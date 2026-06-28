# Base image with Bun
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
# Bun migrates `pnpm-lock.yaml` + `pnpm-workspace.yaml` to its own format
# on first install. The CLI workspace's `package.json` is COPYed so the
# migration can resolve every importer the lockfile references, but
# `--filter './'` then scopes the actual install to the root package
# only. The CLI's source and dependencies never enter the image.
#
# `--ignore-scripts` skips the `fumadocs-mdx` postinstall (declared in
# package.json by PR #131). That hook needs `source.config.ts` and
# `content/docs/`, which aren't present in this hermetic deps stage --
# only `package.json` + the lockfile are. We regenerate fumadocs sources
# explicitly in the builder stage below, where the full tree is available.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY cli/package.json ./cli/package.json
RUN bun install --frozen-lockfile --filter './' --ignore-scripts

# Build Next.js
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# `fumadocs-mdx`'s `lastModified` plugin shells out to `git log` for every
# MDX page (see source.config.ts). The base `oven/bun:1` image is Debian
# slim and ships without `git`, so install it here. Builder-stage only --
# the `runner` stage below does not inherit this layer.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# Compile MDX docs into `src/.source/` before `next build` -- this is what
# the postinstall hook would have done on a non-Docker install.
RUN bunx fumadocs-mdx source.config.ts src/.source
RUN bun run build

# Bundle idempotent migration script with all dependencies
RUN bun build src/db/migrate-idempotent.ts --target=bun --outfile=migrate-idempotent.js

# Bundle one-shot encryption backfill script. Self-host operators run it once
# after upgrading to v0.4.x via:
#   docker compose exec app bun encrypt-backfill.js [--dry-run]
RUN bun build scripts/encrypt-backfill.ts --target=bun --outfile=encrypt-backfill.js

# Final runtime image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# ffmpeg is required by the transcription path: OpenAI Whisper rejects any
# request body above 25 MiB, so long meeting recordings are re-encoded to
# mono Opus before being sent. Pure-JS audio encoders cannot match Opus on
# speech bitrate, so we keep the system binary here even though issue #58
# removed the duration-parsing shell-out.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy Next.js standalone output + public files
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy bundled idempotent migration script (no node_modules needed!)
COPY --from=builder /app/migrate-idempotent.js ./migrate-idempotent.js

# Copy bundled encryption backfill script
COPY --from=builder /app/encrypt-backfill.js ./encrypt-backfill.js

# Copy migrations folder
COPY --from=builder /app/src/db/migrations ./src/db/migrations

# Copy entrypoint
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["bun", "server.js"]

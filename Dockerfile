# Pin bun. `oven/bun:1` floated to 1.4.0, which migrates `pnpm-lock.yaml`
# and then fails `--frozen-lockfile` ("lockfile had changes").
FROM oven/bun:1.4.0 AS base
WORKDIR /app

# Install with pnpm, same pin as hosted CI (`.github/workflows/ci.yml`).
# bun 1.4.0 cannot consume this repo's pnpm lock under `--frozen-lockfile`.
# `--ignore-scripts` skips the `fumadocs-mdx` postinstall (declared in
# package.json by PR #131). That hook needs `source.config.ts` and
# `content/docs/`, which aren't present in this hermetic deps stage --
# only `package.json` + the lockfile + workspace file are. We regenerate
# fumadocs sources explicitly in the builder stage below, where the full
# tree is available.
FROM node:22.20.0-bookworm-slim AS deps
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

# Build Next.js
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# PostHog source-map upload credentials. Empty by default -- only the
# canonical riffado/riffado GitHub Actions build passes these (from repo
# secrets, see .github/workflows/docker.yml). A self-hosted `docker build .`
# or a fork's build gets empty strings here, which short-circuits the guarded
# step below entirely: no `productionBrowserSourceMaps` in next.config.ts, no
# posthog-cli install, no network call, no Riffado credentials required.
ARG POSTHOG_CLI_API_KEY
ARG POSTHOG_CLI_PROJECT_ID
ARG POSTHOG_CLI_HOST=https://eu.posthog.com
ENV POSTHOG_CLI_API_KEY=$POSTHOG_CLI_API_KEY
ENV POSTHOG_CLI_PROJECT_ID=$POSTHOG_CLI_PROJECT_ID
ENV POSTHOG_CLI_HOST=$POSTHOG_CLI_HOST

# `fumadocs-mdx`'s `lastModified` plugin shells out to `git log` for every
# MDX page (see source.config.ts). `curl` installs `posthog-cli` for the
# guarded source-map step below. The pinned `oven/bun:1.4.0` image is
# Debian slim and ships without either, so install them here.
# Builder-stage only -- the `runner` stage below does not inherit this layer.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl \
    && rm -rf /var/lib/apt/lists/*

# Compile MDX docs into `src/.source/` before `next build` -- this is what
# the postinstall hook would have done on a non-Docker install.
RUN bunx fumadocs-mdx source.config.ts src/.source
RUN bun run build

# Source map upload -- only runs when POSTHOG_CLI_API_KEY was passed as a
# build arg. `next build` only emitted `.js.map` files in the first place if
# `productionBrowserSourceMaps` was true (next.config.ts gates that on the
# same var), so this is a true no-op, not just a skipped upload, when unset.
# Injects release/chunk metadata into the built assets and uploads them to
# PostHog. Deliberately non-fatal (`||`) -- a CLI download hiccup or a
# PostHog outage must never block shipping a release. The trailing `find`
# runs unconditionally and deletes any `.js.map` regardless of how far the
# step got (inject-only, upload failure, or full success with
# `--delete-after` already having run), since that cleanup -- not the
# upload -- is what guarantees raw source maps never reach the `runner`
# stage's COPY below.
RUN if [ -n "$POSTHOG_CLI_API_KEY" ]; then \
        ( \
            curl --proto '=https' --tlsv1.2 -LsSf https://download.posthog.com/cli | sh && \
            export PATH="$HOME/.local/bin:/usr/local/bin:$PATH" && \
            posthog-cli sourcemap inject --directory .next && \
            posthog-cli sourcemap upload --directory .next --release-name riffado --delete-after \
        ) || echo "[docker-build] posthog-cli source-map step failed; continuing without it"; \
        find .next -name '*.js.map' -delete; \
    fi

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

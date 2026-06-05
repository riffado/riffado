# Contributing to Mesynx AI

Thanks for your interest. This guide is short on purpose — read it all.

## The One Rule

**You must understand your code.** If you can't explain what your change does and how it interacts with the rest of the system, the PR will be closed.

Using AI to write code is fine. Submitting AI-generated code you don't understand is not.

## Before you submit

- **Search first.** Check [open issues](https://github.com/mesynx-ai/mesynx-ai/issues) and PRs — don't duplicate work in flight.
- **Open an issue for anything non-trivial.** Discuss the approach before you write 500 lines.
- **Read [AGENTS.md](AGENTS.md).** It documents the product principles (self-host is first-class, export parity, no vendor lock-in) and code conventions. PRs that violate them will likely be rejected.
- **Read [BRANCHING.md](BRANCHING.md).** `main` is a rolling integration branch; your PR targets it.

## Development setup

```bash
git clone https://github.com/mesynx-ai/mesynx-ai.git
cd mesynx-ai
pnpm install

cp .env.example .env
# Generate secrets and paste into .env:
echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)"
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"

createdb mesynx-ai
pnpm db:migrate
pnpm dev
```

Open http://localhost:3000.

To run the full containerized stack against your local code instead:

```bash
docker compose up --build
```

## Submitting a PR

1. Branch off `main`: `feature/xxx`, `fix/xxx`, or `docs/xxx`.
2. Write clean, tested code. Follow existing patterns.
3. Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `refactor:`, `chore:`, `perf:`, `docs:`). Same prefixes as our issue titles.
4. Run everything before pushing:
   ```bash
   pnpm format-and-lint:fix
   pnpm type-check
   pnpm test
   pnpm build
   ```
   All four must pass.
5. Open the PR against `main`, link the related issue, and explain **why** the change is needed (not just what it does).

Do **not** edit `CHANGELOG.md` — maintainers curate it at release time. See [BRANCHING.md](BRANCHING.md).

## Database migrations

Edit `src/db/schema.ts` first, then run `pnpm db:generate`. **Never hand-write migration SQL** — drizzle tracks snapshots in `src/db/migrations/meta/` and hand-written files cause silent history corruption. See [AGENTS.md](AGENTS.md) for context.

## Integration tests

Live Plaud API tests are opt-in (skipped in CI to avoid leaking credentials):

```bash
export PLAUD_BEARER_TOKEN="Bearer your-token-here"
bun test src/tests/plaud.integration.test.ts
```

## Security

**Do not report vulnerabilities in public issues.** See [SECURITY.md](SECURITY.md) for the private disclosure process.

## License

Mesynx AI is [AGPL-3.0](LICENSE). By contributing, you agree your contributions are licensed under the same terms. If you run a modified version as a network service, you must release your modifications.

## Code of Conduct

Be decent. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

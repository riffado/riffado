# `src/lib/hosted/`

Hosted-only code. Lives here so that the boundary between "everything self-hosters benefit from" and "code that only runs on the Riffado-operated hosted instance" is enforced at directory level instead of guessed at per-file.

## Rule

Code outside `src/lib/hosted/` and `src/app/(hosted)/` does **not** import from these directories.

The rule is one-way: hosted code may import from anywhere in the repo (it builds on top of the public app), but the public app must never depend on hosted code -- otherwise the self-host build would either fail to compile or pull in code paths that have no business running outside Riffado-operated infra.

### Exception: hosted-only routes that need a stable public URL

A small number of route handlers live under `src/app/api/` (outside `(hosted)`) but import from `src/lib/hosted/`. These are routes whose URL is part of an external contract that must not move when `ADMIN_HOSTNAME` changes -- third-party services have the URL stored on their side and cannot be re-pointed atomically.

Named exception today: **`src/app/api/stripe/webhook/route.ts`**. The Stripe webhook endpoint URL is registered once in the Stripe dashboard (or via the API) and is stored on Stripe's side; moving it to `admin.riffado.com` later would silently drop deliveries. The route stays at `${APP_URL}/api/stripe/webhook`. The hostname gate in `src/middleware.ts` allows `/api/stripe/*` on both the customer host and the admin host (see `ADMIN_HOST_SHARED_PREFIXES`), and the route's own guards (`env.IS_HOSTED` + `isStripeConfigured()`) return 404/503 on self-host or unconfigured instances.

New exceptions require the same justification: an external system has the URL pinned, and moving it would break in-flight resources. Otherwise, put the route under `src/app/(hosted)/api/`.

If you need to call into hosted-only behavior from public code (for example, "is this user on a paid plan?"), introduce a **capability interface** under `src/lib/` with a free/all-on default implementation, then wire the hosted impl through DB state. The public app reads the interface; the hosted app writes the DB rows the interface reads. See `src/lib/entitlements.ts` (when it exists) for the canonical example.

## What lives here today

- `admin/` -- operator-only dashboard primitives (guards, IP allowlist, elevated-cookie, action helpers, install-hit stats, suspension). Used by `src/app/(hosted)/admin/*` pages and `src/app/(hosted)/api/admin/*` routes.
- `hostname-gate.ts` -- pure decision logic for the top-level middleware that locks `/admin/*` and `/api/admin/*` to a dedicated admin subdomain when `ADMIN_HOSTNAME` is set.

## What lives in `src/app/(hosted)/`

The corresponding route group. Currently:

- `src/app/(hosted)/admin/(gated)/*` -- the protected admin pages.
- `src/app/(hosted)/admin/reauth/*` -- the pre-gate re-auth flow.
- `src/app/(hosted)/api/admin/*` -- admin mutation/read API.

Next.js route groups (parentheses) don't affect URL paths -- `(hosted)/admin/users/page.tsx` still serves `/admin/users`. The grouping is purely organizational, but the hostname gate in `src/middleware.ts` enforces that those URLs are only reachable on the admin host in production.

## Why one repo instead of two

Plausible pattern. Single AGPL repo with billing and operator tooling kept in-tree, gated by `IS_HOSTED` and (in production) by hostname. AGPL § 13 is the anti-fork mechanism. See the AGENTS.md "Don't break existing deployments" block and the architecture discussion that produced this layout for background.

If hosted-only surface grows large enough that the public/private balance becomes a problem, a future repo split is mechanical: `git mv src/lib/hosted/ ../riffado-hosted/lib/` and `git mv src/app/(hosted)/ ../riffado-hosted/app/`. Until then, this directory IS the seam.

## Self-host posture

Code in `src/lib/hosted/` ships in the self-host docker image. It is dormant by default:

- Admin pages: `requireAdminPage()` checks `env.ADMIN_EMAILS`; if empty (default), no one is admin and the routes 404.
- Hostname gate: `env.ADMIN_HOSTNAME` is unset by default; the gate is permissive and `/admin/*` works on the operator's own host without subdomain ceremony.
- Billing (when added): inert unless `STRIPE_SECRET_KEY` and friends are configured.

Self-hosters never need to touch any of this. It's load-bearing for Riffado-operated infra and invisible elsewhere.

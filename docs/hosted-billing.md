# Hosted Billing — Operator Runbook

This document is for Riffado operators running the hosted deployment (`IS_HOSTED=true`, `BILLING_ENABLED=true`). Self-host operators can ignore it entirely.

## Architecture

Billing runs inside the Next.js process — no separate worker binary. A background interval (`src/lib/hosted/billing/worker.ts`) fires every 5 minutes and runs, in order:

1. **Cycle close** — rolls over Mynah-seconds grants for users whose 30-day cycle has elapsed.
2. **Expired trials** — demotes `hosted_pro` users whose `planTransitionUntil` has passed and who have no active subscription to `hosted_free`, schedules account deletion (7-day grace).
3. **Due deletions** — hard-deletes users whose `accountDeletionScheduledAt` has passed. R2 objects cleaned up best-effort, then `DELETE FROM users` cascades all dependent rows.
4. **Grace reminders** — sends email reminders at T-3 (trial) or T-7 (paid) and T-1 (last day) before scheduled deletion.
5. **Transition emails** — for the grandfathered pre-launch cohort (`hosted_free` with `plan_transition_until` set and no deletion clock), sends the start / reminder / ended sequence across the 30-day migration window.
6. **Stripe reconcile** (every 6th tick, ~30 min) — re-fetches non-terminal Stripe subscriptions that haven't been mirrored recently and re-mirrors local state.

The worker starts automatically via `instrumentation.ts` when `BILLING_ENABLED` is true.

## Key env vars

| Var | Default | Purpose |
|-----|---------|---------|
| `BILLING_ENABLED` | unset | Master switch. Requires `IS_HOSTED=true`, Stripe credentials, at least one founding monthly Price id (`STRIPE_PRICE_ID_USD` and/or `STRIPE_PRICE_ID_EUR`), at least one standard monthly Price id (`STRIPE_STANDARD_PRICE_ID_USD` and/or `STRIPE_STANDARD_PRICE_ID_EUR`), `MYNAH_BASE_URL`, and `MYNAH_SERVICE_TOKEN`. |
| `STRIPE_SECRET_KEY` | unset | Stripe secret key (`sk_live_...` / `sk_test_...`). |
| `STRIPE_WEBHOOK_SECRET` | unset | Signing secret for `/api/stripe/webhook` (`whsec_...`). |
| `STRIPE_PRICE_ID_USD` | unset | Stripe Price id for the founding monthly USD Pro subscription. |
| `STRIPE_PRICE_ID_EUR` | unset | Stripe Price id for the founding monthly EUR Pro subscription. |
| `STRIPE_STANDARD_PRICE_ID_USD` | unset | Stripe Price id for the standard monthly USD Pro subscription used after founding capacity is gone. |
| `STRIPE_STANDARD_PRICE_ID_EUR` | unset | Stripe Price id for the standard monthly EUR Pro subscription used after founding capacity is gone. |
| `STRIPE_PRICE_ID_USD_ANNUAL` | unset | Optional Stripe Price id for the annual USD Pro subscription. Required with `BILLING_PRICE_USD_ANNUAL` when monthly USD is supported and annual billing is enabled. |
| `STRIPE_PRICE_ID_EUR_ANNUAL` | unset | Optional Stripe Price id for the annual EUR Pro subscription. Required with `BILLING_PRICE_EUR_ANNUAL` when monthly EUR is supported and annual billing is enabled. |
| `STRIPE_LEGACY_PRO_PRICE_IDS` | unset | Optional comma-separated historical Price ids. They grant Pro when mirrored from Stripe but are never used for new Checkout sessions. Must not contain current Price ids. |
| `STRIPE_PORTAL_CONFIGURATION_ID` | unset | Pins the Customer Portal to a specific configuration (`bpc_...`) with subscription/price switching disabled. Do not rely on the account default in hosted production. |
| `STRIPE_TAX_RATE_ID_EUR` | unset | Optional. Inclusive VAT rate (`txr_...`) applied to EUR (EU/EEA) subscriptions so invoices show the VAT line. Match the EUR Price's inclusive `tax_behavior`. Never applied to USD sales. |
| `MYNAH_BASE_URL` | unset | Mynah transcription proxy base URL. Required with `BILLING_ENABLED=true`; configure explicitly in hosted production. |
| `MYNAH_SERVICE_TOKEN` | unset | Shared secret for authenticating Riffado to Mynah. Required with `BILLING_ENABLED=true`. |
| `BILLING_PRICE_USD` | `5.00` | Founding monthly display amount (decimal string) for USD copy/emails. |
| `BILLING_PRICE_EUR` | `5.00` | Founding monthly display amount (decimal string) for EUR copy/emails. |
| `BILLING_STANDARD_PRICE_USD` | `9.00` | Standard monthly display amount (decimal string) for USD copy/emails after founding capacity is gone. |
| `BILLING_STANDARD_PRICE_EUR` | `9.00` | Standard monthly display amount (decimal string) for EUR copy/emails after founding capacity is gone. |
| `BILLING_PRICE_USD_ANNUAL` | unset | Optional annual display amount (decimal string) for USD UI/API responses. Annual display and annual Price ids must be configured together. |
| `BILLING_PRICE_EUR_ANNUAL` | unset | Optional annual display amount (decimal string) for EUR UI/API responses. Annual display and annual Price ids must be configured together. |
| `BILLING_DEFAULT_CURRENCY` | `usd` | Currency used when geo is unknown (non-EU/EEA buyers). |
| `GEO_COUNTRY_HEADER` | unset | Request header carrying the buyer's ISO country, used to pick checkout currency. Set to whatever the hosted LB/CDN injects; checked before the built-in `x-vercel-ip-country` / `cf-ipcountry` fallbacks. Unset and behind a non-CDN LB means every buyer gets `BILLING_DEFAULT_CURRENCY`. |
| `BILLING_PRO_INTERVAL` | `1 month` | Interval label for display; actual cadence comes from the Stripe Price. |
| `BILLING_PRO_DESCRIPTION` | `Riffado Hosted Pro` | Fallback subscription description. |
| `BILLING_PRO_INCLUDED_SECONDS` | `54000` | Mynah-seconds per 30-day cycle for Pro (15 hr). |
| `BILLING_FREE_INCLUDED_SECONDS` | `1800` | Mynah-seconds for free/lockout accounts (30 min). |
| `BILLING_TRIAL_DAYS` | `14` | Trial length for new signups. |
| `BILLING_TRIAL_GRACE_DAYS` | `7` | Grace before hard-delete for never-paid users. |
| `BILLING_PAID_GRACE_DAYS` | `30` | Grace before hard-delete for formerly-paid users. |
| `BILLING_LAUNCH_DATE` | unset | ISO date (`YYYY-MM-DD`). Gates pre-launch grandfather logic and transition emails. Founding pricing is capacity-based, not date-window-based. |
| `BILLING_FOUNDING_MEMBER_CAPACITY` | `100` | First monthly Pro subscribers who can ever claim founding pricing. Claimed slots never reopen; the benefit is forfeited when the subscription ends. Open founding Checkout reservations reduce the public remaining count until Stripe confirms completion or expiry. |

## First-time Stripe setup

Do this once per mode (test, then live). The mirror only runs when the webhook is configured with the right events — miss one and plans silently never activate.

1. **Product + Prices.** Create one Product ("Riffado Hosted Pro") with recurring monthly Prices for each supported currency: a founding monthly Price (`STRIPE_PRICE_ID_USD` / `STRIPE_PRICE_ID_EUR`) and a standard monthly Price (`STRIPE_STANDARD_PRICE_ID_USD` / `STRIPE_STANDARD_PRICE_ID_EUR`). Founding Prices are only issued after an atomic DB reservation and only for monthly Checkout. Hosted billing requires at least one founding monthly Price and one standard monthly Price. If annual billing is enabled, create a separate annual Price and display amount for every supported monthly currency. Put historical Price ids in `STRIPE_LEGACY_PRO_PRICE_IDS` only after they are no longer offered for new Checkout.
2. **Webhook endpoint.** Add an endpoint at `https://<host>/api/stripe/webhook` and enable **exactly** these events — the dispatcher in `webhook.ts` handles these and ignores the rest:
   - `checkout.session.completed`
   - `checkout.session.expired`
   - `checkout.session.expired`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.paused`
   - `customer.subscription.resumed`
   - `invoice.paid`
   - `invoice.payment_failed`

   Copy the endpoint's signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`. (In local/test, `stripe listen --forward-to localhost:3000/api/stripe/webhook` prints the same secret and forwards all events.)
3. **VAT rate (EU).** If you charge EU VAT, create a Tax Rate (`stripe tax_rates create`) with `inclusive=true` and your rate (e.g. Polish 23% under the home-country/no-OSS model, valid below the EUR 10k/yr cross-border threshold). Put its id (`txr_...`) in `STRIPE_TAX_RATE_ID_EUR`. Checkout applies it to EUR subscriptions via `subscription_data.default_tax_rates`, so every renewal invoice carries the VAT line. USD sales get no rate (non-EU export). Cross the 10k threshold and you must move to destination VAT + OSS.
4. **Customer Portal.** Create a portal configuration with: update payment method, invoice history, cancel at period end, and customer email/address update. Disable subscription updates, price switching, quantity changes, promotion-code changes, and plan switching. Put its id (`bpc_...`) in `STRIPE_PORTAL_CONFIGURATION_ID` so the portal renders exactly this feature set regardless of the account default.
5. **Backfill, then enable.** Set `BILLING_LAUNCH_DATE`, run `scripts/billing-backfill.ts --launch=<date>` to grandfather existing accounts, then flip `BILLING_ENABLED=true`.

## Common operator tasks

### Safe Price rotation

Use this order whenever changing a current Stripe Price id:

1. Deploy the existing current Price id in `STRIPE_LEGACY_PRO_PRICE_IDS` before changing `STRIPE_PRICE_ID_*`. Legacy ids continue to grant Pro for already-mirrored subscriptions but are never used for new Checkout sessions.
2. Deploy the new `STRIPE_PRICE_ID_*` value (and matching `BILLING_PRICE_*` display amount when the amount changed). For annual billing, deploy the annual Price and display amount for every supported monthly currency together.
3. Verify the admin billing dashboard shows zero unknown live Price groups after the deploy and after the next Stripe reconcile tick. Any unknown group means the catalog is misconfigured; the mirror freezes the current plan rather than changing entitlements.
4. Leave the legacy id configured for as long as any live subscription still uses it. Never remove a legacy Price id while Stripe still has `active`, `trialing`, or `past_due` subscriptions on that Price.
5. After Stripe reports zero live subscriptions on the legacy Price and the admin dashboard still shows zero unknown groups, remove it from `STRIPE_LEGACY_PRO_PRICE_IDS` in a later deploy.

### Extend a user's grace period

```sql
UPDATE users
SET account_deletion_scheduled_at = now() + interval '30 days',
    updated_at = now()
WHERE id = '<user-id>';
```

### Cancel a scheduled deletion (reactivate manually)

```sql
UPDATE users
SET account_deletion_scheduled_at = NULL,
    plan = 'hosted_pro',
    updated_at = now()
WHERE id = '<user-id>';
```

The user will also need an active Stripe subscription to avoid being re-demoted on the next worker tick. Either have them go through checkout, or create the subscription in the Stripe dashboard against their `stripe_customer_id`.

### Clear an email_log entry (re-send an email)

The `email_log` table prevents duplicate sends. To allow a re-send:

```sql
DELETE FROM email_log
WHERE user_id = '<user-id>'
  AND event_key = '<event-key>';
```

Event key formats:
- `welcome_hosted_pro` — once per user
- `over_cap` — once per user
- `payment_failed:<invoiceId>` — once per failed Stripe invoice
- `grace_started:<deletionAt ISO>` — once per deletion schedule
- `grace_reminder:<deletionAt ISO>` — once per deletion schedule
- `grace_last_day:<deletionAt ISO>` — once per deletion schedule

### Force Stripe reconcile

The reconcile runs automatically every ~30 minutes. To trigger immediately, restart the Next.js process — the worker fires its first tick on startup. Because `mirror.ts` is idempotent, reconcile is the safest way to recover from a missed or failed webhook (it re-fetches live state from Stripe).

### Check a user's billing state

```sql
SELECT id, email, plan, plan_transition_until, founding_member,
       ever_paid_at, account_deletion_scheduled_at,
       monthly_mynah_seconds_remaining, monthly_mynah_grant_reset_at
FROM users
WHERE email = '<email>';
```

### Check subscription status

```sql
SELECT s.id, s.status, s.amount_value, s.amount_currency, s.interval,
       s.billing_country, s.stripe_price_id, s.next_payment_at, s.canceled_at
FROM subscriptions s
WHERE s.user_id = '<user-id>'
ORDER BY s.created_at DESC
LIMIT 1;
```

## Grace period policy

| Path | Trigger | Grace days | Emails |
|------|---------|------------|--------|
| Trial (never paid, post-launch) | `planTransitionUntil` expires with no subscription | 7 | grace-started, grace-reminder (T-3), grace-last-day (T-1), account-deleted |
| Paid (or pre-launch grandfather) | Stripe subscription goes terminal | 30 | grace-started, grace-reminder (T-7), grace-last-day (T-1), account-deleted |

Grace emails are keyed by `deletionAt.toISOString()`. If a user reactivates and then lapses again, the new deletion timestamp re-arms the email sequence.

## Account deletion

Hard delete. The worker:
1. Lists all recording storage paths for the user.
2. Deletes R2/S3 objects (best-effort, logged on failure).
3. Captures the user's email.
4. `DELETE FROM users WHERE id = ...` — FK cascades handle all dependent rows.
5. Sends the `account-deleted` confirmation email to the captured address.

There is no soft-delete or recovery path. Export is available throughout the grace period.

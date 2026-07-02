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
| `BILLING_ENABLED` | unset | Master switch. Requires `IS_HOSTED=true` + `STRIPE_SECRET_KEY`. |
| `STRIPE_SECRET_KEY` | unset | Stripe secret key (`sk_live_...` / `sk_test_...`). |
| `STRIPE_WEBHOOK_SECRET` | unset | Signing secret for `/api/stripe/webhook` (`whsec_...`). |
| `STRIPE_PRICE_ID_USD` | unset | Stripe Price id for the USD Pro subscription. |
| `STRIPE_PRICE_ID_EUR` | unset | Stripe Price id for the EUR Pro subscription. |
| `STRIPE_PORTAL_CONFIGURATION_ID` | unset | Optional. Pins the Customer Portal to a specific configuration (`bpc_...`). Unset falls back to the account's default portal config. |
| `STRIPE_TAX_RATE_ID_EUR` | unset | Optional. Inclusive VAT rate (`txr_...`) applied to EUR (EU/EEA) subscriptions so invoices show the VAT line. Match the EUR Price's inclusive `tax_behavior`. Never applied to USD sales. |
| `BILLING_PRICE_USD` | `5.00` | Display amount (decimal string) for USD copy/emails. |
| `BILLING_PRICE_EUR` | `5.00` | Display amount (decimal string) for EUR copy/emails. |
| `BILLING_DEFAULT_CURRENCY` | `usd` | Currency used when geo is unknown (non-EU/EEA buyers). |
| `GEO_COUNTRY_HEADER` | unset | Request header carrying the buyer's ISO country, used to pick checkout currency. Set to whatever the hosted LB/CDN injects; checked before the built-in `x-vercel-ip-country` / `cf-ipcountry` fallbacks. Unset and behind a non-CDN LB means every buyer gets `BILLING_DEFAULT_CURRENCY`. |
| `BILLING_PRO_INTERVAL` | `1 month` | Interval label for display; actual cadence comes from the Stripe Price. |
| `BILLING_PRO_DESCRIPTION` | `Riffado Hosted Pro` | Fallback subscription description. |
| `BILLING_PRO_INCLUDED_SECONDS` | `54000` | Mynah-seconds per 30-day cycle for Pro (15 hr). |
| `BILLING_FREE_INCLUDED_SECONDS` | `1800` | Mynah-seconds for free/lockout accounts (30 min). |
| `BILLING_TRIAL_DAYS` | `14` | Trial length for new signups. |
| `BILLING_TRIAL_GRACE_DAYS` | `7` | Grace before hard-delete for never-paid users. |
| `BILLING_PAID_GRACE_DAYS` | `30` | Grace before hard-delete for formerly-paid users. |
| `BILLING_LAUNCH_DATE` | unset | ISO date (`YYYY-MM-DD`). Gates founding-member eligibility and pre-launch grandfather logic. |
| `BILLING_FOUNDING_MEMBER_WINDOW_DAYS` | `180` | Days after launch date during which new subscribers get `foundingMember = true`. |

## First-time Stripe setup

Do this once per mode (test, then live). The mirror only runs when the webhook is configured with the right events — miss one and plans silently never activate.

1. **Product + Prices.** Create one Product ("Riffado Hosted Pro") with a recurring monthly Price per currency: USD (tax behavior exclusive) and EUR (tax behavior inclusive). Put the Price ids in `STRIPE_PRICE_ID_USD` / `STRIPE_PRICE_ID_EUR`.
2. **Webhook endpoint.** Add an endpoint at `https://<host>/api/stripe/webhook` and enable **exactly** these events — the dispatcher in `webhook.ts` handles these and ignores the rest:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.paused`
   - `customer.subscription.resumed`
   - `invoice.paid`
   - `invoice.payment_failed`

   Copy the endpoint's signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`. (In local/test, `stripe listen --forward-to localhost:3000/api/stripe/webhook` prints the same secret and forwards all events.)
3. **VAT rate (EU).** If you charge EU VAT, create a Tax Rate (`stripe tax_rates create`) with `inclusive=true` and your rate (e.g. Polish 23% under the home-country/no-OSS model, valid below the EUR 10k/yr cross-border threshold). Put its id (`txr_...`) in `STRIPE_TAX_RATE_ID_EUR`. Checkout applies it to EUR subscriptions via `subscription_data.default_tax_rates`, so every renewal invoice carries the VAT line. USD sales get no rate (non-EU export). Cross the 10k threshold and you must move to destination VAT + OSS.
4. **Customer Portal.** Create a portal configuration with: update payment method, invoice history, cancel at period end, and customer email/address update. Put its id (`bpc_...`) in `STRIPE_PORTAL_CONFIGURATION_ID` so the portal renders exactly this feature set regardless of the account default.
5. **Backfill, then enable.** Set `BILLING_LAUNCH_DATE`, run `scripts/billing-backfill.ts --launch=<date>` to grandfather existing accounts, then flip `BILLING_ENABLED=true`.

## Common operator tasks

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
SELECT s.id, s.status, s.amount_value, s.amount_currency, s.billing_country,
       s.stripe_price_id, s.next_payment_at, s.canceled_at
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

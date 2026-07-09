# `src/lib/hosted/billing/`

Stripe integration for hosted Riffado. Self-host instances never touch these
code paths (guarded on `env.IS_HOSTED` + `isStripeConfigured()`).

## Model

We use **Stripe Checkout Sessions** (`mode: subscription`) for signup and the
**Customer Portal** for self-service (update card, view invoices, cancel).
Stripe owns the payment rail; our own state machine owns everything downstream
of it — entitlements, storage cap, grace, lapse, cycle-close, deletion, and
the grandfather-transition emails.

The processor-independent state machine is the reason the swap from Mollie was a
rail replacement, not a rewrite: `mirror.ts` normalizes a Stripe subscription
into local rows and side effects, and nothing above it knows the processor.

## Trials

We do **not** use Stripe `trial_period_days`. The 14-day trial is owned by our
own worker/DB state; a Stripe subscription is only created when the user
converts (adds a card and completes Checkout). `trialing` is accepted as a
Pro-granting status defensively, but in practice a live subscription means paid.

## Idempotency

1. **Checkout Session create** takes a required `idempotencyKey` (a fresh
   nonce per HTTP request from the route). Its job is to make the Stripe SDK's
   automatic network-level retries of that single `.create()` call safe: a
   timed-out create won't spawn a second Session. It does NOT dedup separate
   user submits — a genuine double-click is two HTTP requests with two keys and
   creates two Sessions. That's harmless: only the Session the browser
   navigates to can be completed, and the other expires unused (no double
   charge).
2. **Webhook delivery claim** — `stripe_webhook_events(event_id)`,
   `claimWebhookDelivery()`. First-write-wins on `event.id`; duplicate Stripe
   deliveries are acked without re-running side effects. The claim row is
   written BEFORE processing, so a transient handler failure is not retried on
   redelivery (see below).
3. `mirror.ts` is idempotent by construction — re-mirroring the same
   subscription (webhook redelivery, reconcile tick) converges to the same
   local state, and the welcome/grace emails dedup once-only at `email_log`.

## Currency

Two fixed Stripe Prices, one per currency (`STRIPE_PRICE_ID_USD`,
`STRIPE_PRICE_ID_EUR`). `pricing.ts` resolves the buyer's currency from the geo
country at checkout (EU/EEA → EUR, else the configured default), picks the
matching Price, and the subscription's currency is then fixed for its lifetime.
`billing_country` is captured for our own records via
`customer_update: { address: "auto" }` on the Session (Checkout does not persist
a collected address back onto an existing Customer otherwise).

## Period boundaries (dahlia)

The Stripe API version is pinned to `2026-06-24.dahlia` in `stripe-client.ts`.
Under dahlia, `current_period_end` lives on the **subscription item**
(`sub.items.data[0].current_period_end`), not the subscription, and an invoice's
subscription reference is `invoice.parent.subscription_details.subscription`,
not the removed top-level `invoice.subscription`. `mirror.ts` and `webhook.ts`
read the dahlia locations; do not "fix" them back to the pre-dahlia fields.

## Webhook claim blocks transient-failure retries

`claimWebhookDelivery` writes the `stripe_webhook_events` row BEFORE downstream
processing runs — that is how duplicate deliveries are suppressed. Trade-off: if
`mirror*` throws transiently, Stripe's redelivery of the same `event.id` hits
the claim row and is acked without re-running the work.

Posture: **fail loud, operator replays manually.**

1. Sentry / log alert fires on `[stripe-webhook] handler threw for ...`.
2. Operator opens the Stripe dashboard → Developers → Events, finds the event,
   and resends it.
3. The duplicate-claim short-circuit fires. To force re-processing, delete the
   row first: `DELETE FROM stripe_webhook_events WHERE event_id = '<id>';` then
   resend the event.

Because `mirror.ts` is idempotent, the safest recovery is usually the
`reconcile` tick (below) rather than a manual replay — it re-fetches live state
from Stripe and re-mirrors.

## Reconcile

Every 6th worker tick (~30 min), `reconcile.ts` re-fetches non-terminal
subscriptions that haven't been mirrored recently and re-mirrors them. This is
the safety net for missed or transiently-failed webhooks; it converges local
state to Stripe's without depending on webhook delivery.

## Webhook route

`src/app/api/stripe/webhook/route.ts` verifies the signature with
`constructEventAsync(rawBody, sig, STRIPE_WEBHOOK_SECRET)` (SubtleCrypto; works
in both Node and Edge), then dispatches the verified event. It always 200s after
a valid signature so Stripe stops retrying; handler errors are logged, not
surfaced. Guards: `env.IS_HOSTED` (404 on self-host) and configured keys (503).
The hostname gate allows `/api/stripe/*` on both the customer host and the admin
host (`ADMIN_HOST_SHARED_PREFIXES`).

## Plan catalog

`plans.ts` maps `(status, priceId)` → plan + entitlements. Pro requires both a
Pro-granting status (`active`, `trialing`, `past_due`) AND a configured Pro
Price id. An unknown price (misconfiguration) yields **free** entitlements,
never privilege escalation — visible as "active subscription, free
entitlements" rather than a silent upgrade.

## EU consumer-law waiver

`subscriptions.withdrawal_waiver_accepted_at` captures the moment the user
explicitly waived their 14-day withdrawal right in exchange for immediate
performance (Polish art. 38 ust. 13 or its EU equivalent). It MUST be captured
at checkout submit before payment — `startSubscriptionCheckout` requires it and
throws `CheckoutPreconditionError("missing_waiver")` otherwise. It is passed
through to the subscription metadata and mirrored back onto the local row.

## File map

- `stripe-client.ts` — lazy SDK singleton (pinned `apiVersion`) + config check.
- `pricing.ts` — currency resolution, per-currency Price lookup, `isProPriceId`.
- `plans.ts` — `(status, priceId)` → entitlements, `unixToDate`, founding window.
- `checkout.ts` — `startSubscriptionCheckout`, `reactivateSubscriptionIfStillInPeriod`,
  `cancelSubscription`, `createBillingPortalSession`, `getOrCreateStripeCustomer`.
- `mirror.ts` — `mirrorStripeSubscription`, `mirrorSubscriptionById`,
  `mirrorCheckoutSession`.
- `webhook.ts` — dispatch: claim idempotency, delegate to mirror, payment-failed email.
- `reconcile.ts` — periodic drift correction against live Stripe state.

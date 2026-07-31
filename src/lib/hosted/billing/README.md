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
2. **Webhook inbox** — `stripe_webhook_events(event_id)` stores every verified
   Stripe event as `pending` before the route acknowledges it. A worker claims
   rows as `processing`, then marks them `completed` or retries failures with
   exponential backoff. The unique event id makes Stripe redelivery safe.
3. `mirror.ts` is idempotent by construction — re-mirroring the same
   subscription (webhook redelivery, reconcile tick) converges to the same
   local state, and the welcome/grace emails dedup once-only at `email_log`.

## Currency

Stripe Prices are resolved by currency + interval. `STRIPE_PRICE_ID_USD` and
`STRIPE_PRICE_ID_EUR` are the founding monthly Prices.
`STRIPE_STANDARD_PRICE_ID_USD` and `STRIPE_STANDARD_PRICE_ID_EUR` are the
standard monthly Prices used once founding capacity is gone; billing requires at
least one founding monthly and one standard monthly Price.
`STRIPE_PRICE_ID_USD_ANNUAL` and `STRIPE_PRICE_ID_EUR_ANNUAL` are optional
annual Prices. When annual billing is enabled, every supported monthly currency
must have a matching annual Price and `BILLING_PRICE_*_ANNUAL` display amount.
`pricing.ts` resolves the buyer's currency from the geo country (EU/EEA → EUR,
else the configured default), then picks founding monthly only when an atomic DB
reservation succeeds and standard monthly otherwise. Annual Checkout never falls
back to a monthly Price and never claims founding pricing. The subscription's
currency/interval are then fixed for its lifetime.
`STRIPE_LEGACY_PRO_PRICE_IDS` grants Pro when mirrored from Stripe but those ids
are excluded from new Checkout sessions and must not duplicate current Price
ids. `billing_country` is captured for our own records via
`customer_update: { address: "auto" }` on the Session (Checkout does not persist
a collected address back onto an existing Customer otherwise).

## Period boundaries (dahlia)

The Stripe API version is pinned to `2026-06-24.dahlia` in `stripe-client.ts`.
Under dahlia, `current_period_end` lives on the **subscription item**
(`sub.items.data[0].current_period_end`), not the subscription, and an invoice's
subscription reference is `invoice.parent.subscription_details.subscription`,
not the removed top-level `invoice.subscription`. `mirror.ts` and `webhook.ts`
read the dahlia locations; do not "fix" them back to the pre-dahlia fields.

## Founding monthly reservations

Founding pricing is capacity-based. Checkout does not choose the founding Price
from a read-only count. It first creates a short-lived
`founding_member_reservations` row inside an advisory-lock transaction. Public
remaining count is `capacity - consumed slots - reserved sessions`, so open
Checkout Sessions hold capacity. The founding Stripe Price is only sent to
Stripe when the reservation exists, and the reservation id is copied into both
Checkout Session metadata and Subscription metadata.

Stripe Checkout Sessions issued for founding pricing get an explicit
`expires_at`. Expired or abandoned sessions release capacity only after Stripe
confirms `checkout.session.expired` or the worker retrieves the expired session.
Successful payment consumes the reservation from subscription metadata and stamps
`users.founding_member_claimed_at`; that timestamp is never cleared. Cancellation
clears only `users.founding_member`, so the active price is forfeited without
reopening capacity.

## Durable webhook inbox

After signature verification, the route inserts the event payload as `pending`
and returns 200 only after that insert succeeds. The billing worker claims due
rows with `FOR UPDATE SKIP LOCKED`, marks them `processing`, and guards every
completion/failure write with a per-claim token. A crashed process loses its
15-minute lease; another process can claim it without accepting a late write
from the original worker.

Failures retry with exponential backoff (one minute through one hour) for five
attempts. A terminal failure remains as `failed`, with its error and attempts
preserved. An elevated admin can POST `{ eventId, reason }` to
`/api/admin/actions/replay-stripe-webhook` to requeue only a failed event; this
resets its attempts without deleting its durable or audit row. Replaying an
already-pending, processing, or completed event is a logged no-op.

Reconciliation remains the drift safety net, and is still the preferred repair
for subscription state that can be reconstructed from Stripe. The inbox also
preserves event-specific work such as payment-failure and analytics side effects
that reconciliation cannot reproduce.

## Reconcile

Every 6th worker tick (~30 min), `reconcile.ts` re-fetches non-terminal
subscriptions that haven't been mirrored recently and re-mirrors them. This is
the safety net for missed or transiently-failed webhooks; it converges local
state to Stripe's without depending on webhook delivery.

## Webhook route

`src/app/api/stripe/webhook/route.ts` verifies the signature with
`constructEventAsync(rawBody, sig, STRIPE_WEBHOOK_SECRET)` (SubtleCrypto; works
in both Node and Edge), then writes the verified event to the inbox. It returns
200 only after durable storage succeeds; a persistence failure returns 500 so
Stripe retries. Guards: `env.IS_HOSTED` (404 on self-host) and configured keys (503).
The hostname gate allows `/api/stripe/*` on both the customer host and the admin
host (`ADMIN_HOST_SHARED_PREFIXES`).

## Plan catalog

`plans.ts` maps `(status, priceId)` → plan + entitlements. Pro requires both a
Pro-granting status (`active`, `trialing`, `past_due`) AND a configured Pro
Price id. Legacy Price ids are accepted for existing subscriptions but are not
checkoutable. An unknown live Price is mirrored for operator visibility but does
not mutate `users.plan` or run activation/lapse side effects; a terminal
subscription still demotes through the normal lapse path.

## EU consumer-law waiver

`subscriptions.withdrawal_waiver_accepted_at` captures the moment the user
explicitly waived their 14-day withdrawal right in exchange for immediate
performance (Polish art. 38 ust. 13 or its EU equivalent). It MUST be captured
at checkout submit before payment — `startSubscriptionCheckout` requires it and
throws `CheckoutPreconditionError("missing_waiver")` otherwise. It is passed
through to the subscription metadata and mirrored back onto the local row.

## File map

- `stripe-client.ts` — lazy SDK singleton (pinned `apiVersion`) + config check.
- `pricing.ts` — currency/interval/founding-vs-standard resolution, Price catalog, `isProPriceId`.
- `founding-reservations.ts` — reconciles expired founding Checkout reservations against Stripe.
- `plans.ts` — `(status, priceId)` → entitlements and `unixToDate`.
- `checkout.ts` — `startSubscriptionCheckout`, `reactivateSubscriptionIfStillInPeriod`,
  `cancelSubscription`, `createBillingPortalSession`, `getOrCreateStripeCustomer`.
- `mirror.ts` — `mirrorStripeSubscription`, `mirrorSubscriptionById`,
  `mirrorCheckoutSession`.
- `webhook.ts` — dispatches a claimed inbox event to mirror, reservation expiry, and payment-failed email.
- `webhook-inbox.ts` — claims, retries, and completes the durable Stripe event inbox.
- `reconcile.ts` — periodic drift correction against live Stripe state.

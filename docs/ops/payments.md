# Payments operations

> Created for Task 16 (payment integration hardening) of
> `DROPSHIPPING-AGENT-PLAN.md`. Covers how payment methods are chosen and
> shown, how an order becomes paid, how webhook events are authenticated and
> deduplicated, what failure/retry messages mean, and — most importantly —
> what refund and cancellation actually do.

## Ownership map

| Concern | Owner | Code |
| --- | --- | --- |
| Which methods checkout offers | Store | `store/lib/payment/methods.ts`, checkout form template |
| Payment sessions, completion, order commit | Openfront | `initiatePaymentSession`, `completeActiveCart` → `handlePaidOrder` |
| Provider adapters (settle/capture/refund/verify) | Openfront executes its copies | `openfront/features/integrations/payment/*` — the store carries vetted mirrors in `store/features/integrations/payment/*` (pinned by tests) |
| Payment webhook ingress | Openfront | `app/api/payment-webhooks/[providerId]` → `handlePaymentProviderWebhook` |
| Refunds | Openfront, via provider adapter | `refundPaymentFunction` |
| Supplier-side cancellation | OpenShip | `cancelPurchase` — **never touches money** |

The store never receives provider webhooks and holds no secret keys (see the
recon note in `store/.env.example`): it renders, submits, and reports —
Openfront decides payment state.

## Market and provider choice (Task 16, Step 1)

The launch market is a single one: **US / USD** (`site.market` in
`store/lib/brand/site.ts`). The plan's India-specific guidance (UPI/card
net-banking preference) is conditional and does not apply to v1; a future
India market needs a new adapter behind the same
`features/integrations/payment` boundary, nothing else.

Offered in the storefront:

- **Stripe** (`pp_stripe_*`) — cards. Requires `NEXT_PUBLIC_STRIPE_KEY`.
- **PayPal** (`pp_paypal*`). Requires `NEXT_PUBLIC_PAYPAL_CLIENT_ID`.
- **Manual / cash-on-delivery** (`pp_system_default`) — development scaffold
  only. The UI already badged it as test-only and Openfront refuses to settle
  it (`Manual tender cannot complete storefront checkout`), so
  `selectPaymentMethods` hides it whenever `NODE_ENV === "production"`
  (reason `test_mode_only`).

`selectPaymentMethods` runs server-side in the checkout form before render.
Gates, in order, with closed reason codes:

1. `unknown_provider` — code outside the closed allowlist (also stops raw
   provider ids leaking through the UI's `|| code` title fallback).
2. `not_installed` — Openfront reports the provider as not installed.
3. `unsupported_currency` — cart region currency ≠ market currency (v1 has
   nothing to quote in another currency).
4. `not_configured` — the public key this deployment would need is absent.
5. `test_mode_only` — manual/COD in production.

A deployment with zero surviving methods simply shows no payment options;
checkout cannot proceed, which is the honest outcome when no payment rail is
configured.

## How an order becomes paid (Task 16, Step 2)

`placeOrder` (store) → `completeActiveCart` (Openfront) → `handlePaidOrder`:

1. The selected session must exist, belong to the cart, and match the cart
   total — otherwise the mutation throws before touching anything.
2. `settlePaymentSession` confirms the payment **at the provider**. A result
   other than `succeeded` throws `Payment failed: …` — and this happens
   **before** `createOrderFromCartAtomically`, so a declined settlement
   provably leaves no order behind (the store's message says exactly that).
3. Only then is the order created and the payment recorded as captured.

The client never marks an order paid: there is no success flag, query param,
or redirect token in `placeOrder` — the only inputs are the cart cookie, the
signed cart proof, and the payment session id. A backend response without an
order id is treated as failure (tested). The confirmation redirect is built
from backend-returned fields only and validated as a locked internal path
(Task 9).

### Failure messages (store mapping in `cart.ts`)

| Backend signal | Customer message claims |
| --- | --- |
| `Manual tender…` | This method can't be used online; pick another |
| `Payment failed: …` | Payment not confirmed, **no order placed**; retry another method |
| payment reference / status / reconciliation | Payment unconfirmed — check payment status or contact support; claims neither charged nor not-charged |
| `…posted to a different account` | Sign in with the owning account |
| transport (`fetch failed`, timeouts, resets, DNS) | Can't reach the service; **check the orders page before retrying**; claims neither outcome |
| anything else | Generic honest fallback, safe to show verbatim |

## Webhook authentication (Task 16, Step 2)

Ingress: `POST /api/payment-webhooks/[providerId]` (Openfront) →
`handlePaymentProviderWebhook`:

1. **Verification runs first, and its contract is throw-to-reject**
   (`executeAdapterFunction` rethrows → HTTP 500 → the provider retries
   later; nothing is persisted for an unverifiable event):
   - Stripe: `stripe-signature` verified with `STRIPE_WEBHOOK_SECRET`; a
     missing secret, missing header, or mismatched body all throw.
   - PayPal: `verify-webhook-signature` API must answer `SUCCESS`, with
     `PAYPAL_WEBHOOK_ID` configured; anything else throws.
   - Manual: **has no webhook channel** — its adapter throws
     `"Manual payment providers do not accept webhook ingress"` for any
     payload. Its previous stub returned `isValid: true` for literally
     anything; this task fixed the store's mirror so it matches Openfront's
     runtime behavior exactly.
2. Only after verification: a provider event id is required (no id →
   throw), then **dedupe** on `provider-webhook:{providerId}:{eventId}` via
   the `IdempotencyKey` table. A completed row answers
   `"Duplicate event acknowledged"` with zero further state changes; a fresh
   lock rejects concurrent processing (`Event is already being processed`).
3. The event's amount/currency are cross-checked against the recorded
   payment before any update; a mismatch throws and leaves the dedupe row
   un-completed, so a corrected retry can still process.

Evidence: `store/tests/integration/payment/webhook-auth.test.ts` (adapter
contracts, real Stripe signing) and `webhook-events.test.ts` (the real
Openfront mutation with an in-memory IdempotencyKey/prisma harness).

## Duplicate submissions and retries (Task 16, Steps 3–4)

Webhook redelivery is deduplicated above; the store's own duplicate surface
is the order submit:

- A failed completion **keeps** the cart cookie → retry is possible and
  performs a fresh completion attempt (one attempt per try).
- Success **clears** the cookie → a duplicate submit (double-click, stale
  tab) stops before any network call with an honest "session expired".
- Lost-response retry (backend committed, response dropped): the next attempt
  re-reads the cart, finds it no longer active, and refuses — exactly one
  completion attempt ever fires, so no double order.

Evidence: `store/tests/integration/payment/place-order-failures.test.ts`
(declined/reconciliation/transport mappings, no-order-id response, retry,
duplicate submit, timeout-after-commit) plus the Task 9 suite for the
unchanged handoff paths.

## Refunds and cancellations (Task 16, Step 5)

**Ground rule: supplier cancellation is not a customer refund.** These are
different state machines that never auto-propagate into each other:

| Action | What it changes | What it does NOT change |
| --- | --- | --- |
| Customer cancels (before shipment) → OpenShip `cancelPurchase` | Local fulfillment status only: `CANCEL_REQUESTED` until the provider confirms, then `CANCELLED` (Task 13 semantics) | No money moves. The capture/refund is a separate, deliberate act. |
| Operator refunds via Openfront (`refundPaymentFunction`) | Provider-side money return: Stripe `refunds.create`, PayPal refunds API — each against the original capture, in its currency | Does not cancel supplier purchases or shipment already made |
| Manual/COD payment "refunded" | A bookkeeping record only — the adapter has no gateway to call | No automatic money movement exists for COD at all |
| Supplier cancels/refunds **us** (purchase claim) | Internal recovery between us and the supplier | **Never** auto-issues a customer refund — that would be the supplier deciding our customer policy |

Refund procedure (operator):

1. Check the payment's authoritative state first (`getPaymentStatus`): only a
   `captured` payment can be refunded; `failed`/`voided`/`authorized`
   (not captured) have nothing to return — releasing an auth is not a
   refund, and claiming "refunded" for them would be false.
2. Confirm eligibility against the published policy
   (`store/lib/brand/policies.ts`): 30 days from delivery, unused, initiated
   by email; damaged/incorrect reported within 7 days makes the item refund
   our choice of replacement or refund where we can offer one.
3. Refund through Openfront (which calls the provider adapter) — never mark
   a refund from client evidence, a screenshot, or an email promise. Refund
   state, like paid state, comes only from the provider/Openfront flow.
4. Refund the captured amount in the captured currency (the PayPal adapter
   currently hardcodes `USD` in its refund body — correct for the v1
   market; a second market must parameterize it first).

Timing truth for support answers: a cancellation accepted before dispatch
still requires a separate refund step; a refund itself is not complete until
the provider confirms it; and a supplier-side cancellation arriving after we
refunded the customer does not change what the customer was told.

## Test/live mode and sandbox switch-on

Configuration lives in two halves:

- **Store (public only):** `NEXT_PUBLIC_STRIPE_KEY`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID`,
  optional `NEXT_PUBLIC_PAYPAL_SANDBOX`.
- **Openfront backend (secrets):** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`.

Switching a sandbox deployment to live:

1. Stripe: replace `pk_test_*` with the live publishable key **and**
   `sk_test_*` with the live secret key in the same move; create a new live
   webhook endpoint and move its signing secret into
   `STRIPE_WEBHOOK_SECRET` (test and live secrets are not interchangeable —
   with a mismatched pair every event verifies as forged and is rejected).
2. PayPal: the adapters in this repo currently hardcode
   `api-m.sandbox.paypal.com` (store and Openfront copies). Going live means
   pointing them at the live API host (env-driven change — do it before
   collecting live credentials), swapping in the live client id/secret, and
   registering a live webhook whose id replaces `PAYPAL_WEBHOOK_ID`.
3. Keep manual/COD out of production — enforced automatically by
   `selectPaymentMethods` (`test_mode_only`); no flag to remember.
4. Re-run `cd store; npx vitest run tests/integration/payment` after any
   adapter/env change: it exercises real signature verification and the
   mutation's dedupe/auth paths, and it fails if a gate stops failing closed.

## Verification

```
cd store
npx vitest run                     # 30 files / 390 tests pass
npx vitest run tests/integration/payment   # 4 files / 36 tests (Task 16)
npx tsc --noEmit -p tsconfig.json  # 193 pre-existing store-app error entries;
                                   # 0 in lib/payment/, tests/, checkout surfaces
```

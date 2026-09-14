# Target State — Dropshipping Store Architecture

> Companion to `current-state.md` (Task 1 deliverable). The authoritative, detailed plan is
> `DROPSHIPPING-AGENT-PLAN.md` (§3 Target Architecture, §5 Implementation Tasks); this file
> records only the deltas the reconnaissance confirmed or changed, and the sequencing
> guardrails.

## What stays as planned

The plan's ownership boundaries are **validated by the actual code**:

- **Openfront** owns catalog/pricing/inventory/cart/checkout/orders/payments — confirmed
  (Medusa-style models, `completeActiveCart` checkout, Stripe/PayPal/manual payments,
  manual/ShipEngine/Shippo shipping, outbox webhooks).
- **OpenShip** owns shop/channel/link/match/order-routing/purchase/tracking — confirmed
  (`Shop → Link → Channel`, `Match: ShopItem ↔ ChannelItem`, adapter executors,
  tracking callback routes).
- **Custom storefront** consumes Openfront GraphQL only — confirmed feasible; the reference
  storefront proves the contract (`graphql-request` → `/api/graphql`, cookie session,
  server actions).

## Deltas from the plan driven by reconnaissance

1. **Custom storefront base:** adapt `openfront-storefront` in place rather than
   re-scaffolding (plan §4 already prefers this). Keep its server-action + React Query
   patterns; simplify `[countryCode]` routing to a fixed India (`in`) prefix or drop the
   prefix behind a redirect for v1.
2. **Synthetic channel (Task 11):** implement as a new `ChannelPlatform`
   ("synthetic") with `createPurchaseFunction` / `cancelPurchase` / tracking functions
   registered through OpenShip's platform system — not a hard-code in routing.
3. **Idempotency:** reuse OpenShip's `idempotencyKey` argument on channel
   `createPurchaseFunction` and Openfront's existing `IdempotencyKey` model; do not invent
   new mechanisms.
4. **Payments (Task 16):** Stripe/PayPal adapters exist; Razorpay (UPI/net-banking for
   India) must be **added** behind `features/integrations/payment/` boundary if required.
5. **Shipping (Task 15):** start with the `manual` provider (flat rate / free threshold)
   — it already exists; add provider-backed rates later.
6. **Order ingestion:** Openfront → OpenShip via OpenShip's
   `app/api/handlers/shop/create-order/[shopId]` route + `order.*` webhook topics
   (`X-OpenFront-Webhook-Signature` HMAC verification). Configure the Openfront **shop**
   adapter with `createWebhookFunction` to register topics.
7. **Test/CI infrastructure is greenfield:** adopt Vitest (unit/integration) + Playwright
   (e2e) in the storefront repo first; CI in GitHub Actions per plan Task 23.
8. **Env contract (Task 2):** seed from §5/§3.6 of `current-state.md`
   (`NEXT_PUBLIC_BACKEND_URL`, `NEXT_PUBLIC_STRIPE_KEY`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID`,
   `NEXT_PUBLIC_DEFAULT_REGION`, `DATABASE_URL`, provider + webhook secrets — server-only).

## Sequence guardrails (unchanged)

```text
Tasks 1–2   ✔ baseline (this doc) + env
Tasks 3–9   storefront: design system → catalog → home → PDP → cart → account → checkout
Tasks 10–12 OpenShip setup → synthetic channel → synthetic end-to-end  ← first "done"
Tasks 13+   real supplier adapter only AFTER Task 12 passes
Task 25     full acceptance suite → then Part B (AI ops agent) begins
```

Failure isolation: every Task 12+ boundary keeps the plan's rules — idempotency keys,
authoritative-callback-only state transitions, sanitized customer tracking projection,
no secrets client-side, human approval before any agent touches money.

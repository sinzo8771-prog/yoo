# Current State — Ecosystem Reconnaissance

> **Task 1 deliverable** (`DROPSHIPPING-AGENT-PLAN.md` §2). All findings below were captured by
> cloning the three repositories at the exact revisions listed and inspecting their source on
> **2026-09-14**. No assumptions from the plan were carried over without verification.

## 1. Repositories & revisions

| Repo | URL | Branch | HEAD SHA | Last commit | Local path |
|---|---|---|---|---|---|
| OpenShip | https://github.com/openshiporg/openship | `main` | `04b231d936a6954d07f11f839246d5815a4d12f2` | 2026-08-25 `feat(integrations): harden OpenFront order and webhook flows` | `../openship` |
| Openfront | https://github.com/openshiporg/openfront | `master` | `2b7181aa50ff6f27dadacc2ded2b145a2de68c1f` | 2026-08-31 `feat(dashboard): refresh logo branding` | `../openfront` |
| Openfront Storefront | https://github.com/openshiporg/openfront-storefront | `main` | `9b1a431da8175e91310fd3c8064547801142813f` | 2025-11-16 `feat(storefront): add checkout link pages and business invoicing features` | `../openfront-storefront` |

All three were cloned with `--depth 1` at HEAD. Re-pin these SHAs before any dependent work;
the storefront repo is the stalest of the three (≈10 months behind).

## 2. Shared technology baseline

All three projects use the **same stack**:

- **KeystoneJS 6** (`@keystone-6/core` ^6.5.1, `@keystone-6/auth` ^8.1.0) as the backend framework —
  Keystone generates the GraphQL API from list definitions in `features/keystone/models/`.
- **Next.js App Router** frontend served by the same process. `package.json` declares
  `next ^16.0.10` (openship/openfront) and `next 16.0.3` (storefront) while READMEs still say
  "Next.js 15". The Keystone core is overridden to `next 14.2.35` via npm `overrides` — a
  **dual-Next-version setup** that is a known fragility.
- **React 19**, **Tailwind CSS 4**, **shadcn/ui** (Radix primitives + `components.json`).
- **Prisma 6** ORM over **PostgreSQL** (Railway deploy template uses the Postgres plugin;
  migrations live in `migrations/`).
- **GraphQL**: schema exported to `schema.graphql` + `schema.prisma` at each repo root;
  API served via `graphql-yoga` at `/api/graphql` (`pages/api/graphql.ts`).
- **Node**: `engines.node >= 20` in all three. Local tooling observed: git 2.55.0,
  Node v24.21.0, npm 11.19.0 (no pnpm/yarn installed).
- Package manager: **npm** (`package-lock.json` present in each repo).
- Scripts (openship/openfront): `dev` = `keystone build --no-ui && npm run migrate && next dev`,
  `build`, `migrate` = `prisma migrate deploy`, `migrate:gen`, `lint`. Storefront is a pure
  Next app: `dev`/`build`/`start`/`lint` only.

**Architecture consequence:** the storefront does not need its own database. It is a thin
Next client talking to Openfront's Keystone GraphQL endpoint.

## 3. Openfront (commerce system of record)

### 3.1 Data model (`schema.prisma` — 80+ models, Medusa-v1-style)

Key models: `Store`, `Region`, `Country`, `Currency`, `Product`, `ProductVariant`,
`ProductOption(Value)`, `ProductImage`, `ProductCollection`, `ProductCategory`, `MoneyAmount`,
`PriceList`/`PriceRule`/`PriceSet`, `Cart`, `LineItem`, `Customer*` (via `Account`), `Order`,
`OrderLineItem`, `Fulfillment(Provider|Item)`, `ShippingOption`, `ShippingMethod`,
`ShippingProvider`, `ShippingLabel`, `Payment`, `PaymentSession`, `PaymentProvider`,
`Discount(Rule|Condition)`, `GiftCard`, `Claim*`, `Return(Reason|Item)`, `Swap`, `DraftOrder`,
`Invoice*`, `SalesChannel`, `ApiKey`, `WebhookEndpoint`, `WebhookEvent`, `IdempotencyKey`.

Note: an `IdempotencyKey` model already exists — reuse it for checkout/order-commit idempotency
rather than inventing a new table.

### 3.2 Checkout & cart mutations (`features/keystone/mutations/`)

| Operation | Mechanism |
|---|---|
| Create cart | `createCart(data: CartCreateInput!)` (Keystone-style create) |
| Read cart | query `activeCart(cartId: ID!)` |
| Add line item | `updateCart(where:{id}, data:{ lineItems: { create: [...] } })` (nested connect `productVariant`) |
| Update/remove line item | `updateActiveCartLineItem`, `updateActiveCart` |
| Shipping method | `addActiveCartShippingMethod(cartId, shippingMethodId)` |
| Address validation | `validateShippingAddress` |
| Payment session | `createActiveCartPaymentSessions`, `setActiveCartPaymentSession`, `initiatePaymentSession` |
| **Place order** | `completeActiveCart(cartId, paymentSessionId)` — returns order incl. `secretKey` for guest order access |
| Order lookup | `getCustomerOrder(s)`, plus guest `secretKey` path |
| Fulfillment | `createOrderFulfillment`, `cancelOrderFulfillment`, `trackShipment`, `getRatesForOrder` |
| Returns/refunds | `processReturnRefund`, `transitionOrderStatus` |

Cart identity: cookie **`_openfront_cart_id`**; auth headers resolved via
`lib/data/cookies.ts` (`getAuthHeaders`). Guest checkout supported via `secretKey`.

Checkout internals: `features/keystone/checkout/order-commit.ts` and `recovery.ts` exist —
inspect before adding any checkout-side logic.

### 3.3 Payment integrations (`features/integrations/payment/`)

`manual.ts`, `stripe.ts`, `paypal.ts`. **No India-native provider (Razorpay/UPI) exists.**
For the INR market this is a gap — either Stripe India, PayPal, or a new adapter behind the
same `integrations/payment` boundary. Webhook handling: `handlePaymentProviderWebhook`
mutation + provider-specific verification.

### 3.4 Shipping integrations (`features/integrations/shipping/`)

`manual.ts`, `shipengine.ts`, `shippo.ts` — adapter-based (rates, labels, tracking,
label cancellation per the domain mutations above). Start with `manual` (flat rate) for v1.

### 3.5 Webhook system (`features/webhooks/`)

An outbox-based global webhook plugin (`webhook-plugin.ts`, `outbox.ts`, `delivery-policy.ts`,
`subscriptions.ts`, enrichers) backs `WebhookEndpoint`/`WebhookEvent`:

- Delivery: HMAC-SHA256 over the JSON payload with the endpoint secret; headers
  `X-OpenFront-Webhook-Signature` and `X-OpenFront-Topic`.
- Retries: exponential backoff, max 5 attempts (`deliveryAttempts < 5`), `nextAttempt` scheduled.
- Event naming: `<listKey>.<operation>` (e.g. `order.created`).
- Management mutations: `registerWebhookEndpoint`, `retryWebhookDeliveries`.

⚠️ `setInterval(deliverWebhooks, 30000)` in-doc is serverless-hostile (Vercel); on Railway/
self-host it works but still needs a crash-safe re-drive. This is the **authoritative
order-event source OpenShip consumes**.

### 3.6 Auth

Keystone session auth (`@keystone-6/auth`) with `authenticatedItem` query; password mutation
helpers (`updateActiveUserPassword`, `regenerateCustomerToken`). OAuth dirs exist
(`features/keystone/oauth`). Do **not** invent a second identity store.

## 4. OpenShip (fulfillment router)

### 4.1 Data model (`schema.prisma`)

`User`, `Role`, `ApiKey`, `ShopPlatform`, `ChannelPlatform`, `Shop`, `Channel`, `Order`,
`LineItem`, `CartItem`, `ShopItem`, `ChannelItem`, `Match`, `Link`, `TrackingDetail`.

The chain is exactly: **Shop (source) → Link → Channel (destination), with Match at
product/variant level** — matching the plan's Task 10 model. Matches are represented by the
`Match` model connecting `ShopItem` ↔ `ChannelItem`.

### 4.2 Adapter system (`features/integrations/`)

Two-tier: **Platform templates** (`ShopPlatform`/`ChannelPlatform` store function
names/URLs + `appKey`/`appSecret`/`webhookSecret`) and **instances** (`Shop`/`Channel` hold
`domain` + `accessToken`). Adapters are executed dynamically via
`executeShopAdapterFunction` / `executeChannelAdapterFunction`
(`features/integrations/{shop,channel}/lib/executor.ts`).

**Shop adapters must implement** (`features/integrations/INTEGRATIONS.md`):
`searchProductsFunction`, `getProductFunction`, `searchOrdersFunction`, `updateProductFunction`,
`createWebhookFunction`, `deleteWebhookFunction`, `getWebhooksFunction`; optional OAuth +
webhook handlers.

**Channel adapters implement**: `createPurchaseFunction({ cartItems, shipping, notes,
idempotencyKey })`, `cancelPurchase`, tracking creation/relay (`channel/tracking-relay.ts`,
`channel/tracking-webhook.ts`).

Existing adapters (both sides): **Openfront** and **Shopify** only. **No synthetic/test
channel exists** — Task 11's synthetic channel must be implemented as a new ChannelPlatform
(`createPurchaseFunction` etc.) registered through the platform system, not hard-coded into
routing.

The Openfront channel adapter is OAuth 2.0-based (refresh flow in
`channel/openfront.ts::getFreshAccessToken`) and supports an explicit `idempotencyKey`
argument on `createPurchaseArgs` — use it for Task 12/13 idempotency.

Webhook security utilities live in
`features/integrations/lib/webhook-verification.ts`,
`shop/openfront-webhook-security.ts`, `shop/openfront-order-search.ts`, and
`features/integrations/openfront-webhook-topics.ts`.

### 4.3 Inbound webhooks / HTTP surface

- `pages/api/graphql.ts` — Keystone GraphQL (primary API).
- `app/api/handlers/shop/create-order/[shopId]/route.ts` and
  `.../cancel-order/[shopId]/route.ts` — order import endpoints (this is how Openfront
  orders enter OpenShip).
- `app/api/handlers/channel/create-tracking/[channelId]/route.ts` and
  `.../cancel-purchase/[channelId]/route.ts` — tracking/cancel callbacks from channels.
- `app/api/oauth/callback/route.ts`, `app/api/mcp-transport/[transport]/route.ts`,
  `app/api/completion/route.ts` (AI completion), `app/dashboard/(admin)/platform/api-keys`.

### 4.4 Operator surface

`features/platform/{shops,channels,matches,orders,api-keys}` + `features/dashboard/*` —
the existing operator workspace already covers the Task 17 "required operational views"
(orders, matches, purchases via TrackingDetail, failures) to a degree; extend rather than
rebuild.

## 5. Openfront Storefront (reference client)

- Pure Next.js client (no DB), talks to `${NEXT_PUBLIC_BACKEND_URL}/api/graphql` via
  `graphql-request` wrapped in `features/storefront/lib/config.ts` (`openfrontClient`,
  10s timeout, `credentials: 'include'`).
- Env vars: `NEXT_PUBLIC_BACKEND_URL` (required), `NEXT_PUBLIC_STRIPE_KEY`,
  `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, `NEXT_PUBLIC_DEFAULT_REGION` (default `us`),
  `HIDE_OPENFRONT_BRANDING`. ⚠️ README references `.env.example` but **no `.env.example`
  file exists in the repo** — must be created.
- Data layer: `features/storefront/lib/data/*.ts` — `products.ts`, `collections.ts`,
  `categories.ts`, `cart.ts` (`"use server"` server actions; `retrieveCart`, `createCart`,
  `addItem`, `placeOrder`, `setShippingMethod`, `setPaymentMethod`, …), `user.ts`,
  `orders.ts`, `shipping.ts`, `payment.ts`, `regions.ts`, plus React Query hooks in
  `lib/hooks/`.
- Routes: `app/(storefront)/[countryCode]/(checkout)` and `(main)` — locale-prefixed
  (`/[countryCode]/...`). Screens in `features/storefront/screens/` (HomePage, ProductPage,
  CartPage, CheckoutPage, Account*, OrderConfirmedPage, …).
- Product query shape (from `lib/data.ts`): Keystone-style
  `products(take, skip, where, orderBy) { id title handle thumbnail productVariants { id title sku prices { amount currency { code } } } }`
  + `productsCount`. **Pricing via `prices` on variant**, with `calculatedPrice`
  (`calculatedAmount`, `originalAmount`, `currencyCode`) available on line-item prices.
- Order confirmation redirect: `/[countryCode]/order/confirmed/[orderId]?secretKey=...`
  for guests. The `[countryCode]` prefix means region handling is baked into routing — a
  custom storefront must decide whether to keep or simplify it (India-first suggests
  fixing it to `in`).

## 6. Gaps & risks found (plan assumptions vs reality)

| # | Finding | Impact on plan |
|---|---|---|
| 1 | **No tests anywhere** (zero `*.test.*`/`*.spec.*` files, no test runner configured) | Task 23 CI must add test infrastructure from scratch; plan's "repository's established test stack" does not exist |
| 2 | **No CI workflows** (no `.github/` in any repo) | Same — all CI/CD is greenfield |
| 3 | **No `.env.example`** in any repo (storefront README references one that's absent) | Task 2 must derive env var lists from source (§3.6/§5 lists known ones) |
| 4 | **No Dockerfile** (README claims Docker deploy; only `railway.toml` exists) | Self-hosting setup (Docker) is greenfield |
| 5 | **No synthetic channel adapter** — only Openfront/Shopify exist | Task 11 is entirely new work through the ChannelPlatform boundary |
| 6 | **No India-native payment adapter** (Stripe/PayPal/manual only) | Task 16 must add Razorpay (or accept Stripe India) behind the payment boundary |
| 7 | Dual Next.js versions (app on 16, Keystone core pinned to 14.2.35 via overrides) | Upgrade risk; keep overrides intact; verify `npm run build` early in Task 2 |
| 8 | Storefront repo is ~10 months stale vs. Openfront API mutations | Re-verify every storefront query against current `schema.graphql` (Task 4); expect drift (e.g. business-invoicing features added since) |
| 9 | Openfront webhook delivery uses `setInterval` (30s) | OK on Railway/self-host; document for deployment choice; outbox + retries otherwise solid |
| 10 | GraphQL clients pass auth via browser cookies (`credentials: 'include'`) against Openfront's GraphQL | Custom storefront must keep GraphQL calls server-side or ensure Openfront origin/CORS policy protects the session cookie |
| 11 | README demo credentials published in openship README | Irrelevant to code, but never reuse those credentials anywhere |
| 12 | `executeShopAdapterFunction`/`executeChannelAdapterFunction` resolve function code dynamically from platform records | Treat platform function names as an allowlist; a malicious/compromised DB row could redirect adapter calls — include in Task 18 threat model |

## 7. Current flow diagram (as-implemented)

```text
Customer browser
   │  HTTPS, cookies: _openfront_cart_id + Keystone session
   ▼
Openfront Storefront (Next 16, no DB)
   │  graphql-request → {NEXT_PUBLIC_BACKEND_URL}/api/graphql
   ▼
Openfront (Keystone 6 + Prisma/PostgreSQL)
   │  carts: createCart / activeCart / updateCart / completeActiveCart
   │  payments: Stripe | PayPal | manual  (+ handlePaymentProviderWebhook)
   │  shipping: manual | ShipEngine | Shippo
   │  webhooks: WebhookEndpoint/WebhookEvent outbox → HMAC-SHA256 → subscribers
   ▼  (order.* webhook → app/api/handlers/shop/create-order/[shopId])
OpenShip (Keystone 6 + Prisma/PostgreSQL)
   │  Shop ──Link──► Channel ; Match: ShopItem ↔ ChannelItem
   │  adapters: executeShopAdapterFunction / executeChannelAdapterFunction
   │  channel adapters: openfront (OAuth2) | shopify     [no synthetic channel]
   │  callbacks: app/api/handlers/channel/{create-tracking,cancel-purchase}/[channelId]
   ▼  typed adapter boundary
Supplier / 3PL API  ──► TrackingDetail ──► customer-safe tracking projection
```

## 8. Reconnaissance checklist status

- [x] Exact commit SHA recorded for each repository (§1)
- [x] Node/package-manager requirements (§2)
- [x] Framework/library versions (§2)
- [x] GraphQL client & generated types (no generated types; raw `graphql-request` + gql strings — §5)
- [x] Authentication/session flow (Keystone session auth, cookie-based — §3.6, §5)
- [x] Product/variant query shapes used by the reference storefront (§5)
- [x] Cart mutation flow (§3.2, §5)
- [x] Checkout handoff flow (`completeActiveCart` + payment sessions + `secretKey` guest path — §3.2)
- [x] Existing shipping adapters in Openfront (§3.4)
- [x] Existing shop/channel/match operations in OpenShip (§4.1–4.3)
- [x] Webhook authentication/signature utilities (§3.5, §4.2)
- [x] Existing tests and CI commands (**none exist** — §6.1–6.2)
- [x] Items marked experimental/incomplete/provider-dependent (§6: dual-Next overrides,
      stale storefront, missing .env.example/Dockerfile, setInterval delivery,
      dynamic adapter function resolution)

## 9. Task 2 addendum (environment verification, 2026-09-14)

Corrections/confirmations discovered while standing up the local environment:

1. **`.env.example` files now exist** in all three repos (they were absent upstream),
   populated strictly from code-verified `process.env` usage. Canonical requirements:
   - Openfront: `DATABASE_URL`, `SESSION_SECRET` (≥32, enforced), plus — **contrary to its
     README, which calls S3 "optional"** — all five `S3_*` vars are **mandatory when
     `NODE_ENV=production`** (`productionEnv()` in `features/keystone/index.ts` throws).
     CI/production builds must set them (placeholders suffice for storage-less builds).
   - OpenShip: `DATABASE_URL` (⚠️ SQLite fallback), `SESSION_SECRET` (⚠️ insecure fallback),
     `NEXT_PUBLIC_URL`, `OAUTH_STATE_SECRET` (⚠️ dev fallback), Shopify keys, SMTP
     (`SMTP_HOST/PORT/USER/PASSWORD/FROM/STORE_LINK`, `MAIL_USER` for Ethereal previews).
   - Storefront: only `NEXT_PUBLIC_BACKEND_URL` + public payment keys.
2. **SMTP var names verified** in `features/keystone/lib/mail.ts` (both apps):
   `SMTP_PASSWORD` (not `SMTP_PASS`), `SMTP_FROM` (not `FROM_EMAIL`), `SMTP_STORE_LINK`.
3. **Shipping provider keys are DB-configured**, not env — the READMEs' `SHIPPO_API_KEY`
   entries do not correspond to any env read in app source.
4. **Storefront build defect fixed locally**: `pages/api/graphql.ts` referenced a
   nonexistent `features/keystone/context` and failed `next build`; the decoupled
   storefront resolves GraphQL exclusively via `NEXT_PUBLIC_BACKEND_URL`, so the file
   was deleted in this workspace (upstream-PR candidate). After the fix the storefront
   builds cleanly.
5. **All three apps verified building** against the pinned SHAs; OpenShip migrations
   applied (19 tables), Openfront migrations applied (115 tables) on local PostgreSQL 17.
6. Root tooling added: `docker-compose.yml` (+ Postgres init script), per-repo
   `.env.example`, `scripts/healthcheck.mjs` (GraphQL ping), root `package.json`
   with setup/dev/health scripts, `README.md` quick-start.

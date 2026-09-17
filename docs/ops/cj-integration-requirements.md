# CJdropshipping integration requirements — Task 12 prep

## Status

Auth, rate limits, sandbox, order and webhook contract details verified from
official CJ pages (Firecrawl scrape, 2026-09-17). Product/inventory field
contracts, logistics details and account-specific behavior still need
credentials; CJ still requires an account before live verification.
Tags: [V] verified from official docs, [S] structure seen but details not read,
[U] unverified until sandbox access, [B] blocked by verified OpenShip-side
gaps. No code, credentials, or routing changes.

## 1. Authentication — VERIFIED (token page, 2026-09-17)

- Header `CJ-Access-Token` on all API calls. Tokens obtained via OAuth 2.0;
  Access Token and Refresh Token lifetimes are each ~180 days. Refresh before
  expiry (delay queue recommended); if both expire, reauthorization is required.
  CJ explicitly mandates backend-only storage ("shall never be returned to front
  end") — matches our server-side rule. Revocation semantics beyond expiry are
  not documented on this page; confirm at account setup.
- Requirement: inject into the OpenShip runtime only; never log; rotation
  drill per runbook template.

## 2. Endpoint mapping to the ten required ChannelPlatform slots

| Slot | CJ docs evidence | Status |
| --- | --- | --- |
| `searchProductsFunction` | Product List V2 (GET) [1.2] | [S] field contract unread |
| `getProductFunction` | Product Details (GET) [1.5]; Query Product Detail (POST) [1.10] | [S] |
| Variant/inventory | All Variants [2.1], Variant Id Inquiry [2.2], Inventory [3.1–3.3] | [S] |
| `createPurchaseFunction` | createOrderV2/V3 (POST `api2.0/v1/shopping/order/...`) | Endpoints [V]; NO idempotency key documented on create — durable intent mandatory; confirmOrder (PATCH) is documented "Repeatable ... last call takes effect" [V] |
| Webhook lifecycle | Webhook section (`webhook.html`) | Push model [V]; event list details [S] |
| `createTrackingWebhookHandler` | Webhook signature section | Scheme [V]: `sign = Base64(HmacSHA256(secret = your openId, message = raw JSON body))`; respond 200 within 3s; failed pushes retried up to 3 times; continuous failures trigger auto-close — ack fast, process async. Events carry `messageId` documented as "unique message ID (unchanged on retry, usable for idempotent dedup)" — use it as the replay-rejection key (Task 12 Step 6) [V] |
| `cancelPurchaseWebhookHandler` (inbound) | Dispute/Shopping sections | [S] |
| Outbound supplier cancellation | Order Delete (DEL) [1.8] exists; shipping-state rules unread | [U]; local `cancelPurchase` is status-only [B] |
| `oAuthFunction` / `oAuthCallbackFunction` | CJ uses OAuth 2.0 server tokens, not per-shop app install | [U]; likely loud-failure stubs |

Gateway hosts seen: probe host `developersapi.cjdropshipping.com/openapi/open/api/...`
and docs curl examples using `developers.cjdropshipping.com/api2.0/v1/...` —
confirm which host applies to which API version at account setup. [V: both
reachable; product routes returned HTTP 200 `Not Found` unauthenticated]

## 3. Data flow (target, aligned with Task 13 pipeline)

Openfront order → OpenShip match → purchase lines → durable intent
(tenant + source order + line, request fingerprint, unique constraint) →
CJ Shopping create call (idempotency behavior [U]) → persist authoritative CJ
order ID → signed CJ webhook or Logistic polling → customer-safe tracking.

Prerequisites [B], verified earlier from the OpenShip checkout: the purchase
resolver must forward orderId, idempotencyKey and channel credentials, and the
CreatePurchaseInput/resolver field mismatch must be reconciled.

## 4. Sandbox and exit criteria

- Sandbox VERIFIED (sandbox page): sandbox is an order flag, not a separate
  host — create with `isSandbox=1`; payment simulated, no real fulfillment.
  `simulatePay` moves unpaid→paid (300); `updateStatus` flows 300→400→500→600→700
  and cannot skip or revert; `updateTrackNumber` sets tracking on paid, unclosed
  sandbox orders. Order queries return an `isSandbox` field. This ladder is the
  evidence base for our response-validation state machine; partial-shipment
  semantics remain unread.
- Rate limits VERIFIED (limits page): ≤10 req/s per IP, ≤30 req/s for non-login
  interfaces, max 3 users per IP; per-user tiers: Free 1/s, Plus 2/s, Prime 4/s,
  Advanced 6/s. Daily usage is now a points-based quota
  (`standard/points.html` — quota arithmetic unread [S]).
- Remaining once credentials exist: (1) confirm host + token for our account;
  (2) build validated read-only product/inventory lookups; (3) implement the
  durable intent store — no native create idempotency; (4) purchase path only
  after the [B] items are fixed.
- Routing stays disabled until every runbook activation gate passes.

Cross-references: `supplier-comparison.md` (CJ requires credentials; Printful
and Printify docs require further verification), `supplier-adapter-template.md`,
`supplier-runbook-template.md`.

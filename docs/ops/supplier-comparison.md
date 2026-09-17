# Supplier comparison — provisional (US market, category unspecified)

## Status

Research only; no supplier selected, no credentials obtained, no repository or
routing changes. Product category is NOT chosen; "phone cases" below was a test
category for API probing only, not a product decision. All evidence was gathered
2026-09-17 from official pages cited inline; anything not cited is unverified.

## Candidates

### CJdropshipping — general-catalog sourcing (current provisional pick)
- Official API docs reachable: https://developers.cjdropshipping.com/ (fetched).
  Documented interface groups (from `/en/api/api2/api/product.html` headings):
  products (list/details/variants), inventory, reviews, sourcing, videos; plus
  shopping, logistic, dispute, webhook, shop sections; update announcements dated
  2025-11/12 confirm active maintenance. VERIFIED (structure only).
- Order contract details now VERIFIED (2026-09-17, Firecrawl): OAuth 2.0
  `CJ-Access-Token` (~180-day access/refresh lifetimes, backend-only storage);
  order creation via `createOrderV2/V3` with **no documented idempotency key**
  (durable intent mandatory); `confirmOrder` PATCH documented repeatable;
  webhook pushes signed `Base64(HmacSHA256(secret=openId, raw body))` with a
  3-second ack requirement, 3 retries, then auto-close; sandbox via
  `isSandbox=1` with a non-skippable 300→700 status ladder; limits: 10 req/s
  per IP, 30 req/s non-login, tiered per-user 1–6 req/s, points-based daily quota.
- Storefront site advertises 10+ global warehouses, store connections, order
  fulfillment, tracking. VERIFIED as marketing claims only.
- US warehouse locations and per-product US shipping cost/time: NOT verified.
- Live probe (read-only, no credentials): `getProductCategory?name=phone%20case`
  → HTTP 200 body `Not Found` in ~1.3s; `getProductListV2` → HTTP 200 `Not Found`
  in ~0.3s at developersapi.cjdropshipping.com. Interpretation: gateway reachable,
  route requires authentication; NO product data verified, no latency SLA implied.

### Printful — print-on-demand only
- Official API page fetched: full-featured REST API (JSON), private tokens with
  scopes and expiry, OAuth 2.0, order submission/mockups, fulfillment centers in
  the US and elsewhere. VERIFIED from https://www.printful.com/api.
- Scope limitation: POD catalog (apparel/merch), not general goods. Full endpoint
  contract NOT verified (docs page exceeds fetch limit; headings seen only).

### Printify — print-on-demand only
- Attempted API page returned HTTP 404. NOTHING verified; API availability for
  custom integrations is unconfirmed from official sources in this session.

## Fit for this codebase (from Task 12 prep, verified earlier)
- All ten `ChannelPlatform` slots are required; unsupported ones must fail loudly.
- Known blockers before any real supplier works: the purchase resolver does not
  forward orderId/idempotencyKey/channel credentials, and
  `cancelPurchase` only flips local status (no supplier-side cancellation).
- CJ fits the general-product plan; Printful/Printify fit only if the category
  becomes print-on-demand merchandise.

## Decision needed from you
1. Product category (unblocks product-fit checks; still unspecified).
2. Confirm CJ as the single primary supplier, or name an alternative.
3. Whether to register for CJ sandbox/API access yourself — I cannot and will
   not create accounts or handle credentials.

## Next steps after decision (unchanged from Task 12 gates)
Authenticate read-only product/inventory lookups in sandbox → implement validated
lookup adapter → intent/idempotency design → purchase path only after the
resolver gaps above are fixed. Routing stays disabled until all gates pass.

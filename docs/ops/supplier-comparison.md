# Supplier comparison — provisional (US market, category unspecified)

## Status

**Selection made 2026-09-17: CJdropshipping is the provisional primary supplier.**
This is a documentation-level decision only. No account exists, no credentials
have been obtained, and no repository code or routing has changed. Product
category is still NOT chosen; "phone cases" below was a test category for API
probing only, not a product decision. All evidence was gathered 2026-09-17 from
official pages cited inline; anything not cited is unverified.

### Why CJ was selected as the "free" option

Cost is the deciding factor at this stage, and both of CJ's claims below come
from **CJ's own pages** (fetched 2026-09-17):

- **No subscription.** `cjdropshipping.com/blogs/cj-news/What-is-CJdropshipping`
  (**[F]**) lists "**No Subscription Fees – Budget Friendly**" as a headline
  advantage, and `.../blogs/cj-news/Zendrop-or-CJdropshipping` (**[F]**) states
  plainly: "CJdropshipping: No, CJ does not charge any monthly membership fee."
- **Free fulfilment overhead in the US warehouse.**
  `cjdropshipping.com/service-fee` (**[F]**, 8,986 chars) shows, for its **US
  Warehouse** column, `Inspection Fee` Free, `Unload Fee` Free, `Inbound Fee`
  Free across every weight band, and 90 days free storage. Its full fee tables
  contain **no monthly or subscription line item**.
- **Caveat: "free" means no platform fee, not zero cost.** Per-order picking and
  shipping still apply, and the fee page says nothing about whether CJ stocks a
  given item or at what price. CJ was chosen over Printful/Printify here purely
  because those are print-on-demand only and would force the catalog into
  apparel/merch.

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

## Decision status

1. **Supplier — DECIDED (2026-09-17):** CJdropshipping is the provisional primary
   supplier, chosen for its no-subscription model and free US-warehouse inbound
   handling. Reversible at any time before credentials are entered.
2. **Product category — STILL OPEN.** Needed to judge product fit and landed cost,
   and to fix the Task 22 niche. Blocks any real sourcing.
3. **CJ developer/sandbox registration — YOURS TO DO.** I cannot and will not
   create accounts, accept terms, or handle credentials. Until a sandbox key is
   entered into server-side configuration, every CJ capability stays [S]/[U].

## Next steps after decision (unchanged from Task 12 gates)
Authenticate read-only product/inventory lookups in sandbox → implement validated
lookup adapter → intent/idempotency design → purchase path only after the
resolver gaps above are fixed. Routing stays disabled until all gates pass.

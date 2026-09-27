# Analytics events (Task 19, Step 3 + 4)

First-party, opt-in, and deliberately small. This document is the contract:
the event names, the props each one may carry, what is never collected, and how
the funnel numbers are calculated — including the ways they are *not* precise.

Code: `store/lib/analytics/events.ts` (vocabulary + sanitizer),
`store/lib/analytics/client.ts` (browser transport),
`store/lib/analytics/collect.ts` (ingest pipeline),
`store/app/api/analytics/collect/route.ts` (the only `/api` route),
`store/components/analytics/TrackEvent.tsx` (page-level emitter).

## Consent and privacy rules

1. **Off by default.** Nothing is sent unless
   `NEXT_PUBLIC_ANALYTICS_ENABLED="true"`. With the variable unset there is no
   request, no script, and no third-party SDK.
2. **Do Not Track / Global Privacy Control are honoured per event**, so a
   visitor who enables GPC mid-session stops being counted immediately
   (`isAnalyticsEnabled` is re-evaluated on every `track` call).
3. **First-party only.** Events go to `/api/analytics/collect` on our own
   origin with `credentials: "omit"` — no cookie, no `localStorage` id, no
   cross-site request.
4. **No personal data.** Every event carries an allowlisted prop set; unknown
   keys are stripped before the payload is built, one out-of-bounds prop drops
   the whole event, and the attributed path has its query string removed (that
   is where emails and tokens leak in from search/filter URLs).
5. **Nothing is stored per visitor.** The collector keeps per-UTC-day counters
   in memory (30 days, then the oldest day is evicted) and writes one sanitized
   log line per accepted event. No IP, session, user agent, order reference or
   free text is retained.

## Events

| Event | When it fires | Emitted from | Allowed props |
| --- | --- | --- | --- |
| `view_product` | Product page renders with a product | `app/(storefront)/[countryCode]/(main)/products/[handle]/page.tsx` | `productId`, `productHandle` |
| `view_collection` | Collection page renders | `features/storefront/screens/CollectionPage.tsx` | `collectionHandle`, `productCount` |
| `select_variant` | Visitor picks a variant (not on render) | `features/products/components/VariantSelector.tsx` | `productId`, `variantId` |
| `add_to_cart` | After the cart call succeeds | `features/products/components/AddToCartForm.tsx` | `productId`, `variantId`, `quantity`, `currency`, `valueMinor` |
| `view_cart` | Cart page renders | `features/storefront/screens/CartPage.tsx` | `itemCount`, `currency`, `valueMinor` |
| `begin_checkout` | Checkout page renders | `features/storefront/screens/CheckoutPage.tsx` | `itemCount`, `currency`, `valueMinor` |
| `checkout_success` | Order confirmation renders (provider-side confirmation) | `features/storefront/screens/OrderConfirmedPage.tsx` | `itemCount`, `currency`, `valueMinor` |
| `purchase` | Order confirmation renders (funnel stage) | `features/storefront/screens/OrderConfirmedPage.tsx` | `itemCount`, `currency`, `valueMinor` |
| `view_order` | Account order detail renders | `features/storefront/screens/AccountOrderDetailsPage.tsx` | — |
| `view_tracking` | Guest tracking page renders | `features/storefront/screens/TrackOrderPage.tsx` | `hasTracking` |

Prop rules, all enforced by `sanitizeAnalyticsEvent`:

- identifiers (`productId`, `variantId`): `^[A-Za-z0-9_-]{1,64}$`
- handles (`productHandle`, `collectionHandle`): `^[a-z0-9][a-z0-9._-]{0,79}$`
- counts: integers — `quantity` 1–999, `itemCount` 0–999, `productCount` 0–10000
- money: `valueMinor` is an **integer in minor units** (4500 = $45.00),
  0 – 100,000,000; `currency` is a 3-letter code, upper-cased on ingest
- the attributed `path` is a rooted path (query and fragment stripped), ≤ 200 chars

`checkout_success` and `purchase` fire together by design: they are two
observations of one conversion (payment provider first, order row second), and
only `purchase` is counted as money in the funnel.


## Wire format

One POST per event to `/api/analytics/collect`:

```json
{
  "event": "add_to_cart",
  "path": "/us/products/oak-board",
  "props": { "productId": "prod_1", "variantId": "var_2", "quantity": 1, "currency": "USD", "valueMinor": 4500 }
}
```

Transport order (see `lib/analytics/client.ts`):

1. `navigator.sendBeacon(path, Blob)` — survives a navigation right after the
   click, which is exactly when `add_to_cart` fires.
2. `fetch(path, { method: "POST", keepalive: true, credentials: "omit" })` when
   `sendBeacon` is missing or refuses the payload.
3. If neither works the event is dropped and `track()` returns `false`. Nothing
   is queued, retried or written to storage.

Server responses (always empty bodies, never cached):

| Status | Meaning |
| --- | --- |
| `204` | accepted and counted (one log line written) |
| `400` | unknown event name, out-of-bounds prop, or malformed JSON |
| `413` | body larger than 4 KB (checked against `Content-Length` *and* while streaming) |
| `429` | rate limit: 120 events per minute per client address (`analytics` bucket) |
| `405` | any method other than `POST` |

Rate limiting uses the same module as the Task 18 middleware guard
(`lib/security/rate-limit.ts`). `/api` is the one path Next 16's `proxy.ts`
excludes from that guard, so the collector applies its own bucket — the reason
this route is worth re-reading whenever the proxy matcher changes.

## Funnel (Step 4)

Stages, in order: `view_product` → `add_to_cart` → `begin_checkout` → `purchase`.

`analyticsFunnel.snapshot()` (`lib/analytics/funnel.ts`) returns:

```jsonc
{
  "totals": { "view_product": 120, "add_to_cart": 30, "begin_checkout": 12, "purchase": 4 },
  "stages": [
    { "stage": "view_product",   "count": 120, "fromPrevious": null,   "fromStart": null },
    { "stage": "add_to_cart",    "count": 30,  "fromPrevious": 0.25,   "fromStart": 0.25 },
    { "stage": "begin_checkout", "count": 12,  "fromPrevious": 0.4,    "fromStart": 0.1  },
    { "stage": "purchase",       "count": 4,   "fromPrevious": 0.3333, "fromStart": 0.0333 }
  ],
  "purchaseValueMinor": 18000,
  "currencies": ["USD"],
  "days": ["2026-09-22", "2026-09-23"],
  "recorded": 166
}
```

- `fromPrevious` is the step conversion, `fromStart` the cumulative one; both are
  `null` when the denominator is zero, because "0% of nothing" is not a finding.
- `purchaseValueMinor` counts `purchase` events only (a cart value is not
  revenue) and only from a valid integer `valueMinor`.
- Retention is 30 UTC days, evicting the oldest day first.

### How precise these numbers are

- **Counts are per process.** The aggregator lives in module scope like the
  rate limiter: on a multi-instance deploy each instance counts its own share,
  and every deploy starts from zero. Treat the funnel as a directional signal.
- **Openfront is authoritative for money.** `purchase` is counted each time the
  confirmation page is *viewed*, so a refresh counts twice. The order row is the
  real purchase count — reconcile against it before acting on the number.
- **Client-side blocking wins.** An ad-blocker, an extension, DNT/GPC or a
  blocked beacon means the visitor is simply not counted. The numbers are a
  floor, never an inflation, of real traffic.

## Deliberately not collected

No email, name, phone, street address, postal code, card or payment data, IP
address, order id/secret key, session or cookie id, user agent, referrer URL,
search term, free-text field, or cross-site identifier. No third-party script is
loaded, so nothing is shared with an analytics vendor.

The collector logs each accepted event (name, allowlisted props, path only),
because that log line is how the pipeline is verified in production; the Task 17
log sanitizer drops sensitive keys at every depth as a second line of defence.

## Enabling and verifying

```bash
# 1. switch it on
NEXT_PUBLIC_ANALYTICS_ENABLED="true"

# 2. send one event by hand
curl -i -X POST http://localhost:3002/api/analytics/collect \
  -H 'content-type: application/json' \
  -H 'x-forwarded-for: 203.0.113.10' \
  -d '{"event":"view_product","path":"/us/products/oak-board","props":{"productHandle":"oak-board"}}'
# → 204, X-RateLimit-Bucket: analytics, Cache-Control: no-store

# 3. bad input is rejected, not echoed
curl -i -X POST http://localhost:3002/api/analytics/collect \
  -H 'content-type: application/json' \
  -d '{"event":"page_view"}'
# → 400
```

Each accepted event also prints one JSON log line with
`"operation":"analytics.event"` and `"status":"<event name>"`, greppable
alongside the Task 17 correlation fields.

## Tests

| Area | File |
| --- | --- |
| Vocabulary, allowlists, PII stripping, path sanitizing | `tests/unit/analytics/events.test.ts` |
| Funnel math, retention, "no identifier stored" shape | `tests/unit/analytics/funnel.test.ts` |
| Consent flags, transport fallback, non-throwing behaviour | `tests/unit/analytics/client.test.ts` |
| Ingest pipeline: rate limit, body cap, validation, log hygiene | `tests/unit/analytics/collect.test.ts` |
| Major→minor conversion used by the confirmation page | `tests/unit/storefront/money-minor-units.test.ts` |

## Follow-ups (not implemented here)

1. Shared counters (KV/Redis) so the funnel survives multiple instances and
   deploys — the same follow-up the rate limiter has.
2. Server-side order reconciliation if marketing ever needs deduplicated
   revenue; today the funnel is explicitly directional.
3. Privacy: the policy entry this line used to ask for exists as of Task 21
   (`store/lib/brand/policies.ts`, published at `/policies/privacy`, with
   `docs/legal/content-source.md` recording which facts it is allowed to state).
   What remains an operator decision is switching `NEXT_PUBLIC_ANALYTICS_ENABLED`
   on in production at all.

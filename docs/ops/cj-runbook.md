# CJdropshipping operations runbook

## Status

Partially implemented, **not activation-ready**. The adapter's read paths are
verified against the live CJ API (read-only); every write path fails closed.
No sandbox purchase, webhook, or reconciliation drill has run. Sections marked
Unspecified block activation. Evidence sources:
`docs/ops/adding-a-supplier-provider.md` (§5 read contract, §6 id rules,
§7 purchase gaps, §8 credentials), `docs/ops/cj-integration-requirements.md`,
`docs/ops/task12-acceptance-checklist.md`.

## Ownership and scope

| Decision | Value |
| --- | --- |
| Supplier / API version / official documentation | CJdropshipping, API 2.0, base `https://developers.cjdropshipping.com/api2.0/v1` |
| Adapter artifact | `store/integrations/cj-channel/cj.ts`, mirrored verbatim to `openship/features/integrations/channel/cj.ts` (git-ignored checkout — copy it, never edit the copy) |
| OpenShip revision / adapter checksum | OpenShip pinned `04b231d`; adapter sha256 `0590a80dd5e90cc9c9c25f828a2392904b6617e9a746272e352050766b1b63d5` |
| Technical owner / on-call / supplier escalation | Unspecified |
| Market / currency / warehouse / allowed variants | Unspecified — only `CN Warehouse` observed so far; no product confirmed US-stocked (§10) |
| Sandbox account / destination channel / operator | Unspecified — one live account used read-only; writes disabled |
| Spend, quantity, timeout and retry limits | Writes disabled; reads retried at most 3 attempts (1 s, 2 s backoff), HTTP 429 only |
| Callback lag threshold / reconciliation schedule | Unspecified — no webhook path is enabled |

## Configuration and secret lifecycle

Record names and shapes only — never values. All three live in the OpenShip
**server** environment (never browser code or the storefront bundle). A channel
row may override `platform.accessToken`; the environment value is the default.

| Setting | Shape and handling |
| --- | --- |
| `CJ_API_KEY` | `CJUserNum@api@<secret>`; measured length 46; the `@` characters are part of the value — an editor or shell that strips them yields a working-looking but shorter key (`48`) that fails auth |
| `CJ_ACCESS_TOKEN` | Returned by the token exchange; ~180-day lifetime; measured length 593 |
| `CJ_ACCESS_TOKEN_EXPIRES_AT` | ISO timestamp recorded next to the token; the adapter refuses every call once past it |

Rotation drill (designed, **not yet executed**): exchange `CJ_API_KEY` for a
fresh token; record the new `CJ_ACCESS_TOKEN_EXPIRES_AT`; verify with one
read-only `listV2` call; revoke/replace the old token — CJ's revocation
semantics for old tokens are Unspecified, so verify them before depending on
overlap; confirm revocation without printing either value. On exposure: writes
are already disabled and no purchase state exists, so there is nothing to
reconcile — rotate and re-verify reads only.


## Deployment and activation gates

All template gates stand — **none executed**. Current adapter slot state:

- **Verified reads**: `searchProductsFunction` (`/product/listV2`),
  `getProductFunction` (`/product/variant/query`), plus `getInventoryByVid`
  (`/product/stock/queryByVid`).
- **Fail-closed writes by design**: `createPurchaseFunction` returns `{ error }`
  until the §7 gaps are fixed (OpenShip forwards no idempotency key or order
  identity, and CJ documents none for order creation); `cancelPurchase` refuses
  because OpenShip's mutation rewrites local status only.
- **No webhook path**: registration/listing/deletion and both OAuth slots fail
  closed; the tracking and cancellation webhook handlers reject unverified
  events because the pinned routes parse JSON before dispatch, destroying the
  raw body the HMAC needs. Signature verification itself is implemented and
  unit-tested, ready for when raw bytes are available.
- Routing stays disabled; no CJ `ChannelPlatform`/`Channel` rows exist
  (Unspecified) until the gates pass.

## Normal operations and reconciliation

Verified read operations — all `GET`, header `CJ-Access-Token`, and the
envelope must satisfy `code === 200 && result === true` (HTTP 200 alone is not
success):

| Operation | Call | Notes |
| --- | --- | --- |
| Product search | `/product/listV2?page=&size=&keyWord=` | products at `data.content[0].productList[]`; `sellPrice` is a range string |
| Variant lookup | `/product/variant/query?pid=` | GET only (POST → code 16900202); carries `vid`/`variantSku`/price, **no stock** |
| Per-warehouse stock | `/product/stock/queryByVid?vid=` | accepts numeric and UUID vids; the only call that proves *where* stock sits |

Id safety: parse every CJ body with `parseCjJson` — 19-digit ids must remain
strings end to end (§6). Rate budget: documented ~10 req/s per IP; reads retry
HTTP 429 within the bounded budget; **writes are never retried**.

Purchase lookup, supplier cancellation, durable intents, failed-event recovery
and a reconciliation job: **Unspecified** — the write paths are disabled and no
operator commands are implemented.

## Incident drills

| Incident | Immediate action | Resolution evidence |
| --- | --- | --- |
| HTTP 429 / rate limit | Stop ad-hoc reads; the adapter's bounded retry (3 attempts) already covers transient throttle | Rate budget respected; no write was in flight |
| Envelope failure (`code != 200` or `result: false`, e.g. 16900202) | Treat as rejection, not ambiguity; never blind-retry a write | `code` + `message` captured by `CjApiError` |
| Token expired (adapter refuses before calling CJ) | Refresh via the token exchange before `CJ_ACCESS_TOKEN_EXPIRES_AT` | One read-only `listV2` probe succeeds |
| Webhook signature failure / replay | Handlers reject unverified events by design | Event dropped; the raw-body gap in the pinned create-tracking/cancel routes remains the open item |
| Purchase timeout / malformed response | Not reachable — writes disabled | n/a until §7 is cleared |
| Cancellation requested | Not supported — supplier-side cancel refuses | A local `CANCELLED` status is insufficient (§7) |
| Outage | Pause reads; nothing else can be affected | Reads succeed again; no outstanding intents exist |

## Rollback and data handling

Nothing routes to CJ, so rollback means: keep routing disabled, keep the
mirrored adapter out of any allowlist until gates pass. Preserve read-only
probe evidence; never log tokens, the `CJ_API_KEY`, signatures or full
provider payloads. Correlate by string `pid`/`vid`/`variantSku` — never by
product title.

## Test evidence and handoff

- **Unit/contract**: `store/tests/unit/cj-channel/cj.test.ts` — 26 tests,
  no network, passing (2026-09-18). Proves request shapes, envelope handling,
  id precision, and the fail-closed write contract; does **not** prove live CJ
  behavior.
- **Live read-only probes**: `listV2`, `variant/query`, `stock/queryByVid` —
  recorded in `docs/ops/adding-a-supplier-provider.md` §5.
- **Sandbox / live routing**: none. No purchase, cancellation, callback or
  reconciliation drill has run. Task 12 stays open until then.


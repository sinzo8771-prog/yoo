# Threat model — storefront, checkout, and the supplier/fulfillment path

> Created for Task 18 (security hardening) of `DROPSHIPPING-AGENT-PLAN.md`.
> Scope: the storefront repo (`store/`) plus the parts of the Openfront backend
> and OpenShip fulfillment service that the storefront depends on. Operator
> procedures live in `docs/ops/incident-runbook.md`; the OpenShip-side controls
> (webhook verification, ownership checks, purchase idempotency) are described
> there and referenced here by test name rather than re-asserted.

## Scope, components, and trust boundaries

| Component | Trust | Runs where | Holds |
| --- | --- | --- | --- |
| Storefront (`store/`) | untrusted network edge, no secrets beyond server env | Next.js (Node) | session cookie forwarded to Openfront, cart proof, rate-limit state |
| Openfront backend (`openfront/`) | trusted, owns data | Next.js + Prisma/Postgres | customers, orders, payments, provider/platform records |
| OpenShip fulfillment (`openship/`) | trusted, owns supplier links | Next.js | channel/platform credential wiring, matches, purchases |
| Supplier APIs (CJ) | **untrusted responses**, hostile-capable | external HTTPS | supplier catalog, stock, tracking |
| Payment providers (Stripe/PayPal) | untrusted webhook senders, authenticated by signature | external HTTPS | money movement, webhook events |
| Admin/operator browser | authenticated user, still an injection source | browser | ability to set store logo, provider URLs, platform records |

The boundaries that matter for this document:

```
customer browser ──► storefront middleware (edge) ──► server actions ──► Openfront GraphQL
     ▲                      │                              │                  │
     │ XSS surface          │ rate limit, CSRF, headers    │ cart proof       │ ownership + session
     │                      ▼                              ▼                  ▼
  operator-set logo/JSON-LD   provider config ──► SSRF guard ──► supplier API (untrusted response)
```

## Assets worth attacking

1. Customer sessions and account data (account takeover, order history).
2. Guest order access (`secretKey`) and cart proofs.
3. Payment credentials and webhook secrets (must never reach the browser).
4. Money-integrity: charged prices, refunds, inventory claims.
5. Supplier/provider credentials (CJ token, OpenShip `osp_` key).
6. Operator-only configuration (logo markup, provider base URLs).
7. Availability of the storefront itself (scraping, credential stuffing).

## Threat summary

| # | Threat | Status | Control (where) | Verification |
| --- | --- | --- | --- | --- |
| 1 | Account takeover | delegated + ingress-hardened | Openfront Keystone session auth; storefront adds rate limiting on account paths and an explicit CSRF gate | `tests/security/csrf.test.ts`, `tests/security/rate-limit.test.ts` |
| 2 | Credential leakage | mitigated (store side) | server-only env, nothing private in the client bundle, `.env*` git-ignored, client-safe keys only | `.env.example`, `.gitignore`, `git check-ignore -v store/.env` |
| 3 | Webhook spoofing | mitigated (Openfront/OpenShip side) | HMAC signature verification before any state change; failure alerts | `tests/integration/payment/webhook-auth.test.ts` |
| 4 | Duplicate purchases | mitigated | provider event id dedupe + `IdempotencyKey` records; supplier purchase creation refuses without an idempotency key | `tests/integration/payment/webhook-events.test.ts`, `tests/unit/order-routing/ingestion.test.ts`, `tests/unit/fulfillment/purchase-creation.test.ts` |
| 5 | Unauthorized order access | mitigated | session ownership check or guest `secretKey`, never an id alone | `tests/unit/storefront/order-access.test.ts`, `tests/unit/storefront/cart-proof.test.ts` |
| 6 | SSRF via configurable provider URL | mitigated (new in Task 18) | scheme/host allowlist + private-network denial before every outbound call | `tests/security/ssrf.test.ts`, `tests/unit/cj-channel/cj.test.ts` |
| 7 | Open redirect | mitigated | fixed confirmation path built from validated parts; internal-path assertion | `tests/unit/storefront/checkout.test.ts` |
| 8 | Price tampering | mitigated | server-computed amounts; client never supplies a price; display helpers only render server values | `tests/unit/catalog/*`, `tests/unit/storefront/checkout.test.ts` |
| 9 | Inventory race / oversell | mitigated (Openfront/OpenShip side) | inventory claims checked server-side at checkout and at match time | `tests/unit/fulfillment/match-verification.test.ts`, `tests/unit/fulfillment/reconciliation.test.ts` |
| 10 | Malicious supplier response | mitigated (new validation added) | envelope/`code` checks, id-digit quoting, schema-validated upstream records | `tests/unit/cj-channel/cj.test.ts`, `tests/security/schemas.test.ts` |

"Delegated" means the control lives in another component of the system; the
storefront's contribution is that it cannot weaken those controls (it holds no
credentials, performs no authorization decisions of its own, and fails closed
when the backend refuses).

## Threat detail

### 1. Account takeover

Attack paths: credential stuffing on the account sign-in page, session theft via
XSS, cross-site request forgery against an authenticated action.

- Session issuance and verification are Openfront's (Keystone session strategy);
  the storefront forwards the session and never mints one.
- **New in Task 18:** every `POST`/`PUT`/`PATCH`/`DELETE` to a page path is
  charged to one shared `actions` bucket (120/min), and account paths get their
  own tighter `auth` bucket (20/min), so stuffing a password list from one
  address is throttled at the edge before it reaches the login action
  (`lib/security/rate-limit.ts`).
- **New in Task 18:** server-action POSTs are gated on `Origin`/`Sec-Fetch-Site`
  (`lib/security/csrf.ts`), which is the storefront's own, testable half of CSRF
  defence; `Origin: null` (sandboxed iframe, `data:` document) is refused.
- XSS, the usual session-theft vector, is addressed in §10's sibling section
  ("HTML/script injection") below.
- Residual: the limiter is per-instance (see residual risks), so a distributed
  credential-stuffing campaign is not stopped by it; the defence-in-depth for
  that is Openfront-side throttling plus alerting on signature/auth failures
  (`docs/ops/incident-runbook.md`).

### 2. Credential leakage

- No payment secret belongs in the storefront: `.env.example` states that
  Stripe/PayPal secrets and webhook secrets live in Openfront, and the file
  carries only `NEXT_PUBLIC_*` client-safe keys plus server-only variables.
- `CJ_ACCESS_TOKEN`, `CJ_ACCESS_TOKEN_EXPIRES_AT`, `CJ_API_BASE` and
  `OPENSHIP_API_TOKEN` are documented as **server-only** (no `NEXT_PUBLIC_`
  prefix, so Next.js cannot inline them into the client bundle), verified by the
  new `.env.example` section.
- `.env` hygiene, verified rather than assumed:
  `git check-ignore -v store/.env store/.env.local` →
  `store/.gitignore:34:.env*` matches both; the repo root additionally ignores
  `.env`/`.env.*` while keeping `!.env.example` tracked.
- Logs: Task 17's correlation builder emits a closed key set, so a cart proof,
  `secretKey`, or token passed by mistake is dropped rather than serialized
  (`store/lib/observability/correlation.ts`, `tests/unit/observability/correlation.test.ts`).
- Residual: Openfront holds provider records (including credentials) in its
  database. Encryption at rest is therefore a property of that database/volume,
  not of this repo — see residual risks (KMS/envelope encryption or
  provider-side tokenisation).

### 3. Webhook spoofing

- Openfront/OpenShip verify the provider signature over the raw body **before**
  any state change and before parsing into a typed event; the storefront never
  receives a webhook (it has no webhook route), so no new spoofing surface was
  added in Task 18.
- Verification is pinned by `tests/integration/payment/webhook-auth.test.ts`
  (unsigned, mis-signed, and tampered bodies are refused) and every signature
  failure is alertable (`lib/observability/alerts.ts`, type
  `webhook_signature_failures`, critical severity).
- Residual: signature verification depends on the shared secret's storage, which
  is Openfront's; rotation procedure is documented in `docs/ops/payments.md`.

### 4. Duplicate purchases

Two independent duplicate paths exist, and both have a control:

- Duplicate *provider events* (a provider retrying a delivery): events are keyed
  by provider event id and recorded, so a redelivery is a no-op —
  `tests/integration/payment/webhook-events.test.ts`; the Openfront side uses
  `IdempotencyKey` rows.
- Duplicate *supplier purchases* (our own retry): the CJ adapter refuses to
  create a purchase without an idempotency key rather than risk a double charge
  at the supplier — pinned by
  `tests/unit/cj-channel/cj.test.ts` ("RETURNS an error (never throws), and
  refuses without an idempotency key") and
  `tests/unit/fulfillment/purchase-creation.test.ts` (the mutation path that
  would drop the key is refused).
- Order ingestion is signature-gated and idempotent at the boundary:
  `tests/unit/order-routing/ingestion.test.ts`, `tests/unit/order-routing/route-ingestion.test.ts`.
- Residual: the supplier purchase path stays **blocked** by design until
  OpenShip forwards order identity and channel credentials; the plan treats
  deliberate refusal as the safer failure mode.

### 5. Unauthorized order access

- Customer order reads are authorized by session ownership **or** a guest
  `secretKey`; an id alone is never sufficient, and both failure shapes return
  "nothing" rather than an error that confirms existence —
  `tests/unit/storefront/order-access.test.ts`.
- Cart mutations require the HMAC cart proof, verified server-side; a forged or
  missing proof fails closed — `tests/unit/storefront/cart-proof.test.ts`,
  `tests/security/schemas.test.ts` (record validation) and
  `tests/unit/storefront/checkout.test.ts` (proof forwarded, never trusted).
- **New in Task 18:** the cart cookie is written with an explicit policy
  (`path=/`, `SameSite=Lax`, `Secure` in production) in
  `features/storefront/middleware.ts`. `HttpOnly` is deliberately *not* set
  because the legacy client cart hook reads it; its value is a cart proof that
  is re-verified server-side, so possessing it does not grant access beyond that
  single cart. Moving the read server-side (and then setting `HttpOnly`) is
  listed as a follow-up.
- Tracking lookups are rate-limited (`tracking` bucket, 30/min) so order
  existence cannot be probed at speed.

### 6. SSRF via configurable provider URL

The real finding of this task: the CJ adapter's base URL is **data, not code** —
`platform.baseUrl` comes from an OpenShip platform record in the database, with
`CJ_API_BASE` as an environment fallback (see `resolveConfig` in
`integrations/cj-channel/cj.ts`). Before Task 18 that value was concatenated into
`new URL(...)` and fetched, so an operator-visible value could make the server
dial an arbitrary host.

Control (new): `lib/security/ssrf.ts`, applied by the adapter immediately before
every outbound request (`assertOutboundUrl` in `cjRequest`):

| Rule | Refused with |
| --- | --- |
| scheme allowlist (https; http only in the dev opt-in) | `protocol_not_allowed` |
| no embedded credentials | `embedded_credentials` |
| loopback/private/link-local/CGNAT/reserved IPv4 | `private_host` |
| loopback/unique-local/link-local/IPv4-mapped IPv6 | `private_host` |
| `.localhost` / `.local` / `.internal` / `.home.arpa`, `localhost.` | `private_host` |
| single-label hosts (internal search domains) | `single_label_host` |
| not a string / blank / over 2048 chars / unparseable | `not_a_string`, `too_long`, `invalid_url` |

IPv4 special notations (`https://2130706433/`, `https://0177.0.0.1/`,
`https://0x7f.0.0.1/`, `https://127.1/`, `https://0/`) are normalized by the URL
parser *before* the host check, and the tests assert exactly that — this is the
bypass naive string checks miss. A refusal raises `CjApiError`, so existing
callers' error handling and logging are unchanged, and the tests also assert
that `fetch` was never called.

The local-development escape hatch (`providerUrlAllowPrivate`) requires
`ALLOW_PRIVATE_PROVIDER_URLS=true` **and** a non-production `NODE_ENV`, so a
stray variable in a deployed environment cannot re-open the private network.

Residual: DNS rebinding (a public name that resolves to a private address after
the check) is not defended — that needs resolve-then-connect pinning, which the
shipped provider hosts (fixed, admin-only configuration) do not justify today.
Recorded as a follow-up with the trigger that would change it
(`platform.baseUrl` becoming customer- or supplier-supplied).

### 7. Open redirect

- The post-checkout redirect is built from validated parts only:
  `buildOrderConfirmationPath` refuses malformed country codes, order ids and
  guest keys; `assertSafeInternalPath` rejects anything that is not a plain
  same-origin path (`//host`, `scheme://`, backslashes) —
  `store/features/storefront/lib/security/redirects.ts`, pinned by
  `tests/unit/storefront/checkout.test.ts`.
- **New in Task 18:** the middleware's own redirect (adding `&step=address` to a
  cart URL) is derived from `request.nextUrl`, never from a request-supplied
  target, and every response that leaves the middleware carries the security
  headers — so a redirect cannot be used to shed them either.
- Residual: none known in this repo; the fixed-origin allowlist model is
  deliberate (no "return to" parameters exist).

### 8. Price tampering

- Prices are never accepted from the client: the storefront renders what
  Openfront returns and checkout completes server-side with the server-computed
  amount (`tests/unit/storefront/checkout.test.ts`, `tests/unit/catalog/money.test.ts`).
- Display helpers degrade rather than invent: a variant without price data is
  ignored, a missing price renders "Price unavailable" instead of `$0.00`, and a
  was-price is only shown when strictly above the charge price —
  `tests/unit/catalog/price-display.test.ts`, `tests/unit/products/product-detail.test.ts`.
- **New in Task 18:** responses carrying those prices are schema-validated at the
  boundary (`lib/security/schemas.ts` + `tests/security/schemas.test.ts`), so a
  malformed upstream record is rejected rather than rendered.
- Residual: the authoritative amount lives in Openfront's checkout; the
  storefront's obligation is to never *become* the authority, which the above
  keeps true.

### 9. Inventory race / oversell

- Availability is a server-side claim checked at checkout and re-checked when a
  match is created; the storefront only displays `availableForSale` /
  `inventory` from the catalog projection (`tests/unit/catalog/catalog.test.ts`).
- Match verification and reconciliation are pinned by
  `tests/unit/fulfillment/match-verification.test.ts`,
  `tests/unit/fulfillment/reconciliation.test.ts` and the alert types
  `unmatched_products` / `stale_orders`
  (`tests/unit/observability/alerts.test.ts`).
- **New in Task 18:** the browse/search surfaces that could be used to scrape
  stock levels at high speed are rate-limited (`search` bucket, 60/min).
- Residual: no reservation/locking exists in the storefront, by design — oversell
  prevention belongs to Openfront's inventory authority.

### 10. Malicious supplier response

A supplier API is the most hostile component in the system: it returns
attacker-influenceable strings (titles, image URLs, error text) and numbers that
do not fit in JavaScript's safe integer range.

- Envelope truth: CJ answers HTTP 200 with its own `code`/`result`, so both are
  checked and an in-envelope failure is an error, not a success
  (`tests/unit/cj-channel/cj.test.ts`, "treats HTTP 200 with a failure code as an
  error, not a success").
- Id integrity: 19-digit ids exceed `Number.MAX_SAFE_INTEGER`, so bare digit runs
  are quoted before `JSON.parse` and ids stay strings — silent id corruption
  would otherwise surface as "product not found"
  (`tests/unit/cj-channel/cj.test.ts`).
- Writes are never retried, and unsafe write paths fail closed with a specific
  reason ("still refuses even with an idempotency key").
- **New in Task 18:** every Openfront record the storefront consumes is
  schema-validated with bounded lengths before use, and operator-rendered fields
  are additionally sanitized (§11) — untrusted transport data cannot become
  executable markup or break out of a JSON-LD script element.
- Residual: supplier-supplied *image* URLs are passed through to the catalogue UI
  and are subject to the storefront's image configuration. They are never
  fetched by our server, so they are not an SSRF primitive.

### 11. HTML/script injection (requirement: framework escaping, safe rich-text)

- Default framework escaping is the baseline: React escapes interpolated text,
  and rich text renders through `react-markdown` with **no** `rehype-raw`, so
  embedded HTML in marketing copy stays inert (verified: `rehype-raw` is neither
  a dependency nor imported anywhere in `store/`).
- **New in Task 18** — three raw-injection surfaces, found and closed:

| Surface | Before | After |
| --- | --- | --- |
| `features/products/components/StructuredProductData.tsx` | `JSON.stringify(data)` inlined into `<script type="application/ld+json">` | `toJsonLdString(data)` escapes `<`, `>`, `&`, U+2028/9, so catalog text containing `</script>` cannot end the element |
| `features/storefront/modules/layout/components/logo/index.tsx` (`store.logoIcon`, operator-set) | `dangerouslySetInnerHTML={{ __html: store.logoIcon }}` verbatim | `sanitizeSvg()` drops scripts, event handlers, embedding/animation elements, off-origin and script-scheme URLs, remote paint references and fetching `style` payloads; `null` falls back to the built-in brand mark |
| same component (`store.logoColor`, operator-set) | interpolated into `hue-rotate(${logoColor}deg)` | `safeCssAngle()` clamps to a finite 0–360 number, so the value cannot break out of the declaration |

Honest statement of strength: `sanitizeSvg` is a **deny-list** sanitizer, not an
allow-list SVG parser. It is solid against the payload classes above (all covered
by `tests/security/markup.test.ts`) and it removes remote references outright,
but a determined markup-level bypass cannot be excluded the way a parser-based
sanitizer would exclude it. The compensating controls are that this content is
*operator-only* (an admin account must be compromised first) and that the SVG is
rendered inside a `size-4` decorative container with `aria-hidden`; the follow-up
is a nonce-based CSP, which turns any residual markup injection into a
non-executing one.

## Controls added by Task 18

| Module | Purpose | Tests |
| --- | --- | --- |
| `store/lib/security/ssrf.ts` | scheme/host allowlist, private-network denial, dev-only opt-in | `tests/security/ssrf.test.ts` (14) |
| `store/lib/security/rate-limit.ts` | bucket classification, fixed-window limiter, client key, response headers (4 buckets here; Task 19 added a 5th, `analytics`, for its `/api` collector) | `tests/security/rate-limit.test.ts` (14) |
| `store/lib/security/csrf.ts` | explicit Origin/Sec-Fetch-Site gate for server-action POSTs | `tests/security/csrf.test.ts` (8) |
| `store/lib/security/headers.ts` | the security header set, applied by the middleware | `tests/security/headers.test.ts` (5) |
| `store/lib/security/markup.ts` | `sanitizeSvg`, `safeCssAngle` for operator-set logo fields | `tests/security/markup.test.ts` (16) |
| `store/lib/security/jsonld.ts` | script-context-safe JSON-LD serialization | `tests/security/jsonld.test.ts` (4) |
| `store/lib/security/schemas.ts` | zod validation for Openfront records and provider URLs | `tests/security/schemas.test.ts` (7) |

Wired into existing code (the part that makes the modules real):

- `proxy.ts` → `features/storefront/middleware.ts` is the single ingress (Next.js
  16 names the middleware entry `proxy.ts`); its matcher covers every page and
  server-action POST and deliberately excludes `/api`, `_next/static`,
  `_next/image` and static asset paths, so assets stay cache-friendly and there
  is no unmatched public surface left unguarded.
  - The one exception is the Task 19 collector (`/api/analytics/collect`), and it
    is compensating rather than uncovered: the handler consumes its own
    `analytics` bucket through this same module, reads at most 4 KB of body
    (streamed, so a lying `Content-Length` does not help), validates the payload
    with the zod sanitizer, returns empty bodies only, and sets
    `Cache-Control: no-store` + `X-Content-Type-Options: nosniff` itself. If the
    proxy matcher ever changes, that handler is the thing to re-check
    (`tests/unit/analytics/collect.test.ts`).

- `features/storefront/middleware.ts` — `guardRequest()` runs **before** any
  routing work: CSRF refusal (403 + `X-CSRF-Rejected`) then bucket budget
  (429 + `Retry-After`/`X-RateLimit-*`); every response (including the
  country-code redirect) leaves through `applySecurityHeaders()`; the cart cookie
  gained `path`, `SameSite=Lax` and production `Secure`.
- `integrations/cj-channel/cj.ts` — `assertOutboundUrl` before every fetch, with
  the refusal surfaced as `CjApiError` so existing error paths/logging are
  unchanged (`tests/unit/cj-channel/cj.test.ts`, +3 tests).
- `features/storefront/lib/data/store.ts` — `getStore()` schema-validates the
  Openfront response and returns `null` on rejection, so all four consumers keep
  their brand-config fallbacks.
- `features/storefront/modules/layout/components/logo/index.tsx` and
  `features/products/components/StructuredProductData.tsx` — the two rendering
  wires for the sanitizers above.
- `package.json` — `npm run audit:deps` (`npm audit --audit-level=high`), the
  command CI runs in Task 23.
- `.env.example` — documents the CJ variables and the provider-URL escape hatch
  as server-only, and why the escape hatch is ignored in production.

## Residual risks and follow-ups (ranked)

1. **Dependency advisories.** `npm audit` reports 64 findings (7 low, 33
   moderate, 19 high, 5 critical) across 25 packages at high|critical. Direct
   dependencies: `next` [critical] — fixed by `next@16.3.6`, **same major**
   (16.0.3 → 16.3.6), so the critical exposure has a low-risk fix and should be
   taken first; `nodemailer` [high] — `nodemailer@10.0.10` (semver-major);
   `@keystone-6/core`, `@modelcontextprotocol/sdk` and `lodash` [high] — no
   direct fix available, they clear only as transitive updates land. The
   remaining findings arrive through the Keystone/express toolchain. Do **not**
   blind-`npm audit fix` this app: it would move pinned majors on a
   checkout-critical path. The audit script exists so the exposure stays visible
   and cannot regress silently.
2. **No Content-Security-Policy yet.** A static CSP is not possible with
   Next.js's inline bootstrap scripts; a per-request nonce must be threaded
   through the document. This is the single control that would neutralise any
   residual markup-injection bypass found in `sanitizeSvg`.
3. **Cart cookie is readable by client JS** (legacy hook reads
   `document.cookie`). The value is a server-verified cart proof, so this is not
   a session credential, but moving the read server-side would allow `HttpOnly`.
4. **Rate limiting is per-instance.** Counters live in module scope, so
   horizontally scaled deployments multiply the effective budget. A shared
   counter (KV/Redis) is the fix when the storefront runs more than one instance.
5. **DNS rebinding** is not defended (see §6). Becomes a requirement if provider
   URLs ever stop being admin-only data.
6. **Provider credential encryption at rest** is Openfront's database property,
   not this repo's; envelope encryption (KMS) or provider-side tokenisation is
   the recommended path, and the CJ token specifically stays in server env per
   Tasks 12/18.
7. **Openfront's own public endpoints** (GraphQL, payment webhooks) are outside
   this repo's ingress; the storefront's limiter cannot protect them. Their
   controls are signature verification + idempotency records, with rate limiting
   listed as an Openfront-side follow-up.

## Verification map

| Property | Command | Expected |
| --- | --- | --- |
| Whole storefront suite | `cd store; npx vitest run` | 41 files / 512 tests pass |
| New security suite | `cd store; npx vitest run tests/security` | 7 files / 68 tests pass |
| SSRF guard is wired into the adapter | `cd store; npx vitest run tests/unit/cj-channel` | 29 tests pass, incl. refusal without calling `fetch` |
| No new type errors | `cd store; npx tsc --noEmit` | 193 entries, 0 in `lib/security/`, `tests/security/`, `middleware.ts`, `cj-channel/`, `logo/`, `StructuredProductData.tsx` |
| Env files are ignored | `git check-ignore -v store/.env store/.env.local` | both match `store/.gitignore:34:.env*` |
| Dependency exposure | `cd store; npm audit --audit-level=high` | exits non-zero while advisories exist; counts as in residual risk 1 |
| Headers are live | `curl -sI https://<store-host>/` | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` |
| Rate limiting is live | >120 `POST`s/min from one address | `429` with `Retry-After` and `X-RateLimit-*` |
| CSRF gate is live | `POST` with `Next-Action` and a cross-site `Origin` | `403` with `X-CSRF-Rejected: 1` |

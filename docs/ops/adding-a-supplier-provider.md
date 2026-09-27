# Adding a supplier provider (channel adapter) to OpenShip

How to add a fulfillment supplier to the local stack. Written against the
pinned OpenShip checkout and a live CJdropshipping account used for
**read-only** probes (2026-09-17).

Tags: **[V]** verified in code or by a live call · **[U]** unverified ·
**[B]** blocked by a verified OpenShip-side gap.

## 0. Short version

There is **no registry and no allowlist to edit**. Nothing to import, no
build step, no schema migration. Three things must line up:

1. a module at `openship/features/integrations/channel/<name>.ts`
2. a `ChannelPlatform` row whose ten adapter fields name that module
3. a `Channel` (the destination instance) plus `Link`/`Match` rows

Step 1 is the only code. Steps 2–3 are **database rows**, normally created
through the OpenShip admin UI or its GraphQL API.

## 1. How dispatch works [V]

`features/integrations/channel/lib/executor.ts`:

```ts
const functionPath = platform[functionName];          // value from the row
if (functionPath.startsWith("http")) { /* POST JSON {platform, ...args} */ }
const adapter = await import(`../${functionPath}.ts`);
const fn = adapter[functionName];                      // named export
return await fn({ platform, ...args });
```

Consequences that dictate the design:

- The field **value is a path** (module name, or a URL for a remote adapter),
  while the field **name selects the export**. Setting
  `searchProductsFunction = "cj"` imports `features/integrations/channel/cj.ts`
  and calls its exported `searchProductsFunction`.
- Because the export name must equal the field name, the module must export
  functions **named exactly after the ChannelPlatform fields** —
  `searchProductsFunction`, `createPurchaseFunction`, and so on. The synthetic
  adapter in `store/integrations/synthetic-channel/synthetic.ts` follows this
  rule (and mirrors it into the pinned checkout as
  `openship/features/integrations/channel/synthetic.ts`).
- A value starting with `http` switches to a **remote adapter**: the platform
  JSON plus args are POSTed to that URL. Use this to host an adapter outside
  the OpenShip process.
- Every call receives `platform` first, so adapters read their own credentials
  from the row rather than from a module-level constant.
- The ten adapter fields are all `validation: { isRequired: true }`, so **a
  module must export all ten named functions** even if some are stubs. The
  synthetic adapter does exactly this: its unsupported operations **return**
  `{ error: "<message>" }` (`searchProductsFunction`, `createWebhookFunction`,
  `getWebhooksFunction`, `deleteWebhookFunction`, `oAuthFunction` and its
  callback), while `createTrackingWebhookHandler` **throws** on malformed or
  unknown events. Note the asymmetry — those two failure styles are not
  interchangeable, because `createChannelPurchase` detects failure by testing
  `if (result.error)`, so the purchase path must *return* an error, not throw.

## 2. The ten required exports [V]

From `features/keystone/models/ChannelPlatform.ts` (group "Adapter Functions").
For `ChannelPlatform.<field> = "<module>"`, the module must export:

| ChannelPlatform field | Module export |
| --- | --- |
| `searchProductsFunction` | `searchProductsFunction` |
| `getProductFunction` | `getProductFunction` |
| `createPurchaseFunction` | `createPurchaseFunction` |
| `createWebhookFunction` | `createWebhookFunction` |
| `oAuthFunction` | `oAuthFunction` |
| `oAuthCallbackFunction` | `oAuthCallbackFunction` |
| `createTrackingWebhookHandler` | `createTrackingWebhookHandler` |
| `cancelPurchaseWebhookHandler` | `cancelPurchaseWebhookHandler` |
| `getWebhooksFunction` | `getWebhooksFunction` |
| `deleteWebhookFunction` | `deleteWebhookFunction` |

Each is called as `fn({ platform, ...args })`, so the adapter reads per-channel
settings from `platform` (the row) instead of module-level state. The synthetic
adapter is the reference implementation:
`store/integrations/synthetic-channel/synthetic.ts`.

`oAuthFunction` / `oAuthCallbackFunction` matter only for per-shop OAuth
platforms. For an account-key supplier (like CJ) they are stubs — but they must
still exist, because the row requires them.

## 3. Credentials: row vs environment

Two supported placements, both server-side:

- **On the row** (`ChannelPlatform.appKey` / `appSecret`, or `Channel.accessToken`
  / `Channel.domain`). The executor always passes `platform` first, so this is
  the natural home. `ChannelPlatform.webhookSecret` is the one field with
  `access.read: () => false`, i.e. hidden from GraphQL — the pattern to copy.
- **In server environment** (`openship/.env`). Right for a supplier-wide account
  credential that is not per-channel, because CJ's token model is one account
  token, not per-shop. This path is **doubly** protected and worth confirming
  before storing a live secret: the pinned clone's own `.gitignore:34` has
  `.env*`, and the parent repo's `.gitignore:2` ignores `/openship/` entirely.
  Confirm with `git check-ignore -v openship/.env` from the repo root.

Recommendation for CJ: keep the account credential in `openship/.env`, keep
`webhookSecret` on the row, and never log either. Verify the key parses before
trusting it (see the warning in §8).

## 4. The rows that wire it up

Dispatch needs a module, but a *fulfillment* needs three linked rows. All are
created through the OpenShip admin UI or its GraphQL API — no migration:

1. `ChannelPlatform` — `name` plus the ten adapter fields (§2).
2. `Channel` — the destination instance: `platform`, `domain`/`accessToken`
   (read by `createChannelPurchase`, see §7), and whatever the adapter needs.
3. `Link` + `Match` — which source variants map to which supplier variants.
   `store/lib/openship/setup.ts` creates these in that order and rejects a link
   unless its shop is in sequential mode.

## 5. Verified CJ read-only contract [V]

All calls below were made against the live account on 2026-09-17 with
`CJ-Access-Token`. Read-only: no purchase, no write, no webhook registration.

Base: `https://developers.cjdropshipping.com/api2.0/v1`
Header: `CJ-Access-Token: <accessToken>`

| Purpose | Call | Method | Result |
| --- | --- | --- | --- |
| Product discovery | `/product/listV2?page=1&size=N&keyWord=` | GET | `code=200` |
| Product discovery (older) | `/product/list` | GET | `code=200` but **`content` empty** |
| Variants of a product | `/product/variant/query?pid=<id>` | **GET** (POST rejected `16900202`) | `code=200`, array |
| Product detail | `/product/productDetail/query` body `{id}` | **POST** | `code=200` |
| Per-warehouse stock | `/product/stock/queryByVid?vid=<id>` | GET | `code=200` |

Response codes seen: `code=200 result=True msg="Success"`. CJ returns its own
`code` field, so **HTTP 200 alone does not mean success** — the adapter must
check `code`/`result`.

### Shape notes that break naive adapters [V]

- `listV2` `sellPrice` is a **range string**, e.g. `"11.09 -- 17.07"`, not a
  number. Prices are unreliable here; take them from the variant call.
- `listV2` returns many keys as `null` (`nowPrice`, `currency`, `supplierName`,
  `threeCategoryName`). Null-safe formatting is required — a naive
  `.Substring()` on a null field threw during probing.
- `categoryId` is a **category** UUID. It is not a product id.
- `GET /product/variant/query?pid=` returns the variant array with the real
  sellable identity: `vid`, `pid`, `variantSku` (e.g. `CJYD230765201AZ`),
  `variantNameEn`, `variantSellPrice` (numeric), `variantWeight`,
  `variantLength/Width/Height`, `barcode`, `variantKey` (e.g. `"Single bowl"`).
  `inventoryNum` and `inventories` came back **`null`** — this call does **not**
  give stock.
- `POST /product/productDetail/query` returns a product-level payload:
  `stanProducts[]` (one per **variant**, 4 of 4 here — carries `id`, `sku`,
  `pid`, `sellprice`, `weight`, `variantkey`), `newImgList[]` (images, 6),
  `keywords`, `priceRatio`, `tradePrice[]`. `stanProducts[0].countryInvs`,
  `.totalInventory` and `.invs` were all **`null`** — so this is **not** a
  per-country stock source either.
- **Per-warehouse stock comes only from `/product/stock/queryByVid`**, which
  returns `countryCode`, `areaEn` (warehouse name), `storageNum`,
  `totalInventoryNum`, and a `stock[]` of `{stockId, inventory,
  factoryInventory}`. This is the call that can prove *where* stock sits.

## 6. CJ ids must be treated as strings, never numbers [V]

Two independent reasons, both verified:

1. **Precision loss.** CJ ids are 19-digit integers, larger than
   `Number.MAX_SAFE_INTEGER` (`9007199254740991`). Measured directly:

   ```text
   raw id string      = 2502251050461617500
   JSON.parse(id)     = 2502251050461617700   // corrupted
   id lost precision? = true
   ```

   `fetch(...).json()` silently returns the **wrong** `pid`/`vid`. An adapter
   that round-trips an id through a JS number will request a nonexistent
   variant, and may fail in a way that looks like "product not found".

2. **The id space is heterogeneous.** `listV2`/`variant/query` return numeric
   ids for newer products, while CJ's own documentation examples use UUID vids
   (`7874B45D-E971-4DC8-8F59-40530B0F6B77`). Both forms were confirmed live:

   ```text
   [NUMERIC vid=2502251050461617900] code=200 result=True  storageNum=7899
   [UUID    vid=7874B45D-E971-...)  ] code=200 result=True  storageNum=12169
   ```

   `/product/stock/queryByVid` accepts either. So a numeric-only adapter would
   work for new products and break for old ones.

Both are solved the same way: keep every CJ id as a `string` from the moment it
enters the process. When parsing CJ JSON, ids must not go through `Number`.

**Rate limits are real and misleading.** `/product/stock/queryByVid` returned
**HTTP 429** on a rapid repeat, then succeeded after an 8-second pause with the
same id. A 429 during development is throttling (documented ~10 req/s per IP),
not proof that a request shape or id is wrong. Retry after a pause before
concluding anything from a failure.

## 7. The blocking OpenShip-side gap [B]

A perfect CJ adapter cannot fulfill a real order yet. Verified in pinned source:

`features/keystone/extendGraphqlSchema/mutations/createChannelPurchase.ts`

```ts
const { channelId, cartItems, address, notes, ...otherData } = input;
//                                            ^^^^^^^^^ idempotencyKey lands here

const channel = await context.query.Channel.findOne({
  where: { id: channelId },
  query: "id domain accessToken platform { id createPurchaseFunction }",
});

const result = await executeChannelPurchase({
  platform: channel.platform,
  cartItems,
  shipping: address,
  notes,
  // no idempotencyKey, no channel.accessToken, no channel.domain
});
```

- `idempotencyKey` is destructured into `otherData` and **never used**, so it is
  not passed to `createPurchaseFunction`.
- `channel.accessToken` and `channel.domain` are **queried but never
  forwarded**, so the adapter cannot see per-channel credentials during a
  purchase.

CJ has **no documented idempotency key** on order creation. Without a durable
key reaching the adapter, a retried create can produce a **duplicate supplier
order** — a real charge. So `createPurchaseFunction` must not be retried until
this gap is closed. This is the single highest-risk item in the whole
integration, and it is not a CJ-specific problem.

Also verified: `cancelPurchase.ts` changes **local status only**; it does not
call the supplier. A "cancelled" order may still ship.

## 8. Credentials: storage and a parsing trap [V]

CJ auth is one **account-level** credential, not per-shop, so it belongs in
server environment, not on a `Channel` row:

```text
CJ_API_KEY                  # CJUserNum@api@<secret>  (the identity+secret)
CJ_ACCESS_TOKEN             # returned by getAccessToken, 180-day lifetime
CJ_ACCESS_TOKEN_EXPIRES_AT  # ISO timestamp; refresh before this
```

Confirmed in this repo:

- `openship/.gitignore` ignores `.env*`, so `openship/.env` is **not
  committable**. A fingerprint scan found the secret in that file and nowhere
  else.
- The values are stored **double-quoted**. Node's `--env-file` (and `dotenv`)
  strip the quotes correctly — measured `CJ_API_KEY len=46`,
  `CJ_ACCESS_TOKEN len=593`. A naive reader sees `48`/`595` and would send a
  token wrapped in quotes, producing a confusing auth failure. If you ever read
  this file by hand, trim the quotes.
- The `@` characters in `CJ_API_KEY` are part of the value. An editor or shell
  that treats `@` specially will truncate the key (this happened: an IDE's
  inline commit feature swallowed the `@<secret>` suffix, so the value reaching
  the script was only the `CJ<number>@api` prefix and auth failed). Verify the
  key length and that it parses before trusting it.

**Never** put the token in a commit, log line, error message, or test fixture.

## 9. Recipe: add `<supplier>` end to end

1. **Write the module.** `openship/features/integrations/channel/<supplier>.ts`,
   exporting the ten names from §2 exactly. Use
   `store/integrations/synthetic-channel/synthetic.ts` as the template: the
   same ten exports, with unsupported operations returning `{ error }` and the
   tracking handler throwing on bad events (§1).
2. **Keep ids as strings** (§6). Parse CJ responses without letting ids pass
   through `Number`.
3. **Check CJ's own `code`/`result`**, not just HTTP status (§5).
4. **Read credentials from `platform` or environment** (§8), never a
   module-level literal.
5. **Create the `ChannelPlatform` row** (admin UI or GraphQL). Set the ten
   fields to the module name, e.g. `"cj"` for all ten.
6. **Create the `Channel`** row pointing at that platform.
7. **Create `Link` + `Match`** rows. `store/lib/openship/setup.ts` already does
   this in order and refuses a link whose shop is not in sequential mode.
   Supplier variant ids stored in `Match` must be the **string** ids from §6.
8. **Verify before enabling routing.** Point `getProductFunction` at a known
   `vid` and confirm the returned SKU matches what you put in `Match`.
9. **Leave routing disabled** until §7 is fixed and the flow is proven end to
   end on the synthetic channel first.

## 10. What is still unverified

- **Order creation, cancellation, and webhook registration were not tested.**
  No purchase was created; the account must not be charged during setup.
- `POST /product/productDetail/query` id semantics for products where
  `listV2` gave a different id form were not exhaustively mapped.
- **US-warehouse availability for a specific sellable product was not
  confirmed.** The utensil probe returned `CN Warehouse` only
  (`storageNum: 7899`). Country-level stock is now *queryable* (§5), but no
  product has been confirmed US-stocked, so US delivery time and landed cost
  remain open.
- Webhook signature, `messageId` dedup, and the sandbox status ladder are
  documented by CJ but were not exercised (they need a purchase to exist).
- A CJ → OpenShip adapter module **now exists**: `store/integrations/cj-channel/cj.ts`,
  mirrored verbatim to `openship/features/integrations/channel/cj.ts` (that
  checkout is git-ignored by the parent repo — copy it, never edit the copy).
  Its **read paths** implement §5 (search via `listV2`, variant lookup,
  per-warehouse stock) and were exercised live read-only; id handling follows
  §6 and envelope handling follows §5. **Every write path fails closed** with a
  specific reason (§7): purchase creation requires an idempotency key the pinned
  mutation never forwards, cancellation is refused because OpenShip only
  rewrites local status, webhook registration/OAuth have no verified CJ
  contract, and both webhook handlers reject unverified events because the
  pinned routes parse JSON before dispatch, destroying the raw body HMAC needs.
  Contract tests (26, all passing, no network) live at
  `store/tests/unit/cj-channel/cj.test.ts`. Unit tests prove the fail-closed
  contract and request shapes, **not** live CJ behavior; the bullets above
  about untested order creation, cancellation and webhooks still stand.
## 11. Related documents

- `docs/ops/cj-integration-requirements.md` — what CJ must provide, tagged by
  evidence level. Read this before deciding whether CJ fits.
- `docs/ops/supplier-comparison.md` — the candidate suppliers and why CJ was
  chosen (general sourcing, not print-on-demand).
- `docs/ops/supplier-adapter-template.md` — the capability matrix a new adapter
  must fill in: inventory, product lookup, purchase, cancellation, tracking,
  webhooks, retries.
- `docs/ops/supplier-runbook-template.md` — the operator procedures to write for
  the supplier once its adapter exists (credentials, incidents, reconciliation).
- `docs/ops/task12-acceptance-checklist.md` — the gate this work has to pass
  before real supplier credentials are connected.
- `docs/ops/openship-setup.md` — provisioning the OpenShip-side rows
  (`Shop`, `ChannelPlatform`, `Link`, `Match`) that §4 refers to.

Two of the above are **templates, not records of finished work**. The CJ adapter
module exists (§10) but is read-only by design: reads are verified, writes fail
closed, and routing stays disabled, so nothing in this document should be read
as a claim that CJ fulfillment is operational.
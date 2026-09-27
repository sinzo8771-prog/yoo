# Catalog product model

**Plan task:** Task 22 (seed a production-shaped catalog), deliverable
`docs/catalog/product-model.md`. Updated when the production catalog was seeded
(Steps 1-5 implemented; see each section for its state).

Every rule below is either **VERIFIED** against the local Openfront instance
(Task 4 addendum, `docs/architecture/current-state.md` §10), **IMPLEMENTED**
(Task 22 code referenced inline and covered by `store/tests/unit/catalog/`), or
explicitly marked **NOT YET IMPLEMENTED**. Nothing here is a guess about
upstream behaviour.

## Where the code lives

| Concern | File |
| --- | --- |
| Fixture data (products, variants, collections) | `store/scripts/fixture/catalog-fixture.ts` |
| Fixture seeder (dev only) | `store/scripts/seed-dev-catalog.ts` (`npm run seed:dev`) |
| **Production catalog data** (12 products) | `store/scripts/catalog/products.ts` |
| Variant → fulfillment mapping (Step 3) | `store/scripts/catalog/fulfillment.ts` |
| Media plan + licence record (Step 4) | `store/scripts/catalog/media.ts` |
| Artwork renderer + PNG encoder | `store/scripts/catalog/art.ts`, `store/scripts/catalog/png.ts` |
| Validation + `--strict` promotion gate | `store/scripts/catalog/validate.ts` (`npm run validate:catalog`) |
| Media generator | `store/scripts/generate-catalog-media.ts` (`npm run media:catalog`) |
| **Production seeder** (Step 5) | `store/scripts/seed-catalog.ts` (`npm run seed:catalog`) |
| Catalog contract tests | `store/tests/unit/catalog/catalog-validation.test.ts`, `catalog-art.test.ts` |
| Focused Prisma schema (read/write target) | `store/prisma/openfront.prisma` |
| Live contract check (GraphQL) | `store/scripts/check-catalog.ts` (`npm run check:catalog`) |
| Media provenance record | `docs/catalog/media-sources.md` |
| Trend/product rationale record | `docs/catalog/trend-sourcing.md` |


## Entity chain

A sellable row is a four-step chain. Omitting any link breaks the storefront:

```text
Currency ──┐
           ├─► MoneyAmount ──► ProductVariant ──► Product ──► ProductCollection
Region  ───┘                        │                 │
                                    └── SKU (1:1)     └── status: published
```

- `Currency` — **effectively mandatory.** `MoneyAmount.currency` is required in
  practice: the `calculatedPrice` resolver dereferences `currency.code` with no
  null check, so one currency-less price row **throws and fails the entire
  `products` query**, not just that variant. VERIFIED.
- `Region` — set alongside currency. The reference storefront filters prices by
  region while this storefront's client filters by currency, so both are set to
  keep the two clients reading the same rows. VERIFIED.
- `MoneyAmount` — one row per variant, carrying `amount` and optional
  `compareAmount`. VERIFIED.
- `ProductVariant` — the sellable unit; owns `sku`, inventory and price. VERIFIED.
- `Product` — the merchandising unit; owns title, handle, description, status. VERIFIED.
- `ProductCollection` — optional grouping; `Product.productCollections` is set
  (not connected) on update so removals converge. VERIFIED.

## Field contract and its quirks

| Field | Rule |
| --- | --- |
| `Product.handle` | URL slug; unique. Fixture handles are prefixed `dev-` so a real catalog can coexist. Hyphens are legal in handles but **not** in fixture keys, because keys are baked into ids. VERIFIED (test) |
| `Product.status` | Enum `draft \| proposed \| published \| rejected`. Only `published` is storefront-visible. `Product.filter` enforces this server-side for unauthenticated sessions, so a client-side filter is a convenience, **not the security boundary**. VERIFIED |
| `Product.description` | A Keystone `document()` field. Requesting bare `description` returns an object, not a string; it must be selected as `description { document }`. Adapter: `store/features/catalog/lib/document.ts`. VERIFIED |
| `Product.thumbnail` | **Virtual**, resolved from `productImages[0].image.url` (falling back to `imagePath`). Null when a product has no images, so clients need an image fallback. VERIFIED |
| `MoneyAmount.amount` | The source of truth for price. `calculatedPrice` is a **virtual field derived from `amount`** and can be absent/null — a client reading only `calculatedPrice` renders **0 prices**. VERIFIED |
| `MoneyAmount.compareAmount` | Optional "was" price. Clients must only surface it when strictly above the charged price. VERIFIED (test) |
| `ProductVariant.sku` | Must be **1:1 with the variant** for the Task 11/22 channel mapping. VERIFIED |

## Availability rule

Availability must be **computed, never defaulted**. VERIFIED:

```text
manageInventory === false                      -> available
manageInventory === true && allowBackorder      -> available
manageInventory === true && inventoryQuantity>0 -> available
otherwise                                       -> NOT available
```

The fixture deliberately covers all three cases (in stock; managed and zero with
no backorder; managed and zero with backorder) because this is the rule most
likely to be wrong and the most expensive when it is.

## Step 1: the assortment (10–30 products in one niche)

**IMPLEMENTED.** Twelve products in one niche — kitchen and table objects in
stoneware, oak and washed linen (`store/scripts/catalog/products.ts`). Each has
a title, a short value proposition, 2–3 paragraphs of original description,
variants with unique SKUs, a price in minor units, shipping constraints,
returns eligibility and two planned images. The validator enforces the
10–30 ceiling (`products:ceiling`), so growing past it is a deliberate act.

Shipping parcel facts (weight, dimensions, ship-from, handling time) are
recorded as `unverified(reason)` until a sourced item exists to measure. Those
unknowns are why `--strict` currently fails — see §Promotion gate.

## Variant normalisation (Task 22, Step 3)

**IMPLEMENTED.** Every sellable variant has a record in
`store/scripts/catalog/fulfillment.ts`, and the seeder writes it into
`ProductVariant.metadata.fulfillment` so the answer lives with the row:

- **Supplier mapping** (`mode: "supplier"`) — supplier, supplier SKU, the date
  it was verified and where. `SUPPLIER_MAPPINGS` is the seam the operator fills
  in; it is empty today because inventing a supplier SKU would be a fabricated
  ordering instruction.
- **Manual rule** (`mode: "manual"`) — a repeatable instruction plus a buy-note
  naming the exact variant (`"Buy: Stoneware Mug, 250 ml (NWG-MUG-250)…"`), and
  a `sourcing` field that is `pending` while the sourcing decision is open.

Validation fails on `fulfillment:coverage` (a variant with no record),
`fulfillment:orphan-mapping` (a mapping nothing consumes), and — under
`--strict` — on `fulfillment:pending`. Today all 21 variants are manual with
`sourcing: "pending"`; that is the honest state, not a defect to hide.

## Media (Task 22, Step 4)

**IMPLEMENTED — as authored artwork, clearly labelled.** The repository holds
no licensed product photography, so shipping someone else's photograph would
have unverifiable provenance. Instead each product has two images rendered
from `store/scripts/catalog/art.ts` (front view + detail view of the same
motif) by `npm run media:catalog`, written to
`store/public/images/catalog/*.png` and served from this deployment's own
origin.

Checks (`validate --strict`, mirrored by tests):

- real file on disk, square 1000 px PNG, within the 120 KB budget;
- **byte-identical** to what the current renderer produces (determinism makes
  the recorded sha256 mean something — see `catalog-art.test.ts`);
- alt text present and, while the image is a placeholder, starting with
  `"Illustration:"` so art is never described as a photograph of the item;
- `source` and `licence` present; the seeder copies both, plus the measured
  byte count and sha256, into `ProductImage.metadata`.

The DB shape: `ProductImage.imagePath` holds the root-relative URL and
`image_id` stays null on purpose — setting it would advertise a storage URL for
a file that does not exist in backend storage. `lib/openfront/catalog.ts`
selects `imagePath` and falls back to it exactly like the backend's own
`thumbnail` virtual field, so cards and the PDP gallery both render. Full
provenance and the replacement plan: `docs/catalog/media-sources.md`.


## Seed safety contract (Task 22, Step 5)

The seeder must be **idempotent** and must **never reset or delete production
data**. Two seeders share one contract:

- **Namespaced.** `seed-dev-catalog.ts` writes only `devfix_*` ids;
  `seed-catalog.ts` writes only `nwg_*` ids (`CATALOG_ID_PREFIX`), and its
  `--purge` deletes only `nwg_*` — children before parents (prices, images,
  variants, products, collections). Reference rows (currency, region, country,
  store) are reused by their unique keys and never deleted, because the other
  seeders and the app may already point at them.
- **Idempotent.** Every owned row is `upsert`ed against its deterministic id, so
  re-running converges instead of duplicating. Product images additionally prune
  `nwg_image_*` rows the plan no longer contains, so a shrunk plan converges too.
  VERIFIED: consecutive `npm run seed:catalog` runs report the same counts.
- **Validated first.** `validateCatalog()` runs before any write; errors abort
  the seed with nothing written. Every media file is read *before* connecting to
  the database, so `image_filesize` and the recorded sha256 always describe bytes
  that exist.
- **Approval is the run itself.** The seeder publishes by default (the
  storefront only lists `published` products); `--draft` seeds the same rows as
  drafts for review first.

> The dev fixture is not the production seeder. `devfix_` exists only so the
> catalog client can be developed and verified; `nwg_` is the production-shaped
> catalog. Do not point either at data it does not own.

## Promotion gate

`npm run validate:catalog -- --strict` is what "launch-ready" means, and it
currently **fails on purpose**. In order, strict requires:

1. every shipping parcel fact measured (`known: true`) instead of
   `unverified(reason)` — right now 48 facts across 12 products are unmeasured;
2. every variant's fulfillment record off `sourcing: "pending"` — right now all
   21 are pending because no supplier account exists yet;
3. every media file present, correct, within budget, and byte-identical to the
   renderer's output (this part passes today);
4. the structural contract above (unique handles/SKUs, coverage, licence
   records, the return window pinned to the published policy) — passes today.

Publishing (`status: published`) is deliberately *not* the same claim as
launch-ready: the rows must be visible to be reviewed, and the storefront's
availability rule keeps them orderable-as-made-to-order while sourcing is
pending. Strict passing is the sign-off, and only strict.

## Catalog ceiling

**10–30 products in one niche** (Task 22, Step 1). The catalog sits at 12
products in a single niche (kitchen & table). A second category, or growth past
30, stays out of scope until the single-supplier happy path is reliable.

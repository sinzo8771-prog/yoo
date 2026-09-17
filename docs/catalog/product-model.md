# Catalog product model

**Plan task:** Task 22 (seed a production-shaped catalog), deliverable
`docs/catalog/product-model.md`.

Every rule below is either **VERIFIED** against the local Openfront instance
(Task 4 addendum, `docs/architecture/current-state.md` §10) or explicitly marked
**NOT YET IMPLEMENTED**. Nothing here is a guess about upstream behaviour.

## Where the code lives

| Concern | File |
| --- | --- |
| Fixture data (products, variants, collections) | `store/scripts/fixture/catalog-fixture.ts` |
| Seeder that writes it | `store/scripts/seed-dev-catalog.ts` (`npm run seed:dev`) |
| Fixture integrity tests | `store/tests/unit/catalog/catalog-fixture.test.ts` |
| Focused Prisma schema (read/write target) | `store/prisma/openfront.prisma` |
| Live contract check (GraphQL) | `store/scripts/check-catalog.ts` (`npm run check:catalog`) |
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

## Variant normalisation (Task 22, Step 3)

Every sellable variant must either map **1:1 to a fulfillment SKU** or carry an
**explicit manual-fulfillment rule**. Status: **NOT YET IMPLEMENTED.** The
fixture's `DEV-CROCK-5` / `DEV-CROCK-7` are placeholders, not supplier SKUs, and
both are manual-fulfillment until mapped. See `docs/catalog/trend-sourcing.md`.

## Media (Task 22, Step 4)

**NOT YET IMPLEMENTED.** The fixture stores **no images at all**. Task 22 Step 4
requires checking dimensions, alt text, file size and a licensing/source record
before any product media is added. Because `thumbnail` is virtual, a product with
no media renders a null thumbnail rather than failing.

## Seed safety contract (Task 22, Step 5)

The seeder must be **idempotent** and must **never reset or delete production
data**. The dev fixture satisfies this by construction:

- **Namespaced:** every row it owns has a deterministic id beginning `devfix_`
  (products, variants, prices, collections, store, region, country). It writes
  and deletes **only** `devfix_*` ids, so a real catalog coexists untouched.
- **Idempotent:** every row is `upsert`ed against its deterministic id, so
  re-running converges instead of duplicating. VERIFIED: three consecutive
  `npm run seed:dev` runs each reported the same `4 products, 8 variants, 8
  prices, 2 collections, 1 store, 1 region, 1 country`.
- **Scoped purge:** `npm run seed:dev -- --purge` deletes children before
  parents and only within `devfix_*`.
- **Currency reuse:** `ensureCurrencyId()` reuses an existing currency by its
  unique `code` before creating one, so the seeder never fights the app over the
  currency row.

> The dev fixture is not the production seeder. Task 22 asks for
> `scripts/seed-catalog.*` operating on **production-shaped** data with human
> approval; the `devfix_` fixture exists only so the catalog client can be
> developed and verified. Do not point the fixture at production data.

## Publishing gate

`published` is set in the **fixture only**, because the storefront reads just
published products. A fixture product is **not** a production listing and must
not be presented as one. Promotion requires, in order, all of:

1. supplier availability **and** landed cost confirmed for every variant in a US
   warehouse;
2. placeholder SKUs replaced by a mapped SKU **or** an explicit
   manual-fulfillment rule (Step 3);
3. licensed media with dimensions, alt text, file size and source record (Step 4);
4. seeding through the Task 22 production seeder with human approval;
5. original merchandising copy — never paste supplier descriptions into customer
   pages (Step 2).

## Catalog ceiling

**10–30 products in one niche** (Task 22, Step 1). The single fixture product
does not authorise expanding past that ceiling, and multi-supplier complexity
stays out of scope until the single-supplier happy path is reliable.
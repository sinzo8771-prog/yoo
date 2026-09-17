/**
 * Task 4 dev fixture — the DATA half of `scripts/seed-dev-catalog.ts`.
 *
 * Split out as pure data (no Prisma, no side effects) so the fixture can be
 * asserted in `tests/unit/catalog/catalog-fixture.test.ts`. The seeder owns
 * every write; this module owns only what gets written.
 *
 * Safety rules (mirroring plan Task 22, Step 5):
 *  - **namespaced**: every id we mint starts with `devfix_` (FIXTURE_ID_PREFIX),
 *    so a real catalog can coexist and is never reset or deleted;
 *  - **idempotent**: ids are derived deterministically from `key` fields, so
 *    re-running the seeder converges instead of duplicating;
 *  - **no supplier claims**: SKUs are `DEV-` placeholders. None of them is a
 *    supplier SKU, and nothing here is mapped to a fulfillment source yet, so
 *    every variant is manual-fulfillment until Task 22 replaces this fixture.
 */

/** Every id this fixture owns. `purge` deletes only ids with this prefix. */
export const FIXTURE_ID_PREFIX = "devfix_";

export const CURRENCY_CODE = "usd";
export const REGION_CODE = "us";
export const COUNTRY_ISO2 = "us";

/** Brand-facing store record, so `/store` metadata is not the Openfront default. */
export const STORE = {
  key: "store",
  name: "Northwind Goods",
  defaultCurrencyCode: CURRENCY_CODE,
  homepageTitle: "Northwind Goods — considered objects for everyday life",
  homepageDescription:
    "A small catalog of solid oak, washed linen and stoneware. Prices and availability are read live from our catalog.",
};

export const COUNTRY = {
  iso2: COUNTRY_ISO2,
  iso3: "usa",
  numCode: 840,
  name: "United States",
  displayName: "United States",
};

export type VariantSeed = {
  /** Stable suffix, used for both the variant and its price id. */
  key: string;
  title: string;
  sku: string;
  price: number;
  compareAmount?: number;
  inventoryQuantity: number;
  allowBackorder?: boolean;
};

export type ProductSeed = {
  key: string;
  handle: string;
  title: string;
  subtitle: string;
  description: string[];
  collections: string[];
  variants: VariantSeed[];
};

export const COLLECTIONS = [
  { key: "kitchen", handle: "dev-kitchen", title: "Kitchen" },
  { key: "desk", handle: "dev-desk", title: "Desk" },
] as const;

/**
 * Deliberately covers the availability matrix, because that is the rule most
 * likely to be wrong and the one that costs money when it is:
 *  - in stock                               -> available
 *  - managed, zero stock, no backorder      -> NOT available
 *  - managed, zero stock, backorder allowed -> available
 * Also covers a discounted variant (`compareAmount`) to exercise `originalPrice`.
 */
export const PRODUCTS: ProductSeed[] = [
  {
    key: "oak_board",
    handle: "dev-oak-serving-board",
    title: "Oak Serving Board",
    subtitle: "Hand-finished solid oak",
    description: [
      "A generous serving board cut from a single piece of solid oak.",
      "Finished by hand with food-safe oil, so the grain deepens with use.",
    ],
    collections: ["kitchen"],
    variants: [
      {
        key: "small",
        title: "Small",
        sku: "DEV-OAK-S",
        price: 2400,
        inventoryQuantity: 5,
      },
      {
        key: "large",
        title: "Large",
        sku: "DEV-OAK-L",
        price: 3200,
        inventoryQuantity: 0,
        allowBackorder: false,
      },
    ],
  },
  {
    key: "linen_apron",
    handle: "dev-washed-linen-apron",
    title: "Washed Linen Apron",
    subtitle: "Stonewashed European linen",
    description: [
      "A cross-back apron in stonewashed linen that softens with every wash.",
      "Adjustable at the waist, with no ties to knot behind your neck.",
    ],
    collections: ["kitchen", "desk"],
    variants: [
      {
        key: "one_size",
        title: "One size",
        sku: "DEV-APRON-OS",
        price: 4800,
        inventoryQuantity: 12,
      },
      {
        key: "tall",
        title: "Tall",
        sku: "DEV-APRON-T",
        price: 5200,
        inventoryQuantity: 0,
        allowBackorder: true,
      },
    ],
  },
  {
    key: "stoneware_mug",
    handle: "dev-stoneware-mug",
    title: "Stoneware Mug",
    subtitle: "Reactive glaze, dishwasher safe",
    description: [
      "Thrown in small batches and glazed with a reactive finish, so no two are identical.",
      "Holds heat well, and is safe in both the dishwasher and the microwave.",
    ],
    collections: ["desk"],
    variants: [
      {
        key: "250ml",
        title: "250ml",
        sku: "DEV-MUG-250",
        price: 1800,
        compareAmount: 2200,
        inventoryQuantity: 30,
      },
      {
        key: "400ml",
        title: "400ml",
        sku: "DEV-MUG-400",
        price: 2100,
        inventoryQuantity: 8,
      },
    ],
  },
  /**
   * Added from public trend research, not from a supplier listing. The evidence
   * and its limits are recorded in `docs/catalog/trend-sourcing.md`: countertop
   * storage plus the nostalgia-driven tableware trend, both of which land on the
   * material story this store already tells (stoneware, oak, linen).
   *
   * It stays a `devfix_` fixture product: no supplier SKU is mapped, prices and
   * stock are placeholders, and Task 22 must re-source it before it can become a
   * real listing.
   */
  {
    key: "utensil_crock",
    handle: "dev-stoneware-utensil-crock",
    title: "Stoneware Utensil Crock",
    subtitle: "Reactive glaze, wide-mouthed",
    description: [
      "A wide-mouthed crock thrown in small batches, sized so a full set of utensils stays upright instead of tipping.",
      "The shape is an old one: a countertop jar that keeps the tools you reach for most within arm's reach.",
    ],
    collections: ["kitchen"],
    variants: [
      {
        key: "5in",
        title: "5 in",
        sku: "DEV-CROCK-5",
        price: 3200,
        compareAmount: 3900,
        inventoryQuantity: 18,
      },
      {
        key: "7in",
        title: "7 in",
        sku: "DEV-CROCK-7",
        price: 4200,
        inventoryQuantity: 0,
        allowBackorder: false,
      },
    ],
  },
];
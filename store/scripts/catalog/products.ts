/**
 * Task 22, Step 1 + Step 2 — the production-shaped catalog, as pure data.
 *
 * Twelve products in **one** niche: the kitchen and table objects this brand
 * already describes (stoneware, oak, washed linen). The ceiling in plan Task 22
 * is 10-30 products in one niche; a second category is out of scope until this
 * one is reliable.
 *
 * Two rules this file exists to enforce, both checked by
 * `scripts/catalog/validate.ts` and its tests:
 *
 * 1. **Copy is original.** Every title, subtitle and paragraph is written for
 *    this store as a *sourcing specification*: the operator must source an item
 *    that matches it, and must change the copy if the sourced item differs.
 *    Nothing is pasted from a supplier listing, and no claim is made that we
 *    have not decided to stand behind (no certifications, no provenance, no
 *    "was" prices — a reference price for an item never sold at a higher price
 *    is a false claim).
 * 2. **Unknown facts stay unknown.** Parcel weights, dimensions, the warehouse
 *    an item ships from and handling times are recorded as `unverified(...)`
 *    with a reason, never approximated with a plausible number. `--strict`
 *    validation refuses to call the catalog launch-ready while any of those
 *    remain (see docs/catalog/product-model.md §Promotion gate).
 */
import type { BackdropKey, MotifKey, PaletteKey } from "./art";

/** Every id this catalog mints. `--purge` deletes only ids with this prefix. */
export const CATALOG_ID_PREFIX = "nwg_";

export const CURRENCY_CODE = "usd";
export const REGION_CODE = "us";
export const COUNTRY_ISO2 = "us";

/**
 * The return window, in days. Not invented here: it is the window the published
 * Returns policy states (`lib/brand/policies.ts`), and a test fails if the two
 * ever disagree, so the catalog cannot promise a different window than the page
 * a customer is linked to.
 */
export const RETURN_WINDOW_DAYS = 30;

/** A fact we have measured or decided, versus one we have not. */
export type Fact<T> = { known: true; value: T } | { known: false; reason: string };

export function known<T>(value: T): Fact<T> {
  return { known: true, value };
}

export function unverified<T>(reason: string): Fact<T> {
  return { known: false, reason };
}

export type ShippingConstraints = {
  /** Fixed by the Shipping policy: this store ships to the United States only. */
  market: "us-only";
  /** True for stoneware and glass: the operator must not use a soft mailer. */
  requiresRigidPackaging: boolean;
  /** Ceramic, wood and textile — no battery, aerosol or flammable component. */
  hazmat: false;
  weightGrams: Fact<number>;
  dimensionsCm: Fact<{ length: number; width: number; height: number }>;
  shipsFrom: Fact<{ country: string; region: string }>;
  handlingDays: Fact<{ min: number; max: number }>;
};

export type ReturnsEligibility = {
  eligible: boolean;
  /** Must equal RETURN_WINDOW_DAYS and the published policy. */
  windowDays: number;
  conditions: string;
  /** Empty means "no product-specific exclusion" — not "unknown". */
  exclusions: string[];
};

/**
 * Every variant is made to order: we hold no stock ledger, and a backorder is
 * accepted because the operator buys the item to fulfil the order. Setting
 * `manageInventory: true` with quantity 0 (rather than `false`) keeps the stored
 * row honest — it records "none held" instead of hiding the question — while
 * `allowBackorder` is what makes it orderable.
 */
export const MADE_TO_ORDER_INVENTORY = {
  manageInventory: true,
  inventoryQuantity: 0,
  allowBackorder: true,
} as const;

export type CatalogVariant = {
  /** Stable suffix; part of the variant id and of the price id. */
  key: string;
  title: string;
  sku: string;
  /** Charge price in minor units (cents). No "was" price exists. */
  price: number;
};

export type CatalogProduct = {
  /** id-safe key (no hyphens: it is embedded in generated ids). */
  key: string;
  handle: string;
  title: string;
  /** Short value proposition, one clause, no hype. */
  subtitle: string;
  /** Original merchandising copy, 2-3 paragraphs, plain text. */
  description: string[];
  collections: string[];
  variants: CatalogVariant[];
  shipping: ShippingConstraints;
  returns: ReturnsEligibility;
};

export const STORE = {
  key: "store",
  name: "Northwind Goods",
  defaultCurrencyCode: CURRENCY_CODE,
  homepageTitle: "Northwind Goods — considered objects for everyday life",
  homepageDescription:
    "Stoneware, oak and washed linen for the kitchen and the table. Prices and availability are read from our catalog.",
} as const;

export const COLLECTIONS = [
  {
    key: "kitchen_table",
    handle: "kitchen-table",
    title: "Kitchen & table",
  },
  { key: "stoneware", handle: "stoneware", title: "Stoneware" },
  { key: "oak", handle: "oak", title: "Oak" },
  { key: "linen", handle: "linen", title: "Washed linen" },
] as const;

/** Shared reason for every parcel fact that needs a sourced item to exist. */
const NOT_SOURCED =
  "Not yet measured: no sourced item or supplier parcel record exists, so any number here would be invented (see docs/catalog/product-model.md §Step 1).";

function unmeasuredShipping(requiresRigidPackaging: boolean): ShippingConstraints {
  return {
    market: "us-only",
    requiresRigidPackaging,
    hazmat: false,
    weightGrams: unverified(NOT_SOURCED),
    dimensionsCm: unverified(NOT_SOURCED),
    shipsFrom: unverified(NOT_SOURCED),
    handlingDays: unverified(
      "Not yet promised: dispatch timing depends on the operator's sourcing decision, and the Shipping policy deliberately promises no transit times."
    ),
  };
}

/** Mirrors the Returns policy rather than restating it in new words. */
const RETURNS: ReturnsEligibility = {
  eligible: true,
  windowDays: RETURN_WINDOW_DAYS,
  conditions:
    "Unused and in its original packaging, within the published return window; every return starts with an email to support.",
  exclusions: [],
};

/**
 * The assortment. Ordering here is the order the seeder writes and the order
 * the storefront lists them (newest first, so the first entries are the most
 * recently created rows).
 */
export const PRODUCTS: CatalogProduct[] = [
  {
    key: "stoneware_utensil_crock",
    handle: "stoneware-utensil-crock",
    title: "Stoneware Utensil Crock",
    subtitle: "Wide mouth, reactive glaze",
    description: [
      "A wide-mouthed crock for the tools you reach for most. The opening is wide enough that a full set stands upright instead of leaning against the rim.",
      "Stoneware, glazed inside and out, with a flat unglazed foot that sits still on a worktop.",
      "The glaze is reactive, so the finish varies from piece to piece. That is the character of the finish rather than a defect, and it is why the variants differ in size rather than in colour.",
    ],
    collections: ["kitchen_table", "stoneware"],
    variants: [
      { key: "5in", title: "5 in", sku: "NWG-CROCK-5", price: 3200 },
      { key: "7in", title: "7 in", sku: "NWG-CROCK-7", price: 4200 },
    ],
    shipping: unmeasuredShipping(true),
    returns: { ...RETURNS },
  },
  {
    key: "stoneware_mug",
    handle: "stoneware-mug",
    title: "Stoneware Mug",
    subtitle: "Reactive glaze, dishwasher safe",
    description: [
      "A straight-sided mug that holds heat without a handle that gets hot first. The wall is thick enough to keep a drink warm while you work.",
      "Glazed inside and out, with a reactive finish that leaves each piece slightly different from the next.",
      "Both sizes are dishwasher safe and fit under a standard countertop machine.",
    ],
    collections: ["kitchen_table", "stoneware"],
    variants: [
      { key: "250ml", title: "250 ml", sku: "NWG-MUG-250", price: 1800 },
      { key: "400ml", title: "400 ml", sku: "NWG-MUG-400", price: 2100 },
    ],
    shipping: unmeasuredShipping(true),
    returns: { ...RETURNS },
  },
  {
    key: "stoneware_serving_bowl",
    handle: "stoneware-serving-bowl",
    title: "Stoneware Serving Bowl",
    subtitle: "Shallow curve, wide rim",
    description: [
      "A bowl with a shallow curve, so a salad can be tossed in it without the leaves ending up in a heap at the bottom.",
      "The rim is left wide enough to hold with both hands when the bowl is full and warm.",
      "Glazed inside and out, dishwasher safe, and heavy enough that a serving spoon does not tip it.",
    ],
    collections: ["kitchen_table", "stoneware"],
    variants: [
      { key: "24cm", title: "24 cm", sku: "NWG-BOWL-24", price: 4800 },
      { key: "30cm", title: "30 cm", sku: "NWG-BOWL-30", price: 6400 },
    ],
    shipping: unmeasuredShipping(true),
    returns: { ...RETURNS },
  },
  {
    key: "stoneware_pitcher",
    handle: "stoneware-pitcher",
    title: "Stoneware Pitcher",
    subtitle: "One litre, pinched lip",
    description: [
      "A pitcher for water on the table, sized to one litre so it is worth carrying but not heavy when full.",
      "The lip is pinched rather than cut, which is what stops a pour from running down the outside of the body.",
      "A handle that clears the knuckles when the pitcher is full, and a glaze that shows the marks of the hand that threw it.",
    ],
    collections: ["kitchen_table", "stoneware"],
    variants: [{ key: "1l", title: "1 L", sku: "NWG-JUG-1L", price: 5800 }],
    shipping: unmeasuredShipping(true),
    returns: { ...RETURNS },
  },
  {
    key: "oak_serving_board",
    handle: "oak-serving-board",
    title: "Oak Serving Board",
    subtitle: "Solid oak, hand-oiled",
    description: [
      "A serving board cut from solid oak, thick enough to carry a joint of meat or a whole loaf without bowing.",
      "Finished by hand with food-safe oil rather than a lacquer, so the surface can be refreshed at home and the grain deepens as it is used.",
      "One face is a full cutting surface; the reverse has a shallow juice groove for anything that would otherwise run onto the table.",
    ],
    collections: ["kitchen_table", "oak"],
    variants: [
      { key: "small", title: "Small", sku: "NWG-BOARD-S", price: 2400 },
      { key: "large", title: "Large", sku: "NWG-BOARD-L", price: 3200 },
    ],
    shipping: unmeasuredShipping(false),
    returns: { ...RETURNS },
  },
  {
    key: "oak_cutting_board",
    handle: "oak-cutting-board",
    title: "Oak Cutting Board",
    subtitle: "End-grain blocks, hanging hole",
    description: [
      "A working board rather than a serving one: end-grain blocks, so the blade edge is parted by the wood instead of being flattened against it.",
      "The thickness keeps it off the worktop and lets it be sanded back and re-oiled as often as it needs.",
      "A hole at one end takes a hook, so the board can dry on its edge instead of lying flat in its own moisture.",
    ],
    collections: ["kitchen_table", "oak"],
    variants: [
      { key: "medium", title: "Medium", sku: "NWG-CUT-M", price: 3600 },
      { key: "large", title: "Large", sku: "NWG-CUT-L", price: 4800 },
    ],
    shipping: unmeasuredShipping(false),
    returns: { ...RETURNS },
  },
  {
    key: "oak_salt_cellar",
    handle: "oak-salt-cellar",
    title: "Oak Salt Cellar",
    subtitle: "Lidded, for a cook's pinch",
    description: [
      "A small lidded cellar so salt can be kept within reach of the hob instead of in a box in a cupboard.",
      "Oak body, a lid that lifts off with two fingers, and enough capacity that it does not need refilling every time it is used.",
      "Sized for flaky salt rather than a fine-grained one, because the opening is what you pinch through.",
    ],
    collections: ["kitchen_table", "oak"],
    variants: [{ key: "single", title: "Single", sku: "NWG-CELLAR", price: 2800 }],
    shipping: unmeasuredShipping(false),
    returns: { ...RETURNS },
  },
  {
    key: "oak_trivet",
    handle: "oak-slat-trivet",
    title: "Oak Slatted Trivet",
    subtitle: "Slatted, lifts off the table",
    description: [
      "A slatted trivet for a hot dish that has just come out of the oven.",
      "The slats are set into a frame, so heat is broken up by air rather than passed straight through to the table, and the middle lifts out for washing.",
      "Oak, finished with the same food-safe oil as our boards.",
    ],
    collections: ["kitchen_table", "oak"],
    variants: [{ key: "20cm", title: "20 cm", sku: "NWG-TRIVET", price: 2200 }],
    shipping: unmeasuredShipping(false),
    returns: { ...RETURNS },
  },
  {
    key: "washed_linen_apron",
    handle: "washed-linen-apron",
    title: "Washed Linen Apron",
    subtitle: "Cross-back, stonewashed",
    description: [
      "A cross-back apron in stonewashed linen, which softens with every wash instead of stiffening.",
      "The straps cross behind you, so the weight is carried on the shoulders and nothing has to be knotted at the neck.",
      "One pair of ties at the waist, and a pocket set low enough to reach without looking.",
    ],
    collections: ["kitchen_table", "linen"],
    variants: [
      { key: "one_size", title: "One size", sku: "NWG-APRON-OS", price: 4800 },
      { key: "tall", title: "Tall", sku: "NWG-APRON-T", price: 5200 },
    ],
    shipping: unmeasuredShipping(false),
    returns: { ...RETURNS },
  },
  {
    key: "linen_tea_towels",
    handle: "washed-linen-tea-towels",
    title: "Washed Linen Tea Towels",
    subtitle: "Absorbent, turned hem",
    description: [
      "Linen tea towels with a turned hem, woven so the cloth absorbs from the first use rather than needing a dozen washes before it stops smearing glass.",
      "Stonewashed before they are sewn, so they arrive at the size they will stay.",
      "Sold as a pair or as a set of four, in the same weave.",
    ],
    collections: ["kitchen_table", "linen"],
    variants: [
      { key: "pair", title: "Pair", sku: "NWG-TOWEL-2", price: 2600 },
      { key: "four", title: "Set of four", sku: "NWG-TOWEL-4", price: 4200 },
    ],
    shipping: unmeasuredShipping(false),
    returns: { ...RETURNS },
  },
  {
    key: "linen_table_runner",
    handle: "washed-linen-table-runner",
    title: "Washed Linen Table Runner",
    subtitle: "Two lengths, hemmed ends",
    description: [
      "A runner that sits down the middle of a table, so there is a cloth surface for a hot dish without covering the whole of the wood.",
      "Hemmed at both ends, and wide enough for the plates nearest the middle to sit on it.",
      "Two lengths, because a runner that is too short reads as a napkin and one that is too long hangs off the end.",
    ],
    collections: ["kitchen_table", "linen"],
    variants: [
      { key: "180cm", title: "180 cm", sku: "NWG-RUNNER-180", price: 5400 },
      { key: "240cm", title: "240 cm", sku: "NWG-RUNNER-240", price: 6800 },
    ],
    shipping: unmeasuredShipping(false),
    returns: { ...RETURNS },
  },
  {
    key: "linen_napkins",
    handle: "washed-linen-napkins",
    title: "Washed Linen Napkins",
    subtitle: "Cloth napkins, hemmed",
    description: [
      "Linen napkins for everyday use, hemmed on all four sides so no edge has to be hidden.",
      "They crease, as linen does. Kept loose in a drawer rather than folded flat, they arrive at the table almost smooth.",
      "Sold as a set of four or six, in the same cloth as our runner.",
    ],
    collections: ["kitchen_table", "linen"],
    variants: [
      { key: "four", title: "Set of four", sku: "NWG-NAPKIN-4", price: 3600 },
      { key: "six", title: "Set of six", sku: "NWG-NAPKIN-6", price: 4800 },
    ],
    shipping: unmeasuredShipping(false),
    returns: { ...RETURNS },
  },
];


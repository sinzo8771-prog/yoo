/**
 * Task 4 dev fixture — the smallest catalog that lets us develop and verify the
 * catalog client. Plan Task 4, Step 4 requires querying a local Openfront with
 * "at least three products and multiple variants"; Task 22 later supersedes
 * this with the production-shaped catalog and media.
 *
 * Safety rules (mirroring plan Task 22, Step 5):
 *  - **idempotent**: every row we own has a deterministic `devfix_*` id and is
 *    upserted, so re-running converges instead of duplicating;
 *  - **namespaced**: we only ever write/delete ids starting with `devfix_`, so
 *    a real catalog can coexist and is never reset or deleted.
 *
 * Usage:  npm run seed:dev            (create/update the fixture)
 *         npm run seed:dev -- --purge (remove only `devfix_*` rows)
 */
import "dotenv/config";

import { PrismaClient, type Prisma } from "../generated/openfront-db";

const ID = "devfix_";
const CURRENCY_CODE = "usd";

const prisma = new PrismaClient();

type VariantSeed = {
  /** Stable suffix, used for both the variant and its price id. */
  key: string;
  title: string;
  sku: string;
  price: number;
  compareAmount?: number;
  inventoryQuantity: number;
  allowBackorder?: boolean;
};

type ProductSeed = {
  key: string;
  handle: string;
  title: string;
  subtitle: string;
  description: string[];
  collections: string[];
  variants: VariantSeed[];
};

const COLLECTIONS = [
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
const PRODUCTS: ProductSeed[] = [
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
];

/** Keystone `document` fields are stored as an array of block nodes. */
function toDocument(paragraphs: string[]): Prisma.InputJsonValue {
  return paragraphs.map((text) => ({
    type: "paragraph",
    children: [{ text }],
  })) as Prisma.InputJsonValue;
}

/** Reuse the currency if the app already created one (its `code` is unique). */
async function ensureCurrencyId(): Promise<string> {
  const existing = await prisma.currency.findUnique({
    where: { code: CURRENCY_CODE },
  });
  if (existing) return existing.id;

  const created = await prisma.currency.create({
    data: {
      id: `${ID}currency_${CURRENCY_CODE}`,
      code: CURRENCY_CODE,
      symbol: "$",
      symbolNative: "$",
      name: "US Dollar",
    },
  });
  return created.id;
}

async function seed(): Promise<void> {
  const currencyId = await ensureCurrencyId();

  for (const collection of COLLECTIONS) {
    const id = `${ID}collection_${collection.key}`;
    await prisma.productCollection.upsert({
      where: { id },
      update: { title: collection.title, handle: collection.handle },
      create: { id, title: collection.title, handle: collection.handle },
    });
  }

  for (const product of PRODUCTS) {
    const productId = `${ID}product_${product.key}`;
    const collectionIds = product.collections.map(
      (key) => `${ID}collection_${key}`
    );
    const description = toDocument(product.description);

    await prisma.product.upsert({
      where: { id: productId },
      update: {
        title: product.title,
        subtitle: product.subtitle,
        handle: product.handle,
        description,
        status: "published",
        productCollections: { set: collectionIds.map((id) => ({ id })) },
      },
      create: {
        id: productId,
        title: product.title,
        subtitle: product.subtitle,
        handle: product.handle,
        description,
        status: "published",
        productCollections: { connect: collectionIds.map((id) => ({ id })) },
      },
    });

    for (const [index, variant] of product.variants.entries()) {
      const variantId = `${ID}variant_${product.key}_${variant.key}`;
      const priceId = `${ID}price_${product.key}_${variant.key}`;
      const variantData = {
        title: variant.title,
        sku: variant.sku,
        inventoryQuantity: variant.inventoryQuantity,
        allowBackorder: variant.allowBackorder ?? false,
        manageInventory: true,
        variantRank: index,
      };

      await prisma.productVariant.upsert({
        where: { id: variantId },
        update: variantData,
        create: {
          id: variantId,
          ...variantData,
          product: { connect: { id: productId } },
        },
      });

      const priceData = {
        amount: variant.price,
        compareAmount: variant.compareAmount ?? null,
      };

      await prisma.moneyAmount.upsert({
        where: { id: priceId },
        update: priceData,
        create: {
          id: priceId,
          ...priceData,
          currency: { connect: { id: currencyId } },
          productVariant: { connect: { id: variantId } },
        },
      });
    }
  }

  const [products, variants, prices, collections] = await Promise.all([
    prisma.product.count({ where: { id: { startsWith: ID } } }),
    prisma.productVariant.count({ where: { id: { startsWith: ID } } }),
    prisma.moneyAmount.count({ where: { id: { startsWith: ID } } }),
    prisma.productCollection.count({ where: { id: { startsWith: ID } } }),
  ]);

  console.log(
    `Seeded dev fixture: ${products} products, ${variants} variants, ` +
      `${prices} prices, ${collections} collections (all "${ID}*" ids).`
  );
}

/** Remove only rows this script owns. Never touches non-`devfix_` data. */
async function purge(): Promise<void> {
  const scope = { id: { startsWith: ID } };
  // Order matters: children before parents.
  const prices = await prisma.moneyAmount.deleteMany({ where: scope });
  const variants = await prisma.productVariant.deleteMany({ where: scope });
  const products = await prisma.product.deleteMany({ where: scope });
  const collections = await prisma.productCollection.deleteMany({ where: scope });
  const currencies = await prisma.currency.deleteMany({ where: scope });

  console.log(
    `Purged dev fixture: ${prices.count} prices, ${variants.count} variants, ` +
      `${products.count} products, ${collections.count} collections, ` +
      `${currencies.count} currencies.`
  );
}

async function main(): Promise<void> {
  if (process.argv.includes("--purge")) {
    await purge();
  } else {
    await seed();
  }
}

main()
  .catch((error) => {
    console.error("DEV SEED FAILED:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
/**
 * Task 4 dev fixture — the smallest catalog that lets us develop and verify the
 * catalog client. Plan Task 4, Step 4 requires querying a local Openfront with
 * "at least three products and multiple variants"; Task 22 later supersedes
 * this with the production-shaped catalog and media.
 *
 * The fixture DATA lives in `./fixture/catalog-fixture.ts` (pure and testable);
 * this script owns only the writes. Safety rules (plan Task 22, Step 5):
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

import {
  COLLECTIONS,
  COUNTRY,
  CURRENCY_CODE,
  FIXTURE_ID_PREFIX as ID,
  PRODUCTS,
  REGION_CODE,
  STORE,
} from "./fixture/catalog-fixture";

const prisma = new PrismaClient();
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

  const storeId = `${ID}${STORE.key}`;
  await prisma.store.upsert({
    where: { id: storeId },
    update: {
      name: STORE.name,
      defaultCurrencyCode: STORE.defaultCurrencyCode,
      currencies: { connect: { id: currencyId } },
    },
    create: {
      id: storeId,
      name: STORE.name,
      defaultCurrencyCode: STORE.defaultCurrencyCode,
      currencies: { connect: { id: currencyId } },
    },
  });

  // Region + country so the country-code routes and region-scoped reference
  // queries resolve. `taxRate` has no database default, so it must be set.
  const regionId = `${ID}region_${REGION_CODE}`;
  await prisma.region.upsert({
    where: { id: regionId },
    update: {
      code: REGION_CODE,
      name: COUNTRY.displayName,
      taxRate: 0,
      taxCode: REGION_CODE.toUpperCase(),
      currency: { connect: { id: currencyId } },
    },
    create: {
      id: regionId,
      code: REGION_CODE,
      name: COUNTRY.displayName,
      taxRate: 0,
      taxCode: REGION_CODE.toUpperCase(),
      currency: { connect: { id: currencyId } },
    },
  });

  const countryId = `${ID}country_${COUNTRY.iso2}`;
  await prisma.country.upsert({
    where: { id: countryId },
    update: {
      iso2: COUNTRY.iso2,
      iso3: COUNTRY.iso3,
      numCode: COUNTRY.numCode,
      name: COUNTRY.name,
      displayName: COUNTRY.displayName,
      region: { connect: { id: regionId } },
    },
    create: {
      id: countryId,
      iso2: COUNTRY.iso2,
      iso3: COUNTRY.iso3,
      numCode: COUNTRY.numCode,
      name: COUNTRY.name,
      displayName: COUNTRY.displayName,
      region: { connect: { id: regionId } },
    },
  });

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
        productVariantId: variantId,
        // Region-scoped as well as currency-scoped: the reference storefront
        // filters prices by region, our client by currency. Setting both keeps
        // the two clients looking at the same rows.
        regionId,
        currencyId,
      };

      await prisma.moneyAmount.upsert({
        where: { id: priceId },
        update: priceData,
        create: {
          id: priceId,
          ...priceData,
        },
      });
    }
  }

  const [products, variants, prices, collections, stores, regions, countries] =
    await Promise.all([
      prisma.product.count({ where: { id: { startsWith: ID } } }),
      prisma.productVariant.count({ where: { id: { startsWith: ID } } }),
      prisma.moneyAmount.count({ where: { id: { startsWith: ID } } }),
      prisma.productCollection.count({ where: { id: { startsWith: ID } } }),
      prisma.store.count({ where: { id: { startsWith: ID } } }),
      prisma.region.count({ where: { id: { startsWith: ID } } }),
      prisma.country.count({ where: { id: { startsWith: ID } } }),
    ]);

  console.log(
    `Seeded dev fixture: ${products} products, ${variants} variants, ` +
      `${prices} prices, ${collections} collections, ${stores} store, ` +
      `${regions} region, ${countries} country (all "${ID}*" ids).`
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
  const countries = await prisma.country.deleteMany({ where: scope });
  const regions = await prisma.region.deleteMany({ where: scope });
  const stores = await prisma.store.deleteMany({ where: scope });
  const currencies = await prisma.currency.deleteMany({ where: scope });

  console.log(
    `Purged dev fixture: ${prices.count} prices, ${variants.count} variants, ` +
      `${products.count} products, ${collections.count} collections, ` +
      `${countries.count} countries, ${regions.count} regions, ` +
      `${stores.count} stores, ${currencies.count} currencies.`
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
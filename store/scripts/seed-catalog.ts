/**
 * Task 22, Step 5 — the production-shaped catalog seeder.
 *
 *   npm run seed:catalog              validate + upsert everything
 *   npm run seed:catalog -- --strict  additionally demand the launch gate
 *   npm run seed:catalog -- --draft   seed as draft instead of published
 *   npm run seed:catalog -- --purge   delete only `nwg_*` rows (children first)
 *
 * Safety contract (plan Task 22, Step 5):
 *  - **Namespaced:** every row this script owns carries a deterministic id
 *    starting `nwg_` (`CATALOG_ID_PREFIX`), so it coexists with the `devfix_`
 *    fixture and any real data, and `--purge` can only ever touch its own rows.
 *  - **Idempotent:** every owned row is upserted against its deterministic id;
 *    re-running converges instead of duplicating. Product-image membership is
 *    additionally pruned to the planned set, so a shrunk plan also converges.
 *  - **Validated first:** `validateCatalog()` runs before any write; errors
 *    abort the seed. `--strict` upgrades unverified facts and pending sourcing
 *    to errors, i.e. it refuses to seed while the catalog would overclaim.
 *  - **Reference rows are shared:** currency/region/country/store are reused by
 *    their unique keys when they already exist and never deleted by `--purge`.
 *
 * The preflight also reads every media file (aborting if any is missing) so the
 * byte count and sha256 written into `ProductImage.metadata` describe the exact
 * bytes the storefront will serve — never an estimated size.
 */
import "dotenv/config";

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient, type Prisma } from "../generated/openfront-db";
import { FULFILLMENT } from "./catalog/fulfillment";
import { MEDIA, MEDIA_SIZE, mediaForProduct } from "./catalog/media";
import { validateCatalog } from "./catalog/validate";
import {
  CATALOG_ID_PREFIX as ID,
  COLLECTIONS,
  COUNTRY_ISO2,
  CURRENCY_CODE,
  MADE_TO_ORDER_INVENTORY,
  PRODUCTS,
  REGION_CODE,
  STORE,
} from "./catalog/products";

const prisma = new PrismaClient();

/** ISO 3166-1 record for the single market the Shipping policy names. */
const COUNTRY_RECORD = {
  iso3: "usa",
  numCode: 840,
  name: "United States",
  displayName: "United States",
} as const;

/** Keystone `document` fields are stored as an array of block nodes. */
function toDocument(paragraphs: string[]): Prisma.InputJsonValue {
  return paragraphs.map((text) => ({
    type: "paragraph",
    children: [{ text }],
  })) as Prisma.InputJsonValue;
}

/**
 * Reuse the currency if anything (the app, the dev fixture) already created one
 * — `code` is unique, so a second row would be rejected anyway.
 */
async function ensureCurrencyId(): Promise<string> {
  const existing = await prisma.currency.findUnique({ where: { code: CURRENCY_CODE } });
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

/** Region is shared reference data keyed by its unique `code`. */
async function ensureRegionId(currencyId: string): Promise<string> {
  const existing = await prisma.region.findUnique({ where: { code: REGION_CODE } });
  if (existing) return existing.id;

  const created = await prisma.region.create({
    data: {
      id: `${ID}region_${REGION_CODE}`,
      code: REGION_CODE,
      name: COUNTRY_RECORD.displayName,
      taxRate: 0,
      taxCode: REGION_CODE.toUpperCase(),
      currency: { connect: { id: currencyId } },
    },
  });
  return created.id;
}

/** Country is shared reference data keyed by its unique `iso2`. */
async function ensureCountryId(regionId: string): Promise<string> {
  const existing = await prisma.country.findUnique({ where: { iso2: COUNTRY_ISO2 } });
  if (existing) return existing.id;

  const created = await prisma.country.create({
    data: {
      id: `${ID}country_${COUNTRY_ISO2}`,
      iso2: COUNTRY_ISO2,
      iso3: COUNTRY_RECORD.iso3,
      numCode: COUNTRY_RECORD.numCode,
      name: COUNTRY_RECORD.name,
      displayName: COUNTRY_RECORD.displayName,
      region: { connect: { id: regionId } },
    },
  });
  return created.id;
}

/** The brand store row; upserted on its deterministic id. */
async function ensureStore(currencyId: string): Promise<void> {
  const data = {
    name: STORE.name,
    defaultCurrencyCode: STORE.defaultCurrencyCode,
    homepageTitle: STORE.homepageTitle,
    homepageDescription: STORE.homepageDescription,
    currencies: { connect: { id: currencyId } },
  };
  await prisma.store.upsert({
    where: { id: `${ID}${STORE.key}` },
    update: data,
    create: { id: `${ID}${STORE.key}`, ...data },
  });
}

type MediaFile = { bytes: Buffer; sha256: string };

/**
 * Read every planned media file before touching the database. A missing file
 * aborts the whole seed: partial media would leave `image_filesize`/`sha256`
 * claiming facts about bytes we never read.
 */
function preflightMedia(rootDir: string): Map<string, MediaFile> {
  const files = new Map<string, MediaFile>();
  for (const entry of MEDIA) {
    const absolute = path.resolve(rootDir, entry.file);
    let bytes: Buffer;
    try {
      bytes = readFileSync(absolute);
    } catch {
      throw new Error(`Media file missing: ${entry.file} — run \`npm run media:catalog\` first.`);
    }
    files.set(entry.file, {
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return files;
}

/** Validate first; errors abort, warnings (pending sourcing) are printed. */
function preflightValidation(strict: boolean): void {
  const result = validateCatalog({ strict });
  for (const issue of result.warnings) console.warn(`  warn  [${issue.code}] ${issue.message}`);
  if (result.errors.length > 0) {
    for (const issue of result.errors) console.error(`  FAIL  [${issue.code}] ${issue.message}`);
    throw new Error(`Catalog validation failed with ${result.errors.length} error(s); nothing was written.`);
  }
}

type SeedOptions = {
  strict?: boolean;
  /** Seed as `draft` instead of `published` (review before customers see it). */
  draft?: boolean;
  rootDir?: string;
};

async function seed(options: SeedOptions = {}): Promise<void> {
  const rootDir = options.rootDir ?? process.cwd();
  preflightValidation(options.strict === true);
  const mediaFiles = preflightMedia(rootDir);

  const currencyId = await ensureCurrencyId();
  const regionId = await ensureRegionId(currencyId);
  await ensureCountryId(regionId);
  await ensureStore(currencyId);
  // Annotated, or the ternary widens to `string` and Prisma rejects it —
  // the enum field accepts only the ProductStatusType labels.
  const status: "draft" | "published" = options.draft ? "draft" : "published";

  for (const collection of COLLECTIONS) {
    const data = { title: collection.title, handle: collection.handle };
    await prisma.productCollection.upsert({
      where: { id: `${ID}collection_${collection.key}` },
      update: data,
      create: { id: `${ID}collection_${collection.key}`, ...data },
    });
  }

  let variantCount = 0;
  let priceCount = 0;
  const expectedImageIds: string[] = [];

  for (const product of PRODUCTS) {
    const productId = `${ID}product_${product.key}`;
    const collectionRefs = product.collections.map((key) => ({ id: `${ID}collection_${key}` }));
    const productData = {
      handle: product.handle,
      title: product.title,
      subtitle: product.subtitle,
      description: toDocument(product.description),
      status,
      // The shipping/returns facts travel with the row, including *which* facts
      // are still unverified and why — the database must not lose the honesty.
      metadata: {
        catalog: {
          source: "scripts/catalog/products.ts",
          shipping: product.shipping,
          returns: product.returns,
        },
      } satisfies Prisma.InputJsonValue,
    };
    await prisma.product.upsert({
      where: { id: productId },
      update: { ...productData, productCollections: { set: collectionRefs } },
      create: {
        id: productId,
        ...productData,
        productCollections: { connect: collectionRefs },
      },
    });

    for (const [index, variant] of product.variants.entries()) {
      const variantId = `${ID}variant_${product.key}_${variant.key}`;
      const fulfillment = FULFILLMENT[variant.sku];
      if (!fulfillment) throw new Error(`No fulfillment record for SKU ${variant.sku}`);
      const variantData = {
        title: variant.title,
        sku: variant.sku,
        ...MADE_TO_ORDER_INVENTORY,
        variantRank: index,
        metadata: { fulfillment } satisfies Prisma.InputJsonValue,
      };
      await prisma.productVariant.upsert({
        where: { id: variantId },
        update: variantData,
        create: { id: variantId, ...variantData, product: { connect: { id: productId } } },
      });

      const priceData = {
        amount: variant.price,
        compareAmount: null,
        productVariantId: variantId,
        // Region-scoped as well as currency-scoped (see seed-dev-catalog.ts):
        // the reference storefront filters by region, our client by currency.
        regionId,
        currencyId,
      };
      await prisma.moneyAmount.upsert({
        where: { id: `${ID}price_${product.key}_${variant.key}` },
        update: priceData,
        create: { id: `${ID}price_${product.key}_${variant.key}`, ...priceData },
      });
      variantCount += 1;
      priceCount += 1;
    }

    // Media: one ProductImage row per planned entry, carrying the licence
    // record and the measured facts (bytes + sha256) of the file we just read.
    for (const entry of mediaForProduct(product.key)) {
      const imageId = `${ID}image_${product.key}_${entry.order}`;
      expectedImageIds.push(imageId);
      const file = mediaFiles.get(entry.file);
      if (!file) throw new Error(`Media file missing: ${entry.file}`);
      const imageData = {
        imagePath: entry.url,
        altText: entry.altText,
        order: entry.order,
        image_width: MEDIA_SIZE,
        image_height: MEDIA_SIZE,
        image_filesize: file.bytes.length,
        image_extension: "png",
        metadata: {
          source: entry.source,
          licence: entry.licence,
          placeholder: entry.placeholder,
          placeholderReason: entry.placeholderReason ?? null,
          sha256: file.sha256,
          render: {
            motif: entry.motif,
            palette: entry.palette,
            backdrop: entry.backdrop,
            view: entry.view,
          },
        } satisfies Prisma.InputJsonValue,
      };
      await prisma.productImage.upsert({
        where: { id: imageId },
        update: { ...imageData, products: { connect: { id: productId } } },
        create: { id: imageId, ...imageData, products: { connect: { id: productId } } },
      });
    }
  }

  // Converge the other way too: images this plan no longer contains (renamed
  // handles, dropped views) are removed — still only ever `nwg_image_*` rows.
  const pruned = await prisma.productImage.deleteMany({
    where: {
      id: { startsWith: `${ID}image_` },
      NOT: { id: { in: expectedImageIds } },
    },
  });

  const [products, variants, prices, collections, images] = await Promise.all([
    prisma.product.count({ where: { id: { startsWith: ID } } }),
    prisma.productVariant.count({ where: { id: { startsWith: ID } } }),
    prisma.moneyAmount.count({ where: { id: { startsWith: ID } } }),
    prisma.productCollection.count({ where: { id: { startsWith: ID } } }),
    prisma.productImage.count({ where: { id: { startsWith: ID } } }),
  ]);

  console.log(
    `Seeded catalog: ${products} products, ${variants} variants, ${prices} prices, ` +
      `${collections} collections, ${images} images (wrote ${variantCount} variants/` +
      `${priceCount} prices this run, pruned ${pruned.count} stale image(s); all "${ID}*").`
  );
}

/** Remove only rows this script owns. Reference rows (currency/region/country/
 *  store) are shared with other seeders and are never deleted. */
async function purge(): Promise<void> {
  const scope = { id: { startsWith: ID } };
  // Order matters: children before parents.
  const prices = await prisma.moneyAmount.deleteMany({ where: scope });
  const images = await prisma.productImage.deleteMany({ where: scope });
  const variants = await prisma.productVariant.deleteMany({ where: scope });
  const products = await prisma.product.deleteMany({ where: scope });
  const collections = await prisma.productCollection.deleteMany({ where: scope });
  console.log(
    `Purged catalog: ${prices.count} prices, ${images.count} images, ` +
      `${variants.count} variants, ${products.count} products, ` +
      `${collections.count} collections (all "${ID}*").`
  );
}

async function main(): Promise<void> {
  const strict = process.argv.includes("--strict");
  const draft = process.argv.includes("--draft");
  if (process.argv.includes("--purge")) {
    await purge();
  } else {
    await seed({ strict, draft });
  }
}

main()
  .catch((error) => {
    console.error("\nCATALOG SEED FAILED:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());



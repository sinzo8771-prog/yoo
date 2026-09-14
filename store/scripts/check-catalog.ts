/**
 * Task 4 verification (plan Task 4, Step 4): query a local Openfront instance
 * through the catalog client and assert the contract holds against real data.
 *
 * Run:  NEXT_PUBLIC_BACKEND_URL=http://localhost:3000 npm run check:catalog
 * Exits non-zero when an expectation fails, so it can gate later tasks.
 *
 * Assertions are written against invariants rather than the exact dev fixture,
 * so this keeps working after Task 22 seeds the production-shaped catalog.
 */
import "dotenv/config";

import {
  getCollectionBySlug,
  getFeaturedProducts,
  getProductBySlug,
  searchProducts,
} from "../lib/openfront/catalog";

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ok   ${message}`);
  } else {
    console.log(`  FAIL ${message}`);
    failures.push(message);
  }
}

async function main(): Promise<void> {
  console.log("Catalog client verification\n");

  const featured = await getFeaturedProducts(12);
  console.log(`featured: ${featured.length} product(s)`);

  check(
    featured.length >= 3,
    `getFeaturedProducts returns at least 3 published products (got ${featured.length})`
  );

  const withMultipleVariants = featured.filter((p) => p.variants.length >= 2);
  check(
    withMultipleVariants.length >= 3,
    `at least 3 products expose multiple variants (got ${withMultipleVariants.length})`
  );

  const allVariants = featured.flatMap((p) => p.variants);
  check(
    allVariants.every((v) => v.price > 0),
    "every variant has a price > 0 (no missing calculatedPrice fell through)"
  );
  check(
    allVariants.every((v) => v.currencyCode.length > 0),
    "every variant reports a currency code"
  );
  check(
    allVariants.every((v) => typeof v.sku === "string" && v.sku.length > 0),
    "every variant reports a SKU (the 1:1 SKU mapping Task 22 depends on)"
  );

  // Availability must be *computed*, not defaulted: real catalogs contain both.
  check(
    allVariants.some((v) => v.available),
    "at least one variant is available"
  );
  check(
    allVariants.some((v) => !v.available),
    "at least one variant is unavailable (availability rule is applied)"
  );

  const described = featured.filter((p) => (p.description ?? "").length > 0);
  check(
    described.length === featured.length,
    `every product exposes a plain-text description (got ${described.length}/${featured.length})`
  );

  const discounted = allVariants.filter((v) => v.originalPrice !== undefined);
  check(
    discounted.every((v) => (v.originalPrice as number) > v.price),
    "originalPrice is only set when strictly above the charged price"
  );

  const single = await getProductBySlug(featured[0].slug);
  check(
    single?.id === featured[0].id,
    `getProductBySlug("${featured[0].slug}") returns the same product`
  );

  check(
    (await getProductBySlug("definitely-missing-product")) === null,
    "getProductBySlug returns null for an unknown handle"
  );

  const collectionHandle = featured.find(
    (p) => p.collectionHandles.length > 0
  )?.collectionHandles[0];
  if (collectionHandle) {
    const { products } = await getCollectionBySlug(collectionHandle);
    check(
      products.length > 0,
      `getCollectionBySlug("${collectionHandle}") returns products`
    );
  } else {
    check(false, "at least one product is linked to a collection");
  }

  const searchTerm = featured[0].title.split(" ")[0];
  const results = await searchProducts(searchTerm);
  check(
    results.some((p) => p.id === featured[0].id),
    `searchProducts("${searchTerm}") finds the product it came from`
  );
  check(
    (await searchProducts("   ")).length === 0,
    "searchProducts short-circuits blank queries"
  );

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed.`);
    process.exitCode = 1;
    return;
  }
  console.log("\nAll catalog checks passed.");
}

main().catch((error) => {
  console.error("\nLIVE CHECK FAILED:", error?.name, error?.message);
  process.exitCode = 1;
});
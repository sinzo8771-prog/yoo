import { describe, expect, it } from "vitest";

import {
  COLLECTIONS,
  FIXTURE_ID_PREFIX,
  PRODUCTS,
} from "@/scripts/fixture/catalog-fixture";

/** Seeder mints ids as `${FIXTURE_ID_PREFIX}<kind>_<key>`, so KEYs must be id-safe. */
const ID_SAFE = /^[a-z0-9_]+$/;
/** HANDLEs are URL slugs (`/collections/<handle>`, `/<handle>`), so hyphens are legal. */
const SLUG_SAFE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ALL_VARIANTS = PRODUCTS.flatMap((product) =>
  product.variants.map((variant) => ({ product: product.key, ...variant }))
);

describe("dev catalog fixture", () => {
  it("keeps every id it can mint inside the purgeable namespace", () => {
    expect(FIXTURE_ID_PREFIX).toBe("devfix_");
  });

  it("uses id-safe, unique product keys so generated ids cannot collide", () => {
    const keys = PRODUCTS.map((product) => product.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((key) => ID_SAFE.test(key))).toBe(true);
  });

  it("uses id-safe, unique variant keys within each product", () => {
    for (const product of PRODUCTS) {
      const keys = product.variants.map((variant) => variant.key);
      expect(new Set(keys).size, `${product.key} variant keys`).toBe(keys.length);
      expect(
        keys.every((key) => ID_SAFE.test(key)),
        `${product.key} variant keys`
      ).toBe(true);
    }
  });

  it("gives every product a unique, URL-safe, fixture-only `dev-` handle", () => {
    const handles = PRODUCTS.map((product) => product.handle);
    expect(new Set(handles).size).toBe(handles.length);
    expect(handles.every((handle) => handle.startsWith("dev-"))).toBe(true);
    expect(handles.every((handle) => SLUG_SAFE.test(handle))).toBe(true);
  });

  it("uses unique `DEV-` placeholder SKUs and never a supplier SKU", () => {
    const skus = ALL_VARIANTS.map((variant) => variant.sku);
    expect(new Set(skus).size).toBe(skus.length);
    expect(skus.every((sku) => sku.startsWith("DEV-"))).toBe(true);
  });

  it("prices every variant in positive integer minor units", () => {
    for (const variant of ALL_VARIANTS) {
      expect(Number.isInteger(variant.price), `${variant.sku} price`).toBe(true);
      expect(variant.price, `${variant.sku} price`).toBeGreaterThan(0);
      expect(
        Number.isInteger(variant.inventoryQuantity),
        `${variant.sku} inventory`
      ).toBe(true);
    }
  });

  it("only sets compareAmount when it is strictly above the charged price", () => {
    const discounted = ALL_VARIANTS.filter(
      (variant) => variant.compareAmount !== undefined
    );
    expect(discounted.length).toBeGreaterThan(0);
    for (const variant of discounted) {
      expect(variant.compareAmount!, `${variant.sku} compareAmount`).toBeGreaterThan(
        variant.price
      );
    }
  });

  it("gives every product merchant copy that is not blank", () => {
    for (const product of PRODUCTS) {
      expect(product.title.trim().length, `${product.key} title`).toBeGreaterThan(0);
      expect(product.subtitle.trim().length, `${product.key} subtitle`).toBeGreaterThan(0);
      expect(product.description.length, `${product.key} description`).toBeGreaterThan(0);
      expect(
        product.description.every((paragraph) => paragraph.trim().length > 0),
        `${product.key} description paragraphs`
      ).toBe(true);
      expect(product.variants.length, `${product.key} variants`).toBeGreaterThan(0);
    }
  });

  it("only links products to collections the seeder also creates", () => {
    // Explicitly `Set<string>`: the `as const` fixture array would otherwise
    // narrow the set to its literal keys while products declare `string[]`.
    const known = new Set<string>(COLLECTIONS.map((collection) => collection.key));
    for (const product of PRODUCTS) {
      expect(product.collections.length, `${product.key} collections`).toBeGreaterThan(0);
      for (const key of product.collections) {
        expect(known.has(key), `${product.key} -> ${key}`).toBe(true);
      }
    }
  });

  it("uses id-safe collection keys and URL-safe, unique handles", () => {
    const keys = COLLECTIONS.map((collection) => collection.key);
    const handles = COLLECTIONS.map((collection) => collection.handle);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(handles).size).toBe(handles.length);
    // Keys are baked into ids; handles are URL slugs, so hyphens are allowed here.
    expect(keys.every((key) => ID_SAFE.test(key))).toBe(true);
    expect(handles.every((handle) => SLUG_SAFE.test(handle))).toBe(true);
  });

  it("covers the availability matrix the catalog client must compute", () => {
    const inStock = ALL_VARIANTS.filter((variant) => variant.inventoryQuantity > 0);
    const outNoBackorder = ALL_VARIANTS.filter(
      (variant) => variant.inventoryQuantity === 0 && variant.allowBackorder !== true
    );
    const outBackorder = ALL_VARIANTS.filter(
      (variant) => variant.inventoryQuantity === 0 && variant.allowBackorder === true
    );

    expect(inStock.length, "in stock").toBeGreaterThan(0);
    expect(outNoBackorder.length, "zero stock, no backorder").toBeGreaterThan(0);
    expect(outBackorder.length, "zero stock, backorder allowed").toBeGreaterThan(0);
  });
});
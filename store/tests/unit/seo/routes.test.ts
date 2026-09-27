import { describe, expect, it } from "vitest";

/**
 * Task 19, Step 2 (unit) — canonical routes and the indexability rule.
 *
 * The sitemap, `robots.txt` and each page's metadata all depend on this rule,
 * so it is pinned here rather than asserted indirectly through those routes.
 */

import {
  HANDLE_PATTERN,
  INDEXABLE_STATIC_PATHS,
  MARKET_COUNTRY_CODE,
  NON_INDEXABLE_PREFIXES,
  collectionPath,
  indexableStaticRoutes,
  isIndexablePath,
  isSafeHandle,
  localizedPath,
  policyPath,
  productPath,
  stripCountryPrefix,
} from "@/lib/seo/routes";

describe("localizedPath", () => {
  it("prefixes the route with the market country code", () => {
    expect(localizedPath("/store")).toBe(`/${MARKET_COUNTRY_CODE}/store`);
    expect(localizedPath("store")).toBe(`/${MARKET_COUNTRY_CODE}/store`);
    expect(localizedPath("/products/oak-board")).toBe(
      `/${MARKET_COUNTRY_CODE}/products/oak-board`
    );
  });

  it("maps the root to the country root, not a double slash", () => {
    expect(localizedPath("/")).toBe(`/${MARKET_COUNTRY_CODE}`);
  });

  it("respects an explicit country code", () => {
    expect(productPath("oak-board", "ca")).toBe("/ca/products/oak-board");
    expect(collectionPath("kitchen", "ca")).toBe("/ca/collections/kitchen");
    expect(policyPath("shipping", "ca")).toBe("/ca/policies/shipping");
  });

  it("builds the routes the app actually serves", () => {
    expect(productPath("oak-board")).toBe("/us/products/oak-board");
    expect(collectionPath("kitchen")).toBe("/us/collections/kitchen");
    expect(policyPath("returns")).toBe("/us/policies/returns");
  });
});

describe("isIndexablePath", () => {
  it("accepts catalog and site routes", () => {
    for (const path of [
      "/",
      "/us",
      "/us/",
      "/us/store",
      "/us/products/oak-board",
      "/us/collections/kitchen",
      "/us/categories/kitchen?page=2",
      "/us/policies",
      "/us/policies/shipping",
    ]) {
      expect(isIndexablePath(path), path).toBe(true);
    }
  });

  it("rejects every private prefix the plan names", () => {
    for (const prefix of NON_INDEXABLE_PREFIXES) {
      expect(isIndexablePath(prefix), prefix).toBe(false);
      expect(isIndexablePath(`${prefix}/nested/route`), prefix).toBe(false);
      expect(isIndexablePath(`/us${prefix}`), prefix).toBe(false);
      expect(isIndexablePath(`/us${prefix}/nested`), prefix).toBe(false);
    }
  });

  it("rejects the concrete personal routes that exist today", () => {
    for (const path of [
      "/us/cart",
      "/us/checkout",
      "/us/account",
      "/us/account/orders",
      "/us/account/orders/details/order_1",
      "/us/account/login",
      "/us/order/confirmed/order_1",
      "/us/track",
      "/api/analytics/collect",
      "/us/api/anything",
    ]) {
      expect(isIndexablePath(path), path).toBe(false);
    }
  });

  it("is prefix-aware, not substring-aware", () => {
    // "/cartography" must not be caught by the "/cart" rule.
    expect(isIndexablePath("/us/cartography")).toBe(true);
    expect(isIndexablePath("/us/orders-guide")).toBe(true);
    expect(isIndexablePath("/us/tracker")).toBe(true);
    expect(isIndexablePath("/us/accounts")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isIndexablePath("/US/Account/Orders")).toBe(false);
    expect(isIndexablePath("/us/CHECKOUT")).toBe(false);
  });

  it("rejects non-string and empty input instead of guessing", () => {
    expect(isIndexablePath("")).toBe(false);
    expect(isIndexablePath(undefined as unknown as string)).toBe(false);
    expect(isIndexablePath(null as unknown as string)).toBe(false);
  });
});

describe("stripCountryPrefix", () => {
  it("removes the market prefix once", () => {
    expect(stripCountryPrefix("/us/cart")).toBe("/cart");
    expect(stripCountryPrefix("/us")).toBe("/");
    expect(stripCountryPrefix("/ca/checkout")).toBe("/ca/checkout");
    expect(stripCountryPrefix("/usx/checkout")).toBe("/usx/checkout");
  });
});

describe("isSafeHandle", () => {
  it("accepts merchant handles", () => {
    for (const handle of ["oak-board", "kitchen-2", "a", "linen.shirt", "x_y"]) {
      expect(isSafeHandle(handle), handle).toBe(true);
    }
  });

  it("rejects traversal, separators, markup and over-long values", () => {
    for (const handle of [
      "../account/orders",
      "a/b",
      "a?b=1",
      "a#b",
      "a%2e%2e",
      "a b",
      "-leading",
      ".leading",
      "",
      "a".repeat(81),
    ]) {
      expect(isSafeHandle(handle), handle).toBe(false);
    }
    expect(isSafeHandle(undefined)).toBe(false);
    expect(isSafeHandle({ handle: "oak" })).toBe(false);
  });

  it("anchors both ends of the pattern", () => {
    expect(HANDLE_PATTERN.test("oak-board")).toBe(true);
    expect(HANDLE_PATTERN.test("oak;board")).toBe(false);
  });
});

describe("indexableStaticRoutes", () => {
  it("localizes every declared static route exactly once", () => {
    const routes = indexableStaticRoutes();
    expect(routes).toHaveLength(INDEXABLE_STATIC_PATHS.length);
    expect(new Set(routes).size).toBe(routes.length);
    for (const route of routes) expect(isIndexablePath(route)).toBe(true);
    expect(routes).toContain("/us");
    expect(routes).toContain("/us/store");
  });
});

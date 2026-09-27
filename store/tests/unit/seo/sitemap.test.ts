import { describe, expect, it } from "vitest";

/**
 * Task 19, Step 2 (unit) — sitemap entry construction.
 *
 * The catalog is untrusted input here: the tests assert that hostile handles and
 * any route that fails the indexability rule are dropped, that duplicates are
 * removed, and that the whole thing is capped.
 */

import { MAX_SITEMAP_URLS, buildSitemapEntries } from "@/lib/seo/sitemap";
import { availablePolicySlugs } from "@/lib/brand/policies";

const ORIGIN = "https://shop.example";

describe("buildSitemapEntries", () => {
  it("emits localized, absolute static routes and policy pages", () => {
    const { entries, excluded } = buildSitemapEntries({
      origin: ORIGIN,
      source: { policySlugs: ["shipping", "returns", "privacy", "terms"] },
    });

    expect(excluded).toEqual([]);
    const urls = entries.map((entry) => entry.url);
    for (const url of urls) expect(url.startsWith(`${ORIGIN}/us`)).toBe(true);
    expect(urls).toContain(`${ORIGIN}/us`);
    expect(urls).toContain(`${ORIGIN}/us/store`);
    expect(urls).toContain(`${ORIGIN}/us/policies`);
    expect(urls).toContain(`${ORIGIN}/us/policies/shipping`);
    expect(urls).toContain(`${ORIGIN}/us/policies/returns`);
    expect(urls).toContain(`${ORIGIN}/us/policies/privacy`);
    expect(urls).toContain(`${ORIGIN}/us/policies/terms`);
  });

  it("advertises every policy that exists, and no policy that does not", () => {
    // Task 21: the sitemap must follow lib/brand/policies.ts, so a new policy
    // cannot ship without being discoverable — and a removed one cannot linger.
    const { entries } = buildSitemapEntries({
      origin: ORIGIN,
      source: { policySlugs: availablePolicySlugs },
    });
    const urls = entries.map((entry) => entry.url);
    for (const slug of availablePolicySlugs) {
      expect(urls).toContain(`${ORIGIN}/us/policies/${slug}`);
    }
    const advertised = urls
      .filter((url) => /\/policies\/.+/.test(url))
      .map((url) => url.replace(`${ORIGIN}/us/policies/`, ""));
    expect(advertised.sort()).toEqual([...availablePolicySlugs].sort());
  });

  it("includes product and collection routes", () => {
    const { entries } = buildSitemapEntries({
      origin: ORIGIN,
      source: { productHandles: ["oak-board"], collectionHandles: ["kitchen"] },
    });
    const urls = entries.map((entry) => entry.url);
    expect(urls).toContain(`${ORIGIN}/us/products/oak-board`);
    expect(urls).toContain(`${ORIGIN}/us/collections/kitchen`);
  });

  it("keeps private and internal routes out, and reports them", () => {
    const { entries, excluded } = buildSitemapEntries({
      origin: ORIGIN,
      source: {
        productHandles: ["../account/orders", "cart", "ok-handle"],
        collectionHandles: ["../checkout"],
        policySlugs: ["../../account"],
      },
    });
    const urls = entries.map((entry) => entry.url);
    expect(urls).toContain(`${ORIGIN}/us/products/ok-handle`);
    expect(urls.some((url) => url.includes("account"))).toBe(false);
    expect(urls.some((url) => url.includes("checkout"))).toBe(false);
    expect(urls.some((url) => url.includes(".."))).toBe(false);
    // Rejected candidates are reported rather than silently vanishing.
    expect(excluded.length).toBeGreaterThanOrEqual(3);
  });

  it("drops unsafe handles before they can become paths", () => {
    const { entries } = buildSitemapEntries({
      origin: ORIGIN,
      source: {
        productHandles: ["a b", "a/b", "a?b=1", "a%2e%2e", "", "a".repeat(81), 42, null],
      },
    });
    expect(entries.map((entry) => entry.url)).toEqual([
      `${ORIGIN}/us`,
      `${ORIGIN}/us/store`,
      `${ORIGIN}/us/policies`,
    ]);
  });

  it("deduplicates repeated handles and static overlap", () => {
    const { entries } = buildSitemapEntries({
      origin: ORIGIN,
      source: { productHandles: ["oak-board", "oak-board"], policySlugs: ["shipping", "shipping"] },
    });
    const urls = entries.map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("works without an origin (relative paths) instead of inventing a host", () => {
    const { entries } = buildSitemapEntries({ origin: null, source: { productHandles: ["oak-board"] } });
    const urls = entries.map((entry) => entry.url);
    expect(urls.every((url) => url.startsWith("/us"))).toBe(true);
  });

  it("rejects a non-http origin", () => {
    const { entries } = buildSitemapEntries({ origin: "javascript:alert(1)" });
    expect(entries.every((entry) => entry.url.startsWith("/us"))).toBe(true);
  });

  it("caps the number of URLs", () => {
    const handles = Array.from({ length: MAX_SITEMAP_URLS + 50 }, (_, i) => `product-${i}`);
    const { entries, truncated } = buildSitemapEntries({
      origin: ORIGIN,
      source: { productHandles: handles },
    });
    expect(entries).toHaveLength(MAX_SITEMAP_URLS);
    expect(truncated).toBe(handles.length + 3 - MAX_SITEMAP_URLS);
  });

  it("omits lastModified unless the caller can state it", () => {
    expect(buildSitemapEntries({ origin: ORIGIN }).entries[0].lastModified).toBeUndefined();
    const stamped = buildSitemapEntries({ origin: ORIGIN, lastModified: new Date(0) });
    expect(stamped.entries[0].lastModified).toBeInstanceOf(Date);
  });

  it("ignores non-array source values", () => {
    const { entries, excluded } = buildSitemapEntries({
      origin: ORIGIN,
      source: {
        productHandles: "oak-board" as unknown,
        collectionHandles: { handle: "kitchen" } as unknown,
        policySlugs: null,
      },
    });
    expect(excluded).toEqual([]);
    expect(entries).toHaveLength(3);
  });
});

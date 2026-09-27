import { describe, expect, it } from "vitest";

/**
 * Task 19, Step 2 (unit) — robots directives.
 *
 * The rule that keeps this honest: nothing the sitemap advertises may be
 * disallowed, and every private prefix must be disallowed.
 */

import { SITEMAP_PATH, buildRobots, robotsDisallowRules } from "@/lib/seo/robots";
import { NON_INDEXABLE_PREFIXES, isIndexablePath } from "@/lib/seo/routes";
import { buildSitemapEntries } from "@/lib/seo/sitemap";

const ORIGIN = "https://shop.example";

describe("buildRobots", () => {
  it("allows crawling and disallows exactly the private prefixes", () => {
    const robots = buildRobots({ origin: ORIGIN });
    const rules = Array.isArray(robots.rules) ? robots.rules : [robots.rules];
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ userAgent: "*", allow: "/" });
    expect(rules[0].disallow).toEqual([...NON_INDEXABLE_PREFIXES]);
  });

  it("points at the absolute sitemap for the served host", () => {
    expect(buildRobots({ origin: ORIGIN }).sitemap).toBe(`${ORIGIN}${SITEMAP_PATH}`);
    expect(buildRobots({ origin: `${ORIGIN}/` }).sitemap).toBe(`${ORIGIN}${SITEMAP_PATH}`);
    expect(buildRobots({ origin: "not a url" }).sitemap).toBeUndefined();
  });

  it("omits sitemap and host rather than publishing a relative or bogus one", () => {
    const robots = buildRobots({ origin: null });
    expect(robots.sitemap).toBeUndefined();
    expect(robots.host).toBeUndefined();
  });

  it("never disallows a route the sitemap advertises", () => {
    const disallowed = robotsDisallowRules();
    const { entries } = buildSitemapEntries({
      origin: ORIGIN,
      source: {
        productHandles: ["oak-board"],
        collectionHandles: ["kitchen"],
        policySlugs: ["shipping", "returns", "privacy", "terms"],
      },
    });
    for (const entry of entries) {
      const path = new URL(entry.url).pathname.toLowerCase();
      expect(isIndexablePath(path), path).toBe(true);
      for (const rule of disallowed) {
        expect(path === rule || path.startsWith(`${rule}/`), `${path} vs ${rule}`).toBe(false);
      }
    }
  });
});

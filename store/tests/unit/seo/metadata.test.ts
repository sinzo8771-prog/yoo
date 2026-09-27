import { describe, expect, it } from "vitest";

/**
 * Task 19, Step 1 (unit) — metadata helpers.
 *
 * Assertions cover the template, the plain-text bounding, canonical/OG URL
 * rules (including a hostile or malformed origin) and the `noindex` contract
 * for private pages.
 */

import type { Metadata } from "next";

import {
  MAX_DESCRIPTION_LENGTH,
  MAX_OG_IMAGES,
  MAX_TITLE_LENGTH,
  SITE_NAME,
  buildMetadata,
  buildPrivateMetadata,
  formatDescription,
  formatTitle,
} from "@/lib/seo/metadata";
import { site } from "@/lib/brand/site";

const ORIGIN = "https://shop.example";

/**
 * `Metadata["twitter"]` is a union (summary card vs. large-image card), so the
 * `card` field is not directly indexable — read it through a narrow shape.
 */
function twitterCard(metadata: Metadata): string | undefined {
  return (metadata.twitter as { card?: string } | undefined)?.card;
}

describe("formatTitle", () => {
  it("appends the site name once", () => {
    expect(formatTitle("Oak Serving Board")).toBe(`Oak Serving Board | ${SITE_NAME}`);
  });

  it("never repeats the site name", () => {
    expect(formatTitle(SITE_NAME)).toBe(SITE_NAME);
    expect(formatTitle(site.name.toLowerCase())).toBe(SITE_NAME);
    expect(formatTitle(`  ${SITE_NAME}  `)).toBe(SITE_NAME);
  });

  it("falls back to the site name when there is no title", () => {
    expect(formatTitle(null)).toBe(SITE_NAME);
    expect(formatTitle(undefined)).toBe(SITE_NAME);
    expect(formatTitle("   ")).toBe(SITE_NAME);
  });

  it("collapses whitespace and bounds the length", () => {
    expect(formatTitle("Oak\n  Serving   Board")).toBe(
      `Oak Serving Board | ${SITE_NAME}`
    );
    const long = formatTitle("x".repeat(500));
    expect(long.startsWith("x".repeat(MAX_TITLE_LENGTH))).toBe(true);
    expect(long.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH + SITE_NAME.length + 3);
  });
});

describe("formatDescription", () => {
  it("omits an absent description rather than inventing one", () => {
    expect(formatDescription(undefined)).toBeUndefined();
    expect(formatDescription(null)).toBeUndefined();
    expect(formatDescription("   ")).toBeUndefined();
  });

  it("collapses whitespace", () => {
    expect(formatDescription("Cut from\n one   piece.")).toBe("Cut from one piece.");
  });

  it("bounds the length with an ellipsis", () => {
    const long = formatDescription("y".repeat(1000))!;
    expect(long.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("buildMetadata", () => {
  it("builds the canonical, OG and Twitter tags for an absolute origin", () => {
    const metadata = buildMetadata({
      title: "Oak Serving Board",
      description: "Hand-finished oak",
      path: "/us/products/oak-board",
      origin: ORIGIN,
      images: ["https://cdn.example/oak.webp"],
    });

    expect(metadata.title).toBe(`Oak Serving Board | ${SITE_NAME}`);
    expect(metadata.alternates?.canonical).toBe(`${ORIGIN}/us/products/oak-board`);
    expect(metadata.openGraph?.title).toBe(`Oak Serving Board | ${SITE_NAME}`);
    expect(metadata.openGraph?.siteName).toBe(SITE_NAME);
    expect(metadata.openGraph?.images).toEqual(["https://cdn.example/oak.webp"]);
    expect(twitterCard(metadata)).toBe("summary_large_image");
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });

  it("omits canonical and image tags when no origin is configured", () => {
    const metadata = buildMetadata({
      title: "Oak Serving Board",
      path: "/us/products/oak-board",
      origin: null,
    });
    expect(metadata.alternates).toBeUndefined();
    expect(metadata.openGraph?.images).toBeUndefined();
    expect(metadata.openGraph?.url).toBeUndefined();
    expect(twitterCard(metadata)).toBe("summary");
  });

  it("refuses to publish a malformed origin", () => {
    for (const origin of [
      "javascript:alert(1)",
      "not a url",
      "//evil.example",
      "ftp://example.com",
      "https://user:pass@example.com",
      "",
    ]) {
      const metadata = buildMetadata({ title: "T", path: "/us", origin });
      expect(metadata.alternates, origin).toBeUndefined();
    }
  });

  it("drops unsafe image values and caps the count", () => {
    const metadata = buildMetadata({
      title: "T",
      origin: ORIGIN,
      images: [
        "javascript:alert(1)",
        "//evil.example/x.png",
        "data:image/svg+xml,<svg/>",
        ...Array.from({ length: MAX_OG_IMAGES + 3 }, (_, i) => `https://cdn.example/${i}.webp`),
      ],
    });
    const images = metadata.openGraph?.images as string[];
    expect(images).toHaveLength(MAX_OG_IMAGES);
    for (const image of images) expect(image.startsWith("https://cdn.example/")).toBe(true);
  });

  it("resolves catalog-relative images against the origin", () => {
    const metadata = buildMetadata({ title: "T", origin: ORIGIN, images: ["/media/oak.webp"] });
    expect(metadata.openGraph?.images).toEqual([`${ORIGIN}/media/oak.webp`]);
  });

  it("omits an empty description instead of a blank tag", () => {
    const metadata = buildMetadata({ title: "T", description: "  " });
    expect(metadata.description).toBeUndefined();
    expect(metadata.openGraph?.description).toBeUndefined();
  });

  it("honours noIndex", () => {
    const metadata = buildMetadata({ title: "Cart", noIndex: true });
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe("buildPrivateMetadata", () => {
  it("marks the page noindex and keeps the site-name template", () => {
    const metadata = buildPrivateMetadata("Your cart");
    expect(metadata.title).toBe(`Your cart | ${SITE_NAME}`);
    expect(metadata.robots).toEqual({ index: false, follow: false });
    // A private page must not advertise a canonical URL of its own.
    expect(metadata.alternates).toBeUndefined();
  });
});

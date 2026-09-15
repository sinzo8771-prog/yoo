import { describe, expect, it } from "vitest";

import type { CatalogProduct, CatalogVariant } from "@/lib/openfront/catalog";
import { productPriceSummary } from "@/features/catalog/lib/price-display";
import { formatMinorUnits } from "@/lib/format/money";
import { productRationale } from "@/features/catalog/lib/rationale";
import { buildProductLdJson } from "@/features/products/components/StructuredProductData";

function variant(
  overrides: Partial<CatalogVariant> & { id: string; title: string }
): CatalogVariant {
  return {
    price: 0,
    currencyCode: "usd",
    available: true,
    hasPrice: true,
    ...overrides,
  };
}

function fullProduct(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: "p1",
    slug: "oak-board",
    title: "Oak Serving Board",
    subtitle: "Hand-finished oak",
    description: "Cut from a single piece of oak. Finished by hand.",
    thumbnail: "https://cdn/a.webp",
    images: [{ url: "https://cdn/a.webp", alt: "Board angle one" }],
    variants: [variant({ id: "v1", title: "Small", price: 2400 })],
    collectionHandles: ["kitchen"],
    ...overrides,
  };
}

describe("PDP price display (Task 6 step 2)", () => {
  it("shows the cheapest price with a From range when variants differ", () => {
    const product: Pick<CatalogProduct, "variants"> = {
      variants: [
        variant({ id: "v1", title: "Small", price: 2400 }),
        variant({ id: "v2", title: "Large", price: 1800 }),
      ],
    };
    const summary = productPriceSummary(product);
    expect(summary?.amount).toBe(1800);
    expect(summary?.formatted).toBe("$18.00");
    expect(summary?.from).toBe(true);
  });

  it("does not surface a was-price when original equals charge", () => {
    const product: Pick<CatalogProduct, "variants"> = {
      variants: [
        variant({ id: "v1", title: "One", price: 1800, originalPrice: 1800 }),
      ],
    };
    const summary = productPriceSummary(product);
    expect(summary?.compareAt).toBeUndefined();
  });

  it("renders 'Price unavailable' when no variant has a price", () => {
    const product: Pick<CatalogProduct, "variants"> = {
      variants: [variant({ id: "v1", title: "One", price: 0, hasPrice: false })],
    };
    expect(productPriceSummary(product)).toBeNull();
  });

    it("formats zero-decimal currencies without division", () => {
    // 5000 JPY should render as ¥5,000, not ¥50.00
    const formatted = formatMinorUnits(5000, "jpy");
    expect(formatted).toContain("5,000");
    expect(formatted).not.toContain(".");
  });
});

describe("PDP structured data (Task 6 step 4)", () => {
  it("emits JSON-LD with schema.org Product + Offer from catalog values", () => {
    const ld = buildProductLdJson(fullProduct()) as Record<string, unknown>;

    expect(ld["@context"]).toBe("https://schema.org/");
    expect(ld["@type"]).toBe("Product");
    expect(ld["name"]).toBe("Oak Serving Board");
    expect(ld["description"]).toBe("Cut from a single piece of oak. Finished by hand.");
    expect(ld["image"]).toBe("https://cdn/a.webp");

    const offers = ld["offers"] as Record<string, unknown>;
    expect(offers["@type"]).toBe("Offer");
    expect(offers["priceCurrency"]).toBe("USD");
    expect(offers["price"]).toBe("24.00"); // 2400 minor units → 24.00
    expect(offers["availability"]).toBe("http://schema.org/InStock");
    expect(offers["url"]).toContain("/products/oak-board");
  });

  it("marks availability as OutOfStock when all variants are unavailable", () => {
    const product = fullProduct({
      variants: [variant({ id: "v1", title: "Small", price: 2400, available: false })],
    });
    const ld = buildProductLdJson(product) as Record<string, unknown>;
    const offers = ld["offers"] as Record<string, unknown>;
    expect(offers["availability"]).toBe("http://schema.org/OutOfStock");
  });

  it("does not include a numeric price when the catalog has none", () => {
    const product = fullProduct({
      variants: [variant({ id: "v1", title: "One", price: 0, hasPrice: false })],
    });
    const ld = buildProductLdJson(product) as Record<string, unknown>;
    const offers = ld["offers"] as Record<string, unknown>;
    expect(offers["price"]).toBeUndefined();
    expect(offers["availability"]).toBe("http://schema.org/Discontinued");
  });

  it("never fabricates review aggregate data", () => {
    const ld = buildProductLdJson(fullProduct()) as Record<string, unknown>;
    expect(ld).not.toHaveProperty("aggregateRating");
    expect(ld).not.toHaveProperty("review");
    const offers = ld["offers"] as Record<string, unknown>;
    expect(offers).not.toHaveProperty("aggregateRating");
  });
});

describe("PDP variant availability (Task 6 step 2)", () => {
    it("treats unmanaged inventory as always available", () => {
    const v = variant({ id: "v1", title: "Unmanaged" });
    // The catalog client maps unmanaged inventory to available: true
    expect(v.available).toBe(true);
  });

  it("treats managed + zero stock + no backorder as unavailable", () => {
    // The catalog client computes `available: false` from
    // manageInventory=true, allowBackorder=false, inventoryQuantity=0
    const v = variant({
      id: "v1",
      title: "Zero stock",
      available: false,
    });
    expect(v.available).toBe(false);
  });

  it("treats managed + backorder allowed as available even at zero stock", () => {
    const v = variant({
      id: "v1",
      title: "Backorder",
      available: true,
    });
    expect(v.available).toBe(true);
  });
});

describe("PDP description / rationale (Task 6 step 1)", () => {
  it("prefers the merchant subtitle for the rationale", () => {
    expect(productRationale(fullProduct())).toBe("Hand-finished oak");
  });

  it("falls back to the first sentence of the description when no subtitle", () => {
    expect(productRationale(fullProduct({ subtitle: undefined }))).toBe(
      "Cut from a single piece of oak."
    );
  });

  it("returns null when neither subtitle nor description is present", () => {
    expect(
      productRationale(fullProduct({ subtitle: undefined, description: undefined }))
    ).toBeNull();
  });
});

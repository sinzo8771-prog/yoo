import { describe, expect, it } from "vitest";

import type { CatalogProduct } from "@/lib/openfront/catalog";
import { productPriceSummary } from "@/features/catalog/lib/price-display";

function productWithPrices(
  prices: Array<{ price: number; hasPrice: boolean; originalPrice?: number }>
): Pick<CatalogProduct, "variants"> {
  return {
    variants: prices.map((p, i) => ({
      id: `v${i}`,
      title: `Variant ${i}`,
      price: p.price,
      originalPrice: p.originalPrice,
      currencyCode: "usd",
      available: true,
      hasPrice: p.hasPrice,
    })),
  };
}

describe("productPriceSummary", () => {
  it("returns the cheapest variant and a From range when prices disagree", () => {
    const summary = productPriceSummary(
      productWithPrices([
        { price: 2100, hasPrice: true },
        { price: 1800, hasPrice: true },
      ])
    );
    expect(summary?.amount).toBe(1800);
    expect(summary?.formatted).toBe("$18.00");
    expect(summary?.from).toBe(true);
  });

  it("has no From range when all priced variants agree", () => {
    const summary = productPriceSummary(
      productWithPrices([
        { price: 2400, hasPrice: true },
        { price: 2400, hasPrice: true },
      ])
    );
    expect(summary?.from).toBe(false);
  });

  it("ignores variants without price data (never renders $0.00 for missing data)", () => {
    const summary = productPriceSummary(
      productWithPrices([
        { price: 0, hasPrice: false },
        { price: 2400, hasPrice: true },
      ])
    );
    expect(summary?.amount).toBe(2400);
  });

  it("returns null when no variant has usable price data", () => {
    expect(
      productPriceSummary(productWithPrices([{ price: 0, hasPrice: false }]))
    ).toBeNull();
  });

  it("surfaces a was-price only when strictly above the charge price", () => {
    const discounted = productPriceSummary(
      productWithPrices([{ price: 1800, hasPrice: true, originalPrice: 2200 }])
    );
    expect(discounted?.compareAt?.formatted).toBe("$22.00");

    const equal = productPriceSummary(
      productWithPrices([{ price: 1800, hasPrice: true, originalPrice: 1800 }])
    );
    expect(equal?.compareAt).toBeUndefined();
  });
});
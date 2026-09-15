/**
 * Price presentation for catalog surfaces (Task 5, step 2: "use actual product
 * images and backend prices").
 *
 * Rules that keep the display honest:
 *  - Variants Openfront returned no price for are ignored entirely, so we never
 *    render "$0.00" for missing data.
 *  - When priced variants disagree we render a "From …" range rather than
 *    implying a single price for the whole product.
 *  - A "was" price is only surfaced when it is strictly above the charge price
 *    (the catalog client already enforces that, and we re-check here).
 */
import type { CatalogProduct, CatalogVariant } from "@/lib/openfront/catalog";
import { formatMinorUnits } from "@/lib/format/money";
import { site } from "@/lib/brand/site";

export type PriceSummary = {
  /** Charge price in minor units. */
  amount: number;
  currencyCode: string;
  /** Localized string for `amount`. */
  formatted: string;
  /** True when priced variants have more than one distinct price. */
  from: boolean;
  /** Present only when strictly above `amount`. */
  compareAt?: { amount: number; formatted: string };
};

function pricedVariants(variants: CatalogVariant[]): CatalogVariant[] {
  return variants.filter((v) => v.hasPrice);
}

/** Cheapest priced variant, or `null` when the product has no usable price. */
export function cheapestPricedVariant(
  variants: CatalogVariant[]
): CatalogVariant | null {
  const priced = pricedVariants(variants);
  if (priced.length === 0) return null;
  return priced.reduce((cheapest, v) => (v.price < cheapest.price ? v : cheapest));
}

/** Summary for a product card / PDP, or `null` when no price data exists. */
export function productPriceSummary(
  product: Pick<CatalogProduct, "variants">
): PriceSummary | null {
  const priced = pricedVariants(product.variants ?? []);
  const cheapest = cheapestPricedVariant(priced);
  if (!cheapest) return null;

  // Variants are already filtered to the market currency by the catalog client;
  // fall back to the configured market so a missing code still formats.
  const currencyCode = cheapest.currencyCode || site.market.currency;
  const formatted = formatMinorUnits(cheapest.price, currencyCode);
  if (formatted == null) return null;

  const distinctPrices = new Set(priced.map((v) => v.price));

  const originalPrice = cheapest.originalPrice;
  const compareAt =
    originalPrice != null && originalPrice > cheapest.price
      ? {
          amount: originalPrice,
          formatted: formatMinorUnits(originalPrice, currencyCode) ?? "",
        }
      : undefined;

  return {
    amount: cheapest.price,
    currencyCode,
    formatted,
    from: distinctPrices.size > 1,
    ...(compareAt ? { compareAt } : {}),
  };
}
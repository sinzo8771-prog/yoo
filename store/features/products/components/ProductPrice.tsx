/**
 * Price display on the PDP (Task 6, step 2).
 *
 * Delegates to the Task 5 `productPriceSummary` module so the PDP and product
 * cards share the exact same pricing rules. Renders nothing invented: when the
 * catalog has no usable price we say so explicitly.
 */
import type { CatalogProduct } from "@/lib/openfront/catalog";
import { productPriceSummary } from "@/features/catalog/lib/price-display";
import { formatMinorUnits } from "@/lib/format/money";
import { site } from "@/lib/brand/site";

export function ProductPrice({ product }: { product: CatalogProduct }) {
  const summary = productPriceSummary(product);
  const currencyCode = summary?.currencyCode ?? site.market.currency.toLowerCase();

  if (!summary) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="price-unavailable">
        Price unavailable
      </p>
    );
  }

  const formattedOriginal = summary.compareAt
    ? formatMinorUnits(summary.compareAt.amount, currencyCode) ?? ""
    : null;

  return (
    <div className="flex items-baseline gap-3" data-testid="product-price">
      <span className="text-2xl font-medium text-foreground">
        {summary.from ? `From ${summary.formatted}` : summary.formatted}
      </span>
      {formattedOriginal ? (
        <span className="text-sm text-muted-foreground line-through">
          {formattedOriginal}
        </span>
      ) : null}
    </div>
  );
}

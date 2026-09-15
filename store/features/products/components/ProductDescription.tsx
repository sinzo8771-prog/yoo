/**
 * Product description (Task 6, step 1).
 *
 * Renders the plain-text description from the catalog record. The raw
 * Keystone `descriptionDocument` is available if a future task wants rich
 * rendering, but we keep it honest: only show what the merchant authored.
 */
import type { CatalogProduct } from "@/lib/openfront/catalog";
import { productRationale } from "@/features/catalog/lib/rationale";

export function ProductDescription({
  product,
}: {
  product: CatalogProduct;
}) {
  const rationale = productRationale(product);
  const description = product.description;

  if (!description && !rationale) {
    return null;
  }

  return (
    <div className="prose prose-sm max-w-none" data-testid="product-description">
      {rationale ? (
        <p className="text-sm text-muted-foreground">{rationale}</p>
      ) : null}
      {description ? (
        <p className="mt-3 text-sm text-foreground leading-relaxed">{description}</p>
      ) : null}
    </div>
  );
}

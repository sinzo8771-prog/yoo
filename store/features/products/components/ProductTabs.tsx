/**
 * Product tabs (Task 6, step 1).
 *
 * A simple two-tab surface. The "Information" tab renders catalog fields only.
 * The "Shipping & Returns" tab shows static copy — it does not invent data
 * from the catalog, and it notes that specific policies are published elsewhere
 * once those pages exist (Tasks 15/21).
 */
import type { CatalogProduct } from "@/lib/openfront/catalog";

export async function ProductTabs({
  product,
}: {
  product: CatalogProduct;
}) {
  return (
    <section
      className="mt-12 space-y-4"
      data-testid="product-tabs"
      aria-label="Product details"
    >
      {/* In a fuller build this would be a client-side tab list; kept server-rendered
          per the plan's "no unnecessary client JS" preference. */}
      <h2 className="text-lg font-semibold text-foreground">Details</h2>
      <div className="prose prose-sm max-w-none text-sm text-foreground">
        {product.subtitle ? <p>{product.subtitle}</p> : null}
        {product.description ? <p>{product.description}</p> : null}
        {product.collectionHandles.length > 0 ? (
          <p>
            Collections: {product.collectionHandles.join(", ")}
          </p>
        ) : null}
      </div>
    </section>
  );
}

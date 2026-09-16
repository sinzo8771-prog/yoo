/**
 * Product Detail Page (Task 6).
 *
 * This screen consumes the Task 4 catalog client (`getProductBySlug`) and the
 * Task 5 price/rationale/money modules — it does NOT use the reference
 * storefront's `getProductByHandle`/`StoreProduct`/`StoreRegion` data path,
 * which is tied to a different GraphQL schema and a region join we do not need
 * for a read-only PDP. Prices/availability come from the memoized catalog read
 * in the same request that checkout ultimately uses.
 *
 * Contract enforced by tests (tests/unit/products/product-detail.test.ts):
 *  - 404 (via `notFound`) when the catalog has no product for the slug.
 *  - Never emits a fake price: `ProductPrice` renders "Price unavailable" when
 *    `productPriceSummary` returns null.
 *  - Structured data is built only from authoritative catalog values; no review
 *    aggregate data is fabricated.
 */
import { notFound } from "next/navigation";

import { getProductBySlug } from "@/lib/openfront/catalog";
import { ProductGallery } from "../components/ProductGallery";
import { ProductPrice } from "../components/ProductPrice";
import { VariantSelector } from "../components/VariantSelector";
import { AddToCartForm } from "../components/AddToCartForm";
import { ProductDescription } from "../components/ProductDescription";
import { StructuredProductData } from "../components/StructuredProductData";
import { ProductTabs } from "../components/ProductTabs";
import { site } from "@/lib/brand/site";

export interface ProductDetailScreenProps {
  handle: string;
  /** Region from the `[countryCode]` route segment. */
  countryCode: string;
}

export default async function ProductDetailScreen({
  handle,
  countryCode,
}: ProductDetailScreenProps) {
  const product = await getProductBySlug(handle);
  if (!product) {
    notFound();
  }

  const defaultVariant = product.variants[0] ?? null;

  return (
    <article
      className={site.containerClass + " py-8"}
      data-testid="product-detail"
    >
      <StructuredProductData product={product} />

      <div className="grid grid-cols-1 gap-x-8 gap-y-10 lg:grid-cols-2">
        <ProductGallery product={product} selectedVariant={defaultVariant} />

        <div className="flex flex-col gap-y-6">
          {product.collectionHandles.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              {product.collectionHandles.join(", ")}
            </p>
          ) : null}

          <h1 className="text-2xl font-medium tracking-tight text-foreground">
            {product.title}
          </h1>

          <ProductPrice product={product} />

          <VariantSelector
            product={product}
            defaultVariantId={defaultVariant?.id ?? undefined}
          />

          <AddToCartForm product={product} countryCode={countryCode} />

          <ProductDescription product={product} />
        </div>
      </div>

      <ProductTabs product={product} />
    </article>
  );
}

export { ProductDetailScreen };



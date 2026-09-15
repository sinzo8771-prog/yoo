import LocalizedClientLink from "@/features/storefront/modules/common/components/localized-client-link";
import { productPriceSummary } from "@/features/catalog/lib/price-display";
import { productRationale } from "@/features/catalog/lib/rationale";
import type { CatalogProduct } from "@/lib/openfront/catalog";
import { site } from "@/lib/brand/site";

/**
 * FeaturedCollection (Task 5, steps 2 + 3).
 *
 * Curated, not exhaustive: `limit` defaults to 4 so the home page reads as a
 * selection rather than a wall of products.
 *
 * Every piece of information on a card comes from the catalog record:
 *  - image from `productImages`, with a neutral placeholder when the merchant
 *    has not uploaded one (no broken-image icons);
 *  - price from the real variant prices, via `productPriceSummary`;
 *  - rationale from `productRationale` (merchant subtitle → description), never
 *    invented copy.
 */
export default function FeaturedCollection({
  products,
  heading = "Selected pieces",
  limit = 4,
  viewAllHref = "/store",
}: {
  products: CatalogProduct[];
  heading?: string;
  limit?: number;
  viewAllHref?: string;
}) {
  const curated = products.slice(0, limit);
  if (curated.length === 0) return null;

  return (
    <section
      aria-labelledby="featured-heading"
      className={`${site.containerClass} py-14 sm:py-20`}
    >
      <div className="mb-8 flex items-end justify-between gap-4">
        <h2
          id="featured-heading"
          className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
        >
          {heading}
        </h2>
        <LocalizedClientLink
          href={viewAllHref}
          className="shrink-0 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          View all
        </LocalizedClientLink>
      </div>

      <ul className="grid grid-cols-2 gap-x-4 gap-y-8 lg:grid-cols-4">
        {curated.map((product) => (
          <li key={product.id}>
            <FeaturedProductCard product={product} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function FeaturedProductCard({ product }: { product: CatalogProduct }) {
  const rationale = productRationale(product);
  const price = productPriceSummary(product);
  const image = product.images[0];
  // Truthful availability signal: only claim unavailability when we are sure.
  const soldOut =
    product.variants.length > 0 && product.variants.every((v) => !v.available);

  return (
    <article className="group flex h-full flex-col">
      <LocalizedClientLink
        href={`/products/${product.slug}`}
        className="flex h-full flex-col"
        aria-label={product.title}
      >
        <div className="relative aspect-square w-full overflow-hidden rounded-md border border-border bg-secondary">
          {image ? (
            /* Plain <img>: the app's next/image allowlist only covers the
               configured S3 endpoint, so optimization is handled in Task 20. */
            <img
              src={image.url}
              alt={image.alt ?? ""}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex h-full w-full items-center justify-center bg-muted"
            >
              <span className="text-[0.6875rem] uppercase tracking-[0.14em] text-muted-foreground">
                No image
              </span>
            </div>
          )}
          {soldOut ? (
            <span className="absolute left-2 top-2 rounded-sm bg-background/95 px-2 py-1 text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Unavailable
            </span>
          ) : null}
        </div>

        <h3 className="mt-3 text-sm font-medium leading-5 text-foreground group-hover:underline group-hover:underline-offset-4">
          {product.title}
        </h3>

        {rationale ? (
          <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-5 text-muted-foreground">
            {rationale}
          </p>
        ) : null}

        <div className="mt-2 flex items-baseline gap-2">
          {price ? (
            <>
              <span className="text-sm font-medium text-foreground">
                {price.from ? `From ${price.formatted}` : price.formatted}
              </span>
              {price.compareAt ? (
                <span className="text-[0.8125rem] text-muted-foreground line-through">
                  {price.compareAt.formatted}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-[0.8125rem] text-muted-foreground">
              Price unavailable
            </span>
          )}
        </div>
      </LocalizedClientLink>
    </article>
  );
}
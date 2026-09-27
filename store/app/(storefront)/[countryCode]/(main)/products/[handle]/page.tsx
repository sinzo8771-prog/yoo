import { ProductDetailScreen } from "@/features/products/screens/ProductDetailScreen";
import { TrackEvent } from "@/components/analytics/TrackEvent";
import { getBaseUrl } from "@/features/storefront/lib/getBaseUrl";
import { getProductBySlug } from "@/lib/openfront/catalog";
import { buildMetadata } from "@/lib/seo/metadata";
import { productPath } from "@/lib/seo/routes";
import type { Metadata } from "next";

/**
 * Task 19, Step 1 — product metadata from catalog values only: merchant title
 * and subtitle as the description, the real images as Open Graph images, and a
 * canonical URL built from the shared route helper (never hand-written here).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ countryCode: string; handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const product = await getProductBySlug(handle);
  if (!product) {
    // A missing product is a 404 page — keep it out of the index.
    return { title: "Product not found", robots: { index: false, follow: false } };
  }

  return buildMetadata({
    title: product.title,
    description: product.subtitle ?? product.description ?? null,
    path: productPath(product.slug),
    origin: process.env.NEXT_PUBLIC_SITE_URL ?? (await getBaseUrl()),
    images: product.images.map((image) => image.url),
  });
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ countryCode: string; handle: string }>;
}) {
  const { countryCode, handle } = await params;
  // Same memoised read as `generateMetadata` — a cache hit, not a second
  // round trip — so the funnel event can carry the real product identifiers.
  const product = await getProductBySlug(handle);

  return (
    <>
      {product ? (
        <TrackEvent
          event="view_product"
          props={{ productId: product.id, productHandle: product.slug }}
        />
      ) : null}
      <ProductDetailScreen handle={handle} countryCode={countryCode} />
    </>
  );
}


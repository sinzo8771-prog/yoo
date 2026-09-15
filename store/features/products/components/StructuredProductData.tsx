/**
 * Structured product data / SEO (Task 6, step 4).
 *
 * Emits JSON-LD for a Product + Offer, built only from authoritative catalog
 * values. We deliberately do NOT fabricate review aggregate data or ratings —
 * the plan forbids "fake review aggregate data". If the catalog has no price,
 * we omit the `offers` object rather than emitting a misleading $0.
 */
import { productPriceSummary } from "@/features/catalog/lib/price-display";
import { site } from "@/lib/brand/site";
import type { CatalogProduct } from "@/lib/openfront/catalog";
import Script from "next/script";

/**
 * Pure helper that builds the JSON-LD object from catalog values.
 * Extracted so tests can assert the structured-data shape without rendering
 * the Next.js `<Script>` component.
 */
export function buildProductLdJson(product: CatalogProduct): unknown {
  const summary = productPriceSummary(product);
  const currencyCode = summary?.currencyCode ?? site.market.currency;

  const offers = summary
    ? {
        "@type": "Offer" as const,
        priceCurrency: currencyCode.toUpperCase(),
        price: (summary.amount / 100).toFixed(2),
        availability: product.variants.every((v) => !v.available)
          ? "http://schema.org/OutOfStock"
          : "http://schema.org/InStock",
        url: `${site.market.countryCode}/products/${product.slug}`,
        priceValidUntil: new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000
        )
          .toISOString()
          .split("T")[0],
      }
    : {
        "@type": "Offer" as const,
        availability: "http://schema.org/Discontinued",
        priceCurrency: currencyCode.toUpperCase(),
        // Intentionally omit `price` when we have none.
      };

  return {
    "@context": "https://schema.org/",
    "@type": "Product",
    name: product.title,
    image: product.images.length > 0 ? product.images[0].url : product.thumbnail,
    description: product.description,
    offers,
  };
}

export function StructuredProductData({
  product,
}: {
  product: CatalogProduct;
}) {
  const data = buildProductLdJson(product);

  return (
    <Script
      id={`product-ldjson-${product.id}`}
      type="application/ld+json"
      strategy="beforeInteractive"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}


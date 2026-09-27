/**
 * Task 19, Step 2 — the sitemap route.
 *
 * `force-dynamic` because the origin is resolved per request (`NEXT_PUBLIC_SITE_URL`
 * first, then the incoming host) — a sitemap must list the host it is served
 * from. A catalog outage degrades the sitemap to its static, policy and
 * homepage entries instead of failing the route: a partial sitemap is better
 * than a 500 for a crawler, and the failure is logged.
 */

import type { MetadataRoute } from "next";

import { availablePolicySlugs } from "@/lib/brand/policies";
import { listIndexableCatalog } from "@/lib/openfront/catalog";
import { buildSitemapEntries, type SitemapSource } from "@/lib/seo/sitemap";
import { resolveOrigin } from "@/lib/seo/urls";
import { getBaseUrl } from "@/features/storefront/lib/getBaseUrl";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = resolveOrigin(
    process.env.NEXT_PUBLIC_SITE_URL,
    await getBaseUrl()
  );

  const source: SitemapSource = { policySlugs: availablePolicySlugs };
  try {
    const index = await listIndexableCatalog();
    source.productHandles = index.productHandles;
    source.collectionHandles = index.collectionHandles;
  } catch (error) {
    console.error("Sitemap: catalog unavailable, emitting static routes only", error);
  }

  return buildSitemapEntries({ origin, source }).entries;
}

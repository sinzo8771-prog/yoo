/**
 * Task 19, Step 2 — robots.txt.
 *
 * Kept in sync with the sitemap and with each page's `noindex` metadata by
 * reading the same `NON_INDEXABLE_PREFIXES` list (see `lib/seo/routes.ts`).
 * No crawl-delay is emitted: throttling crawlers is a hosting/CDN concern, and
 * a made-up delay would just be noise.
 */

import type { MetadataRoute } from "next";

import { buildRobots } from "@/lib/seo/robots";
import { resolveOrigin } from "@/lib/seo/urls";
import { getBaseUrl } from "@/features/storefront/lib/getBaseUrl";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = resolveOrigin(
    process.env.NEXT_PUBLIC_SITE_URL,
    await getBaseUrl()
  );
  return buildRobots({ origin });
}

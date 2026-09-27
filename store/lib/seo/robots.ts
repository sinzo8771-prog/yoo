/**
 * Task 19, Step 2 — robots directives (pure, so it is testable).
 *
 * `robots.txt` is a crawler *request*, not an access control. It is written to
 * agree with the sitemap and with each page's own `noindex` directive:
 * everything under the private prefixes is disallowed here *and* marked
 * `noindex` in the document, and nothing that the sitemap advertises is
 * disallowed. Static asset paths (`/_next/`, images) are deliberately allowed —
 * crawlers need them to render a page before judging it.
 */

import type { MetadataRoute } from "next";

import { NON_INDEXABLE_PREFIXES } from "./routes";
import { absoluteUrl, normalizeOrigin } from "./urls";

export const SITEMAP_PATH = "/sitemap.xml";

/** Disallow rules derived from the single indexability source of truth. */
export function robotsDisallowRules(): string[] {
  return [...NON_INDEXABLE_PREFIXES];
}

export function buildRobots(input: {
  origin?: string | null;
  sitemapPath?: string;
}): MetadataRoute.Robots {
  const { sitemapPath = SITEMAP_PATH } = input;
  // Normalize first: a malformed origin must produce no sitemap/host at all,
  // never a relative `/sitemap.xml` that a crawler would resolve against
  // whatever host it happened to fetch.
  const origin = normalizeOrigin(input.origin);
  const sitemap = origin ? absoluteUrl(sitemapPath, origin) : undefined;

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: robotsDisallowRules(),
      },
    ],
    ...(sitemap ? { sitemap } : {}),
    // `host` is a bare origin (no path), which is exactly what `origin` is.
    ...(origin ? { host: origin } : {}),
  };
}

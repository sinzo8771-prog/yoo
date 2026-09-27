/**
 * Task 19, Step 2 — sitemap entry construction (pure, so it is testable).
 *
 * Only indexable catalog routes are emitted. Catalog handles arrive as
 * untrusted strings, so each one is validated (`isSafeHandle`) *and* the
 * resulting path is re-checked against `isIndexablePath` before it can enter the
 * sitemap: a handle of `../account/orders` is dropped rather than advertised to
 * crawlers. Static routes, policies that exist, products and collections are
 * deduped and capped.
 */

import type { MetadataRoute } from "next";

import {
  collectionPath,
  indexableStaticRoutes,
  isIndexablePath,
  isSafeHandle,
  policyPath,
  productPath,
} from "./routes";
import { absoluteUrl } from "./urls";

/** Hard cap so an unbounded catalog cannot produce an unbounded sitemap. */
export const MAX_SITEMAP_URLS = 5000;

export type SitemapSource = {
  productHandles?: unknown;
  collectionHandles?: unknown;
  policySlugs?: unknown;
};

export type SitemapBuild = {
  entries: MetadataRoute.Sitemap;
  /** Candidate paths rejected as non-indexable or unsafe (for tests/ops). */
  excluded: string[];
  /** Entries dropped because `MAX_SITEMAP_URLS` was reached. */
  truncated: number;
};

type ChangeFrequency = NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;

type Candidate = { path: string; changeFrequency: ChangeFrequency };

/** Longest offending value we echo back into `excluded` (for ops/debugging). */
const MAX_EXCLUDED_ECHO = 80;

function handleList(value: unknown, excluded: string[]): string[] {
  if (!Array.isArray(value)) return [];
  const safe: string[] = [];
  for (const candidate of value) {
    if (isSafeHandle(candidate)) {
      safe.push(candidate);
      continue;
    }
    // Reported, not silently dropped: an unsafe catalog handle is a data
    // problem someone should see in the sitemap's own diagnostics.
    if (typeof candidate === "string") {
      excluded.push(`(unsafe) ${candidate.slice(0, MAX_EXCLUDED_ECHO)}`);
    }
  }
  return safe;
}

function stripCountry(path: string): string {
  return path.replace(/^\/[a-z]{2}(?=\/|$)/i, "") || "/";
}

export function buildSitemapEntries(input: {
  origin?: string | null;
  countryCode?: string;
  source?: SitemapSource;
  /** Only passed when the caller can state it honestly. */
  lastModified?: Date | string | null;
}): SitemapBuild {
  const { origin, countryCode, source = {}, lastModified } = input;

  const excluded: string[] = [];
  const candidates: Candidate[] = [
    ...indexableStaticRoutes(countryCode).map((path) => ({
      path,
      changeFrequency: "weekly" as ChangeFrequency,
    })),
    ...handleList(source.collectionHandles, excluded).map((handle) => ({
      path: collectionPath(handle, countryCode),
      changeFrequency: "daily" as ChangeFrequency,
    })),
    ...handleList(source.productHandles, excluded).map((handle) => ({
      path: productPath(handle, countryCode),
      changeFrequency: "daily" as ChangeFrequency,
    })),
    ...handleList(source.policySlugs, excluded).map((slug) => ({
      path: policyPath(slug, countryCode),
      changeFrequency: "monthly" as ChangeFrequency,
    })),
  ];

  const seen = new Set<string>();
  const entries: MetadataRoute.Sitemap = [];
  let truncated = 0;

  for (const candidate of candidates) {
    if (!isIndexablePath(stripCountry(candidate.path))) {
      excluded.push(candidate.path);
      continue;
    }
    const url = absoluteUrl(candidate.path, origin);
    if (seen.has(url)) continue;
    if (entries.length >= MAX_SITEMAP_URLS) {
      truncated += 1;
      continue;
    }
    seen.add(url);
    entries.push({
      url,
      changeFrequency: candidate.changeFrequency,
      ...(lastModified ? { lastModified } : {}),
    });
  }

  return { entries, excluded, truncated };
}

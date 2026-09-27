/**
 * Task 19, Step 1 — page metadata built from real values.
 *
 * Every page goes through here so title/description/canonical/OG cannot drift
 * apart: the title template, the plain-text bounding and the absolute-URL rules
 * live in one place, and nothing is invented. A page with no description gets
 * *no* description tag rather than boilerplate copy repeated across the site —
 * duplicate boilerplate is worse for a crawler than an absent tag.
 */

import type { Metadata } from "next";

import { site } from "@/lib/brand/site";
import { absoluteAssetUrl, absoluteUrl, isAbsoluteHttpUrl } from "./urls";

export const SITE_NAME = site.name;

/** Titles past this length are truncated by search engines anyway. */
export const MAX_TITLE_LENGTH = 120;

/** Meta descriptions are clipped to roughly one SERP snippet. */
export const MAX_DESCRIPTION_LENGTH = 300;

/** At most this many OG images are emitted from catalog data. */
export const MAX_OG_IMAGES = 4;

/**
 * `Title | Site name`, or the bare site name when there is no page title or the
 * title already *is* the site name (never `Northwind Goods | Northwind Goods`).
 */
export function formatTitle(title?: string | null): string {
  const trimmed =
    typeof title === "string" ? title.replace(/\s+/g, " ").trim() : "";
  if (trimmed.length === 0) return SITE_NAME;
  const bounded =
    trimmed.length > MAX_TITLE_LENGTH
      ? trimmed.slice(0, MAX_TITLE_LENGTH).trimEnd()
      : trimmed;
  if (bounded.toLowerCase() === SITE_NAME.toLowerCase()) return SITE_NAME;
  return `${bounded} | ${SITE_NAME}`;
}

/** Collapse whitespace, bound the length, and never emit an empty string. */
export function formatDescription(
  description?: string | null
): string | undefined {
  if (typeof description !== "string") return undefined;
  const collapsed = description.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return undefined;
  if (collapsed.length <= MAX_DESCRIPTION_LENGTH) return collapsed;
  return `${collapsed.slice(0, MAX_DESCRIPTION_LENGTH - 1).trimEnd()}…`;
}

export type MetadataInput = {
  title?: string | null;
  description?: string | null;
  /** Route path (country-prefixed), used for the canonical and `og:url`. */
  path?: string | null;
  origin?: string | null;
  images?: Array<string | null | undefined>;
  type?: "website" | "article";
  /** Personal/transactional pages are marked noindex, never hidden silently. */
  noIndex?: boolean;
};

/**
 * Build page metadata. Canonical and image URLs are only written when they can
 * be made absolute, so a misconfigured origin omits the tag instead of
 * publishing a wrong one.
 */
export function buildMetadata(input: MetadataInput): Metadata {
  const title = formatTitle(input.title);
  const description = formatDescription(input.description);
  // A canonical is only emitted when it is truly absolute: with no origin (or a
  // malformed one) `absoluteUrl` returns the bare path, and publishing that as a
  // canonical would invite a crawler to resolve it against the wrong host.
  const canonicalCandidate = input.path
    ? absoluteUrl(input.path, input.origin)
    : undefined;
  const canonical =
    canonicalCandidate && isAbsoluteHttpUrl(canonicalCandidate)
      ? canonicalCandidate
      : undefined;

  const images = (input.images ?? [])
    .map((image) => absoluteAssetUrl(image, input.origin))
    .filter((image): image is string => typeof image === "string")
    .slice(0, MAX_OG_IMAGES);

  const openGraph: Metadata["openGraph"] = {
    type: input.type ?? "website",
    title,
    siteName: SITE_NAME,
    ...(description ? { description } : {}),
    ...(canonical ? { url: canonical } : {}),
    ...(images.length > 0 ? { images } : {}),
  };

  return {
    title,
    ...(description ? { description } : {}),
    ...(canonical ? { alternates: { canonical } } : {}),
    openGraph,
    twitter: {
      card: images.length > 0 ? "summary_large_image" : "summary",
      title,
      ...(description ? { description } : {}),
      ...(images.length > 0 ? { images } : {}),
    },
    robots: input.noIndex
      ? { index: false, follow: false }
      : { index: true, follow: true },
  };
}

/**
 * Metadata for cart, checkout, account, order and tracking pages.
 *
 * The plan's SEO target requires "no accidental indexing of account/admin
 * routes"; `robots.txt` is a request, not a guarantee, so these pages also send
 * an explicit `noindex` directive in the document itself.
 */
export function buildPrivateMetadata(title: string): Metadata {
  return {
    title: formatTitle(title),
    robots: { index: false, follow: false },
  };
}

/**
 * Task 19, Step 1 — origin/URL helpers shared by metadata, sitemap and robots.
 *
 * Pure and dependency-free, so the same logic that runs in a crawlable route is
 * the logic under test. One rule matters more than the rest: a URL is made
 * absolute *only* when the configured origin is a real `http(s)` origin.
 * A malformed `NEXT_PUBLIC_SITE_URL` therefore degrades to a relative path —
 * visibly wrong in a crawler report — instead of silently producing a
 * `javascript:` or protocol-relative `//evil.example` canonical that a search
 * engine would happily index and attribute to the wrong site.
 */

/** Longest origin/asset URL we will consider (mirrors the SSRF guard's bound). */
export const MAX_URL_LENGTH = 2048;

/**
 * Reduce a configured value to a bare `http(s)` origin, or null.
 * Paths, queries, fragments and credentials are dropped rather than reused:
 * a site origin must never carry a path into route helpers.
 */
export function normalizeOrigin(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  if (parsed.hostname.length === 0) return null;
  return parsed.origin;
}

/** First candidate that normalizes to a usable origin. */
export function resolveOrigin(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const candidate of candidates) {
    const origin = normalizeOrigin(candidate);
    if (origin) return origin;
  }
  return null;
}

/** True only for absolute `http(s)` URLs. */
export function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Resolve `path` against an origin. When no usable origin is available the path
 * is returned unchanged (never guesses a host from a header-less context).
 */
export function absoluteUrl(path: string, origin?: string | null): string {
  const base = normalizeOrigin(origin);
  if (!base) return path;
  try {
    return new URL(path, base).toString();
  } catch {
    return path;
  }
}

/**
 * Absolute URL for an image/thumbnail that came from the catalog.
 * Rejects anything that is not `http(s)`: `data:`, `javascript:` and
 * protocol-relative `//host` values are dropped rather than emitted into
 * Open Graph tags, where a wrong value is visible to every link preview.
 */
export function absoluteAssetUrl(
  value: string | null | undefined,
  origin?: string | null
): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) return undefined;
  if (isAbsoluteHttpUrl(trimmed)) return trimmed;
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return undefined;
  return absoluteUrl(trimmed, origin);
}

/**
 * Task 19, Steps 1 + 2 — canonical route vocabulary for the single-market
 * storefront (`/us/...`), plus the indexability rule the sitemap, robots and
 * page metadata all share.
 *
 * Keeping this in one module is deliberate: the sitemap must never advertise a
 * route that `isIndexablePath` rejects, and a page must never emit a canonical
 * URL that the sitemap disagrees with. Both read from here.
 */

import { site } from "@/lib/brand/site";

/** Fixed for v1 (see DROPSHIPPING-AGENT-PLAN.md §1.1). */
export const MARKET_COUNTRY_CODE: string = site.market.countryCode;

/**
 * Path prefixes a crawler must never index, expressed *without* the country
 * prefix so the rule reads the same as the plan: account, cart, checkout,
 * order confirmation/detail, guest tracking and the API surface.
 */
export const NON_INDEXABLE_PREFIXES = [
  "/account",
  "/cart",
  "/checkout",
  "/order",
  "/track",
  "/api",
] as const;

/** Static storefront routes that always exist and are safe to index. */
export const INDEXABLE_STATIC_PATHS = ["/", "/store", "/policies"] as const;

/** Country prefix first, exactly as the app routes are laid out. */
export function localizedPath(
  path: string,
  countryCode: string = MARKET_COUNTRY_CODE
): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized === "/") return `/${countryCode}`;
  return `/${countryCode}${normalized}`;
}

export function productPath(
  handle: string,
  countryCode: string = MARKET_COUNTRY_CODE
): string {
  return localizedPath(`/products/${handle}`, countryCode);
}

export function collectionPath(
  handle: string,
  countryCode: string = MARKET_COUNTRY_CODE
): string {
  return localizedPath(`/collections/${handle}`, countryCode);
}

export function policyPath(
  slug: string,
  countryCode: string = MARKET_COUNTRY_CODE
): string {
  return localizedPath(`/policies/${slug}`, countryCode);
}

/**
 * Handles/slugs we are willing to place in a canonical URL, a sitemap entry or
 * a structured-data `url`. Catalog values are untrusted input: a handle such as
 * `../account/orders` or `x?y=` must be rejected rather than concatenated into
 * a route, where it could point a crawler at a private page.
 */
export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/i;

export function isSafeHandle(value: unknown): value is string {
  return typeof value === "string" && HANDLE_PATTERN.test(value);
}

/**
 * Strip the country prefix (`/us/cart` -> `/cart`) so indexability is decided
 * on the route, not on how the visitor arrived at it. Case-insensitive: `/US/...`
 * is the same route as `/us/...` to every HTTP router.
 */
export function stripCountryPrefix(pathname: string): string {
  const withSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const lowered = withSlash.toLowerCase();
  const prefix = `/${MARKET_COUNTRY_CODE.toLowerCase()}`;
  if (lowered === prefix) return "/";
  if (lowered.startsWith(`${prefix}/`)) {
    return withSlash.slice(prefix.length);
  }
  return withSlash;
}

/**
 * Whether a path may be indexed. Case-insensitive and country-prefix agnostic,
 * so `/us/Account/Orders`, `/account/orders` and `/us/account` all agree.
 */
export function isIndexablePath(pathname: string): boolean {
  if (typeof pathname !== "string" || pathname.length === 0) return false;
  // Lowercase BEFORE stripping: `/US/account` must match the `/account` rule.
  const route = stripCountryPrefix(pathname.toLowerCase()).toLowerCase();
  return !NON_INDEXABLE_PREFIXES.some(
    (prefix) => route === prefix || route.startsWith(`${prefix}/`)
  );
}

/** Localized static routes, for the sitemap and cross-checking tests. */
export function indexableStaticRoutes(
  countryCode: string = MARKET_COUNTRY_CODE
): string[] {
  return INDEXABLE_STATIC_PATHS.map((path) => localizedPath(path, countryCode));
}

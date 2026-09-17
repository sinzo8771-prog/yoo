/**
 * Task 9, Step 3 — locked internal redirect targets.
 *
 * Every client-side redirect after checkout is built here from server-side
 * data only. `buildOrderConfirmationPath` composes the fixed confirmation
 * route and refuses to build a path from malformed country codes, order IDs,
 * or guest secret keys; `assertSafeInternalPath` rejects anything that is not
 * a plain same-origin absolute path, so a hostile value can never turn the
 * confirmation redirect into an open redirect.
 */

/** iso2 country codes, always lowercased before use. */
const ISO2_COUNTRY = /^[a-z]{2}$/;

/** Openfront entity IDs (cuid-style) and guest secret keys (64-char hex). */
const SAFE_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Build the confirmation path for a completed order, or return null when any
 * input is malformed. `secretKey` is only present for guest checkouts.
 */
export function buildOrderConfirmationPath(
  countryCode: string | null | undefined,
  orderId: string,
  secretKey?: string | null
): string | null {
  // iso2 codes are validated lowercase, exactly as they appear in URLs.
  const country =
    typeof countryCode === "string" ? countryCode.toLowerCase() : null;
  if (!country || !ISO2_COUNTRY.test(country)) return null;
  if (!orderId || !SAFE_TOKEN.test(orderId)) return null;
  if (secretKey != null && secretKey !== "" && !SAFE_TOKEN.test(secretKey)) {
    return null;
  }

  const base = `/${country}/order/confirmed/${encodeURIComponent(orderId)}`;
  return secretKey ? `${base}?secretKey=${encodeURIComponent(secretKey)}` : base;
}

/**
 * Accept only plain same-origin absolute paths ("/foo", never "//host",
 * "https://…", or backslash forms). Used by client redirect consumers as a
 * final gate before router.push.
 */
export function assertSafeInternalPath(path: string | null | undefined): string {
  if (
    !path ||
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("://") ||
    path.includes("\\")
  ) {
    throw new Error("Unsafe redirect target");
  }
  return path;
}

/**
 * Task 18 — security response headers.
 *
 * Applied by the storefront middleware to every matched (HTML) response, so the
 * values live here as data that unit tests can assert without booting Next.
 *
 * Why each header, and why no CSP yet:
 *  - `X-Content-Type-Options: nosniff` — stops MIME confusion turned into script
 *    execution by uploaded/streamed content.
 *  - `X-Frame-Options: DENY` — clickjacking. Nothing in the storefront is meant
 *    to be framed by third parties; Stripe and PayPal render *their* iframes,
 *    they never frame us.
 *  - `Referrer-Policy: strict-origin-when-cross-origin` — keeps cart/order
 *    paths and query strings out of third-party referrers.
 *  - `Permissions-Policy: camera=(), microphone=(), geolocation=()` — the
 *    storefront needs none of these. `payment=()` is deliberately NOT set:
 *    disabling the Payment Request API would break wallets (Apple Pay).
 *  - `Strict-Transport-Security` — browsers ignore HSTS received over plain
 *    HTTP, so shipping it unconditionally is safe in development and protects
 *    production from downgrade. `preload` is intentionally omitted (removal
 *    from the preload list is slow and we do not need it).
 *  - `X-Permitted-Cross-Domain-Policies: none` — legacy Flash/PDF policy file
 *    loading, free to disable.
 *
 * A nonce-based Content-Security-Policy is the documented follow-up: Next.js
 * inlines bootstrap scripts, so a real CSP needs a per-request nonce threaded
 * through the document, not a static header here.
 */

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Permitted-Cross-Domain-Policies": "none",
};

/**
 * Set every security header on a response. Existing values are overwritten so a
 * mismatched upstream value cannot weaken the response.
 */
export function applySecurityHeaders<T extends { set(name: string, value: string): unknown }>(
  headers: T
): T {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return headers;
}

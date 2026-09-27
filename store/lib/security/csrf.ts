/**
 * Task 18 — explicit CSRF gate for server-action POSTs.
 *
 * Next.js already rejects server-action POSTs whose `Origin` does not match the
 * request host, but that protection is implicit and only in the framework. This
 * module makes the rule ours, explicit and testable, and lets the middleware
 * reject a request *before* any work happens:
 *
 *  - only `POST` can change state via a server action; other methods pass,
 *  - requests without the `Next-Action` header are not server actions and are
 *    left to the framework's own routing (they still pass the rate limiter),
 *  - a server action must present at least one trustworthy browser signal:
 *    `Sec-Fetch-Site: same-origin`, or an `Origin` whose host matches the
 *    request host (or `x-forwarded-host` behind a proxy),
 *  - `Origin: null` (sandboxed iframe, `data:` document) is refused,
 *  - `Sec-Fetch-Site: cross-site` / `same-site` is refused even when `Origin`
 *    matches nothing we trust.
 *
 * Cookie policy that this gate complements: the session cookie is
 * `httpOnly` + `SameSite=Lax` + `Secure` in production, and cart mutations
 * additionally require the HMAC cart proof, which a cross-site form cannot
 * forge (Task 9).
 */

/** Fetch metadata values a state-changing server action may legitimately use. */
export const TRUSTED_FETCH_SITES: readonly string[] = ["same-origin"];

export type ActionRequestHeaders = {
  method?: string | null;
  /** `Next-Action` header: presence marks a Next.js server-action POST. */
  nextAction?: string | null;
  origin?: string | null;
  host?: string | null;
  forwardedHost?: string | null;
  secFetchSite?: string | null;
};

/** Lowercase, trim, and keep only the first entry of a comma-separated value. */
function normalizeHost(value: string | null | undefined): string | null {
  const first = String(value ?? "").split(",")[0]?.trim().toLowerCase();
  return first ? first : null;
}

/**
 * True when the request may proceed. Fails closed: an action POST with no
 * trustworthy signal at all is rejected rather than assumed same-origin.
 */
export function isTrustedActionRequest(input: ActionRequestHeaders): boolean {
  const method = String(input.method ?? "GET").toUpperCase();
  if (method !== "POST") return true;
  if (!input.nextAction) return true;

  const fetchSite = String(input.secFetchSite ?? "").trim().toLowerCase();
  if (fetchSite && !TRUSTED_FETCH_SITES.includes(fetchSite)) return false;

  const rawOrigin = input.origin?.trim();
  if (!rawOrigin) {
    // No Origin: accept only when the browser told us it was same-origin.
    return fetchSite === "same-origin";
  }

  let origin: URL;
  try {
    origin = new URL(rawOrigin);
  } catch {
    return false;
  }
  if (origin.protocol !== "http:" && origin.protocol !== "https:") return false;

  const expected = [normalizeHost(input.host), normalizeHost(input.forwardedHost)].filter(
    (host): host is string => Boolean(host)
  );
  if (expected.length === 0) return false;
  return expected.includes(origin.host.toLowerCase());
}

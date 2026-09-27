/**
 * Task 18 — outbound-URL guard for operator-configurable provider endpoints.
 *
 * Provider base URLs are configuration, not code: OpenShip stores
 * `platform.baseUrl` in the database and the CJ adapter also reads
 * `CJ_API_BASE` from the server environment. A mis-set or hostile value turns
 * our server into a request proxy (SSRF), so the URL is checked immediately
 * before *every* outbound call rather than once at configuration time:
 *
 *  - scheme allowlist — `https:` only, plus `http:` when private hosts are
 *    explicitly enabled for local development,
 *  - no embedded credentials (`https://user:pass@host/…`),
 *  - host must be a public DNS name or public IP literal; loopback, private,
 *    link-local (incl. cloud metadata), CGNAT, reserved, single-label and
 *    `.local`/`.internal` hosts are refused,
 *  - IPv4 special forms (`http://2130706433/`, `0177.0.0.1`, `0x7f.1`) are
 *    normalized by the WHATWG URL parser *before* the check, so they cannot
 *    smuggle a loopback address past it.
 *
 * Deliberately NOT defended here — see `docs/security/threat-model.md` §SSRF:
 * DNS rebinding after the check (that needs resolve-then-connect pinning).
 * Provider hosts we ship are fixed and provider configuration is admin-only.
 */

/** Why a URL was refused. Closed vocabulary so logs never carry the URL itself. */
export type UrlRejectionReason =
  | "not_a_string"
  | "too_long"
  | "invalid_url"
  | "protocol_not_allowed"
  | "embedded_credentials"
  | "private_host"
  | "single_label_host";

export type UrlCheckResult =
  | { ok: true; url: URL }
  | { ok: false; reason: UrlRejectionReason; host?: string };

/** Longest URL we will even attempt to parse. */
export const MAX_URL_LENGTH = 2048;

/** Default scheme allowlist: providers are always called over TLS. */
export const DEFAULT_ALLOWED_PROTOCOLS = ["https:"] as const;

/** Host suffixes that can never be a public provider. */
const PRIVATE_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
] as const;

export class ProviderUrlError extends Error {
  readonly reason: UrlRejectionReason;
  readonly host: string | undefined;

  constructor(reason: UrlRejectionReason, host?: string) {
    super(`Refusing outbound provider URL (${reason}${host ? `: ${host}` : ""})`);
    this.name = "ProviderUrlError";
    this.reason = reason;
    this.host = host;
  }
}

/**
 * Lowercase, strip the brackets the URL parser keeps for IPv6 literals, and
 * strip trailing dots so `localhost.` cannot bypass the suffix checks.
 */
export function normalizeHostname(rawHostname: string): string {
  let host = String(rawHostname ?? "").trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  while (host.endsWith(".")) host = host.slice(0, -1);
  return host;
}

/** True for loopback/private/link-local/CGNAT/reserved IPv4 literals. */
export function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/** True for loopback/unique-local/link-local/IPv4-mapped IPv6 literals. */
export function isPrivateIpv6(host: string): boolean {
  if (!host.includes(":")) return false;
  if (host === "::" || host === "::1") return true;
  const mapped = host.match(/^::ffff:(.+)$/);
  if (mapped) {
    const tail = mapped[1];
    // Hex-encoded tails (::ffff:7f00:1) are treated as private; only a dotted
    // quad that is itself public is allowed through the mapped form.
    if (!tail.includes(".")) return true;
    return isPrivateIpv4(tail);
  }
  if (/^f[cd][0-9a-f]{0,2}:/.test(host)) return true; // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]?:/.test(host)) return true; // fe80::/10 link-local
  return false;
}

/** True when the hostname must not be dialed unless private hosts are allowed. */
export function isPrivateHostname(rawHostname: string): boolean {
  const host = normalizeHostname(rawHostname);
  if (!host) return true;
  if (host === "localhost") return true;
  if (PRIVATE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (isPrivateIpv4(host)) return true;
  if (isPrivateIpv6(host)) return true;
  return false;
}

/**
 * Validate one outbound URL. Returns a discriminated result instead of throwing
 * so callers can log the reason without a try/catch.
 */
export function checkOutboundUrl(
  raw: unknown,
  options: { allowPrivate?: boolean; allowedProtocols?: readonly string[] } = {}
): UrlCheckResult {
  const allowPrivate = options.allowPrivate === true;
  const protocols =
    options.allowedProtocols ??
    (allowPrivate ? (["https:", "http:"] as const) : DEFAULT_ALLOWED_PROTOCOLS);

  if (typeof raw !== "string") return { ok: false, reason: "not_a_string" };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "not_a_string" };
  if (trimmed.length > MAX_URL_LENGTH) return { ok: false, reason: "too_long" };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (!protocols.includes(url.protocol)) {
    return { ok: false, reason: "protocol_not_allowed", host: url.hostname };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "embedded_credentials", host: url.hostname };
  }

  const host = normalizeHostname(url.hostname);
  if (isPrivateHostname(host)) {
    if (allowPrivate) return { ok: true, url };
    return { ok: false, reason: "private_host", host };
  }
  // A public host must be a FQDN or an IP literal; a single-label name resolves
  // through internal search domains and is never a provider endpoint.
  if (!host.includes(".") && !host.includes(":")) {
    if (allowPrivate) return { ok: true, url };
    return { ok: false, reason: "single_label_host", host };
  }
  return { ok: true, url };
}

/** Same as {@link checkOutboundUrl}, but throws {@link ProviderUrlError}. */
export function assertOutboundUrl(
  raw: unknown,
  options: { allowPrivate?: boolean; allowedProtocols?: readonly string[] } = {}
): URL {
  const result = checkOutboundUrl(raw, options);
  if (!result.ok) throw new ProviderUrlError(result.reason, result.host);
  return result.url;
}

/**
 * Local-development escape hatch. Both conditions are required: the explicit
 * `ALLOW_PRIVATE_PROVIDER_URLS=true` opt-in *and* a non-production build, so a
 * stray production environment variable can never re-introduce private targets.
 */
export function providerUrlAllowPrivate(
  env: Record<string, string | undefined> = process.env
): boolean {
  const optedIn =
    String(env.ALLOW_PRIVATE_PROVIDER_URLS ?? "").trim().toLowerCase() === "true";
  const production = String(env.NODE_ENV ?? "").trim().toLowerCase() === "production";
  return optedIn && !production;
}

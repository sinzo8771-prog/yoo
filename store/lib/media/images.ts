/**
 * Task 20, Step 2 — image delivery policy (single source of truth).
 *
 * Every catalog photograph in the storefront is hosted somewhere we do not
 * control: the commerce backend origin (`NEXT_PUBLIC_BACKEND_URL`), the media
 * store (`S3_ENDPOINT`) or — once a supplier feed is connected — a supplier CDN
 * the operator adds to `NEXT_PUBLIC_IMAGE_HOSTS`. All three ask the same
 * question: *may Next's image optimizer fetch from this host?*
 *
 * The answer is computed here once and consumed twice:
 *  - `next.config.ts` turns the parsed hosts into `images.remotePatterns`, which
 *    is the only thing the optimizer will fetch from;
 *  - `components/media/ProductImage.tsx` asks per image whether the optimizer is
 *    usable at all, and falls back to a plain `<img>` when it is not.
 *
 * Rules (covered by tests/unit/media/images.test.ts):
 *  - http/https origins only, never with embedded credentials;
 *  - no wildcard hosts: a `*` hostname would turn `/_next/image` into an open
 *    image proxy (a fetcher anyone can point at anything);
 *  - an env value may carry a path prefix (`https://cdn.example.com/products`),
 *    which becomes a least-privilege path pattern (`/products/**`);
 *  - matching mirrors Next's own `matchRemotePattern` (protocol, port and
 *    hostname compared verbatim, pathname as a glob) and is deliberately never
 *    more permissive than it: a false "optimizable" would show up in production
 *    as a 400 from the optimizer instead of an image.
 */

/** Same shape as a Next `remotePatterns` entry. */
export type ImageRemotePattern = {
  protocol: "http" | "https";
  hostname: string;
  /**
   * Verbatim, exactly like Next compares it: `""` means "URL with no explicit
   * port" (so `https://cdn.example.com` matches and `https://cdn.example.com:8443`
   * does not). We never omit it, so each entry is as narrow as the env value it
   * came from.
   */
  port: string;
  /** Glob, always leading slash: `/**` or `/prefix/**`. */
  pathname: string;
};

/** Env keys that may declare an image host, in precedence order. */
export const IMAGE_HOST_ENV_KEYS = [
  "S3_ENDPOINT",
  "NEXT_PUBLIC_BACKEND_URL",
  "NEXT_PUBLIC_IMAGE_HOSTS",
] as const;

/** A pattern that matches every path on the host (the default). */
export const ANY_PATHNAME = "/**";

/** Longest hostname we accept (DNS allows 253). */
const MAX_HOSTNAME_LENGTH = 253;

/** Anything longer than this is not a host declaration, it is a mistake. */
const MAX_INPUT_LENGTH = 2048;

/**
 * Turn one env value into a pattern.
 *
 * Accepts `cdn.example.com`, `cdn.example.com:8443`, `https://cdn.example.com`
 * and `https://cdn.example.com/products/`. Returns `null` — never a permissive
 * default — for anything else, so a malformed value can only ever *reduce* what
 * the optimizer is allowed to fetch.
 */
export function parseImageHost(raw: unknown): ImageRemotePattern | null {
  if (typeof raw !== "string") return null;

  const value = raw.trim();
  if (value.length === 0 || value.length > MAX_INPUT_LENGTH) return null;
  // Whitespace inside a value means it was not meant as a single host.
  if (/\s/.test(value)) return null;
  // No globs, no `*.` wildcards, no brace expansion.
  if (value.includes("*") || value.includes("{")) return null;

  // Bare hosts get an https scheme so `URL` can parse them; an explicit scheme
  // is preserved so `http://localhost:3000` stays usable in development.
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)
    ? value
    : `https://${value}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username.length > 0 || url.password.length > 0) return null;
  if (url.hostname.length === 0 || url.hostname.length > MAX_HOSTNAME_LENGTH) {
    return null;
  }

  return {
    protocol: url.protocol === "http:" ? "http" : "https",
    hostname: url.hostname.toLowerCase(),
    // `URL` yields `""` when the value has no explicit port.
    port: url.port,
    pathname: toPathPattern(url.pathname),
  };
}

/** `/` and `` become `/**`; `/products/` becomes `/products/**`. */
function toPathPattern(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  if (trimmed.length === 0) return ANY_PATHNAME;
  const normalized = `/${trimmed.replace(/^\/+/, "")}`;
  return `${normalized}/**`;
}

/** Comma-separated value → patterns, skipping anything malformed. */
export function parseImageHostList(raw: unknown): ImageRemotePattern[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((entry) => parseImageHost(entry))
    .filter((entry): entry is ImageRemotePattern => entry !== null);
}

/**
 * Every image host this deployment declares, de-duplicated and in a stable
 * order (env-lookup order, then the order inside `NEXT_PUBLIC_IMAGE_HOSTS`).
 */
export function collectImageHosts(
  env: Record<string, string | undefined> = process.env
): ImageRemotePattern[] {
  const declared: ImageRemotePattern[] = [];
  for (const key of IMAGE_HOST_ENV_KEYS) {
    const value = env[key];
    if (typeof value !== "string" || value.trim().length === 0) continue;
    declared.push(...parseImageHostList(value));
  }

  const seen = new Set<string>();
  const unique: ImageRemotePattern[] = [];
  for (const pattern of declared) {
    const key = `${pattern.protocol}|${pattern.hostname}|${pattern.port}|${pattern.pathname}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(pattern);
  }
  return unique;
}

/** `images.remotePatterns` for `next.config.ts` (copies, so callers cannot mutate). */
export function toRemotePatterns(
  hosts: readonly ImageRemotePattern[]
): ImageRemotePattern[] {
  return hosts.map((host) => ({ ...host }));
}

/**
 * True when `rawUrl` is an absolute URL that an entry of the allowlist covers.
 * Mirrors `matchRemotePattern` for the pattern shapes this module generates.
 */
export function matchesImagePattern(
  rawUrl: unknown,
  patterns: readonly ImageRemotePattern[]
): boolean {
  if (typeof rawUrl !== "string") return false;

  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return false;
  }

  if (url.username.length > 0 || url.password.length > 0) return false;

  const protocol = url.protocol.replace(/:$/, "");
  if (protocol !== "http" && protocol !== "https") return false;
  const hostname = url.hostname.toLowerCase();

  return patterns.some(
    (pattern) =>
      pattern.protocol === protocol &&
      pattern.hostname === hostname &&
      pattern.port === url.port &&
      matchesPathname(pattern.pathname, url.pathname)
  );
}

function matchesPathname(pattern: string, pathname: string): boolean {
  if (pattern === ANY_PATHNAME) return true;
  const prefix = pattern.replace(/\/\*\*$/, "");
  // Stricter than picomatch on the bare-prefix case (`/products` does not match
  // `/products/**`), which is the safe direction: we only claim optimizability
  // for URLs the optimizer will certainly accept.
  return pathname.startsWith(`${prefix}/`);
}

/**
 * Whether Next's optimizer can serve this URL.
 *
 * Same-origin paths (`/images/x.jpg`) are always fine — those are files the
 * deployment itself controls. Everything else must be covered by the allowlist.
 */
export function isOptimizableImageUrl(
  rawUrl: unknown,
  patterns: readonly ImageRemotePattern[] = collectImageHosts()
): boolean {
  if (typeof rawUrl !== "string") return false;

  const value = rawUrl.trim();
  if (value.length === 0) return false;
  // Protocol-relative URLs point at a host we have not allowlisted.
  if (value.startsWith("//")) return false;
  if (value.startsWith("/")) return true;

  return matchesImagePattern(value, patterns);
}

/**
 * Task 18 — fixed-window rate limiting for the storefront's public surface.
 *
 * Two ingress points, both covered by this module:
 *  - Every page GET and page server-action POST. Next.js 16 loads `proxy.ts` as
 *    the ingress entry (`store/proxy.ts`), which delegates every request except
 *    `/api`, `_next/static`, `_next/image` and static asset paths to
 *    `features/storefront/middleware.ts` — so one `guardRequest` call classifies
 *    and limits the whole public surface, and assets keep their cache-friendly
 *    path.
 *  - The storefront's single `/api` route, added in Task 19
 *    (`app/api/analytics/collect/route.ts`). Because `proxy.ts` deliberately
 *    excludes `/api`, that handler consumes its own `analytics` bucket instead of
 *    depending on the middleware.
 *
 * Honest limits of this implementation (see `docs/security/threat-model.md`):
 * state lives in module scope, so it is per-process/per-edge-isolate and resets
 * on deploy. That is enough to stop trivial scripted abuse and credential
 * stuffing from a single address, but a distributed attacker spread across
 * isolates sees `limit × instances`. A shared counter store (KV/Redis) is the
 * documented follow-up.
 *
 * Buckets are deliberately generous: real humans must never hit them, only
 * scripts. `contact` and `webhook` are absent on purpose — the storefront has
 * no contact endpoint (the UI uses `mailto:`) and no webhook route (payment
 * webhooks terminate in Openfront, hardened in Task 16).
 */

/** Public surfaces the plan asks us to limit. */
export type RateBucketName = "actions" | "auth" | "tracking" | "search" | "analytics";

export type RateLimitConfig = { limit: number; windowMs: number };

/** Per-minute budgets per bucket. */
export const RATE_LIMITS: Readonly<Record<RateBucketName, RateLimitConfig>> = {
  /** Every state-changing server action (cart, checkout, account, payment). */
  actions: { limit: 120, windowMs: 60_000 },
  /** Sign-in / register / account pages. */
  auth: { limit: 20, windowMs: 60_000 },
  /** Guest order tracking and confirmation lookups. */
  tracking: { limit: 30, windowMs: 60_000 },
  /** Catalog browse and search. */
  search: { limit: 60, windowMs: 60_000 },
  /**
   * The analytics collector (Task 19). Generous: one visitor produces a handful
   * of events per page view, so this only bites on scripted flooding.
   */
  analytics: { limit: 120, windowMs: 60_000 },
};

export const ALL_RATE_BUCKETS: readonly RateBucketName[] = [
  "actions",
  "analytics",
  "auth",
  "search",
  "tracking",
];

export type RateVerdict = {
  bucket: RateBucketName;
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets; 0 when the request is allowed. */
  retryAfterSeconds: number;
  resetAtMs: number;
};

export type RateLimiter = {
  consume(bucket: RateBucketName, key: string, nowMs?: number): RateVerdict;
  reset(): void;
  size(): number;
};

/**
 * Create an in-memory fixed-window limiter. `maxKeys` bounds memory: an
 * attacker rotating keys must not be able to grow the map without limit, so the
 * oldest key is evicted once the bound is reached.
 */
export function createRateLimiter(options: { maxKeys?: number } = {}): RateLimiter {
  const maxKeys = options.maxKeys ?? 5000;
  const windows = new Map<string, { count: number; resetAtMs: number }>();

  return {
    consume(bucket, key, nowMs = Date.now()) {
      const config = RATE_LIMITS[bucket];
      if (!config) {
        // A bucket missing from RATE_LIMITS is a programming error: fail loud
        // rather than silently leaving the surface unlimited.
        throw new Error(`Unknown rate-limit bucket: ${String(bucket)}`);
      }
      const mapKey = `${bucket}:${String(key)}`;
      const existing = windows.get(mapKey);
      const entry =
        !existing || existing.resetAtMs <= nowMs
          ? { count: 0, resetAtMs: nowMs + config.windowMs }
          : existing;

      entry.count += 1;
      // Re-insert so Map insertion order tracks recency for eviction.
      windows.delete(mapKey);
      windows.set(mapKey, entry);
      while (windows.size > maxKeys) {
        const oldest = windows.keys().next().value;
        if (oldest === undefined) break;
        windows.delete(oldest);
      }

      const allowed = entry.count <= config.limit;
      return {
        bucket,
        allowed,
        limit: config.limit,
        remaining: Math.max(0, config.limit - entry.count),
        retryAfterSeconds: allowed
          ? 0
          : Math.max(1, Math.ceil((entry.resetAtMs - nowMs) / 1000)),
        resetAtMs: entry.resetAtMs,
      };
    },
    reset() {
      windows.clear();
    },
    size() {
      return windows.size;
    },
  };
}

/**
 * Limiter used by the storefront middleware. Module scope by design (see the
 * per-isolate caveat above).
 */
export const edgeRateLimiter: RateLimiter = createRateLimiter();

/**
 * Map one request to a bucket, or null when the surface is not rate limited.
 * Paths may carry a country prefix (`/us/account/orders/123`), so matching is
 * substring-based and ordered most-specific-first.
 */
export function classifyRequest(input: {
  method?: string | null;
  pathname?: string | null;
}): RateBucketName | null {
  const method = String(input.method ?? "GET").toUpperCase();
  if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
    return "actions";
  }
  const pathname = String(input.pathname ?? "").toLowerCase();
  if (pathname.includes("/account/orders")) return "tracking";
  if (pathname.includes("/account")) return "auth";
  if (
    pathname.endsWith("/store") ||
    pathname.includes("/store/") ||
    pathname.includes("/search") ||
    pathname.includes("/categories") ||
    pathname.includes("/collections")
  ) {
    return "search";
  }
  return null;
}

/**
 * Best-effort client identity from proxy headers. Behind a trusted proxy the
 * first `x-forwarded-for` entry is the client; with no proxy header at all every
 * request shares the "unknown" key, which still bounds total traffic per bucket.
 */
export function clientKeyFromHeaders(
  read: (name: string) => string | null | undefined
): string {
  const forwarded = read("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  const realIp = read("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}

/** Response headers describing the limiter state (used by middleware and tests). */
export function rateLimitHeaders(verdict: RateVerdict): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Bucket": verdict.bucket,
    "X-RateLimit-Limit": String(verdict.limit),
    "X-RateLimit-Remaining": String(verdict.remaining),
  };
  if (!verdict.allowed) headers["Retry-After"] = String(verdict.retryAfterSeconds);
  return headers;
}

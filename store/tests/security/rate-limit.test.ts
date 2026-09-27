/**
 * Task 18 — rate limiting for the storefront's public surface.
 *
 * Pins bucket classification (mutations → actions, account → auth,
 * order tracking → tracking, browse/search → search, everything else
 * unlimited), the fixed-window accounting, window reset, retry-after math,
 * per-key and per-bucket independence, the memory bound, and the fail-loud
 * behavior for an unknown bucket.
 */
import { describe, expect, it } from "vitest";

import {
  ALL_RATE_BUCKETS,
  RATE_LIMITS,
  classifyRequest,
  clientKeyFromHeaders,
  createRateLimiter,
  rateLimitHeaders,
  type RateBucketName,
} from "@/lib/security/rate-limit";

describe("classifyRequest", () => {
  it("sends every mutating method to the actions bucket", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      expect(classifyRequest({ method, pathname: "/us" })).toBe("actions");
    }
  });

  it("classifies account, tracking and browse paths", () => {
    expect(classifyRequest({ method: "GET", pathname: "/us/account" })).toBe("auth");
    expect(classifyRequest({ method: "GET", pathname: "/us/account/orders/ord_1" })).toBe(
      "tracking"
    );
    expect(classifyRequest({ method: "GET", pathname: "/us/store" })).toBe("search");
    expect(classifyRequest({ method: "GET", pathname: "/us/collections/summer" })).toBe("search");
    expect(classifyRequest({ method: "GET", pathname: "/us/search?q=mug" })).toBe("search");
  });

  it("leaves unrelated paths unlimited", () => {
    expect(classifyRequest({ method: "GET", pathname: "/us" })).toBeNull();
    expect(classifyRequest({ method: "GET", pathname: "/us/products/mug" })).toBeNull();
    expect(classifyRequest({ method: "GET", pathname: "/us/cart" })).toBeNull();
    expect(classifyRequest({})).toBeNull();
  });

  it("covers exactly the documented buckets", () => {
    // `analytics` was added by Task 19 for the storefront's only `/api` route,
    // which `proxy.ts` excludes from the middleware — so it is limited by its
    // own handler through this same module rather than by `classifyRequest`.
    expect([...ALL_RATE_BUCKETS].sort()).toEqual([
      "actions",
      "analytics",
      "auth",
      "search",
      "tracking",
    ]);
    for (const bucket of ALL_RATE_BUCKETS) {
      expect(RATE_LIMITS[bucket].limit).toBeGreaterThan(0);
      expect(RATE_LIMITS[bucket].windowMs).toBe(60_000);
    }
  });
});

describe("createRateLimiter", () => {
  it("allows exactly the limit then blocks with retry-after and headers", () => {
    const limiter = createRateLimiter();
    const limit = RATE_LIMITS.auth.limit;

    for (let i = 0; i < limit; i += 1) {
      expect(limiter.consume("auth", "203.0.113.9", 1_000).allowed).toBe(true);
    }

    const blocked = limiter.consume("auth", "203.0.113.9", 1_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBe(60);
    expect(rateLimitHeaders(blocked)["Retry-After"]).toBe("60");
  });

  it("reports the remaining budget", () => {
    const limiter = createRateLimiter();
    const first = limiter.consume("search", "203.0.113.9", 0);
    expect(first.remaining).toBe(RATE_LIMITS.search.limit - 1);
    expect(rateLimitHeaders(first)["Retry-After"]).toBeUndefined();
    expect(rateLimitHeaders(first)["X-RateLimit-Bucket"]).toBe("search");
  });

  it("keeps keys and buckets independent", () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < RATE_LIMITS.auth.limit; i += 1) {
      limiter.consume("auth", "10.0.0.1", 0);
    }
    expect(limiter.consume("auth", "10.0.0.1", 0).allowed).toBe(false);
    expect(limiter.consume("auth", "10.0.0.2", 0).allowed).toBe(true);
    expect(limiter.consume("actions", "10.0.0.1", 0).allowed).toBe(true);
  });

  it("resets when the window elapses", () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < RATE_LIMITS.tracking.limit; i += 1) {
      limiter.consume("tracking", "198.51.100.7", 0);
    }
    expect(limiter.consume("tracking", "198.51.100.7", 59_999).allowed).toBe(false);
    expect(limiter.consume("tracking", "198.51.100.7", 60_000).allowed).toBe(true);
  });

  it("derives retry-after from the window end, never below one second", () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < RATE_LIMITS.tracking.limit; i += 1) {
      limiter.consume("tracking", "198.51.100.7", 0);
    }
    expect(limiter.consume("tracking", "198.51.100.7", 30_000).retryAfterSeconds).toBe(30);
    expect(limiter.consume("tracking", "198.51.100.7", 59_999).retryAfterSeconds).toBe(1);
  });

  it("bounds memory by evicting the oldest keys", () => {
    const limiter = createRateLimiter({ maxKeys: 2 });
    limiter.consume("auth", "a", 0);
    limiter.consume("auth", "b", 0);
    limiter.consume("auth", "c", 0);

    expect(limiter.size()).toBe(2);
    // "auth:a" was evicted, so it starts a fresh window.
    expect(limiter.consume("auth", "a", 0).remaining).toBe(RATE_LIMITS.auth.limit - 1);
  });

  it("throws for a bucket that is not configured", () => {
    const limiter = createRateLimiter();
    expect(() => limiter.consume("nope" as RateBucketName, "k")).toThrow(
      /Unknown rate-limit bucket/
    );
  });

  it("can be cleared", () => {
    const limiter = createRateLimiter();
    limiter.consume("auth", "a", 0);
    limiter.reset();
    expect(limiter.size()).toBe(0);
  });
});

describe("clientKeyFromHeaders", () => {
  it("prefers the first x-forwarded-for entry", () => {
    const key = clientKeyFromHeaders((name) =>
      name === "x-forwarded-for" ? "203.0.113.9, 10.0.0.1" : null
    );
    expect(key).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip and then to a shared unknown key", () => {
    expect(
      clientKeyFromHeaders((name) => (name === "x-real-ip" ? " 198.51.100.7 " : null))
    ).toBe("198.51.100.7");
    expect(clientKeyFromHeaders(() => null)).toBe("unknown");
  });
});

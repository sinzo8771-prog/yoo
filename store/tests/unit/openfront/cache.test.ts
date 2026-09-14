import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Task 4 unit tests — lib/openfront/cache.
 * The TTL window is the guard that stops stale pricing/availability from
 * reaching a shopper, so its edge cases are tested directly.
 */
import {
  DEFAULT_CACHE_TTL_MS,
  MAX_CACHE_TTL_MS,
  cacheTtlMs,
  cached,
  clearOpenfrontCache,
  openfrontCacheSize,
} from "@/lib/openfront/cache";

beforeEach(() => {
  clearOpenfrontCache();
  vi.useRealTimers();
});

describe("cacheTtlMs", () => {
  it("defaults when unset or blank", () => {
    expect(cacheTtlMs({})).toBe(DEFAULT_CACHE_TTL_MS);
    expect(cacheTtlMs({ OPENFRONT_CACHE_TTL_MS: "   " })).toBe(
      DEFAULT_CACHE_TTL_MS
    );
  });

  it("accepts a valid override and clamps it to the hard ceiling", () => {
    expect(cacheTtlMs({ OPENFRONT_CACHE_TTL_MS: "5000" })).toBe(5000);
    expect(cacheTtlMs({ OPENFRONT_CACHE_TTL_MS: "999999999" })).toBe(
      MAX_CACHE_TTL_MS
    );
  });

  it("rejects values that would silently break caching", () => {
    expect(cacheTtlMs({ OPENFRONT_CACHE_TTL_MS: "abc" })).toBe(
      DEFAULT_CACHE_TTL_MS
    );
    expect(cacheTtlMs({ OPENFRONT_CACHE_TTL_MS: "-1" })).toBe(
      DEFAULT_CACHE_TTL_MS
    );
    // 0 is meaningful: it disables caching entirely.
    expect(cacheTtlMs({ OPENFRONT_CACHE_TTL_MS: "0" })).toBe(0);
  });
});

describe("cached", () => {
  it("returns the value and calls the loader once per TTL window", async () => {
    const loader = vi.fn().mockResolvedValue("value");
    expect(await cached("k", loader, 1000)).toBe("value");
    expect(await cached("k", loader, 1000)).toBe("value");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("reloads after the TTL expires", async () => {
    const loader = vi.fn().mockResolvedValueOnce("old").mockResolvedValueOnce("new");
    expect(await cached("k", loader, 10)).toBe("old");

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 50);
    expect(await cached("k", loader, 10)).toBe("new");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("bypasses the cache when the TTL is 0", async () => {
    const loader = vi.fn().mockResolvedValue("v");
    await cached("k", loader, 0);
    await cached("k", loader, 0);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(openfrontCacheSize()).toBe(0);
  });

  it("shares one in-flight promise between concurrent callers", async () => {
    const loader = vi.fn(
      () => new Promise<string>((resolve) => setTimeout(() => resolve("v"), 5))
    );
    const results = await Promise.all([
      cached("k", loader, 1000),
      cached("k", loader, 1000),
      cached("k", loader, 1000),
    ]);
    expect(results).toEqual(["v", "v", "v"]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("evicts a failed read so it cannot poison the window", async () => {
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("recovered");

    await expect(cached("k", loader, 1000)).rejects.toThrow("boom");
    expect(openfrontCacheSize()).toBe(0);
    await expect(cached("k", loader, 1000)).resolves.toBe("recovered");
  });

  it("keeps distinct keys independent", async () => {
    const loader = vi.fn((v: string) => Promise.resolve(v));
    await cached("a", () => loader("a"), 1000);
    await cached("b", () => loader("b"), 1000);
    expect(openfrontCacheSize()).toBe(2);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
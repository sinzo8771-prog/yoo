/**
 * Task 4 — TTL cache for server-side Openfront reads.
 *
 * Why not `unstable_cache` / `'use cache'`? Next 16's cache primitives require
 * the experimental `cacheComponents` flag, which would change the build we have
 * already verified, and neither can express the hard product rule that pricing
 * and availability must never be stale long enough to mislead checkout
 * (plan Task 4, Step 3).
 *
 * The function shape (`cached(key, fn, ttl)`) is intentionally the same as the
 * framework primitive, so call sites do not change if we migrate later.
 *
 * Two properties matter here:
 *  - **single-flight**: concurrent identical reads share one in-flight promise,
 *    so a page rendering N sections issues one request, not N.
 *  - **failures are not cached**: a transient network error must not poison the
 *    entry for the whole TTL window.
 */

type Entry = { value: Promise<unknown>; expiresAt: number };

const entries = new Map<string, Entry>();

/** 30s: short enough that a repriced variant cannot mislead a shopper. */
export const DEFAULT_CACHE_TTL_MS = 30_000;

/** Hard ceiling, so a bad env value cannot serve stale prices for hours. */
export const MAX_CACHE_TTL_MS = 300_000;

/**
 * Resolve the TTL from `OPENFRONT_CACHE_TTL_MS`.
 * Invalid/negative values fall back to the default; `0` disables caching.
 */
export function cacheTtlMs(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = env.OPENFRONT_CACHE_TTL_MS?.trim();
  if (!raw) return DEFAULT_CACHE_TTL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_CACHE_TTL_MS;
  return Math.min(parsed, MAX_CACHE_TTL_MS);
}

/** Read through the cache, or call `fn` and memoise it for `ttlMs`. */
export function cached<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs: number = cacheTtlMs()
): Promise<T> {
  if (ttlMs <= 0) return fn();

  const now = Date.now();
  const entry = entries.get(key);
  if (entry && entry.expiresAt > now) return entry.value as Promise<T>;

  const value = fn();
  entries.set(key, { value, expiresAt: now + ttlMs });
  // Drop failed reads immediately — only successful reads earn the TTL.
  void value.catch(() => {
    if (entries.get(key)?.value === value) entries.delete(key);
  });
  return value;
}

/** Test/ops escape hatch: forget every cached read. */
export function clearOpenfrontCache(): void {
  entries.clear();
}

/** Diagnostics: number of live (possibly expired) entries. */
export function openfrontCacheSize(): number {
  return entries.size;
}
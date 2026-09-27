/**
 * Task 19, Step 3 — the analytics ingest pipeline, as a plain function.
 *
 * The route handler (`app/api/analytics/collect/route.ts`) is a three-line
 * adapter over this, which keeps the interesting behaviour — rate limiting,
 * bounded body reads, payload validation, counting, logging — testable in the
 * node test environment without booting Next.js.
 *
 * This route is the storefront's only `/api` path, and Next 16's `proxy.ts`
 * deliberately excludes `/api` from the Task 18 middleware guard, so every
 * control that guard would have applied is applied here instead:
 *  - a dedicated rate-limit bucket, keyed by client address,
 *  - a bounded body read so a hostile POST cannot allocate memory,
 *  - the zod sanitizer (allowlisted props, closed event set),
 *  - a structured log line via the Task 17 logger, never echoing the payload.
 */

import { sanitizeAnalyticsEvent } from "./events";
import { analyticsFunnel, type FunnelAggregator } from "./funnel";
import { logEvent, type LogSink } from "../observability/logger";
import {
  clientKeyFromHeaders,
  createRateLimiter,
  rateLimitHeaders,
  type RateLimiter,
} from "../security/rate-limit";

/** Largest accepted payload; a sanitized envelope is well under 300 bytes. */
export const MAX_COLLECT_BODY_BYTES = 4096;

/** Module-scope limiter: per-instance, same caveat as the middleware's. */
const limiter: RateLimiter = createRateLimiter({ maxKeys: 2000 });

export type CollectResult = {
  status: number;
  headers: Record<string, string>;
};

export type CollectInput = {
  headers: { get(name: string): string | null };
  /** Present for a POST with a body; absent for an empty request. */
  body: ReadableStream<Uint8Array> | null;
};

export type CollectDeps = {
  funnel?: FunnelAggregator;
  limiter?: RateLimiter;
  sink?: LogSink;
};

function headersWith(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extra,
  };
}

/**
 * Read at most `MAX_COLLECT_BODY_BYTES`, streaming so a lying (or absent)
 * `Content-Length` cannot make us buffer an unbounded body.
 * Returns null when the body is too large or the stream fails.
 */
export async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  declaredLength: number,
  limit: number = MAX_COLLECT_BODY_BYTES
): Promise<string | null> {
  if (Number.isFinite(declaredLength) && declaredLength > limit) return null;
  if (!body) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/**
 * Ingest one event. Returns a status and headers only — never a body, so an
 * attacker learns nothing from the response and a rejected payload is never
 * echoed back.
 */
export async function collectAnalyticsEvent(
  input: CollectInput,
  deps: CollectDeps = {}
): Promise<CollectResult> {
  const funnel = deps.funnel ?? analyticsFunnel;
  const activeLimiter = deps.limiter ?? limiter;

  const verdict = activeLimiter.consume(
    "analytics",
    clientKeyFromHeaders((name) => input.headers.get(name))
  );
  const rateHeaders = rateLimitHeaders(verdict);
  if (!verdict.allowed) {
    return { status: 429, headers: headersWith(rateHeaders) };
  }

  const declaredLength = Number(input.headers.get("content-length") ?? "0");
  const body = await readBoundedBody(input.body, declaredLength);
  if (body === null) {
    return { status: 413, headers: headersWith(rateHeaders) };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return { status: 400, headers: headersWith(rateHeaders) };
  }

  const event = sanitizeAnalyticsEvent(raw);
  if (!event) {
    // The rejected payload is never logged or echoed: it is attacker-controlled
    // and could be an attempt to make us persist personal data.
    logEvent(
      { level: "warn", operation: "analytics.event", status: "invalid" },
      deps.sink
    );
    return { status: 400, headers: headersWith(rateHeaders) };
  }

  funnel.record({ event: event.event, props: event.props });
  logEvent(
    {
      operation: "analytics.event",
      status: event.event,
      fields: { ...event.props, ...(event.path ? { pagePath: event.path } : {}) },
    },
    deps.sink
  );

  return { status: 204, headers: headersWith(rateHeaders) };
}

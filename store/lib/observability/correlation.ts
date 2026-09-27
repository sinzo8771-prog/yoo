import { randomUUID } from "node:crypto";

/**
 * Task 17, Step 1 — correlation IDs across the order pipeline.
 *
 * The traceable chain, keyed for grep at every hop:
 *
 *   customer / Openfront order id  = `sourceOrderId`  (THE permanent key, Task 13 Step 2)
 *     → OpenShip order row id      = `openshipOrderId` (once ingestion acknowledged)
 *     → provider purchase id       = `purchaseId`      (once a keyed purchase exists)
 *   plus `cartId` (storefront cart at operation time) and `traceId`
 *   (per-operation UUID).
 *
 * The key list is CLOSED and the object is constructed field-by-field:
 * a caller cannot smuggle `secretKey`, a cart-proof header, or a payload by
 * passing extra properties — unknown keys simply never reach the log line.
 * That structural guarantee is what makes "never log secrets" (Step 2)
 * enforceable, because correlation data is what every log line carries.
 */

export const CORRELATION_KEYS = [
  "traceId",
  "sourceOrderId",
  "openshipOrderId",
  "purchaseId",
  "cartId",
] as const;

export type CorrelationKey = (typeof CORRELATION_KEYS)[number];
export type CorrelationIds = Partial<Record<CorrelationKey, string | null>>;

/** Bounds: ids are opaque but not unbounded — truncate rather than obey. */
export const MAX_CORRELATION_ID_LENGTH = 128;

export function newTraceId(): string {
  return randomUUID();
}

/**
 * Pick the whitelisted correlation fields off any input object.
 *
 * Non-string values, empties, and unknown keys are dropped; oversized strings
 * are truncated. The input is treated as untrusted even though callers are
 * ours — the logger must never be one careless spread away from a leak.
 */
export function buildCorrelation(
  input: CorrelationIds | Record<string, unknown> | null | undefined
): Partial<Record<CorrelationKey, string>> {
  const out: Partial<Record<CorrelationKey, string>> = {};
  if (!input || typeof input !== "object") return out;
  for (const key of CORRELATION_KEYS) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    out[key] =
      trimmed.length > MAX_CORRELATION_ID_LENGTH
        ? trimmed.slice(0, MAX_CORRELATION_ID_LENGTH)
        : trimmed;
  }
  return out;
}

/**
 * Fixed-order, single-line summary for human eyeballs and log greps:
 * `sourceOrder=of_1 openshipOrder=osh_2 purchase=pur_3` (absent hops omitted).
 * Labels match `knownHops` so one vocabulary serves greps and tests alike.
 */
const SUMMARY_LABELS: Partial<Record<CorrelationKey, string>> = {
  sourceOrderId: "sourceOrder",
  openshipOrderId: "openshipOrder",
  purchaseId: "purchase",
  cartId: "cart",
};

export function correlationSummary(
  input: CorrelationIds | Record<string, unknown> | null | undefined
): string {
  const c = buildCorrelation(input);
  const parts: string[] = [];
  for (const key of CORRELATION_KEYS) {
    const label = SUMMARY_LABELS[key];
    if (!label) continue; // traceId stays on the line, not the summary
    const value = c[key];
    if (value) parts.push(`${label}=${value}`);
  }
  return parts.length > 0 ? parts.join(" ") : "(no correlation yet)";
}

export type CorrelationHop =
  | "sourceOrder"
  | "openshipOrder"
  | "purchase"
  | "cart"
  | "trace";

/**
 * Which hops of the chain are known so far — the Step 1 requirement is that
 * every hop IS traceable, so callers/tests can assert coverage explicitly.
 */
export function knownHops(
  input: CorrelationIds | Record<string, unknown> | null | undefined
): CorrelationHop[] {
  const c = buildCorrelation(input);
  const hops: CorrelationHop[] = [];
  if (c.sourceOrderId) hops.push("sourceOrder");
  if (c.openshipOrderId) hops.push("openshipOrder");
  if (c.purchaseId) hops.push("purchase");
  if (c.cartId) hops.push("cart");
  if (c.traceId) hops.push("trace");
  return hops;
}

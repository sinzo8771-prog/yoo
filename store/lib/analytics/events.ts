/**
 * Task 19, Step 3 — the analytics event vocabulary, and the only place a
 * payload is allowed to enter or leave the app.
 *
 * Privacy rules encoded here (plan Task 19, Steps 3 + 4):
 *  - A CLOSED set of ten events. Anything else is rejected, so a future caller
 *    cannot quietly start shipping a new stream of behavioural data.
 *  - A per-event ALLOWLIST of props. Unknown keys are stripped by the schema,
 *    and one invalid prop rejects the whole event rather than partially
 *    trusting it (the same doctrine as the Task 18 boundary schemas).
 *  - No personal data can pass: the allowlist holds ids, handles, counts,
 *    minor-unit amounts, a currency code and a pathname — never an email,
 *    name, address, phone number, IP, order reference or free-text field.
 *  - Query strings are stripped from the attributed path, because search and
 *    filter URLs are exactly where emails and tokens leak into `location`.
 *
 * The same sanitizer runs on the client (before transport) and again in the
 * route handler (before anything is counted or logged): the server never trusts
 * the browser, and the browser never builds a payload it cannot explain.
 */

import { z } from "zod";

export const ANALYTICS_EVENTS = [
  "view_product",
  "view_collection",
  "select_variant",
  "add_to_cart",
  "view_cart",
  "begin_checkout",
  "checkout_success",
  "purchase",
  "view_order",
  "view_tracking",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

export const ANALYTICS_EVENT_SET: ReadonlySet<string> = new Set(ANALYTICS_EVENTS);

/**
 * The four stages the funnel measure is built from (Step 4).
 * `checkout_success` and `purchase` are separate: they are two observations of
 * the same conversion — the payment provider's confirmation, then the order row
 * that is authoritative for money.
 */
export const FUNNEL_STAGES = [
  "view_product",
  "add_to_cart",
  "begin_checkout",
  "purchase",
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

/** Longest attributed path accepted (`/us/products/oak-board` is 23 chars). */
export const MAX_ANALYTICS_PATH_LENGTH = 200;

/**
 * Keys that must never appear in an analytics payload. The per-event
 * allowlists already exclude them; this pattern exists so that a future
 * allowlist edit which reintroduces one fails a test instead of shipping.
 */
export const PII_KEY_PATTERN =
  /(email|phone|name|address|street|postal|zip|city|first|last|card|cvv|token|password|secret|session|ip)/i;

const handleSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9._-]{0,79}$/i);
const idSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,64}$/);
const currencySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/)
  .transform((value) => value.toUpperCase());
/** Money in minor units, never a float — the catalog's convention. */
const valueMinorSchema = z.number().int().min(0).max(100_000_000);
const quantitySchema = z.number().int().min(1).max(999);
const itemCountSchema = z.number().int().min(0).max(999);
const productCountSchema = z.number().int().min(0).max(10_000);
/** Events that carry no props at all are still counted. */
const noProps = z.object({});

/**
 * Per-event prop allowlist. Zod objects strip unknown keys, so even a
 * hand-crafted payload can only contribute the fields named here.
 */
export const EVENT_PROP_SCHEMAS = {
  view_product: z.object({
    productId: idSchema.optional(),
    productHandle: handleSchema.optional(),
  }),
  view_collection: z.object({
    collectionHandle: handleSchema.optional(),
    productCount: productCountSchema.optional(),
  }),
  select_variant: z.object({
    productId: idSchema.optional(),
    variantId: idSchema.optional(),
  }),
  add_to_cart: z.object({
    productId: idSchema.optional(),
    variantId: idSchema.optional(),
    quantity: quantitySchema.optional(),
    currency: currencySchema.optional(),
    valueMinor: valueMinorSchema.optional(),
  }),
  view_cart: z.object({
    itemCount: itemCountSchema.optional(),
    currency: currencySchema.optional(),
    valueMinor: valueMinorSchema.optional(),
  }),
  begin_checkout: z.object({
    itemCount: itemCountSchema.optional(),
    currency: currencySchema.optional(),
    valueMinor: valueMinorSchema.optional(),
  }),
  checkout_success: z.object({
    itemCount: itemCountSchema.optional(),
    currency: currencySchema.optional(),
    valueMinor: valueMinorSchema.optional(),
  }),
  purchase: z.object({
    itemCount: itemCountSchema.optional(),
    currency: currencySchema.optional(),
    valueMinor: valueMinorSchema.optional(),
  }),
  view_order: noProps,
  view_tracking: z.object({
    hasTracking: z.boolean().optional(),
  }),
} as const;

/**
 * Strip query/hash and bound the length. Returns undefined for anything that is
 * not a rooted path, so a "path" of `https://x/?email=…` can never be attributed.
 */
export function sanitizeAnalyticsPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ANALYTICS_PATH_LENGTH) {
    return undefined;
  }
  const pathname = trimmed.split(/[?#]/, 1)[0];
  if (!pathname.startsWith("/")) return undefined;
  if (pathname === "/") return "/";
  return pathname.replace(/\/+$/, "");
}

const envelopeSchema = z.object({
  event: z.enum(ANALYTICS_EVENTS),
  path: z.string().max(MAX_ANALYTICS_PATH_LENGTH).optional(),
  props: z.unknown().optional(),
});

export type SanitizedAnalyticsEvent = {
  event: AnalyticsEventName;
  path?: string;
  props: Record<string, string | number | boolean>;
};

/** Drop `undefined` so logs and aggregates only carry fields that exist. */
function pruneProps(
  input: Record<string, unknown>
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Validate an untrusted payload. Returns null when the event is unknown or any
 * prop is out of bounds — the caller then drops the whole event (the route logs
 * an `invalid` status without echoing the payload back).
 */
export function sanitizeAnalyticsEvent(
  input: unknown
): SanitizedAnalyticsEvent | null {
  const envelope = envelopeSchema.safeParse(input);
  if (!envelope.success) return null;

  const propSchema = EVENT_PROP_SCHEMAS[envelope.data.event];
  const props = propSchema.safeParse(envelope.data.props ?? {});
  if (!props.success) return null;

  const path = sanitizeAnalyticsPath(envelope.data.path);
  return {
    event: envelope.data.event,
    ...(path ? { path } : {}),
    props: pruneProps(props.data as Record<string, unknown>),
  };
}

/** True only for the ten declared event names. */
export function isAnalyticsEventName(
  value: unknown
): value is AnalyticsEventName {
  return typeof value === "string" && ANALYTICS_EVENT_SET.has(value);
}

/** Prop names a given event may carry (used by tests and by `docs/analytics/events.md`). */
export function allowedPropNames(event: AnalyticsEventName): string[] {
  return Object.keys(EVENT_PROP_SCHEMAS[event].shape ?? {}).sort();
}

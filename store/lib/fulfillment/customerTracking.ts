/**
 * Task 14 — customer tracking experience (Steps 1-3).
 *
 * Produces the sanitized object the plan specifies — never a raw provider
 * payload. Two verified facts shape it:
 *
 *  - `features/storefront/modules/order/components/fulfillment-card/index.tsx`
 *    renders `fulfillment.shippingLabels[0].trackingUrl` straight into an
 *    `<a href>` (falling back to `"#"`) with `target="_blank"`. A supplier-
 *    supplied URL is attacker-controlled data, so it must be validated before
 *    it ever reaches an href (Step 2).
 *  - The pinned channel adapters return a `url` alongside a purchase ID
 *    (`completeSupplierPurchase({ purchaseId, url })`), and the synthetic
 *    adapter emits a deterministic tracking number with no carrier URL at all —
 *    so "tracking number without a link" is a normal state, not an error.
 *
 * Pure functions: no I/O, no clock (callers inject `now`).
 */

import { FULFILLMENT_STATE as S, type FulfillmentState } from "./reconciliation";

export type CustomerTrackingStatus = "processing" | "shipped" | "delivered" | "issue";

export type CustomerTracking = {
  status: CustomerTrackingStatus;
  carrier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  lastUpdatedAt?: string;
  /** True when the order is accepted but no tracking exists yet (Step 3). */
  trackingDelayed?: boolean;
  /** Customer-safe explanation; never a provider error string. */
  message: string;
};

/** Every key this projection may ever emit; nothing else reaches a customer. */
export const CUSTOMER_TRACKING_KEYS = [
  "status",
  "carrier",
  "trackingNumber",
  "trackingUrl",
  "lastUpdatedAt",
  "trackingDelayed",
  "message",
] as const;

/**
 * Internal state -> customer-safe state.
 *
 * `issue` is the only bucket available for a problem, and it legitimately covers
 * a confirmed cancellation: OpenShip's `cancelPurchase` rewrites local status
 * only, so a cancelled line is a customer-visible problem.
 */
const CUSTOMER_STATUS: Record<FulfillmentState, CustomerTrackingStatus> = {
  [S.RECEIVED]: "processing",
  [S.MATCHED]: "processing",
  [S.READY]: "processing",
  [S.SUBMITTING]: "processing",
  [S.ACCEPTED]: "processing",
  [S.FULFILLING]: "shipped",
  [S.SHIPPED]: "shipped",
  [S.DELIVERED]: "delivered",
  [S.MATCH_FAILED]: "issue",
  [S.PROVIDER_REJECTED]: "issue",
  [S.RETRYABLE_ERROR]: "issue",
  [S.CANCEL_REQUESTED]: "issue",
  [S.CANCELLED]: "issue",
  [S.RECONCILIATION_REQUIRED]: "issue",
};

export function toCustomerStatus(state: FulfillmentState): CustomerTrackingStatus {
  const status = CUSTOMER_STATUS[state];
  if (!status) throw new Error(`Unknown fulfillment state: ${String(state)}`);
  return status;
}

/** States where the order is purchased but tracking may not exist yet. */
const AWAITING_TRACKING: FulfillmentState[] = [S.ACCEPTED, S.FULFILLING];

/** Default grace period before "accepted but no tracking" is called out. */
export const TRACKING_DELAY_MS = 48 * 60 * 60 * 1000;

/**
 * Carrier hosts we are willing to link to. A URL is only projected when its
 * host belongs to the carrier we think we are tracking with — an unknown or
 * mismatched host is dropped and the customer sees the plain number instead.
 */
export const CARRIER_TRACKING_HOSTS: Record<string, string[]> = {
  usps: ["tools.usps.com", "www.usps.com"],
  ups: ["www.ups.com"],
  fedex: ["www.fedex.com"],
  dhl: ["www.dhl.com"],
};

const CARRIER_HOST_ALIASES: Record<string, string> = {
  "united states postal service": "usps",
  "us postal service": "usps",
  "ups express": "ups",
  "fedex express": "fedex",
  "dhl express": "dhl",
};

const MAX_URL_LENGTH = 2048;
const MAX_TRACKING_NUMBER_LENGTH = 64;
const MAX_CARRIER_LENGTH = 60;

/** Tracking numbers are opaque but restricted: printable, no markup. */
const SAFE_TRACKING_NUMBER = /^[A-Za-z0-9][A-Za-z0-9\-_. ]*$/;

const isVague = (value: unknown): boolean =>
  typeof value !== "string" || value.trim().length === 0;

/** Normalize a carrier label to a known key, or null when unrecognised. */
export function normalizeCarrier(carrier: unknown): string | null {
  if (isVague(carrier)) return null;
  const raw = (carrier as string).trim();
  if (raw.length > MAX_CARRIER_LENGTH) return null;
  const lower = raw.toLowerCase();
  const key = CARRIER_HOST_ALIASES[lower] ?? lower.replace(/\s+/g, " ").split(" ")[0];
  return CARRIER_TRACKING_HOSTS[key] ? key : null;
}

/** Keep only opaque, printable tracking identifiers. */
export function sanitizeTrackingNumber(trackingNumber: unknown): string | null {
  if (isVague(trackingNumber)) return null;
  const value = (trackingNumber as string).trim();
  if (value.length > MAX_TRACKING_NUMBER_LENGTH) return null;
  return SAFE_TRACKING_NUMBER.test(value) ? value : null;
}

/**
 * Step 2: accept a tracking URL only when it is an https URL on the expected
 * carrier's host. Credentials, non-https schemes, IP literals, and unknown hosts
 * are refused — the caller then shows a plain tracking number, so a hostile or
 * broken URL can never become a customer-facing redirect.
 */
export function sanitizeTrackingUrl(
  url: unknown,
  { carrier }: { carrier?: unknown } = {}
): string | null {
  if (isVague(url)) return null;
  const raw = (url as string).trim();
  if (raw.length > MAX_URL_LENGTH) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;

  const host = parsed.hostname.toLowerCase();
  // No bare IP literals, single-label hosts, or loopback.
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;
  if (host === "localhost" || host.endsWith(".localhost")) return null;

  const carrierKey = normalizeCarrier(carrier);
  if (!carrierKey) return null;
  if (!CARRIER_TRACKING_HOSTS[carrierKey].includes(host)) return null;

  parsed.hash = "";
  return parsed.toString();
}

/** ISO timestamp from a valid date, never a raw provider format. */
export function sanitizeTimestamp(value: unknown): string | null {
  if (isVague(value)) return null;
  const date = new Date(value as string);
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;
  // Reject implausible values (epoch noise, far-future provider typos).
  const year = date.getUTCFullYear();
  if (year < 2000 || year > 2100) return null;
  return date.toISOString();
}

/**
 * Provider/internal detail the customer never sees. Only these named scalars are
 * read; any other key on the input (raw payload, provider error, metadata) is
 * ignored by construction.
 */
export type TrackingObservation = {
  state: FulfillmentState;
  carrier?: unknown;
  trackingNumber?: unknown;
  trackingUrl?: unknown;
  /** When the purchase was accepted, used for the delayed-tracking notice. */
  acceptedAt?: unknown;
  updatedAt?: unknown;
};

export type ProjectionOptions = {
  now?: number;
  /** How long an accepted order may sit without tracking before we say so. */
  delayedAfterMs?: number;
  [key: string]: unknown;
};

const MESSAGE: Record<CustomerTrackingStatus, string> = {
  processing: "We are preparing your order for shipment.",
  shipped: "Your order is on its way.",
  delivered: "Your order was delivered.",
  issue: "There is a problem with this order. Our team is looking into it.",
};

const DELAYED_MESSAGE =
  "Your order has been accepted by our supplier, but tracking is not available yet. " +
  "We will show it here as soon as the carrier reports it.";

/**
 * Steps 1-3: map internal state to a customer-safe status, project only
 * validated tracking, and explain an accepted-but-untracked order instead of
 * showing an empty box.
 */
export function projectCustomerTracking(
  observation: TrackingObservation,
  { now = Date.now(), delayedAfterMs = TRACKING_DELAY_MS }: ProjectionOptions = {}
): CustomerTracking {
  const status = toCustomerStatus(observation?.state);

  const carrierKey = normalizeCarrier(observation?.carrier);
  const trackingNumber = sanitizeTrackingNumber(observation?.trackingNumber);
  // A link is only ever projected alongside a real tracking number, and only
  // when the destination passes validation.
  const trackingUrl = trackingNumber
    ? sanitizeTrackingUrl(observation?.trackingUrl, { carrier: observation?.carrier })
    : null;

  const updatedAt = sanitizeTimestamp(observation?.updatedAt);
  const acceptedAt = sanitizeTimestamp(observation?.acceptedAt);

  const awaitingTracking =
    status === "processing" && AWAITING_TRACKING.includes(observation.state) && !trackingNumber;
  const overdue =
    awaitingTracking &&
    acceptedAt !== null &&
    now - new Date(acceptedAt).getTime() >= delayedAfterMs;
  const trackingDelayed = awaitingTracking && overdue;

  const tracking: CustomerTracking = {
    status,
    message: trackingDelayed ? DELAYED_MESSAGE : MESSAGE[status],
  };

  if (carrierKey) tracking.carrier = carrierKey.toUpperCase();
  if (trackingNumber) tracking.trackingNumber = trackingNumber;
  if (trackingUrl) tracking.trackingUrl = trackingUrl;
  if (updatedAt) tracking.lastUpdatedAt = updatedAt;
  if (awaitingTracking) tracking.trackingDelayed = trackingDelayed;

  return tracking;
}
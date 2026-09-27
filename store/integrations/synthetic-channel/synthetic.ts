import { createHash } from "node:crypto";

/**
 * Synthetic fulfillment channel adapter (Task 11).
 *
 * Loaded by OpenShip's executeChannelAdapterFunction via dynamic import
 * (`integrations/channel/${platform.createPurchaseFunction}.ts`) and consumed
 * with the pinned call shape adapter[functionName]({ platform, ...args }).
 *
 * Deterministic by design: purchase IDs and tracking numbers derive from
 * SHA-256 of the request identity, never randomness or wall-clock time.
 * "Known" SKUs are exactly those with the reserved `syn_` prefix. State is
 * in-memory per process: this adapter is a fixture, not a provider.
 */

type SyntheticCartItem = { variantId: string; quantity: number };

type SyntheticPurchase = {
  purchaseId: string;
  status: "accepted" | "rejected";
  lines: SyntheticCartItem[];
  trackingNumber: string | null;
  trackingCompany: string | null;
  cancelled: boolean;
};

const purchases = new Map<string, SyntheticPurchase>();
const SKU_PREFIX = "syn_";

const isKnownSku = (variantId: unknown): variantId is string =>
  typeof variantId === "string" && variantId.startsWith(SKU_PREFIX) &&
  variantId.trim() === variantId && variantId.length > SKU_PREFIX.length;

const stableKey = (parts: unknown[]): string =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex");

const trackingNumberFor = (purchaseId: string): string =>
  `syn_track_${createHash("sha256").update(purchaseId).digest("hex").slice(0, 12)}`;

export async function createPurchaseFunction({
  cartItems,
  shipping,
  idempotencyKey,
}: {
  platform: Record<string, unknown>;
  cartItems: SyntheticCartItem[];
  shipping?: unknown;
  notes?: string;
  idempotencyKey?: string;
}): Promise<{ purchaseId: string; status: string } | { error: string }> {
  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    return { error: "Synthetic channel requires at least one cart item." };
  }
  for (const item of cartItems) {
    if (!item || !isKnownSku(item.variantId) ||
        !Number.isInteger(item.quantity) || item.quantity <= 0) {
      return { error: `Synthetic channel rejected unknown SKU or malformed item: ${JSON.stringify(item?.variantId ?? item)}` };
    }
  }
  // The pinned router (placeMultipleOrders.ts) forwards claim.attemptKey as
  // idempotencyKey, so a retried claim dedupes here. Fall back to the request
  // identity (same cart + address = same purchase) for callers without a key.
  const identity = idempotencyKey
    ? String(idempotencyKey)
    : stableKey([cartItems.map(item => [item.variantId, item.quantity]), shipping ?? null]);
  const existing = purchases.get(identity);
  if (existing) {
    return { purchaseId: existing.purchaseId, status: existing.status, reconciled: true } as any;
  }
  const purchaseId = `syn_purchase_${stableKey([identity]).slice(0, 16)}`;
  purchases.set(identity, {
    purchaseId, status: "accepted",
    lines: cartItems.map(item => ({ variantId: item.variantId, quantity: item.quantity })),
    trackingNumber: null, trackingCompany: null, cancelled: false,
  });
  return {
    purchaseId,
    status: "accepted",
    lineItems: cartItems.map(item => ({ id: item.variantId, quantity: item.quantity, variantId: item.variantId })),
  } as any;
}

/**
 * Explicit state transition: emit deterministic tracking for an accepted
 * purchase. Only purchases created by this adapter can transition.
 */
export function fulfillPurchase({ purchaseId }: { purchaseId: string }):
  { trackingNumber: string; trackingCompany: string } | { error: string } {
  for (const purchase of purchases.values()) {
    if (purchase.purchaseId === purchaseId) {
      if (purchase.cancelled) return { error: `Purchase ${purchaseId} was cancelled and cannot be fulfilled.` };
      if (purchase.trackingNumber) {
        return { trackingNumber: purchase.trackingNumber, trackingCompany: purchase.trackingCompany! };
      }
      purchase.trackingNumber = trackingNumberFor(purchaseId);
      purchase.trackingCompany = "Synthetic";
      return { trackingNumber: purchase.trackingNumber, trackingCompany: purchase.trackingCompany };
    }
  }
  return { error: `Unknown purchase ${purchaseId}.` };
}

/**
 * Read-only snapshot of purchases created by this adapter (identity -> record).
 * For tests and operator inspection; never mutates state.
 */
export function inspectSyntheticPurchases(): SyntheticPurchase[] {
  return [...purchases.values()];
}

export function cancelPurchase({ purchaseId }: { purchaseId: string }):
  { purchaseId: string; status: "cancelled" } | { error: string } {
  for (const purchase of purchases.values()) {
    if (purchase.purchaseId === purchaseId) {
      if (purchase.trackingNumber) return { error: `Purchase ${purchaseId} was already fulfilled.` };
      if (purchase.cancelled) return { purchaseId, status: "cancelled" };
      purchase.cancelled = true;
      purchase.status = "rejected";
      return { purchaseId, status: "cancelled" };
    }
  }
  return { error: `Unknown purchase ${purchaseId}.` };
}

/**
 * Tracking webhook handler: verifies the synthetic event envelope and returns
 * the deterministic tracking payload OpenShip's relay expects. Rejects
 * unknown or unfulfilled purchases and malformed events.
 */
export async function createTrackingWebhookHandler({ event }: {
  platform: Record<string, any>;
  event: { event?: string; data?: { orderId?: string; trackingNumber?: string; trackingCompany?: string } };
  headers: Record<string, string>;
}): Promise<{ purchaseId: string; trackingNumber: string; trackingCompany: string; status: string }> {
  if (event?.event !== "fulfillment.created" || !event.data?.orderId) {
    throw new Error("Synthetic channel received a malformed fulfillment event.");
  }
  const purchaseId = String(event.data.orderId);
  for (const purchase of purchases.values()) {
    if (purchase.purchaseId === purchaseId) {
      if (!purchase.trackingNumber) throw new Error(`Purchase ${purchaseId} has no tracking to relay.`);
      return {
        purchaseId,
        trackingNumber: event.data.trackingNumber ?? purchase.trackingNumber,
        trackingCompany: event.data.trackingCompany ?? purchase.trackingCompany ?? "Synthetic",
        status: "shipped",
      };
    }
  }
  throw new Error(`Synthetic channel received tracking for unknown purchase ${purchaseId}.`);
}
export const cancelPurchaseWebhookHandler = createTrackingWebhookHandler;

// ---- Remaining pinned ChannelPlatform contract exports --------------------
// The synthetic platform sells nothing and uses no OAuth; these exports exist
// so a ChannelPlatform row can reference them and fail loudly if called.

export async function searchProductsFunction(): Promise<{ error: string }> {
  return { error: "Synthetic channel does not support product search." };
}
export const getProductFunction = searchProductsFunction;
export async function createWebhookFunction(): Promise<{ error: string }> {
  return { error: "Synthetic channel does not support webhooks." };
}
export async function deleteWebhookFunction(): Promise<{ error: string }> {
  return { error: "Synthetic channel does not support webhooks." };
}
export async function getWebhooksFunction(): Promise<{ error: string }> {
  return { error: "Synthetic channel does not support webhooks." };
}
export async function oAuthFunction(): Promise<{ error: string }> {
  return { error: "Synthetic channel does not support OAuth." };
}
export const oAuthCallbackFunction = oAuthFunction;


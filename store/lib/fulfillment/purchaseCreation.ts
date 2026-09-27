/**
 * Task 13 Step 4 — purchase creation.
 *
 * Rule from the plan: "Use one idempotency key per source order/fulfillment
 * action and persist the downstream purchase ID before allowing a retry path to
 * create a second request."
 *
 * Two verified pinned facts constrain how that can be done safely:
 *
 *  1. `features/keystone/extendGraphqlSchema/mutations/createChannelPurchase.ts`
 *     destructures `idempotencyKey` into `...otherData` and never forwards it,
 *     and never forwards `channel.accessToken`/`channel.domain` either. Calling
 *     that mutation can produce a DUPLICATE SUPPLIER ORDER on retry — a real
 *     charge. It must not be used for purchases.
 *  2. The router path does forward the key:
 *     `lib/placeMultipleOrders.ts` -> `utils/channelProviderAdapter.ts`
 *     `createChannelPurchase({ ..., idempotencyKey: claim.attemptKey })` ->
 *     adapter `createPurchaseFunction`.
 *
 * So this module computes the key from the SOURCE order identity (the
 * permanent correlation key from Step 2), refuses the unsafe path outright, and
 * turns the pinned claim vocabulary into an explicit submit/reuse/reconcile
 * decision. It never resubmits while an attempt is in flight or its outcome is
 * unknown: an uncertain supplier response is an operator problem, not a retry.
 *
 * Pure functions: no I/O, no clock (`now` is injected).
 */

import { createHash } from "node:crypto";

/** Where a purchase submission is being issued from. */
export const PURCHASE_PATH = {
  /** `placeMultipleOrders` -> adapter with `idempotencyKey` forwarded. */
  ROUTER: "router",
  /** `createChannelPurchase` mutation: drops the key and channel credentials. */
  GRAPHQL_MUTATION: "graphql-mutation",
} as const;

export type PurchasePath = (typeof PURCHASE_PATH)[keyof typeof PURCHASE_PATH];

/** Pinned cart-item vocabulary (`lib/supplierPurchaseClaim.ts`, `CartItem.ts`). */
export const PURCHASE_STATE = {
  /** Cart item exists, nothing claimed yet (`CartItem.status` default). */
  PENDING: "PENDING",
  /** Claimed; the adapter has been called or is being called. */
  PROCESSING: "PURCHASE_PROCESSING",
  /** Outcome uncertain. Never resubmitted automatically. */
  UNKNOWN: "PURCHASE_OUTCOME_UNKNOWN",
  /** `purchaseId` persisted; the line is done. */
  COMPLETE: "AWAITING",
} as const;

export type PurchaseState = (typeof PURCHASE_STATE)[keyof typeof PURCHASE_STATE];

/** Pinned `SUPPLIER_PURCHASE_STALE_MS` (5 minutes). */
export const STALE_CLAIM_MS = 5 * 60 * 1000;

/** The pinned router only ever re-attempts the `openfront` channel API. */
const PINNED_AUTO_RETRY_FUNCTION = "openfront";

export type PurchaseIntent = {
  /** OpenFront order id — the permanent correlation key (Step 2). */
  sourceOrderId: string;
  channelId: string;
  /** Cart items (the fulfillment action) that this purchase covers. */
  cartItemIds: string[];
  /** `ChannelPlatform.createPurchaseFunction` for the destination channel. */
  createPurchaseFunction: string;
};

/** A previously recorded attempt, as persisted against the cart items. */
export type PurchaseAttempt = {
  attemptKey: string;
  channelId: string;
  cartItemIds: string[];
  purchaseId?: string | null;
  state: PurchaseState | string;
  claimedAt?: string | Date | null;
};

export type PurchaseAction = "submit" | "reuse" | "reconcile" | "blocked";

export type PurchasePlan = {
  action: PurchaseAction;
  attemptKey: string;
  /** Present when the outcome is already known and must be reused. */
  purchaseId?: string;
  state?: PurchaseState | string;
  /** Stable, operator-facing explanation of the decision. */
  reason: string;
};

const isIdentity = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const toStringArray = (ids: string[]) => [...new Set(ids.filter(isIdentity))].sort();

const toMillis = (value: string | Date): number =>
  value instanceof Date ? value.getTime() : new Date(value).getTime();

/**
 * Deterministic key: one per source order + fulfillment action (channel plus the
 * exact cart-item set). Same inputs always produce the same key, so a retry can
 * never look like a new request. Mirrors the pinned
 * `supplier-purchase:<sha256(orderId\0channelId\0sortedItemIds)>` scheme, rooted
 * at the source order id instead of OpenShip's internal row id.
 */
export function sourcePurchaseAttemptKey({
  sourceOrderId,
  channelId,
  cartItemIds,
}: {
  sourceOrderId: string;
  channelId: string;
  cartItemIds: string[];
}): string {
  const itemIds = toStringArray(cartItemIds);
  if (!isIdentity(sourceOrderId) || !isIdentity(channelId) || itemIds.length === 0) {
    throw new Error(
      "A purchase attempt key requires a source order, a channel, and at least one cart item"
    );
  }
  return `source-purchase:${createHash("sha256")
    .update(`${sourceOrderId}\u0000${channelId}\u0000${itemIds.join("\u0000")}`)
    .digest("hex")}`;
}

/** Attempts that claim any of the given cart items. */
function attemptsTouching(attempts: PurchaseAttempt[], cartItemIds: string[]) {
  const wanted = new Set(cartItemIds);
  return attempts.filter(attempt => attempt.cartItemIds.some(id => wanted.has(id)));
}

function isStale(attempt: PurchaseAttempt, now: number): boolean {
  if (!attempt.claimedAt) return false;
  const at = toMillis(attempt.claimedAt);
  return Number.isFinite(at) && now - at >= STALE_CLAIM_MS;
}

/**
 * Decide what a purchase submission for this fulfillment action may do.
 *
 * `submit`    — no prior attempt owns these items; the router path (which
 *               forwards the key) may call the adapter once.
 * `reuse`     — a purchase ID is already persisted for this key; use it and
 *               issue no request.
 * `reconcile` — the outcome is unknown or the claim went stale; a human must
 *               compare local state with the supplier before anything else.
 * `blocked`   — another attempt owns these items, an attempt is in flight, or
 *               the submission path would drop the idempotency key.
 */
export function planPurchaseCreation({
  intent,
  attempts = [],
  path = PURCHASE_PATH.ROUTER,
  now = Date.now(),
}: {
  intent: PurchaseIntent;
  attempts?: PurchaseAttempt[];
  path?: PurchasePath;
  now?: number;
}): PurchasePlan {
  const attemptKey = sourcePurchaseAttemptKey(intent);
  const cartItemIds = toStringArray(intent.cartItemIds);

  if (!isIdentity(intent.createPurchaseFunction)) {
    throw new Error(
      `Channel for ${intent.channelId} has no createPurchaseFunction configured; ` +
        "the router cannot dispatch a purchase."
    );
  }

  if (path !== PURCHASE_PATH.ROUTER) {
    return {
      action: "blocked",
      attemptKey,
      reason:
        "The createChannelPurchase mutation drops idempotencyKey and never forwards channel " +
        "credentials (verified in the pinned source), so it cannot be retried safely.",
    };
  }

  const owners = attemptsTouching(attempts, cartItemIds);
  const foreign = owners.find(attempt => attempt.attemptKey !== attemptKey);
  if (foreign) {
    return {
      action: "blocked",
      attemptKey,
      state: foreign.state,
      reason:
        `Cart items are already claimed by attempt ${foreign.attemptKey} ` +
        `(${foreign.state}); one fulfillment action may own a cart item.`,
    };
  }

  const mine = owners.find(attempt => attempt.attemptKey === attemptKey);
  if (!mine) {
    return {
      action: "submit",
      attemptKey,
      reason: `No prior attempt for ${cartItemIds.length} item(s); one keyed request is allowed.`,
    };
  }

  if (isIdentity(mine.purchaseId)) {
    return {
      action: "reuse",
      attemptKey,
      purchaseId: mine.purchaseId as string,
      state: mine.state,
      reason: `Purchase ${mine.purchaseId} is already persisted for this key; never request a second one.`,
    };
  }

  if (mine.state === PURCHASE_STATE.UNKNOWN) {
    return {
      action: "reconcile",
      attemptKey,
      state: mine.state,
      reason:
        "The supplier outcome is unknown. It cannot be resubmitted automatically: " +
        "reconcile against the supplier before deciding.",
    };
  }

  if (mine.state === PURCHASE_STATE.PROCESSING) {
    // The pinned claim is deliberately not lease-stealable, and only the
    // openfront channel API is ever automatically retried.
    return {
      action: "blocked",
      attemptKey,
      state: mine.state,
      reason: isStale(mine, now)
        ? `Claim has been in flight since ${String(mine.claimedAt)} and is stale; ` +
          (intent.createPurchaseFunction === PINNED_AUTO_RETRY_FUNCTION
            ? "OpenShip will only re-attempt this for the openfront channel — reconcile first."
            : "the supplier has no verified retry contract — reconcile first.")
        : "A previous attempt is still in flight; the pinned claim is not lease-stealable.",
    };
  }

  return {
    action: "reconcile",
    attemptKey,
    state: mine.state,
    reason: `Attempt exists in unexpected state ${mine.state}; reconcile before submitting.`,
  };
}

export type PurchaseOutcome = {
  purchaseId?: string | null;
  url?: string | null;
  error?: string | null;
};

export type PurchaseLedgerEntry = {
  attemptKey: string;
  sourceOrderId: string;
  channelId: string;
  cartItemIds: string[];
  purchaseId: string;
  url: string;
  state: PurchaseState;
  error: string;
};

/**
 * Convert an adapter response into the state that must be persisted against the
 * cart items *before* any retry is considered. A response without a purchase ID
 * is an UNKNOWN outcome, never a success — the pinned router takes the same
 * position (`markSupplierPurchaseUnknown`).
 */
export function recordPurchaseOutcome({
  intent,
  outcome,
}: {
  intent: PurchaseIntent;
  outcome: PurchaseOutcome;
}): PurchaseLedgerEntry {
  const attemptKey = sourcePurchaseAttemptKey(intent);
  const cartItemIds = toStringArray(intent.cartItemIds);
  // IDs are opaque to us; surrounding whitespace is transport noise, never part
  // of the identity we persist and later compare against.
  const purchaseId = isIdentity(outcome?.purchaseId) ? outcome.purchaseId.trim() : "";
  const url = isIdentity(outcome?.url) ? outcome.url.trim() : "";
  const error = isIdentity(outcome?.error) ? outcome.error.trim() : "";

  if (!purchaseId) {
    return {
      attemptKey,
      sourceOrderId: intent.sourceOrderId,
      channelId: intent.channelId,
      cartItemIds,
      purchaseId: "",
      url: "",
      state: PURCHASE_STATE.UNKNOWN,
      error: `PURCHASE_OUTCOME_UNKNOWN [${attemptKey}]: ${
        error || "Supplier returned no purchase ID"
      }`,
    };
  }

  return {
    attemptKey,
    sourceOrderId: intent.sourceOrderId,
    channelId: intent.channelId,
    cartItemIds,
    purchaseId,
    url,
    state: PURCHASE_STATE.COMPLETE,
    error: "",
  };
}
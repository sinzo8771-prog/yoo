/**
 * Task 13 Step 5 — reconciliation state machine.
 *
 * The plan's state list, adapted to the vocabulary the pinned router already
 * uses where one exists (`CartItem.status`: PENDING / PURCHASE_PROCESSING /
 * PURCHASE_OUTCOME_UNKNOWN / AWAITING; `Order.status`: PENDING / AWAITING).
 *
 * Two pinned behaviours are encoded as first-class transitions:
 *
 *  - `cancelPurchase.ts` changes LOCAL STATUS ONLY; it never calls the supplier.
 *    A "cancelled" purchase can still ship, so cancellation ends in
 *    CANCEL_REQUESTED and may only reach CANCELLED on a confirmed callback.
 *  - An uncertain supplier outcome is not a retryable error. It holds the order
 *    in RECONCILIATION_REQUIRED until a human compares local state with the
 *    supplier.
 *
 * Pure functions: no I/O, no clock.
 */

import type { MatchStatus } from "./matchVerification";
import { PURCHASE_STATE } from "./purchaseCreation";

export const FULFILLMENT_STATE = {
  RECEIVED: "RECEIVED",
  MATCHED: "MATCHED",
  READY: "READY",
  SUBMITTING: "SUBMITTING",
  ACCEPTED: "ACCEPTED",
  FULFILLING: "FULFILLING",
  SHIPPED: "SHIPPED",
  DELIVERED: "DELIVERED",
  MATCH_FAILED: "MATCH_FAILED",
  PROVIDER_REJECTED: "PROVIDER_REJECTED",
  RETRYABLE_ERROR: "RETRYABLE_ERROR",
  CANCEL_REQUESTED: "CANCEL_REQUESTED",
  CANCELLED: "CANCELLED",
  RECONCILIATION_REQUIRED: "RECONCILIATION_REQUIRED",
} as const;

export type FulfillmentState = (typeof FULFILLMENT_STATE)[keyof typeof FULFILLMENT_STATE];

export const ALL_STATES: FulfillmentState[] = Object.values(FULFILLMENT_STATE);

/** No further automatic or operator work is expected. */
export const TERMINAL_STATES: FulfillmentState[] = [
  FULFILLMENT_STATE.DELIVERED,
  FULFILLMENT_STATE.CANCELLED,
];

/** States an operator must act on; none of them advance on their own. */
export const FAILURE_STATES: FulfillmentState[] = [
  FULFILLMENT_STATE.MATCH_FAILED,
  FULFILLMENT_STATE.PROVIDER_REJECTED,
  FULFILLMENT_STATE.RETRYABLE_ERROR,
  FULFILLMENT_STATE.RECONCILIATION_REQUIRED,
];

const S = FULFILLMENT_STATE;

/**
 * Explicit, closed transition table. Anything not listed here is rejected —
 * a state machine that accepts unknown edges cannot be reasoned about.
 */
export const TRANSITIONS: Record<FulfillmentState, FulfillmentState[]> = {
  [S.RECEIVED]: [S.MATCHED, S.MATCH_FAILED, S.CANCEL_REQUESTED],
  [S.MATCHED]: [S.READY, S.MATCH_FAILED, S.CANCEL_REQUESTED],
  [S.READY]: [S.SUBMITTING, S.RETRYABLE_ERROR, S.CANCEL_REQUESTED],
  [S.SUBMITTING]: [
    S.ACCEPTED,
    S.PROVIDER_REJECTED,
    S.RETRYABLE_ERROR,
    S.RECONCILIATION_REQUIRED,
    S.CANCEL_REQUESTED,
  ],
  [S.ACCEPTED]: [S.FULFILLING, S.SHIPPED, S.CANCEL_REQUESTED, S.RECONCILIATION_REQUIRED],
  [S.FULFILLING]: [S.SHIPPED, S.RECONCILIATION_REQUIRED, S.CANCEL_REQUESTED],
  [S.SHIPPED]: [S.DELIVERED, S.RECONCILIATION_REQUIRED],
  [S.DELIVERED]: [],
  [S.MATCH_FAILED]: [S.READY, S.MATCHED, S.CANCEL_REQUESTED],
  [S.PROVIDER_REJECTED]: [S.READY, S.RETRYABLE_ERROR, S.CANCEL_REQUESTED],
  [S.RETRYABLE_ERROR]: [S.READY, S.SUBMITTING, S.CANCEL_REQUESTED],
  [S.CANCEL_REQUESTED]: [S.CANCELLED, S.RECONCILIATION_REQUIRED],
  [S.CANCELLED]: [],
  [S.RECONCILIATION_REQUIRED]: [
    S.ACCEPTED,
    S.FULFILLING,
    S.SHIPPED,
    S.DELIVERED,
    S.READY,
    S.RETRYABLE_ERROR,
    S.CANCEL_REQUESTED,
    S.CANCELLED,
  ],
};

export function nextStates(state: FulfillmentState): FulfillmentState[] {
  const allowed = TRANSITIONS[state];
  if (!allowed) throw new Error(`Unknown fulfillment state: ${String(state)}`);
  return [...allowed];
}

export function isTerminal(state: FulfillmentState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function isFailureState(state: FulfillmentState): boolean {
  return FAILURE_STATES.includes(state);
}

/** Move to `next`, or throw listing the legal targets. */
export function transition(state: FulfillmentState, next: FulfillmentState): FulfillmentState {
  const allowed = nextStates(state);
  if (!allowed.includes(next)) {
    throw new Error(
      `Illegal fulfillment transition ${state} -> ${next}` +
        (isTerminal(state)
          ? `: ${state} is terminal`
          : `; allowed: ${allowed.join(", ") || "none"}`)
    );
  }
  return next;
}

/** Purpose-built events; each maps to exactly one intended next state. */
export type FulfillmentEvent =
  | { type: "IMPORTED" }
  | { type: "MATCH_VERIFIED" }
  | { type: "MATCH_REJECTED"; reason?: string }
  | { type: "READY_FOR_PURCHASE" }
  | { type: "SUBMISSION_STARTED" }
  | { type: "SUBMISSION_SUCCEEDED"; purchaseId: string }
  | { type: "SUBMISSION_REJECTED"; reason?: string }
  | { type: "SUBMISSION_RETRYABLE"; reason?: string }
  | { type: "SUBMISSION_UNKNOWN"; error?: string }
  | { type: "RETRY_ALLOWED" }
  | { type: "OUTCOME_RECOVERED" }
  | { type: "TRACKING_RECEIVED" }
  | { type: "SHIPPED" }
  | { type: "DELIVERED" }
  | { type: "CANCEL_REQUESTED" }
  | { type: "CANCEL_CONFIRMED" }
  | { type: "CANCEL_REFUSED" };

export type FulfillmentEventType = FulfillmentEvent["type"];

/** The monotonically forward path; failures and holds hang off it. */
const HAPPY_PATH: FulfillmentState[] = [
  S.RECEIVED,
  S.MATCHED,
  S.READY,
  S.SUBMITTING,
  S.ACCEPTED,
  S.FULFILLING,
  S.SHIPPED,
  S.DELIVERED,
];

const happyIndex = (state: FulfillmentState) => HAPPY_PATH.indexOf(state);

const TARGET: Record<FulfillmentEventType, FulfillmentState> = {
  IMPORTED: S.RECEIVED,
  MATCH_VERIFIED: S.MATCHED,
  MATCH_REJECTED: S.MATCH_FAILED,
  READY_FOR_PURCHASE: S.READY,
  SUBMISSION_STARTED: S.SUBMITTING,
  SUBMISSION_SUCCEEDED: S.ACCEPTED,
  SUBMISSION_REJECTED: S.PROVIDER_REJECTED,
  SUBMISSION_RETRYABLE: S.RETRYABLE_ERROR,
  SUBMISSION_UNKNOWN: S.RECONCILIATION_REQUIRED,
  RETRY_ALLOWED: S.READY,
  OUTCOME_RECOVERED: S.ACCEPTED,
  TRACKING_RECEIVED: S.FULFILLING,
  SHIPPED: S.SHIPPED,
  DELIVERED: S.DELIVERED,
  CANCEL_REQUESTED: S.CANCEL_REQUESTED,
  CANCEL_CONFIRMED: S.CANCELLED,
  CANCEL_REFUSED: S.RECONCILIATION_REQUIRED,
};

/**
 * Apply an event.
 *
 * Idempotent by design, because supplier callbacks are at-least-once: repeating
 * an event, or delivering one whose target already lies behind a forward state
 * (a duplicate "purchase created" after tracking arrived), is a no-op rather
 * than an error. Genuine conflicts — cancelling a delivered order — still throw.
 */
export function reduce(state: FulfillmentState, event: FulfillmentEvent): FulfillmentState {
  if (!ALL_STATES.includes(state)) {
    throw new Error(`Unknown fulfillment state: ${String(state)}`);
  }
  if (!(event.type in TARGET)) {
    throw new Error(`Unknown fulfillment event: ${String((event as { type?: string }).type)}`);
  }

  // A success response that carries no purchase ID is not a success.
  const target =
    event.type === "SUBMISSION_SUCCEEDED" && !event.purchaseId?.trim()
      ? S.RECONCILIATION_REQUIRED
      : TARGET[event.type];

  if (target === state) return state;

  const from = happyIndex(state);
  const to = happyIndex(target);
  if (from !== -1 && to !== -1 && to < from) {
    // Late/duplicate callback for an already-passed stage: never regress.
    return state;
  }

  return transition(state, target);
}

/** What a human should do next, per state. */
export function operatorAction(state: FulfillmentState): string {
  switch (state) {
    case S.RECEIVED:
      return "Match every source line to a fulfillment channel.";
    case S.MATCHED:
      return "Confirm the match covers every line, then release it for purchase.";
    case S.READY:
      return "Submit one keyed purchase per channel; do not submit while another attempt is in flight.";
    case S.SUBMITTING:
      return "Wait for the supplier response; never resubmit while a claim is in flight.";
    case S.ACCEPTED:
      return "Wait for tracking; do not re-purchase.";
    case S.FULFILLING:
      return "Wait for shipment confirmation.";
    case S.SHIPPED:
      return "Wait for delivery confirmation, then project tracking to the customer.";
    case S.DELIVERED:
      return "None — terminal.";
    case S.MATCH_FAILED:
      return "Fix the variant mapping, then re-match. Do not purchase partially matched lines.";
    case S.PROVIDER_REJECTED:
      return "Read the supplier rejection, correct the request, then re-release deliberately.";
    case S.RETRYABLE_ERROR:
      return "Verify the previous attempt left no purchase behind, then retry once.";
    case S.CANCEL_REQUESTED:
      return "Confirm with the supplier: OpenShip cancellation rewrites local status only.";
    case S.CANCELLED:
      return "None — terminal.";
    case S.RECONCILIATION_REQUIRED:
    default:
      return "Compare local state with the supplier by hand before any further supplier call.";
  }
}

/**
 * Project the pinned observations onto a state.
 *
 * Inputs are exactly what the pinned code exposes: the match verdict from Step 3
 * and `CartItem.status` / `purchaseId` / tracking, which is also what
 * `placeMultipleOrders` uses to decide between `Order.status` PENDING and
 * AWAITING (it flips to AWAITING only when every cart item has a purchaseId).
 */
export type CartItemObservation = {
  /** Pinned `CartItem.status` value. */
  status: string;
  purchaseId?: string | null;
  tracking?: "none" | "in_transit" | "delivered";
};

export type FulfillmentObservation = {
  match: { status: MatchStatus; canSubmit: boolean };
  cartItems: CartItemObservation[];
  cancelRequested?: boolean;
};

const hasPurchase = (item: CartItemObservation) =>
  typeof item.purchaseId === "string" && item.purchaseId.trim().length > 0;

export function deriveFulfillmentState({
  match,
  cartItems,
  cancelRequested = false,
}: FulfillmentObservation): FulfillmentState {
  if (cancelRequested) return S.CANCEL_REQUESTED;
  if (match.status === "INVALID" || !match.canSubmit) return S.MATCH_FAILED;
  if (cartItems.length === 0) return S.RECEIVED;

  // Certainty before progress: an unknown supplier outcome always outranks any
  // other observation, because local state may not reflect the supplier.
  if (cartItems.some(item => item.status === PURCHASE_STATE.UNKNOWN)) {
    return S.RECONCILIATION_REQUIRED;
  }
  if (cartItems.some(item => item.status === PURCHASE_STATE.PROCESSING)) {
    return S.SUBMITTING;
  }

  const purchased = cartItems.filter(
    item => hasPurchase(item) || item.status === PURCHASE_STATE.COMPLETE
  );
  const delivered = purchased.filter(item => item.tracking === "delivered").length;
  const shipped = purchased.filter(item => item.tracking === "in_transit").length;

  if (purchased.length === cartItems.length) {
    if (delivered === purchased.length) return S.DELIVERED;
    if (shipped === purchased.length) return S.SHIPPED;
    if (shipped + delivered > 0) return S.FULFILLING;
    return S.ACCEPTED;
  }

  // Purchase work remains (pinned Order.status stays PENDING here). Tracking on
  // any line means fulfillment has visibly started.
  return shipped + delivered > 0 ? S.FULFILLING : S.READY;
}
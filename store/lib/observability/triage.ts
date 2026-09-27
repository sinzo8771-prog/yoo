/**
 * Task 17, Step 3 — retry/reconciliation visibility.
 *
 * Answers the operator's two questions for one order — "WHY is it stuck?" and
 * "WHAT is safe to do?" — as a pure projection over the pinned fulfillment
 * state machine (Task 13 Step 5). It deliberately reuses
 * `operatorAction(state)` for the canonical next step so this view can never
 * contradict the state machine, and adds the age/retry awareness the state
 * machine itself (pure, clockless) intentionally does not have:
 *
 *  - waiting states past a per-state threshold → `stuck_stale`
 *  - failure states → `stuck_failure` (they never advance on their own)
 *  - RECONCILIATION_REQUIRED → `reconciliation_hold`, its own bucket,
 *    matching the plan's "reconciliation queue" operational view
 *  - repeated retry failures (>= RETRY_LIMIT attempts) are called out
 *    explicitly and add a do-not-blind-retry warning.
 *
 * `unsafeActions` encodes the pinned constraints from earlier tasks: no fresh
 * submission out of the hold, no resubmission while a claim is in flight, no
 * second purchase for an accepted line, local-only cancellation, and no
 * partially matched purchases.
 */

import {
  FULFILLMENT_STATE as S,
  isFailureState,
  isTerminal,
  operatorAction,
  type FulfillmentState,
} from "../fulfillment/reconciliation";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Per-state "no progress in this long ⇒ stale" thresholds. */
export const STALE_AFTER_MS: Partial<Record<FulfillmentState, number>> = {
  [S.RECEIVED]: DAY,
  [S.MATCHED]: DAY,
  [S.READY]: DAY,
  [S.SUBMITTING]: DAY,
  // Mirrors Task 14's 48h delayed-tracking rule: accepted, but no tracking.
  [S.ACCEPTED]: 48 * HOUR,
  [S.FULFILLING]: 48 * HOUR,
  [S.SHIPPED]: 10 * DAY,
  [S.CANCEL_REQUESTED]: DAY,
};

/** Attempts after which "retry" stops being safe advice. */
export const RETRY_LIMIT = 3;

export type TriageCategory =
  | "healthy"
  | "waiting"
  | "stuck_stale"
  | "stuck_failure"
  | "reconciliation_hold";

export type Triage = {
  state: FulfillmentState;
  category: TriageCategory;
  /** True only for categories an operator must act on. */
  stuck: boolean;
  terminal: boolean;
  /** One honest sentence: why this order is in this shape right now. */
  why: string;
  /** The state machine's canonical next step (never contradicted here). */
  operatorAction: string;
  /** Concrete safe next actions. */
  safeActions: string[];
  /** Actions that would violate a pinned constraint — never do these. */
  unsafeActions: string[];
  ageMs?: number;
  retryAttempts?: number;
};

const WAITING_STATES: FulfillmentState[] = [
  S.RECEIVED,
  S.MATCHED,
  S.READY,
  S.SUBMITTING,
  S.ACCEPTED,
  S.FULFILLING,
  S.SHIPPED,
  S.CANCEL_REQUESTED,
];

function unsafeActionsFor(state: FulfillmentState): string[] {
  switch (state) {
    case S.READY:
    case S.SUBMITTING:
      return ["Resubmit while an attempt is still in flight"];
    case S.ACCEPTED:
    case S.FULFILLING:
      return ["Create a second purchase for the same line"];
    case S.SHIPPED:
      return ["Mark delivered before the carrier confirms it"];
    case S.MATCH_FAILED:
      return ["Purchase partially matched lines"];
    case S.PROVIDER_REJECTED:
      return ["Resubmit the rejected request unchanged"];
    case S.RETRYABLE_ERROR:
      return ["Retry before confirming the previous attempt left no purchase behind"];
    case S.CANCEL_REQUESTED:
      return [
        "Tell the customer it is cancelled",
        "Assume the supplier stopped the shipment",
      ];
    case S.RECONCILIATION_REQUIRED:
      return ["Submit a fresh purchase", "Tell the customer the order failed"];
    default:
      return [];
  }
}

function safeActionsFor(state: FulfillmentState, attempts: number): string[] {
  const actions: string[] = [];
  if (isFailureState(state)) {
    actions.push("Re-read the order's current state before acting");
  }
  if (attempts >= RETRY_LIMIT) {
    actions.push("Escalate: inspect the provider record before any further attempt");
  }
  if (state === S.RECONCILIATION_REQUIRED) {
    actions.push("Compare local state with the supplier record by hand");
  }
  return actions;
}

export type TriageInput = {
  state: FulfillmentState;
  /** Milliseconds since the last recorded progress; omit if unknown. */
  ageMs?: number | null;
  /** Failed attempts recorded for this order, if tracked. */
  retryAttempts?: number | null;
};

export function triageOrder({
  state,
  ageMs = null,
  retryAttempts = null,
}: TriageInput): Triage {
  // Same discipline as nextStates: an unknown state is an error, not a
  // category we invent an answer for.
  if (!Object.values(S).includes(state)) {
    throw new Error(`Unknown fulfillment state: ${String(state)}`);
  }

  const age =
    typeof ageMs === "number" && Number.isFinite(ageMs) && ageMs >= 0
      ? Math.round(ageMs)
      : undefined;
  const attempts =
    typeof retryAttempts === "number" && Number.isFinite(retryAttempts) && retryAttempts >= 0
      ? Math.round(retryAttempts)
      : 0;

  const terminal = isTerminal(state);
  const staleLimit = STALE_AFTER_MS[state];
  const isStale = staleLimit !== undefined && age !== undefined && age > staleLimit;

  let category: TriageCategory;
  let why: string;

  if (terminal) {
    category = "healthy";
    why = `${state} — terminal; no further automatic or operator work is expected.`;
  } else if (state === S.RECONCILIATION_REQUIRED) {
    category = "reconciliation_hold";
    why =
      "Supplier outcome is unknown, so local state may not reflect the supplier. The hold only clears when a human compares the two.";
  } else if (isFailureState(state)) {
    category = "stuck_failure";
    why = `${state} is a failure state — it does not advance on its own.`;
    if (attempts >= RETRY_LIMIT) {
      why += ` ${attempts} failed attempts recorded: another blind retry is not safe.`;
    }
  } else if (isStale) {
    category = "stuck_stale";
    why = `${state} has had no recorded progress for ${formatDuration(
      age!
    )} (stale after ${formatDuration(staleLimit)}).`;
  } else if (WAITING_STATES.includes(state)) {
    category = "waiting";
    why =
      age === undefined
        ? `${state} is progressing normally; the next transition comes from the supplier or a callback.`
        : `${state} is within its expected window (${formatDuration(age)} so far).`;
  } else {
    category = "healthy";
    why = `${state} needs no attention.`;
  }

  return {
    state,
    category,
    stuck: category !== "healthy" && category !== "waiting",
    terminal,
    why,
    operatorAction: operatorAction(state),
    safeActions: safeActionsFor(state, attempts),
    unsafeActions: unsafeActionsFor(state),
    ...(age !== undefined ? { ageMs: age } : {}),
    ...(attempts > 0 ? { retryAttempts: attempts } : {}),
  };
}

function formatDuration(ms: number): string {
  if (ms < HOUR) return `${Math.round(ms / 60000)}m`;
  // Hours until a week: the thresholds operators reason about (24h/48h) are
  // in hours, and "2d" would blur a 49h breach of the 48h line.
  if (ms < 7 * DAY) return `${round1(ms / HOUR)}h`;
  return `${round1(ms / DAY)}d`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

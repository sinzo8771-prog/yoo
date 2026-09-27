import { describe, expect, it } from "vitest";
import {
  ALL_STATES,
  FAILURE_STATES,
  FULFILLMENT_STATE as S,
  TERMINAL_STATES,
  TRANSITIONS,
  deriveFulfillmentState,
  isFailureState,
  isTerminal,
  nextStates,
  operatorAction,
  reduce,
  transition,
  type FulfillmentEvent,
  type FulfillmentState,
} from "@/lib/fulfillment/reconciliation";

// Task 13 Step 5 + Step 6. The plan asks for explicit states and a test of every
// terminal and failure transition. Two pinned behaviours are encoded here:
//   - `cancelPurchase.ts` rewrites LOCAL STATUS ONLY, so cancellation cannot
//     jump straight to CANCELLED; it stops at CANCEL_REQUESTED.
//   - An uncertain supplier outcome is a hold, never a retry.

const HAPPY_EVENTS: FulfillmentEvent[] = [
  { type: "IMPORTED" },
  { type: "MATCH_VERIFIED" },
  { type: "READY_FOR_PURCHASE" },
  { type: "SUBMISSION_STARTED" },
  { type: "SUBMISSION_SUCCEEDED", purchaseId: "syn_purchase_1" },
  { type: "TRACKING_RECEIVED" },
  { type: "SHIPPED" },
  { type: "DELIVERED" },
];

describe("reconciliation state machine (Task 13 step 5)", () => {
  it("walks the full forward path from RECEIVED to DELIVERED", () => {
    let state: FulfillmentState = S.RECEIVED;
    const seen: FulfillmentState[] = [state];
    for (const event of HAPPY_EVENTS) {
      state = reduce(state, event);
      seen.push(state);
    }

    expect(seen).toEqual([
      S.RECEIVED,
      S.RECEIVED,
      S.MATCHED,
      S.READY,
      S.SUBMITTING,
      S.ACCEPTED,
      S.FULFILLING,
      S.SHIPPED,
      S.DELIVERED,
    ]);
    expect(isTerminal(state)).toBe(true);
  });

  it("has a closed transition table: every state's edges are declared and known", () => {
    for (const state of ALL_STATES) {
      expect(Object.keys(TRANSITIONS)).toContain(state);
      for (const next of nextStates(state)) {
        // No edge may point at a state that does not exist.
        expect(ALL_STATES).toContain(next);
      }
    }
    // Terminal states accept nothing.
    for (const state of TERMINAL_STATES) {
      expect(nextStates(state)).toEqual([]);
    }
  });

  it("routes every failure edge to a declared failure state", () => {
    // Match rejection.
    expect(reduce(S.RECEIVED, { type: "MATCH_REJECTED", reason: "var_a unmatched" })).toBe(
      S.MATCH_FAILED
    );
    // Provider rejection while submitting.
    expect(reduce(S.SUBMITTING, { type: "SUBMISSION_REJECTED", reason: "bad address" })).toBe(
      S.PROVIDER_REJECTED
    );
    // Retryable transport error.
    expect(reduce(S.READY, { type: "SUBMISSION_RETRYABLE" })).toBe(S.RETRYABLE_ERROR);
    expect(reduce(S.PROVIDER_REJECTED, { type: "SUBMISSION_RETRYABLE" })).toBe(
      S.RETRYABLE_ERROR
    );
    // Uncertain outcome is a hold, not a failure to retry.
    expect(reduce(S.SUBMITTING, { type: "SUBMISSION_UNKNOWN" })).toBe(
      S.RECONCILIATION_REQUIRED
    );

    for (const state of [S.MATCH_FAILED, S.PROVIDER_REJECTED, S.RETRYABLE_ERROR, S.RECONCILIATION_REQUIRED]) {
      expect(FAILURE_STATES).toContain(state);
      expect(isFailureState(state)).toBe(true);
      expect(isTerminal(state)).toBe(false);
    }
  });

  it("never treats an unknown supplier outcome as a retry", () => {
    const held = reduce(
      reduce(S.READY, { type: "SUBMISSION_STARTED" }),
      { type: "SUBMISSION_UNKNOWN", error: "socket hang up" }
    );

    expect(held).toBe(S.RECONCILIATION_REQUIRED);
    // The hold does not accept a direct resubmission — a human must release it.
    expect(() => reduce(held, { type: "SUBMISSION_STARTED" })).toThrow(
      /Illegal fulfillment transition RECONCILIATION_REQUIRED -> SUBMITTING/
    );
    // The hold is left deliberately, in two explicit steps.
    expect(reduce(held, { type: "RETRY_ALLOWED" })).toBe(S.READY);
    expect(reduce(held, { type: "OUTCOME_RECOVERED" })).toBe(S.ACCEPTED);
  });

  it("cannot cancel straight to CANCELLED because OpenShip only rewrites local status", () => {
    const requested = reduce(S.FULFILLING, { type: "CANCEL_REQUESTED" });
    expect(requested).toBe(S.CANCEL_REQUESTED);
    expect(() => transition(S.FULFILLING, S.CANCELLED)).toThrow(/Illegal fulfillment transition/);

    // Only a confirmed cancellation — or a refusal to acknowledge one — resolves it.
    expect(reduce(requested, { type: "CANCEL_CONFIRMED" })).toBe(S.CANCELLED);
    expect(reduce(requested, { type: "CANCEL_REFUSED" })).toBe(S.RECONCILIATION_REQUIRED);
  });

  it("protects terminal states from every event", () => {
    expect(() => reduce(S.DELIVERED, { type: "CANCEL_REQUESTED" })).toThrow(/terminal/);
    expect(() => reduce(S.CANCELLED, { type: "SHIPPED" })).toThrow(/terminal/);
    expect(() => transition(S.DELIVERED, S.FULFILLING)).toThrow(/DELIVERED is terminal/);
  });

  it("treats at-least-once callbacks as idempotent no-ops", () => {
    const accepted = reduce(S.SUBMITTING, {
      type: "SUBMISSION_SUCCEEDED",
      purchaseId: "syn_purchase_1",
    });
    expect(accepted).toBe(S.ACCEPTED);

    // The same event again, and a duplicate that arrives after tracking.
    expect(
      reduce(accepted, { type: "SUBMISSION_SUCCEEDED", purchaseId: "syn_purchase_1" })
    ).toBe(S.ACCEPTED);
    const shipped = reduce(reduce(accepted, { type: "SHIPPED" }), { type: "SHIPPED" });
    expect(shipped).toBe(S.SHIPPED);
    expect(
      reduce(shipped, { type: "SUBMISSION_SUCCEEDED", purchaseId: "syn_purchase_1" })
    ).toBe(S.SHIPPED);
  });

  it("treats a success response without a purchase ID as an uncertain outcome", () => {
    expect(reduce(S.SUBMITTING, { type: "SUBMISSION_SUCCEEDED", purchaseId: "  " })).toBe(
      S.RECONCILIATION_REQUIRED
    );
  });

  it("rejects unknown states, unknown events, and illegal forward jumps", () => {
    expect(() => reduce("NOT_A_STATE" as FulfillmentState, { type: "IMPORTED" })).toThrow(
      /Unknown fulfillment state/
    );
    expect(() => reduce(S.RECEIVED, { type: "NOT_AN_EVENT" } as unknown as FulfillmentEvent)).toThrow(
      /Unknown fulfillment event/
    );
    expect(() => reduce(S.RECEIVED, { type: "TRACKING_RECEIVED" })).toThrow(
      /Illegal fulfillment transition RECEIVED -> FULFILLING/
    );
  });

  it("tells the operator what to do in every state, and never promises a silent retry", () => {
    for (const state of ALL_STATES) {
      expect(operatorAction(state)).toBeTruthy();
    }
    expect(operatorAction(S.SUBMITTING)).toContain("never resubmit");
    expect(operatorAction(S.RECONCILIATION_REQUIRED)).toContain("Compare local state");
    expect(operatorAction(S.PROVIDER_REJECTED)).toContain("rejection");
  });
});

describe("state projection from pinned observations (Task 13 step 5)", () => {
  const ok = { status: "MATCHED" as const, canSubmit: true };
  const item = (overrides: Record<string, unknown> = {}) => ({
    status: "AWAITING",
    purchaseId: "syn_purchase_1",
    ...overrides,
  });

  it("reports MATCH_FAILED whenever the match is not submittable", () => {
    expect(deriveFulfillmentState({ match: { status: "INVALID", canSubmit: false }, cartItems: [] }))
      .toBe(S.MATCH_FAILED);
    expect(
      deriveFulfillmentState({
        match: { status: "PARTIAL", canSubmit: false },
        cartItems: [item()],
      })
    ).toBe(S.MATCH_FAILED);
  });

  it("stays RECEIVED while nothing has been matched", () => {
    expect(deriveFulfillmentState({ match: ok, cartItems: [] })).toBe(S.RECEIVED);
  });

  it("lets certainty outrank progress", () => {
    // One line unknown, one line complete: local state cannot be trusted at all.
    expect(
      deriveFulfillmentState({
        match: ok,
        cartItems: [
          item({ status: "PURCHASE_OUTCOME_UNKNOWN", purchaseId: "" }),
          item({ status: "PURCHASE_PROCESSING", purchaseId: "" }),
        ],
      })
    ).toBe(S.RECONCILIATION_REQUIRED);
  });

  it("reports SUBMITTING while a claim is in flight", () => {
    expect(
      deriveFulfillmentState({
        match: ok,
        cartItems: [item({ status: "PURCHASE_PROCESSING", purchaseId: "" })],
      })
    ).toBe(S.SUBMITTING);
  });

  it("walks the accepted -> fulfilling -> shipped -> delivered ladder", () => {
    const items = (tracking: "none" | "in_transit" | "delivered") => [
      item({ tracking }),
      item({ status: "AWAITING", purchaseId: "syn_purchase_2", tracking }),
    ];

    expect(deriveFulfillmentState({ match: ok, cartItems: items("none") })).toBe(S.ACCEPTED);
    expect(deriveFulfillmentState({ match: ok, cartItems: items("in_transit") })).toBe(S.SHIPPED);
    expect(deriveFulfillmentState({ match: ok, cartItems: items("delivered") })).toBe(S.DELIVERED);

    // Mixed tracking means fulfillment is visibly under way.
    expect(
      deriveFulfillmentState({
        match: ok,
        cartItems: [
          item({ tracking: "in_transit" }),
          item({ status: "AWAITING", purchaseId: "syn_purchase_2", tracking: "none" }),
        ],
      })
    ).toBe(S.FULFILLING);
  });

  it("treats un-purchased lines as remaining work, and shipped work as started", () => {
    // Pinned: Order.status stays PENDING until every cart item has a purchaseId.
    expect(
      deriveFulfillmentState({
        match: ok,
        cartItems: [item(), { status: "PENDING", purchaseId: "" }],
      })
    ).toBe(S.READY);

    expect(
      deriveFulfillmentState({
        match: ok,
        cartItems: [item({ tracking: "in_transit" }), { status: "PENDING", purchaseId: "" }],
      })
    ).toBe(S.FULFILLING);
  });

  it("always returns a known state that the operator can act on", () => {
    const cases = [
      ok,
      { status: "INVALID" as const, canSubmit: false },
      { status: "PARTIAL" as const, canSubmit: true },
    ];
    for (const match of cases) {
      const state = deriveFulfillmentState({ match, cartItems: [item()] });
      expect(ALL_STATES).toContain(state);
      expect(operatorAction(state)).toBeTruthy();
    }
  });

  it("records a cancellation request above every other observation", () => {
    expect(
      deriveFulfillmentState({
        match: ok,
        cartItems: [item({ tracking: "delivered" })],
        cancelRequested: true,
      })
    ).toBe(S.CANCEL_REQUESTED);
  });
});
/**
 * Task 17, Step 3 — retry/reconciliation visibility.
 *
 * Every state yields a triage with the state machine's own operatorAction
 * (never a contradiction), failure/hold/stale categories land where the
 * runbook expects them, thresholds are pinned at their boundaries, repeated
 * retries are called out, and unknown states throw instead of guessing.
 */
import { describe, expect, it } from "vitest";

import {
  ALL_STATES,
  FULFILLMENT_STATE as S,
  operatorAction,
} from "@/lib/fulfillment/reconciliation";
import {
  RETRY_LIMIT,
  STALE_AFTER_MS,
  triageOrder,
} from "@/lib/observability/triage";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("triageOrder over every state", () => {
  it("always returns a why and the state machine's own operatorAction", () => {
    for (const state of ALL_STATES) {
      const t = triageOrder({ state });
      expect(t.state).toBe(state);
      expect(t.why.length).toBeGreaterThan(10);
      // The triage view may never contradict the state machine.
      expect(t.operatorAction).toBe(operatorAction(state));
      expect(["healthy", "waiting", "stuck_stale", "stuck_failure", "reconciliation_hold"]).toContain(
        t.category
      );
    }
  });

  it("marks terminal states healthy and not stuck", () => {
    for (const state of [S.DELIVERED, S.CANCELLED]) {
      const t = triageOrder({ state, ageMs: 30 * DAY });
      expect(t).toMatchObject({ category: "healthy", stuck: false, terminal: true });
      expect(t.unsafeActions).toEqual([]);
    }
  });

  it("buckets the reconciliation hold separately, with pinned unsafe actions", () => {
    const t = triageOrder({ state: S.RECONCILIATION_REQUIRED });
    expect(t).toMatchObject({
      category: "reconciliation_hold",
      stuck: true,
      terminal: false,
    });
    expect(t.unsafeActions).toContain("Submit a fresh purchase");
    expect(t.unsafeActions).toContain("Tell the customer the order failed");
    expect(t.safeActions).toContain("Compare local state with the supplier record by hand");
    expect(t.why).toMatch(/supplier/i);
  });

  it("classifies the other failure states as stuck_failure", () => {
    for (const state of [S.MATCH_FAILED, S.PROVIDER_REJECTED, S.RETRYABLE_ERROR]) {
      const t = triageOrder({ state });
      expect(t).toMatchObject({ category: "stuck_failure", stuck: true });
      expect(t.safeActions).toContain("Re-read the order's current state before acting");
    }
  });

  it("keeps pinned unsafe actions for in-flight and cancellation states", () => {
    expect(triageOrder({ state: S.SUBMITTING }).unsafeActions).toContain(
      "Resubmit while an attempt is still in flight"
    );
    expect(triageOrder({ state: S.CANCEL_REQUESTED }).unsafeActions).toContain(
      "Tell the customer it is cancelled"
    );
    expect(triageOrder({ state: S.MATCH_FAILED }).unsafeActions).toContain(
      "Purchase partially matched lines"
    );
  });
});

describe("staleness thresholds", () => {
  it("flags RECEIVED past 24h, but not at exactly 24h (boundary is exclusive)", () => {
    expect(triageOrder({ state: S.RECEIVED, ageMs: DAY }).category).toBe("waiting");
    expect(triageOrder({ state: S.RECEIVED, ageMs: DAY + 1 }).category).toBe("stuck_stale");
  });

  it("flags ACCEPTED only past 48h — matching the delayed-tracking rule", () => {
    expect(triageOrder({ state: S.ACCEPTED, ageMs: 47 * HOUR }).category).toBe("waiting");
    const stale = triageOrder({ state: S.ACCEPTED, ageMs: 49 * HOUR });
    expect(stale).toMatchObject({ category: "stuck_stale", stuck: true });
    expect(stale.why).toContain("49h");
  });

  it("flags long-shipped and cancel-requested orders too", () => {
    expect(triageOrder({ state: S.SHIPPED, ageMs: 9 * DAY }).category).toBe("waiting");
    expect(triageOrder({ state: S.SHIPPED, ageMs: 11 * DAY }).category).toBe("stuck_stale");
    expect(triageOrder({ state: S.CANCEL_REQUESTED, ageMs: 2 * DAY }).category).toBe(
      "stuck_stale"
    );
  });

  it("ignores unknown, negative, or nonsensical ages", () => {
    for (const ageMs of [null, undefined, -1, NaN]) {
      expect(triageOrder({ state: S.RECEIVED, ageMs: ageMs as any }).category).toBe(
        "waiting"
      );
    }
    // Failure states are stuck on their own merits, with or without an age.
    expect(triageOrder({ state: S.RETRYABLE_ERROR, ageMs: null }).stuck).toBe(true);
  });

  it("publishes exactly the states that have thresholds", () => {
    expect(Object.keys(STALE_AFTER_MS).sort()).toEqual(
      [
        S.ACCEPTED,
        S.CANCEL_REQUESTED,
        S.FULFILLING,
        S.MATCHED,
        S.READY,
        S.RECEIVED,
        S.SHIPPED,
        S.SUBMITTING,
      ].sort()
    );
  });
});

describe("repeated retry failures", () => {
  it("calls out attempts at the limit and adds escalation + no-blind-retry", () => {
    const t = triageOrder({
      state: S.RETRYABLE_ERROR,
      retryAttempts: RETRY_LIMIT,
    });

    expect(t.retryAttempts).toBe(RETRY_LIMIT);
    expect(t.why).toContain("3 failed attempts");
    expect(t.why).toContain("blind retry is not safe");
    expect(t.safeActions).toContain(
      "Escalate: inspect the provider record before any further attempt"
    );
    expect(t.unsafeActions).toContain(
      "Retry before confirming the previous attempt left no purchase behind"
    );
  });

  it("stays quiet below the limit and omits zero attempts", () => {
    expect(triageOrder({ state: S.RETRYABLE_ERROR, retryAttempts: 2 }).why).not.toContain(
      "failed attempts"
    );
    expect(triageOrder({ state: S.READY, retryAttempts: 0 })).not.toHaveProperty(
      "retryAttempts"
    );
  });
});

describe("unknown states", () => {
  it("throws instead of inventing a category", () => {
    expect(() =>
      triageOrder({ state: "TELEPORTED" as never })
    ).toThrow(/Unknown fulfillment state/);
  });
});

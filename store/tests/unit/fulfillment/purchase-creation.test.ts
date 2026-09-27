import { describe, expect, it } from "vitest";
import {
  PURCHASE_PATH,
  PURCHASE_STATE,
  STALE_CLAIM_MS,
  planPurchaseCreation,
  recordPurchaseOutcome,
  sourcePurchaseAttemptKey,
  type PurchaseAttempt,
  type PurchaseIntent,
} from "@/lib/fulfillment/purchaseCreation";

// Task 13 Step 4 (and Step 6 coverage). Two verified pinned facts drive every
// assertion below:
//   - `createChannelPurchase.ts` drops `idempotencyKey` (it lands in
//     `...otherData`) and never forwards channel credentials, so that mutation
//     can create a duplicate supplier order on retry.
//   - `placeMultipleOrders.ts` DOES forward `claim.attemptKey` as
//     `idempotencyKey`, and `supplierPurchaseClaim.ts` deliberately refuses to
//     lease-steal a PROCESSING/UNKNOWN claim.

const intent = (overrides: Partial<PurchaseIntent> = {}): PurchaseIntent => ({
  sourceOrderId: "of_order_1",
  channelId: "channel_a",
  cartItemIds: ["ci-2", "ci-1"],
  createPurchaseFunction: "synthetic",
  ...overrides,
});

const attempt = (overrides: Partial<PurchaseAttempt> = {}): PurchaseAttempt => ({
  attemptKey: sourcePurchaseAttemptKey(intent()),
  channelId: "channel_a",
  cartItemIds: ["ci-1", "ci-2"],
  purchaseId: "",
  state: PURCHASE_STATE.PROCESSING,
  claimedAt: new Date("2026-09-19T10:00:00.000Z"),
  ...overrides,
});

describe("purchase creation (Task 13 step 4)", () => {
  it("derives one stable key per source order and fulfillment action", () => {
    const key = sourcePurchaseAttemptKey(intent());

    // Same inputs, and item order/dedup must not change the key.
    expect(sourcePurchaseAttemptKey(intent())).toBe(key);
    expect(
      sourcePurchaseAttemptKey(intent({ cartItemIds: ["ci-1", "ci-2", "ci-1"] }))
    ).toBe(key);

    // Different source order, channel, or item set is a different action.
    expect(sourcePurchaseAttemptKey(intent({ sourceOrderId: "of_order_2" }))).not.toBe(key);
    expect(sourcePurchaseAttemptKey(intent({ channelId: "channel_b" }))).not.toBe(key);
    expect(sourcePurchaseAttemptKey(intent({ cartItemIds: ["ci-1"] }))).not.toBe(key);

    // Rooted in the permanent source correlation key (Step 2).
    expect(key).toMatch(/^source-purchase:[0-9a-f]{64}$/);
  });

  it("refuses to build a key without a source order, channel, or items", () => {
    expect(() => sourcePurchaseAttemptKey(intent({ sourceOrderId: "" }))).toThrow(/source order/);
    expect(() => sourcePurchaseAttemptKey(intent({ channelId: " " }))).toThrow(/channel/);
    expect(() => sourcePurchaseAttemptKey(intent({ cartItemIds: [] }))).toThrow(/cart item/);
  });

  it("allows exactly one keyed submission when nothing has claimed the items", () => {
    const plan = planPurchaseCreation({ intent: intent() });

    expect(plan.action).toBe("submit");
    expect(plan.attemptKey).toBe(sourcePurchaseAttemptKey(intent()));
    expect(plan.reason).toContain("No prior attempt");
  });

  it("reuses a persisted purchase ID and issues no second request", () => {
    const plan = planPurchaseCreation({
      intent: intent(),
      attempts: [
        attempt({ purchaseId: "syn_purchase_abc", state: PURCHASE_STATE.COMPLETE }),
      ],
    });

    expect(plan.action).toBe("reuse");
    expect(plan.purchaseId).toBe("syn_purchase_abc");
    expect(plan.reason).toContain("never request a second one");
  });

  it("blocks a resubmit while the same claim is still in flight", () => {
    const now = new Date("2026-09-19T10:01:00.000Z").getTime();
    const plan = planPurchaseCreation({ intent: intent(), attempts: [attempt()], now });

    expect(plan.action).toBe("blocked");
    expect(plan.state).toBe(PURCHASE_STATE.PROCESSING);
    expect(plan.reason).toContain("not lease-stealable");
  });

  it("refuses to auto-retry a stale claim and names the openfront exception", () => {
    const claimedAt = new Date("2026-09-19T10:00:00.000Z");
    const now = claimedAt.getTime() + STALE_CLAIM_MS;

    const openfront = planPurchaseCreation({
      intent: intent({ createPurchaseFunction: "openfront" }),
      attempts: [attempt({ claimedAt })],
      now,
    });
    expect(openfront.action).toBe("blocked");
    expect(openfront.reason).toContain("stale");
    expect(openfront.reason).toContain("openfront channel");

    const supplier = planPurchaseCreation({
      intent: intent(),
      attempts: [attempt({ claimedAt })],
      now,
    });
    expect(supplier.action).toBe("blocked");
    expect(supplier.reason).toContain("no verified retry contract");
  });

  it("holds an unknown outcome for reconciliation instead of resubmitting", () => {
    const plan = planPurchaseCreation({
      intent: intent(),
      attempts: [attempt({ state: PURCHASE_STATE.UNKNOWN })],
    });

    expect(plan.action).toBe("reconcile");
    expect(plan.state).toBe(PURCHASE_STATE.UNKNOWN);
    expect(plan.reason).toContain("unknown");
  });

  it("blocks items another fulfillment action already claimed", () => {
    const plan = planPurchaseCreation({
      intent: intent(),
      attempts: [
        attempt({
          attemptKey: "source-purchase:someone-else",
          cartItemIds: ["ci-1"],
          state: PURCHASE_STATE.PROCESSING,
        }),
      ],
    });

    expect(plan.action).toBe("blocked");
    expect(plan.reason).toContain("source-purchase:someone-else");
  });

  it("refuses the pinned mutation path that drops the idempotency key", () => {
    const plan = planPurchaseCreation({
      intent: intent(),
      path: PURCHASE_PATH.GRAPHQL_MUTATION,
    });

    expect(plan.action).toBe("blocked");
    expect(plan.reason).toContain("createChannelPurchase mutation drops idempotencyKey");
  });

  it("fails closed when the channel has no purchase function configured", () => {
    expect(() =>
      planPurchaseCreation({ intent: intent({ createPurchaseFunction: "" }) })
    ).toThrow(/createPurchaseFunction/);
  });

  it("reconciles an attempt found in an unrecognised state", () => {
    const plan = planPurchaseCreation({
      intent: intent(),
      attempts: [attempt({ state: "WEIRD" })],
    });

    expect(plan.action).toBe("reconcile");
    expect(plan.reason).toContain("WEIRD");
  });

  it("records a complete purchase only when the supplier returned an ID", () => {
    const entry = recordPurchaseOutcome({
      intent: intent(),
      outcome: { purchaseId: " syn_purchase_abc ", url: "https://supplier.test/p/abc" },
    });

    expect(entry).toMatchObject({
      purchaseId: "syn_purchase_abc",
      url: "https://supplier.test/p/abc",
      state: PURCHASE_STATE.COMPLETE,
      error: "",
      sourceOrderId: "of_order_1",
      channelId: "channel_a",
    });
    // Cart items are stored deduped and sorted, matching the pinned read order.
    expect(entry.cartItemIds).toEqual(["ci-1", "ci-2"]);
  });

  it("treats a missing or blank purchase ID as an unknown outcome", () => {
    const missing = recordPurchaseOutcome({ intent: intent(), outcome: {} });
    expect(missing.state).toBe(PURCHASE_STATE.UNKNOWN);
    expect(missing.purchaseId).toBe("");
    expect(missing.error).toContain("Supplier returned no purchase ID");

    const blank = recordPurchaseOutcome({
      intent: intent(),
      outcome: { purchaseId: "   ", error: "gateway timeout" },
    });
    expect(blank.state).toBe(PURCHASE_STATE.UNKNOWN);
    // Pinned error format: PURCHASE_OUTCOME_UNKNOWN [<attemptKey>]: <reason>
    expect(blank.error).toBe(
      `PURCHASE_OUTCOME_UNKNOWN [${blank.attemptKey}]: gateway timeout`
    );
  });

  it("persists the outcome before any retry can create a second request", () => {
    // Round trip: adapter result -> ledger entry -> next plan.
    const complete = recordPurchaseOutcome({
      intent: intent(),
      outcome: { purchaseId: "syn_purchase_xyz" },
    });
    const reuse = planPurchaseCreation({ intent: intent(), attempts: [complete] });
    expect(reuse.action).toBe("reuse");
    expect(reuse.purchaseId).toBe("syn_purchase_xyz");

    const unknown = recordPurchaseOutcome({
      intent: intent(),
      outcome: { error: "connection reset after send" },
    });
    const reconcile = planPurchaseCreation({ intent: intent(), attempts: [unknown] });
    expect(reconcile.action).toBe("reconcile");
    expect(reconcile.reason).toContain("cannot be resubmitted automatically");
  });
});
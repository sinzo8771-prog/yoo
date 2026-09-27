import { describe, expect, it } from "vitest";
import {
  MATCH_FAULT,
  verifyOrderMatch,
  type MatchedCartItem,
  type SourceLine,
} from "@/lib/fulfillment/matchVerification";

// Task 13 Step 3 (and Step 6 coverage): the guard the pinned router does not
// have. `matchOrder.ts` only purchases what an operator matched, and
// `findChannelItems` reuses one ChannelItem for identical (variant, quantity)
// pairs, so an unverified partial match silently under-ships.

const line = (lineItemId: string, variantId: string, quantity: number): SourceLine => ({
  lineItemId,
  productId: `prod_${variantId}`,
  variantId,
  quantity,
});

const item = (
  cartItemId: string,
  channelId: string,
  variantId: string,
  quantity: number
): MatchedCartItem => ({
  cartItemId,
  channelId,
  productId: `prod_${variantId}`,
  variantId,
  quantity,
});

describe("match verification (Task 13 step 3)", () => {
  it("accepts an exact multi-variant, multi-quantity match across channels", () => {
    const result = verifyOrderMatch({
      lines: [line("li-1", "var_a", 2), line("li-2", "var_b", 1), line("li-3", "var_c", 3)],
      cartItems: [
        item("ci-1", "channel_b", "var_b", 1),
        item("ci-2", "channel_a", "var_a", 2),
        item("ci-3", "channel_a", "var_c", 3),
      ],
    });

    expect(result.status).toBe("MATCHED");
    expect(result.canSubmit).toBe(true);
    expect(result.faults).toEqual([]);
    expect(result.shortfalls).toEqual([]);
    // Deterministic channel ordering, despite unsorted cart items.
    expect(result.submittableChannelIds).toEqual(["channel_a", "channel_b"]);
    expect(result.summary).toContain("Full match");
  });

  it("rejects an unmatched line by default and reports the shortfall", () => {
    const result = verifyOrderMatch({
      lines: [line("li-1", "var_a", 1), line("li-2", "var_b", 2)],
      cartItems: [item("ci-1", "channel_a", "var_a", 1)],
    });

    expect(result.status).toBe("PARTIAL");
    expect(result.canSubmit).toBe(false);
    expect(result.submittableChannelIds).toEqual([]);
    expect(result.faults).toEqual([
      expect.objectContaining({
        kind: MATCH_FAULT.UNMATCHED_LINE,
        severity: "partial",
        variantId: "var_b",
        expected: 2,
        matched: 0,
      }),
    ]);
    expect(result.shortfalls).toEqual([{ variantId: "var_b", expected: 2, matched: 0 }]);
  });

  it("ships only the fault-free channels when partial fulfillment is approved", () => {
    const result = verifyOrderMatch({
      lines: [line("li-1", "var_a", 1), line("li-2", "var_b", 2)],
      cartItems: [
        item("ci-1", "channel_a", "var_a", 1),
        item("ci-2", "channel_b", "var_b", 2),
      ],
      policy: { allowPartialFulfillment: true },
    });

    // Both channels are complete for the variants they hold, so nothing is a
    // fault here: the order is fully matched.
    expect(result.status).toBe("MATCHED");
    expect(result.canSubmit).toBe(true);
    expect(result.submittableChannelIds).toEqual(["channel_a", "channel_b"]);
  });

  it("ships the short line only when the partial rule allows it, and keeps the gap visible", () => {
    const lines = [line("li-1", "var_a", 3), line("li-2", "var_b", 1)];
    const cartItems = [
      item("ci-1", "channel_a", "var_a", 2),
      item("ci-2", "channel_b", "var_b", 1),
    ];

    // Strict: a short line blocks the whole order, so no channel is exposed.
    const strict = verifyOrderMatch({ lines, cartItems });
    expect(strict.status).toBe("PARTIAL");
    expect(strict.canSubmit).toBe(false);
    expect(strict.submittableChannelIds).toEqual([]);
    expect(strict.shortfalls).toEqual([{ variantId: "var_a", expected: 3, matched: 2 }]);

    // Approved partial: the matched portion may ship from both channels, and the
    // missing quantity stays recorded for the operator and the customer.
    const partial = verifyOrderMatch({
      lines,
      cartItems,
      policy: { allowPartialFulfillment: true },
    });
    expect(partial.status).toBe("PARTIAL");
    expect(partial.canSubmit).toBe(true);
    expect(partial.submittableChannelIds).toEqual(["channel_a", "channel_b"]);
    expect(partial.shortfalls).toEqual([{ variantId: "var_a", expected: 3, matched: 2 }]);
    expect(partial.summary).toContain("Partial fulfillment approved");
  });

  it("never allows over-purchase, even under the partial rule", () => {
    const result = verifyOrderMatch({
      lines: [line("li-1", "var_a", 1)],
      cartItems: [item("ci-1", "channel_a", "var_a", 2)],
      policy: { allowPartialFulfillment: true },
    });

    expect(result.status).toBe("PARTIAL");
    expect(result.canSubmit).toBe(false);
    expect(result.submittableChannelIds).toEqual([]);
    expect(result.faults[0]).toMatchObject({
      kind: MATCH_FAULT.QUANTITY_EXCESS,
      severity: "blocking",
      expected: 1,
      matched: 2,
    });
  });

  it("refuses a cart item the customer never ordered", () => {
    const result = verifyOrderMatch({
      lines: [line("li-1", "var_a", 1)],
      cartItems: [
        item("ci-1", "channel_a", "var_a", 1),
        item("ci-2", "channel_b", "var_extra", 1),
      ],
      policy: { allowPartialFulfillment: true },
    });

    expect(result.canSubmit).toBe(false);
    expect(result.submittableChannelIds).toEqual([]);
    expect(result.faults).toEqual([
      expect.objectContaining({
        kind: MATCH_FAULT.UNLINKED_CART_ITEM,
        severity: "blocking",
        cartItemId: "ci-2",
        channelId: "channel_b",
      }),
    ]);
  });

  it("detects the pinned ChannelItem reuse that silently drops a duplicate line", () => {
    // Two identical (variant, quantity) lines: findChannelItems reuses one
    // ChannelItem, so the router can only ever buy one of the two.
    const lines = [line("li-1", "var_a", 2), line("li-2", "var_a", 2)];
    const cartItems = [item("ci-1", "channel_a", "var_a", 2)];

    const strict = verifyOrderMatch({ lines, cartItems });
    expect(strict.canSubmit).toBe(false);
    expect(strict.faults.map(f => f.kind).sort()).toEqual([
      MATCH_FAULT.COLLAPSED_SOURCE_LINE,
      MATCH_FAULT.QUANTITY_SHORTFALL,
    ]);
    expect(strict.shortfalls).toEqual([{ variantId: "var_a", expected: 4, matched: 2 }]);

    // Under the partial rule the one line the router will really buy may ship,
    // and the missing quantity stays visible.
    const partial = verifyOrderMatch({
      lines,
      cartItems,
      policy: { allowPartialFulfillment: true },
    });
    expect(partial.canSubmit).toBe(true);
    expect(partial.submittableChannelIds).toEqual(["channel_a"]);
    expect(partial.shortfalls).toEqual([{ variantId: "var_a", expected: 4, matched: 2 }]);
  });

  it("refuses one variant split across two channels (double-sourcing)", () => {
    const result = verifyOrderMatch({
      lines: [line("li-1", "var_a", 2)],
      cartItems: [
        item("ci-1", "channel_a", "var_a", 1),
        item("ci-2", "channel_b", "var_a", 1),
      ],
      policy: { allowPartialFulfillment: true },
    });

    expect(result.canSubmit).toBe(false);
    expect(result.submittableChannelIds).toEqual([]);
    expect(result.faults).toEqual([
      expect.objectContaining({
        kind: MATCH_FAULT.MULTI_CHANNEL_VARIANT,
        severity: "blocking",
        variantId: "var_a",
      }),
    ]);
    expect(result.faults[0].message).toContain("channel_a, channel_b");
  });

  it("fails closed on an uninterpretable line identity or quantity", () => {
    const result = verifyOrderMatch({
      lines: [
        { lineItemId: "li-1", productId: "p", variantId: "", quantity: 1 },
        { lineItemId: "li-2", productId: "p", variantId: "var_b", quantity: 0 },
      ],
      cartItems: [],
    });

    expect(result.status).toBe("INVALID");
    expect(result.canSubmit).toBe(false);
    expect(result.faults).toHaveLength(2);
    expect(result.faults.every(f => f.kind === MATCH_FAULT.INVALID_LINE)).toBe(true);
    expect(result.faults[0].severity).toBe("blocking");
  });

  it("treats an entirely unmatched order as a blocked partial match", () => {
    const result = verifyOrderMatch({
      lines: [line("li-1", "var_a", 1)],
      cartItems: [],
    });

    expect(result.status).toBe("PARTIAL");
    expect(result.canSubmit).toBe(false);
    expect(result.summary).toContain(MATCH_FAULT.UNMATCHED_LINE);
  });

  it("is deterministic for the same input", () => {
    const lines = [line("li-2", "var_b", 1), line("li-1", "var_a", 2)];
    const cartItems = [
      item("ci-2", "channel_b", "var_b", 1),
      item("ci-1", "channel_a", "var_a", 1),
    ];
    const first = verifyOrderMatch({ lines, cartItems });
    const second = verifyOrderMatch({ lines, cartItems });

    expect(first).toEqual(second);
    expect(first.shortfalls).toEqual([{ variantId: "var_a", expected: 2, matched: 1 }]);
    // Strict policy: a short line is not submittable at all.
    expect(first.submittableChannelIds).toEqual([]);
    // Approved partial: both channels are exposed, in a stable order.
    expect(
      verifyOrderMatch({
        lines,
        cartItems,
        policy: { allowPartialFulfillment: true },
      }).submittableChannelIds
    ).toEqual(["channel_a", "channel_b"]);
  });
});

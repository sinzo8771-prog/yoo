/**
 * Task 17, Step 1 — correlation IDs.
 *
 * Pins the closed key set, the construct-field-by-field guarantee (extra
 * input keys like secretKey/proof never survive), bounds, the fixed-order
 * summary, and the hop coverage the plan requires (customer order → Openfront
 * order → OpenShip order → provider purchase).
 */
import { describe, expect, it } from "vitest";

import {
  CORRELATION_KEYS,
  MAX_CORRELATION_ID_LENGTH,
  buildCorrelation,
  correlationSummary,
  knownHops,
  newTraceId,
} from "@/lib/observability/correlation";

describe("correlation keys (Step 1)", () => {
  it("is a closed set of exactly the traceable hops", () => {
    expect([...CORRELATION_KEYS]).toEqual([
      "traceId",
      "sourceOrderId",
      "openshipOrderId",
      "purchaseId",
      "cartId",
    ]);
  });

  it("mints UUID trace ids that do not collide", () => {
    const a = newTraceId();
    const b = newTraceId();
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(a).not.toBe(b);
  });
});

describe("buildCorrelation", () => {
  it("keeps whitelisted string ids and drops everything else", () => {
    const out = buildCorrelation({
      sourceOrderId: "of_1",
      cartId: "c-1",
      // Everything below must never survive:
      secretKey: "sekrit",
      proof: "p-123",
      authorization: "Bearer xyz",
      payload: { card: "4242" },
      purchaseId: 42 as unknown as string, // wrong type
      openshipOrderId: "   ", // empty after trim
      traceId: null,
    });

    expect(out).toEqual({ sourceOrderId: "of_1", cartId: "c-1" });
    expect(JSON.stringify(out)).not.toMatch(/sekrit|Bearer|4242|proof/);
  });

  it("truncates oversized ids instead of obeying them", () => {
    const huge = "x".repeat(MAX_CORRELATION_ID_LENGTH * 3);
    const out = buildCorrelation({ sourceOrderId: huge });
    expect(out.sourceOrderId).toHaveLength(MAX_CORRELATION_ID_LENGTH);
  });

  it("handles null/undefined/non-object input without throwing", () => {
    expect(buildCorrelation(null)).toEqual({});
    expect(buildCorrelation(undefined)).toEqual({});
    expect(buildCorrelation("oops" as unknown as object)).toEqual({});
  });
});

describe("correlationSummary", () => {
  it("renders present hops in fixed order, without the trace id", () => {
    expect(
      correlationSummary({
        traceId: "t-1",
        purchaseId: "pur_3",
        sourceOrderId: "of_1",
        openshipOrderId: "osh_2",
      })
    ).toBe("sourceOrder=of_1 openshipOrder=osh_2 purchase=pur_3");
  });

  it("says so plainly when nothing is known", () => {
    expect(correlationSummary({})).toBe("(no correlation yet)");
    expect(correlationSummary(null)).toBe("(no correlation yet)");
  });
});

describe("knownHops", () => {
  it("reports the full chain the plan requires", () => {
    expect(
      knownHops({
        sourceOrderId: "of_1",
        openshipOrderId: "osh_1",
        purchaseId: "pur_1",
        cartId: "c-1",
        traceId: "t-1",
      })
    ).toEqual(["sourceOrder", "openshipOrder", "purchase", "cart", "trace"]);
  });

  it("reports partial chains honestly", () => {
    expect(knownHops({ sourceOrderId: "of_1" })).toEqual(["sourceOrder"]);
    expect(knownHops({})).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

/**
 * Task 19, Step 4 (unit) — funnel aggregation.
 *
 * Beyond the arithmetic, these tests pin the *shape* of what is retained: a
 * snapshot holds counters, minor-unit totals, currency codes and day keys, and
 * nothing that could identify a visitor.
 */

import { PII_KEY_PATTERN, type AnalyticsEventName } from "@/lib/analytics/events";
import {
  DEFAULT_FUNNEL_RETENTION_DAYS,
  createFunnelAggregator,
  utcDayKey,
} from "@/lib/analytics/funnel";

const DAY_ONE = new Date("2026-09-23T10:00:00.000Z");
const DAY_TWO = new Date("2026-09-24T10:00:00.000Z");

describe("utcDayKey", () => {
  it("buckets by UTC day", () => {
    expect(utcDayKey(new Date("2026-09-23T23:59:59.999Z"))).toBe("2026-09-23");
    expect(utcDayKey(new Date("2026-09-24T00:00:00.000Z"))).toBe("2026-09-24");
  });
});

describe("createFunnelAggregator", () => {
  it("counts every event and totals all of them", () => {
    const funnel = createFunnelAggregator();
    const record = (event: AnalyticsEventName) =>
      funnel.record({ event }, DAY_ONE);

    record("view_product");
    record("view_product");
    record("add_to_cart");
    record("begin_checkout");
    record("checkout_success");
    record("purchase");
    record("view_order");
    record("view_tracking");

    const snapshot = funnel.snapshot();
    expect(snapshot.totals).toEqual({
      view_product: 2,
      add_to_cart: 1,
      begin_checkout: 1,
      checkout_success: 1,
      purchase: 1,
      view_order: 1,
      view_tracking: 1,
    });
    expect(snapshot.recorded).toBe(8);
  });

  it("computes step and cumulative conversion without inventing a rate from zero", () => {
    const funnel = createFunnelAggregator();
    const record = (event: AnalyticsEventName) => funnel.record({ event }, DAY_ONE);

    for (let i = 0; i < 10; i += 1) record("view_product");
    for (let i = 0; i < 5; i += 1) record("add_to_cart");
    record("begin_checkout");
    record("purchase");

    const { stages } = funnel.snapshot();
    expect(stages.map((stage) => stage.stage)).toEqual([
      "view_product",
      "add_to_cart",
      "begin_checkout",
      "purchase",
    ]);
    expect(stages[0]).toMatchObject({ count: 10, fromPrevious: null, fromStart: null });
    expect(stages[1]).toMatchObject({ count: 5, fromPrevious: 0.5, fromStart: 0.5 });
    expect(stages[2]).toMatchObject({ count: 1, fromPrevious: 0.2, fromStart: 0.1 });
    expect(stages[3]).toMatchObject({ count: 1, fromPrevious: 1, fromStart: 0.1 });
  });

  it("returns null rates when the funnel has no entry point", () => {
    const funnel = createFunnelAggregator();
    funnel.record({ event: "add_to_cart" }, DAY_ONE);
    const { stages } = funnel.snapshot();
    expect(stages[0]).toMatchObject({ count: 0, fromPrevious: null, fromStart: null });
    expect(stages[1]).toMatchObject({ count: 1, fromPrevious: null, fromStart: null });
  });

  it("sums purchase value only, and collects currency codes", () => {
    const funnel = createFunnelAggregator();

    funnel.record({ event: "purchase", props: { valueMinor: 4500, currency: "usd", itemCount: 2 } }, DAY_ONE);
    funnel.record({ event: "purchase", props: { valueMinor: 1000, currency: "USD" } }, DAY_ONE);
    // A cart value is not revenue, and an unparseable currency is ignored.
    funnel.record({ event: "view_cart", props: { valueMinor: 999_999, currency: "dollars" } }, DAY_ONE);
    funnel.record({ event: "add_to_cart", props: { valueMinor: 500, currency: "usd" } }, DAY_ONE);

    const snapshot = funnel.snapshot();
    expect(snapshot.purchaseValueMinor).toBe(5500);
    expect(snapshot.currencies).toEqual(["USD"]);
  });

  it("ignores a purchase value that is not a finite, non-negative number", () => {
    const funnel = createFunnelAggregator();
    funnel.record({ event: "purchase", props: { valueMinor: Number.NaN } }, DAY_ONE);
    funnel.record({ event: "purchase", props: { valueMinor: -100 } }, DAY_ONE);
    expect(funnel.snapshot().purchaseValueMinor).toBe(0);
  });

  it("keeps days separate but reports them together", () => {
    const funnel = createFunnelAggregator();
    funnel.record({ event: "view_product" }, DAY_ONE);
    funnel.record({ event: "view_product" }, DAY_TWO);
    funnel.record({ event: "purchase", props: { valueMinor: 100, currency: "USD" } }, DAY_TWO);

    const snapshot = funnel.snapshot();
    expect(snapshot.days).toEqual(["2026-09-23", "2026-09-24"]);
    expect(snapshot.totals.view_product).toBe(2);
    expect(snapshot.purchaseValueMinor).toBe(100);
    expect(funnel.dayCount()).toBe(2);
  });

  it("bounds retention to the newest days", () => {
    const funnel = createFunnelAggregator({ maxDays: 3 });
    for (let day = 1; day <= 6; day += 1) {
      funnel.record({ event: "view_product" }, new Date(Date.UTC(2026, 8, day, 12)));
    }
    expect(funnel.dayCount()).toBe(3);
    expect(funnel.snapshot().days).toEqual(["2026-09-04", "2026-09-05", "2026-09-06"]);
  });

  it("retains 30 days by default", () => {
    const funnel = createFunnelAggregator();
    for (let day = 1; day <= DEFAULT_FUNNEL_RETENTION_DAYS + 5; day += 1) {
      funnel.record({ event: "view_product" }, new Date(Date.UTC(2026, 0, day, 12)));
    }
    expect(funnel.dayCount()).toBe(DEFAULT_FUNNEL_RETENTION_DAYS);
  });

  it("ignores unknown event names rather than counting them", () => {
    const funnel = createFunnelAggregator();
    funnel.record({ event: "page_view" as AnalyticsEventName }, DAY_ONE);
    expect(funnel.snapshot().recorded).toBe(0);
  });

  it("stores no identifier of any kind", () => {
    const funnel = createFunnelAggregator();
    funnel.record({ event: "purchase", props: { valueMinor: 100, currency: "USD" } }, DAY_ONE);

    const snapshot = funnel.snapshot();
    expect(Object.keys(snapshot).sort()).toEqual([
      "currencies",
      "days",
      "purchaseValueMinor",
      "recorded",
      "stages",
      "totals",
    ]);
    expect(Object.keys(snapshot.stages[0]).sort()).toEqual([
      "count",
      "fromPrevious",
      "fromStart",
      "stage",
    ]);

    const serialized = JSON.stringify(snapshot);
    for (const token of ["email", "ip", "session", "cookie", "userAgent", "orderId"]) {
      expect(serialized).not.toContain(token);
    }
    for (const key of Object.keys(snapshot.totals)) {
      expect(PII_KEY_PATTERN.test(key), key).toBe(false);
    }
  });

  it("resets on demand", () => {
    const funnel = createFunnelAggregator();
    funnel.record({ event: "view_product" }, DAY_ONE);
    funnel.reset();
    expect(funnel.dayCount()).toBe(0);
    expect(funnel.snapshot().recorded).toBe(0);
  });
});

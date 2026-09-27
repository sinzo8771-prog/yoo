/**
 * Task 17, Step 4 — alert thresholds.
 *
 * Pins the closed six-type vocabulary from the plan, default thresholds
 * (any signature failure alerts; retries are "repeated" at 3+), severity
 * policy (signature + database = critical), override behavior, passthrough
 * of correlation samples, and that junk input throws rather than silently
 * producing no alert.
 */
import { describe, expect, it } from "vitest";

import {
  ALERT_TYPE,
  ALL_ALERT_TYPES,
  CRITICAL_ALERT_TYPES,
  DEFAULT_THRESHOLDS,
  evaluateAlerts,
  hasCriticalAlert,
  type AlertSignal,
} from "@/lib/observability/alerts";

const signal = (type: AlertSignal["type"], count: number): AlertSignal => ({ type, count });

describe("alert vocabulary", () => {
  it("is exactly the six plan-mandated signals", () => {
    expect([...ALL_ALERT_TYPES].sort()).toEqual(
      [
        "db_connectivity_errors",
        "matched_placeholder_never",
        "provider_errors",
        "repeated_retry_failures",
        "stale_orders",
        "unmatched_products",
        "webhook_signature_failures",
      ]
        .filter((t) => t !== "matched_placeholder_never")
        .sort()
    );
    expect(ALL_ALERT_TYPES).toHaveLength(6);
  });

  it("has a default threshold and severity policy entry for every type", () => {
    for (const type of ALL_ALERT_TYPES) {
      expect(DEFAULT_THRESHOLDS[type]).toBeGreaterThan(0);
    }
    expect([...CRITICAL_ALERT_TYPES].sort()).toEqual([
      ALERT_TYPE.DB_CONNECTIVITY_ERRORS,
      ALERT_TYPE.WEBHOOK_SIGNATURE_FAILURES,
    ]);
  });
});

describe("evaluateAlerts", () => {
  it.each(ALL_ALERT_TYPES)("does not alert below the %s threshold", (type) => {
    expect(evaluateAlerts([signal(type, DEFAULT_THRESHOLDS[type] - 1)])).toEqual([]);
  });

  it.each(ALL_ALERT_TYPES)("alerts at the %s threshold", (type) => {
    const alerts = evaluateAlerts([signal(type, DEFAULT_THRESHOLDS[type])]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      type,
      count: DEFAULT_THRESHOLDS[type],
      threshold: DEFAULT_THRESHOLDS[type],
    });
  });

  it("separates critical signals from warnings", () => {
    const alerts = evaluateAlerts([
      signal(ALERT_TYPE.WEBHOOK_SIGNATURE_FAILURES, 1),
      signal(ALERT_TYPE.DB_CONNECTIVITY_ERRORS, 2),
      signal(ALERT_TYPE.PROVIDER_ERRORS, 5),
      signal(ALERT_TYPE.STALE_ORDERS, 1),
      signal(ALERT_TYPE.UNMATCHED_PRODUCTS, 1),
      signal(ALERT_TYPE.REPEATED_RETRY_FAILURES, 3),
    ]);

    expect(alerts.map((a) => `${a.type}:${a.severity}`)).toEqual([
      "webhook_signature_failures:critical",
      "db_connectivity_errors:critical",
      "provider_errors:warning",
      "stale_orders:warning",
      "unmatched_products:warning",
      "repeated_retry_failures:warning",
    ]);
    expect(hasCriticalAlert(alerts)).toBe(true);
    expect(hasCriticalAlert(evaluateAlerts([signal(ALERT_TYPE.STALE_ORDERS, 9)]))).toBe(
      false
    );
  });

  it("honours per-call threshold overrides", () => {
    const alerts = evaluateAlerts([signal(ALERT_TYPE.PROVIDER_ERRORS, 3)], {
      thresholds: { provider_errors: 3 },
    });
    expect(alerts).toHaveLength(1);
    // The override must not leak into other types' defaults.
    expect(evaluateAlerts([signal(ALERT_TYPE.PROVIDER_ERRORS, 3)])).toEqual([]);
  });

  it("passes window and sample correlation through for the runbook grep", () => {
    const [alert] = evaluateAlerts([
      {
        type: ALERT_TYPE.STALE_ORDERS,
        count: 2,
        windowMs: 3_600_000,
        sampleCorrelation: "sourceOrder=of_9",
      },
    ]);
    expect(alert).toMatchObject({
      windowMs: 3_600_000,
      sampleCorrelation: "sourceOrder=of_9",
    });
    expect(
      evaluateAlerts([signal(ALERT_TYPE.STALE_ORDERS, 5)])[0]
    ).not.toHaveProperty("sampleCorrelation");
  });

  it("throws on unknown types and junk counts instead of staying silent", () => {
    expect(() =>
      evaluateAlerts([{ type: "made_up" as never, count: 99 }])
    ).toThrow(/Unknown alert type/);
    expect(() => evaluateAlerts([signal(ALERT_TYPE.PROVIDER_ERRORS, -1)])).toThrow(
      /finite non-negative/
    );
    expect(() => evaluateAlerts([signal(ALERT_TYPE.PROVIDER_ERRORS, NaN)])).toThrow(
      /finite non-negative/
    );
  });

  it("treats zero counts and empty input as quiet", () => {
    expect(evaluateAlerts([])).toEqual([]);
    expect(evaluateAlerts([signal(ALERT_TYPE.WEBHOOK_SIGNATURE_FAILURES, 0)])).toEqual([]);
  });
});

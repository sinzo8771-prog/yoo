import { describe, expect, it } from "vitest";
import {
  CUSTOMER_TRACKING_KEYS,
  projectCustomerTracking,
  sanitizeTrackingNumber,
  sanitizeTrackingUrl,
  toCustomerStatus,
  type CustomerTracking,
  type TrackingObservation,
} from "@/lib/fulfillment/customerTracking";
import { ALL_STATES, FULFILLMENT_STATE as S } from "@/lib/fulfillment/reconciliation";

// Task 14 Step 4 (stale/missing tracking) plus Steps 1-3. Grounded in two
// verified facts of this repo:
//   - `fulfillment-card/index.tsx` puts a supplier-supplied `trackingUrl` into
//     an `<a href target="_blank">`, so the URL must be validated first.
//   - The synthetic channel returns a tracking number and no carrier URL, so
//     "number without a link" is a normal, expected state.

const keysOf = (tracking: CustomerTracking) => Object.keys(tracking).sort();

describe("customer tracking projection (Task 14)", () => {
  it("maps every internal state onto the four customer-safe states", () => {
    const buckets = Object.fromEntries(
      ALL_STATES.map(state => [state, toCustomerStatus(state)])
    );

    expect(buckets).toEqual({
      RECEIVED: "processing",
      MATCHED: "processing",
      READY: "processing",
      SUBMITTING: "processing",
      ACCEPTED: "processing",
      FULFILLING: "shipped",
      SHIPPED: "shipped",
      DELIVERED: "delivered",
      MATCH_FAILED: "issue",
      PROVIDER_REJECTED: "issue",
      RETRYABLE_ERROR: "issue",
      CANCEL_REQUESTED: "issue",
      CANCELLED: "issue",
      RECONCILIATION_REQUIRED: "issue",
    });
    expect(() => toCustomerStatus("NOPE" as never)).toThrow(/Unknown fulfillment state/);
  });

  it("never lets provider detail reach the customer object", () => {
    const leaked = {
      state: S.ACCEPTED,
      carrier: "USPS",
      trackingNumber: "9400 1000 0000 0000 0000 00",
      trackingUrl: "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400",
      acceptedAt: "2026-09-15T10:00:00.000Z",
      updatedAt: "2026-09-15T10:00:00.000Z",
      // Everything below is provider/internal detail and must be ignored.
      raw: { supplierRefundSecret: "do-not-leak", cost: 4.12 },
      error: "PURCHASE_OUTCOME_UNKNOWN [key]: card declined",
      metadata: { warehouse: "CN-1" },
      purchaseId: "syn_purchase_abc",
      status: "PURCHASE_PROCESSING",
    };

    const tracking = projectCustomerTracking(leaked);

    // Only the documented keys exist, and no value carries the raw payload.
    expect(keysOf(tracking).every(key => CUSTOMER_TRACKING_KEYS.includes(key as never))).toBe(
      true
    );
    const serialized = JSON.stringify(tracking);
    for (const secret of ["do-not-leak", "card declined", "CN-1", "syn_purchase_abc"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("projects a validated carrier link, uppercased carrier, and ISO timestamp", () => {
    const tracking = projectCustomerTracking({
      state: S.SHIPPED,
      carrier: "united states postal service",
      trackingNumber: "9400 1000 0000 0000 0000 00",
      trackingUrl: "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400#frag",
      updatedAt: "2026-09-18T06:30:00.000Z",
    });

    expect(tracking).toEqual({
      status: "shipped",
      carrier: "USPS",
      trackingNumber: "9400 1000 0000 0000 0000 00",
      trackingUrl: "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400",
      lastUpdatedAt: "2026-09-18T06:30:00.000Z",
      message: "Your order is on its way.",
    });
  });

  it("keeps the plain tracking number when a link cannot be safely projected", () => {
    const unsafe = [
      "http://tools.usps.com/track/9400",              // not https
      "https://evil.example.com/track/9400",           // wrong host
      "https://www.ups.com/track?num=9400",            // carrier/host mismatch
      "https://user:pw@tools.usps.com/track/9400",     // embedded credentials
      "https://127.0.0.1/track/9400",                  // IP literal
      "https://localhost/track/9400",                  // loopback
      "javascript:alert(1)",                           // scheme
      "//tools.usps.com/track/9400",                   // scheme-relative
      "#",                                             // the current UI fallback
      "",
      null,
    ];

    for (const trackingUrl of unsafe) {
      const tracking = projectCustomerTracking({
        state: S.SHIPPED,
        carrier: "USPS",
        trackingNumber: "9400",
        trackingUrl,
      });
      expect(tracking.trackingUrl).toBeUndefined();
      // The customer still gets the number, so no dead link is shown.
      expect(tracking.trackingNumber).toBe("9400");
    }
  });

  it("drops a link when the carrier itself is unrecognised", () => {
    expect(
      sanitizeTrackingUrl("https://tools.usps.com/track/9400", { carrier: "Weird Courier" })
    ).toBeNull();
    expect(
      sanitizeTrackingUrl("https://tools.usps.com/track/9400", { carrier: "USPS" })
    ).not.toBeNull();
  });

  it("rejects tracking identifiers that are not plain opaque values", () => {
    expect(sanitizeTrackingNumber("1Z999AA10123456784")).toBe("1Z999AA10123456784");
    expect(sanitizeTrackingNumber("  syn_track_ab12cd34  ")).toBe("syn_track_ab12cd34");
    expect(sanitizeTrackingNumber("<script>alert(1)</script>")).toBeNull();
    expect(sanitizeTrackingNumber("9".repeat(65))).toBeNull();
    expect(sanitizeTrackingNumber("")).toBeNull();
    expect(sanitizeTrackingNumber(undefined)).toBeNull();

    // A rejected number also removes any link that came with it.
    expect(
      projectCustomerTracking({
        state: S.SHIPPED,
        carrier: "UPS",
        trackingNumber: "bad#number",
        trackingUrl: "https://www.ups.com/track?num=bad",
      }).trackingUrl
    ).toBeUndefined();
  });

  it("explains an accepted order that has no tracking yet", () => {
    const acceptedAt = "2026-09-15T10:00:00.000Z";
    const now = new Date("2026-09-16T10:00:00.000Z").getTime(); // 24h later

    // Inside the grace period: normal processing message, delay flag off.
    const fresh = projectCustomerTracking({ state: S.ACCEPTED, acceptedAt }, { now });
    expect(fresh.status).toBe("processing");
    expect(fresh.trackingDelayed).toBe(false);
    expect(fresh.message).toBe("We are preparing your order for shipment.");

    // Past the grace period: the customer is told why nothing has appeared.
    const delayed = projectCustomerTracking(
      { state: S.ACCEPTED, acceptedAt },
      { now: now + 2 * 24 * 60 * 60 * 1000 }
    );
    expect(delayed.trackingDelayed).toBe(true);
    expect(delayed.message).toContain("tracking is not available yet");

    // No tracking timestamp at all: not a delay claim, and never an invented one.
    const unknownAge = projectCustomerTracking({ state: S.FULFILLING }, { now });
    expect(unknownAge.status).toBe("shipped");
    expect(unknownAge.trackingDelayed).toBeUndefined();

    // A tracking number ends the waiting state entirely.
    const tracked = projectCustomerTracking(
      { state: S.ACCEPTED, acceptedAt, carrier: "DHL", trackingNumber: "JD0146000062" },
      { now: now + 10 * 24 * 60 * 60 * 1000 }
    );
    expect(tracked.trackingDelayed).toBeUndefined();
    expect(tracked.trackingNumber).toBe("JD0146000062");
  });

  it("survives stale, missing, and unparseable tracking data", () => {
    // Shipped but the carrier never gave us a number.
    const noNumber = projectCustomerTracking({ state: S.SHIPPED, carrier: "FedEx" });
    expect(noNumber).toEqual({ status: "shipped", carrier: "FEDEX", message: "Your order is on its way." });

    // Unparseable or implausible timestamps are dropped, not displayed raw.
    for (const updatedAt of ["not-a-date", 0, "1970-01-01T00:00:00.000Z", "2999-01-01T00:00:00.000Z"]) {
      const tracking = projectCustomerTracking({ state: S.DELIVERED, updatedAt });
      expect(tracking.lastUpdatedAt).toBeUndefined();
      expect(tracking.status).toBe("delivered");
    }

    // A hold state is an issue for the customer, never a provider error string.
    // The raw payload may carry provider detail (asserted past the closed type,
    // exactly as it arrives on the wire) — the projection must drop it.
    const rawWithProviderError = {
      state: S.RECONCILIATION_REQUIRED,
      error: "unique constraint failed on CartItem_purchaseAttemptKey_key",
    } as TrackingObservation;
    const issue = projectCustomerTracking(rawWithProviderError);
    expect(issue.status).toBe("issue");
    expect(issue.message).not.toContain("CartItem");
    expect(issue.message).toContain("looking into it");

    // A cancelled order is an issue too, and says so without provider detail.
    const cancelled = projectCustomerTracking({ state: S.CANCELLED });
    expect(cancelled.status).toBe("issue");
    expect(cancelled).toEqual({ status: "issue", message: expect.stringContaining("problem") });
  });

  it("emits the same shape for the same observation", () => {
    const observation = {
      state: S.ACCEPTED,
      carrier: "UPS",
      trackingNumber: "1Z999AA10123456784",
      trackingUrl: "https://www.ups.com/track?tracknum=1Z999AA10123456784",
      acceptedAt: "2026-09-15T10:00:00.000Z",
      updatedAt: "2026-09-16T10:00:00.000Z",
    };
    const now = new Date("2026-09-19T00:00:00.000Z").getTime();

    const first = projectCustomerTracking(observation, { now });
    expect(projectCustomerTracking(observation, { now })).toEqual(first);
    // Exactly six keys: with a tracking number present there is nothing to
    // explain, so `trackingDelayed` is omitted rather than reported as false.
    expect(keysOf(first)).toEqual([
      "carrier",
      "lastUpdatedAt",
      "message",
      "status",
      "trackingNumber",
      "trackingUrl",
    ].sort());
    expect(first.trackingDelayed).toBeUndefined();
  });
});
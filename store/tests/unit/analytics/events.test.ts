import { describe, expect, it } from "vitest";

/**
 * Task 19, Step 3 (unit) — event vocabulary and payload sanitizer.
 *
 * These tests are the privacy contract: the event set is closed, props are
 * allowlisted per event, query strings never reach the payload, and no accepted
 * prop name can ever match the PII pattern.
 */

import {
  ANALYTICS_EVENTS,
  FUNNEL_STAGES,
  PII_KEY_PATTERN,
  allowedPropNames,
  isAnalyticsEventName,
  sanitizeAnalyticsEvent,
  sanitizeAnalyticsPath,
  type AnalyticsEventName,
} from "@/lib/analytics/events";

/** The exact list the plan asks for, spelled out. */
const REQUIRED_EVENTS = [
  "view_product",
  "view_collection",
  "select_variant",
  "add_to_cart",
  "view_cart",
  "begin_checkout",
  "checkout_success",
  "purchase",
  "view_order",
  "view_tracking",
];

describe("event vocabulary", () => {
  it("is exactly the ten events the plan lists", () => {
    expect([...ANALYTICS_EVENTS].sort()).toEqual([...REQUIRED_EVENTS].sort());
    expect(ANALYTICS_EVENTS).toHaveLength(10);
  });

  it("names its funnel stages from that vocabulary, in order", () => {
    expect([...FUNNEL_STAGES]).toEqual([
      "view_product",
      "add_to_cart",
      "begin_checkout",
      "purchase",
    ]);
    for (const stage of FUNNEL_STAGES) {
      expect(isAnalyticsEventName(stage)).toBe(true);
    }
  });

  it("rejects anything outside the vocabulary", () => {
    for (const value of ["", "page_view", "view_product ", "VIEW_PRODUCT", 1, null, {}, []]) {
      expect(isAnalyticsEventName(value), String(value)).toBe(false);
    }
  });
});

describe("sanitizeAnalyticsEvent", () => {
  it("accepts a valid event and normalizes the currency", () => {
    expect(
      sanitizeAnalyticsEvent({
        event: "add_to_cart",
        path: "/us/products/oak-board",
        props: {
          productId: "prod_1",
          variantId: "var-2",
          quantity: 2,
          currency: "usd",
          valueMinor: 4500,
        },
      })
    ).toEqual({
      event: "add_to_cart",
      path: "/us/products/oak-board",
      props: {
        productId: "prod_1",
        variantId: "var-2",
        quantity: 2,
        currency: "USD",
        valueMinor: 4500,
      },
    });
  });

  it("rejects unknown events and non-object payloads", () => {
    for (const payload of [
      { event: "page_view" },
      { event: "" },
      {},
      null,
      undefined,
      "view_product",
      42,
      [],
      { event: "view_product", props: "nope" },
    ]) {
      expect(sanitizeAnalyticsEvent(payload), JSON.stringify(payload)).toBeNull();
    }
  });

  it("strips unknown props instead of refusing the event", () => {
    const result = sanitizeAnalyticsEvent({
      event: "view_product",
      props: { productHandle: "oak-board", channel: "email", referrer: "https://x" },
    });
    expect(result?.props).toEqual({ productHandle: "oak-board" });
  });

  it("rejects the whole event when an allowlisted prop is out of bounds", () => {
    // Each case pairs a prop with the event that actually allows it, so the
    // assertion is about the bound and not about the allowlist.
    const cases: Array<[AnalyticsEventName, Record<string, unknown>]> = [
      ["add_to_cart", { productId: "a".repeat(200) }],
      ["add_to_cart", { productId: "has spaces" }],
      ["add_to_cart", { quantity: 0 }],
      ["add_to_cart", { quantity: 1000 }],
      ["add_to_cart", { quantity: 1.5 }],
      ["add_to_cart", { valueMinor: -1 }],
      ["add_to_cart", { valueMinor: 4.99 }],
      ["add_to_cart", { currency: "us" }],
      ["add_to_cart", { currency: "usdollars" }],
      ["view_cart", { itemCount: -3 }],
      ["view_cart", { itemCount: 1000 }],
      ["view_collection", { productCount: -1 }],
      ["view_product", { productHandle: "Not A Handle" }],
      ["view_tracking", { hasTracking: "yes" }],
    ];

    for (const [event, props] of cases) {
      expect(
        sanitizeAnalyticsEvent({ event, props }),
        `${event} ${JSON.stringify(props)}`
      ).toBeNull();
    }
  });

  it("accepts a partially specified cart/checkout event", () => {
    expect(sanitizeAnalyticsEvent({ event: "view_cart", props: {} })).toEqual({
      event: "view_cart",
      props: {},
    });
    expect(sanitizeAnalyticsEvent({ event: "view_cart", props: { itemCount: 3 } })).toEqual({
      event: "view_cart",
      props: { itemCount: 3 },
    });
  });

  it("keeps events with no props at all", () => {
    expect(sanitizeAnalyticsEvent({ event: "view_order" })).toEqual({
      event: "view_order",
      props: {},
    });
    expect(
      sanitizeAnalyticsEvent({ event: "view_order", path: "/us/account/orders" })
    ).toEqual({
      event: "view_order",
      path: "/us/account/orders",
      props: {},
    });
  });

  it("never emits a key that looks like personal data", () => {
    const result = sanitizeAnalyticsEvent({
      event: "add_to_cart",
      path: "/us/cart",
      props: {
        email: "shopper@example.com",
        phone: "+15550100",
        firstName: "Ada",
        address: "1 Analytical Way",
        postalCode: "94107",
        customerName: "Ada Lovelace",
        cardNumber: "4242424242424242",
        quantity: 1,
      },
    })!;
    expect(result.props).toEqual({ quantity: 1 });
    for (const key of Object.keys(result.props)) {
      expect(PII_KEY_PATTERN.test(key), key).toBe(false);
    }
    expect(JSON.stringify(result)).not.toContain("shopper@example.com");
    expect(JSON.stringify(result)).not.toContain("4242");
  });

  it("leaves no undefined values in the prop bag", () => {
    const result = sanitizeAnalyticsEvent({
      event: "select_variant",
      props: { productId: "prod_1", variantId: undefined },
    })!;
    expect(Object.keys(result.props)).toEqual(["productId"]);
    expect("variantId" in result.props).toBe(false);
  });
});

describe("sanitizeAnalyticsPath", () => {
  it("keeps a rooted pathname and trims a trailing slash", () => {
    expect(sanitizeAnalyticsPath("/us/products/oak-board")).toBe("/us/products/oak-board");
    expect(sanitizeAnalyticsPath("/us/cart/")).toBe("/us/cart");
    expect(sanitizeAnalyticsPath("/")).toBe("/");
  });

  it("removes the query string and fragment", () => {
    expect(sanitizeAnalyticsPath("/us/store?email=a@b.c")).toBe("/us/store");
    expect(sanitizeAnalyticsPath("/us/track?order=1#top")).toBe("/us/track");
  });

  it("rejects anything that is not a rooted, bounded path", () => {
    for (const value of [
      "https://evil.example/?x=1",
      "us/cart",
      "",
      "   ",
      `/${"a".repeat(300)}`,
      5,
      null,
    ]) {
      expect(sanitizeAnalyticsPath(value), String(value)).toBeUndefined();
    }
  });
});

describe("allowedPropNames", () => {
  it("publishes the allowlist for every event, sorted", () => {
    for (const event of ANALYTICS_EVENTS) {
      const names = allowedPropNames(event);
      expect(Array.isArray(names)).toBe(true);
      expect(names).toEqual([...names].sort());
    }
    expect(allowedPropNames("view_order")).toEqual([]);
    expect(allowedPropNames("add_to_cart")).toEqual([
      "currency",
      "productId",
      "quantity",
      "valueMinor",
      "variantId",
    ]);
  });

  it("contains no key that could describe a person", () => {
    for (const event of ANALYTICS_EVENTS) {
      for (const name of allowedPropNames(event)) {
        expect(PII_KEY_PATTERN.test(name), `${event}.${name}`).toBe(false);
      }
    }
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Task 19, Step 3 (unit) — browser transport and consent handling.
 *
 * The point of these tests: by default nothing is sent; when the feature is on,
 * only the sanitized envelope leaves the page, to our own origin, with
 * credentials omitted; and every failure path is a quiet `false` rather than an
 * unhandled rejection in the middle of a purchase.
 */

import {
  ANALYTICS_COLLECT_PATH,
  ANALYTICS_ENABLED_ENV,
  MAX_ANALYTICS_PAYLOAD_LENGTH,
  beaconTransport,
  createAnalyticsClient,
  isAnalyticsEnabled,
  readPrivacySignals,
} from "@/lib/analytics/client";

const ON = { [ANALYTICS_ENABLED_ENV]: "true" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isAnalyticsEnabled", () => {
  it("is off unless explicitly switched on", () => {
    expect(isAnalyticsEnabled({ env: {} })).toBe(false);
    expect(isAnalyticsEnabled({ env: { [ANALYTICS_ENABLED_ENV]: "1" } })).toBe(false);
    expect(isAnalyticsEnabled({ env: { [ANALYTICS_ENABLED_ENV]: "TRUE" } })).toBe(false);
    expect(isAnalyticsEnabled({ env: { [ANALYTICS_ENABLED_ENV]: "false" } })).toBe(false);
    expect(isAnalyticsEnabled({ env: ON, signals: null })).toBe(true);
  });

  it("honours do-not-track and global privacy control", () => {
    expect(isAnalyticsEnabled({ env: ON, signals: { doNotTrack: "1" } })).toBe(false);
    expect(isAnalyticsEnabled({ env: ON, signals: { doNotTrack: 1 } })).toBe(false);
    expect(isAnalyticsEnabled({ env: ON, signals: { doNotTrack: "yes" } })).toBe(false);
    expect(isAnalyticsEnabled({ env: ON, signals: { globalPrivacyControl: true } })).toBe(false);
    expect(
      isAnalyticsEnabled({ env: ON, signals: { doNotTrack: "0", globalPrivacyControl: false } })
    ).toBe(true);
  });
});

describe("createAnalyticsClient", () => {
  it("sends the sanitized envelope to our own collect path", () => {
    const sent: Array<{ payload: string; path: string }> = [];
    const client = createAnalyticsClient({
      isEnabled: () => true,
      transport: (payload, path) => {
        sent.push({ payload, path });
        return true;
      },
      pathname: () => "/us/products/oak-board",
    });

    expect(
      client.track("view_product", {
        productHandle: "oak-board",
        productCount: 3,
        email: "shopper@example.com",
      })
    ).toBe(true);

    expect(sent).toHaveLength(1);
    expect(sent[0].path).toBe(ANALYTICS_COLLECT_PATH);
    expect(JSON.parse(sent[0].payload)).toEqual({
      event: "view_product",
      path: "/us/products/oak-board",
      props: { productHandle: "oak-board" },
    });
    expect(sent[0].payload.length).toBeLessThanOrEqual(MAX_ANALYTICS_PAYLOAD_LENGTH);
  });

  it("sends nothing while disabled", () => {
    const transport = vi.fn(() => true);
    const client = createAnalyticsClient({ isEnabled: () => false, transport });
    expect(client.track("view_cart", { itemCount: 1 })).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it("drops an event with an invalid prop instead of sending a request the server would reject", () => {
    const transport = vi.fn(() => true);
    const client = createAnalyticsClient({ isEnabled: () => true, transport });
    expect(client.track("add_to_cart", { valueMinor: 12.5 })).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it("drops an event name outside the vocabulary", () => {
    const transport = vi.fn(() => true);
    const client = createAnalyticsClient({ isEnabled: () => true, transport });
    expect(client.track("page_view" as never, {})).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it("never throws when transport fails", () => {
    const throwing = createAnalyticsClient({
      isEnabled: () => true,
      transport: () => {
        throw new Error("offline");
      },
    });
    expect(throwing.track("view_cart")).toBe(false);

    const rejecting = createAnalyticsClient({
      isEnabled: () => true,
      transport: () => {
        throw new TypeError("failed to fetch");
      },
    });
    expect(rejecting.track("view_cart")).toBe(false);
  });

  it("uses the path it was given when one is provided explicitly", () => {
    const sent: string[] = [];
    const client = createAnalyticsClient({
      isEnabled: () => true,
      transport: (payload) => {
        sent.push(payload);
        return true;
      },
      pathname: () => "/us/cart",
    });
    client.track("view_cart", { itemCount: 2 }, "/us/checkout");
    expect(JSON.parse(sent[0]).path).toBe("/us/checkout");
  });

  it("honours a consent signal that changes mid-session", () => {
    let enabled = true;
    const transport = vi.fn(() => true);
    const client = createAnalyticsClient({ isEnabled: () => enabled, transport });

    expect(client.track("view_cart")).toBe(true);
    enabled = false;
    expect(client.track("view_cart")).toBe(false);
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe("readPrivacySignals", () => {
  it("returns null where there is no navigator", () => {
    vi.stubGlobal("navigator", undefined);
    expect(readPrivacySignals()).toBeNull();
  });

  it("reads doNotTrack and globalPrivacyControl", () => {
    vi.stubGlobal("navigator", { doNotTrack: "1", globalPrivacyControl: true });
    expect(readPrivacySignals()).toEqual({ doNotTrack: "1", globalPrivacyControl: true });
  });
});

describe("beaconTransport", () => {
  it("prefers sendBeacon, which survives navigation", () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { sendBeacon });

    expect(beaconTransport('{"event":"view_cart"}', ANALYTICS_COLLECT_PATH)).toBe(true);
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [path, body] = sendBeacon.mock.calls[0] as unknown as [string, Blob];
    expect(path).toBe(ANALYTICS_COLLECT_PATH);
    expect(body).toBeInstanceOf(Blob);
    expect(body.type).toBe("application/json");
  });

  it("reports the queue-full case as a failure rather than pretending", () => {
    vi.stubGlobal("navigator", { sendBeacon: vi.fn(() => false) });
    expect(beaconTransport("{}", ANALYTICS_COLLECT_PATH)).toBe(false);
  });

  it("returns false when sendBeacon throws", () => {
    vi.stubGlobal("navigator", {
      sendBeacon: () => {
        throw new Error("blocked by an extension");
      },
    });
    expect(beaconTransport("{}", ANALYTICS_COLLECT_PATH)).toBe(false);
  });

  it("falls back to fetch with keepalive and no credentials", () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("fetch", fetchMock);

    expect(beaconTransport('{"event":"view_cart"}', ANALYTICS_COLLECT_PATH)).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      ANALYTICS_COLLECT_PATH,
      expect.objectContaining({
        method: "POST",
        body: '{"event":"view_cart"}',
        keepalive: true,
        credentials: "omit",
        mode: "same-origin",
      })
    );
  });

  it("returns false when no transport exists at all", () => {
    vi.stubGlobal("navigator", undefined);
    vi.stubGlobal("fetch", undefined);
    expect(beaconTransport("{}", ANALYTICS_COLLECT_PATH)).toBe(false);
  });
});

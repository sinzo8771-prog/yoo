/**
 * Task 16, Step 4 — failure and retry semantics of `placeOrder`.
 *
 * Failure mappings added by this task (declined, reconciliation, transport)
 * plus the retry invariants the customer-facing messages promise:
 *  - a failed attempt keeps the cart so a retry is possible;
 *  - a retry after failure completes, and only once;
 *  - after success, a duplicate submit never reaches the backend again;
 *  - a lost-response (timeout-after-commit) retry stops honestly instead of
 *    completing the cart twice;
 *  - a backend response without an order id is a failure, never a success
 *    (Step 2's corollary: paid state comes from the backend, not the client).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn();

const cookieStore: Record<string, string> = {};

vi.mock("@/features/storefront/lib/config", () => ({
  openfrontClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (key: string) => (cookieStore[key] ? { value: cookieStore[key] } : undefined),
    set: (key: string, value: string) => {
      cookieStore[key] = value;
    },
  }),
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

import { placeOrder } from "@/features/storefront/lib/data/cart";
import { setCartId, getCartId } from "@/features/storefront/lib/data/cookies";

const freshCart = () =>
  requestMock.mockImplementationOnce(async () => ({
    activeCart: {
      id: "test-cart",
      region: { currency: { code: "USD" } },
      lineItems: [{ id: "li_1", quantity: 1 }],
    },
  }));

const completeCalls = () =>
  requestMock.mock.calls.filter((c) => /completeActiveCart/.test(String(c[0]))).length;

/** Console spies, re-created per test (see beforeEach). */
type CapturedSpy = { mock: { calls: unknown[][] } };
let errorSpy: CapturedSpy;
let logSpy: CapturedSpy;

beforeEach(() => {
  requestMock.mockReset();
  Object.keys(cookieStore).forEach((k) => delete cookieStore[k]);
  errorSpy = vi
    .spyOn(console, "error")
    .mockImplementation(() => {}) as unknown as CapturedSpy;
  logSpy = vi
    .spyOn(console, "log")
    .mockImplementation(() => {}) as unknown as CapturedSpy;
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.keys(cookieStore).forEach((k) => delete cookieStore[k]);
});

describe("placeOrder failure mappings (Step 4)", () => {
  it("maps a declined settlement to 'no order was placed' — the order is provably not created", async () => {
    freshCart();
    // Openfront throws `Payment failed: …` BEFORE createOrderFromCartAtomically.
    requestMock.mockRejectedValueOnce(new Error("Payment failed: card_declined"));

    await setCartId("test-cart");
    const result = await placeOrder("session_1");

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("no order was placed"),
    });
    if (!result.success) {
      // Never claims "not charged": a provider hold is between customer and bank.
      expect(result.error).not.toMatch(/not charged|no charge/i);
    }
    // Retry stays possible — the cart cookie survives a failed completion.
    expect(await getCartId()).toBe("test-cart");
    expect(completeCalls()).toBe(1);

    // Task 17, Step 2 — exactly one structured failure line: closed keys
    // only, sanitized failureClass, no raw backend text or secrets.
    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain('"operation":"checkout.complete"');
    expect(logged).toContain('"status":"failed"');
    expect(logged).toContain('"failureClass":"payment_failed"');
    expect(logged).toContain('"cartId":"test-cart"');
    expect(logged).not.toMatch(/proof|secret|authorization|card_declined/i);
  });

  it("maps reconciliation-required to the payment-confirmation message", async () => {
    freshCart();
    requestMock.mockRejectedValueOnce(new Error("Checkout requires payment reconciliation"));

    await setCartId("test-cart");
    const result = await placeOrder("session_1");

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("couldn't confirm your payment"),
    });
    expect(await getCartId()).toBe("test-cart");
  });

  it("maps a transport failure to a message that claims neither outcome", async () => {
    freshCart();
    // graphql-request surfaces network failures as e.g. "fetch failed".
    requestMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    await setCartId("test-cart");
    const result = await placeOrder("session_1");

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("couldn't reach the payment service"),
    });
    if (!result.success) {
      // The backend may have committed — we must not assert otherwise.
      expect(result.error).not.toMatch(/no order was placed|not been charged|not charged/i);
      expect(result.error).toMatch(/orders page/);
    }
    expect(await getCartId()).toBe("test-cart");

    // Structured log classifies the transport failure (sanitized, no raw text).
    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain('"failureClass":"transport"');
    expect(logged).not.toContain("fetch failed");
  });

  it("treats a backend response without an order id as failure, not success", async () => {
    freshCart();
    requestMock.mockResolvedValueOnce({ completeActiveCart: null });

    await setCartId("test-cart");
    const result = await placeOrder("session_1");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/^We couldn't confirm your order\./);
      expect(result).not.toHaveProperty("redirectTo");
    }
    expect(await getCartId()).toBe("test-cart");
    expect(completeCalls()).toBe(1);
  });
});

describe("placeOrder retry semantics (Step 4)", () => {
  it("lets a customer retry after a failure and then complete exactly once", async () => {
    freshCart();
    requestMock.mockRejectedValueOnce(new Error("Payment failed: card_declined"));
    await setCartId("test-cart");
    await expect(placeOrder("session_1")).resolves.toMatchObject({ success: false });

    freshCart();
    requestMock.mockResolvedValueOnce({
      completeActiveCart: {
        id: "order_9",
        shippingAddress: { country: { iso2: "US" } },
        secretKey: null,
      },
    });

    const retry = await placeOrder("session_1");
    expect(retry).toEqual({ success: true, redirectTo: "/us/order/confirmed/order_9" });
    // One completion attempt per try — two tries, two attempts, one success.
    expect(completeCalls()).toBe(2);
    expect(await getCartId()).toBeUndefined();

    // Task 17, Steps 1+2 — success line carries cart + permanent source key.
    const okLines = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(okLines).toContain('"operation":"checkout.complete"');
    expect(okLines).toContain('"status":"ok"');
    expect(okLines).toContain('"sourceOrderId":"order_9"');
    expect(okLines).toContain('"cartId":"test-cart"');
    expect(okLines).not.toMatch(/proof|secret/i);
  });

  it("never reaches the backend for a duplicate submit after success", async () => {
    freshCart();
    requestMock.mockResolvedValueOnce({
      completeActiveCart: {
        id: "order_10",
        shippingAddress: { country: { iso2: "US" } },
        secretKey: null,
      },
    });
    await setCartId("test-cart");
    await expect(placeOrder("session_1")).resolves.toMatchObject({ success: true });

    const callsAfterSuccess = requestMock.mock.calls.length;
    const result = await placeOrder("session_1"); // double-click / stale tab

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("session expired"),
    });
    // Zero new requests: the cleared cart cookie stops it before any network.
    expect(requestMock.mock.calls.length).toBe(callsAfterSuccess);
    expect(completeCalls()).toBe(1);
  });

  it("stops honestly on a lost-response retry instead of completing twice", async () => {
    // Attempt 1: the backend commits, but the response never arrives.
    freshCart();
    requestMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await setCartId("test-cart");
    await expect(placeOrder("session_1")).resolves.toMatchObject({ success: false });
    expect(completeCalls()).toBe(1);

    // Attempt 2: the cart is no longer active server-side — activeCart is
    // empty, so completion must refuse rather than fire a second order.
    requestMock.mockResolvedValueOnce({ activeCart: null });
    const retry = await placeOrder("session_1");

    expect(retry).toMatchObject({
      success: false,
      error: expect.stringContaining("no longer available"),
    });
    expect(completeCalls()).toBe(1); // still exactly one completion attempt
  });
});

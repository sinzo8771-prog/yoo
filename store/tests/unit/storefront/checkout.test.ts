/**
 * Task 9 — checkout handoff unit tests.
 *
 * Covers:
 *   - buildOrderConfirmationPath: locked internal redirect composition
 *   - assertSafeInternalPath: open-redirect rejection
 *   - placeOrder: signed proof / session headers forwarded to completeActiveCart,
 *     stale/empty-cart rejection, backend error mapping to honest
 *     customer-actionable messages (never fabricated success)
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
    set: (
      key: string,
      value: string,
      options?: { maxAge?: number; expires?: Date }
    ) => {
      const cleared =
        (typeof options?.maxAge === "number" && options.maxAge <= 0) ||
        (options?.expires instanceof Date && options.expires.getTime() <= 0);
      if (cleared) {
        delete cookieStore[key];
      } else {
        cookieStore[key] = value;
      }
    },
  }),
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

import {
  buildOrderConfirmationPath,
  assertSafeInternalPath,
} from "@/features/storefront/lib/security/redirects";
import {
  placeOrder,
} from "@/features/storefront/lib/data/cart";
import { getCartShippingOptions } from "@/features/storefront/lib/data/shipping";
import {
  setCartId,
  getCartId,
  getAuthHeaders,
} from "@/features/storefront/lib/data/cookies";

beforeEach(() => {
  requestMock.mockReset();
  Object.keys(cookieStore).forEach((k) => delete cookieStore[k]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.keys(cookieStore).forEach((k) => delete cookieStore[k]);
});

describe("checkout shipping options", () => {
  it("forwards the current cart proof when loading shipping options", async () => {
    await setCartId("test-cart");
    const headers = await getAuthHeaders();
    const options = [{ id: "shipping_1", name: "Standard" }];
    requestMock.mockResolvedValueOnce({ activeCartShippingOptions: options });

    await expect(getCartShippingOptions("test-cart")).resolves.toEqual(options);
    expect(requestMock).toHaveBeenCalledWith(
      expect.stringContaining("activeCartShippingOptions"),
      { cartId: "test-cart" },
      headers
    );
    expect(headers["x-openfront-cart-proof"]).toBeTruthy();
  });
});

describe("buildOrderConfirmationPath (Task 9, Step 3)", () => {
  it("builds a guest confirmation path with encoded secretKey", () => {
    expect(
      buildOrderConfirmationPath("US", "order_123", "secret_key_abc")
    ).toBe("/us/order/confirmed/order_123?secretKey=secret_key_abc");
  });

  it("builds a logged-in confirmation path without secretKey", () => {
    expect(buildOrderConfirmationPath("in", "order_456", null)).toBe(
      "/in/order/confirmed/order_456"
    );
  });

  it.each([
    ["", "order_1", null], // missing country
    ["USA", "order_1", null], // not iso2
    ["us", "", null], // missing order id
    ["us", "bad id/../../etc", null], // traversal in order id
    ["us", "order_1", "bad secret key/../x"], // traversal in secret
  ])("refuses malformed input %j", (country, id, secret) => {
    expect(buildOrderConfirmationPath(country, id, secret)).toBeNull();
  });
});

describe("assertSafeInternalPath (Task 9, Step 3)", () => {
  it("accepts plain same-origin absolute paths", () => {
    expect(assertSafeInternalPath("/us/order/confirmed/order_1")).toBe(
      "/us/order/confirmed/order_1"
    );
  });

  it.each([
    null,
    undefined,
    "",
    "//evil.example.com/x",
    "https://evil.example.com",
    "javascript:alert(1)",
    "/path\\..\\windows",
    "relative/path",
  ])("rejects %j", (bad) => {
    expect(() => assertSafeInternalPath(bad as string)).toThrow(
      "Unsafe redirect target"
    );
  });
});

describe("placeOrder — checkout handoff (Task 9, Steps 1–2)", () => {
  const mockFreshCart = () =>
    requestMock.mockImplementationOnce(async () => ({
      activeCart: {
        id: "test-cart",
        region: { currency: { code: "USD" } },
        lineItems: [{ id: "li_1", quantity: 2 }],
      },
    }));

  it("forwards the signed cart proof to completeActiveCart (Step 1)", async () => {
    mockFreshCart();
    requestMock.mockResolvedValueOnce({
      completeActiveCart: {
        id: "order_789",
        shippingAddress: { country: { iso2: "US" } },
        secretKey: null,
      },
    });

    await setCartId("test-cart");
    await placeOrder();

    // The completion call carries the auth headers (proof / bearer).
    const completeCall = requestMock.mock.calls[1];
    expect(completeCall[1]).toEqual({
      cartId: "test-cart",
      paymentSessionId: undefined,
    });
    const headers = completeCall[2] as Record<string, string>;
    expect(headers["x-openfront-cart-proof"]).toBeTruthy();
    // Cart cookie is cleared after success.
    expect(await getCartId()).toBeUndefined();
    expect(await getAuthHeaders()).toEqual({});
  });

  it("rejects an empty cart before charging (Step 2)", async () => {
    // Persistent mock: each placeOrder attempt re-reads the cart.
    requestMock.mockResolvedValue({
      activeCart: {
        id: "test-cart",
        region: { currency: { code: "USD" } },
        lineItems: [],
      },
    });

    await setCartId("test-cart");

    await expect(placeOrder()).resolves.toMatchObject({ success: false });
    const callsAfterFirst = requestMock.mock.calls.length;
    await expect(placeOrder()).resolves.toMatchObject({
      success: false, error: expect.stringContaining("Your cart is empty"),
    });
    // Each attempt only re-reads the cart for freshness — no completion call
    // was ever made against the empty cart.
    expect(requestMock.mock.calls.length).toBe(callsAfterFirst + 1);
    expect(requestMock.mock.calls.every((c) => !/completeActiveCart/.test(String(c[0])))).toBe(true);
  });

  it("rejects when the cart currency cannot be confirmed (Step 2)", async () => {
    requestMock.mockResolvedValueOnce({
      activeCart: {
        id: "test-cart",
        region: {},
        lineItems: [{ id: "li_1", quantity: 1 }],
      },
    });

    await setCartId("test-cart");

    await expect(placeOrder()).resolves.toMatchObject({
      success: false, error: expect.stringContaining("currency could not be confirmed"),
    });
  });

  it("maps 'Manual tender' to an actionable message (Step 4)", async () => {
    mockFreshCart();
    requestMock.mockRejectedValueOnce(
      new Error("Manual tender payment cannot be used for online checkout")
    );

    await setCartId("test-cart");

    await expect(placeOrder("session_1")).resolves.toMatchObject({
      success: false, error: expect.stringContaining("This payment method cannot be used for online checkout"),
    });
  });

  it("maps missing payment confirmation without claiming no charge (Step 4)", async () => {
    mockFreshCart();
    requestMock.mockRejectedValueOnce(
      new Error("Payment provider reference not found")
    );

    await setCartId("test-cart");

    await expect(placeOrder("session_1")).resolves.toMatchObject({
      success: false, error: expect.stringContaining("Check your payment status"),
    });
  });

  it("maps cross-account cart attempts to a sign-in message (Step 4)", async () => {
    mockFreshCart();
    requestMock.mockRejectedValueOnce(
      new Error("Cart already posted to a different account")
    );

    await setCartId("test-cart");

    await expect(placeOrder("session_1")).resolves.toMatchObject({
      success: false, error: expect.stringContaining("This cart belongs to a different account"),
    });
  });

  it("maps unknown backend failures to a generic honest message (Step 4)", async () => {
    mockFreshCart();
    requestMock.mockRejectedValueOnce(new Error("Something exploded"));

    await setCartId("test-cart");

    const result = await placeOrder("session_1");
    expect(result).toMatchObject({
      success: false, error: expect.stringContaining("couldn't confirm your order or payment status"),
    });
    expect(JSON.stringify(result)).not.toMatch(/not charged|No charge|Something exploded/);
    expect(await getCartId()).toBe("test-cart");
  });

  it("rejects when the fresh cart read fails (Step 2)", async () => {
    requestMock.mockRejectedValueOnce(new Error("network down"));

    await setCartId("test-cart");

    await expect(placeOrder()).resolves.toMatchObject({
      success: false, error: expect.stringContaining("We couldn't verify your cart"),
    });
  });
});
/**
 * Task 7 unit tests — cart operations.
 *
 * Covers the contract rules from the plan:
 *   - add/update/remove reject when the cart cookie is missing
 *   - addToCart rejects a missing variantId
 *   - duplicate click: addToCart is idempotent on the client via isAdding state;
 *     the server side rejects duplicate line-item creates by variant (delegated to
 *     Openfront) and this test asserts we never send an empty variantId
 *   - stale cart: if the cart no longer exists in Openfront we clear the cookie
 *     (covered by getOrSetCart null-cart path)
 *
 * The openfrontClient is mocked (same pattern as catalog.test.ts). The Next.js
 * `cookies()` and `revalidateTag` are stubbed so the server actions can run in
 * the vitest node environment.
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
      // Mirror real Next.js semantics: a non-positive maxAge or a past expiry
      // clears the cookie (the hardened removeCartId uses maxAge 0 + expires 0).
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

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("@redirect");
  }),
}));

import {
  addToCart,
  placeOrder,
  submitDiscountForm,
  updateLineItem,
  deleteLineItem,
  getOrSetCart,
} from "@/features/storefront/lib/data/cart";
import { getCartId, setCartId } from "@/features/storefront/lib/data/cookies";

beforeEach(() => {
  requestMock.mockReset();
  Object.keys(cookieStore).forEach((k) => delete cookieStore[k]);
});

afterEach(() => {
  Object.keys(cookieStore).forEach((k) => delete cookieStore[k]);
});

describe("addToCart validation (Task 7, Step 1)", () => {
  it("throws when variantId is empty", async () => {
    await expect(
      addToCart({ variantId: "", quantity: 1, countryCode: "us" })
    ).rejects.toThrow("Missing variant ID");
  });

  it("throws when variantId is undefined", async () => {
    await expect(
      addToCart({ variantId: undefined as unknown as string, quantity: 1, countryCode: "us" })
    ).rejects.toThrow("Missing variant ID");
  });

  it("never sends a mutation when variantId is missing (duplicate-click guard)", async () => {
    // The server-side guard means duplicate clicks that somehow reach the
    // server with an empty variantId do not result in a GraphQL mutation.
    await expect(
      addToCart({ variantId: "", quantity: 1, countryCode: "us" })
    ).rejects.toThrow();
    expect(requestMock).not.toHaveBeenCalled();
  });
});

describe("updateLineItem validation (Task 7, Step 1)", () => {
  it("returns error when cart cookie is missing", async () => {
    const result = await updateLineItem({ lineId: "line1", quantity: 2 });
    expect(result).toBe("No cartId cookie found");
  });
});

describe("deleteLineItem validation (Task 7, Step 1)", () => {
  it("returns error when cart cookie is missing", async () => {
    const result = await deleteLineItem("line1");
    expect(result).toBe("No cart ID found");
  });
});

describe("submitDiscountForm validation (Task 7, Step 1)", () => {
  it("returns error when code is empty", async () => {
    const formData = new FormData();
    const result = await submitDiscountForm(null, formData);
    expect(result).toBe("Code is required");
  });

  it("returns error when cart cookie is missing", async () => {
    const formData = new FormData();
    formData.set("code", "SAVE10");
    const result = await submitDiscountForm(null, formData);
    expect(result).toBe("No cart found");
  });
});

describe("getOrSetCart stale-cart handling (Task 7, Step 1)", () => {
  it("creates a new cart when no cart cookie is set", async () => {
    // No cart cookie → getCartId returns undefined → skip lookup → region lookup → create
    requestMock.mockResolvedValueOnce({ regions: [{ id: "reg1" }] }); // region lookup
    requestMock.mockResolvedValueOnce({
      createCart: { id: "new-cart", region: { id: "reg1" } },
    }); // cart creation

    const result = await getOrSetCart("us");

    expect(result).toBeDefined();
    expect(result.id).toBe("new-cart");
  });

  it("creates a new cart when the stored cart no longer exists in Openfront", async () => {
    // Simulate a cartId cookie that points to a non-existent cart
    await setCartId("stale-cart-id");

    requestMock
      .mockResolvedValueOnce({ activeCart: null }) // 1st: cart lookup returns null
      .mockResolvedValueOnce({ regions: [{ id: "reg1" }] }) // 2nd: region lookup
      .mockResolvedValueOnce({
        createCart: { id: "new-cart", region: { id: "reg1" } },
      }); // 3rd: cart creation

    const result = await getOrSetCart("us");

    expect(result).toBeDefined();
    expect(result.id).toBe("new-cart");
    // The stale cart cookie should have been cleared and then set to the new cart ID
    expect(await getCartId()).toBe("new-cart");
  });

  it("throws when no region matches the country code", async () => {
    requestMock.mockResolvedValueOnce({ regions: [] }); // no region found

    await expect(getOrSetCart("xx")).rejects.toThrow("No region found for country: xx");
  });
});

describe("placeOrder redirect URL construction (Task 7, Step 2; updated by Task 9)", () => {
  /** Seed the fresh-cart re-read placeOrder performs before completion. */
  const mockFreshCart = () =>
    requestMock.mockImplementationOnce(async () => ({
      activeCart: {
        id: "test-cart",
        region: { currency: { code: "USD" } },
        lineItems: [{ id: "li_1", quantity: 1 }],
      },
    }));

  it("builds the correct confirmation redirect with secretKey for guest orders", async () => {
    mockFreshCart();
    requestMock.mockResolvedValueOnce({
      completeActiveCart: {
        id: "order_123",
        shippingAddress: {
          country: {
            iso2: "US",
          },
        },
        secretKey: "secret_key_abc",
      },
    });

    await setCartId("test-cart");

    const result = await placeOrder();

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.redirectTo).toBe(
      "/us/order/confirmed/order_123?secretKey=secret_key_abc"
    );
  });

  it("builds redirect without secretKey for logged-in orders", async () => {
    mockFreshCart();
    requestMock.mockResolvedValueOnce({
      completeActiveCart: {
        id: "order_456",
        shippingAddress: {
          country: {
            iso2: "US",
          },
        },
        secretKey: null,
      },
    });

    await setCartId("test-cart");

    const result = await placeOrder();

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.redirectTo).toBe("/us/order/confirmed/order_456");
    // Cart cookie should be cleared after successful order
    expect(await getCartId()).toBeUndefined();
  });

  it("throws a customer-actionable error when cart cookie is missing (Task 9)", async () => {
    await expect(placeOrder()).resolves.toMatchObject({
      success: false,
      error: "Your session expired. Please return to your cart and try again.",
    });
  });

  it("throws when the completed order has no id (Task 9 — never fabricates success)", async () => {
    mockFreshCart();
    requestMock.mockResolvedValueOnce({
      completeActiveCart: null,
    });

    await setCartId("test-cart");

    await expect(placeOrder()).resolves.toMatchObject({
      success: false, error: expect.stringContaining("We couldn't confirm your order"),
    });
    expect(await getCartId()).toBe("test-cart");
  });
});

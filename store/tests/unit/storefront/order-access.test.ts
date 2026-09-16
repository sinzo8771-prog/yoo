/**
 * Task 8, Step 4 — order lookup authorization boundaries.
 *
 * The backend `getCustomerOrder` mutation enforces the actual access rules
 * (session ownership or guest `secretKey`); these tests verify the store-side
 * contract around it:
 *   - malformed order IDs never reach the backend
 *   - every backend rejection (unauthenticated, wrong customer, bad secretKey)
 *     becomes `null` → the pages render a 404 instead of leaking state
 *   - the customer-safe projection strips internal-only fields
 *     (secretKey, paymentDetails, fulfillmentDetails, user, raw gateway data)
 *     before anything is returned to the UI / RSC payload
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn();

vi.mock("@/features/storefront/lib/config", () => ({
  openfrontClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

vi.mock("@/features/storefront/lib/data/cookies", () => ({
  getAuthHeaders: async () => authHeadersValue,
}));

// orders.ts wraps its lookups in react's `cache()`. Outside a server render
// that memoizes globally for the process lifetime, which would leak results
// between tests — collapse it to a passthrough here.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cache: ((fn: any) => fn) as any,
}));

let authHeadersValue: Record<string, string> = {};

import {
  retrieveOrder,
  listCustomerOrders,
} from "@/features/storefront/lib/data/orders";

/** Full raw order payload exactly as the backend getCustomerOrder returns it. */
const rawBackendOrder = {
  id: "cmorder_abc123",
  secretKey: "sk_live_DO_NOT_LEAK",
  displayId: "1042",
  status: "completed",
  fulfillmentStatus: { status: "shipped" },
  fulfillmentDetails: { internal: "routing-notes" },
  paymentDetails: { internal: "gateway-ref" },
  total: "$58.00",
  formattedTotalPaid: "$58.00",
  subtotal: "$50.00",
  shipping: "$5.00",
  discount: "$0.00",
  tax: "$3.00",
  createdAt: "2026-09-16T10:00:00.000Z",
  email: "customer@example.com",
  unfulfilled: [],
  fulfillments: [
    {
      id: "cmful_1",
      createdAt: "2026-09-16T12:00:00.000Z",
      canceledAt: null,
      fulfillmentItems: [
        {
          id: "cmfi_1",
          quantity: 2,
          lineItem: {
            id: "cmli_1",
            quantity: 2,
            title: "Stoneware Mug",
            sku: "MUG-1",
            thumbnail: "https://cdn/mug.jpg",
            metadata: { hidden: "ops" },
            variantTitle: "12oz",
            formattedUnitPrice: "$25.00",
            formattedTotal: "$50.00",
            productData: { handle: "dev-stoneware-mug" },
            variantData: { sku: "MUG-1" },
          },
        },
      ],
      shippingLabels: [
        {
          id: "cmsl_1",
          labelUrl: "https://labels/1",
          trackingNumber: "TRK123",
          trackingUrl: "https://track/TRK123",
          carrier: "UPS",
        },
      ],
    },
  ],
  user: { id: "cmuser_777", name: "Someone Else", email: "someone.else@example.com" },
  lineItems: [
    {
      id: "cmli_1",
      title: "Stoneware Mug",
      quantity: 2,
      thumbnail: "https://cdn/mug.jpg",
      sku: "MUG-1",
      variantTitle: "12oz",
      formattedUnitPrice: "$25.00",
      formattedTotal: "$50.00",
      productData: { handle: "dev-stoneware-mug" },
      variantData: { sku: "MUG-1" },
    },
  ],
  shippingAddress: {
    firstName: "Test",
    lastName: "Buyer",
    address1: "1 Main St",
    city: "Mumbai",
    province: "MH",
    postalCode: "400001",
    country: { id: "cin", iso2: "in", name: "India" },
    phone: "+91-000",
  },
  billingAddress: null,
  shippingMethods: [
    { id: "cmsm_1", price: "$5.00", shippingOption: { name: "Standard" } },
  ],
  payments: [
    {
      id: "cmpay_1",
      amount: "$58.00",
      status: "captured",
      createdAt: "2026-09-16T10:05:00.000Z",
      data: { id: "pi_3Xinternal", cardLast4: "4242", client_secret: "cs_secret" },
      paymentCollection: {
        paymentSessions: [
          {
            id: "cmps_1",
            isSelected: true,
            paymentProvider: { id: "stripe", code: "stripe" },
          },
        ],
      },
    },
  ],
  region: { id: "cmregion_in", name: "India", currency: { code: "INR" } },
};

const rawBackendOrderListItem = {
  id: "cmorder_abc123",
  displayId: "1042",
  status: "completed",
  fulfillmentStatus: "shipped",
  total: "$58.00",
  formattedTotalPaid: "$58.00",
  createdAt: "2026-09-16T10:00:00.000Z",
  shippingAddress: { country: { id: "cin", iso2: "in" } },
  lineItems: [
    { id: "cmli_1", title: "Stoneware Mug", quantity: 2, thumbnail: "https://cdn/mug.jpg" },
  ],
  region: { id: "cmregion_in", currency: { code: "INR" } },
};

beforeEach(() => {
  requestMock.mockReset();
  authHeadersValue = {};
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("retrieveOrder — authorization boundaries (Task 8, Step 4)", () => {
  it.each([
    "",
    "../../etc/passwd",
    "order%20id with spaces",
    "<script>alert(1)</script>",
    "a".repeat(65),
  ])("rejects malformed order ID %j without calling the backend", async (badId) => {
    const result = await retrieveOrder(badId);
    expect(result).toBeNull();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("returns null when unauthenticated (no session, no secretKey)", async () => {
    requestMock.mockRejectedValue(new Error("Not authenticated"));
    const result = await retrieveOrder("cmorder_abc123");
    expect(result).toBeNull();
  });

  it("returns null when the order belongs to another customer", async () => {
    requestMock.mockRejectedValue(new Error("Order not found"));
    const result = await retrieveOrder("cmorder_abc123");
    expect(result).toBeNull();
  });

  it("returns null when the guest secretKey is wrong", async () => {
    requestMock.mockRejectedValue(new Error("Invalid secret key"));
    const result = await retrieveOrder("cmorder_abc123", "guess-me");
    expect(result).toBeNull();
  });
});

describe("retrieveOrder — customer-safe projection (Task 8, Step 3)", () => {
  it("strips internal-only fields from a guest order fetched via secretKey", async () => {
    requestMock.mockResolvedValue({ getCustomerOrder: rawBackendOrder });

    const result = await retrieveOrder("cmorder_abc123", "sk_live_DO_NOT_LEAK");

    expect(requestMock).toHaveBeenCalledWith(
      expect.anything(),
      { id: "cmorder_abc123", secretKey: "sk_live_DO_NOT_LEAK" },
      {}
    );
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("secretKey");
    expect(result).not.toHaveProperty("paymentDetails");
    expect(result).not.toHaveProperty("fulfillmentDetails");
    expect(result).not.toHaveProperty("user");
  });

  it("keeps every field the order UI consumes and sanitizes payment data", async () => {
    requestMock.mockResolvedValue({ getCustomerOrder: rawBackendOrder });

    const order = (await retrieveOrder("cmorder_abc123", "sk_live_DO_NOT_LEAK"))!;

    // OrderDetails / OrderSummary / ShippingDetails / FulfillmentCard / Items
    expect(order).toMatchObject({
      id: "cmorder_abc123",
      displayId: "1042",
      status: "completed",
      fulfillmentStatus: { status: "shipped" },
      email: "customer@example.com",
      total: "$58.00",
      formattedTotalPaid: "$58.00",
      subtotal: "$50.00",
      shipping: "$5.00",
      tax: "$3.00",
    });
    expect(order.region.currency.code).toBe("INR");
    expect(order.lineItems[0]).toMatchObject({
      id: "cmli_1",
      title: "Stoneware Mug",
      quantity: 2,
      formattedTotal: "$50.00",
    });
    expect(order.fulfillments[0].shippingLabels[0].trackingNumber).toBe("TRK123");
    expect(order.shippingMethods[0].shippingOption.name).toBe("Standard");
    expect(order.shippingAddress.country.iso2).toBe("in");

    // Payment details survive only as a safe projection.
    const payment = order.payments[0];
    expect(payment).toMatchObject({
      id: "cmpay_1",
      status: "captured",
      paymentCollection: {
        paymentSessions: [
          {
            isSelected: true,
            paymentProvider: { id: "stripe", code: "stripe" },
          },
        ],
      },
    });
    expect(payment.data).toEqual({});
  });

  it("projects an order fetched by the owning session identically", async () => {
    authHeadersValue = { authorization: "Bearer session-token" };
    requestMock.mockResolvedValue({ getCustomerOrder: rawBackendOrder });

    const order = await retrieveOrder("cmorder_abc123");

    expect(requestMock).toHaveBeenCalledWith(
      expect.anything(),
      { id: "cmorder_abc123", secretKey: null },
      { authorization: "Bearer session-token" }
    );
    expect(order).not.toBeNull();
    expect(order!).not.toHaveProperty("secretKey");
    expect(order!.payments[0].data).toEqual({});
  });
});

describe("listCustomerOrders — authorization boundaries", () => {
  it("returns null when unauthenticated", async () => {
    requestMock.mockRejectedValue(new Error("Not authenticated"));
    const result = await listCustomerOrders();
    expect(result).toBeNull();
  });

  it("projects list entries down to the customer-safe summary", async () => {
    requestMock.mockResolvedValue({
      getCustomerOrders: [rawBackendOrderListItem],
    });

    const orders = await listCustomerOrders();

    expect(orders).toHaveLength(1);
    const [entry] = orders!;
    expect(entry).toMatchObject({
      id: "cmorder_abc123",
      displayId: "1042",
      total: "$58.00",
      lineItems: [
        { id: "cmli_1", title: "Stoneware Mug", quantity: 2 },
      ],
      shippingAddress: { country: { iso2: "in" } },
      region: { currency: { code: "INR" } },
    });
    // Nothing beyond the whitelisted summary shape is forwarded.
    expect(Object.keys(entry).sort()).toEqual(
      [
        "createdAt",
        "displayId",
        "fulfillmentStatus",
        "formattedTotalPaid",
        "id",
        "lineItems",
        "region",
        "shippingAddress",
        "status",
        "total",
      ].sort()
    );
  });
});
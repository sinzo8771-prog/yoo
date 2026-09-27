import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReferenceClone } from "@/scripts/reference-clones";
import { noteMissingReferenceClone, referenceCloneMissing } from "@/tests/reference-clones";

// Task 13 end-to-end harness: the REAL pinned router, claim state machine, and
// adapter boundary run against in-memory query/prisma fakes. The adapter module
// itself is loaded through OpenShip's own dynamic import
// (features/integrations/channel/synthetic.ts — the verbatim mirror of
// store/integrations/synthetic-channel/synthetic.ts), so nothing here is
// stubbed except the database.
//
// Task 23 (CI follow-up): those pinned modules live in `../openship/`, one of
// the gitignored reference clones, so they are imported in `beforeAll` and this
// suite skips when that clone is not checked out. The `typeof import(...)`
// annotations keep every call site type-checked wherever the clone *is*
// checked out.

const clone: ReferenceClone = "openship";
const cloneMissing = referenceCloneMissing(clone);
noteMissingReferenceClone(clone);

let placeMultipleOrders: typeof import("../../../../openship/features/keystone/lib/placeMultipleOrders")["placeMultipleOrders"];
let supplierPurchaseAttemptKey: typeof import("../../../../openship/features/keystone/lib/supplierPurchaseClaim")["supplierPurchaseAttemptKey"];
let inspectSyntheticPurchases: typeof import("../../../../openship/features/integrations/channel/synthetic")["inspectSyntheticPurchases"];

beforeAll(async () => {
  if (cloneMissing) return;
  ({ placeMultipleOrders } = await import("../../../../openship/features/keystone/lib/placeMultipleOrders"));
  ({ supplierPurchaseAttemptKey } = await import("../../../../openship/features/keystone/lib/supplierPurchaseClaim"));
  ({ inspectSyntheticPurchases } = await import("../../../../openship/features/integrations/channel/synthetic"));
});

type Row = {
  id: string;
  orderId: string;
  channelId: string;
  variantId: string;
  quantity: number;
  price: number;
  status: string;
  purchaseId: string;
  url: string;
  purchaseAttemptKey: string | null;
  purchaseClaimedAt: Date | null;
  error: string;
};

const matchOp = (value: unknown, op: any): boolean => {
  if (op && typeof op === "object") {
    if ("equals" in op) return value === op.equals;
    if ("in" in op) return (op.in as unknown[]).includes(value);
    if ("isNull" in op || "null" in op) return value === null;
  }
  return value === op;
};

function fixture() {
  const cartItems: Row[] = [];
  const orderUpdates: { id: string; status: string }[] = [];
  const orders: Record<string, any> = {};

  const addOrder = (id: string, overrides: Record<string, unknown> = {}) => {
    orders[id] = {
      id,
      firstName: "Test", lastName: "Buyer",
      streetAddress1: "1 Main St", streetAddress2: "",
      city: "Springfield", state: "IL", zip: "62704",
      country: "US", phone: "555-0100", currency: "USD",
      user: { email: "buyer@example.com" },
      shop: { domain: null, accessToken: "", platform: { addCartToPlatformOrderFunction: "none" } },
      orderId: `shop-order-${id}`, orderName: `#${id}`,
      ...overrides,
    };
  };

  const addItem = (id: string, orderId: string, channelId: string, variantId: string, quantity = 1) => {
    cartItems.push({
      id, orderId, channelId, variantId, quantity, price: 10,
      status: "PENDING", purchaseId: "", url: "",
      purchaseAttemptKey: null, purchaseClaimedAt: null, error: "",
    });
  };

  const query = {
    Order: {
      findOne: async ({ where }: { where: { id: string } }) => orders[where.id] ?? null,
      updateOne: async ({ where, data }: { where: { id: string }; data: { status: string } }) => {
        const order = orders[where.id];
        order.status = data.status;
        orderUpdates.push({ id: where.id, status: data.status });
        return {
          ...order,
          shop: { platform: { addCartToPlatformOrderFunction: "none" } },
          cartItems: cartItems.filter(item => item.orderId === where.id),
        };
      },
    },
    Channel: {
      findMany: async ({ query: gql = "" }: { query?: string } = {}) => {
        // Mimic the pinned router's channel query: cart items still awaiting a
        // purchase (purchaseId "" and url "") grouped under their channel. The
        // pinned query embeds `order: { id: { equals: "<orderId>" } }` in the
        // selection text — honor it the way the real resolver would.
        const orderMatch = /order:\s*\{\s*id:\s*\{\s*equals:\s*"([^"]+)"/.exec(gql);
        const orderId = orderMatch?.[1];
        const channelIds = [...new Set(cartItems.map(item => item.channelId))];
        return channelIds.map(channelId => ({
          id: channelId,
          domain: null,
          accessToken: "",
          cartItems: cartItems.filter(item =>
            item.channelId === channelId && item.purchaseId === "" && item.url === "" &&
            (orderId === undefined || item.orderId === orderId)),
          platform: { createPurchaseFunction: "synthetic" },
          metadata: null,
        }));
      },
    },
    CartItem: {
      count: async ({ where }: { where: any }) =>
        cartItems.filter(item =>
          item.orderId === where.order?.id?.equals &&
          item.url === "" && item.purchaseId === "").length,
    },
  };

  const prisma = {
    $transaction: async (fn: (tx: any) => unknown) => fn(prisma),
    cartItem: {
      findMany: async ({ where }: { where: any }) =>
        cartItems.filter(item => (where.id?.in as string[])?.includes(item.id)),
      updateMany: async ({ where, data }: { where: any; data: Partial<Row> }) => {
        const matched = cartItems.filter(item =>
          (!where.id?.in || (where.id.in as string[]).includes(item.id)) &&
          (where.orderId === undefined || matchOp(item.orderId, where.orderId)) &&
          (where.channelId === undefined || matchOp(item.channelId, where.channelId)) &&
          (where.purchaseId === undefined || matchOp(item.purchaseId, where.purchaseId)) &&
          (where.url === undefined || matchOp(item.url, where.url)) &&
          (where.purchaseAttemptKey === undefined || matchOp(item.purchaseAttemptKey, where.purchaseAttemptKey)) &&
          (where.status === undefined || matchOp(item.status, where.status)));
        for (const item of matched) Object.assign(item, data);
        return { count: matched.length };
      },
    },
  };

  return { cartItems, orders, orderUpdates, addOrder, addItem, query, prisma };
}

beforeEach(() => {
  // The adapter's purchase map is module-level and keyed by the claim key
  // (which embeds the order ID), so unique order/item IDs isolate tests.
  vi.restoreAllMocks();
});

describe.skipIf(cloneMissing)("synthetic end-to-end routing (pinned router + adapter)", () => {
  it("purchases matched lines through the synthetic adapter and marks the order AWAITING", async () => {
    const f = fixture();
    f.addOrder("order-1");
    f.addItem("ci-1", "order-1", "channel-1", "syn_sku_a", 2);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const processed = await placeMultipleOrders({ ids: ["order-1"], query: f.query, prisma: f.prisma });

    expect(processed).toHaveLength(1);
    const item = f.cartItems[0];
    expect(item.purchaseId).toMatch(/^syn_purchase_[0-9a-f]{16}$/);
    expect(item.status).toBe("AWAITING");
    expect(item.error).toBe("");
    expect(f.orderUpdates).toEqual([{ id: "order-1", status: "AWAITING" }]);
    // The pinned chain calls the shop platform adapter last; the "none" shop
    // adapter fails to load and the router degrades gracefully with a warning.
    expect(warn).toHaveBeenCalled();
  });

  it("forwards the claim attempt key so identical carts on different orders get distinct purchases", async () => {
    const f = fixture();
    f.addOrder("order-a");
    f.addOrder("order-b");
    f.addItem("ci-a", "order-a", "channel-1", "syn_same_sku", 1);
    f.addItem("ci-b", "order-b", "channel-1", "syn_same_sku", 1);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await placeMultipleOrders({ ids: ["order-a", "order-b"], query: f.query, prisma: f.prisma });

    const [a, b] = f.cartItems;
    expect(a.purchaseId).toMatch(/^syn_purchase_/);
    expect(b.purchaseId).toMatch(/^syn_purchase_/);
    // The adapter dedupes by idempotencyKey when forwarded (attemptKey embeds
    // the order ID) and by cart+address hash when not. Identical carts with
    // different order IDs MUST NOT collide — proves the pinned router forwards
    // claim.attemptKey end to end (Task 13 Step 4).
    expect(a.purchaseId).not.toBe(b.purchaseId);
  });

  it("re-running completed orders creates no second purchase and touches no state", async () => {
    const f = fixture();
    f.addOrder("order-1");
    f.addItem("ci-1", "order-1", "channel-1", "syn_sku_a");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await placeMultipleOrders({ ids: ["order-1"], query: f.query, prisma: f.prisma });
    const afterFirst = JSON.stringify(f.cartItems);

    const processed = await placeMultipleOrders({ ids: ["order-1"], query: f.query, prisma: f.prisma });

    expect(processed).toEqual([]);
    expect(JSON.stringify(f.cartItems)).toBe(afterFirst);
    expect(f.orderUpdates).toHaveLength(1);
  });

  it("an in-flight claim on the same items is not lease-stealable and creates no second purchase", async () => {
    const f = fixture();
    f.addOrder("order-1");
    f.addItem("ci-1", "order-1", "channel-1", "syn_sku_a");
    const attemptKey = supplierPurchaseAttemptKey({
      orderId: "order-1", channelId: "channel-1", cartItemIds: ["ci-1"],
    });
    // Simulate a concurrent run that already claimed the items.
    f.cartItems[0].status = "PURCHASE_PROCESSING";
    f.cartItems[0].purchaseAttemptKey = attemptKey;
    f.cartItems[0].purchaseClaimedAt = new Date();

    const processed = await placeMultipleOrders({ ids: ["order-1"], query: f.query, prisma: f.prisma });

    expect(processed).toEqual([]);
    expect(f.cartItems[0].purchaseId).toBe("");
    expect(f.orderUpdates).toEqual([]);
  });

  it("an unknown SKU fails closed: items land in PURCHASE_OUTCOME_UNKNOWN and the order stays PENDING", async () => {
    const f = fixture();
    f.addOrder("order-1");
    f.addItem("ci-1", "order-1", "channel-1", "not_a_syn_sku");
    const attemptKey = supplierPurchaseAttemptKey({
      orderId: "order-1", channelId: "channel-1", cartItemIds: ["ci-1"],
    });

    await placeMultipleOrders({ ids: ["order-1"], query: f.query, prisma: f.prisma });

    const item = f.cartItems[0];
    expect(item.purchaseId).toBe("");
    expect(item.status).toBe("PURCHASE_OUTCOME_UNKNOWN");
    expect(item.error).toContain("PURCHASE_OUTCOME_UNKNOWN");
    expect(item.error).toContain(attemptKey);
    // Unresolved lines hold the order back — no premature AWAITING (Step 3:
    // partial fulfillment is not silently accepted).
    expect(f.orderUpdates).toEqual([{ id: "order-1", status: "PENDING" }]);
  });

  it("maps every line exactly: multi-variant, multi-quantity carts reach the adapter intact", async () => {
    const f = fixture();
    f.addOrder("order-1");
    f.addItem("ci-1", "order-1", "channel-1", "syn_sku_a", 2);
    f.addItem("ci-2", "order-1", "channel-1", "syn_sku_b", 1);
    f.addItem("ci-3", "order-1", "channel-1", "syn_sku_c", 3);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const purchasesBefore = inspectSyntheticPurchases().length;

    await placeMultipleOrders({ ids: ["order-1"], query: f.query, prisma: f.prisma });

    expect(f.cartItems.every(item => item.status === "AWAITING")).toBe(true);
    const created = inspectSyntheticPurchases().slice(purchasesBefore);
    expect(created).toHaveLength(1);
    // Exact line mapping (Task 13 Step 1): the adapter saw each cart line with
    // its precise variant ID and quantity, in order, nothing added or dropped.
    expect(created[0].lines).toEqual([
      { variantId: "syn_sku_a", quantity: 2 },
      { variantId: "syn_sku_b", quantity: 1 },
      { variantId: "syn_sku_c", quantity: 3 },
    ]);
  });

  it("a mixed cart is all-or-nothing at the adapter boundary: no partial purchase", async () => {
    const f = fixture();
    f.addOrder("order-1");
    f.addItem("ci-1", "order-1", "channel-1", "syn_sku_ok");
    f.addItem("ci-2", "order-1", "channel-1", "totally_unknown");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await placeMultipleOrders({ ids: ["order-1"], query: f.query, prisma: f.prisma });

    for (const item of f.cartItems) {
      expect(item.purchaseId).toBe("");
      expect(item.status).toBe("PURCHASE_OUTCOME_UNKNOWN");
    }
    expect(f.orderUpdates).toEqual([{ id: "order-1", status: "PENDING" }]);
  });
});

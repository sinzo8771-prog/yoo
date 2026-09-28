import { beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { state } from "../../stubs/openship-keystone-context";
import type { ReferenceClone } from "@/scripts/reference-clones";
import { noteMissingReferenceClone, referenceCloneMissing } from "@/tests/reference-clones";

// The pinned adapter module and the route import the Keystone context at the
// top level; the vitest alias maps that specifier to the mutable stub
// (tests/stubs/openship-keystone-context.ts). The webhook handlers under test
// never touch it; the route-level suite injects resolvers through `state`.
//
// Task 23 (CI follow-up): the pinned executor and webhook-security modules live
// in `../openship/`, one of the gitignored reference clones, so they are
// imported in a `beforeAll` INSIDE each skipped suite and the suites skip via
// `describe.skipIf(cloneMissing)` when that clone is not checked out. The
// `beforeAll` must not sit at file top level: vitest 3 fails collection when a
// file registers hooks but all of its suites are skipped. The
// `typeof import(...)` annotations keep every call site type-checked wherever
// the clone *is* checked out.

const clone: ReferenceClone = "openship";
const cloneMissing = referenceCloneMissing(clone);
noteMissingReferenceClone(clone);

let handleShopOrderWebhook: typeof import("../../../../openship/features/integrations/shop/lib/executor")["handleShopOrderWebhook"];
let handleShopCancelWebhook: typeof import("../../../../openship/features/integrations/shop/lib/executor")["handleShopCancelWebhook"];
let deriveOpenFrontShopWebhookSecret: typeof import("../../../../openship/features/integrations/shop/openfront-webhook-security")["deriveOpenFrontShopWebhookSecret"];
let verifyOpenFrontShopWebhook: typeof import("../../../../openship/features/integrations/shop/openfront-webhook-security")["verifyOpenFrontShopWebhook"];
// The pinned create-order route must be lazy for the same reason: a static
// import resolves while the module graph is collected, i.e. *before*
// `describe.skipIf(cloneMissing)` can skip — so a clone-less checkout (CI)
// would fail collection instead of skipping.
let POST: typeof import("../../../../openship/app/api/handlers/shop/create-order/[shopId]/route")["POST"];

async function loadPinnedIngestion() {
  ({ handleShopOrderWebhook, handleShopCancelWebhook } = await import(
    "../../../../openship/features/integrations/shop/lib/executor"
  ));
  ({ deriveOpenFrontShopWebhookSecret, verifyOpenFrontShopWebhook } = await import(
    "../../../../openship/features/integrations/shop/openfront-webhook-security"
  ));
  ({ POST } = await import("../../../../openship/app/api/handlers/shop/create-order/[shopId]/route"));
}


const SECRET = "op-secret";
const signWith = (secret: string, event: unknown) =>
  createHmac("sha256", secret).update(JSON.stringify(event)).digest("hex");
const sign = (event: unknown) => signWith(deriveOpenFrontShopWebhookSecret(SECRET), event);

const baseEvent = () => ({
  topic: "order.created",
  data: {
    id: "of_order_1",
    displayId: 1042,
    email: "buyer@example.com",
    currency: { code: "usd" },
    rawTotal: 4398,
    subtotal: "$41.98",
    discount: "$0",
    tax: "$2.00",
    shippingAddress: {
      firstName: "Ada", lastName: "Lovelace",
      address1: "1 Main St", address2: "Unit 2",
      city: "Springfield", province: "IL", postalCode: "62704",
      country: { iso2: "us" }, phone: "+1 555 0100",
    },
    lineItems: [
      {
        id: "li-1", quantity: 2,
        title: "Fallback title",
        sku: "fallback-sku",
        moneyAmount: { amount: 2199 },
        productVariant: {
          id: "of_var_1", sku: "of-sku-1", title: "M",
          product: { id: "of_prod_1", title: "Widget", productImages: [] },
        },
      },
    ],
  },
});

const platform = () => ({
  name: "openfront",
  appSecret: SECRET,
  webhookSecret: undefined as string | undefined,
  domain: "http://localhost:3000",
  accessToken: "t",
  // Adapter slots as a real ShopPlatform row carries them: they name the
  // module (relative to features/integrations/shop/) the executor imports.
  createOrderWebhookHandler: "openfront",
  cancelOrderWebhookHandler: "openfront",
});

describe.skipIf(cloneMissing)("order ingestion (Task 13 step 2): signature boundary", () => {
  beforeAll(loadPinnedIngestion);
  it("accepts a correctly signed event through the real executor dispatch", async () => {
    const event = baseEvent();
    const result = await handleShopOrderWebhook({
      platform: platform(), event, headers: { "x-openfront-webhook-signature": sign(event) },
    });
    expect(result.orderId).toBe("of_order_1");
  });

  it("rejects a body tampered after signing", async () => {
    const event = baseEvent();
    const signature = sign(event);
    event.data.id = "of_order_999";
    await expect(handleShopOrderWebhook({
      platform: platform(), event, headers: { "x-openfront-webhook-signature": signature },
    })).rejects.toThrow();
  });

  it("rejects a signature made with the wrong secret", async () => {
    const event = baseEvent();
    await expect(handleShopOrderWebhook({
      platform: platform(),
      event,
      headers: { "x-openfront-webhook-signature": signWith("attacker-secret", event) },
    })).rejects.toThrow();
  });

  it("rejects truncated, malformed, and missing signatures", async () => {
    const event = baseEvent();
    for (const signature of ["deadbeef", `sha256=${"a".repeat(63)}`, `sha256=${"g".repeat(64)}`, ""]) {
      await expect(handleShopOrderWebhook({
        platform: platform(), event, headers: { "x-openfront-webhook-signature": signature },
      })).rejects.toThrow();
    }
    await expect(handleShopOrderWebhook({
      platform: platform(), event, headers: {},
    })).rejects.toThrow();
  });

  it("prefers an explicit webhookSecret over the derived appSecret", async () => {
    const event = baseEvent();
    const explicit = "a".repeat(32);
    const withExplicit = { ...platform(), webhookSecret: explicit, appSecret: undefined };
    // Signed with the explicit secret → accepted.
    await expect(handleShopOrderWebhook({
      platform: withExplicit, event, headers: { "x-openfront-webhook-signature": signWith(explicit, event) },
    })).resolves.toMatchObject({ orderId: "of_order_1" });
    // Signed with the (no longer active) derived secret → rejected.
    await expect(handleShopOrderWebhook({
      platform: withExplicit, event, headers: { "x-openfront-webhook-signature": sign(event) },
    })).rejects.toThrow();
  });

  it("rejects when no verification material is configured", async () => {
    const event = baseEvent();
    await expect(handleShopOrderWebhook({
      platform: { ...platform(), appSecret: undefined },
      event, headers: { "x-openfront-webhook-signature": sign(event) },
    })).rejects.toThrow();
  });

  it("verifies directly at the security helper with sha256= prefixes", () => {
    const event = baseEvent();
    expect(verifyOpenFrontShopWebhook(event, `sha256=${sign(event)}`, SECRET)).toBe(true);
    expect(verifyOpenFrontShopWebhook(event, sign(event).toUpperCase(), SECRET)).toBe(true);
    expect(verifyOpenFrontShopWebhook(event, sign(event), "other-secret")).toBe(false);
    expect(verifyOpenFrontShopWebhook(event, undefined, SECRET)).toBe(false);
  });
});
describe.skipIf(cloneMissing)("order ingestion (Task 13 step 2): Openfront ? OpenShip transform", () => {
  beforeAll(loadPinnedIngestion);
  const ingest = async () => {
    const event = baseEvent();
    const result = await handleShopOrderWebhook({
      platform: platform(), event, headers: { "x-openfront-webhook-signature": sign(event) },
    });
    return result;
  };

  it("preserves the source order ID as the correlation key", async () => {
    const result = await ingest();
    expect(result.orderId).toBe("of_order_1");
    expect(result.orderName).toBe("#1042");
  });

  it("maps the full Keystone-ready order shape", async () => {
    const result = await ingest();
    expect(result).toMatchObject({
      email: "buyer@example.com",
      firstName: "Ada", lastName: "Lovelace",
      streetAddress1: "1 Main St", streetAddress2: "Unit 2",
      city: "Springfield", state: "IL", zip: "62704",
      country: "US", phone: "+1 555 0100",
      currency: "USD",
      totalPrice: 43.98, subTotalPrice: 41.98,
      totalDiscounts: 0, totalTax: 2,
      status: "INPROCESS",
      linkOrder: true, matchOrder: true, processOrder: true,
    });
  });

  it("maps line items exactly, combining product and variant titles", async () => {
    const result = await ingest();
    expect(result.lineItems.create).toEqual([{
      name: "Widget - M",
      image: undefined, // no images and no thumbnail; the route's removeEmpty strips it
      price: 21.99,
      quantity: 2,
      productId: "of_prod_1",
      variantId: "of_var_1",
      sku: "of-sku-1",
      lineItemId: "li-1",
    }]);
  });

  it("falls back to flat title/sku when no variant relation is present", async () => {
    const event = baseEvent();
    // A real delivery may omit the variant relation entirely; the signature is
    // computed over whatever the wire actually carried.
    (event.data.lineItems[0] as any).productVariant = undefined;
    const result = await handleShopOrderWebhook({
      platform: platform(), event, headers: { "x-openfront-webhook-signature": sign(event) },
    });
    expect(result.lineItems.create[0]).toMatchObject({
      name: "Fallback title", sku: "fallback-sku", productId: undefined, variantId: undefined,
    });
  });

  it("defaults currency to USD and zeroes missing amounts", async () => {
    const event = baseEvent();
    // Undocumented-but-observed OpenFront payload: the fields are simply absent.
    const payload = event.data as any;
    delete payload.currency;
    delete payload.rawTotal;
    payload.lineItems[0].moneyAmount = undefined;
    const result = await handleShopOrderWebhook({
      platform: platform(), event, headers: { "x-openfront-webhook-signature": sign(event) },
    });
    expect(result.currency).toBe("USD");
    expect(result.totalPrice).toBe(0);
    expect(result.lineItems.create[0].price).toBe(0);
  });
});

describe.skipIf(cloneMissing)("order ingestion (Task 13 step 2): cancellation webhook", () => {
  beforeAll(loadPinnedIngestion);
  it("returns the source order ID for a valid cancellation event", async () => {
    const event = { topic: "order.cancelled", data: { id: "of_order_1" } };
    const result = await handleShopCancelWebhook({
      platform: platform(), event,
      headers: { "x-openfront-webhook-signature": sign(event) },
    });
    expect(result).toBe("of_order_1");
  });

  it("rejects a cancellation event missing the order ID", async () => {
    const event = { topic: "order.cancelled", data: {} };
    await expect(handleShopCancelWebhook({
      platform: platform(), event,
      headers: { "x-openfront-webhook-signature": sign(event) },
    })).rejects.toThrow("Missing order ID");
  });
});

// ---------------------------------------------------------------------------
// Real pinned route: POST /api/handlers/shop/create-order/[shopId]
// (dedupe on orderId+shop, concurrent-race recovery, fail-closed errors).
// The executor/adapter run for real; Keystone resolvers are injected below.
// ---------------------------------------------------------------------------

function seedShop() {
  const orders: any[] = [];
  const calls = { findOne: 0, findMany: 0, createOne: 0 };
  // Set by failCreateOne(): models an insert that loses the unique race on
  // Order.orderId, optionally with the concurrent winner's row already durable.
  let createFault: { winner: boolean } | null = null;
  state.query = {
    Shop: {
      findOne: async ({ where }: any) => {
        calls.findOne++;
        if (where.id !== "shop-1") return null;
        return {
          id: "shop-1", domain: "http://localhost:3000", accessToken: "t",
          metadata: {}, webhookSecret: undefined,
          user: { id: "operator-1", email: "op@example.com" },
          links: [{ channel: { id: "channel-1", name: "local-test-supplier" } }],
          platform: platform(),
        };
      },
    },
    Order: {
      findMany: async ({ where }: any) => {
        calls.findMany++;
        const orderId = where?.orderId?.equals;
        const shopId = where?.shop?.id?.equals;
        // Keystone rejects `equals` without a value instead of matching every
        // row, so a route that dropped the correlation key fails loudly here.
        if (orderId === undefined || orderId === null) {
          throw new Error("Keystone: 'equals' requires a value");
        }
        return orders
          .filter(order => order.orderId === orderId && (order.shopId ?? order.shop?.id) === shopId)
          .slice(0, 1);
      },
      createOne: async ({ data }: any) => {
        calls.createOne++;
        if (createFault) {
          if (createFault.winner) {
            // The concurrent delivery committed between the route's findMany
            // and this insert, so the canonical row exists even though the
            // insert itself lost the unique race.
            orders.push({ id: "order-winner", orderId: data.orderId, shopId: data.shop?.connect?.id });
          }
          throw new Error("Unique constraint failed on Order.orderId");
        }
        // Keystone persists `shop: { connect: { id } }` as a shopId column,
        // which is the shape the route's dedupe filter queries by.
        const order = { id: `order-${orders.length + 1}`, ...data, shopId: data.shop?.connect?.id };
        orders.push(order);
        return order;
      },
    },
  };
  return {
    orders, calls,
    // `winner: true` lands the concurrent row (recovery path); otherwise the
    // store stays empty and the route must surface the failure.
    failCreateOne: ({ winner }: { winner?: boolean } = {}) => {
      orders.length = 0;
      createFault = { winner: Boolean(winner) };
    },
  };
}

const requestFrom = (event: unknown, signature?: string) => {
  const headers = new Headers();
  if (signature !== undefined) {
    headers.set("x-openfront-webhook-signature", signature);
  }
  return { json: async () => event, headers } as any;
};

const callRoute = (event: unknown, signature?: string) =>
  POST(requestFrom(event, signature), { params: Promise.resolve({ shopId: "shop-1" }) });

describe.skipIf(cloneMissing)("order ingestion (Task 13 step 2): create-order route", () => {
  beforeAll(loadPinnedIngestion);
  it("creates the order once from a signed webhook", async () => {
    const db = seedShop();
    const event = baseEvent();
    const response = await callRoute(event, sign(event));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(db.calls.createOne).toBe(1);
    expect(db.orders[0].orderId).toBe("of_order_1");
    expect(db.orders[0].shop).toEqual({ connect: { id: "shop-1" } });
    expect(db.orders[0].user).toEqual({ connect: { id: "operator-1" } });
    expect(db.orders[0].status).toBe("INPROCESS");
    expect(db.orders[0].lineItems.create[0].variantId).toBe("of_var_1");
  });

  it("acknowledges a replayed webhook against the canonical row without re-creating", async () => {
    const db = seedShop();
    const event = baseEvent();
    const signature = sign(event);
    await callRoute(event, signature);
    db.calls.createOne = 0;
    db.calls.findMany = 0;
    const response = await callRoute(event, signature);
    expect(response.status).toBe(200);
    expect(db.calls.createOne).toBe(0);
    expect(db.calls.findMany).toBe(1);
  });

  it("fails closed with 500 on a bad signature and writes nothing", async () => {
    const db = seedShop();
    const event = baseEvent();
    const response = await callRoute(event, signWith("wrong-secret", event));
    expect(response.status).toBe(500);
    expect(db.calls.createOne).toBe(0);
  });

  it("fails closed with 500 for an unknown shop and writes nothing", async () => {
    const db = seedShop();
    const event = baseEvent();
    const response = await POST(requestFrom(event, sign(event)), {
      params: Promise.resolve({ shopId: "shop-unknown" }),
    });
    expect(response.status).toBe(500);
    expect(db.calls.createOne).toBe(0);
  });

  it("recovers the concurrent winner when createOne loses a dedupe race", async () => {
    const db = seedShop();
    // The winner had not committed when the route ran its findMany, so only the
    // catch-block re-query can discover it after our insert collides.
    db.failCreateOne({ winner: true });
    const event = baseEvent();
    const response = await callRoute(event, sign(event));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(db.calls.findMany).toBe(2);
    expect(db.calls.createOne).toBe(1);
    // The adopted row is the concurrent winner's, not a second local insert.
    expect(db.orders).toHaveLength(1);
    expect(db.orders[0].id).toBe("order-winner");
  });

  it("returns 500 when createOne fails and no winner exists", async () => {
    const db = seedShop();
    db.failCreateOne();
    const event = baseEvent();
    const response = await callRoute(event, sign(event));
    expect(response.status).toBe(500);
    expect(db.calls.findMany).toBe(2);
    expect(db.orders).toHaveLength(0);
  });
});

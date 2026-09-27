import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { state } from "../../stubs/openship-keystone-context";
import type { ReferenceClone } from "@/scripts/reference-clones";
import { noteMissingReferenceClone, referenceCloneMissing } from "@/tests/reference-clones";

// Task 13 Step 2 harness (route level): the REAL pinned ingestion route runs
// with only the database faked. The executor's dynamic import loads the real
// openfront.ts adapter (signature verification happens there, against the shop
// row the route looked up), so the replay/dedupe semantics below exercise the
// pinned create-order handler, not a copy.
//
// Task 23 (CI follow-up): the route and the webhook-security helper live in
// `../openship/`, one of the gitignored reference clones, so they are imported
// in `beforeAll` and this suite skips when that clone is not checked out. The
// `typeof import(...)` annotations keep every call site type-checked wherever
// the clone *is* checked out.

const clone: ReferenceClone = "openship";
const cloneMissing = referenceCloneMissing(clone);
noteMissingReferenceClone(clone);

let POST: typeof import("../../../../openship/app/api/handlers/shop/create-order/[shopId]/route")["POST"];
let deriveOpenFrontShopWebhookSecret: typeof import("../../../../openship/features/integrations/shop/openfront-webhook-security")["deriveOpenFrontShopWebhookSecret"];

beforeAll(async () => {
  if (cloneMissing) return;
  ({ POST } = await import("../../../../openship/app/api/handlers/shop/create-order/[shopId]/route"));
  ({ deriveOpenFrontShopWebhookSecret } = await import(
    "../../../../openship/features/integrations/shop/openfront-webhook-security"
  ));
});

const SHOP = {
  id: "shop-1", domain: "http://openfront.test", accessToken: "tok",
  metadata: null, webhookSecret: null,
  user: { id: "operator" },
  links: [{ channel: { id: "channel-1", name: "synthetic" } }],
  platform: {
    id: "sp-1", name: "openfront", createOrderWebhookHandler: "openfront",
    appKey: "key", appSecret: "op-secret",
  },
};

const orderEvent = () => ({
  topic: "order.created",
  data: {
    id: "of_order_1", displayId: 1042, email: "buyer@example.com",
    currency: { code: "usd" }, rawTotal: 4398, subtotal: "$41.98",
    discount: "$0", tax: "$2.00",
    shippingAddress: {
      firstName: "Ada", lastName: "Lovelace",
      address1: "1 Main St", address2: "Unit 2",
      city: "Springfield", province: "IL", postalCode: "62704",
      country: { iso2: "us" }, phone: "+1 555 0100",
    },
    lineItems: [{
      id: "li-1", quantity: 2, title: "Fallback title", sku: "fallback-sku",
      moneyAmount: { amount: 2199 },
      productVariant: {
        id: "of_var_1", sku: "of-sku-1", title: "M",
        product: { id: "of_prod_1", title: "Widget", productImages: [] },
      },
    }],
  },
});

const sign = (event: unknown) =>
  createHmac("sha256", deriveOpenFrontShopWebhookSecret("op-secret"))
    .update(JSON.stringify(event))
    .digest("hex");

function fixture() {
  const rows: any[] = [];
  let createShouldThrow = false;
  let createOneCalls = 0;
  let findManyCalls = 0;
  const createCalls: any[] = [];
  const query = {
    Shop: { findOne: async () => JSON.parse(JSON.stringify(SHOP)) },
    Order: {
      findMany: async ({ where }: any) => {
        findManyCalls++;
        const orderId = where?.orderId?.equals;
        const shopId = where?.shop?.id?.equals;
        // Mirror Keystone: equals: undefined is a rejected query.
        if (orderId === undefined || orderId === null) {
          throw new Error("Keystone: equals requires a value");
        }
        return rows.filter(o => o.orderId === orderId && o.shopId === shopId).slice(0, 1);
      },
      createOne: async ({ data }: any) => {
        createOneCalls++;
        createCalls.push(data);
        if (createShouldThrow) {
          // A concurrent delivery committed the canonical row between the
          // route's findMany and this insert: the unique orderId index rejects
          // the insert while the winner's row is now durable.
          if (!rows.some(r => r.orderId === data.orderId)) {
            rows.push({ id: "os-winner", orderId: data.orderId, shopId: data.shop?.connect?.id });
          }
          throw new Error("Unique constraint failed on Order.orderId");
        }
        const row = { id: `os-${rows.length + 1}`, orderId: data.orderId, shopId: data.shop?.connect?.id };
        rows.push(row);
        return { ...row };
      },
    },
  };
  const request = async (body: unknown, headers: Record<string, string> = {}, shopId = "shop-1") =>
    POST(
      { json: async () => body, headers: { entries: () => Object.entries(headers) } } as any,
      { params: Promise.resolve({ shopId }) },
    );
  const signed = () => {
    const event = orderEvent();
    return { event, headers: { "x-openfront-webhook-signature": sign(event) } };
  };
  return {
    query, rows, createCalls, request, signed,
    counts: () => ({ createOneCalls, findManyCalls }),
    setCreateShouldThrow: (v: boolean) => { createShouldThrow = v; },
  };
}

beforeEach(() => {
  state.query = {};
});

describe.skipIf(cloneMissing)("create-order route ingestion (Task 13 step 2, route level)", () => {
  it("ingests a signed order end to end, preserving the source orderId", async () => {
    const f = fixture();
    state.query = f.query;
    const { event, headers } = f.signed();
    const response = await f.request(event, headers);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(f.counts().createOneCalls).toBe(1);
    const data = f.createCalls[0];
    expect(data.orderId).toBe("of_order_1");
    expect(data.status).toBe("INPROCESS");
    expect(data.shop).toEqual({ connect: { id: "shop-1" } });
    expect(data.user).toEqual({ connect: { id: "operator" } });
    // removeEmpty dropped the empty image/address2 but kept real content.
    expect(data.lineItems.create[0]).toMatchObject({
      name: "Widget - M", price: 21.99, quantity: 2, variantId: "of_var_1",
    });
    // The pinned adapter always sets `image` (undefined when OpenFront has no
    // product image); route removeEmpty only strips top-level empties.
    expect(data.lineItems.create[0].image).toBeUndefined();
    expect(data.streetAddress2).toBe("Unit 2");
  });

  it("acknowledges a replayed webhook against the canonical row without re-creating", async () => {
    const f = fixture();
    state.query = f.query;
    const { event, headers } = f.signed();
    await f.request(event, headers);
    const again = await f.request(event, headers);
    expect(again.status).toBe(200);
    expect(f.counts().createOneCalls).toBe(1);
    expect(f.rows).toHaveLength(1);
  });

  it("adopts the canonical row when a concurrent delivery wins the create race", async () => {
    const f = fixture();
    state.query = f.query;
    const { event, headers } = f.signed();
    // The winner had not committed when the route ran its findMany, so only the
    // catch-block re-query can discover it after our insert collides.
    f.setCreateShouldThrow(true);
    const response = await f.request(event, headers);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    // The route's first create collides with the concurrent row, the catch
    // re-query finds the canonical winner, and no second row is created.
    expect(f.counts().findManyCalls).toBe(2);
    expect(f.counts().createOneCalls).toBe(1);
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0].id).toBe("os-winner");
  });

  it("rejects a tampered body without creating an order", async () => {
    const f = fixture();
    state.query = f.query;
    const { event, headers } = f.signed();
    event.data.id = "of_order_999";
    const response = await f.request(event, headers);
    expect(response.status).toBe(500);
    expect(f.counts().createOneCalls).toBe(0);
    expect(f.rows).toHaveLength(0);
  });

  it("fails closed when the event carries no source order id", async () => {
    const f = fixture();
    state.query = f.query;
    const { event, headers } = f.signed();
    // An OpenFront delivery with no source order id cannot be correlated.
    delete (event.data as any).id;
    const response = await f.request(event, headers);
    expect(response.status).toBe(500);
    expect(f.counts().createOneCalls).toBe(0);
    expect(f.rows).toHaveLength(0);
  });

  it("fails closed when the shop does not exist", async () => {
    const f = fixture();
    state.query = {
      ...f.query,
      Shop: { findOne: async () => null },
    };
    const { event, headers } = f.signed();
    const response = await f.request(event, headers);
    expect(response.status).toBe(500);
    expect(f.counts().createOneCalls).toBe(0);
  });
});

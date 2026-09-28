import { readFileSync } from "node:fs";
import { buildSchema, graphql, type GraphQLSchema } from "graphql";
import { describe, expect, it } from "vitest";
import type { ReferenceClone } from "@/scripts/reference-clones";
import { noteMissingReferenceClone, referenceCloneMissing } from "@/tests/reference-clones";

// Task 11 red tests: drive the pinned createChannelPurchase contract the way
// OpenShip's executeChannelAdapterFunction does (dynamic import by the platform's
// function name, call adapter[functionName]({ platform, ...args })). In-memory
// channel row; the adapter module under @/integrations/synthetic-channel does not
// exist yet, so these tests must fail on the missing integration.
//
// Task 23 (CI follow-up): the contract is `schema.graphql` at the root of the
// `../openship/` reference clone (gitignored), so it is read on first use rather
// than at load time — a clone-less checkout has to be able to load this file in
// order to *skip* it rather than die on a missing file.

const clone: ReferenceClone = "openship";
const cloneMissing = referenceCloneMissing(clone);
noteMissingReferenceClone(clone);
let schemaCache: GraphQLSchema | undefined;

function schema(): GraphQLSchema {
  if (!schemaCache) {
    schemaCache = buildSchema(
      readFileSync(new URL("../../../../openship/schema.graphql", import.meta.url), "utf8")
    );
  }
  return schemaCache;
}

const syntheticPlatform = {
  name: "synthetic",
  searchProductsFunction: "synthetic",
  getProductFunction: "synthetic",
  createPurchaseFunction: "synthetic",
  createWebhookFunction: "synthetic",
  oAuthFunction: "synthetic",
  oAuthCallbackFunction: "synthetic",
  createTrackingWebhookHandler: "synthetic",
  cancelPurchaseWebhookHandler: "synthetic",
  getWebhooksFunction: "synthetic",
  deleteWebhookFunction: "synthetic",
};

// Mirrors openship/features/keystone/utils/channelProviderAdapter.ts dispatch:
// non-URL function names import integrations/channel/<name>.ts and call
// adapter[functionName]({ platform, ...args }).
async function executeChannelAdapterFunction({ platform, functionName, args }: {
  platform: Record<string, any>;
  functionName: string;
  args: Record<string, unknown>;
}) {
  const adapter = await import(`@/integrations/synthetic-channel/${platform[functionName]}`);
  const fn = adapter[functionName];
  if (!fn) throw new Error(`Function ${functionName} not found in adapter ${platform[functionName]}`);
  return fn({ platform, ...args });
}

const CREATE_CHANNEL_PURCHASE = `mutation CreateChannelPurchase($input: CreatePurchaseInput!) {
  createChannelPurchase(input: $input) {
    success
    purchaseId
  }
}`;

function fixture() {
  const purchases: { purchaseId: string }[] = [];
  const channels = [{ id: "channel", platform: syntheticPlatform }];
  const rootValue = {
    channel: ({ where }: { where?: { id?: string } }) =>
      channels.find(candidate => candidate.id === where?.id) ?? null,
    createChannelPurchase: async ({ input }: { input: any }) => {
      const channel = channels.find(candidate => candidate.id === input.shopId);
      if (!channel) throw new Error("Channel not found");
      if (!channel.platform) throw new Error("Channel platform not configured.");
      const result = await executeChannelAdapterFunction({
        platform: channel.platform,
        functionName: "createPurchaseFunction",
        args: {
          cartItems: input.cartItems, shipping: input.address,
          notes: input.orderId, idempotencyKey: input.orderId,
        },
      });
      if (result.error) throw new Error(result.error);
      purchases.push(result);
      return { success: true, purchaseId: result.purchaseId };
    },
  };
  const request = async <T>(source: string, variableValues?: Record<string, unknown>): Promise<T> => {
    const result = await graphql({ schema: schema(), source, variableValues, rootValue });
    if (result.errors) throw new Error(result.errors.map(error => error.message).join("; "));
    return result.data as T;
  };
  return { request, purchases, rootValue };
}

const knownOrder = {
  input: {
    shopId: "channel",
    cartItems: [{ variantId: "syn_sku_known_1", quantity: 2 }],
    email: "buyer@example.com",
    address: { firstName: "Test", lastName: "Buyer", streetAddress1: "1 Main St", city: "Springfield", state: "IL", zip: "12345", country: "US" },
    orderId: "order_1",
  },
};

describe.skipIf(cloneMissing)("synthetic channel adapter (Task 11)", () => {
  it("creates a deterministic purchase for a known SKU through the pinned mutation", async () => {
    const f = fixture();
    const first = await f.request<{ createChannelPurchase: { success: boolean; purchaseId: string } }>(
      CREATE_CHANNEL_PURCHASE, knownOrder,
    );
    expect(first.createChannelPurchase).toEqual({ success: true, purchaseId: expect.any(String) });
    expect(f.purchases).toHaveLength(1);
  });

  it("returns the same purchaseId when the same order is submitted twice", async () => {
    const f = fixture();
    const first = await f.request<{ createChannelPurchase: { purchaseId: string } }>(CREATE_CHANNEL_PURCHASE, knownOrder);
    const second = await f.request<{ createChannelPurchase: { purchaseId: string } }>(CREATE_CHANNEL_PURCHASE, knownOrder);
    expect(second.createChannelPurchase.purchaseId).toBe(first.createChannelPurchase.purchaseId);
  });

  it("scopes purchase identity to the external order, not just the cart", async () => {
    const f = fixture();
    const first = await f.request<{ createChannelPurchase: { purchaseId: string } }>(CREATE_CHANNEL_PURCHASE, knownOrder);
    const replay = { input: { ...knownOrder.input, orderId: "order_2" } };
    const second = await f.request<{ createChannelPurchase: { purchaseId: string } }>(CREATE_CHANNEL_PURCHASE, replay);
    expect(second.createChannelPurchase.purchaseId).not.toBe(first.createChannelPurchase.purchaseId);
  });

  it.each([
    { label: "unknown SKU", cartItems: [{ variantId: "sku_unknown", quantity: 1 }] },
    { label: "non-synthetic reserved prefix", cartItems: [{ variantId: "osp_real_1", quantity: 1 }] },
    { label: "zero quantity", cartItems: [{ variantId: "syn_sku_1", quantity: 0 }] },
    { label: "empty cart", cartItems: [] as [] },
  ])("rejects $label through the pinned mutation", async ({ cartItems }) => {
    const f = fixture();
    await expect(f.request(CREATE_CHANNEL_PURCHASE, {
      input: { ...knownOrder.input, cartItems },
    })).rejects.toThrow();
    expect(f.purchases).toHaveLength(0);
  });

  it("emits deterministic tracking exactly once per purchase via explicit transition", async () => {
    const adapter = await import("@/integrations/synthetic-channel/synthetic");
    const created = await adapter.createPurchaseFunction({
      platform: syntheticPlatform,
      cartItems: [{ variantId: "syn_sku_track_1", quantity: 1 }],
      shipping: knownOrder.input.address, idempotencyKey: "order_track_1",
    }) as { purchaseId: string };
    const first = adapter.fulfillPurchase({ purchaseId: created.purchaseId });
    const second = adapter.fulfillPurchase({ purchaseId: created.purchaseId });
    expect(first).toEqual(second);
    expect(first).toMatchObject({ trackingCompany: "Synthetic" });
    expect((first as { trackingNumber: string }).trackingNumber)
      .toMatch(/^syn_track_[0-9a-f]{12}$/);
  });

  it("refuses to cancel a purchase after fulfillment", async () => {
    const adapter = await import("@/integrations/synthetic-channel/synthetic");
    const created = await adapter.createPurchaseFunction({
      platform: syntheticPlatform,
      cartItems: [{ variantId: "syn_sku_late_1", quantity: 1 }],
      shipping: knownOrder.input.address, idempotencyKey: "order_late_1",
    }) as { purchaseId: string };
    expect(adapter.fulfillPurchase({ purchaseId: created.purchaseId })).toMatchObject({ trackingNumber: expect.any(String) });
    expect(adapter.cancelPurchase({ purchaseId: created.purchaseId })).toEqual({ error: expect.stringContaining("already fulfilled") });
  });

  it("cancels cleanly before fulfillment and stays idempotent", async () => {
    const adapter = await import("@/integrations/synthetic-channel/synthetic");
    const created = await adapter.createPurchaseFunction({
      platform: syntheticPlatform,
      cartItems: [{ variantId: "syn_sku_cancel_1", quantity: 1 }],
      shipping: knownOrder.input.address, idempotencyKey: "order_cancel_1",
    }) as { purchaseId: string };
    expect(adapter.cancelPurchase({ purchaseId: created.purchaseId })).toEqual({ purchaseId: created.purchaseId, status: "cancelled" });
    expect(adapter.cancelPurchase({ purchaseId: created.purchaseId })).toEqual({ purchaseId: created.purchaseId, status: "cancelled" });
    expect(adapter.fulfillPurchase({ purchaseId: created.purchaseId })).toEqual({ error: expect.stringContaining("cancelled") });
  });

  it("relays duplicate tracking events to the same payload and rejects unknown sources", async () => {
    const adapter = await import("@/integrations/synthetic-channel/synthetic");
    const created = await adapter.createPurchaseFunction({
      platform: syntheticPlatform,
      cartItems: [{ variantId: "syn_sku_relay_1", quantity: 1 }],
      shipping: knownOrder.input.address, idempotencyKey: "order_relay_1",
    }) as { purchaseId: string };
    const fulfilled = adapter.fulfillPurchase({ purchaseId: created.purchaseId }) as { trackingNumber: string };
    const event = {
      event: "fulfillment.created",
      data: { orderId: created.purchaseId, trackingNumber: fulfilled.trackingNumber, trackingCompany: "Synthetic" },
    };
    const first = await adapter.createTrackingWebhookHandler({ platform: syntheticPlatform, event, headers: {} });
    const duplicate = await adapter.createTrackingWebhookHandler({ platform: syntheticPlatform, event, headers: {} });
    expect(duplicate).toEqual(first);
    await expect(adapter.createTrackingWebhookHandler({
      platform: syntheticPlatform,
      event: { event: "fulfillment.created", data: { orderId: "syn_purchase_unknown" } },
      headers: {},
    })).rejects.toThrow("unknown purchase");
    await expect(adapter.createTrackingWebhookHandler({
      platform: syntheticPlatform, event: { event: "other.topic", data: {} }, headers: {},
    })).rejects.toThrow("malformed fulfillment event");
  });
});


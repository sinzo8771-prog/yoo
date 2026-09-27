import { readFileSync } from "node:fs";
import { buildSchema, graphql, type GraphQLSchema } from "graphql";
import { describe, expect, it } from "vitest";
import { stageLink, stageMatch, ensureLocalChannel, ensureSourceShop, ensureSyntheticChannelPlatform, attachSyntheticChannelPlatform } from "@/lib/openship/setup";
import type { OpenShipRequest } from "@/lib/openship/transport";
import type { ReferenceClone } from "@/scripts/reference-clones";
import { noteMissingReferenceClone, referenceCloneMissing } from "@/tests/reference-clones";

// Execute the public operation against the pinned generated GraphQL contract.
// Resolvers are in-memory: this proves contract compatibility, not live hooks/auth.
//
// Task 23 (CI follow-up): that contract is `schema.graphql` at the root of the
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

function fixture() {
  const links: Record<string, unknown>[] = [];
  const channels: Record<string, unknown>[] = [
    { id: "channel", name: "local-test-supplier", domain: null },
  ];
  const shopItems: any[] = [];
  const channelItems: any[] = [];
  const matches: any[] = [];
  const shops: any[] = [];
  const platforms: any[] = [];
  let creates = 0;
  let channelCreates = 0;
  let matchCreates = 0;
  let shopCreates = 0;
  let platformCreates = 0;
  let channelUpdates = 0;
  const owner = { id: "operator" };
  const rootValue = {
    authenticatedItem: () => ({ __typename: "User", id: "operator" }),
    shop: () => ({ id: "shop", user: owner, linkMode: "sequential" }),
    channel: ({ where }: { where?: { id?: string } }) => {
      const channel = channels.find(candidate => candidate.id === where?.id) as any;
      return channel
        ? { ...channel, user: channel.user ?? owner, platform: channel.platform ?? null }
        : null;
    },
    channels: ({ where }: { where?: { name?: { equals?: string } } }) => {
      const name = where?.name?.equals;
      return channels.filter(channel => !name || channel.name === name);
    },
    createChannel: ({ data }: { data: Record<string, any> }) => {
      channelCreates++;
      const channel = { id: `channel-${channelCreates}`, name: data.name, domain: data.domain ?? null };
      channels.push(channel);
      return channel;
    },
    shops: ({ where }: { where?: any }) => {
      const name = where?.name?.equals;
      return shops.filter(shop => !name || shop.name === name);
    },
    createShop: ({ data }: { data: any }) => {
      shopCreates++;
      const shop = {
        id: `shop-${shopCreates}`, name: data.name,
        domain: data.domain ?? null, linkMode: data.linkMode ?? "sequential",
      };
      shops.push(shop);
      return shop;
    },
    matches: ({ where }: { where?: any }) => {
      const conditions: any[] = where?.AND ?? [];
      const inputSome = conditions.find(condition => condition.input?.some)?.input.some;
      const outputEvery = conditions.find(condition => condition.output?.every)?.output.every;
      return matches.filter(match => {
        if (inputSome && !match.input.some((item: any) =>
          (!inputSome.productId?.equals || item.productId === inputSome.productId.equals) &&
          (!inputSome.variantId?.equals || item.variantId === inputSome.variantId.equals) &&
          (!inputSome.shop?.id?.equals || item.shop.id === inputSome.shop.id.equals))) {
          return false;
        }
        if (outputEvery && !match.output.every((item: any) =>
          !outputEvery.channel?.id?.equals || item.channel.id === outputEvery.channel.id.equals)) {
          return false;
        }
        return true;
      });
    },
    createMatch: ({ data }: { data: any }) => {
      matchCreates++;
      const inSpec = data.input?.create?.[0];
      const outSpec = data.output?.create?.[0];
      let shopItem = shopItems.find((item: any) =>
        item.productId === inSpec.productId && item.variantId === inSpec.variantId &&
        item.quantity === inSpec.quantity && item.shop.id === inSpec.shop.connect.id &&
        item.user.id === (inSpec.user?.connect?.id ?? "operator"));
      if (!shopItem) {
        shopItem = {
          id: `si-${shopItems.length + 1}`, productId: inSpec.productId, variantId: inSpec.variantId,
          quantity: inSpec.quantity, shop: { id: inSpec.shop.connect.id },
          user: { id: inSpec.user?.connect?.id ?? "operator" },
        };
        shopItems.push(shopItem);
      }
      let channelItem = channelItems.find((item: any) =>
        item.productId === outSpec.productId && item.variantId === outSpec.variantId &&
        item.quantity === outSpec.quantity && item.channel.id === outSpec.channel.connect.id &&
        item.user.id === (outSpec.user?.connect?.id ?? "operator"));
      if (!channelItem) {
        channelItem = {
          id: `ci-${channelItems.length + 1}`, productId: outSpec.productId, variantId: outSpec.variantId,
          quantity: outSpec.quantity, channel: { id: outSpec.channel.connect.id },
          user: { id: outSpec.user?.connect?.id ?? "operator" },
        };
        channelItems.push(channelItem);
      }
      const match = { id: `match-${matchCreates}`, user: { id: data.user.connect.id }, input: [shopItem], output: [channelItem] };
      matches.push(match);
      return match;
    },
    channelPlatforms: ({ where }: { where?: { name?: { equals?: string } } }) => {
      const name = where?.name?.equals;
      return platforms.filter(platform => !name || platform.name === name);
    },
    createChannelPlatform: ({ data }: { data: any }): any => {
      platformCreates++;
      const platform = {
        id: `platform-${platformCreates}`, user: owner, name: data.name,
        ...Object.fromEntries([
          "searchProductsFunction", "getProductFunction", "createPurchaseFunction",
          "createWebhookFunction", "oAuthFunction", "oAuthCallbackFunction",
          "createTrackingWebhookHandler", "cancelPurchaseWebhookHandler",
          "getWebhooksFunction", "deleteWebhookFunction",
        ].map(slot => [slot, data[slot] ?? null])),
      };
      platforms.push(platform);
      return platform;
    },
    channelPlatform: ({ where }: { where?: { id?: string } }) =>
      platforms.find(platform => platform.id === where?.id) ?? null,
    updateChannel: ({ where, data }: { where: { id: string }; data: any }) => {
      const channel = channels.find(candidate => candidate.id === where.id) as any;
      if (!channel) return null;
      channelUpdates++;
      if (data.platform?.connect?.id) {
        const platform = platforms.find(candidate => candidate.id === data.platform.connect.id);
        if (!platform) throw new Error("Connect target platform does not exist.");
        channel.platform = {
          id: platform.id, name: platform.name,
          createPurchaseFunction: platform.createPurchaseFunction,
        };
      }
      return { id: channel.id, platform: channel.platform };
    },
    links: () => links,
    createLink: ({ data }: { data: any }) => {
      creates++;
      const link = {
        id: "link", ...data,
        user: owner, shop: { id: "shop" },
        channel: { id: data.channel?.connect?.id ?? "channel" },
      };
      links.push(link);
      return link;
    },
  };
  const request: OpenShipRequest = async <T>(source: string, variableValues: Record<string, unknown>) => {
    const result = await graphql({ schema: schema(), source, variableValues, rootValue });
    if (result.errors) throw new Error(result.errors.map(error => error.message).join("; "));
    return result.data as T;
  };
  return { request, links, channels, matches, shops, platforms, rootValue, creates: () => creates, channelCreates: () => channelCreates, matchCreates: () => matchCreates, shopCreates: () => shopCreates, platformCreates: () => platformCreates, channelUpdates: () => channelUpdates };
}

describe.skipIf(cloneMissing)("stageLink", () => {
  it("creates one disabled link and reuses it on a sequential repeat", async () => {
    const f = fixture();
    const input = { ownerId: "operator", shopId: "shop", channelId: "channel" };
    await expect(stageLink(f.request, input)).resolves.toEqual({ id: "link", created: true, routingEnabled: false });
    await expect(stageLink(f.request, input)).resolves.toEqual({ id: "link", created: false, routingEnabled: false });
    expect(f.creates()).toBe(1);
    expect(f.links[0].filters).toEqual([{ field: "id", type: "in", value: [] }]);
  });

  it.each(["owner", "duplicate", "destination", "enabled", "adapter"])(
    "rejects %s conflicts without creating another link", async (conflict) => {
      const f = fixture();
      const input = { ownerId: "operator", shopId: "shop", channelId: "channel" };
      await stageLink(f.request, input);
      if (conflict === "owner") input.ownerId = "other-operator";
      if (conflict === "duplicate") f.links.push({ ...f.links[0], id: "duplicate" });
      if (conflict === "destination") f.links[0].channel = { id: "other-channel" };
      if (conflict === "enabled") f.links[0].filters = [];
      if (conflict === "adapter") f.rootValue.channel = () => ({
        id: "channel", user: { id: "operator" }, platform: { createPurchaseFunction: "openfront" },
      });
      await expect(stageLink(f.request, input)).rejects.toThrow();
      expect(f.creates()).toBe(1);
    },
  );

  it("rejects a channel owned by another operator before writing", async () => {
    const f = fixture();
    f.rootValue.channel = () => ({
      id: "channel", user: { id: "other-operator" }, platform: { createPurchaseFunction: "" },
    });
    await expect(stageLink(f.request, { ownerId: "operator", shopId: "shop", channelId: "channel" }))
      .rejects.toThrow("OpenShip ownership check failed.");
    expect(f.creates()).toBe(0);
  });
});

describe.skipIf(cloneMissing)("ensureLocalChannel", () => {
  it("reuses the named channel and never duplicates it on a repeat", async () => {
    const f = fixture();
    const input = { ownerId: "operator", name: "local-test-supplier" };
    await expect(ensureLocalChannel(f.request, input)).resolves.toEqual({
      id: "channel", created: false,
    });
    await expect(ensureLocalChannel(f.request, input)).resolves.toEqual({
      id: "channel", created: false,
    });
    expect(f.channelCreates()).toBe(0);
  });

  it("creates one channel with no platform, domain, or credentials", async () => {
    const f = fixture();
    f.rootValue.channels = () => [];
    await expect(ensureLocalChannel(f.request, { ownerId: "operator", name: "local-test-supplier" }))
      .resolves.toEqual({ id: "channel-1", created: true });
    expect(f.channelCreates()).toBe(1);
    expect(f.channels[0]).toMatchObject({ name: "local-test-supplier", domain: null });
    expect("platform" in f.channels[0]).toBe(false);
    expect("accessToken" in f.channels[0]).toBe(false);
  });
});

describe.skipIf(cloneMissing)("ensureSourceShop", () => {
  const input = { ownerId: "operator", name: "openfront-orders" };

  it("reuses the named shop and never duplicates it on a repeat", async () => {
    const f = fixture();
    f.shops.push({ id: "shop", name: "openfront-orders", linkMode: "sequential", domain: null });
    await expect(ensureSourceShop(f.request, input)).resolves.toEqual({ id: "shop", created: false });
    await expect(ensureSourceShop(f.request, input)).resolves.toEqual({ id: "shop", created: false });
    expect(f.shopCreates()).toBe(0);
  });

  it("creates one sequential shop with no platform or credentials", async () => {
    const f = fixture();
    f.rootValue.shops = () => [];
    await expect(ensureSourceShop(f.request, input)).resolves.toEqual({ id: "shop-1", created: true });
    expect(f.shopCreates()).toBe(1);
    expect(f.shops[0]).toMatchObject({ name: "openfront-orders", linkMode: "sequential", domain: null });
    expect("platform" in f.shops[0]).toBe(false);
    expect("accessToken" in f.shops[0]).toBe(false);
    expect("refreshToken" in f.shops[0]).toBe(false);
  });

  it("rejects multiple shops sharing the name without writing", async () => {
    const f = fixture();
    f.shops.push(
      { id: "s1", name: "openfront-orders", linkMode: "sequential" },
      { id: "s2", name: "openfront-orders", linkMode: "sequential" },
    );
    await expect(ensureSourceShop(f.request, input)).rejects.toThrow("Multiple shops share this name");
    expect(f.shopCreates()).toBe(0);
  });

  it.each(["-leading-dash", " spaced ", ""])("rejects the invalid name %j without writing", async (name) => {
    const f = fixture();
    await expect(ensureSourceShop(f.request, { ownerId: "operator", name }))
      .rejects.toThrow();
    expect(f.shopCreates()).toBe(0);
  });
});

describe.skipIf(cloneMissing)("stageMatch", () => {
  const input = {
    ownerId: "operator", shopId: "shop", channelId: "channel",
    source: { productId: "prod_1", variantId: "var_1" },
    target: { productId: "sup_prod_1", variantId: "sup_var_1" },
  };

  it("creates an exact one-to-one variant match and reuses it on repeat", async () => {
    const f = fixture();
    await expect(stageMatch(f.request, input)).resolves.toEqual({
      id: "match-1", created: true,
      source: { productId: "prod_1", variantId: "var_1" },
      target: { productId: "sup_prod_1", variantId: "sup_var_1" },
    });
    await expect(stageMatch(f.request, input)).resolves.toMatchObject({ id: "match-1", created: false });
    expect(f.matchCreates()).toBe(1);
    expect(f.matches).toHaveLength(1);
    expect(f.matches[0].input).toHaveLength(1);
    expect(f.matches[0].output).toHaveLength(1);
  });

  it("rejects remapping a variant that already has a different target", async () => {
    const f = fixture();
    await stageMatch(f.request, input);
    await expect(stageMatch(f.request, { ...input, target: { productId: "sup_prod_9", variantId: "sup_var_9" } }))
      .rejects.toThrow("already mapped to a different supplier variant");
    expect(f.matchCreates()).toBe(1);
  });

  it("rejects a source variant already mapped inside a bundle match", async () => {
    const f = fixture();
    await stageMatch(f.request, input);
    f.matches[0].output.push({
      id: "ci-2", productId: "sup_prod_2", variantId: "sup_var_2",
      quantity: 1, channel: { id: "channel" }, user: { id: "operator" },
    });
    await expect(stageMatch(f.request, input)).rejects.toThrow("bundle matches");
    expect(f.matchCreates()).toBe(1);
  });

  it.each([
    { label: "missing variantId", patch: { source: { productId: "prod_1" } } },
    { label: "identical ids", patch: { target: { productId: "prod_1", variantId: "var_1" } } },
    { label: "blank id", patch: { source: { productId: "prod_1", variantId: "  " } } },
  ])("rejects $label without writing", async ({ patch }) => {
    const f = fixture();
    await expect(stageMatch(f.request, { ...input, ...patch } as typeof input)).rejects.toThrow();
    expect(f.matchCreates()).toBe(0);
  });

  it.each(["owner", "source", "destination", "quantity", "empty output"])(
    "rejects an unverified mutation result (%s) without retrying", async (fault) => {
      const f = fixture();
      const create = f.rootValue.createMatch;
      f.rootValue.createMatch = (args) => {
        const match = create(args);
        if (fault === "owner") Object.assign(match, { user: { id: "other" } });
        if (fault === "source") match.input[0].shop.id = "other-shop";
        if (fault === "destination") match.output[0].channel.id = "other-channel";
        if (fault === "quantity") match.output[0].quantity = 2;
        if (fault === "empty output") match.output = [];
        return match;
      };
      await expect(stageMatch(f.request, input)).rejects.toThrow("inspect state before retrying");
      expect(f.matchCreates()).toBe(1);
    },
  );


  it("rejects duplicate identical matches without writing", async () => {
    const f = fixture();
    await stageMatch(f.request, input);
    f.matches.push({ ...f.matches[0], id: "duplicate" });
    await expect(stageMatch(f.request, input)).rejects.toThrow("multiple matches");
    expect(f.matchCreates()).toBe(1);
  });


  it("rejects remapping the same source onto another channel", async () => {
    const f = fixture();
    await stageMatch(f.request, input);
    f.matches[0].output[0].channel = { id: "other-channel" };
    await expect(stageMatch(f.request, input)).rejects.toThrow("already mapped to a different supplier variant");
    expect(f.matchCreates()).toBe(1);
  });


  it("rejects non-sequential source shops without writing", async () => {
    const f = fixture();
    f.rootValue.shop = () => ({ id: "shop", user: { id: "operator" }, linkMode: "parallel" });
    await expect(stageMatch(f.request, input)).rejects.toThrow("sequential");
    expect(f.matchCreates()).toBe(0);
  });


  it("rejects a source shop owned by another operator without writing", async () => {
    const f = fixture();
    f.rootValue.shop = () => ({ id: "shop", user: { id: "other" }, linkMode: "sequential" });
    await expect(stageMatch(f.request, input)).rejects.toThrow("ownership");
    expect(f.matchCreates()).toBe(0);
  });


  it("rejects a channel with a platform attached before writing", async () => {
    const f = fixture();
    (f.channels[0] as any).platform = { createPurchaseFunction: "openfront" };
    await expect(stageMatch(f.request, input)).rejects.toThrow("no platform");
    expect(f.matchCreates()).toBe(0);
  });
});

describe.skipIf(cloneMissing)("ensureSyntheticChannelPlatform", () => {
  it("creates the synthetic platform row once and reuses it on repeat", async () => {
    const f = fixture();
    const first = await ensureSyntheticChannelPlatform(f.request, { ownerId: "operator" });
    expect(first).toEqual({ id: "platform-1", created: true });
    const repeat = await ensureSyntheticChannelPlatform(f.request, { ownerId: "operator" });
    expect(repeat).toEqual({ id: "platform-1", created: false });
    expect(f.platformCreates()).toBe(1);
    expect(f.platforms[0]).toMatchObject({ name: "synthetic", createPurchaseFunction: "synthetic" });
  });

  it("refuses a same-name row with different adapter functions without writing", async () => {
    const f = fixture();
    f.platforms.push({
      id: "platform-x", user: { id: "operator" }, name: "synthetic",
      searchProductsFunction: "openfront", getProductFunction: null,
      createPurchaseFunction: null, createWebhookFunction: null, oAuthFunction: null,
      oAuthCallbackFunction: null, createTrackingWebhookHandler: null,
      cancelPurchaseWebhookHandler: null, getWebhooksFunction: null, deleteWebhookFunction: null,
    });
    await expect(ensureSyntheticChannelPlatform(f.request, { ownerId: "operator" }))
      .rejects.toThrow("different adapter functions");
    expect(f.platformCreates()).toBe(0);
  });

  it("refuses ambiguous duplicate rows without writing", async () => {
    const f = fixture();
    const row = () => ({
      id: "platform-x", user: { id: "operator" }, name: "synthetic",
      searchProductsFunction: "synthetic", getProductFunction: "synthetic",
      createPurchaseFunction: "synthetic", createWebhookFunction: "synthetic",
      oAuthFunction: "synthetic", oAuthCallbackFunction: "synthetic",
      createTrackingWebhookHandler: "synthetic", cancelPurchaseWebhookHandler: "synthetic",
      getWebhooksFunction: "synthetic", deleteWebhookFunction: "synthetic",
    });
    f.platforms.push(row(), { ...row(), id: "platform-y" });
    await expect(ensureSyntheticChannelPlatform(f.request, { ownerId: "operator" }))
      .rejects.toThrow("resolve the conflict");
    expect(f.platformCreates()).toBe(0);
  });

  it("ignores same-name rows owned by other operators", async () => {
    const f = fixture();
    f.platforms.push({
      id: "foreign", user: { id: "someone-else" }, name: "synthetic",
      searchProductsFunction: "synthetic", getProductFunction: "synthetic",
      createPurchaseFunction: "synthetic", createWebhookFunction: "synthetic",
      oAuthFunction: "synthetic", oAuthCallbackFunction: "synthetic",
      createTrackingWebhookHandler: "synthetic", cancelPurchaseWebhookHandler: "synthetic",
      getWebhooksFunction: "synthetic", deleteWebhookFunction: "synthetic",
    });
    await expect(ensureSyntheticChannelPlatform(f.request, { ownerId: "operator" }))
      .resolves.toEqual({ id: "platform-1", created: true });
    expect(f.platformCreates()).toBe(1);
  });

  it("rejects a foreign session before writing", async () => {
    const f = fixture();
    f.rootValue.authenticatedItem = () => ({ __typename: "User", id: "other" });
    await expect(ensureSyntheticChannelPlatform(f.request, { ownerId: "operator" }))
      .rejects.toThrow("ownership");
    expect(f.platformCreates()).toBe(0);
  });

  it("rejects an unverified create result without retrying", async () => {
    const f = fixture();
    const create = f.rootValue.createChannelPlatform;
    f.rootValue.createChannelPlatform = (args: any) => {
      const platform = create(args);
      platform.searchProductsFunction = "openfront";
      return platform;
    };
    await expect(ensureSyntheticChannelPlatform(f.request, { ownerId: "operator" }))
      .rejects.toThrow("inspect state before retrying");
    expect(f.platformCreates()).toBe(1);
  });
});

describe.skipIf(cloneMissing)("attachSyntheticChannelPlatform", () => {
  const attachInput = { ownerId: "operator", channelId: "channel", platformId: "platform-1" };
  const makeAttached = async (f = fixture()) => {
    const platform = await ensureSyntheticChannelPlatform(f.request, { ownerId: "operator" });
    return { f, platformId: platform.id };
  };

  it("attaches the verified platform through updateChannel", async () => {
    const { f, platformId } = await makeAttached();
    await expect(attachSyntheticChannelPlatform(f.request, { ...attachInput, platformId }))
      .resolves.toEqual({ channelId: "channel", platformId, attached: true });
    expect(f.channelUpdates()).toBe(1);
    expect((f.channels[0] as any).platform.createPurchaseFunction).toBe("synthetic");
  });

  it("reuses an existing identical attachment without writing", async () => {
    const { f, platformId } = await makeAttached();
    await attachSyntheticChannelPlatform(f.request, { ...attachInput, platformId });
    await expect(attachSyntheticChannelPlatform(f.request, { ...attachInput, platformId }))
      .resolves.toEqual({ channelId: "channel", platformId, attached: false });
    expect(f.channelUpdates()).toBe(1);
  });

  it("refuses a channel that already carries a different platform", async () => {
    const { f, platformId } = await makeAttached();
    (f.channels[0] as any).platform = { id: "platform-other" };
    await expect(attachSyntheticChannelPlatform(f.request, { ...attachInput, platformId }))
      .rejects.toThrow("already carries a different platform");
    expect(f.channelUpdates()).toBe(0);
  });

  it("refuses a platform row that is not the synthetic adapter", async () => {
    const f = fixture();
    f.platforms.push({
      id: "platform-1", user: { id: "operator" }, name: "synthetic",
      createPurchaseFunction: "openfront", searchProductsFunction: null,
      getProductFunction: null, createWebhookFunction: null, oAuthFunction: null,
      oAuthCallbackFunction: null, createTrackingWebhookHandler: null,
      cancelPurchaseWebhookHandler: null, getWebhooksFunction: null, deleteWebhookFunction: null,
    });
    await expect(attachSyntheticChannelPlatform(f.request, attachInput))
      .rejects.toThrow("not the synthetic adapter");
    expect(f.channelUpdates()).toBe(0);
  });

  it("refuses a missing or foreign platform row without writing", async () => {
    const f = fixture();
    f.platforms.push({
      id: "platform-1", user: { id: "someone-else" }, name: "synthetic",
      createPurchaseFunction: "synthetic", searchProductsFunction: "synthetic",
      getProductFunction: "synthetic", createWebhookFunction: "synthetic",
      oAuthFunction: "synthetic", oAuthCallbackFunction: "synthetic",
      createTrackingWebhookHandler: "synthetic", cancelPurchaseWebhookHandler: "synthetic",
      getWebhooksFunction: "synthetic", deleteWebhookFunction: "synthetic",
    });
    await expect(attachSyntheticChannelPlatform(f.request, attachInput))
      .rejects.toThrow("was not found for this operator");
    expect(f.channelUpdates()).toBe(0);
  });

  it("rejects an unverified update result without retrying", async () => {
    const { f, platformId } = await makeAttached();
    f.rootValue.updateChannel = () => ({ id: "channel", platform: null });
    await expect(attachSyntheticChannelPlatform(f.request, { ...attachInput, platformId }))
      .rejects.toThrow("inspect state before retrying");
    expect(f.channelUpdates()).toBe(0);
  });

  it("rejects blank inputs before any request", async () => {
    const f = fixture();
    await expect(attachSyntheticChannelPlatform(f.request, { ...attachInput, platformId: "  " }))
      .rejects.toThrow("required");
    expect(f.channelUpdates()).toBe(0);
    expect(f.platformCreates()).toBe(0);
  });

  it("completes the staged flow: channel, link, platform, then attach", async () => {
    const f = fixture();
    const channel = await ensureLocalChannel(f.request, { ownerId: "operator", name: "local-test-supplier" });
    await stageLink(f.request, { ownerId: "operator", shopId: "shop", channelId: channel.id });
    const platform = await ensureSyntheticChannelPlatform(f.request, { ownerId: "operator" });
    await expect(attachSyntheticChannelPlatform(f.request, {
      ownerId: "operator", channelId: channel.id, platformId: platform.id,
    })).resolves.toEqual({ channelId: channel.id, platformId: platform.id, attached: true });
    expect(f.creates()).toBe(1);
    expect(f.channelCreates()).toBe(0); // fixture pre-seeds the named channel
    expect(f.platformCreates()).toBe(1);
    expect(f.channelUpdates()).toBe(1);
    expect(f.links[0].filters).toEqual([{ field: "id", type: "in", value: [] }]);
  });
});

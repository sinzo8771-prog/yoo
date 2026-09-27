import type { OpenShipRequest } from "./transport";

type Owned = { id: string; user: { id: string } | null };
type StagedLink = Owned & {
  shop: { id: string } | null;
  channel: { id: string } | null;
  filters: unknown;
  customWhere: unknown;
};

// The pinned Link.dynamicWhereClause converts this to { id: { in: [] } }.
// Unlike empty filters (match all), this cannot match any order ID.
const disabledFilters = () => [{ field: "id", type: "in", value: [] }];
const linkFields = "id user { id } shop { id } channel { id } filters customWhere";

/**
 * Stage a single destination for an existing operator-owned shop/channel.
 * Sequential repeats are safe; callers must serialize setup across processes.
 * No orders, adapter calls, webhooks, credentials, or activation are created here.
 */
export async function stageLink(request: OpenShipRequest, input: {
  ownerId: string;
  shopId: string;
  channelId: string;
}): Promise<{ id: string; created: boolean; routingEnabled: false }> {
  if (Object.values(input).some(value => typeof value !== "string" || !value.trim())) {
    throw new Error("Owner, shop, and channel IDs are required.");
  }
  const state = await request<{
    authenticatedItem: { id: string } | null;
    shop: (Owned & { linkMode: string }) | null;
    channel: (Owned & { platform: { createPurchaseFunction: string | null } | null }) | null;
    links: StagedLink[] | null;
  }>(`query StageLinkState($shopId: ID!, $channelId: ID!) {
    authenticatedItem { ... on User { id } }
    shop(where: { id: $shopId }) { id user { id } linkMode }
    channel(where: { id: $channelId }) {
      id user { id } platform { createPurchaseFunction }
    }
    links(where: { shop: { id: { equals: $shopId } } }, take: 2) { ${linkFields} }
  }`, { shopId: input.shopId, channelId: input.channelId });
  if (state.authenticatedItem?.id !== input.ownerId ||
      state.shop?.id !== input.shopId || state.shop.user?.id !== input.ownerId ||
      state.channel?.id !== input.channelId || state.channel.user?.id !== input.ownerId) {
    throw new Error("OpenShip ownership check failed.");
  }
  if (state.shop.linkMode !== "sequential" || state.channel.platform !== null) {
    throw new Error("Staging requires sequential routing and a channel with no platform attached.");
  }
  if (!Array.isArray(state.links)) throw new Error("OpenShip returned invalid link data.");
  const isStaged = (link: StagedLink) => Boolean(link?.id) &&
    link.user?.id === input.ownerId && link.shop?.id === input.shopId &&
    link.channel?.id === input.channelId &&
    JSON.stringify(link.filters) === JSON.stringify(disabledFilters()) &&
    JSON.stringify(link.customWhere) === "{}";
  if (state.links.length) {
    if (state.links.length !== 1 || !isStaged(state.links[0])) {
      throw new Error("Existing routing conflicts with staged setup; no changes made.");
    }
    return { id: state.links[0].id, created: false, routingEnabled: false };
  }
  const result = await request<{ createLink: StagedLink | null }>(
    `mutation StageLink($data: LinkCreateInput!) { createLink(data: $data) { ${linkFields} } }`,
    { data: {
      shop: { connect: { id: input.shopId } },
      channel: { connect: { id: input.channelId } },
      user: { connect: { id: input.ownerId } },
      filters: disabledFilters(), customWhere: {},
    } },
  );
  if (!result.createLink || !isStaged(result.createLink)) {
    throw new Error("OpenShip staging could not be verified; inspect state before retrying.");
  }
  return { id: result.createLink.id, created: true, routingEnabled: false };
}

const RESOURCE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,99}$/;

/**
 * Reuse or create the single named local channel that Task 11 will turn into a
 * synthetic destination. Creates a channel with no platform, domain, or access
 * token — staging never attaches credentials or adapters. Sequential repeats are
 * safe; callers must serialize provisioning across processes. Ambiguous matches
 * (multiple same-name channels) fail without writing.
 */
export async function ensureLocalChannel(
  request: OpenShipRequest,
  input: { ownerId: string; name: string },
): Promise<{ id: string; created: boolean }> {
  if (typeof input.ownerId !== "string" || !input.ownerId.trim() ||
      typeof input.name !== "string" || !RESOURCE_NAME_PATTERN.test(input.name)) {
    throw new Error("Owner ID and a valid channel name are required.");
  }
  const state = await request<{
    authenticatedItem: { id: string } | null;
    channels: { id: string }[] | null;
  }>(`query EnsureChannel($name: String!) {
    authenticatedItem { ... on User { id } }
    channels(where: { name: { equals: $name } }) { id }
  }`, { name: input.name });
  if (state.authenticatedItem?.id !== input.ownerId) {
    throw new Error("OpenShip ownership check failed.");
  }
  if (!Array.isArray(state.channels)) throw new Error("OpenShip returned invalid channel data.");
  if (state.channels.length > 1) {
    throw new Error("Multiple channels share this name; resolve the conflict before provisioning.");
  }
  if (state.channels.length === 1) {
    return { id: state.channels[0].id, created: false };
  }
  const result = await request<{ createChannel: { id: string; name: string | null } | null }>(
    `mutation EnsureChannel($data: ChannelCreateInput!) { createChannel(data: $data) { id name } }`,
    { data: { name: input.name } },
  );
  if (!result.createChannel || result.createChannel.name !== input.name) {
    throw new Error("OpenShip channel provisioning could not be verified; inspect state before retrying.");
  }
  return { id: result.createChannel.id, created: true };
}

/**
 * Reuse or create the single named Openfront source shop (Shop = order source).
 * Creates a shop with sequential link mode and no platform, domain, or access
 * token — staging never attaches credentials or adapters, and ShopPlatform rows
 * cannot exist without all adapter functions. Sequential repeats are safe;
 * callers must serialize provisioning across processes. Ambiguous matches
 * (multiple same-name shops) fail without writing.
 */
export async function ensureSourceShop(
  request: OpenShipRequest,
  input: { ownerId: string; name: string },
): Promise<{ id: string; created: boolean }> {
  if (typeof input.ownerId !== "string" || !input.ownerId.trim() ||
      typeof input.name !== "string" || !RESOURCE_NAME_PATTERN.test(input.name)) {
    throw new Error("Owner ID and a valid shop name are required.");
  }
  const state = await request<{
    authenticatedItem: { id: string } | null;
    shops: { id: string }[] | null;
  }>(`query EnsureSourceShop($name: String!) {
    authenticatedItem { ... on User { id } }
    shops(where: { name: { equals: $name } }) { id }
  }`, { name: input.name });
  if (state.authenticatedItem?.id !== input.ownerId) {
    throw new Error("OpenShip ownership check failed.");
  }
  if (!Array.isArray(state.shops)) throw new Error("OpenShip returned invalid shop data.");
  if (state.shops.length > 1) {
    throw new Error("Multiple shops share this name; resolve the conflict before provisioning.");
  }
  if (state.shops.length === 1) {
    return { id: state.shops[0].id, created: false };
  }
  const result = await request<{ createShop: { id: string; name: string | null } | null }>(
    `mutation EnsureSourceShop($data: ShopCreateInput!) { createShop(data: $data) { id name } }`,
    { data: { name: input.name, linkMode: "sequential" } },
  );
  if (!result.createShop || result.createShop.name !== input.name) {
    throw new Error("OpenShip shop provisioning could not be verified; inspect state before retrying.");
  }
  return { id: result.createShop.id, created: true };
}
// Task 11: the synthetic adapter is reached only through OpenShip's supported
// adapter boundary — a ChannelPlatform row whose ten adapter-function slots all
// name the `synthetic` module in features/integrations/channel/. No routing
// code is modified; the platform row is data, not a hard-coded provider.
const SYNTHETIC_SLOTS = [
  "searchProductsFunction",
  "getProductFunction",
  "createPurchaseFunction",
  "createWebhookFunction",
  "oAuthFunction",
  "oAuthCallbackFunction",
  "createTrackingWebhookHandler",
  "cancelPurchaseWebhookHandler",
  "getWebhooksFunction",
  "deleteWebhookFunction",
] as const;
type SyntheticSlot = (typeof SYNTHETIC_SLOTS)[number];
type SyntheticPlatformRow = { id: string; user: { id: string } | null } & {
  name: string | null;
} & Partial<Record<SyntheticSlot, string | null>>;
const SYNTHETIC_PLATFORM_FIELDS = `id user { id } name ${SYNTHETIC_SLOTS.join(" ")}`;
const isSyntheticRow = (row: SyntheticPlatformRow) =>
  row.name === "synthetic" &&
  SYNTHETIC_SLOTS.every(slot => row[slot] === "synthetic");

/**
 * Reuse or create the operator's synthetic channel platform — the adapter
 * boundary for the Task 11 fulfillment channel. The row carries no credentials
 * and every slot resolves to the local `synthetic` adapter module. A same-name
 * row with different slot values is refused (it would silently point the
 * channel at a different adapter); same-name rows owned by other operators are
 * ignored. Sequential repeats are safe; callers must serialize provisioning
 * across processes. Attaching the platform is a separate, last step.
 */
export async function ensureSyntheticChannelPlatform(
  request: OpenShipRequest,
  input: { ownerId: string },
): Promise<{ id: string; created: boolean }> {
  if (typeof input.ownerId !== "string" || !input.ownerId.trim()) {
    throw new Error("Owner ID is required.");
  }
  const state = await request<{
    authenticatedItem: { id: string } | null;
    channelPlatforms: SyntheticPlatformRow[] | null;
  }>(`query EnsureSyntheticPlatform($name: String!) {
    authenticatedItem { ... on User { id } }
    channelPlatforms(where: { name: { equals: $name } }) { ${SYNTHETIC_PLATFORM_FIELDS} }
  }`, { name: "synthetic" });
  if (state.authenticatedItem?.id !== input.ownerId) {
    throw new Error("OpenShip ownership check failed.");
  }
  if (!Array.isArray(state.channelPlatforms)) {
    throw new Error("OpenShip returned invalid channel platform data.");
  }
  const owned = state.channelPlatforms.filter(row => row.user?.id === input.ownerId);
  if (owned.length > 1) {
    throw new Error("Multiple channel platforms share this name; resolve the conflict before provisioning.");
  }
  if (owned.length === 1) {
    if (!isSyntheticRow(owned[0])) {
      throw new Error("An existing same-name platform has different adapter functions; refusing to reuse it.");
    }
    return { id: owned[0].id, created: false };
  }
  const result = await request<{ createChannelPlatform: SyntheticPlatformRow | null }>(
    `mutation EnsureSyntheticPlatform($data: ChannelPlatformCreateInput!) {
      createChannelPlatform(data: $data) { ${SYNTHETIC_PLATFORM_FIELDS} }
    }`,
    { data: { name: "synthetic", ...Object.fromEntries(SYNTHETIC_SLOTS.map(slot => [slot, "synthetic"])) } },
  );
  if (!result.createChannelPlatform || !isSyntheticRow(result.createChannelPlatform) ||
      result.createChannelPlatform.user?.id !== input.ownerId) {
    throw new Error("OpenShip platform provisioning could not be verified; inspect state before retrying.");
  }
  return { id: result.createChannelPlatform.id, created: true };
}

/**
 * Attach the verified synthetic platform to the staged channel — the final
 * Task 11 boundary step, performed through OpenShip's own updateChannel
 * mutation. Refuses when the channel already carries a different platform, when
 * the target platform row is missing, foreign-owned, or not the synthetic
 * adapter. Attaching does NOT enable routing: the staged link's filters stay
 * disabled and no orders route until an operator changes them. Run after
 * stageLink/stageMatch — those require a platform-free channel.
 */
export async function attachSyntheticChannelPlatform(
  request: OpenShipRequest,
  input: { ownerId: string; channelId: string; platformId: string },
): Promise<{ channelId: string; platformId: string; attached: boolean }> {
  if (Object.values(input).some(value => typeof value !== "string" || !value.trim())) {
    throw new Error("Owner, channel, and platform IDs are required.");
  }
  const state = await request<{
    authenticatedItem: { id: string } | null;
    channel: (Owned & { platform: { id: string } | null }) | null;
    channelPlatform: SyntheticPlatformRow | null;
  }>(`query AttachSyntheticPlatform($channelId: ID!, $platformId: ID!) {
    authenticatedItem { ... on User { id } }
    channel(where: { id: $channelId }) { id user { id } platform { id } }
    channelPlatform(where: { id: $platformId }) { ${SYNTHETIC_PLATFORM_FIELDS} }
  }`, { channelId: input.channelId, platformId: input.platformId });
  if (state.authenticatedItem?.id !== input.ownerId ||
      state.channel?.id !== input.channelId || state.channel.user?.id !== input.ownerId) {
    throw new Error("OpenShip ownership check failed.");
  }
  if (!state.channelPlatform || state.channelPlatform.user?.id !== input.ownerId) {
    throw new Error("Target platform row was not found for this operator.");
  }
  if (!isSyntheticRow(state.channelPlatform)) {
    throw new Error("Target platform is not the synthetic adapter; refusing to attach.");
  }
  if (state.channel.platform) {
    if (state.channel.platform.id === input.platformId) {
      return { channelId: input.channelId, platformId: input.platformId, attached: false };
    }
    throw new Error("Channel already carries a different platform; no changes made.");
  }
  const result = await request<{ updateChannel: { id: string; platform: { id: string; createPurchaseFunction: string | null } | null } | null }>(
    `mutation AttachSyntheticPlatform($channelId: ID!, $platformId: ID!) {
      updateChannel(where: { id: $channelId }, data: { platform: { connect: { id: $platformId } } }) {
        id platform { id createPurchaseFunction }
      }
    }`,
    { channelId: input.channelId, platformId: input.platformId },
  );
  if (!result.updateChannel || result.updateChannel.id !== input.channelId ||
      result.updateChannel.platform?.id !== input.platformId ||
      result.updateChannel.platform?.createPurchaseFunction !== "synthetic") {
    throw new Error("OpenShip platform attachment could not be verified; inspect state before retrying.");
  }
  return { channelId: input.channelId, platformId: input.platformId, attached: true };
}


type ItemRef = { productId: string; variantId: string };
type StagedMatch = Owned & {
  input: (Owned & ItemRef & { quantity: number; shop: { id: string } | null })[];
  output: (Owned & ItemRef & { quantity: number; channel: { id: string } | null })[];
};
const MATCH_FIELDS = `id user { id }
  input { id user { id } productId variantId quantity shop { id } }
  output { id user { id } productId variantId quantity channel { id } }`;

const assertExactVariant = (side: "source" | "target", value: unknown): ItemRef => {
  const value_ = value as Partial<ItemRef> | undefined;
  if (!value_ || typeof value_.productId !== "string" || !value_.productId.trim() ||
      typeof value_.variantId !== "string" || !value_.variantId.trim()) {
    throw new Error("Exact source and target product and variant IDs are required.");
  }
  return { productId: value_.productId.trim(), variantId: value_.variantId.trim() };
};

/**
 * Stage an exact one-to-one variant match (openfront source variant -> supplier
 * variant). Reuses an identical existing match; refuses to remap a variant that
 * is already mapped to a different target, to participate in bundle matches, or
 * to appear in more than one match. Sequential repeats are safe; callers must
 * serialize setup across processes. No purchases or routing are performed.
 */
export async function stageMatch(request: OpenShipRequest, input: {
  ownerId: string;
  shopId: string;
  channelId: string;
  source: ItemRef;
  target: ItemRef;
}): Promise<{ id: string; created: boolean; source: ItemRef; target: ItemRef }> {
  const source = assertExactVariant("source", input.source);
  const target = assertExactVariant("target", input.target);
  if (source.productId === target.productId && source.variantId === target.variantId) {
    throw new Error("Source and target variants must differ.");
  }
  const state = await request<{
    authenticatedItem: { id: string } | null;
    shop: (Owned & { linkMode: string }) | null;
    channel: (Owned & { platform: unknown }) | null;
    matches: StagedMatch[] | null;
  }>(`query StageMatchState($shopId: ID!, $channelId: ID!, $productId: String!, $variantId: String!) {
    authenticatedItem { ... on User { id } }
    shop(where: { id: $shopId }) { id user { id } linkMode }
    channel(where: { id: $channelId }) { id user { id } platform { createPurchaseFunction } }
    matches(
      where: {
        AND: [
          { input: { some: {
            shop: { id: { equals: $shopId } }
            productId: { equals: $productId }
            variantId: { equals: $variantId }
          } } }
        ]
      }
    ) { ${MATCH_FIELDS} }
  }`, {
    shopId: input.shopId, channelId: input.channelId,
    productId: source.productId, variantId: source.variantId,
  });
  if (state.authenticatedItem?.id !== input.ownerId ||
      state.shop?.id !== input.shopId || state.shop.user?.id !== input.ownerId ||
      state.channel?.id !== input.channelId || state.channel.user?.id !== input.ownerId) {
    throw new Error("OpenShip ownership check failed.");
  }
  if (state.shop.linkMode !== "sequential" || state.channel.platform !== null) {
    throw new Error("Staging matches requires sequential routing and a channel with no platform attached.");
  }
  if (!Array.isArray(state.matches)) throw new Error("OpenShip returned invalid match data.");
  const sameMapping = (match: StagedMatch) => Boolean(match?.id) &&
    match.user?.id === input.ownerId &&
    Array.isArray(match.input) && Array.isArray(match.output) &&
    match.input.length === 1 && match.output.length === 1 &&
    Boolean(match.input[0]?.id) && Boolean(match.output[0]?.id) &&
    match.input[0].user?.id === input.ownerId && match.output[0].user?.id === input.ownerId &&
    match.input[0].quantity === 1 && match.output[0].quantity === 1 &&
    match.input[0].shop?.id === input.shopId &&
    match.input[0].productId === source.productId && match.input[0].variantId === source.variantId &&
    match.output[0].channel?.id === input.channelId &&
    match.output[0].productId === target.productId && match.output[0].variantId === target.variantId;
  if (state.matches.length) {
    if (state.matches.length !== 1) {
      throw new Error("Source variant appears in multiple matches; manual resolution is required.");
    }
    if (state.matches.some(match => match.input.length !== 1 || match.output.length !== 1)) {
      throw new Error("Source variant appears in bundle matches; manual resolution is required.");
    }
    if (state.matches.some(match => !sameMapping(match))) {
      throw new Error("This variant is already mapped to a different supplier variant; no changes made.");
    }
    return {
      id: state.matches[0].id, created: false,
      source, target,
    };
  }
  const result = await request<{ createMatch: StagedMatch | null }>(
    `mutation StageMatch($data: MatchCreateInput!) { createMatch(data: $data) { ${MATCH_FIELDS} } }`,
    { data: {
      input: { create: [{
        productId: source.productId, variantId: source.variantId, quantity: 1,
        shop: { connect: { id: input.shopId } }, user: { connect: { id: input.ownerId } },
      }] },
      output: { create: [{
        productId: target.productId, variantId: target.variantId, quantity: 1,
        channel: { connect: { id: input.channelId } }, user: { connect: { id: input.ownerId } },
      }] },
      user: { connect: { id: input.ownerId } },
    } },
  );
  if (!result.createMatch || !sameMapping(result.createMatch)) {
    throw new Error("OpenShip match staging could not be verified; inspect state before retrying.");
  }
  return { id: result.createMatch.id, created: true, source, target };
}

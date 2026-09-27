# OpenShip setup — Task 10 partial implementation

## Status

Implemented the internal transport, staged provisioning for the Openfront source shop
(`ensureSourceShop`) and the fulfillment channel (`ensureLocalChannel`), `stageLink`
for linking them, and `stageMatch` for exact variant mappings. Task 10 is
**not complete**: live authenticated validation has not been run. No live records,
webhooks, orders, or provider credentials were changed during this work.

## Internal API

Implementation directory: `c:\Users\lenovo\Desktop\yoo\store\lib\openship`.
From operator-side Node code: create the transport, provision the destination, then
stage the link:

```ts
const request = createOpenShipTransport({ url: process.env.OPENSHIP_GRAPHQL_URL!, token: process.env.OPENSHIP_API_TOKEN! });
const shop = await ensureSourceShop(request, { ownerId, name: "openfront-orders" });
const channel = await ensureLocalChannel(request, { ownerId, name: "local-test-supplier" });
const link = await stageLink(request, { ownerId, shopId: shop.id, channelId: channel.id });
const match = await stageMatch(request, {
  ownerId, shopId, channelId: channel.id,
  source: { productId: "prod_1", variantId: "var_1" },      // Openfront variant
  target: { productId: "sup_prod_1", variantId: "sup_var_1" }, // supplier variant
});
```

Do not expose these functions as public server actions or routes. The transport
rejects browser execution; it does not provide endpoint authorization for callers.

- Supply `OPENSHIP_GRAPHQL_URL` and `OPENSHIP_API_TOKEN` through server environment
  configuration only. There is no implicit endpoint or credential fallback.
- URL must use HTTPS, except HTTP on literal loopback hosts for local development.
  Redirects are rejected. Check actual port assignments: current checkout uses
  storefront 3000 and Openfront 3001, unlike the older root README defaults.
- Token must be an OpenShip `osp_` API key sent as `Authorization: Bearer ...`.
  Use a dedicated non-admin test operator. Scopes used by these operations:
  `read_shops`, `write_shops`, `read_channels`, `write_channels`, `read_links`,
  `write_links`, `read_matches`, `write_matches` (verified against
  `openship/features/keystone/lib/api-key-scopes.ts`).
  These are not a claim that every nested resolver enforces scopes uniformly.
- `ownerId` must equal the authenticated user's ID and both resource owners.
  The backend remains responsible for authorization and relationship visibility.
- Shop must use sequential linking. The staged channel must have **no platform
  attached** — no credentials and no adapter. Task 11 adds the synthetic
  ChannelPlatform later; never attach a real purchase adapter for staging.

## Staging and repeat behavior

A staged link uses `filters: [{ field: "id", type: "in", value: [] }]` and an empty
`customWhere`. In the pinned Link resolver this becomes `{ id: { in: [] } }`.
The Order hook ANDs it with the new order ID, so it cannot match an order.
Empty filters instead mean **match all**: never clear them to "disable" a link.
There is no `orderID` or enabled flag on Link in this revision.

The operation reuses one identical staged link and rejects different destinations,
active filters, foreign ownership, and multiple existing links. It does not call
order, purchase, tracking, webhook, or adapter operations. A staging result is
not evidence of fulfillment or of end-to-end routing.

`stageMatch` stages one exact source-variant → supplier-variant mapping as a Match
with exactly one ShopItem (input) and one ChannelItem (output). It accepts product
and variant IDs only — never titles — so every staged match is an exact 1:1 match;
title-only or fuzzy matches cannot be expressed through it. It reuses an identical
existing match (`created: false`), and without writing rejects: a source variant
already mapped to a different supplier variant, on this or any other channel;
source variants appearing in multiple matches or inside bundle (multi-item)
matches; blank/missing IDs; identical source and target; non-sequential shops;
foreign ownership; and channels with a platform attached. Both the reuse lookup
and the create response are verified field by field (owner, source item, destination
item, unit quantities); any mismatch surfaces as "inspect state before retrying"
and requires manual reconciliation. The server-side Match hook also dedupes items;
staging sends exactly one item per side regardless.

`ensureSourceShop` reuses or creates the single named source shop (sequential link
mode, no platform, domain, or credentials). A ShopPlatform row cannot exist without
every adapter function, so staging never attaches a platform to the shop either.
Like the channel operation, it fails without writing when several same-name shops
exist.

Run setup serially with a single operator writer. There is no unique database
constraint for a shop/channel pair, so simultaneous processes or dashboard writes
can race the read-before-create check. This is **sequential repeat safety**, not
atomic or distributed idempotency. No mutation is retried automatically. On a
network error or unverified mutation result, inspect records before retrying.

## Activating the synthetic channel (Task 11)

The deterministic synthetic adapter lives in
`c:\Users\lenovo\Desktop\yoo\store\integrations\synthetic-channel\synthetic.ts`.
It implements the pinned channel contract called by OpenShip's
`executeChannelAdapterFunction`: `createPurchaseFunction({ platform, cartItems,
shipping, notes, idempotencyKey })` plus the tracking webhook handler and the
remaining ChannelPlatform fields. To integrate: copy the module into the OpenShip
checkout at `openship/features/integrations/channel/synthetic.ts` (that
repository is separate and git-ignored here) and create a ChannelPlatform row
named `synthetic` whose ten adapter-function fields all reference `synthetic`,
then attach it to the staged channel.

Both boundary steps are now implemented in `store/lib/openship/setup.ts`, to run
**after** stageLink/stageMatch (those require a platform-free channel):

1. `ensureSyntheticChannelPlatform(request, { ownerId })` — reuses or creates the
   operator's `ChannelPlatform` row named `synthetic` with all ten adapter slots
   set to `"synthetic"` and no credentials. A same-name row with different slot
   values is refused (it would silently point the channel at another adapter);
   foreign-owned same-name rows are ignored; ambiguous duplicates fail without
   writing. Returns `{ id, created }`.
2. `attachSyntheticChannelPlatform(request, { ownerId, channelId, platformId })` —
   verifies the platform row is the operator's synthetic adapter, then connects
   it via OpenShip's own `updateChannel` mutation. Refuses a channel that already
   carries a different platform; a repeated call returns `{ attached: false }`.
   Attaching does **not** enable routing — the staged link's disabled filters
   remain in place, so no orders route until an operator explicitly changes them.

Behavior: purchases are accepted only for
`syn_`-prefixed SKUs with positive integer quantities; purchase IDs and tracking
numbers are SHA-256-derived and stable; re-submitting the same order returns the
same purchase; `fulfillPurchase` is the explicit tracking transition; cancelled
purchases cannot be fulfilled and vice versa. State is in-memory per process —
this is a fixture for isolated routing tests, never a production provider.


## Verification

From `c:\Users\lenovo\Desktop\yoo\store`:

```powershell
npm test -- tests/unit/openship
npm test
```

The setup tests execute queries/mutations against the pinned generated schema at
`c:\Users\lenovo\Desktop\yoo\openship\schema.graphql` with in-memory resolvers.
The reference clone must exist. These tests validate GraphQL names/types and setup
behavior, **not** live Keystone auth, hooks, database concurrency, or fulfillment.
Latest unit run: 223 passing (16 files), including 45 setup tests:
stageLink 7, ensureLocalChannel 2, stageMatch 16, ensureSourceShop 6,
ensureSyntheticChannelPlatform 6, attachSyntheticChannelPlatform 8
(incl. the full staged-flow test). Typecheck still fails on
existing project diagnostics (all pre-existing in the vendored `features/` tree);
none are in the OpenShip files. `npm run build` exits 0.

## Rollback and activation

Record the returned link and match IDs with their `created` flags. For rollback,
delete exactly the staged link (never bulk-delete shop links or delete a reused
link). Deleting a Match removes only the mapping; its input ShopItems and output
ChannelItems also need explicit deletion, so reconcile by source variant ID before
retrying after a lost response. Revoking an API key does not remove any stored link
or match.

Do not activate routing as part of this task slice. Before activation: implement
and validate Task 11's synthetic adapter; complete exact variant mapping and
reject title-only matches; test routing and retries in isolation. Do not attach
production credentials. Settled-payment validation for Task 9 remains separate.
Remaining Task 10 work: live authenticated validation against a running OpenShip
with real `osp_` credentials.

# Dropshipping Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a polished, conversion-focused, low-cost dropshipping ecommerce business using Openfront as the commerce backend, OpenShip as the fulfillment/order-routing layer, and a custom Next.js storefront that feels like a real brand rather than a generic dropshipping template.

**Architecture:** Keep customer-facing commerce, operator fulfillment, and provider integrations separated. Openfront owns product/catalog/customer/cart/checkout/order state; OpenShip owns shop/channel/link/match/order-routing state; the custom storefront consumes Openfront through its supported GraphQL contract. Supplier/3PL integrations terminate at OpenShip adapter boundaries. Do not treat a generated link, database row, HTTP 200, or synthetic purchase ID as proof of fulfillment.

**Tech Stack:** Next.js, React, TypeScript, Tailwind CSS, shadcn/ui where useful, Openfront, Openfront Storefront as the reference client, OpenShip, GraphQL, Keystone, Prisma, PostgreSQL, Vitest/Playwright or the repository's established test stack, Docker for self-hosting, GitHub Actions for CI.

**Spec:** `DROPSHIPPING-AGENT-PLAN.md` is the executable product specification and implementation plan for the agent.

## Global Constraints

- The customer storefront must be a custom branded experience, not a copied Shopify/AliExpress-style theme.
- Openfront is the commerce system of record for storefront commerce: products, variants, inventory, customers, carts, checkout, orders, discounts, and payment handoff.
- OpenShip is the fulfillment/order-router, not the customer storefront or payment platform.
- Do not expose supplier credentials, private provider APIs, raw internal GraphQL, or internal database records to the browser.
- Every provider adapter must have explicit capability boundaries, timeouts, bounded inputs/outputs, idempotency behavior, ownership checks, and error mapping.
- Never claim an order is fulfilled because an internal operation succeeded; fulfillment must be reconciled against the provider's authoritative response/callback.
- Do not connect real supplier/payment credentials until synthetic end-to-end tests pass.
- Use the smallest number of dependencies necessary. Prefer existing repository patterns over new frameworks.
- Use environment variables for all credentials and secrets. Never commit credentials, tokens, cookies, or local database dumps.
- Production must have HTTPS, secure cookies, webhook signature verification, rate limiting, structured logs without secrets, and a documented backup/recovery path.
- The first release should target one country/market and one primary supplier flow; multi-supplier complexity comes after the single-supplier happy path is reliable.
- Start with roughly 10–30 high-quality products in one coherent niche rather than importing a huge catalog.
- Product copy, photography, and merchandising must be original or appropriately licensed. Do not scrape/copy competitor assets or descriptions.
- Treat pricing, inventory, variants, shipping, tax, and checkout status as live data from the authoritative commerce/provider operation where applicable.
- Accessibility target: keyboard navigable, visible focus states, semantic HTML, useful labels, alt text, sufficient contrast, reduced-motion support.
- Performance target: fast first render on mobile, optimized images, limited client JavaScript, no heavy animation library unless justified by a concrete interaction.
- SEO target: unique metadata, canonical URLs, sitemap, robots, structured product data, indexable collection/product content, and no accidental indexing of account/admin routes.
- Do not use fake scarcity, fake reviews, fake orders, or fabricated trust badges.
- Every task must end with a test, review, and focused commit.

---

# 1. Product Definition

## 1.1 Business model

Build a single-niche dropshipping store with a premium direct-to-consumer feel. The store should have a clear point of view, a small curated catalog, transparent pricing, and a simple path from discovery to purchase.

Default business assumptions for v1:

- Market: India unless the existing project explicitly targets another country.
- Currency: INR for the first market.
- Language: English for v1, with architecture that does not block later localization.
- Catalog size: 10–30 products.
- Supplier count: one primary supplier/integration first.
- Fulfillment: supplier/3PL through an OpenShip channel.
- Checkout: Openfront checkout using a payment provider supported for the target market.
- Customer support: email/contact form plus order lookup/tracking.

The agent must treat these assumptions as defaults, not immutable truths. If the existing repository already contains a target market or brand, preserve that intent and update only the minimum required configuration.

## 1.2 Brand direction

The visual language must avoid generic ecommerce patterns. Use a restrained editorial/product-led composition:

```text
Brand statement
    ↓
Editorial hero
    ↓
Curated collection
    ↓
Product storytelling
    ↓
Social proof / reassurance
    ↓
Shipping + returns clarity
    ↓
Final CTA
```

Do not use:

- gradient-heavy SaaS visuals,
- oversized meaningless headings repeated on every section,
- stock-template icon grids,
- copied supplier images with inconsistent backgrounds,
- fake countdown timers,
- unnecessary popups on first page load,
- autoplay sound,
- animation that slows shopping.

## 1.3 Success criteria

A release candidate is successful when all of the following are true:

1. A new visitor can understand what the brand sells within 5 seconds.
2. A visitor can reach a product page in one or two interactions.
3. A visitor can select a valid variant and add it to cart without stale state.
4. Cart totals remain consistent with the backend.
5. Checkout is handed off only with a valid cart/session and the expected store origin.
6. A paid/test order appears in Openfront correctly.
7. OpenShip receives/imports the order correctly.
8. Exact variants are matched to the fulfillment channel.
9. The downstream purchase operation is idempotent.
10. Tracking is stored and shown back to the customer after authoritative fulfillment/tracking data is received.
11. Failures are visible in the operator workspace and are recoverable.
12. No secrets appear in client bundles, logs, Git history, or API responses.
13. The storefront is usable on current Chrome, Safari, Firefox, Edge, and mobile viewports.

---

# 2. Existing Repository Reconnaissance

Before changing code, inspect the current repositories and record the findings in `docs/architecture/current-state.md`.

Repositories to inspect:

- OpenShip: `https://github.com/openshiporg/openship`
- Openfront: `https://github.com/openshiporg/openfront`
- Openfront Storefront: `https://github.com/openshiporg/openfront-storefront`

Current OpenShip documentation describes the core model as shop → channel → link → product match → order/purchase/tracking. It also states that OpenShip is an operator workspace, not a customer storefront/payment platform, and that current provider adapters/callback paths require hardening before production credentials are connected.

Inspect these areas:

```text
OpenShip
├── package.json
├── schema.prisma
├── schema.graphql
├── features/
│   ├── integrations/
│   └── ...
├── app/
├── lib/
└── pages/api/

Openfront
├── package.json
├── schema.prisma
├── schema.graphql
├── features/
├── app/
└── lib/

Openfront Storefront
├── package.json
├── app/
├── components/
├── lib/
└── GraphQL/client configuration
```

The exact tree may differ by current revision. Do not invent paths; replace this map with the actual paths found in the checked-out source before executing later tasks.

### Reconnaissance checklist

- [ ] Record exact commit SHA for each repository.
- [ ] Record Node.js/package-manager requirements.
- [ ] Record framework/library versions.
- [ ] Identify existing GraphQL client and generated types, if any.
- [ ] Identify authentication/session flow.
- [ ] Identify product/variant query shapes used by the reference storefront.
- [ ] Identify cart mutation flow.
- [ ] Identify checkout handoff flow.
- [ ] Identify existing shipping adapters in Openfront.
- [ ] Identify existing shop/channel/match operations in OpenShip.
- [ ] Identify webhook authentication/signature utilities.
- [ ] Identify existing tests and CI commands.
- [ ] Record anything currently marked experimental, incomplete, or provider-dependent.

Deliverable: `docs/architecture/current-state.md` with exact versions, paths, interfaces, known limitations, and a short diagram of the current flow.

---

# 3. Target Architecture

```text
                         ┌──────────────────────┐
                         │      CUSTOMER        │
                         └──────────┬───────────┘
                                    │ HTTPS
                                    ▼
                    ┌────────────────────────────┐
                    │     CUSTOM STOREFRONT       │
                    │       Next.js / React       │
                    │                             │
                    │ Home / Collection / PDP    │
                    │ Cart / Account / Tracking  │
                    └────────────┬───────────────┘
                                 │ GraphQL / server calls
                                 ▼
                    ┌────────────────────────────┐
                    │         OPENFRONT           │
                    │                             │
                    │ Catalog / Price / Inventory│
                    │ Cart / Customer / Checkout │
                    │ Orders / Discounts         │
                    └────────────┬───────────────┘
                                 │ order source
                                 ▼
                    ┌────────────────────────────┐
                    │          OPENSHIP           │
                    │                             │
                    │ Shop / Channel / Link      │
                    │ Product Match / Routing    │
                    │ Purchase / Tracking        │
                    └────────────┬───────────────┘
                                 │ typed adapter boundary
                                 ▼
                    ┌────────────────────────────┐
                    │     SUPPLIER / 3PL API      │
                    └────────────┬───────────────┘
                                 │ authoritative
                                 ▼
                    ┌────────────────────────────┐
                    │       TRACKING DATA         │
                    └────────────┬───────────────┘
                                 │
                                 ▼
                    ┌────────────────────────────┐
                    │ CUSTOMER ORDER TRACKING     │
                    └────────────────────────────┘
```

## Ownership boundaries

### Openfront owns

- customer-facing product catalog,
- product/variant pricing,
- inventory state exposed to the storefront,
- cart state,
- checkout/session handoff,
- customer identity and account state,
- customer-visible order state.

### OpenShip owns

- source shop configuration,
- fulfillment channels,
- shop-to-channel links,
- product/variant matches,
- order routing state,
- downstream purchases,
- tracking/cancellation/error state related to fulfillment adapters.

### Supplier/3PL owns

- actual downstream order acceptance,
- fulfillment execution,
- carrier handoff,
- authoritative tracking numbers/events,
- provider-specific cancellation/refund constraints.

---

# 4. Project Layout

If creating a separate application around the existing projects, prefer:

```text
store/
├── app/
│   ├── (store)/
│   │   ├── page.tsx
│   │   ├── shop/page.tsx
│   │   ├── collections/[slug]/page.tsx
│   │   ├── products/[slug]/page.tsx
│   │   ├── cart/page.tsx
│   │   ├── checkout/page.tsx
│   │   ├── account/page.tsx
│   │   ├── orders/[id]/page.tsx
│   │   └── track/page.tsx
│   ├── sitemap.ts
│   ├── robots.ts
│   └── api/
├── components/
│   ├── layout/
│   ├── product/
│   ├── collection/
│   ├── cart/
│   ├── checkout/
│   ├── account/
│   ├── tracking/
│   └── ui/
├── features/
│   ├── catalog/
│   ├── cart/
│   ├── checkout/
│   ├── customer/
│   ├── orders/
│   └── tracking/
├── lib/
│   ├── openfront/
│   ├── openship/
│   ├── auth/
│   ├── validation/
│   ├── seo/
│   └── observability/
├── public/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
└── docs/
```

If the existing Openfront Storefront already matches most of this structure, adapt it in place rather than re-scaffolding the application.

---

# 5. Implementation Tasks

## Task 1: Create the product/technical baseline

**Files:**
- Create: `docs/architecture/current-state.md`
- Create: `docs/architecture/target-state.md`
- Modify: root agent instructions (`CLAUDE.md`, `AGENTS.md`, or equivalent if present)

**Interfaces:**
- Produces: exact repository/version/path map that later tasks use.

- [ ] **Step 1: Inspect all three repositories at fixed revisions.**

Record current branch, commit SHA, Node version requirement, package manager, build command, test command, and database requirements.

- [ ] **Step 2: Document current OpenShip flow.**

Capture the exact interfaces for shop, channel, link, match, order, purchase, tracking, webhook, and API-key operations used by the checked-out revision.

- [ ] **Step 3: Document current Openfront flow.**

Capture the exact product, variant, cart, checkout, account, order, and shipping operations used by the checked-out revision.

- [ ] **Step 4: Commit reconnaissance.**

```bash
git add docs/architecture/current-state.md docs/architecture/target-state.md CLAUDE.md AGENTS.md 2>/dev/null || true
git commit -m "docs: define dropshipping architecture baseline"
```

---

## Task 2: Establish local development and environments

**Files:**
- Create/modify: `.env.example`
- Create/modify: `docker-compose.yml` if needed
- Create/modify: `README.md`
- Create/modify: development scripts in `package.json`

**Interfaces:**
- Produces: reproducible local environment with separate development/test configuration.

- [ ] **Step 1: Define environment variables.**

Use names that match the actual checked-out code. At minimum document placeholders for:

```text
DATABASE_URL
OPENFRONT_GRAPHQL_URL
OPENFRONT_PUBLIC_URL
OPENFRONT_API_TOKEN (server-only when required)
OPENSHIP_GRAPHQL_URL
OPENSHIP_API_TOKEN (server-only when required)
PAYMENT_PROVIDER_* (server-only)
SUPPLIER_* (server-only)
WEBHOOK_SECRET_* (server-only)
NEXT_PUBLIC_SITE_URL
```

Never place private credentials in variables prefixed `NEXT_PUBLIC_`.

- [ ] **Step 2: Add local PostgreSQL setup.**

Use the repository's supported migration workflow. Do not manually edit generated migration history unless the project requires it.

- [ ] **Step 3: Add health checks.**

Implement or expose server-side checks that verify the storefront can reach Openfront and, from operator/internal code only, OpenShip. Return sanitized status to health endpoints.

- [ ] **Step 4: Test from a clean checkout.**

```bash
npm ci
npm run lint
npm test
npm run build
```

Use the repository's actual package-manager commands when they differ.

---

## Task 3: Build the storefront design system

**Files:**
- Create/modify: `app/globals.css`
- Create/modify: `components/ui/*`
- Create: `components/layout/SiteHeader.*`
- Create: `components/layout/SiteFooter.*`
- Create: `components/ui/MotionPreference.*`
- Create: `lib/brand/*`

**Interfaces:**
- Produces: reusable visual primitives consumed by home, collection, product, cart, account, and tracking pages.

- [ ] **Step 1: Define design tokens.**

Centralize spacing, typography scale, radius, shadows, container widths, and motion durations. Avoid hard-coded design values scattered across components.

- [ ] **Step 2: Implement navigation.**

Desktop and mobile navigation must share the same source of truth for categories and account/cart actions.

- [ ] **Step 3: Implement accessibility primitives.**

Add skip link, visible keyboard focus, dialog semantics, reduced-motion support, and sensible heading hierarchy.

- [ ] **Step 4: Add visual regression checkpoints.**

Capture screenshots for desktop 1440px and mobile 390px after the home shell is stable.

---

## Task 4: Implement catalog access through Openfront

**Files:**
- Create/modify: `lib/openfront/catalog.*`
- Create/modify: `features/catalog/*`
- Create/modify: `components/product/*`
- Create tests: `tests/unit/catalog/*`

**Interfaces:**
- Produces typed functions similar to:

```ts
type CatalogProduct = {
  id: string;
  slug: string;
  title: string;
  description: string;
  images: Array<{ url: string; alt?: string }>;
  variants: Array<{
    id: string;
    title: string;
    sku?: string;
    price: number;
    available: boolean;
  }>;
};

getFeaturedProducts(): Promise<CatalogProduct[]>;
getCollectionBySlug(slug: string): Promise<{ products: CatalogProduct[] }>;
getProductBySlug(slug: string): Promise<CatalogProduct | null>;
searchProducts(query: string): Promise<CatalogProduct[]>;
```

Replace the illustrative signatures above with the exact generated types/queries used by the checked-out Openfront revision.

- [ ] **Step 1: Write failing catalog tests.**

Cover missing product, unavailable variant, collection pagination, empty search, and malformed provider response.

- [ ] **Step 2: Implement the minimal typed Openfront client.**

Keep the client server-side by default. Only expose customer-safe data to React client components.

- [ ] **Step 3: Add caching/revalidation.**

Use the framework's supported server cache/revalidation primitives. Product availability/pricing must not be cached beyond a window that could make checkout misleading.

- [ ] **Step 4: Verify.**

Run unit tests and query a local Openfront instance with at least three products and multiple variants.

---

## Task 5: Build the home page and merchandising flow

**Files:**
- Modify: `app/(store)/page.*`
- Create: `components/home/Hero.*`
- Create: `components/home/FeaturedCollection.*`
- Create: `components/home/BrandStory.*`
- Create: `components/home/TrustSection.*`
- Create: `components/home/FAQ.*`

**Interfaces:**
- Consumes: `getFeaturedProducts()`, brand tokens, site configuration.

- [ ] **Step 1: Build an editorial hero.**

The hero must explain what the brand sells and why it exists. CTA must navigate to a real collection or catalog route.

- [ ] **Step 2: Add curated product presentation.**

Show a limited number of products, not a giant grid. Use actual product images and backend prices.

- [ ] **Step 3: Add product rationale.**

For each featured product, communicate one real use case/benefit grounded in catalog data or approved copy.

- [ ] **Step 4: Add trust and policy visibility.**

Show shipping/returns/support links with real policy content. No fabricated claims.

- [ ] **Step 5: Test responsive behavior and keyboard navigation.**

---

## Task 6: Build collection and product detail pages

**Files:**
- Create/modify: `app/(store)/shop/page.*`
- Create/modify: `app/(store)/collections/[slug]/page.*`
- Create/modify: `app/(store)/products/[slug]/page.*`
- Create/modify: `components/product/ProductGallery.*`
- Create/modify: `components/product/VariantSelector.*`
- Create/modify: `components/product/AddToCart.*`
- Create tests: `tests/unit/product/*`
- Create tests: `tests/e2e/product.spec.*`

**Interfaces:**
- Produces: product-detail UX that emits a selected Openfront variant ID into the cart flow.

- [ ] **Step 1: Implement product routing.**

Use stable slugs. Generate metadata and canonical URLs from the authoritative product record.

- [ ] **Step 2: Implement variant selection.**

The UI must never silently substitute a different variant. Disabled/unavailable options must be obvious.

- [ ] **Step 3: Implement add-to-cart.**

Submit the exact variant ID and quantity to Openfront. Disable duplicate submissions and show a recoverable error state.

- [ ] **Step 4: Add structured data.**

Add product structured data only from authoritative catalog values. Do not create fake review aggregate data.

- [ ] **Step 5: E2E test.**

Test: collection → product → variant → add to cart → cart contains exact variant/quantity.

---

## Task 7: Implement cart state and correctness

**Files:**
- Create/modify: `features/cart/*`
- Create/modify: `lib/openfront/cart.*`
- Create/modify: `components/cart/*`
- Create/modify: `app/(store)/cart/page.*`
- Create tests: `tests/unit/cart/*`
- Create tests: `tests/e2e/cart.spec.*`

**Interfaces:**
- Produces typed cart operations:

```ts
getCart(cartId: string): Promise<Cart>;
addCartLine(input: { cartId: string; variantId: string; quantity: number }): Promise<Cart>;
updateCartLine(input: { cartId: string; lineId: string; quantity: number }): Promise<Cart>;
removeCartLine(input: { cartId: string; lineId: string }): Promise<Cart>;
```

Use the exact Openfront mutation names/types from the checked-out revision.

- [ ] **Step 1: Write failing tests for add/update/remove.**

Include duplicate click, invalid quantity, unavailable variant, and stale cart scenarios.

- [ ] **Step 2: Implement server-backed operations.**

Do not compute final totals on the client. Display backend totals.

- [ ] **Step 3: Add optimistic UI only where rollback is reliable.**

Never allow optimistic totals to be interpreted as final checkout totals.

- [ ] **Step 4: Verify cart-to-checkout continuity.**

---

## Task 8: Implement account and customer order lookup

**Files:**
- Create/modify: `features/customer/*`
- Create/modify: `app/(store)/account/page.*`
- Create/modify: `app/(store)/orders/[id]/page.*`
- Create/modify: `app/(store)/track/page.*`
- Create/modify: `lib/auth/*`
- Create tests: `tests/e2e/account.spec.*`

**Interfaces:**
- Produces authenticated customer operations using the Openfront-supported account/session flow.

- [ ] **Step 1: Reuse Openfront's current auth/session contract.**

Do not invent a second customer identity store unless the existing architecture requires it.

- [ ] **Step 2: Implement safe order lookup.**

Do not allow a customer to retrieve arbitrary orders by changing an ID. Require the session/customer relationship or a properly signed/time-limited lookup capability.

- [ ] **Step 3: Display order status.**

Use customer-safe state from Openfront plus fulfillment/tracking state that has been intentionally projected for the customer.

- [ ] **Step 4: Test authorization boundaries.**

Cover wrong customer, expired session, malformed ID, and unauthenticated access.

---

## Task 9: Implement checkout handoff

**Files:**
- Create/modify: `features/checkout/*`
- Create/modify: `app/(store)/checkout/page.*`
- Create/modify: `lib/openfront/checkout.*`
- Create/modify: `lib/security/redirects.*`
- Create tests: `tests/unit/checkout/*`
- Create tests: `tests/e2e/checkout.spec.*`

**Interfaces:**
- Produces a customer-safe checkout handoff using the current Openfront contract.

- [ ] **Step 1: Validate cart ownership/session.**

The checkout operation must prove that the current customer/session owns the cart being submitted.

- [ ] **Step 2: Re-read important cart state.**

Before redirecting, ensure prices, availability, currency, and line items are current enough for the checkout contract.

- [ ] **Step 3: Lock redirect origin.**

Allow only the expected merchant origin/configured route. Reject arbitrary redirect URLs.

- [ ] **Step 4: Handle unavailable checkout capability.**

Show a useful error rather than claiming order success.

- [ ] **Step 5: E2E test test-payment mode.**

Verify customer can reach payment/checkout and a test order is created exactly once.

---

## Task 10: Configure OpenShip shop and channel model

**Files:**
- Create/modify: `lib/openship/*`
- Create/modify: `docs/ops/openship-setup.md`
- Create tests: `tests/unit/openship/*`

**Interfaces:**
- Produces typed internal operations for the configured Openfront shop and selected fulfillment channel.

Core relationship:

```text
Shop = Openfront order source
Channel = Supplier/3PL destination
Link = Shop -> Channel
Match = Openfront variant -> Supplier/Channel variant
```

- [x] **Step 1: Configure the Openfront shop source.**

Use scoped credentials and owner checks as supported by the current OpenShip revision.

- [x] **Step 2: Configure the fulfillment channel.**

Use a real provider adapter only after its contract is verified; otherwise start with a synthetic/local channel.

- [x] **Step 3: Create the shop-channel link.**

Prevent duplicate links unless the OpenShip contract explicitly supports multiple routing destinations with deterministic priority.

- [x] **Step 4: Create exact product matches.**

Match at variant level, not merely by title. Store a deterministic mapping from storefront SKU/variant to supplier SKU/variant.

- [x] **Step 5: Write operator setup documentation.**

Document every required credential, scope, match rule, test command, and rollback procedure.

---

## Task 11: Build a synthetic fulfillment channel

**Files:**
- Create: `integrations/synthetic-channel/*`
- Create: `tests/integration/synthetic-channel/*`
- Modify: provider registry/allowlist files from the current OpenShip revision

**Interfaces:**

```ts
type CreatePurchaseInput = {
  externalOrderId: string;
  currency: string;
  lines: Array<{
    externalVariantId: string;
    quantity: number;
  }>;
  shippingAddress: Address;
};

createPurchase(input: CreatePurchaseInput): Promise<{
  purchaseId: string;
  status: "accepted" | "rejected";
}>;

getTracking(input: { purchaseId: string }): Promise<Tracking | null>;
cancelPurchase(input: { purchaseId: string }): Promise<CancelResult>;
```

Use actual adapter contracts from the checked-out OpenShip revision rather than copying these illustrative types verbatim.

- [x] **Step 1: Implement deterministic synthetic behavior.**

The fixture should accept known SKUs, reject unknown SKUs, expose deterministic purchase IDs, and emit deterministic tracking numbers after an explicit state transition.

- [x] **Step 2: Implement idempotency tests.**

Submitting the same external order twice must not create two purchases.

- [x] **Step 3: Implement failure tests.**

Cover timeout, malformed response, provider rejection, duplicate callback, and cancellation after fulfillment.

- [x] **Step 4: Integrate into OpenShip through the supported adapter boundary.**

Do not hard-code the provider into generic routing logic. Implemented as data,
not code changes: `ensureSyntheticChannelPlatform` provisions the operator's
`ChannelPlatform` row (all ten adapter slots = `synthetic`, no credentials;
same-name rows with different slots are refused), and
`attachSyntheticChannelPlatform` connects it to the staged channel through
OpenShip's own `updateChannel` mutation, refusing a foreign or non-synthetic
platform and never touching the staged link's disabled filters. Both live in
`store/lib/openship/setup.ts`, run against the pinned `schema.graphql`, and are
covered by 14 contract tests in `store/tests/unit/openship/setup.test.ts`
(45 in that file, 223 total, all passing). Routing stays disabled; ordering
matters — stageLink/stageMatch require a platform-free channel, so the attach
is the final boundary step.

---

## Task 12: Implement production supplier adapter

**Files:**
- Create: `integrations/<supplier>/*`
- Modify: OpenShip provider registry/allowlist from the checked-out revision
- Create: `tests/integration/<supplier>/*`
- Create: `docs/ops/<supplier>-runbook.md` → `docs/ops/cj-runbook.md` (created; gates unchecked)

**Interfaces:**
- Consumes: exact OpenShip channel adapter contract.
- Produces: bounded purchase, tracking, cancellation, and health operations.

- [x] **Step 1: Define supplier capabilities.**

Explicitly list whether the provider supports inventory lookup, product lookup, purchase creation, cancellation, tracking, webhooks, and retries.
Recorded: `docs/ops/supplier-adapter-template.md` (CJ assessment) and
`docs/ops/cj-runbook.md` — reads verified live; writes fail closed.

- [x] **Step 2: Implement authentication.**

Keep credentials server-side. Rotate and revoke through environment/configuration management.
Implemented in `store/integrations/cj-channel/cj.ts`: token from OpenShip
server env / channel accessToken, expiry-checked before every call; rotation
drill designed but not yet executed (`docs/ops/cj-runbook.md`).

- [x] **Step 3: Validate provider responses.**

Use schema validation. Reject missing IDs, wrong currencies, unknown SKUs, negative quantities, and unexpected status transitions.
`parseCjJson` keeps 19-digit ids as strings; envelope `code === 200 &&
result === true` enforced (`CjApiError` otherwise); purchase lines require
positive integer quantities; unknown vid rejected. Contract tests:
`store/tests/unit/cj-channel/cj.test.ts` (26, no network).


- [ ] **Step 4: Implement idempotency.**

Use a durable key based on the source order identity plus deterministic request scope. Handle concurrent duplicate requests safely.

- [ ] **Step 5: Implement timeout/retry policy.**

Retry only operations that are safe to retry. Never blindly retry an order-creation call without idempotency support.

- [ ] **Step 6: Implement webhooks/callbacks.**

Verify signatures, reject replayed event IDs, persist receipt/processing state, and make event handling idempotent.

- [ ] **Step 7: Reconcile.**

Provide an operator action/job to compare local state against authoritative supplier state when callbacks are delayed or missing.

---

## Task 13: Connect order routing end-to-end

**Files:**
- Modify: OpenShip order-routing service/resolver files identified during reconnaissance
- Create/modify: `features/fulfillment/*`
- Create: `tests/integration/order-routing/*`
- Create: `tests/e2e/fulfillment.spec.*`

**Interfaces:**

```text
Openfront paid/test order
        ↓
OpenShip source order import/receive
        ↓
Match exact variants
        ↓
Build downstream purchase lines
        ↓
Provider idempotency key
        ↓
Supplier purchase
        ↓
Persist authoritative purchase ID
        ↓
Tracking callback/poll
        ↓
Customer-safe tracking projection
```

- [x] **Step 1: Write the full synthetic happy-path test.** (2026-09-18)

Create an order containing multiple variants and quantities. Assert exact line mapping into the synthetic channel.

Evidence: `store/tests/unit/order-routing/routing.test.ts` runs the REAL pinned
`placeMultipleOrders` + `supplierPurchaseClaim` chain against in-memory
query/prisma fakes, loading the adapter through OpenShip's own dynamic import
(`features/integrations/channel/synthetic.ts`). Seven tests: exact multi-variant/
multi-quantity line mapping (adapter-side `lines` snapshot), two identical carts
on different orders get distinct purchases (attemptKey forwarded end to end),
rerun of completed orders is a no-op, in-flight claims cannot be lease-stolen,
unknown SKUs fail closed to `PURCHASE_OUTCOME_UNKNOWN` with the order held at
`PENDING`, and mixed carts are all-or-nothing at the adapter boundary.

- [x] **Step 2: Implement order ingestion.** (2026-09-19)

Preserve the source order ID permanently as the correlation key.

Evidence: the ingestion path is the REAL pinned OpenShip route
`openship/app/api/handlers/shop/create-order/[shopId]/route.ts` (signature
verification via `features/integrations/shop/openfront.ts` +
`openfront-webhook-security.ts`, dispatched through
`features/integrations/shop/lib/executor.ts`) run against in-memory Keystone
resolvers; only the database is faked.

- `store/tests/unit/order-routing/ingestion.test.ts` — 20 tests. Signature
  boundary (7): real executor dispatch accepts a correctly signed event and
  rejects a tampered body, a wrong secret, truncated/malformed/missing
  signatures, a missing verification secret, and `sha256=`-prefixed digests.
  Transform (5): the OpenFront order ID is preserved verbatim as
  `orderId`, the full Keystone-ready shape is mapped (status `INPROCESS`,
  `shop`/`user` as `connect` inputs, addresses, totals), line items combine
  product+variant titles, flat title/sku fall back when no variant relation
  exists, and currency defaults to USD with missing amounts zeroed.
  Cancellation (2): the cancel webhook returns the source order ID and rejects
  an event without one. Route (6): creates exactly once from a signed webhook;
  a replay acknowledges the canonical row (1 dedupe query, 0 inserts); a lost
  create race is recovered by the catch-block re-query (adopting the
  concurrent winner, still exactly one row); a bad signature, an unknown shop,
  or a `createOne` failure with no winner each return 500 and write nothing.
- `store/tests/unit/order-routing/route-ingestion.test.ts` — 6 route-level
  tests over the pinned `POST` handler with the same fakes, plus a
  Keystone-shaped `equals` guard (an empty correlation key is a rejected query,
  not a match-all).
- Harness: `store/tests/stubs/openship-keystone-context.ts` (mutable
  `state.query`) aliased in both `store/vitest.config.ts` and
  `store/tsconfig.json`, so the pinned route's `@/features/*` imports resolve
  the same way at runtime and in the type checker. The store's own
  `@/features/storefront/*` namespace is not shadowed.
- Commands: `cd store; npx vitest run` -> 19 files / 256 tests pass;
  `npx vitest run tests/unit/order-routing` -> 3 files / 33 tests pass;
  `npx tsc --noEmit -p tsconfig.json` reports no errors under `tests/` or in
  the pinned ingestion files (the 211 remaining lines are pre-existing store
  app errors unrelated to order routing).

- [x] **Step 3: Implement match verification.** (2026-09-19)

Reject partially matched orders unless the configured business rule explicitly supports partial fulfillment.

Evidence: `store/lib/fulfillment/matchVerification.ts`. The pinned router has
no such guard — `matchOrder.ts` only turns matched lines into cart items, and
`findChannelItems` reuses one `ChannelItem` for identical
`(channel, user, quantity, productId, variantId)` rows — so verification is a
store-side comparison of the source lines against the matched cart items.
Closed fault set, each with a severity: `INVALID_LINE`, `UNLINKED_CART_ITEM`,
`QUANTITY_EXCESS`, `MULTI_CHANNEL_VARIANT` block unconditionally; `UNMATCHED_LINE`,
`QUANTITY_SHORTFALL`, `COLLAPSED_SOURCE_LINE` are permitted only when
`allowPartialFulfillment` is set. A refused verdict exposes no channel
(`submittableChannelIds: []`); an approved partial exposes only channels with no
channel-scoped fault, because the router submits a channel's whole cart in one
adapter call. Tests: `store/tests/unit/fulfillment/match-verification.test.ts`
(11), including the documented ChannelItem-reuse collapse and double-sourcing.

- [x] **Step 4: Implement purchase creation.** (2026-09-19)

Use one idempotency key per source order/fulfillment action and persist the downstream purchase ID before allowing a retry path to create a second request.

Evidence: `store/lib/fulfillment/purchaseCreation.ts`. The key is
`source-purchase:<sha256(sourceOrderId\0channelId\0sortedItemIds)>` — one per
source order + fulfillment action, stable across item ordering and duplicates,
mirroring the pinned `supplierPurchaseAttemptKey` scheme but rooted in the
source correlation key from Step 2. `planPurchaseCreation` returns exactly one of
`submit | reuse | reconcile | blocked`: a persisted `purchaseId` is reused
(never a second request), a fresh `PURCHASE_PROCESSING` claim is not
lease-stealable, a stale one is not auto-retried (the pinned router only ever
re-attempts the `openfront` channel API), and `PURCHASE_OUTCOME_UNKNOWN`
becomes `reconcile`. It also refuses the verified unsafe path: the
`createChannelPurchase` mutation drops `idempotencyKey` and never forwards
channel credentials, so it is blocked outright — only the router path forwards
the key. `recordPurchaseOutcome` writes `AWAITING` only when the supplier
returned a non-empty ID, otherwise `PURCHASE_OUTCOME_UNKNOWN [<attemptKey>]:
<reason>` (the pinned error format). Tests:
`store/tests/unit/fulfillment/purchase-creation.test.ts` (14), including the
outcome → ledger → next-plan round trip.

- [x] **Step 5: Implement reconciliation state machine.** (2026-09-19)

Use explicit states, for example:

```text
RECEIVED
→ MATCHED
→ READY
→ SUBMITTING
→ ACCEPTED
→ FULFILLING
→ SHIPPED
→ DELIVERED
```

And failure states:

```text
MATCH_FAILED
PROVIDER_REJECTED
RETRYABLE_ERROR
CANCEL_REQUESTED
CANCELLED
RECONCILIATION_REQUIRED
```

Adapt names to existing domain types where possible.

Evidence: `store/lib/fulfillment/reconciliation.ts` keeps the plan's state names
verbatim and adds a closed transition table (anything undeclared throws), an
event reducer, and `deriveFulfillmentState`, which projects the pinned
observations (`CartItem.status` PENDING / PURCHASE_PROCESSING /
PURCHASE_OUTCOME_UNKNOWN / AWAITING, `purchaseId`, tracking, cancel intent, plus
the Step 3 verdict) onto a state. Two pinned behaviours are first-class:
`cancelPurchase.ts` rewrites local status only, so cancellation stops at
CANCEL_REQUESTED and reaches CANCELLED only on confirmation; and an uncertain
supplier outcome is a hold (`RECONCILIATION_REQUIRED`) that no single event can
leave for a fresh submission. Terminal states are `DELIVERED` and `CANCELLED`.

- [x] **Step 6: Test all terminal and failure transitions.** (2026-09-19)

Evidence: `store/tests/unit/fulfillment/reconciliation.test.ts` (18). Covers the
full forward walk, table integrity (every state's edges exist and point at known
states; terminal states have none), every failure edge, the unknown-outcome
hold, both cancellation outcomes, terminal-state protection, at-least-once
callback idempotency (including a duplicate success arriving after tracking
without regressing), a blank purchase ID on a "success", unknown
state/event/illegal-jump rejection, operator guidance for all 14 states, and a
projection table over the pinned observation shapes.

Commands: `cd store; npx vitest run` -> 22 files / 299 tests pass;
`npx tsc --noEmit -p tsconfig.json` -> no errors in `lib/fulfillment/` or
`tests/unit/fulfillment/` (the 211 remaining lines are the pre-existing store
app errors documented in `docs/architecture/current-state.md`).

---

## Task 14: Customer tracking experience

**Files:**
- Create/modify: `components/tracking/*`
- Modify: `app/(store)/orders/[id]/page.*`
- Create: `lib/fulfillment/customerTracking.*`
- Create tests: `tests/e2e/tracking.spec.*`

**Interfaces:**
- Produces a sanitized customer tracking object, never raw provider payloads.

Example shape:

```ts
type CustomerTracking = {
  status: "processing" | "shipped" | "delivered" | "issue";
  carrier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  lastUpdatedAt?: string;
};
```

- [x] **Step 1: Map internal/provider status to customer-safe states.** (2026-09-19)

Evidence: `store/lib/fulfillment/customerTracking.ts`. `toCustomerStatus` folds
every Step 5 reconciliation state onto one of four customer-safe statuses —
processing (RECEIVED→ACCEPTED), shipped (FULFILLING/SHIPPED), delivered
(DELIVERED), issue (all failure states; CANCELLED included, because OpenShip's
`cancelPurchase` rewrites local status only, so a cancelled line is a
customer-visible problem). `projectCustomerTracking` reads only the named
scalars of a `TrackingObservation`; any other key arriving on the wire (raw
provider payloads, error strings) is dropped by construction, so a
`RECONCILIATION_REQUIRED` hold renders as "Our team is looking into it." —
never as the underlying `PURCHASE_OUTCOME_UNKNOWN` text. The closed
`CUSTOMER_TRACKING_KEYS` list bounds what can ever reach a customer and is
asserted in tests.

- [x] **Step 2: Validate tracking URL destinations.** (2026-09-19)

Avoid arbitrary redirect behavior. Show a plain tracking number even when a carrier URL cannot be safely projected.

Evidence: `sanitizeTrackingUrl` accepts a URL only when it is https, carries no
embedded credentials, resolves to a real multi-label host (no IP literals,
loopback, or single-label names), and that host belongs to the carrier we
believe we are tracking (`CARRIER_TRACKING_HOSTS` for usps/ups/fedex/dhl, with
label aliases). Anything else returns null and the caller shows the plain
number. The consumer was hardened too: `fulfillment-card/index.tsx` used to put
the supplier `trackingUrl` into `href={trackingUrl || "#"}` verbatim; it now
projects through `sanitizeTrackingUrl`/`sanitizeTrackingNumber`, renders an
`<a>` only when both survive, and falls back to a plain `<p>` number.
Identifiers are restricted to opaque printable values (`sanitizeTrackingNumber`,
≤64 chars) and timestamps to plausible ISO dates (`sanitizeTimestamp`,
2000–2100).

- [x] **Step 3: Add delayed-tracking state.** (2026-09-19)

Explain when an order has been accepted but tracking is not yet available.

Evidence: for ACCEPTED/FULFILLING with no tracking number, the projection adds
`trackingDelayed` — true only once `acceptedAt` is at least `TRACKING_DELAY_MS`
(48h) old — and swaps the message to the "accepted by our supplier, tracking
not available yet" copy. Once a number exists the key is omitted entirely, so a
delivered order is never reported as delayed.

- [x] **Step 4: Test stale/missing tracking.** (2026-09-19)

Evidence: `store/tests/unit/fulfillment/customer-tracking.test.ts` (9 tests).
Covers: full state→status mapping; provider detail never reaching the customer
object; validated carrier link + uppercased carrier + ISO timestamp; plain
number when the link cannot be safely projected (and when the carrier itself is
unrecognised); opaque-identifier enforcement; the 48h delayed-tracking boundary
(just under → no flag, past → flag, number present → flag disappears); stale,
missing, and unparseable timestamps (`"not-a-date"`, `0`, epoch, far-future)
dropped rather than displayed; wire payloads carrying provider error strings
ignored; and shape stability — the same observation always projects to the same
object with exactly the permitted keys.

Commands: `cd store; npx vitest run` -> 23 files / 308 tests pass;
`npx vitest run tests/unit/fulfillment` -> 4 files pass;
`npx tsc --noEmit -p tsconfig.json` -> no errors in `lib/fulfillment/`,
`tests/`, or the hardened `fulfillment-card` component (the 211 remaining
lines are the pre-existing store app errors documented in
`docs/architecture/current-state.md`).

---

## Task 15: Shipping and returns implementation

**Files:**
- Modify: Openfront shipping configuration as required
- Create/modify: `lib/shipping/*`
- Create/modify: `app/(store)/shipping/page.*`
- Create/modify: `app/(store)/returns/page.*`
- Create: `tests/unit/shipping/*`

Openfront documentation describes shipping providers as having operations such as rate lookup, address validation, label creation, tracking, and label cancellation. Use only the operations actually needed by the business flow.

- [x] **Step 1: Configure shipping strategy.** (2026-09-19)

Start with the smallest reliable model: a flat rate, free-shipping threshold, or provider-backed live rates based on actual business requirements.

Evidence: `store/lib/shipping/pricing.ts`. The v1 strategy is applied
store-side, on top of what Openfront returns: the `activeCartShippingOptions`
query returns region-scoped `ShippingOption` rows with their
`min_subtotal`/`max_subtotal` requirements attached but **not applied**, so
`selectShippingOptions` gates them before checkout renders — USD-only (the
store market, `site.market`), flat rates only (`priceType: "calculated"`
options are dropped because no live rate exists yet to quote — showing one
would be a fabricated price), `min_subtotal`/`max_subtotal` requirements
enforced against the cart subtotal (inclusive lower, exclusive upper, exactly
the Medusa-style semantics Openfront's schema implies), `priceType: "free"`
surfaced as Free, and the selection response carrying a closed reason code
(`market`, `unavailable_destination`, `no_quoted_rate`, `unmet_threshold`)
plus `reasons` explaining each hidden option. Wired into
`checkout-form/index.tsx`, which passes the filtered options to the Shipping
component and relaxes its `calculatedAmount` type to optional. Rationale,
edge cases, and failure modes documented in `docs/ops/adding-a-supplier-provider.md`.

- [x] **Step 2: Validate addresses where required.** (2026-09-19)

Do not claim address validation if the configured provider does not perform it.

Evidence: `store/lib/shipping/address.ts` performs **format-only** validation —
bounded lengths, per-field shape, US-state/ZIP5 format, and a closed
`SUPPORTED_DESTINATIONS` list — and never claims deliverability. This is
honest for v1 because the configured provider is `manual`, whose
`validateAddressFunction` returns `isValid: true` unconditionally (verified in
`store/features/integrations/shipping/manual.ts`); the result type carries
`validatedBy: "format-only"` so no caller can mistake it for carrier
validation. Wired server-side into the `setAddresses` action in
`store/features/storefront/lib/data/cart.ts` before any address record is
created, so malformed or out-of-market addresses are rejected before payment
rather than at the label-purchase step.

- [x] **Step 3: Publish real shipping/return policies.** (2026-09-19)

Policies must match operational capability.

Evidence: `store/lib/brand/policies.ts` holds the copy as data; the existing
`app/(storefront)/[countryCode]/(main)/policies/[slug]/page.tsx` renders it and
404s any slug not in `policies` (privacy/terms deliberately still 404 — Task
21 owns them). The copy states only what is true: US-only market, costs
shown at checkout, tracking appearing when the carrier reports it, 30-day
returns initiated by email because there is no automated returns portal. The
two `available: false` trust slots reserved for this task in
`store/lib/brand/site.ts` are now `available: true` with honest one-line
summaries; privacy/terms stay flagged off. `logs-verify-home.mjs` was
updated to assert the new links render and privacy/terms still do not.

- [x] **Step 4: Test pricing at boundaries.** (2026-09-19)

Cover free-shipping threshold, unavailable destination, invalid address, and currency mismatch.

Evidence: `store/tests/unit/shipping/pricing.test.ts` covers the threshold
boundary exactly at/at the dollar below/above, inclusive-min and
exclusive-max requirement semantics, calculated-price dropping, market gate,
unknown-destination and null-subtotal fallbacks, reason codes, shape
stability, and zero-option carts. `store/tests/unit/shipping/address.test.ts`
covers valid/invalid ZIP5, state, city/street/name/phone, oversize fields,
unsupported countries, and the `validatedBy: "format-only"` flag.
`store/tests/unit/brand/policies.test.ts` covers that every policy section is
non-empty, privacy/terms are absent, capability claims match reality
(US-only, email-initiated returns), and the reserved trust links resolve to
published slugs.

Commands: `cd store; npx vitest run` -> 29 files / 396 tests pass;
`npx tsc --noEmit -p tsconfig.json` -> no errors in `lib/shipping/`,
`lib/brand/`, checkout surfaces, or tests (211 remaining lines are the
pre-existing store-app errors documented in `docs/architecture/current-state.md`).

---

## Task 16: Payment integration hardening

**Files:**
- Create/modify: `lib/payment/*`
- Modify: Openfront payment configuration
- Create: `tests/integration/payment/*`
- Create: `docs/ops/payments.md`

- [x] **Step 1: Use the payment integration supported by the target market.** (2026-09-19)

For India, prefer a provider with UPI/card/net-banking support if the business requires those methods. Keep provider-specific logic behind Openfront's payment boundary.

Evidence: the pinned v1 market is **US/USD** (`site.market`,
`store/lib/brand/site.ts`), so the supported integrations are Stripe (cards)
and PayPal, both USD-capable and both kept behind Openfront's
`features/integrations/payment` adapter boundary — the store holds only
public keys (`store/.env.example` recon note). New
`store/lib/payment/methods.ts` applies `selectPaymentMethods` server-side in
the checkout form before render: a closed allowlist over provider codes
(`unknown_provider`), `not_installed`, a market-currency gate
(`unsupported_currency`), a configured-key gate on `NEXT_PUBLIC_STRIPE_KEY` /
`NEXT_PUBLIC_PAYPAL_CLIENT_ID` (`not_configured`), and exclusion of the
manual/COD test scaffold in production (`test_mode_only` — the storefront
itself names the button `ManualTestPaymentButton` and Openfront refuses to
settle manual tender). Reason codes are a closed set; gate order is pinned by
tests. Tests: `store/tests/integration/payment/methods.test.ts` (15).

- [x] **Step 2: Verify webhook authentication.** (2026-09-19)

Never mark an order paid because a client returned to a success page. Payment state must come from an authenticated provider/Openfront flow.

Evidence: (a) `placeOrder` has no client success input at all — cart cookie
+ signed proof + payment session id only; a `completeActiveCart` response
without an order id is now explicitly tested as failure (no redirect, cart
kept). (b) Webhook verification is throw-to-reject at the adapter boundary
and runs **before any persistence**: Stripe verifies `stripe-signature`
against `STRIPE_WEBHOOK_SECRET` (missing secret/header/mismatch all throw),
PayPal requires `PAYPAL_WEBHOOK_ID` + a `SUCCESS` answer from
`verify-webhook-signature`, and the manual adapter — which previously
returned `isValid: true` for *any* payload — now throws
`"Manual payment providers do not accept webhook ingress"`, matching
Openfront's runtime copy. Tests: `store/tests/integration/payment/
webhook-auth.test.ts` (8, real Stripe signing via
`generateTestHeaderString`) and `webhook-events.test.ts` (3 auth cases
against Openfront's real `handlePaymentProviderWebhook`: forged event →
zero rows/captures/updates; tampered amount → rejected with the dedupe row
left un-completed; manual ingress → rejected before dedupe).

- [x] **Step 3: Add duplicate-event tests.** (2026-09-19)

Evidence: `store/tests/integration/payment/webhook-events.test.ts` executes
Openfront's **real** `handlePaymentProviderWebhook` mutation (vendored in
this repo, loaded via a specifier assembled from parts so the store's tsc
program does not follow it into vendored sources) against an in-memory
IdempotencyKey/prisma harness: first delivery of a verified capture
reconciles (`capture.create`, payment → `captured`, one `PAYMENT_CAPTURED`
event, row → `completed`); redelivery of the same
`provider-webhook:{providerId}:{eventId}` answers `"Duplicate event
acknowledged"` with **zero** further writes (asserted via call counts, and
verification re-runs both times — auth is never skipped); an event with no
provider event id is refused before any row exists; a delivery arriving
while a fresh lock is held is rejected (`Event is already being processed`).
Order-submit duplicates are covered in Step 4's suite.

- [x] **Step 4: Add failure/retry tests.** (2026-09-19)

Evidence: `store/tests/integration/payment/place-order-failures.test.ts`
(7). Failure mappings added to `store/features/storefront/lib/data/cart.ts`
and pinned: declined settlement (`Payment failed: …` — thrown by Openfront
*before* `createOrderFromCartAtomically`, so the message may say "no order
was placed" while never claiming "not charged"), reconciliation-required →
payment-confirmation message, transport failure (timeout/reset/DNS/fetch) →
a message claiming neither outcome and pointing at the orders page. Retry
invariants: failure keeps the cart cookie and a retry completes exactly once
(2 completion attempts, 1 order); after success a duplicate submit makes
**zero** network calls; a lost-response retry after a backend commit stops
at "cart no longer available" with still exactly one completion attempt; a
backend response without an order id is failure, never success.

- [x] **Step 5: Document refund/cancellation behavior.** (2026-09-19)

Do not assume supplier cancellation equals customer refund.

Evidence: `docs/ops/payments.md`. The refund/cancellation section pins the
ground rule in a four-row matrix — OpenShip `cancelPurchase` rewrites local
fulfillment status only (`CANCEL_REQUESTED` → `CANCELLED` on confirmation,
Task 13 semantics) and moves no money; a customer refund is a separate
deliberate Openfront op through `refundPaymentFunction` against a `captured`
payment (failed/voided/uncaptured have nothing to refund — checking
`getPaymentStatus` first is step 1 of the operator procedure); manual/COD
"refunds" are bookkeeping only; and a supplier refund to *us* never
auto-issues a customer refund. Refund state comes from the provider flow,
never from client evidence, and eligibility follows the published returns
policy. The doc also covers ownership map, method gating, paid-state flow,
webhook auth/dedupe, retry semantics, and the sandbox→live switch-on
checklist (incl. the adapters' hardcoded PayPal sandbox host).

Commands: `cd store; npx vitest run` -> 30 files / 390 tests pass;
`npx vitest run tests/integration/payment` -> 4 files / 36 tests;
`npx tsc --noEmit -p tsconfig.json` -> 193 error entries, all pre-existing
store-app debt (0 in `lib/payment/`, `tests/`, or the checkout surfaces;
earlier "~211 lines" figures count tsc's console-wrapped continuation lines —
entry count is the stable measure).

---

## Task 17: Admin/operator observability

**Files:**
- Create/modify: `features/admin/*` or use existing OpenShip operator routes
- Create: `lib/observability/*`
- Create: `docs/ops/incident-runbook.md`
- Create tests: `tests/unit/observability/*`

Required operational views:

```text
Orders
Matches
Purchases
Tracking
Provider health
Failed operations
Reconciliation queue
Webhook events
```

- [x] **Step 1: Add correlation IDs.** (2026-09-19)

Every customer order → Openfront order → OpenShip order → provider purchase must be traceable by correlation ID/source order ID.

Evidence: `store/lib/observability/correlation.ts`. The chain is
`cartId → sourceOrderId (the permanent Task 13 Step 2 key) → openshipOrderId
→ purchaseId`, plus a per-operation `traceId` (UUID from `newTraceId`).
The key set is CLOSED and the object is built field-by-field — extra input
keys (`secretKey`, proofs, payloads) can never reach a log line, which is
the enforceable half of Step 2's "never log secrets". Bounds (128 chars,
trim/drop empties, non-strings dropped), a fixed-order `correlationSummary`
(`sourceOrder=of_1 openshipOrder=osh_2 purchase=pur_3`, same vocabulary as
`knownHops`), and hop coverage helpers are all exported. Wired into store
logs: the `checkout.complete` success line carries `{cartId,
sourceOrderId}`. Runbook table maps all eight required operational views to
their real homes + the correlation key to grep
(`docs/ops/incident-runbook.md`). Tests:
`store/tests/unit/observability/correlation.test.ts` (9).

- [x] **Step 2: Add structured logs.** (2026-09-19)

Log IDs, operation names, durations, and sanitized provider status. Never log secrets, auth headers, full payment data, or raw customer credentials.

Evidence: `store/lib/observability/logger.ts` — single-line JSON
`{ts, level, operation, durationMs?, status?, ...correlation, ...fields}`
with deny-by-key sanitization at every depth (`SENSITIVE_KEY_PATTERN`
covers secret/token/password/authorization/cookie/signature/proof/card/
cvv/credential/apiKey/session/payload/body — the value is dropped, never
truncated-and-emitted), token enforcement on `operation`/`status`
(`^[A-Za-z0-9_.:-]{1,64}$`, else `invalid`), string/array/depth bounds,
cycle detection, and Error → `{name, message}` with **no stacks**. Wired
for real: `checkout.complete` success (`cart.ts`, with duration +
correlation) and failure (closed `failureClass` vocabulary —
`payment_failed`, `transport`, etc. — mapped from the raw backend string,
which is never logged), replacing the old bare
`console.error("Checkout completion failed")`; `cart.shippingOptions`
wrapped in `withLogging` (`shipping.ts`). Tests:
`store/tests/unit/observability/logger.test.ts` (10) plus log-line
assertions inside `store/tests/integration/payment/place-order-failures
.test.ts` (declined → `payment_failed` + no `card_declined`/proof text;
transport → `transport` + no raw `fetch failed`; success → `ok` +
`sourceOrderId=order_9`).

- [x] **Step 3: Add retry/reconciliation visibility.** (2026-09-19)

An operator must be able to see why an order is stuck and what action is safe.

Evidence: `store/lib/observability/triage.ts` — `triageOrder({state,
ageMs?, retryAttempts?})` returns `{category, stuck, why, operatorAction,
safeActions, unsafeActions}`. Five categories: `healthy`, `waiting`,
`stuck_stale`, `stuck_failure`, and `reconciliation_hold` as its own bucket
(matching the plan's "reconciliation queue" view). Anti-contradiction is
structural: `operatorAction` is copied verbatim from Task 13's state
machine, and every `unsafeActions` entry encodes a pinned constraint (no
fresh submission out of the hold, no resubmit while a claim is in flight,
no second purchase for an accepted line, cancellation is local-status-only,
no partially matched purchases). Stale thresholds: 24h for processing
states, 48h ACCEPTED/FULFILLING (same line as Task 14 delayed tracking),
10d SHIPPED, 24h CANCEL_REQUESTED; `retryAttempts >= RETRY_LIMIT (3)` adds
"blind retry is not safe" + escalation; unknown states throw. Runbook
section defines the operator stance per category. Tests:
`store/tests/unit/observability/triage.test.ts` (13 — every state, both
sides of every boundary, pinned unsafe actions, repeated retries).

- [x] **Step 4: Add alert thresholds.** (2026-09-19)

At minimum: provider errors, webhook signature failures, unmatched products, stale orders, repeated retry failures, and database/connectivity errors.

Evidence: `store/lib/observability/alerts.ts` — the six plan types as a
CLOSED vocabulary (`ALERT_TYPE`), default thresholds (`provider_errors: 5`,
`webhook_signature_failures: 1` (any), `unmatched_products: 1`,
`stale_orders: 1`, `repeated_retry_failures: 3`, `db_connectivity_errors:
2`), severity policy (signature failures + db/connectivity = critical —
an auth bypass attempt and a platform-wide stop; the rest = warning),
per-call threshold overrides, `sampleCorrelation` passthrough for the
runbook grep, and `hasCriticalAlert` as the page/notify gate. Unknown types
and junk counts throw — an alert vocabulary that silently accepts junk
teaches operators to ignore it. `docs/ops/incident-runbook.md` maps each
alert to its first response. Tests:
`store/tests/unit/observability/alerts.test.ts` (19 — every type below/at
threshold, severities, overrides, passthrough, junk rejection).

Commands: `cd store; npx vitest run` -> 34 files / 441 tests pass;
`npx vitest run tests/unit/observability` -> 4 files / 51 tests;
`npx tsc --noEmit -p tsconfig.json` -> 193 entries, 0 in
`lib/observability/`, `tests/`, or the wired checkout surfaces (the
remainder is the pre-existing store-app debt).

---

## Task 18: Security hardening

**Files:**
- Create/modify: `lib/security/*`
- Modify: auth/session code
- Modify: webhook handlers
- Create: `tests/security/*`
- Create: `docs/security/threat-model.md`

Security requirements:

- [x] Server-side credential storage only.
- [x] Encrypt or otherwise strongly protect provider credentials at rest when the existing architecture permits it.
- [x] Explicit ownership checks on user-owned shop/channel/order/match records.
- [x] Signed webhook verification.
- [x] Replay protection with event IDs/nonce/idempotency records.
- [x] Rate limiting on public auth, search, contact, tracking, and webhook endpoints as appropriate.
- [x] CSRF protections where cookie-authenticated state-changing requests require them.
- [x] SSRF protection for configurable provider URLs; allow only approved schemes/hosts and deny private-network targets unless explicitly required for local development.
- [x] Open redirects prevented by fixed origin/path allowlists.
- [x] HTML/script injection prevented through framework escaping and safe rich-text handling.
- [x] Input schema validation at API boundaries.
- [x] Security headers configured where compatible with the application.
- [x] Dependency audit in CI.

Create a threat model covering account takeover, credential leakage, webhook spoofing, duplicate purchases, unauthorized order access, SSRF, open redirect, price tampering, inventory race, and malicious supplier response.

- [x] **Threat model.** (2026-09-23)

`docs/security/threat-model.md` — scope/trust-boundary table, seven assets, a
10-row threat summary with a verification pointer per row, per-threat detail for
all ten required threats plus HTML/script injection (the 11th surface), the
Task 18 control inventory, seven ranked residual risks, and a verification map
of command -> expected result.

Recon that drove the work (each item is a gap found by inspection, not an
assumption): zod was a declared-but-unused dependency (zero import sites in
`store/`); there was no rate limiting anywhere in `store/` or `openship/`; the
CJ provider base URL is DB/env-configurable and was fetched unchecked; and three
untrusted values reached the DOM raw (JSON-LD via `JSON.stringify`,
`store.logoIcon` via `dangerouslySetInnerHTML`, `store.logoColor` interpolated
into CSS).

Delivered controls:

- `store/lib/security/` (new, 7 modules): `ssrf.ts` (scheme/host allowlist,
  private/loopback/link-local/CGNAT/reserved denial including the IPv4 special
  forms the URL parser normalizes, dev-only opt-in that is ignored under
  `NODE_ENV=production`), `rate-limit.ts` (4 buckets at delivery — a 5th,
  `analytics`, was added by Task 19 for its `/api` collector — plus bucket
  classification and a bounded in-memory fixed window), `csrf.ts` (Origin/Sec-Fetch-Site gate for
  server-action POSTs), `headers.ts` (nosniff, `X-Frame-Options: DENY`, referrer
  policy, permissions policy, HSTS, cross-domain policy), `markup.ts`
  (`sanitizeSvg`, `safeCssAngle`), `jsonld.ts` (`toJsonLdString`), `schemas.ts`
  (zod record + provider-URL validation).
- `features/storefront/middleware.ts`: `guardRequest()` (CSRF -> 403 with
  `X-CSRF-Rejected`, then rate limit -> 429 with `Retry-After`/`X-RateLimit-*`)
  runs before any routing work; every response leaves through
  `applySecurityHeaders()`; the cart cookie is now explicit (`path=/`,
  `SameSite=Lax`, production `Secure`; `HttpOnly` deliberately not set because
  the legacy `use-cart.tsx` hook reads it and the value is a
  server-re-verified cart proof — documented as a follow-up).
- `integrations/cj-channel/cj.ts`: `assertOutboundUrl` before every fetch, with
  the refusal surfaced as `CjApiError` so no caller changes were needed; mirror
  note added for the OpenShip adapter copy.
- Rendering/boundary wires: `logo/index.tsx` (`sanitizeSvg`/`safeCssAngle`),
  `StructuredProductData.tsx` (`toJsonLdString`), `getStore()`
  (zod-validated; rejection returns `null`, so all four consumers keep their
  `lib/brand` fallbacks).
- `package.json`: `audit:deps` = `npm audit --audit-level=high` (CI hook for
  Task 23).
- `.env.example`: CJ variables and `ALLOW_PRIVATE_PROVIDER_URLS` documented as
  server-only, with the rationale for ignoring the escape hatch in production.

Delegated controls (verified by existing suites, cited rather than re-asserted):
signed webhook verification (`tests/integration/payment/webhook-auth.test.ts`),
replay/idempotency (`payment/webhook-events.test.ts`,
`order-routing/ingestion.test.ts`, `fulfillment/purchase-creation.test.ts`),
order ownership and guest access (`storefront/order-access.test.ts`), redirect
allowlists (`storefront/checkout.test.ts`), price authority (`catalog/*`,
`storefront/checkout.test.ts`), inventory/match checks
(`fulfillment/match-verification.test.ts`), log hygiene
(`observability/correlation.test.ts`).

Commands: `cd store; npx vitest run` -> 41 files / 512 tests pass; `npx vitest
run tests/security` -> 7 files / 68 tests; `npx vitest run tests/unit/cj-channel`
-> 1 file / 29 tests; `npx tsc --noEmit` -> 193 entries, 0 in `lib/security/`,
`tests/security/`, `middleware.ts`, `cj-channel/`, `logo/` or
`StructuredProductData.tsx` (the remainder is the pre-existing store-app debt,
the same 193 recorded at Task 17); `git check-ignore -v store/.env
store/.env.local` -> `store/.gitignore:34:.env*` matches both; `npm audit
--audit-level=high` -> exits non-zero: 64 findings (7 low / 33 moderate /
19 high / 5 critical), direct ones `next` [critical] fixed by `next@16.3.6`
(same major), `nodemailer` [high] by `nodemailer@10.0.10` (major), and
`@keystone-6/core` / `@modelcontextprotocol/sdk` / `lodash` [high] with no direct
fix (transitive) — captured as residual risk 1 instead of a blind
`npm audit fix`. Sandbox note: `npm run audit:deps` is intercepted by this
environment's npm wrapper (`EALLOWSCRIPTS ... --allow-scripts is not allowed in
project-scoped installs`); the identical command run directly works, so the
script itself is correct.

---

## Task 19: SEO, analytics, and conversion measurement

**Files:**
- Create/modify: `lib/seo/*`
- Create/modify: `app/sitemap.ts`
- Create/modify: `app/robots.ts`
- Create: `components/analytics/*`
- Create: `docs/analytics/events.md`

- [x] **Step 1: Add metadata helpers.** (2026-09-23)

Use page-specific title, description, canonical URL, Open Graph, and product metadata.

Evidence: `store/lib/seo/urls.ts` + `store/lib/seo/metadata.ts` +
`store/lib/seo/routes.ts`. `urls.ts` normalizes an origin to a bare `http(s)`
origin (path/query/credentials/protocol dropped — a malformed
`NEXT_PUBLIC_SITE_URL` can never be published), resolves canonical/OG asset URLs
(`data:`, `javascript:` and protocol-relative `//host` values are rejected), and
is pure so it is unit-testable without Next. `metadata.ts` is the single
template: `Title | Northwind Goods` (never doubled), whitespace-collapsed and
bounded title (120) / description (300), canonical + `og:url` **only when
absolute**, ≤4 absolute images, Twitter card chosen from whether images exist,
and an explicit `robots` directive either way. `buildPrivateMetadata()` is the
`noindex` helper for cart/checkout/account/order/tracking pages. Wired for real:
the product page (`buildMetadata` with catalog title/subtitle/images + canonical
`/us/products/{handle}`), collection page, and `noindex` on
`CartPage`/`CheckoutPage`/`OrderConfirmedPage`/`TrackOrderPage`/
`AccountOrderDetailsPage` (the last two also in `generateMetadata`). Tests:
`tests/unit/seo/urls`+`metadata` (metadata file: 17 assertions incl. hostile
origins `javascript:`, `//evil.example`, `ftp:`, credentialed URLs).

- [x] **Step 2: Generate sitemap from indexable catalog routes.** (2026-09-23)

Exclude account, cart, checkout, admin, and internal routes.

Evidence: `store/app/sitemap.ts` + `store/app/robots.ts`, both reading the same
indexability rule in `lib/seo/routes.ts` (`NON_INDEXABLE_PREFIXES` = `/account`,
`/cart`, `/checkout`, `/order`, `/track`, `/api`; case-insensitive and
country-prefix agnostic, prefix-aware so `/cartography` is not swallowed).
`lib/seo/sitemap.ts` is the pure builder: localized static routes + real policies
(`availablePolicySlugs`) + product/collection handles, each handle validated by
`isSafeHandle` **and** each resulting path re-checked by `isIndexablePath`
(a handle of `../account/orders` is dropped and *reported* in `excluded` rather
than advertised), deduped, capped at 5000 URLs. The catalog is read through a new
bounded handle-only query (`listIndexableCatalog`, published products only,
`tests/unit/catalog/catalog-index.test.ts`), and a catalog outage degrades the
sitemap to its static/policy entries with a logged warning instead of a 500.
`lib/seo/robots.ts` disallows exactly the private prefixes (no `/_next/`
disallow: crawlers need assets to render) and emits `sitemap`/`host` only from a
validated absolute origin. A test asserts the two can never disagree: nothing the
sitemap lists is disallowed by robots. Tests: `tests/unit/seo/{routes,sitemap,robots}`.

- [x] **Step 3: Add privacy-aware analytics.** (2026-09-23)

Track only events necessary to improve the business.

Recommended events:

```text
view_product
view_collection
select_variant
add_to_cart
view_cart
begin_checkout
checkout_success
purchase
view_order
view_tracking
```

Evidence: `store/lib/analytics/{events,client,collect,funnel}.ts`,
`store/components/analytics/TrackEvent.tsx`,
`store/app/api/analytics/collect/route.ts`, `docs/analytics/events.md`. All ten
recommended events exist as a **closed** union; nothing else can be sent.
Privacy is enforced structurally, not by convention: a per-event zod allowlist
strips unknown keys, one out-of-bounds prop drops the whole event, the
attributed path has its query/fragment removed (that is where emails leak in),
and no allowlisted prop name can match the PII pattern (a test asserts it, so a
future allowlist edit cannot quietly add `email`). Consent is honoured: off
unless `NEXT_PUBLIC_ANALYTICS_ENABLED="true"`, and `navigator.doNotTrack` /
`globalPrivacyControl` are re-read per event. Transport is first-party —
`sendBeacon` (survives the navigation right after an add-to-cart) with
`fetch(keepalive, credentials: "omit")` as fallback, to our own
`/api/analytics/collect`; every failure path returns `false` instead of throwing
mid-purchase. The collector is the storefront's only `/api` route, so — because
`proxy.ts` excludes `/api` from the middleware guard — it applies its own
`analytics` rate-limit bucket (120/min/IP, 429 + `Retry-After`), reads at most
4 KB of body while streaming (so a lying `Content-Length` cannot make it buffer
unbounded input), and returns empty `204/400/413/429` responses that never echo
a rejected payload. Emitters are wired to real UI: product page, collection
page, `VariantSelector` (`select_variant` only on a real user action),
`AddToCartForm` (`add_to_cart` only *after* the cart call succeeds, with the
variant's minor-unit price), cart, checkout, the confirmation page
(`checkout_success` + `purchase` via `toMinorUnits` on the real order total),
account order detail and the guest tracking page. The order id, email, address
and card data are deliberately never sent. Tests:
`tests/unit/analytics/{events,client,collect}.test.ts` (incl. a spoofed payload
carrying email/phone/name/address/card — stripped, and asserted absent from the
log line), `tests/unit/storefront/money-minor-units.test.ts`.

- [x] **Step 4: Add funnel metrics.** (2026-09-23)

Measure product-view → add-to-cart → checkout → purchase conversion without storing unnecessary personal information.

Evidence: `store/lib/analytics/funnel.ts` — per-UTC-day counters for the four
stages (`view_product` → `add_to_cart` → `begin_checkout` → `purchase`) plus
`purchaseValueMinor` (integer minor units, `purchase` events only — a cart value
is not revenue) and the observed currency codes. Step and cumulative conversion
are `null` when the denominator is 0 rather than a fabricated 0%. Retention is
30 days (oldest day evicted first) and the aggregate is **in-memory only**: no
visitor id, session id, IP, user agent, order reference or free text is stored —
the snapshot's own key set is asserted by tests, so adding an identifier later
fails them. Honest limits are documented in `docs/analytics/events.md`: counts
are per process/isolate and reset on deploy (same caveat as the Task 18 rate
limiter), a confirmation-page refresh counts `purchase` twice, blocked beacons
mean under-counting, and Openfront's order rows remain the authoritative
purchase count. Tests: `tests/unit/analytics/funnel.test.ts` (stage counts,
rates incl. the zero-denominator case, value/currency handling, retention,
"stores no identifier of any kind").

Commands: `cd store; npx vitest run` -> 51 files / 624 tests pass; `npx vitest
run tests/unit/seo tests/unit/analytics tests/unit/storefront/money-minor-units.test.ts`
-> 9 files / 105 tests; `npx vitest run tests/unit/catalog` -> 2 files / 20 tests
(incl. the new sitemap index query); `npx tsc --noEmit` -> 193 entries, 0 in
`lib/seo/`, `lib/analytics/`, `components/analytics/`, `app/sitemap.ts`,
`app/robots.ts`, `app/api/analytics/collect/route.ts` or any page wired above
(the remainder is the unchanged pre-existing store-app debt recorded at Tasks
17/18). Docs: `docs/analytics/events.md` (event table, prop rules, wire format,
status codes, funnel definition + precision caveats, what is never collected,
curl verification), `.env.example` (`NEXT_PUBLIC_SITE_URL`,
`NEXT_PUBLIC_ANALYTICS_ENABLED` — off by default), `docs/security/threat-model.md`
(why the one `/api` path is compensating rather than unguarded).

---

## Task 20: Performance and accessibility hardening

**Files:**
- Modify: image handling/configuration
- Modify: components responsible for client-heavy interactions
- Create: `tests/e2e/accessibility.spec.*`
- Create: `docs/performance/budget.md`

- [x] **Step 1: Audit client components.** (2026-09-25)

Eliminated dead legacy tree `store/features/storefront/modules/home/` (`dots-shader` and legacy hero). Verified zero active client routes import heavy WebGL or `framer-motion` libraries; state islands are restricted to interactive leaves.

- [x] **Step 2: Optimize product images.** (2026-09-25)

Centralized catalog image handling in `components/media/ProductImage.tsx` backed by strict allowlist resolution in `lib/media/images.ts`. Allowlisted hosts (`NEXT_PUBLIC_IMAGE_HOSTS`, `S3_ENDPOINT`, `NEXT_PUBLIC_BACKEND_URL`) route through Next.js image optimization with responsive `sizes` and aspect-ratio preservation; un-allowlisted supplier hosts gracefully degrade to native `<img>` rather than broken 400s. Standardized across `FeaturedCollection`, `ProductGallery`, `Thumbnail`, and `FulfillmentCard`. Added comprehensive unit test coverage in `tests/unit/media/images.test.ts` (22 tests).

- [x] **Step 3: Respect reduced motion.** (2026-09-25)

Validated system-wide `prefers-reduced-motion` compliance: `MotionPreference` provider synchronizes preferences, and `globals.css` declares `prefers-reduced-motion: reduce` token overrides disabling unnecessary transitions and animations.

- [x] **Step 4: Run accessibility checks.** (2026-09-25)

Fixed root landmark nesting by removing redundant `<main>` from `store/app/layout.tsx` so route layouts own their landmark structure (`<main id="main-content">` paired with the skip link). Added explicit `aria-label` attributes to icon-only buttons (`DeleteButton`, `SideMenu` hamburger trigger) and accessible keyboard controls (`role="button"`, `tabIndex={0}`, `aria-expanded`, `aria-label`, `onKeyDown`) to shipment accordions in `FulfillmentCard`. Defaulted `Thumbnail` `alt` prop to `""` for decorative images.

- [x] **Step 5: Set performance budgets.** (2026-09-25)

Created `docs/performance/budget.md` documenting Core Web Vitals targets (LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1), JavaScript bundle size ceilings (initial shared client JS ≤ 125 KB, current baseline ~102 KB), image optimization rules, and accessibility verification practices.

---

## Task 21: Legal/policy surface

**Files:**
- Create: `app/(store)/privacy/page.*`, `app/(store)/terms/page.*`,
  `app/(store)/shipping/page.*`, `app/(store)/returns/page.*`,
  `app/(store)/contact/page.*`
  → **implemented at** `app/(storefront)/[countryCode]/(main)/policies/{page,[slug]/page}.tsx`,
  which is the policy route this repo already had from Task 15. One page renders
  every policy from `lib/brand/policies.ts` instead of five near-identical files,
  so the four policies cannot drift apart in layout or metadata.
- Create: `docs/legal/content-source.md` (+ mirror at `store/docs/legal/`)
- Modify: `store/lib/brand/policies.ts`, `store/lib/brand/site.ts`,
  footer/trust/cart/checkout/order/register surfaces, `tests/unit/brand/policies.test.ts`,
  `tests/unit/seo/*`, `logs-verify-home.mjs`, `docs/analytics/events.md`

- [x] **Step 1: Add policy pages.** (2026-09-25)

Use the actual business entity, customer-support contact, delivery expectations, return conditions, and payment behavior.

Evidence: `store/lib/brand/policies.ts` now publishes four policies — shipping,
returns (Task 15, kept) plus **privacy** and **terms** — and
`docs/legal/content-source.md` records the source of every published claim
(cookie max-ages from `lib/data/cookies.ts`, the no-PII analytics allowlist and
DNT/GPC handling from `lib/analytics/client.ts`, "a declined payment leaves no
order behind" from the settle-before-create sequence in `docs/ops/payments.md`,
the address/returns/refund rules from `docs/ops/*`), plus the two dead links this
task fixed. **Nothing unverifiable was invented**: the registered entity name,
postal address and governing jurisdiction are listed in that doc as operator
inputs, and the Terms carry no jurisdiction claim at all (pinned by a test)
rather than a fabricated state or a `[placeholder]` a customer could read. The
Terms name the seller from `site.name`, the same source as the copyright line.
`/policies` stopped being a redirect and is now a real index of every policy.

- [x] **Step 2: Add consistent policy links.** (2026-09-25)

Footer, cart, checkout, order/tracking, and support surfaces should expose relevant policies.

Evidence: every link is driven by `site.trust.items` (`available` flag) so no
surface can advertise a policy route that 404s — a test now fails if the flag and
`lib/brand/policies.ts` disagree. Surfaces: footer + home `TrustSection` (all
four), `/policies` index and each policy page ("see also" links the other three,
plus a support link), **cart** (`cart/templates/index.tsx` — shipping/returns
summary read from `site.trust.items`, so the cart cannot quote a different return
window than the Returns page), **checkout review** (consent sentence now links
Terms, Returns and Privacy instead of naming unreachable documents),
**order/tracking help** (`order/components/help/index.tsx`), account
**registration** (Privacy/Terms consent), and the sitemap
(`app/sitemap.ts` via `availablePolicySlugs`). Three dead links were found and
fixed while wiring this: `/content/privacy-policy` and `/content/terms-of-use`
(registration) and `/contact` (order help, twice). The home support card was also
linking to `/usmailto:support@example.com` because `LocalizedClientLink` prefixes
the country code unconditionally — `mailto:` is now a plain `<a>` there and in the
order help component.

- [x] **Step 3: Add consent requirements only where legally/business necessary.** (2026-09-25)

Do not add invasive cookie banners or tracking solely because a template contains them.

Evidence: **no cookie banner and no consent-management script were added**, with
the reasoning recorded in `docs/legal/content-source.md` §Step 3. Every cookie the
store sets is strictly necessary (cart proof, sign-in session — neither used for
advertising, profiling or cross-site tracking), so the Privacy policy discloses
them instead of asking consent for them; analytics is off unless
`NEXT_PUBLIC_ANALYTICS_ENABLED="true"` and is refused per event when the browser
sends DNT/GPC, so there is nothing to consent to. The doc also states the
condition that would force a revisit: any future advertising or third-party
measurement must be handled in the same change, not by adding a banner "just in
case".

Verification: `npx vitest run` → 52 files / 660 tests pass (incl. 24 in
`tests/unit/brand/policies.test.ts` and the new sitemap coverage of all four
policies); `npx tsc --noEmit` → 193 pre-existing entries, **0** in any file this
task touched; `npm run build` → `/us/policies` and `/us/policies/[slug]` compile
alongside the unchanged 20 routes. `logs-verify-home.mjs` was updated to require
all four policy links and to catch a country-prefixed `mailto:`.


---

## Task 22: Seed a production-shaped catalog

**Files:**
- Create: `scripts/seed-catalog.*`
- Create: `docs/catalog/product-model.md`
- Create or import: approved product media in `public/` or the configured media store

Also created: `store/scripts/catalog/{products,fulfillment,media,art,png,validate}.ts`,
`store/scripts/generate-catalog-media.ts`, `docs/catalog/media-sources.md`,
`store/public/images/catalog/*.png`, and
`store/tests/unit/catalog/{catalog-validation,catalog-art}.test.ts`.

- [x] **Step 1: Choose 10–30 products in one niche.** (2026-09-25)

Every product must have: title, short value proposition, description, variants, SKU, pricing, shipping constraints, returns eligibility, and appropriate media.

Evidence: **12 products, one niche** (kitchen and table objects in stoneware, oak
and washed linen) in `store/scripts/catalog/products.ts` — 4 crock/mug/bowl/
pitcher, 4 oak board/cutting board/salt cellar/trivet, 4 linen apron/tea towels/
runner/napkins — across 4 collections (`kitchen-table`, `stoneware`, `oak`,
`linen`). Each product carries a title, a one-clause subtitle, three paragraphs
of copy, variants with unique `NWG-` SKUs, integer minor-unit prices,
`ShippingConstraints`, `ReturnsEligibility` and two planned images; the
validator fails on any of these being missing (`products:*` codes) and enforces
the 10–30 ceiling. **Parcel facts that need a real item are recorded as
`unverified(reason)`, never approximated** — weight, dimensions, ship-from and
handling time for all 12 products (48 facts) are explicitly unknown, because no
sourced item exists to measure and a plausible number would be an invented
parcel fact. Returns mirror the published Returns policy (window 30 days, pinned
by a test and by `validate`'s `returns:policy-pin` against the policy text
itself, so the catalog cannot promise a different window than the page a
customer is linked to).

- [x] **Step 2: Create original merchandising copy.** (2026-09-25)

Do not paste supplier descriptions directly into customer pages.

Evidence: every title, subtitle and paragraph was written for this store as a
**sourcing specification** — the operator must source an item that matches it
and change the copy if the sourced item differs. Nothing was pasted from a
supplier listing, and no claim is made that we have not decided to stand behind:
no certifications, no provenance, no country-of-origin, and **no "was" price**
(there is no prior price to discount from, so a struck-through price would be
false). The document header of `products.ts` states this rule so future edits
inherit it.

- [x] **Step 3: Normalize variants.** (2026-09-25)

Every sellable variant must map 1:1 to a fulfillment SKU or have an explicit manual-fulfillment rule.

Evidence: all **21 variants** have a record in
`store/scripts/catalog/fulfillment.ts`, built *from* the assortment so a new
variant raises a validation failure rather than silently becoming unfillable
(`fulfillment:coverage`). No supplier account exists, so rather than invent
supplier SKUs that look real, every variant gets an explicit manual rule —
`MANUAL_FULFILLMENT_RULE` plus a buy-note naming the exact item
("Buy: Stoneware Mug, 250 ml (NWG-MUG-250). Do not substitute another size or
material…") — and `SUPPLIER_MAPPINGS` is the empty seam the operator fills with
real mappings (supplier, supplier SKU, ISO verification date, evidence). The
record is written into `ProductVariant.metadata.fulfillment`, so the answer
travels with the row, and a mapping that matches no sellable SKU is a hard error
(`fulfillment:orphan-mapping`) rather than a misfiled instruction.


- [x] **Step 4: Validate images.** (2026-09-25)

Check dimensions, alt text, file size, and licensing/source record.

Evidence: the repository holds **no licensed product photography**, so shipping a
supplier or stock photograph would have unverifiable provenance. Each of the 12
products instead has two images — a front view and a detail zoom of the *same*
motif, so the second gallery image never invents a view of an item nobody has
photographed — rendered from scene data in `store/scripts/catalog/art.ts` by
`npm run media:catalog` and written to `store/public/images/catalog/*.png`
(24 files, 1000×1000, 237.6 KB total). All four Step 4 checks run against the
bytes on disk, not the manifest: **dimensions** read from the PNG's IHDR,
**file size** against a 120 KB budget, **alt text** present and — while the image
is a stand-in — required to begin `"Illustration:"` so art is never described as
a photograph of the item, and a **licensing/source record** (`ARTWORK_SOURCE`,
`ARTWORK_LICENCE`) that is true because there is no third-party asset to license.
Rendering is deterministic, so `--strict` can also prove each file is
byte-identical to a fresh render, which is what makes the sha256 stored in
`ProductImage.metadata` meaningful. The record and the replacement procedure
live in `docs/catalog/media-sources.md`; every file is `placeholder: true` with
its reason stored alongside it. The images are served from this deployment's own
origin, so `ProductImage.image_id` is left null on purpose (setting it would
advertise a storage URL for a file that does not exist in backend storage) and
`lib/openfront/catalog.ts` falls back to `imagePath` exactly like the backend's
own `thumbnail` virtual field.

- [x] **Step 5: Seed safely.** (2026-09-25)

The seed script must be idempotent and must never reset/delete production data.

Evidence: `store/scripts/seed-catalog.ts` writes only `nwg_`-prefixed rows with
deterministic ids, upserting every one of them, so it converges instead of
duplicating and coexists with the `devfix_` fixture untouched; `--purge` deletes
children before parents **within `nwg_*` only**, and never deletes the shared
currency/region/country/store reference rows other seeders and the app may
already point at. Two consecutive `npm run seed:catalog` runs reported the same
`12 products, 21 variants, 21 prices, 4 collections, 24 images` with 0 pruned.
The catalog is validated **before** anything is written, and every media file is
read before the database connection opens, so `image_filesize` and the recorded
sha256 always describe bytes that exist; a missing file aborts with
"run `npm run media:catalog` first". The data itself is honest about what is not
known: each `Product.metadata` carries the shipping/returns record including
`{known: false, reason}` for every unmeasured parcel fact, and each variant
carries its fulfillment record.

Verification: `npx vitest run` → 54 files / 686 tests pass (incl. 24 new in
`tests/unit/catalog/catalog-validation.test.ts` and `catalog-art.test.ts`);
`npx tsc --noEmit` → 193 pre-existing entries, **0** in any file this task
touched; `npm run build` → compiled successfully. Live against the local
Postgres: `npm run validate:catalog` → passes with 69 warnings (48 unverified
facts + 21 pending sourcing); `npm run seed:catalog` → 12/21/21/4/24; seed
re-run identical. **`npm run validate:catalog -- --strict` fails on purpose**
(exit 1, "69 error(s)") with **0 media errors** — the promotion gate refuses to
call the catalog launch-ready while parcel facts are unmeasured and sourcing is
pending, which is the honest state until a supplier account and real
measurements exist. `npm run seed:catalog -- --strict` therefore writes nothing.


---

## Task 23: GitHub Actions CI/CD

**Files:**
- Create/modify: `.github/workflows/ci.yml`
- Create/modify: `.github/workflows/deploy.yml`
- Modify: package scripts

Required pipeline:

```text
install
  ↓
lint/typecheck
  ↓
unit tests
  ↓
integration tests with synthetic provider
  ↓
production build
  ↓
e2e smoke tests
  ↓
security/dependency checks
  ↓
deploy
```

- [x] **Step 1: Run CI on pull requests.** (2026-09-26)

Evidence: `.github/workflows/ci.yml` implements the plan's exact linear pipeline:
`install` → `lint/typecheck` (baseline-gated via `scripts/quality-gate.ts`, fails
on any new problem beyond the recorded 469 lint / 193 type debt) → `unit tests`
(`vitest run tests/unit`) → `integration tests with synthetic provider` (`vitest
run tests/integration tests/security`, hermetic with no live network/db) →
`production build` (`npm run build` with CI placeholder env) → `e2e smoke tests`
(`playwright test` with headless Chromium running against local production
server, asserting route availability and security headers) →
`security/dependency checks` (asserts no tracked `.env*` files in repository
history and executes `npm run audit:deps`). Unit and integration test suites are
hermetic, producing JUnit XML output.

- [x] **Step 2: Run deployment only from the protected branch/tag strategy used by the project.** (2026-09-26)

Evidence: `.github/workflows/deploy.yml` triggers only via `workflow_run`
following a successful CI completion on `master`, on `push` of `v*` release
tags, or through manual `workflow_dispatch` restricted to `master` or release
tags. The workflow binds to the `production` GitHub environment where mandatory
reviewers and deployment gates reside. Step execution strictly enforces green CI
preflight before deployment tasks can execute.

- [x] **Step 3: Keep production secrets out of repository files.** (2026-09-26)

Evidence: Verified with `git ls-files` that no `.env*` files are tracked in the
repository (only sanitized documentation templates in `env-templates/` and
`store/.env.example`). The `security` CI job runs a git history check on every
commit to fail immediately if any `.env` file is accidentally committed. Build
and smoke test stages execute entirely with dummy placeholder secrets
(`ci-session-secret-*`, localhost URLs).

- [x] **Step 4: Upload only sanitized test artifacts/logs.** (2026-09-26)

Evidence: `.github/workflows/ARTIFACTS.md` specifies artifact boundaries.
Artifacts are uploaded exclusively on test failures (`if: failure()`) with a
3-day retention limit. Only sanitized JUnit XML reports from Vitest and
Playwright's static HTML report are uploaded. Process environments, `.env*`
files, network responses, and build dumps are explicitly excluded.

- [x] **Step 5: Add rollback documentation.** (2026-09-26)

Evidence: `docs/ops/rollback.md` establishes a 5-step incident recovery order:
freeze writes at edge, redeploy previous verified green commit, database schema
preservation vs restore rules (handling forward-only Prisma migrations),
mandatory synthetic order verification before reopening traffic, and post-recovery
reconciliation tracking.

Verification: Local gate validation succeeded with zero regressions:
- `npm run quality:baseline` and `npm run lint:ci` passed (469 baselined).
- `npm run typecheck:ci` passed (193 baselined).
- `npx vitest run tests/unit` passed (44 files, 591 tests).
- `npx vitest run tests/integration tests/security` passed (11 files, 104 tests).
- `npx playwright test --list` passed (8 tests indexed).
- Repository secret check confirmed 0 tracked `.env*` files.

---

## Task 24: Production deployment

**Files:**
- Modify: deployment configuration appropriate to the chosen host
- Create: `docs/ops/deployment.md`
- Create: `docs/ops/rollback.md`

The deployment can be self-hosted or use a free/low-cost platform where the terms permit commercial use. Do not assume a free tier is suitable for a commercial store without checking its current terms.

- [x] **Step 1: Deploy PostgreSQL.** (2026-09-27)

Evidence: PostgreSQL 16 provisioned via `docker-compose.prod.yml` (`yoo-prod-postgres-1` on internal `data` network). Bounded connection limits per app (`connection_limit=10`) configured in `DATABASE_URL` strings to guarantee aggregate headroom under PostgreSQL's 100-connection limit without requiring external poolers. Automated `postgres-backup` sidecar container executes custom-format `pg_dump` upon boot and every 24h into host-mounted `backups/`, with automated 7-day retention pruning. Verified live: initial schema backups created (`openfront_*.dump` [304KB], `openship_*.dump` [53KB]) and successfully validated via `pg_restore -l` (761 table/object TOC entries confirmed).

- [x] **Step 2: Deploy Openfront.** (2026-09-27)

Evidence: Provisioned via `docker/Dockerfile.openfront` and `docker-compose.prod.yml` as `yoo-openfront:latest` container on internal `edge` and `data` networks. Mirrors upstream `railway.toml` build and startup contract: headless Keystone build and Next.js production build (`keystone build --no-ui && next build`) executed without database dependencies, followed by automated migration and startup command (`npm run migrate && npm start`). Installed `openssl` runtime libraries to eliminate Prisma TLS driver warnings. Verified healthy on `127.0.0.1:3001` with zero runtime crashes.

- [x] **Step 3: Deploy OpenShip.** (2026-09-27)

Evidence: Provisioned via `docker/Dockerfile.openship` and `docker-compose.prod.yml` as `yoo-openship:latest` on `edge` and `data` networks. Build workflow decoupled from migrations so image compilation is hermetic; container start applies `npm run migrate && npm start`. Bundles project channels (`features/integrations/channel/synthetic.ts` and `cj.ts`). Isolated from public edge proxy: access restricted to `127.0.0.1:3002` for SSH-tunneled operator access. Verified healthy with GraphQL responding.

- [x] **Step 4: Deploy the custom storefront.** (2026-09-27)

Evidence: Provisioned via `docker/Dockerfile.store` and `docker-compose.prod.yml` as `yoo-store:latest` on `edge` and `data` networks. Image compilation executes full CI-parity build (`npm run build` triggering openfront prisma client generation and `next build`). Configured with runtime `SESSION_SECRET` and build-time `NEXT_PUBLIC_*` arguments. Verified container status healthy on `127.0.0.1:3000` with 307 root-to-locale redirection and static policy routes responding.

- [x] **Step 5: Configure domains and HTTPS.** (2026-09-27)

Evidence: Configured reverse proxy edge in `docker/Caddyfile` with an explicit `--profile edge` service in `docker-compose.prod.yml`. Manages automatic ACME TLS certificate lifecycle, HTTP/3, and forced HTTP-to-HTTPS redirection for `$STORE_DOMAIN` (routing to `store:3000`) and `$API_DOMAIN` (routing to `openfront:3001`). OpenShip dashboard and database ports are deliberately unexposed to external traffic.

- [x] **Step 6: Configure environment variables.** (2026-09-27)

Evidence: Documented and templated in `.env.example` with strict variable validation (`:?` enforcement in Compose). Cryptographic isolation enforced: separate 64-character hex keys for `SESSION_SECRET` (shared strictly between Storefront and Openfront for cart-proof validation), `OPENSHIP_SESSION_SECRET`, and `OAUTH_STATE_SECRET`. Verified with `git ls-files` that zero `.env*` secret files are tracked in version control, and `.dockerignore` excludes untracked `.env` files from Docker build contexts.

- [x] **Step 7: Run database migrations using the repository-supported mechanism.** (2026-09-27)

Evidence: Container startup scripts execute `npm run migrate` (`prisma migrate deploy`) against both Openfront (`openfront/schema.prisma`) and OpenShip (`openship/schema.prisma`). Verified live: Openfront applied 25 forward-only migrations resulting in 115 tables; OpenShip applied all migrations creating 19 tables. One-shot and automatic recovery mechanisms documented in `docs/ops/deployment.md`.

- [x] **Step 8: Verify health checks.** (2026-09-27)

Evidence: Both in-container Compose healthchecks and external non-credentialed probes via `scripts/healthcheck.mjs` execute GraphQL queries (`{ __typename }`). Local verification succeeded:
- Openfront GraphQL responding at `http://localhost:3001/api/graphql` (78ms).
- OpenShip GraphQL responding at `http://localhost:3002/api/graphql` (13ms).
- Storefront responding 200/307 at `http://localhost:3000/`.
- All Compose services reported `healthy`.

- [x] **Step 9: Run the synthetic end-to-end order before real credentials.** (2026-09-27)

Evidence: Executed against the running production Docker Compose stack (`yoo-prod`) with devfix catalog seeded:
1. `scripts/verify-pdp-e2e.mjs`: PASSED (14/14 checks). Validated PDP 200 response, absolute JSON-LD schema, live catalog rendering ($18.00 Stoneware Mug), cart creation, signed cart-proof acceptance, unsigned cart write rejection, line item persistence, and cart page render.
2. `scripts/verify-checkout-e2e.mjs`: PASSED (12/12 checks). Validated checkout container render, 404 on unauthenticated/anonymous access, unsigned checkout completion rejection, rejection of guest orders without payment session, rejection of invalid payment sessions, and cart line-item preservation under retry attempts.

- [ ] **Step 10: Connect production credentials and repeat the full flow with a low-risk test order.**

Production credentials (CJ Dropshipping API and live Stripe/PayPal keys) remain intentionally disconnected per plan policy until live cutover on production hosting. Execution runbook and verification sequence are documented in `docs/ops/deployment.md` §Step 10 and `docs/ops/incident-runbook.md`.


---

# 6. Exact End-to-End Acceptance Test

Run this scenario before declaring the system production-ready.

## Customer path

```text
Landing page
→ Collection
→ Product
→ Select variant
→ Add to cart
→ Update quantity
→ Checkout
→ Payment/test payment
→ Order confirmation
→ Order page
```

Assertions:

- Product and variant are correct.
- Price shown before checkout matches backend checkout state.
- Quantity is correct.
- Only one order is created.
- Order is linked to the correct customer/session.

## Fulfillment path

```text
Openfront order
→ OpenShip source order
→ exact match
→ supplier purchase
→ accepted purchase ID
→ tracking
→ shipped
→ delivered/test terminal state
```

Assertions:

- Source order ID remains stable across systems.
- Exact SKU/variant mapping is used.
- Duplicate processing does not create duplicate supplier orders.
- Provider failure enters an explicit recoverable state.
- Tracking callback is authenticated.
- Duplicate callback is ignored safely.
- Customer sees only sanitized tracking data.

## Failure scenarios

The acceptance suite must also exercise:

1. Unknown supplier SKU.
2. Product not matched.
3. Supplier timeout before response.
4. Supplier timeout after acceptance but before local persistence.
5. Duplicate purchase request.
6. Duplicate webhook.
7. Invalid webhook signature.
8. Wrong customer requesting another order.
9. Stale price/cart before checkout.
10. Provider rejects cancellation.
11. Tracking delayed.
12. Database temporarily unavailable.

Every failure must result in either:

- an explicit safe terminal state, or
- an explicit retry/reconciliation state with an operator-visible reason.

---

# 7. Test Strategy

## Unit tests

Cover pure functions and adapters:

- variant matching,
- price formatting,
- status mapping,
- idempotency-key generation,
- input validation,
- webhook signature verification,
- redirect validation,
- customer-safe projections.

## Integration tests

Use a synthetic OpenShip channel and, where practical, a local/test Openfront instance.

Never use real supplier credentials in CI.

## E2E tests

Use Playwright or the project's established browser test framework.

Required journeys:

```text
home → collection → product → cart
cart → checkout
checkout → order
order → tracking
```

## Security tests

Automate at least:

- unauthorized order access,
- webhook replay,
- invalid webhook signature,
- open redirect attempts,
- SSRF/private-network provider URL attempts,
- duplicate purchase request,
- malformed provider response.

---

# 8. Data and State Rules

## Variant identity

Never identify a sellable item only by title.

Use:

```text
Openfront product ID
Openfront variant ID
Storefront SKU
Supplier/channel item ID
Supplier SKU
```

with deterministic mapping.

## Idempotency

Every state-changing boundary must answer:

- What is the unique operation key?
- Where is it persisted?
- What happens if the request is repeated?
- What happens if the provider accepted the operation but the response was lost?
- How does reconciliation recover?

## State transitions

No code may jump directly from `pending` to `delivered` without an authoritative source proving the transition.

---

# 9. AI Agent Operating Rules

The coding agent implementing this file must obey the following workflow:

1. Read the existing code before writing new code.
2. Locate the exact interface in the checked-out revision before calling it.
3. Prefer existing project utilities and patterns.
4. Write a failing test before behavior changes when practical.
5. Implement the smallest change that satisfies the test.
6. Run focused tests after each change.
7. Run the full relevant suite before each task commit.
8. Keep commits small and scoped.
9. Never silently change data models without documenting the migration.
10. Never silently replace a provider/API contract with an assumed one.
11. Stop a provider integration if the actual capability cannot be proven.
12. Use synthetic fixtures for unverified external behavior.
13. Keep customer UI separate from operator/admin UI.
14. Keep provider credentials outside client code.
15. Verify every final claim with command output or test evidence.

When the agent discovers that the repository differs from assumptions in this plan:

```text
STOP
→ document the mismatch
→ locate the current contract
→ update the affected task in this plan
→ implement against the actual revision
```

Do not patch around an unknown interface by guessing.

---

# 10. Launch Checklist

## Application

- [ ] Storefront builds in production mode.
- [ ] Openfront is healthy.
- [ ] OpenShip is healthy.
- [ ] PostgreSQL backups are configured.
- [ ] Domain + HTTPS are active.

## Commerce

- [ ] Catalog is populated.
- [ ] Every sellable variant has a fulfillment mapping.
- [ ] Prices and inventory are correct.
- [ ] Cart works.
- [ ] Checkout works.
- [ ] Payment confirmation is provider-authoritative.

## Fulfillment

- [ ] Shop configured.
- [ ] Channel configured.
- [ ] Link configured.
- [ ] Matches configured.
- [ ] Synthetic flow passes.
- [ ] Real provider test order passes.
- [ ] Idempotency passes.
- [ ] Webhook verification passes.
- [ ] Reconciliation procedure is documented.

## Customer experience

- [ ] Product pages are persuasive without deceptive claims.
- [ ] Shipping/returns are clear.
- [ ] Order confirmation is clear.
- [ ] Tracking works.
- [ ] Mobile experience is polished.
- [ ] Accessibility checks pass.
- [ ] SEO metadata is present.

## Security

- [ ] No secrets in Git.
- [ ] No private credentials in client code.
- [ ] Webhooks signed and replay-protected.
- [ ] Customer order authorization tested.
- [ ] Rate limits configured where required.
- [ ] Redirect/SSRF protections tested.

## Operations

- [ ] Error logs are actionable and sanitized.
- [ ] Failed orders are visible.
- [ ] Reconciliation is possible.
- [ ] Rollback procedure tested.
- [ ] Support contact works.

---

# 11. Recommended Implementation Order

Execute in this exact dependency order:

```text
1. Reconnaissance
2. Local environment
3. Design system
4. Openfront catalog client
5. Home
6. Collection/product pages
7. Cart
8. Customer/account/order lookup
9. Checkout
10. OpenShip shop/channel/link/match setup
11. Synthetic fulfillment channel
12. End-to-end routing
13. Real supplier adapter
14. Tracking
15. Shipping/returns
16. Payment hardening
17. Observability
18. Security
19. SEO/analytics
20. Performance/accessibility
21. Policies
22. Catalog seed
23. CI/CD
24. Production deployment
25. Final acceptance suite
```

Do not skip directly from storefront work to production supplier credentials.

---

# 12. Definition of Done

The agent may declare the project complete only when:

```text
CUSTOM STOREFRONT
        ↓
OPENFRONT COMMERCE
        ↓
AUTHENTICATED ORDER
        ↓
OPENSHIP ROUTING
        ↓
EXACT SKU MATCH
        ↓
IDEMPOTENT SUPPLIER PURCHASE
        ↓
AUTHORITATIVE TRACKING
        ↓
CUSTOMER ORDER STATUS
```

works in a reproducible test environment and the same sequence has been validated safely with the chosen production provider.

A successful build is **not** "the pages look good". It is a complete chain from customer purchase to verified fulfillment with recoverable failure states.

---

# 13. Reference Notes

Use the current checked-out documentation/source as the authority for exact provider contracts. The following architectural points are intentionally reflected in this plan:

- OpenShip describes itself as an order router connecting sales locations to fulfillment destinations through shops, channels, links, and product matches.
- OpenShip's current documentation says it is an operator workspace rather than a storefront/payment platform.
- OpenShip documents Shopify and Openfront adapters in the current source and warns that configured providers/endpoints are not by themselves proof of external purchase, webhooks, retries, cancellation, or tracking.
- Openfront is the headless ecommerce layer in the ecosystem; Openfront Storefront is a standalone Next.js client intended to connect to an Openfront backend.
- Shipping integrations in Openfront are adapter-based and should expose only provider-neutral operations required by the domain.

Before implementing any provider-specific integration, re-check the exact current source revision and tests because these projects evolve.


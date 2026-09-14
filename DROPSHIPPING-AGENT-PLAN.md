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

- [ ] **Step 1: Configure the Openfront shop source.**

Use scoped credentials and owner checks as supported by the current OpenShip revision.

- [ ] **Step 2: Configure the fulfillment channel.**

Use a real provider adapter only after its contract is verified; otherwise start with a synthetic/local channel.

- [ ] **Step 3: Create the shop-channel link.**

Prevent duplicate links unless the OpenShip contract explicitly supports multiple routing destinations with deterministic priority.

- [ ] **Step 4: Create exact product matches.**

Match at variant level, not merely by title. Store a deterministic mapping from storefront SKU/variant to supplier SKU/variant.

- [ ] **Step 5: Write operator setup documentation.**

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

- [ ] **Step 1: Implement deterministic synthetic behavior.**

The fixture should accept known SKUs, reject unknown SKUs, expose deterministic purchase IDs, and emit deterministic tracking numbers after an explicit state transition.

- [ ] **Step 2: Implement idempotency tests.**

Submitting the same external order twice must not create two purchases.

- [ ] **Step 3: Implement failure tests.**

Cover timeout, malformed response, provider rejection, duplicate callback, and cancellation after fulfillment.

- [ ] **Step 4: Integrate into OpenShip through the supported adapter boundary.**

Do not hard-code the provider into generic routing logic.

---

## Task 12: Implement production supplier adapter

**Files:**
- Create: `integrations/<supplier>/*`
- Modify: OpenShip provider registry/allowlist from the checked-out revision
- Create: `tests/integration/<supplier>/*`
- Create: `docs/ops/<supplier>-runbook.md`

**Interfaces:**
- Consumes: exact OpenShip channel adapter contract.
- Produces: bounded purchase, tracking, cancellation, and health operations.

- [ ] **Step 1: Define supplier capabilities.**

Explicitly list whether the provider supports inventory lookup, product lookup, purchase creation, cancellation, tracking, webhooks, and retries.

- [ ] **Step 2: Implement authentication.**

Keep credentials server-side. Rotate and revoke through environment/configuration management.

- [ ] **Step 3: Validate provider responses.**

Use schema validation. Reject missing IDs, wrong currencies, unknown SKUs, negative quantities, and unexpected status transitions.

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

- [ ] **Step 1: Write the full synthetic happy-path test.**

Create an order containing multiple variants and quantities. Assert exact line mapping into the synthetic channel.

- [ ] **Step 2: Implement order ingestion.**

Preserve the source order ID permanently as the correlation key.

- [ ] **Step 3: Implement match verification.**

Reject partially matched orders unless the configured business rule explicitly supports partial fulfillment.

- [ ] **Step 4: Implement purchase creation.**

Use one idempotency key per source order/fulfillment action and persist the downstream purchase ID before allowing a retry path to create a second request.

- [ ] **Step 5: Implement reconciliation state machine.**

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

- [ ] **Step 6: Test all terminal and failure transitions.**

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

- [ ] **Step 1: Map internal/provider status to customer-safe states.**

- [ ] **Step 2: Validate tracking URL destinations.**

Avoid arbitrary redirect behavior. Show a plain tracking number even when a carrier URL cannot be safely projected.

- [ ] **Step 3: Add delayed-tracking state.**

Explain when an order has been accepted but tracking is not yet available.

- [ ] **Step 4: Test stale/missing tracking.**

---

## Task 15: Shipping and returns implementation

**Files:**
- Modify: Openfront shipping configuration as required
- Create/modify: `lib/shipping/*`
- Create/modify: `app/(store)/shipping/page.*`
- Create/modify: `app/(store)/returns/page.*`
- Create: `tests/unit/shipping/*`

Openfront documentation describes shipping providers as having operations such as rate lookup, address validation, label creation, tracking, and label cancellation. Use only the operations actually needed by the business flow.

- [ ] **Step 1: Configure shipping strategy.**

Start with the smallest reliable model: a flat rate, free-shipping threshold, or provider-backed live rates based on actual business requirements.

- [ ] **Step 2: Validate addresses where required.**

Do not claim address validation if the configured provider does not perform it.

- [ ] **Step 3: Publish real shipping/return policies.**

Policies must match operational capability.

- [ ] **Step 4: Test pricing at boundaries.**

Cover free-shipping threshold, unavailable destination, invalid address, and currency mismatch.

---

## Task 16: Payment integration hardening

**Files:**
- Create/modify: `lib/payment/*`
- Modify: Openfront payment configuration
- Create: `tests/integration/payment/*`
- Create: `docs/ops/payments.md`

- [ ] **Step 1: Use the payment integration supported by the target market.**

For India, prefer a provider with UPI/card/net-banking support if the business requires those methods. Keep provider-specific logic behind Openfront's payment boundary.

- [ ] **Step 2: Verify webhook authentication.**

Never mark an order paid because a client returned to a success page. Payment state must come from an authenticated provider/Openfront flow.

- [ ] **Step 3: Add duplicate-event tests.**

- [ ] **Step 4: Add failure/retry tests.**

- [ ] **Step 5: Document refund/cancellation behavior.**

Do not assume supplier cancellation equals customer refund.

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

- [ ] **Step 1: Add correlation IDs.**

Every customer order → Openfront order → OpenShip order → provider purchase must be traceable by correlation ID/source order ID.

- [ ] **Step 2: Add structured logs.**

Log IDs, operation names, durations, and sanitized provider status. Never log secrets, auth headers, full payment data, or raw customer credentials.

- [ ] **Step 3: Add retry/reconciliation visibility.**

An operator must be able to see why an order is stuck and what action is safe.

- [ ] **Step 4: Add alert thresholds.**

At minimum: provider errors, webhook signature failures, unmatched products, stale orders, repeated retry failures, and database/connectivity errors.

---

## Task 18: Security hardening

**Files:**
- Create/modify: `lib/security/*`
- Modify: auth/session code
- Modify: webhook handlers
- Create: `tests/security/*`
- Create: `docs/security/threat-model.md`

Security requirements:

- [ ] Server-side credential storage only.
- [ ] Encrypt or otherwise strongly protect provider credentials at rest when the existing architecture permits it.
- [ ] Explicit ownership checks on user-owned shop/channel/order/match records.
- [ ] Signed webhook verification.
- [ ] Replay protection with event IDs/nonce/idempotency records.
- [ ] Rate limiting on public auth, search, contact, tracking, and webhook endpoints as appropriate.
- [ ] CSRF protections where cookie-authenticated state-changing requests require them.
- [ ] SSRF protection for configurable provider URLs; allow only approved schemes/hosts and deny private-network targets unless explicitly required for local development.
- [ ] Open redirects prevented by fixed origin/path allowlists.
- [ ] HTML/script injection prevented through framework escaping and safe rich-text handling.
- [ ] Input schema validation at API boundaries.
- [ ] Security headers configured where compatible with the application.
- [ ] Dependency audit in CI.

Create a threat model covering account takeover, credential leakage, webhook spoofing, duplicate purchases, unauthorized order access, SSRF, open redirect, price tampering, inventory race, and malicious supplier response.

---

## Task 19: SEO, analytics, and conversion measurement

**Files:**
- Create/modify: `lib/seo/*`
- Create/modify: `app/sitemap.ts`
- Create/modify: `app/robots.ts`
- Create: `components/analytics/*`
- Create: `docs/analytics/events.md`

- [ ] **Step 1: Add metadata helpers.**

Use page-specific title, description, canonical URL, Open Graph, and product metadata.

- [ ] **Step 2: Generate sitemap from indexable catalog routes.**

Exclude account, cart, checkout, admin, and internal routes.

- [ ] **Step 3: Add privacy-aware analytics.**

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

- [ ] **Step 4: Add funnel metrics.**

Measure product-view → add-to-cart → checkout → purchase conversion without storing unnecessary personal information.

---

## Task 20: Performance and accessibility hardening

**Files:**
- Modify: image handling/configuration
- Modify: components responsible for client-heavy interactions
- Create: `tests/e2e/accessibility.spec.*`
- Create: `docs/performance/budget.md`

- [ ] **Step 1: Audit client components.**

Convert static sections to server components where possible. Keep interactive islands small.

- [ ] **Step 2: Optimize product images.**

Use responsive image delivery and correct intrinsic dimensions. Avoid shipping original-resolution supplier assets to mobile.

- [ ] **Step 3: Respect reduced motion.**

Disable non-essential transforms/parallax for reduced-motion users.

- [ ] **Step 4: Run accessibility checks.**

Test keyboard navigation, labels, focus traps, headings, landmarks, alt text, contrast, and touch target size.

- [ ] **Step 5: Set performance budgets.**

Choose concrete thresholds after measuring the baseline. Fail CI only on metrics that are deterministic and meaningful for this architecture.

---

## Task 21: Legal/policy surface

**Files:**
- Create: `app/(store)/privacy/page.*`
- Create: `app/(store)/terms/page.*`
- Create: `app/(store)/shipping/page.*`
- Create: `app/(store)/returns/page.*`
- Create: `app/(store)/contact/page.*`
- Create: `docs/legal/content-source.md`

- [ ] **Step 1: Add policy pages.**

Use the actual business entity, customer-support contact, delivery expectations, return conditions, and payment behavior.

- [ ] **Step 2: Add consistent policy links.**

Footer, cart, checkout, order/tracking, and support surfaces should expose relevant policies.

- [ ] **Step 3: Add consent requirements only where legally/business necessary.**

Do not add invasive cookie banners or tracking solely because a template contains them.

---

## Task 22: Seed a production-shaped catalog

**Files:**
- Create: `scripts/seed-catalog.*`
- Create: `docs/catalog/product-model.md`
- Create or import: approved product media in `public/` or the configured media store

- [ ] **Step 1: Choose 10–30 products in one niche.**

Every product must have: title, short value proposition, description, variants, SKU, pricing, shipping constraints, returns eligibility, and appropriate media.

- [ ] **Step 2: Create original merchandising copy.**

Do not paste supplier descriptions directly into customer pages.

- [ ] **Step 3: Normalize variants.**

Every sellable variant must map 1:1 to a fulfillment SKU or have an explicit manual-fulfillment rule.

- [ ] **Step 4: Validate images.**

Check dimensions, alt text, file size, and licensing/source record.

- [ ] **Step 5: Seed safely.**

The seed script must be idempotent and must never reset/delete production data.

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

- [ ] **Step 1: Run CI on pull requests.**
- [ ] **Step 2: Run deployment only from the protected branch/tag strategy used by the project.**
- [ ] **Step 3: Keep production secrets out of repository files.**
- [ ] **Step 4: Upload only sanitized test artifacts/logs.**
- [ ] **Step 5: Add rollback documentation.**

---

## Task 24: Production deployment

**Files:**
- Modify: deployment configuration appropriate to the chosen host
- Create: `docs/ops/deployment.md`
- Create: `docs/ops/rollback.md`

The deployment can be self-hosted or use a free/low-cost platform where the terms permit commercial use. Do not assume a free tier is suitable for a commercial store without checking its current terms.

- [ ] **Step 1: Deploy PostgreSQL.**

Use backups and connection pooling appropriate to the provider.

- [ ] **Step 2: Deploy Openfront.**
- [ ] **Step 3: Deploy OpenShip.**
- [ ] **Step 4: Deploy the custom storefront.**
- [ ] **Step 5: Configure domains and HTTPS.**
- [ ] **Step 6: Configure environment variables.**
- [ ] **Step 7: Run database migrations using the repository-supported mechanism.**
- [ ] **Step 8: Verify health checks.**
- [ ] **Step 9: Run the synthetic end-to-end order before real credentials.**
- [ ] **Step 10: Connect production credentials and repeat the full flow with a low-risk test order.**

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


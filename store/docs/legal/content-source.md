# Legal content: sources, decisions and open inputs

> Created for Task 21 (legal/policy surface) of `DROPSHIPPING-AGENT-PLAN.md`.
> The plan's Step 1 is "use the actual business entity, customer-support
> contact, delivery expectations, return conditions, and payment behavior".
> This file records **where each published claim comes from**, what was
> deliberately left out, and the inputs only the operator can supply.

## The rule this work is held to

A policy is a statement to a customer, so it must match what the code actually
does. Where the store does not do something, the policy says so (no automated
returns portal, no invented transit window, no carrier guarantee) instead of
promising it. Copy lives in `store/lib/brand/policies.ts`; no policy text is
written inside a component.

## Where each claim comes from

| Published claim | Source of truth in this repo |
| --- | --- |
| Ships to the United States only | `site.market.countryCode = "us"` (`store/lib/brand/site.ts`); `SUPPORTED_DESTINATIONS` in `store/lib/shipping/address.ts`; address rejection happens before payment in `setAddresses` (`store/features/storefront/lib/data/cart.ts`) |
| Cost and free-shipping threshold shown at checkout | `selectShippingOptions` (`store/lib/shipping/pricing.ts`) filters region-scoped options and drops `calculated` (unquotable) ones |
| Tracking appears only when the carrier reports it; no promised transit time | `store/lib/fulfillment/*`, `docs/ops/*-runbook.md`, `store/features/storefront/modules/order/components/fulfillment-card/index.tsx` |
| 30-day return window, unused, original packaging | Published return condition in `store/lib/brand/policies.ts`; the operator-facing procedure that must follow it is `docs/ops/payments.md` §Refunds |
| Returns start with an email because no returns portal exists | No returns route or portal exists in `store/app/**`; the only returns path is support email |
| Refunds go to the original payment method; shipping refunded only for damaged/incorrect | Provider adapters `store/features/integrations/payment/*` (`refundPaymentFunction`), documented in `docs/ops/payments.md` |
| Damaged/incorrect reported within 7 days | Published condition in `store/lib/brand/policies.ts`; operator procedure in `docs/ops/payments.md` |
| Account fields we hold (name, email, password, optional phone) | Registration form `store/features/storefront/modules/account/components/register/index.tsx` + `signUp` in `store/features/storefront/lib/data/user.ts` |
| We hold the delivery address, the items and a payment reference | Cart/order data in `store/features/storefront/lib/data/cart.ts`; reference only, per `docs/ops/payments.md` (the store holds no secret keys and receives no provider webhooks) |
| We never see or store card numbers | Card/wallet capture happens at the provider; the store keeps a reference (`docs/ops/payments.md`) |
| Two cookies: seven-day cart, thirty-day session | `store/features/storefront/lib/data/cookies.ts` (`_openfront_cart_id` maxAge 7d, `keystonejs-session` maxAge 30d) |
| No advertising, tracking or third-party analytics cookies; no third-party script | No third-party script is loaded; analytics is first-party (`store/lib/analytics/client.ts`, `docs/analytics/events.md`) |
| Analytics off by default; allowlisted facts only; no identifiers | `NEXT_PUBLIC_ANALYTICS_ENABLED` (off unless `"true"`), allowlists in `store/lib/analytics/events.ts`, no-PII rule in `docs/analytics/events.md` |
| Do Not Track / Global Privacy Control honoured, re-checked per event | `isAnalyticsEnabled` + `readPrivacySignals` in `store/lib/analytics/client.ts` |
| Details shared with the payment provider, the fulfilment partner and the carrier, and nobody else | `docs/architecture/current-state.md`, `docs/ops/adding-a-supplier-provider.md`, `docs/ops/payments.md` |
| Prices/stock read at request time; the checkout price is what is charged | Catalog reads in `store/features/storefront/lib/data/*`; `docs/architecture/current-state.md` |
| A declined payment leaves no order behind | `handlePaidOrder` settles the provider session **before** `createOrderFromCartAtomically` (`docs/ops/payments.md` §How an order becomes paid) |
| The payment methods listed at checkout are the ones offered | `selectPaymentMethods` (`store/lib/payment/methods.ts`) |
| Cancellation by email; cancellation is a request and a refund is a separate step | `docs/ops/payments.md` §Cancellation and refunds |
| Automated traffic is rate-limited | `store/tests/security/rate-limit.test.ts` (Task 17 rate limiter) |

## Deliberately absent (operator inputs, not invented)

These are facts only the business can supply. None of them appears in the
published copy, and none is replaced by a `[placeholder]` a customer could read:

1. **Registered legal name** — the Terms name the store using `site.name`
   (`Northwind Goods`), the same name used in the copyright line and in
   structured data. If the registered entity differs (for example an LLC trading
   under the brand), add that name to the Terms once it is confirmed.
2. **Postal address / registered state** — required for a service-of-process
   address and for a governing-law clause. The Terms deliberately contain **no**
   jurisdiction claim; `store/tests/unit/brand/policies.test.ts` pins that
   (`makes no claim about a jurisdiction we have not been given`). Add the
   address and the governing-law/venue sentence together, with legal review.
3. **Real support address** — `mailto:support@example.com` in
   `store/lib/brand/site.ts` is a placeholder. Replace it with the monitored
   mailbox before launch; every surface (footer, trust section, order help,
   policy pages, registration consent) reads it from that one place.
4. **DMCA agent / copyright contact** — not published, because no agent has been
   registered. Add a section if the business registers one.
5. **Order-record retention period** — the Privacy policy says records are kept
   for accounting and tax reasons and that we will say what is kept. If tax
   counsel requires a stated period, state it there.
6. **Legal review** — the Privacy and Terms pages are written from the
   application's real behaviour, not by a lawyer. Have them reviewed before
   launch, then record the reviewer and date in the review log below.

## Step 3 — consent: what was added, and what was refused

*Decision: no cookie banner, and no consent-management script.*

- Every cookie this store sets is **strictly necessary**: the cart proof and the
  sign-in session (`store/features/storefront/lib/data/cookies.ts`). They are not
  used for advertising, profiling or cross-site tracking, so they need disclosure
  rather than consent — which the Privacy policy provides.
- Analytics is **opt-in at the deployment level** (`NEXT_PUBLIC_ANALYTICS_ENABLED`
  defaults to off) and **opt-out at the visitor level** (DNT / Global Privacy
  Control are re-read on every event). Switching the flag on is an operator
  decision, and `docs/analytics/events.md` already records a published privacy
  policy as a precondition for it.
- A banner would therefore ask consent for things that either do not happen or
  are strictly necessary — the invasive pattern the plan warns against. If a
  future change adds advertising or third-party measurement, this decision must
  be revisited in that same change instead of a banner added "just in case".

## Where the policies are surfaced (Step 2)

| Surface | File | What it shows |
| --- | --- | --- |
| Every page footer | `store/components/layout/SiteFooter.tsx` | All four policies, driven by `site.trust.items` |
| Home page | `store/components/home/TrustSection.tsx` | All four plus support/tracking, copy from `site.trust.items` |
| `/policies` index | `store/app/(storefront)/[countryCode]/(main)/policies/page.tsx` | Every policy with its summary |
| Each policy page | `…/policies/[slug]/page.tsx` | Body, "see also" links to the other policies, support link |
| Cart | `store/features/storefront/modules/cart/templates/index.tsx` | Shipping + returns summary with links, read from `site.trust.items` |
| Checkout review | `store/features/storefront/modules/checkout/components/review/index.tsx` | Consent sentence linking Terms, Returns and Privacy |
| Order confirmation / order detail | `store/features/storefront/modules/order/components/help/index.tsx` | Support email, Shipping and Returns policies |
| Account registration | `store/features/storefront/modules/account/components/register/index.tsx` | Privacy + Terms consent links |
| Sitemap | `store/app/sitemap.ts` via `availablePolicySlugs` | Every published policy, and only published ones |

Dead links fixed in this task: `/content/privacy-policy` and
`/content/terms-of-use` (registration) and `/contact` (order help, twice). The
support card in `TrustSection` also linked to `/usmailto:…`, because
`LocalizedClientLink` prefixes the country code unconditionally; `mailto:` links
are now plain `<a>` elements there and in the order help component.

## Verification

```bash
cd store
npx vitest run tests/unit/brand/policies.test.ts   # content + wiring
npx vitest run tests/unit/seo                      # sitemap/robots advertise policies
npx tsc --noEmit -p tsconfig.json                  # no new errors
npm run build                                      # /us/policies/* compile
```

A rendered-page check lives at the repo root: `node logs-verify-home.mjs <html>`
asserts that all four policies are linked and that `mailto:` is never mangled by
the localized link wrapper.

## Review log

| Date | Change | Reviewed by |
| --- | --- | --- |
| 2026-09-25 | Privacy + Terms published from app behaviour; shipping/returns expanded; `/policies` index added | Not yet reviewed by counsel |

/**
 * Brand, navigation and site-content single source of truth (Tasks 3 + 5).
 *
 * Header, footer, home page sections and metadata read from this file — never
 * hard-code copy or routes in individual components.
 *
 * CONTENT RULES (plan Task 5, steps 3 + 4):
 *  - No fabricated claims. Anything here must be verifiable in the running app
 *    or in the catalog data.
 *  - Policy links (shipping/returns/privacy/terms) are delivered by Tasks 15 and
 *    21. They are declared here with an `available` flag so nothing links to a
 *    page that does not exist: `TrustSection` and `SiteFooter` render an entry
 *    only when its route is live, and the flag flips with the page in the same
 *    change.
 */

export const site = {
  name: "Northwind Goods",
  tagline: "Considered objects for everyday life",
  /** Fixed for the v1 market (see DROPSHIPPING-AGENT-PLAN.md §1.1) */
  market: { countryCode: "us", currency: "USD" },
  /** Shared container width — keep every section aligned to this. */
  containerClass: "max-w-[1440px] mx-auto px-6",
  /** Static routes shown in the header on desktop. Data-driven category links
   *  continue to come from Openfront (SideMenu / Footer). */
  navLinks: [{ label: "Shop", href: "/store" }],
  /** Footer link groups — only routes that exist today. Policy pages are
   *  rendered from `trust.items` below, not from this list. */
  footer: {
    support: [
      { label: "Track your order", href: "/account/orders" },
      { label: "Contact", href: "mailto:support@example.com" },
    ],
  },

  /** Task 5, step 1 — editorial hero. The CTA targets real routes: the catalog
   *  (`/store`) and a real collection (`/collections/{handle}`, resolved at
   *  render time from catalog data). */
  hero: {
    eyebrow: "Kitchen and desk",
    headline: "Pieces built to be used, not replaced",
    description:
      "A small catalog of solid oak, washed linen and stoneware, described in plain terms. Prices and availability are read from our catalog system on every request, so what you see here is what checkout uses.",
    primaryCta: { label: "Shop all products", href: "/store" },
    /** `{collection}` is replaced with a real collection handle when one
     *  exists; when it does not, this CTA is hidden rather than linking nowhere. */
    collectionCta: { labelTemplate: "Shop {collection}", hrefTemplate: "/collections/{handle}" },
  },

  /** Task 5 — brand story. Claims here are limited to how the site actually
   *  works and what the product copy actually says. */
  brandStory: {
    heading: "How we choose what to list",
    paragraphs: [
      "Every piece is here because we can describe it honestly — what it is made of, how it is finished, and what it is for.",
      "We would rather list a few things we understand than a wall of variations we do not.",
    ],
    points: [
      {
        title: "Catalog data, not marketing data",
        body: "Prices and availability on this site are read from our commerce system at request time. Nothing is cached long enough to mislead checkout.",
      },
      {
        title: "Material stated in the copy",
        body: "If we say oak, linen or stoneware, that is what the product description says too.",
      },
      {
        title: "You can track it yourself",
        body: "Orders are visible from your account, so you do not have to ask us where things stand.",
      },
    ],
  },

  /** Task 5, step 4 (expanded in Tasks 15/21) — trust/policy visibility.
   *  `available: false` means the page does not exist yet, so no surface may
   *  link to it. All four policies are live today; keep the flag and the route
   *  in the same commit or the footer will link somewhere that 404s. */
  trust: {
    heading: "Ordering with us",
    items: [
      {
        label: "Order tracking",
        body: "Every order is visible from your account, with its current status.",
        href: "/account/orders",
        available: true,
      },
      {
        label: "Support",
        body: "Email us and a person replies — no ticket robots.",
        href: "mailto:support@example.com",
        available: true,
      },
      // Tasks 15 + 21 — shipping, returns, privacy and terms all exist at
      // /policies/{shipping,returns,privacy,terms} (see lib/brand/policies.ts).
      {
        label: "Shipping",
        body: "We ship to the US; costs and free-shipping thresholds are shown at checkout.",
        href: "/policies/shipping",
        available: true,
      },
      {
        label: "Returns",
        body: "30 days from delivery; every return starts with an email to support.",
        href: "/policies/returns",
        available: true,
      },
      {
        label: "Privacy",
        body: "What the store holds about you, what it never sees, and how to have it removed.",
        href: "/policies/privacy",
        available: true,
      },
      {
        label: "Terms",
        body: "The rules that apply to an order: prices, payment and cancellation.",
        href: "/policies/terms",
        available: true,
      },
    ],
  },

  /** Task 5 — FAQ. Only questions the current app can answer truthfully are
   *  listed. Shipping times, the return window and delivery estimates are not
   *  repeated here: they live in the policies (Tasks 15/21), so there is one
   *  place to change the answer and no second version to drift. */
  faq: {
    heading: "Questions we get",
    items: [
      {
        question: "How do I know an item is in stock?",
        answer:
          "Each product page shows availability per variant, read live from our catalog. If a variant cannot be ordered it is marked clearly rather than substituted.",
      },
      {
        question: "Which payment methods can I use?",
        answer:
          "Payment is taken by our checkout provider at the end of checkout, and the methods available to you are listed there.",
      },
      {
        question: "How do I track an order?",
        answer:
          "Sign in and open your orders page — each order shows its current status. If you need more detail than we display, email support and we will look it up.",
      },
    ],
  },
} as const;

export type SiteConfig = typeof site;
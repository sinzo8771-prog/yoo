/**
 * Brand, navigation and site-content single source of truth (Tasks 3 + 5).
 *
 * Header, footer, home page sections and metadata read from this file — never
 * hard-code copy or routes in individual components.
 *
 * CONTENT RULES (plan Task 5, steps 3 + 4):
 *  - No fabricated claims. Anything here must be verifiable in the running app
 *    or in the catalog data.
 *  - Policy links (shipping/returns/privacy/terms) are added in Tasks 15/21.
 *    They are declared here with `available: false` so nothing links to a page
 *    that does not exist yet, and `TrustSection` will start rendering them as
 *    soon as their task flips the flag.
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
  /** Footer link groups — only routes that exist today; policy pages are added
   *  in Tasks 15/21 and should be appended here. */
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

  /** Task 5, step 4 — trust/policy visibility.
   *  `available: false` means the page does not exist yet; the entry is kept
   *  here so Tasks 15/21 only have to flip the flag. Do not link to a route
   *  that is not implemented. */
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
      // TODO(Task 15): shipping + returns once the policies exist.
      { label: "Shipping", body: "", href: "/policies/shipping", available: false },
      // TODO(Task 15): returns policy.
      { label: "Returns", body: "", href: "/policies/returns", available: false },
      // TODO(Task 21): privacy policy.
      { label: "Privacy", body: "", href: "/policies/privacy", available: false },
      // TODO(Task 21): terms of service.
      { label: "Terms", body: "", href: "/policies/terms", available: false },
    ],
  },

  /** Task 5 — FAQ. Only questions the current app can answer truthfully are
   *  listed. Shipping times, return windows and delivery estimates are
   *  deliberately absent until Tasks 15/21 define them. */
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
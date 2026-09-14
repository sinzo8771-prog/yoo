/**
 * Brand + navigation single source of truth (Task 3).
 * Desktop nav, mobile side menu, and footer all read from this file —
 * never hard-code navigation labels/routes in individual components.
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
} as const;

export type SiteConfig = typeof site;
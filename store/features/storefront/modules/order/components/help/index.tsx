import LocalizedClientLink from "@/features/storefront/modules/common/components/localized-client-link"
import { site } from "@/lib/brand/site"
import React from "react"

/**
 * Task 21, Step 2 — the order/support surface.
 *
 * Every link here must resolve. Both entries previously pointed at `/contact`,
 * a route that does not exist; support is an email, and the two policies below
 * are where the shipping and return answers actually live.
 *
 * The contact link is a plain `<a>` on purpose: `LocalizedClientLink` prefixes
 * the country code unconditionally and would turn `mailto:` into `/usmailto:`.
 */
const Help = () => {
  const contact = site.footer.support.find((link) =>
    link.href.startsWith("mailto:")
  )

  return (
    <div className="mt-6">
      <h2 className="text-sm leading-6 font-semibold">Need help?</h2>
      <div className="text-sm leading-6 font-normal my-2">
        <ul className="gap-y-2 flex flex-col">
          {contact ? (
            <li>
              <a
                href={contact.href}
                className="underline underline-offset-4"
                rel="noreferrer"
              >
                {contact.label}
              </a>
            </li>
          ) : null}
          <li>
            <LocalizedClientLink
              href="/policies/shipping"
              className="underline underline-offset-4"
            >
              Shipping and delivery
            </LocalizedClientLink>
          </li>
          <li>
            <LocalizedClientLink
              href="/policies/returns"
              className="underline underline-offset-4"
            >
              Returns and exchanges
            </LocalizedClientLink>
          </li>
        </ul>
      </div>
    </div>
  )
}

export default Help

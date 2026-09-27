import LocalizedClientLink from "@/features/storefront/modules/common/components/localized-client-link";
import { site } from "@/lib/brand/site";

/**
 * TrustSection (Task 5, step 4; content completed by Tasks 15/21).
 *
 * Shows shipping/returns/privacy/terms/support visibility by reading
 * `site.trust.items` — the copy is never written in this component. Entries are
 * only rendered when `available: true`, which today means all six routes/pages
 * exist. Do not "fix" an empty section by linking to a route that 404s.
 *
 * `mailto:` links must not go through `LocalizedClientLink`: it prefixes the
 * country code unconditionally, which would turn `mailto:` into `/usmailto:`.
 */
export default function TrustSection() {
  const available = site.trust.items.filter((item) => item.available);
  if (available.length === 0) return null;

  const linkClass =
    "mt-3 inline-block text-[0.8125rem] font-medium text-foreground underline underline-offset-4";

  return (
    <section
      aria-labelledby="trust-heading"
      className={`${site.containerClass} py-14 sm:py-16`}
    >
      <h2
        id="trust-heading"
        className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
      >
        {site.trust.heading}
      </h2>

      <ul className="mt-6 grid gap-6 sm:grid-cols-2">
        {available.map((item) => (
          <li
            key={item.label}
            className="rounded-md border border-border p-5"
          >
            <h3 className="text-sm font-medium text-foreground">{item.label}</h3>
            {item.body ? (
              <p className="mt-1 text-[0.8125rem] leading-5 text-muted-foreground">
                {item.body}
              </p>
            ) : null}
            {item.href.startsWith("mailto:") ? (
              <a href={item.href} className={linkClass} rel="noreferrer">
                Email support
              </a>
            ) : (
              <LocalizedClientLink href={item.href} className={linkClass}>
                {item.label === "Support" ? "Email support" : "Open"}
              </LocalizedClientLink>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
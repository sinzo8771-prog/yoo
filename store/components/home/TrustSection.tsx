import LocalizedClientLink from "@/features/storefront/modules/common/components/localized-client-link";
import { site } from "@/lib/brand/site";

/**
 * TrustSection (Task 5, step 4).
 *
 * Shows shipping/returns/support visibility **without fabricating policy
 * content**. Entries in `site.trust.items` are only rendered when
 * `available: true`, which today means the routes/pages actually exist.
 *
 * The shipping/returns/privacy/terms entries are already declared in the config
 * with `available: false`; Tasks 15/21 flip that flag once the pages exist. Do
 * not "fix" an empty section by linking to a route that 404s.
 */
export default function TrustSection() {
  const available = site.trust.items.filter((item) => item.available);
  if (available.length === 0) return null;

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
            <LocalizedClientLink
              href={item.href}
              className="mt-3 inline-block text-[0.8125rem] font-medium text-foreground underline underline-offset-4"
            >
              {item.label === "Support" ? "Email support" : "Open"}
            </LocalizedClientLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
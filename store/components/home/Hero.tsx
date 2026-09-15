import LocalizedClientLink from "@/features/storefront/modules/common/components/localized-client-link";
import { site } from "@/lib/brand/site";

/**
 * Hero (Task 5, step 1).
 *
 * Editorial, not decorative: it states what the brand sells and why it exists,
 * and its CTAs point at routes that actually exist.
 *
 * - Primary CTA → the catalog (`/store`).
 * - Secondary CTA → a real collection, but only when `collection` is supplied
 *   from real catalog data. When it is absent the CTA is omitted rather than
 *   linking to a collection that does not exist.
 *
 * Deliberately a server component with no animation: no shader/canvas weight on
 * the first paint, and nothing that a reduced-motion user has to opt out of.
 */
export default function Hero({
  collection,
}: {
  /** A real collection handle + title from the catalog, when one exists. */
  collection?: { handle: string; title: string } | null;
}) {
  const { hero } = site;

  return (
    <section
      aria-labelledby="hero-heading"
      className="border-b border-border bg-secondary/40"
    >
      <div className={`${site.containerClass} py-16 sm:py-24 lg:py-32`}>
        <div className="max-w-3xl">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {hero.eyebrow}
          </p>
          <h1
            id="hero-heading"
            className="mt-4 text-3xl leading-tight font-semibold tracking-tight text-foreground sm:text-4xl lg:text-5xl"
          >
            {hero.headline}
          </h1>
          <p className="mt-6 text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            {hero.description}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            <LocalizedClientLink
              href={hero.primaryCta.href}
              className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors duration-[var(--duration-normal)] hover:bg-primary/90"
            >
              {hero.primaryCta.label}
            </LocalizedClientLink>

            {collection ? (
              <LocalizedClientLink
                href={hero.collectionCta.hrefTemplate.replace(
                  "{handle}",
                  collection.handle
                )}
                className="inline-flex items-center justify-center rounded-md border border-border px-6 py-3 text-sm font-medium text-foreground transition-colors duration-[var(--duration-normal)] hover:bg-secondary"
              >
                {hero.collectionCta.labelTemplate.replace(
                  "{collection}",
                  collection.title
                )}
              </LocalizedClientLink>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
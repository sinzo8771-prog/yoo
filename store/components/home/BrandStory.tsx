import { site } from "@/lib/brand/site";

/**
 * BrandStory (Task 5).
 *
 * Explains the selection approach in the brand's own voice. All copy lives in
 * `lib/brand/site.ts` and is limited to claims the app can back up — no invented
 * history, awards or scale claims.
 */
export default function BrandStory() {
  const { brandStory } = site;

  return (
    <section
      aria-labelledby="brand-story-heading"
      className="border-y border-border bg-secondary/30"
    >
      <div className={`${site.containerClass} py-14 sm:py-20`}>
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <h2
              id="brand-story-heading"
              className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
            >
              {brandStory.heading}
            </h2>
            <div className="mt-5 space-y-4">
              {brandStory.paragraphs.map((paragraph) => (
                <p
                  key={paragraph}
                  className="text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7"
                >
                  {paragraph}
                </p>
              ))}
            </div>
          </div>

          <dl className="grid gap-6 sm:grid-cols-1">
            {brandStory.points.map((point) => (
              <div key={point.title} className="border-l-2 border-brand pl-4">
                <dt className="text-sm font-medium text-foreground">
                  {point.title}
                </dt>
                <dd className="mt-1 text-[0.8125rem] leading-5 text-muted-foreground">
                  {point.body}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
import { site } from "@/lib/brand/site";

/**
 * FAQ (Task 5).
 *
 * Uses native `<details>`/`<summary>`: keyboard-operable, screen-reader
 * announced, and needs no client JavaScript or animation library — so it cannot
 * fight the reduced-motion rules in `globals.css`.
 *
 * Answers come from `site.faq.items` and are restricted to questions the app can
 * answer truthfully today; shipping/returns answers arrive with Tasks 15/21.
 */
export default function FAQ() {
  const { faq } = site;
  if (faq.items.length === 0) return null;

  return (
    <section
      aria-labelledby="faq-heading"
      className="border-t border-border bg-secondary/30"
    >
      <div className={`${site.containerClass} py-14 sm:py-20`}>
        <h2
          id="faq-heading"
          className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
        >
          {faq.heading}
        </h2>

        <div className="mt-8 max-w-3xl divide-y divide-border border-y border-border">
          {faq.items.map((item) => (
            <details key={item.question} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-foreground marker:content-none">
                <span>{item.question}</span>
                <span
                  aria-hidden="true"
                  className="shrink-0 text-muted-foreground transition-transform duration-[var(--duration-fast)] group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="mt-3 max-w-2xl text-[0.8125rem] leading-6 text-muted-foreground">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
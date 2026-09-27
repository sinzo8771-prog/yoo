import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LocalizedClientLink from "@/features/storefront/modules/common/components/localized-client-link";
import { policies, availablePolicySlugs, type Policy } from "@/lib/brand/policies";
import { site } from "@/lib/brand/site";

/**
 * Tasks 15 + 21 — policy pages. Only slugs in `policies` render; anything else
 * 404s, because an empty policy page would be a fabricated claim about how the
 * store operates.
 *
 * Every lookup goes through `resolvePolicy`, so the title and the body can never
 * disagree about whether a slug exists, and the key type comes from the record
 * rather than a hand-written union — adding a policy to `lib/brand/policies.ts`
 * wires itself in here.
 */
function resolvePolicy(slug: string): Policy | null {
  return availablePolicySlugs.includes(slug as Policy["slug"])
    ? policies[slug as Policy["slug"]]
    : null;
}

/** The other policies, so each policy page can link the rest of the set. */
function otherPolicies(slug: Policy["slug"]): Policy[] {
  return availablePolicySlugs
    .filter((other) => other !== slug)
    .map((other) => policies[other]);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const policy = resolvePolicy(slug);
  if (!policy) {
    return { title: "Not found" };
  }
  return {
    title: `${policy.title} | ${site.name}`,
    description: policy.summary,
  };
}

export default async function PolicyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const policy = resolvePolicy(slug);
  if (!policy) notFound();

  return (
    <div className={site.containerClass}>
      <article className="max-w-2xl py-16">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          <LocalizedClientLink
            className="underline-offset-4 hover:underline"
            href="/policies"
          >
            Policies
          </LocalizedClientLink>
        </p>
        <h1 className="mt-2 text-3xl font-medium tracking-tight">
          {policy.title}
        </h1>
        <p className="mt-2 text-muted-foreground">{policy.summary}</p>
        {policy.sections.map((section) => (
          <section key={section.heading} className="mt-10">
            <h2 className="text-lg font-medium">{section.heading}</h2>
            {section.paragraphs.map((paragraph, i) => (
              <p key={i} className="mt-3 text-[0.9375rem] leading-6 text-foreground/90">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
        <p className="mt-12 text-sm text-muted-foreground">
          Questions about this policy?{" "}
          <LocalizedClientLink
            className="underline underline-offset-4"
            href={site.footer.support[1].href}
          >
            Contact support
          </LocalizedClientLink>
          .
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          See also:{" "}
          {otherPolicies(policy.slug).map((other, index) => (
            <span key={other.slug}>
              {index > 0 ? ", " : ""}
              <LocalizedClientLink
                className="underline underline-offset-4"
                href={`/policies/${other.slug}`}
              >
                {other.title}
              </LocalizedClientLink>
            </span>
          ))}
          .
        </p>
      </article>
      <div className="pb-16" />
    </div>
  );
}
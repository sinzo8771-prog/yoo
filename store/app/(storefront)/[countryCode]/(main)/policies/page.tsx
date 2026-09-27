import type { Metadata } from "next";
import LocalizedClientLink from "@/features/storefront/modules/common/components/localized-client-link";
import { availablePolicySlugs, policies } from "@/lib/brand/policies";
import { site } from "@/lib/brand/site";

/**
 * Tasks 15 + 21 — `/policies` is the index of the policies that exist. It used
 * to redirect to Shipping, which meant a visitor following a policy link had no
 * way to see the rest of the set; the list is built from
 * `availablePolicySlugs`, so a policy cannot be missing from it.
 */
export const metadata: Metadata = {
  title: `Policies | ${site.name}`,
  description: "Shipping, returns, privacy and terms for this store.",
};

export default function PoliciesIndexPage() {
  return (
    <div className={site.containerClass}>
      <div className="max-w-2xl py-16">
        <h1 className="text-3xl font-medium tracking-tight">Policies</h1>
        <p className="mt-2 text-muted-foreground">
          Every policy that applies when you shop here. Each one is written to
          match what the store actually does — where it does not do something, the
          policy says so rather than promising it.
        </p>
        <ul className="mt-10 flex flex-col gap-y-8">
          {availablePolicySlugs.map((slug) => (
            <li key={slug}>
              <h2 className="text-lg font-medium">
                <LocalizedClientLink
                  className="underline-offset-4 hover:underline"
                  href={`/policies/${slug}`}
                >
                  {policies[slug].title}
                </LocalizedClientLink>
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {policies[slug].summary}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-12 text-sm text-muted-foreground">
          Something not covered here?{" "}
          <LocalizedClientLink
            className="underline underline-offset-4"
            href={site.footer.support[1].href}
          >
            Contact support
          </LocalizedClientLink>
          .
        </p>
      </div>
      <div className="pb-16" />
    </div>
  );
}

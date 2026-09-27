/**
 * Tasks 15 + 21 — policy content tests.
 *
 * The plan's hard rule for policies: they must match operational capability.
 * These tests pin the claims that must (and must not) appear, so an innocent
 * copy edit cannot drift into a fabricated promise. They also pin what is
 * deliberately absent — a registered entity, a governing jurisdiction, a
 * placeholder — so that nobody "helpfully" invents one to fill the gap.
 */
import { describe, expect, it } from "vitest";
import { policies, availablePolicySlugs } from "@/lib/brand/policies";
import { site } from "@/lib/brand/site";

type PolicySlug = keyof typeof policies;

const allText = (slug: PolicySlug): string =>
  [
    policies[slug].title,
    policies[slug].summary,
    ...policies[slug].sections.flatMap((section) => [
      section.heading,
      ...section.paragraphs,
    ]),
  ].join("\n");

describe("policy surface", () => {
  it("publishes exactly shipping, returns, privacy and terms", () => {
    expect(availablePolicySlugs).toEqual([
      "shipping",
      "returns",
      "privacy",
      "terms",
    ]);
  });

  it("gives every section a heading and non-empty paragraphs", () => {
    for (const slug of availablePolicySlugs) {
      expect(policies[slug].sections.length).toBeGreaterThan(0);
      for (const section of policies[slug].sections) {
        expect(section.heading.trim()).toBeTruthy();
        expect(section.paragraphs.length).toBeGreaterThan(0);
        for (const paragraph of section.paragraphs) {
          expect(paragraph.trim()).toBeTruthy();
        }
      }
    }
  });

  it("gives each policy a unique title, its own slug and a summary", () => {
    const titles = availablePolicySlugs.map((slug) => policies[slug].title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const slug of availablePolicySlugs) {
      expect(policies[slug].slug).toBe(slug);
      expect(policies[slug].summary.trim()).toBeTruthy();
    }
  });

  it.each(availablePolicySlugs)(
    "publishes no placeholder, invented price or unsubstantiated entity in %s",
    (slug) => {
      const text = allText(slug);
      // No template token, TODO, markup or lorem filler...
      expect(text).not.toMatch(/\[[^\]]{2,}\]|\bTBD\b|\bTODO\b|lorem ipsum|<[a-z/]/i);
      // ...no dollar amount (checkout owns pricing)...
      expect(text).not.toMatch(/\$\d/);
      // ...no legal-entity suffix or registered address we have not been given...
      expect(text).not.toMatch(/\b(LLC|L\.L\.C\.|Inc\.|Ltd\.|GmbH|LLP)\b/);
      // ...and no invented transit window.
      expect(text).not.toMatch(/\d+-\d+ (business )?days/);
    }
  );
});

describe("shipping policy matches capability", () => {
  const text = () => allText("shipping");

  it("states the single US market", () => {
    expect(text()).toContain("United States");
  });

  it("defers all costs and thresholds to checkout, not to invented prices", () => {
    expect(text()).toMatch(/checkout/);
    // No fabricated dollar amounts in policy copy — checkout owns pricing.
    expect(text()).not.toMatch(/\$\d/);
  });

  it("explains delayed tracking honestly instead of promising transit times", () => {
    expect(text()).toContain("48 hours");
    expect(text()).toContain("processing");
    // No invented transit guarantees like "3-5 business days".
    expect(text()).not.toMatch(/\d+-\d+ (business )?days/);
  });
});

describe("returns policy matches capability", () => {
  const text = () => allText("returns");

  it("states a concrete 30-day window", () => {
    expect(text()).toContain("30 days");
  });

  it("says returns start with an email — no invented self-service portal", () => {
    expect(text()).toMatch(/email to support/);
    expect(text().toLowerCase()).not.toContain("returns portal — log in");
    expect(text()).toContain("no online returns portal");
  });
});

describe("privacy policy matches what the app stores", () => {
  const text = () => allText("privacy");

  it("names the cookies the store actually sets", () => {
    expect(text()).toContain("seven days");
    expect(text()).toContain("thirty days");
    expect(text()).toContain("session cookie");
  });

  it("promises no advertising or third-party tracking", () => {
    expect(text()).toContain("no advertising cookies");
    expect(text()).toContain("No third-party script");
  });

  it("describes payment handling without claiming to hold card data", () => {
    expect(text()).toContain("never see or store your card number");
    expect(text()).toMatch(/payment provider/);
  });

  it("states analytics is off by default and honours privacy signals", () => {
    expect(text()).toContain("off by default");
    expect(text()).toContain("Do Not Track");
    expect(text()).toContain("Global Privacy Control");
  });
});

describe("terms match the ordering mechanics", () => {
  const text = () => allText("terms");

  it("names the seller from the brand config, not a hard-coded legal entity", () => {
    expect(text()).toContain(site.name);
  });

  it("says a declined payment creates no order (settlement precedes the order)", () => {
    expect(text()).toContain("no order is created");
    expect(text()).toContain("nothing is charged");
  });

  it("points at the shipping and returns policies instead of restating them", () => {
    expect(text()).toContain("Shipping policy");
    expect(text()).toContain("Returns policy");
  });

  it("makes no claim about a jurisdiction we have not been given", () => {
    expect(text()).not.toMatch(/governed by the laws|jurisdiction|venue|courts of/i);
    // Consumer rights are still preserved, without naming a state.
    expect(text()).toMatch(/right you have under consumer law|rights you have where you live/);
  });

  it("does not promise a delivery date on the carrier's behalf", () => {
    expect(text()).toContain("cannot promise a delivery date");
  });
});

describe("policy surfaces are wired and leak-free", () => {
  it("marks every published policy available, with copy, in site.ts", () => {
    const byHref = new Map(site.trust.items.map((item) => [item.href, item]));
    for (const slug of availablePolicySlugs) {
      const item = byHref.get(`/policies/${slug}`);
      expect(item, `/policies/${slug} is missing from site.trust.items`).toBeTruthy();
      expect(item?.available, `/policies/${slug} is not marked available`).toBe(true);
      expect(item?.body.trim()).toBeTruthy();
    }
  });

  it("never links a policy route that does not exist", () => {
    for (const item of site.trust.items) {
      if (!item.href.startsWith("/policies/")) continue;
      expect(
        availablePolicySlugs,
        `${item.href} would 404 — flip the flag only with the page`
      ).toContain(item.href.replace("/policies/", ""));
    }
  });

  it("pins the support entry the policy pages link to", () => {
    // `policies/page.tsx` and `policies/[slug]/page.tsx` render
    // `site.footer.support[1]` as "Contact support" (the Task 15/21 convention).
    // Reorder that list and the link would silently become "Track your order",
    // so the shape is asserted here rather than left to a comment.
    expect(site.footer.support).toHaveLength(2);
    expect(site.footer.support[0].href).toBe("/account/orders");
    expect(site.footer.support[1].href.startsWith("mailto:")).toBe(true);
  });

  it("never exposes provider or API details in policy copy", () => {
    for (const slug of availablePolicySlugs) {
      expect(allText(slug)).not.toMatch(
        /api\.|carrier API|Shippo|ShipEngine|Stripe|PayPal/i
      );
    }
  });
});

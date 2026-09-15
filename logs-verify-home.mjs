/**
 * One-off Task 5 home-page assertion script.
 * Normalises Next's `<!-- -->` text separators, then checks the rendered HTML.
 */
import { readFileSync } from "node:fs";

const raw = readFileSync(process.argv[2], "utf8");
const html = raw.replace(/<!--[\s\S]*?-->/g, "");
/** Visible markup only: Next inlines the RSC payload (including raw props such
 *  as minor-unit prices) inside <script> tags, which is not user-visible. */
const visible = html.replace(/<script[\s\S]*?<\/script>/g, "");

let failed = 0;
function check(ok, label, extra = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${extra && !ok ? ` — ${extra}` : ""}`);
  if (!ok) failed++;
}
function count(re) {
  return (html.match(re) || []).length;
}

check(count(/id="hero-heading"/g) === 1, "hero heading landmark present");
check(html.includes("Pieces built to be used, not replaced"), "hero headline copy rendered");
check(html.includes('href="/us/store"'), "primary CTA targets the real catalog route (/us/store)");

// Secondary CTA must use the merchant-authored collection title, not the handle.
const collectionLinks = [...html.matchAll(/href="\/us\/collections\/([a-z0-9-]+)"/g)].map((m) => m[1]);
check(collectionLinks.length > 0, "secondary CTA targets a real collection route", JSON.stringify(collectionLinks));
check(html.includes("Shop Kitchen") || html.includes("Shop Desk"), "secondary CTA labelled with merchant title");
check(!html.includes("Shop Dev"), "secondary CTA does not expose a prettified handle");

check(count(/id="featured-heading"/g) === 1, "featured section landmark present");
check(html.includes("Selected pieces"), "featured heading rendered");
for (const title of ["Oak Serving Board", "Washed Linen Apron", "Stoneware Mug"]) {
  check(html.includes(title), `featured product from catalog: ${title}`);
}
check(count(/href="\/us\/products\/dev-/g) === 3, "each featured card links to its product route", String(count(/href="\/us\/products\/dev-/g)));

// Prices must be major units. $24.00 correct; 2400/2,400.00 means the minor-unit
// conversion is wrong.
check(html.includes("$18.00"), "price formatted from minor units ($18.00)");
check(html.includes("$24.00"), "price formatted from minor units ($24.00)");
check(!/2,400|2400/.test(visible), "no raw minor-unit prices leaked (2400)");
check(html.includes("From $18.00"), "multi-price product shows a From range (mug: $18 / $21)");
check(!html.includes("Price unavailable"), "no product fell back to a missing-price label");

// Rationale comes from the merchant subtitle (catalog data), not invented copy.
check(html.includes("Hand-finished solid oak"), "product rationale from catalog subtitle");
check(html.includes("Reactive glaze, dishwasher safe"), "product rationale from catalog subtitle (2nd)");

check(html.includes("How we choose what to list"), "brand story section rendered");
check(html.includes("Ordering with us"), "trust section rendered");
check(html.includes('href="/us/account/orders"'), "trust: order tracking links to a real route");
check(html.includes('href="mailto:support@example.com"'), "trust: support link is a plain mailto (not country-prefixed)");
check(!html.includes('/us/mailto:'), "mailto not mangled by the localized link wrapper");

// FAQ: native disclosure widgets, no client JS required.
check(count(/<details/g) === 3, "FAQ uses 3 native <details> widgets", String(count(/<details/g)));
check(count(/<summary/g) === 3, "FAQ has 3 <summary> controls");

// Unreleased policy pages must NOT be linked (Tasks 15/21 own them).
check(!html.includes("/policies/"), "no links to unimplemented policy pages");

// Accessibility primitives from Task 3 must survive the new sections.
check(html.includes("skip-link"), "skip link present");
check(count(/<main[^>]*id="main-content"/g) === 1, "main landmark present");
check(count(/<h1/g) === 1, "exactly one h1 on the page", String(count(/<h1/g)));

// Section heading order: h2s must follow the h1 (no h3 before an h2, etc.)
const order = [...html.matchAll(/<h([123])[\s>]/g)].map((m) => Number(m[1]));
const firstH3 = order.indexOf(3);
const firstH2 = order.indexOf(2);
check(firstH2 > -1 && firstH2 < firstH3, "heading order: h2 before any h3", order.join(","));

console.log(failed === 0 ? "\nAll home page checks passed." : `\n${failed} check(s) FAILED.`);
process.exitCode = failed === 0 ? 0 : 1;
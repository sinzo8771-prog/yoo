import { expect, test } from "@playwright/test";

/**
 * Task 23, Step 1 — e2e smoke tests for the production build.
 *
 * These run against `next start` with placeholder env and NO backend, so they
 * assert only what a disconnected smoke run can prove: the server answers, the
 * locale redirect lands, static routes (robots, policies) render, and the
 * security headers from Task 18 are present on HTML responses.
 *
 * Anything needing the Openfront GraphQL backend (catalog pages, cart,
 * checkout) is explicitly skipped with a reason — a skipped test is an honest
 * record; an assertion that passes against an error boundary would be a lie.
 * The full customer journey (home → collection → product → cart → checkout →
 * order → tracking) stays in the plan's §6 acceptance suite and needs Task 24's
 * deployed backend before it can run anywhere.
 */

const REGION = "/us";

test("root redirects to the default region", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.ok(), "root / should redirect successfully").toBe(true);
  await expect(page).toHaveURL(new RegExp(`${REGION}(/|$)`));
});

test("homepage renders without a server error", async ({ page }) => {
  const response = await page.goto(REGION, { waitUntil: "domcontentloaded" });
  expect(response?.status(), "homepage status").toBeLessThan(500);
  await expect(page.locator("body")).toBeVisible();
});

test("policies index renders", async ({ page }) => {
  const response = await page.goto(`${REGION}/policies`, { waitUntil: "domcontentloaded" });
  expect(response?.status(), "policies status").toBeLessThan(500);
  await expect(page.locator("body")).toBeVisible();
});

test("robots.txt is served", async ({ request }) => {
  const response = await request.get("/robots.txt");
  expect(response.status(), "robots.txt status").toBeLessThan(500);
});

test("HTML responses carry the Task 18 security headers", async ({ page }) => {
  const response = await page.goto(REGION, { waitUntil: "domcontentloaded" });
  const headers = response?.headers() ?? {};
  expect(headers["x-frame-options"], "X-Frame-Options").toBe("DENY");
  expect(headers["x-content-type-options"], "X-Content-Type-Options").toBe("nosniff");
});

test.skip("store page lists live catalog products", async () => {
  // needs a reachable Openfront backend (Task 24); the smoke run has none by design.
});
test.skip("collection → product → cart → checkout journey", async () => {
  // plan §6 acceptance journey; needs a deployed backend with seeded catalog (Task 24 Step 9).
});
test.skip("order → tracking journey", async () => {
  // needs a deployed backend plus a routed test order (Task 24 Step 9).
});

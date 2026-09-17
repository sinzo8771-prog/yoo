#!/usr/bin/env node
/**
 * End-to-end verification for the checkout handoff (Task 9) — test-payment mode.
 *
 * The dev backend has no gateway credentials (Stripe/PayPal), so a *settled*
 * order is not reachable here; `settlePaymentSession` fails closed for manual
 * tender and for sessions without a provider reference. This script verifies
 * the deterministic parts of the contract instead — everything that must hold
 * regardless of which gateway is configured:
 *
 *   1. A signed guest cart with a line item can REACH payment/checkout: the
 *      storefront /us/checkout renders the checkout container from the proof
 *      cookie.
 *   2. Negative control: /us/checkout without a cart cookie is a 404 — no
 *      anonymous checkout page is exposed.
 *   3. `completeActiveCart` WITHOUT the signed proof is rejected (Task 9
 *      Step 1 — cart ownership is proven on every completion call).
 *   4. A signed GUEST completion with no payment session is rejected
 *      ("Authentication required for account orders") — an unauthenticated
 *      caller can never mint an account order.
 *   5. A signed completion with a bogus payment session is rejected
 *      ("Payment session not found") — no fabricated success.
 *   6. Failed-attempt behavior: the cart retains its line item and a retry
 *      returns the same rejection without a success response. This does NOT
 *      verify inventory release, payment settlement, or exactly-once creation.
 *
 * Usage:
 *   node --experimental-strip-types scripts/verify-checkout-e2e.mjs
 *
 * Requires the backend (default http://localhost:3001) and the built storefront
 * (default http://localhost:3000) to be running. Override with BACKEND_URL /
 * STOREFRONT_URL.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STORE = resolve(ROOT, "store");
const BACKEND = process.env.BACKEND_URL || "http://localhost:3001";
const STOREFRONT = process.env.STOREFRONT_URL || "http://localhost:3000";
const VARIANT_ID =
  process.env.E2E_VARIANT_ID || "devfix_variant_stoneware_mug_250ml";

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

// The store's OWN proof module — verify the real crypto, not a copy.
const env = readFileSync(resolve(STORE, ".env"), "utf8");
const secret = env.match(/^SESSION_SECRET="?([^"\r\n]+)"?/m)?.[1];
if (!secret) throw new Error("SESSION_SECRET not found in store/.env");
process.env.SESSION_SECRET = secret;
const { createCartProof } = await import(
  pathToFileURL(resolve(STORE, "features/storefront/lib/security/token-crypto.ts")).href
);

async function gql(query, variables = {}, headers = {}) {
  const res = await fetch(`${BACKEND}/api/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ query, variables }),
  });
  return { status: res.status, json: await res.json() };
}

// Development GraphQL masks public messages but includes the original error.
// Exact gate assertions intentionally fail if neither message is available.
const errorMessage = (response) =>
  response?.errors?.[0]?.extensions?.originalError?.message ||
  response?.errors?.[0]?.message || "";

// ── Setup: a signed guest cart with a line item ────────────────────────────
const { json: regionRes } = await gql(
  `query { regions(where: { countries: { some: { iso2: { equals: "us" } } } }) { id } }`
);
const regionId = regionRes?.data?.regions?.[0]?.id;
check('region for "us" resolved', Boolean(regionId), regionId);

const { json: created } = await gql(
  `mutation CreateCart($data: CartCreateInput!) { createCart(data: $data) { id } }`,
  { data: { region: { connect: { id: regionId } } } }
);
const cartId = created?.data?.createCart?.id;
check("cart created on backend", Boolean(cartId), cartId);
const proof = createCartProof(cartId);

const ADD = `mutation UpdateActiveCart($cartId: ID!, $data: CartUpdateInput!) {
  updateActiveCart(cartId: $cartId, data: $data) { id }
}`;
const addVars = {
  cartId,
  data: {
    lineItems: {
      create: [
        {
          productVariant: { connect: { id: VARIANT_ID } },
          quantity: 1,
        },
      ],
    },
  },
};
const { json: signed } = await gql(ADD, addVars, {
  "x-openfront-cart-proof": proof,
});
check("signed cart write is accepted", !signed?.errors, JSON.stringify(signed?.errors));

const COMPLETE = `mutation CompleteCart($cartId: ID!, $paymentSessionId: ID) {
  completeActiveCart(cartId: $cartId, paymentSessionId: $paymentSessionId)
}`;

// ── 1. The storefront checkout renders from the proof cookie ────────────────
const checkoutRes = await fetch(`${STOREFRONT}/us/checkout`, {
  headers: { cookie: `_openfront_cart_id=${proof}` },
});
const checkoutHtml = await checkoutRes.text();
check(
  "storefront /us/checkout responds 200 with the cart proof",
  checkoutRes.status === 200,
  String(checkoutRes.status)
);
check(
  "checkout renders the checkout container",
  checkoutRes.status === 200 &&
    checkoutHtml.includes('data-testid="checkout-container"'),
  "render markers"
);

// ── 2. Negative control: no cart cookie → no anonymous checkout ─────────────
const anonRes = await fetch(`${STOREFRONT}/us/checkout`);
check(
  "checkout without a cart cookie returns 404",
  anonRes.status === 404,
  String(anonRes.status)
);

// ── 3. UNSIGNED completion is rejected (cart ownership proven every call) ───
const { json: unsigned } = await gql(COMPLETE, { cartId, paymentSessionId: null });
check(
  "UNSIGNED completeActiveCart is rejected by the backend",
  Boolean(unsigned?.errors),
  unsigned?.errors?.[0]?.message
);

// ── 4. Signed GUEST completion without payment → account-order rejection ────
const { json: guestNoPay } = await gql(
  COMPLETE,
  { cartId, paymentSessionId: null },
  { "x-openfront-cart-proof": proof }
);
check(
  "signed guest completion without payment is rejected",
  Boolean(guestNoPay?.errors),
  guestNoPay?.errors?.[0]?.message
);
check(
  "rejection is the account-order auth gate",
  /Authentication required/i.test(errorMessage(guestNoPay)),
  errorMessage(guestNoPay)
);

// ── 5. Signed completion with a bogus payment session → fabricated success ──
const { json: bogusPay } = await gql(
  COMPLETE,
  { cartId, paymentSessionId: "cmps_does_not_exist" },
  { "x-openfront-cart-proof": proof }
);
check(
  "signed completion with a bogus payment session is rejected",
  Boolean(bogusPay?.errors),
  bogusPay?.errors?.[0]?.message
);
check(
  "rejection is the payment-session lookup gate",
  /Payment session not found/i.test(errorMessage(bogusPay)),
  errorMessage(bogusPay)
);

// ── 6. Cart line-item integrity after failed attempts ─────────────────────
const { json: reread } = await gql(
  `query GetCart($cartId: ID!) { activeCart(cartId: $cartId) }`,
  { cartId },
  { "x-openfront-cart-proof": proof }
);
const rawCart = reread?.data?.activeCart;
const cart = typeof rawCart === "string" ? JSON.parse(rawCart) : rawCart;
const persisted = cart?.lineItems ?? [];
check(
  "cart is still active with its line item after failed completions",
  persisted.length === 1 && persisted[0]?.quantity === 1,
  JSON.stringify(persisted)
);

const { json: retry } = await gql(
  COMPLETE,
  { cartId, paymentSessionId: null },
  { "x-openfront-cart-proof": proof }
);
check(
  "retry is rejected with the same error and no success response",
  retry?.errors?.length > 0 && retry?.data?.completeActiveCart === null &&
    errorMessage(retry) === errorMessage(guestNoPay),
  errorMessage(retry)
);

console.log(
  failures === 0
    ? "\nE2E: PASS — checkout handoff authorization contract (test-payment mode)"
    : `\nE2E: FAIL (${failures} check(s) failed)`
);
process.exit(failures === 0 ? 0 : 1);

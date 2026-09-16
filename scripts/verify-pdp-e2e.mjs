#!/usr/bin/env node
/**
 * End-to-end verification for the product detail page (Task 6) and the
 * add-to-cart path.
 *
 * Dependency-free (Node 18+ global fetch; run with `--experimental-strip-types`
 * on Node 22/24 so the store's own proof module can be imported).
 *
 * Checks, in order:
 *   1. The PDP renders from live catalog data with its Task 6 markers, and its
 *      JSON-LD carries an ABSOLUTE `offers.url`.
 *   2. The Openfront backend resolves the `us` region and creates a cart.
 *   3. The store's OWN crypto mints a cart proof the backend accepts.
 *   4. Negative control: an UNSIGNED cart write is rejected by the backend
 *      (this is why the storefront must send `x-openfront-cart-proof`).
 *   5. The signed write persists a line item (re-read via `activeCart`).
 *   6. The storefront cart page renders that cart from the proof cookie, with a
 *      negative control proving an empty cart looks different.
 *
 * Usage:
 *   node --experimental-strip-types scripts/verify-pdp-e2e.mjs [handle]
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
const HANDLE = process.argv[2] || "dev-stoneware-mug";

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

// ── 1. PDP render + structured data ────────────────────────────────────────
const pdpUrl = `${STOREFRONT}/us/products/${HANDLE}`;
const pdpRes = await fetch(pdpUrl);
const pdpHtml = await pdpRes.text();
// JSON-LD is emitted through Next's script-push mechanism, so quotes inside the
// payload arrive escaped (\"@type\":\"Product\"). Decode before matching.
const decoded = pdpHtml.replace(/\\"/g, '"');

check(`PDP responds 200 (${pdpUrl})`, pdpRes.status === 200, String(pdpRes.status));
for (const marker of [
  'data-testid="product-detail"',
  'data-testid="product-price"',
  'data-testid="variant-selector"',
  'data-testid="add-to-cart"',
  '"@type":"Product"',
]) {
  check(`PDP contains ${marker}`, decoded.includes(marker));
}
check(
  "PDP JSON-LD offers.url is absolute",
  /"url":"https?:\/\/[^"]+\/us\/products\//.test(decoded)
);
const title = pdpHtml.match(/<h1[^>]*>([\s\S]{0,160}?)<\/h1>/i);
const titleText = title ? title[1].replace(/<[^>]+>/g, "").trim() : "";
check("PDP renders the catalog product title", titleText.length > 0, titleText);
const price = pdpHtml.match(/\$\s?\d+[.,]\d{2}/);
check("PDP renders a catalog price", Boolean(price), price?.[0]);
// ── 2-5. Cart proof flow against the backend ───────────────────────────────
const env = readFileSync(resolve(STORE, ".env"), "utf8");
const secret = env.match(/^SESSION_SECRET="?([^"\r\n]+)"?/m)?.[1];
if (!secret) throw new Error("SESSION_SECRET not found in store/.env");
process.env.SESSION_SECRET = secret;
check("store/.env defines SESSION_SECRET", secret.length >= 32, `${secret.length} chars`);

// Import the store's OWN proof module so we verify the real crypto, not a copy.
const { createCartProof, verifyCartProof } = await import(
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

// Mint the proof exactly as the store does on add-to-cart.
const proof = createCartProof(cartId);
check("store mints a proof for the cart", verifyCartProof(proof, cartId));

const ADD = `mutation UpdateActiveCart($cartId: ID!, $data: CartUpdateInput!) {
  updateActiveCart(cartId: $cartId, data: $data) { id }
}`;
const addVars = {
  cartId,
  data: {
    lineItems: {
      create: [
        {
          productVariant: { connect: { id: "devfix_variant_stoneware_mug_250ml" } },
          quantity: 2,
        },
      ],
    },
  },
};

// Negative control: an unsigned write must be rejected.
const { json: unsigned } = await gql(ADD, addVars);
check(
  "UNSIGNED cart write is rejected by the backend",
  Boolean(unsigned?.errors),
  unsigned?.errors?.[0]?.message
);

// With the proof the write is accepted.
const { json: signed } = await gql(ADD, addVars, {
  "x-openfront-cart-proof": proof,
});
check("signed cart write is accepted", !signed?.errors, JSON.stringify(signed?.errors));
// NOTE: `updateActiveCart` returns `Cart.updateOne` (a Prisma-level object), which
// does NOT resolve the GraphQL `lineItems` relation, so persistence has to be
// confirmed by re-reading. `activeCart` is a JSON scalar and takes no subselection.
const { json: reread } = await gql(
  `query GetCart($cartId: ID!) { activeCart(cartId: $cartId) }`,
  { cartId },
  { "x-openfront-cart-proof": proof }
);
const rawCart = reread?.data?.activeCart;
const cart = typeof rawCart === "string" ? JSON.parse(rawCart) : rawCart;
const persisted = cart?.lineItems ?? [];
check(
  "add-to-cart persists a line item (re-read via activeCart)",
  persisted.length === 1 && persisted[0]?.quantity === 2,
  JSON.stringify(persisted)
);

// ── 6. Storefront cart page reflects the cart for the proof cookie ─────────
const cartRes = await fetch(`${STOREFRONT}/us/cart`, {
  headers: { cookie: `_openfront_cart_id=${proof}` },
});
const cartHtml = await cartRes.text();
check("storefront /us/cart responds 200", cartRes.status === 200, String(cartRes.status));
check('cart page renders cart-container', cartHtml.includes('data-testid="cart-container"'));
// CartTemplate renders `empty-cart-message` only when there are no line items.
check(
  "cart page renders line items (not the empty state)",
  !cartHtml.includes('data-testid="empty-cart-message"')
);

// Negative control: an empty cart renders the empty state.
const { json: emptyCreated } = await gql(
  `mutation CreateCart($data: CartCreateInput!) { createCart(data: $data) { id } }`,
  { data: { region: { connect: { id: regionId } } } }
);
const emptyCartId = emptyCreated?.data?.createCart?.id;
const emptyProof = createCartProof(emptyCartId);
const emptyHtml = await (
  await fetch(`${STOREFRONT}/us/cart`, {
    headers: { cookie: `_openfront_cart_id=${emptyProof}` },
  })
).text();
check(
  "control: the empty cart renders the empty state",
  emptyHtml.includes('data-testid="empty-cart-message"'),
  `empty cart ${emptyCartId}`
);

console.log(
  failures === 0
    ? "\nE2E: PASS — PDP render → add-to-cart → backend → cart page"
    : `\nE2E: FAIL (${failures} check(s) failed)`
);
process.exit(failures === 0 ? 0 : 1);
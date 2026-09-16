/**
 * Cart-proof crypto tests.
 *
 * The Openfront backend (`features/keystone/security/cart-access.ts` @ 2b7181a)
 * refuses guest cart writes unless the caller proves possession of the cart with
 * a signed proof. These tests pin the exact contract we must satisfy:
 *
 *   - a proof we mint verifies for its own cart id
 *   - a raw cart id (no signature) is NEVER accepted as proof
 *   - a proof for another cart / a tampered or expired proof is rejected
 *
 * The secret is provided by `tests/setup.ts` (same requirement as the backend:
 * CREDENTIAL_PEPPER or SESSION_SECRET, ≥32 chars).
 */
import { describe, expect, it } from "vitest";

import {
  cartIdFromProof,
  createCartProof,
  verifyCartProof,
} from "@/features/storefront/lib/security/token-crypto";

const CART = "cmu47x9id0000t1p4xb689fz1";

describe("cart proof minting/verification", () => {
  it("verifies a freshly minted proof for its own cart", () => {
    const proof = createCartProof(CART);
    expect(verifyCartProof(proof, CART)).toBe(true);
  });

  it("emits the v1.<cartId>.<expiresAt>.<signature> shape", () => {
    const proof = createCartProof(CART);
    const parts = proof.split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
    expect(parts[1]).toBe(CART);
    expect(parts[2]).toMatch(/^\d+$/);
    expect(parts[3]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a raw cart id — the pre-hardening cookie value", () => {
    // This is the regression guard: an unsigned cart id must never pass.
    expect(verifyCartProof(CART, CART)).toBe(false);
  });

  it("rejects undefined or empty proofs", () => {
    expect(verifyCartProof(undefined, CART)).toBe(false);
    expect(verifyCartProof("", CART)).toBe(false);
  });

  it("rejects a proof minted for a different cart", () => {
    const proof = createCartProof("some-other-cart");
    expect(verifyCartProof(proof, CART)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const proof = createCartProof(CART);
    const tampered = `${proof.slice(0, -1)}${proof.endsWith("0") ? "1" : "0"}`;
    expect(verifyCartProof(tampered, CART)).toBe(false);
  });

  it("rejects an expired proof", () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const proof = createCartProof(CART, { expiresAt: past });
    expect(verifyCartProof(proof, CART)).toBe(false);
    // ...and it would have been valid before it expired.
    expect(verifyCartProof(proof, CART, { now: past - 60 })).toBe(true);
  });

  it("rejects a proof signed with a different secret", () => {
    const otherSecret = "a-completely-different-secret-value-32+chars";
    const proof = createCartProof(CART, { secret: otherSecret });
    expect(verifyCartProof(proof, CART)).toBe(false);
    expect(verifyCartProof(proof, CART, { secret: otherSecret })).toBe(true);
  });

  it("refuses to mint a proof without a cart id", () => {
    expect(() => createCartProof("")).toThrow("Cart ID is required");
  });
});

describe("cartIdFromProof", () => {
  it("extracts the cart id from a valid-shaped proof", () => {
    expect(cartIdFromProof(createCartProof(CART))).toBe(CART);
  });

  it("returns undefined for a raw cart id or missing proof", () => {
    expect(cartIdFromProof(CART)).toBeUndefined();
    expect(cartIdFromProof(undefined)).toBeUndefined();
  });
});

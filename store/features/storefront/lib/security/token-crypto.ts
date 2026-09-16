import crypto from "node:crypto";

/**
 * Cart / credential token crypto (ported from `openfront/features/keystone/security/token-crypto.ts`).
 *
 * The Openfront backend gates cart mutations behind `assertCartAccess`, which for
 * anonymous (guest) callers requires a *signed* possession proof:
 *
 *   v1.<cartId>.<expiresAt>.<hmac-sha256>
 *
 * The raw cart ID is NOT accepted as proof. The storefront therefore stores the
 * signed proof in the `_openfront_cart_id` cookie and forwards it to the backend
 * as the `x-openfront-cart-proof` header (see `lib/data/cookies.ts`).
 *
 * The HMAC secret MUST be the same value the backend uses (`CREDENTIAL_PEPPER`
 * or `SESSION_SECRET`) or the backend will reject every proof we mint.
 */

const CART_PROOF_VERSION = "v1";
const DEFAULT_CART_PROOF_TTL_SECONDS = 60 * 60 * 24 * 7;

function requireSecret(purpose: string, explicitSecret?: string): string {
  const secret =
    explicitSecret ||
    process.env.CREDENTIAL_PEPPER ||
    process.env.SESSION_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      `${purpose} requires CREDENTIAL_PEPPER or SESSION_SECRET with at least 32 characters`
    );
  }

  return secret;
}

export function digestCredential(
  value: string,
  purpose: string,
  explicitSecret?: string
): string {
  const secret = requireSecret(purpose, explicitSecret);
  return crypto
    .createHmac("sha256", secret)
    .update(`${purpose}\0${value}`, "utf8")
    .digest("hex");
}

export function verifyCredentialDigest(
  value: string,
  expectedDigest: string,
  purpose: string,
  explicitSecret?: string
): boolean {
  if (!value || !expectedDigest) return false;
  const actual = Buffer.from(
    digestCredential(value, purpose, explicitSecret),
    "hex"
  );
  const expected = Buffer.from(expectedDigest, "hex");
  return (
    actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
  );
}

export function createCartProof(
  cartId: string,
  options: { secret?: string; expiresAt?: number } = {}
): string {
  if (!cartId) throw new Error("Cart ID is required");
  const expiresAt =
    options.expiresAt ||
    Math.floor(Date.now() / 1000) + DEFAULT_CART_PROOF_TTL_SECONDS;
  const payload = `${CART_PROOF_VERSION}.${cartId}.${expiresAt}`;
  const signature = digestCredential(payload, "cart-proof", options.secret);
  return `${payload}.${signature}`;
}

export function verifyCartProof(
  proof: string | undefined,
  cartId: string,
  options: { secret?: string; now?: number } = {}
): boolean {
  if (!proof || !cartId) return false;
  const [version, proofCartId, expiresAtRaw, signature, ...extra] =
    proof.split(".");
  if (
    extra.length ||
    version !== CART_PROOF_VERSION ||
    proofCartId !== cartId ||
    !/^\d+$/.test(expiresAtRaw || "") ||
    !/^[a-f0-9]{64}$/.test(signature || "")
  ) {
    return false;
  }

  const expiresAt = Number(expiresAtRaw);
  const now = options.now || Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;

  return verifyCredentialDigest(
    `${version}.${proofCartId}.${expiresAt}`,
    signature,
    "cart-proof",
    options.secret
  );
}

export function cartIdFromProof(proof: string | undefined): string | undefined {
  if (!proof) return undefined;
  const [version, cartId] = proof.split(".");
  return version === CART_PROOF_VERSION && cartId ? cartId : undefined;
}

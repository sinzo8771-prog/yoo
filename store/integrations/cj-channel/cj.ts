/**
 * CJdropshipping fulfillment channel adapter (Task 12 preparation).
 *
 * Placement: this file is the tracked source of truth. OpenShip loads adapters
 * by dynamic import of `integrations/channel/<platform field value>.ts`, so a
 * copy must be placed at `openship/features/integrations/channel/cj.ts`. That
 * checkout is git-ignored by the parent repo, exactly like the mirrored
 * synthetic adapter. Copy it; never edit the copy.
 *
 * SAFETY - read before changing:
 *  - Only the read paths are implemented against a verified contract: product
 *    search, variant lookup and per-warehouse stock. Those were exercised
 *    against the live CJ API read-only.
 *  - Every write path (purchase creation, supplier cancellation, webhook
 *    lifecycle, OAuth) fails closed with a specific reason. That is deliberate,
 *    not an oversight: see docs/ops/adding-a-supplier-provider.md sections 7
 *    and 10. Purchase creation in particular cannot be retried safely yet,
 *    because OpenShip's createChannelPurchase mutation never forwards order
 *    identity or channel credentials to the adapter, and CJ documents no
 *    idempotency key for order creation.
 *  - No live purchase, cancellation, or webhook registration is authorized.
 *
 * Verified CJ facts encoded here:
 *  - Auth is the `CJ-Access-Token` header. The credential is account-wide, so it
 *    is read from server environment; a caller-supplied value wins.
 *  - CJ answers HTTP 200 with its own envelope (`code`, `result`). HTTP 200
 *    alone is NOT success, so `code`/`result` are always checked.
 *  - CJ serializes ids as JSON strings (`"vid":"2502251050461617900"`). Ids are
 *    19 digits, past Number.MAX_SAFE_INTEGER, so they are kept as strings and
 *    never coerced to numbers.
 *  - `product/listV2` nests products at `data.content[0].productList[]`, NOT at
 *    `data.content[]`.
 *  - `product/variant/query` is GET (POST is rejected, code 16900202) and does
 *    NOT carry stock. Per-warehouse stock is a separate `product/stock/queryByVid`.
 *  - Rapid repeats return HTTP 429 (documented ~10 req/s per IP), so reads are
 *    retried within a bounded budget and writes are never retried.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

// Task 18: outbound-URL guard. NOTE for the OpenShip mirror
// (`openship/features/integrations/channel/cj.ts`): this module path must exist
// next to the adapter in that tree too — copy `store/lib/security/ssrf.ts`
// alongside the adapter when placing it (see docs/ops/adding-a-supplier-provider.md).
import { assertOutboundUrl, providerUrlAllowPrivate } from "../../lib/security/ssrf";

const DEFAULT_BASE_URL = "https://developers.cjdropshipping.com/api2.0/v1";
const SEARCH_PAGE_SIZE = 20;
/** Digit runs at or above this length can exceed Number.MAX_SAFE_INTEGER. */
const MAX_SAFE_DIGIT_RUN = 16;
const READ_RETRY_ATTEMPTS = 3;
const READ_RETRY_BASE_DELAY_MS = 1000;

/** Subset of the ChannelProduct GraphQL type this adapter returns. */
export type CjChannelProduct = {
  image: string | null;
  title: string | null;
  productId: string | null;
  variantId: string | null;
  price: string | null;
  availableForSale: boolean | null;
  productLink: string | null;
  inventory: number | null;
  inventoryTracked: boolean | null;
  error?: string | null;
};

export type CjCartItem = { variantId: string; quantity: number };

type CjConfig = { baseUrl: string; accessToken: string };

/** Raised when CJ reports failure in its own envelope, or transport fails. */
export class CjApiError extends Error {
  readonly code: number | string | null;
  constructor(message: string, code: number | string | null = null) {
    super(message);
    this.name = "CjApiError";
    this.code = code;
  }
}

/**
 * Quote bare integer literals long enough to lose precision through
 * `JSON.parse`. CJ currently sends ids quoted, but an endpoint that sent them
 * bare would otherwise silently produce a *different* id, which surfaces as
 * "product not found" rather than as a parsing bug. String-aware, so digits
 * inside string values are never touched.
 */
export function quoteLongIntegerLiterals(raw: string): string {
  let out = "";
  let inString = false;
  let index = 0;
  while (index < raw.length) {
    const char = raw[index];
    if (inString) {
      out += char;
      if (char === "\\") {
        out += raw[index + 1] ?? "";
        index += 2;
        continue;
      }
      if (char === '"') inString = false;
      index += 1;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      index += 1;
      continue;
    }
    if (char >= "0" && char <= "9") {
      let end = index;
      while (end < raw.length && raw[end] >= "0" && raw[end] <= "9") end += 1;
      const digits = raw.slice(index, end);
      const before = index === 0 ? "" : raw[index - 1];
      const after = end >= raw.length ? "" : raw[end];
      const standalone =
        (before === "" || ",:[]{} \n\r\t".includes(before)) &&
        (after === "" || ",}] \n\r\t".includes(after));
      out += standalone && digits.length >= MAX_SAFE_DIGIT_RUN ? `"${digits}"` : digits;
      index = end;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

/** Parse a CJ response body without ever losing id precision. */
export function parseCjJson(text: string): unknown {
  return JSON.parse(quoteLongIntegerLiterals(text));
}

// ---- request layer --------------------------------------------------------

function resolveConfig(platform: Record<string, unknown>): CjConfig {
  const supplied = typeof platform?.accessToken === "string" ? platform.accessToken.trim() : "";
  const accessToken = supplied || String(process.env.CJ_ACCESS_TOKEN ?? "").trim();
  if (!accessToken) {
    throw new CjApiError(
      "CJ access token is not configured. Set CJ_ACCESS_TOKEN in the OpenShip server " +
        "environment, or supply platform.accessToken. See " +
        "docs/ops/adding-a-supplier-provider.md section 8.",
    );
  }
  // The token is long-lived (~180 days) and its expiry is recorded next to it.
  const expiresAt = String(process.env.CJ_ACCESS_TOKEN_EXPIRES_AT ?? "").trim();
  if (expiresAt) {
    const expiry = Date.parse(expiresAt);
    if (Number.isFinite(expiry) && expiry <= Date.now()) {
      throw new CjApiError(`CJ access token expired at ${expiresAt}; refresh it before use.`);
    }
  }
  const platformBase = typeof platform?.baseUrl === "string" ? platform.baseUrl.trim() : "";
  return {
    baseUrl: platformBase || String(process.env.CJ_API_BASE ?? "").trim() || DEFAULT_BASE_URL,
    accessToken,
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Issue one CJ call and unwrap its envelope.
 *
 * Reads (`GET`) are retried on HTTP 429 only, within a bounded budget, because
 * throttling is indistinguishable from a bad request until you pause. Writes
 * are never retried: see the module header.
 */
async function cjRequest(
  config: CjConfig,
  path: string,
  options: { query?: Record<string, string>; body?: unknown } = {},
): Promise<any> {
  // Task 18: the base URL is configuration (OpenShip `platform.baseUrl` from the
  // database, or `CJ_API_BASE` from the environment), so it is re-validated on
  // every call: https only, no embedded credentials, and no loopback/private/
  // link-local targets unless ALLOW_PRIVATE_PROVIDER_URLS=true in a
  // non-production build (local development against a stub endpoint).
  let url: URL;
  try {
    url = assertOutboundUrl(`${config.baseUrl}${path}`, {
      allowPrivate: providerUrlAllowPrivate(),
    });
  } catch (error) {
    throw new CjApiError(
      `CJ provider URL rejected: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }
  const isWrite = options.body !== undefined;
  const attempts = isWrite ? 1 : READ_RETRY_ATTEMPTS;

  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(READ_RETRY_BASE_DELAY_MS * attempt);

    let response: Response;
    try {
      response = await globalThis.fetch(url.toString(), {
        method: isWrite ? "POST" : "GET",
        headers: {
          "CJ-Access-Token": config.accessToken,
          ...(isWrite ? { "Content-Type": "application/json" } : {}),
        },
        ...(isWrite ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch (error) {
      lastError = new CjApiError(
        `CJ request to ${path} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    if (response.status === 429) {
      lastError = new CjApiError(`CJ throttled the request to ${path} (HTTP 429).`, 429);
      continue;
    }
    if (!response.ok) {
      throw new CjApiError(`CJ request to ${path} failed with HTTP ${response.status}.`, response.status);
    }

    const envelope = parseCjJson(await response.text()) as
      | { code?: number | string; result?: unknown; message?: string; data?: unknown }
      | null;
    if (!envelope || typeof envelope !== "object") {
      throw new CjApiError(`CJ returned an unreadable body for ${path}.`);
    }
    // HTTP 200 alone is not success: CJ reports failure inside its own envelope.
    const ok = String(envelope.code) === "200" && String(envelope.result) === "true";
    if (!ok) {
      throw new CjApiError(
        `CJ rejected ${path}: code=${String(envelope.code)} message=${String(envelope.message ?? "no message").trim()}`,
        envelope.code ?? null,
      );
    }
    return envelope.data;
  }
  throw lastError ?? new CjApiError(`CJ request to ${path} failed.`);
}

// ---- verified read operations --------------------------------------------

const asText = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
};

const asCount = (value: unknown): number | null => {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
};

/**
 * Products live at `data.content[0].productList[]`. Other shapes put them at
 * `data.content[]` or `data.list[]`, so all three are accepted rather than
 * silently returning nothing.
 */
function extractListedProducts(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    const first = data[0] as Record<string, unknown> | undefined;
    if (first && Array.isArray(first.productList)) {
      return first.productList as Record<string, unknown>[];
    }
    return data as Record<string, unknown>[];
  }
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.productList)) return record.productList as Record<string, unknown>[];
    // `content` (the verified live shape wraps rows at content[0].productList)
    // and `list` are checked identically.
    for (const key of ["content", "list"] as const) {
      const rows = record[key];
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const first = rows[0] as Record<string, unknown> | undefined;
      if (first && Array.isArray(first.productList)) {
        return first.productList as Record<string, unknown>[];
      }
      return rows as Record<string, unknown>[];
    }
  }
  return [];
}

/**
 * `searchProductsFunction` - product discovery for the matching UI.
 *
 * Verified call: `GET /product/listV2?page=&size=&keyWord=`. `after` carries the
 * page number, because the ChannelProduct GraphQL type has no cursor field.
 *
 * `sellPrice` is a RANGE STRING (`"11.09 -- 17.07"`), never a number, so it is
 * passed through verbatim; variant-level numeric pricing comes from
 * `getProductFunction`. `warehouseInventoryNum` is CJ's aggregate figure, used
 * here for `inventory`/`availableForSale` as an inference. `productLink` stays
 * null rather than guessing a URL pattern.
 */
export async function searchProductsFunction({
  platform,
  searchEntry,
  after,
}: {
  platform: Record<string, unknown>;
  searchEntry: string;
  after?: string;
}): Promise<{ products: CjChannelProduct[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }> {
  const config = resolveConfig(platform);
  const parsedPage = Number.parseInt(String(after ?? "1"), 10);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

  const data = await cjRequest(config, "/product/listV2", {
    query: { page: String(page), size: String(SEARCH_PAGE_SIZE), keyWord: String(searchEntry ?? "") },
  });

  const record = (data ?? {}) as Record<string, unknown>;
  const products: CjChannelProduct[] = extractListedProducts(data).map((item) => {
    const inventory = asCount(item.warehouseInventoryNum ?? item.totalVerifiedInventory);
    return {
      image: asText(item.bigImage ?? item.productImage),
      title: asText(item.nameEn ?? item.productNameEn ?? item.productName),
      productId: asText(item.id ?? item.pid),
      // `listV2` is product-level; variants are resolved by getProductFunction.
      variantId: null,
      price: asText(item.sellPrice),
      availableForSale: inventory === null ? null : inventory > 0,
      productLink: null,
      inventory,
      inventoryTracked: true,
    };
  });

  const totalPages = asCount(record.totalPages);
  const pageNumber = asCount(record.pageNumber) ?? page;
  const hasNextPage =
    totalPages !== null ? pageNumber < totalPages : products.length >= SEARCH_PAGE_SIZE;
  return { products, pageInfo: { hasNextPage, endCursor: hasNextPage ? String(page + 1) : null } };
}

/**
 * `getProductFunction` - resolve one variant of one product.
 *
 * Verified call: `GET /product/variant/query?pid=<productId>` (POST returns
 * 16900202). This is the call that yields the sellable identity stored in Match
 * rows: `vid` + `variantSku`, plus numeric `variantSellPrice` and weight.
 *
 * It does NOT carry stock (`inventoryNum`/`inventories` come back null), so
 * `inventory` is null here by design; use `getInventoryByVid` for stock.
 */
export async function getProductFunction({
  platform,
  productId,
  variantId,
}: {
  platform: Record<string, unknown>;
  productId: string;
  variantId?: string;
}): Promise<{ product: CjChannelProduct }> {
  const config = resolveConfig(platform);
  const pid = asText(productId);
  if (!pid) throw new CjApiError("CJ product lookup requires a productId.");

  const data = await cjRequest(config, "/product/variant/query", { query: { pid } });
  const variants = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
  if (variants.length === 0) {
    throw new CjApiError(`CJ returned no variants for product ${pid}.`);
  }

  let variant = variants[0];
  if (variantId) {
    const wanted = String(variantId).trim();
    // Ids are opaque strings: compare as text, never as numbers.
    const found = variants.find((candidate) => asText(candidate.vid) === wanted);
    if (!found) {
      throw new CjApiError(
        `CJ product ${pid} has no variant ${wanted}; ${variants.length} variant(s) exist.`,
      );
    }
    variant = found;
  }

  return {
    product: {
      image: asText(variant.variantImage),
      title: asText(variant.variantNameEn ?? variant.variantName),
      productId: asText(variant.pid) ?? pid,
      variantId: asText(variant.vid),
      price: asText(variant.variantSellPrice),
      availableForSale: null,
      productLink: null,
      inventory: null,
      inventoryTracked: true,
    },
  };
}

export type CjWarehouseStock = {
  vid: string | null;
  countryCode: string | null;
  warehouse: string | null;
  storageNum: number | null;
  totalInventoryNum: number | null;
};

/**
 * Per-warehouse stock. This is the ONLY call that proves *where* stock sits:
 * `variant/query` and `productDetail/query` both return null inventory. Accepts
 * numeric and UUID vids (both verified live), so a US warehouse can be confirmed
 * before a listing is promoted.
 */
export async function getInventoryByVid({
  platform,
  variantId,
}: {
  platform: Record<string, unknown>;
  variantId: string;
}): Promise<CjWarehouseStock[]> {
  const config = resolveConfig(platform);
  const vid = asText(variantId);
  if (!vid) throw new CjApiError("CJ stock lookup requires a variantId.");

  const data = await cjRequest(config, "/product/stock/queryByVid", { query: { vid } });
  return ((Array.isArray(data) ? data : []) as Record<string, unknown>[]).map((row) => ({
    vid,
    countryCode: asText(row.countryCode),
    warehouse: asText(row.areaEn ?? row.area),
    storageNum: asCount(row.storageNum),
    totalInventoryNum: asCount(row.totalInventoryNum),
  }));
}

// ---- fail-closed write paths ---------------------------------------------

const INTEGRATION_DOC = "docs/ops/adding-a-supplier-provider.md";

/**
 * Validate a purchase request before any supplier contact. Kept separate so the
 * validation is testable while the supplier call stays disabled.
 */
export function validateCartItems(
  cartItems: unknown,
): { ok: true; items: CjCartItem[] } | { ok: false; error: string } {
  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    return { ok: false, error: "CJ purchase requires at least one cart item." };
  }
  const items: CjCartItem[] = [];
  for (const raw of cartItems) {
    const record = (raw ?? {}) as Record<string, unknown>;
    const variantId = asText(record.variantId);
    const quantity = record.quantity;
    if (
      !variantId ||
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity <= 0
    ) {
      return {
        ok: false,
        error: `CJ purchase rejected a malformed cart item: ${JSON.stringify(raw)}`,
      };
    }
    items.push({ variantId, quantity });
  }
  return { ok: true, items };
}

/**
 * `createPurchaseFunction` - deliberately does NOT place an order.
 *
 * This is a hard gate, not a stub awaiting a one-line fill-in. Two independent
 * blockers must both be cleared first, and neither is a coding task alone:
 *
 *  1. OpenShip's createChannelPurchase mutation destructures `channelId` from an
 *     input that only defines `shopId`, so the channel lookup gets `undefined`
 *     and the mutation cannot succeed at all. It also drops `orderId` (the only
 *     order identity the schema carries) and never forwards the channel
 *     credentials it queried. A retry therefore cannot be distinguished from a
 *     fresh order.
 *  2. CJ documents no idempotency key on order creation, so a duplicated call is
 *     a duplicated supplier order and a real charge.
 *
 * The return shape matters: `createChannelPurchase` detects failure by testing
 * `result.error`, so this must RETURN an error rather than throw.
 */
export async function createPurchaseFunction({
  cartItems,
  idempotencyKey,
}: {
  platform: Record<string, unknown>;
  cartItems: unknown;
  shipping?: unknown;
  notes?: string;
  idempotencyKey?: string;
}): Promise<{ error: string }> {
  const validated = validateCartItems(cartItems);
  if (!validated.ok) return { error: validated.error };

  if (!asText(idempotencyKey)) {
    return {
      error:
        "CJ purchase refused: no idempotency key reached the adapter. OpenShip's " +
        `createChannelPurchase mutation does not forward one. See ${INTEGRATION_DOC} section 7.`,
    };
  }

  return {
    error:
      "CJ purchase refused: order creation is not enabled. CJ documents no " +
      "idempotency key for order creation and the ordering contract has not been " +
      "verified against a sandbox, so a retry could create a duplicate supplier " +
      `order and a real charge. See ${INTEGRATION_DOC} sections 7 and 10.`,
  };
}

/**
 * `cancelPurchase` - supplier-side cancellation. Not a pinned ChannelPlatform
 * slot, but exposed because OpenShip's cancelPurchase mutation only rewrites
 * local status and would otherwise leave a "cancelled" order that still ships.
 */
export async function cancelPurchase({ purchaseId }: { purchaseId: string }): Promise<{ error: string }> {
  return {
    error:
      `CJ supplier-side cancellation of ${String(purchaseId)} is not enabled. ` +
      "OpenShip's cancelPurchase mutation changes local status only, so a locally " +
      `cancelled order may still ship. See ${INTEGRATION_DOC} section 7.`,
  };
}

// ---- webhooks ------------------------------------------------------------

const readHeader = (headers: unknown, name: string): string | null => {
  if (!headers || typeof headers !== "object") return null;
  const record = headers as Record<string, unknown>;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === wanted) return asText(value);
  }
  return null;
};

/**
 * CJ's documented scheme: `Base64(HMAC-SHA256(secret = the account openId, raw
 * request body))`. Implemented and unit-tested; not yet exercised against a live
 * delivery, because that needs a purchase to exist.
 *
 * Comparison is constant-time and length-checked, so a malformed or empty
 * signature cannot throw its way into an accepted event.
 */
export function verifyCjWebhookSignature({
  rawBody,
  signature,
  secret,
}: {
  rawBody: string | null | undefined;
  signature: string | null | undefined;
  secret: string | null | undefined;
}): boolean {
  if (!rawBody || !signature || !secret) return false;
  const expected = createHmac("sha256", String(secret)).update(rawBody).digest("base64");
  const received = Buffer.from(String(signature).trim());
  const computed = Buffer.from(expected);
  if (received.length !== computed.length) return false;
  return timingSafeEqual(received, computed);
}

/**
 * `createTrackingWebhookHandler` - fails closed.
 *
 * Two independent reasons, both verified in the pinned checkout:
 *
 *  1. OpenShip's route at
 *     `app/api/handlers/channel/create-tracking/[channelId]/route.ts` calls
 *     `await request.json()` before dispatch, so only PARSED JSON reaches the
 *     adapter. HMAC over the raw body cannot be recomputed from it, and the route
 *     does not forward a raw-body field. Accepting the event anyway would let
 *     anyone who learns the channel URL inject tracking numbers onto real orders.
 *     `verifyCjWebhookSignature` above is ready for when raw bytes are available.
 *  2. CJ's order-status webhook payload has not been observed, so mapping its
 *     fields (`purchaseId`, `trackingNumber`, `trackingCompany`, partial
 *     shipments) would be guesswork presented as an integration.
 */
export async function createTrackingWebhookHandler({
  headers,
}: {
  platform: Record<string, unknown>;
  event: unknown;
  headers: Record<string, string>;
}): Promise<never> {
  const signature = readHeader(headers, "cj-signature") ?? readHeader(headers, "x-cj-signature");
  throw new CjApiError(
    "CJ tracking webhook rejected: the event cannot be trusted in this revision. " +
      (signature
        ? "A signature header was present, but "
        : "No signature header was present, and ") +
      "OpenShip's create-tracking route parses the JSON body before dispatch, so the " +
      "raw bytes required to verify CJ's HMAC are unavailable. The CJ order-status " +
      `payload is also unverified. See ${INTEGRATION_DOC} sections 6 and 10.`,
  );
}

/**
 * `cancelPurchaseWebhookHandler` - fails closed for the same signature and
 * payload reasons as the tracking handler. The pinned route also treats a thrown
 * error as a failed delivery, which is the correct outcome for an unverified
 * cancellation: it must never be allowed to cancel local orders unverified.
 */
export async function cancelPurchaseWebhookHandler({
  headers,
}: {
  platform: Record<string, unknown>;
  event: unknown;
  headers: Record<string, string>;
}): Promise<never> {
  const signature = readHeader(headers, "cj-signature") ?? readHeader(headers, "x-cj-signature");
  throw new CjApiError(
    "CJ cancellation webhook rejected: " +
      (signature ? "a signature was present but " : "no signature was present and ") +
      "the raw body needed to verify CJ's HMAC is not available to the adapter, and the " +
      `cancellation payload is unverified. See ${INTEGRATION_DOC} sections 6 and 10.`,
  );
}

// ---- remaining pinned ChannelPlatform slots ------------------------------
// A ChannelPlatform row requires all ten fields, so these exist to satisfy the
// contract and to fail loudly with a reason rather than a vague "unsupported".

const blockedSlot = (what: string, why: string) => async (): Promise<{ error: string }> => ({
  error: `CJ ${what} is not enabled: ${why} See ${INTEGRATION_DOC} sections 7 and 10.`,
});

export const createWebhookFunction = blockedSlot(
  "webhook registration",
  "Registering a callback is a supplier-side write and CJ's registration contract has not been verified.",
);
export const getWebhooksFunction = blockedSlot(
  "webhook listing",
  "It depends on the same unverified registration contract.",
);
export const deleteWebhookFunction = blockedSlot(
  "webhook deletion",
  "It depends on the same unverified registration contract.",
);
export const oAuthFunction = blockedSlot(
  "OAuth start",
  "CJ authenticates with one account-level OAuth2 token (CJ_ACCESS_TOKEN), not a per-shop app install, so this slot has no CJ equivalent.",
);
export const oAuthCallbackFunction = blockedSlot(
  "OAuth callback",
  "CJ authenticates with one account-level OAuth2 token (CJ_ACCESS_TOKEN), not a per-shop app install, so this slot has no CJ equivalent.",
);
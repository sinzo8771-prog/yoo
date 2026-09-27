import { createHmac } from "node:crypto";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import * as cj from "@/integrations/cj-channel/cj";

/**
 * Contract tests for the CJ adapter. No network: `globalThis.fetch` is stubbed,
 * so these prove request shape, envelope handling and id safety. They do NOT
 * prove live CJ behaviour - see docs/ops/adding-a-supplier-provider.md section 10.
 */

/** The ten ChannelPlatform slots. A row requires all of them to exist. */
const PINNED_SLOTS = [
  "searchProductsFunction",
  "getProductFunction",
  "createPurchaseFunction",
  "createWebhookFunction",
  "deleteWebhookFunction",
  "getWebhooksFunction",
  "oAuthFunction",
  "oAuthCallbackFunction",
  "createTrackingWebhookHandler",
  "cancelPurchaseWebhookHandler",
] as const;

const platform = { name: "cj", accessToken: "test-token" };

function jsonResponse(body: unknown, status = 200) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("CJ_ACCESS_TOKEN", "test-token");
  vi.stubEnv("CJ_ACCESS_TOKEN_EXPIRES_AT", "");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Real observed payload, trimmed. `content[0]` is an OBJECT holding
// `productList` - not an array of products.
const LIST_V2_BODY = {
  code: 200,
  result: true,
  message: "Success",
  data: {
    pageSize: 2,
    pageNumber: 1,
    totalRecords: 11,
    totalPages: 6,
    content: [
      {
        productList: [
          {
            id: "2502251050461617500",
            nameEn: "Retro Kiln Turned Tianmu Black Glazed Tea Ceremony Utensil",
            sku: "CJYD2307652",
            bigImage: "https://oss-cf.cjdropshipping.com/product/2025/02/25/10/x.jpg",
            sellPrice: "11.09 -- 17.07",
            nowPrice: null,
            categoryId: "CF330457-0E5B-4FAF-9BAE-7D2C247BD8DE",
            warehouseInventoryNum: 28529,
            supplierName: null,
            threeCategoryName: null,
          },
        ],
        relatedCategoryList: [],
        keyWord: "utensil crock",
        keyWordOld: null,
      },
    ],
  },
};

const VARIANT_BODY = {
  code: 200,
  result: true,
  message: "Success",
  data: [
    {
      vid: "2502251050461617900",
      pid: "2502251050461617500",
      variantNameEn: "Retro Kiln ... Single bowl",
      variantImage: "https://oss-cf.cjdropshipping.com/product/2025/02/25/10/y.jpg",
      variantSku: "CJYD230765201AZ",
      barcode: "1600006130709",
      variantKey: "Single bowl",
      variantWeight: 420.0,
      variantSellPrice: 11.09,
      variantProperty: "[]",
      inventoryNum: null,
      inventories: null,
    },
  ],
};

describe("CJ adapter - pinned ChannelPlatform contract", () => {
  it("exports all ten slots, matching the field-name-is-export rule", () => {
    for (const slot of PINNED_SLOTS) {
      expect(typeof (cj as Record<string, unknown>)[slot]).toBe("function");
    }
  });
});

describe("CJ adapter - id precision", () => {
  it("keeps a bare 19-digit id exact, where plain JSON.parse cannot", () => {
    const bare = '{"vid":2502251050461617900}';
    const naive = JSON.parse(bare) as { vid: number };
    // The damage is done by the numeric literal itself: this is the failure mode
    // that would surface as "product not found" rather than as a parsing bug.
    expect(String(naive.vid)).not.toBe("2502251050461617900");

    const safe = cj.parseCjJson(bare) as { vid: string };
    expect(safe.vid).toBe("2502251050461617900");
    expect(typeof safe.vid).toBe("string");
  });

  it("leaves short numbers and digits inside strings untouched", () => {
    const raw = '{"weight":420.5,"barcode":"1600006130709","createTime":1740480646000}';
    const parsed = cj.parseCjJson(raw) as Record<string, unknown>;
    expect(parsed.weight).toBe(420.5);
    expect(parsed.barcode).toBe("1600006130709");
    expect(parsed.createTime).toBe(1740480646000);
    expect(cj.quoteLongIntegerLiterals(raw)).toBe(raw);
  });

  it("does not quote a long digit run embedded in a decimal", () => {
    expect(cj.quoteLongIntegerLiterals('{"a":12345678901234567.5}')).toBe(
      '{"a":12345678901234567.5}',
    );
  });
});

describe("CJ adapter - envelope handling", () => {
  it("treats HTTP 200 with a failure code as an error, not a success", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: 16900202, result: false, message: "Invalid parameter" }),
    );
    await expect(
      cj.getProductFunction({ platform, productId: "2502251050461617500" }),
    ).rejects.toThrow(/code=16900202/);
  });

  it("rejects a 200 whose result flag is false", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 200, result: false, message: "nope" }));
    await expect(cj.searchProductsFunction({ platform, searchEntry: "crock" })).rejects.toThrow(
      /rejected/,
    );
  });

  it("retries a read after HTTP 429 and then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse(LIST_V2_BODY));
    const result = await cj.searchProductsFunction({ platform, searchEntry: "crock" });
    expect(result.products).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 10000);

  it("gives up after the bounded read retry budget is exhausted", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 429));
    await expect(cj.searchProductsFunction({ platform, searchEntry: "crock" })).rejects.toThrow(
      /429/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 15000);

  it("fails clearly when no token is configured", async () => {
    vi.stubEnv("CJ_ACCESS_TOKEN", "");
    await expect(cj.searchProductsFunction({ platform: {}, searchEntry: "crock" })).rejects.toThrow(
      /CJ_ACCESS_TOKEN/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an expired token without calling CJ", async () => {
    vi.stubEnv("CJ_ACCESS_TOKEN_EXPIRES_AT", "2020-01-01T00:00:00.000Z");
    await expect(cj.searchProductsFunction({ platform, searchEntry: "crock" })).rejects.toThrow(
      /expired/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("CJ adapter - read mapping", () => {
  it("reads products from the nested content[0].productList shape", async () => {
    fetchMock.mockResolvedValue(jsonResponse(LIST_V2_BODY));
    const { products, pageInfo } = await cj.searchProductsFunction({
      platform,
      searchEntry: "utensil crock",
    });

    expect(products).toHaveLength(1);
    const product = products[0];
    expect(product.productId).toBe("2502251050461617500");
    expect(product.title).toBe("Retro Kiln Turned Tianmu Black Glazed Tea Ceremony Utensil");
    expect(product.image).toContain("oss-cf.cjdropshipping.com");
    // A range string, passed through verbatim rather than coerced to a number.
    expect(product.price).toBe("11.09 -- 17.07");
    expect(product.inventory).toBe(28529);
    expect(product.availableForSale).toBe(true);
    // listV2 is product-level: variants come from getProductFunction.
    expect(product.variantId).toBeNull();
    // Not guessed.
    expect(product.productLink).toBeNull();

    expect(pageInfo).toEqual({ hasNextPage: true, endCursor: "2" });
  });

  it("sends a GET to listV2 with the token header and expected query", async () => {
    fetchMock.mockResolvedValue(jsonResponse(LIST_V2_BODY));
    await cj.searchProductsFunction({ platform, searchEntry: "utensil crock", after: "3" });

    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string> },
    ];
    expect(init.method).toBe("GET");
    expect(init.headers["CJ-Access-Token"]).toBe("test-token");
    const parsed = new URL(url);
    expect(parsed.pathname).toContain("/product/listV2");
    expect(parsed.searchParams.get("page")).toBe("3");
    expect(parsed.searchParams.get("keyWord")).toBe("utensil crock");
    expect(parsed.searchParams.get("size")).toBe("20");
  });

  it("matches a variant by vid as a string and returns { product }", async () => {
    fetchMock.mockResolvedValue(jsonResponse(VARIANT_BODY));
    const { product } = await cj.getProductFunction({
      platform,
      productId: "2502251050461617500",
      variantId: "2502251050461617900",
    });
    expect(product.variantId).toBe("2502251050461617900");
    expect(product.productId).toBe("2502251050461617500");
    expect(product.price).toBe("11.09");
    // variant/query does not carry stock.
    expect(product.inventory).toBeNull();
  });

  it("throws when the requested variant does not exist", async () => {
    fetchMock.mockResolvedValue(jsonResponse(VARIANT_BODY));
    await expect(
      cj.getProductFunction({
        platform,
        productId: "2502251050461617500",
        variantId: "9999999999999999999",
      }),
    ).rejects.toThrow(/no variant/);
  });

  it("maps per-warehouse stock, the only call that proves where stock sits", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        code: 200,
        result: true,
        message: "Success",
        data: [
          { countryCode: "CN", areaEn: "CN Warehouse", storageNum: 7899, totalInventoryNum: 7899 },
        ],
      }),
    );
    const rows = await cj.getInventoryByVid({ platform, variantId: "2502251050461617900" });
    expect(rows).toEqual([
      {
        vid: "2502251050461617900",
        countryCode: "CN",
        warehouse: "CN Warehouse",
        storageNum: 7899,
        totalInventoryNum: 7899,
      },
    ]);
  });
});

describe("CJ adapter - write paths fail closed", () => {
  it("validateCartItems accepts well-formed items and nothing else", () => {
    expect(cj.validateCartItems([{ variantId: "2502251050461617900", quantity: 2 }])).toEqual({
      ok: true,
      items: [{ variantId: "2502251050461617900", quantity: 2 }],
    });
    expect(cj.validateCartItems([]).ok).toBe(false);
    expect(cj.validateCartItems(undefined).ok).toBe(false);
    // quantity must be a positive integer: 0, fractional and string forms all fail.
    expect(cj.validateCartItems([{ variantId: "v", quantity: 0 }]).ok).toBe(false);
    expect(cj.validateCartItems([{ variantId: "v", quantity: 1.5 }]).ok).toBe(false);
    expect(cj.validateCartItems([{ variantId: "v", quantity: "2" }]).ok).toBe(false);
    expect(cj.validateCartItems([{ quantity: 2 }]).ok).toBe(false);
  });

  it("createPurchaseFunction RETURNS an error (never throws), and refuses without an idempotency key", async () => {
    const result = await cj.createPurchaseFunction({
      platform,
      cartItems: [{ variantId: "2502251050461617900", quantity: 1 }],
    });
    // createChannelPurchase detects failure by testing result.error.
    expect(result.error).toBeTruthy();
    expect(result.error).toMatch(/no idempotency key/);
    // Fail-closed means fail BEFORE any supplier contact.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("createPurchaseFunction still refuses even with an idempotency key - the gate is deliberate", async () => {
    const result = await cj.createPurchaseFunction({
      platform,
      cartItems: [{ variantId: "2502251050461617900", quantity: 1 }],
      idempotencyKey: "opaque-key-123",
    });
    expect(result.error).toMatch(/not enabled/);
    expect(result.error).toMatch(/duplicate supplier/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("createPurchaseFunction surfaces cart validation errors rather than contacting CJ", async () => {
    const result = await cj.createPurchaseFunction({ platform, cartItems: [] });
    expect(result.error).toMatch(/at least one cart item/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancelPurchase refuses with the local-status-only caveat", async () => {
    const result = await cj.cancelPurchase({ purchaseId: "cj-order-1" });
    expect(result.error).toMatch(/not enabled/);
    expect(result.error).toMatch(/local/);
  });
});

describe("CJ adapter - webhook signature", () => {
  const SECRET = "cj-open-id-secret";
  const RAW = '{"event":"order.shipped"}';
  const sign = (body: string, key = SECRET) =>
    createHmac("sha256", key).update(body).digest("base64");

  it("accepts a correctly signed raw body", () => {
    expect(cj.verifyCjWebhookSignature({ rawBody: RAW, signature: sign(RAW), secret: SECRET })).toBe(
      true,
    );
  });

  it("rejects a tampered body, wrong secret and wrong key", () => {
    expect(
      cj.verifyCjWebhookSignature({ rawBody: RAW + " ", signature: sign(RAW), secret: SECRET }),
    ).toBe(false);
    expect(
      cj.verifyCjWebhookSignature({ rawBody: RAW, signature: sign(RAW, "other"), secret: SECRET }),
    ).toBe(false);
    expect(
      cj.verifyCjWebhookSignature({ rawBody: RAW, signature: sign(RAW), secret: "other" }),
    ).toBe(false);
  });

  it("fails closed on any missing input instead of throwing its way to acceptance", () => {
    const sig = sign(RAW);
    expect(cj.verifyCjWebhookSignature({ rawBody: null, signature: sig, secret: SECRET })).toBe(false);
    expect(cj.verifyCjWebhookSignature({ rawBody: RAW, signature: null, secret: SECRET })).toBe(false);
    expect(cj.verifyCjWebhookSignature({ rawBody: RAW, signature: sig, secret: null })).toBe(false);
    // A truncated signature must fail the length check, not throw.
    expect(
      cj.verifyCjWebhookSignature({ rawBody: RAW, signature: sig.slice(0, 8), secret: SECRET }),
    ).toBe(false);
  });
});

describe("CJ adapter - webhook handlers fail closed", () => {
  const headersWithSig = { "cj-signature": "abc123" };
  const headersWithoutSig = { "content-type": "application/json" };

  it("createTrackingWebhookHandler always throws, naming the missing raw body", async () => {
    await expect(
      cj.createTrackingWebhookHandler({ platform, event: {}, headers: headersWithSig }),
    ).rejects.toThrow(/raw bytes/);
    await expect(
      cj.createTrackingWebhookHandler({ platform, event: {}, headers: headersWithoutSig }),
    ).rejects.toThrow(/No signature header was present/);
    // Rejected before anything else happens.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancelPurchaseWebhookHandler always throws - an unverified cancellation must not cancel local orders", async () => {
    await expect(
      cj.cancelPurchaseWebhookHandler({ platform, event: {}, headers: headersWithSig }),
    ).rejects.toThrow(/rejected/);
    await expect(
      cj.cancelPurchaseWebhookHandler({ platform, event: {}, headers: headersWithoutSig }),
    ).rejects.toThrow(/no signature was present/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("CJ adapter - blocked ChannelPlatform slots", () => {
  it("webhook lifecycle and OAuth slots return a specific error rather than throwing", async () => {
    for (const slot of [
      cj.createWebhookFunction,
      cj.getWebhooksFunction,
      cj.deleteWebhookFunction,
      cj.oAuthFunction,
      cj.oAuthCallbackFunction,
    ]) {
      const result = await slot();
      expect(result.error).toMatch(/is not enabled/);
    }
  });
});

describe("CJ adapter - SSRF guard (Task 18)", () => {
  const privatePlatform = {
    name: "cj",
    accessToken: "test-token",
    baseUrl: "http://127.0.0.1:9200",
  };

  it("refuses a private provider base URL instead of dialing it", async () => {
    await expect(
      cj.searchProductsFunction({ platform: privatePlatform, searchEntry: "crock" }),
    ).rejects.toThrow(/provider URL rejected/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a base URL that hides credentials in the authority", async () => {
    await expect(
      cj.searchProductsFunction({
        platform: {
          ...privatePlatform,
          baseUrl: "https://user:pass@developers.cjdropshipping.com",
        },
        searchEntry: "crock",
      }),
    ).rejects.toThrow(/provider URL rejected/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows a private base URL only with the explicit local-development opt-in", async () => {
    vi.stubEnv("ALLOW_PRIVATE_PROVIDER_URLS", "true");
    fetchMock.mockResolvedValue(jsonResponse(LIST_V2_BODY));

    const result = await cj.searchProductsFunction({
      platform: { ...privatePlatform, baseUrl: "http://localhost:9200/api2.0/v1" },
      searchEntry: "crock",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.products.length).toBeGreaterThan(0);
  });
});

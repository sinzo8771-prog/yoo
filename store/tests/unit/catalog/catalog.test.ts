import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Task 4 unit tests — lib/openfront/catalog.
 * The GraphQL client is mocked; assertions cover the provider contract mapped
 * into CatalogProduct: variant availability rules, price selection, missing
 * product, empty search, and malformed provider responses.
 */

const requestMock = vi.fn();

vi.mock("@/features/storefront/lib/config", () => ({
  openfrontClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import {
  getFeaturedProducts,
  getCollectionBySlug,
  getProductBySlug,
  searchProducts,
  clearOpenfrontCache,
  CatalogClientError,
} from "@/lib/openfront/catalog";

beforeEach(() => {
  requestMock.mockReset();
  // Every read is memoised (Task 4, Step 3) — isolate tests from each other.
  clearOpenfrontCache();
});

/** Raw shape mirrors the exact Openfront GraphQL fields requested. */
function rawProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    handle: "oak-board",
    title: "Oak Serving Board",
    subtitle: "Hand-finished oak",
    thumbnail: null,
    status: "published",
    description: {
      document: [
        { type: "paragraph", children: [{ text: "Cut from a single piece." }] },
        { type: "paragraph", children: [{ text: "Finished by hand." }] },
      ],
    },
    productImages: [
      { image: { url: "https://cdn/a.webp" }, altText: "Board angle one", order: 0 },
    ],
    productCollections: [{ handle: "kitchen" }],
    productVariants: [
      {
        id: "v1",
        title: "Small",
        sku: "OAK-S",
        manageInventory: true,
        allowBackorder: false,
        inventoryQuantity: 5,
        prices: [
          {
            amount: 2400,
            compareAmount: null,
            currency: { code: "usd" },
            calculatedPrice: {
              calculatedAmount: 2400,
              originalAmount: 2400,
              currencyCode: "usd",
            },
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("getFeaturedProducts", () => {
  it("maps variants with availability and calculated price", async () => {
    requestMock.mockResolvedValue({ products: [rawProduct()] });

    const result = await getFeaturedProducts();

    expect(result).toHaveLength(1);
    const p = result[0];
    expect(p.slug).toBe("oak-board");
    expect(p.images).toEqual([{ url: "https://cdn/a.webp", alt: "Board angle one" }]);
    expect(p.variants[0]).toMatchObject({
      id: "v1",
      title: "Small",
      sku: "OAK-S",
      price: 2400,
      available: true,
    });
  });

  it("marks managed variants with zero stock and no backorder unavailable", async () => {
    requestMock.mockResolvedValue({
      products: [
        rawProduct({
          productVariants: [
            {
              id: "v2",
              title: "Large",
              sku: "OAK-L",
              manageInventory: true,
              allowBackorder: false,
              inventoryQuantity: 0,
              prices: [
                {
                  calculatedPrice: {
                    calculatedAmount: 3200,
                    originalAmount: 3200,
                    currencyCode: "usd",
                  },
                },
              ],
            },
          ],
        }),
      ],
    });

    const [p] = await getFeaturedProducts();
    expect(p.variants[0].available).toBe(false);
  });

  it("throws CatalogClientError on malformed provider response", async () => {
    requestMock.mockResolvedValue({ unexpected: true });
    await expect(getFeaturedProducts()).rejects.toBeInstanceOf(CatalogClientError);
  });

  it("throws CatalogClientError when the request fails", async () => {
    requestMock.mockRejectedValue(new Error("network down"));
    await expect(getFeaturedProducts()).rejects.toBeInstanceOf(CatalogClientError);
  });
});

describe("getProductBySlug", () => {
  it("returns null when the product is missing", async () => {
    requestMock.mockResolvedValue({ products: [] });
    expect(await getProductBySlug("nope")).toBeNull();
  });

  it("returns the mapped product when found", async () => {
    requestMock.mockResolvedValue({ products: [rawProduct()] });
    const p = await getProductBySlug("oak-board");
    expect(p?.id).toBe("p1");
  });
});

describe("searchProducts", () => {
  it("returns [] without a request for empty/blank queries", async () => {
    expect(await searchProducts("   ")).toEqual([]);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("searches published products by title and subtitle", async () => {
    requestMock.mockResolvedValue({ products: [] });
    await searchProducts("oak");
    const [doc, vars] = requestMock.mock.calls[0];
    expect(doc).toContain("products(");
    expect(vars.where.OR).toEqual([
      { title: { contains: "oak" } },
      { subtitle: { contains: "oak" } },
    ]);
    expect(vars.where.status).toEqual({ equals: "published" });
  });
});

describe("getCollectionBySlug", () => {
  it("returns mapped products for a collection", async () => {
    requestMock.mockResolvedValue({
      productCollections: [{ id: "c1", products: [rawProduct()] }],
    });
    const { products } = await getCollectionBySlug("kitchen");
    expect(products).toHaveLength(1);
    expect(products[0].slug).toBe("oak-board");
  });

  it("returns empty products for an unknown collection", async () => {
    requestMock.mockResolvedValue({ productCollections: [] });
    const { products } = await getCollectionBySlug("ghost");
    expect(products).toEqual([]);
  });
});
describe("description (Keystone document field)", () => {
  it("flattens the document into plain text", async () => {
    requestMock.mockResolvedValue({ products: [rawProduct()] });
    const [p] = await getFeaturedProducts();
    expect(p.description).toBe("Cut from a single piece. Finished by hand.");
    expect(p.descriptionDocument).toHaveLength(2);
  });

  it("omits description when the document is empty or malformed", async () => {
    requestMock.mockResolvedValue({
      products: [rawProduct({ description: { document: [] } })],
    });
    const [p] = await getFeaturedProducts();
    expect(p.description).toBeUndefined();
  });
});

describe("price selection", () => {
  it("falls back to `amount` when calculatedPrice is absent", async () => {
    requestMock.mockResolvedValue({
      products: [
        rawProduct({
          productVariants: [
            {
              id: "v1",
              title: "Small",
              sku: "OAK-S",
              manageInventory: true,
              allowBackorder: false,
              inventoryQuantity: 5,
              prices: [
                { amount: 1900, compareAmount: null, currency: { code: "usd" }, calculatedPrice: null },
              ],
            },
          ],
        }),
      ],
    });

    const [p] = await getFeaturedProducts();
    expect(p.variants[0].price).toBe(1900);
    expect(p.variants[0].currencyCode).toBe("usd");
  });

  it("prefers the market currency when several prices are returned", async () => {
    requestMock.mockResolvedValue({
      products: [
        rawProduct({
          productVariants: [
            {
              id: "v1",
              title: "Small",
              sku: "OAK-S",
              manageInventory: true,
              allowBackorder: false,
              inventoryQuantity: 1,
              prices: [
                { amount: 9900, currency: { code: "gbp" }, calculatedPrice: null },
                { amount: 2400, currency: { code: "usd" }, calculatedPrice: null },
              ],
            },
          ],
        }),
      ],
    });

    const [p] = await getFeaturedProducts();
    expect(p.variants[0].price).toBe(2400);
    expect(p.variants[0].currencyCode).toBe("usd");
  });

  it("reports originalPrice only when it is above the charged price", async () => {
    const variant = (amount: number, compareAmount: number | null) => ({
      id: "v1",
      title: "Small",
      sku: "OAK-S",
      manageInventory: true,
      allowBackorder: false,
      inventoryQuantity: 1,
      prices: [{ amount, compareAmount, currency: { code: "usd" }, calculatedPrice: null }],
    });

    requestMock.mockResolvedValue({
      products: [rawProduct({ productVariants: [variant(1800, 2200)] })],
    });
    const [discounted] = await getFeaturedProducts();
    expect(discounted.variants[0].originalPrice).toBe(2200);

    clearOpenfrontCache();
    requestMock.mockResolvedValue({
      products: [rawProduct({ productVariants: [variant(1800, 1800)] })],
    });
    const [unchanged] = await getFeaturedProducts();
    expect(unchanged.variants[0].originalPrice).toBeUndefined();
  });

  it("falls back to the first image when the virtual thumbnail is null", async () => {
    requestMock.mockResolvedValue({ products: [rawProduct({ thumbnail: null })] });
    const [p] = await getFeaturedProducts();
    expect(p.thumbnail).toBe("https://cdn/a.webp");
  });

  it("exposes imagePath-only images (Task 22 media has no stored asset)", async () => {
    requestMock.mockResolvedValue({
      products: [
        rawProduct({
          thumbnail: null,
          productImages: [
            {
              image: null,
              imagePath: "/images/catalog/oak-serving-board-1-front.png",
              altText: "Illustration: a tall solid oak serving board",
              order: 0,
            },
          ],
        }),
      ],
    });
    const [p] = await getFeaturedProducts();
    expect(p.images).toEqual([
      {
        url: "/images/catalog/oak-serving-board-1-front.png",
        alt: "Illustration: a tall solid oak serving board",
      },
    ]);
    expect(p.thumbnail).toBe("/images/catalog/oak-serving-board-1-front.png");
  });
});

describe("read caching", () => {
  it("serves repeated identical reads from one request", async () => {
    requestMock.mockResolvedValue({ products: [rawProduct()] });

    await getFeaturedProducts(8);
    await getFeaturedProducts(8);

    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("keys the cache by arguments", async () => {
    requestMock.mockResolvedValue({ products: [rawProduct()] });

    await getFeaturedProducts(8);
    await getFeaturedProducts(4);

    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache failures", async () => {
    requestMock.mockRejectedValueOnce(new Error("network down"));
    await expect(getFeaturedProducts()).rejects.toBeInstanceOf(CatalogClientError);

    requestMock.mockResolvedValue({ products: [rawProduct()] });
    await expect(getFeaturedProducts()).resolves.toHaveLength(1);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it("single-flights concurrent identical reads", async () => {
    let resolveRequest: (value: unknown) => void = () => {};
    requestMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );

    const inFlight = [getFeaturedProducts(), getFeaturedProducts()];
    resolveRequest({ products: [rawProduct()] });
    await Promise.all(inFlight);

    expect(requestMock).toHaveBeenCalledTimes(1);
  });
});
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Task 19, Step 2 (unit) — `listIndexableCatalog`, the sitemap's catalog read.
 *
 * Same harness as the Task 4 catalog tests: the GraphQL client is mocked, so
 * the assertions pin the query arguments (published-only, bounded) and the
 * handle mapping rather than the transport.
 */

const requestMock = vi.fn();

vi.mock("@/features/storefront/lib/config", () => ({
  openfrontClient: {
    request: (...args: unknown[]) => requestMock(...args),
  },
}));

import {
  MAX_INDEX_HANDLES,
  CatalogClientError,
  clearOpenfrontCache,
  listIndexableCatalog,
} from "@/lib/openfront/catalog";

beforeEach(() => {
  requestMock.mockReset();
  clearOpenfrontCache();
});

function respond(data: unknown) {
  requestMock.mockResolvedValue(data);
}

describe("listIndexableCatalog", () => {
  it("returns product and collection handles", async () => {
    respond({
      products: [{ handle: "oak-board" }, { handle: "linen-shirt" }],
      productCollections: [{ handle: "kitchen" }],
    });

    await expect(listIndexableCatalog()).resolves.toEqual({
      productHandles: ["oak-board", "linen-shirt"],
      collectionHandles: ["kitchen"],
    });
  });

  it("asks only for published products and a bounded page", async () => {
    respond({ products: [], productCollections: [] });
    await listIndexableCatalog(25);

    const [, variables] = requestMock.mock.calls[0];
    expect(variables).toEqual({
      where: { status: { equals: "published" } },
      limit: 25,
    });
    // Handles only: the query must not drag the whole product projection along.
    const [doc] = requestMock.mock.calls[0];
    expect(doc).toContain("handle");
    expect(doc).not.toContain("productVariants");
    expect(doc).not.toContain("prices");
  });

  it("clamps the limit into a sane range", async () => {
    respond({ products: [], productCollections: [] });
    await listIndexableCatalog(0);
    expect(requestMock.mock.calls[0][1]).toMatchObject({ limit: 1 });

    clearOpenfrontCache();
    await listIndexableCatalog(999_999);
    expect(requestMock.mock.calls[1][1]).toMatchObject({ limit: MAX_INDEX_HANDLES });
  });

  it("drops null, empty and unset handles instead of emitting them", async () => {
    respond({
      products: [{ handle: null }, { handle: "" }, { handle: "oak-board" }, {}],
      productCollections: null,
    });

    await expect(listIndexableCatalog()).resolves.toEqual({
      productHandles: ["oak-board"],
      collectionHandles: [],
    });
  });

  it("treats a missing payload as an empty index rather than throwing", async () => {
    respond(null);
    await expect(listIndexableCatalog()).resolves.toEqual({
      productHandles: [],
      collectionHandles: [],
    });
  });

  it("wraps transport failures in CatalogClientError", async () => {
    requestMock.mockRejectedValue(new Error("socket hang up"));
    await expect(listIndexableCatalog()).rejects.toBeInstanceOf(CatalogClientError);
  });

  it("memoises the read like every other catalog call", async () => {
    respond({ products: [{ handle: "oak-board" }], productCollections: [] });
    await listIndexableCatalog(10);
    await listIndexableCatalog(10);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });
});

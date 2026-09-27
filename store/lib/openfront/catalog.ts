import { gql } from "graphql-request";

import { documentToPlainText } from "@/features/catalog/lib/document";
import { openfrontClient } from "@/features/storefront/lib/config";
import { cached } from "@/lib/openfront/cache";
import { site } from "@/lib/brand/site";

export {
  clearOpenfrontCache,
  openfrontCacheSize,
} from "@/lib/openfront/cache";

/**
 * Task 4 — typed Openfront catalog client (server-side only).
 *
 * Field names/inputs are verified against `openfront/schema.graphql` and
 * `features/keystone/models/*` at the pinned revision (2b7181a):
 *  - `Product.status` (ProductStatusType), `Product.description` is a Keystone
 *    `document()` field, so it must be selected as `description { document }`
 *    (`thumbnail` is a virtual field resolved from `productImages[0]`).
 *  - `MoneyAmount.calculatedPrice` is a virtual field derived from `amount`; it
 *    THROWS if the price row has no `currency` relation, and can be absent, so
 *    we always select `amount` as a fallback.
 *
 * Reads are memoised for a short window (see `lib/openfront/cache`); the window
 * is kept well below the point where stale pricing/availability could mislead
 * checkout (plan Task 4, Step 3).
 *
 * Never import this module from a client component — it performs network I/O.
 */

export class CatalogClientError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CatalogClientError";
  }
}

export type CatalogImage = { url: string; alt?: string };

/** A collection and its (published) products. */
export type CatalogCollection = {
  /** Merchant-authored title; null when the collection has no title set. */
  title: string | null;
  products: CatalogProduct[];
};

export type CatalogVariant = {
  id: string;
  title: string;
  sku?: string;
  /** Charge price in minor units (cents). Meaningful only when `hasPrice`. */
  price: number;
  /** Original price in minor units when discounted. */
  originalPrice?: number;
  currencyCode: string;
  available: boolean;
  /**
   * False when Openfront returned no usable price for this variant. Keeps
   * "no price data" from being rendered as a real "$0.00".
   */
  hasPrice: boolean;
};

export type CatalogProduct = {
  id: string;
  slug: string;
  title: string;
  subtitle?: string;
  /** Plain-text description (flattened from the Keystone document field). */
  description?: string;
  /** Raw Keystone document JSON, kept for rich rendering on the PDP (Task 6). */
  descriptionDocument?: unknown;
  thumbnail?: string;
  images: CatalogImage[];
  variants: CatalogVariant[];
  collectionHandles: string[];
};

/* Exact GraphQL selection shared by every product query. */
const PRODUCT_FIELDS = gql`
  fragment CatalogProductFields on Product {
    id
    handle
    title
    subtitle
    thumbnail
    description {
      document
    }
    productImages(orderBy: { order: asc }) {
      image {
        url
      }
      imagePath
      altText
      order
    }
    productCollections {
      handle
    }
    productVariants(orderBy: [{ variantRank: asc }]) {
      id
      title
      sku
      manageInventory
      allowBackorder
      inventoryQuantity
      prices {
        amount
        compareAmount
        currency {
          code
        }
        calculatedPrice {
          calculatedAmount
          originalAmount
          currencyCode
        }
      }
    }
  }
`;

const PUBLISHED = "published";

type RawProduct = {
  id: string;
  handle: string | null;
  title: string | null;
  subtitle: string | null;
  thumbnail: string | null;
  description: { document: unknown } | null;
  productImages: Array<{
    image: { url: string } | null;
    /** Root-relative path served by this deployment (Task 22 media has no
     *  uploaded storage asset, so `image` is null and this is the URL). */
    imagePath: string | null;
    altText: string | null;
    order: number | null;
  }> | null;
  productCollections: Array<{ handle: string | null }> | null;
  productVariants: Array<{
    id: string;
    title: string | null;
    sku: string | null;
    manageInventory: boolean | null;
    allowBackorder: boolean | null;
    inventoryQuantity: number | null;
    prices: Array<{
      amount: number | null;
      compareAmount: number | null;
      currency: { code: string | null } | null;
      calculatedPrice: {
        calculatedAmount: number | null;
        originalAmount: number | null;
        currencyCode: string | null;
      } | null;
    }> | null;
  }> | null;
};

function mapVariant(
  raw: NonNullable<RawProduct["productVariants"]>[number]
): CatalogVariant {
  const prices = raw.prices ?? [];
  const preferredCurrency = site.market.currency.toLowerCase();

  // `calculatedPrice` is a virtual field Openfront derives from `amount` (it
  // applies price lists/rules) and it can be absent, so treat `amount` as the
  // source of truth and the calculated price as an override.
  const currencyOf = (price: (typeof prices)[number]): string =>
    (
      price.calculatedPrice?.currencyCode ??
      price.currency?.code ??
      ""
    ).toLowerCase();

  const chosen =
    prices.find((p) => currencyOf(p) === preferredCurrency) ??
    prices.find((p) => currencyOf(p) !== "") ??
    prices[0];
  const calculated = chosen?.calculatedPrice ?? null;

  const price = calculated?.calculatedAmount ?? chosen?.amount ?? 0;
  // A price of exactly 0 is only trustworthy when Openfront actually returned a
  // zero price; otherwise we have no price data at all.
  const hasPrice =
    typeof calculated?.calculatedAmount === "number" ||
    typeof chosen?.amount === "number";

  // A "was" price is only meaningful when it is strictly above what we charge.
  const originalPrice = [chosen?.compareAmount, calculated?.originalAmount].find(
    (candidate): candidate is number =>
      typeof candidate === "number" && candidate > price
  );

  // Availability rule: unmanaged inventory is sellable; managed inventory is
  // sellable when backorder is allowed or stock remains.
  const available =
    raw.manageInventory === true
      ? raw.allowBackorder === true || (raw.inventoryQuantity ?? 0) > 0
      : true;

  return {
    id: raw.id,
    title: raw.title ?? "",
    sku: raw.sku ?? undefined,
    price,
    originalPrice,
    currencyCode: (chosen ? currencyOf(chosen) : "") || preferredCurrency,
    available,
    hasPrice,
  };
}

function mapProduct(raw: RawProduct): CatalogProduct {
  if (!raw.id || raw.handle == null) {
    throw new CatalogClientError("Malformed product record: missing id/handle");
  }

  // Prefer the backend's stored asset URL; fall back to `imagePath`, which is
  // what the backend's own thumbnail virtual field does — Task 22 media rows
  // set `imagePath` only (no uploaded asset), so without the fallback the PDP
  // gallery would render empty while cards showed a thumbnail.
  const images = (raw.productImages ?? []).flatMap((i) => {
    const url = i?.image?.url || i?.imagePath || "";
    return url.length > 0 ? [{ url, alt: i.altText ?? undefined }] : [];
  });

  const descriptionDocument = raw.description?.document;
  const description = documentToPlainText(descriptionDocument);

  return {
    id: raw.id,
    slug: raw.handle,
    title: raw.title ?? "",
    subtitle: raw.subtitle ?? undefined,
    description: description.length > 0 ? description : undefined,
    descriptionDocument,
    // `thumbnail` is a virtual field Openfront resolves from the first product
    // image; fall back to the images we already fetched so cards still render.
    thumbnail: raw.thumbnail ?? images[0]?.url,
    images,
    variants: (raw.productVariants ?? []).map(mapVariant),
    collectionHandles: (raw.productCollections ?? [])
      .map((c) => c.handle)
      .filter((h): h is string => h != null),
  };
}

function assertProducts(
  data: { products?: unknown } | null | undefined
): RawProduct[] {
  if (!data || !Array.isArray(data.products)) {
    throw new CatalogClientError(
      "Malformed Openfront response: expected `products` array"
    );
  }
  return data.products as RawProduct[];
}

/** Wraps transport failures in CatalogClientError (never leaks raw errors). */
async function requestCatalog<T>(
  doc: string,
  variables: Record<string, unknown>
): Promise<T> {
  try {
    return await openfrontClient.request<T>(doc, variables);
  } catch (err) {
    if (err instanceof CatalogClientError) throw err;
    throw new CatalogClientError("Openfront request failed", { cause: err });
  }
}

/**
 * Task 19, Step 2 — identifiers only, for the sitemap.
 *
 * The sitemap needs handles, not prices, images or descriptions, so this query
 * selects two scalar lists instead of running the full product projection over
 * the whole catalog. Published products only: a draft must never be advertised
 * to a crawler. Results are memoised like every other read and bounded by
 * `limit` (the sitemap has its own hard cap on top of this).
 */
export type CatalogIndex = {
  productHandles: string[];
  collectionHandles: string[];
};

export const MAX_INDEX_HANDLES = 1000;

export function listIndexableCatalog(
  limit: number = MAX_INDEX_HANDLES
): Promise<CatalogIndex> {
  const bounded = Math.min(Math.max(Math.trunc(limit), 1), MAX_INDEX_HANDLES);
  return cached(`catalog:index:${bounded}`, () => loadIndexableCatalog(bounded));
}

async function loadIndexableCatalog(limit: number): Promise<CatalogIndex> {
  const query = gql`
    query CatalogIndex($where: ProductWhereInput!, $limit: Int!) {
      products(where: $where, take: $limit, orderBy: [{ createdAt: desc }]) {
        handle
      }
      productCollections(take: $limit) {
        handle
      }
    }
  `;
  const data = await requestCatalog<{
    products: Array<{ handle: string | null }>;
    productCollections: Array<{ handle: string | null }>;
  }>(query, { where: { status: { equals: PUBLISHED } }, limit });

  const handles = (rows: Array<{ handle: string | null }> | null | undefined) =>
    (rows ?? [])
      .map((row) => row?.handle)
      .filter((handle): handle is string => typeof handle === "string" && handle.length > 0);

  return {
    productHandles: handles(data?.products),
    collectionHandles: handles(data?.productCollections),
  };
}

/** Featured products: published, newest first, limited. */
export function getFeaturedProducts(
  limit: number = 8
): Promise<CatalogProduct[]> {
  return cached(`catalog:featured:${limit}`, () =>
    loadFeaturedProducts(limit)
  );
}

async function loadFeaturedProducts(
  limit: number
): Promise<CatalogProduct[]> {
  const query = gql`
    query CatalogFeatured($where: ProductWhereInput!, $limit: Int!) {
      products(where: $where, take: $limit, orderBy: [{ createdAt: desc }]) {
        ...CatalogProductFields
      }
    }
    ${PRODUCT_FIELDS}
  `;
  const data = await requestCatalog<{ products: RawProduct[] }>(query, {
    where: { status: { equals: PUBLISHED } },
    limit,
  });
  return assertProducts(data).map(mapProduct);
}

/** Single product by stable handle/slug; null when absent. */
export function getProductBySlug(
  slug: string
): Promise<CatalogProduct | null> {
  return cached(`catalog:product:${slug}`, () => loadProductBySlug(slug));
}

async function loadProductBySlug(
  slug: string
): Promise<CatalogProduct | null> {
  const query = gql`
    query CatalogProductBySlug($handle: String!) {
      products(
        where: { handle: { equals: $handle }, status: { equals: ${PUBLISHED} } }
        take: 1
      ) {
        ...CatalogProductFields
      }
    }
    ${PRODUCT_FIELDS}
  `;
  const data = await requestCatalog<{ products: RawProduct[] }>(query, {
    handle: slug,
  });
  const products = assertProducts(data);
  return products.length > 0 ? mapProduct(products[0]) : null;
}

/** Products in a collection (by collection handle). */
export function getCollectionBySlug(
  slug: string,
  limit: number = 24
): Promise<CatalogCollection> {
  return cached(`catalog:collection:${slug}:${limit}`, () =>
    loadCollectionBySlug(slug, limit)
  );
}

async function loadCollectionBySlug(
  slug: string,
  limit: number
): Promise<CatalogCollection> {
  const query = gql`
    query CatalogCollection($handle: String!, $limit: Int!) {
      productCollections(where: { handle: { equals: $handle } }, take: 1) {
        id
        title
        products(
          where: { status: { equals: ${PUBLISHED} } }
          take: $limit
          orderBy: [{ createdAt: desc }]
        ) {
          ...CatalogProductFields
        }
      }
    }
    ${PRODUCT_FIELDS}
  `;
  const data = await requestCatalog<{
    productCollections: Array<{
      id: string;
      title: string | null;
      products: RawProduct[];
    }>;
  }>(query, { handle: slug, limit });

  if (!data || !Array.isArray(data.productCollections)) {
    throw new CatalogClientError(
      "Malformed Openfront response: expected `productCollections` array"
    );
  }
  const collection = data.productCollections[0];
  return {
    // The merchant-authored title, so callers never have to prettify a handle.
    title: collection?.title ?? null,
    products: (collection?.products ?? []).map(mapProduct),
  };
}

/**
 * Bounded search across title and subtitle; blank queries short-circuit.
 * Input validation runs before the cache so blank/over-long queries never
 * occupy a cache slot.
 */
export function searchProducts(
  query: string,
  limit: number = 12
): Promise<CatalogProduct[]> {
  const term = query.trim();
  if (term.length === 0) return Promise.resolve([]);
  if (term.length > 100) {
    return Promise.reject(new CatalogClientError("Search query too long"));
  }
  return cached(`catalog:search:${term}:${limit}`, () =>
    loadSearchProducts(term, limit)
  );
}

async function loadSearchProducts(
  term: string,
  limit: number
): Promise<CatalogProduct[]> {
  const doc = gql`
    query CatalogSearch($where: ProductWhereInput!, $limit: Int!) {
      products(where: $where, take: $limit, orderBy: [{ createdAt: desc }]) {
        ...CatalogProductFields
      }
    }
    ${PRODUCT_FIELDS}
  `;
  const data = await requestCatalog<{ products: RawProduct[] }>(doc, {
    where: {
      status: { equals: PUBLISHED },
      OR: [{ title: { contains: term } }, { subtitle: { contains: term } }],
    },
    limit,
  });
  return assertProducts(data).map(mapProduct);
}
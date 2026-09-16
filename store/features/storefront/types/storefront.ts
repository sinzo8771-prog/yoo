/**
 * Task 8 — customer-safe order shapes.
 *
 * The order payloads rendered by the storefront are whitelist projections from
 * `features/storefront/lib/data/orders.ts` (internal fields such as secretKey,
 * paymentDetails, fulfillmentDetails and raw gateway payloads never reach the
 * client). The templates consume a broad, dynamic surface, so these types keep
 * an index signature while naming the fields the UI relies on.
 */
export type StoreOrder = {
  [key: string]: any
  id: string
  displayId?: string | null
  status?: string | null
  fulfillmentStatus?: { status?: string | null } | null
  email?: string | null
  subtotal?: string | null
  shipping?: string | null
  discount?: string | null
  tax?: string | null
  total?: string | null
  formattedTotalPaid?: string | null
  createdAt?: string | null
  region?: { id: string; name?: string | null; currency: { code: string } } | null
}

export type StorefrontOrderOverviewItem = {
  [key: string]: any
  id: string
  displayId?: string | null
  status?: string | null
  fulfillmentStatus?: string | null
  total?: string | null
  formattedTotalPaid?: string | null
  createdAt?: string | null
  lineItems?: {
    id: string
    title?: string | null
    quantity?: number
    thumbnail?: string | null
  }[]
  region?: { id: string; currency?: { code?: string } | null } | null
  shippingAddress?: { country?: { id?: string; iso2?: string } | null } | null
}

export interface ProductWhereClause {
  productCollections?: {
    some: { id: { equals: any } }
  },
  isGiftcard: { equals: any },
  productVariants: {
    some: {
      prices: {
        some: {
          region: {
            countries: { some: { iso2: { equals: string } } }
          }
        }
      }
    }
  },
  id?: { in: any }
}

export interface StoreCollection {
  id: string;
  title: string;
  handle: string;
  products?: any[];
}

export interface StoreRegion {
  id: string;
  name: string;
  currency_code: string;
  currency: {
    code: string;
  };
  countries: {
    id: string;
    name: string;
    iso2: string;
  }[];
  locale?: string;
}

export interface MoneyAmount {
  amount: number;
  currency: {
    code: string;
  };
  calculatedPrice: {
    calculatedAmount: number;
    originalAmount: number;
    currencyCode: string;
  };
}

export interface ProductVariant {
  id: string;
  title: string;
  sku?: string;
  inventoryQuantity?: number;
  allowBackorder?: boolean;
  metadata?: Record<string, any>;
  productOptionValues?: {
    id: string;
    value: string;
    productOption: {
      id: string;
    };
  }[];
  prices?: MoneyAmount[];
}

export interface StoreProduct {
  id: string;
  title: string;
  handle: string;
  description?: {
    document: any;
  };
  thumbnail?: string;
  productImages?: {
    id: string;
    image: {
      url: string;
    };
    imagePath: string;
  }[];
  productOptions?: {
    id: string;
    title: string;
    metadata?: Record<string, any>;
    productOptionValues?: {
      id: string;
      value: string;
    }[];
  }[];
  productVariants?: ProductVariant[];
  status?: string;
  metadata?: Record<string, any>;
}

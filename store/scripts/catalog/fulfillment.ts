/**
 * Task 22, Step 3 — variant → fulfillment mapping.
 *
 * The rule the plan sets is: **every sellable variant maps 1:1 to a fulfillment
 * SKU, or carries an explicit manual-fulfillment rule.** There is no third
 * option and no implicit default, so this module is the one place that answers
 * "how would this specific variant actually reach a customer?".
 *
 * We hold no supplier account and therefore no supplier SKUs. Rather than invent
 * SKUs that look real, every variant is generated with an explicit manual rule
 * naming the exact item to buy, and `SUPPLIER_MAPPINGS` is the empty seam the
 * operator fills in when a sourcing decision exists. The seeder writes the
 * result into `ProductVariant.metadata.fulfillment`, so the answer travels with
 * the row instead of living only in this file.
 *
 * `--strict` validation refuses to call the catalog launch-ready while any
 * variant still depends on `sourcing: "pending"`.
 */
import { PRODUCTS, type CatalogProduct } from "./products";

export type SupplierMapping = {
  mode: "supplier";
  /** Channel/adapter that fulfils it, e.g. `cj` (Task 12). */
  supplier: string;
  /** The supplier's own SKU for this variant. Never our catalog SKU. */
  supplierSku: string;
  /** ISO date the mapping was checked against the supplier's own listing. */
  verifiedOn: string;
  /** Where it was checked (URL, account, invoice) so it can be re-checked. */
  evidence: string;
};

export type ManualRule = {
  mode: "manual";
  /** Repeatable instruction someone else could follow without asking. */
  rule: string;
  /** `pending` = the sourcing decision behind this rule is still outstanding. */
  sourcing: "pending" | "confirmed";
  /** Which item to buy, by SKU, so the wrong size cannot be shipped. */
  note: string;
};

export type FulfillmentRecord = SupplierMapping | ManualRule;

/**
 * Operator-supplied real mappings, keyed by **our** variant SKU. Empty today:
 * inventing a supplier SKU would be a fabricated ordering instruction.
 */
export const SUPPLIER_MAPPINGS: Record<string, SupplierMapping> = {};

/** The manual rule every unmapped variant uses, in full, so it is auditable. */
export const MANUAL_FULFILLMENT_RULE =
  "Manual fulfillment: when an order is placed, the operator buys the exact variant named in the note from a retail supplier, records the receipt against the order id, and ships it to the delivery address on the order. No stock is held, so the variant stays orderable only while the operator can buy it; if it cannot be sourced, the variant is delisted (or set to zero stock with backorders refused) in the same working day.";

/** Which item to buy — the part that makes the rule above specific. */
export function manualFulfillmentNote(
  product: CatalogProduct,
  variantTitle: string,
  sku: string
): string {
  return `Buy: ${product.title}, ${variantTitle} (${sku}). Do not substitute another size or material, and do not ship a different variant of ${product.title}.`;
}

function manualRecord(
  product: CatalogProduct,
  variantTitle: string,
  sku: string
): ManualRule {
  return {
    mode: "manual",
    rule: MANUAL_FULFILLMENT_RULE,
    sourcing: "pending",
    note: manualFulfillmentNote(product, variantTitle, sku),
  };
}

/**
 * Built from the assortment, so a variant cannot exist without a mapping: a new
 * variant raises a validation failure rather than silently becoming unfillable.
 */
export function buildFulfillment(
  products: readonly CatalogProduct[],
  supplierMappings: Record<string, SupplierMapping> = SUPPLIER_MAPPINGS
): Record<string, FulfillmentRecord> {
  const records: Record<string, FulfillmentRecord> = {};
  for (const product of products) {
    for (const variant of product.variants) {
      records[variant.sku] =
        supplierMappings[variant.sku] ??
        manualRecord(product, variant.title, variant.sku);
    }
  }
  return records;
}

export const FULFILLMENT: Record<string, FulfillmentRecord> =
  buildFulfillment(PRODUCTS);

/** The fulfillment record for a variant SKU, if one exists. */
export function fulfillmentFor(sku: string): FulfillmentRecord | undefined {
  return FULFILLMENT[sku];
}

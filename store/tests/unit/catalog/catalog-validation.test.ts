import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Task 22 unit tests — the catalog contract (`scripts/catalog/validate.ts`).
 *
 * Two jobs:
 *  1. pin the authored catalog: it validates clean, its unknown facts stay
 *     visibly unknown, every variant has a fulfillment answer, every product
 *     has licensed media, and the return window matches the *published* policy;
 *  2. prove the `--strict` gate behaves: it reads real files, accepts exactly
 *     what `generateMedia` writes, and still refuses to call the catalog
 *     launch-ready while sourcing is pending.
 */
import { policies } from "@/lib/brand/policies";
import { SUPPLIER_MAPPINGS, type SupplierMapping } from "@/scripts/catalog/fulfillment";
import { MEDIA } from "@/scripts/catalog/media";
import { PRODUCTS, RETURN_WINDOW_DAYS } from "@/scripts/catalog/products";
import { validateCatalog } from "@/scripts/catalog/validate";
import { generateMedia } from "@/scripts/generate-catalog-media";

const ALL_VARIANTS = PRODUCTS.flatMap((product) => product.variants);

describe("catalog validation (default mode)", () => {
  it("passes the authored catalog without a single error", () => {
    const result = validateCatalog();
    expect(result.errors).toEqual([]);
    expect(result.strict).toBe(false);
  });

  it("reports every unmeasured parcel fact as a warning instead of hiding it", () => {
    const result = validateCatalog();
    const unverified = result.warnings.filter((issue) => issue.code === "facts:unverified");
    // 4 facts (weight, dimensions, ships-from, handling) x 12 products.
    expect(unverified).toHaveLength(4 * PRODUCTS.length);
    for (const issue of unverified) {
      // The warning must carry the reason, not just the fact name.
      expect(issue.message).toContain("is not measured yet:");
    }
  });

  it("reports every pending fulfillment answer as a warning naming the SKU", () => {
    const result = validateCatalog();
    const pending = result.warnings.filter((issue) => issue.code === "fulfillment:pending");
    expect(pending).toHaveLength(ALL_VARIANTS.length);
    for (const variant of ALL_VARIANTS) {
      expect(
        pending.some((issue) => issue.message.startsWith(`${variant.sku}:`)),
        `pending warning for ${variant.sku}`
      ).toBe(true);
    }
  });

  it("never lets a fact become known-without-value or unknown-without-reason", () => {
    for (const product of PRODUCTS) {
      const facts: Array<[string, { known: boolean } & Record<string, unknown>]> = [
        ["weight", product.shipping.weightGrams],
        ["dimensions", product.shipping.dimensionsCm],
        ["shipsFrom", product.shipping.shipsFrom],
        ["handling", product.shipping.handlingDays],
      ];
      for (const [label, fact] of facts) {
        if (fact.known) {
          expect(fact.value, `${product.key} ${label}`).toBeDefined();
        } else {
          expect(String(fact.reason ?? "").trim().length, `${product.key} ${label}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("covers every variant with a fulfillment record, never an implicit default", () => {
    const result = validateCatalog();
    expect(result.errors.filter((issue) => issue.code === "fulfillment:coverage")).toEqual([]);
  });

  it("flags a supplier mapping that matches no sellable variant", () => {
    const orphan: SupplierMapping = {
      mode: "supplier",
      supplier: "acme",
      supplierSku: "ACME-1",
      verifiedOn: "2026-09-25",
      evidence: "supplier portal",
    };
    const result = validateCatalog({
      supplierMappings: { ...SUPPLIER_MAPPINGS, "NOT-A-REAL-SKU": orphan },
    });
    expect(result.errors.some((issue) => issue.code === "fulfillment:orphan-mapping")).toBe(true);
  });

  it("clears a SKU's pending warning once a real supplier mapping exists", () => {
    const result = validateCatalog({
      supplierMappings: {
        ...SUPPLIER_MAPPINGS,
        "NWG-MUG-250": {
          mode: "supplier",
          supplier: "cj",
          supplierSku: "CJ-77881",
          verifiedOn: "2026-09-25",
          evidence: "https://example.invalid/item/77881",
        },
      },
    });
    const pending = result.warnings.filter((issue) => issue.code === "fulfillment:pending");
    expect(pending.some((issue) => issue.message.startsWith("NWG-MUG-250:"))).toBe(false);
    // Every other variant is still pending.
    expect(pending).toHaveLength(ALL_VARIANTS.length - 1);
  });
});

describe("return window pin", () => {
  it("promises customers exactly the window the published Returns policy states", () => {
    const policyText = policies.returns.sections.flatMap((section) => section.paragraphs).join(" ");
    const published = /(\d+)\s+days?\s+from\s+delivery/i.exec(policyText);
    expect(published, "policy must state its window extractably").not.toBeNull();
    expect(RETURN_WINDOW_DAYS).toBe(Number(published![1]));
    for (const product of PRODUCTS) {
      expect(product.returns.windowDays, product.key).toBe(RETURN_WINDOW_DAYS);
    }
    expect(validateCatalog().errors.some((issue) => issue.code.startsWith("returns:"))).toBe(false);
  });
});

describe("media plan coverage", () => {
  it("plans two licensed, honestly-labelled images for every product", () => {
    const result = validateCatalog();
    expect(result.errors.filter((issue) => issue.code.startsWith("media:"))).toEqual([]);
    for (const product of PRODUCTS) {
      const orders = MEDIA.filter((entry) => entry.productKey === product.key)
        .map((entry) => entry.order)
        .sort((a, b) => a - b);
      expect(orders, product.key).toEqual([0, 1]);
    }
  });

  it("fails when a product has no planned media", () => {
    const result = validateCatalog({ media: [] });
    const coverage = result.errors.filter((issue) => issue.code === "media:coverage");
    expect(coverage).toHaveLength(PRODUCTS.length);
  });
});

describe("--strict promotion gate", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "catalog-media-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it("fails against a directory with no generated media", () => {
    const result = validateCatalog({ strict: true, rootDir: scratch, media: MEDIA.slice(0, 1) });
    expect(result.errors.some((issue) => issue.code === "media:file-missing")).toBe(true);
  });

  it(
    "accepts exactly what generateMedia writes, yet still refuses pending sourcing",
    () => {
      // Render every planned file once…
      const records = generateMedia({ rootDir: scratch });
      expect(records).toHaveLength(MEDIA.length);

      const result = validateCatalog({ strict: true, rootDir: scratch });
      // Media checks all pass: existence, dimensions, byte budget, byte-identity.
      expect(result.errors.filter((issue) => issue.code.startsWith("media:"))).toEqual([]);
      // …but strict is a launch gate, not a media gate: unmeasured facts and
      // pending sourcing remain errors while they exist.
      expect(result.errors.some((issue) => issue.code === "facts:unverified")).toBe(true);
      expect(result.errors.some((issue) => issue.code === "fulfillment:pending")).toBe(true);
      // And the strict run reports the measured bytes + sha256 of each file.
      expect(result.files).toHaveLength(MEDIA.length);
      for (const file of result.files) {
        expect(file.bytes).toBeGreaterThan(0);
        expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    },
    120_000
  );
});


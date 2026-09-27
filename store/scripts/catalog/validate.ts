/**
 * Task 22, Steps 1-4 — the catalog's contract, checked in one place.
 *
 * Two modes, one code path:
 *  - **default**: structural honesty. Data-shape invariants (unique handles and
 *    SKUs, coverage of fulfillment/media plans, licence records present) plus
 *    *visible warnings* for every fact we have not measured. Warnings are not
 *    failures — an unsourced catalog may be seeded and reviewed.
 *  - **`--strict`**: the promotion gate (docs/catalog/product-model.md §Promotion
 *    gate). Unverified shipping facts and `sourcing: "pending"` variants become
 *    ERRORS, and every media file is read back from disk: it must exist, decode
 *    as a PNG of the declared size, fit the byte budget, and be byte-identical
 *    to what the current renderer produces. Strict passing is what "launch-ready"
 *    means; strict failing while facts are unknown is the gate working.
 *
 * The CLI at the bottom (`npx tsx scripts/catalog/validate.ts [--strict]`) prints
 * issues and sets the exit code; tests import `validateCatalog` directly and
 * inject data, so the same checks govern both.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { policies } from "../../lib/brand/policies";
import { MOTIFS, renderArtwork } from "./art";
import {
  SUPPLIER_MAPPINGS,
  buildFulfillment,
  type FulfillmentRecord,
  type SupplierMapping,
} from "./fulfillment";
import {
  MAX_IMAGE_BYTES,
  MEDIA,
  MEDIA_PUBLIC_DIR,
  MEDIA_SIZE,
  MEDIA_URL_PREFIX,
  type MediaEntry,
} from "./media";
import {
  CATALOG_ID_PREFIX,
  COLLECTIONS,
  MADE_TO_ORDER_INVENTORY,
  PRODUCTS,
  RETURN_WINDOW_DAYS,
  type CatalogProduct,
  type Fact,
} from "./products";
import { readPngSize } from "./png";

export type Issue = {
  /** Stable machine code, so tests assert on identity rather than prose. */
  code: string;
  message: string;
};

export type ValidationResult = {
  strict: boolean;
  errors: Issue[];
  warnings: Issue[];
  /** Populated only by `--strict`: what each media file actually is on disk. */
  files: Array<{ file: string; bytes: number; sha256: string }>;
};

export type ValidateOptions = {
  strict?: boolean;
  /** Store package root; media paths resolve against it. Defaults to cwd. */
  rootDir?: string;
  /** Injection seams for tests; defaults to the authored catalog. */
  products?: readonly CatalogProduct[];
  media?: readonly MediaEntry[];
  supplierMappings?: Record<string, SupplierMapping>;
};

/** URL slug for handles and collection handles. */
const SLUG_SAFE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Keys are baked into generated ids, so they must be id-safe. */
const ID_SAFE = /^[a-z0-9_]+$/;
/** SKUs travel to suppliers and channels; no spaces or punctuation surprises. */
const SKU_SAFE = /^[A-Za-z0-9._-]+$/;
/** The public URL must correspond to the file path under the served root. */
const PUBLIC_ROOT = MEDIA_PUBLIC_DIR.split("/")[0];

type Sink = { errors: Issue[]; warnings: Issue[] };

function fail(sink: Sink, code: string, message: string): void {
  sink.errors.push({ code, message });
}

function warn(sink: Sink, code: string, message: string): void {
  sink.warnings.push({ code, message });
}

/* ------------------------------------------------------------------ *
 * Steps 1 + 2: assortment shape, copy, and honest facts.
 * ------------------------------------------------------------------ */

function validateProducts(sink: Sink, strict: boolean, products: readonly CatalogProduct[]): void {
  if (products.length < 10 || products.length > 30) {
    fail(
      sink,
      "products:ceiling",
      `assortment must sit in the plan's 10-30 product ceiling (got ${products.length})`
    );
  }

  if (CATALOG_ID_PREFIX.length === 0 || !/^[a-z0-9_]+$/.test(CATALOG_ID_PREFIX)) {
    fail(sink, "products:id-prefix", `CATALOG_ID_PREFIX ${JSON.stringify(CATALOG_ID_PREFIX)} is not id-safe`);
  }

  const seenHandles = new Set<string>();
  const seenSkus = new Set<string>();

  for (const product of products) {
    if (!ID_SAFE.test(product.key)) {
      fail(sink, "products:key", `${JSON.stringify(product.key)} is not id-safe`);
    }
    if (!SLUG_SAFE.test(product.handle)) {
      fail(sink, "products:handle", `${product.key}: handle ${JSON.stringify(product.handle)} is not a URL slug`);
    }
    if (seenHandles.has(product.handle)) {
      fail(sink, "products:handle-duplicate", `handle ${JSON.stringify(product.handle)} is used by more than one product`);
    }
    seenHandles.add(product.handle);

    if (product.title.trim().length === 0) fail(sink, "products:title", `${product.key}: title is blank`);
    if (product.subtitle.trim().length === 0) fail(sink, "products:subtitle", `${product.key}: subtitle is blank`);
    if (product.description.length === 0 || product.description.some((p) => p.trim().length === 0)) {
      fail(sink, "products:description", `${product.key}: description must be non-empty paragraphs of original copy`);
    }

    // Collections: every referenced key must be one the seeder also creates.
    if (product.collections.length === 0) {
      fail(sink, "products:collections", `${product.key}: belongs to no collection`);
    }
    for (const key of product.collections) {
      if (!COLLECTIONS.some((collection) => collection.key === key)) {
        fail(sink, "products:collection-ref", `${product.key}: references unknown collection ${JSON.stringify(key)}`);
      }
    }

    // Returns: the catalog must promise exactly the published window.
    if (product.returns.windowDays !== RETURN_WINDOW_DAYS) {
      fail(
        sink,
        "returns:window",
        `${product.key}: return window ${product.returns.windowDays}d differs from RETURN_WINDOW_DAYS (${RETURN_WINDOW_DAYS})`
      );
    }
    if (product.returns.eligible && product.returns.conditions.trim().length === 0) {
      fail(sink, "returns:conditions", `${product.key}: eligible for return but states no conditions`);
    }

    // Shipping: policy-fixed fields are fixed; measured fields must be honest.
    if (product.shipping.market !== "us-only") {
      fail(sink, "shipping:market", `${product.key}: shipping market must be us-only (Shipping policy)`);
    }
    if (product.shipping.hazmat !== false) {
      fail(sink, "shipping:hazmat", `${product.key}: declares hazmat=true; ceramics/wood/textile are not hazmat`);
    }
    checkFact(sink, strict, `${product.key} weight`, product.shipping.weightGrams);
    checkFact(sink, strict, `${product.key} dimensions`, product.shipping.dimensionsCm);
    checkFact(sink, strict, `${product.key} ships-from`, product.shipping.shipsFrom);
    checkFact(sink, strict, `${product.key} handling time`, product.shipping.handlingDays);

    if (product.variants.length === 0) {
      fail(sink, "variants:none", `${product.key}: has no variants, so it cannot be sold`);
    }
    const seenKeys = new Set<string>();
    for (const variant of product.variants) {
      const label = `${product.key}/${variant.sku || variant.key}`;
      if (!ID_SAFE.test(variant.key)) fail(sink, "variants:key", `${label}: variant key is not id-safe`);
      if (seenKeys.has(variant.key)) fail(sink, "variants:key-duplicate", `${label}: duplicate variant key`);
      seenKeys.add(variant.key);

      if (!SKU_SAFE.test(variant.sku)) fail(sink, "variants:sku-format", `${label}: SKU contains unsupported characters`);
      if (seenSkus.has(variant.sku)) fail(sink, "variants:sku-duplicate", `SKU ${JSON.stringify(variant.sku)} is used twice (mapping would be ambiguous)`);
      seenSkus.add(variant.sku);

      if (!Number.isInteger(variant.price) || variant.price <= 0) {
        fail(sink, "variants:price", `${label}: price must be a positive integer in minor units`);
      }
    }
  }

  // The made-to-order model itself: 0 held + backorder allowed is what makes a
  // not-yet-sourced variant orderable without pretending stock exists.
  if (
    MADE_TO_ORDER_INVENTORY.manageInventory !== true ||
    MADE_TO_ORDER_INVENTORY.inventoryQuantity !== 0 ||
    MADE_TO_ORDER_INVENTORY.allowBackorder !== true
  ) {
    fail(sink, "inventory:model", "MADE_TO_ORDER_INVENTORY must be manageInventory=true, quantity=0, allowBackorder=true");
  }

  const collectionKeys = new Set<string>();
  const collectionHandles = new Set<string>();
  for (const collection of COLLECTIONS) {
    if (!ID_SAFE.test(collection.key)) fail(sink, "collections:key", `collection key ${JSON.stringify(collection.key)} is not id-safe`);
    if (!SLUG_SAFE.test(collection.handle)) fail(sink, "collections:handle", `collection handle ${JSON.stringify(collection.handle)} is not a URL slug`);
    if (collectionKeys.has(collection.key)) fail(sink, "collections:key-duplicate", `duplicate collection key ${collection.key}`);
    if (collectionHandles.has(collection.handle)) fail(sink, "collections:handle-duplicate", `duplicate collection handle ${collection.handle}`);
    collectionKeys.add(collection.key);
    collectionHandles.add(collection.handle);
    if (collection.title.trim().length === 0) fail(sink, "collections:title", `${collection.key}: title is blank`);
  }

  validateReturnWindowPin(sink);
}

/**
 * The return window is pinned against the *published* policy text, not just
 * against our own constant — the number a customer reads on /policies/returns
 * and the number the catalog stores must be the same number.
 */
function validateReturnWindowPin(sink: Sink): void {
  const text = policies.returns.sections
    .flatMap((section) => section.paragraphs)
    .join(" ");
  const match = /(\d+)\s+days?\s+from\s+delivery/i.exec(text);
  if (!match) {
    fail(sink, "returns:policy-parse", "published Returns policy no longer states its window as 'N days from delivery'");
    return;
  }
  const published = Number(match[1]);
  if (published !== RETURN_WINDOW_DAYS) {
    fail(
      sink,
      "returns:policy-pin",
      `published policy says ${published} days but the catalog promises ${RETURN_WINDOW_DAYS}`
    );
  }
}

function checkFact(
  sink: Sink,
  strict: boolean,
  label: string,
  fact: Fact<unknown>
): void {
  if (fact.known) {
    if (fact.value === undefined || fact.value === null) {
      fail(sink, "facts:empty-known", `${label} is marked known but has no value`);
    }
    return;
  }
  if (fact.reason.trim().length === 0) {
    fail(sink, "facts:reason-required", `${label} is unknown without a stated reason`);
    return;
  }
  // Unknown-but-honest is a warning by default and a release blocker under --strict.
  const message = `${label} is not measured yet: ${fact.reason}`;
  if (strict) fail(sink, "facts:unverified", message);
  else warn(sink, "facts:unverified", message);
}

/* ------------------------------------------------------------------ *
 * Step 3: every sellable variant maps to fulfillment, or says why not.
 * ------------------------------------------------------------------ */

function validateFulfillment(
  sink: Sink,
  strict: boolean,
  products: readonly CatalogProduct[],
  supplierMappings: Record<string, SupplierMapping>
): void {
  const fulfillment = buildFulfillment(products, supplierMappings);
  const sellableSkus = new Set(products.flatMap((product) => product.variants.map((variant) => variant.sku)));

  for (const sku of sellableSkus) {
    const record: FulfillmentRecord | undefined = fulfillment[sku];
    if (!record) {
      fail(sink, "fulfillment:coverage", `variant ${sku} has no fulfillment record`);
      continue;
    }
    if (record.mode === "supplier") {
      if (record.supplier.trim().length === 0 || record.supplierSku.trim().length === 0) {
        fail(sink, "fulfillment:supplier-fields", `${sku}: supplier mapping names neither supplier nor supplier SKU`);
      }
      if (Number.isNaN(Date.parse(record.verifiedOn))) {
        fail(sink, "fulfillment:supplier-date", `${sku}: verifiedOn is not an ISO date`);
      }
      if (record.evidence.trim().length === 0) {
        fail(sink, "fulfillment:supplier-evidence", `${sku}: mapping has no evidence of where it was checked`);
      }
      continue;
    }
    if (record.rule.trim().length === 0 || record.note.trim().length === 0) {
      fail(sink, "fulfillment:manual-fields", `${sku}: manual rule or buy-note is empty`);
    }
    if (record.sourcing === "pending") {
      const message = `${sku}: fulfillment is manual and the sourcing decision is still pending`;
      if (strict) fail(sink, "fulfillment:pending", message);
      else warn(sink, "fulfillment:pending", message);
    }
  }

  // A mapping nobody consumes is a misfiled instruction: surface it either way.
  for (const mappedSku of Object.keys(supplierMappings)) {
    if (!sellableSkus.has(mappedSku)) {
      fail(sink, "fulfillment:orphan-mapping", `supplier mapping for ${JSON.stringify(mappedSku)} matches no sellable variant`);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Step 4: media plan coverage (files themselves are checked under --strict).
 * ------------------------------------------------------------------ */

function validateMediaPlan(sink: Sink, products: readonly CatalogProduct[], media: readonly MediaEntry[]): void {
  const productKeys = new Set(products.map((product) => product.key));
  const seenFiles = new Set<string>();

  for (const entry of media) {
    const label = `${entry.productKey}#${entry.order}`;
    if (!productKeys.has(entry.productKey)) {
      fail(sink, "media:unknown-product", `${label}: media planned for a product that does not exist`);
      continue;
    }
    if (!MOTIFS[entry.motif]) {
      fail(sink, "media:motif", `${label}: motif ${JSON.stringify(entry.motif)} is not defined`);
    }
    if (entry.altText.trim().length === 0) {
      fail(sink, "media:alt", `${label}: alt text is blank`);
    } else if (entry.placeholder && !/^Illustration:/.test(entry.altText)) {
      // A stand-in must introduce itself as one; describing art as a photo of
      // the sourced item would be a claim about an item we have never held.
      fail(sink, "media:alt-placeholder", `${label}: placeholder alt text must begin "Illustration:"`);
    }
    if (entry.source.trim().length === 0) fail(sink, "media:source", `${label}: no source record`);
    if (entry.licence.trim().length === 0) fail(sink, "media:licence", `${label}: no licence record`);
    if (entry.placeholder && !entry.placeholderReason) {
      fail(sink, "media:placeholder-reason", `${label}: marked placeholder without stating why`);
    }
    if (entry.file !== `${PUBLIC_ROOT}${entry.url}` || !entry.file.startsWith(`${MEDIA_PUBLIC_DIR}/`)) {
      fail(sink, "media:path", `${label}: file ${JSON.stringify(entry.file)} and url ${JSON.stringify(entry.url)} disagree`);
    }
    if (seenFiles.has(entry.file)) fail(sink, "media:file-duplicate", `${label}: file ${entry.file} planned twice`);
    seenFiles.add(entry.file);
  }

  for (const product of products) {
    const entries = media.filter((entry) => entry.productKey === product.key);
    if (entries.length === 0) {
      fail(sink, "media:coverage", `${product.key}: has no planned media`);
      continue;
    }
    const orders = entries.map((entry) => entry.order).sort((a, b) => a - b);
    if (orders.some((order, index) => order !== index)) {
      fail(sink, "media:order", `${product.key}: image orders must be 0..n contiguous (got ${orders.join(", ")})`);
    }
  }
}

/**
 * `--strict` reads every planned file back from disk. The byte-identity check
 * is the whole point of the hand-rolled encoder: the same plan must produce the
 * same bytes, so the sha256 the seeder records in `ProductImage.metadata`
 * actually identifies the artwork in the repository.
 */
function validateMediaFiles(
  sink: Sink,
  rootDir: string,
  media: readonly MediaEntry[],
  files: ValidationResult["files"]
): void {
  for (const entry of media) {
    const label = `${entry.productKey}#${entry.order} (${entry.file})`;
    const absolute = path.resolve(rootDir, entry.file);
    if (!existsSync(absolute)) {
      fail(sink, "media:file-missing", `${label}: file not found — run \`npm run media:catalog\``);
      continue;
    }
    const bytes = readFileSync(absolute);
    try {
      const { width, height } = readPngSize(bytes);
      if (width !== MEDIA_SIZE || height !== MEDIA_SIZE) {
        fail(sink, "media:dimensions", `${label}: declared ${MEDIA_SIZE}px square but file is ${width}x${height}`);
      }
    } catch {
      fail(sink, "media:png", `${label}: not a readable PNG`);
      continue;
    }
    if (bytes.length > MAX_IMAGE_BYTES) {
      fail(sink, "media:bytes", `${label}: ${bytes.length} bytes exceeds the ${MAX_IMAGE_BYTES} byte budget`);
    }
    // Byte-identity is only claimable for artwork this repository generates.
    // Once a real photograph replaces a placeholder (placeholder: false), the
    // checks above still apply but the bytes are no longer re-renderable here.
    if (entry.placeholder) {
      const rendered = renderArtwork({
        motif: entry.motif,
        palette: entry.palette,
        backdrop: entry.backdrop,
        view: entry.view,
        size: MEDIA_SIZE,
      });
      if (!rendered.equals(bytes)) {
        fail(
          sink,
          "media:drift",
          `${label}: on-disk bytes differ from what the current renderer produces (file is stale or was edited by hand)`
        );
      }
    }
    files.push({
      file: entry.file,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
}

/**
 * Run every check. Returns issues instead of throwing so callers — the CLI,
 * the seeder, tests — decide what is fatal.
 */
export function validateCatalog(options: ValidateOptions = {}): ValidationResult {
  const strict = options.strict === true;
  const rootDir = options.rootDir ?? process.cwd();
  const products = options.products ?? PRODUCTS;
  const media = options.media ?? MEDIA;
  const supplierMappings = options.supplierMappings ?? SUPPLIER_MAPPINGS;

  const sink: Sink = { errors: [], warnings: [] };
  validateProducts(sink, strict, products);
  validateFulfillment(sink, strict, products, supplierMappings);
  validateMediaPlan(sink, products, media);

  const files: ValidationResult["files"] = [];
  if (strict) {
    validateMediaFiles(sink, rootDir, media, files);
  }
  return { strict, errors: sink.errors, warnings: sink.warnings, files };
}

/* ------------------------------------------------------------------ *
 * CLI: `npx tsx scripts/catalog/validate.ts [--strict]`
 * ------------------------------------------------------------------ */

function printResult(result: ValidationResult): void {
  for (const issue of result.warnings) console.log(`  warn  [${issue.code}] ${issue.message}`);
  for (const issue of result.errors) console.error(`  FAIL  [${issue.code}] ${issue.message}`);
  if (result.strict && result.files.length > 0) {
    console.log(`  checked ${result.files.length} media file(s) on disk:`);
    for (const file of result.files) {
      console.log(`    ${file.file}  ${file.bytes} bytes  sha256 ${file.sha256.slice(0, 16)}…`);
    }
  }
  const verdict = result.errors.length > 0
    ? `${result.errors.length} error(s), ${result.warnings.length} warning(s).`
    : result.strict
      ? `Strict validation passed (${result.warnings.length} warning(s)). This certifies data + media integrity, not launch readiness beyond what the checks state.`
      : `Validation passed with ${result.warnings.length} warning(s). \`--strict\` is the launch gate.`;
  console.log(verdict);
}

// Only run when executed directly (`tsx scripts/catalog/validate.ts`), never
// when imported by the seeder or by tests.
const invoked = (process.argv[1] ?? "").replace(/\\/g, "/");
if (invoked.endsWith("/scripts/catalog/validate.ts")) {
  const strict = process.argv.includes("--strict");
  const result = validateCatalog({ strict });
  printResult(result);
  if (result.errors.length > 0) process.exitCode = 1;
}


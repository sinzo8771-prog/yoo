/**
 * Keystone `document` field helpers (Task 4).
 *
 * Openfront stores `Product.description` as a Keystone document: a JSON array
 * of block nodes (`paragraph`, `heading`, `list`, `link`, ...), each holding
 * `children` with `text` leaves. The catalog client exposes flat text for
 * meta descriptions and fallbacks, while the raw document is kept for rich
 * rendering on the product page (Task 6).
 */

/** Defensive cap so a pathological document cannot blow up a page. */
const DEFAULT_MAX_LENGTH = 600;

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function collectText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) {
    return node.map(collectText).filter(Boolean).join(" ");
  }
  if (typeof node === "object") {
    const record = node as { text?: unknown; children?: unknown };
    const own = typeof record.text === "string" ? record.text : "";
    const children = collectText(record.children);
    return [own, children].filter(Boolean).join(" ");
  }
  return "";
}

/**
 * Flatten a Keystone document value into human-readable plain text.
 * Accepts the JSON array, a JSON string, or a plain string; anything else
 * yields `""` rather than throwing, because a malformed description must never
 * break a product page.
 */
export function documentToPlainText(
  document: unknown,
  maxLength: number = DEFAULT_MAX_LENGTH
): string {
  const source =
    typeof document === "string" ? tryParseJson(document) : document;
  const text = collectText(source).replace(/\s+/g, " ").trim();
  if (maxLength > 0 && text.length > maxLength) {
    return `${text.slice(0, maxLength - 1).trimEnd()}…`;
  }
  return text;
}

/** True when the value looks like a non-empty Keystone document. */
export function isDocumentValue(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "object" || typeof value === "string";
}
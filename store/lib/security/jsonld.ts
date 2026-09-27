/**
 * Task 18 — safe JSON-LD serialization for `<script type="application/ld+json">`.
 *
 * `JSON.stringify` alone is not safe inside a `<script>` element: a value
 * containing `</script>` (a product description is operator/catalog data, not
 * user input, but it is still untrusted by the time it reaches the browser)
 * would close the element early and the remainder would be parsed as HTML.
 * `toJsonLdString` escapes the characters that can end or alter an HTML script
 * element while remaining valid JSON, so `JSON.parse` of the emitted text
 * returns exactly the value that went in.
 */

/**
 * Serialize a value for a JSON-LD script element. Returns `"null"` for values
 * JSON cannot represent (functions, `undefined`, symbols), matching what
 * `JSON.stringify` would produce for them inside an object.
 */
export function toJsonLdString(value: unknown): string {
  const json = JSON.stringify(value);
  if (typeof json !== "string") return "null";
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** True when a serialized JSON-LD payload is safe to inline into a document. */
export function isSafeJsonLdDocument(serialized: string): boolean {
  return (
    typeof serialized === "string" &&
    serialized.length > 0 &&
    !serialized.includes("<") &&
    !serialized.includes(">")
  );
}

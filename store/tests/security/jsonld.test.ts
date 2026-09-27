/**
 * Task 18 — JSON-LD escaping for script-element context.
 *
 * Pins that browser-significant characters never survive serialization, that
 * the emitted text is still exactly parseable JSON equal to the input, and that
 * the safety predicate agrees with the serializer.
 */
import { describe, expect, it } from "vitest";

import { isSafeJsonLdDocument, toJsonLdString } from "@/lib/security/jsonld";

describe("toJsonLdString", () => {
  it("round-trips through JSON.parse", () => {
    const value = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Mug </script><img src=x onerror=alert(1)>",
      description: "Tea & coffee <b>bold</b>",
      offers: { price: "12.00", priceCurrency: "USD" },
    };
    const serialized = toJsonLdString(value);

    expect(JSON.parse(serialized)).toEqual(value);
    expect(serialized).not.toContain("<");
    expect(serialized).not.toContain(">");
    expect(serialized).not.toContain("&");
  });

  it("escapes ampersands and line separators", () => {
    expect(toJsonLdString({ a: "&" })).toContain("\\u0026");
    expect(toJsonLdString({ a: "x\u2028y\u2029z" })).toContain("\\u2028");
    expect(JSON.parse(toJsonLdString({ a: "x\u2028y" })).a).toBe("x\u2028y");
  });

  it("serializes non-encodable values as null", () => {
    expect(toJsonLdString(undefined)).toBe("null");
    expect(toJsonLdString(() => "x")).toBe("null");
    expect(toJsonLdString({ a: 1 })).toBe('{"a":1}');
  });
});

describe("isSafeJsonLdDocument", () => {
  it("accepts only non-empty, angle-bracket-free payloads", () => {
    expect(isSafeJsonLdDocument(toJsonLdString({ a: "<script>" }))).toBe(true);
    expect(isSafeJsonLdDocument('<script type="application/ld+json">')).toBe(false);
    expect(isSafeJsonLdDocument("")).toBe(false);
  });
});

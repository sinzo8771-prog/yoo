/**
 * Task 18 — zod schema validation at the Openfront API boundary.
 *
 * Pins that a well-formed store record is accepted (with a numeric `logoColor`
 * normalized to a string), that untyped, oversized or wrong-typed records are
 * rejected as a whole, that unknown fields survive without gaining a type
 * contract, and that provider URLs are bounded strings.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_PROVIDER_URL_LENGTH,
  MAX_STORE_MARKUP_LENGTH,
  MAX_STORE_TEXT_LENGTH,
  parseProviderUrl,
  parseStoreRecord,
} from "@/lib/security/schemas";

const RECORD = {
  id: "store_1",
  name: "Example Store",
  defaultCurrencyCode: "usd",
  homepageTitle: "Example Store",
  homepageDescription: "Mugs and more",
  logoIcon: '<svg><path d="M0 0"/></svg>',
  logoColor: "180",
  metadata: { theme: "light" },
};

describe("parseStoreRecord", () => {
  it("accepts a well-formed record", () => {
    const parsed = parseStoreRecord(RECORD);
    expect(parsed).not.toBeNull();
    expect(parsed?.id).toBe("store_1");
    expect(parsed?.logoColor).toBe("180");
  });

  it("normalizes a numeric logoColor to a string", () => {
    expect(parseStoreRecord({ ...RECORD, logoColor: 180 })?.logoColor).toBe("180");
  });

  it("treats absent optional fields as undefined", () => {
    const parsed = parseStoreRecord({ id: "store_1" });
    expect(parsed).not.toBeNull();
    expect(parsed?.logoIcon).toBeUndefined();
    expect(parsed?.logoColor).toBeUndefined();
  });

  it("rejects records that cannot be trusted", () => {
    const rejected = [
      undefined,
      null,
      "not an object",
      [],
      {},
      { id: "" },
      { id: "x".repeat(129) },
      { id: "store_1", name: 5 },
      { id: "store_1", defaultCurrencyCode: "x" },
      { id: "store_1", homepageTitle: "x".repeat(MAX_STORE_TEXT_LENGTH + 1) },
      { id: "store_1", logoIcon: "x".repeat(MAX_STORE_MARKUP_LENGTH + 1) },
      { id: "store_1", logoColor: "x".repeat(17) },
      { id: "store_1", logoColor: Number.POSITIVE_INFINITY },
    ];
    for (const value of rejected) {
      expect(parseStoreRecord(value), JSON.stringify(value)?.slice(0, 40)).toBeNull();
    }
  });

  it("keeps unknown fields without typing them", () => {
    const parsed = parseStoreRecord({ ...RECORD, extraField: "kept" });
    const asRecord = parsed as unknown as Record<string, unknown>;
    expect(asRecord.extraField).toBe("kept");
    expect(asRecord["@type"]).toBeUndefined();
  });
});

describe("parseProviderUrl", () => {
  it("accepts bounded non-empty strings", () => {
    expect(parseProviderUrl("https://developers.cjdropshipping.com")).toBe(
      "https://developers.cjdropshipping.com"
    );
    expect(parseProviderUrl("  https://example.com/x  ")).toBe("https://example.com/x");
  });

  it("rejects non-strings, blanks and oversized values", () => {
    for (const value of [undefined, null, 42, {}, "", "   "]) {
      expect(parseProviderUrl(value)).toBeNull();
    }
    expect(parseProviderUrl(`https://example.com/${"a".repeat(MAX_PROVIDER_URL_LENGTH)}`)).toBeNull();
  });
});

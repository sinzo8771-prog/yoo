import { describe, expect, it } from "vitest";

/**
 * Task 4 unit tests — Keystone document flattening.
 * A malformed description must never throw: it would take down a product page.
 */
import {
  documentToPlainText,
  isDocumentValue,
} from "@/features/catalog/lib/document";

describe("documentToPlainText", () => {
  it("joins paragraph text with spaces", () => {
    const doc = [
      { type: "paragraph", children: [{ text: "First line." }] },
      { type: "paragraph", children: [{ text: "Second line." }] },
    ];
    expect(documentToPlainText(doc)).toBe("First line. Second line.");
  });

  it("collapses whitespace and newlines", () => {
    const doc = [{ type: "paragraph", children: [{ text: "  a \n b  " }] }];
    expect(documentToPlainText(doc)).toBe("a b");
  });

  it("walks nested children (lists, links, headings)", () => {
    const doc = [
      {
        type: "list",
        children: [
          {
            type: "list-item",
            children: [
              { type: "paragraph", children: [{ text: "one" }] },
              {
                type: "paragraph",
                children: [
                  { text: "two " },
                  { type: "link", children: [{ text: "with link" }] },
                ],
              },
            ],
          },
        ],
      },
    ];
    expect(documentToPlainText(doc)).toBe("one two with link");
  });

  it("accepts a JSON string (as Prisma may return it)", () => {
    const json = JSON.stringify([
      { type: "paragraph", children: [{ text: "From a string." }] },
    ]);
    expect(documentToPlainText(json)).toBe("From a string.");
  });

  it("truncates with an ellipsis at the requested length", () => {
    const doc = [{ type: "paragraph", children: [{ text: "abcdefghij" }] }];
    expect(documentToPlainText(doc, 5)).toBe("abcd…");
    expect(documentToPlainText(doc, 0)).toBe("abcdefghij");
  });

  it("returns an empty string for nullish or malformed input", () => {
    expect(documentToPlainText(null)).toBe("");
    expect(documentToPlainText(undefined)).toBe("");
    expect(documentToPlainText([])).toBe("");
    expect(documentToPlainText(42)).toBe("");
    expect(documentToPlainText({ unexpected: true })).toBe("");
    expect(documentToPlainText("{not json")).toBe("{not json");
  });
});

describe("isDocumentValue", () => {
  it("recognises non-empty documents", () => {
    expect(isDocumentValue([{ type: "paragraph" }])).toBe(true);
    expect(isDocumentValue({ type: "paragraph" })).toBe(true);
    expect(isDocumentValue("text")).toBe(true);
  });

  it("rejects empties and nullish values", () => {
    expect(isDocumentValue([])).toBe(false);
    expect(isDocumentValue(null)).toBe(false);
    expect(isDocumentValue(undefined)).toBe(false);
  });
});
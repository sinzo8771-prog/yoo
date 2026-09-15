import { describe, expect, it } from "vitest";

import {
  firstSentence,
  productRationale,
  RATIONALE_MAX_LENGTH,
} from "@/features/catalog/lib/rationale";

describe("productRationale", () => {
  it("prefers the merchant subtitle over the description", () => {
    expect(
      productRationale({
        subtitle: "Hand-finished solid oak",
        description: "A generous board. Finished by hand.",
      })
    ).toBe("Hand-finished solid oak");
  });

  it("falls back to the first sentence of the description", () => {
    expect(
      productRationale({ description: "Thrown in small batches. Holds heat well." })
    ).toBe("Thrown in small batches.");
  });

  it("returns null when there is nothing real to say (never invents copy)", () => {
    expect(productRationale({ subtitle: "  ", description: "" })).toBeNull();
    expect(productRationale({})).toBeNull();
  });

  it("truncates overly long rationales to the card-safe maximum", () => {
    const long = `x${"o".repeat(RATIONALE_MAX_LENGTH + 50)}`;
    const result = productRationale({ subtitle: long });
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(RATIONALE_MAX_LENGTH);
  });

  it("firstSentence falls back to the whole string when there is no punctuation", () => {
    expect(firstSentence("no punctuation here")).toBe("no punctuation here");
    expect(firstSentence("   ")).toBe("");
  });
});
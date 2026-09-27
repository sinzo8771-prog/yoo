import { describe, expect, it } from "vitest";

/**
 * Task 19, Step 4 (unit) — `toMinorUnits`, the conversion the order confirmation
 * uses before reporting revenue to the funnel. A wrong parse here would show up
 * as fabricated revenue, so unparseable input must yield `undefined` rather than
 * `0` or `NaN`.
 */

import { formatMinorUnits, toMinorUnits } from "@/lib/format/money";

describe("toMinorUnits", () => {
  it("converts a major-unit string into minor units", () => {
    expect(toMinorUnits("45.00", "USD")).toBe(4500);
    expect(toMinorUnits("45.5", "USD")).toBe(4550);
    expect(toMinorUnits("0.01", "usd")).toBe(1);
    expect(toMinorUnits("1,234.56", "USD")).toBe(123456);
    expect(toMinorUnits(45, "USD")).toBe(4500);
  });

  it("does not scale zero-decimal currencies", () => {
    expect(toMinorUnits("4500", "JPY")).toBe(4500);
    expect(toMinorUnits("100", "krw")).toBe(100);
  });

  it("returns undefined instead of inventing a number", () => {
    for (const value of ["", " ", "abc", "-5", "1e3", "12..3", "$45.00 extra", null, undefined, Number.NaN]) {
      expect(toMinorUnits(value as never, "USD"), String(value)).toBeUndefined();
    }
  });

  it("round-trips through the formatter", () => {
    const minor = toMinorUnits("45.00", "USD")!;
    expect(formatMinorUnits(minor, "USD")).toBe("$45.00");
  });
});
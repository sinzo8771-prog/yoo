import { describe, expect, it } from "vitest";

import { formatMinorUnits, isZeroDecimalCurrency, toMajorUnits } from "@/lib/format/money";

describe("money formatting", () => {
  it("converts minor units to major units before formatting", () => {
    expect(formatMinorUnits(2400, "usd")).toBe("$24.00");
    expect(formatMinorUnits(1800, "usd")).toBe("$18.00");
  });

  it("does not divide zero-decimal currencies", () => {
    expect(isZeroDecimalCurrency("jpy")).toBe(true);
    expect(isZeroDecimalCurrency("usd")).toBe(false);
    expect(toMajorUnits(2400, "jpy")).toBe(2400);
    expect(toMajorUnits(2400, "usd")).toBe(24);
  });

  it("returns null for missing/invalid amounts instead of a misleading zero", () => {
    expect(formatMinorUnits(null, "usd")).toBeNull();
    expect(formatMinorUnits(undefined, "usd")).toBeNull();
    expect(formatMinorUnits(Number.NaN, "usd")).toBeNull();
  });

  it("never throws on malformed currency codes (falls back to a plain number)", () => {
    expect(formatMinorUnits(2400, "U$!")).toBe("24");
  });
});
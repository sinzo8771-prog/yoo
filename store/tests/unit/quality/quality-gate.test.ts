import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Task 23, Step 1 unit tests — the quality gate's comparison logic and the
 * shape of the baseline it ships with.
 *
 * The gate is the thing that keeps CI honest while 662 legacy lint/type
 * problems are still on the books, so its two rules are pinned here:
 * identical runs pass, and anything genuinely new fails. The baseline file
 * itself is checked for *structure* (not its exact counts) so regenerating it
 * after real fixes stays a routine, expected change.
 */
import { diff, tally, total } from "@/scripts/quality-gate";

const BASELINE_PATH = path.resolve(__dirname, "../../../scripts/quality-baseline.json");

describe("quality gate comparison", () => {
  it("counts repeated problems instead of collapsing them", () => {
    const counts = tally(["a | error | TS1 | x", "a | error | TS1 | x", "b | error | TS2 | y"]);
    expect(total(counts)).toBe(3);
    expect(counts["a | error | TS1 | x"]).toBe(2);
  });

  it("passes when nothing changed", () => {
    const counts = tally(["a | error | TS1 | x"]);
    expect(diff(counts, counts)).toEqual({ added: [], fixed: [] });
  });

  it("flags a problem that is not in the baseline", () => {
    const result = diff(tally(["a | error | TS1 | x"]), tally(["a | error | TS1 | x", "c | error | TS9 | z"]));
    expect(result.added).toEqual([["c | error | TS9 | z", 1]]);
    expect(result.fixed).toEqual([]);
  });

  it("flags only the extra occurrences when a known problem is duplicated", () => {
    // Fixing one of three identical errors must not forgive the other two.
    const result = diff(tally(["a | error | TS1 | x", "a | error | TS1 | x"]), tally(["a | error | TS1 | x"]));
    expect(result.added).toEqual([]);
    expect(result.fixed).toEqual([["a | error | TS1 | x", 1]]);

    const worse = diff(tally(["a | error | TS1 | x"]), tally(["a | error | TS1 | x", "a | error | TS1 | x"]));
    expect(worse.added).toEqual([["a | error | TS1 | x", 1]]);
  });

  it("reports fixed problems so the baseline can shrink", () => {
    const result = diff(tally(["a | error | TS1 | x", "b | error | TS2 | y"]), tally([]));
    expect(result.added).toEqual([]);
    expect(total(Object.fromEntries(result.fixed))).toBe(2);
  });

  it("treats an empty baseline as 'everything is new'", () => {
    const result = diff({}, tally(["a | warn | rule | m"]));
    expect(result.added).toEqual([["a | warn | rule | m", 1]]);
  });
});

describe("checked-in baseline", () => {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Record<
    string,
    Record<string, number>
  >;

  it("is strict JSON with both checks present and non-empty", () => {
    // If this file ever gains a comment or a trailing comma, every CI run dies
    // with a parse error — so the format is asserted, not assumed.
    for (const check of ["lint", "typecheck"]) {
      expect(Object.keys(baseline[check] ?? {}).length, `${check} entries`).toBeGreaterThan(0);
    }
  });

  it("keys every entry as `file | severity | code | message` with a positive count", () => {
    for (const check of ["lint", "typecheck"]) {
      for (const [key, count] of Object.entries(baseline[check])) {
        // Only the leading fields are asserted: a rule message may itself
        // contain " | ", but it must be whitespace-collapsed and single-line.
        expect(key, `${check}: ${key}`).toMatch(
          /^[^|]+\| (error|warn|warning) \| (TS\d+|fatal|@?[\w@/.-]+) \| \S/
        );
        expect(key, `${check}: ${key}`).not.toMatch(/[\r\n\t]/);
        expect(count, `${check}: ${key}`).toBeGreaterThan(0);
        expect(Number.isInteger(count)).toBe(true);
      }
    }
  });

  it("excludes generated and vendored paths that CI never lints", () => {
    for (const check of ["lint", "typecheck"]) {
      for (const key of Object.keys(baseline[check])) {
        expect(key.startsWith("generated/"), `${check}: ${key}`).toBe(false);
        expect(key.startsWith(".next/"), `${check}: ${key}`).toBe(false);
      }
    }
  });
});

/**
 * Task 23, Step 1 — baseline-gated quality gate for `lint` and `typecheck`.
 *
 * Why this exists: the storefront was written against a scaffold whose checks
 * had never run. `next lint` was removed in Next 16, and `tsc --noEmit` reports
 * 193 pre-existing type errors. A CI job that runs either verbatim would be red
 * on day one, and a CI job that never runs them is decoration. So both are
 * recorded as *baselines*:
 *
 *  - `lint:ci`      → `eslint . -f json` (errors + warnings)
 *  - `typecheck:ci` → `tsc --noEmit --pretty false`
 *
 * The gate fails only on **new** problems. A problem is identified by
 * `file | severity | code | message` with line/column stripped and occurrences
 * counted, so inserting a line above an existing problem does not "fix" it and
 * re-introducing a fixed problem is still caught. Counts (not just presence)
 * matter: three identical `TS2322`s in one file are three entries, and fixing
 * one must not silently forgive the other two.
 *
 * Baselines are **never** updated automatically — CI cannot write to the repo.
 * To adopt a new baseline (after deliberately fixing or re-scoping problems):
 *
 *     npm run quality:baseline
 *
 * which rewrites `scripts/quality-baseline.json` and prints a summary. Review
 * that diff like any other change: a baseline that grows is a regression, and a
 * baseline that shrinks is progress worth noting in the PR.
 *
 * Raw, ungated output stays available (`npm run lint`, `npm run typecheck`), so
 * a developer can still see every problem.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Store package root: the parent of `scripts/`. */
const ROOT = path.resolve(__dirname, "..");
const BASELINE_PATH = path.join(ROOT, "scripts", "quality-baseline.json");

type Check = "lint" | "typecheck";
/** problem key → how many times it occurs (duplicates are real). */
export type ProblemCounts = Record<string, number>;
type Baselines = Record<Check, ProblemCounts>;

const CHECKS: Check[] = ["lint", "typecheck"];

function emptyBaselines(): Baselines {
  return { lint: {}, typecheck: {} };
}

function loadBaselines(): Baselines {
  if (!existsSync(BASELINE_PATH)) return emptyBaselines();
  let parsed: unknown;
  try {
    // Strict JSON on purpose: the file is machine-written and machine-read, and
    // a `//` comment or a trailing comma here would fail every CI run with a
    // parse error instead of a useful message.
    parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch (error) {
    throw new Error(
      `${path.relative(ROOT, BASELINE_PATH)} is not valid JSON (${
        error instanceof Error ? error.message : String(error)
      }). Regenerate it with \`npm run quality:baseline\`.`
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${BASELINE_PATH} is not a JSON object`);
  }
  const out = emptyBaselines();
  for (const check of CHECKS) {
    const section = (parsed as Record<string, unknown>)[check];
    if (typeof section === "object" && section !== null) {
      for (const [key, count] of Object.entries(section as Record<string, unknown>)) {
        if (typeof count === "number" && count > 0) out[check][key] = count;
      }
    }
  }
  return out;
}

function writeBaselines(baselines: Baselines): void {
  const ordered: Baselines = { lint: {}, typecheck: {} };
  for (const check of CHECKS) {
    for (const key of Object.keys(baselines[check]).sort()) {
      ordered[check][key] = baselines[check][key];
    }
  }
  // No comment header: this file is parsed by `loadBaselines`, and JSON has no
  // comments. The rationale lives in this file's header and in the plan.
  writeFileSync(BASELINE_PATH, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
}

/** Count occurrences of each key. */
export function tally(keys: string[]): ProblemCounts {
  const counts: ProblemCounts = {};
  for (const key of keys) counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}

function runNode(bin: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function toPosix(relative: string): string {
  return relative.split(path.sep).join("/");
}

/**
 * ESLint's JSON output. Messages are keyed without line/column so a pure line
 * shift is not reported as a new problem; `fatal` (ruleId null) is kept because
 * a parse/config crash must still fail the gate.
 */
function collectLint(): string[] {
  const bin = path.join(ROOT, "node_modules", "eslint", "bin", "eslint.js");
  const { stdout, stderr } = runNode(bin, [".", "-f", "json"]);
  if (!stdout.trim()) {
    throw new Error(`eslint produced no JSON output:\n${stderr}`);
  }
  const results = JSON.parse(stdout) as Array<{
    filePath?: string;
    messages?: Array<{ ruleId?: string | null; severity?: number; message?: string }>;
  }>;
  const keys: string[] = [];
  for (const result of results) {
    const file = toPosix(path.relative(ROOT, result.filePath ?? ""));
    for (const message of result.messages ?? []) {
      const severity = message.severity === 2 ? "error" : "warn";
      const rule = message.ruleId ?? "fatal";
      // Collapse whitespace: several rules emit multi-line messages with code
      // frames, which would otherwise put newlines into a JSON key and make the
      // baseline unreadable.
      const text = (message.message ?? "").replace(/\s+/g, " ").trim();
      keys.push(`${file} | ${severity} | ${rule} | ${text}`);
    }
  }
  return keys;
}

/** tsc lines look like: `path(line,col): error TSxxxx: message`. */
function collectTypecheck(): string[] {
  const bin = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");
  const { stdout, stderr } = runNode(bin, ["--noEmit", "--pretty", "false"]);
  const keys: string[] = [];
  for (const line of `${stdout}\n${stderr}`.split(/\r?\n/)) {
    const match = /^(.+?)\(\d+,\d+\):\s+(error|warning)\s+(TS\d+):\s*(.*)$/.exec(line.trim());
    if (match) {
      const [, file, kind, code, message] = match;
      keys.push(`${toPosix(file)} | ${kind} | ${code} | ${message}`);
    }
  }
  return keys;
}

const COLLECTORS: Record<Check, () => string[]> = {
  lint: collectLint,
  typecheck: collectTypecheck,
};

/**
 * Problems present now but not (or more often than) baselined, and problems
 * baselined that no longer occur. Neither side is a silent pass: `added` fails
 * the gate, `fixed` is reported so the baseline can shrink.
 */
export function diff(baseline: ProblemCounts, current: ProblemCounts) {
  const added: Array<[string, number]> = [];
  const fixed: Array<[string, number]> = [];
  for (const [key, count] of Object.entries(current)) {
    const known = baseline[key] ?? 0;
    if (count > known) added.push([key, count - known]);
  }
  for (const [key, count] of Object.entries(baseline)) {
    const now = current[key] ?? 0;
    if (now < count) fixed.push([key, count - now]);
  }
  return { added, fixed };
}

export function total(counts: ProblemCounts): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

/** Only the first few print; a wall of text hides the one that matters. */
const MAX_PRINTED = 10;

function runCheck(check: Check, baselines: Baselines, update: boolean): boolean {
  const current = tally(COLLECTORS[check]());
  const previous = total(baselines[check]);
  if (update) {
    baselines[check] = current;
    console.log(
      `  ${check}: baselined ${total(current)} problem(s) (was ${previous}) in ${BASELINE_PATH}.`
    );
    return true;
  }
  const { added, fixed } = diff(baselines[check], current);
  console.log(`  ${check}: ${total(current)} problem(s) reported, ${previous} baselined.`);
  const fixedCount = fixed.reduce((sum, [, count]) => sum + count, 0);
  if (fixedCount > 0) {
    console.log(
      `    ${fixedCount} no longer reported — run \`npm run quality:baseline\` to shrink the baseline.`
    );
    for (const [key] of fixed.slice(0, MAX_PRINTED)) console.log(`    fixed: ${key}`);
  }
  if (added.length === 0) return true;
  console.error(`    ${added.length} NEW problem(s) not in the baseline:`);
  for (const [key, count] of added.slice(0, MAX_PRINTED)) {
    console.error(`    new: ${key}${count > 1 ? ` (x${count})` : ""}`);
  }
  if (added.length > MAX_PRINTED) {
    console.error(`    …and ${added.length - MAX_PRINTED} more.`);
  }
  console.error(
    "    Fix them, or — only if they are understood pre-existing problems — regenerate the baseline deliberately with `npm run quality:baseline`."
  );
  return false;
}

function main(): void {
  const args = process.argv.slice(2);
  const update = args.includes("--update");
  const requested = args.filter((arg) => !arg.startsWith("--")) as Check[];

  for (const check of requested) {
    if (!CHECKS.includes(check)) {
      console.error(`Unknown check ${JSON.stringify(check)}. Use: ${CHECKS.join(", ")} [--update]`);
      process.exitCode = 2;
      return;
    }
  }
  const checks = requested.length > 0 ? requested : CHECKS;

  const baselines = loadBaselines();
  let ok = true;
  console.log(`Quality gate (${update ? "updating baseline" : "checking against baseline"}):`);
  for (const check of checks) {
    if (!runCheck(check, baselines, update)) ok = false;
  }
  if (update) {
    writeBaselines(baselines);
    console.log(`Wrote ${path.relative(ROOT, BASELINE_PATH)}.`);
    return;
  }
  if (!ok) {
    console.error("Quality gate FAILED: new problems must be fixed before merge.");
    process.exitCode = 1;
    return;
  }
  console.log("Quality gate passed: no new lint or type problems.");
}

// Only run when invoked directly (`tsx scripts/quality-gate.ts …`), never when
// imported by tests.
const invoked = (process.argv[1] ?? "").replace(/\\/g, "/");
if (invoked.endsWith("/scripts/quality-gate.ts")) {
  main();
}


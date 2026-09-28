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
 * Two things are deliberately *not* counted, because they belong to the
 * checkout rather than to the code, and counting them would make the gate fail
 * on a clean machine while passing on the developer's:
 *
 *  - an embedded absolute path + code frame inside a rule's message (React
 *    Compiler rules do this) — normalized away in `normalizeLintMessage`, so
 *    the key is the same on Windows and on the Linux runner;
 *  - an embedded absolute path inside a *tsc* message (`TS7016` quotes the file
 *    it actually resolved, which is machine-specific) — normalized away in
 *    `normalizeTypeMessage` for the same reason;
 *  - `TS2307` for a module that lives in one of the pinned reference clones,
 *    which are gitignored and therefore absent in CI — classified by
 *    `isEnvironmentDependentTypeError` and *reported* rather than counted. Fix
 *    the environment (check the clone out) and any genuine `TS2307` counts
 *    again the moment the module could have resolved.
 *
 * Raw, ungated output stays available (`npm run lint`, `npm run typecheck`), so
 * a developer can still see every problem.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isMissingReferenceCloneModule } from "./reference-clones";

/** Store package root: the parent of `scripts/`. */
const ROOT = path.resolve(__dirname, "..");
const BASELINE_PATH = path.join(ROOT, "scripts", "quality-baseline.json");

type Check = "lint" | "typecheck";
/** problem key → how many times it occurs (duplicates are real). */
export type ProblemCounts = Record<string, number>;
/**
 * One check's findings: the keys the gate counts, plus the keys this checkout
 * cannot see the cause of — only `TS2307` for a module inside a reference clone
 * that is not checked out here (see the file header).
 */
type Collected = { keys: string[]; environmentDependent: string[] };
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

/** `path/to/file.tsx:12:3` — the header of a code frame embedded in a message. */
const CODE_FRAME_LABEL = /[^\s|]*\.(?:[cm]?[jt]sx?):\d+:\d+/;

/**
 * The message half of a lint key, with the parts that describe *this checkout*
 * instead of the code removed.
 *
 * Most rules emit one stable sentence, but the React Compiler rules
 * (`react-hooks/refs`, `react-hooks/purity`, `react-hooks/set-state-in-effect`,
 * `react-hooks/preserve-manual-memoization`) append the file's absolute path, a
 * `line:col` label and the surrounding source lines. Kept verbatim, one problem
 * keys as `… C:\Users\dev\…\TrackEvent.tsx:30:3 …` on a workstation and
 * `… /home/runner/work/yoo/yoo/store/…:30:3 …` on the CI runner, so every one of
 * them is reported as both fixed *and* new — a red gate on an unchanged tree.
 * The code frame has a second problem of its own: it renumbers whenever a line
 * is inserted above it, which the "no line/column in the key" rule exists to
 * prevent.
 *
 * Cutting at the label keeps the rule's own summary, which is what the baseline
 * is comparing. `undefined`/empty messages keep their (empty) text so a `fatal`
 * entry is still keyed distinctly.
 */
export function normalizeLintMessage(message: string): string {
  // Collapse whitespace first: several rules emit multi-line messages with code
  // frames, which would otherwise put newlines into a JSON key and make the
  // baseline unreadable.
  const collapsed = message.replace(/\s+/g, " ").trim();
  const label = collapsed.search(CODE_FRAME_LABEL);
  return label === -1 ? collapsed : collapsed.slice(0, label).trim();
}

/**
 * ESLint's JSON output. Messages are keyed without line/column so a pure line
 * shift is not reported as a new problem; `fatal` (ruleId null) is kept because
 * a parse/config crash must still fail the gate.
 */
function collectLint(): Collected {
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
      const text = normalizeLintMessage(message.message ?? "");
      keys.push(`${file} | ${severity} | ${rule} | ${text}`);
    }
  }
  // ESLint needs no environment-dependent classification: it resolves no
  // modules, so a clone-less checkout lints exactly the same tree.
  return { keys, environmentDependent: [] };
}

/**
 * The message half of a typecheck key, with machine-specific absolute paths
 * replaced by a placeholder.
 *
 * `TS7016` ("Could not find a declaration file for module 'x'") quotes the file
 * tsc actually resolved — `'C:/Users/dev/…/lodash.js'` on a workstation,
 * `'/home/runner/work/yoo/yoo/store/node_modules/lodash/lodash.js'` on the CI
 * runner. Keyed verbatim, the *same* problem is "new" on every machine other
 * than the one the baseline was written on, which is exactly the
 * Windows-green/Linux-red failure `normalizeLintMessage` exists for on the lint
 * side. Only the quoted absolute path is replaced; the identifying half of the
 * message (which module, what is wrong with it) stays verbatim, and a relative
 * quoted specifier (`'../generated/openfront-db'`, `'lodash'`) is untouched.
 */
export function normalizeTypeMessage(message: string): string {
  return message.replace(/'(?:[A-Za-z]:[\\/]|\/)[^']*'/g, "'{{path}}'");
}

/** tsc lines look like: `path(line,col): error TSxxxx: message`. */
function collectTypecheck(): Collected {
  const bin = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");
  const { stdout, stderr } = runNode(bin, ["--noEmit", "--pretty", "false"]);
  const keys: string[] = [];
  const environmentDependent: string[] = [];
  for (const line of `${stdout}\n${stderr}`.split(/\r?\n/)) {
    const match = /^(.+?)\(\d+,\d+\):\s+(error|warning)\s+(TS\d+):\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const [, file, kind, code, rawMessage] = match;
    const key = `${toPosix(file)} | ${kind} | ${code} | ${normalizeTypeMessage(rawMessage)}`;
    if (isEnvironmentDependentTypeError(file, code, rawMessage)) environmentDependent.push(key);
    else keys.push(key);
  }
  return { keys, environmentDependent };
}

/**
 * Is this type error caused by the checkout rather than by the code?
 *
 * Exactly one shape qualifies: `TS2307` ("Cannot find module") for a module
 * that lives inside a pinned reference clone which is not checked out here. The
 * importer is not wrong and cannot be fixed from this repository — but the
 * moment the clone *is* present the import resolves and the same code counts
 * against the baseline again, so a mistake of this shape is never permanently
 * forgiven.
 *
 * Everything else counts, including `TS2307` for a module this repository is
 * supposed to own (`../generated/openfront-db`, for instance: a missing
 * `prisma generate`, not a missing clone — CI runs the generator for exactly
 * that reason).
 */
export function isEnvironmentDependentTypeError(file: string, code: string, message: string): boolean {
  if (code !== "TS2307") return false;
  const specifier = /^Cannot find module '([^']+)'/.exec(message)?.[1];
  return specifier !== undefined && isMissingReferenceCloneModule(specifier, file);
}

const COLLECTORS: Record<Check, () => Collected> = {
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

/**
 * Say out loud what the gate is *not* counting. Staying silent would make the
 * tolerance a hidden hole: these keys cannot be verified in this checkout, so
 * they are printed on every run — and when the reference clones are present
 * (a recon workstation) this prints nothing at all, because nothing qualifies.
 */
function reportEnvironmentDependent(keys: string[]): void {
  if (keys.length === 0) return;
  console.log(
    `    ${keys.length} problem(s) point into a reference clone that is not checked out here (reported, not counted):`
  );
  for (const key of keys.slice(0, MAX_PRINTED)) console.log(`    env: ${key}`);
  if (keys.length > MAX_PRINTED) console.log(`    …and ${keys.length - MAX_PRINTED} more.`);
}

function runCheck(check: Check, baselines: Baselines, update: boolean): boolean {
  const collected = COLLECTORS[check]();
  const current = tally(collected.keys);
  const previous = total(baselines[check]);
  if (update) {
    baselines[check] = current;
    console.log(
      `  ${check}: baselined ${total(current)} problem(s) (was ${previous}) in ${BASELINE_PATH}.`
    );
    reportEnvironmentDependent(collected.environmentDependent);
    return true;
  }
  const { added, fixed } = diff(baselines[check], current);
  console.log(`  ${check}: ${total(current)} problem(s) reported, ${previous} baselined.`);
  reportEnvironmentDependent(collected.environmentDependent);
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


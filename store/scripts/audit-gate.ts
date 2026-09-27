/**
 * Task 23, Step 4 — dependency audit gate (`npm run audit:ci`).
 *
 * Why not `npm audit --audit-level=high` directly: that command is *always* red
 * on this tree. Task 18 measured it — "exits non-zero: 64 findings … 19 high /
 * 5 critical" — and recorded why several of them cannot be fixed from here
 * (`@keystone-6/core` and friends have no released fix; others need a breaking
 * major). They are Threat-model residual risk 1, not news. A job that is red on
 * day one gets deleted or ignored, which is exactly the failure mode the lint
 * and typecheck baselines in this same CI exist to avoid.
 *
 * So this gate uses the same rule as `scripts/quality-gate.ts`: the *known* set
 * is written down and reviewed (`scripts/audit-allowlist.json`), and the job
 * fails on anything **new**. That keeps the signal — a fresh advisory, or a
 * known advisory spreading to a new package, still fails the build — while the
 * accepted set stays visible in one place, per advisory id, with its title.
 *
 * The allowlist is deliberately advisory-id + package rather than a count: npm's
 * report changes shape as the registry's database is updated, and a count would
 * silently absorb a swap. Severity is part of the key too, so a re-classified
 * advisory (moderate → critical) is *not* silently accepted.
 *
 * No credential and no repository write: `npm audit` reads the public registry,
 * and the baseline is a checked-in file a human edits on purpose.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const ALLOWLIST_PATH = path.join(ROOT, "scripts", "audit-allowlist.json");

/** npm's severity vocabulary, weakest first — the index *is* the comparison. */
const SEVERITIES = ["info", "low", "moderate", "high", "critical"] as const;
type Severity = (typeof SEVERITIES)[number];

/** One advisory, identified by the GHSA id npm links to plus the package it affects. */
export type Advisory = { package: string; id: string; severity: Severity; title: string };

export type AuditAllowlist = { reviewed: string; threshold: Severity; advisories: Advisory[] };

function isAtLeast(severity: string, threshold: Severity): boolean {
  const rank = SEVERITIES.indexOf(severity as Severity);
  return rank >= SEVERITIES.indexOf(threshold);
}

/**
 * Advisories at or above the allowlist's threshold. `vulnerabilities[<pkg>].via`
 * carries the advisories for that package as objects (a bare string means "this
 * package is vulnerable *through* another one, see that entry"), which is what
 * makes a stable `package + GHSA id` key possible.
 */
export function collectAdvisories(report: unknown, threshold: Severity): Advisory[] {
  const vulnerabilities = (report as { vulnerabilities?: Record<string, unknown> }).vulnerabilities ?? {};
  const found: Advisory[] = [];
  for (const [name, entry] of Object.entries(vulnerabilities)) {
    const via = (entry as { via?: unknown[] }).via ?? [];
    for (const item of via) {
      if (typeof item !== "object" || item === null) continue;
      const { severity, title, url } = item as { severity?: string; title?: string; url?: string };
      const id = /GHSA-[0-9a-z-]+/i.exec(url ?? "")?.[0];
      if (!id || !severity || !title) continue;
      if (!isAtLeast(severity, threshold)) continue;
      found.push({ package: name, id, severity: severity as Severity, title });
    }
  }
  // npm can list the same advisory more than once for a package (it reaches the
  // package through several paths); a baseline wants the distinct set, not the
  // multiplicity, and the comparison below is set-based anyway.
  const unique = new Map(
    found.map((advisory) => [`${advisory.package}|${advisory.id}|${advisory.severity}`, advisory])
  );
  return [...unique.values()].sort((a, b) => a.package.localeCompare(b.package) || a.id.localeCompare(b.id));
}


/**
 * The two directions the gate reports: `added` fails the build, `resolved`
 * means the allowlist can shrink (an upgrade landed, or the advisory was
 * withdrawn). An entry whose *severity* changed counts as added — a
 * re-classification is a new fact, not a silent one.
 */
export function compare(current: Advisory[], allowed: Advisory[]): { added: Advisory[]; resolved: Advisory[] } {
  const key = (advisory: Advisory) => `${advisory.package}|${advisory.id}|${advisory.severity}`;
  const allowedKeys = new Set(allowed.map(key));
  const currentKeys = new Set(current.map(key));
  return {
    added: current.filter((advisory) => !allowedKeys.has(key(advisory))),
    resolved: allowed.filter((advisory) => !currentKeys.has(key(advisory))),
  };
}

function loadAllowlist(): AuditAllowlist {
  if (!existsSync(ALLOWLIST_PATH)) {
    throw new Error(
      `Missing ${path.relative(ROOT, ALLOWLIST_PATH)} — the audit gate needs its reviewed baseline.`
    );
  }
  return JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")) as AuditAllowlist;
}

/**
 * npm's CLI entry point. Spawning `npm.cmd` directly is refused by Node on
 * Windows (EINVAL) and `shell: true` only exists to work around that — with the
 * deprecation warning to match — so npm's JS entry is run with the current node
 * binary instead: same npm, no shell, both platforms.
 */
function npmCliPath(): string {
  // `npm run` exports the path it is executing; a direct `tsx scripts/audit-gate.ts` guesses.
  const fromEnv = process.env.npm_execpath;
  if (fromEnv && fromEnv.endsWith(".js") && existsSync(fromEnv)) return fromEnv;
  const bundled = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (existsSync(bundled)) return bundled;
  throw new Error("Cannot locate npm's CLI entry point — run this as `npm run audit:ci`.");
}

/**
 * `npm audit --json` exits non-zero whenever it finds anything, so only stdout
 * matters. A report *without* `metadata.vulnerabilities` is not "clean", it is
 * an audit that did not run (proxied/offline/wrapped npm, registry error): that
 * must fail the job rather than pass it, or the gate would report success on
 * exactly the day it stopped looking.
 */
function auditReport(): unknown {
  // `npm run` exports every npmrc setting as `npm_config_*` for its child
  // scripts, so this gate inherits `npm_config_allow_scripts` from the invoking
  // user's *user-level* ~/.npmrc (a setting belonging to a different tool).
  // npm treats an env-resolved value exactly like the `--allow-scripts` CLI
  // flag and refuses it in project-scoped runs (`EALLOWSCRIPTS`), which would
  // make the audit emit an error object instead of a report on every machine
  // whose global npmrc happens to set it. The flag is irrelevant to `audit`
  // either way, so drop it from the child's environment; every other setting
  // (registry, auth, proxy) is deliberately left intact.
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.npm_config_allow_scripts;
  delete env.npm_config_allowScripts;
  const result = spawnSync(process.execPath, [npmCliPath(), "audit", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env,
  });
  const stdout = result.stdout ?? "";
  if (!stdout.trim()) {
    throw new Error(`npm audit produced no output (exit ${result.status}):\n${result.stderr ?? ""}`);
  }
  const report = JSON.parse(stdout) as { metadata?: { vulnerabilities?: unknown } };
  if (typeof report.metadata?.vulnerabilities !== "object" || report.metadata.vulnerabilities === null) {
    throw new Error(
      `npm audit returned a report without a metadata.vulnerabilities summary — refusing to pass. Output:\n${stdout.slice(0, 2000)}`
    );
  }
  return report;
}

export function main(): void {
  const allowlist = loadAllowlist();
  const report = auditReport() as { metadata?: { vulnerabilities?: Record<string, number> } };
  const totals = report.metadata?.vulnerabilities ?? {};
  const current = collectAdvisories(report, allowlist.threshold);
  const { added, resolved } = compare(current, allowlist.advisories);

  console.log(
    `Dependency audit (registry severity >= ${allowlist.threshold}; allowlist reviewed ${allowlist.reviewed}):`
  );
  console.log(
    `  tree: ${Object.entries(totals).map(([severity, count]) => `${count} ${severity}`).join(", ") || "no findings"}`
  );
  console.log(
    `  at or above ${allowlist.threshold}: ${current.length} advisory(ies), ${allowlist.advisories.length} allow-listed.`
  );

  if (resolved.length > 0) {
    console.log(`  ${resolved.length} allow-listed advisory(ies) no longer reported — move them out of the allowlist:`);
    for (const advisory of resolved) {
      console.log(`    resolved: ${advisory.package} ${advisory.id} (${advisory.severity})`);
    }
  }
  if (added.length === 0) {
    console.log("Dependency audit passed: no new high-or-worse advisories.");
    return;
  }
  console.error(`  ${added.length} NEW high-or-worse advisory(ies) not in the allowlist:`);
  for (const advisory of added) {
    console.error(`    new: ${advisory.package} ${advisory.id} (${advisory.severity}) — ${advisory.title}`);
  }
  console.error(
    "  Upgrade or remove the dependency. Only add an entry to scripts/audit-allowlist.json when the risk is understood and recorded (see docs/security/threat-model.md)."
  );
  process.exitCode = 1;
}

const invoked = (process.argv[1] ?? "").replace(/\\/g, "/");
if (invoked.endsWith("/scripts/audit-gate.ts")) {
  main();
}

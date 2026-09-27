/**
 * Task 23 (CI follow-up) — the pinned reference clones.
 *
 * `README.md` calls `openship/`, `openfront/` and `openfront-storefront/`
 * *pinned reference clones*: upstream checkouts kept in this workspace on
 * purpose, gitignored on purpose. The consequence is easy to forget and has to
 * be handled explicitly, because the two situations are both normal:
 *
 *   - on a recon workstation the clones are there, so suites that exercise the
 *     pinned router/adapter/route code *and* `tsc`'s view of it are complete;
 *   - in a fresh checkout — including CI — they are not there at all.
 *
 * Without this module the difference shows up as noise: a suite dies with
 * "Cannot find module '../../../../openship/…'" instead of skipping and saying
 * why, and `tsc` reports eight `TS2307`s that look exactly like a typo.
 *
 * So the path arithmetic lives here once, and both consumers read it:
 *
 *   - `hasReferenceClone` gates suites (`describe.skipIf`) — see
 *     `tests/reference-clones.ts` for the test-side wrapper;
 *   - `isMissingReferenceCloneModule` lets `scripts/quality-gate.ts` tell an
 *     environmental `TS2307` ("that module lives in a clone this checkout does
 *     not have") apart from a real one ("this repository cannot resolve its own
 *     module"). Only the former is tolerated, and only while it is true.
 */
import { existsSync } from "node:fs";
import path from "node:path";

/** Directory names at the repository root, in the order `README.md` lists them. */
export const REFERENCE_CLONES = ["openship", "openfront", "openfront-storefront"] as const;

export type ReferenceClone = (typeof REFERENCE_CLONES)[number];

/** The store app root — the directory every check runs from, so gate keys are relative to it. */
export const STORE_ROOT = path.resolve(__dirname, "..");

/** Repository root: the clones are siblings of `store/`. */
export const REPO_ROOT = path.resolve(STORE_ROOT, "..");

export function referenceClonePath(clone: ReferenceClone): string {
  return path.join(REPO_ROOT, clone);
}

/**
 * Is this clone checked out *here*? A filesystem question, never an environment
 * variable: nothing a test run can set may turn "clone missing" into "clone
 * present", or a real resolution failure would become a silent skip.
 */
export function hasReferenceClone(clone: ReferenceClone): boolean {
  return existsSync(referenceClonePath(clone));
}

/** Which clone a filesystem path points into — present or not (`undefined` when it points elsewhere). */
export function referenceCloneOf(target: string): ReferenceClone | undefined {
  const [top] = path.relative(REPO_ROOT, path.resolve(target)).split(path.sep);
  return REFERENCE_CLONES.find((clone) => clone === top);
}

/**
 * Does this module specifier point into a reference clone that is not checked
 * out here? `fromFile` is the importing file (store-relative, as `tsc` reports
 * it); `@/…` is resolved through the store's own root, which is where
 * `tsconfig.json` maps the two clone-backed namespaces into.
 */
export function isMissingReferenceCloneModule(specifier: string, fromFile: string): boolean {
  const target = specifier.startsWith("@/")
    ? path.resolve(STORE_ROOT, specifier.slice(2))
    : path.resolve(path.dirname(path.resolve(STORE_ROOT, fromFile)), specifier);
  const clone = referenceCloneOf(target);
  return clone !== undefined && !hasReferenceClone(clone);
}

/**
 * Task 23 (CI follow-up) — test-side view of the pinned reference clones.
 *
 * Six suites exercise code that lives in the `openship/` and `openfront/`
 * clones (`README.md`: pinned reference clones, deliberately gitignored), so
 * they can only even *load* where those clones are checked out. On a clone-less
 * checkout — CI, or a fresh clone of this repository — they skip with a reason
 * instead of dying on "Cannot find module '../../../../openship/…'". A skip
 * that says why is honest; a red run that only says "module not found" teaches
 * nothing; a suite that silently is not there is worst of all.
 *
 * The reason is emitted as a *skipped test* on purpose: vitest prints it and
 * the JUnit XML CI uploads on failure carries it, so the artifact records the
 * environment instead of just the absence.
 *
 * Why a guard instead of an import that cannot fail: the import has to be
 * conditional (a loader or a `beforeAll`) so the module graph is never built
 * against a clone that is not there. `hasReferenceClone` decides, and it asks
 * the filesystem — never `process.env` — so no variable can turn "clone is
 * missing" into "clone is present" and quietly skip a real failure.
 */
import { describe, it } from "vitest";
import { hasReferenceClone, type ReferenceClone } from "../scripts/reference-clones";

export { hasReferenceClone };

/**
 * The `describe.skipIf` / `it.skipIf` argument: true when the clone is *not*
 * checked out here, i.e. when the suite has nothing to run against.
 */
export function referenceCloneMissing(clone: ReferenceClone): boolean {
  return !hasReferenceClone(clone);
}

/**
 * One skipped placeholder carrying the reason, written only when the clone is
 * absent. Call it once per file, at the top, so the report says why the file
 * contributed no tests instead of just looking thin.
 *
 * Two vitest 3 collector constraints shape this helper and its call sites:
 *
 * 1. No unconditional top-level HOOKS (`beforeAll`/`beforeEach`/`afterEach`)
 *    may remain in a file whose real suites are all `describe.skipIf(true)` —
 *    collection fails with "failed to find the runner/suite". So call sites
 *    keep their lazy `beforeAll`/`beforeEach` INSIDE the skipped describes.
 * 2. A file whose suites are ALL skipped collects to zero suites, which
 *    vitest reports as "No test suite found in file". So this helper registers
 *    one unconditional `describe` holding a single `it.skip(reason)`: the file
 *    collects exactly one skipped test, runs zero, passes, and the JUnit XML
 *    CI uploads on failure carries the environment reason.
 */
export function noteMissingReferenceClone(clone: ReferenceClone): void {
  if (hasReferenceClone(clone)) return;
  // Unconditional suite, skipped test: the file still "has a suite" for the
  // collector even when every real suite is `describe.skipIf(true)`. Hooks
  // must stay out of here — one stray top-level `beforeAll` reintroduces the
  // "failed to find the runner" failure this dance avoids.
  describe(`[reference clone missing] ../${clone}/ is not checked out`, () => {
    it.skip(`pinned-code tests skipped: ../${clone}/ is not checked out here`, () => {});
  });
}

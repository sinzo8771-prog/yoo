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
import { it } from "vitest";
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
 */
export function noteMissingReferenceClone(clone: ReferenceClone): void {
  if (hasReferenceClone(clone)) return;
  it.skip(
    `[reference clone missing] ../${clone}/ is not checked out, so the pinned-code tests in this file are skipped`,
    () => {}
  );
}

# Task 23, Step 4 — sanitized test artifacts only (plan: DROPSHIPPING-AGENT-PLAN.md §Task 23).
#
# Both workflows produce at most two kinds of output, and neither can leak:
#
#  1. Uploaded artifacts: vitest JUnit XML (`tests ... --reporter=junit`),
#     uploaded ONLY on job failure (`if: failure()`), expiring after 3 days
#     (`retention-days: 3`, `if-no-files-found: ignore` so a missing file is
#     not itself an error). JUnit XML contains suite/test names, durations,
#     and assertion text — the tests are hermetic (no database, no sockets,
#     synthetic provider only), so there is no row, token, or credential in
#     the process to serialize. What is deliberately NOT uploaded: `npm` logs,
#     `next build` output, `git` state, environment dumps (`env`, `printenv`,
#     `${{ toJSON(...) }}` of contexts), coverage HTML, or anything under
#     `.next/`.
#  2. Step logs: every `run:` block in ci.yml / deploy.yml is a fixed string.
#     No step echoes an environment variable, a secret, a file containing one
#     (`.env*`), or a GitHub context beyond `github.ref` / `github.event_name`
#     (ref names, not credentials). `permissions: contents: read` is the whole
#     grant, so a compromised step cannot rewrite the repo or read other scopes.
#
# Local runs write the same XML under `store/.artifacts/` (git-ignored, never
# committed) — the workflows reference that path but never check it in.

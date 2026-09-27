# Rollback procedure (Task 23 Step 5 / Task 24)

# Host: self-hosted Docker Compose — `docker-compose.prod.yml` (project
# `yoo-prod`). Every `[HOST: …]` placeholder from the Task 23 stub is now a
# concrete command; `docs/ops/deployment.md` describes the stack these commands
# act on. The full incident flow (detect → triage → act → record) lives in
# `docs/ops/incident-runbook.md`; payment-specific recovery in
# `docs/ops/payments.md`. This file answers only: "the deploy is bad, how do
# we get back to the last good state safely?"

# ## 1. Decide: forward-fix or roll back?
#
# Roll back when ANY of these hold; otherwise fix forward on a new PR through
# the normal CI gate:
#
# - checkout or payment capture is broken (money at risk — see payments.md);
# - the storefront serves 5xx / fails health checks for > 5 minutes;
# - a data migration corrupted production rows (stop writes FIRST, then read on).

# ## 2. Rollback order (concrete commands)
#
# 0. **Know your target first**: the last good ref = the `v*` tag (or master
#    SHA) whose CI run was green (Deploy workflow's `ci-ok` gate) AND whose
#    images were built from it. Record both: `git rev-parse HEAD` on the host
#    and `docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep yoo`.
#
# 1. **Freeze writes at the edge** — stop the two write-capable apps while
#    leaving the database up (read-only triage still possible):
#      docker compose -f docker-compose.prod.yml stop store openfront
#    Goal: no new orders or payments while state is mixed.
#
# 2. **Redeploy the last good ref** — images are tagged `yoo-*:latest` with the
#    previous build kept as `:previous` (see step 2a); source roll-forward is a
#    git checkout of the known-good ref, then rebuild:
#      git -C /path/to/yoo fetch --tags && git checkout <last-good-tag>
#      docker compose -f docker-compose.prod.yml build
#      docker compose -f docker-compose.prod.yml up -d
#    2a. Fast path (no rebuild, code-only rollback): retag images if you kept
#      the previous ones:
#        docker tag yoo-store:previous yoo-store:latest   # …and openfront/openship
#        docker compose -f docker-compose.prod.yml up -d
#      (Record the pre-deploy image IDs — `docker images -q` — before any deploy;
#      `deploy.sh` and the Deploy workflow both do this. Never roll "forward" to
#      an untested ref.)
#
# 3. **Database: do NOT auto-downgrade.** Prisma migrations in this repo move
#    forward only (`npm run migrate` = `prisma migrate deploy`; there is no
#    down-migration runner). If the bad deploy included a migration, the choice
#    is:
#    - *additive-only migration* (new nullable column/table): old code runs
#      fine — leave the schema, redeploy old code, clean up later; or
#    - *destructive migration* (drop/rename/alter): restore from the
#      pre-deploy backup, THEN redeploy:
#        docker compose -f docker-compose.prod.yml stop store openfront openship
#        docker compose -f docker-compose.prod.yml run --rm postgres-backup \
#          pg_restore -U postgres --clean --if-exists -d openfront \
#          /backups/openfront_<PRE-DEPLOY-STAMP>.dump
#        # …same for openship; then start the old code (step 2).
#    When in doubt, assume destructive and restore. Record which path was
#    taken in the incident note. (Backups: `ls backups/` — the sidecar writes
#    one per database at boot and nightly thereafter.)
#
# 4. **Verify before reopening** — health checks pass, then the synthetic
#    end-to-end order (deployment.md §Step 9) succeeds against production
#    with test credentials BEFORE real traffic returns. A rollback that skips
#    verification is a second incident:
#      node scripts/healthcheck.mjs http://localhost:3001/api/graphql \
#        http://localhost:3002/api/graphql
#      node --experimental-strip-types scripts/verify-pdp-e2e.mjs
#      node --experimental-strip-types scripts/verify-checkout-e2e.mjs
#
# 5. **Reopen writes** (`docker compose -f docker-compose.prod.yml up -d`), then
#    watch the Task 17 alert feed (`failed_operations`,
#    `db_connectivity_errors`) for one full reconciliation window before
#    declaring recovery.

# ## 3. Invariants (hold even during an incident)
#
# - Secrets stay in the root `.env` on the host / the `production` GitHub
#   environment secret store; never paste one into a chat log, incident note,
#   or rollback command line (Task 23 Step 3 — `git ls-files` must show no
#   `.env*`).
# - Incident notes record sanitized IDs only (`sourceOrder`, `traceId`) — no
#   payloads, headers, or provider responses (incident-runbook.md redaction
#   rules).
# - A rollback is itself a deploy: it goes through the Deploy workflow's
#   branch/tag gate (or the same host script), not around it.
#
# ## 4. After recovery
#
# - File the postmortem against the incident note (alert type, correlation
#   summary, triage category, action taken).
# - The bad ref stays undeployed until its fix lands as a new PR with green CI.
# - If the database was restored from backup, reconcile every order created
#   between backup time and the freeze (Task 13 Step 5 machine) before closing
#   the incident — those rows exist in provider systems but not in the restore.


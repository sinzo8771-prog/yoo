# Dropshipping Store — Local Environment

Workspace for the plan in `DROPSHIPPING-AGENT-PLAN.md` (sequencing summary in
`COMBINED-ROADMAP.md`). Architecture findings: `docs/architecture/current-state.md`.

## Layout

| Path | Role | Default port |
|---|---|---|
| `openfront/` | Commerce backend (Keystone 6 + Next.js) — products, carts, checkout, orders, payments | 3000 |
| `openship/` | Fulfillment router (Keystone 6 + Next.js) — shop/channel/link/match, tracking | 3001 |
| `openfront-storefront/` | Reference Next.js client for Openfront — base for the custom storefront | 3002 |
| `docker-compose.yml` | PostgreSQL 16 with `openfront` + `openship` databases | 5432 |
| `env-templates/` | Tracked copies of each repo's `.env.example` (the app dirs are gitignored clones — restore from here after re-cloning) | — |
| `docs/architecture/` | Reconnaissance + target architecture | — |
| `scripts/healthcheck.mjs` | Dependency-free GraphQL health check | — |

The three app directories are **pinned reference clones** (gitignored here):
`openfront @ 2b7181a`, `openship @ 04b231d`, `openfront-storefront @ 9b1a431`.
Re-pin deliberately; do not pull upstream blindly mid-task.

## Quick start

Prereqs: Node ≥ 20 (local: v24.21.0), npm 11, Docker Desktop.

```bash
# 1. Database
docker compose up -d postgres   # creates openfront + openship DBs on first boot

# 2. Dependencies (three repos)
npm run setup                   # or per-repo: npm run setup:openfront | :openship | :storefront

# 3. Environments
cp openfront/.env.example openfront/.env
cp openship/.env.example openship/.env
cp openfront-storefront/.env.example openfront-storefront/.env
#   → generate unique SESSION_SECRET / OAUTH_STATE_SECRET per app (≥32 chars):
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 4. Run (three terminals)
npm run dev:openfront      # terminal 1 → http://localhost:3000
npm run dev:openship       # terminal 2 → http://localhost:3001
npm run dev:storefront     # terminal 3 → http://localhost:3002

# 5. Verify
npm run health             # ✓ openfront / ✓ openship (storefront has no API)
```

First boot of each Keystone app: create the admin user at the dashboard
(`/dashboard/init` on openfront, `/init` on openship).

## Environment variables

Per-repo templates (code-verified, see comments inside for fallback warnings):

- `openfront/.env.example` — requires `DATABASE_URL`, `SESSION_SECRET` (≥32 chars,
  enforced at boot). Optional Stripe/PayPal, SMTP, S3, OpenRouter.
- `openship/.env.example` — `DATABASE_URL` (⚠️ falls back to local SQLite if unset),
  `SESSION_SECRET` (⚠️ insecure fallback), `NEXT_PUBLIC_URL`, `OAUTH_STATE_SECRET`,
  Shopify keys, SMTP.
- `openfront-storefront/.env.example` — requires only `NEXT_PUBLIC_BACKEND_URL`
  plus **public** payment keys. Never put server-only secrets in the storefront.

Hard rules (from the plan):
- Never commit `.env` files; `.gitignore` excludes them.
- Never place private credentials in `NEXT_PUBLIC_*` vars.
- Shipping provider (Shippo/ShipEngine) credentials are configured per-provider in the
  DB via the dashboards, not env vars, in the current revisions.

## Custom storefront app (`store/`)

`store/` is the project's own storefront (Task 3+), scaffolded from the pinned
`openfront-storefront` reference. It talks to Openfront over GraphQL at
`NEXT_PUBLIC_BACKEND_URL`.

```bash
cd store
npm run dev            # PORT=3003
npm test               # vitest unit tests
npm run check:catalog  # live contract check against a running Openfront
npm run seed:dev       # seed the local dev catalog fixture
npm run seed:dev -- --purge   # remove ONLY the fixture rows
```

Dev catalog fixture (Task 4, Step 4) — writes 3 products / 6 variants / 2
collections, all with deterministic `devfix_*` ids:

- **Idempotent**: rows are upserted, so re-running converges.
- **Non-destructive**: only `devfix_*` ids are ever written or deleted, so a real
  catalog can coexist. `--purge` removes only those rows.
- Requires `OPENFRONT_DATABASE_URL` (seeder only; the storefront never reads it)
  and `npm run db:generate:openfront` (run automatically by `prebuild`).
- The fixture deliberately covers the availability matrix: in-stock, zero-stock
  without backorder (unavailable), and zero-stock with backorder (available).

## Health checks

`scripts/healthcheck.mjs` POSTs `{ __typename }` to each GraphQL endpoint (5s timeout,
no credentials). Exit code 1 on any failure — usable as a CI smoke test:

```bash
npm run health
# or with custom targets:
node scripts/healthcheck.mjs https://staging.example.com/api/graphql
```

## Known environment risks (from reconnaissance + Task 2 verification)

1. **Dual Next.js pins**: apps run Next 16 while `@keystone-6/core` is overridden to
   `next 14.2.35` — do not remove the `overrides` block; verify builds early.
   ✅ Verified: both Keystone apps and the storefront build clean with the overrides intact.
2. **OpenShip secret fallbacks**: missing `SESSION_SECRET`/`OAUTH_STATE_SECRET` fall back
   to insecure dev constants — always set them, even locally.
3. **Ports collide** (all default to 3000): this setup fixes 3000/3001/3002 via `PORT`.
4. **S3 vars are REQUIRED for production builds** (Openfront): `features/keystone/index.ts`
   `productionEnv()` throws at module-eval time when `NODE_ENV=production` and any of
   `S3_BUCKET_NAME` / `S3_REGION` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` /
   `S3_ENDPOINT` is unset — even if you don't use S3. CI builds must set placeholders
   (see `openfront/.env.example`).
5. **Vestigial storefront route (fixed locally)**: `openfront-storefront/pages/api/graphql.ts`
   imported a nonexistent `features/keystone/context` and broke `next build`. The decoupled
   storefront never serves GraphQL locally (all traffic goes to `NEXT_PUBLIC_BACKEND_URL`),
   so the file was removed in this workspace. Consider an upstream PR.
6. **Docker Desktop 4.91.0 IS installed** (per-user: `C:\Users\lenovo\AppData\Local\Programs\DockerDesktop`
   — **not on PATH** by default; add `...\DockerDesktop\resources\bin` or use `npm run db:up`
   after adding it to your profile PATH). Engine verified working (client/server 29.8.0, WSL2/Ubuntu).
   - The containerized Postgres runs on host port **5433** (see `docker-compose.override.yml`)
     because the workstation's local PostgreSQL 17 service already owns 5432.
   - ⚠️ Keep shell scripts in `docker/postgres-init/` **LF-only** — CRLF breaks the
     container's bash (this bit us once; the script has been converted).

## Task 2 verification results (2026-09-14)

| Check | Result |
|---|---|
| `npm ci` storefront / openship / openfront | ✅ all three install clean |
| `npm run build` (storefront, after vestigial-route fix) | ✅ all routes compiled |
| `npm run build` (openship: keystone build + migrate + next build) | ✅ 19 tables migrated |
| `npm run build` (openfront, with S3 placeholders) | ✅ 115 tables migrated |
| Local PostgreSQL 17 | ✅ running; `openfront` + `openship` databases created |
| `npm run health` | ✅ passes with all three apps booted (verified during Task 3) |

## Task 4 verification results (2026-09-14)

| Check | Result |
|---|---|
| `npm test` (store unit tests) | ✅ 37 passed / 3 files |
| `npm run seed:dev` (1st, 2nd, 3rd run) | ✅ 3 products / 6 variants / 6 prices / 2 collections each time (idempotent) |
| `npm run check:catalog` against live Openfront :3000 | ✅ 14/14 assertions passed |
| `npm run build` (store, `prebuild` regenerates Prisma client) | ✅ all routes compiled |

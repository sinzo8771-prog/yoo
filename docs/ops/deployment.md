# Production deployment (Task 24)

Status: **configuration complete and locally rehearsed**; the runbook below is
written for the real cutover. Where a step was verified in this environment the
text says exactly how; where it needs the real host (DNS, ACME, live secrets)
it says that instead. No step here can move real money — payment credentials
enter only at Step 10, after the Step 9 synthetic gate passes.

## Host choice and why

**Self-hosted Docker Compose on a VPS** — the plan's tech stack (line 9)
already commits to "Docker for self-hosting", and it sidesteps the plan's
free-tier warning entirely: nothing here depends on a free tier's terms, so
there is no commercial-use clause to re-check. A ~2 vCPU / 4 GB box runs this
stack (three Next.js apps + Postgres 16 + Caddy). Requirements on the host:

- Docker Engine 24+ with the Compose plugin (v2 syntax — `docker compose`).
- Ports 80/443 open (Caddy edge), SSH for management.
- A DNS zone you control (Step 5).

Files involved (all tracked):

| File | Role |
|---|---|
| `docker-compose.prod.yml` | the production stack (`yoo-prod` project) |
| `docker/Dockerfile.openfront` | backend image, mirrors upstream `railway.toml` build/start |
| `docker/Dockerfile.openship` | backend image; migrate deferred to start (no DB at build) |
| `docker/Dockerfile.store` | storefront image, CI-parity `npm run build` |
| `.dockerignore` | keeps `.env*`, `node_modules`, `.next` out of build contexts |
| `docker/Caddyfile` | HTTPS edge, two sites, env-driven domains |
| `docker/postgres-backup.sh` | boot + nightly `pg_dump` sidecar (LF-only) |
| `.env.example` | canonical template for the root `.env` (secrets, domains) |
| `.github/workflows/deploy.yml` | gated deploy entry point (preflight → host script) |

The dev stack (`docker-compose.yml` + override, project `yoo`) is untouched and
can run **at the same time** — different project name, containers, networks,
volumes, and ports. Only one stack may ever claim a given `.env`.

## Topology

```text
                    Internet
                       │ :80/:443
                 ┌─────▼─────┐   edge network
                 │   Caddy   │   (ACME, HTTP→HTTPS)
                 └─┬───────┬─┘
        STORE_DOMAIN│      │API_DOMAIN
              ┌─────▼─┐  ┌▼────────┐
   127.0.0.1  │ store │  │openfront│◄── host health checks / e2e gate
   :3000      └───┬───┘  └────┬────┘
                  │ edge+data  │
              ┌───▼────────────▼───┐   data network
              │      openship      │   (dashboard = 127.0.0.1:3002, SSH only)
              └─────────┬──────────┘
                        │
              ┌─────────▼─────────┐      ./backups ← postgres-backup sidecar
              │ postgres 16       │      (boot + nightly pg_dump, 7-day prune)
              │ 127.0.0.1:5434    │
              └───────────────────┘
```

- `edge` network: Caddy ⇄ apps only.
- `data` network: apps ⇄ postgres; **postgres has no edge membership**.
- Everything the internet can reach is behind Caddy; the three `127.0.0.1:300x`
  publishes and `127.0.0.1:5434` exist for host-side verification only.

## Step 0 — obtain the source on the host

```bash
git clone <this-repo> yoo && cd yoo
git checkout <release-tag>            # a v* tag whose CI run was green
```

Then the two **gitignored upstream clones** (README "Layout" documents the
pins; `docs/architecture/current-state.md` has the full table):

```bash
git clone https://github.com/openshiporg/openfront   openfront
git clone https://github.com/openshiporg/openship    openship
git -C openfront checkout 2b7181aa50ff6f27dadacc2ded2b145a2de68c1f
git -C openship  checkout 04b231d936a6954d07f11f839246d5815a4d12f2
```

⚠️ **Two files in `openship/` are NOT upstream** and must be copied from this
project's working tree (they are untracked inside the gitignored clone):
`openship/features/integrations/channel/cj.ts` and `synthetic.ts` (Tasks 11–12).
Keep them in sync with the mirrored sources `store/integrations/cj-channel/` and
`store/integrations/synthetic-channel/` — the contract tests in
`store/tests/unit/cj-channel/` cover the store copy. Build them inside the
openship image by `COPY openship/ ./` as written, so place the files before
`docker compose build`.

## Step 1 — PostgreSQL (backups + pooling)

```bash
cp .env.example .env    # then edit: all required keys, see §env below
docker compose -f docker-compose.prod.yml up -d postgres postgres-backup
docker compose -f docker-compose.prod.yml ps postgres postgres-backup

## Steps 2–4 — build and start the three applications

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps   # all four apps healthy
```

What each image does (and why it matches the repository's own mechanisms):

- **openfront / openship** run upstream's `keystone build --no-ui && next build`
  (byte-identical to their `railway.toml` `buildCommand`), and their containers
  start with `npm run migrate && npm start` — upstream's `startCommand`. The
  openship Dockerfile deliberately does *not* use `npm run build` because that
  script would run migrations during image build, where no database exists.
- **store** runs the repository's `npm run build` (= `prebuild` prisma generate
  + `next build`), exactly like the CI production-build job.
- `NODE_ENV=production` at runtime makes openfront's `productionEnv()` require
  all five `S3_*` keys — `.env.example` supplies placeholders; boot succeeds
  without real media storage, and real values are needed only before uploading
  product images.

## Step 5 — domains and HTTPS

```bash
# DNS: A records for STORE_DOMAIN and API_DOMAIN → host IP (TTL low for cutover).
docker compose -f docker-compose.prod.yml --profile edge up -d caddy
docker compose -f docker-compose.prod.yml logs -f caddy   # watch ACME success
```

`docker/Caddyfile` declares exactly two public sites: `STORE_DOMAIN → store` and
`API_DOMAIN → openfront`. Caddy obtains and renews Let's Encrypt certificates
automatically on first request; HTTP is redirected to HTTPS. **OpenShip is not
proxied** — reach its dashboard via SSH tunnel:

```bash
ssh -L 3002:127.0.0.1:3002 user@host    # then http://localhost:3002
```

## Step 6 — environment variables

All secrets live in the **root `.env`** (gitignored; template `.env.example`
documents every key). Rules that matter:

1. **`SESSION_SECRET` parity**: the store and openfront must use the *same*
   value or every guest cart write fails `Cart not found` (cart-proof
   invariant, plan Task 4/9). One `.env` entry feeds both services in compose;
   for host-run e2e scripts keep `store/.env`'s value identical to root `.env`.
2. **`OPENSHIP_SESSION_SECRET` and `OAUTH_STATE_SECRET` are separate** values —
   distinct trust domains; never reuse `SESSION_SECRET` for them.
3. **`NEXT_PUBLIC_*` are baked at build time.** Changing `NEXT_PUBLIC_BACKEND_URL`
   or `NEXT_PUBLIC_SITE_URL` requires `docker compose build` of the affected
   images afterwards — editing `.env` alone changes nothing in the bundle.
4. **Never** put private payment/supplier keys in `NEXT_PUBLIC_*` or in the
   store's environment at all (storefront rule, README "Hard rules").
5. `git ls-files | grep '\.env'` must show only templates — CI's security job
   enforces this on every commit.

ls -la backups/         # a .dump per database exists already (boot backup)
```

- **Backups**: the `postgres-backup` sidecar runs `pg_dump -Fc` for `openfront`
  and `openship` at container start, then every 24h, pruning older than
  `BACKUP_KEEP_DAYS` (default 7). A green sidecar *means* a backup exists.
  Archives land in `./backups` on the host — **copy them off-box** (cron +
  `rclone`/`scp` to other storage); a backup on the same disk as the database
  is not a disaster plan.
- **Pooling**: no separate pooler — Prisma's built-in pool is bounded per app
  via `?connection_limit=10` in each `DATABASE_URL` (compose file). Budget:
  `openfront(10) + openship(10) + maintenance + slack < 100`, comfortably under
  Postgres's default `max_connections=100`. Raise the limits only after raising
  `max_connections`, and keep the sum plus ~10% headroom. PgBouncer would be the
  next step only if you run multiple replicas of an app.
- **Restore** (details in `rollback.md`): `pg_restore` from `backups/*.dump`.

## Step 7 — database migrations

Mechanism: **`npm run migrate` = `prisma migrate deploy`** (repository-supported;
schemas at `openfront/schema.prisma` + `openship/schema.prisma`, forward-only
migration folders beside them). Two ways to run it:

```bash
# (a) automatic — every container start runs migrate before `next start`
docker compose -f docker-compose.prod.yml restart openfront openship
# (b) explicit one-shot, e.g. right after deploying a release that adds migrations
docker compose -f docker-compose.prod.yml run --rm openfront npm run migrate
docker compose -f docker-compose.prod.yml run --rm openship npm run migrate
```

If a migration fails, the container exits instead of serving — that is the
intended fail-closed behaviour. Migrations are **forward-only**; schema rollback
is governed by `rollback.md` §3.

## Step 8 — health checks

```bash
node scripts/healthcheck.mjs \
  http://localhost:3001/api/graphql \
  http://localhost:3002/api/graphql
curl -fsS http://localhost:3000/ >/dev/null && echo "store ok"
docker compose -f docker-compose.prod.yml ps   # per-service healthchecks green
```

`healthcheck.mjs` posts `{__typename}` with no credentials (never sends
secrets). The compose healthchecks run the same probe from inside each image,
so `docker compose ps` alone shows readiness on the host too.

## Step 9 — synthetic end-to-end gate (before any real credential)

Run against the running stack, **before** adding CJ/Stripe/PayPal credentials:

```bash
# seed the devfix fixture catalog (dev-only; namespaced, plan Task 4)
docker compose -f docker-compose.prod.yml run --rm \
  -e OPENFRONT_DATABASE_URL="postgresql://postgres:$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2- | tr -d '\"')@postgres:5432/openfront" \

## Step 10 — production credentials + low-risk test order

Only after Step 9 is green:

1. **CJ / supplier**: add `CJ_API_KEY`, `CJ_ACCESS_TOKEN`,
   `CJ_ACCESS_TOKEN_EXPIRES_AT` to root `.env` → extend the openship service env
   in `docker-compose.prod.yml` (deliberately absent today — see its comment),
   then `docker compose up -d openship`. Sandbox first if the provider offers
   one (`docs/ops/cj-runbook.md`).
2. **Payments**: public keys (`NEXT_PUBLIC_STRIPE_KEY`,
   `NEXT_PUBLIC_PAYPAL_CLIENT_ID`) go in `.env` **followed by a rebuild** of
   store (baked at build); private keys belong to openfront's environment,
   never the storefront.
3. **Test order**: one low-risk order end-to-end — store checkout → openfront
   payment session → order page → openship routing → provider acceptance, then
   reconcile against the provider's authoritative response (`payments.md`,
   plan hard rule: never claim fulfillment from an internal success).
4. Record the run in the ops log; watch `failed_operations` and
   `db_connectivity_errors` alerts for one full reconciliation window.

## Verification performed for this task (local rehearsal)

- `docker compose -f docker-compose.prod.yml config --quiet` → exit 0.
- Images built: `yoo-store`, `yoo-openfront`, `yoo-openship` (results recorded
  in the Task 24 notes in `DROPSHIPPING-AGENT-PLAN.md`).
- Stack booted on the local Docker host; migrations applied via
  `npm run migrate` at container start; `healthcheck.mjs` green on 3001/3002.
- Backup sidecar produced `backups/openfront-*.dump` + `openship-*.dump`.
- Synthetic gate: `verify-pdp-e2e.mjs` + `verify-checkout-e2e.mjs` results are
  recorded alongside the Task 24 checkboxes.
- **Not verifiable here** (needs the real host): DNS cut-over, ACME issuance,
  the off-box backup copy, and Step 10 credentials — each is a runbook step
  with exact commands above.

  store npm run seed:dev

node --experimental-strip-types scripts/verify-pdp-e2e.mjs
node --experimental-strip-types scripts/verify-checkout-e2e.mjs
```

Both scripts read `SESSION_SECRET` from `store/.env` (Step 6 parity!) and use
`BACKEND_URL`/`STOREFRONT_URL` defaults of `localhost:3001`/`3000` — the
loopback publishes exist precisely for this gate. They verify: PDP renders from
live data, cart creation + signed proof accepted, unsigned writes rejected, and
the checkout rejection paths — the plan's "synthetic end-to-end tests pass"
precondition (line 21) for ever touching real credentials.


# Incident runbook

> Created for Task 17 (admin/operator observability) of
> `DROPSHIPPING-AGENT-PLAN.md`. This is the store-repo side of operations:
> what to look at, what to grep, which actions are safe, and when to page.
> Payment-specific procedures live in `docs/ops/payments.md`; supplier/provider
> setup in `docs/ops/adding-a-supplier-provider.md` and the CJ runbook.

## The eight required operational views — where each actually lives

| View | Where it lives | Correlate by |
| --- | --- | --- |
| Orders | Openfront admin → Orders; customer side `store/lib/data/orders.ts` projections | `sourceOrder` (Openfront order id — the permanent key, Task 13 Step 2) |
| Matches | OpenShip operator routes (match records) | `sourceOrder` → match keyed by source order + channel |
| Purchases | OpenShip purchases; store decision vocabulary in `store/lib/fulfillment/purchaseCreation.ts` (`submit`/`reuse`/`reconcile`/`blocked`) | `purchase` id; attempt key `source-purchase:<sha256>` |
| Tracking | Store customer projection `store/lib/fulfillment/customerTracking.ts`; carrier sites limited to `CARRIER_TRACKING_HOSTS` | `sourceOrder`, tracking number |
| Provider health | Alert feed below (`lib/observability/alerts.ts` types) + adapter error classifications in store logs (`failureClass`) | operation token, `failureClass` |
| Failed operations | Structured store logs (`level=error`) + `triageOrder` categories | `cart`/`sourceOrder` on the log line |
| Reconciliation queue | OpenShip/Openfront state `RECONCILIATION_REQUIRED` (Task 13 Step 5 machine); store triage bucket `reconciliation_hold` | `sourceOrder` |
| Webhook events | Openfront payment ingress dedupe (`IdempotencyKey`, `provider-webhook:*`); order ingestion route logs (`WEBHOOK ENDPOINT ERROR` in the OpenShip handler) | `sourceOrder`, provider event id |

Honesty note: the store does not host operator UI — it contributes the
correlation keys, the sanitized log lines, the triage projection, and the
alert vocabulary that make the above views joinable.

## Correlation IDs (Step 1)

Chain, with the closed key set from `store/lib/observability/correlation.ts`:

```
cartId ─► sourceOrderId (Openfront order id, PERMANENT) ─► openshipOrderId ─► purchaseId
traceId (per-operation UUID, minted with newTraceId())
```

Grep recipes:

- one order across systems: `sourceOrder=of_…` (log lines) / `source-purchase:` + sha (attempt keys)
- one attempt everywhere: `"traceId":"<uuid>"`
- summary form for humans: `correlationSummary({…})` →
  `sourceOrder=of_1 openshipOrder=osh_2 purchase=pur_3`

Only these five keys can ever appear: the builder is field-by-field, so a
`secretKey`, proof header, or payload passed by mistake is dropped, never
logged. Unknown input keys cannot reach a line — that is the enforceable
half of "never log secrets".

## Structured log lines (Step 2)

Format: single-line JSON —

```json
{"ts":"…","level":"info|warn|error","operation":"checkout.complete","durationMs":1234,"status":"…","sourceOrderId":"…","cartId":"…","failureClass":"…"}
```

Guarantees (pinned by `tests/unit/observability/logger.test.ts`):

- sensitive keys (`secret|token|password|authorization|cookie|signature|proof|card|…|session|payload|body`)
  are dropped at **any depth** — value never partially emitted;
- `operation`/`status` must match `^[A-Za-z0-9_.:-]{1,64}$` (else `invalid`) —
  payloads cannot ride the grep-able fields;
- strings cap at 300 chars; arrays at 20 items; structures at depth 4;
  cycles → `[circular]`;
- Errors log as `{name, message}` only — **never stacks** (stacks can embed
  payloads/paths);
- checkout failures log a closed `failureClass`
  (`session_missing|cart_unreadable|cart_unavailable|cart_empty|currency_unconfirmed|manual_tender|payment_failed|payment_unconfirmed|cross_account|transport|backend_error|order_id_missing|redirect_unbuilt|unknown`)
  instead of the raw backend string, which may contain provider/session
  internals.

Existing seams: `checkout.complete` (success + failure, `cart.ts`),
`cart.shippingOptions` (`withLogging` wrapper, `shipping.ts`). New async
server operations should use `withLogging({operation, correlation}, fn)` so
every operation emits exactly one duration line and rethrows unchanged.

## Alert thresholds (Step 4)

Defaults from `store/lib/observability/alerts.ts` (override per call, e.g.
tighter windows during a launch):

| Alert type | Default threshold | Severity | First response |
| --- | --- | --- | --- |
| `webhook_signature_failures` | **1** (any) | critical | Treat as attempted auth bypass: confirm which provider/endpoint, verify secrets match the provider dashboard, check for a misconfigured or hostile source. Details: `docs/ops/payments.md` § webhook authentication. |
| `db_connectivity_errors` | 2 | critical | Platform incident: check Openfront/OpenPostgres reachability before anything else — every other view is downstream of the database. |
| `provider_errors` | 5 | warning | Correlate `failureClass` values in store logs; if they cluster on one adapter, check provider status/credentials (payments.md § switch-on). |
| `unmatched_products` | 1 | warning | Fix variant mapping before purchase (`MATCH_FAILED` triage); never purchase partially matched lines. |
| `stale_orders` | 1 | warning | Run the triage sweep below on the sample correlation; act only from `safeActions`. |
| `repeated_retry_failures` | 3 | warning | Stop retrying: inspect the provider record first (matches `RETRY_LIMIT` in triage). |

`hasCriticalAlert(alerts)` is the page/notify gate: critical ⇒ page now;
warning ⇒ batch into the next operator pass. Signal producers feed counts
(windowed) into `evaluateAlerts`; junk input throws rather than silently
producing no alert.

## Retry/reconciliation triage (Step 3)

`triageOrder({ state, ageMs?, retryAttempts? })` answers *why stuck* and
*what is safe* for one order (`store/lib/observability/triage.ts`):

| Category | Meaning | Operator stance |
| --- | --- | --- |
| `healthy` | Terminal (DELIVERED/CANCELLED) or needs no attention | Do nothing |
| `waiting` | Inside the expected window; next transition comes from supplier/callback | Wait — do not touch |
| `stuck_stale` | Waiting state past its threshold: 24h processing states, **48h** ACCEPTED/FULFILLING (same line as delayed tracking), 10d SHIPPED, 24h CANCEL_REQUESTED | Investigate why no progress; act only from `safeActions` |
| `stuck_failure` | MATCH_FAILED / PROVIDER_REJECTED / RETRYABLE_ERROR — never advance alone | Re-read state, fix the cause, then one deliberate retry per `operatorAction` |
| `reconciliation_hold` | Supplier outcome unknown | **Human comparison required.** Never `Submit a fresh purchase`, never tell the customer it failed — the hold only clears on a human verdict (Task 13 Step 5) |

Invariants (pinned by `tests/unit/observability/triage.test.ts`):

- `operatorAction` is copied from the state machine — this view cannot
  contradict it;
- every `unsafeActions` entry encodes a pinned constraint: no resubmit while
  a claim is in flight, no second purchase for an accepted line, cancellation
  is local-status-only until confirmed, no partially matched purchases;
- `retryAttempts >= 3` adds "blind retry is not safe" + escalation;
- unknown state ⇒ throw (no invented categories).

## First-response flow

1. **Alert fires** (or a report comes in) → note `type`, severity, and
   `sampleCorrelation`.
2. **Grep the chain**: `sourceOrder=…` across store logs, then Openfront /
   OpenShip views per the table above; attach `traceId` for one attempt.
3. **Triage the order** — read `why`, obey `safeActions`, never the
   `unsafeActions` column.
4. **Classify**: payment/money questions → `docs/ops/payments.md` (refund ≠
   supplier cancellation); fulfillment questions → the state machine's
   `operatorAction`.
5. **Record**: incident note = alert type, correlation summary, triage
   category, action taken. Sanitized IDs only — no payloads, headers, or
   full provider responses in incident notes (`supplier-runbook-template.md`
   redaction rules apply).

## Verification

```
cd store
npx vitest run                    # full suite
npx vitest run tests/unit/observability   # Steps 1–4 units
npx tsc --noEmit -p tsconfig.json # pre-existing store-app debt only
```

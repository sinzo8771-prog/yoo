# Supplier adapter template — Task 12 prep (no provider selected)

## Status

Template only. No supplier is selected and all seven Task 12 steps remain open.
Complete this assessment with provider-specific evidence before implementation;
this is not a drop-in integration or a readiness claim. Do not attach real
credentials until synthetic end-to-end tests pass.

Companion runbook: `c:\Users\lenovo\Desktop\yoo\docs\ops\supplier-runbook-template.md`.
Record provider, owner, target country, currency, API version, sandbox availability,
official API documentation URLs, review date, and escalation contact. Never record
secret values. Mark capabilities Supported, Unsupported, Conditional, or Unknown;
unknown capabilities block dependent operations.

## 1. Capabilities matrix (Task 12 Step 1)

Copy this table per supplier. Record official API evidence and sandbox results
separately. The rows group capabilities; section 2 lists the ten required slots.
Unsupported exports must fail explicitly in the shape their caller expects.

| Capability | Slot / operation | Status | Evidence required |
| --- | --- | --- | --- |
| Product search | `searchProductsFunction` | Unknown | Pagination, SKU identity |
| Product lookup | `getProductFunction` | Unknown | Exact variant IDs |
| Purchase creation | `createPurchaseFunction` | Unknown | Currency, authoritative ID |
| Supplier cancellation | Outbound operation; not a pinned slot | Unknown | Cutoff, confirmation |
| Cancellation notification | `cancelPurchaseWebhookHandler` | Unknown | Inbound event contract |
| Tracking notification | `createTrackingWebhookHandler` | Unknown | Partial shipments, carrier IDs |
| Webhook lifecycle | `createWebhookFunction` / `getWebhooksFunction` / `deleteWebhookFunction` | Unknown | Registration, signature, replay rules |
| OAuth | `oAuthFunction` / `oAuthCallbackFunction` | Unknown | Scopes, rotation, revocation |
| Inventory | Outside pinned slots | Unknown | Freshness, reservation semantics |
| Health / tracking polling | Reconciliation operation | Unknown | Authoritative status, lag |
| Native purchase idempotency | Provider API | Unknown | Key scope, retention, concurrency |
| External-reference lookup | Provider API | Unknown | Ambiguous-create recovery |
| Retry policy | Provider API | Unknown | Safe operations, rate limits |

## 2. Adapter placement and verified contract gaps

Inspected OpenShip HEAD: `04b231d936a6954d07f11f839246d5815a4d12f2`.
Schema/generated files have local modifications; verify the deployed revision.
Source base: `c:\Users\lenovo\Desktop\yoo\openship\features\keystone`.

- `models\ChannelPlatform.ts` requires these ten text slots:
  `searchProductsFunction`, `getProductFunction`, `createPurchaseFunction`,
  `createWebhookFunction`, `deleteWebhookFunction`, `getWebhooksFunction`,
  `oAuthFunction`, `oAuthCallbackFunction`, `createTrackingWebhookHandler`,
  `cancelPurchaseWebhookHandler`.
- `utils\channelProviderAdapter.ts` imports the module named by the slot value
  and calls its same-named export with `{ platform, ...args }`. Local module path:
  `c:\Users\lenovo\Desktop\yoo\openship\features\integrations\channel\<supplier>.ts`.
  HTTP dispatch also exists; this template does not recommend it.
- `extendGraphqlSchema\mutations\createChannelPurchase.ts` does not forward
  orderId, idempotencyKey, or fetched channel credentials. It queries platform
  with only id and createPurchaseFunction. Identity and credential delivery
  require implementation before a production adapter can rely on them.
- The inspected CreatePurchaseInput lacks channelId and notes although that
  resolver reads them. Verify the exposed GraphQL operation and reconcile this
  mismatch; schema validation alone is not proof of a working purchase path.
- `extendGraphqlSchema\mutations\cancelPurchase.ts` only updates local status.
  cancelPurchaseWebhookHandler is inbound, not supplier-side cancellation.
- ChannelPlatform.webhookSecret denies GraphQL read/create/update. Verify its
  server-side provisioning path; do not set it with an ordinary row mutation.

Copying or smoke-importing a module is not activation. Require authenticated
registration, channel association, actual dispatch and persisted outcome evidence.
Keep routing disabled until acceptance gates pass.

## 3. Authentication (Task 12 Step 2)

Define server-only secret names, least-privilege scopes, account isolation and
injection into the actual OpenShip runtime. Storefront environment settings alone
do not configure OpenShip. Keep names/storage references in the runbook, never
values. Verify credential delivery at the resolver boundary. Document rotation,
revocation and overlap semantics. Sanitize failures and logs; never log tokens,
addresses or full provider responses.

## 4. Response validation (Task 12 Step 3)

Validate requests before sending and responses before applying local state.
Reject missing IDs, wrong currency, unknown variants, invalid quantities and
transitions outside a provider-evidenced state machine. Delayed events may
legitimately skip intermediate states. An invalid purchase response can follow a
successful supplier purchase: persist an ambiguous outcome and reconcile; never
assume no side effects or blindly retry.

## 5. Idempotency (Task 12 Step 4)

Persist intent keyed by tenant, source order, destination and stable purchase
scope, with canonical request fingerprint and unique constraint. Atomically
claim work: concurrent repeats reuse intent; changed payloads conflict. Persist
supplier IDs. Test restarts and crashes after provider success. Native keys must
remain stable within documented retention windows. Without reliable idempotency,
ambiguous creates require reference lookup or operator resolution, not blind retry.

## 6. Timeout/retry policy (Task 12 Step 5)

Bound timeouts and retry budgets. Retry reads only when semantics and error
classification permit. Cancellation needs documented idempotency or authoritative
reconciliation too; a pre-call shipping check alone is insufficient. Purchase
retries require verified provider guarantees and the same durable key/payload.
Honor rate limits. Do not blindly retry authentication or validation failures.

## 7. Webhooks (Task 12 Step 6)

Verify provider-prescribed signatures and freshness before trusting events;
preserve raw bytes when required. Do not assume every provider uses HMAC.
Persist validated receipts with restricted access and PII retention limits.
Enforce scoped event-ID uniqueness and atomic processing claims. Distinguish
received, processing, failed and completed states. Acknowledge completed duplicates
without repeated effects; allow controlled recovery of failed processing.
Reject invalid signatures and stale replays. Verify secret provisioning separately.

## 8. Reconciliation (Task 12 Step 7)

Define an authorized operator job, schedule/lag thresholds, pagination, rate
budget and audit trail. Compare authoritative purchases/tracking with local
intents; report unknown IDs, partial shipments and divergence. Quarantine
ambiguous outcomes for approved repair. Missing callbacks are not grounds to
resubmit purchases. Record the implemented operation and evidence in the runbook.

## 9. Test and runbook deliverables

- `tests/unit/<supplier>/` — contract tests pinned to `schema.graphql`
  (mirror `store/tests/unit/openship/synthetic-channel.test.ts`).
- `tests/integration/<supplier>/` — gated on real sandbox credentials; must not
  run in CI by default.
- `docs/ops/<supplier>-runbook.md` — env vars, rotation, activation steps,
  reconciliation drill, incident: "purchase created but callback never came".

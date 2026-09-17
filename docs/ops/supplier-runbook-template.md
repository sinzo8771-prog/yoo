# Supplier operations runbook — template

## Status

Docs-only skeleton, not an executable procedure. No provider selected. Every
Unspecified entry and unchecked gate blocks activation. Do not invent endpoints,
commands, retry guarantees or credentials. Capabilities assessment:
`c:\Users\lenovo\Desktop\yoo\docs\ops\supplier-adapter-template.md`.

## Ownership and scope

| Decision | Value |
| --- | --- |
| Supplier / API version / official documentation | Unspecified |
| Technical owner / on-call / supplier escalation | Unspecified |
| Market / currency / warehouse / allowed variants | Unspecified |
| OpenShip revision and adapter artifact checksum | Unspecified |
| Sandbox account / destination channel / operator | Unspecified |
| Spend, quantity, timeout and retry limits | Unspecified |
| Callback lag threshold / reconciliation schedule | Unspecified |

## Configuration and secret lifecycle

Record secret names and storage references only, never values. Inject into
OpenShip's server runtime, not browser code or just the storefront environment.
For each setting record purpose, scope, environment, owner and rotation procedure.
Decide sandbox/production endpoints, account identity, authentication mechanism,
callback verification material, allowed currency and request limits. Configuration
names remain Unspecified until implemented.

Rotation drill: verify provider overlap semantics; install replacement through
approved secret management; verify a read-only sandbox operation; revoke old key;
confirm revocation without printing either key. On exposure, pause new purchases,
revoke promptly and reconcile in-flight outcomes. Never restore compromised keys.
Record tested steps and evidence here.

## Deployment and activation gates

- [ ] Capabilities and unsupported operations approved with evidence.
- [ ] Synthetic end-to-end routing passes before real credentials are connected.
- [ ] Schema/resolver identity and credential propagation gaps resolved.
- [ ] Durable intent uniqueness, concurrent duplicates and crash recovery tested.
- [ ] Validation, bounded retries and ambiguous outcomes tested.
- [ ] Signed callbacks, duplicates and failed-event recovery tested.
- [ ] Supplier cancellation distinguished from local status updates.
- [ ] Deployed artifact and all ten adapter slots verified.
- [ ] Authenticated platform/channel association verified; routing still disabled.
- [ ] Approved sandbox purchase traced through real dispatch to persisted ID.
- [ ] Tracking, cancellation and reconciliation drills completed where supported.
- [ ] Owner approves limited rollout, monitoring and rollback.

Record revision, command/job, sanitized evidence location, date and reviewer for
each gate. Unit tests and direct imports do not satisfy live gates. Document the
exact implemented command or UI action to pause/resume routing before activation;
none is provided or executed by this template.

## Normal operations and reconciliation

Document implemented operator actions for purchase lookup, tracking, bounded
reconciliation and failed-event recovery. Each needs authorization, inputs,
read/write effects, pagination, rate budget and expected output. Commands remain
Unspecified until implemented and tested.

Monitor ambiguous intents, oldest unprocessed callback, retry exhaustion, auth
failures and state divergence. Define alerts before launch. Correlate tenant,
source order, destination, intent and supplier purchase ID, not customer name.
Report partial shipments and mismatches; audit approved repairs.

## Incident drills

| Incident | Immediate action | Resolution evidence |
| --- | --- | --- |
| Purchase timeout / malformed response | Hold intent; never blind retry | Stable-reference lookup or supplier confirms outcome |
| Missing callback | Poll authoritative state within limits | Verified state persisted; delivery failure investigated |
| Duplicate callback | Reuse durable event record | No repeated effects; controlled recovery for failed processing |
| Signature failure / stale replay | Reject without business effects; alert | Verification configuration checked without logging secrets |
| Cancellation requested | Follow supported supplier procedure | Supplier confirmation; local CANCELLED is insufficient |
| Wrong variant / currency | Quarantine request or ambiguous response | Approved mapping/configuration and reconciled outcome |
| Outage / rate limit | Pause writes as needed; bound retries | Health restored and outstanding intents reconciled |

## Rollback and data handling

Pause new routing using the verified control before rollback. Preserve intents,
supplier IDs, callback receipts and audit records. Continue safe tracking and
reconciliation for submitted orders. Code rollback does not cancel purchases;
never delete state or re-create orders to resolve uncertainty. Resume only with
owner approval and bounded sandbox verification.

Restrict payloads and shipping PII; define encryption, access, redaction and
retention. Never put addresses, tokens, signatures or full provider responses in
public logs or incident reports. Record sanitized correlation IDs.

## Test evidence and handoff

Record unit/contract, concurrency/restart, sandbox and live-routing results
separately. Sandbox tests must be explicit opt-in and bounded, with no production
credentials by default. Handoff requires capability evidence, configuration
ownership, rotation/incident drills, rollback proof and operator approval.
Task 12 stays open until implementation and validation are complete.

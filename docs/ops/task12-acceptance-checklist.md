# Task 12 acceptance checklist

## Scope
Docs-only preparation. No supplier selected; no production adapter, credentials,
routing activation or live validation authorized by this checkpoint.

## Preparation acceptance
- [x] Capabilities template exists and marks Task 12 implementation incomplete.
- [x] All ten ChannelPlatform slots and observed resolver gaps are documented.
- [x] Invalid purchase responses are treated as potentially ambiguous outcomes.
- [x] Durable scoped intent, atomic concurrency and crash recovery are required.
- [x] Retry guidance requires provider evidence, bounded budgets and reconciliation.
- [x] Callback guidance covers signatures, atomic processing, recovery and retention.
- [x] Authorized reconciliation includes thresholds, rate budgets and audit trails.
- [x] Adapter template and runbook skeleton read back against inspected sources.

ADAPTER_TEMPLATE_VALIDATED: YES (documentation review only)
Runbook remains a provider-neutral skeleton, not an executable procedure.
No preparation checkbox certifies implemented behavior or live validation.

## Implementation acceptance (blocked on supplier decision)
- [ ] Select one supplier, market, currency, API version and sandbox; record
      official capability evidence and unsupported operations.
- [ ] Resolve exposed schema/resolver, credential and order-identity gaps.
- [ ] Implement validated authentication, purchase, callbacks and reconciliation;
      distinguish supplier cancellation from local status updates.
- [ ] Test concurrent duplicate order submissions: one authoritative purchase,
      one durable intent/ID, changed-payload conflict, restart/timeout recovery.
- [ ] Verify signatures, replay handling, tracking and cancellation in sandbox.
- [ ] Record actual authenticated dispatch and persisted outcomes separately
      from mocks/import checks; synthetic end-to-end gate precedes real secrets.

TASK_12_IMPLEMENTED: NO

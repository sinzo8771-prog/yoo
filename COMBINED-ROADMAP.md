# Combined Roadmap: Build the Store, Then Run It With AI

This merges two plans into one sequence:

- **Part A — Build Phase** (from `DROPSHIPPING-AGENT-PLAN.md`): constructs the actual store — custom storefront + Openfront + OpenShip + a real supplier flow.
- **Part B — Operate Phase** (from the earlier AI agent plan): once the store is live, layers a free AI ops agent on top to watch orders, support customers, and guard pricing.

**Rule of sequence:** Part B cannot start meaningfully until Part A reaches a working, reconciled fulfillment chain (Task 12 below). An ops agent watching a store that doesn't yet route real orders correctly will just generate false alerts.

---

## Part A — Build the Store

Execute in this order (full detail lives in `DROPSHIPPING-AGENT-PLAN.md` — this is the sequencing summary):

| # | Task | Produces | Unlocks in Part B |
|---|---|---|---|
| 1 | Reconnaissance of OpenShip / Openfront / Openfront Storefront repos | `docs/architecture/current-state.md` | Exact GraphQL contracts the ops agent will query later |
| 2 | Local environment + `.env` setup | Reproducible dev environment | Same env vars the ops agent's workflows will reuse |
| 3 | Storefront design system | Brand shell, accessibility primitives | — |
| 4 | Openfront catalog client | Typed product/variant queries | Product Scout & Listing Writer agent (B4) |
| 5 | Home page / merchandising | Editorial homepage | — |
| 6 | Collection/product pages | Real PDP flow | — |
| 7 | Cart | Working cart state | — |
| 8 | Customer/account/order lookup | Order status visible to customer | Customer Support agent (B2) reuses this exact lookup |
| 9 | Checkout | Payment handoff | — |
| 10 | OpenShip shop/channel/link/match setup | Configured routing | Order Watcher agent (B1) queries this directly |
| 11 | Synthetic fulfillment channel | Safe test supplier | Lets you test the Order Watcher agent risk-free before real money moves |
| 12 | **End-to-end routing (synthetic)** | **First real "done" milestone** | **Part B can begin here** |
| 13 | Real supplier adapter | Live fulfillment | Price Guardian agent (B3) needs this to compare live supplier cost |
| 14 | Tracking | Authoritative tracking data | Support agent answers "where's my order" with real data |
| 15 | Shipping/returns policy pages | Customer trust content | Feeds the Support agent's FAQ context |
| 16 | Payment hardening | Secure checkout | — |
| 17 | Observability | Structured logs | Reporting agent (B5) reads from here |
| 18 | Security | Rate limits, secret hygiene | Guardrails for agent's write access (see below) |
| 19 | SEO/analytics | Discoverability | — |
| 20 | Performance/accessibility | Polished UX | — |
| 21 | Policies (returns, privacy, etc.) | Legal/trust pages | — |
| 22 | Catalog seed (10–30 products) | Live catalog | Product Scout agent expands this later |
| 23 | CI/CD | Automated deploys | — |
| 24 | Production deployment | Live store | — |
| 25 | Final acceptance suite | Verified launch | **Store is live — start Part B in earnest** |

**Do not skip ahead.** The build plan's own rule stands: don't connect real supplier credentials (Task 13) until the synthetic end-to-end flow (Task 12) passes.

---

## Part B — Operate the Store With a Free AI Agent

Once Task 25 is done and the store is live, build the ops agent in this order. Same free stack as before: **n8n** (self-hosted, free) as the orchestrator, **Claude API or self-hosted Ollama** as the LLM brain, talking to the **same GraphQL endpoints** the storefront and OpenShip already expose from Part A.

### B1 — Order Watcher (build first)
- Cron job in n8n queries OpenShip for orders stuck in `pending`/`error` beyond a threshold.
- LLM summarizes the failure and suggests a fix.
- Alerts go to Slack/Telegram/Discord — free webhook, instant.
- **Reuses:** Task 10's shop/channel/link/match config and Task 17's structured logs.

### B2 — Customer Support Agent
- Chat widget (Chatwoot, free) on the storefront.
- n8n workflow: message → LLM (with real order data from Task 8/14's lookup + tracking) → draft reply.
- Refunds/complaints escalate to you — never auto-approved.
- **Reuses:** Task 8's order lookup contract and Task 15's shipping/returns copy as FAQ grounding.

### B3 — Price Guardian
- Periodic check comparing live supplier cost (via the Task 13 adapter) against your storefront price.
- Flags margin erosion; can suggest — not auto-apply — a price change above a threshold.
- **Reuses:** Task 13's real supplier adapter. Do not build this until that task is live and trustworthy.

### B4 — Product Scout & Listing Writer
- Feeds trending-product signals (free sources like Google Trends) to the LLM to draft new listings.
- New listings go into Openfront as drafts — a human approves and publishes.
- **Reuses:** Task 4's catalog client and Task 22's seeded catalog structure/tone.

### B5 — Daily Reporting Agent
- Cron pulls sales/order data via the same GraphQL layer, LLM turns it into a plain-English summary, emails it each morning.
- **Reuses:** Task 17's observability data.

---

## Shared Guardrails (apply to both parts)

These carry over directly from the build plan's own rules — they apply to the AI ops agent too, not just human-written code:

- **No agent auto-issues refunds or changes prices/inventory without a human approval step.** Add an explicit approve/deny node in n8n for anything touching money.
- **No secrets in agent workflows.** API tokens for Openfront/OpenShip live in n8n's credential store, never in prompts or logs.
- **Idempotency still applies.** If an n8n workflow retries, it must not double-alert, double-message a customer, or double-adjust a price.
- **Never treat an agent's own output as proof of a real-world event.** Same rule as the build plan: an LLM saying "order shipped" is not authoritative — only the supplier/tracking callback is.
- **Start every new agent capability in "suggest" mode** (drafts for human approval) before promoting it to "auto-act" once you trust its judgment.

---

## Minimal Path If You Want to Move Faster

If the full 25-task build is too much before you want to see something live:
1. Run Tasks 1–2 (reconnaissance + environment).
2. Use Openfront Storefront's reference client instead of a fully custom one — skip most of Task 3's custom design system for a v0.
3. Get Tasks 4, 7, 9, 10, 11, 12 done (catalog → cart → checkout → routing → synthetic fulfillment) — this is your real MVP.
4. Launch with the synthetic/test channel still visible only to you, swap in Task 13's real supplier once confident.
5. Add **only B1 (Order Watcher)** from Part B at first — it's the highest-value, lowest-risk agent to run from day one.

Everything else in both parts can be added incrementally after that.

# Architecture

**Analysis Date:** 2026-08-22

## Pattern Overview

**Overall:** Safety-first modular monolith with two intentionally separated application surfaces:

1. A Python modular monolith under `src/mox_adv/` for fixture/observe pipelines, the Integrated Prototype Dashboard, durable authority, local simulations, and a strictly read-only production view.
2. A separate TypeScript P0 production candidate under `sites/p0-production/` whose single `mox-adv.p0.application` query/command contract owns a real five-step campaign-creation workflow.

**Key Characteristics:**
- Closed, versioned contracts and fail-closed validation at every trust boundary.
- File/SQLite/D1 state rather than a shared remote application database.
- Immutable/content-addressed artifacts and revisioned state transitions.
- Explicit separation between test fixtures, read-only production observation, fake writes, and the P0 Direct write candidate.
- Agent-Owned Work and Human Decision Gates follow the domain decisions in `CONTEXT.md` and `docs/adr/0001-agent-owns-safe-work.md`.

## Python Modular Monolith Layers

**Entry and transport layer:**
- Purpose: expose CLI commands, local HTTP routes, Vercel adaptation, and host launchers.
- Contains: `src/mox_adv/cli.py`, `ui_server.py`, `api/index.py`, `scripts/mox-adv-host`, and `scripts/mox-adv-demo-site`.
- Depends on: application facades and orchestration services.

**Contract layer:**
- Purpose: define typed boundaries and canonical data exchanged between modules.
- Contains: dataclasses/Protocols in `src/mox_adv/contracts.py`, recommendation contracts in `recommend_contracts.py`, goal contracts in `goal_contracts.py`, autonomy contracts in `autonomy_contracts.py`, and versioned protocols in `internal_api/v1/__init__.py`.
- Used by: connectors, analytics, policy, persistence, UI, and test fixtures.

**Observation and analytics layer:**
- Purpose: collect local or allowlisted Yandex facts, normalize linked evidence, and calculate deterministic metrics.
- Contains: `connectors.py`, `yandex_read.py`, `normalization.py`, `analytics.py`, `observe.py`, and `monitoring.py`.
- Depends on: contracts plus the explicit egress policy.

**Decision and recommendation layer:**
- Purpose: convert trusted evidence into typed, explainable decisions without inheriting execution authority.
- Contains: `decision.py`, `policy.py`, `recommend_projection.py`, `recommend_service.py`, `model_provider.py`, and `proposal_store.py`.
- Pattern: sanitized projection → model/provider boundary → closed-schema proposal → immutable store.

**Authority and execution layer:**
- Purpose: enforce Approval, Mandate, kill-switch, write-window, audit, idempotency, and readback rules before any write-class operation.
- Contains: `control_state.py`, `application_control.py`, `approval_execution.py`, `autonomy_execution.py`, `mandate_store.py`, `write_window.py`, `egress.py`, and `trust_boundary.py`.
- Write implementations are either fake/local (`fake_write_adapter.py`, `goal_adapters.py`) or explicit typed management boundaries (`direct_management.py`).

**Lifecycle layer:**
- Purpose: run restart-safe campaign and goal sagas with durable reservations and ownership.
- Contains: `campaign_lifecycle.py`, `goal_service.py`, `goal_store.py`, `lifecycle_authority.py`, and `ui_workflows.py`.

**Persistence and evidence layer:**
- Purpose: preserve immutable run outputs, hash-chained events, revisions, and generated acceptance evidence.
- Contains: `artifacts.py`, `audit.py`, `ui_evidence.py`, `e2e_evidence.py`, plus SQLite stores embedded in domain modules.

**Dashboard composition layer:**
- Purpose: assemble services into the local Integrated Prototype without mixing simulated and production state inside one module.
- Contains: `ui_service.py` for run orchestration, `ui_dashboard.py` for application composition, `ui_control_plane.py`, `ui_campaign.py`, `ui_goal.py`, static assets under `src/mox_adv/ui/`, and HTTP routing in `ui_server.py`.

## P0 Production Candidate Layers

**Application contract:**
- `sites/p0-production/lib/p0-application.ts` is the single authority for queries, commands, workflow truth, document migrations, compare-and-swap revisions, evidence lineage, Campaign Strategy, Recommendation Set, Campaign Drafts, package review, Human Decision Gate, and external outcomes.
- `P0_COMMAND_TRUTH_TABLE` determines legal transitions; clients do not derive them from presentation state.

**Domain contracts/services:**
- Evidence: `analytics-evidence.ts`, `market-evidence.ts`, `landing-advisory.ts`.
- Strategy and drafts: `campaign-strategy.ts`, `campaign-fanout.ts`, `campaign-draft.ts`, `campaign-draft-fields.ts`, `campaign-viability.ts`, and `campaign-playbook.ts`.
- Authority/execution: `campaign-decision-gate.ts`, `campaign-package-execution.ts`, `campaign-correction.ts`, `execution-safety.ts`, and `direct-write.ts`.
- Public-site and provider context: `site-research.ts`, `site-url.ts`, and `yandex-context.ts`.

**Adapters and persistence:**
- `sites/p0-production/lib/p0.ts` binds the application contract to Cloudflare environment values, D1, Yandex APIs, public research, account writer leases, and durable Direct execution journals.
- D1 tables are declared in `sites/p0-production/db/schema.ts`.
- The deterministic localhost fixture adapter is isolated in `lib/p0-e2e-runtime.ts` and gated by `lib/p0-e2e-boundary.ts`.

**HTTP and UI:**
- `app/api/p0/route.ts` exposes `GET` query and `POST` command calls with explicit error status mapping.
- `app/P0Client.tsx` renders the five workflow steps and sends commands with `expected_revision`.
- `app/RecommendationSetDisclosure.tsx` and `app/MarketEvidenceDisclosure.tsx` render persisted evidence rather than recomputing it.
- `worker/index.ts` is the Cloudflare Worker entry point.

## Data Flow

**Root fixture simulation:**
1. CLI routes `mox-adv run-fixture` in `src/mox_adv/cli.py`.
2. `pipeline.py` creates an immutable `RunWorkspace` and SQLite audit journal.
3. `FixtureConnectorV1` validates the closed fixture schema.
4. normalization, analytics, deterministic decision, simulation policy, and no-write executor run through `internal_api/v1` contracts.
5. Result, report, event chain, and capability evidence are atomically written and the audit chain is sealed.

**Root production observation:**
1. Dashboard/CLI loads exact non-secret production binding and protected credentials.
2. `YandexReadOnlyTransport` permits only Direct Reports get, Campaigns get, and Metrika Statistics get.
3. `observe.py` links typed blocks into one `IntegratedPerformanceSnapshot`.
4. Analytics and recommendation operate on sanitized evidence; the first read-only snapshot routes material uncertainty to human review and never grants write authority.

**Root Dashboard request:**
1. `UiRequestHandler` maps a narrow path to `UiRunService` or `DashboardApplication`.
2. application facades validate JSON and durable revision/authority state.
3. test operations use deterministic fixtures and sealed fake adapters; production mode remains read-only.
4. JSON/HTML/evidence artifacts and SQLite transitions are persisted under `runs/`.

**P0 query/command:**
1. GPT Sites identity maps the request to a user key.
2. `GET /api/p0` loads/migrates the revisioned D1 document and returns workflow truth plus current read context.
3. `POST /api/p0` validates `expected_revision`, the truth-table transition, current provider/context lineage, and command-specific evidence.
4. document mutations persist by compare-and-swap; stale tabs fail with `P0_REVISION_CONFLICT`.
5. confirmed package dispatch journals intent before independent Direct item writes, explicitly suspends each campaign, verifies semantic readback, and records moderation/outcome state.

## State Management

- Root immutable run state lives under `runs/<run-id>/`; reusable control state is in purpose-specific SQLite files.
- Interrupt/kill-switch state is independently writable so it can preempt a busy execution transaction.
- Root Vercel demo state is a zipped private Blob snapshot restored to `/tmp` for API handling.
- P0 current state and every revision are whole application documents in D1; execution/account-lock rows provide a separate durable operation journal.
- Canonical JSON and SHA-256 fingerprints establish identity and detect drift throughout both applications.

## Key Abstractions

**Closed contract / Protocol:**
- Purpose: prevent an implementation from quietly gaining methods or accepting new fields.
- Examples: `ReadOnlyTransport`, `ModelProvider`, `P0ApplicationStore`, and `P0ApplicationAdapters`.

**Durable authority:**
- Purpose: make Approval, Mandate, kill-switch, reservation, and writer-lease decisions restart-safe.
- Examples: `DurableControlState`, `DurableMandateAuthority`, `CampaignSagaStore`, `GoalLifecycleStore`, and P0 D1 execution/account-lock rows.

**Immutable evidence artifact:**
- Purpose: preserve exact inputs, provenance, revision, and a verifiable digest.
- Examples: `IntegratedPerformanceSnapshot`, `AnalyticsEvidenceBundle`, `PackageReview`, audit anchors, and run manifests.

**Adapter:**
- Purpose: keep external effects outside deterministic domain logic.
- Examples: fixture/read connectors, `FakeWriteAdapter`, `DirectManagementAdapter`, P0 `P0ApplicationAdapters`, and the landing advisory adapter.

## Entry Points

- `src/mox_adv/cli.py` / `src/mox_adv/__main__.py` — root CLI.
- `src/mox_adv/ui_server.py` — loopback Dashboard HTTP server.
- `api/index.py` — Vercel Python Function adapter.
- `src/mox_adv/e2e_runner.py` — final sealed-write E2E workflow.
- `sites/p0-production/app/api/p0/route.ts` — P0 query/command API.
- `sites/p0-production/app/page.tsx` and `app/P0Client.tsx` — P0 UI.
- `sites/p0-production/worker/index.ts` — Worker runtime entry.

## Error Handling

**Strategy:** Fail closed at boundaries, preserve a bounded reason code, and avoid leaking credentials or arbitrary provider payloads.

**Patterns:**
- Python domain exceptions expose `reason_code` or fixed error codes and are caught at CLI/HTTP boundaries.
- Fixture failures still create redacted immutable failure artifacts.
- Egress, credentials, schema, stale revision, and unknown external outcomes block rather than degrade silently.
- P0 throws `P0ApplicationError(code, message)`; API routes map query failures to 503 and command conflicts to 409.
- Ambiguous Direct outcomes require reconciliation and are never blind-retried.

## Cross-Cutting Concerns

**Validation:** exact key sets, dataclass/type contracts, canonical hashes, schema versions, API matrices, provider semantic readback, and document compare-and-swap.

**Security:** protected credential channels, no-redirect HTTPS, bounded response bodies, prompt-injection canaries, SSRF defenses, account-scoped writer leases, and fail-closed unavailable states.

**Auditability:** SQLite hash chains, immutable revisions, persisted evidence lineage, signed anchors, provider IDs/issues, and explicit human decision packets.

**Language:** domain output should use the exact vocabulary in `CONTEXT.md`; avoid the synonyms marked there.

---

*Architecture analysis: 2026-08-22*
*Update when module ownership or state-transition authority changes*

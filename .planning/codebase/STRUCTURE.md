# Codebase Structure

**Analysis Date:** 2026-08-22

## Directory Layout

```text
MOX-ADV/
├── api/                       # Vercel Python Function adapter
├── config/                    # Gate 0 policy and production-read example
├── docs/
│   ├── adr/                   # Accepted architecture decisions
│   ├── agents/                # Repository workflow/triage/domain rules
│   ├── research/              # Primary-source design research
│   └── prototypes/            # Design evidence images
├── fixtures/                  # Closed-schema local, policy, security, and E2E inputs
├── schemas/                   # Versioned JSON Schemas for external artifacts
├── scripts/                   # Host, tunnel, and Gate 0 validation scripts
├── site/dashboard-demo/       # Static GitHub Pages demo
├── sites/p0-production/       # Separate TypeScript P0 production candidate
│   ├── .openai/               # OpenAI Sites hosting binding
│   ├── app/                   # React pages, API route, and client UI
│   ├── db/                    # Drizzle D1 schema/accessor
│   ├── drizzle/               # Generated/committed D1 migrations
│   ├── lib/                   # P0 application and domain contracts
│   ├── public/                # Static P0 assets
│   ├── tests/                 # Node contract fixtures and tests
│   └── worker/                # Cloudflare Worker entry
├── src/mox_adv/
│   ├── internal_api/v1/       # Versioned modular-monolith Protocol boundaries
│   ├── ui/                    # Root Dashboard HTML/CSS/JavaScript assets
│   └── *.py                   # Domain, application, persistence, and transport modules
├── tests/
│   ├── e2e/                   # Browser and final acceptance tests
│   └── test_*.py              # Python unit/integration tests
├── CONTEXT.md                 # Ubiquitous language
├── AGENTS.md                  # Repository agent instructions
├── README.md                  # Runtime and operator guide
├── pyproject.toml             # Root Python package
├── uv.lock                    # Resolved Python environment
├── Dockerfile                 # Networkless fixture container image
└── vercel.json                # Root Vercel routing
```

## Directory Purposes

**`src/mox_adv/`:**
- Purpose: source of truth for the root Python modular monolith.
- Contains: contracts, connectors, analytics, recommendation, authority, lifecycle, audit, Dashboard, Vercel, and E2E modules.
- Key files: `cli.py`, `contracts.py`, `pipeline.py`, `observe.py`, `control_state.py`, `ui_service.py`, `ui_dashboard.py`, and `yandex_read.py`.
- UI assets: `src/mox_adv/ui/index.html`, `app.js`, `app.css`, and prototype equivalents.

**`src/mox_adv/internal_api/v1/`:**
- Purpose: stable versioned Protocol interfaces between the root monolith's modules.
- Key file: `src/mox_adv/internal_api/v1/__init__.py`.

**`tests/`:**
- Purpose: root unit, integration, safety, storage, UI, and browser acceptance tests.
- Tests mirror functional areas rather than source directories, for example `tests/test_yandex_read.py`, `tests/test_bounded_autonomy.py`, and `tests/e2e/test_p0_production_candidate.py`.
- Shared test data is normally read from `fixtures/` or created inside temporary directories.

**`sites/p0-production/`:**
- Purpose: isolated production candidate for real campaign strategy/draft/package workflow.
- Key application contract: `sites/p0-production/lib/p0-application.ts`.
- Provider/runtime adapter: `sites/p0-production/lib/p0.ts`.
- UI: `sites/p0-production/app/P0Client.tsx`.
- API: `sites/p0-production/app/api/p0/route.ts`.
- Persistence: `sites/p0-production/db/schema.ts` and `drizzle/`.
- Tests: `sites/p0-production/tests/*.test.mjs` plus Python Playwright acceptance in `tests/e2e/test_p0_production_candidate.py`.

**`config/`:**
- `config/gate0-policy.json` is normative for the root Gate 0 boundary.
- `config/production-read.example.json` is the non-secret production-read linkage template.

**`fixtures/`:**
- `fixtures/safe-bootstrap.json` and `fixtures/linked-observe.json` drive root simulation/observe paths.
- `fixtures/llm/`, `fixtures/impact/`, `fixtures/security/`, and `fixtures/ui/` cover deterministic decisions, post-change outcomes, injection/sensitive-data defenses, and Dashboard scenarios.

**`docs/`:**
- `docs/adr/` holds accepted decisions; read it with `CONTEXT.md` before changing domain behavior.
- `docs/research/` records source-grounded design work.
- `docs/agents/` defines issue triage and the `Wayfinder → to-spec → to-tickets → implement` delivery sequence.

**`scripts/`:**
- `scripts/mox-adv-host` builds/runs the no-network Docker path and handles ephemeral Keychain credential stdin.
- `scripts/mox-adv-demo-site` starts the local Dashboard and a temporary localhost.run tunnel.
- `scripts/validate_gate0.py` validates the large Gate 0 policy contract.

**`api/` and deployment files:**
- `api/index.py` adapts the root Dashboard to a Vercel Python Function.
- `vercel.json` rewrites all root routes to that function.
- `.github/workflows/deploy-dashboard-demo.yml` deploys only the static `site/dashboard-demo/` tree.

## Key File Locations

**Entry points:**
- `src/mox_adv/cli.py` — `mox-adv` command router.
- `src/mox_adv/__main__.py` — `python -m mox_adv`.
- `src/mox_adv/ui_server.py` — local HTTP server.
- `api/index.py` — Vercel adapter.
- `sites/p0-production/worker/index.ts` — P0 Worker.
- `sites/p0-production/app/api/p0/route.ts` — P0 HTTP query/command contract.

**Core root logic:**
- `src/mox_adv/contracts.py` — shared dataclasses and read contracts.
- `src/mox_adv/pipeline.py` and `observe.py` — top-level execution paths.
- `src/mox_adv/control_state.py` and `mandate_store.py` — durable authority.
- `src/mox_adv/approval_execution.py` and `autonomy_execution.py` — guarded fake execution.
- `src/mox_adv/campaign_lifecycle.py` and `goal_service.py` — restart-safe sagas.
- `src/mox_adv/ui_service.py` and `ui_dashboard.py` — Integrated Prototype application layer.

**Core P0 logic:**
- `sites/p0-production/lib/p0-application.ts` — authoritative state machine.
- `sites/p0-production/lib/analytics-evidence.ts` — evidence contract.
- `sites/p0-production/lib/campaign-fanout.ts` and `campaign-viability.ts` — Recommendation Set and comparative priority.
- `sites/p0-production/lib/campaign-decision-gate.ts` — shortlist/package/Human Decision Gate.
- `sites/p0-production/lib/campaign-package-execution.ts` and `direct-write.ts` — independent provider executions and semantic readback.

**Configuration:**
- `pyproject.toml`, `uv.lock`, `Dockerfile`, `vercel.json`.
- `sites/p0-production/package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.mjs`, and `.openai/hosting.json`.

**Documentation:**
- `CONTEXT.md`, `docs/adr/0001-agent-owns-safe-work.md`, and `README.md`.
- Requirements remain at repository root; source research is in `docs/research/`.

## Naming Conventions

**Python files and symbols:**
- Modules use `snake_case.py`; test modules use `test_<area>.py`.
- Classes and dataclasses use `PascalCase`; functions/variables use `snake_case`; constants use `UPPER_SNAKE_CASE`.
- Private helpers and constants use a leading underscore.

**P0 files and symbols:**
- Library files use kebab-case, such as `campaign-package-execution.ts`.
- React components use PascalCase filenames and exports, such as `P0Client.tsx` and `MarketEvidenceDisclosure.tsx`.
- Functions/variables use camelCase; contract constants use `UPPER_SNAKE_CASE`.
- Node tests use `<contract>.test.mjs`.

**Documents:**
- Normative root context files are uppercase (`README.md`, `CONTEXT.md`, `AGENTS.md`).
- ADRs use numeric prefixes under `docs/adr/`.
- Research documents use descriptive kebab-case names.

## Where to Add New Code

**Root domain behavior:**
- Define or extend closed data in `src/mox_adv/contracts.py` or the domain-specific contract module.
- Place deterministic service logic in a focused `src/mox_adv/<domain>.py` module.
- Expose a stable cross-module seam through `src/mox_adv/internal_api/v1/` when needed.
- Add matching `tests/test_<domain>.py` coverage and reusable closed fixtures under `fixtures/<domain>/`.

**Root Dashboard behavior:**
- Service/orchestration: `src/mox_adv/ui_service.py` or a focused `ui_<domain>.py` facade.
- HTTP route: `src/mox_adv/ui_server.py`.
- Browser UI: `src/mox_adv/ui/app.js` and `app.css`; prototype-only behavior belongs in `prototype.*`.
- Browser acceptance: `tests/e2e/test_ui_*.py` using the Dashboard UI, not direct state manipulation.

**P0 feature:**
- State/transition authority: `sites/p0-production/lib/p0-application.ts`.
- Focused domain calculation: a kebab-case module under `sites/p0-production/lib/`.
- Persistence adapter/schema: `lib/p0.ts`, `db/schema.ts`, and a generated migration in `drizzle/`.
- UI: a PascalCase component under `app/`.
- Contract tests: `sites/p0-production/tests/<feature>.test.mjs`; full UI acceptance: `tests/e2e/test_p0_production_candidate.py`.

**External integration:**
- Root reads go through `contracts.py` + `connectors.py` + `egress.py`; Yandex HTTP implementation is in `yandex_read.py`.
- P0 provider adapters stay in `lib/p0.ts`, `direct-write.ts`, `yandex-context.ts`, or `market-evidence.ts`; deterministic logic stays outside adapters.

## Special Directories

**`.planning/`:**
- GSD planning and codebase-map output. The current map is created under `.planning/codebase/`.
- Intended to be committed when produced by GSD workflows.

**`.pi/`:**
- Project-local Pi extensions and the installed GSD runtime.
- `.pi/tasks/` and `.pi/subagents/` are ignored runtime state; extension code may be versioned.

**`runs/`:**
- Generated immutable run/evidence state and local SQLite stores.
- Ignored by Git; never treat it as source code.

**`src/mox_adv.egg-info/`:**
- Generated packaging metadata currently tracked in the repository; it is not authoritative application source.

**Nested worktrees/local artifacts:**
- `.worktrees/` and the local `sites/mox-adv-overview/` linked worktree are not tracked as part of this repository's source tree.
- `.venv/`, caches, `.vercel/`, `.wrangler/`, `node_modules/`, build output, screenshots, and local `.env*` files are generated or local-only.

---

*Structure analysis: 2026-08-22*
*Update when source ownership or top-level layout changes*

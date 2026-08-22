# Coding Conventions

**Analysis Date:** 2026-08-22

## Domain Vocabulary

- Use the exact ubiquitous language in `CONTEXT.md` for issues, hypotheses, tests, UI labels, and documentation.
- Do not replace terms with the synonyms explicitly marked “Avoid” in `CONTEXT.md`.
- Read relevant decisions under `docs/adr/` before changing ownership, authority, or Human Decision Gate behavior.
- Preserve the distinction between Test Scenario, Integrated Prototype, Production Module, Agent-Owned Work, Critical Decision, Material Uncertainty, and Human Decision Gate.

## Python Naming Patterns

**Files:**
- Use `snake_case.py` modules grouped by domain capability: `recommend_service.py`, `campaign_lifecycle.py`, `ui_control_plane.py`.
- Use `test_<area>.py` for tests and keep browser suites under `tests/e2e/`.

**Functions and variables:**
- Use `snake_case` for public and private functions.
- Prefix module-private helpers with `_`, for example `_load_json_object` in `src/mox_adv/pipeline.py`.
- Use `UPPER_SNAKE_CASE` for constants and frozen lookup tables.

**Types:**
- Use `PascalCase` for classes, dataclasses, enums, Protocols, and exceptions.
- Prefer descriptive capability names (`IntegratedPerformanceSnapshot`, `DurableMandateAuthority`) over generic service names.
- Enum members and closed string states use uppercase semantic values such as `IN_FLIGHT`, `SUSPENDED`, and `NEEDS_HUMAN`.

## TypeScript/React Naming Patterns

**Files:**
- Use kebab-case for P0 library modules (`campaign-decision-gate.ts`, `analytics-evidence.ts`).
- Use PascalCase for React component files (`P0Client.tsx`, `RecommendationSetDisclosure.tsx`).
- Use `<feature>.test.mjs` for Node contract tests.

**Symbols:**
- Use camelCase for functions and variables.
- Use PascalCase for exported types, interfaces, classes, and React components.
- Use `UPPER_SNAKE_CASE` for schema IDs, contract versions, fixed tokens, and safety constants.

## Code Style

**Python formatting:**
- Four-space indentation, double-quoted strings, trailing commas in multiline calls/collections, and parenthesized line wrapping are the dominant style.
- Begin modules with a short explanatory docstring and `from __future__ import annotations` where annotations are used.
- No root formatter/linter configuration is committed; match the existing style and keep Python 3.9 compatibility declared by `pyproject.toml`.
- Use UTF-8 explicitly for file reads/writes.

**TypeScript formatting:**
- Two-space indentation, double quotes, semicolons, trailing commas, and ESM imports.
- `sites/p0-production/tsconfig.json` enforces strict, no-emit, bundler-resolution TypeScript.
- ESLint combines recommended TypeScript, React, hooks, jsx-a11y, and Next core-web-vitals rules from `sites/p0-production/eslint.config.mjs`.
- Internal P0 imports include explicit `.ts` extensions in library/test code where the bundler/test runner accepts them.

## Import Organization

**Python:**
1. `__future__` annotations.
2. Standard-library imports.
3. Blank line.
4. `mox_adv.*` imports.
- Use `collections.abc` for runtime collection interfaces when practical; older modules also use `typing` aliases to preserve 3.9 compatibility.
- Avoid wildcard imports and implicit package re-export seams.

**TypeScript:**
1. Platform/external imports (`cloudflare:workers`, React, Node built-ins).
2. Relative P0 domain modules.
3. Type-only imports with `type` markers where appropriate.
- P0 does not rely heavily on the configured `@/*` alias; relative imports make domain boundaries explicit.

## Contract and State Design

- Prefer frozen Python dataclasses for immutable values and Protocols for replaceable boundaries.
- Validate exact field sets for security-sensitive JSON instead of accepting arbitrary additional properties.
- Version persisted/external contracts with explicit `schema_version`, contract ID, and version constants.
- Canonicalize before hashing; use `sha256:`-prefixed identities where established.
- Treat persisted revisions as immutable. Mutations should create a new revision or append a durable transition.
- Use compare-and-swap for shared P0 documents and `BEGIN IMMEDIATE`/guarded updates for SQLite state.
- Public clients consume workflow truth from the application contract; they must not recreate state-machine rules in UI code.

## Error Handling

**Patterns:**
- Fail closed when validation, credentials, bindings, freshness, provider outcome, or durable state is missing/ambiguous.
- Use typed domain exceptions with stable reason codes: `ControlRejected`, `RunRejectedError`, `UiRunRejected`, `P0ApplicationError`, and `DirectWriteError`.
- Catch errors at CLI/HTTP boundaries and return bounded messages without raw credentials, provider bodies, or tracebacks.
- Chain root causes with `raise ... from error` in Python or `ErrorOptions.cause` in TypeScript when the internal cause is useful and safe.
- Do not blind-retry write-class provider operations; persist intent and require semantic reconciliation for ambiguous outcomes.

## External Effects

- Keep network/file/provider effects behind explicit adapters or transport interfaces.
- Root Yandex work must go through API-only seams (`src/mox_adv/yandex_read.py`, `egress.py`); browser cabinets are out of bounds.
- Dashboard automation must be validated through the UI with Playwright; do not bypass it with direct Dashboard API/state manipulation.
- Fixture and E2E write paths use sealed fake adapters and local interception unless a separately accepted production boundary explicitly says otherwise.
- Write an audit/pre-write intent before dispatch, and verify exact readback before claiming success.

## Logging and Evidence

- Prefer durable structured artifacts/events to informal debug logs for material decisions.
- Use stdout/stderr for operator summaries and bounded errors; do not emit credentials or raw sensitive source data.
- Every material recommendation or provider outcome should retain evidence/provenance pointers, not model chain of thought.
- User-facing product copy is predominantly Russian; technical identifiers, file paths, and schema values remain English.

## Comments and Documentation

- Explain safety invariants, reasons, trade-offs, and provider edge cases rather than narrating obvious code.
- Public or security-sensitive classes/functions commonly have concise docstrings; keep them current.
- Use comments to identify intentional legacy behavior, fail-closed boundaries, or why an operation is excluded (for example the absent `Campaigns.resume` path in P0).
- Add domain decisions to `docs/adr/` only when an architectural decision is actually resolved; do not duplicate the glossary.
- There are almost no TODO/FIXME markers in tracked source; prefer tracked issues/specs over unowned TODO comments.

## Function and Module Design

- Use early validation and guard clauses before effects.
- Inject clocks, stores, providers, HTTP clients, and authenticators so deterministic tests can control boundaries.
- Keep deterministic calculation separate from adapters and persistence.
- Prefer one authority for each state machine: `DurableControlState` for root authority and `P0Application` for the P0 document.
- Existing large orchestrator modules are not a model for new code; add focused modules and keep their public seam narrow.

## Testing Conventions

- Python tests subclass `unittest.TestCase`, use `tempfile.TemporaryDirectory`, `unittest.mock`, `subTest`, and exact equality/assertion checks.
- Node tests use `node:test`, `node:assert/strict`, temporary stores, and injected adapters.
- Browser tests use semantic Playwright locators, assert no console/page errors or unexpected egress, and use a 1920×1080 viewport.
- Security tests include explicit secret canaries and verify they do not appear in messages or artifacts.
- Assert negative capability boundaries (no network, no write, no resume, no stale revision) as well as happy paths.

---

*Convention analysis: 2026-08-22*
*Update when linting, language levels, or authority patterns change*

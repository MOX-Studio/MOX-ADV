# Technology Stack

**Analysis Date:** 2026-08-22

## Languages

**Primary:**
- Python 3.9+ — the root modular monolith, CLI, local Dashboard, safety controls, persistence, Yandex read paths, and Python E2E harness under `src/mox_adv/`.
- TypeScript 5.9 — the separate P0 production candidate under `sites/p0-production/`.

**Secondary:**
- JavaScript — browser assets in `src/mox_adv/ui/*.js` and Node test files in `sites/p0-production/tests/*.test.mjs`.
- HTML/CSS — the root Dashboard and prototype assets in `src/mox_adv/ui/`, the static demo in `site/dashboard-demo/`, and the P0 React presentation.
- POSIX shell — Docker and temporary demo launchers in `scripts/mox-adv-host` and `scripts/mox-adv-demo-site`.
- JSON/YAML/Markdown — policies, fixtures, schemas, GitHub Actions, research, requirements, and domain documentation.

## Runtime

**Root Python application:**
- Python `>=3.9` is declared in `pyproject.toml`.
- The container runtime is Python 3.12 slim in `Dockerfile`.
- The package exposes `mox-adv = mox_adv.cli:main` and can also run through `python -m mox_adv`.
- Most application code uses only the Python standard library; the conditional production dependency is `vercel>=0.5,<1` for Python 3.10+.

**P0 production candidate:**
- Node.js `>=22.13.0` is required by `sites/p0-production/package.json`.
- The deployment runtime is a Cloudflare Worker produced by vinext/Vite and hosted through OpenAI Sites.
- React Server Components and browser React execute through React 19.2.6.

**Package managers:**
- Python: editable pip installs are documented in `README.md`; `uv.lock` is committed for resolved environments.
- Node: npm with `sites/p0-production/package-lock.json`.

## Frameworks

**Root application:**
- Setuptools — package build backend configured in `pyproject.toml`.
- `argparse` — CLI command routing in `src/mox_adv/cli.py`.
- `http.server.ThreadingHTTPServer` — local Dashboard HTTP surface in `src/mox_adv/ui_server.py`.
- SQLite through `sqlite3` — durable local control, audit, scheduling, lifecycle, proposal, and UI state.
- Vercel Python Functions — root demo adapter in `api/index.py` with routing in `vercel.json`.

**P0 application:**
- React 19.2.6 and React DOM 19.2.6 — the five-step production-candidate UI in `sites/p0-production/app/`.
- vinext 1.0.0-beta.2 and Vite 8.0.13 — Next-compatible application/build runtime.
- `@openai/sites-vite-plugin` 0.1.0 — OpenAI Sites integration.
- Cloudflare Vite plugin 1.37.1 and Wrangler 4.92.0 — Worker development and build.
- Drizzle ORM 0.45.2 / Drizzle Kit 0.31.10 — typed Cloudflare D1 schema and migration generation.
- Tailwind CSS 4.2.1 PostCSS plugin is configured in `sites/p0-production/postcss.config.mjs`; application styling also lives directly in `app/globals.css`.

**Testing:**
- Python `unittest` — 32 tracked test files, 55 `TestCase` classes, and 376 test methods across unit, integration, and E2E suites.
- Playwright Python `>=1.48,<2` — browser E2E at a fixed 1920×1080 viewport.
- Node's built-in `node:test` and `node:assert/strict` — 27 P0 contract test files with about 199 top-level tests.
- ESLint 9 with TypeScript, React, hooks, accessibility, and Next core-web-vitals presets for P0.

## Key Dependencies

**Root critical dependencies:**
- Python standard library — `sqlite3`, `urllib`, `http.server`, `hashlib`, `hmac`, `subprocess`, `threading`, and dataclasses implement the core system.
- `vercel` Python package — private Blob state snapshots for the Vercel demo in `src/mox_adv/vercel_runtime.py`.
- Playwright — opt-in browser safety and UI acceptance tests from `requirements-e2e.txt`.

**P0 critical dependencies:**
- `drizzle-orm` 0.45.2 — Cloudflare D1 persistence bindings.
- `json-bigint` 1.x — lossless Yandex Direct identifiers and payloads in `sites/p0-production/lib/direct-write.ts`.
- React/React DOM 19.2.6 — UI and server rendering.
- vinext/Vite/Cloudflare plugin — OpenAI Sites and Worker packaging.

## Configuration

**Root:**
- `config/gate0-policy.json` is the versioned, fail-closed Gate 0 authority and API matrix.
- `config/production-read.example.json` defines non-secret Yandex account/campaign/counter/goal linkage.
- A protected root `.env` supplies exactly the four read-only Dashboard bindings described in `README.md`; code reads the file without importing it into the process environment.
- `pyproject.toml`, `uv.lock`, `Dockerfile`, `vercel.json`, and `.github/workflows/deploy-dashboard-demo.yml` define packaging and deployment.

**P0:**
- `sites/p0-production/.openai/hosting.json` binds Cloudflare D1 as `DB`.
- `sites/p0-production/vite.config.ts`, `tsconfig.json`, `eslint.config.mjs`, and `drizzle.config.ts` configure build, types, linting, and schema generation.
- Yandex Direct, Metrika, and Wordstat credentials and identifiers are server-side Worker environment bindings; `P0_E2E_FIXTURE_SCENARIO` activates only the localhost deterministic fixture boundary.

## Platform Requirements

**Development:**
- Python 3.9+; Node 22.13+ and npm for the P0 candidate.
- Chromium installed through Playwright for browser E2E.
- macOS-specific Keychain and elevated authorization paths exist for trusted local authority operations; fixture and most test paths remain portable.
- Docker is optional for the networkless, read-only container smoke test.

**Production/demo:**
- Root Dashboard: loopback local server, Docker, Vercel Python Function plus private Vercel Blob, or GitHub Pages for the static demo.
- P0 candidate: OpenAI Sites on a Cloudflare Worker with D1 and GPT Sites authentication headers.
- External platform calls are HTTPS-only and explicitly bounded in the relevant integration layers.

---

*Stack analysis: 2026-08-22*
*Update after runtime, deployment, or major dependency changes*

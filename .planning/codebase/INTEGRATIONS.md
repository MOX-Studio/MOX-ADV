# External Integrations

**Analysis Date:** 2026-08-22

## APIs & External Services

**Yandex Direct — root read-only Dashboard:**
- `src/mox_adv/yandex_read.py` performs exactly three allowlisted production-read operations through `YandexReadOnlyTransport` and `HttpEgressGuard`.
- Direct Reports: `POST https://api.direct.yandex.com/json/v501/reports`, `Reports.get`.
- Campaign state/catalog: `POST https://api.direct.yandex.com/json/v501/campaigns`, `Campaigns.get`.
- Authentication: read-only OAuth token plus client login; values come from protected `.env` or an exact macOS Keychain profile and are never written to artifacts.
- Redirects are rejected and responses are size- and timeout-bounded.

**Yandex Metrika — root read-only Dashboard:**
- Statistics: `GET https://api-metrika.yandex.net/stat/v1/data` through `src/mox_adv/yandex_read.py`.
- Authentication: OAuth token and exactly one positive counter ID.
- Direct campaign time zone is propagated to Metrika queries so linked daily rows share a calendar boundary.

**Yandex APIs — P0 production candidate:**
- Context verification in `sites/p0-production/lib/yandex-context.ts` uses Direct `Clients.get` and Metrika Management API counter/goal reads.
- `sites/p0-production/lib/p0.ts` reads Direct dictionaries/campaign inventory and Metrika statistics.
- `sites/p0-production/lib/market-evidence.ts` uses official Wordstat `/v1/topRequests`, `/v1/dynamics`, and `/v1/regions`, plus Direct `Keywords.get` and `KeywordBids.get` for qualified current-cost evidence.
- `sites/p0-production/lib/direct-write.ts` implements bounded Direct v501 `Campaigns`, `AdGroups`, `Keywords`, and `Ads` add/update/get operations, explicit `Campaigns.suspend`, and `Ads.moderate`.
- `Campaigns.resume` is intentionally absent from the P0 contract.
- All credentials remain in server-side Worker bindings; provider IDs are parsed losslessly with `json-bigint`.

**Public-site research:**
- `sites/p0-production/lib/site-research.ts` performs credential-free, bounded first-party HTTPS research with manual redirects, DNS/IP checks, page and byte limits, and cross-party rejection.
- `sites/p0-production/lib/p0.ts` resolves hostnames through Cloudflare DNS over HTTPS at `https://cloudflare-dns.com/dns-query`.
- `sites/p0-production/lib/landing-advisory.ts` exposes an injected, fail-closed Lighthouse/axe audit boundary for an exact first-party landing URL; deployments without the pinned browser runtime report insufficient evidence.

**Temporary tunnel:**
- `scripts/mox-adv-demo-site` opens an SSH reverse tunnel through `nokey@localhost.run` and exposes the same local Dashboard state intentionally for a short-lived demo.

## Data Storage

**Root local storage:**
- SQLite is the primary durable store for audit chains, approvals, Mandates, kill-switch state, monitoring schedules, write windows, campaign/goal sagas, proposals, model-cost reservations, and Dashboard state.
- Representative stores: `src/mox_adv/audit.py`, `control_state.py`, `mandate_store.py`, `campaign_lifecycle.py`, `goal_store.py`, and `ui_automation.py`.
- Immutable run artifacts live under `runs/<run-id>/` and include JSON, Markdown/HTML, JSONL, and hidden SQLite journals.
- `src/mox_adv/artifacts.py` performs atomic workspace and artifact writes.

**Vercel demo storage:**
- `src/mox_adv/vercel_runtime.py` zips the `runs/` state into private Vercel Blob object `runtime/dashboard-state-v1.zip`.
- `api/index.py` restores state before API requests and persists it after mutations or scheduler changes.
- `BLOB_READ_WRITE_TOKEN` is the server-side Blob credential.

**P0 storage:**
- Cloudflare D1 binding `DB` is configured by `sites/p0-production/.openai/hosting.json`.
- `sites/p0-production/db/schema.ts` defines current state, immutable revision rows, Direct execution journals, and account-level writer leases.
- `sites/p0-production/lib/p0-application.ts` owns document-level compare-and-swap and versioned migration semantics; `lib/p0.ts` implements the D1 adapter.
- No R2 bucket is configured.

## Authentication & Identity

**Root trusted authority:**
- macOS user identity and optional elevated `sudo -n -v` verification are implemented in `src/mox_adv/control_state.py`.
- HMAC and macOS Keychain-backed signing protect Mandates and audit anchors in `src/mox_adv/mandate_signing.py` and `src/mox_adv/trust_boundary.py`.
- Local read-only Yandex credentials may be read from a mode-0600 `.env`; write-class credential profiles remain Keychain-bound by policy.

**P0 user identity:**
- GPT Sites injects `oai-authenticated-user-*` headers consumed by `sites/p0-production/app/chatgpt-auth.ts`.
- `sites/p0-production/lib/p0.ts` keys D1 state by authenticated user ID; localhost previews use the explicit `local-preview` identity.
- Production access without GPT Sites identity fails closed.

## Monitoring & Observability

**Audit and evidence:**
- `src/mox_adv/audit.py` persists a contiguous SHA-256 hash chain in SQLite and exports `events.jsonl`.
- `src/mox_adv/ui_evidence.py` and `e2e_evidence.py` generate signed/hashed capability and acceptance evidence bundles.
- P0 persists content-addressed evidence, revisions, package execution, provider outcomes, and moderation checkpoints inside its application document and D1 journals.

**Logs:**
- Root services use stdout/stderr and durable artifacts; no external error-tracking provider is integrated.
- Wrangler logs are project-local and disabled/minimized by `sites/p0-production/vite.config.ts` defaults.

## CI/CD & Deployment

**GitHub Pages:**
- `.github/workflows/deploy-dashboard-demo.yml` publishes `site/dashboard-demo/` on matching `main` changes.

**Vercel:**
- `vercel.json` routes every root request to `api/index.py` with a 60-second function limit.
- Private Blob state is optional but required for persistence across function instances.

**OpenAI Sites / Cloudflare:**
- `sites/p0-production/vite.config.ts` combines vinext, the OpenAI Sites plugin, and Cloudflare Worker/D1 bindings.
- Worker entry: `sites/p0-production/worker/index.ts`.

**Docker:**
- `Dockerfile` builds the root CLI on Python 3.12.
- `scripts/mox-adv-host` runs it with no network, read-only root filesystem, dropped capabilities, no privilege escalation, and optional ephemeral Keychain credential stdin.

## Environment Configuration

**Root development/demo:**
- Non-secret linkage: `config/production-read.example.json` copied to `~/.config/mox-adv/production-read.json`.
- Secret/read bindings: `YANDEX_DIRECT_OAUTH_TOKEN`, `YANDEX_DIRECT_CLIENT_LOGIN`, `YANDEX_METRICA_OAUTH_TOKEN`, and `YANDEX_METRICA_COUNTER_IDS` in protected `.env`.
- Vercel adds `MOX_ADV_PRODUCTION_READ_JSON` and `BLOB_READ_WRITE_TOKEN`.

**P0 Worker:**
- Direct: `YANDEX_DIRECT_OAUTH_TOKEN`, `YANDEX_DIRECT_CLIENT_LOGIN`, campaign/currency/VAT and optional comparable-keyword bindings.
- Metrika: `YANDEX_METRICA_OAUTH_TOKEN`, `YANDEX_METRICA_COUNTER_ID`, `YANDEX_METRICA_GOAL_ID`.
- Wordstat: `YANDEX_WORDSTAT_OAUTH_TOKEN`, `YANDEX_WORDSTAT_CLIENT_ID`, region IDs/names, and device.
- Controlled E2E: `P0_E2E_FIXTURE_SCENARIO` only on localhost.

## Webhooks & Callbacks

**Incoming:**
- No third-party webhook receiver is implemented.
- Root JSON routes are served by `src/mox_adv/ui_server.py`; the P0 contract is exposed only through `GET/POST /api/p0` in `sites/p0-production/app/api/p0/route.ts`.
- GPT Sites sign-in/sign-out/callback paths are platform-managed and guarded by `app/chatgpt-auth.ts`.

**Outgoing:**
- Yandex API reads/writes, bounded first-party research, Cloudflare DNS-over-HTTPS, Vercel Blob state operations, and the optional localhost.run SSH tunnel are the external egress surfaces.
- Root fixture, standard test, and deterministic P0 E2E paths use local fixtures/fakes and explicitly block unrelated network access.

---

*Integration audit: 2026-08-22*
*Update when endpoints, credentials, storage, or deployment surfaces change*

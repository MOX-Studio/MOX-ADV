# Testing Patterns

**Analysis Date:** 2026-08-22

## Test Frameworks

**Root runner:**
- Python standard-library `unittest` with discovery from `tests/`.
- No pytest dependency or committed pytest configuration is required by the documented suite.
- 32 tracked `test*.py` files contain 55 `unittest.TestCase` classes and approximately 376 test methods.

**P0 contract runner:**
- Node's built-in `node:test` with `node:assert/strict`.
- 27 `sites/p0-production/tests/*.test.mjs` files contain approximately 199 top-level tests.
- Tests import TypeScript source directly through the P0 build/test runtime.

**Browser runner:**
- Playwright Python `>=1.48,<2` from `requirements-e2e.txt`.
- Browser tests use Chromium and a fixed `1920×1080` viewport.

## Run Commands

```bash
PYTHONPATH=src python3 -m unittest discover -s tests
# Complete root standard-library suite

PYTHONPATH=src python3 -m unittest tests.test_yandex_read
# One root module

MOX_ADV_RUN_DOCKER_TESTS=1 PYTHONPATH=src python3 -m unittest tests.test_docker_boundary
# Opt-in real Docker boundary test

python3 -m pip install --requirement requirements-e2e.txt
python3 -m playwright install chromium
# Browser prerequisites

PYTHONPATH=src:. python3 -m mox_adv.cli readonly-e2e --run-id <unique-id> --runs-dir runs
# Final sealed-write E2E evidence run

cd sites/p0-production && npm run lint
# P0 lint

cd sites/p0-production && npm run test:contract
# P0 build plus all Node contract tests

cd sites/p0-production && npm run test:e2e
# P0 Python Playwright acceptance

cd sites/p0-production && npm test
# Full P0 contract + E2E suite
```

## Test File Organization

**Python unit/integration:**
```text
tests/
├── test_bootstrap_run.py
├── test_yandex_read.py
├── test_approval_execution.py
├── test_bounded_autonomy.py
├── test_campaign_lifecycle.py
├── test_ui_*.py
└── e2e/
    ├── test_final_e2e_evidence.py
    ├── test_p0_production_candidate.py
    ├── test_ui_browser.py
    └── test_vercel_runtime_browser.py
```

**P0 Node contracts:**
```text
sites/p0-production/tests/
├── p0-application-contract.test.mjs
├── direct-write.test.mjs
├── execution-safety.test.mjs
├── analytics-evidence.test.mjs
├── campaign-viability.test.mjs
├── rendered-html.test.mjs
└── fixtures/
```

**Shared fixtures:**
- Root closed-schema input lives under `fixtures/`, grouped by impact, LLM decision, security, and UI concern.
- P0 provider/evidence goldens live under `sites/p0-production/tests/fixtures/`.
- Browser tests create isolated temporary application copies and state directories.

## Python Test Structure

```python
class FixtureRunTests(unittest.TestCase):
    def test_success_creates_required_versioned_artifacts_without_network(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            with mock.patch.object(socket, "socket", side_effect=AssertionError("network access is forbidden")):
                outcome = run_fixture(...)

            self.assertEqual(0, outcome.exit_code)
            self.assertFalse(result["external_write_sent"])
```

**Patterns:**
- Arrange data with temporary directories and local fixtures.
- Inject clocks, authenticators, HTTP clients, adapters, and durable store paths.
- Use exact state/artifact assertions rather than snapshots.
- Use `self.subTest(...)` for table-driven boundary matrices.
- Verify both returned values and persisted SQLite/JSON/JSONL/HTML state.
- Check that error messages and artifacts exclude canary credentials and tracebacks.

## P0 Node Test Structure

```javascript
import assert from "node:assert/strict";
import test from "node:test";

class JsonDurableStore {
  // Minimal compare-and-swap store used by application-contract tests.
}

test("...", async () => {
  const application = new P0Application({ store, adapters });
  const result = await application.command(key, command);
  assert.equal(result.revision, expectedRevision);
});
```

**Patterns:**
- Build small in-memory/file-backed adapter doubles at the test boundary.
- Preserve provider-shaped response fixtures for Direct/Metrika/Wordstat behavior.
- Recompute canonical hashes in tests when verifying tamper detection.
- Exercise stale revisions, migrations, fail-closed unknown schemas, moderation, correction, and independent package items.
- Test presentation helpers separately from the authoritative application contract.

## Mocking and Isolation

**Python:**
- `unittest.mock.patch` replaces sockets, subprocesses, clocks, filesystem roots, HTTP clients, and credentials.
- `RecordingHttpClient`-style fakes capture exact method/URL/header/body calls without external egress.
- Tests patch `socket.create_connection`/`socket.socket` or browser routing to prove no network access.
- Keychain and Docker tests inject fake commands and never read real credentials.

**P0:**
- Application tests inject `P0ApplicationAdapters` and a durable-store fake.
- Direct tests inject a `fetcher` that returns official-shape responses and records every call.
- Local P0 E2E runs only when `P0_E2E_FIXTURE_SCENARIO` passes the localhost boundary.
- Production `YANDEX_*` environment variables are removed from the E2E child process.

**Do not mock:**
- Canonicalization, schema validation, decision rules, hash/fingerprint calculations, and state transitions should run for real.
- Browser E2E must use the visible UI, not direct application API/state calls.

## Browser E2E

- `tests/e2e/test_p0_production_candidate.py` starts an isolated vinext dev server on loopback, drives all five P0 steps, and checks stale-tab CAS, Draft edits, package authority, moderation, correction, and acceptance evidence.
- Root Dashboard tests use Playwright against `127.0.0.1`, semantic labels/roles, and locally intercepted Yandex Metrika events.
- Every browser suite records console errors, page errors, nonlocal requests, and horizontal overflow.
- The prototype acceptance viewport is exactly 1920×1080; other responsive sizes are outside the current prototype scope.

## Security and Safety Assertions

- Fixture writes are fake/local and external socket creation is denied.
- Root Yandex transport tests permit only three exact read operations and reject method/path/profile drift before HTTP.
- Secrets are represented by canaries and asserted absent from transport records, exceptions, reports, and audit artifacts.
- Audit tests mutate/delete SQLite events to prove chain verification catches tampering.
- P0 Direct tests require explicit suspension and semantic readback and assert that `Campaigns.resume` is never called.
- Unknown/ambiguous provider outcomes remain pending reconciliation and are not retried blindly.
- E2E acceptance confirms visible fixture banners so controlled evidence cannot be confused with live production.

## Coverage

**Requirements:**
- No numeric line/branch coverage target is committed.
- No coverage report command appears in the root or P0 package scripts.
- Quality is enforced through broad boundary matrices, goldens, browser acceptance, and explicit negative assertions rather than a percentage gate.

**CI status:**
- The only committed GitHub Actions workflow deploys the static Dashboard demo.
- Root/P0 test and lint commands are documented and runnable locally, but no repository CI workflow currently executes them on pushes or pull requests.

## Fixtures and Golden Updates

- Use a unique run ID because immutable runs are single-use.
- Keep fixture objects closed-schema and bounded; do not add arbitrary fields for test convenience.
- `sites/p0-production/tests/fixtures/production-candidate-acceptance.json` is the checked-in P0 acceptance golden.
- Set `UPDATE_P0_E2E_ACCEPTANCE=1` only for an intentional acceptance of changed lineage/provider journal output.
- Never place real OAuth tokens, account secrets, or browser-cabinet exports in fixtures.

---

*Testing analysis: 2026-08-22*
*Update when runners, CI gates, viewport, or acceptance contracts change*

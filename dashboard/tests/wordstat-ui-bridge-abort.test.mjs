import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { createWordstatUiBridge } from "../scripts/wordstat-ui-bridge.mjs";
import { collectAndSaveWordstatBatch } from "../scripts/wordstat-ui-collector.mjs";

const planInput = {
  seeds: [{ seed_id: "seed-1", exact_query: "промышленная выставка", operator_profile: "BROAD_CONTAINING" }],
  surfaces: ["TOP_POPULAR", "TOP_SIMILAR"],
  scope: {
    regions: [{ provider_id: 213, label: "Москва" }], device: "ALL",
    dynamics: { granularity: "MONTH", from_date: "2025-01-01", to_date: "2025-12-31" },
  },
};

function completeSurface({ seed, surface }) {
  const rows = [{ rank: 1, phrase: surface === "TOP_POPULAR" ? "промышленная выставка" : "участие в выставке", count: 25 }];
  const headers = ["rank", "phrase", "count"];
  return {
    state: "COMPLETE", observed_at: "2026-09-05T10:00:00.000Z", confirmed_query: seed.exact_query,
    scope: { provider_region_ids: [213], region_labels: ["Москва"], device: "ALL", declared_window: "Последние 30 дней", from_date: null, to_date: null, granularity: null },
    official_csv: { headers, rows },
    dom: { headers, rows, displayed_row_count: 1, explicit_empty_state: false, stable: true },
  };
}

test("disconnected bridge caller cancels only its collection and keeps admission locked until owned cleanup completes", { timeout: 3_000 }, async (t) => {
  let readStarted;
  const inFlightRead = new Promise((resolve) => { readStarted = resolve; });
  let cleanupStarted;
  const cleanupEntered = new Promise((resolve) => { cleanupStarted = resolve; });
  let releaseCleanup;
  const cleanupMayFinish = new Promise((resolve) => { releaseCleanup = resolve; });
  let firstSaved;
  const firstBatchSaved = new Promise((resolve) => { firstSaved = resolve; });
  const batches = [];
  const signals = [];
  const cleanedRuns = [];
  const reads = [];
  const server = createWordstatUiBridge({
    bridgeToken: "fixture-token",
    collectPlan: async ({ plan, runId, signal }) => {
      signals.push(signal);
      let clock = 0;
      return collectAndSaveWordstatBatch({
        plan, runId, signal, source: "TEST_FIXTURE", collectorVersion: "fixture-collector-v1", uiParserVersion: "fixture-parser-v1",
        now: () => "2026-09-05T10:00:00.000Z", clock: () => clock, wait: async (milliseconds) => { clock += milliseconds; },
        driver: {
          async readSurface(input) {
            reads.push(`${runId}:${input.surface}`);
            if (runId === "disconnected-run" && input.surface === "TOP_SIMILAR") {
              readStarted();
              return new Promise(() => {});
            }
            return completeSurface(input);
          },
          async cleanup() {
            if (runId === "disconnected-run") {
              cleanupStarted();
              await cleanupMayFinish;
            }
            cleanedRuns.push(runId);
            return { cleanup_status: "COMPLETE" };
          },
        },
        artifactStore: {
          async saveCsv() {},
          async saveBatch(batch) {
            batches.push(structuredClone(batch));
            if (runId === "disconnected-run") firstSaved();
          },
        },
      });
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    releaseCleanup();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const endpoint = `http://127.0.0.1:${server.address().port}/collect`;
  const request = (runId, signal) => fetch(endpoint, {
    method: "POST", signal,
    headers: { authorization: "Bearer fixture-token", "content-type": "application/json" },
    body: JSON.stringify({ run_id: runId, plan_input: planInput }),
  });
  const disconnected = new AbortController();
  const pending = request("disconnected-run", disconnected.signal).catch((error) => error);
  await inFlightRead;
  const blocked = await request("blocked-run");
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).code, "PROFILE_CLONE_BUSY");
  assert.equal(signals[0].aborted, false);

  disconnected.abort();
  await cleanupEntered;
  assert.equal((await pending).name, "AbortError");
  assert.equal(signals[0].aborted, true);
  assert.equal((await request("still-blocked-run")).status, 409);
  assert.deepEqual(cleanedRuns, []);
  releaseCleanup();
  await firstBatchSaved;

  const next = await request("next-run");
  assert.equal(next.status, 200);
  assert.equal((await next.json()).batch.status, "COMPLETE");
  assert.equal(signals.length, 2);
  assert.equal(signals[1].aborted, false);
  assert.deepEqual(cleanedRuns, ["disconnected-run", "next-run"]);
  assert.deepEqual(reads, ["disconnected-run:TOP_POPULAR", "disconnected-run:TOP_SIMILAR", "next-run:TOP_POPULAR", "next-run:TOP_SIMILAR"]);
  assert.equal(batches[0].status, "UNAVAILABLE");
  assert.equal(batches[0].cleanup_status, "COMPLETE");
  assert.equal(batches[0].failures.at(-1).code, "STOPPED");
  assert.equal(batches[0].observations.length, 1);
  assert.deepEqual(batches[0].observations[0].rows, [{ rank: 1, phrase: "промышленная выставка", count: 25 }]);
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  WORDSTAT_SURFACES,
  WordstatCollectionError,
  assertWordstatBatchEligibleForProductionSnapshot,
  buildWordstatCollectionPlan,
  collectAndSaveWordstatBatch,
  createWordstatFileArtifactStore,
  projectWordstatBatchForDashboard,
} from "../scripts/wordstat-ui-collector.mjs";

function planWithSeeds(count = 1) {
  return buildWordstatCollectionPlan({
    seeds: Array.from({ length: count }, (_, index) => ({
      seed_id: `seed-${index + 1}`,
      exact_query: index === 0 ? '  "!виброизоляция пола"  ' : `+формулировка +${index + 1}`,
      operator_profile: index === 0 ? "FIXED_ORDER_FORM" : "BROAD_CONTAINING",
    })),
    scope: {
      regions: [{ provider_id: 213, label: "Москва" }],
      device: "ALL",
      dynamics: { granularity: "MONTH", from_date: "2025-01-01", to_date: "2025-12-31" },
    },
  });
}

const rowsBySurface = {
  TOP_POPULAR: [{ rank: 1, phrase: "виброизоляция пола", count: 120 }],
  TOP_SIMILAR: [{ rank: 1, phrase: "шумоизоляция пола", count: 80 }],
  DYNAMICS: [{ period_start: "2025-01-01", count: 100, share: 0.25 }],
  REGIONS: [{ provider_region_id: 213, region_label: "Москва", count: 75, share: 0.2, affinity_index: 132.5 }],
};

const headersBySurface = {
  TOP_POPULAR: ["rank", "phrase", "count"],
  TOP_SIMILAR: ["rank", "phrase", "count"],
  DYNAMICS: ["period_start", "count", "share"],
  REGIONS: ["provider_region_id", "region_label", "count", "share", "affinity_index"],
};

function completeResult({ seed, surface, rows = rowsBySurface[surface], observedAt = "2026-09-01T10:00:00.000Z" }) {
  return {
    state: "COMPLETE",
    observed_at: observedAt,
    confirmed_query: seed.exact_query,
    scope: {
      provider_region_ids: [213],
      region_labels: ["Москва"],
      device: "ALL",
      declared_window: surface === "DYNAMICS" ? "2025-01-01/2025-12-31" : "last_30_days",
      from_date: surface === "DYNAMICS" ? "2025-01-01" : null,
      to_date: surface === "DYNAMICS" ? "2025-12-31" : null,
      granularity: surface === "DYNAMICS" ? "MONTH" : null,
    },
    official_csv: { headers: headersBySurface[surface], rows },
    dom: {
      headers: headersBySurface[surface],
      rows,
      displayed_row_count: rows.length,
      explicit_empty_state: rows.length === 0,
      stable: true,
    },
    // Raw browser material may be present inside the driver, but the collector
    // deliberately never projects or persists it.
    cookie: "must-not-leave-driver",
    html: "<main>must-not-leave-driver</main>",
    har: { secret: true },
  };
}

function memoryStore(events = []) {
  return {
    csv: [],
    batches: [],
    async saveCsv(value) {
      events.push(`save-csv:${value.surface}`);
      this.csv.push(structuredClone(value));
      return `protected:${value.digest}`;
    },
    async saveBatch(value) {
      events.push("save-batch");
      this.batches.push(structuredClone(value));
      return "protected:batch";
    },
  };
}

function deterministicRuntime() {
  let milliseconds = 0;
  let timestamp = 0;
  const waits = [];
  return {
    waits,
    clock: () => milliseconds,
    wait: async (delay) => {
      waits.push(delay);
      milliseconds += delay;
    },
    now: () => `2026-09-01T10:00:${String(timestamp++).padStart(2, "0")}.000Z`,
  };
}

async function collect({ plan = planWithSeeds(), readSurface, cleanup, store = memoryStore(), events = [] } = {}) {
  const runtime = deterministicRuntime();
  const calls = [];
  const batch = await collectAndSaveWordstatBatch({
    plan,
    source: "TEST_FIXTURE",
    runId: "wordstat-run-1",
    collectorVersion: "wordstat-ui-collector/1.0",
    uiParserVersion: "wordstat-ui-parser/1.0",
    now: runtime.now,
    clock: runtime.clock,
    wait: runtime.wait,
    driver: {
      async readSurface(value) {
        calls.push({ seed: value.seed.seed_id, surface: value.surface, attempt: value.attempt, at: runtime.clock() });
        return readSurface ? readSurface(value) : completeResult(value);
      },
      async cleanup() {
        events.push("cleanup");
        return cleanup ? cleanup() : { cleanup_status: "COMPLETE" };
      },
    },
    artifactStore: store,
  });
  return { batch, calls, waits: runtime.waits, store };
}

test("freezes no more than eight exact formulations and detects plan mutation", async () => {
  const plan = planWithSeeds(8);

  assert.equal(plan.schema_version, "wordstat-ui-collection-plan-v1");
  assert.equal(plan.seeds.length, 8);
  assert.equal(plan.seeds[0].exact_query, '  "!виброизоляция пола"  ');
  assert.equal(plan.seeds[0].normalized_query, '"!виброизоляция пола"');
  assert.deepEqual(plan.surfaces, ["TOP_POPULAR", "TOP_SIMILAR", "DYNAMICS", "REGIONS"]);
  assert.deepEqual(plan.limits, { maximum_seeds: 8, parallel_queries: 1 });
  assert.match(plan.plan_digest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(plan), true);
  assert.throws(() => planWithSeeds(9), (error) => error instanceof WordstatCollectionError && error.code === "PLAN_LIMIT_EXCEEDED");

  const changed = structuredClone(plan);
  changed.seeds[0].exact_query = "changed after browser opening";
  await assert.rejects(collectAndSaveWordstatBatch({ plan: changed }), (error) => error.code === "PLAN_INVALID");
});

test("collects every surface sequentially with at least three seconds between reads and saves only sanitized evidence", async () => {
  const plan = planWithSeeds(2);
  const events = [];
  const store = memoryStore(events);
  const result = await collect({ plan, store, events });

  assert.equal(result.batch.status, "COMPLETE");
  assert.equal(result.batch.cleanup_status, "COMPLETE");
  assert.equal(result.batch.schema_version, "wordstat-ui-observation-batch-v1");
  assert.equal(result.batch.source, "TEST_FIXTURE");
  assert.equal(result.batch.transport, "HEADLESS_PLAYWRIGHT");
  assert.deepEqual(result.calls.map(({ seed, surface }) => `${seed}:${surface}`), [
    ...WORDSTAT_SURFACES.map((surface) => `seed-1:${surface}`),
    ...WORDSTAT_SURFACES.map((surface) => `seed-2:${surface}`),
  ]);
  assert.equal(result.calls.every((call, index) => index === 0 || call.at - result.calls[index - 1].at >= 3_000), true);
  assert.equal(result.batch.observations.length, 8);
  assert.equal(store.csv.length, 8);
  assert.equal(store.batches.length, 1);
  assert.equal(events.at(-2), "cleanup");
  assert.equal(events.at(-1), "save-batch");
  assert.match(store.csv[0].csv, /^rank,phrase,count\n/u);
  assert.equal(store.csv[0].csv.includes("must-not-leave-driver"), false);
  const serialized = JSON.stringify(result.batch);
  assert.doesNotMatch(serialized, /must-not-leave-driver|<main>|"(?:cookie|html|har|trace|video|screenshot)"\s*:/iu);
  assert.ok(result.batch.observations.every((item) => item.protected_artifact_ref.startsWith("wordstat-csv:sha256:")));
});

test("keeps an explicit empty surface complete without representing missing demand as zero", async () => {
  const result = await collect({
    readSurface: (value) => value.surface === "TOP_POPULAR"
      ? completeResult({ ...value, rows: [] })
      : completeResult(value),
  });

  assert.equal(result.batch.status, "COMPLETE");
  const empty = result.batch.observations.find((item) => item.surface === "TOP_POPULAR");
  assert.equal(empty.explicit_empty_state, true);
  assert.equal(empty.result_state, "NO_ROWS_RETURNED");
  assert.deepEqual(empty.rows, []);
  assert.match(empty.limitations.join(" "), /UNKNOWN.*not zero demand/iu);
  assert.equal(Object.hasOwn(empty, "frequency"), false);
});

test("classifies CSV or DOM contract drift as DOM_CHANGED without a fallback or retry", async () => {
  const store = memoryStore();
  const result = await collect({
    store,
    readSurface: (value) => {
      const loaded = completeResult(value);
      loaded.official_csv.headers = ["changed", "headers"];
      return loaded;
    },
  });

  assert.equal(result.batch.status, "DOM_CHANGED");
  assert.equal(result.batch.observations.length, 0);
  assert.equal(result.calls.length, 1);
  assert.equal(result.batch.failures[0].code, "CSV_SCHEMA_CHANGED");
  assert.equal(store.csv.length, 0);
});

test("retries only a transient affected surface and returns PARTIAL instead of a false zero", async () => {
  const result = await collect({
    readSurface: (value) => value.surface === "TOP_SIMILAR"
      ? { state: "UNAVAILABLE", failure_code: "LOAD_TIMEOUT" }
      : completeResult(value),
  });

  assert.equal(result.batch.status, "PARTIAL");
  assert.equal(result.calls.filter((call) => call.surface === "TOP_SIMILAR").length, 3);
  assert.deepEqual(result.batch.failures.filter((failure) => failure.code === "LOAD_TIMEOUT").map((failure) => failure.attempt), [1, 2, 3]);
  assert.ok(result.waits.includes(10_000));
  assert.ok(result.waits.includes(30_000));
  assert.equal(result.batch.observations.some((item) => item.surface === "TOP_SIMILAR"), false);
  assert.equal(JSON.stringify(result.batch).includes('"count":0'), false);
});

for (const terminalState of ["AUTH_REQUIRED", "CAPTCHA_OR_CHALLENGE"]) {
  test(`${terminalState} stops the whole plan and is never retried automatically`, async () => {
    const result = await collect({
      plan: planWithSeeds(2),
      readSurface: () => ({ state: terminalState, failure_code: terminalState }),
    });

    assert.equal(result.batch.status, terminalState);
    assert.equal(result.calls.length, 1);
    assert.equal(result.batch.failures.length, 1);
    assert.equal(result.batch.observations.length, 0);
    const projection = projectWordstatBatchForDashboard(result.batch);
    assert.ok(projection.human_action);
    assert.doesNotMatch(JSON.stringify(projection), /provider_region_id|protected_artifact|"(?:cookie|html|har|trace|video|screenshot)"\s*:/iu);
  });
}

test("stop and explicit access block terminate collection immediately and still clean up", async () => {
  for (const code of ["STOPPED", "EXPLICIT_ACCESS_BLOCK"]) {
    const result = await collect({
      plan: planWithSeeds(2),
      readSurface: () => ({ state: "UNAVAILABLE", failure_code: code }),
    });

    assert.equal(result.batch.status, "UNAVAILABLE");
    assert.equal(result.batch.cleanup_status, "COMPLETE");
    assert.equal(result.calls.length, 1);
    assert.equal(result.batch.failures[0].code, code);
  }
});

test("controlled fixture evidence cannot enter a production Analytics Evidence Snapshot", async () => {
  const result = await collect();
  assert.throws(
    () => assertWordstatBatchEligibleForProductionSnapshot(result.batch),
    (error) => error instanceof WordstatCollectionError && error.code === "PRODUCTION_SNAPSHOT_FORBIDDEN",
  );

  const production = structuredClone(result.batch);
  production.source = "YANDEX_WORDSTAT_UI";
  assert.equal(assertWordstatBatchEligibleForProductionSnapshot(production), production);
});

test("cleanup failure overrides collected rows and blocks COMPLETE", async () => {
  const result = await collect({ cleanup: () => ({ cleanup_status: "FAILED" }) });

  assert.equal(result.batch.status, "UNAVAILABLE");
  assert.equal(result.batch.cleanup_status, "FAILED");
  assert.equal(result.batch.failures.at(-1).code, "CLEANUP_FAILED");
  assert.equal(result.store.batches.length, 1);
});

test("writes regenerated CSV and batch JSON to a private store outside the repository", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mox-wordstat-artifacts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = await createWordstatFileArtifactStore({ root, repositoryRoot: process.cwd() });
  const result = await collect({ store });

  const csvFiles = await readdir(join(root, "csv"));
  const batchFiles = await readdir(join(root, "batches"));
  assert.equal(csvFiles.length, 4);
  assert.equal(batchFiles.length, 1);
  assert.equal((await stat(root)).mode & 0o777, 0o700);
  assert.equal((await stat(join(root, "csv", csvFiles[0]))).mode & 0o777, 0o600);
  assert.match(await readFile(join(root, "csv", csvFiles[0]), "utf8"), /^(rank,phrase,count|period_start,count,share|provider_region_id,region_label,count,share,affinity_index)\n/u);
  const persisted = JSON.parse(await readFile(join(root, "batches", batchFiles[0]), "utf8"));
  assert.equal(persisted.status, "COMPLETE");
  assert.equal(persisted.cleanup_status, "COMPLETE");
  assert.equal(result.batch.protected_batch_ref.startsWith("wordstat-batch:sha256:"), true);

  await assert.rejects(
    createWordstatFileArtifactStore({ root: join(process.cwd(), "unsafe-wordstat-artifacts"), repositoryRoot: process.cwd() }),
    (error) => error instanceof WordstatCollectionError && error.code === "ARTIFACT_LOCATION_UNSAFE",
  );
});

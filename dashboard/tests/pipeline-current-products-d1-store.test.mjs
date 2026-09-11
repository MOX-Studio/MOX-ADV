import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { randomBytes } from "node:crypto";

import { D1PipelineCurrentProductStore } from "../lib/pipeline-current-products-d1-store.ts";
import { resolvePriorStrategyInput, saveVerifiedPipelineProduct } from "../lib/pipeline-current-products.ts";
import { pipelineDigest } from "../lib/pipeline-orchestrator.ts";
import { createEvidenceReuseHarness } from "./fixtures/pipeline-evidence-reuse-fixture.mjs";
import { loadPipelineValue } from "../lib/pipeline-value-chunks.ts";

function d1Shim(database, { includeTriggerChanges = false, maximumBoundBytes = Infinity } = {}) {
  const wrap = (statement, values = []) => ({
    bind(...nextValues) {
      if (nextValues.some(value => typeof value === "string" && Buffer.byteLength(value) > maximumBoundBytes)) throw new Error("SQLITE_TOOBIG: single bound value exceeds row limit");
      return wrap(statement, nextValues);
    },
    async run() {
      const result = statement.run(...values);
      const changes = Number(result.changes);
      return { meta: { changes: changes > 0 && includeTriggerChanges ? changes + 1 : changes } };
    },
    async first() {
      return statement.get(...values) ?? null;
    },
    async all() {
      return { results: statement.all(...values) };
    },
  });
  return {
    prepare(sql) {
      return wrap(database.prepare(sql));
    },
  };
}

test("large source corpora round-trip across D1 row limits, history and CAS without truncation", async () => {
  const database = new DatabaseSync(":memory:"), db = d1Shim(database, { maximumBoundBytes: 900_000 });
  const store = new D1PipelineCurrentProductStore(db), current = currentProducts(0);
  current.current_stage = "EVIDENCE_COLLECTION";
  current.analytics_evidence_snapshot = { snapshot_id: "isolated-large-source", full_source: randomBytes(1_200_000).toString("hex") };
  assert.equal(await store.compareAndSwap("owner", null, current), true);
  const stored = database.prepare("SELECT value_json FROM p0_pipeline_current_products").get().value_json;
  assert.match(stored, /^p0:chunks:v1:/);
  assert.deepEqual(await new D1PipelineCurrentProductStore(db).loadCurrent("owner"), current);
  assert.deepEqual(await store.loadEvidenceCandidates("owner"), [current]);
  assert.equal(await store.compareAndSwap("owner", null, current), false);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM p0_pipeline_product_revisions").get().n, 1);
  assert.throws(() => database.prepare("UPDATE p0_pipeline_value_chunks SET value = 'tampered'").run(), /immutable/);
  const broken = JSON.parse(stored.slice("p0:chunks:v1:".length)); broken.digest = "0".repeat(64);
  await assert.rejects(loadPipelineValue(db, `p0:chunks:v1:${JSON.stringify(broken)}`), /incomplete/);
  const corruptRead = { prepare() { return { bind() { return { async all() {
    const rows = database.prepare("SELECT part, value FROM p0_pipeline_value_chunks ORDER BY part").all();
    rows[0].value = "X" + rows[0].value.slice(1); return { results: rows };
  } }; } }; } };
  await assert.rejects(loadPipelineValue(corruptRead, stored), /integrity/);
  database.close();
});

function currentProducts(stateRevision, runVersion = stateRevision) {
  return {
    schema_version: "p0-pipeline-current-products-v1",
    owner_key: "owner",
    state_revision: stateRevision,
    run_id: "pipeline-run-1",
    run_version: runVersion,
    current_stage: "CAMPAIGN_GOAL",
    updated_at: `2026-09-01T10:00:0${Math.min(stateRevision, 9)}.000Z`,
    historical_source: {
      kind: "HISTORICAL_DOCUMENT",
      revision_id: "historical-document:67",
      content_digest: `sha256:${"a".repeat(64)}`,
    },
    goal_revision: null,
    analytics_evidence_snapshot: null,
    campaign_strategy: null,
    campaign_pairs: [],
    campaign_pair_checks: { schema_version: "campaign-pair-validation-v1", status: "PASSED", checks: [] },
    campaign_playbook: {
      kind: "CAMPAIGN_PLAYBOOK",
      revision_id: "playbook-release:test:1.0.0",
      content_digest: `sha256:${"b".repeat(64)}`,
    },
    publication_review: null,
    authority: {
      external_write: "DENIED",
      publication: "NOT_AUTHORIZED",
      impressions: 0,
      spend_micros: 0,
    },
  };
}

test("D1 current-product CAS appends history only after a successful current-row mutation", async () => {
  const database = new DatabaseSync(":memory:");
  // Production D1 can include the successful history-trigger INSERT in meta.changes.
  const store = new D1PipelineCurrentProductStore(d1Shim(database, { includeTriggerChanges: true }));

  assert.equal(await store.compareAndSwap("owner", null, currentProducts(0)), true);
  assert.equal(await store.compareAndSwap("owner", 0, currentProducts(1)), true);

  // A forged high expected revision must not poison a future immutable revision slot.
  assert.equal(await store.compareAndSwap("owner", 5, currentProducts(6)), false);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM p0_pipeline_product_revisions WHERE owner_key = ? AND state_revision = ?").get("owner", 6).count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM p0_pipeline_product_revisions WHERE owner_key = ?").get("owner").count, 2);

  assert.equal((await store.loadCurrent("owner")).state_revision, 1);
  assert.throws(
    () => database.prepare("UPDATE p0_pipeline_product_revisions SET value_json = ? WHERE owner_key = ? AND state_revision = ?").run("tampered", "owner", 1),
    /pipeline product revisions are immutable/u,
  );

  database.close();
});

test("D1 immutable Evidence revisions recover a verified snapshot after the current pointer is cleared", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const store = new D1PipelineCurrentProductStore(d1Shim(database));
    const harness = await createEvidenceReuseHarness({ productStore: store });
    await harness.fullRun();
    const current = await store.loadCurrent("owner");
    const cleared = {
      ...structuredClone(current), state_revision: current.state_revision + 1,
      current_stage: "CAMPAIGN_GOAL", analytics_evidence_snapshot: null,
      evidence_interpretation: null, prior_verified_evidence: null,
    };
    assert.equal(await store.compareAndSwap("owner", current.state_revision, cleared), true);
    const candidates = await new D1PipelineCurrentProductStore(d1Shim(database)).loadEvidenceCandidates("owner");
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].analytics_evidence_snapshot.snapshot_id, harness.snapshot.snapshot_id);
    const available = await harness.controller.evidenceReuse("owner", harness.view);
    assert.equal(available.available, true, available.reason);
    harness.failures.collection = true;
    await harness.regenerate();
    assert.equal(harness.calls.collection, 1);
    assert.equal((await store.loadCurrent("owner")).analytics_evidence_snapshot.generated_at, harness.snapshot.generated_at);
  } finally { database.close(); }
});

test("D1 persists a separate prior Strategy input through Goal and Evidence replacement and restores it after restart", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const binding = d1Shim(database);
    const store = new D1PipelineCurrentProductStore(binding);
    const current = currentProducts(0);
    current.campaign_strategy = {
      schema_version: "p0-strategy-stage-product-v1",
      strategy: { strategy_revision_id: "owner-corrected-strategy", dimensions: [{ dimension_id: "weekly_budget", value: 90_000 }] },
      inputs: { business_input: { content: { owner_strategy_correction: { precedence: "PRIORITY_BUSINESS_INPUT", changes: { exclusions: "Посетители без заявки" } } } } },
    };
    await store.compareAndSwap("owner", null, current);
    const run = {
      owner_key: "owner", run_id: "next-run", version: 1,
      goal_formation: { status: "PENDING" },
      input_versions: { historical_document: current.historical_source, campaign_pair_checks: current.campaign_pair_checks, campaign_playbook: current.campaign_playbook },
    };
    await saveVerifiedPipelineProduct({ store, run, product: { stage: "CAMPAIGN_GOAL", value: { desired_outcome: "Qualified leads" } }, recordedAt: "2026-09-05T10:00:00.000Z" });
    const restartedStore = new D1PipelineCurrentProductStore(binding);
    const afterGoal = await restartedStore.loadCurrent("owner");
    assert.equal(afterGoal.campaign_strategy, null);
    assert.deepEqual(afterGoal.prior_strategy_input.artifact, current.campaign_strategy);
    assert.equal(afterGoal.prior_strategy_input.reference.digest, await pipelineDigest(current.campaign_strategy));
    assert.equal(afterGoal.prior_strategy_input.source_run_id, current.run_id);
    await saveVerifiedPipelineProduct({ store: restartedStore, run: { ...run, version: 2 }, product: { stage: "EVIDENCE_COLLECTION", value: { schema_version: "evidence-v1", snapshot_id: "fresh-evidence" } }, recordedAt: "2026-09-05T10:00:01.000Z" });
    const afterEvidence = await new D1PipelineCurrentProductStore(binding).loadCurrent("owner");
    assert.equal(afterEvidence.campaign_strategy, null);
    assert.deepEqual(await resolvePriorStrategyInput(afterEvidence), afterGoal.prior_strategy_input);
    const corrupted = structuredClone(afterEvidence);
    corrupted.prior_strategy_input.artifact.strategy.dimensions[0].value = 1;
    await assert.rejects(resolvePriorStrategyInput(corrupted), /immutable artifact reference/u);
  } finally { database.close(); }
});

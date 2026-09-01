import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { D1PipelineCurrentProductStore } from "../lib/pipeline-current-products-d1-store.ts";

function d1Shim(database, { includeTriggerChanges = false } = {}) {
  const wrap = (statement, values = []) => ({
    bind(...nextValues) {
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
  });
  return {
    prepare(sql) {
      return wrap(database.prepare(sql));
    },
  };
}

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

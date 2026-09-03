import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  PipelineLegacyMigrationError,
  archiveLegacyPipelineDocument,
} from "../lib/pipeline-legacy-migration.ts";

function d1Shim(database) {
  const wrap = (statement, values = []) => ({
    bind(...nextValues) {
      return wrap(statement, nextValues);
    },
    async run() {
      const result = statement.run(...values);
      return { meta: { changes: Number(result.changes) } };
    },
    async first() {
      return statement.get(...values) ?? null;
    },
  });
  return { prepare: (sql) => wrap(database.prepare(sql)) };
}

function databaseWith(valueJson) {
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE p0_state(user_key TEXT PRIMARY KEY, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, value_json TEXT NOT NULL)");
  database.prepare("INSERT INTO p0_state VALUES (?, ?, ?, ?)")
    .run("owner", 19, "2026-08-31T09:00:00.000Z", valueJson);
  return database;
}

function recoverableDocument() {
  return {
    schema_version: "p0-application-document-v19",
    business_model: { schema_version: "business-model-v2", product: "Стенд под ключ" },
    analytics_evidence_snapshot: {
      schema_version: "analytics-evidence-snapshot-v3",
      snapshot_id: "evidence-19",
    },
    strategy: {
      schema_version: "campaign-strategy-v4",
      strategy_revision_id: "strategy-19",
      analytics_evidence_snapshot_id: "evidence-19",
    },
    recommendation_set: {
      schema_version: "campaign-recommendation-set-v4",
      strategy_revision_id: "strategy-19",
      analytics_evidence_snapshot_id: "evidence-19",
      drafts: [{
        schema_version: "campaign-draft-v4",
        draft_id: "draft-1",
        draft_revision_id: "draft-1@2",
        strategy_revision_id: "strategy-19",
        variant: {
          hypothesis: {
            schema_version: "campaign-hypothesis-v1",
            hypothesis_id: "hypothesis-1@2",
            draft_revision_id: "draft-1@2",
          },
        },
        publish_projection: {
          lineage: {
            strategy_revision_id: "strategy-19",
            draft_id: "draft-1",
            draft_revision_id: "draft-1@2",
          },
        },
        viability_score: { score: 99, rank: 1 },
      }],
    },
    shortlist: { shortlist_revision_id: "shortlist-legacy" },
    package_review: { review_id: "package-legacy" },
    human_decision_gate: { gate_id: "gate-legacy" },
    package_execution: { execution_id: "write-legacy" },
  };
}

test("expand-contract archive preserves the exact legacy document without making package state current", async () => {
  const original = JSON.stringify(recoverableDocument());
  const database = databaseWith(original);
  const db = d1Shim(database);

  const view = await archiveLegacyPipelineDocument(db, "owner", "2026-08-31T10:00:00.000Z");

  assert.equal(view.revision, 19);
  assert.deepEqual(view.state, JSON.parse(original));
  assert.equal(database.prepare("SELECT value_json FROM p0_state WHERE user_key = 'owner'").get().value_json, original);
  const audit = database.prepare("SELECT * FROM p0_pipeline_legacy_audit WHERE owner_key = 'owner'").get();
  assert.equal(audit.value_json, original);
  assert.equal(audit.audit_schema, "p0-pipeline-legacy-audit-v1");
  assert.match(audit.source_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.throws(
    () => database.prepare("UPDATE p0_pipeline_legacy_audit SET value_json = '{}' WHERE owner_key = 'owner'").run(),
    /pipeline legacy audit is immutable/u,
  );
  assert.throws(
    () => database.prepare("DELETE FROM p0_pipeline_legacy_audit WHERE owner_key = 'owner'").run(),
    /pipeline legacy audit is immutable/u,
  );
  database.close();
});

test("unknown or incomplete lineage fails explicitly and is never rewritten into a fabricated migration", async () => {
  const incomplete = recoverableDocument();
  incomplete.recommendation_set.drafts[0].variant.hypothesis.draft_revision_id = "another-draft";
  const original = JSON.stringify(incomplete);
  const database = databaseWith(original);

  await assert.rejects(
    archiveLegacyPipelineDocument(d1Shim(database), "owner"),
    (error) => error instanceof PipelineLegacyMigrationError
      && error.code === "PIPELINE_LEGACY_LINEAGE_INVALID",
  );
  assert.equal(database.prepare("SELECT value_json FROM p0_state WHERE user_key = 'owner'").get().value_json, original);
  assert.equal(database.prepare("SELECT value_json FROM p0_pipeline_legacy_audit WHERE owner_key = 'owner'").get().value_json, original);
  database.close();

  const unknown = JSON.stringify({ schema_version: "p0-application-document-v999", strategy: {} });
  const unknownDatabase = databaseWith(unknown);
  await assert.rejects(
    archiveLegacyPipelineDocument(d1Shim(unknownDatabase), "owner"),
    (error) => error instanceof PipelineLegacyMigrationError
      && error.code === "PIPELINE_LEGACY_SCHEMA_UNSUPPORTED",
  );
  assert.equal(unknownDatabase.prepare("SELECT value_json FROM p0_pipeline_legacy_audit WHERE owner_key = 'owner'").get().value_json, unknown);
  unknownDatabase.close();
});

test("corrupt JSON is retained as exact audit bytes and rejected", async () => {
  const original = "{not-json";
  const database = databaseWith(original);

  await assert.rejects(
    archiveLegacyPipelineDocument(d1Shim(database), "owner"),
    (error) => error instanceof PipelineLegacyMigrationError
      && error.code === "PIPELINE_HISTORICAL_DOCUMENT_INVALID",
  );
  assert.equal(database.prepare("SELECT value_json FROM p0_state WHERE user_key = 'owner'").get().value_json, original);
  assert.equal(database.prepare("SELECT value_json FROM p0_pipeline_legacy_audit WHERE owner_key = 'owner'").get().value_json, original);
  database.close();
});

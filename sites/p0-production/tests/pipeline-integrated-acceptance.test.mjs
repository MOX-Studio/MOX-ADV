import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  completePipelineAcceptanceRun,
  pipelineAcceptanceHistoricalView,
} from "../lib/pipeline-acceptance-fixture.ts";
import { D1PipelineRunStore } from "../lib/pipeline-orchestrator-d1-store.ts";
import { PipelineOrchestrator } from "../lib/pipeline-orchestrator.ts";
import {
  OwnerPipelineController,
  pipelineInputVersions,
  projectOwnerPipeline,
} from "../lib/pipeline-owner-dashboard.ts";

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
    async all() {
      return { results: statement.all(...values) };
    },
  });
  return {
    prepare(sql) {
      return wrap(database.prepare(sql));
    },
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

test("controlled cold-start inputs traverse the durable five-stage orchestrator with autonomous correction and zero write authority", async () => {
  const database = new DatabaseSync(":memory:");
  const db = d1Shim(database);
  const store = new D1PipelineRunStore(db);
  const controller = new OwnerPipelineController(store, {
    newRunId: () => "pipeline-integrated-acceptance",
    now: (() => {
      let tick = 0;
      return () => new Date(Date.parse("2026-09-01T10:00:00.000Z") + tick++ * 1_000).toISOString();
    })(),
  });
  const historical = await pipelineAcceptanceHistoricalView();
  const versions = await pipelineInputVersions(historical);

  assert.equal(versions.campaign_pair_checks.set_disposition, "CURRENT_PAIRS_AVAILABLE");
  assert.equal(versions.campaign_pairs.length, 2);
  assert.equal(versions.campaign_pair_checks.pairs.length, 3);
  assert.equal(versions.campaign_pair_checks.pairs.filter((pair) => pair.included).length, 2);
  assert.equal(versions.campaign_pair_checks.pairs.find((pair) => !pair.included).violations.some((item) => item.code === "DRAFT_PROJECTION_PARTIAL"), true);
  const sources = historical.state.analytics_evidence_snapshot.sources;
  assert.deepEqual(
    sources.filter((source) => ["direct", "metrika", "financial"].includes(source.source_id)).map((source) => source.status),
    ["UNAVAILABLE", "UNAVAILABLE", "UNAVAILABLE"],
  );
  for (const value of historical.state.recommendation_set.drafts.slice(0, 2)) {
    const projection = value.publish_projection;
    assert.equal(projection.creation_profile.profile_id, "p0-campaign-creation-profile-v1");
    assert.equal(projection.creation_profile.endpoint_version, "v501");
    assert.equal(projection.direct.campaign.UnifiedCampaign.BiddingStrategy.Search.BiddingStrategyType, "WB_MAXIMUM_CLICKS");
    assert.equal(projection.direct.campaign.UnifiedCampaign.BiddingStrategy.Network.BiddingStrategyType, "SERVING_OFF");
    assert.equal(projection.safety.resume_allowed, false);
  }

  const started = await controller.start("owner", historical);
  assert.equal(started.currentStage, "goal");
  const completed = await completePipelineAcceptanceRun(db, "owner");
  const audit = await new PipelineOrchestrator({ store }).audit(completed.run_id);
  const projection = projectOwnerPipeline(completed);

  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.current_stage, "PUBLICATION_REVIEW");
  assert.equal(projection.currentStage, "review");
  assert.deepEqual(projection.stages.map((stage) => stage.status), ["Завершён", "Завершён", "Завершён", "Завершён", "Завершён"]);
  assert.equal(audit.filter((event) => event.event_kind === "ATTEMPT_DISCARDED").length, 1);
  assert.equal(audit.find((event) => event.event_kind === "ATTEMPT_DISCARDED").retry.next_attempt, 2);
  assert.equal(audit.at(-1).event_kind, "RUN_COMPLETED");
  assert.deepEqual(completed.authority, {
    external_write: "DENIED",
    external_write_operations: [],
    model: { state_write: false, transition: false, authority_grant: false, persistence: false, external_write: false },
  });
  assert.equal(JSON.stringify(completed).includes("APPROVED_FOR_PUBLICATION"), false);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM p0_pipeline_run_revisions").get().count, completed.version + 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM p0_pipeline_audit_events").get().count, completed.version + 1);
  database.close();
});

test("one shared mandatory gap cancels every new pair and produces one atomic request package", async () => {
  const versions = await pipelineInputVersions(await pipelineAcceptanceHistoricalView({ sharedMandatoryGap: true }));

  assert.equal(versions.campaign_pairs.length, 0);
  assert.equal(versions.campaign_pair_checks.set_disposition, "BLOCKED_SHARED_REQUIREMENT");
  assert.equal(versions.campaign_pair_checks.pairs.some((pair) => pair.included), false);
  assert.equal(versions.campaign_pair_checks.required_request_package.atomic, true);
  assert.deepEqual(
    versions.campaign_pair_checks.required_request_package.requests.map((request) => request.code),
    ["STRATEGY_CONTENT_INCOMPLETE"],
  );
});

test("stop, new run, and a saved owner correction create new identities and frozen input digests", async () => {
  const database = new DatabaseSync(":memory:");
  const db = d1Shim(database);
  const ids = ["pipeline-before-correction", "pipeline-after-correction"];
  const controller = new OwnerPipelineController(new D1PipelineRunStore(db), {
    newRunId: () => ids.shift(),
    now: () => "2026-09-01T12:00:00.000Z",
  });
  const before = await pipelineAcceptanceHistoricalView();
  const first = await controller.start("owner", before);
  const stopped = await controller.stop("owner", { runId: first.runId, expectedVersion: first.version });
  const after = await pipelineAcceptanceHistoricalView({ ownerGoal: "Получать квалифицированные заявки на переговоры" });
  const second = await controller.start("owner", after);

  assert.equal(stopped.status, "STOPPED");
  assert.notEqual(first.runId, second.runId);
  assert.notEqual(
    (await pipelineInputVersions(before)).business_input.digest,
    (await pipelineInputVersions(after)).business_input.digest,
  );
  const persisted = await new D1PipelineRunStore(db).load(second.runId);
  assert.equal(persisted.input_versions.business_input.digest, (await pipelineInputVersions(after)).business_input.digest);
  assert.equal((await new D1PipelineRunStore(db).load(first.runId)).status, "STOPPED");
  database.close();
});

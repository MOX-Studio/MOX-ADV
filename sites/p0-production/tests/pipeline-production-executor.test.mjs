import assert from "node:assert/strict";
import test from "node:test";

import {
  ProductionPipelineExecutionError,
  executeProductionPipeline,
} from "../lib/pipeline-production-executor.ts";
import {
  PIPELINE_INPUT_VERSIONS_SCHEMA,
  PipelineOrchestrator,
} from "../lib/pipeline-orchestrator.ts";

class MemoryPipelineStore {
  runs = new Map();
  auditEvents = new Map();
  order = [];

  async load(runId) {
    return this.runs.has(runId) ? structuredClone(this.runs.get(runId)) : null;
  }

  async loadCurrent(ownerKey) {
    const runId = [...this.order].reverse().find((candidate) => this.runs.get(candidate)?.owner_key === ownerKey);
    return runId ? this.load(runId) : null;
  }

  async loadActive(ownerKey) {
    const state = [...this.runs.values()].find((candidate) => candidate.owner_key === ownerKey && candidate.status === "ACTIVE");
    return state ? structuredClone(state) : null;
  }

  async loadAudit(runId) {
    return structuredClone(this.auditEvents.get(runId) ?? []);
  }

  async initialize(state, event) {
    if (this.runs.has(state.run_id) || await this.loadActive(state.owner_key)) return false;
    this.runs.set(state.run_id, structuredClone(state));
    this.auditEvents.set(state.run_id, [structuredClone(event)]);
    this.order.push(state.run_id);
    return true;
  }

  async compareAndSwap(runId, expectedVersion, state, event) {
    const current = this.runs.get(runId);
    if (!current || current.version !== expectedVersion) return false;
    this.runs.set(runId, structuredClone(state));
    this.auditEvents.set(runId, [...(this.auditEvents.get(runId) ?? []), structuredClone(event)]);
    return true;
  }
}

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}

function reference(name, character) {
  return {
    schema_version: `${name}-v1`,
    revision_id: `${name}-revision-1`,
    digest: digest(character),
  };
}

function inputVersions() {
  return {
    schema_version: PIPELINE_INPUT_VERSIONS_SCHEMA,
    historical_document: {
      schema_version: "p0-application-document-v19",
      revision: 42,
      digest: digest("a"),
    },
    business_input: reference("business-input", "b"),
    goal_revision: null,
    analytics_evidence_snapshot: reference("analytics-evidence-snapshot", "d"),
    campaign_strategy_revision: reference("campaign-strategy-revision", "e"),
    campaign_pairs: [{
      hypothesis: reference("campaign-hypothesis", "f"),
      draft: reference("campaign-draft", "0"),
    }],
    campaign_pair_checks: {
      schema_version: "campaign-pair-validation-v1",
      contract_version: "1.1.0",
      strategy_revision_id: "campaign-strategy-revision-1",
      evidence_snapshot_id: "analytics-evidence-snapshot-revision-1",
      field_registry_schema: "direct-v501-draft-field-registry-v2",
      set_disposition: "CURRENT_PAIRS_AVAILABLE",
      required_request_package: null,
      pairs: [{
        pair_id: "campaign-hypothesis-revision-1::campaign-draft-revision-1",
        hypothesis_revision_id: "campaign-hypothesis-revision-1",
        draft_id: "campaign-draft-1",
        draft_revision_id: "campaign-draft-revision-1",
        publish_fingerprint: digest("3"),
        included: true,
        violations: [],
      }],
    },
    pipeline_policy: reference("pipeline-policy", "1"),
    campaign_playbook: reference("campaign-playbook", "2"),
  };
}

function historicalView() {
  return {
    revision: 42,
    state: {
      schema_version: "p0-application-document-v19",
      context_state: {
        business_goal_decision: {
          value: "Получать квалифицированные заявки на участие со стендом",
          decision: "CORRECTED",
          owner_confirmed: true,
        },
      },
      business_model: {
        qualified_result: "Представитель промышленной компании подтвердил интерес и готов обсудить участие",
        exclusions: "Посетители без намерения подать коммерческую заявку",
        key_constraints: "Не публиковать без отдельного решения владельца",
      },
      strategy: {
        strategy_revision_id: "campaign-strategy-revision-1",
        owner_confirmation: { decision: "APPROVED", confirmed_by: "OWNER" },
      },
      analytics_evidence_snapshot: { snapshot_id: "analytics-evidence-snapshot-revision-1" },
      recommendation_set: { recommendation_set_id: "recommendation-set-1" },
      external_write_intent: null,
      package_execution: null,
      campaign: null,
    },
  };
}

test("production executor seals real current artifacts through Publication Review without Direct authority", async () => {
  const store = new MemoryPipelineStore();
  let tick = 0;
  const orchestrator = new PipelineOrchestrator({
    store,
    newRunId: () => "production-pipeline-1",
    now: () => new Date(Date.parse("2026-08-31T12:00:00.000Z") + tick++ * 1_000).toISOString(),
  });
  const started = await orchestrator.start("owner", inputVersions());
  const completed = await executeProductionPipeline({ orchestrator, run: started, view: historicalView() });

  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.current_stage, "PUBLICATION_REVIEW");
  assert.equal(completed.stages.every((stage) => stage.status === "COMPLETED"), true);
  assert.deepEqual(completed.authority, {
    external_write: "DENIED",
    external_write_operations: [],
    model: { state_write: false, transition: false, authority_grant: false, persistence: false, external_write: false },
  });
  assert.equal(completed.input_versions.campaign_pairs[0].draft.revision_id, "campaign-draft-revision-1");

  const audit = await orchestrator.audit(completed.run_id);
  assert.deepEqual(audit.map((event) => event.event_kind), [
    "RUN_STARTED",
    "STAGE_VERIFIED",
    "STAGE_VERIFIED",
    "STAGE_VERIFIED",
    "RUN_COMPLETED",
  ]);
  assert.deepEqual(audit.map((event) => event.stage), [
    "CAMPAIGN_GOAL",
    "CAMPAIGN_GOAL",
    "EVIDENCE_COLLECTION",
    "STRATEGY",
    "CAMPAIGNS",
  ]);
  assert.equal(audit.slice(2).every((event) => event.actor.actor_type === "DETERMINISTIC_SERVICE"), true);
  assert.equal(audit.some((event) => JSON.stringify(event).match(/fixture|synthetic/iu)), false);
  assert.equal(audit.at(-1).output.reference.schema_version, "campaign-pair-set-v1");
  assert.deepEqual(audit.at(-1).evidence.map((item) => item.revision_id), [
    "analytics-evidence-snapshot-revision-1",
    "campaign-hypothesis-revision-1",
  ]);
});

test("production executor refuses unconfirmed Strategy before recording any stage output", async () => {
  const store = new MemoryPipelineStore();
  const orchestrator = new PipelineOrchestrator({ store, newRunId: () => "production-pipeline-2" });
  const started = await orchestrator.start("owner", inputVersions());
  const view = historicalView();
  view.state.strategy.owner_confirmation.decision = "PENDING";

  await assert.rejects(
    executeProductionPipeline({ orchestrator, run: started, view }),
    (error) => error instanceof ProductionPipelineExecutionError
      && error.code === "PRODUCTION_STRATEGY_NOT_CONFIRMED",
  );
  const current = await orchestrator.current("owner");
  assert.equal(current.current_stage, "CAMPAIGN_GOAL");
  assert.equal((await orchestrator.audit(current.run_id)).length, 1);
});

test("production executor refuses runs without a fully current Campaign Pair", async () => {
  const store = new MemoryPipelineStore();
  const versions = inputVersions();
  versions.campaign_pairs = [];
  versions.campaign_pair_checks.set_disposition = "NO_CURRENT_PAIRS";
  versions.campaign_pair_checks.pairs = [];
  const orchestrator = new PipelineOrchestrator({ store, newRunId: () => "production-pipeline-3" });
  const started = await orchestrator.start("owner", versions);

  await assert.rejects(
    executeProductionPipeline({ orchestrator, run: started, view: historicalView() }),
    (error) => error instanceof ProductionPipelineExecutionError
      && error.code === "PRODUCTION_CAMPAIGN_PAIRS_NOT_CURRENT",
  );
});

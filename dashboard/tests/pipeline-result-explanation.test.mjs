import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  explainCurrentResultQuestion,
  projectCurrentResultProvenance,
} from "../lib/pipeline-result-explanation.ts";
import {
  PIPELINE_INPUT_VERSIONS_SCHEMA,
  PipelineOrchestrator,
} from "../lib/pipeline-orchestrator.ts";

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}

function reference(name, character, revision = `${name}-revision-1`) {
  return { schema_version: `${name}-v1`, revision_id: revision, digest: digest(character) };
}

function inputVersions() {
  const pipelinePolicy = reference("pipeline-policy", "1");
  return {
    schema_version: PIPELINE_INPUT_VERSIONS_SCHEMA,
    historical_document: { schema_version: "p0-application-document-v19", revision: 42, digest: digest("a") },
    business_input: reference("business-input", "b"),
    goal_revision: reference("goal-revision", "c"),
    analytics_evidence_snapshot: reference("analytics-evidence-snapshot", "d"),
    campaign_strategy_revision: reference("campaign-strategy-revision", "e"),
    campaign_pairs: [{
      hypothesis: reference("campaign-hypothesis", "f", "yandex-direct-campaign-id-12345"),
      draft: reference("campaign-draft", "0", "draft-revision-7"),
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
        pair_id: "yandex-direct-campaign-id-12345::draft-revision-7",
        hypothesis_revision_id: "yandex-direct-campaign-id-12345",
        draft_id: "draft-1",
        draft_revision_id: "draft-revision-7",
        publish_fingerprint: digest("3"),
        included: true,
        violations: [],
      }],
    },
    pipeline_policy: pipelinePolicy,
    campaign_playbook: reference("campaign-playbook", "2"),
  };
}

function goalCandidate() {
  return {
    schema_version: "p0-goal-candidate-v1",
    desired_outcome: "Получать квалифицированные заявки",
    qualified_action: "Клиент подтвердил потребность и готов обсудить предложение",
    used_input_ids: ["business_input", "historical_document"],
    provenance: [{
      supports: "DESIRED_OUTCOME",
      input_id: "business_input",
      locator: "business_goal_decision.value",
      evidence: "Сохранённый бизнес-вход задаёт квалифицированные заявки",
    }, {
      supports: "QUALIFIED_ACTION",
      input_id: "business_input",
      locator: "business_model.qualified_outcome",
      evidence: "Модель бизнеса задаёт признак квалифицированного обращения",
    }],
    known_constraints: [{ constraint: "Не учитывать случайные обращения", input_ids: ["business_input"] }],
    material_ambiguity: null,
  };
}

function attempt(stage, character, status = "PASSED") {
  const versions = inputVersions();
  const roles = { EVIDENCE_COLLECTION: "EVIDENCE_ANALYST", STRATEGY: "STRATEGY_AGENT", CAMPAIGNS: "CAMPAIGN_DESIGN_AGENT" };
  return {
    actor: { actor_id: `agent-${stage.toLowerCase()}`, actor_type: "AGENT", role: roles[stage] ?? "STAGE_EXECUTOR" },
    inputs: [reference(`${stage.toLowerCase()}-input`, character)],
    evidence: [reference(`${stage.toLowerCase()}-evidence`, character)],
    output: reference(`${stage.toLowerCase()}-output`, character),
    checks: [{ check_id: `${stage}_CHECK`, status, policy: versions.pipeline_policy }],
    schemas: [reference(`${stage.toLowerCase()}-schema`, character)],
    policies: [versions.pipeline_policy],
    campaign_playbook: versions.campaign_playbook,
  };
}

class MemoryStore {
  runs = new Map();
  audits = new Map();

  async load(runId) { return structuredClone(this.runs.get(runId) ?? null); }
  async loadCurrent(ownerKey) {
    const state = [...this.runs.values()].find((item) => item.owner_key === ownerKey);
    return structuredClone(state ?? null);
  }
  async loadActive(ownerKey) {
    const state = [...this.runs.values()].find((item) => item.owner_key === ownerKey && item.status === "ACTIVE");
    return structuredClone(state ?? null);
  }
  async loadAudit(runId) { return structuredClone(this.audits.get(runId) ?? []); }
  async initialize(state, event) {
    if (this.runs.has(state.run_id)) return false;
    this.runs.set(state.run_id, structuredClone(state));
    this.audits.set(state.run_id, [structuredClone(event)]);
    return true;
  }
  async compareAndSwap(runId, expectedVersion, state, event) {
    if (this.runs.get(runId)?.version !== expectedVersion) return false;
    this.runs.set(runId, structuredClone(state));
    this.audits.get(runId).push(structuredClone(event));
    return true;
  }
}

async function currentResult() {
  const store = new MemoryStore();
  let tick = 0;
  const orchestrator = new PipelineOrchestrator({
    store,
    newRunId: () => "pipeline-explanation",
    now: () => new Date(Date.parse("2026-09-01T10:00:00.000Z") + tick++ * 1_000).toISOString(),
  });
  let run = await orchestrator.start("owner", inputVersions());
  run = await orchestrator.recordGoalCandidate({
    run_id: run.run_id,
    expected_version: run.version,
    candidate: goalCandidate(),
    actor: { actor_id: "goal-agent:model", actor_type: "AGENT", role: "GOAL_AGENT" },
  });
  run = await orchestrator.retry({
    run_id: run.run_id,
    expected_version: run.version,
    source_stage: "EVIDENCE_COLLECTION",
    reason_code: "EVIDENCE_RETRY",
    reason: "Проверка потребовала безопасного повтора.",
    attempt: attempt("EVIDENCE_COLLECTION", "4", "FAILED"),
  });
  run = await orchestrator.advance({
    run_id: run.run_id,
    expected_version: run.version,
    source_stage: "EVIDENCE_COLLECTION",
    reason_code: "EVIDENCE_VERIFIED",
    reason: "Разрешённые сведения проверены.",
    attempt: attempt("EVIDENCE_COLLECTION", "5"),
  });
  return { run, audit: await orchestrator.audit(run.run_id) };
}

test("owner disclosure projects actor, task, inputs, evidence, checks, retry, handoff and reproducibility versions", async () => {
  const { run, audit } = await currentResult();
  const provenance = await projectCurrentResultProvenance(run, audit);

  assert.equal(provenance.title, "Агенты и проверяемый след");
  assert.deepEqual(provenance.agents.map((agent) => agent.name), ["Goal Agent", "Evidence Analyst", "Evidence Analyst"]);
  assert.ok(provenance.agents.every((agent) => agent.stage && agent.work && agent.outcome && agent.evidenceBasis.length));
  assert.equal(provenance.pairs.length, 1);
  assert.equal(provenance.pairs[0].hypothesis.revision, "Скрыто как чувствительный идентификатор");
  assert.equal(provenance.pairs[0].draft.revision, "draft-revision-7");
  assert.ok(provenance.events.every((event) => event.executor && event.task));
  assert.ok(provenance.events.some((event) => event.evidence.length && event.inputs.length && event.checks.length));
  assert.ok(provenance.events.some((event) => event.safeCorrection && event.retry === "Повтор с попытки 2"));
  assert.ok(provenance.events.some((event) => event.handoff === "Стратегия"));
  assert.match(provenance.versions.historicalDocument, /Редакция 42/u);
  assert.equal(JSON.stringify(provenance).includes("sha256:"), false);
  assert.equal(JSON.stringify(provenance).includes("agent-evidence_collection"), false);
  assert.equal(JSON.stringify(provenance).includes("12345"), false);
});

test("current verified pair output supersedes the frozen seed pair in provenance and questions", async () => {
  const { run, audit } = await currentResult();
  const provenance = await projectCurrentResultProvenance(run, audit, [{
    key: "current-pair-revision-9",
    hypothesis: {
      schema_version: "p0-campaign-hypothesis-v1",
      revision_id: "current-hypothesis-revision-9",
    },
    draft: {
      schema_version: "direct-projection-compiler-v1",
      revision_id: "current-draft-revision-9",
    },
  }]);

  assert.equal(provenance.pairs.length, 1);
  assert.equal(provenance.pairs[0].key, "current-pair-revision-9");
  assert.equal(provenance.pairs[0].hypothesis.revision, "current-hypothesis-revision-9");
  assert.equal(provenance.pairs[0].draft.kind, "Campaign Draft");
  assert.equal(provenance.pairs[0].draft.revision, "current-draft-revision-9");
  assert.equal(JSON.stringify(provenance).includes("draft-revision-7"), false);
  assert.equal(
    explainCurrentResultQuestion(provenance, "Какая версия текущая?", "current-pair-revision-9").scope,
    "Текущий запуск · Пара 1",
  );
  assert.throws(
    () => explainCurrentResultQuestion(provenance, "Какая версия текущая?", "pair-1"),
    /не относится к текущему результату/u,
  );
});

test("free question is answered only from the selected current pair and sanitized trail", async () => {
  const { run, audit } = await currentResult();
  const provenance = await projectCurrentResultProvenance(run, audit);
  const answer = explainCurrentResultQuestion(
    provenance,
    "Почему был повтор и куда передали результат? token=super-secret yandex campaign id 12345",
    "pair-1",
  );

  assert.equal(answer.scope, "Текущий запуск · Пара 1");
  assert.match(answer.answer, /не скрытое рассуждение модели/u);
  assert.ok(answer.facts.some((fact) => /Повтор/u.test(fact)));
  assert.ok(answer.facts.some((fact) => /Стратегия/u.test(fact)));
  assert.equal(JSON.stringify(answer).includes("super-secret"), false);
  assert.equal(JSON.stringify(answer).includes("12345"), false);
  assert.throws(
    () => explainCurrentResultQuestion(provenance, "Что произошло?", "pair-from-another-run"),
    /не относится к текущему результату/u,
  );
});

test("explanation remains available in the backend while the Dashboard omits the removed provenance and question panels", async () => {
  const [client, route] = await Promise.all([
    readFile(new URL("../app/P0Client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/p0/route.ts", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(client, /<summary>\{provenance\.title\}<\/summary>|Агенты текущего запуска|name="question"|Получить объяснение|pipeline_action: "EXPLAIN"/u);
  assert.match(route, /pipelineAction === "EXPLAIN"/u);
  assert.match(route, /controller\.explain\(key/u);
  assert.doesNotMatch(client, /chain.of.thought|system prompt|raw payload/iu);
});

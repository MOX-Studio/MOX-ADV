import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { D1PipelineRunStore } from "../lib/pipeline-orchestrator-d1-store.ts";
import {
  PIPELINE_INPUT_VERSIONS_SCHEMA,
  PIPELINE_STAGES,
  PipelineOrchestrator,
  PipelineOrchestratorError,
  verifyPipelineRunState,
} from "../lib/pipeline-orchestrator.ts";

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
    goal_revision: reference("goal-revision", "c"),
    analytics_evidence_snapshot: reference("analytics-evidence-snapshot", "d"),
    campaign_strategy_revision: reference("campaign-strategy-revision", "e"),
    campaign_pairs: [{
      hypothesis: reference("campaign-hypothesis", "f"),
      draft: reference("campaign-draft", "0"),
    }],
    campaign_pair_checks: {
      schema_version: "campaign-pair-validation-v1",
      contract_version: "1.0.0",
      strategy_revision_id: "campaign-strategy-revision-1",
      evidence_snapshot_id: "analytics-evidence-snapshot-revision-1",
      field_registry_schema: "direct-v501-draft-field-registry-v2",
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

function goalCandidate(materialAmbiguity = null) {
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
    known_constraints: [{
      constraint: "Не учитывать обращения без подтверждённой потребности",
      input_ids: ["business_input"],
    }],
    material_ambiguity: materialAmbiguity,
  };
}

function verifiedAttempt(stage, character) {
  const versions = inputVersions();
  return {
    actor: { actor_id: `strategy-agent-${stage.toLowerCase()}`, actor_type: "AGENT", role: "STAGE_EXECUTOR" },
    inputs: [reference(`${stage.toLowerCase()}-input`, character)],
    evidence: [reference(`${stage.toLowerCase()}-evidence`, character)],
    output: reference(`${stage.toLowerCase()}-output`, character),
    checks: [{ check_id: `${stage}_CHECK`, status: "PASSED", policy: versions.pipeline_policy }],
    schemas: [reference(`${stage.toLowerCase()}-schema`, character)],
    policies: [versions.pipeline_policy],
    campaign_playbook: versions.campaign_playbook,
  };
}

function discardedAttempt(stage, character) {
  const attempt = verifiedAttempt(stage, character);
  return {
    ...attempt,
    output: reference(`${stage.toLowerCase()}-partial`, character),
    checks: [{ ...attempt.checks[0], status: "FAILED" }],
  };
}

function fixture(database) {
  const ids = ["pipeline-run-first", "pipeline-run-second"];
  let tick = 0;
  const store = new D1PipelineRunStore(d1Shim(database));
  return {
    store,
    orchestrator: new PipelineOrchestrator({
      store,
      newRunId: () => ids.shift(),
      now: () => new Date(Date.parse("2026-08-31T10:00:00.000Z") + tick++ * 1_000).toISOString(),
    }),
  };
}

test("Start persists a new zero-write run at Campaign Goal with five canonical stages and exact inputs", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE p0_state(user_key TEXT PRIMARY KEY, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, value_json TEXT NOT NULL)");
  const historical = JSON.stringify({ schema_version: "p0-application-document-v19", draft: { name: "Исторический документ" } });
  database.prepare("INSERT INTO p0_state VALUES (?, ?, ?, ?)").run("owner", 42, "2026-08-31T09:00:00.000Z", historical);
  const { store, orchestrator } = fixture(database);
  const versions = inputVersions();

  const started = await orchestrator.start("owner", versions);
  versions.business_input.revision_id = "caller-mutated-after-start";

  assert.equal(started.run_id, "pipeline-run-first");
  assert.equal(started.version, 0);
  assert.equal(started.status, "ACTIVE");
  assert.equal(started.current_stage, "CAMPAIGN_GOAL");
  assert.deepEqual(started.goal_formation, { status: "PENDING" });
  assert.deepEqual(started.stages, PIPELINE_STAGES.map((stage, index) => ({ ...stage, status: index === 0 ? "ACTIVE" : "PENDING" })));
  assert.equal(started.input_versions.historical_document.revision, 42);
  assert.equal(started.input_versions.business_input.revision_id, "business-input-revision-1");
  assert.match(started.input_versions_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(started.ownership, {
    state: "PIPELINE_ORCHESTRATOR",
    transitions: "PIPELINE_ORCHESTRATOR",
    authority: "PIPELINE_ORCHESTRATOR",
    persistence: "PIPELINE_ORCHESTRATOR",
  });
  assert.deepEqual(started.authority, {
    external_write: "DENIED",
    external_write_operations: [],
    model: { state_write: false, transition: false, authority_grant: false, persistence: false, external_write: false },
  });
  assert.deepEqual(await new D1PipelineRunStore(d1Shim(database)).load(started.run_id), started);
  assert.equal((await store.loadCurrent("owner")).run_id, started.run_id);

  const historicalAfter = database.prepare("SELECT revision, updated_at, value_json FROM p0_state WHERE user_key = ?").get("owner");
  assert.deepEqual({ ...historicalAfter }, { revision: 42, updated_at: "2026-08-31T09:00:00.000Z", value_json: historical });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM p0_pipeline_runs").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM p0_pipeline_run_revisions").get().count, 1);
  const audit = await orchestrator.audit(started.run_id);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].event_kind, "RUN_STARTED");
  assert.equal(audit[0].actor.actor_id, "owner");
  assert.equal(audit[0].previous_event_digest, null);
  assert.match(audit[0].event_digest, /^sha256:[0-9a-f]{64}$/u);
  database.close();
});

test("durable 1.1 Goal-stage runs upgrade to pending formation without inventing a GoalRevision", async () => {
  const database = new DatabaseSync(":memory:");
  const { orchestrator } = fixture(database);
  const started = await orchestrator.start("owner", inputVersions());
  const legacy = structuredClone(started);
  legacy.contract.version = "1.1.0";
  delete legacy.goal_formation;
  database.prepare("UPDATE p0_pipeline_runs SET value_json = ? WHERE run_id = ?").run(JSON.stringify(legacy), started.run_id);

  const loaded = await new D1PipelineRunStore(d1Shim(database)).load(started.run_id);

  assert.equal(loaded.contract.version, "1.2.0");
  assert.deepEqual(loaded.goal_formation, { status: "PENDING" });
  assert.equal(loaded.current_stage, "CAMPAIGN_GOAL");
  database.close();
});

test("a successful full run ends at publication review with zero Direct writes, impressions, or spend", async () => {
  const database = new DatabaseSync(":memory:");
  const { orchestrator } = fixture(database);
  const externalEffects = {
    create: 0,
    update: 0,
    pause: 0,
    moderate: 0,
    launch: 0,
    impressions: 0,
    spend: 0,
  };
  let run = await orchestrator.start("owner", inputVersions());
  run = await orchestrator.recordGoalCandidate({
    run_id: run.run_id,
    expected_version: run.version,
    candidate: goalCandidate(),
  });
  const completions = [
    ["EVIDENCE_COLLECTION", "EVIDENCE_VERIFIED", "Разрешённые сведения проверены.", "b"],
    ["STRATEGY", "STRATEGY_VERIFIED", "Текущая стратегия проверена.", "c"],
    ["CAMPAIGNS", "DRAFTS_COMPLETE", "Полные текущие Draft готовы к проверке публикации.", "d"],
  ];

  for (const [source_stage, reason_code, reason, character] of completions) {
    run = await orchestrator.advance({
      run_id: run.run_id,
      expected_version: run.version,
      source_stage,
      reason_code,
      reason,
      attempt: verifiedAttempt(source_stage, character),
    });
  }

  assert.equal(run.status, "COMPLETED");
  assert.equal(run.current_stage, "PUBLICATION_REVIEW");
  assert.equal(run.last_transition.kind, "COMPLETE");
  assert.equal(run.last_transition.source_stage, "CAMPAIGNS");
  assert.equal(run.last_transition.target_stage, "PUBLICATION_REVIEW");
  assert.equal(run.work_control.issue_actions, false);
  assert.deepEqual(run.authority.external_write_operations, []);
  assert.equal(run.authority.external_write, "DENIED");
  assert.deepEqual(externalEffects, {
    create: 0,
    update: 0,
    pause: 0,
    moderate: 0,
    launch: 0,
    impressions: 0,
    spend: 0,
  });
  assert.doesNotMatch(JSON.stringify(run), /APPROVED_FOR_PUBLICATION/u);
  database.close();
});

test("each successful Start allocates a new run and durable CAS rejects a stale writer", async () => {
  const database = new DatabaseSync(":memory:");
  const { store, orchestrator } = fixture(database);
  const first = await orchestrator.start("owner", inputVersions());

  await assert.rejects(
    orchestrator.start("owner", inputVersions()),
    (error) => error instanceof PipelineOrchestratorError && error.code === "PIPELINE_RUN_ALREADY_ACTIVE",
  );

  const stopped = await orchestrator.stop({
    run_id: first.run_id,
    expected_version: first.version,
  });
  assert.equal(stopped.status, "STOPPED");
  assert.equal(stopped.work_control.issue_actions, false);
  assert.equal(stopped.work_control.cancellation, "REQUESTED");
  assert.equal(stopped.work_control.unverified_output, "NEVER_PERSISTED");
  assert.equal(await store.compareAndSwap(first.run_id, 0, stopped), false);

  const second = await orchestrator.start("owner", inputVersions());
  assert.equal(second.run_id, "pipeline-run-second");
  assert.notEqual(second.run_id, first.run_id);
  assert.equal((await orchestrator.current("owner")).run_id, second.run_id);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM p0_pipeline_runs").get().count, 2);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM p0_pipeline_run_revisions").get().count, 3);
  database.close();
});

test("stop rejects stale work, retry keeps the run, and typed returns follow the deterministic table", async () => {
  const database = new DatabaseSync(":memory:");
  const { orchestrator } = fixture(database);
  const started = await orchestrator.start("owner", inputVersions());
  const goalComplete = await orchestrator.recordGoalCandidate({
    run_id: started.run_id,
    expected_version: started.version,
    candidate: goalCandidate(),
  });
  assert.equal(goalComplete.goal_formation.status, "VERIFIED");
  assert.equal(goalComplete.goal_formation.revision.validation.owner_confirmation_required, false);
  const evidenceComplete = await orchestrator.advance({
    run_id: goalComplete.run_id,
    expected_version: goalComplete.version,
    source_stage: "EVIDENCE_COLLECTION",
    reason_code: "EVIDENCE_VERIFIED",
    reason: "Снимок сведений сохранён и проверен.",
    attempt: verifiedAttempt("EVIDENCE_COLLECTION", "4"),
  });
  const strategyComplete = await orchestrator.advance({
    run_id: evidenceComplete.run_id,
    expected_version: evidenceComplete.version,
    source_stage: "STRATEGY",
    reason_code: "STRATEGY_VERIFIED",
    reason: "Стратегия прошла обязательные проверки.",
    attempt: verifiedAttempt("STRATEGY", "5"),
  });

  const retry = await orchestrator.retry({
    run_id: strategyComplete.run_id,
    expected_version: strategyComplete.version,
    source_stage: "CAMPAIGNS",
    reason_code: "TRANSIENT_READ",
    reason: "Временное безопасное чтение будет повторено в текущем запуске.",
    attempt: discardedAttempt("CAMPAIGNS", "6"),
  });
  assert.equal(retry.run_id, started.run_id);
  assert.equal(retry.current_stage, "CAMPAIGNS");
  assert.equal(retry.stage_attempt, 2);

  const returned = await orchestrator.returnTo({
    run_id: retry.run_id,
    expected_version: retry.version,
    source_stage: "CAMPAIGNS",
    cause: "STRATEGY_DEFECT",
    reason: "Стратегия не задаёт точную географию для полного черновика.",
    attempt: discardedAttempt("CAMPAIGNS", "7"),
  });
  assert.equal(returned.run_id, started.run_id);
  assert.equal(returned.current_stage, "STRATEGY");
  assert.equal(returned.last_transition.source_stage, "CAMPAIGNS");
  assert.equal(returned.last_transition.target_stage, "STRATEGY");
  assert.equal(returned.last_transition.reason_code, "STRATEGY_DEFECT");
  assert.equal(returned.stages.find((stage) => stage.id === "STRATEGY").status, "ACTIVE");
  assert.equal(returned.stages.find((stage) => stage.id === "CAMPAIGNS").status, "RETURNED");

  const trail = await orchestrator.audit(returned.run_id);
  assert.equal(trail.length, returned.version + 1);
  for (const event of trail.filter((item) => item.event_kind === "STAGE_VERIFIED")) {
    assert.equal(event.output.status, "VERIFIED");
    assert.deepEqual(event.current_product_link, event.output.reference);
    assert.ok(event.inputs.length > 0);
    assert.ok(event.evidence.length > 0);
    assert.ok(event.schemas.length > 0);
    assert.ok(event.policies.some((policy) => policy.digest === inputVersions().pipeline_policy.digest));
    assert.deepEqual(event.campaign_playbook, inputVersions().campaign_playbook);
  }
  const discarded = trail.filter((event) => event.event_kind === "ATTEMPT_DISCARDED");
  assert.equal(discarded.length, 2);
  assert.ok(discarded.every((event) => event.output.status === "DISCARDED" && event.current_product_link === null));
  assert.equal(discarded[0].retry.next_attempt, 2);
  assert.equal(discarded[1].return.target_stage, "STRATEGY");
  assert.ok(trail.every((event) => !Object.hasOwn(event, "raw_model_message") && !Object.hasOwn(event, "personal_data")));

  const stopped = await orchestrator.stop({
    run_id: returned.run_id,
    expected_version: returned.version,
    reason: "Владелец остановил работу до сохранения непроверенного черновика.",
  });
  await assert.rejects(
    orchestrator.advance({
      run_id: started.run_id,
      expected_version: strategyComplete.version,
      source_stage: "CAMPAIGNS",
      reason_code: "STALE_OUTPUT",
      reason: "Устаревший исполнитель пытается сохранить завершение.",
      attempt: verifiedAttempt("CAMPAIGNS", "8"),
    }),
    (error) => error instanceof PipelineOrchestratorError && error.code === "PIPELINE_RUN_NOT_ACTIVE",
  );
  assert.equal(stopped.work_control.unverified_output, "NEVER_PERSISTED");
  assert.equal(Object.hasOwn(await orchestrator.current("owner"), "partial_output"), false);
  const corrupted = structuredClone(stopped);
  corrupted.partial_output = { unverified: true };
  await assert.rejects(
    verifyPipelineRunState(corrupted),
    (error) => error instanceof PipelineOrchestratorError && error.code === "PIPELINE_RUN_CORRUPT",
  );
  database.close();
});

test("material Goal ambiguity stays at Campaign Goal with a prepared decision packet", async () => {
  const database = new DatabaseSync(":memory:");
  const { orchestrator } = fixture(database);
  const started = await orchestrator.start("owner", inputVersions());
  const ambiguous = await orchestrator.recordGoalCandidate({
    run_id: started.run_id,
    expected_version: started.version,
    candidate: goalCandidate({
      reason: "Продажа и регистрация посетителей являются разными бизнес-результатами.",
      options: [{
        option_id: "sales",
        desired_outcome: "Получать квалифицированные заявки",
        qualified_action: "Клиент подтвердил потребность и готов обсудить предложение",
        evidence: [
          { supports: "DESIRED_OUTCOME", input_id: "business_input", locator: "goal", evidence: "Вход указывает продажи" },
          { supports: "QUALIFIED_ACTION", input_id: "business_input", locator: "qualified", evidence: "Вход задаёт квалификацию" },
        ],
        consequences: ["Кампании будут оптимизированы под коммерческое обращение."],
        recommended: true,
      }, {
        option_id: "registrations",
        desired_outcome: "Получать регистрации посетителей",
        qualified_action: "Посетитель зарегистрировался на мероприятие",
        evidence: [
          { supports: "DESIRED_OUTCOME", input_id: "historical_document", locator: "site", evidence: "Сайт поддерживает регистрацию" },
          { supports: "QUALIFIED_ACTION", input_id: "historical_document", locator: "action", evidence: "Регистрация наблюдаема" },
        ],
        consequences: ["Изменятся аудитория и измеряемое действие."],
        recommended: false,
      }],
    }),
  });

  assert.equal(ambiguous.current_stage, "CAMPAIGN_GOAL");
  assert.equal(ambiguous.stage_attempt, 2);
  assert.equal(ambiguous.goal_formation.status, "MATERIAL_DECISION_REQUIRED");
  assert.equal(ambiguous.goal_formation.options.length, 2);
  assert.equal(ambiguous.last_transition.reason_code, "GOAL_MATERIAL_AMBIGUITY");
  const ambiguityTrail = await orchestrator.audit(started.run_id);
  assert.equal(ambiguityTrail[1].event_kind, "ATTEMPT_DISCARDED");
  assert.equal(ambiguityTrail[1].current_product_link, null);
  database.close();
});

test("audit survives store restart, detects mutation, and is protected from update and delete", async () => {
  const database = new DatabaseSync(":memory:");
  const { orchestrator } = fixture(database);
  const started = await orchestrator.start("owner", inputVersions());
  await orchestrator.recordGoalCandidate({
    run_id: started.run_id,
    expected_version: started.version,
    candidate: goalCandidate(),
  });

  const restarted = new PipelineOrchestrator({ store: new D1PipelineRunStore(d1Shim(database)) });
  const trail = await restarted.audit(started.run_id);
  assert.equal(trail.length, 2);
  assert.equal(trail[1].event_kind, "STAGE_VERIFIED");
  assert.equal(trail[1].previous_event_digest, trail[0].event_digest);
  assert.throws(
    () => database.prepare("UPDATE p0_pipeline_audit_events SET actor_id = 'other' WHERE run_id = ? AND sequence = 0").run(started.run_id),
    /pipeline audit events are immutable/u,
  );
  assert.throws(
    () => database.prepare("DELETE FROM p0_pipeline_audit_events WHERE run_id = ? AND sequence = 0").run(started.run_id),
    /pipeline audit events are immutable/u,
  );

  database.exec("DROP TRIGGER p0_pipeline_audit_events_no_update");
  const tampered = JSON.parse(database.prepare("SELECT value_json FROM p0_pipeline_audit_events WHERE run_id = ? AND sequence = 1").get(started.run_id).value_json);
  tampered.actor.actor_id = "tampered-agent";
  database.prepare("UPDATE p0_pipeline_audit_events SET value_json = ? WHERE run_id = ? AND sequence = 1").run(JSON.stringify(tampered), started.run_id);
  await assert.rejects(
    restarted.audit(started.run_id),
    (error) => error instanceof PipelineOrchestratorError && error.code === "PIPELINE_AUDIT_CORRUPT",
  );
  database.close();
});

test("verified output without exact policy and Playbook bindings is rejected before persistence", async () => {
  const database = new DatabaseSync(":memory:");
  const { orchestrator } = fixture(database);
  const started = await orchestrator.start("owner", inputVersions());
  const goalComplete = await orchestrator.recordGoalCandidate({
    run_id: started.run_id,
    expected_version: started.version,
    candidate: goalCandidate(),
  });
  const incomplete = verifiedAttempt("EVIDENCE_COLLECTION", "a");
  incomplete.policies = [];

  await assert.rejects(
    orchestrator.advance({
      run_id: goalComplete.run_id,
      expected_version: goalComplete.version,
      source_stage: "EVIDENCE_COLLECTION",
      reason_code: "EVIDENCE_VERIFIED",
      reason: "Сведения проверены.",
      attempt: incomplete,
    }),
    (error) => error instanceof PipelineOrchestratorError && error.code === "PIPELINE_VERIFIED_ATTEMPT_INVALID",
  );
  assert.equal((await orchestrator.current("owner")).version, goalComplete.version);
  assert.equal((await orchestrator.audit(started.run_id)).length, 2);
  database.close();
});

test("closed input-version contract rejects an unversioned start before persistence", async () => {
  const database = new DatabaseSync(":memory:");
  const { orchestrator } = fixture(database);
  const versions = inputVersions();
  delete versions.pipeline_policy.digest;

  await assert.rejects(
    orchestrator.start("owner", versions),
    (error) => error instanceof PipelineOrchestratorError && error.code === "PIPELINE_INPUT_VERSIONS_INVALID",
  );
  assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE name = 'p0_pipeline_runs'").get(), undefined);
  database.close();
});

test("closed input-version contract rejects a pair that is not included by its automatic checks", async () => {
  const database = new DatabaseSync(":memory:");
  const { orchestrator } = fixture(database);
  const versions = inputVersions();
  versions.campaign_pair_checks.pairs[0].included = false;
  versions.campaign_pair_checks.pairs[0].violations = [{
    category: "PAIR_COMPLETENESS",
    code: "DRAFT_PROJECTION_PARTIAL",
    executor: "CAMPAIGN_DESIGN_AGENT",
    return_target: "CAMPAIGNS",
    pointer: "/draft/publish_projection",
    message: "Direct Projection неполна.",
  }];

  await assert.rejects(
    orchestrator.start("owner", versions),
    (error) => error instanceof PipelineOrchestratorError && error.code === "PIPELINE_INPUT_VERSIONS_INVALID",
  );
  assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE name = 'p0_pipeline_runs'").get(), undefined);
  database.close();
});

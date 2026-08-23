import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";

import { runP0ProductMvpPilotScenarios } from "../lib/p0-product-mvp-pilots.ts";
import {
  P0_PRODUCT_MVP_EVAL_IDS,
  P0_PRODUCT_MVP_EXPLAINABILITY_TOPICS,
  P0_PRODUCT_MVP_HARD_GATES,
  buildP0ProductMvpAcceptanceArtifact,
} from "../lib/p0-product-mvp-acceptance.ts";

const sourceUrl = new URL("./fixtures/product-mvp/product-mvp-source.json", import.meta.url);
const goldenUrl = new URL("./fixtures/product-mvp/product-mvp-acceptance.json", import.meta.url);
const pilotRunnerUrl = new URL("../lib/p0-product-mvp-pilots.ts", import.meta.url);
const source = JSON.parse(await readFile(sourceUrl, "utf8"));

async function artifact(value = source) {
  return buildP0ProductMvpAcceptanceArtifact(structuredClone(value));
}

test("builds the same Product MVP artifact without presenting prepared scenarios as independent pilot evidence", async () => {
  const first = await artifact();
  const second = await artifact();
  assert.deepEqual(first, second);
  assert.equal(first.schema_version, "p0-product-mvp-acceptance-v1");
  assert.equal(first.status, "READY_FOR_HUMAN_CHECKPOINT");
  assert.equal(first.human_checkpoint.issue, 176);
  assert.equal(first.human_checkpoint.verdict, "PENDING_HUMAN_VERDICT");
  assert.equal(first.evidence.fixture.kind, "CONTROLLED_FIXTURE_EVIDENCE");
  assert.equal(first.evidence.prepared_scenarios.kind, "CONTROLLED_TEST_SCENARIO_EVIDENCE");
  assert.equal(first.evidence.independent_pilots.status, "PENDING_HUMAN_CHECKPOINT");
  assert.equal(first.evidence.independent_pilots.evidence, null);
  assert.notEqual(first.evidence.fixture.scenario_id, first.evidence.prepared_scenarios.positive.scenario_id);
  assert.equal(first.no_write_proof.production_write_attempts, 0);
  assert.equal(first.no_write_proof.live_authority_issued, false);
  assert.deepEqual(first.no_write_proof.provider_mutations, []);
});

test("agent eval contour covers every required adversarial and resilience scenario with bounded outcomes", async () => {
  const value = await artifact();
  assert.deepEqual(value.agent_evals.map((item) => item.id), P0_PRODUCT_MVP_EVAL_IDS);
  assert.equal(value.agent_evals.every((item) => item.status === "PASSED"), true);
  assert.equal(value.agent_evals.every((item) => item.metrics.unauthorized_tools_executed === 0), true);
  assert.equal(value.agent_evals.every((item) => item.metrics.false_certainty_claims === 0), true);
  assert.equal(value.agent_evals.find((item) => item.id === "unnecessary-owner-questions").metrics.unnecessary_owner_questions, 0);
  assert.equal(value.agent_evals.find((item) => item.id === "prompt-injection").observed.policy_integrity_preserved, true);
  assert.equal(value.agent_evals.find((item) => item.id === "provider-delay").observed.owner_polling_controls, 0);
  assert.equal(value.agent_evals.find((item) => item.id === "restart-compaction").observed.remaining_budgets_preserved, true);
  await Promise.all(value.agent_evals.map((item) => readFile(new URL(`./${item.executable_test}`, import.meta.url), "utf8")));
});

test("prepared pilot scenarios execute deterministically through authoritative pure product contracts without masquerading as pilot evidence", async () => {
  const first = await runP0ProductMvpPilotScenarios();
  const second = await runP0ProductMvpPilotScenarios();
  assert.deepEqual(first, second);
  assert.equal(first.kind, "CONTROLLED_TEST_SCENARIO_EVIDENCE");
  assert.equal(first.positive.evidence_kind, "CONTROLLED_TEST_SCENARIO_EVIDENCE");
  assert.equal(first.positive.checkpoint_evidence_status, "AWAITING_INDEPENDENT_OBSERVATION");
  assert.equal(first.positive.execution_mode, "EXECUTABLE_TEST_SCENARIO_NO_WRITE");
  assert.equal(first.positive.business_name, "Контур.Маркет");
  assert.doesNotMatch(JSON.stringify(first.positive.business_model), /выстав/u);
  assert.equal(first.positive.execution_proof.external_write_calls, 0);
  assert.equal(first.positive.execution_proof.provider_mutation_capability_present, false);
  assert.deepEqual(first.positive.execution_proof.authoritative_contracts_executed, [
    "p0-business-model-v1",
    "campaign-fanout-v1",
    "viability-score/1.0.0",
    "p0-campaign-creation-profile-v1",
  ]);
  assert.equal(first.honesty.cases.every((item) => item.execution_proof.viable_count === 0), true);
  assert.equal(first.honesty.cases.every((item) => item.execution_proof.external_write_calls === 0), true);
  const runnerSource = await readFile(pilotRunnerUrl, "utf8");
  assert.doesNotMatch(runnerSource, /direct-write|P0Application|fetch\s*\(|Campaigns\.(?:add|update|suspend|resume)/u);
});

test("prepared positive real-business scenario exposes an editable VIABLE Draft only after every hard gate and complete Profile v1 projection", async () => {
  const value = await artifact();
  const positive = value.evidence.prepared_scenarios.positive;
  assert.equal(positive.real_business_reference, true);
  assert.equal(positive.derived_from_fixture, false);
  assert.equal(positive.business_model.editable, true);
  assert.equal(positive.business_model.complete, true);
  const viable = positive.campaigns.filter((draft) => draft.status === "VIABLE");
  assert.ok(viable.length >= 1);
  for (const draft of viable) {
    assert.equal(draft.editable, true);
    assert.deepEqual(draft.hard_gates.map((gate) => gate.gate), P0_PRODUCT_MVP_HARD_GATES);
    assert.equal(draft.hard_gates.every((gate) => gate.status === "PASSED"), true);
    assert.equal(draft.profile_v1.complete, true);
    assert.equal(draft.profile_v1.unsupported_selected_fields.length, 0);
    assert.equal(draft.score.comparative_not_predictive, true);
  }
});

test("prepared honesty scenario matrix never produces false VIABLE and prioritizes repair for each material insufficiency", async () => {
  const value = await artifact();
  const honesty = value.evidence.prepared_scenarios.honesty;
  assert.deepEqual(honesty.cases.map((item) => item.insufficient_area), [
    "ECONOMICS", "DEMAND", "MEASUREMENT", "DESTINATION", "CAPABILITY",
  ]);
  for (const item of honesty.cases) {
    assert.equal(item.campaigns.some((draft) => draft.status === "VIABLE"), false);
    assert.ok(item.campaigns.every((draft) => ["BLOCKED", "INSUFFICIENT_EVIDENCE"].includes(draft.status)));
    assert.ok(item.repair_plan.length >= 1);
    assert.deepEqual(item.repair_plan.map((repair) => repair.priority), item.repair_plan.map((_, index) => index + 1));
    assert.equal(item.repair_plan[0].area, item.insufficient_area);
  }
});

test("artifact prepares browser and non-specialist explainability acceptance without claiming the human verdict", async () => {
  const value = await artifact();
  assert.deepEqual(value.browser.stages, ["Цель", "Что узнал агент", "Стратегия", "Кампании", "Проверка и создание"]);
  assert.deepEqual(value.browser.viewport, { width: 1920, height: 1080 });
  assert.equal(value.browser.local_dashboard_ui_only, true);
  assert.equal(value.browser.direct_dashboard_api_or_state_access, false);
  assert.equal(value.browser.checks.every((check) => check.status === "PASSED"), true);
  assert.ok(value.browser.technical_noise_denylist.length >= 24);
  assert.deepEqual(value.human_explainability.sections.map((item) => item.topic), P0_PRODUCT_MVP_EXPLAINABILITY_TOPICS);
  assert.equal(value.human_explainability.reviewer_response, null);
  assert.equal(value.human_explainability.verdict, "PENDING_HUMAN_VERDICT");
});

test("fails closed on a false positive, fixture-substituted pilot, missing eval, or production-write evidence", async () => {
  const mutations = [
    (value) => { value.pilots.kind = "CONTROLLED_FIXTURE_EVIDENCE"; },
    (value) => { value.pilots.positive_scenario_id = "mixed-correction"; },
    (value) => { value.agent_evals.pop(); },
    (value) => { value.safety.production_write_attempts = 1; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(source);
    mutate(changed);
    await assert.rejects(() => artifact(changed), /P0_PRODUCT_MVP_ACCEPTANCE_INVALID/u);
  }
});

test("matches the checked-in machine-readable Product MVP artifact", async () => {
  const actual = await artifact();
  if (process.env.UPDATE_P0_PRODUCT_MVP_ACCEPTANCE === "1") {
    await writeFile(goldenUrl, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
  }
  const expected = JSON.parse(await readFile(goldenUrl, "utf8"));
  assert.deepEqual(actual, expected);
});

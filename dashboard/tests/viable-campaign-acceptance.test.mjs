import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";

import {
  P0_VIABLE_CAMPAIGN_HARD_GATES,
  buildP0ViableCampaignAcceptanceArtifact,
  runP0ViableCampaignScenarios,
} from "../lib/p0-viable-campaign-acceptance.ts";

const sourceUrl = new URL("./evidence/p0-viable-campaign-real-business.json", import.meta.url);
const goldenUrl = new URL("./evidence/p0-viable-campaign-acceptance.json", import.meta.url);
const source = JSON.parse(await readFile(sourceUrl, "utf8"));

async function artifact(value = source) {
  return buildP0ViableCampaignAcceptanceArtifact(structuredClone(value));
}

test("independent current real-business evidence produces editable VIABLE drafts after every hard gate", async () => {
  const value = await artifact();
  assert.equal(value.feature_issue, 238);
  assert.deepEqual(value.implemented_tasks, [285, 286]);
  assert.equal(value.status, "READY_FOR_OWNER_CHECKPOINT");
  const positive = value.evidence.independent_positive;
  assert.equal(positive.evidence_kind, "INDEPENDENT_READ_ONLY_BUSINESS_EVIDENCE");
  assert.equal(positive.derived_from_fixture, false);
  const viable = positive.campaigns.filter((campaign) => campaign.status === "VIABLE");
  assert.ok(viable.length >= 1);
  for (const campaign of viable) {
    assert.equal(campaign.editable, true);
    assert.deepEqual(campaign.hard_gates.map((gate) => gate.gate), P0_VIABLE_CAMPAIGN_HARD_GATES);
    assert.equal(campaign.hard_gates.every((gate) => gate.status === "PASSED"), true);
    assert.equal(campaign.profile_v1.complete, true);
    assert.equal(campaign.profile_v1.unsupported_selected_fields.length, 0);
    assert.ok(campaign.score.coverage_percent >= 80);
    assert.equal(campaign.score.comparative_not_predictive, true);
  }
});

test("honesty variants never create false VIABLE and lead with a material repair", async () => {
  const scenarios = await runP0ViableCampaignScenarios(structuredClone(source));
  assert.equal(scenarios.honesty.evidence_kind, "CONTROLLED_HONESTY_VARIANTS_FROM_INDEPENDENT_SOURCE");
  assert.deepEqual(scenarios.honesty.cases.map((item) => item.insufficient_area), [
    "ECONOMICS", "DEMAND", "MEASUREMENT", "DESTINATION", "CAPABILITY",
  ]);
  for (const item of scenarios.honesty.cases) {
    assert.equal(item.campaigns.some((campaign) => campaign.status === "VIABLE"), false);
    assert.equal(item.execution_proof.recommendation_set_status, "NO_VIABLE_DRAFTS");
    assert.equal(item.execution_proof.viable_count, 0);
    assert.equal(item.execution_proof.external_write_calls, 0);
    assert.equal(item.repair_plan[0].priority, 1);
  }
});

test("fixture browser proof stays separate and every evidence path preserves no-write", async () => {
  const value = await artifact();
  assert.equal(value.evidence.browser_regression.evidence_kind, "CONTROLLED_BROWSER_FIXTURE_EVIDENCE");
  assert.equal(value.evidence.browser_regression.fixture_is_independent_evidence, false);
  assert.deepEqual(value.evidence.browser_regression.viewport, { width: 1920, height: 1080 });
  assert.deepEqual(value.no_write_proof.provider_mutations, []);
  assert.equal(value.no_write_proof.external_write_calls, 0);
  assert.equal(value.no_write_proof.production_write_attempts, 0);
  assert.equal(value.no_write_proof.live_authority_issued, false);
  assert.equal(value.human_checkpoint.issue, 241);
  assert.equal(value.human_checkpoint.verdict, "PENDING_HUMAN_VERDICT");
});

test("fails closed on invented identity, unavailable cost, false demand, or provider mutation", async () => {
  const mutations = [
    (value) => { value.evidence_kind = "CONTROLLED_FIXTURE_EVIDENCE"; },
    (value) => { value.direct.cost.status = "UNAVAILABLE"; },
    (value) => { value.metrika.report.visits.observed = false; },
    (value) => { value.safety.provider_mutations.push("Campaigns.add"); },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(source);
    mutate(changed);
    await assert.rejects(() => artifact(changed), /P0_VIABLE_CAMPAIGN_EVIDENCE_INVALID/u);
  }
});

test("matches the checked-in machine-readable acceptance artifact", async () => {
  const actual = await artifact();
  if (process.env.UPDATE_P0_VIABLE_CAMPAIGN_ACCEPTANCE === "1") {
    await writeFile(goldenUrl, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
  }
  const expected = JSON.parse(await readFile(goldenUrl, "utf8"));
  assert.deepEqual(actual, expected);
});

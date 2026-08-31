import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMPAIGN_STRATEGY_AGENT_INPUT_SCHEMA,
  CAMPAIGN_STRATEGY_DIMENSIONS,
  CampaignStrategyAgentError,
  formAutonomousCampaignStrategy,
  sealCampaignStrategyAgentArtifact,
} from "../lib/campaign-strategy-agent.ts";

const ACCEPTED_AT = "2026-09-01T12:00:00.000Z";

async function artifact(kind, revisionId, evidenceId, content) {
  return sealCampaignStrategyAgentArtifact({
    kind,
    schema_version: `${kind.toLowerCase().replaceAll("_", "-")}-v1`,
    revision_id: revisionId,
    evidence: [{ evidence_id: evidenceId, path: `/facts/${evidenceId}` }],
    content,
  });
}

async function inputs() {
  return {
    schema_version: CAMPAIGN_STRATEGY_AGENT_INPUT_SCHEMA,
    goal_revision: await artifact("GOAL_REVISION", "goal-r7", "goal-qualified-result", {
      business_goal: "Получать квалифицированные заявки",
      qualified_result: "Заявка на расчёт",
    }),
    business_input: await artifact("BUSINESS_INPUT", "business-r4", "business-boundaries", {
      campaign_focus: "Внедрение товарного учёта",
      maximum_weekly_budget_rub: 50_000,
    }),
    analytics_evidence_snapshot: await artifact("ANALYTICS_EVIDENCE_SNAPSHOT", "snapshot-r9", "snapshot-offer-audience", {
      offer: "Внедрение товарного учёта для магазинов",
      audience: "Владельцы розничных магазинов",
      landing_page: "https://owner.example/accounting",
    }),
    policies: [await artifact("MANDATORY_POLICY", "policy-r3", "policy-no-performance-promise", {
      policy_id: "strategy-safety",
      policy_version: "3.0.0",
      status: "MANDATORY",
      performance_promises: "FORBIDDEN",
    })],
    supported_draft_profile: await artifact("SUPPORTED_DRAFT_PROFILE", "profile-r2", "profile-search", {
      profile_id: "direct-v501-search-max-clicks",
      profile_version: "2.0.0",
      status: "SUPPORTED",
      campaign_type: "UNIFIED_CAMPAIGN",
      placement: "SEARCH",
    }),
    campaign_playbook: await artifact("CAMPAIGN_PLAYBOOK", "playbook-r5", "playbook-qualified-message", {
      release_id: "campaign-playbook-2026-09",
      release_version: "5.0.0",
      status: "ACTIVE",
      rule_ids: ["qualified-message-v2"],
    }),
  };
}

function evidenceRef(input, key, evidenceId) {
  const source = key === "policies" ? input.policies[0] : input[key];
  return {
    input_kind: source.kind,
    revision_id: source.revision_id,
    evidence_id: evidenceId,
  };
}

function proposal(input) {
  const refs = {
    goal: [evidenceRef(input, "goal_revision", "goal-qualified-result")],
    business: [evidenceRef(input, "business_input", "business-boundaries")],
    snapshot: [evidenceRef(input, "analytics_evidence_snapshot", "snapshot-offer-audience")],
    policy: [evidenceRef(input, "policies", "policy-no-performance-promise")],
    profile: [evidenceRef(input, "supported_draft_profile", "profile-search")],
    playbook: [evidenceRef(input, "campaign_playbook", "playbook-qualified-message")],
  };
  const values = {
    business_goal: "Получать квалифицированные заявки",
    campaign_focus: "Внедрение товарного учёта",
    advertised_offer: "Внедрение товарного учёта для магазинов",
    target_audience: "Владельцы розничных магазинов",
    qualified_result: "Заявка на расчёт",
    exclusions: "Запросы на бесплатную консультацию без магазина",
    geography: "Москва",
    period: { start_date: "2026-09-10", end_date: "2026-10-31" },
    landing_page: "https://owner.example/accounting",
    weekly_budget: 50_000,
    target_result_cost: null,
    core_message: "Настройка учёта под процессы магазина",
  };
  const referenceFor = {
    business_goal: refs.goal,
    campaign_focus: refs.business,
    advertised_offer: refs.snapshot,
    target_audience: refs.snapshot,
    qualified_result: refs.goal,
    exclusions: refs.business,
    geography: refs.business,
    period: refs.business,
    landing_page: refs.snapshot,
    weekly_budget: refs.business,
    target_result_cost: refs.policy,
    core_message: [...refs.snapshot, ...refs.playbook],
  };
  return {
    dimensions: CAMPAIGN_STRATEGY_DIMENSIONS.map((dimensionId) => ({
      dimension_id: dimensionId,
      value: values[dimensionId],
      rationale: `Основание для ${dimensionId}`,
      confidence: dimensionId === "target_result_cost" ? "LOW" : "HIGH",
      evidence_refs: referenceFor[dimensionId],
    })),
    rationale: "Стратегия связывает подтверждённую цель и бизнес-границы с проверенным предложением.",
    confidence: "MEDIUM",
    conflicts: [],
  };
}

test("forms and autonomously accepts all twelve evidence-linked dimensions from only typed immutable inputs", async () => {
  const exactInputs = await inputs();
  const callerCopy = structuredClone(exactInputs);
  let observedRequest;
  const model = {
    model_id: "fixture-strategy-agent-v1",
    async formCampaignStrategy(request) {
      observedRequest = request;
      assert.equal(Object.isFrozen(request), true);
      assert.equal(Object.isFrozen(request.analytics_evidence_snapshot.content), true);
      assert.deepEqual(request.authority, {
        external_read: false,
        persistence: false,
        adjacent_stage_mutation: false,
        mandate_grant: false,
        publication: false,
        spend: false,
      });
      assert.deepEqual(Object.keys(request).sort(), [
        "analytics_evidence_snapshot",
        "authority",
        "business_input",
        "campaign_playbook",
        "contract",
        "goal_revision",
        "policies",
        "schema_version",
        "supported_draft_profile",
      ]);
      return proposal(request);
    },
  };

  const strategy = await formAutonomousCampaignStrategy({ inputs: exactInputs, model, acceptedAt: ACCEPTED_AT });

  assert.ok(observedRequest);
  assert.deepEqual(exactInputs, callerCopy);
  assert.equal(strategy.status, "AGENT_ACCEPTED");
  assert.deepEqual(strategy.dimensions.map((item) => item.dimension_id), CAMPAIGN_STRATEGY_DIMENSIONS);
  assert.ok(strategy.dimensions.every((item) => item.evidence_refs.length > 0));
  assert.match(strategy.strategy_revision_id, /^campaign-strategy:[0-9a-f]{24}$/u);
  assert.match(strategy.digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(strategy.input_lineage.goal_revision.revision_id, "goal-r7");
  assert.equal(strategy.input_lineage.analytics_evidence_snapshot.revision_id, "snapshot-r9");
  assert.equal(strategy.input_lineage.supported_draft_profile.revision_id, "profile-r2");
  assert.equal(strategy.input_lineage.campaign_playbook.revision_id, "playbook-r5");
  assert.equal(Object.isFrozen(strategy), true);
  assert.equal(Object.isFrozen(strategy.dimensions), true);
});

test("recommended budget is planning-only and cannot carry Mandate, publication, spend, or performance authority", async () => {
  const exactInputs = await inputs();
  const strategy = await formAutonomousCampaignStrategy({
    inputs: exactInputs,
    model: { model_id: "fixture-strategy-agent-v1", formCampaignStrategy: async () => proposal(exactInputs) },
    acceptedAt: ACCEPTED_AT,
  });

  assert.deepEqual(strategy.budget_boundary, {
    weekly_budget: 50_000,
    semantics: "RECOMMENDATION_ONLY",
    creates_mandate: false,
    authorizes_spend: false,
  });
  assert.deepEqual(strategy.authority, {
    mandate: "NOT_GRANTED",
    publication: "NOT_AUTHORIZED",
    spend: "NOT_AUTHORIZED",
    performance_promise: false,
  });
  assert.equal(JSON.stringify(strategy).includes("APPROVED_FOR_PUBLICATION"), false);
});

test("rejects incomplete dimensions and evidence that does not resolve to an exact immutable input", async () => {
  const exactInputs = await inputs();
  const incomplete = proposal(exactInputs);
  incomplete.dimensions.pop();
  await assert.rejects(
    formAutonomousCampaignStrategy({
      inputs: exactInputs,
      model: { model_id: "fixture-strategy-agent-v1", formCampaignStrategy: async () => incomplete },
      acceptedAt: ACCEPTED_AT,
    }),
    (error) => error instanceof CampaignStrategyAgentError && error.code === "STRATEGY_DIMENSIONS_INCOMPLETE",
  );

  const invented = proposal(exactInputs);
  invented.dimensions[0].evidence_refs[0].evidence_id = "model-invented-source";
  await assert.rejects(
    formAutonomousCampaignStrategy({
      inputs: exactInputs,
      model: { model_id: "fixture-strategy-agent-v1", formCampaignStrategy: async () => invented },
      acceptedAt: ACCEPTED_AT,
    }),
    (error) => error instanceof CampaignStrategyAgentError && error.code === "STRATEGY_EVIDENCE_UNKNOWN",
  );
});

test("rejects mutated artifacts, non-mandatory policy, unsupported profile, and inactive Playbook before calling the agent", async () => {
  for (const mutate of [
    (value) => { value.business_input.content.maximum_weekly_budget_rub = 70_000; },
    (value) => { value.policies[0].content.status = "OPTIONAL"; },
    (value) => { value.supported_draft_profile.content.status = "UNSUPPORTED"; },
    (value) => { value.campaign_playbook.content.status = "SUPERSEDED"; },
  ]) {
    const exactInputs = structuredClone(await inputs());
    mutate(exactInputs);
    let called = false;
    await assert.rejects(
      formAutonomousCampaignStrategy({
        inputs: exactInputs,
        model: {
          model_id: "must-not-run",
          async formCampaignStrategy() {
            called = true;
            return proposal(exactInputs);
          },
        },
        acceptedAt: ACCEPTED_AT,
      }),
      (error) => error instanceof CampaignStrategyAgentError,
    );
    assert.equal(called, false);
  }
});

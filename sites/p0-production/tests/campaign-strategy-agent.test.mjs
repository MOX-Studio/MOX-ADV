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
    campaign_playbook: await artifact("CAMPAIGN_PLAYBOOK", "playbook-release:campaign-playbook-2026-09:5.0.0:cccccccccccccccc", "playbook-qualified-message", {
      schema_version: "p0-campaign-playbook-strategy-snapshot-v1",
      status: "ACTIVE_APPROVED",
      release: {
        release_id: "campaign-playbook-2026-09",
        release_version: "5.0.0",
        content_digest: `sha256:${"c".repeat(64)}`,
      },
      promotion_policy: {
        policy_id: "campaign-playbook-promotion-policy",
        policy_version: "3.0.0",
        content_digest: `sha256:${"d".repeat(64)}`,
      },
      activation_decision: {
        decision_id: "activate-campaign-playbook-2026-09",
        content_digest: `sha256:${"e".repeat(64)}`,
      },
      steward_delegation: {
        delegation_id: "knowledge-steward-delegation",
        delegation_version: "1.0.0",
        content_digest: `sha256:${"f".repeat(64)}`,
      },
      applicable_rules: [{
        rule_id: "qualified-message",
        rule_version: "2.0.0",
        content_digest: `sha256:${"1".repeat(64)}`,
        changed_family: "QUALIFIED_ACTION",
        mechanism: "Name the qualified action in the message.",
        changed_fields: ["/direct/ad/ResponsiveAd/Texts"],
        assessment_id: "assessment-qualified-message-v2",
        assessment_digest: `sha256:${"2".repeat(64)}`,
      }],
      authority: {
        evidence_override: false,
        mandate_grant: false,
        campaign_execution: false,
        campaign_publication: false,
        spend: false,
      },
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
      assert.equal(request.attempt, 1);
      assert.equal(request.repair, null);
      assert.deepEqual(Object.keys(request).sort(), [
        "analytics_evidence_snapshot",
        "attempt",
        "authority",
        "business_input",
        "campaign_playbook",
        "contract",
        "goal_revision",
        "policies",
        "repair",
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
  assert.equal(strategy.input_lineage.campaign_playbook.revision_id, "playbook-release:campaign-playbook-2026-09:5.0.0:cccccccccccccccc");
  assert.deepEqual(strategy.playbook_lineage, {
    release: {
      release_id: "campaign-playbook-2026-09",
      release_version: "5.0.0",
      content_digest: `sha256:${"c".repeat(64)}`,
    },
    promotion_policy: {
      policy_id: "campaign-playbook-promotion-policy",
      policy_version: "3.0.0",
      content_digest: `sha256:${"d".repeat(64)}`,
    },
    applied_rules: [{
      rule_id: "qualified-message",
      rule_version: "2.0.0",
      content_digest: `sha256:${"1".repeat(64)}`,
    }],
  });
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

test("normalizes formal presentation without a retry or change to business meaning", async () => {
  const exactInputs = await inputs();
  const unnormalized = proposal(exactInputs);
  unnormalized.dimensions.reverse();
  unnormalized.rationale = "  Стратегия   связывает подтверждённую цель  ";
  unnormalized.dimensions.find((item) => item.dimension_id === "core_message").value = "  Настройка　учёта   под процессы магазина  ";
  let calls = 0;

  const strategy = await formAutonomousCampaignStrategy({
    inputs: exactInputs,
    model: {
      model_id: "fixture-strategy-agent-v1",
      async formCampaignStrategy() {
        calls += 1;
        return unnormalized;
      },
    },
    acceptedAt: ACCEPTED_AT,
  });

  assert.equal(calls, 1);
  assert.deepEqual(strategy.dimensions.map((item) => item.dimension_id), CAMPAIGN_STRATEGY_DIMENSIONS);
  assert.equal(strategy.rationale, "Стратегия связывает подтверждённую цель");
  assert.equal(strategy.dimensions.find((item) => item.dimension_id === "core_message").value, "Настройка учёта под процессы магазина");
});

test("returns every first-attempt content violation to the Strategy Agent in one immutable repair package", async () => {
  const exactInputs = await inputs();
  const rejected = proposal(exactInputs);
  rejected.dimensions.find((item) => item.dimension_id === "weekly_budget").value = 0;
  rejected.dimensions.find((item) => item.dimension_id === "period").value = { start_date: "2026-10-31", end_date: "2026-09-10" };
  rejected.dimensions[0].evidence_refs[0].evidence_id = "model-invented-source";
  rejected.conflicts.push({
    code: "POLICY_CONFLICT",
    description: "Конфликт с обязательной политикой",
    evidence_refs: [evidenceRef(exactInputs, "policies", "policy-no-performance-promise")],
  });
  const requests = [];

  const strategy = await formAutonomousCampaignStrategy({
    inputs: exactInputs,
    model: {
      model_id: "fixture-strategy-agent-v1",
      async formCampaignStrategy(request) {
        requests.push(request);
        if (request.attempt === 1) return rejected;
        assert.equal(Object.isFrozen(request.repair), true);
        assert.equal(Object.isFrozen(request.repair.validation.violations), true);
        assert.deepEqual(
          new Set(request.repair.validation.violations.map((item) => item.code)),
          new Set([
            "STRATEGY_EVIDENCE_UNKNOWN",
            "STRATEGY_PERIOD_INVALID",
            "STRATEGY_WEEKLY_BUDGET_INVALID",
            "STRATEGY_CONFLICT_UNRESOLVED",
          ]),
        );
        return proposal(request);
      },
    },
    acceptedAt: ACCEPTED_AT,
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[1].attempt, 2);
  assert.equal(requests[1].repair.validation.status, "CONTENT_REJECTED");
  assert.equal(requests[1].repair.validation.attempt, 1);
  assert.equal(strategy.status, "AGENT_ACCEPTED");
  assert.deepEqual(strategy.conflicts, []);
});

test("a second substantive rejection produces TECHNICAL_FAILURE after exactly one repair attempt", async () => {
  const exactInputs = await inputs();
  let calls = 0;

  await assert.rejects(
    formAutonomousCampaignStrategy({
      inputs: exactInputs,
      model: {
        model_id: "fixture-strategy-agent-v1",
        async formCampaignStrategy() {
          calls += 1;
          const invalid = proposal(exactInputs);
          invalid.dimensions.pop();
          invalid.dimensions[0].evidence_refs[0].evidence_id = "model-invented-source";
          return invalid;
        },
      },
      acceptedAt: ACCEPTED_AT,
    }),
    (error) => {
      assert.ok(error instanceof CampaignStrategyAgentError);
      assert.equal(error.code, "TECHNICAL_FAILURE");
      assert.equal(error.details.status, "TECHNICAL_FAILURE");
      assert.equal(error.details.reason, "STRATEGY_CONTENT_REJECTED_TWICE");
      assert.deepEqual(error.details.validation_attempts.map((item) => item.attempt), [1, 2]);
      assert.ok(error.details.validation_attempts.every((item) => {
        const codes = new Set(item.violations.map((violation) => violation.code));
        return codes.has("STRATEGY_DIMENSIONS_INCOMPLETE") && codes.has("STRATEGY_EVIDENCE_UNKNOWN");
      }));
      assert.equal(/question|confirm|approv/iu.test(JSON.stringify(error.details)), false);
      return true;
    },
  );
  assert.equal(calls, 2);
});

test("rejects mutated artifacts, non-mandatory policy, unsupported profile, and inactive Playbook before calling the agent", async () => {
  for (const mutate of [
    (value) => { value.business_input.content.maximum_weekly_budget_rub = 70_000; },
    (value) => { value.policies[0].content.status = "OPTIONAL"; },
    (value) => { value.supported_draft_profile.content.status = "UNSUPPORTED"; },
    (value) => { value.campaign_playbook.content.status = "SUPERSEDED"; },
    (value) => { value.campaign_playbook.content.applicable_rules[0].content_digest = `sha256:${"9".repeat(64)}`; },
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

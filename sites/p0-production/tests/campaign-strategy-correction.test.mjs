import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMPAIGN_STRATEGY_AGENT_INPUT_SCHEMA,
  CAMPAIGN_STRATEGY_DIMENSIONS,
  formAutonomousCampaignStrategy,
  sealCampaignStrategyAgentArtifact,
} from "../lib/campaign-strategy-agent.ts";
import {
  CURRENT_CAMPAIGN_STRATEGY_SCHEMA,
  CampaignStrategyCorrectionError,
  saveCampaignStrategyCorrection,
} from "../lib/campaign-strategy-correction.ts";

const INITIAL_AT = "2026-09-01T12:00:00.000Z";
const CORRECTED_AT = "2026-09-02T12:00:00.000Z";

async function artifact(kind, revisionId, evidenceId, content) {
  return sealCampaignStrategyAgentArtifact({
    kind,
    schema_version: `${kind.toLowerCase().replaceAll("_", "-")}-v1`,
    revision_id: revisionId,
    evidence: [{ evidence_id: evidenceId, path: `/facts/${evidenceId}` }],
    content,
  });
}

async function strategyInputs() {
  return {
    schema_version: CAMPAIGN_STRATEGY_AGENT_INPUT_SCHEMA,
    goal_revision: await artifact("GOAL_REVISION", "goal-r7", "goal-qualified-result", {
      business_goal: "Получать квалифицированные заявки",
      qualified_result: "Заявка на расчёт",
    }),
    business_input: await artifact("BUSINESS_INPUT", "business-r4", "business-boundaries", {
      campaign_focus: "Внедрение товарного учёта",
      geography: "Москва",
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

function proposal(input, changedValues = {}) {
  const refs = {
    goal: [evidenceRef(input, "goal_revision", "goal-qualified-result")],
    business: [evidenceRef(input, "business_input", "business-boundaries")],
    snapshot: [evidenceRef(input, "analytics_evidence_snapshot", "snapshot-offer-audience")],
    policy: [evidenceRef(input, "policies", "policy-no-performance-promise")],
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
    ...changedValues,
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
  for (const dimensionId of Object.keys(changedValues)) {
    const correctionEvidence = input.business_input.evidence.find((item) => item.evidence_id.includes(`-${dimensionId}`));
    if (correctionEvidence) {
      referenceFor[dimensionId] = [evidenceRef(input, "business_input", correctionEvidence.evidence_id)];
    }
  }
  return {
    dimensions: CAMPAIGN_STRATEGY_DIMENSIONS.map((dimensionId) => ({
      dimension_id: dimensionId,
      value: values[dimensionId],
      rationale: `Основание для ${dimensionId}`,
      confidence: dimensionId === "target_result_cost" ? "LOW" : "HIGH",
      evidence_refs: referenceFor[dimensionId],
    })),
    rationale: "Стратегия полностью перепроверена с приоритетной правкой владельца.",
    confidence: "MEDIUM",
    conflicts: [],
  };
}

class MemoryStrategyStore {
  constructor(current) {
    this.current = structuredClone(current);
    this.compareAndSwapCalls = 0;
    this.conflictNext = false;
  }

  async loadCurrent() {
    return structuredClone(this.current);
  }

  async compareAndSwap(_ownerKey, expectedRevision, next) {
    this.compareAndSwapCalls += 1;
    if (this.conflictNext || this.current.state_revision !== expectedRevision) return false;
    this.current = structuredClone(next);
    return true;
  }
}

async function fixture(launchStatus = "COMPLETED") {
  const inputs = await strategyInputs();
  const strategy = await formAutonomousCampaignStrategy({
    inputs,
    acceptedAt: INITIAL_AT,
    model: {
      model_id: "fixture-strategy-agent-v1",
      async formCampaignStrategy(request) {
        return proposal(request);
      },
    },
  });
  const current = {
    schema_version: CURRENT_CAMPAIGN_STRATEGY_SCHEMA,
    owner_key: "owner-1",
    state_revision: 4,
    updated_at: INITIAL_AT,
    launch_status: launchStatus,
    strategy,
    inputs,
    campaign_pairs: [{
      pair_revision_id: "pair-a-r3",
      hypothesis_revision_id: "hypothesis-a-r3",
      draft_revision_id: "draft-a-r5",
    }, {
      pair_revision_id: "pair-b-r2",
      hypothesis_revision_id: "hypothesis-b-r2",
      draft_revision_id: "draft-b-r4",
    }],
    last_invalidation: null,
  };
  return { current, store: new MemoryStrategyStore(current) };
}

function correctionInput(store, strategyRevisionId, changes, model) {
  return {
    store,
    owner_key: "owner-1",
    expected_state_revision: 4,
    expected_strategy_revision_id: strategyRevisionId,
    changes,
    model,
    corrected_at: CORRECTED_AT,
  };
}

test("normalization-only correction preserves the exact current Strategy revision and every dependent pair", async () => {
  const { current, store } = await fixture();
  let modelCalls = 0;
  const result = await saveCampaignStrategyCorrection(correctionInput(
    store,
    current.strategy.strategy_revision_id,
    { geography: "  Москва\u00a0 " },
    {
      model_id: "must-not-run",
      async recheckCampaignStrategy() {
        modelCalls += 1;
        throw new Error("normalization-only corrections must not rerun the Agent");
      },
    },
  ));

  assert.equal(result.status, "NO_OP");
  assert.equal(result.material_change, false);
  assert.equal(result.current.strategy.strategy_revision_id, current.strategy.strategy_revision_id);
  assert.deepEqual(result.current.campaign_pairs, current.campaign_pairs);
  assert.equal(result.current.last_invalidation, null);
  assert.equal(store.compareAndSwapCalls, 0);
  assert.equal(modelCalls, 0);
});

test("correction is unavailable during an active launch", async () => {
  const { current, store } = await fixture("ACTIVE");
  let modelCalls = 0;

  await assert.rejects(
    saveCampaignStrategyCorrection(correctionInput(
      store,
      current.strategy.strategy_revision_id,
      { geography: "Москва и область" },
      {
        model_id: "must-not-run",
        async recheckCampaignStrategy() {
          modelCalls += 1;
          return { kind: "CANDIDATE", proposal: {} };
        },
      },
    )),
    (error) => error instanceof CampaignStrategyCorrectionError
      && error.code === "STRATEGY_CORRECTION_ACTIVE_LAUNCH"
      && /only outside an active launch/u.test(error.message),
  );
  assert.equal(modelCalls, 0);
  assert.equal(store.compareAndSwapCalls, 0);
  assert.equal((await store.loadCurrent()).strategy.strategy_revision_id, current.strategy.strategy_revision_id);
});

test("material priority correction is fully rechecked, creates one new current revision, and invalidates all dependent pairs", async () => {
  const { current, store } = await fixture();
  const callerCopy = structuredClone(current);
  const requests = [];
  const changes = { geography: "Москва и область", weekly_budget: 45_000 };

  const result = await saveCampaignStrategyCorrection(correctionInput(
    store,
    current.strategy.strategy_revision_id,
    changes,
    {
      model_id: "fixture-strategy-agent-v2",
      async recheckCampaignStrategy(request) {
        requests.push(request);
        assert.equal(Object.isFrozen(request), true);
        assert.equal(Object.isFrozen(request.strategy_request.business_input.content), true);
        assert.equal(request.correction.priority, "OWNER_BUSINESS_INPUT");
        assert.deepEqual(request.correction.changes, changes);
        assert.equal(
          request.strategy_request.business_input.content.owner_strategy_correction.precedence,
          "PRIORITY_BUSINESS_INPUT",
        );
        return { kind: "CANDIDATE", proposal: proposal(request.strategy_request, changes) };
      },
    },
  ));

  assert.equal(requests.length, 1);
  assert.equal(result.status, "SAVED");
  assert.equal(result.material_change, true);
  assert.equal(result.current.state_revision, 5);
  assert.notEqual(result.current.strategy.strategy_revision_id, current.strategy.strategy_revision_id);
  assert.equal(result.current.strategy.status, "AGENT_ACCEPTED");
  assert.equal(result.current.strategy.dimensions.find((item) => item.dimension_id === "geography").value, "Москва и область");
  assert.equal(result.current.strategy.dimensions.find((item) => item.dimension_id === "weekly_budget").value, 45_000);
  assert.equal(result.current.inputs.business_input.content.owner_strategy_correction.precedence, "PRIORITY_BUSINESS_INPUT");
  assert.equal(result.current.strategy.input_lineage.business_input.revision_id, result.current.inputs.business_input.revision_id);
  assert.deepEqual(result.invalidated_pairs, current.campaign_pairs);
  assert.deepEqual(result.current.last_invalidation.pairs, current.campaign_pairs);
  assert.deepEqual(result.current.campaign_pairs, []);
  assert.equal(result.current.strategy.authority.publication, "NOT_AUTHORIZED");
  assert.equal(result.current.strategy.authority.spend, "NOT_AUTHORIZED");
  assert.equal(result.current.strategy.budget_boundary.semantics, "RECOMMENDATION_ONLY");
  assert.deepEqual(current, callerCopy);
  assert.equal(store.compareAndSwapCalls, 1);
  assert.equal((await store.loadCurrent()).strategy.strategy_revision_id, result.current.strategy.strategy_revision_id);
});

test("exact fact, mandatory-policy, and Direct-capability conflicts preserve the current revision without silently undoing the edit", async () => {
  const cases = [{
    sourceKind: "CONFIRMED_FACT",
    sourceKey: "analytics_evidence_snapshot",
    evidenceId: "snapshot-offer-audience",
    dimensionId: "landing_page",
    editedValue: "https://owner.example/other",
    code: "LANDING_PAGE_FACT_CONFLICT",
  }, {
    sourceKind: "MANDATORY_POLICY",
    sourceKey: "policies",
    evidenceId: "policy-no-performance-promise",
    dimensionId: "core_message",
    editedValue: "Гарантируем удвоение продаж",
    code: "PERFORMANCE_PROMISE_POLICY_CONFLICT",
  }, {
    sourceKind: "DIRECT_CAPABILITY",
    sourceKey: "supported_draft_profile",
    evidenceId: "profile-search",
    dimensionId: "geography",
    editedValue: "Неподдерживаемый регион",
    code: "REGION_CAPABILITY_CONFLICT",
  }];

  for (const item of cases) {
    const { current, store } = await fixture();
    const sourceArtifact = item.sourceKey === "policies" ? current.inputs.policies[0] : current.inputs[item.sourceKey];
    const result = await saveCampaignStrategyCorrection(correctionInput(
      store,
      current.strategy.strategy_revision_id,
      { [item.dimensionId]: item.editedValue },
      {
        model_id: "fixture-conflict-agent",
        async recheckCampaignStrategy() {
          return {
            kind: "CONFLICT",
            conflict: {
              code: item.code,
              dimension_id: item.dimensionId,
              edited_value: item.editedValue,
              source_kind: item.sourceKind,
              source: {
                input_kind: sourceArtifact.kind,
                revision_id: sourceArtifact.revision_id,
                evidence_id: item.evidenceId,
                path: sourceArtifact.evidence[0].path,
              },
              description: `Правка ${item.dimensionId} нарушает точный источник ${item.evidenceId}.`,
            },
          };
        },
      },
    ));

    assert.equal(result.status, "CONFLICT");
    assert.equal(result.material_change, false);
    assert.equal(result.conflict.source_kind, item.sourceKind);
    assert.equal(result.conflict.source.revision_id, sourceArtifact.revision_id);
    assert.equal(result.conflict.source.evidence_id, item.evidenceId);
    assert.equal(result.conflict.source.path, sourceArtifact.evidence[0].path);
    assert.equal(result.conflict.dimension_id, item.dimensionId);
    assert.equal(result.conflict.edited_value, item.editedValue);
    assert.equal(result.current.strategy.strategy_revision_id, current.strategy.strategy_revision_id);
    assert.deepEqual(result.current.campaign_pairs, current.campaign_pairs);
    assert.equal(store.compareAndSwapCalls, 0);
  }
});

test("an Agent cannot silently drop a priority edit or cite an inexact conflict source", async () => {
  const first = await fixture();
  await assert.rejects(
    saveCampaignStrategyCorrection(correctionInput(
      first.store,
      first.current.strategy.strategy_revision_id,
      { geography: "Москва и область" },
      {
        model_id: "silent-drop-agent",
        async recheckCampaignStrategy(request) {
          return { kind: "CANDIDATE", proposal: proposal(request.strategy_request) };
        },
      },
    )),
    (error) => error instanceof CampaignStrategyCorrectionError
      && error.code === "STRATEGY_CORRECTION_SILENTLY_DROPPED",
  );
  assert.equal(first.store.compareAndSwapCalls, 0);

  const second = await fixture();
  await assert.rejects(
    saveCampaignStrategyCorrection(correctionInput(
      second.store,
      second.current.strategy.strategy_revision_id,
      { geography: "Москва и область" },
      {
        model_id: "invented-conflict-agent",
        async recheckCampaignStrategy() {
          return {
            kind: "CONFLICT",
            conflict: {
              code: "INVENTED_FACT_CONFLICT",
              dimension_id: "geography",
              edited_value: "Москва и область",
              source_kind: "CONFIRMED_FACT",
              source: {
                input_kind: "ANALYTICS_EVIDENCE_SNAPSHOT",
                revision_id: "invented-revision",
                evidence_id: "invented-evidence",
                path: "/invented",
              },
              description: "Правка конфликтует с придуманным источником.",
            },
          };
        },
      },
    )),
    (error) => error instanceof CampaignStrategyCorrectionError
      && error.code === "STRATEGY_CORRECTION_CONFLICT_SOURCE_UNKNOWN",
  );
  assert.equal(second.store.compareAndSwapCalls, 0);
});

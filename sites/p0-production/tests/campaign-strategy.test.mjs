import assert from "node:assert/strict";
import test from "node:test";

import {
  STRATEGY_FIELD_ORDER,
  buildStrategyQuestionnaire,
  normalizeStrategyAnswers,
  strategyAnswersFingerprint,
} from "../lib/campaign-strategy.ts";
import { P0_CURATED_PLAYBOOK_V1 } from "../lib/p0-curated-playbook-v1.ts";

const GENERATED_AT = "2026-08-24T12:00:00.000Z";

function input(overrides = {}) {
  return {
    contextState: {
      context_revision_id: "context-r1",
      material_fingerprint: `sha256:${"a".repeat(64)}`,
      business_goal_decision: { value: "Получать квалифицированные заявки" },
      facts: {
        site: { url: "https://owner.example/participate" },
        direct: {
          minimum_weekly_budget_rub: 300,
          capability_snapshot: {
            schema_version: "direct-account-capability-snapshot-v1",
            snapshot_id: "direct-capability:owner",
            source: "YANDEX_DIRECT_API_V501",
            account: "owner-account",
            observed_at: "2026-08-24T11:55:00.000Z",
            api_version: "v501",
            archived: "NO",
            currency: "RUB",
            edit_campaigns_grant: "YES",
            available_campaign_types: ["UNIFIED_CAMPAIGN"],
            restrictions: [],
            conditional_capabilities: [],
          },
        },
      },
    },
    model: {
      product: "Участие со стендом в промышленной выставке",
      audience: "Руководители производственных компаний",
      qualified_result: "Квалифицированная заявка на участие",
      exclusions: "Посетители без коммерческого намерения",
      value: "Найдите новых оптовых покупателей",
      field_evidence: {
        product: { confidence: "OWNER_CONFIRMED", owner_confirmed: true },
        audience: { confidence: "OWNER_CONFIRMED", owner_confirmed: true },
        qualified_result: { confidence: "OWNER_CONFIRMED", owner_confirmed: true },
        exclusions: { confidence: "OWNER_CONFIRMED", owner_confirmed: true },
        value: { confidence: "OWNER_CONFIRMED", owner_confirmed: true },
      },
      owner_contract: {
        model_revision_id: "business-model:r1",
        fields: {
          geography: { value: "Москва и Московская область", availability: "AVAILABLE", owner_confirmed: true },
        },
        economics: {
          status: "CONFIRMED",
          target_result_cost_rub: 40_000,
          limitation: null,
        },
      },
    },
    analyticsEvidence: {
      snapshot_id: `sha256:${"b".repeat(64)}`,
      recommendation_status: "EVIDENCE_READY_WITH_GAPS",
      conflicts: [],
      gaps: [],
      claims: [
        { predicate: "exact_goal_binding", confidence: { tier: "TIER_1_VERIFIED" } },
        { predicate: "observed_performance", confidence: { tier: "TIER_1_VERIFIED" } },
      ],
      market_evidence: {
        frequency: { status: "AVAILABLE" },
        cost: {
          status: "AVAILABLE",
          compact_source: "DIRECT_HISTORY_OWN_EMPIRICAL",
          selected_observation_id: "cost-history-1",
          scenario: "day-level P25-P75",
          scope: { comparison: { phrase: "Точное совпадение", geography: "Москва", placement: "Результаты поиска", strategy: "Максимум кликов", season: "Текущий сезон" } },
          as_of: "2026-08-23T12:00:00.000Z",
          currency: "RUB",
          vat_treatment: "INCLUDED",
          sample_size: { unit: "clicks", value: 42 },
          range: { low: 110, high: 170, kind: "EMPIRICAL_IQR" },
          missing_or_conflict_reasons: [],
        },
      },
    },
    productFocus: {
      focus_revision_id: "focus-r1",
      selected_offer_id: "offer-selected",
      decision_status: "OWNER_SELECTED",
      catalog: {
        offers: [{ offer_id: "offer-selected", label: "Участие со стендом", material_axes: { offer: "Участие со стендом в промышленной выставке" } }],
      },
    },
    playbookReleases: [structuredClone(P0_CURATED_PLAYBOOK_V1)],
    generatedAt: GENERATED_AT,
    ...overrides,
  };
}

test("builds a complete adaptive Campaign Strategy recommendation from exact lineage instead of questionnaire defaults", async () => {
  const questionnaire = await buildStrategyQuestionnaire(input());

  assert.deepEqual(questionnaire.fields.map((field) => field.field_id), STRATEGY_FIELD_ORDER);
  assert.equal(questionnaire.fields.find((field) => field.field_id === "campaign_focus").recommended_value, "Участие со стендом");
  assert.equal(questionnaire.fields.find((field) => field.field_id === "geography").recommended_value, "Москва и Московская область");
  assert.equal(questionnaire.fields.find((field) => field.field_id === "geography").prepared_decision, null);
  assert.equal(questionnaire.material_questions.some((question) => question.field_id === "geography"), false);
  assert.equal(questionnaire.recommendation.objective.value, "QUALIFIED_RESULT");
  assert.equal(questionnaire.recommendation.bidding.value, "WB_MAXIMUM_CLICKS");
  assert.deepEqual(questionnaire.recommendation.placements.value, ["SEARCH"]);
  assert.equal(questionnaire.recommendation.measurement.value, "EXACT_METRIKA_PRIMARY_GOAL");
  assert.equal(questionnaire.recommendation.economics.target_result_cost_rub, 40_000);
  assert.equal(questionnaire.recommendation.economics.uncertainty, null);
  assert.equal(questionnaire.recommendation.prelaunch_cost.status, "QUALIFIED_RANGE");
  assert.equal(questionnaire.recommendation.financial_context.status, "NOT_USED");
  assert.equal(questionnaire.recommendation.financial_context.advertising_performance_inference_allowed, false);
  assert.deepEqual(questionnaire.recommendation.prelaunch_cost.range, { low: 110, high: 170, currency: "RUB", unit: "COST_PER_CLICK" });
  assert.equal(questionnaire.recommendation.prelaunch_cost.source.kind, "DIRECT_HISTORY_OWN_EMPIRICAL");
  assert.equal(questionnaire.recommendation.prelaunch_cost.effectiveness_forecast, false);
  assert.equal(questionnaire.recommendation.prelaunch_cost.target_result_cost_used_as_keyword_cost, false);
  assert.match(questionnaire.recommendation.prelaunch_cost.consequences.join(" "), /не прогнозирует.*результат/iu);
  assert.equal(questionnaire.direct_capability_snapshot_id, "direct-capability:owner");
  assert.equal(questionnaire.product_focus_revision_id, "focus-r1");
  assert.equal(questionnaire.playbook_lineage.release_id, "p0-curated-playbook-v1");
  assert.deepEqual(questionnaire.playbook_lineage.rule_ids, ["p0-qualified-result-alignment"]);
  assert.deepEqual(questionnaire.human_decision_gate.unresolved_field_ids, ["period", "weekly_budget"]);
  assert.deepEqual(questionnaire.material_questions.map((item) => item.field_id), ["period", "weekly_budget"]);
  assert.ok(questionnaire.material_questions.every((item) => item.decision.owner_decision_required === true));
  assert.ok(questionnaire.material_questions.every((item) => ["LOW", "MEDIUM"].includes(item.decision.confidence)));
  assert.ok(questionnaire.material_questions.every((item) => item.decision.recommendation.length > 0 && item.decision.evidence.length > 0));
});

test("sparse or conflicting evidence creates a complete prepared Human Decision Gate and explicit safe fallback", async () => {
  const base = input();
  base.analyticsEvidence.claims = [];
  base.analyticsEvidence.recommendation_status = "BLOCKED_UNKNOWN";
  base.analyticsEvidence.conflicts = [{ conflict_id: "conflict-offer", predicate: "product", material: true, resolution: "UNRESOLVED_OWNER_DECISION" }];
  base.analyticsEvidence.gaps = [{ gap_id: "gap-measurement", code: "METRIKA_REPORT_UNAVAILABLE", description: "Нет подтверждённого отчёта результата", material: true }];
  base.model.owner_contract.economics = { status: "MATERIAL_UNCERTAINTY", target_result_cost_rub: null, limitation: "Маржа и конверсия в продажу не подтверждены." };
  base.analyticsEvidence.market_evidence.cost = {
    status: "UNAVAILABLE",
    range: null,
    missing_or_conflict_reasons: ["NO_QUALIFIED_PRELAUNCH_COST_SOURCE"],
  };

  const questionnaire = await buildStrategyQuestionnaire(base);

  assert.equal(questionnaire.recommendation.measurement.value, "PRE_LAUNCH_MEASUREMENT_VALIDATION");
  assert.equal(questionnaire.recommendation.measurement.confidence, "LOW");
  assert.equal(questionnaire.recommendation.economics.target_result_cost_rub, null);
  assert.match(questionnaire.recommendation.economics.uncertainty, /не подтверждены/u);
  assert.equal(questionnaire.recommendation.prelaunch_cost.status, "OWNER_ECONOMICS_EDIT_REQUIRED");
  assert.match(questionnaire.recommendation.prelaunch_cost.owner_action, /экономик/iu);
  assert.ok(questionnaire.human_decision_gate);
  assert.match(questionnaire.human_decision_gate.recommendation, /не утверждать|уточнить/iu);
  assert.ok(questionnaire.human_decision_gate.evidence.some((item) => item.includes("Нет подтверждённого отчёта")));
  assert.ok(questionnaire.human_decision_gate.alternatives.length >= 2);
  assert.ok(questionnaire.human_decision_gate.consequences.length >= 1);
  assert.equal(["LOW", "MEDIUM"].includes(questionnaire.human_decision_gate.confidence), true);
});

test("unavailable qualified cost chooses a bounded non-predictive traffic fallback when business economics is confirmed", async () => {
  const base = input();
  base.analyticsEvidence.market_evidence.cost = {
    status: "UNAVAILABLE",
    range: null,
    missing_or_conflict_reasons: ["NO_QUALIFIED_PRELAUNCH_COST_SOURCE"],
  };

  const questionnaire = await buildStrategyQuestionnaire(base);

  assert.equal(questionnaire.recommendation.prelaunch_cost.status, "BOUNDED_TRAFFIC_FALLBACK");
  assert.equal(questionnaire.recommendation.prelaunch_cost.range, null);
  assert.equal(questionnaire.recommendation.prelaunch_cost.source, null);
  assert.equal(questionnaire.recommendation.prelaunch_cost.effectiveness_forecast, false);
  assert.match(questionnaire.recommendation.prelaunch_cost.uncertainty, /недоступ/iu);
  assert.match(questionnaire.recommendation.prelaunch_cost.consequences.join(" "), /середин|чувствитель/iu);
});

test("conflicting qualified cost fails closed instead of selecting or averaging a source", async () => {
  const base = input();
  base.analyticsEvidence.market_evidence.cost = {
    status: "UNAVAILABLE",
    range: null,
    missing_or_conflict_reasons: ["CONFLICTING_COST_EVIDENCE"],
  };

  const questionnaire = await buildStrategyQuestionnaire(base);

  assert.equal(questionnaire.recommendation.prelaunch_cost.status, "COST_EVIDENCE_BLOCKED");
  assert.equal(questionnaire.recommendation.prelaunch_cost.range, null);
  assert.match(questionnaire.recommendation.prelaunch_cost.owner_action, /обнов/iu);
  assert.ok(questionnaire.human_decision_gate.evidence.some((item) => /конфликт/iu.test(item)));
});

test("Strategy receives only pre-gated financial claims that retain independent non-financial evidence", async () => {
  const base = input();
  base.analyticsEvidence.financial_competitor_intelligence = {
    schema_version: "p0-financial-competitor-intelligence-v1",
    capability_status: "PARTIAL",
    strategy_claims: [{
      interpretation_id: "niche-positioning",
      statement: "Наблюдаемая разница масштаба поддерживает проверку более узкого сообщения.",
      financial_record_refs: ["fer-company-2024", "fer-competitor-2024"],
      independent_nonfinancial_evidence_refs: ["claim:public-positioning"],
      affected_strategy_fields: ["campaign_focus", "core_message"],
      limitations: ["Выручка не доказывает рекламную эффективность."],
    }],
    suppressed_strategy_claims: [{
      interpretation_id: "financial-only",
      reason: "INDEPENDENT_NONFINANCIAL_EVIDENCE_REQUIRED",
    }],
  };

  const questionnaire = await buildStrategyQuestionnaire(base);

  assert.equal(questionnaire.recommendation.financial_context.status, "AVAILABLE");
  assert.deepEqual(questionnaire.recommendation.financial_context.claims.map((claim) => claim.interpretation_id), ["niche-positioning"]);
  assert.deepEqual(questionnaire.recommendation.financial_context.claims[0].independent_nonfinancial_evidence_refs, ["claim:public-positioning"]);
  assert.equal(questionnaire.recommendation.financial_context.claims.some((claim) => claim.interpretation_id === "financial-only"), false);
  assert.equal(questionnaire.recommendation.financial_context.advertising_performance_inference_allowed, false);
});

test("unsupported exact account capability stays explicit and fails closed without a provider default", async () => {
  const base = input();
  base.contextState.facts.direct.capability_snapshot.available_campaign_types = ["TEXT_CAMPAIGN"];

  const questionnaire = await buildStrategyQuestionnaire(base);

  assert.equal(questionnaire.recommendation.bidding.value, "UNAVAILABLE");
  assert.deepEqual(questionnaire.recommendation.placements.value, []);
  assert.equal(questionnaire.recommendation.bidding.fallback, true);
  assert.ok(questionnaire.human_decision_gate.evidence.some((item) => item.includes("capabilities")));
  assert.equal(questionnaire.human_decision_gate.confidence, "LOW");
});

test("campaign focus is owner-editable material meaning while normalization-only input preserves fingerprint", async () => {
  const values = {
    business_goal: "Получать квалифицированные заявки",
    campaign_focus: "Участие со стендом",
    advertised_offer: "Участие со стендом в промышленной выставке",
    target_audience: "Руководители компаний",
    qualified_result: "Квалифицированная заявка",
    exclusions: "Посетители",
    geography: "Москва",
    period: { start_date: "2026-09-01", end_date: "2026-10-01" },
    landing_page: "https://owner.example/participate",
    weekly_budget: 50_000,
    target_result_cost: 40_000,
    core_message: "Найдите покупателей",
  };
  const normalized = normalizeStrategyAnswers(values);
  const whitespace = normalizeStrategyAnswers({ ...values, campaign_focus: "  Участие   со стендом  " });

  assert.equal(normalized.campaign_focus, "Участие со стендом");
  assert.equal(await strategyAnswersFingerprint(normalized), await strategyAnswersFingerprint(whitespace));
  assert.notEqual(
    await strategyAnswersFingerprint(normalized),
    await strategyAnswersFingerprint(normalizeStrategyAnswers({ ...values, campaign_focus: "Партнёрский пакет" })),
  );
});

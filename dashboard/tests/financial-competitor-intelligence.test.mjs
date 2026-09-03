import assert from "node:assert/strict";
import test from "node:test";

import {
  FinancialCompetitorIntelligenceError,
  buildFinancialCompetitorIntelligence,
  verifyFinancialCompetitorIntelligence,
} from "../lib/financial-competitor-intelligence.ts";

const GENERATED_AT = "2026-08-31T12:00:00.000Z";

function frame() {
  return {
    product: {
      product_or_service: "Участие со стендом в промышленной выставке",
      customer_need: "Найти оптовых покупателей",
      included_offers: ["Проектирование и аренда стенда"],
      excluded_offers: ["Продажа входных билетов"],
      evidence_refs: ["claim:product"],
    },
    customer: {
      description: "Руководители производственных компаний",
      evidence_refs: ["claim:customer"],
    },
    geography: {
      kind: "SERVICE_AREA",
      regions: [{ official_id: "77", name: "Москва" }],
      evidence_refs: ["claim:geography"],
      limitation: null,
    },
    period: {
      period_start: "2023-01-01",
      period_end: "2024-12-31",
      reporting_years: [2023, 2024],
      as_of_date: "2026-08-31",
    },
    okved: {
      classifier: "OK_029_2014_KDES_REV_2",
      classifier_version: "2026-01-01",
      codes: [{ code: "82.30", inclusion: "REQUIRED_PRIMARY", rationale: "Организация выставок в подтверждённом продуктовом контуре." }],
      activity_rule_version: "okved-frame-v1",
    },
    competitor_rule: {
      version: "competitive-frame-v1",
      inclusion_rule: "Подтверждённое заменяемое предложение для той же аудитории и географии.",
    },
  };
}

function scope(overrides = {}) {
  return {
    product_or_service: "Участие со стендом в промышленной выставке",
    customer_need: "Найти оптовых покупателей",
    geography_official_ids: ["77"],
    period_start: "2023-01-01",
    period_end: "2024-12-31",
    okved_codes: ["82.30"],
    ...overrides,
  };
}

function entity(entityId, role, overrides = {}) {
  return {
    entity_id: entityId,
    role,
    inn: role === "COMPANY" ? "7701234567" : "7712345678",
    ogrn: role === "COMPANY" ? "1027700123456" : "1027700987654",
    legal_name: role === "COMPANY" ? "ООО Компания" : "ООО Конкурент",
    relation: "OPERATOR",
    resolution_status: "CONFIRMED",
    evidence: [
      {
        evidence_ref: `egrul:${entityId}`,
        evidence_kind: "LEGAL_IDENTITY",
        source_kind: "EGRUL",
        source_locator: `https://egrul.nalog.ru/${entityId}`,
        observed_at: GENERATED_AT,
        status: "VERIFIED",
      },
      {
        evidence_ref: `site:${entityId}`,
        evidence_kind: "BRAND_OR_PRODUCT_RELATION",
        source_kind: "OFFICIAL_BRAND_DISCLOSURE",
        source_locator: `https://${entityId}.example/legal`,
        observed_at: GENERATED_AT,
        status: "VERIFIED",
      },
    ],
    ...overrides,
  };
}

function record(recordId, entityId, year, value, overrides = {}) {
  return {
    record_id: recordId,
    entity_id: entityId,
    reporting_year: year,
    period_start: `${year}-01-01`,
    period_end: `${year}-12-31`,
    statement_kind: "FINANCIAL_RESULTS",
    form_variant: "FULL",
    accounting_standard: year >= 2025 ? "FSBU_4_2023" : "PBU_4_99",
    format_version: `gir-bo-${year}`,
    column_role: "CURRENT",
    metric: "REVENUE",
    line_code: "2110",
    line_name_raw: "Выручка",
    value_raw: value,
    value_decimal: value,
    unit_raw: "тыс. руб.",
    unit_multiplier: 1000,
    currency: "RUB",
    provenance: {
      source_system: "GIR_BO_FNS",
      access_channel: "OFFICIAL_SUBSCRIPTION_BULK",
      source_locator: `gir-bo://subscription/${entityId}/${year}`,
      source_file_name: `${entityId}-${year}.xml`,
      source_hash_sha256: `sha256:${"a".repeat(64)}`,
      signature_present: null,
      signature_verified: null,
      fetched_at: GENERATED_AT,
      resource_as_of_date: "2026-08-31",
      parser_name: "gir-bo-xml",
      parser_version: "1.0.0",
    },
    revision: { correction_indicator: "ORIGINAL", supersedes_record_id: null },
    quality: {
      status: "ACCEPTED",
      flags: [],
      identity_match: "PASS",
      period_valid: "PASS",
      unit_known: "PASS",
    },
    ...overrides,
  };
}

function input() {
  return {
    frame: frame(),
    legal_entities: [
      entity("company", "COMPANY"),
      entity("competitor", "COMPETITOR"),
      entity("unresolved", "COMPETITOR", {
        inn: "7723456789",
        ogrn: "1027700111222",
        legal_name: "ООО Неподтверждённый кандидат",
        resolution_status: "UNRESOLVED",
      }),
    ],
    financial_records: [
      record("fer-company-2023", "company", 2023, "125000.50"),
      record("fer-company-2024", "company", 2024, "150000"),
      record("fer-competitor-2024", "competitor", 2024, "300000"),
      record("fer-unresolved-2024", "unresolved", 2024, "999999"),
    ],
    missing_financial_data: [{
      entity_id: "competitor",
      reporting_year: 2023,
      metric: "REVENUE",
      reason: "ACCESS_RESTRICTED",
      source_ref: "gir-bo:competitor:2023",
      limitation: "Доступ к отчётности ограничен; значение неизвестно.",
    }],
    observed_segment_revenue_share: {
      reporting_year: 2024,
      population_frame_complete: false,
      company_group_policy: "SINGLE_ENTITY",
      revenue_attributions: [
        {
          financial_record_ref: "fer-company-2024",
          scope: scope(),
          attribution_policy: "WHOLE_ENTITY_IF_SINGLE_ACTIVITY",
          evidence_refs: ["claim:company-single-activity"],
        },
        {
          financial_record_ref: "fer-competitor-2024",
          scope: scope(),
          attribution_policy: "DIRECT_SEGMENT_DISCLOSURE",
          evidence_refs: ["claim:competitor-segment-disclosure"],
        },
      ],
    },
    strategic_interpretations: [
      {
        interpretation_id: "niche-positioning",
        statement: "Наблюдаемая разница масштаба вместе с подтверждённой специализацией поддерживает проверку более узкого позиционирования.",
        financial_record_refs: ["fer-company-2024", "fer-competitor-2024"],
        independent_nonfinancial_evidence: [{ evidence_ref: "claim:specialization", family: "POSITIONING", scope: scope() }],
        competing_explanations: ["Выручка может включать другие продукты."],
        limitations: ["Наблюдение не устанавливает причину различия."],
        affected_strategy_fields: ["campaign_focus", "core_message"],
        falsifiable_consequence: "Узкое сообщение должно улучшить долю квалифицированных обращений в будущем тесте.",
      },
      {
        interpretation_id: "financial-only",
        statement: "Наблюдаемая выручка выросла.",
        financial_record_refs: ["fer-company-2024"],
        independent_nonfinancial_evidence: [],
        competing_explanations: [],
        limitations: [],
        affected_strategy_fields: ["core_message"],
        falsifiable_consequence: null,
      },
      {
        interpretation_id: "forbidden-budget",
        statement: "Высокая выручка доказывает рекламный бюджет конкурента.",
        financial_record_refs: ["fer-competitor-2024"],
        independent_nonfinancial_evidence: [{ evidence_ref: "claim:positioning", family: "POSITIONING", scope: scope() }],
        competing_explanations: [],
        limitations: [],
        affected_strategy_fields: ["core_message"],
        falsifiable_consequence: null,
      },
    ],
    generated_at: GENERATED_AT,
  };
}

test("freezes the exact analysis frame, excludes unresolved entities and preserves missing financial data as null", async () => {
  const dossier = await buildFinancialCompetitorIntelligence(input());

  assert.match(dossier.dossier_id, /^sha256:[a-f0-9]{64}$/u);
  assert.match(dossier.frozen_frame.frame_id, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(await verifyFinancialCompetitorIntelligence(dossier), true);
  const corrupted = structuredClone(dossier);
  corrupted.accepted_records[0].normalized_value_rub = "0";
  assert.equal(await verifyFinancialCompetitorIntelligence(corrupted), false);
  assert.equal(Object.isFrozen(dossier), true);
  assert.deepEqual(dossier.legal_perimeter.accepted_entities.map((item) => item.entity_id), ["company", "competitor"]);
  assert.deepEqual(dossier.legal_perimeter.excluded_entities, [{
    entity_id: "unresolved",
    legal_name: "ООО Неподтверждённый кандидат",
    reason: "ENTITY_UNRESOLVED",
  }]);
  assert.equal(dossier.accepted_records.some((item) => item.entity_id === "unresolved"), false);
  assert.deepEqual(dossier.excluded_records.find((item) => item.record_id === "fer-unresolved-2024"), {
    record_id: "fer-unresolved-2024",
    entity_id: "unresolved",
    reason: "ENTITY_NOT_IN_ACCEPTED_LEGAL_PERIMETER",
  });
  assert.equal(dossier.accepted_records.find((item) => item.record_id === "fer-company-2023").normalized_value_rub, "125000500");
  const unavailable = dossier.profiles.find((item) => item.entity_id === "competitor").observations.find((item) => item.reporting_year === 2023);
  assert.equal(unavailable.status, "UNAVAILABLE");
  assert.equal(unavailable.value_rub, null);
  assert.equal(unavailable.missing_reason, "ACCESS_RESTRICTED");
  assert.equal(dossier.capability_status, "PARTIAL");
  assert.deepEqual(dossier.coverage, {
    candidate_entities: 3,
    accepted_entities: 2,
    entities_with_records: 2,
    entities_without_records: [],
  });
  assert.equal(dossier.observed_segment_revenue_share.label, "Observed Segment Revenue Share");
  assert.equal(dossier.observed_segment_revenue_share.status, "AVAILABLE_PARTIAL_OBSERVED_COHORT");
  assert.equal(dossier.observed_segment_revenue_share.value_percent, "33.33");
  assert.deepEqual(dossier.observed_segment_revenue_share.numerator, {
    value_rub: "150000000",
    entity_ids: ["company"],
    financial_record_refs: ["fer-company-2024"],
  });
  assert.deepEqual(dossier.observed_segment_revenue_share.denominator, {
    value_rub: "450000000",
    entity_ids: ["company", "competitor"],
    financial_record_refs: ["fer-company-2024", "fer-competitor-2024"],
  });
  assert.deepEqual(dossier.observed_segment_revenue_share.coverage, {
    population_entities: 2,
    accepted_entities: 2,
    observed_entities: 2,
    entity_observation_ratio: "100",
    revenue_coverage_ratio: null,
    frame_state: "PARTIAL",
  });
  assert.deepEqual(dossier.observed_segment_revenue_share.missing_entities, []);
  assert.match(dossier.observed_segment_revenue_share.limitation, /не является долей рынка/iu);
});

test("passes a financial Strategy statement only with independent non-financial evidence in the same scope", async () => {
  const dossier = await buildFinancialCompetitorIntelligence(input());

  assert.deepEqual(dossier.strategy_claims.map((item) => item.interpretation_id), ["niche-positioning"]);
  assert.deepEqual(dossier.strategy_claims[0].independent_nonfinancial_evidence_refs, ["claim:specialization"]);
  assert.deepEqual(dossier.suppressed_strategy_claims, [
    { interpretation_id: "financial-only", reason: "INDEPENDENT_NONFINANCIAL_EVIDENCE_REQUIRED" },
    { interpretation_id: "forbidden-budget", reason: "PROHIBITED_FINANCIAL_INFERENCE" },
  ]);
  assert.match(dossier.prohibited_inferences.join(" "), /бюджет.*эффективност/iu);
  assert.match(dossier.limitations.join(" "), /не означают нулевую/iu);
});

test("suppresses independent evidence from a different geography and excludes incomplete legal identity evidence", async () => {
  const value = input();
  value.legal_entities[1].evidence = value.legal_entities[1].evidence.filter((item) => item.evidence_kind === "LEGAL_IDENTITY");
  value.missing_financial_data = [];
  value.strategic_interpretations = [{
    ...value.strategic_interpretations[0],
    interpretation_id: "wrong-scope",
    financial_record_refs: ["fer-company-2024"],
    independent_nonfinancial_evidence: [{ evidence_ref: "claim:other-region", family: "POSITIONING", scope: scope({ geography_official_ids: ["78"] }) }],
  }];

  const dossier = await buildFinancialCompetitorIntelligence(value);
  assert.deepEqual(dossier.legal_perimeter.excluded_entities.map((item) => ({ entity_id: item.entity_id, reason: item.reason })), [
    { entity_id: "competitor", reason: "IDENTITY_EVIDENCE_INCOMPLETE" },
    { entity_id: "unresolved", reason: "ENTITY_UNRESOLVED" },
  ]);
  assert.deepEqual(dossier.strategy_claims, []);
  assert.deepEqual(dossier.suppressed_strategy_claims, [{ interpretation_id: "wrong-scope", reason: "NONFINANCIAL_SCOPE_MISMATCH" }]);
});

test("does not calculate Observed Segment Revenue Share across a mismatched geography", async () => {
  const value = input();
  value.observed_segment_revenue_share.revenue_attributions[1].scope = scope({ geography_official_ids: ["78"] });

  const dossier = await buildFinancialCompetitorIntelligence(value);

  assert.equal(dossier.observed_segment_revenue_share.status, "SEMANTICS_MISMATCH");
  assert.equal(dossier.observed_segment_revenue_share.value_percent, null);
  assert.deepEqual(dossier.observed_segment_revenue_share.excluded_attributions, [{
    financial_record_ref: "fer-competitor-2024",
    reason: "SEMANTICS_MISMATCH",
  }]);
  assert.deepEqual(dossier.observed_segment_revenue_share.missing_entities.map((item) => item.entity_id), ["competitor"]);
});

test("rejects a financial record whose form and line do not match the canonical metric", async () => {
  const value = input();
  value.financial_records[0] = record("bad-assets", "company", 2023, "100", {
    metric: "ASSETS",
    statement_kind: "FINANCIAL_RESULTS",
    line_code: "2110",
  });

  await assert.rejects(
    buildFinancialCompetitorIntelligence(value),
    (error) => error instanceof FinancialCompetitorIntelligenceError && error.code === "FINANCIAL_METRIC_SEMANTICS_INVALID",
  );
});

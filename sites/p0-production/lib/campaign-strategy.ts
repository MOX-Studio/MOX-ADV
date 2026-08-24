import { resolveCuratedPlaybookReleases, type CuratedPlaybookRelease } from "./campaign-playbook.ts";
import { cleanText } from "./text.ts";

export const STRATEGY_QUESTIONNAIRE_SCHEMA = "p0-strategy-questionnaire-v2";
export const STRATEGY_QUESTIONNAIRE_CONTRACT_VERSION = "2.0.0";
export const CAMPAIGN_STRATEGY_SCHEMA = "p0-campaign-strategy-v2";

export const STRATEGY_FIELD_ORDER = [
  "business_goal",
  "campaign_focus",
  "advertised_offer",
  "target_audience",
  "qualified_result",
  "exclusions",
  "geography",
  "period",
  "landing_page",
  "weekly_budget",
  "target_result_cost",
  "core_message",
] as const;

export type StrategyFieldId = typeof STRATEGY_FIELD_ORDER[number];
export type StrategySourceCategory = "сайт" | "Директ" | "Метрика" | "аналитика агента" | "решение владельца";
export type StrategyFieldStatus = "уверенно" | "нужно проверить" | "нет данных";
export type StrategyPeriod = { start_date: string; end_date: string };
export type StrategyAnswerValue = string | number | StrategyPeriod;

export type PreparedStrategyDecision = {
  required: true;
  question: string;
  recommendation: string;
  evidence: string[];
  confidence: "LOW" | "MEDIUM";
  alternatives: string[];
  consequences: string[];
};

export type StrategyQuestionnaireField = {
  field_id: StrategyFieldId;
  recommended_value: StrategyAnswerValue | null;
  explanation: string;
  source_category: StrategySourceCategory;
  status: StrategyFieldStatus;
  prepared_decision: PreparedStrategyDecision | null;
};

type RecommendationItem<T> = {
  value: T;
  rationale: string;
  evidence: string[];
  confidence: "HIGH" | "MEDIUM" | "LOW";
  fallback: boolean;
};

export type StrategyPrelaunchCostDecision = {
  status: "QUALIFIED_RANGE" | "BOUNDED_TRAFFIC_FALLBACK" | "OWNER_ECONOMICS_EDIT_REQUIRED" | "COST_EVIDENCE_BLOCKED";
  semantic: "KEYWORD_COST_PER_CLICK_AUCTION_PROXY";
  range: { low: number; high: number; currency: string; unit: "COST_PER_CLICK" } | null;
  source: {
    kind: string;
    selected_observation_id: string | null;
    scenario: string;
    observed_at: string;
    vat_treatment: string;
    sample_size: { unit: string; value: number };
    scope: Record<string, unknown>;
  } | null;
  uncertainty: string;
  consequences: string[];
  owner_action: string | null;
  effectiveness_forecast: false;
  target_result_cost_used_as_keyword_cost: false;
};

export type StrategyDeliveryRecommendation = {
  objective: RecommendationItem<"QUALIFIED_RESULT" | "TRAFFIC_VALIDATION">;
  bidding: RecommendationItem<"WB_MAXIMUM_CLICKS" | "UNAVAILABLE">;
  placements: RecommendationItem<Array<"SEARCH">>;
  measurement: RecommendationItem<"EXACT_METRIKA_PRIMARY_GOAL" | "PRE_LAUNCH_MEASUREMENT_VALIDATION">;
  economics: {
    target_result_cost_rub: number | null;
    uncertainty: string | null;
    provenance: "CONFIRMED_BUSINESS_MODEL_ECONOMICS" | "MATERIAL_UNCERTAINTY";
  };
  prelaunch_cost: StrategyPrelaunchCostDecision;
};

export type StrategyHumanDecisionGate = {
  reason: "MATERIAL_GAPS_OR_CONFLICTS";
  recommendation: string;
  evidence: string[];
  confidence: "LOW" | "MEDIUM";
  alternatives: string[];
  consequences: string[];
  unresolved_field_ids: StrategyFieldId[];
};

export type StrategyQuestionnaire = {
  schema_version: typeof STRATEGY_QUESTIONNAIRE_SCHEMA;
  contract_version: typeof STRATEGY_QUESTIONNAIRE_CONTRACT_VERSION;
  questionnaire_id: string;
  generated_at: string;
  context_revision_id: string;
  context_material_fingerprint: string;
  business_model_revision_id: string;
  analytics_evidence_snapshot_id: string;
  product_focus_revision_id: string;
  direct_capability_snapshot_id: string;
  playbook_lineage: {
    release_id: string | null;
    release_version: string | null;
    release_digest: string | null;
    rule_ids: string[];
    rule_digests: string[];
  };
  recommendation: StrategyDeliveryRecommendation;
  material_questions: Array<{ field_id: StrategyFieldId; decision: PreparedStrategyDecision }>;
  human_decision_gate: StrategyHumanDecisionGate | null;
  fields: StrategyQuestionnaireField[];
};

export type CampaignStrategyRevision = {
  schema_version: typeof CAMPAIGN_STRATEGY_SCHEMA;
  strategy_revision_id: string;
  questionnaire_id: string;
  questionnaire_contract_version: string;
  context_revision_id: string;
  context_material_fingerprint: string;
  business_model_revision_id: string;
  analytics_evidence_snapshot_id: string;
  product_focus_revision_id: string;
  direct_capability_snapshot_id: string;
  playbook_lineage: StrategyQuestionnaire["playbook_lineage"];
  recommendation: StrategyDeliveryRecommendation;
  target_result_cost_uncertainty: string | null;
  answers: Array<{ field_id: StrategyFieldId; value: StrategyAnswerValue | null }>;
  material_fingerprint: string;
  approved_at: string;
  approved_by: "OWNER";
  approval_command: "APPROVE_CAMPAIGN_STRATEGY";
  lineage: { previous_strategy_revision_id: string | null };
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizedText(value: unknown, maximum = 2_000) {
  return cleanText(String(value ?? "").normalize("NFKC"), maximum);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalize(item)]));
}

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

function modelRecommendation(model: Record<string, unknown>, fieldId: "product" | "audience" | "qualified_result" | "exclusions" | "value") {
  const value = normalizedText(model[fieldId]);
  const evidence = record(record(model.field_evidence)[fieldId]);
  const confidence = normalizedText(evidence.confidence, 100);
  const sourceCategory: StrategySourceCategory = evidence.owner_edited === true
    ? "решение владельца"
    : normalizedText(evidence.source_url) ? "сайт"
      : evidence.owner_confirmed === true ? "решение владельца" : "аналитика агента";
  const status: StrategyFieldStatus = !value ? "нет данных"
    : ["HIGH", "OWNER_CONFIRMED"].includes(confidence) ? "уверенно" : "нужно проверить";
  return { value: value || null, sourceCategory, status };
}

function missingDecision(question: string, recommendation: string, evidence: string[], consequences: string[]): PreparedStrategyDecision {
  return {
    required: true,
    question,
    recommendation,
    evidence,
    confidence: evidence.length ? "MEDIUM" : "LOW",
    alternatives: ["Принять рекомендацию агента", "Указать другое бизнес-значение и пересчитать зависимые результаты"],
    consequences,
  };
}

function preparedField(fieldId: StrategyFieldId, explanation: string, question: string, recommendation: string, evidence: string[], consequences: string[]): StrategyQuestionnaireField {
  return {
    field_id: fieldId,
    recommended_value: null,
    explanation,
    source_category: "решение владельца",
    status: "нет данных",
    prepared_decision: missingDecision(question, recommendation, evidence, consequences),
  };
}

function selectedFocus(productFocus: Record<string, unknown>, model: Record<string, unknown>) {
  const selectedId = normalizedText(productFocus.selected_offer_id, 255);
  const offers = list(record(productFocus.catalog).offers).map(record);
  const selected = offers.find((offer) => normalizedText(offer.offer_id, 255) === selectedId);
  return {
    value: normalizedText(selected?.label ?? record(selected?.material_axes).offer ?? model.product) || null,
    revisionId: normalizedText(productFocus.focus_revision_id, 255),
  };
}

function exactCapability(contextState: Record<string, unknown>) {
  const capability = record(record(record(contextState.facts).direct).capability_snapshot);
  const valid = capability.schema_version === "direct-account-capability-snapshot-v1"
    && capability.source === "YANDEX_DIRECT_API_V501"
    && capability.api_version === "v501"
    && capability.archived === "NO"
    && capability.edit_campaigns_grant === "YES"
    && list(capability.available_campaign_types).map(String).includes("UNIFIED_CAMPAIGN")
    && Boolean(normalizedText(capability.snapshot_id, 255));
  return { capability, valid, snapshotId: normalizedText(capability.snapshot_id, 255) };
}

function measurementEvidence(analyticsEvidence: Record<string, unknown>) {
  const claims = list(analyticsEvidence.claims).map(record);
  const exactGoal = claims.find((claim) => claim.predicate === "exact_goal_binding");
  const performance = claims.find((claim) => claim.predicate === "observed_performance");
  const exactTier = normalizedText(record(exactGoal?.confidence).tier, 100);
  const performanceTier = normalizedText(record(performance?.confidence).tier, 100);
  return {
    ready: Boolean(exactGoal && performance && exactTier === "TIER_1_VERIFIED" && ["TIER_1_VERIFIED", "TIER_2_CORROBORATED"].includes(performanceTier)),
    exactGoal: Boolean(exactGoal),
    performance: Boolean(performance),
  };
}

export function buildStrategyPrelaunchCostDecision(
  analyticsEvidence: Record<string, unknown>,
  confirmedEconomics: boolean,
): StrategyPrelaunchCostDecision {
  const cost = record(record(analyticsEvidence.market_evidence).cost);
  const range = record(cost.range);
  const low = Number(range.low);
  const high = Number(range.high);
  const qualified = cost.status === "AVAILABLE"
    && Number.isFinite(low) && low >= 0
    && Number.isFinite(high) && high >= low
    && Boolean(normalizedText(cost.compact_source, 255))
    && Boolean(normalizedText(cost.currency, 20));
  const common = {
    semantic: "KEYWORD_COST_PER_CLICK_AUCTION_PROXY" as const,
    effectiveness_forecast: false as const,
    target_result_cost_used_as_keyword_cost: false as const,
  };
  if (qualified) {
    const sample = record(cost.sample_size);
    return {
      ...common,
      status: "QUALIFIED_RANGE",
      range: { low, high, currency: normalizedText(cost.currency, 20), unit: "COST_PER_CLICK" },
      source: {
        kind: normalizedText(cost.compact_source, 255),
        selected_observation_id: normalizedText(cost.selected_observation_id, 255) || null,
        scenario: normalizedText(cost.scenario, 500),
        observed_at: normalizedText(cost.as_of, 100),
        vat_treatment: normalizedText(cost.vat_treatment, 100),
        sample_size: { unit: normalizedText(sample.unit, 100), value: Number(sample.value) },
        scope: record(cost.scope),
      },
      uncertainty: "Диапазон описывает стоимость перехода в сопоставимом аукционном scope, а не стоимость квалифицированного бизнес-результата.",
      consequences: [
        "Диапазон участвует только в оценке покупательной способности недельного бюджета и сравнительной предстартовой чувствительности.",
        "Он не прогнозирует число результатов, CPA, прибыль или эффективность кампании.",
      ],
      owner_action: null,
    };
  }
  const reasons = list(cost.missing_or_conflict_reasons).map((item) => normalizedText(item, 255)).filter(Boolean);
  const conflicting = reasons.includes("CONFLICTING_COST_EVIDENCE") || cost.status === "CONFLICTING";
  if (conflicting) {
    return {
      ...common,
      status: "COST_EVIDENCE_BLOCKED",
      range: null,
      source: null,
      uncertainty: "Квалифицированные источники стоимости конфликтуют; ни один диапазон не выбран и источники не усредняются.",
      consequences: ["Campaign Draft и предстартовая оценка заблокированы до разрешения конфликта стоимости."],
      owner_action: "Обновить разрешённые API-наблюдения стоимости и разрешить конфликт сопоставимого scope.",
    };
  }
  if (!confirmedEconomics) {
    return {
      ...common,
      status: "OWNER_ECONOMICS_EDIT_REQUIRED",
      range: null,
      source: null,
      uncertainty: "Сопоставимая стоимость перехода недоступна, а безопасный бизнес-предел результата не подтверждён.",
      consequences: ["Campaign Draft остаётся заблокированным: неизвестную цену перехода нельзя подменить целевой стоимостью результата."],
      owner_action: "Уточнить и подтвердить экономику результата; агент затем повторит разрешённое исследование стоимости.",
    };
  }
  return {
    ...common,
    status: "BOUNDED_TRAFFIC_FALLBACK",
    range: null,
    source: null,
    uncertainty: "Квалифицированная сопоставимая стоимость перехода недоступна; недоступное не считается нулём.",
    consequences: [
      "Используется ограниченная недельным бюджетом проверка трафика без обещания стоимости результата.",
      "Измерение стоимости получает неизвестную середину 50 и полный диапазон чувствительности 0–100.",
    ],
    owner_action: null,
  };
}

async function buildRecommendation(
  contextState: Record<string, unknown>,
  model: Record<string, unknown>,
  analyticsEvidence: Record<string, unknown>,
): Promise<StrategyDeliveryRecommendation> {
  const capability = exactCapability(contextState);
  const measurement = measurementEvidence(analyticsEvidence);
  const economics = record(record(model.owner_contract).economics);
  const confirmedEconomics = economics.status === "CONFIRMED"
    && Number.isSafeInteger(Number(economics.target_result_cost_rub))
    && Number(economics.target_result_cost_rub) > 0;
  const measurementItem: StrategyDeliveryRecommendation["measurement"] = measurement.ready ? {
    value: "EXACT_METRIKA_PRIMARY_GOAL",
    rationale: "Точная primary goal binding и наблюдаемая performance подтверждены evidence официального API Метрики.",
    evidence: ["Точная цель Метрики подтверждена", "Наблюдаемая performance цели доступна"],
    confidence: "HIGH",
    fallback: false,
  } : {
    value: "PRE_LAUNCH_MEASUREMENT_VALIDATION",
    rationale: "До подтверждения точной цели и достаточного наблюдения используется безопасная проверка измерения, а не выдуманный conversion default.",
    evidence: [measurement.exactGoal ? "Точная цель найдена" : "Точная цель не подтверждена", measurement.performance ? "Performance доступна с ограничениями" : "Performance результата недоступна"],
    confidence: "LOW",
    fallback: true,
  };
  return {
    objective: measurement.ready && confirmedEconomics ? {
      value: "QUALIFIED_RESULT",
      rationale: "Qualified result и его economics подтверждены Business Model и Analytics Evidence.",
      evidence: ["Квалифицированный результат определён", "Economics подтверждена", "Measurement подтверждено"],
      confidence: "HIGH",
      fallback: false,
    } : {
      value: "TRAFFIC_VALIDATION",
      rationale: "До устранения measurement/economics uncertainty цель ограничена проверкой качественного трафика без обещания результата.",
      evidence: [measurement.ready ? "Measurement подтверждено" : "Measurement требует проверки", confirmedEconomics ? "Economics подтверждена" : "Economics не подтверждена"],
      confidence: "LOW",
      fallback: true,
    },
    bidding: capability.valid ? {
      value: "WB_MAXIMUM_CLICKS",
      rationale: "Выбран только поддержанный P0 search bidding profile точного Direct account; conversion bidding не предполагается без capability evidence.",
      evidence: [`Direct capability snapshot ${capability.snapshotId} подтверждает UNIFIED_CAMPAIGN и право редактирования`],
      confidence: "HIGH",
      fallback: false,
    } : {
      value: "UNAVAILABLE",
      rationale: "Bidding не выбирается без точного поддержанного account capability snapshot.",
      evidence: ["Exact Direct capability profile недоступен или не поддерживает P0 campaign type"],
      confidence: "LOW",
      fallback: true,
    },
    placements: capability.valid ? {
      value: ["SEARCH"],
      rationale: "P0 включает только явно поддержанный Search scope; Network и Product Gallery не включаются молча.",
      evidence: [`Direct capability snapshot ${capability.snapshotId}`, "Curated P0 capability profile ограничен Search"],
      confidence: "HIGH",
      fallback: false,
    } : {
      value: [],
      rationale: "Размещения не выбираются без exact account capability evidence.",
      evidence: ["Exact Direct capability profile недоступен"],
      confidence: "LOW",
      fallback: true,
    },
    measurement: measurementItem,
    economics: {
      target_result_cost_rub: confirmedEconomics ? Number(economics.target_result_cost_rub) : null,
      uncertainty: confirmedEconomics ? null : normalizedText(economics.limitation, 1_000) || "Target result cost неизвестна: economics не подтверждена.",
      provenance: confirmedEconomics ? "CONFIRMED_BUSINESS_MODEL_ECONOMICS" : "MATERIAL_UNCERTAINTY",
    },
    prelaunch_cost: buildStrategyPrelaunchCostDecision(analyticsEvidence, confirmedEconomics),
  };
}

export async function buildStrategyQuestionnaire({
  contextState,
  model,
  analyticsEvidence,
  productFocus = {},
  playbookReleases = [],
  generatedAt,
}: {
  contextState: Record<string, unknown>;
  model: Record<string, unknown>;
  analyticsEvidence: Record<string, unknown>;
  productFocus?: Record<string, unknown>;
  playbookReleases?: CuratedPlaybookRelease[];
  generatedAt: string;
}): Promise<StrategyQuestionnaire> {
  const contextDecision = record(contextState.business_goal_decision);
  const contextFacts = record(contextState.facts);
  const goal = normalizedText(contextDecision.value, 500);
  const offer = modelRecommendation(model, "product");
  const audience = modelRecommendation(model, "audience");
  const qualifiedResult = modelRecommendation(model, "qualified_result");
  const exclusions = modelRecommendation(model, "exclusions");
  const message = modelRecommendation(model, "value");
  const focus = selectedFocus(productFocus, model);
  const landing = normalizedText(record(contextFacts.site).url, 2_000);
  const ownerContract = record(model.owner_contract);
  const contractFields = record(ownerContract.fields);
  const geographyField = record(contractFields.geography);
  const geography = normalizedText(geographyField.value, 255);
  const recommendation = await buildRecommendation(contextState, model, analyticsEvidence);
  const minimumWeeklyBudget = Number(record(contextFacts.direct).minimum_weekly_budget_rub);
  const budgetEvidence = Number.isFinite(minimumWeeklyBudget) && minimumWeeklyBudget > 0
    ? [`Direct technical minimum is ${minimumWeeklyBudget} ₽/week; it is not a business budget.`]
    : [];

  const fields: StrategyQuestionnaireField[] = [
    { field_id: "business_goal", recommended_value: goal || null, explanation: "Цель подтверждена владельцем в Context.", source_category: "решение владельца", status: goal ? "уверенно" : "нет данных", prepared_decision: goal ? null : missingDecision("Какой бизнес-результат должна поддержать кампания?", "Зафиксировать один измеримый бизнес-результат.", [], ["Без цели Recommendation Set не имеет бизнес-якоря."]) },
    { field_id: "campaign_focus", recommended_value: focus.value, explanation: "Фокус взят из выбранного materially distinct Product Focus.", source_category: "решение владельца", status: focus.value ? "уверенно" : "нет данных", prepared_decision: focus.value ? null : missingDecision("Какой рекламный фокус выбрать?", "Выбрать наиболее готовое подтверждённое предложение.", [], ["Фокус определяет Strategy и все downstream Drafts."]) },
    { field_id: "advertised_offer", recommended_value: offer.value, explanation: "Предложение нормализовано из подтверждённой модели бизнеса.", source_category: offer.sourceCategory, status: offer.status, prepared_decision: offer.value ? null : missingDecision("Какое реальное предложение рекламировать?", "Использовать подтверждённое first-party предложение.", [], ["Без предложения невозможно подготовить точные объявления."]) },
    { field_id: "target_audience", recommended_value: audience.value, explanation: "Аудитория перенесена из подтверждённых Model evidence.", source_category: audience.sourceCategory, status: audience.status, prepared_decision: audience.value ? null : missingDecision("Кто принимает решение о целевом действии?", "Указать реального business decision maker.", [], ["Без аудитории нельзя оценить соответствие сообщения."]) },
    { field_id: "qualified_result", recommended_value: qualifiedResult.value, explanation: "Результат описывает подтверждаемое квалифицированное действие.", source_category: qualifiedResult.sourceCategory, status: qualifiedResult.status, prepared_decision: qualifiedResult.value ? null : missingDecision("Какое действие считать квалифицированным результатом?", "Связать Strategy с primary business outcome.", [], ["Без определения результата нельзя связать кампанию с measurement."]) },
    { field_id: "exclusions", recommended_value: exclusions.value, explanation: "Исключения отделяют нецелевые обращения.", source_category: exclusions.sourceCategory, status: exclusions.status, prepared_decision: exclusions.value ? null : missingDecision("Какие обращения или аудитории исключить?", "Исключить неподходящие обращения из qualified result.", [], ["Нецелевой спрос может попасть в Drafts."]) },
    geography ? { field_id: "geography", recommended_value: geography, explanation: "География найдена в owner-confirmed Business Model.", source_category: geographyField.owner_confirmed === true ? "решение владельца" : "сайт", status: geographyField.owner_confirmed === true ? "уверенно" : "нужно проверить", prepared_decision: null }
      : preparedField("geography", "Evidence не доказывает business-owned территорию показа.", "В какой географии разрешён показ?", "Использовать только реально обслуживаемую территорию.", [], ["География меняет спрос, стоимость и Direct projection."]),
    preparedField("period", "Evidence не задаёт допустимое рекламное окно без бизнес-решения.", "Когда кампания может начинаться и заканчиваться?", "Выбрать период, совместимый с sales cycle и seasonality.", [], ["Период ограничивает внешнюю экспозицию и интерпретацию evidence."]),
    { field_id: "landing_page", recommended_value: landing || null, explanation: "Использован исследованный first-party HTTPS URL.", source_category: "сайт", status: landing ? "уверенно" : "нет данных", prepared_decision: landing ? null : missingDecision("На какую first-party страницу вести трафик?", "Использовать релевантную проверяемую first-party destination.", [], ["Без URL Draft нельзя безопасно подготовить."]) },
    preparedField("weekly_budget", "Бюджет — business-owned предел; технический минимум не подменяет его.", "Какую максимальную сумму можно расходовать за неделю?", "Задать предел, согласованный с economics и допустимой экспозицией.", budgetEvidence, ["Без суммы approval остаётся заблокированным."]),
    { field_id: "target_result_cost", recommended_value: recommendation.economics.target_result_cost_rub, explanation: recommendation.economics.uncertainty ?? "Целевая стоимость детерминированно выведена из подтверждённой economics.", source_category: "решение владельца", status: recommendation.economics.target_result_cost_rub ? "уверенно" : "нет данных", prepared_decision: null },
    { field_id: "core_message", recommended_value: message.value, explanation: "Сообщение основано на подтверждённой first-party ценности.", source_category: message.sourceCategory, status: message.status, prepared_decision: message.value ? null : missingDecision("Какое доказуемое основное сообщение использовать?", "Использовать подтверждённую ценность без обещания результата.", [], ["Без сообщения невозможно сформировать рекламный текст."]) },
  ];

  const capability = exactCapability(contextState);
  const measurement = measurementEvidence(analyticsEvidence);
  const playbook = await resolveCuratedPlaybookReleases(playbookReleases, {
    evaluatedAt: generatedAt,
    applicability: {
      campaign_fanout_contract: "campaign-fanout-v1",
      capability_profile_id: "p0-campaign-creation-profile-v1",
      campaign_type: "UNIFIED_CAMPAIGN",
      placement: "SEARCH",
      strategy_fields: ["advertised_offer", "qualified_result"],
      measurement_status: measurement.ready ? "READY" : "BLOCKED",
    },
  });
  const playbookLineage = {
    release_id: playbook.release?.release_id ?? null,
    release_version: playbook.release?.release_version ?? null,
    release_digest: playbook.release?.content_digest ?? null,
    rule_ids: playbook.rules.map((rule) => rule.rule_id),
    rule_digests: playbook.rules.map((rule) => rule.content_digest),
  };
  const materialQuestions = fields.flatMap((field) => field.prepared_decision ? [{ field_id: field.field_id, decision: field.prepared_decision }] : []);
  const materialConflicts = list(analyticsEvidence.conflicts).map(record).filter((conflict) => conflict.material === true);
  const materialGaps = list(analyticsEvidence.gaps).map(record).filter((gap) => gap.material === true);
  const evidenceProblems = [
    ...materialConflicts.map((conflict) => `Конфликт ${normalizedText(conflict.predicate, 200) || normalizedText(conflict.conflict_id, 200)} не разрешён.`),
    ...materialGaps.map((gap) => normalizedText(gap.description, 500)).filter(Boolean),
    ...(!capability.valid ? ["Exact Direct account capabilities не подтверждены."] : []),
    ...(recommendation.measurement.fallback ? ["Measurement требует pre-launch validation."] : []),
    ...(recommendation.economics.uncertainty ? [recommendation.economics.uncertainty] : []),
    ...(recommendation.prelaunch_cost.status === "COST_EVIDENCE_BLOCKED" ? [recommendation.prelaunch_cost.uncertainty] : []),
  ];
  const unresolvedFieldIds = materialQuestions.map((item) => item.field_id);
  const humanDecisionGate: StrategyHumanDecisionGate | null = unresolvedFieldIds.length || evidenceProblems.length ? {
    reason: "MATERIAL_GAPS_OR_CONFLICTS",
    recommendation: materialConflicts.length ? "Не утверждать конфликтующий бизнес-смысл; уточнить перечисленные material facts." : "Заполнить только перечисленные material gaps и сохранить безопасные рекомендации агента.",
    evidence: [...new Set([...evidenceProblems, ...materialQuestions.flatMap((item) => item.decision.evidence)])],
    confidence: materialConflicts.length || !capability.valid ? "LOW" : "MEDIUM",
    alternatives: ["Принять подготовленные fallback-рекомендации и закрыть material gaps", "Изменить бизнес-смысл и пересчитать Strategy/downstream"],
    consequences: ["Approval создаст immutable Strategy revision только после заполнения полного business intent.", "Material edit пересоздаст downstream; normalization-only edit сохранит lineage."],
    unresolved_field_ids: unresolvedFieldIds,
  } : null;

  const contextRevisionId = normalizedText(contextState.context_revision_id, 255);
  const contextMaterialFingerprint = normalizedText(contextState.material_fingerprint, 255);
  const businessModelRevisionId = normalizedText(ownerContract.model_revision_id, 255);
  const snapshotId = normalizedText(analyticsEvidence.snapshot_id, 255);
  if (!contextRevisionId || !contextMaterialFingerprint || !businessModelRevisionId || !snapshotId || !focus.revisionId || !capability.snapshotId) {
    throw new Error("Campaign Strategy требует точные Context, Business Model, Product Focus, Analytics Evidence и capability lineage.");
  }
  const identity = {
    contract_version: STRATEGY_QUESTIONNAIRE_CONTRACT_VERSION,
    context_revision_id: contextRevisionId,
    context_material_fingerprint: contextMaterialFingerprint,
    business_model_revision_id: businessModelRevisionId,
    analytics_evidence_snapshot_id: snapshotId,
    product_focus_revision_id: focus.revisionId,
    direct_capability_snapshot_id: capability.snapshotId,
    playbook_lineage: playbookLineage,
    recommendation,
    material_questions: materialQuestions,
    human_decision_gate: humanDecisionGate,
    fields,
  };
  const questionnaireHash = await sha256(identity);
  return {
    schema_version: STRATEGY_QUESTIONNAIRE_SCHEMA,
    questionnaire_id: `strategy-questionnaire:${questionnaireHash.slice("sha256:".length, "sha256:".length + 24)}`,
    generated_at: generatedAt,
    ...identity,
    contract_version: STRATEGY_QUESTIONNAIRE_CONTRACT_VERSION,
  };
}

export async function verifyStrategyQuestionnaireIdentity(value: StrategyQuestionnaire) {
  const identity = {
    contract_version: value.contract_version,
    context_revision_id: value.context_revision_id,
    context_material_fingerprint: value.context_material_fingerprint,
    business_model_revision_id: value.business_model_revision_id,
    analytics_evidence_snapshot_id: value.analytics_evidence_snapshot_id,
    product_focus_revision_id: value.product_focus_revision_id,
    direct_capability_snapshot_id: value.direct_capability_snapshot_id,
    playbook_lineage: value.playbook_lineage,
    recommendation: value.recommendation,
    material_questions: value.material_questions,
    human_decision_gate: value.human_decision_gate,
    fields: value.fields,
  };
  const digest = await sha256(identity);
  return value.schema_version === STRATEGY_QUESTIONNAIRE_SCHEMA
    && value.contract_version === STRATEGY_QUESTIONNAIRE_CONTRACT_VERSION
    && value.questionnaire_id === `strategy-questionnaire:${digest.slice("sha256:".length, "sha256:".length + 24)}`;
}

export function normalizeStrategyAnswers(value: unknown, sanitize: (value: unknown, maximum: number) => string = (item, maximum) => normalizedText(item, maximum)) {
  const input = record(value);
  const textAnswer = (fieldId: StrategyFieldId, maximum = 2_000) => sanitize(input[fieldId], maximum);
  const period = record(input.period);
  const normalized: Record<StrategyFieldId, StrategyAnswerValue | null> = {
    business_goal: textAnswer("business_goal", 500) || null,
    campaign_focus: textAnswer("campaign_focus", 1_000) || null,
    advertised_offer: textAnswer("advertised_offer") || null,
    target_audience: textAnswer("target_audience") || null,
    qualified_result: textAnswer("qualified_result") || null,
    exclusions: textAnswer("exclusions") || null,
    geography: textAnswer("geography", 255) || null,
    period: { start_date: normalizedText(period.start_date, 20), end_date: normalizedText(period.end_date, 20) },
    landing_page: textAnswer("landing_page", 2_000) || null,
    weekly_budget: Number(input.weekly_budget),
    target_result_cost: Number(input.target_result_cost),
    core_message: textAnswer("core_message") || null,
  };
  const normalizedPeriod = normalized.period as StrategyPeriod;
  if (!normalizedPeriod.start_date || !normalizedPeriod.end_date) normalized.period = null;
  if (!Number.isSafeInteger(normalized.weekly_budget) || Number(normalized.weekly_budget) <= 0) normalized.weekly_budget = null;
  if (!Number.isSafeInteger(normalized.target_result_cost) || Number(normalized.target_result_cost) <= 0) normalized.target_result_cost = null;
  return normalized;
}

export function missingStrategyDecisions(answers: Record<StrategyFieldId, StrategyAnswerValue | null>) {
  return STRATEGY_FIELD_ORDER.filter((fieldId) => fieldId !== "target_result_cost" && answers[fieldId] === null);
}

export async function strategyAnswersFingerprint(answers: Record<StrategyFieldId, StrategyAnswerValue | null>) {
  return sha256(STRATEGY_FIELD_ORDER.map((fieldId) => ({ field_id: fieldId, value: answers[fieldId] })));
}

const LEGACY_FIELDS: Record<StrategyFieldId, string> = {
  business_goal: "goal",
  campaign_focus: "focus",
  advertised_offer: "advertised_offer",
  target_audience: "target_audience",
  qualified_result: "qualified_result",
  exclusions: "exclusions",
  geography: "geography",
  period: "period",
  landing_page: "landing_page",
  weekly_budget: "weekly_budget_rub",
  target_result_cost: "target_cpa_rub",
  core_message: "message",
};

export function strategyAnswerValue(strategy: Record<string, unknown>, fieldId: StrategyFieldId): unknown {
  const answers = Array.isArray(strategy.answers) ? strategy.answers as Array<Record<string, unknown>> : [];
  const answer = answers.find((item) => item.field_id === fieldId);
  if (answer) return answer.value;
  if (fieldId === "period") return { start_date: strategy.period_start, end_date: strategy.period_end };
  return strategy[LEGACY_FIELDS[fieldId]];
}

export function strategyPeriod(strategy: Record<string, unknown>): StrategyPeriod {
  const value = record(strategyAnswerValue(strategy, "period"));
  return { start_date: normalizedText(value.start_date, 20), end_date: normalizedText(value.end_date, 20) };
}

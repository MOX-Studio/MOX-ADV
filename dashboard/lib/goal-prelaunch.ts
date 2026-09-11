import { formArray, formEnum, formId, formIds, formObject, formRefs, formText, type FormationPlan, type FormationResearch, type FormationViolation } from "./campaign-formation-method.ts";
import { goalMeasurement, type GoalRevision } from "./goal-revision.ts";
import type { GoalMetricDefinition } from "./goal-metric.ts";
import type { FormationPortfolio } from "./campaign-formation-portfolio.ts";

export const GOAL_PRELAUNCH_VERSION = "goal-prelaunch-v1";
export const REQUIREMENT_AREAS = ["AUDIENCE", "OFFER", "REACH", "LANDING", "MEASUREMENT", "BUDGET", "TIMING", "CAPACITY", "PAYMENT", "REVERSALS", "COSTS", "DENOMINATOR"] as const;
export const EVIDENCE_CLASSES = ["BUSINESS_INPUT", "PRIMARY_FACT", "BEHAVIORAL_OBSERVATION", "CAUSAL_ESTIMATE", "PLATFORM_RULE", "RESEARCH_GUIDANCE", "MODEL_ASSUMPTION"] as const;
const MEASURED_OUTCOMES = ["FORM_SUBMISSION", "CLICK", "VISIT", "QUALIFIED_REQUEST", "PAID_ORDER", "REVENUE", "PROFIT", "CUSTOM", "UNKNOWN"] as const;
type RequirementArea = typeof REQUIREMENT_AREAS[number];
export type GoalRequirementsResearch = {
  version: typeof GOAL_PRELAUNCH_VERSION;
  goal_revision_id: string;
  goal_digest: string;
  requirements: Array<{ id: string; area: RequirementArea; condition: string; criticality: "CRITICAL" | "SUPPORTING";
    status: "SUPPORTED" | "ASSUMPTION" | "UNAVAILABLE" | "CONFLICT" | "BLOCKER" | "NOT_APPLICABLE";
    resolution_scope: "PRELAUNCH" | "EXTERNAL" | "PERFORMANCE"; evidence_basis: "OWNER_GOAL" | "SOURCES" | "INFERENCE" | "UNKNOWN";
    finding_ids: string[]; evidence_refs: string[]; decision_impact: string; next_step: string }>;
  measurements: Array<{ source_ref: string; observed_outcome: string; outcome_type: typeof MEASURED_OUTCOMES[number]; unit: "RESULT" | "RUB" | "PERCENT" | "OTHER" | "UNKNOWN";
    relation: "EXACT" | "PROXY" | "UNRELATED" | "UNKNOWN"; evidence_class: typeof EVIDENCE_CLASSES[number]; observed_at: string; population: string;
    period: { from: string; to: string } | null; permitted_use: "GOAL_ESTIMATE" | "FUNNEL_INPUT" | "CONTEXT_ONLY"; limitation: string }>;
  decision_gaps: Array<{ id: string; requirement_ids: string[]; question: string; status: "RESOLVED" | "UNAVAILABLE" | "CONFLICT" | "NOT_DECISION_RELEVANT" | "OUTSIDE_AUTHORITY";
    attempts: string[]; finding_ids: string[]; evidence_refs: string[]; decision_impact: string; conclusion: string }>;
};
export type GoalOutcomePlan = {
  requirement_decisions: Array<{ requirement_id: string; disposition: "ADDRESS" | "HOLD_AS_CONDITION" | "NEEDS_REPAIR" | "NOT_APPLICABLE"; direction_ids: string[]; action: string; evidence_refs: string[] }>;
  candidate_comparisons: Array<{ alternative_id: string; requirement_ids: string[]; package: { audience: string; offer: string; landing: string; action: string; measurement: string; budget_and_timing: string };
    ranking: "PREFERRED" | "ALTERNATIVE" | "UNRESOLVED"; advantage: string; strongest_counterargument: string; decision_reason: string }>;
  stopping_reason: string;
};
export type GoalOutcomeReview = {
  creative_combinations: Array<{ ad_id: string; title: string; text: string; status: "COMPATIBLE" | "CONFLICT"; explanation: string }>;
  requirements: Array<{ requirement_id: string; status: "SATISFIED" | "CONDITION" | "BLOCKER" | "NOT_APPLICABLE"; target_ids: string[]; explanation: string; evidence_refs: string[]; repaired_issue_ids: string[] }>;
  group_selections: Array<{ group_id: string; candidate_ids: string[]; requirement_ids: string[]; ranking: "PREFERRED" | "UNRESOLVED"; main_advantage: string; strongest_counterargument: string;
    unknowns: Array<{ question: string; decision_impact: string }>; conclusion: string }>;
  success_probability: null;
  material_limits: string[];
};

export function requiredGoalAreas(metric: GoalMetricDefinition): RequirementArea[] {
  return ["AUDIENCE", "OFFER", "REACH", "LANDING", "MEASUREMENT", "BUDGET", "TIMING", "CAPACITY",
    ...(["PAID_ORDER", "REVENUE", "PROFIT"].includes(metric.outcome_type) ? ["PAYMENT" as const] : []),
    ...(metric.family === "SUM" ? ["REVERSALS" as const] : []), ...(metric.outcome_type === "PROFIT" ? ["COSTS" as const] : []), ...(metric.family === "RATIO" ? ["DENOMINATOR" as const] : [])];
}

export function goalRequirementsSchema(refs: string[]) {
  return formObject({ version: formEnum([GOAL_PRELAUNCH_VERSION]), goal_revision_id: formText(255), goal_digest: formText(71),
    requirements: formArray(formObject({ id: formId(), area: formEnum(REQUIREMENT_AREAS), condition: formText(), criticality: formEnum(["CRITICAL", "SUPPORTING"]),
      status: formEnum(["SUPPORTED", "ASSUMPTION", "UNAVAILABLE", "CONFLICT", "BLOCKER", "NOT_APPLICABLE"]), resolution_scope: formEnum(["PRELAUNCH", "EXTERNAL", "PERFORMANCE"]), evidence_basis: formEnum(["OWNER_GOAL", "SOURCES", "INFERENCE", "UNKNOWN"]), finding_ids: formIds(), evidence_refs: formRefs(refs), decision_impact: formText(), next_step: formText() }), null, 1),
    measurements: formArray(formObject({ source_ref: formEnum(refs), observed_outcome: formText(), outcome_type: formEnum(MEASURED_OUTCOMES), unit: formEnum(["RESULT", "RUB", "PERCENT", "OTHER", "UNKNOWN"]), relation: formEnum(["EXACT", "PROXY", "UNRELATED", "UNKNOWN"]), evidence_class: formEnum(EVIDENCE_CLASSES), observed_at: formText(100), population: formText(), period: { ...formObject({ from: formText(10), to: formText(10) }), type: ["object", "null"] }, permitted_use: formEnum(["GOAL_ESTIMATE", "FUNNEL_INPUT", "CONTEXT_ONLY"]), limitation: formText() })),
    decision_gaps: formArray(formObject({ id: formId(), requirement_ids: formIds(null, 1), question: formText(), status: formEnum(["RESOLVED", "UNAVAILABLE", "CONFLICT", "NOT_DECISION_RELEVANT", "OUTSIDE_AUTHORITY"]), attempts: formArray(formText(), null, 1), finding_ids: formIds(), evidence_refs: formRefs(refs), decision_impact: formText(), conclusion: formText() })),
  });
}
export function goalOutcomePlanSchema(refs: string[]) {
  return formObject({ requirement_decisions: formArray(formObject({ requirement_id: formId(), disposition: formEnum(["ADDRESS", "HOLD_AS_CONDITION", "NEEDS_REPAIR", "NOT_APPLICABLE"]), direction_ids: formIds(), action: formText(), evidence_refs: formRefs(refs) }), null, 1),
    candidate_comparisons: formArray(formObject({ alternative_id: formId(), requirement_ids: formIds(null, 1), package: formObject({ audience: formText(), offer: formText(), landing: formText(), action: formText(), measurement: formText(), budget_and_timing: formText() }), ranking: formEnum(["PREFERRED", "ALTERNATIVE", "UNRESOLVED"]), advantage: formText(), strongest_counterargument: formText(), decision_reason: formText() }), null, 2), stopping_reason: formText(4000) });
}
export function goalOutcomeReviewSchema(refs: string[]) {
  return formObject({ creative_combinations: formArray(formObject({ ad_id: formId(), title: formText(56), text: formText(81), status: formEnum(["COMPATIBLE", "CONFLICT"]), explanation: formText() }), null, 1), requirements: formArray(formObject({ requirement_id: formId(), status: formEnum(["SATISFIED", "CONDITION", "BLOCKER", "NOT_APPLICABLE"]), target_ids: formIds(null, 1), explanation: formText(), evidence_refs: formRefs(refs), repaired_issue_ids: formIds() }), null, 1),
    group_selections: formArray(formObject({ group_id: formId(), candidate_ids: formIds(null, 2), requirement_ids: formIds(null, 1), ranking: formEnum(["PREFERRED", "UNRESOLVED"]), main_advantage: formText(), strongest_counterargument: formText(), unknowns: formArray(formObject({ question: formText(), decision_impact: formText() })), conclusion: formText() }), null, 1),
    success_probability: { type: "null" }, material_limits: formArray(formText()) });
}

const exact = (ids: string[], expected: string[]) => ids.length === expected.length && new Set(ids).size === ids.length && expected.every(id => ids.includes(id));
const issuesAt = (pointer: string) => {
  const violations: FormationViolation[] = [];
  return { violations, add: (code: string, message: string) => violations.push({ code, pointer, message }) };
};

export function verifyGoalRequirements(research: FormationResearch, goal: GoalRevision): FormationViolation[] {
  const { violations, add } = issuesAt("/research/goal_requirements");
  const value = research.goal_requirements;
  if (!value) { add("GOAL_REQUIREMENTS_MISSING", "Определите условия достижения именно этой цели и существенные пробелы."); return violations; }
  if (value.goal_revision_id !== goal.goal_revision_id || value.goal_digest !== goal.digest) add("GOAL_REQUIREMENTS_STALE", "Условия относятся к другой версии цели.");
  const metric = goalMeasurement(goal), required = requiredGoalAreas(metric);
  if (required.some(area => !value.requirements.some(r => r.area === area))) add("GOAL_REQUIREMENT_AREA_MISSING", "Исследуйте покупателя, предложение, доступность, посадочную, измерение, бюджет, сроки и исполнение; дополните условиями конкретной метрики.");
  const ids = value.requirements.map(r => r.id), findingIds = new Set(research.findings.map(f => f.id));
  if (new Set(ids).size !== ids.length) add("GOAL_REQUIREMENT_ID_DUPLICATE", "Условия должны иметь уникальные идентификаторы.");
  for (const requirement of value.requirements) {
    if (requirement.finding_ids.some(id => !findingIds.has(id))) add("GOAL_REQUIREMENT_FINDING_UNKNOWN", "Свяжите условие с существующими выводами исследования.");
    if (requirement.evidence_basis === "OWNER_GOAL" && !["BUDGET", "TIMING"].includes(requirement.area)) add("GOAL_OWNER_INPUT_OVERSTATED", "Определённая владельцем цель не подтверждает готовность рынка, посадочной, платежей или измерения.");
    if (requirement.status === "SUPPORTED" && requirement.evidence_basis !== "OWNER_GOAL" && (requirement.evidence_basis !== "SOURCES" || !requirement.evidence_refs.length || !requirement.finding_ids.some(id => research.findings.some(f => f.id === id && f.state === "OBSERVED")))) add("GOAL_REQUIREMENT_SUPPORT_MISSING", "Подтверждённое условие требует наблюдаемого вывода и источника; предположение сохраняется отдельно.");
    if (requirement.status === "ASSUMPTION" && requirement.evidence_basis !== "INFERENCE") add("GOAL_ASSUMPTION_MISLABELLED", "Суждение агента должно сохранять статус предположения.");
    if (requirement.status === "NOT_APPLICABLE" && ["MEASUREMENT", "BUDGET", "TIMING"].includes(requirement.area)) add("GOAL_ESSENTIAL_REQUIREMENT_REMOVED", "Определение измерения, бюджет и срок применимы к любой поддержанной цели.");
    if (["UNAVAILABLE", "CONFLICT", "BLOCKER"].includes(requirement.status) && !value.decision_gaps.some(g => g.requirement_ids.includes(requirement.id))) add("GOAL_DECISION_GAP_MISSING", "Существенный пробел требует вопроса, выполненных проверок и последствий для решения.");
  }
  if (new Set(value.decision_gaps.map(g => g.id)).size !== value.decision_gaps.length) add("GOAL_GAP_ID_DUPLICATE", "Вопросы должны иметь уникальные идентификаторы.");
  for (const gap of value.decision_gaps) {
    if (gap.requirement_ids.some(id => !ids.includes(id)) || gap.finding_ids.some(id => !findingIds.has(id))) add("GOAL_GAP_TARGET_UNKNOWN", "Пробел должен относиться к существующим условиям и выводам.");
    if (gap.status === "RESOLVED" && !gap.finding_ids.length) add("GOAL_GAP_RESOLUTION_MISSING", "Разрешённый вопрос требует результата проверки в выводах исследования.");
  }
  for (const observation of value.measurements) {
    if (!Number.isFinite(Date.parse(observation.observed_at))) add("GOAL_MEASUREMENT_DATE_INVALID", "Укажите дату наблюдения источника.");
    const date = (value: string) => /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    if (observation.period && (!date(observation.period.from) || !date(observation.period.to) || observation.period.from > observation.period.to)) add("GOAL_MEASUREMENT_PERIOD_INVALID", "Укажите период измеренного исхода.");
    if (observation.relation === "EXACT" && (observation.outcome_type !== metric.outcome_type || observation.unit !== metric.unit)) add("GOAL_MEASUREMENT_PROXY_SUBSTITUTION", "Событие и единица источника не совпадают с целью; формы, клики и выручка не заменяют другой исход.");
    if (observation.permitted_use === "GOAL_ESTIMATE" && (observation.relation !== "EXACT" || !["BEHAVIORAL_OBSERVATION", "CAUSAL_ESTIMATE"].includes(observation.evidence_class))) add("GOAL_MEASUREMENT_USE_UNSUPPORTED", "Численный исход цели требует сопоставимого наблюдения; иные данные остаются контекстом или входом отдельного перехода воронки.");
  }
  return violations;
}

export function verifyGoalOutcomePlan(plan: FormationPlan, research: FormationResearch): FormationViolation[] {
  const { violations, add } = issuesAt("/formation_plan/goal_preparation/outcome_plan");
  const preparation = plan.goal_preparation, value = preparation?.outcome_plan, source = research.goal_requirements;
  if (!value || !source || !preparation) { add("GOAL_OUTCOME_PLAN_MISSING", "Свяжите выбор стратегии с принятыми условиями достижения цели."); return violations; }
  const ids = source.requirements.map(r => r.id), directions = plan.directions.map(d => d.id);
  if (!exact(value.requirement_decisions.map(r => r.requirement_id), ids)) add("GOAL_REQUIREMENT_DECISION_MISSING", "Примите отдельное решение по каждому условию достижения цели.");
  for (const decision of value.requirement_decisions) {
    const requirement = source.requirements.find(r => r.id === decision.requirement_id);
    if (decision.direction_ids.some(id => !directions.includes(id))) add("GOAL_REQUIREMENT_DIRECTION_UNKNOWN", "Действие должно относиться к фактическим направлениям стратегии.");
    if (decision.disposition === "NOT_APPLICABLE" && requirement?.status !== "NOT_APPLICABLE") add("GOAL_REQUIREMENT_DISCARDED", "Применимое условие нельзя убрать в стратегии без обновления исследования.");
    if (decision.disposition === "HOLD_AS_CONDITION" && requirement?.resolution_scope === "PRELAUNCH" && ["BLOCKER", "CONFLICT"].includes(requirement.status)) add("GOAL_PRELAUNCH_DEFECT_DEFERRED", "Известное устранимое препятствие нужно исправить; ожидание будущих результатов его не закрывает.");
  }
  if (!exact(value.candidate_comparisons.map(c => c.alternative_id), preparation.alternatives.map(c => c.id))) add("GOAL_PACKAGE_COMPARISON_MISSING", "Сравните полные предложения всех рассматриваемых альтернатив.");
  for (const candidate of value.candidate_comparisons) {
    if (candidate.requirement_ids.some(id => !ids.includes(id))) add("GOAL_CANDIDATE_REQUIREMENT_UNKNOWN", "Преимущество альтернативы должно относиться к реальному условию цели.");
    if ((candidate.ranking === "PREFERRED" && candidate.alternative_id !== preparation.selected_alternative_id) || (candidate.alternative_id === preparation.selected_alternative_id && candidate.ranking === "ALTERNATIVE")) add("GOAL_PACKAGE_SELECTION_CHANGED", "Итоговое предпочтение должно соответствовать фактическому выбору стратегии.");
  }
  const estimates = preparation.forecast.inputs.flatMap(r => [r.click_to_qualified_percent]).concat((preparation.forecast.metric_inputs ?? []).map(r => r.value));
  for (const estimate of estimates.filter(e => e.range && e.basis === "OBSERVATION")) {
    if (!estimate.evidence_refs.some(ref => source.measurements.some(m => m.source_ref === ref && m.relation === "EXACT" && m.permitted_use === "GOAL_ESTIMATE"))) add("GOAL_FORECAST_OBSERVATION_UNMAPPED", "Наблюдаемая конверсия или сумма требует сопоставимого измеренного исхода; промежуточный показатель нельзя выдать за результат цели.");
  }
  if (preparation.forecast.effect_basis === "CAUSAL_ESTIMATE") {
    const causalRefs = source.measurements.filter(m => m.evidence_class === "CAUSAL_ESTIMATE" && m.relation === "EXACT" && m.permitted_use === "GOAL_ESTIMATE").map(m => m.source_ref);
    if (!causalRefs.length || estimates.some(e => e.range && !e.evidence_refs.some(ref => causalRefs.includes(ref)))) add("GOAL_CAUSAL_EVIDENCE_MISSING", "Каждая причинная проекция требует связанного применимого свидетельства; обычное распределение объявлений его не заменяет.");
  }
  return violations;
}

export function verifyGoalOutcomeReview(plan: FormationPlan, research: FormationResearch, portfolio: FormationPortfolio): FormationViolation[] {
  const { violations, add } = issuesAt("/goal_review/outcome_review");
  const value = portfolio.goal_review?.outcome_review, source = research.goal_requirements, decisions = plan.goal_preparation?.outcome_plan;
  if (!value || !source || !decisions) { add("GOAL_OUTCOME_REVIEW_MISSING", "Проверьте условия цели и выбор всех фактических групп после подготовки материалов."); return violations; }
  if (value.success_probability !== null) add("GOAL_PROBABILITY_UNVALIDATED", "В этой версии нет проверенной вероятностной модели; вероятность успеха должна оставаться null.");
  if (!exact(value.requirements.map(r => r.requirement_id), source.requirements.map(r => r.id))) add("GOAL_FINAL_REQUIREMENT_MISSING", "В итоговом разборе должно быть решение по каждому условию цели.");
  const groups = portfolio.campaigns.flatMap(c => c.groups), targetIds = new Set(["portfolio", "landing", "measurement", "budget", ...portfolio.campaigns.map(c => c.id), ...groups.map(g => g.id), ...groups.flatMap(g => g.ads.map(a => a.id))]);
  const combinationKey = (adId: string, title: string, text: string) => JSON.stringify([adId, title, text]);
  const combinations = groups.flatMap(g => g.ads.flatMap(ad => ad.titles.flatMap(title => ad.texts.map(text => combinationKey(ad.id, title, text)))));
  if (!Array.isArray(value.creative_combinations) || !exact(value.creative_combinations.map(c => combinationKey(c.ad_id, c.title, c.text)), combinations)) add("GOAL_CREATIVE_COMBINATIONS_STALE", "Проверьте каждое фактическое сочетание заголовка и текста; изменение материалов требует нового разбора сочетаний.");
  if (value.creative_combinations?.some(c => c.status !== "COMPATIBLE")) add("GOAL_CREATIVE_COMBINATION_CONFLICT", "Устраните несовместимость предложения, категории, цены или условий внутри возможного сочетания.");
  for (const row of value.requirements) {
    const requirement = source.requirements.find(r => r.id === row.requirement_id);
    const decision = decisions.requirement_decisions.find(d => d.requirement_id === row.requirement_id);
    if (row.target_ids.some(id => !targetIds.has(id))) add("GOAL_FINAL_TARGET_UNKNOWN", "Укажите существующие материалы или условие посадочной, измерения либо бюджета.");
    if (row.status === "BLOCKER") add("GOAL_FINAL_REQUIREMENT_BLOCKED", "Устраните выявленное препятствие подготовки до завершения.");
    if (row.status === "NOT_APPLICABLE" && requirement?.status !== "NOT_APPLICABLE") add("GOAL_FINAL_REQUIREMENT_DISCARDED", "Применимое условие не исчезает при финальном разборе.");
    if (row.status === "SATISFIED" && requirement && ["UNAVAILABLE", "ASSUMPTION"].includes(requirement.status) && requirement.resolution_scope !== "PRELAUNCH") add("GOAL_EXTERNAL_CONDITION_INVENTED", "Недоступное измерение или внешнее условие не становится выполненным после редактирования рекламы.");
    const repairs = row.repaired_issue_ids.map(id => portfolio.optimization_review?.issues.find(i => i.id === id));
    if (repairs.some(r => !r || r.kind !== "PREPARATION_DEFECT" || r.status !== "REPAIRED" || !r.repair)) add("GOAL_REPAIR_REFERENCE_INVALID", "Исправление должно ссылаться на проверенное изменение конкретного параметра.");
    if (repairs.some(r => r && !r.affected_ids.some(id => row.target_ids.includes(id)))) add("GOAL_REPAIR_UNRELATED", "Исправление должно относиться к материалам, которыми обеспечивается это условие цели.");
    if (row.status === "SATISFIED" && requirement?.resolution_scope === "PRELAUNCH" && ["UNAVAILABLE", "ASSUMPTION"].includes(requirement.status) && !repairs.length) add("GOAL_UNVERIFIED_CONDITION_CLOSED", "Предположение не становится проверенным условием без нового исследования или конкретного исправления.");
    if (requirement?.resolution_scope === "PRELAUNCH" && (["CONFLICT", "BLOCKER"].includes(requirement.status) || decision?.disposition === "NEEDS_REPAIR") && (row.status !== "SATISFIED" || !repairs.length)) add("GOAL_REPAIR_NOT_IMPLEMENTED", "Известное препятствие требует реального исправления либо нового исследования; его нельзя переименовать в ограничение.");
  }
  if (!exact(value.group_selections.map(r => r.group_id), groups.map(g => g.id))) add("GOAL_FINAL_GROUP_MISSING", "Проверьте выбор каждой фактической группы.");
  for (const row of value.group_selections) {
    const candidates = portfolio.goal_review?.groups.find(g => g.group_id === row.group_id)?.candidates.map(c => c.id) ?? [];
    if (!exact(row.candidate_ids, candidates) || row.requirement_ids.some(id => !source.requirements.some(r => r.id === id))) add("GOAL_FINAL_COMPARISON_STALE", "Итоговое сравнение должно охватывать все реальные варианты группы и её условия результата.");
    if (row.ranking === "UNRESOLVED" && !row.unknowns.length) add("GOAL_RANKING_UNCERTAINTY_MISSING", "Неопределённое ранжирование требует объяснения, какой неизвестный ответ способен изменить выбор.");
  }
  return violations;
}

export function goalPrelaunchInstructions(metric: GoalMetricDefinition) {
  return { version: GOAL_PRELAUNCH_VERSION, required_areas: requiredGoalAreas(metric),
    creative_compatibility: "In goal_review.outcome_review.creative_combinations, review every actual ad title crossed with every actual body text. Preserve the exact ad ID and strings, mark COMPATIBLE only when subject, offer, prices, dates and material conditions remain coherent together, and explain the judgment. A CONFLICT blocks acceptance. Recheck combinations after any text or grouping change. A required condition must not rely exclusively on an optional extension that might not be shown.",
    task: "Preserve the exact owner metric and its counting, reversals, deadline and attribution. Derive the necessary conditions of this particular goal, with applicability, evidence class, scope and decision consequence. One Codex owns every judgment; scripts check types and linkage only.",
    evidence: "Add research.goal_requirements. A goal states an intention; it does not prove buyer demand, a working payment path, fulfilled capacity or measurement. OWNER_GOAL may support only budget and timing. Other supported requirements need observed findings and sources. Missing, conflicting and blocked requirements need decision_gaps with performed checks, consequences and a stopping reason. Describe numeric outcome sources individually: actual event, unit, population, date, period, causal versus observational class and allowed use. A form, click, current text or ordinary ad rotation does not establish qualified results, paid orders or causal effect.",
    strategy: "Add goal_preparation.outcome_plan. Make a decision for every condition. Compare complete candidate packages: audience, offer, landing, target action, measurement, budget and time; connect advantages and strongest objections to conditions. Record UNRESOLVED where evidence cannot rank alternatives. Still make a provisional practical selection with limits. Investigate a gap when its answer can materially change this choice. Do not rewrite unavailable facts or manufacture a winner by adding more self-reviews.",
    forecast: "COUNT uses clicks and conversion into the exact counted event, with duplicate/deadline adjustments. SUM and RATIO use metric_inputs for every direction, inputs=[], and duplicate/deadline adjustments=null because values already incorporate owner rules. SUM inputs are rubles after applicable refunds/costs/timing; PROFIT inputs may be negative and include advertising cost once. RATIO inputs are separate numerator/denominator counts, never percentages averaged across directions; use the same population definition and remove overlaps before summing. State assumptions and exact budget applicability. A changed budget invalidates generic numeric projections. Unknown values stay null. No probability of success is supported by this version.",
    completion: "Add goal_review.outcome_review after inspecting actual materials. Link each condition to concrete targets and every real candidate in each group. Repair references must point to actual validated optimization issues, not changed rationales. Preserve external/performance conditions until measured. Known fixable prelaunch defects require repair. Keep local preparation, full-goal scenario support and bounded technical checks independent; success_probability is null. Complete goal_review.preparation_decision with scope LOCAL_CAMPAIGN_PREPARATION and decision READY_FOR_VALIDATION, covering all unavailable inputs and an existing positive budget phase. Use GOAL_OUTCOME_RECORDS and GOAL_OUTCOME_DATE for the exact outcome; money additionally needs OUTCOME_AMOUNT and REVERSALS_AND_COSTS, proportions need METRIC_NUMERATOR and METRIC_DENOMINATOR. Save missing measurements and a suitable bounded observation plan without claiming its execution or advertising authority." };
}

import { keywordResearchSchema, type KeywordResearch } from "./keyword-preparation.ts";
import { goalPreparationSchema, type GoalPreparation, type GoalPreparationVersion } from "./campaign-goal-preparation.ts";
import { goalRequirementsSchema, type GoalRequirementsResearch } from "./goal-prelaunch.ts";

/** The preparation contract used by the controlling Codex, independent of a business vertical. */
export const CAMPAIGN_FORMATION_METHOD = "evidence-to-campaign-v1";
export const FORMATION_AREAS = ["offer", "buyers", "objections", "formats_and_calendar", "competitors", "contractor_cases", "demand", "landing", "measurement", "economics"] as const;
export const FORMATION_AREA_LABELS: Record<string, string> = {
  offer: "Продукт и предложение", buyers: "Покупатели и задачи", objections: "Возражения и причины выбора",
  formats_and_calendar: "Форматы, условия и сроки", competitors: "Конкуренты", contractor_cases: "Кейсы продвижения",
  demand: "Поисковый спрос", landing: "Посадочная и заявка", measurement: "Измерение и обработка заявок", economics: "Экономика",
};
export type FormationFinding = { id: string; area: string; finding: string; state: "OBSERVED" | "INFERRED" | "UNKNOWN" | "CONFLICT" | "NO_ROWS_RETURNED"; evidence_refs: string[]; source_urls?: string[]; limitation: string };
export type FormationTestDatum = { id: string; label: string; value: string | number | null; reason_unavailable: string; attempted_sources: string[]; affects: string[] };
export type FormationResearch = {
  keyword_research?: KeywordResearch;
  goal_requirements?: GoalRequirementsResearch;
  mode: "REAL_INPUTS" | "TEST_SCENARIO";
  coverage: Array<{ area: string; status: "RESEARCHED" | "PARTIAL" | "UNAVAILABLE" | "NOT_APPLICABLE"; finding_ids: string[]; explanation: string }>;
  findings: FormationFinding[];
  test_data: FormationTestDatum[];
};
export type FormationDecision = { finding_id: string; disposition: "APPLIED" | "DEFERRED" | "EXCLUDED"; reason: string; target_ids: string[] };
export type FormationDirection = { id: string; name: string; channel: "SEARCH" | "NETWORK" | "RETARGETING"; audience: string; intent: string; offer: string; message: string; weekly_budget_rub: number; activation_condition: string; finding_ids: string[] };
export type FormationExperiment = { id: string; question: string; variable: string; metric: string; activation_condition: string; comparison: "CONTROLLED_VARIANT" | "SEGMENT_COMPARISON"; variants: Array<{ id: string; label: string; direction_id: string }>; limitations: string };
export type FormationPlan = {
  goal_preparation?: GoalPreparation;
  directions: FormationDirection[];
  decisions: FormationDecision[];
  experiments: FormationExperiment[];
  budget: { total_cap_rub: number; phases: Array<{ id: string; label: string; cap_rub: number; release_condition: string }>; reserve_rule: string };
  landing: { url: string; required_fields: string[]; qualification_fields: string[]; proof: string; missing: string[] };
  measurement: { qualified_result: string; paid_result: string; attribution: string; crm_status: string; followup: string; missing: string[] };
  planning_inputs: Array<{ id: string; label: string; value: number | null; unit: string; state: "OBSERVED" | "TEST_DATA" | "UNKNOWN"; evidence_refs: string[]; test_data_id: string | null; metric?: "CPC" | "CTR" | "FORM_CR" | "QUALIFICATION_RATE" | "CLOSE_RATE" | "MARGIN" | "OTHER"; direction_id?: string | null }>;
};

type Schema = Record<string, unknown>;
export const formText = (maxLength = 2000, minLength = 1): Schema => ({ type: "string", minLength, maxLength });
export const formEnum = (values: readonly string[]): Schema => ({ type: "string", enum: values });
export const formArray = (items: Schema, maxItems: number | null = null, minItems = 0): Schema => ({ type: "array", items, minItems, ...(maxItems === null ? {} : { maxItems }) });
export const formObject = (properties: Record<string, Schema>, optional: string[] = []): Schema => ({ type: "object", properties, required: Object.keys(properties).filter(key => !optional.includes(key)), additionalProperties: false });
export const formId = (): Schema => ({ ...formText(100), pattern: "^[A-Za-z0-9][A-Za-z0-9:_-]*$" });
export const formIds = (max: number | null = null, min = 0): Schema => ({ ...formArray(formId(), max, min), uniqueItems: true });
export const formRefs = (allowed: string[], min = 0): Schema => ({ ...formArray(formEnum(allowed), null, min), uniqueItems: true });
const number = (nullable = false): Schema => ({ type: nullable ? ["number", "null"] : "number", minimum: 0 });
export const formMoney = (): Schema => ({ type: "integer", minimum: 0 });

export function formationResearchSchema(evidenceRefs: string[], gapRefs: string[], outcomeRequired = false, keywordRequired = false) {
  return formObject({
    summary: formText(4000), evidence_refs: formRefs(evidenceRefs, 1), gap_refs: formRefs(gapRefs),
    research: formObject({
      ...(keywordRequired ? { keyword_research: keywordResearchSchema(evidenceRefs) } : {}),
      ...(outcomeRequired ? { goal_requirements: goalRequirementsSchema(evidenceRefs) } : {}),
      mode: formEnum(["REAL_INPUTS", "TEST_SCENARIO"]),
      coverage: formArray(formObject({ area: formEnum(FORMATION_AREAS), status: formEnum(["RESEARCHED", "PARTIAL", "UNAVAILABLE", "NOT_APPLICABLE"]), finding_ids: formIds(), explanation: formText() }), FORMATION_AREAS.length, FORMATION_AREAS.length),
      findings: formArray(formObject({ id: formId(), area: formEnum(FORMATION_AREAS), finding: formText(), state: formEnum(["OBSERVED", "INFERRED", "UNKNOWN", "CONFLICT", "NO_ROWS_RETURNED"]), evidence_refs: formRefs(evidenceRefs), source_urls: formArray({ ...formText(4096), pattern: "^https://" }, 30), limitation: formText(2000, 0) }, ["source_urls"]), null, 1),
      test_data: formArray(formObject({ id: formId(), label: formText(300), value: { type: ["string", "number", "null"], maxLength: 2000 }, reason_unavailable: formText(), attempted_sources: formArray(formText(), 50, 1), affects: formArray(formText(300), 50, 1) }), 100),
    }),
  });
}

export function formationPlanSchema(evidenceRefs: string[], goalPreparationRequired = false, version?: GoalPreparationVersion) {
  return formObject({
    goal_preparation: goalPreparationSchema(evidenceRefs, version),
    directions: formArray(formObject({ id: formId(), name: formText(255), channel: formEnum(["SEARCH", "NETWORK", "RETARGETING"]), audience: formText(), intent: formText(), offer: formText(), message: formText(), weekly_budget_rub: { type: "integer", minimum: 1 }, activation_condition: formText(), finding_ids: formIds(null, 1) }), null, 1),
    decisions: formArray(formObject({ finding_id: formId(), disposition: formEnum(["APPLIED", "DEFERRED", "EXCLUDED"]), reason: formText(), target_ids: formIds() }), null, 1),
    experiments: formArray(formObject({ id: formId(), question: formText(), variable: formText(), metric: formText(), activation_condition: formText(), comparison: formEnum(["CONTROLLED_VARIANT", "SEGMENT_COMPARISON"]), variants: formArray(formObject({ id: formId(), label: formText(300), direction_id: formId() }), null, 2), limitations: formText() }), null),
    budget: formObject({ total_cap_rub: { type: "integer", minimum: 1 }, phases: formArray(formObject({ id: formId(), label: formText(200), cap_rub: formMoney(), release_condition: formText() }), 12, 1), reserve_rule: formText() }),
    landing: formObject({ url: formText(4096), required_fields: formArray(formText(200), 30, 1), qualification_fields: formArray(formText(200), 30), proof: formText(), missing: formArray(formText(), 100) }),
    measurement: formObject({ qualified_result: formText(), paid_result: formText(), attribution: formText(), crm_status: formText(), followup: formText(), missing: formArray(formText(), 100) }),
    planning_inputs: formArray(formObject({ id: formId(), label: formText(300), value: number(true), unit: formText(100), state: formEnum(["OBSERVED", "TEST_DATA", "UNKNOWN"]), evidence_refs: formRefs(evidenceRefs), test_data_id: { type: ["string", "null"] }, metric: formEnum(["CPC", "CTR", "FORM_CR", "QUALIFICATION_RATE", "CLOSE_RATE", "MARGIN", "OTHER"]), direction_id: { type: ["string", "null"] } }, ["metric", "direction_id"]), null),
  }, goalPreparationRequired ? [] : ["goal_preparation"]);
}

export type FormationViolation = { code: string; pointer: string; message: string };
export function formationError(violations: FormationViolation[]): never {
  throw Object.assign(new Error("Результат формирования кампаний не прошёл проверку."), { code: "CAMPAIGN_FORMATION_INVALID", violations });
}
/** Interprets the small closed schema vocabulary above; never evaluates generated code or mutates data. */
export function validateFormationShape(schema: Schema, value: unknown, pointer = ""): FormationViolation[] {
  const result: FormationViolation[] = [];
  const fail = (message: string) => result.push({ code: "FORMATION_SHAPE_INVALID", pointer: pointer || "/", message });
  const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (!types.includes(actual) && !(actual === "number" && types.includes("integer") && Number.isSafeInteger(value))) { fail(`Ожидается ${types.join(" / ")}.`); return result; }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) fail("Значение отсутствует в допустимом наборе.");
  if (typeof value === "string") {
    if (value.trim().length < Number(schema.minLength ?? 0) || value.length > Number(schema.maxLength ?? Infinity)) fail("Длина текста вне допустимых границ.");
    if (schema.pattern && !new RegExp(String(schema.pattern), "u").test(value)) fail("Неверный формат идентификатора.");
  }
  if (typeof value === "number" && (!Number.isFinite(value) || value < Number(schema.minimum ?? -Infinity) || value > Number(schema.maximum ?? Infinity))) fail("Число вне допустимых границ.");
  if (Array.isArray(value)) {
    if (value.length < Number(schema.minItems ?? 0) || value.length > Number(schema.maxItems ?? Infinity)) fail("Количество элементов вне допустимых границ.");
    if (schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) fail("Элементы не должны повторяться.");
    value.forEach((item, i) => result.push(...validateFormationShape(schema.items as Schema, item, `${pointer}/${i}`)));
  } else if (value && typeof value === "object") {
    const row = value as Record<string, unknown>, props = (schema.properties ?? {}) as Record<string, Schema>;
    for (const key of (schema.required ?? []) as string[]) if (!Object.hasOwn(row, key)) fail(`Отсутствует поле ${key}.`);
    for (const [key, item] of Object.entries(row)) {
      if (props[key]) result.push(...validateFormationShape(props[key], item, `${pointer}/${key}`));
      else if (schema.additionalProperties === false) fail(`Неизвестное поле ${key}.`);
    }
  }
  return result;
}
export function verifyFormationResearch(research: FormationResearch) {
  const violations: FormationViolation[] = [];
  const add = (code: string, message: string) => violations.push({ code, pointer: "/research", message });
  const ids = research.findings.map(f => f.id);
  if (new Set(ids).size !== ids.length || new Set(research.test_data.map(d => d.id)).size !== research.test_data.length) add("FINDING_ID_DUPLICATE", "Идентификаторы выводов и тестовых данных должны быть уникальными.");
  if (new Set(research.coverage.map(c => c.area)).size !== FORMATION_AREAS.length) add("RESEARCH_AREA_MISSING", "Нужно дать результат исследования по каждой области.");
  for (const finding of research.findings) if (["OBSERVED", "INFERRED", "NO_ROWS_RETURNED", "CONFLICT"].includes(finding.state) && !finding.evidence_refs.length) add("FINDING_SOURCE_MISSING", `${finding.id}: требуется источник наблюдения.`);
  for (const area of research.coverage) {
    if (area.finding_ids.some(id => !research.findings.some(f => f.id === id && f.area === area.area))) add("COVERAGE_FINDING_INVALID", `${area.area}: вывод принадлежит другой области или отсутствует.`);
    if (research.findings.some(f => f.area === area.area && !area.finding_ids.includes(f.id))) add("FINDING_OMITTED", `${area.area}: вывод пропущен в учёте исследования.`);
  }
  if (research.mode !== "TEST_SCENARIO" && research.test_data.length) add("TEST_DATA_UNDECLARED", "Тестовые значения допустимы только в явно отмеченном тестовом прогоне.");
  if (violations.length) formationError(violations);
}

export function verifyFormationPlan(plan: FormationPlan, research: FormationResearch, weeklyBudget: number, landingUrl: string, qualifiedResult: string) {
  const violations: FormationViolation[] = [];
  const add = (code: string, message: string, pointer = "/formation_plan") => violations.push({ code, pointer, message });
  const ids = plan.directions.map(d => d.id), findingIds = research.findings.map(f => f.id);
  const targets = new Set([...ids, ...plan.experiments.map(e => e.id), "landing", "measurement", "budget", "planning", "semantics"]);
  if (new Set(ids).size !== ids.length) add("DIRECTION_ID_DUPLICATE", "Направления кампаний должны иметь уникальные идентификаторы.");
  if (plan.directions.reduce((sum, d) => sum + d.weekly_budget_rub, 0) > weeklyBudget) add("FORMATION_BUDGET_EXCEEDED", "Распределение превышает единый недельный бюджет стратегии.");
  if (plan.budget.phases.reduce((sum, p) => sum + p.cap_rub, 0) !== plan.budget.total_cap_rub) add("BUDGET_PHASE_SUM_MISMATCH", "Пределы этапов должны суммироваться в общий предел теста.");
  if (new Set(plan.budget.phases.map(p => p.id)).size !== plan.budget.phases.length) add("BUDGET_PHASE_ID_DUPLICATE", "Этапы бюджета должны иметь уникальные идентификаторы.");
  if (plan.landing.url !== landingUrl || plan.measurement.qualified_result !== qualifiedResult) add("FORMATION_GOAL_CHANGED", "Посадочная и квалифицированный результат должны совпадать со стратегией человека.");
  const usedFindings = plan.decisions.map(d => d.finding_id);
  if (usedFindings.length !== findingIds.length || new Set(usedFindings).size !== usedFindings.length || findingIds.some(id => !usedFindings.includes(id))) add("RESEARCH_DECISION_MISSING", "Каждый существенный вывод должен получить ровно одно решение: применён, отложен или исключён.");
  for (const decision of plan.decisions) {
    if (decision.target_ids.some(id => !targets.has(id)) || (decision.disposition === "APPLIED" && !decision.target_ids.length)) add("DECISION_TARGET_INVALID", `${decision.finding_id}: нужно конкретное место применения.`);
  }
  for (const direction of plan.directions) if (direction.finding_ids.some(id => !findingIds.includes(id))) add("DIRECTION_FINDING_UNKNOWN", `${direction.id}: неизвестный вывод исследования.`);
  const variants = plan.experiments.flatMap(e => e.variants.map(v => v.id));
  if (new Set(variants).size !== variants.length || new Set(plan.experiments.map(e => e.id)).size !== plan.experiments.length) add("EXPERIMENT_ID_DUPLICATE", "Гипотезы и варианты должны иметь уникальные идентификаторы.");
  for (const experiment of plan.experiments) if (experiment.variants.some(v => !ids.includes(v.direction_id))) add("EXPERIMENT_DIRECTION_UNKNOWN", `${experiment.id}: вариант не связан с направлением кампании.`);
  for (const [i, item] of plan.planning_inputs.entries()) {
    const pointer = `/formation_plan/planning_inputs/${i}`;
    if (item.direction_id && !ids.includes(item.direction_id)) add("PLANNING_DIRECTION_UNKNOWN", "Показатель относится к неизвестному направлению.", pointer);
    if (item.value !== null && (["CTR", "FORM_CR", "QUALIFICATION_RATE", "CLOSE_RATE"].includes(item.metric ?? "") && item.value > 100 || item.metric === "CPC" && item.value <= 0)) add("PLANNING_RATE_INVALID", "Проценты должны быть от 0 до 100; CPC — выше нуля.", pointer);
    if (item.state === "TEST_DATA") {
      const datum = research.test_data.find(d => d.id === item.test_data_id);
      if (!datum || datum.value !== item.value || research.mode !== "TEST_SCENARIO" || item.evidence_refs.length) add("TEST_DATA_PROVENANCE_INVALID", "Тестовое число должно точно совпадать с помеченной подстановкой и не иметь статуса наблюдения.", pointer);
    } else if (item.test_data_id !== null || (item.state === "UNKNOWN" && item.value !== null) || (item.state === "OBSERVED" && (item.value === null || !item.evidence_refs.length))) add("PLANNING_VALUE_STATE_INVALID", "Неизвестное число остаётся пустым; наблюдение требует источника.", pointer);
  }
  if (violations.length) formationError(violations);
}

/** Scenario arithmetic only. Missing inputs propagate as null, including a missing margin. */
export function calculateFormationModel(plan: FormationPlan, allocations: Array<{ direction_id: string; spend: number; conditional: boolean }>, includeConditional = true) {
  const metrics = ["CPC", "CTR", "FORM_CR", "QUALIFICATION_RATE", "CLOSE_RATE"];
  const missing: string[] = [];
  const rows = allocations.filter(a => includeConditional || !a.conditional).map(a => {
    const value = (metric: string) => {
      const found = plan.planning_inputs.find(p => p.metric === metric && p.direction_id === a.direction_id) ?? plan.planning_inputs.find(p => p.metric === metric && !p.direction_id);
      if (!found || found.value === null) missing.push(`${a.direction_id}:${metric}`);
      return found?.value ?? null;
    };
    const [cpc, ctr, form, qualification, close] = metrics.map(value);
    const margin = value("MARGIN");
    const clicks = cpc && cpc > 0 ? a.spend / cpc : null;
    const impressions = clicks !== null && ctr && ctr > 0 ? clicks / (ctr / 100) : null;
    const forms = clicks !== null && form !== null ? clicks * form / 100 : null;
    const qualified = forms !== null && qualification !== null ? forms * qualification / 100 : null;
    const paid = qualified !== null && close !== null ? qualified * close / 100 : null;
    return { ...a, clicks, impressions, forms, qualified, paid, contribution_after_ads: paid !== null && margin !== null ? paid * margin - a.spend : null };
  });
  const sum = (field: "clicks" | "impressions" | "forms" | "qualified" | "paid" | "contribution_after_ads") => rows.every(r => r[field] !== null) ? rows.reduce((s, r) => s + r[field]!, 0) : null;
  return { rows, spend: rows.reduce((s, r) => s + r.spend, 0), clicks: sum("clicks"), impressions: sum("impressions"), forms: sum("forms"), qualified: sum("qualified"), paid: sum("paid"), contribution_after_ads: sum("contribution_after_ads"), missing, actuals: null };
}

export function formationInstructions(stage: string) {
  return {
    methodology: CAMPAIGN_FORMATION_METHOD,
    owner: stage === "CAMPAIGN_GOAL" ? "HUMAN" : "SINGLE_CODEX",
    operating_rule: "The human defines and confirms Goal. One controlling Codex completes research, strategy and campaigns, including research gaps and rejected proposals. Do not ask the owner to operate tools or approve routine stages.",
    research: "Inspect the complete saved corpus and all relevant product, buyer, objection, offer format/calendar, competitor, contractor-case, demand, landing, measurement and economics evidence. Give every material finding a stable ID. Preserve source period, uncertainty, contradictory prices and no-rows results. Additional research is allowed through permitted source tools; upload the updated source snapshot through Dashboard before relying on it.",
    search_completion: "Select research by its expected effect on the owner's qualified-result goal. Before an additional query, state which decision its answer can change: funded buyer intent/groups, differentiated copy, material budget allocation or wasted traffic. Use explicit Wordstat reads for those material gaps; 20 queries is a per-phase operational limit, never a research quota. Do not collect every suggested variant, irrelevant tail or overlapping key. Low-impact candidates may remain uncollected with a scope reason. Before completion retain concise intent coverage, material candidate dispositions, effective negatives reviewed for each group, protected qualified-query examples and a stopping reason based on diminishing decision value. Measured-only filtering, generic negative-list reuse, passing validation and successful saving do not establish useful coverage. Resolve material research gaps, preserve lesser uncertainties, and complete the strongest supported campaign under the owner's constraints.",
    strategy: "Resolve every material finding into APPLIED, DEFERRED or EXCLUDED with a reason and concrete target. Decide direction count, intent groups, channels, staged budget, experiments, landing and measurement from the goal and research. Counts are resource ceilings, never content quotas. Different format audiences are segment comparisons, not controlled A/B evidence.",
    campaigns: "Implement the accepted directions, all experiment variants and all applied decisions in actual campaign objects. Separate Search keywords from network themes and retargeting segments. Give each ad, group, criterion and source a stable ID. Preserve incomplete demand and conditional audiences; never replace an unknown count with zero. Validate sums, references, copy, exclusions, periods and completeness.",
    test_data: "Use test values only when explicitly authorized. List every substituted value, what could not be found, attempted sources, and affected decisions. Test values are planning inputs only and cannot establish real advertising promises, verified audience IDs, actual campaign metrics, or commercial effectiveness.",
    publication: "LOCAL_PREPARATION_ONLY",
  };
}

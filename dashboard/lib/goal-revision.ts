import { normalizeGoalMetric, validGoalMetricTarget, goalMetricPreset, formatGoalMetricTarget, GOAL_METRIC_LABELS, type GoalMetricDefinition, type GoalComparison } from "./goal-metric.ts";

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u;

export const GOAL_CANDIDATE_SCHEMA = "p0-goal-candidate-v1";
export const GOAL_REVISION_SCHEMA = "p0-goal-revision-v1";
export const GOAL_REVISION_CONTRACT_VERSION = "1.0.0";

export const GOAL_CANDIDATE_SCHEMA_V2 = "p0-goal-candidate-v2";
export const GOAL_REVISION_SCHEMA_V2 = "p0-goal-revision-v2";
export const GOAL_REVISION_CONTRACT_VERSION_V2 = "2.0.0";
export const GOAL_CANDIDATE_SCHEMA_V3 = "p0-goal-candidate-v3";
export const GOAL_REVISION_SCHEMA_V3 = "p0-goal-revision-v3";
export const GOAL_REVISION_CONTRACT_VERSION_V3 = "3.0.0";
export const GOAL_CANDIDATE_SCHEMA_V4 = "p0-goal-candidate-v4";
export const GOAL_REVISION_SCHEMA_V4 = "p0-goal-revision-v4";
export const GOAL_REVISION_CONTRACT_VERSION_V4 = "4.0.0";

// A business counting definition, not an implemented CRM/attribution measurement.
export type GoalCountingPolicy = {
  unit: "UNIQUE_QUALIFIED_COMMERCIAL_REQUEST";
  deduplication_key: "COMPANY_AND_REQUEST";
  repeated_contacts: "DO_NOT_COUNT";
  form_submission_alone: "DOES_NOT_QUALIFY";
};
export const QUALIFIED_REQUEST_COUNTING_POLICY: GoalCountingPolicy = Object.freeze({
  unit: "UNIQUE_QUALIFIED_COMMERCIAL_REQUEST",
  deduplication_key: "COMPANY_AND_REQUEST",
  repeated_contacts: "DO_NOT_COUNT",
  form_submission_alone: "DOES_NOT_QUALIFY",
});
export const GOAL_COUNTING_RULE = "Один результат — одно уникальное квалифицированное коммерческое обращение компании. Повторные контакты по тому же обращению не добавляют результатов; разные обращения одной компании могут учитываться отдельно. Отправка формы сама по себе не квалифицирует результат.";

export function normalizeGoalCountingPolicy(value: unknown): GoalCountingPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !exactKeys(value, Object.keys(QUALIFIED_REQUEST_COUNTING_POLICY))
    || Object.entries(QUALIFIED_REQUEST_COUNTING_POLICY).some(([key, expected]) => (value as Record<string, unknown>)[key] !== expected)) {
    fail("GOAL_COUNTING_POLICY_REQUIRED", "Подтвердите правило подсчёта уникальных квалифицированных обращений; отправка формы не является результатом.");
  }
  return { ...QUALIFIED_REQUEST_COUNTING_POLICY };
}

/** Owner-approved default for new submissions; sealed revisions still require an explicit valid policy. */
export function ownerGoalCountingPolicy(value?: unknown): GoalCountingPolicy {
  return normalizeGoalCountingPolicy(value === undefined ? QUALIFIED_REQUEST_COUNTING_POLICY : value);
}

export function normalizeGoalGeography(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) fail("GOAL_GEOGRAPHY_REQUIRED", "Укажите географию клиентов: её определяет владелец, это не место проведения мероприятия.");
  return normalizedText(value, "География клиентов", 1000);
}

type GoalReadinessInput = Pick<GoalRevision, "desired_outcome" | "qualified_action" | "success_criterion" | "customer_geography" | "counting_policy">;
export type ReadyGoalData = GoalReadinessInput & {
  success_criterion: GoalSuccessCriterion;
  customer_geography: string;
  counting_policy?: GoalCountingPolicy;
};

/** Checks completeness, not feasibility or the immutable revision seal. */
export function goalReadinessErrors(goal: GoalReadinessInput | null | undefined, requireTotalBudget = false): string[] {
  const errors: string[] = [];
  try { normalizeGoalText(goal?.desired_outcome, "Бизнес-цель и рекламируемый предмет"); } catch (error) { errors.push((error as Error).message); }
  try { normalizeGoalText(goal?.qualified_action, "Квалифицированный результат"); } catch (error) { errors.push((error as Error).message); }
  try { if (!normalizeGoalSuccessCriterion(goal?.success_criterion)) throw new Error("Укажите целевой показатель, срок и общий бюджет."); else if (requireTotalBudget && goalTotalBudgetRub(goal?.success_criterion) === null) throw new Error("Укажите общий бюджет в первом этапе. Старая максимальная цена результата не является общим бюджетом."); } catch (error) { errors.push((error as Error).message); }
  try { normalizeGoalGeography(goal?.customer_geography); } catch (error) { errors.push((error as Error).message); }
  if (isTypedGoalCriterion(goal?.success_criterion)) {
    if (goal?.counting_policy !== undefined) errors.push("Для измеримой цели используется её собственное правило подсчёта, без подстановки правила обращений.");
    if (goal.success_criterion.metric.counted_event !== goal.qualified_action) errors.push("Засчитываемое событие должно точно совпадать с результатом, заданным владельцем.");
  } else try { normalizeGoalCountingPolicy(goal?.counting_policy); } catch (error) { errors.push((error as Error).message); }
  return errors;
}

export function assertGoalReady(goal: GoalReadinessInput | null | undefined, requireTotalBudget = false): asserts goal is ReadyGoalData {
  const errors = goalReadinessErrors(goal, requireTotalBudget);
  if (errors.length) fail("GOAL_INCOMPLETE", errors.join(" "));
}

/** Closed, non-coercing boundary for owner form submissions. */
export function normalizeOwnerGoalInput(input: { [K in Exclude<keyof Required<GoalReadinessInput>, "counting_policy">]: unknown } & { counting_policy?: unknown }): ReadyGoalData {
  const criterion = normalizeGoalSuccessCriterion(input.success_criterion);
  const goal = {
    desired_outcome: normalizeGoalText(input.desired_outcome, "Бизнес-цель и рекламируемый предмет"),
    qualified_action: normalizeGoalText(input.qualified_action, "Квалифицированный результат"),
    success_criterion: criterion,
    customer_geography: normalizeGoalGeography(input.customer_geography),
    ...(isTypedGoalCriterion(criterion) ? (input.counting_policy === undefined ? {} : { counting_policy: input.counting_policy as GoalCountingPolicy }) : { counting_policy: ownerGoalCountingPolicy(input.counting_policy) }),
  };
  assertGoalReady(goal);
  return goal;
}

export function normalizeGoalText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.normalize("NFKC").trim() || value.length > 1000) {
    fail("GOAL_CANDIDATE_INVALID", `${label}: укажите текст длиной до 1000 символов.`);
  }
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

export type GoalInputReference = {
  input_id: string;
  schema_version: string;
  revision_id: string;
  digest: string;
};

export type GoalEvidenceReference = {
  supports: "DESIRED_OUTCOME" | "QUALIFIED_ACTION" | "SUCCESS_CRITERION" | "CUSTOMER_GEOGRAPHY" | "COUNTING_POLICY";
  input_id: string;
  locator: string;
  evidence: string;
};

export type LegacyGoalSuccessCriterion = {
  target_count: number;
  target_value?: never;
  comparison?: never;
  metric?: never;
  deadline: string;
} & ({ total_budget_rub: number; max_result_cost_rub?: never } | { max_result_cost_rub: number; total_budget_rub?: never });
export type TypedGoalSuccessCriterion = {
  target_value: number;
  comparison: GoalComparison;
  metric: GoalMetricDefinition;
  deadline: string;
  total_budget_rub: number;
  target_count?: never;
  max_result_cost_rub?: never;
};
export type GoalSuccessCriterion = LegacyGoalSuccessCriterion | TypedGoalSuccessCriterion;
export function isTypedGoalCriterion(value: GoalSuccessCriterion | null | undefined): value is TypedGoalSuccessCriterion {
  return Boolean(value && Object.hasOwn(value, "metric"));
}
export function goalTargetValue(criterion: GoalSuccessCriterion | null | undefined): number | null {
  return criterion ? isTypedGoalCriterion(criterion) ? criterion.target_value : criterion.target_count : null;
}
export function goalComparison(criterion: GoalSuccessCriterion | null | undefined): GoalComparison {
  return isTypedGoalCriterion(criterion) ? criterion.comparison : "AT_LEAST";
}
export function goalMeasurement(goal: Pick<GoalRevision, "success_criterion" | "qualified_action">): GoalMetricDefinition {
  return isTypedGoalCriterion(goal.success_criterion) ? structuredClone(goal.success_criterion.metric) : goalMetricPreset("QUALIFIED_REQUEST", goal.qualified_action);
}
export function goalCountTarget(criterion: GoalSuccessCriterion | null | undefined): number | null {
  return isTypedGoalCriterion(criterion) && (criterion.metric.family !== "COUNT" || criterion.comparison !== "AT_LEAST") ? null : goalTargetValue(criterion);
}

export function goalTotalBudgetRub(criterion: GoalSuccessCriterion | null | undefined): number | null {
  return typeof criterion?.total_budget_rub === "number" && Number.isSafeInteger(criterion.total_budget_rub) && criterion.total_budget_rub > 0 ? criterion.total_budget_rub : null;
}
/** An internal planning ceiling derived from the total goal budget, never another owner input. */
export function goalResultCostCeiling(criterion: GoalSuccessCriterion | null | undefined): number | null {
  const budget = goalTotalBudgetRub(criterion);
  const target = goalCountTarget(criterion);
  if (budget !== null && target !== null && target > 0) return budget / target;
  return typeof criterion?.max_result_cost_rub === "number" && criterion.max_result_cost_rub > 0 ? criterion.max_result_cost_rub : null;
}
export function describeGoalCriterion(criterion: GoalSuccessCriterion): string {
  if (isTypedGoalCriterion(criterion)) return `${GOAL_METRIC_LABELS[criterion.metric.outcome_type]}: ${criterion.comparison === "AT_LEAST" ? "не менее" : "не более"} ${formatGoalMetricTarget(criterion.target_value, criterion.metric)} до ${criterion.deadline}, общий бюджет ${criterion.total_budget_rub} ₽`;
  return `${criterion.target_count} результатов до ${criterion.deadline}, ${goalTotalBudgetRub(criterion) !== null ? `общий бюджет ${criterion.total_budget_rub} ₽` : `историческая максимальная цена результата ${criterion.max_result_cost_rub} ₽`}`;
}

export type GoalCandidateOption = {
  option_id: string;
  desired_outcome: string;
  qualified_action: string;
  evidence: GoalEvidenceReference[];
  consequences: string[];
  recommended: boolean;
};

export type GoalCandidate = {
  schema_version: typeof GOAL_CANDIDATE_SCHEMA | typeof GOAL_CANDIDATE_SCHEMA_V2 | typeof GOAL_CANDIDATE_SCHEMA_V3 | typeof GOAL_CANDIDATE_SCHEMA_V4;
  desired_outcome: string;
  qualified_action: string;
  success_criterion?: GoalSuccessCriterion | null;
  customer_geography?: string;
  counting_policy?: GoalCountingPolicy;
  used_input_ids: string[];
  provenance: GoalEvidenceReference[];
  known_constraints: Array<{
    constraint: string;
    input_ids: string[];
  }>;
  material_ambiguity: null | {
    reason: string;
    options: GoalCandidateOption[];
  };
};

export type GoalRevision = {
  schema_version: typeof GOAL_REVISION_SCHEMA | typeof GOAL_REVISION_SCHEMA_V2 | typeof GOAL_REVISION_SCHEMA_V3 | typeof GOAL_REVISION_SCHEMA_V4;
  contract_version: typeof GOAL_REVISION_CONTRACT_VERSION | typeof GOAL_REVISION_CONTRACT_VERSION_V2 | typeof GOAL_REVISION_CONTRACT_VERSION_V3 | typeof GOAL_REVISION_CONTRACT_VERSION_V4;
  goal_revision_id: string;
  version: number;
  digest: string;
  desired_outcome: string;
  qualified_action: string;
  success_criterion?: GoalSuccessCriterion | null;
  customer_geography?: string;
  counting_policy?: GoalCountingPolicy;
  exact_inputs: GoalInputReference[];
  provenance: GoalEvidenceReference[];
  known_constraints: GoalCandidate["known_constraints"];
  validation: {
    status: "VERIFIED";
    validator: "DETERMINISTIC_CODE";
    owner_confirmation_required: false;
    verified_at: string;
  };
};

export type GoalMaterialDecision = {
  status: "MATERIAL_DECISION_REQUIRED";
  reason: string;
  recommendation: string;
  options: Array<{
    option_id: string;
    desired_outcome: string;
    qualified_action: string;
    evidence: GoalEvidenceReference[];
    consequences: string[];
    recommended: boolean;
  }>;
};

export type GoalFormationResult =
  | { status: "VERIFIED"; revision: GoalRevision }
  | GoalMaterialDecision;

export class GoalRevisionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GoalRevisionError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new GoalRevisionError(code, message);
}

function exactKeys(value: object, keys: string[]) {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function normalizedText(value: unknown, label: string, maximum = 1_000) {
  const text = String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!text || text.length > maximum) fail("GOAL_CANDIDATE_INVALID", `${label} is required and must be at most ${maximum} characters.`);
  return text;
}

export function normalizeGoalSuccessCriterion(value: unknown): GoalSuccessCriterion | null {
  if (value === null || value === undefined) return null;
  if (value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "metric")) {
    if (!exactKeys(value, ["target_value", "comparison", "metric", "deadline", "total_budget_rub"])) fail("GOAL_SUCCESS_CRITERION_INVALID", "Измеримая цель требует своего показателя, правила сравнения, срока и общего бюджета.");
    const input = value as TypedGoalSuccessCriterion;
    const metric = normalizeGoalMetric(input.metric);
    const deadline = typeof input.deadline === "string" ? input.deadline.trim() : "";
    const date = /^\d{4}-\d{2}-\d{2}$/u.test(deadline) ? new Date(`${deadline}T00:00:00Z`) : null;
    if (!validGoalMetricTarget(input.target_value, metric) || !["AT_LEAST", "AT_MOST"].includes(input.comparison)
      || !Number.isSafeInteger(input.total_budget_rub) || input.total_budget_rub <= 0
      || !date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== deadline) fail("GOAL_SUCCESS_CRITERION_INVALID", "Проверьте величину и единицу цели, существующую дату и положительный целый бюджет.");
    return { target_value: input.target_value, comparison: input.comparison, metric, deadline, total_budget_rub: input.total_budget_rub };
  }
  const budgetField = value && typeof value === "object" && Object.hasOwn(value, "total_budget_rub") ? "total_budget_rub" : "max_result_cost_rub";
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !exactKeys(value, ["target_count", "deadline", budgetField])) {
    fail("GOAL_SUCCESS_CRITERION_INVALID", "Укажите целевое количество, срок и общий бюджет.");
  }
  const criterion = value as LegacyGoalSuccessCriterion;
  const targetCount = criterion.target_count;
  const amount = criterion[budgetField];
  const deadline = typeof criterion.deadline === "string" ? criterion.deadline.trim() : "";
  const deadlineDate = /^\d{4}-\d{2}-\d{2}$/u.test(deadline) ? new Date(`${deadline}T00:00:00Z`) : null;
  if (!Number.isSafeInteger(targetCount) || targetCount < 1
    || !Number.isSafeInteger(amount) || typeof amount !== "number" || amount < 1
    || !deadlineDate || Number.isNaN(deadlineDate.getTime())
    || deadlineDate.toISOString().slice(0, 10) !== deadline) {
    fail("GOAL_SUCCESS_CRITERION_INVALID", "Количество и бюджет — положительные целые числа, срок — существующая дата.");
  }
  return budgetField === "total_budget_rub" ? { target_count: targetCount, deadline, total_budget_rub: amount } : { target_count: targetCount, deadline, max_result_cost_rub: amount };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalize(item)]));
}

async function digest(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(hash)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

function validateInputReferences(input: GoalInputReference[]) {
  if (!Array.isArray(input) || input.length < 1) fail("GOAL_INPUTS_INVALID", "At least one exact Goal input is required.");
  const ids = new Set<string>();
  for (const reference of input) {
    if (!reference || typeof reference !== "object" || !exactKeys(reference, ["input_id", "schema_version", "revision_id", "digest"])
      || !IDENTIFIER.test(String(reference.input_id))
      || !IDENTIFIER.test(String(reference.revision_id))
      || !normalizedText(reference.schema_version, "Input schema version", 255)
      || !SHA256_DIGEST.test(String(reference.digest))
      || ids.has(reference.input_id)) {
      fail("GOAL_INPUTS_INVALID", "Goal inputs must be unique exact version references.");
    }
    ids.add(reference.input_id);
  }
  return ids;
}

function validateEvidence(value: unknown, availableInputs: Set<string>): GoalEvidenceReference {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !exactKeys(value, ["supports", "input_id", "locator", "evidence"])) {
    fail("GOAL_PROVENANCE_INVALID", "Goal evidence must use the closed provenance schema.");
  }
  const evidence = value as GoalEvidenceReference;
  if (!availableInputs.has(evidence.input_id) || !["DESIRED_OUTCOME", "QUALIFIED_ACTION", "SUCCESS_CRITERION", "CUSTOMER_GEOGRAPHY", "COUNTING_POLICY"].includes(evidence.supports)) {
    fail("GOAL_PROVENANCE_INVALID", "Goal evidence must support one typed field from the exact input set.");
  }
  return {
    supports: evidence.supports,
    input_id: evidence.input_id,
    locator: normalizedText(evidence.locator, "Evidence locator", 500),
    evidence: normalizedText(evidence.evidence, "Evidence", 1_000),
  };
}

function normalizeCandidate(candidate: GoalCandidate, exactInputs: GoalInputReference[]): GoalCandidate {
  const v4 = candidate?.schema_version === GOAL_CANDIDATE_SCHEMA_V4;
  const v3 = candidate?.schema_version === GOAL_CANDIDATE_SCHEMA_V3 || v4;
  const v2 = candidate?.schema_version === GOAL_CANDIDATE_SCHEMA_V2 || v3;
  const candidateKeys = ["schema_version", "desired_outcome", "qualified_action", "used_input_ids", "provenance", "known_constraints", "material_ambiguity"];
  if (candidate && typeof candidate === "object" && Object.hasOwn(candidate, "success_criterion")) candidateKeys.push("success_criterion");
  if (v2) candidateKeys.push("customer_geography");
  if (v2 && !v4) candidateKeys.push("counting_policy");
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)
    || !exactKeys(candidate, candidateKeys)
    || (!v2 && candidate.schema_version !== GOAL_CANDIDATE_SCHEMA)) {
    fail("GOAL_CANDIDATE_INVALID", "Goal candidate does not match the closed schema.");
  }
  const availableInputs = validateInputReferences(exactInputs);
  if (!Array.isArray(candidate.used_input_ids) || candidate.used_input_ids.length < 1
    || new Set(candidate.used_input_ids).size !== candidate.used_input_ids.length
    || candidate.used_input_ids.some((inputId) => !availableInputs.has(inputId))) {
    fail("GOAL_INPUTS_INVALID", "The candidate must name every used input from the exact input set.");
  }
  const usedInputs = new Set(candidate.used_input_ids);
  if (!Array.isArray(candidate.provenance) || candidate.provenance.length < 1) {
    fail("GOAL_PROVENANCE_INVALID", "Desired outcome and qualified action require evidence.");
  }
  const provenance = candidate.provenance.map((item) => validateEvidence(item, usedInputs));
  if (!provenance.some((item) => item.supports === "DESIRED_OUTCOME")
    || !provenance.some((item) => item.supports === "QUALIFIED_ACTION")) {
    fail("GOAL_PROVENANCE_INVALID", "Desired outcome and qualified action each require typed provenance.");
  }
  if (!Array.isArray(candidate.known_constraints)) fail("GOAL_CONSTRAINTS_INVALID", "Known constraints must be an explicit array.");
  const knownConstraints = candidate.known_constraints.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || !exactKeys(item, ["constraint", "input_ids"])
      || !Array.isArray(item.input_ids) || item.input_ids.length < 1
      || new Set(item.input_ids).size !== item.input_ids.length
      || item.input_ids.some((inputId) => !usedInputs.has(inputId))) {
      fail("GOAL_CONSTRAINTS_INVALID", "Each known constraint must link to one or more used inputs.");
    }
    return {
      constraint: normalizedText(item.constraint, "Known constraint", 1_000),
      input_ids: [...item.input_ids],
    };
  });
  const normalized: GoalCandidate = {
    schema_version: candidate.schema_version,
    desired_outcome: normalizedText(candidate.desired_outcome, "Desired business outcome"),
    qualified_action: normalizedText(candidate.qualified_action, "Qualified action"),
    used_input_ids: [...candidate.used_input_ids],
    provenance,
    known_constraints: knownConstraints,
    material_ambiguity: null,
  };
  if (Object.hasOwn(candidate, "success_criterion")) {
    normalized.success_criterion = normalizeGoalSuccessCriterion(candidate.success_criterion);
  }
  if (isTypedGoalCriterion(normalized.success_criterion) && !v4) fail("GOAL_METRIC_SCHEMA_MISMATCH", "Измеримая цель требует версии v4.");
  if (v2) {
    normalizeGoalText(candidate.desired_outcome, "Бизнес-цель и рекламируемый предмет");
    normalizeGoalText(candidate.qualified_action, "Квалифицированный результат");
    normalized.customer_geography = normalizeGoalGeography(candidate.customer_geography);
    if (!v4) normalized.counting_policy = normalizeGoalCountingPolicy(candidate.counting_policy);
    if (v4 !== isTypedGoalCriterion(normalized.success_criterion)) fail("GOAL_METRIC_SCHEMA_MISMATCH", "Измеримая цель требует версии v4; старые цели сохраняют собственную семантику.");
    assertGoalReady(normalized, v3);
    if (!v3 && goalTotalBudgetRub(normalized.success_criterion) !== null) fail("GOAL_SCHEMA_BUDGET_MISMATCH", "Общий бюджет требует новой версии цели.");
    for (const field of (v4 ? ["SUCCESS_CRITERION", "CUSTOMER_GEOGRAPHY"] : ["SUCCESS_CRITERION", "CUSTOMER_GEOGRAPHY", "COUNTING_POLICY"]) as GoalEvidenceReference["supports"][]) {
      if (!provenance.some((item) => item.supports === field)) fail("GOAL_PROVENANCE_INVALID", `${field} requires exact owner-input provenance.`);
    }
    if (v4 && provenance.some(item => item.supports === "COUNTING_POLICY")) fail("GOAL_PROVENANCE_INVALID", "Правило измерения v4 относится к точному критерию успеха, а не к прежнему подсчёту обращений.");
  } else if (provenance.some((item) => ["CUSTOMER_GEOGRAPHY", "COUNTING_POLICY"].includes(item.supports))) {
    fail("GOAL_PROVENANCE_INVALID", "Legacy Goal provenance cannot claim v2 fields.");
  }
  if (candidate.material_ambiguity === null) return normalized;
  const ambiguity = candidate.material_ambiguity;
  if (!ambiguity || typeof ambiguity !== "object" || Array.isArray(ambiguity)
    || !exactKeys(ambiguity, ["reason", "options"])
    || !Array.isArray(ambiguity.options) || ambiguity.options.length < 2 || ambiguity.options.length > 5) {
    fail("GOAL_AMBIGUITY_INVALID", "Material ambiguity requires two to five prepared options.");
  }
  const options = ambiguity.options.map((option) => {
    if (!option || typeof option !== "object" || Array.isArray(option)
      || !exactKeys(option, ["option_id", "desired_outcome", "qualified_action", "evidence", "consequences", "recommended"])
      || !IDENTIFIER.test(String(option.option_id))
      || !Array.isArray(option.evidence) || option.evidence.length < 1
      || !Array.isArray(option.consequences) || option.consequences.length < 1
      || typeof option.recommended !== "boolean") {
      fail("GOAL_AMBIGUITY_INVALID", "Each Goal option needs evidence, consequences, and a recommendation flag.");
    }
    return {
      option_id: option.option_id,
      desired_outcome: normalizedText(option.desired_outcome, "Option desired outcome"),
      qualified_action: normalizedText(option.qualified_action, "Option qualified action"),
      evidence: option.evidence.map((item) => validateEvidence(item, usedInputs)),
      consequences: option.consequences.map((item) => normalizedText(item, "Option consequence")),
      recommended: option.recommended,
    };
  });
  if (options.some((option) => !option.evidence.some((item) => item.supports === "DESIRED_OUTCOME")
    || !option.evidence.some((item) => item.supports === "QUALIFIED_ACTION"))) {
    fail("GOAL_PROVENANCE_INVALID", "Every material option needs evidence for its desired outcome and qualified action.");
  }
  const distinctOutcomes = new Set(options.map((option) => option.desired_outcome.toLocaleLowerCase("ru-RU")));
  if (distinctOutcomes.size !== options.length || new Set(options.map((option) => option.option_id)).size !== options.length
    || options.filter((option) => option.recommended).length !== 1) {
    fail("GOAL_AMBIGUITY_NOT_MATERIAL", "Options must have materially different desired outcomes and exactly one recommendation.");
  }
  const recommendation = options.find((option) => option.recommended)!;
  if (recommendation.desired_outcome !== normalized.desired_outcome || recommendation.qualified_action !== normalized.qualified_action) {
    fail("GOAL_AMBIGUITY_INVALID", "The candidate must carry the exact recommended option as its proposed goal.");
  }
  normalized.material_ambiguity = {
    reason: normalizedText(ambiguity.reason, "Material ambiguity reason"),
    options,
  };
  return normalized;
}

function revisionMaterial(revision: Omit<GoalRevision, "goal_revision_id" | "digest">) {
  return revision;
}

export async function verifyGoalCandidate(input: {
  candidate: GoalCandidate;
  exact_inputs: GoalInputReference[];
  verified_at: string;
  previous_version?: number | null;
}): Promise<GoalFormationResult> {
  const candidate = normalizeCandidate(input.candidate, input.exact_inputs);
  const verifiedAt = normalizedText(input.verified_at, "Verification time", 100);
  if (!Number.isFinite(Date.parse(verifiedAt))) fail("GOAL_VERIFICATION_TIME_INVALID", "Goal verification time must be ISO-8601.");
  if (input.previous_version !== undefined && input.previous_version !== null
    && (!Number.isSafeInteger(input.previous_version) || input.previous_version < 1)) {
    fail("GOAL_VERSION_INVALID", "Previous Goal version must be a positive integer.");
  }
  if (candidate.material_ambiguity) {
    const recommended = candidate.material_ambiguity.options.find((option) => option.recommended)!;
    return {
      status: "MATERIAL_DECISION_REQUIRED",
      reason: candidate.material_ambiguity.reason,
      recommendation: recommended.option_id,
      options: structuredClone(candidate.material_ambiguity.options),
    };
  }
  const exactInputById = new Map(input.exact_inputs.map((reference) => [reference.input_id, reference]));
  const base: Omit<GoalRevision, "goal_revision_id" | "digest"> = {
    schema_version: candidate.schema_version === GOAL_CANDIDATE_SCHEMA_V4 ? GOAL_REVISION_SCHEMA_V4 : candidate.schema_version === GOAL_CANDIDATE_SCHEMA_V3 ? GOAL_REVISION_SCHEMA_V3 : candidate.schema_version === GOAL_CANDIDATE_SCHEMA_V2 ? GOAL_REVISION_SCHEMA_V2 : GOAL_REVISION_SCHEMA,
    contract_version: candidate.schema_version === GOAL_CANDIDATE_SCHEMA_V4 ? GOAL_REVISION_CONTRACT_VERSION_V4 : candidate.schema_version === GOAL_CANDIDATE_SCHEMA_V3 ? GOAL_REVISION_CONTRACT_VERSION_V3 : candidate.schema_version === GOAL_CANDIDATE_SCHEMA_V2 ? GOAL_REVISION_CONTRACT_VERSION_V2 : GOAL_REVISION_CONTRACT_VERSION,
    version: (input.previous_version ?? 0) + 1,
    desired_outcome: candidate.desired_outcome,
    qualified_action: candidate.qualified_action,
    exact_inputs: candidate.used_input_ids.map((inputId) => structuredClone(exactInputById.get(inputId)!)),
    provenance: candidate.provenance,
    known_constraints: candidate.known_constraints,
    validation: {
      status: "VERIFIED",
      validator: "DETERMINISTIC_CODE",
      owner_confirmation_required: false,
      verified_at: verifiedAt,
    },
  };
  if (Object.hasOwn(candidate, "success_criterion")) {
    base.success_criterion = candidate.success_criterion ? structuredClone(candidate.success_criterion) : null;
  }
  if (candidate.schema_version === GOAL_CANDIDATE_SCHEMA_V2 || candidate.schema_version === GOAL_CANDIDATE_SCHEMA_V3 || candidate.schema_version === GOAL_CANDIDATE_SCHEMA_V4) {
    base.customer_geography = candidate.customer_geography;
    if (candidate.schema_version !== GOAL_CANDIDATE_SCHEMA_V4) base.counting_policy = structuredClone(candidate.counting_policy!);
  }
  const materialDigest = await digest(revisionMaterial(base));
  return {
    status: "VERIFIED",
    revision: {
      ...base,
      goal_revision_id: `goal-revision:${materialDigest.slice("sha256:".length, "sha256:".length + 24)}`,
      digest: materialDigest,
    },
  };
}

export async function verifyGoalFormationResult(value: GoalFormationResult) {
  if (value?.status === "MATERIAL_DECISION_REQUIRED") {
    if (!exactKeys(value, ["status", "reason", "recommendation", "options"])) fail("GOAL_RESULT_INVALID", "Goal decision packet contains unknown fields.");
    const candidate: GoalCandidate = {
      schema_version: GOAL_CANDIDATE_SCHEMA,
      desired_outcome: value.options.find((option) => option.recommended)?.desired_outcome ?? "",
      qualified_action: value.options.find((option) => option.recommended)?.qualified_action ?? "",
      used_input_ids: [...new Set(value.options.flatMap((option) => option.evidence.map((item) => item.input_id)))],
      provenance: value.options.flatMap((option) => option.evidence),
      known_constraints: [],
      material_ambiguity: { reason: value.reason, options: value.options },
    };
    const exactInputs = candidate.used_input_ids.map((inputId) => ({
      input_id: inputId,
      schema_version: "decision-packet-check",
      revision_id: `decision-packet:${inputId}`,
      digest: `sha256:${"0".repeat(64)}`,
    }));
    const checked = await verifyGoalCandidate({ candidate, exact_inputs: exactInputs, verified_at: "2000-01-01T00:00:00.000Z" });
    if (checked.status !== "MATERIAL_DECISION_REQUIRED" || checked.recommendation !== value.recommendation) fail("GOAL_RESULT_INVALID", "Goal decision recommendation is inconsistent.");
    return;
  }
  if (value?.status !== "VERIFIED" || !value.revision || !exactKeys(value, ["status", "revision"])) fail("GOAL_RESULT_INVALID", "Goal formation result is invalid.");
  const revision = value.revision;
  const v4 = revision.schema_version === GOAL_REVISION_SCHEMA_V4;
  const v3 = revision.schema_version === GOAL_REVISION_SCHEMA_V3 || v4;
  const v2 = revision.schema_version === GOAL_REVISION_SCHEMA_V2 || v3;
  const revisionKeys = ["schema_version", "contract_version", "goal_revision_id", "version", "digest", "desired_outcome", "qualified_action", "exact_inputs", "provenance", "known_constraints", "validation"];
  if (Object.hasOwn(revision, "success_criterion")) revisionKeys.push("success_criterion");
  if (v2) revisionKeys.push("customer_geography");
  if (v2 && !v4) revisionKeys.push("counting_policy");
  if (!exactKeys(revision, revisionKeys)
    || (!v2 && revision.schema_version !== GOAL_REVISION_SCHEMA)
    || revision.contract_version !== (v4 ? GOAL_REVISION_CONTRACT_VERSION_V4 : v3 ? GOAL_REVISION_CONTRACT_VERSION_V3 : v2 ? GOAL_REVISION_CONTRACT_VERSION_V2 : GOAL_REVISION_CONTRACT_VERSION)
    || !IDENTIFIER.test(revision.goal_revision_id)
    || !Number.isSafeInteger(revision.version) || revision.version < 1
    || !SHA256_DIGEST.test(revision.digest)
    || !revision.validation || !exactKeys(revision.validation, ["status", "validator", "owner_confirmation_required", "verified_at"])
    || revision.validation.status !== "VERIFIED"
    || revision.validation.validator !== "DETERMINISTIC_CODE"
    || revision.validation?.owner_confirmation_required !== false) {
    fail("GOAL_REVISION_INVALID", "Verified GoalRevision metadata is invalid.");
  }
  const candidate: GoalCandidate = {
    schema_version: v4 ? GOAL_CANDIDATE_SCHEMA_V4 : v3 ? GOAL_CANDIDATE_SCHEMA_V3 : v2 ? GOAL_CANDIDATE_SCHEMA_V2 : GOAL_CANDIDATE_SCHEMA,
    desired_outcome: revision.desired_outcome,
    qualified_action: revision.qualified_action,
    used_input_ids: revision.exact_inputs.map((item) => item.input_id),
    provenance: revision.provenance,
    known_constraints: revision.known_constraints,
    material_ambiguity: null,
  };
  if (Object.hasOwn(revision, "success_criterion")) {
    candidate.success_criterion = revision.success_criterion ? structuredClone(revision.success_criterion) : null;
  }
  if (v2) {
    candidate.customer_geography = revision.customer_geography;
    if (!v4) candidate.counting_policy = revision.counting_policy;
  }
  normalizeCandidate(candidate, revision.exact_inputs);
  if (!Number.isFinite(Date.parse(revision.validation.verified_at))) fail("GOAL_REVISION_INVALID", "GoalRevision verification time is invalid.");
  const { goal_revision_id: sealedId, digest: sealedDigest, ...base } = revision;
  if (!sealedId || !sealedDigest) fail("GOAL_REVISION_INVALID", "GoalRevision seal is missing.");
  if (await digest(revisionMaterial(base)) !== revision.digest
    || revision.goal_revision_id !== `goal-revision:${revision.digest.slice("sha256:".length, "sha256:".length + 24)}`) {
    fail("GOAL_REVISION_DIGEST_MISMATCH", "GoalRevision digest does not match its exact contents.");
  }
}

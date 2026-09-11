/** Owner-defined measurement. No free-form formula execution or inferred business outcome. */
export const GOAL_METRIC_FAMILIES = ["COUNT", "SUM", "RATIO"] as const;
export const GOAL_OUTCOME_TYPES = ["QUALIFIED_REQUEST", "PAID_ORDER", "REVENUE", "PROFIT", "CUSTOM"] as const;
export type GoalMetricFamily = typeof GOAL_METRIC_FAMILIES[number];
export type GoalOutcomeType = typeof GOAL_OUTCOME_TYPES[number];
export type GoalMetricUnit = "RESULT" | "RUB" | "PERCENT";
export type GoalComparison = "AT_LEAST" | "AT_MOST";
export type GoalMetricDefinition = {
  family: GoalMetricFamily;
  outcome_type: GoalOutcomeType;
  unit: GoalMetricUnit;
  counted_event: string;
  eligibility_rule: string;
  deduplication_rule: string;
  reversal_rule: string;
  measurement_definition: string;
  attribution_semantics: "ATTRIBUTED" | "INCREMENTAL";
  denominator_definition: string | null;
  minimum_denominator: number | null;
};

export class GoalMetricError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "GoalMetricError"; this.code = code; }
}
const fail = (code: string, message: string): never => { throw new GoalMetricError(code, message); };
const exactKeys = (value: object, keys: string[]) => JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const text = (value: unknown, name: string) => {
  if (typeof value !== "string" || !value.normalize("NFKC").trim() || value.length > 1000) fail("GOAL_MEASUREMENT_INCOMPLETE", `${name}: укажите определение длиной до 1000 символов.`);
  return (value as string).normalize("NFKC").replace(/\s+/gu, " ").trim();
};

export const GOAL_METRIC_LABELS: Record<GoalOutcomeType, string> = {
  QUALIFIED_REQUEST: "Квалифицированные обращения", PAID_ORDER: "Оплаченные заказы", REVENUE: "Выручка", PROFIT: "Прибыль", CUSTOM: "Другой измеримый результат",
};
export const GOAL_METRIC_UNIT_LABELS: Record<GoalMetricUnit, string> = { RESULT: "результатов", RUB: "₽", PERCENT: "%" };

/** Presets are shown to the owner for confirmation on Save, not applied to sealed goals. */
export function goalMetricPreset(outcome: GoalOutcomeType, countedEvent: string, family: GoalMetricFamily = "COUNT"): GoalMetricDefinition {
  const money = outcome === "REVENUE" || outcome === "PROFIT";
  const kind = money ? "SUM" : outcome !== "CUSTOM" ? "COUNT" : family;
  const common = { family: kind, outcome_type: outcome, unit: kind === "COUNT" ? "RESULT" : kind === "SUM" ? "RUB" : "PERCENT",
    counted_event: countedEvent,
    attribution_semantics: "ATTRIBUTED", denominator_definition: kind === "RATIO" ? "" : null, minimum_denominator: kind === "RATIO" ? 1 : null } as const;
  if (outcome === "QUALIFIED_REQUEST") return { ...common,
    eligibility_rule: "Уникальное квалифицированное коммерческое обращение компании по определению результата владельца; отправка формы сама по себе не квалифицирует результат.",
    deduplication_rule: "Одна компания и одно коммерческое обращение. Повторные контакты не добавляют результатов; разные обращения одной компании учитываются отдельно.",
    reversal_rule: "Обращение, признанное повторным или не соответствующим критериям, исключается.",
    measurement_definition: "Реестр обращений с компанией, отдельным запросом, датой квалификации и связью с рекламной кампанией и объявлением." };
  if (outcome === "PAID_ORDER") return { ...common,
    eligibility_rule: "Заказ соответствует определению владельца, оплата фактически получена до срока цели.",
    deduplication_rule: "Один уникальный идентификатор заказа; повторные платежи и контакты не добавляют заказов.",
    reversal_rule: "Полностью возвращённые и отменённые заказы исключаются; частичный возврат не создаёт новый заказ.",
    measurement_definition: "Учёт заказов, фактических платежей и возвратов с идентификатором заказа, датой и рекламным источником." };
  if (outcome === "REVENUE") return { ...common,
    eligibility_rule: "Сумма фактически полученных до срока цели платежей за соответствующие определению владельца заказы в рублях.",
    deduplication_rule: "Каждая платёжная операция учитывается один раз по уникальному идентификатору.",
    reversal_rule: "Из полученных платежей вычитаются фактические возвраты; отменённый неоплаченный заказ не добавляет выручку.",
    measurement_definition: "Реестр платежей и возвратов в рублях, даты операций, связь заказа и рекламного источника." };
  if (outcome === "PROFIT") return { ...common,
    eligibility_rule: "Полученные платежи за соответствующие определению владельца заказы минус возвраты, себестоимость, переменные расходы и рекламные расходы этой цели.",
    deduplication_rule: "Каждый платёж, возврат и расход учитывается один раз; общие рекламные расходы вычитаются один раз.",
    reversal_rule: "Возвраты, отмены и исправления расходов корректируют прибыль соответствующего заказа и периода.",
    measurement_definition: "Связанный учёт платежей, возвратов, себестоимости, переменных и рекламных расходов за период цели в рублях." };
  return { ...common, eligibility_rule: "", deduplication_rule: "", reversal_rule: "", measurement_definition: "" };
}

export function normalizeGoalMetric(value: unknown): GoalMetricDefinition {
  const keys = ["family", "outcome_type", "unit", "counted_event", "eligibility_rule", "deduplication_rule", "reversal_rule", "measurement_definition", "attribution_semantics", "denominator_definition", "minimum_denominator"];
  if (!value || typeof value !== "object" || Array.isArray(value) || !exactKeys(value, keys)) fail("GOAL_MEASUREMENT_INCOMPLETE", "Укажите тип, единицу и полное правило измерения цели.");
  const metric = value as GoalMetricDefinition;
  if (!GOAL_METRIC_FAMILIES.includes(metric.family) || !GOAL_OUTCOME_TYPES.includes(metric.outcome_type)) fail("UNSUPPORTED_GOAL_METRIC", "Поддерживаются количество, сумма в рублях и отношение в процентах. Другой тип требует отдельного правила измерения.");
  const unit = metric.family === "COUNT" ? "RESULT" : metric.family === "SUM" ? "RUB" : "PERCENT";
  if (metric.unit !== unit || ((metric.outcome_type === "REVENUE" || metric.outcome_type === "PROFIT") && metric.family !== "SUM")
    || ((metric.outcome_type === "QUALIFIED_REQUEST" || metric.outcome_type === "PAID_ORDER") && metric.family !== "COUNT")) fail("GOAL_METRIC_UNIT_MISMATCH", "Тип результата и единица измерения несовместимы.");
  if (!["ATTRIBUTED", "INCREMENTAL"].includes(metric.attribution_semantics)) fail("GOAL_ATTRIBUTION_INVALID", "Укажите, нужен связанный с рекламой результат или доказанный дополнительный эффект.");
  if (metric.family === "RATIO") {
    if (!Number.isSafeInteger(metric.minimum_denominator) || Number(metric.minimum_denominator) < 1) fail("GOAL_DENOMINATOR_REQUIRED", "Для отношения укажите минимальный положительный объём знаменателя.");
  } else if (metric.denominator_definition !== null || metric.minimum_denominator !== null) fail("GOAL_DENOMINATOR_UNEXPECTED", "Знаменатель относится только к цели в процентах.");
  return { family: metric.family, outcome_type: metric.outcome_type, unit,
    counted_event: text(metric.counted_event, "Засчитываемое событие"), eligibility_rule: text(metric.eligibility_rule, "Условия зачёта"),
    deduplication_rule: text(metric.deduplication_rule, "Правило повторов"), reversal_rule: text(metric.reversal_rule, "Отмены и возвраты"),
    measurement_definition: text(metric.measurement_definition, "Подтверждение результата"), attribution_semantics: metric.attribution_semantics,
    denominator_definition: metric.family === "RATIO" ? text(metric.denominator_definition, "Определение знаменателя") : null,
    minimum_denominator: metric.family === "RATIO" ? metric.minimum_denominator : null };
}

export function validGoalMetricTarget(value: unknown, metric: GoalMetricDefinition): value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) return false;
  if (metric.family === "COUNT") return Number.isSafeInteger(value) && value >= 1;
  if (metric.family === "RATIO") return value <= 100;
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-6 && value <= Number.MAX_SAFE_INTEGER / 100;
}

export function formatGoalMetricTarget(value: number, metric: Pick<GoalMetricDefinition, "family" | "unit">) {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: metric.family === "COUNT" ? 0 : 2 }).format(value)} ${GOAL_METRIC_UNIT_LABELS[metric.unit]}`;
}

export function goalMetricSchema() {
  const bounded = { type: "string", minLength: 1, maxLength: 1000 };
  const properties = {
    family: { type: "string", enum: [...GOAL_METRIC_FAMILIES] }, outcome_type: { type: "string", enum: [...GOAL_OUTCOME_TYPES] },
    unit: { type: "string", enum: ["RESULT", "RUB", "PERCENT"] }, counted_event: bounded, eligibility_rule: bounded,
    deduplication_rule: bounded, reversal_rule: bounded, measurement_definition: bounded,
    attribution_semantics: { type: "string", enum: ["ATTRIBUTED", "INCREMENTAL"] },
    denominator_definition: { ...bounded, type: ["string", "null"] }, minimum_denominator: { type: ["integer", "null"], minimum: 1 },
  };
  return { type: "object", additionalProperties: false, required: Object.keys(properties), properties };
}

"use client";

import { GOAL_METRIC_LABELS, GOAL_OUTCOME_TYPES, goalMetricPreset, type GoalComparison, type GoalMetricDefinition, type GoalMetricFamily, type GoalOutcomeType } from "../lib/goal-metric.ts";
import { GOAL_COUNTING_RULE } from "../lib/goal-revision.ts";

export default function GoalMetricFields({ value, comparison, countedEvent, disabled, onChange, onComparisonChange }: {
  value: GoalMetricDefinition | null;
  comparison: GoalComparison;
  countedEvent: string;
  disabled: boolean;
  onChange: (value: GoalMetricDefinition | null) => void;
  onComparisonChange: (value: GoalComparison) => void;
}) {
  const outcome = value?.outcome_type ?? "QUALIFIED_REQUEST";
  const set = (key: keyof GoalMetricDefinition, next: string | number) => value && onChange({ ...value, [key]: next });
  const fields = [
    ["eligibility_rule", "Что учитываем"], ["deduplication_rule", "Как исключаем повторы"], ["reversal_rule", "Отмены и возвраты"], ["measurement_definition", "Чем подтверждаем результат"],
  ] as const;
  return <section className="owner-goal-measurement" aria-label="Измерение результата">
    <div className="owner-goal-measurement-selectors">
      <label><span>Тип результата</span><select aria-label="Тип результата" value={outcome} disabled={disabled} onChange={event => {
        const next = event.target.value as GoalOutcomeType;
        onChange(next === "QUALIFIED_REQUEST" ? null : goalMetricPreset(next, countedEvent));
      }}>{GOAL_OUTCOME_TYPES.map(type => <option key={type} value={type}>{GOAL_METRIC_LABELS[type]}</option>)}</select></label>
      {value?.outcome_type === "CUSTOM" && <label><span>Как измеряем</span><select aria-label="Как измеряем" value={value.family} disabled={disabled} onChange={event => {
        const family = event.target.value as GoalMetricFamily;
        onChange({ ...value, family, unit: family === "COUNT" ? "RESULT" : family === "SUM" ? "RUB" : "PERCENT", denominator_definition: family === "RATIO" ? "" : null, minimum_denominator: family === "RATIO" ? 1 : null });
      }}><option value="COUNT">Количество</option><option value="SUM">Сумма, ₽</option><option value="RATIO">Доля, %</option></select></label>}
      {value && <label><span>Условие достижения</span><select name="goal_comparison" aria-label="Условие достижения" value={comparison} disabled={disabled} onChange={event => onComparisonChange(event.target.value as GoalComparison)}><option value="AT_LEAST">Не менее</option><option value="AT_MOST">Не более</option></select></label>}
    </div>
    <input type="hidden" name="metric_definition" value={value ? JSON.stringify({ ...value, counted_event: countedEvent }) : ""} />
    <details className="owner-goal-measurement-rules" open={value?.outcome_type === "CUSTOM" || undefined}>
      <summary>Правило учёта результата</summary>
      {!value ? <div><p>{GOAL_COUNTING_RULE}</p><button type="button" disabled={disabled} onClick={() => onChange(goalMetricPreset("QUALIFIED_REQUEST", countedEvent))}>Настроить правило учёта</button></div> : <div className="owner-goal-measurement-fields">
        {fields.map(([key, label]) => <label key={key}><span>{label}</span><textarea name={`metric_${key}`} aria-label={label} value={value[key]} onChange={event => set(key, event.target.value)} required disabled={disabled} maxLength={1000} /></label>)}
        <label><span>Связь с рекламой</span><select aria-label="Связь с рекламой" value={value.attribution_semantics} disabled={disabled} onChange={event => set("attribution_semantics", event.target.value)}><option value="ATTRIBUTED">Результат, связанный с рекламой</option><option value="INCREMENTAL">Доказанный дополнительный эффект рекламы</option></select></label>
        {value.family === "RATIO" && <><label><span>Знаменатель доли</span><textarea name="metric_denominator_definition" aria-label="Знаменатель доли" value={value.denominator_definition ?? ""} onChange={event => set("denominator_definition", event.target.value)} required disabled={disabled} maxLength={1000} /></label><label><span>Минимальный объём знаменателя</span><input name="metric_minimum_denominator" aria-label="Минимальный объём знаменателя" type="number" min="1" step="1" max={Number.MAX_SAFE_INTEGER} value={value.minimum_denominator ?? ""} onChange={event => set("minimum_denominator", Number(event.target.value))} required disabled={disabled} /></label></>}
      </div>}
    </details>
  </section>;
}

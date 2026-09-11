"use client";

import { createContext, useContext, type MouseEvent, type ReactNode } from "react";
import { FORMATION_AREA_LABELS, calculateFormationModel, type FormationResearch, type FormationPlan } from "../lib/campaign-formation-method.ts";
import type { FormationBundle, FormationAd, FormationCampaign, FormationPortfolio } from "../lib/campaign-formation-portfolio.ts";
import styles from "./campaign-formation.module.css";
import EvidenceBasis from "./EvidenceBasis.tsx";
import FormationArchive from "./FormationArchive.tsx";
import type { ReadableEvidenceFact } from "../lib/readable-evidence.ts";
import type { ResearchMaterials, ResearchMaterialEntry } from "../lib/research-material-presentation.ts";
import { findingLead, ownerBrief, presentFormationResearch } from "../lib/formation-presentation.ts";
import { buyerSituation, genericSelectionReason, presentDirection, strategyApproach } from "../lib/direction-presentation.ts";
import { businessSourceUrl, businessText } from "../lib/owner-business-copy.ts";
import { analyzeGoalPortfolio, assessGoalPortfolioReadiness } from "../lib/goal-portfolio-analysis.ts";
import { usesTotalGoalBudget, calculateGoalForecast, goalPreparationTarget, type EstimateRange, type GoalCampaignReview } from "../lib/campaign-goal-preparation.ts";
import GoalPrelaunchStatus from "./GoalPrelaunchStatus.tsx";
import { formatGoalMetricTarget } from "../lib/goal-metric.ts";

const money = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;
const counted = (count: number, forms: [string, string, string]) => `${count} ${forms[new Intl.PluralRules("ru").select(count) === "one" ? 0 : new Intl.PluralRules("ru").select(count) === "few" ? 1 : 2]}`;
const periodText = (period?: string) => period?.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/gu, "$3.$2.$1");
const labels: Record<string, string> = { OBSERVED: "Наблюдение", INFERRED: "Вывод / гипотеза", UNKNOWN: "Не найдено", CONFLICT: "Противоречие", NO_ROWS_RETURNED: "Нет строк", RESEARCHED: "Исследовано", PARTIAL: "Частично", UNAVAILABLE: "Данные не получены", NOT_APPLICABLE: "Не применяется", APPLIED: "Применено", DEFERRED: "Отложено", EXCLUDED: "Исключено", SEARCH: "Поиск", NETWORK: "Рекламная сеть", RETARGETING: "Повторное обращение к аудитории" };

const FlatRecords = createContext(false);
export function FormationTechnicalDetails({ title, children }: { title: string; children: ReactNode }) {
  return <details className={styles.fold} data-formation-technical><summary>{businessText(title)}</summary><div className={styles.technicalRecords}><FlatRecords.Provider value={true}><FormationArchive>{children}</FormationArchive></FlatRecords.Provider></div></details>;
}
const ownerSourceUrl = (value: string) => Boolean(businessSourceUrl(value));
function TextDetails({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  const flat = useContext(FlatRecords);
  if (flat) return <section id={id} className={styles.recordSection}><h3>{businessText(title)}</h3><div className={styles.detailContent}>{children}</div></section>;
  return <details id={id} className={styles.innerDetails}><summary>{businessText(title)}</summary><div className={styles.detailContent}>{children}</div></details>;
}
function PhraseList({ phrases, title = "Исключённые запросы" }: { phrases: string[]; title?: string }) {
  if (!phrases.length) return null;
  return <TextDetails title={title}><ul className={styles.phrases}>{phrases.map(phrase => <li key={phrase}>{phrase}</li>)}</ul></TextDetails>;
}
const rangeText = (range: EstimateRange | null, unit = "") => range ? `${range.low.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}–${range.high.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}${unit}` : "Не оценено";
const reviewLabels: Record<string, string> = { DEMAND_AND_INTENT: "Спрос и намерение", OFFER_AND_COPY: "Предложение и объявления", LANDING_AND_QUALIFICATION: "Посадочная и квалификация", BUDGET_AND_GOAL: "Бюджет и цель", EVIDENCE_LIMITS: "Ограничения данных", PASS: "Проверено", REPAIRED: "Доработано", LIMITATION: "Ограничение", BLOCKER: "Требует решения" };
export function GoalPreparationSummary({ plan, review, testScenario = false, calculationDetails, compact = false }: { plan: FormationPlan; review?: GoalCampaignReview; testScenario?: boolean; calculationDetails?: ReactNode; compact?: boolean }) {
  const preparation = plan.goal_preparation;
  if (!preparation) return <section className={compact ? styles.compactAssessment : styles.goalAssessment} aria-label="Оценка достижения цели" data-goal-assessment="NOT_ASSESSED"><strong>Прогноз</strong><p>Оценка результата ещё не выполнена.</p></section>;
  const analysis = analyzeGoalPortfolio(preparation);
  const readiness = assessGoalPortfolioReadiness(preparation, review, testScenario);
  const forecast = analysis.forecast;
  const goalUnit = forecast.metricUnit === "RUB" ? " ₽" : forecast.metricUnit === "PERCENT" ? " %" : " результатов";
  const projectedResult = rangeText(forecast.results, goalUnit);
  const target = preparation.goal.metric ? formatGoalMetricTarget(goalPreparationTarget(preparation), preparation.goal.metric) : String(goalPreparationTarget(preparation));
  const supported = readiness.status === "SUPPORTED_PLAN";
  if (compact) {
    const needsRepair = review && (review.recommendation !== "BEST_SUPPORTED" || review.checks.some(check => check.status === "BLOCKER"));
    const message = testScenario ? "Тестовый расчёт · результат рекламы не подтверждён."
      : needsRepair ? readiness.summary
      : !forecast.results ? "Пока неизвестен — нет данных о результативности рекламы."
      : preparation.forecast.scope !== "FULL_GOAL" ? `${projectedResult} за подготовленный период. Вся цель ещё не оценена.`
      : supported ? `${projectedResult} к сроку цели. Расчёт поддерживает цель; это сценарная оценка.`
      : review ? readiness.summary : `${projectedResult} по расчёту. Итоговая проверка кампаний ещё впереди.`;
    return <section className={styles.compactAssessment} aria-label="Оценка достижения цели" data-goal-assessment={supported && !testScenario ? "SUPPORTED_BY_ESTIMATE" : readiness.status}><strong>Прогноз</strong><p>{message}</p></section>;
  }
  return <section className={styles.goalAssessment} aria-label="Оценка достижения цели" data-goal-assessment={supported ? "SUPPORTED_BY_ESTIMATE" : readiness.status}>
    <div className={styles.assessmentTitle}><strong>Оценка достижения цели</strong>{(testScenario || supported || review) && <span>{testScenario ? "Тестовый расчёт" : supported ? "Расчёт поддерживает цель" : "Достижимость цели не обоснована"}</span>}</div>
    {!compact && <dl className={styles.facts}><div><dt>{preparation.forecast.scope === "FULL_GOAL" ? "Результаты за весь план" : "Вклад подготовленного периода"}</dt><dd>{projectedResult}<small>Цель: {target}</small></dd></div>{forecast.metricUnit === "RESULT" && <div><dt>Стоимость результата по расчёту</dt><dd>{rangeText(forecast.cost, " ₽")}</dd></div>}<div><dt>Период оценки</dt><dd>{preparation.forecast.period.start_date} — {preparation.forecast.period.end_date}</dd></div></dl>}
    {review && !supported && !testScenario && <p>{readiness.summary}</p>}
    {compact && !review && !testScenario && <p>{!forecast.results ? "Для расчёта достижения цели недостаточно данных." : preparation.forecast.scope !== "FULL_GOAL" ? "Оценён подготовленный период. Достижимость всей цели ещё не обоснована." : `Сценарная оценка: ${projectedResult}. Итоговая проверка кампаний доступна на следующем этапе.`}</p>}
    {compact && supported && <p>{projectedResult} к сроку цели · цель {target}. Сценарная оценка по сохранённым предпосылкам.</p>}
    {!compact && <GoalPreparationDetails plan={plan} review={review} calculationDetails={calculationDetails} />}
  </section>;
}
export function GoalPreparationDetails({ plan, review, calculationDetails }: { plan: FormationPlan; review?: GoalCampaignReview; calculationDetails?: ReactNode }) {
  const preparation = plan.goal_preparation;
  if (!preparation) return null;
  const analysis = analyzeGoalPortfolio(preparation);
  const forecast = analysis.forecast;
  return (
    <TextDetails title="Сравнение вариантов и расчёт">
      {analysis.missing.length > 0 && <TextDetails title="Что мешает оценить цель"><ul>{analysis.missing.map(item => <li key={item}>{businessText(plan.directions.reduce((label, direction) => label.replace(`${direction.id}:`, `${direction.name}:`), item))}</li>)}</ul></TextDetails>}
      {analysis.conservative && <TextDetails title="Минимальные расходы в сценарной модели"><p>{analysis.conservative.minimumBudgetRub === null ? `Даже при полном использовании оценённого спроса недостаёт ${analysis.conservative.resultGap.toLocaleString("ru-RU")} результата.` : `Нижняя граница расходов: ${money(analysis.conservative.minimumBudgetRub)}.`}</p><p>{businessText(analysis.assumptions)}</p></TextDetails>}
    <p>Цель: {preparation.goal.metric ? formatGoalMetricTarget(goalPreparationTarget(preparation), preparation.goal.metric) : goalPreparationTarget(preparation)} · до {new Date(`${preparation.goal.deadline}T00:00:00`).toLocaleDateString("ru-RU")} · {preparation.goal.total_budget_rub !== undefined ? `общий бюджет до ${money(preparation.goal.total_budget_rub)}` : `историческая цена результата до ${money(preparation.goal.max_result_cost_rub ?? 0)}`}.</p>
      <p>{businessText(review?.summary ?? preparation.selection_reason)}</p>{review && review.summary !== preparation.selection_reason && <p>{businessText(preparation.selection_reason)}</p>}
      <table><thead><tr><th>Подход</th><th>Основание выбора</th><th>Главный риск</th></tr></thead><tbody>{preparation.alternatives.map(a => <tr key={a.id}><td>{businessText(a.approach)}<small>{a.id === preparation.selected_alternative_id ? "Выбран" : "Рассмотрен"}</small></td><td>{businessText(a.strongest_reason)}<TextDetails title="Аудитория и механизм"><p>{businessText(a.audience)}</p><p>{a.offer}</p><p>{businessText(a.mechanism)}</p></TextDetails></td><td>{businessText(a.principal_risk)}</td></tr>)}</tbody></table>
      {preparation.outcome_plan && <TextDetails title="Полные предложения и условия результата">{preparation.outcome_plan.candidate_comparisons.map(candidate => <article key={candidate.alternative_id}><h3>{businessText(preparation.alternatives.find(a => a.id === candidate.alternative_id)?.approach ?? "Рассмотренный подход")}</h3><small>{candidate.ranking === "UNRESOLVED" ? "Преимущество по результату не установлено" : candidate.ranking === "PREFERRED" ? "Предпочтение по доступным сведениям" : "Рассмотренная альтернатива"}</small><dl className={styles.facts}>{([["Аудитория", candidate.package.audience], ["Предложение", candidate.package.offer], ["Посадочная", candidate.package.landing], ["Целевое действие", candidate.package.action], ["Измерение", candidate.package.measurement], ["Бюджет и срок", candidate.package.budget_and_timing]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{businessText(value)}</dd></div>)}</dl><p>{businessText(candidate.advantage)}</p><p>{businessText(candidate.strongest_counterargument)}</p><p>{businessText(candidate.decision_reason)}</p></article>)}<p>{businessText(preparation.outcome_plan.stopping_reason)}</p></TextDetails>}
      {preparation.portfolio_search && <TextDetails title="Выбор кампаний"><table><thead><tr><th>Кампания</th><th>Дополнительная польза</th><th>Решение</th></tr></thead><tbody>{preparation.portfolio_search.candidates.map(c => <tr key={c.id}><td>{businessText(c.name)}</td><td>{businessText(c.added_value)}</td><td>{c.disposition === "SELECTED" ? "Включена" : c.disposition === "DEFERRED" ? "Отложена" : "Исключена"}<p>{businessText(c.reason)}</p></td></tr>)}</tbody></table><p>{businessText(preparation.portfolio_search.continuation.additional_value)}</p><p>{businessText(preparation.portfolio_search.continuation.stopping_reason)}</p>{preparation.portfolio_search.continuation.single_campaign_reason && <p>{businessText(preparation.portfolio_search.continuation.single_campaign_reason)}</p>}</TextDetails>}
      {preparation.forecast.allocation_options && <TextDetails title="Проверка меньших расходов"><table><thead><tr><th>Вариант</th><th>Бюджет</th><th>Результаты к сроку</th></tr></thead><tbody>{preparation.forecast.allocation_options.map(option => { const value = calculateGoalForecast(preparation, option.allocations); return <tr key={option.id}><td>{option.id === preparation.forecast.selected_allocation_id ? "Выбранный" : "Альтернативный"}<p>{businessText(option.rationale)}</p></td><td>{money(value.budget)}</td><td>{rangeText(value.results, value.metricUnit === "RUB" ? " ₽" : value.metricUnit === "PERCENT" ? " %" : "")}</td></tr>; })}</tbody></table></TextDetails>}
      <TextDetails title="Распределение бюджета под цель">{preparation.directions.map(d => <article key={d.direction_id}><h3>{businessText(plan.directions.find(p => p.id === d.direction_id)?.name ?? "Направление рекламы")} · {money(d.budget_rub)}</h3><p>{businessText(d.audience_reason)}</p><p>{businessText(d.qualification_path)}</p><p>{businessText(d.budget_reason)}</p><small>{d.role === "EXPLORATION" ? "Исследование аудитории" : "Привлечение целевых результатов"} · {d.commercial_intent === "EXPLICIT" ? "Явное намерение" : d.commercial_intent === "MIXED" ? "Смешанное намерение" : "Косвенный интерес"}</small></article>)}</TextDetails>
      <TextDetails title="Основания расчёта">
    {forecast.unallocatedBudgetRub !== null && <p>В плане: {money(forecast.budget)} · не распределено: {money(forecast.unallocatedBudgetRub)}. Остаток бюджета сохраняется.</p>}
    <p>{businessText(preparation.forecast.contribution_to_goal)}</p>
    {preparation.forecast.conditions.length > 0 && <ul className={styles.conditions}>{preparation.forecast.conditions.map(condition => <li key={condition}>{businessText(condition)}</li>)}</ul>}
        <p>Диапазоны — сценарная оценка, а не вероятность успеха. Фактические результаты здесь не учитываются.</p>{preparation.forecast.duplicate_result_percent && <p>Повторы целевого события: {rangeText(preparation.forecast.duplicate_result_percent.range, "%")}. {businessText(preparation.forecast.duplicate_result_percent.explanation)}</p>}{preparation.forecast.result_before_deadline_percent && <p>Результаты до срока цели: {rangeText(preparation.forecast.result_before_deadline_percent.range, "%")}. {businessText(preparation.forecast.result_before_deadline_percent.explanation)}</p>}{preparation.forecast.inputs.map(row => <article key={row.direction_id}><h3>{businessText(plan.directions.find(d => d.id === row.direction_id)?.name ?? "Направление рекламы")}</h3>{([["Стоимость клика", row.cpc_rub, " ₽"], [preparation.goal.metric && preparation.goal.metric.outcome_type !== "QUALIFIED_REQUEST" ? "Клик → целевое событие" : "Клик → квалифицированное обращение", row.click_to_qualified_percent, "%"], ["Доступные клики за период", row.obtainable_clicks, ""]] as const).map(([label, input, unit]) => <div key={label}><strong>{label}: {rangeText(input.range, unit)}</strong><small>{input.basis === "OBSERVATION" ? "Наблюдение" : input.basis === "INFERENCE" ? "Оценка по источникам" : "Неизвестно"}</small><p>{businessText(input.explanation)}</p></div>)}</article>)}{calculationDetails}</TextDetails>
      {(preparation.forecast.metric_inputs?.length ?? 0) > 0 && <TextDetails title="Расчёт в единицах цели">{preparation.forecast.metric_inputs!.map(row => <article key={row.direction_id}><h3>{businessText(plan.directions.find(d => d.id === row.direction_id)?.name ?? "Направление рекламы")}</h3><p>{row.value_unit === "RUB" ? "Сумма после корректировок" : "Числитель доли"}: {rangeText(row.value.range, row.value_unit === "RUB" ? " ₽" : "")}</p><p>{businessText(row.value.explanation)}</p>{row.denominator && <><p>Знаменатель: {rangeText(row.denominator.range)}</p><p>{businessText(row.denominator.explanation)}</p></>}<p>{businessText(row.population)}</p><p>{businessText(row.adjustments)}</p><p>Бюджет, к которому относится оценка: {money(row.budget_rub)}.</p></article>)}<p>{businessText(analysis.assumptions)}</p></TextDetails>}
      {review && <TextDetails title="Проверка выбранных кампаний">{review.checks.map(c => <article key={c.area}><h3>{reviewLabels[c.area]} · {reviewLabels[c.status]}</h3><p>{businessText(c.finding)}</p><p>{businessText(c.action)}</p></article>)}</TextDetails>}
      {review?.preparation_decision && <TextDetails title="План проверки результативности"><p>{businessText(review.preparation_decision.reasoning)}</p><p>Предел первой проверки: {money(review.preparation_decision.validation_plan.maximum_spend_rub)} из уже распределённого бюджета.</p><p>Целевой результат: {businessText(review.preparation_decision.validation_plan.qualified_result)}.</p><ul>{review.preparation_decision.validation_plan.observations.map(row => <li key={row.field}>{businessText(row.collection_method)}</li>)}</ul><p>{businessText(review.preparation_decision.validation_plan.reassess_remaining_goal)}</p><p>{businessText(review.preparation_decision.validation_plan.stop_rule)}</p><TextDetails title="Условия перед публикацией"><ul>{review.preparation_decision.validation_plan.prepublication_dependencies.map(value => <li key={value}>{businessText(value)}</li>)}</ul></TextDetails><TextDetails title="Что предстоит измерить"><ul>{review.preparation_decision.remaining_unknowns.map(row => <li key={row.metric}>{businessText(row.why_unavailable)} {businessText(row.decision_impact)}</li>)}</ul></TextDetails></TextDetails>}
    </TextDetails>
  );
}
export function TestDataPanel({ research, compact = false }: { research?: FormationResearch; compact?: boolean }) {
  if (!research || research.mode !== "TEST_SCENARIO") return null;
  if (compact) return <p className={styles.testData} aria-label="Тестовые данные">Тестовый расчёт · используются условные значения</p>;
  return <section className={styles.testData} aria-label="Тестовые данные"><TextDetails title="Условные значения тестового расчёта">
    <table><thead><tr><th>Показатель</th><th>Тестовое значение</th><th>Основание</th></tr></thead><tbody>{research.test_data.map(d => <tr key={d.id} data-test-datum={d.id}>
      <td>{businessText(d.label)}</td><td><b>{d.value === null ? "—" : typeof d.value === "number" ? d.value.toLocaleString("ru-RU", { maximumFractionDigits: 3 }) : d.value}</b><small>Тестовые данные</small></td>
      <td><TextDetails title="Почему использовано условное значение"><p>{businessText(d.reason_unavailable)}</p><ul>{d.attempted_sources.map((s, i) => <li key={i}>{businessText(s)}</li>)}</ul><p>{businessText(d.affects.join(" · "))}</p></TextDetails></td>
    </tr>)}</tbody></table></TextDetails></section>;
}
export function FormationSourceDetails({ compact, children }: { compact: boolean; children: ReactNode }) {
  return compact ? <details className={styles.fold}><summary>Источники исследования</summary>{children}</details> : <>{children}</>;
}
function MaterialCard({ item, contractor }: { item: ResearchMaterialEntry; contractor: boolean }) {
  const lead = item.fields[0];
  const reported = item.fields.find(f => f.label === "Заявлено автором кейса"), limitation = item.fields.find(f => f.label === "Ограничения");
  const other = item.fields.filter(f => f !== lead && f !== reported && f !== limitation);
  return <article className={styles.finding} data-research-material={item.id}><h4>{businessText(item.name)}</h4><p>{businessText(item.summary)}</p>
    <div className={styles.detailContent}>{lead && <p>{["Предложение", "Цена и условия"].includes(lead.label) ? lead.value : businessText(lead.value)}</p>}
      {(reported || limitation) && <TextDetails title={contractor ? "Результаты кейса и ограничения" : "Ограничения сравнения"}>{reported && <p>{businessText(reported.value)}</p>}{limitation && <p>{businessText(limitation.value)}</p>}</TextDetails>}
      <TextDetails title={contractor ? "Сопоставимость" : "Условия и сравнение"}><dl>{other.map(f => <div key={f.label}><dt>{f.label}</dt><dd>{["Предложение", "Цена и условия"].includes(f.label) ? f.value : businessText(f.value)}</dd></div>)}</dl></TextDetails>
      <TextDetails title="Источники исследования"><ul>{item.sources.filter(source => ownerSourceUrl(source.url)).map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{businessText(source.title) || "Источник исследования"}</a></li>)}</ul><small>Материалы от {item.observedAt.slice(0, 10)}. Вывод исследования не подтверждает результативность рекламы.</small></TextDetails>
    </div>
  </article>;
}
export type FormationResearchPresentation = { rows: Array<{ id: string; title: string; statement: string; impact: string; findingIds: string[]; sourceRefs: string[]; state: "OBSERVED" | "INFERRED" | "UNKNOWN" | "CONFLICT" | "NO_ROWS_RETURNED"; limitations: string[]; visibleLimitations?: string[]; briefStatement?: string; briefLimitations?: string[] }> };
export function FormationResearchView({ research, materials, plan, portfolio, summary, sourceFacts, presentation, search, archive }: { research: FormationResearch; materials?: ResearchMaterials; plan?: FormationPlan; portfolio?: FormationPortfolio; summary?: string; sourceFacts?: ReadableEvidenceFact[]; presentation?: FormationResearchPresentation; search?: ReactNode; archive?: ReactNode }) {
  const rows = presentation?.rows ?? presentFormationResearch(research, plan, portfolio).rows;
  const showImpact = Boolean(plan || presentation);
  const limits = (row: FormationResearchPresentation["rows"][number]) => {
    const notes = [...new Set((row.briefLimitations ?? row.visibleLimitations ?? row.limitations).map(ownerBrief).filter(Boolean))];
    return notes.length > 0 && <ul className={`${styles.rowLimits} ${styles.researchNotes}`}>{notes.map(item => <li key={item}>{item}</li>)}</ul>;
  };
  return <section className={`${styles.research} ${styles.quietResearch}`} aria-label="Исследование для формирования кампаний">
    <header className={styles.header}><h2>Что выяснили для рекламы</h2></header><TestDataPanel research={research} compact />
    {!showImpact && <p className={styles.summary}>Стратегия формируется</p>}
    <dl className={styles.researchList}>{rows.filter(row => row.id !== "contractor_cases").map(row => <div key={row.id} className={styles.researchRow} data-research-row={row.id}>
      <dt>{businessText(row.title)}</dt><dd className={styles.researchCopy}><p>{ownerBrief(row.briefStatement ?? findingLead(row.statement))}</p>{limits(row)}</dd>
    </div>)}</dl>
    {search}
    <FormationTechnicalDetails title="Подробности исследования">
      {summary && <p>{businessText(summary)}</p>}
      <TestDataPanel research={research} />
      <TextDetails title="Выводы и влияние на рекламу">{rows.map(row => <section key={row.id}><h3>{businessText(row.title)}</h3><p>{businessText(row.statement)}</p>{showImpact && <p>{businessText(row.impact)}</p>}<EvidenceBasis research={research} sourceFacts={sourceFacts} findingIds={row.findingIds} sourceRefs={row.sourceRefs} choice={showImpact ? businessText(row.impact) : undefined} /></section>)}</TextDetails>
      <TextDetails title="Полные выводы и решения">{research.findings.map(f => {
        const decision = plan?.decisions.find(d => d.finding_id === f.id);
        return <article key={f.id} id={`formation-finding-${f.id}`} className={styles.finding} data-finding-id={f.id}>
          <h3>{FORMATION_AREA_LABELS[f.area] ?? "Сведения для рекламы"}</h3><p>{businessText(f.finding)}</p><small>{labels[f.state]}</small>
          {f.limitation && <p>{businessText(f.limitation)}</p>}
          {decision && <p>{labels[decision.disposition]}: {businessText(decision.reason)}{decision.target_ids.length > 0 && <> · {decision.target_ids.map(id => businessText(targetLabel(id, plan!).name)).join("; ")}</>}</p>}
          {f.source_urls?.length ? <ul>{f.source_urls.filter(ownerSourceUrl).map(url => <li key={url}><a href={url} target="_blank" rel="noreferrer">Открыть источник</a></li>)}</ul> : !f.evidence_refs.length && <p>Источник не получен.</p>}

        </article>;
      })}</TextDetails>
      <TextDetails title="Материалы и охват исследования"><div className={styles.researchAreas}>{research.coverage.map(area => {
        const entries = area.area === "competitors" ? materials?.competitors : area.area === "contractor_cases" ? materials?.contractors : undefined;
        return <section key={area.area} className={styles.area} data-research-area={area.area}>
          <h3>{area.area === "contractor_cases" && entries?.length ? "Подрядчики и кейсы" : FORMATION_AREA_LABELS[area.area]}</h3><small>{labels[area.status]}</small><p>{businessText(area.explanation)}</p>
          {entries?.map(item => <MaterialCard key={item.id} item={item} contractor={area.area === "contractor_cases"} />)}
        </section>;
      })}</div></TextDetails>
      {archive}
    </FormationTechnicalDetails>
  </section>;
}
function revealTarget(event: MouseEvent<HTMLAnchorElement>) {
  const id = decodeURIComponent(event.currentTarget.hash.slice(1));
  const target = document.getElementById(id);
  if (!target) return;
  for (let element: HTMLElement | null = target; element; element = element.parentElement) {
    if (element instanceof HTMLDetailsElement) element.open = true;
  }
}
function targetLabel(id: string, plan: FormationPlan, portfolio?: FormationPortfolio) {
  const common: Record<string, string> = { portfolio: "Все кампании", landing: "Посадочная страница", measurement: "Измерение результата", budget: "Распределение бюджета", planning: "Допущения расчёта", semantics: "Поисковые фразы и темы" };
  const campaign = portfolio?.campaigns.find(c => c.id === id || c.direction_id === id);
  if (campaign) return { name: campaign.name, id: campaign.id };
  const direction = plan.directions.find(d => d.id === id);
  if (direction) return { name: direction.name, id };
  for (const campaign of portfolio?.campaigns ?? []) {
    const group = campaign.groups.find(g => g.id === id);
    if (group) return { name: `${campaign.name} · ${group.name}`, id };
    for (const group of campaign.groups) {
      const ad = group.ads.find(a => a.id === id);
      if (ad) return { name: `Объявление «${ad.titles[0]}»`, id };
    }
  }
  const experiment = plan.experiments.find(e => e.id === id);
  if (experiment) return { name: experiment.question, id };
  const image = portfolio?.images.find(i => i.id === id);
  if (image) return { name: image.alt, id };
  const segment = portfolio?.segments.find(s => s.id === id);
  if (segment) return { name: segment.rule, id };
  return { name: common[id] ?? "Связанное решение", id };
}
function TargetLinks({ ids, plan, portfolio }: { ids: string[]; plan: FormationPlan; portfolio?: FormationPortfolio }) {
  if (!ids.length) return null;
  return <ul className={styles.targetLinks}>{ids.map(id => {
    const target = targetLabel(id, plan, portfolio);
    return <li key={id}><a href={`#formation-${target.id}`} onClick={revealTarget}>{businessText(target.name)}</a></li>;
  })}</ul>;
}
export function FormationDecisions({ plan, research, portfolio }: { plan: FormationPlan; research: FormationResearch; portfolio?: FormationPortfolio }) {
  const applied = plan.decisions.filter(d => d.disposition === "APPLIED");
  const other = plan.decisions.filter(d => d.disposition !== "APPLIED");
  const orphanedApplications = portfolio?.applications.filter(a => !plan.decisions.some(d => d.finding_id === a.finding_id)) ?? [];
  if (!plan.decisions.length && !orphanedApplications.length) return null;
  const rows = (decisions: FormationPlan["decisions"]) => <table><thead><tr><th>Вывод исследования</th><th>Решение и применение</th><th>Где учтено</th></tr></thead><tbody>{decisions.map(d => {
    const finding = research.findings.find(f => f.id === d.finding_id);
    const application = portfolio?.applications.find(a => a.finding_id === d.finding_id);
    return <tr key={d.finding_id} data-decision={d.disposition}>
      <td>{businessText(finding?.finding ?? "Вывод отсутствует в сохранённом исследовании")}<TextDetails title="Источники вывода">
        {finding?.limitation && <p>{businessText(finding.limitation)}</p>}
        {finding?.source_urls?.filter(ownerSourceUrl).map(url => <p key={url}><a href={url} target="_blank" rel="noreferrer">Открыть источник</a></p>)}



      </TextDetails></td>
      <td>{d.disposition !== "APPLIED" && <small>{labels[d.disposition]}</small>}<p>{businessText(d.reason)}</p>{application && application.explanation !== d.reason && <p>{businessText(application.explanation)}</p>}</td>
      <td><TargetLinks ids={application?.target_ids ?? d.target_ids} plan={plan} portfolio={portfolio} />{application && <TextDetails title="Назначение в плане"><TargetLinks ids={d.target_ids} plan={plan} portfolio={portfolio} /></TextDetails>}</td>
    </tr>;
  })}</tbody></table>;
  return <TextDetails title="Как исследование повлияло на кампании">
    {applied.length > 0 && rows(applied)}
    {other.length > 0 && <TextDetails title="Отложенные и исключённые решения">{rows(other)}</TextDetails>}
    {orphanedApplications.map(a => <article key={a.finding_id}><p>{businessText(research.findings.find(f => f.id === a.finding_id)?.finding ?? "Вывод отсутствует в сохранённом исследовании")}</p><p>{businessText(a.explanation)}</p><TargetLinks ids={a.target_ids} plan={plan} portfolio={portfolio} /></article>)}
  </TextDetails>;
}
function PlanningDetails({ plan, portfolio }: { plan: FormationPlan; portfolio?: FormationPortfolio }) {
  return <>
    <TextDetails title="Распределение бюджета" id="formation-budget"><dl className={styles.facts}>{plan.budget.phases.map(p => <div key={p.id}><dt>{businessText(p.label)}</dt><dd>{money(p.cap_rub)}</dd></div>)}</dl><p>{businessText(plan.budget.reserve_rule)}</p>{plan.budget.phases.map(p => <p key={p.id}>{businessText(p.label)}: {businessText(p.release_condition)}</p>)}</TextDetails>
    {plan.experiments.length > 0 && <TextDetails title="Что сравниваем">{plan.experiments.map(e => <TextDetails key={e.id} id={`formation-${e.id}`} title={businessText(e.question)}><p>{businessText(e.variable)}</p><p>{e.comparison === "CONTROLLED_VARIANT" ? "Сравнение фиксированных вариантов" : "Сравнение сегментов"} · {businessText(e.metric)}</p><ul>{e.variants.map(v => <li key={v.id}>{businessText(v.label)}</li>)}</ul><p>{businessText(e.activation_condition)}</p><small>{businessText(e.limitations)}</small></TextDetails>)}</TextDetails>}
    <TextDetails title="Посадочная и измерение"><div className={styles.twoColumns}>
      <article id="formation-landing"><h3>Посадочная</h3><a href={plan.landing.url} target="_blank" rel="noreferrer">Открыть сайт ↗</a><p>Поля: {businessText(plan.landing.required_fields.join(", "))}</p><p>Квалификация: {businessText(plan.landing.qualification_fields.join(", "))}</p><p>{businessText(plan.landing.proof)}</p>{plan.landing.missing.length > 0 && <ul>{plan.landing.missing.map(v => <li key={v}>{businessText(v)}</li>)}</ul>}</article>
      <article id="formation-measurement"><h3>Измерение</h3><p>{businessText(plan.measurement.qualified_result)}</p><p>{businessText(plan.measurement.paid_result)}</p><p>{businessText(plan.measurement.attribution)}</p><p>{businessText(plan.measurement.followup)}</p><p>{businessText(plan.measurement.crm_status)}</p>{plan.measurement.missing.length > 0 && <ul>{plan.measurement.missing.map(v => <li key={v}>{businessText(v)}</li>)}</ul>}</article>
    </div></TextDetails>
    {(plan.planning_inputs.length > 0 || plan.decisions.some(d => d.target_ids.includes("planning")) || portfolio?.applications.some(a => a.target_ids.includes("planning"))) && <TextDetails title="Допущения расчёта" id="formation-planning">{plan.planning_inputs.length ? <table><thead><tr><th>Показатель</th><th>Значение</th><th>Основание</th></tr></thead><tbody>{plan.planning_inputs.map(p => <tr key={p.id}><td>{businessText(p.label)}</td><td>{p.value === null ? "—" : p.value} {businessText(p.unit)}</td><td>{p.state === "TEST_DATA" ? "Тестовые данные" : labels[p.state]}</td></tr>)}</tbody></table> : <p>Допущения расчёта пока не определены.</p>}</TextDetails>}
    {portfolio && portfolio.segments.length > 0 && <TextDetails title="Условия доступности аудиторий">{portfolio.segments.map(segment => <article key={segment.id} id={`formation-${segment.id}`}><h3>{businessText(segment.rule)}</h3><p>{segment.readiness === "VERIFIED" ? "Готовность подтверждена" : "Аудитория не создана"} · период {segment.lookback_days} дн.</p></article>)}</TextDetails>}
    {portfolio && portfolio.images.length > 0 && <TextDetails title="Изображения и права использования">{portfolio.images.map(image => <article key={image.id} id={`formation-${image.id}`}><a href={image.url} target="_blank" rel="noreferrer">{image.alt}</a><p>{businessText(image.rights)}</p></article>)}</TextDetails>}
  </>;
}
function MaterialLimits({ plan, review, portfolio }: { plan: FormationPlan; review?: GoalCampaignReview; portfolio?: FormationPortfolio }) {
  const conditions = review?.outcome_review?.requirements.filter(row => row.status === "CONDITION" || row.status === "BLOCKER");
  if (conditions?.length) return <section className={styles.compactLimits} aria-label="Ограничения плана"><strong>Условия и ограничения</strong>
    {conditions.map(row => <div className={styles.compactLimit} key={row.requirement_id} data-limit-status={row.status}>
      {row.status === "BLOCKER" && <strong className={styles.blocker}>Требует решения</strong>}
      <p>{businessText(row.explanation)}</p>
    </div>)}
  </section>;
  const missing = [...new Set([...plan.landing.missing, ...plan.measurement.missing])];
  const checks = review?.checks.filter(c => c.status === "LIMITATION" || c.status === "BLOCKER") ?? [];
  const comparisonLimits = portfolio?.optimization_review?.issues.filter(issue => issue.status === "ACCEPTED_LIMITATION" && !checks.some(check => check.finding === issue.finding)) ?? [];
  const hasReviewedLanding = checks.some(check => check.area === "LANDING_AND_QUALIFICATION" && check.finding.trim());
  if (!missing.length && !checks.length && !comparisonLimits.length) return null;
  return <section className={styles.compactLimits} aria-label="Ограничения плана"><strong>Условия и ограничения</strong>
      {!hasReviewedLanding && <>
        {plan.landing.missing.length > 0 && <div className={styles.compactLimit}><strong>Страница и форма</strong><p>{[...new Set(plan.landing.missing)].map(ownerBrief).join(". ")}</p></div>}
        {plan.measurement.missing.length > 0 && <div className={styles.compactLimit}><strong>Учёт обращений</strong><p>{[...new Set(plan.measurement.missing)].map(ownerBrief).join(". ")}</p></div>}
      </>}
      {checks.map((check, index) => <div className={styles.compactLimit} key={index} data-limit-status={check.status}>
          {check.status === "BLOCKER" && <strong className={styles.blocker}>Требует решения</strong>}
          <p>{ownerBrief(findingLead(ownerBrief(check.finding)))}</p>{check.status === "BLOCKER" && check.action && check.action !== check.finding && <p>{businessText(check.action)}</p>}
          {portfolio && check.status === "BLOCKER" && <TargetLinks ids={check.affected_ids} plan={plan} portfolio={portfolio} />}
      </div>)}
      {comparisonLimits.map(issue => <div className={styles.compactLimit} key={issue.id}><p>{ownerBrief(issue.finding)}</p></div>)}
  </section>;
}
export type FormationStrategyPresentation = { approach: string; directions: Array<{ id: string; situation: string; response: string; reason: string }> };
function GoalOutcomeDetails({ bundle }: { bundle: FormationBundle }) {
  const source = bundle.research.goal_requirements, review = bundle.portfolio.goal_review?.outcome_review;
  if (!source || !review) return null;
  const status: Record<string, string> = { SATISFIED: "Проверено в подготовке", CONDITION: "Остаётся условием", BLOCKER: "Требует исправления", NOT_APPLICABLE: "Не применяется" };
  return <TextDetails title="Условия достижения цели">{review.requirements.map(row => <article key={row.requirement_id}><h3>{businessText(source.requirements.find(r => r.id === row.requirement_id)?.condition ?? "Условие результата")}</h3><small>{status[row.status]}</small><p>{businessText(row.explanation)}</p></article>)}{review.group_selections.map(row => <article key={row.group_id}><h3>{businessText(bundle.portfolio.campaigns.flatMap(c => c.groups).find(g => g.id === row.group_id)?.name ?? "Группа объявлений")}</h3><p>{row.ranking === "UNRESOLVED" ? "Доступные сведения не определяют победителя по результативности." : "Сохранено предпочтение по доступным сведениям."}</p><p>{businessText(row.main_advantage)}</p><p>{businessText(row.strongest_counterargument)}</p>{row.unknowns.map((item, index) => <p key={index}>{businessText(item.question)} {businessText(item.decision_impact)}</p>)}<p>{businessText(row.conclusion)}</p></article>)}{review.material_limits.length > 0 && <ul>{review.material_limits.map((text, i) => <li key={i}>{businessText(text)}</li>)}</ul>}<p>Технические проверки относятся к подготовленным материалам. Приём объявлений площадкой и фактические результаты проверяются отдельно.</p></TextDetails>;
}
function BudgetStatement({ plan }: { plan: FormationPlan }) {
  const total = plan.goal_preparation?.goal.total_budget_rub;
  const cap = plan.budget.total_cap_rub;
  const first = plan.budget.phases[0];
  const unallocated = total === undefined ? null : total - cap;
  return <dl className={styles.compactBudget} aria-label="План расходов">
    <div><dt>План расходов</dt><dd><strong className={styles.budgetValue}>до {money(cap)}</strong>{total !== undefined && <small>из {money(total)}</small>}</dd></div>
    {first && <div><dt>{plan.budget.phases.length > 1 ? "Первый этап" : "На весь план"}</dt><dd><strong className={styles.budgetValue}>до {money(first.cap_rub)}</strong></dd></div>}
    {unallocated !== null && <div><dt>{unallocated >= 0 ? "Не распределено" : "Превышение бюджета"}</dt><dd><strong className={styles.budgetValue}>{money(Math.abs(unallocated))}</strong></dd></div>}
  </dl>;
}
export function FormationStrategyView({ plan, research, archive, notice, presentation, sourceFacts }: { plan: FormationPlan; research: FormationResearch; archive?: ReactNode; notice?: ReactNode; presentation?: FormationStrategyPresentation; sourceFacts?: ReadableEvidenceFact[]; materials?: ResearchMaterials }) {
  return <section className={`${styles.strategy} ${styles.quietStrategy}`} aria-label="План формирования кампаний"><TestDataPanel research={research} compact />
    <header className={styles.header}><h2>Кому покажем рекламу</h2></header>
    <div className={styles.strategyList} id="formation-semantics">{plan.directions.map(d => {
      const projected = presentDirection(d, plan, research);
      const saved = presentation?.directions.find(item => item.id === d.id);
      const allocation = plan.goal_preparation?.directions.find(item => item.direction_id === d.id);
      return <article className={styles.strategyRow} key={d.id} id={`formation-${d.id}`}><div className={styles.directionName}><h3>{businessText(saved?.situation ?? projected.situation)}</h3><p>{saved?.response ?? projected.response}</p>{d.channel === "RETARGETING" && <p>{ownerBrief(findingLead(d.activation_condition))}</p>}</div><span className={styles.directionMeta}>{labels[d.channel]}</span><strong className={styles.directionBudget}>{allocation ? money(allocation.budget_rub) : `${money(d.weekly_budget_rub)} / нед.`}</strong></article>;
    })}</div>
    <BudgetStatement plan={plan} />
    <GoalPreparationSummary plan={plan} testScenario={research.mode === "TEST_SCENARIO"} compact />
    <MaterialLimits plan={plan} />
    {notice}
    <FormationTechnicalDetails title="Разбор выбора">
      <TestDataPanel research={research} />
      <p>{businessText(presentation?.approach ?? strategyApproach(plan))}</p>
      <TextDetails title="Почему выбраны эти направления">{plan.directions.map(d => {
        const projected = presentDirection(d, plan, research);
        const saved = presentation?.directions.find(item => item.id === d.id);
        return <section key={d.id}><h3>{businessText(d.name)}</h3><p>{businessText(saved?.reason ?? projected.reason)}</p><EvidenceBasis research={research} sourceFacts={sourceFacts} findingIds={d.finding_ids} choice={saved?.response ?? projected.response} explanation={projected.reasonKind === "FINDING" && !saved?.reason ? undefined : saved?.reason ?? projected.reason} /></section>;
      })}</TextDetails>
      <GoalPreparationDetails plan={plan} />
      <TextDetails title="Сохранённые направления">{plan.directions.map(d => <section key={d.id}><h3>{businessText(d.name)} · {labels[d.channel]}</h3><p>Аудитория: {businessText(d.audience)}</p><p>Намерение: {businessText(d.intent)}</p><p>{d.offer}</p><p>{d.message}</p><p>{businessText(d.activation_condition)}</p><p>{money(d.weekly_budget_rub)} в неделю</p></section>)}</TextDetails>
      <PlanningDetails plan={plan} />
      <FormationDecisions plan={plan} research={research} />
      {archive}
    </FormationTechnicalDetails>
  </section>;
}
function AdPreview({ ad, bundle, findingIds, groupIntent, sourceFacts }: { ad: FormationAd; bundle: FormationBundle; findingIds: string[]; groupIntent: string; sourceFacts?: ReadableEvidenceFact[] }) {
  const image = bundle.portfolio.images.find(i => ad.image_ids.includes(i.id));
  const comparison = bundle.portfolio.goal_review?.groups.find(g => g.candidates.some(c => c.ad_id === ad.id));
  const selected = comparison?.candidates.find(c => c.ad_id === ad.id);
  const reason = [selected?.reason, comparison?.selection_reason].find(value => !genericSelectionReason(value));
  const variant = bundle.plan.experiments.flatMap(e => e.variants).find(v => v.id === ad.variant_id);
  return <article className={styles.ad} id={`formation-${ad.id}`} data-formation-ad={ad.id}>
    {(variant || ad.valid_until) && <div className={styles.adStamp}>{variant && <span>{businessText(variant.label)}</span>}{ad.valid_until && <span>До {new Date(ad.valid_until).toLocaleDateString("ru-RU")}</span>}</div>}
    <div className={styles.creative}>{image && <img src={image.url} alt={image.alt} width={160} height={160} />}<div><small>{new URL(ad.url).hostname}</small><h4>{ad.titles[0]}</h4><p>{ad.texts[0]}</p></div></div>
    <EvidenceBasis research={bundle.research} sourceFacts={sourceFacts} findingIds={findingIds} sourceRefs={ad.source_refs} explanation={reason ? businessText(reason) : undefined}>{!reason && <section><h4>Ситуация покупателя</h4><p>{businessText(buyerSituation(groupIntent))}</p></section>}</EvidenceBasis>
  </article>;
}
function AdRecords({ ad, bundle }: { ad: FormationAd; bundle: FormationBundle }) {
  const variant = bundle.plan.experiments.flatMap(e => e.variants).find(v => v.id === ad.variant_id);
  return <section className={styles.recordSection} data-ad-record={ad.id}>
    <h3>{ad.titles[0]}</h3>{variant && <p>{businessText(variant.label)}</p>}{ad.valid_until && <p>Действует до {new Date(ad.valid_until).toLocaleDateString("ru-RU")}</p>}
    <div className={styles.twoColumns}><div><h4>Заголовки</h4><ol>{ad.titles.map((value, i) => <li key={i}>{value}</li>)}</ol></div><div><h4>Тексты</h4><ol>{ad.texts.map((value, i) => <li key={i}>{value}</li>)}</ol></div></div>
    <a href={ad.url} target="_blank" rel="noreferrer">Страница объявления</a>

    {ad.extensions && <TextDetails title="Быстрые ссылки и уточнения">{ad.extensions.sitelinks.map(link => <div key={link.url}><p><a href={link.url} target="_blank" rel="noreferrer">{link.title}</a>{link.description && <> · {link.description}</>}</p></div>)}{ad.extensions.callouts.length > 0 && <ul>{ad.extensions.callouts.map(c => <li key={c.text}>{c.text}</li>)}</ul>}<p>{businessText(ad.extensions.reason)}</p></TextDetails>}
  </section>;
}
function CampaignSettings({ campaign: c, plan, rule }: { campaign: FormationCampaign; plan: FormationPlan; rule: (id: string) => string }) {
  return <TextDetails title="Расходы и условия показа"><p>Бюджет на неделю: {money(c.weekly_budget_rub)}.</p>
    <p>{businessText(c.bidding.rationale)}</p><p>{businessText(c.activation_condition)}</p>
    <dl className={styles.facts}>{c.allocations.map(a => <div key={a.phase_id}><dt>{businessText(plan.budget.phases.find(p => p.id === a.phase_id)?.label ?? "Период бюджета")}</dt><dd>{money(a.cap_rub)}</dd></div>)}</dl>
    <PhraseList phrases={c.negative_keywords} /><PhraseList phrases={c.exclude_segments.map(rule)} title="Исключённые аудитории" />
  </TextDetails>;
}
function KeywordSelectionDetails({ bundle }: { bundle: FormationBundle }) {
  const research = bundle.research.keyword_research, review = bundle.portfolio.keyword_review;
  if (!research || !review) return null;
  const decisions = { INCLUDED: "Включена", COVERED: "Учтена другим ключом", EXCLUDED: "Исключена", DEFERRED: "Отложена" };
  const groups = bundle.portfolio.campaigns.flatMap(c => c.groups);
  return <TextDetails title="Как выбраны поисковые фразы">
    <p>{research.candidates.length} рассмотрено · {review.decisions.filter(d => d.disposition === "INCLUDED").length} включено. Неизмеренная частота остаётся неизвестной.</p>
    <p>{businessText(review.stopping_reason)}</p>
    <table><thead><tr><th>Фраза</th><th>Решение</th><th>Обоснование</th></tr></thead><tbody>{review.decisions.map(d => <tr key={d.candidate_id}>
      <td>{research.candidates.find(c => c.id === d.candidate_id)?.phrase}</td><td>{decisions[d.disposition]}{d.group_id && <small>{businessText(groups.find(g => g.id === d.group_id)?.name ?? "")}</small>}{d.disposition === "COVERED" && <small>Ключ: {d.keyword}</small>}</td><td>{businessText(d.reason)}</td>
    </tr>)}</tbody></table>
    <TextDetails title="Исследованные намерения">{research.families.map(f => <section key={f.id}><h3>{businessText(f.intent)}</h3><p>{f.seeds.join(" · ")}</p><p>{businessText(f.conclusion)}</p></section>)}<p>{businessText(research.stopping_reason)}</p></TextDetails>
  </TextDetails>;
}
function OptimizationDetails({ bundle, sourceFacts }: { bundle: FormationBundle; sourceFacts?: ReadableEvidenceFact[] }) {
  const review = bundle.portfolio.optimization_review;
  if (!review) return null;
  const names = { AUDIENCE_AND_INTENT: "Аудитория и запросы", OFFER_AND_COPY: "Предложение и текст", CREATIVE: "Оформление и дополнения", LANDING_AND_QUALIFICATION: "Страница и качество обращений", DELIVERY: "Настройки показа", BUDGET_AND_TIMING: "Бюджет и сроки" };
  return <TextDetails title="Как агент выбрал объявления">
    <p>Выбор основан на исследовании и сравнении вариантов. Отклик на рекламу ещё не измерен.</p>
    {review.groups.map(group => <section key={group.group_id} data-optimization-group={group.group_id}>
      <h3>{businessText(bundle.portfolio.campaigns.flatMap(c => c.groups).find(g => g.id === group.group_id)?.name ?? "Группа объявлений")}</h3>
      <p>{businessText(group.selection_reason)}</p><p><strong>Главное возражение: </strong>{businessText(group.strongest_counterargument)}</p>
      <table><colgroup><col style={{ width: "18%" }} /><col style={{ width: "40%" }} /><col style={{ width: "42%" }} /></colgroup><thead><tr><th>Что оценили</th><th>Почему выбрано</th><th>Рассмотренные альтернативы</th></tr></thead><tbody>{group.parameters.map(row => <tr key={row.parameter}>
        <td>{names[row.parameter]}</td><td>{businessText(row.reason)}</td><td>{row.alternatives.length ? row.alternatives.map((alternative, index) => <article key={index}>
          <strong>{businessText(alternative.label)}</strong><p>{businessText(alternative.expected_advantage)}</p><p>Риск: {businessText(alternative.principal_risk)}</p>{alternative.rejection_reason !== row.reason && <p>{businessText(alternative.rejection_reason)}</p>}
        </article>) : "Сохранено с учётом выбранного плана"}</td>
      </tr>)}</tbody></table>
      <EvidenceBasis research={bundle.research} sourceFacts={sourceFacts} findingIds={[...new Set(group.parameters.flatMap(row => [...row.finding_ids, ...row.alternatives.flatMap(a => a.finding_ids)]))]} />
    </section>)}
    {review.issues.length > 0 && <TextDetails title="Доработки и оставшиеся ограничения">{review.issues.map(issue => <article key={issue.id}>
      <h3>{issue.status === "REPAIRED" ? "Доработано" : issue.status === "ACCEPTED_LIMITATION" ? "Остаётся неизвестным" : "Требует доработки"}</h3><p>{businessText(issue.finding)}</p><p>{businessText(issue.action)}</p>
    </article>)}</TextDetails>}
    <p>{businessText(review.stopping_reason)}</p>
  </TextDetails>;
}
export function FormationPortfolioView({ bundle, active, period, sourceFacts }: { bundle: FormationBundle; active: boolean; period?: string; sourceFacts?: ReadableEvidenceFact[]; materials?: ResearchMaterials }) {
  const { portfolio, plan, research } = bundle;
  const rule = (id: string) => portfolio.segments.find(s => s.id === id)?.rule ?? "Условие аудитории не найдено";
  const isV2 = usesTotalGoalBudget(plan.goal_preparation?.version);
  const adCount = portfolio.campaigns.reduce((total, campaign) => total + campaign.groups.reduce((sum, group) => sum + group.ads.length, 0), 0);
  return <section id="formation-portfolio" className={`${styles.portfolio} ${styles.quietPortfolio}`} aria-label="Подготовленные кампании" data-formation-method={bundle.method}>
    <header className={styles.header}><div><h1>Кампании</h1><small>{counted(portfolio.campaigns.length, ["кампания", "кампании", "кампаний"])} · {counted(adCount, ["объявление", "объявления", "объявлений"])} · {active ? "подготовка продолжается" : "черновики, не запущены"}</small></div>{period && <small>{periodText(period)}</small>}</header>
    <TestDataPanel research={research} compact />
    <BudgetStatement plan={plan} />
    <GoalPrelaunchStatus bundle={bundle} active={active} />
    <GoalPreparationSummary plan={plan} review={portfolio.goal_review} testScenario={research.mode === "TEST_SCENARIO"} compact />
    <div className={styles.compactCampaigns} id="formation-semantics">
      {portfolio.campaigns.map(c => {
        const direction = plan.directions.find(d => d.id === c.direction_id);
        const preparation = plan.goal_preparation?.directions.find(d => d.direction_id === c.direction_id);
        const candidate = plan.goal_preparation?.portfolio_search?.candidates.find(d => d.direction_id === c.direction_id && d.disposition === "SELECTED");
        const actualTargets = new Set([c.id, ...c.groups.flatMap(g => [g.id, ...g.ads.map(a => a.id)])]);
        const application = portfolio.applications.find(a => a.target_ids.some(id => actualTargets.has(id)));
        const decision = plan.decisions.find(d => d.disposition === "APPLIED" && d.target_ids.includes(c.direction_id));
        const reason = candidate?.reason ?? preparation?.audience_reason ?? decision?.reason ?? application?.explanation;
        return <details className={styles.compactCampaign} id={`formation-${c.id}`} key={c.id} data-formation-campaign={c.id}>
          <summary className={styles.compactCampaignSummary}>
            <div className={styles.campaignSummaryCopy}><h2>{businessText(c.name)}</h2><p>{businessText(direction ? buyerSituation(direction.intent) : [...new Set(c.groups.map(g => buyerSituation(g.intent)))].join(" "))}</p>{c.channel === "RETARGETING" && <p>{ownerBrief(findingLead(c.activation_condition))}</p>}</div>
            <span className={styles.summaryMeta}>{labels[c.channel]}{c.channel === "SEARCH" && <><br />{counted(c.groups.reduce((n, g) => n + g.keywords.length, 0), ["фраза", "фразы", "фраз"])}</>}<br />{counted(c.groups.reduce((sum, group) => sum + group.ads.length, 0), ["объявление", "объявления", "объявлений"])}</span>
            <strong className={styles.summaryBudget}>{money(c.allocations.reduce((n, a) => n + a.cap_rub, 0))}</strong>
          </summary>
          <div className={styles.campaignBody}>
            <PhraseList phrases={c.negative_keywords} title="Минус-фразы кампании" />
            <EvidenceBasis research={research} sourceFacts={sourceFacts} findingIds={direction?.finding_ids ?? c.groups.flatMap(g => g.finding_ids)} sourceRefs={preparation?.evidence_refs} explanation={reason ? businessText(reason) : undefined} choice={direction?.message ?? c.name} />
            {c.groups.map(g => <section className={styles.group} id={`formation-${g.id}`} key={g.id} data-formation-group={g.id}>
              <header className={styles.groupHeader}><h3>{businessText(g.name)}</h3></header>
              {buyerSituation(g.intent) !== (direction ? buyerSituation(direction.intent) : "") && <p className={styles.groupRole}>{businessText(buyerSituation(g.intent))}</p>}
              {g.keywords.length > 0 && <TextDetails title={`Поисковые фразы · ${g.keywords.length}`}><div data-keywords-for-group={g.id}>
                <table><thead><tr><th>Фраза</th><th>Частота и период</th><th>Основание</th></tr></thead><tbody>{g.keywords.map(k => <tr key={k.phrase} data-formation-keyword-state={k.state}>
                  <td>{k.phrase}</td><td>{k.count ?? (k.state === "NO_ROWS_RETURNED" ? "Нет строк" : "Не измерена")}<small>{[k.state === "OBSERVED_BROAD" ? "Широкая" : k.state === "OBSERVED_EXACT" ? "Точная" : "", k.period].filter(Boolean).join(" · ")}</small></td><td>{businessText(k.rationale)}</td>
                </tr>)}</tbody></table>
                <PhraseList phrases={g.negative_keywords} title="Минус-фразы группы" />
                <p>Также применяются минус-фразы кампании. Целевой автотаргетинг оценивается отдельно от ключей.</p>
                {portfolio.keyword_review?.groups.filter(row => row.group_id === g.id).map(row => <TextDetails key={row.group_id} title="Проверка намерения и исключений"><p>{businessText(row.landing_fit)}</p><p>{businessText(row.additional_value)}</p><p>{businessText(row.autotargeting_review)}</p><ul>{row.examples.map((e, i) => <li key={i}>{e.desired === "ALLOW" ? "Нужный запрос" : "Исключаемый запрос"}: «{e.query}» — {businessText(e.explanation)}</li>)}</ul>{row.ignored_negatives.map((n, i) => <p key={i}>Минус «{n.negative}» игнорируется для ключа «{n.keyword}»: {businessText(n.reason)}</p>)}<p>Это проверка подготовленных настроек; фактические показы и результаты ещё не получены.</p></TextDetails>)}
              </div></TextDetails>}
              {g.themes.length > 0 && <PhraseList phrases={g.themes} title="Темы рекламы" />}
              {g.ads.map(a => <AdPreview key={a.id} ad={a} bundle={bundle} findingIds={g.finding_ids} groupIntent={businessText(g.intent)} sourceFacts={sourceFacts} />)}
            </section>)}
          </div>
        </details>;
      })}
    </div>
    <KeywordSelectionDetails bundle={bundle} />
    <MaterialLimits plan={plan} review={portfolio.goal_review} portfolio={portfolio} />
    <FormationTechnicalDetails title="Подробности кампаний">
      <p>{businessText(portfolio.selection_rationale)}</p>
      <GoalOutcomeDetails bundle={bundle} />
      <OptimizationDetails bundle={bundle} sourceFacts={sourceFacts} />
      <TestDataPanel research={research} />
      {portfolio.campaigns.map(c => {
        const direction = plan.directions.find(d => d.id === c.direction_id);
        return <section key={c.id} className={styles.campaignRecords}><h2>{businessText(c.name)}</h2>
          {direction && <><p>Аудитория: {businessText(direction.audience)}</p><p>Намерение: {businessText(direction.intent)}</p><p>{direction.offer}</p><p>{direction.message}</p><p>{businessText(direction.activation_condition)}</p></>}
          <CampaignSettings campaign={c} plan={plan} rule={rule} />
          {c.groups.map(g => {
            const comparison = portfolio.goal_review?.groups.find(item => item.group_id === g.id);
            const rejected = comparison?.candidates.filter(item => item.disposition === "REJECTED") ?? [];
            return <section key={g.id} className={styles.recordSection}><h3>{businessText(g.name)}</h3><p>{businessText(g.intent)}</p>
              {g.ads.map(ad => <AdRecords key={ad.id} ad={ad} bundle={bundle} />)}
              {comparison && <TextDetails title="Сравнение объявлений"><p>{businessText(comparison.audience_fit)}</p><p>{businessText(comparison.qualification_mechanism)}</p><p>{businessText(comparison.selection_reason)}</p><p>{businessText(comparison.budget_reason)}</p>{comparison.reuse_reason && <p>{businessText(comparison.reuse_reason)}</p>}{comparison.candidates.filter(item => item.disposition !== "REJECTED").map(item => <p key={item.id}>{businessText(item.reason)}</p>)}</TextDetails>}
              {rejected.length > 0 && <TextDetails title="Отклонённые объявления">{rejected.map(item => <article key={item.id}><h4>{item.titles.join(" · ")}</h4><p>{item.texts.join(" · ")}</p><p>{businessText(item.reason)}</p></article>)}</TextDetails>}
              <PhraseList phrases={g.themes} title="Темы рекламы" /><PhraseList phrases={g.negative_keywords} /><PhraseList phrases={g.include_segments.map(rule)} title="Включённые аудитории" /><PhraseList phrases={g.exclude_segments.map(rule)} title="Исключённые аудитории" />
              <dl className={styles.facts}>{g.allocations.map(a => <div key={a.phase_id}><dt>{businessText(plan.budget.phases.find(p => p.id === a.phase_id)?.label ?? "Период бюджета")}</dt><dd>{money(a.cap_rub)}</dd></div>)}</dl>
            </section>;
          })}
        </section>;
      })}
      <GoalPreparationDetails plan={plan} review={portfolio.goal_review} calculationDetails={isV2 && plan.planning_inputs.length > 0 ? <FormationModel bundle={bundle} intermediate /> : undefined} />
      <FormationDecisions plan={plan} research={research} portfolio={portfolio} />
      <PlanningDetails plan={plan} portfolio={portfolio} />
      {!isV2 && <FormationModel bundle={bundle} />}
      {portfolio.semantic_dispositions.length > 0 && <TextDetails title="Отложенные и исключённые фразы"><table><thead><tr><th>Фраза</th><th>Решение</th><th>Причина</th></tr></thead><tbody>{portfolio.semantic_dispositions.map((d, i) => <tr key={i}><td>{d.phrase}</td><td>{labels[d.disposition]}</td><td>{businessText(d.reason)}</td></tr>)}</tbody></table></TextDetails>}
    </FormationTechnicalDetails>
  </section>;
}
function FormationModel({ bundle, intermediate = false }: { bundle: FormationBundle; intermediate?: boolean }) {
  const result = calculateFormationModel(bundle.plan, bundle.portfolio.campaigns.map(c => ({ direction_id: c.direction_id, spend: c.allocations.reduce((n, a) => n + a.cap_rub, 0), conditional: c.channel === "RETARGETING" })));
  const fmt = (value: number | null) => value === null ? "—" : value.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  return <TextDetails title={intermediate ? "Расчёт результатов по допущениям" : "Воронка и экономика"}><p>{bundle.research.mode === "TEST_SCENARIO" ? "Тестовый расчёт" : result.missing.length ? "Недостаточно данных" : "Расчёт"}</p>
    <table><thead><tr><th>Показатель</th><th>Расчёт</th></tr></thead><tbody>{[["Бюджет, ₽", result.spend], ["Клики", result.clicks], ["Формы", result.forms], ["Квалифицированные обращения", result.qualified], ["Оплаты", result.paid], ["Маржа после рекламы, ₽", result.contribution_after_ads]].map(([label, value]) => <tr key={String(label)}><td>{label}</td><td data-model-value={label}>{fmt(value as number | null)}</td></tr>)}</tbody></table>
    <p>Расчёт по заданным коэффициентам. Фактические показатели рекламы не получены.</p>
    {result.missing.length > 0 && <p>Для части показателей пока недостаточно данных. Неизвестные значения отмечены «—».</p>}
    {bundle.portfolio.campaigns.filter(c => c.channel === "RETARGETING").map(c => <p key={c.id}>{businessText(c.name)}: {businessText(c.activation_condition)}</p>)}
  </TextDetails>;
}

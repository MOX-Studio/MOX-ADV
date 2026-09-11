"use client";

import { Fragment } from "react";
import type { OwnerJourneyProjection } from "../lib/p0-owner-journey.ts";
import type { CurrentPipelineOwnerResult } from "../lib/pipeline-current-contract.ts";
import type { OwnerCompetitorAnalysis } from "../lib/competitor-dashboard.ts";
import { buildFindingsReport, type FindingsReport, type FindingsSection, type FindingState } from "../lib/findings-research.ts";
import { ownerDate } from "./ui-copy.ts";
import CompetitorTop from "./CompetitorTop.tsx";
import { isWordstatEmptyResultNote } from "../lib/wordstat-presentation.ts";
import { researchSourceStatus, type ResearchMaterials } from "../lib/research-material-presentation.ts";
import { businessSourceUrl, businessText } from "../lib/owner-business-copy.ts";

type Projection = OwnerJourneyProjection & { currentResult?: CurrentPipelineOwnerResult };
type Evidence = NonNullable<NonNullable<CurrentPipelineOwnerResult["products"]>["evidence"]>;
const states: Record<FindingState, string> = { SUPPORTED: "Есть основания", INDICATIVE: "С ограничениями", UNKNOWN: "Нужно уточнить", CONFLICT: "Противоречие", STALE: "Другой период" };
const fields: Record<string, string> = {
  company: "Компания", brand: "Бренд", company_capabilities: "Возможности компании", capabilities: "Возможности компании", product: "Продукт", advertised_offer: "Предложение", offer: "Предложение", value: "Ценность", value_proposition: "Ценность", offer_terms: "Условия", price: "Опубликованная цена",
  audience: "Аудитория", target_audience: "Аудитория", customer_context: "Покупатели", buying_context: "Процесс покупки", buyer_roles: "Участники решения", customer_jobs: "Задачи покупателя", choice_criteria: "Критерии выбора", objections: "Возражения", exclusions: "Исключения",
  revenue_model: "Модель выручки", average_sale_value_rub: "Средняя ценность продажи", gross_margin_percent: "Валовая маржа", lead_to_sale_percent: "Конверсия обращения в продажу", capacity: "Мощность продаж", sales_cycle: "Цикл сделки", seasonality: "Сезонность", geography: "География", key_constraints: "Ограничения",
  qualified_action: "Квалифицированный результат", qualified_outcome: "Квалифицированный результат", qualified_result: "Квалифицированный результат", crm_qualification: "Квалификация в CRM", measurement: "Измерение", landing_page: "Посадочная", conversion_path: "Путь до обращения", sales_process: "Обработка обращений", history: "История результатов", landing: "Посадочные", comparison: "Сопоставимые предложения", search_interest: "Поисковый интерес",
};
function human(value: string) { return businessText(value.replace(/Network connection lost[.!]?/giu, "Соединение с источником прервалось.").replace(/[a-zA-Z][a-zA-Z0-9_]*/gu, key => fields[key]?.toLocaleLowerCase("ru-RU") || key)); }
function visibleGaps(values: string[]) { return [...new Set(values.filter(value => !isWordstatEmptyResultNote(value)).map(human).filter(Boolean))]; }
function safeUrl(value: string) { return businessSourceUrl(value) ?? undefined; }
function displaySummary(section: FindingsSection, competitors?: OwnerCompetitorAnalysis, materials?: ResearchMaterials) {
  if (section.id === "competitors" && materials?.competitors.length && !competitors?.competitors.length) return materials.competitors.map(item => item.name).join(" · ");
  if (section.id === "competitors" && competitors) {
    const names = competitors.competitors.slice(0, 3).map(item => item.name);
    if (names.length) return `${names.join(" · ")}${competitors.competitors.length > 3 ? ` и ещё ${competitors.competitors.length - 3}` : ""}`;
    if (competitors.assessmentStatus === "CURRENT") return "В проверенном наборе конкуренты не найдены";
  }
  return businessText(section.summary);
}
function Comparison({ report, analysis }: { report: FindingsReport; analysis?: OwnerCompetitorAnalysis }) {
  if (!analysis?.competitors.length) return null;
  const own = (area: string, preferred?: string) => {
    const facts = report.sections.find(section => section.id === area)?.facts.filter(fact => ["SUPPORTED", "INDICATIVE"].includes(fact.state)) ?? [];
    return businessText((preferred ? facts.find(fact => fact.field === preferred)?.value : facts[0]?.value) || "Не подтверждено");
  };
  return <div className="findings-comparison"><h3>Сравнение с нашим предложением</h3>
    <table><thead><tr><th>Компания</th><th>Предложение</th><th>Покупатели</th><th>Цена и условия</th><th>Что учесть в стратегии</th></tr></thead>
      <tbody><tr className="findings-comparison-own"><th>Наше предложение</th><td>{own("product", "product")}</td><td>{own("buyer", "buyer_roles")}</td><td>{own("product", "offer_terms")}</td><td>Различия оцениваются по потребностям общего сегмента.</td></tr>
        {analysis.competitors.slice(0, 5).map(item => <tr key={item.name}><th><a href={safeUrl(item.landingUrl)} target="_blank" rel="noreferrer">{item.name}</a></th>
          <td>{businessText(item.analysis?.offer.text || item.observedOffer)}</td><td>{businessText(item.analysis?.buyer_segment.text || "Не подтверждено")}</td>
          <td>{item.analysis?.terms.text ? businessText(item.analysis.terms.text) : item.publishedPrice || "Не опубликовано"}</td><td>{businessText(item.analysis?.strategy_implications.map(implication => implication.text).join(" ") || "Сравнительный вывод требует проверки")}</td></tr>)}
      </tbody></table><p>Общие критерии сравнения. Неизвестные условия не считаются недостатком; рекламная эффективность конкурентов не установлена.</p>
  </div>;
}
function SearchQueries({ research, provenance, collecting, compact = false }: {
  research?: OwnerJourneyProjection["demandCostResearch"]; provenance?: Evidence["provenance"]; collecting: boolean; compact?: boolean;
}) {
  const demand = research?.demand;
  const formulations = demand?.formulations.filter(item => item.status === "Частота получена") ?? [];
  const source = provenance?.sources.find(item => item.id === "wordstat");
  const materialGaps = visibleGaps(demand?.gaps ?? []);
  const measurements = formulations.map(item => ({
    operator: businessText(item.operator || "Условия подсчёта не указаны"),
    scope: businessText((item.scope || demand?.scope || "География и устройства не указаны").replace(/\ball\b/gu, "все устройства")),
    date: item.observedAt || demand?.observedAt,
  }));
  const commonConditions = measurements.length > 0 && new Set(measurements.map(item => JSON.stringify([item.operator, item.scope]))).size === 1;
  const commonDate = measurements.length > 0 && new Set(measurements.map(item => item.date)).size === 1;
  const connectionLost = source?.limitations.some(item => /network connection lost/iu.test(item));
  const status = collecting ? "В работе" : formulations.length ? demand?.status ?? "Частично" : "Нет данных";
  const summary = collecting ? "Исследование выполняется"
    : formulations.length ? businessText(demand!.coverage)
      : connectionLost ? "Соединение с Wordstat прервалось" : "Подтверждённые частоты не получены";
  return <details className={`findings-brief-row${compact ? " findings-search-compact" : ""}`} data-area="search-queries">
    <summary><strong>Поисковые запросы</strong>{(!compact || collecting || !formulations.length) && <span className="findings-brief-value">{summary}</span>}
      {!compact && <span className="findings-brief-state">{status}</span>}<span className="findings-brief-chevron" aria-hidden="true">＋</span></summary>
    <div className="findings-brief-detail findings-search-queries">
      {!formulations.length && <p className="findings-full-conclusion">{collecting ? "Сбор запросов выполняется." : "Подтверждённые частоты не получены."}</p>}
      {connectionLost && <p className="findings-gaps">Причина: соединение с Wordstat прервалось во время сбора данных.</p>}
      {demand && <details className="findings-secondary"><summary>Условия измерения</summary>
        <dl className="findings-search-scope">
          <div><dt>Источник</dt><dd>Яндекс Wordstat</dd></div>
          <div><dt>Дата наблюдения</dt><dd>{source?.status === "UNAVAILABLE" ? "Данные не получены" : ownerDate(demand.observedAt)}</dd></div>
          <div><dt>География и устройства</dt><dd>{businessText(demand.scope.replace(/\ball\b/gu, "все устройства"))}</dd></div>
          <div><dt>Период</dt><dd>{demand.status === "Недоступно" ? "Период измерения не подтверждён" : businessText(demand.window)}</dd></div>
        </dl>
        <p>{businessText(demand.coverage)}</p>
      </details>}
      {formulations.length > 0 && <>
        {(commonConditions || commonDate) && <dl className="findings-search-common">
          {commonConditions && <div><dt>Условия измерения для всех строк</dt><dd>{measurements[0].operator}<small>{measurements[0].scope}</small></dd></div>}
          {commonDate && <div><dt>Дата наблюдения для всех строк</dt><dd>{ownerDate(measurements[0].date)}</dd></div>}
        </dl>}
        <div className="findings-search-table"><table>
        <caption>Запросы с подтверждённой частотой</caption>
        <thead><tr><th scope="col">Поисковый запрос</th><th scope="col">Частота</th>{!commonConditions && <th scope="col">Условия измерения</th>}{!commonDate && <th scope="col">Дата наблюдения</th>}</tr></thead>
        <tbody>{formulations.map((item, index) => <tr key={`${item.phrase}-${index}`}>
          <th scope="row">{item.phrase}</th><td>{item.frequency}</td>{!commonConditions && <td>{measurements[index].operator}<small>{measurements[index].scope}</small></td>}{!commonDate && <td>{ownerDate(measurements[index].date)}</td>}
        </tr>)}</tbody>
      </table></div></>}
      {materialGaps.length > 0 && <details className="findings-secondary"><summary>Ограничения данных</summary><ul>{materialGaps.map(gap => <li key={gap}>{gap}</li>)}</ul></details>}
      {formulations.length > 0 && <details className="findings-secondary"><summary>Как читать частоты</summary><p>{businessText(demand?.limitation || "Частоты не показывают число покупателей или будущих заявок.")}</p></details>}
      {!collecting && !formulations.length && <p><strong>Следующий шаг: </strong>{businessText(demand?.nextAction || "Повторить сбор запросов.")}</p>}
    </div>
  </details>;
}
function ResearchOverview({ report, competitors, materials }: { report: FindingsReport; competitors?: OwnerCompetitorAnalysis; materials?: ResearchMaterials }) {
  const conclusions = report.sections.map(section => ({ section, summary: displaySummary(section, competitors, materials) }))
    .filter(item => item.summary && item.summary !== "Данных пока недостаточно");
  if (!conclusions.length) return null;
  return <dl className="findings-conclusions" aria-label="Выводы исследования">{conclusions.map(({ section, summary }) => <div key={section.id}>
    <dt>{section.title}</dt><dd>{summary}{["CONFLICT", "STALE"].includes(section.state) && <small data-state={section.state}>{states[section.state]}</small>}</dd>
  </div>)}</dl>;
}
function ResearchLimits({ report, flat = false }: { report: FindingsReport; flat?: boolean }) {
  const groups = report.sections.map(section => ({ section, gaps: visibleGaps([
    ...section.gaps, ...section.facts.filter(fact => fact.state !== "SUPPORTED").map(fact => fact.limitation).filter(Boolean),
  ]) })).filter(group => group.gaps.length);
  const known = new Set(groups.flatMap(group => group.gaps));
  const other = visibleGaps(report.limitations).filter(gap => !known.has(gap));
  if (!groups.length && !other.length) return null;
  const content = <div className="findings-limit-groups">{groups.map(({ section, gaps }) => <section key={section.id}>
      <h3>{section.title}<small data-state={section.state}>{states[section.state]}</small></h3><ul>{gaps.map(gap => <li key={gap}>{gap}</li>)}</ul>
    </section>)}{other.length > 0 && <section><h3>Другие ограничения</h3><ul>{other.map(gap => <li key={gap}>{gap}</li>)}</ul></section>}</div>;
  if (flat) return <section aria-label="Ограничения исследования"><h3>Ограничения исследования</h3>{content}</section>;
  return <details className="findings-limits" aria-label="Ограничения исследования">
    <summary><strong>Ограничения исследования</strong><span>{groups.map(group => group.section.title).join(" · ")}</span><span className="findings-brief-chevron" aria-hidden="true">＋</span></summary>
    {content}
  </details>;
}
function ReportRows({ report, competitors, demand, provenance, materials, includeSearch = false, flat = false, includeGaps = true }: { report: FindingsReport; competitors?: OwnerCompetitorAnalysis; demand?: OwnerJourneyProjection["demandCostResearch"]; provenance?: Evidence["provenance"]; materials?: ResearchMaterials; includeSearch?: boolean; flat?: boolean; includeGaps?: boolean }) {
  const Entry = flat ? "section" : "details";
  const Heading = flat ? "header" : "summary";
  return <div className="findings-brief-rows">{report.sections.map(section => <Fragment key={section.id}><Entry className="findings-brief-row" data-area={section.id}>
    <Heading><strong>{section.title}</strong><span className="findings-brief-value">{displaySummary(section, competitors, materials)}</span>
      <span className="findings-brief-state" data-state={section.state}>{section.id === "competitors" && materials?.competitors.length ? "Есть исследование" : states[section.state]}</span>{!flat && <span className="findings-brief-chevron" aria-hidden="true">＋</span>}</Heading>
    <div className="findings-brief-detail">
      {section.id === "competitors" && materials?.competitors.map(item => <details className="findings-secondary" key={item.id}><summary>{item.name}</summary><p>{businessText(item.fields[0]?.value ?? "")}</p>{item.sources.filter(s => safeUrl(s.url)).map(s => <a key={s.url} href={safeUrl(s.url)} target="_blank" rel="noreferrer">{businessText(s.title)}</a>)}</details>)}
      {section.facts.length > 0 && <dl className="findings-facts">{section.facts.map(fact => <div key={fact.id}>
        <dt>{fields[fact.field] || "Наблюдение"}<small data-state={fact.state}>{states[fact.state]}</small></dt><dd>{["price", "average_sale_value_rub", "gross_margin_percent", "lead_to_sale_percent"].includes(fact.field) ? fact.value || "Не получено" : businessText(fact.value || "Не получено")}
          {(fact.limitation || fact.sources.some(url => safeUrl(url))) && <details className="findings-secondary"><summary>Основание</summary>{fact.limitation && <small>{businessText(fact.limitation)}</small>}{fact.sources.filter(url => safeUrl(url)).map(url => <a key={url} href={safeUrl(url)} target="_blank" rel="noreferrer">Источник</a>)}</details>}</dd>
      </div>)}</dl>}
      {section.id === "competitors" && <><Comparison report={report} analysis={competitors} />{competitors?.research && <CompetitorTop analysis={competitors} />}
        {competitors?.financialProfiles && competitors.financialProfiles.length > 0 && <details className="findings-secondary"><summary>Финансовые сведения</summary>
          {competitors.financialProfiles.map(profile => <p key={profile.name}>{profile.name} · {profile.reportingYear || "Период неизвестен"}: выручка {profile.revenueRub ?? "неизвестна"}, чистая прибыль {profile.netProfitRub ?? "неизвестна"}. {(profile.bfoUrl || profile.rusprofileUrl) && <a href={safeUrl(profile.bfoUrl || profile.rusprofileUrl || "")} target="_blank" rel="noreferrer">Отчётность</a>}</p>)}
          <p>Показатели юрлица не определяют рекламный бюджет и эффективность.</p></details>}</>}
      {includeGaps && visibleGaps(section.gaps).length > 0 && <div className="findings-gaps">{section.facts.length > 0 && <h3>Что нужно уточнить</h3>}<ul>{visibleGaps(section.gaps).map(gap => <li key={gap}>{gap}</li>)}</ul></div>}
    </div>
  </Entry>{includeSearch && section.id === "demand" && <SearchQueries research={demand} provenance={provenance} collecting={false} />}</Fragment>)}</div>;
}
export default function FindingsReadiness({ projection, busy, active, onRefresh, onCompetitorRefresh, competitorBusy = false, onContinue, embedded = false, view = "full" }: {
  projection: Projection; busy: boolean; active: boolean; onRefresh: () => Promise<void>; onCompetitorRefresh?: () => Promise<void>; competitorBusy?: boolean; onContinue?: () => Promise<void>; embedded?: boolean; view?: "full" | "search" | "archive";
}) {
  const evidence: Evidence | null | undefined = projection.currentResult?.products?.evidence;
  const previous = projection.currentResult?.products?.previousEvidence;
  // A new run does not erase the last known results. This is display-only;
  // reuse authority and Strategy inputs still come from the current pipeline.
  const showingPrevious = !evidence && Boolean(previous);
  const report = evidence?.findings ?? (showingPrevious ? previous!.findings : buildFindingsReport({}));
  const competitors = showingPrevious ? previous!.competitorAnalysis : evidence?.competitorAnalysis;
  const provenance = showingPrevious ? previous!.provenance : evidence?.provenance;
  const materials = showingPrevious ? previous!.researchMaterials : evidence?.researchMaterials;
  const demand = showingPrevious ? previous!.demandCostResearch : projection.currentResult?.products?.demandCostResearch ?? projection.demandCostResearch;
  const continueReady = Boolean(onContinue && projection.pipeline?.evidenceReuse?.available && !active);
  const mono = projection.pipeline?.singleCodex;
  const refreshing = active && projection.pipeline?.currentStage === "findings" && (!mono || mono.phase === "COLLECTING");
  const date = report.collected_at || (showingPrevious ? previous!.generatedAt : evidence?.generatedAt);
  const status = showingPrevious ? "Показан последний сохранённый анализ" : !embedded && !refreshing ? businessText(report.summary) : "";
  const hasSavedInformation = Boolean(evidence || showingPrevious || report.snapshot_id);
  const failedSourceAttempt = report.attempts.some(attempt => /не получен|недоступ|не удалось|ошиб|error|fail|timeout|unavailable|denied/iu.test(attempt.outcome));
  const hasSources = Boolean(provenance?.sources.length || failedSourceAttempt || showingPrevious || evidence?.competitorRefresh || demand?.demand.gaps.some(isWordstatEmptyResultNote));
  const sourceArchive = <div className="findings-source-list">
    {demand?.demand.gaps.some(isWordstatEmptyResultNote) && <article><strong>Запросы без данных</strong>{[...new Set(demand.demand.gaps.filter(isWordstatEmptyResultNote).map(human).filter(Boolean))].map(item => <p key={item}>{item}</p>)}</article>}
    {showingPrevious && <p><strong>Цель сохранённого анализа:</strong> {previous?.goal || "Цель исходного исследования"}. Дата исследования сохранена; новый результат ещё не получен.</p>}
    {evidence?.competitorRefresh && <p>Конкуренты проверены {ownerDate(evidence.competitorRefresh.refreshedAt)}</p>}
    {provenance?.sources.map(source => {
      const display = researchSourceStatus(source, materials), date = display.date || source.observedAt;
      const limits = [...new Set(source.limitations.map(human).filter(Boolean))];
      return <article key={source.id}><strong>{businessText(display.title)}</strong><p>{businessText(display.status)}{date ? ` · ${date.slice(0, 10)}` : ""}</p>{display.detail && !/API|кампаний:\s*\d/iu.test(display.detail) && <p>{businessText(display.detail)}</p>}
        {source.sourceUrls.filter(url => safeUrl(url)).map(url => <a key={url} href={safeUrl(url)} target="_blank" rel="noreferrer">Открыть источник</a>)}
        {limits.map(item => <p key={item}>{item}</p>)}
        {!limits.length && source.status === "UNAVAILABLE" && <p>Не удалось получить данные из этого источника.</p>}
      </article>;
    })}
    {!evidence && !showingPrevious && <p>{active ? "Источники проверяются. Итог появится после завершения исследования." : "Источники ещё не получены."}</p>}
    {failedSourceAttempt && !provenance?.sources.length && <p>Часть сведений получить не удалось. Ограничения исследования сохраняются.</p>}
  </div>;
  const savedContext = <>
    {showingPrevious && <p>Показан последний сохранённый анализ.</p>}
    {date && <p className="findings-archive-date">Данные от {ownerDate(date)}{showingPrevious && refreshing && " · Обновление выполняется"}</p>}
    {showingPrevious && previous?.matchesCurrentGoal === false && <p className="findings-brief-next">Этот анализ относится к предыдущей версии цели. Для текущей цели исследование ещё не завершено.</p>}
  </>;
  if (view === "search") return <section className="findings-readiness findings-brief" aria-label="Поисковые запросы">
    {showingPrevious && savedContext}
    <SearchQueries research={demand} provenance={provenance} collecting={refreshing && !report.snapshot_id} compact />
  </section>;
  if (view === "archive") return <div className="findings-readiness findings-brief findings-archive" aria-label="Сохранённое исследование">
    {savedContext}
    <ResearchLimits report={report} flat />
    <section><h3>Полные сведения</h3><ReportRows report={report} competitors={competitors} provenance={provenance} materials={materials} flat includeGaps={false} /></section>
    {previous && !showingPrevious && <section className="findings-previous"><h3>Предыдущий анализ · {ownerDate(previous.generatedAt)}</h3>
      <p><strong>Предыдущая версия.</strong> {previous.goal || "Цель исходного исследования"}. Данные относятся к указанной дате и прежней цели.</p>
      <ReportRows report={previous.findings} competitors={previous.competitorAnalysis} demand={previous.demandCostResearch} provenance={previous.provenance} materials={previous.researchMaterials} includeSearch flat />
    </section>}
    {hasSources && <section><h3>Источники исследования</h3>{sourceArchive}</section>}
  </div>;
  return <section className="findings-readiness findings-brief" data-embedded={embedded || undefined} aria-label={embedded ? "Подробности исследования" : "Сбор сведений"}>
    {(!embedded || status || date || !mono) && <header className="findings-brief-header"><div>{!embedded && <h2>Сбор сведений</h2>}{status && <p>{status}</p>}
      {date && <small>Данные от {ownerDate(date)}{showingPrevious && refreshing && " · Обновление выполняется"}</small>}</div>
      {!mono && <div className="findings-brief-actions"><button className="findings-primary" type="button" disabled={busy || active || competitorBusy} onClick={continueReady ? onContinue : onRefresh}>{busy ? "Выполняю…" : continueReady ? "Продолжить к стратегии" : "Обновить сведения"}</button>
        {(continueReady || onCompetitorRefresh) && <details className="findings-actions-menu"><summary aria-label="Дополнительные действия">•••</summary><div>
          {continueReady && <button type="button" onClick={onRefresh} disabled={busy || active || competitorBusy}>Собрать сведения заново</button>}
          {onCompetitorRefresh && <button type="button" onClick={onCompetitorRefresh} disabled={busy || competitorBusy || (active && projection.pipeline?.currentStage !== "campaigns") || !evidence}>{competitorBusy ? "Ищу конкурентов…" : "Обновить конкурентов"}</button>}
        </div></details>}</div>}</header>}
    {showingPrevious && previous?.matchesCurrentGoal === false && <p className="findings-brief-next">Этот анализ относится к предыдущей версии цели. Для текущей цели исследование ещё не завершено.</p>}
    {!embedded && hasSavedInformation && <ResearchOverview report={report} competitors={competitors} materials={materials} />}
    <SearchQueries research={demand} provenance={provenance} collecting={refreshing && !report.snapshot_id} />
    <ResearchLimits report={report} />
    <div className="findings-brief-secondary">
      <details className="findings-secondary findings-topic-records"><summary>Подробности по темам</summary>
        <ReportRows report={report} competitors={competitors} provenance={provenance} materials={materials} />
      </details>
      {previous && !showingPrevious && <details className="findings-secondary"><summary>Предыдущий анализ · {ownerDate(previous.generatedAt)}</summary><div className="findings-previous">
        <p><strong>Предыдущая версия.</strong> {previous.goal || "Цель исходного исследования"}. Данные относятся к указанной дате и прежней цели.</p>
        <ReportRows report={previous.findings} competitors={previous.competitorAnalysis} demand={previous.demandCostResearch} provenance={previous.provenance} materials={previous.researchMaterials} includeSearch />
      </div></details>}
      {hasSources && <details className="findings-secondary"><summary>Источники исследования</summary>{sourceArchive}</details>}
    </div>
  </section>;
}

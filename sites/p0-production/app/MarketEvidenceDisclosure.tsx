/* eslint-disable @typescript-eslint/no-explicit-any -- revisioned evidence payloads are validated by the server contract. */
import { deviceLabel, machineLabel } from "./ui-copy.ts";

type MarketEvidence = Record<string, any>;

function frequencySummary(frequency: MarketEvidence) {
  const value = frequency.observed_unique_count?.value;
  return typeof value === "number" ? `${value}+ запросов` : "Частотность недоступна";
}

function scopeSummary(scope: MarketEvidence) {
  const regions = Array.isArray(scope.region_names) && scope.region_names.length
    ? scope.region_names.join(", ")
    : "регион не подтверждён";
  return `${regions} · ${deviceLabel(scope.device)} · профиль операторов: ${scope.operator_profile || "не указан"}`;
}

function costSummary(cost: MarketEvidence) {
  if (!["AVAILABLE", "CONFLICTING"].includes(cost.status) || !cost.range) return "Сопоставимая оценка цены недоступна";
  return `${cost.range.low}–${cost.range.high} ${cost.currency}`;
}

function costDecisionLabel(decision: MarketEvidence) {
  if (decision.status === "OWNER_ECONOMICS_EDIT_REQUIRED") return "Нужно уточнить экономику результата";
  if (decision.status === "COST_EVIDENCE_BLOCKED") return "Конфликт стоимости блокирует подготовку";
  if (decision.status === "BOUNDED_TRAFFIC_FALLBACK") return "Ограниченный бюджетом тест трафика";
  return "Квалифицированный диапазон применён";
}

export function MarketEvidenceDisclosure({ evidence, context = "model", costDecision }: { evidence: MarketEvidence; context?: "model" | "draft"; costDecision?: MarketEvidence }) {
  const frequency = evidence.frequency || {};
  const cost = evidence.cost || {};
  const scopes = Array.isArray(frequency.scopes) ? frequency.scopes : [];
  const rows = Array.isArray(frequency.unique_assigned_rows) ? frequency.unique_assigned_rows : [];
  const gaps = Array.isArray(frequency.gaps) ? frequency.gaps : [];
  const costReasons = Array.isArray(cost.missing_or_conflict_reasons) ? cost.missing_or_conflict_reasons : [];
  return <section className="market-evidence" aria-label={context === "model" ? "Спрос и стоимость до запуска" : "Доказательства черновика кампании"}>
    <header>
      <div><p className="eyebrow">Официальные рыночные данные в точном охвате</p><h4>Спрос и стоимость до запуска</h4></div>
      <strong className={String(frequency.status || "UNAVAILABLE").toLowerCase()}>{machineLabel(frequency.status, "Недоступно")}</strong>
    </header>
    <div className="market-evidence-grid">
      <article>
        <span>Wordstat · {frequency.method || "/v1/topRequests"}</span>
        <strong>{frequencySummary(frequency)}</strong>
        <small>{frequency.observed_unique_count?.semantics === "LOWER_BOUND_OBSERVED_TOP_ROWS" ? "Нижняя граница по наблюдаемым популярным запросам" : machineLabel(frequency.observed_unique_count?.semantics, "Недоступно — это не нулевой спрос")}</small>
        {scopes[0] && <small>{scopeSummary(scopes[0])} · собрано {frequency.batch_finished_at || evidence.batch_finished_at || "неизвестно"}</small>}
        <small>{rows.length} уникальных распределённых строк · каждая учтена не более одного раза</small>
      </article>
      <article>
        <span>Подходящая оценка стоимости до запуска</span>
        <strong>{costSummary(cost)}</strong>
        <small>{cost.compact_source || "Недоступно"}</small>
        <small>{cost.aggregation === "FIRST_QUALIFIED_SOURCE_NO_AVERAGING" ? "Первый подходящий источник, без усреднения" : machineLabel(cost.aggregation, "Правило объединения недоступно")}</small>
        <small>Это стоимость перехода в аукционном scope, не стоимость бизнес-результата; диапазон не прогнозирует эффективность.</small>
      </article>
    </div>
    <details>
      <summary>Раскрыть охват, пакет снимка и ограничения частотности</summary>
      <div className="market-evidence-detail">
        <p><b>Пакет снимка:</b> <code>{frequency.snapshot_batch_id || evidence.snapshot_batch_id || "не указан"}</code></p>
        {scopes.length ? <ul>{scopes.map((scope: MarketEvidence, index: number) => <li key={`${scope.scope_fingerprint || "scope"}-${index}`}>{scopeSummary(scope)} · {scope.observed_unique_count?.value ?? "неизвестно"}+</li>)}</ul> : <p>Охват по операторам, регионам и устройствам недоступен — это не означает нулевую частотность.</p>}
        <p><b>Окно:</b> последние 30 дней; точный конец окна API не раскрывает ({frequency.source_window_end || "не раскрыт API"}).</p>
        <p><b>Смысл:</b> нижняя граница по наблюдаемым популярным запросам; это запросы, не пользователи, клики или гарантированные показы.</p>
        <p><b>Динамика:</b> {machineLabel(frequency.seasonality?.status, "Недоступно")} · /v1/dynamics · широкий охват. <b>Регионы:</b> {machineLabel(frequency.geo_evidence?.status, "Недоступно")} · /v1/regions.</p>
        {gaps.length > 0 && <ul className="limitations">{gaps.map((gap: MarketEvidence, index: number) => <li key={`${gap.code}-${index}`}>{gap.code}: {gap.detail}</li>)}</ul>}
      </div>
    </details>
    <details>
      <summary>Раскрыть источник, сценарий и охват стоимости</summary>
      <div className="market-evidence-detail">
        {["AVAILABLE", "CONFLICTING"].includes(cost.status) ? <>
          <p><b>Источник:</b> {cost.compact_source}</p>
          <p><b>Сценарий:</b> {cost.scenario}</p>
          <p><b>Охват:</b> <code>{JSON.stringify(cost.scope)}</code></p>
          <p><b>На дату:</b> {cost.as_of} · <b>НДС: {cost.vat_treatment}</b> · <b>выборка:</b> {cost.sample_size?.value} {cost.sample_size?.unit}</p>
          <p><b>Диапазон:</b> {machineLabel(cost.range?.kind, "не указан")}; источники не усредняются ({cost.aggregation === "FIRST_QUALIFIED_SOURCE_NO_AVERAGING" ? "первый подходящий источник" : machineLabel(cost.aggregation)}).</p>
        </> : <>
          <p><b>Сопоставимая оценка цены недоступна.</b> Нулевые или выдуманные границы не подставляются.</p>
          {costReasons.length > 0 && <ul className="limitations">{costReasons.map((reason: string) => <li key={reason}>{reason}</li>)}</ul>}
        </>}
      </div>
    </details>
    {costDecision && <article className="market-evidence-cost-decision" data-cost-outcome={costDecision.status}>
      <span>Последствие для стратегии</span>
      <strong>{costDecisionLabel(costDecision)}</strong>
      <p>{costDecision.uncertainty || "Неопределённость стоимости раскрыта."}</p>
      {Array.isArray(costDecision.consequences) && costDecision.consequences.length > 0 && <ul className="limitations">{costDecision.consequences.map((item: string) => <li key={item}>{item}</li>)}</ul>}
    </article>}
    {context === "draft" && evidence.packing && <details>
      <summary>Раскрыть детерминированную упаковку показа</summary>
      <div className="market-evidence-detail"><code>{JSON.stringify(evidence.packing)}</code></div>
    </details>}
  </section>;
}

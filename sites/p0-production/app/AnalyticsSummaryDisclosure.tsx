import type { OwnerAnalyticsSummary } from "../lib/analytics-owner-summary";
import { localizedText } from "./ui-copy.ts";

function state(status: OwnerAnalyticsSummary["status"]) {
  return status === "Готово к стратегии" ? "ready" : status === "Есть существенные пробелы" ? "mixed" : "blocked";
}

export default function AnalyticsSummaryDisclosure({ summary }: { summary: OwnerAnalyticsSummary }) {
  return <section className="owner-analytics-summary" data-analytics-state={state(summary.status)} aria-labelledby="owner-analytics-summary-title">
    <header>
      <div><p className="owner-eyebrow">СВОДКА АНАЛИТИКИ</p><h2 id="owner-analytics-summary-title">Что известно о бизнесе и рынке</h2></div>
      <strong>{summary.status}</strong>
    </header>
    <article className="owner-analytics-conclusion">
      <h3>{localizedText(summary.headline)}</h3>
      <p>{localizedText(summary.conclusion)}</p>
    </article>
    <dl className="owner-analytics-quality" aria-label="Качество данных">
      <div><dt>Покрытие</dt><dd>{localizedText(summary.quality.coverage)}</dd></div>
      <div><dt>Свежесть</dt><dd>{localizedText(summary.quality.freshness)}</dd></div>
      <div><dt>Согласованность</dt><dd>{localizedText(summary.quality.consistency)}</dd></div>
      <div><dt>Как понимать оценку</dt><dd>{localizedText(summary.quality.limitation)}</dd></div>
    </dl>
    {summary.observedSegmentRevenueShare && <article className="owner-observed-revenue-share" aria-labelledby="owner-observed-revenue-share-title">
      <header><div><span>ФИНАНСОВЫЙ КОНТЕКСТ</span><h3 id="owner-observed-revenue-share-title">{summary.observedSegmentRevenueShare.label}</h3></div><strong>{summary.observedSegmentRevenueShare.status}</strong></header>
      <div className="owner-observed-revenue-value"><b>{summary.observedSegmentRevenueShare.value}</b><p>{localizedText(summary.observedSegmentRevenueShare.scope)}</p></div>
      <dl>
        <div><dt>Что считаем</dt><dd>{localizedText(summary.observedSegmentRevenueShare.numerator)}</dd></div>
        <div><dt>С чем сравниваем</dt><dd>{localizedText(summary.observedSegmentRevenueShare.denominator)}</dd></div>
        <div><dt>Покрытие</dt><dd>{localizedText(summary.observedSegmentRevenueShare.coverage)}</dd></div>
        <div><dt>Отсутствующие организации</dt><dd>{summary.observedSegmentRevenueShare.missingEntities.length
          ? <ul>{summary.observedSegmentRevenueShare.missingEntities.map((item) => <li key={item}>{item}</li>)}</ul>
          : "Нет в указанном наборе."}</dd></div>
      </dl>
      <p>{localizedText(summary.observedSegmentRevenueShare.limitation)}</p>
    </article>}
    <div className="owner-analytics-findings" aria-label="Данные по направлениям анализа">
      {summary.findings.map((finding) => <article key={finding.area} data-evidence-state={finding.status === "Подтверждено" ? "verified" : finding.status === "Частично" ? "partial" : "unavailable"}>
        <header><h3>{localizedText(finding.area)}</h3><strong>{finding.status}</strong></header>
        <p>{localizedText(finding.finding)}</p>
        <dl>
          <div><dt>Источник</dt><dd>{localizedText(finding.source)}</dd></div>
          <div><dt>Свежесть</dt><dd>{localizedText(finding.freshness)}</dd></div>
          <div><dt>Уверенность</dt><dd>{localizedText(finding.confidence)}</dd></div>
          <div><dt>Ограничение</dt><dd>{localizedText(finding.limitation)}</dd></div>
        </dl>
      </article>)}
    </div>
    {summary.remediation.length > 0 && <section className="owner-analytics-remediation" aria-labelledby="owner-analytics-remediation-title">
      <header><span>ПРИОРИТЕТНАЯ ПОСЛЕДОВАТЕЛЬНОСТЬ</span><h3 id="owner-analytics-remediation-title">Что исправить прежде всего</h3></header>
      <ol>{summary.remediation.map((item) => <li key={`${item.priority}-${item.area}-${item.action}`}>
        <b>{item.priority}</b>
        <div><span>{localizedText(item.impact)} · {item.area}</span><strong>{localizedText(item.problem)}</strong><p>{localizedText(item.action)}</p></div>
      </li>)}</ol>
    </section>}
  </section>;
}

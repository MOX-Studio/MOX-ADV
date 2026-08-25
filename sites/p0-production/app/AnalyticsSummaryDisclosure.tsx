import type { OwnerAnalyticsSummary } from "../lib/analytics-owner-summary";

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
      <h3>{summary.headline}</h3>
      <p>{summary.conclusion}</p>
    </article>
    <dl className="owner-analytics-quality" aria-label="Качество доказательств">
      <div><dt>Покрытие</dt><dd>{summary.quality.coverage}</dd></div>
      <div><dt>Свежесть</dt><dd>{summary.quality.freshness}</dd></div>
      <div><dt>Согласованность</dt><dd>{summary.quality.consistency}</dd></div>
      <div><dt>Как читать статус</dt><dd>{summary.quality.limitation}</dd></div>
    </dl>
    <div className="owner-analytics-findings" aria-label="Факты по областям аналитики">
      {summary.findings.map((finding) => <article key={finding.area} data-evidence-state={finding.status === "Подтверждено" ? "verified" : finding.status === "Частично" ? "partial" : "unavailable"}>
        <header><h3>{finding.area}</h3><strong>{finding.status}</strong></header>
        <p>{finding.finding}</p>
        <dl>
          <div><dt>Источник</dt><dd>{finding.source}</dd></div>
          <div><dt>Свежесть</dt><dd>{finding.freshness}</dd></div>
          <div><dt>Уверенность</dt><dd>{finding.confidence}</dd></div>
          <div><dt>Ограничение</dt><dd>{finding.limitation}</dd></div>
        </dl>
      </article>)}
    </div>
    {summary.remediation.length > 0 && <section className="owner-analytics-remediation" aria-labelledby="owner-analytics-remediation-title">
      <header><span>ПРИОРИТЕТНАЯ ПОСЛЕДОВАТЕЛЬНОСТЬ</span><h3 id="owner-analytics-remediation-title">Что исправить прежде всего</h3></header>
      <ol>{summary.remediation.map((item) => <li key={`${item.priority}-${item.area}-${item.action}`}>
        <b>{item.priority}</b>
        <div><span>{item.impact} · {item.area}</span><strong>{item.problem}</strong><p>{item.action}</p></div>
      </li>)}</ol>
    </section>}
  </section>;
}

import type { OwnerCompetitorAnalysis } from "../lib/competitor-dashboard.ts";
import type { CompetitorStatement, CompetitorCriterion } from "../lib/competitor-ranking.ts";
import { businessSourceUrl, businessText } from "../lib/owner-business-copy.ts";

const criteria: Record<CompetitorCriterion, string> = {
  BUYER_OVERLAP: "Пересечение покупателей", OFFER_SUBSTITUTION: "Заменяемость предложения",
  ATTRACTION: "Привлекательность", TERMS: "Условия участия", PROMOTION: "Продвижение",
};
const levels = { HIGH: "Высокая", MEDIUM: "Средняя", LOW: "Низкая", UNKNOWN: "Не оценено" };

function EvidenceText({ value }: { value: CompetitorStatement }) {
  return <div className="competitor-top-statement"><p>{businessText(value.text)}</p>
    {value.evidence.length > 0 && <span className="competitor-top-citations">{value.evidence.filter(citation => businessSourceUrl(citation.url)).map((citation, index) =>
      <a key={`${citation.url}:${index}`} href={citation.url} target="_blank" rel="noreferrer" title={businessText(citation.quote)}>Источник {index + 1}</a>)}</span>}
  </div>;
}

export default function CompetitorTop({ analysis }: { analysis: OwnerCompetitorAnalysis }) {
  const research = analysis.research;
  if (!research) return null;
  const top = analysis.competitors.filter((item) => item.analysis).slice(0, 5);
  const coverage = research.coverage;
  return <section className="competitor-top" aria-label="Топ конкурентов">
    <header><div><h3>Топ-{top.length} конкурентов</h3>
      <p>Приоритет: общие покупатели → сопоставимое предложение → привлекательность → условия → продвижение.</p></div>
      <span>{coverage.target_met ? "Сравнение подготовлено" : "Найдено меньше пяти сопоставимых предложений"}</span>
    </header>
    {!coverage.target_met && <p className="competitor-top-gap">Исследование пока не подтвердило пять конкурентов. Непроверенные предложения не включены в топ; причины приведены ниже.</p>}
    <ol className="competitor-top-list">{top.map((item) => {
      const dossier = item.analysis!;
      return <li key={item.name}>
        <details className="competitor-top-card">
          <summary><b className="competitor-top-rank">{dossier.rank}</b>
            <span><strong>{item.name}</strong><small>{item.competitiveRelation === "DIRECT_COMPETITOR" ? "Прямой конкурент" : "Альтернатива для общего сегмента"}</small></span>
            <span className="competitor-top-segment">{businessText(dossier.buyer_segment.text)}</span>
            <span className="competitor-top-expand">Анализ <i>＋</i></span>
          </summary>
          <div className="competitor-top-analysis">
            <div className="competitor-top-overview">
              <section><h4>Предложение</h4><EvidenceText value={dossier.offer} /></section>
              <section><h4>Цена и условия</h4><EvidenceText value={dossier.terms} /></section>
              <section><h4>Путь к обращению</h4><EvidenceText value={dossier.funnel} /></section>
            </div>
            <h4>Почему такое место в топе</h4>
            <div className="competitor-top-criteria">{dossier.criteria.map((criterion) => <div key={criterion.criterion}>
              <strong>{criteria[criterion.criterion]}</strong><span data-level={criterion.level}>{levels[criterion.level]}</span>
              <EvidenceText value={{ text: criterion.explanation, evidence: criterion.evidence }} />
            </div>)}</div>
            <div className="competitor-top-conclusions">
              <section><h4>Подтверждённые сильные стороны</h4>{dossier.strengths.map((value, index) => <EvidenceText key={index} value={value} />)}</section>
              <section><h4>Ограничения и неизвестное</h4>{dossier.limitations.map((value, index) => <EvidenceText key={index} value={value} />)}</section>
              <section><h4>Что проверить в нашей рекламе</h4><small>Гипотезы на основе наблюдений</small>{dossier.strategy_implications.map((value, index) => <EvidenceText key={index} value={value} />)}</section>
            </div>
          </div>
        </details>
      </li>;
    })}</ol>
    <details className="competitor-top-audit"><summary>Охват поиска и причины исключения</summary>
      <p>Место в списке показывает приоритет для сравнения предложений. Рекламная эффективность этих компаний не установлена.</p>
      {coverage.unavailable_count > 0 && <p>Некоторые предложения проверить не удалось.</p>}
      {research.exclusions.length > 0 && <ul>{research.exclusions.map((item) => <li key={item.name}><strong>{item.name}</strong> — {businessText(item.reason)}</li>)}</ul>}
      <p><strong>Поисковые запросы:</strong> {research.searchQueries.join("; ")}</p>
    </details>
  </section>;
}

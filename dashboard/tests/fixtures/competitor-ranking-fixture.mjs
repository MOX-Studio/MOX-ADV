import { COMPETITOR_CRITERIA } from "../../lib/competitor-ranking.ts";

export function competitorDossier(name, sources, overrides = {}) {
  const source = sources.find((item) => item.competitor === name && item.text.includes("Участие со стендом для производителей"));
  const evidence = [{ url: source.url, quote: "Участие со стендом для производителей" }];
  const statement = (text) => ({ text, evidence });
  return {
    competitor: name,
    criteria: COMPETITOR_CRITERIA.map((criterion) => ({ criterion, level: overrides[criterion] ?? "MEDIUM", explanation: "Предложение относится к участию промышленных компаний", evidence })),
    buyer_segment: statement("Промышленные компании и производители"), offer: statement("Участие со стендом для производителей"),
    terms: { text: "Стоимость не опубликована", evidence: [] }, funnel: statement("На странице описано участие со стендом"),
    strengths: [statement("Предложение ориентировано на производителей")],
    limitations: [{ text: "Цена и условия следующего выпуска требуют уточнения", evidence: [] }],
    strategy_implications: [statement("Проверить сообщение для производителей, сравнивающих выставочные площадки")],
  };
}

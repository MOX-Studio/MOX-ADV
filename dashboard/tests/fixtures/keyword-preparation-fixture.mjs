import { KEYWORD_AXES, KEYWORD_PREPARATION_VERSION } from "../../lib/keyword-preparation.ts";
export function keywordResearchFixture(research, phrases = ["участие со стендом"]) {
  const finding = research.findings[0];
  return { version: KEYWORD_PREPARATION_VERSION, advertiser_role: "Изолированный пример владельца предложения",
    coverage: KEYWORD_AXES.map(axis => ({ axis, status: axis === "PRODUCT" ? "INVESTIGATED" : "NOT_APPLICABLE", family_ids: axis === "PRODUCT" ? ["KF1"] : [], explanation: "Узкий изолированный пример для проверки контракта; не исследование реального рынка." })),
    families: [{ id: "KF1", intent: "Участие компании", seeds: ["участие", "стенд"], finding_ids: [finding.id], conclusion: "Проверяется связь исследованного кандидата с фактическим ключом." }],
    candidates: phrases.map((phrase, i) => ({ id: `K${i + 1}`, family_id: "KF1", phrase, origin: "CURATED", finding_ids: [finding.id], evidence_refs: finding.evidence_refs, rationale: "Авторский вариант изолированного примера, частота не измерена." })),
    investigations: [{ id: "KI1", question: "Какие слова описывают предложение?", decision_impact: "Выбор группы", status: "COMPLETED", finding_ids: [finding.id], evidence_refs: finding.evidence_refs, conclusion: "Пример источника прочитан; внешнего исследования нет." }], stopping_reason: "Изолированный тест связности; не подтверждение полноты рынка.",
  };
}
export function keywordReviewFixture(research, portfolio) {
  const groups = portfolio.campaigns.filter(c => c.channel === "SEARCH").flatMap(c => c.groups.map(g => ({ campaign: c, group: g })));
  return { version: KEYWORD_PREPARATION_VERSION,
    decisions: research.keyword_research.candidates.map(candidate => {
      const actual = groups.find(({ group }) => group.keywords.some(k => k.phrase === candidate.phrase));
      return { candidate_id: candidate.id, disposition: actual ? "INCLUDED" : "EXCLUDED", group_id: actual?.group.id ?? null, keyword: actual ? candidate.phrase : null, coverage_basis: null, reason: "Изолированная проверка фактического выбора." };
    }),
    groups: groups.map(({ campaign, group }) => ({ group_id: group.id, keywords: group.keywords.map(k => k.phrase), campaign_negatives: campaign.negative_keywords, group_negatives: group.negative_keywords, landing_fit: "Страница содержит участие со стендом.", additional_value: "Намерение компании", autotargeting_review: "Целевые запросы проверяются отдельно по фактическим результатам.", examples: [{ query: group.keywords[0].phrase, keyword: group.keywords[0].phrase, desired: "ALLOW", basis: "LITERAL", negative: null, explanation: "Собственный положительный ключ без минусов." }], ignored_negatives: [] })),
    stopping_reason: "Проверен изолированный выбор, результатов трафика нет.",
  };
}

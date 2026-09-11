import { formArray, formEnum, formId, formIds, formObject, formRefs, formText, type FormationResearch, type FormationViolation } from "./campaign-formation-method.ts";
import type { FormationPortfolio } from "./campaign-formation-portfolio.ts";

export const KEYWORD_PREPARATION_VERSION = "keyword-preparation-v1";
export const KEYWORD_AXES = ["PRODUCT", "ACTION", "SYNONYMS", "PROFESSIONAL", "FORMATS", "BRAND", "CONTEXT"] as const;
export type KeywordResearch = {
  version: typeof KEYWORD_PREPARATION_VERSION;
  advertiser_role: string;
  coverage: Array<{ axis: typeof KEYWORD_AXES[number]; status: "INVESTIGATED" | "NOT_APPLICABLE"; family_ids: string[]; explanation: string }>;
  families: Array<{ id: string; intent: string; seeds: string[]; finding_ids: string[]; conclusion: string }>;
  candidates: Array<{ id: string; family_id: string; phrase: string; origin: "SOURCE_QUERY" | "SITE_LANGUAGE" | "CURATED"; finding_ids: string[]; evidence_refs: string[]; rationale: string }>;
  investigations: Array<{ id: string; question: string; decision_impact: string; status: "COMPLETED" | "UNAVAILABLE" | "NOT_DECISION_RELEVANT"; finding_ids: string[]; evidence_refs: string[]; conclusion: string }>;
  stopping_reason: string;
};
export type KeywordReview = {
  version: typeof KEYWORD_PREPARATION_VERSION;
  decisions: Array<{ candidate_id: string; disposition: "INCLUDED" | "COVERED" | "EXCLUDED" | "DEFERRED"; group_id: string | null; keyword: string | null; coverage_basis: "LITERAL" | "MORPHOLOGICAL" | "SEMANTIC_ASSUMPTION" | null; reason: string }>;
  groups: Array<{ group_id: string; keywords: string[]; campaign_negatives: string[]; group_negatives: string[]; landing_fit: string; additional_value: string; autotargeting_review: string;
    examples: Array<{ query: string; keyword: string; desired: "ALLOW" | "EXCLUDE"; basis: "LITERAL" | "AGENT_REVIEW"; negative: string | null; explanation: string }>;
    ignored_negatives: Array<{ keyword: string; negative: string; reason: string }> }>;
  stopping_reason: string;
};
const texts = (min = 0) => ({ ...formArray(formText(4096), null, min), uniqueItems: true });
const nullable = { type: ["string", "null"], minLength: 1, maxLength: 4096 };
export function keywordResearchSchema(refs: string[]) {
  return formObject({ version: formEnum([KEYWORD_PREPARATION_VERSION]), advertiser_role: formText(),
    coverage: formArray(formObject({ axis: formEnum(KEYWORD_AXES), status: formEnum(["INVESTIGATED", "NOT_APPLICABLE"]), family_ids: formIds(), explanation: formText() }), KEYWORD_AXES.length, KEYWORD_AXES.length),
    families: formArray(formObject({ id: formId(), intent: formText(), seeds: texts(1), finding_ids: formIds(null, 1), conclusion: formText() })),
    candidates: formArray(formObject({ id: formId(), family_id: formId(), phrase: formText(4096), origin: formEnum(["SOURCE_QUERY", "SITE_LANGUAGE", "CURATED"]), finding_ids: formIds(null, 1), evidence_refs: formRefs(refs), rationale: formText() })),
    investigations: formArray(formObject({ id: formId(), question: formText(), decision_impact: formText(), status: formEnum(["COMPLETED", "UNAVAILABLE", "NOT_DECISION_RELEVANT"]), finding_ids: formIds(), evidence_refs: formRefs(refs), conclusion: formText() }), null, 1),
    stopping_reason: formText(4000),
  });
}
export function keywordReviewSchema() {
  return formObject({ version: formEnum([KEYWORD_PREPARATION_VERSION]),
    decisions: formArray(formObject({ candidate_id: formId(), disposition: formEnum(["INCLUDED", "COVERED", "EXCLUDED", "DEFERRED"]), group_id: nullable, keyword: nullable, coverage_basis: { type: ["string", "null"], enum: ["LITERAL", "MORPHOLOGICAL", "SEMANTIC_ASSUMPTION", null] }, reason: formText() })),
    groups: formArray(formObject({ group_id: formId(), keywords: texts(1), campaign_negatives: texts(), group_negatives: texts(), landing_fit: formText(), additional_value: formText(), autotargeting_review: formText(),
      examples: formArray(formObject({ query: formText(4096), keyword: formText(4096), desired: formEnum(["ALLOW", "EXCLUDE"]), basis: formEnum(["LITERAL", "AGENT_REVIEW"]), negative: nullable, explanation: formText() }), null, 1),
      ignored_negatives: formArray(formObject({ keyword: formText(4096), negative: formText(4096), reason: formText() })),
    })), stopping_reason: formText(4000),
  });
}
export const keywordTokens = (value: string) => value.toLocaleLowerCase("ru-RU").replace(/ё/gu, "е").match(/[\p{L}\p{N}]+/gu) ?? [];
const operators = /[!+[\]"()|-]/u;
const identity = (value: string) => value.toLocaleLowerCase("ru-RU").replace(/ё/gu, "е").trim().replace(/\s+/gu, " ");
/** Conservative lexical checks only. Operators, inflection and semantic matching need separate review. */
export const keywordTargetIdentity = (value: string) => operators.test(value) ? identity(value) : [...new Set(keywordTokens(value))].sort().join(" ");
export function literalKeywordCoverage(keyword: string, query: string) {
  if (identity(keyword) === identity(query)) return true;
  if (operators.test(keyword) || operators.test(query)) return false;
  const terms = keywordTokens(keyword), target = new Set(keywordTokens(query));
  return terms.length > 0 && terms.every(word => target.has(word));
}
export function literalNegativeEffect(keyword: string, negative: string, query: string): "IGNORED_FULL_OVERLAP" | "EXCLUDES" | "UNRESOLVED" {
  if ([keyword, negative, query].some(value => operators.test(value))) return "UNRESOLVED";
  const terms = keywordTokens(negative), keys = new Set(keywordTokens(keyword)), request = new Set(keywordTokens(query));
  if (!terms.length) return "UNRESOLVED";
  if (terms.every(word => keys.has(word))) return "IGNORED_FULL_OVERLAP";
  return terms.every(word => request.has(word)) ? "EXCLUDES" : "UNRESOLVED";
}
const sameSet = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === a.length && a.every(v => b.includes(v));
export function verifyKeywordResearch(research: FormationResearch): FormationViolation[] {
  const r = research.keyword_research, issues: FormationViolation[] = [];
  const fail = (code: string, message: string) => issues.push({ code, pointer: "/research/keyword_research", message });
  if (!r) { fail("KEYWORD_RESEARCH_REQUIRED", "Нужны карта намерений, кандидаты фраз и результат их исследования."); return issues; }
  if (!sameSet(r.coverage.map(c => c.axis), [...KEYWORD_AXES])) fail("KEYWORD_AXIS_MISSING", "Нужно рассмотреть каждое направление расширения словаря.");
  const families = new Set(r.families.map(f => f.id)), findings = new Set(research.findings.map(f => f.id));
  if (families.size !== r.families.length || new Set(r.candidates.map(c => c.id)).size !== r.candidates.length || new Set(r.investigations.map(i => i.id)).size !== r.investigations.length) fail("KEYWORD_ID_DUPLICATE", "ID семейств, кандидатов и исследований должны быть уникальны.");
  for (const row of r.coverage) if (row.family_ids.some(id => !families.has(id)) || row.status === "INVESTIGATED" && !row.family_ids.length || row.status === "NOT_APPLICABLE" && row.family_ids.length) fail("KEYWORD_AXIS_COVERAGE_INVALID", `${row.axis}: нужны существующие семейства либо объяснение неприменимости.`);
  for (const family of r.families) if (!r.coverage.some(c => c.family_ids.includes(family.id)) || !r.candidates.some(c => c.family_id === family.id)) fail("KEYWORD_FAMILY_EMPTY", `${family.id}: семейство должно участвовать в карте и иметь рассмотренные фразы.`);
  for (const row of [...r.families, ...r.candidates, ...r.investigations]) if (row.finding_ids.some(id => !findings.has(id))) fail("KEYWORD_FINDING_UNKNOWN", "Фраза или исследование ссылается на неизвестный вывод.");
  const seen = new Set<string>();
  for (const candidate of r.candidates) {
    if (!families.has(candidate.family_id)) fail("KEYWORD_FAMILY_UNKNOWN", `${candidate.id}: неизвестное семейство.`);
    const key = identity(candidate.phrase);
    if (seen.has(key)) fail("KEYWORD_CANDIDATE_DUPLICATE", "Одна формулировка не должна искусственно увеличивать пул кандидатов.");
    seen.add(key);
    const support = candidate.finding_ids.flatMap(id => research.findings.find(f => f.id === id)?.evidence_refs ?? []);
    if (candidate.evidence_refs.some(ref => !support.includes(ref)) || candidate.origin !== "CURATED" && !candidate.evidence_refs.length) fail("KEYWORD_PROVENANCE_INVALID", `${candidate.id}: наблюдаемая формулировка требует связанного источника; авторская остаётся CURATED.`);
  }
  return issues;
}
export function verifyKeywordReview(research: FormationResearch, portfolio: FormationPortfolio): FormationViolation[] {
  const issues: FormationViolation[] = [], r = research.keyword_research, review = portfolio.keyword_review;
  const fail = (code: string, message: string) => issues.push({ code, pointer: "/keyword_review", message });
  if (!r || !review) { fail("KEYWORD_REVIEW_REQUIRED", "Нужны исследование и решение по каждому кандидату поисковой фразы."); return issues; }
  if (!sameSet(review.decisions.map(d => d.candidate_id), r.candidates.map(c => c.id))) fail("KEYWORD_DECISION_MISSING", "Каждый кандидат должен получить ровно одно решение.");
  const groups = portfolio.campaigns.filter(c => c.channel === "SEARCH").flatMap(c => c.groups.map(g => ({ campaign: c, group: g })));
  if (!sameSet(review.groups.map(g => g.group_id), groups.map(g => g.group.id))) fail("KEYWORD_GROUP_REVIEW_MISSING", "Проверьте фразы и минусы каждой поисковой группы.");
  for (const decision of review.decisions) {
    const candidate = r.candidates.find(c => c.id === decision.candidate_id);
    if (!candidate) continue;
    const target = groups.find(g => g.group.id === decision.group_id);
    if (["INCLUDED", "COVERED"].includes(decision.disposition)) {
      if (!target || !target.group.keywords.some(k => k.phrase === decision.keyword)) fail("KEYWORD_SELECTION_MISSING", `${candidate.id}: выбранная фраза должна существовать в указанной поисковой группе.`);
      if (decision.disposition === "INCLUDED" && (candidate.phrase !== decision.keyword || decision.coverage_basis !== null)) fail("KEYWORD_INCLUDED_CHANGED", `${candidate.id}: включение требует точной формулировки кандидата.`);
      if (decision.disposition === "COVERED" && (decision.coverage_basis === null || decision.coverage_basis === "SEMANTIC_ASSUMPTION")) fail("KEYWORD_COVERAGE_ASSUMED", `${candidate.id}: предположение о семантическом соответствии не доказывает покрытие.`);
      if (decision.disposition === "COVERED" && decision.coverage_basis === "LITERAL" && !literalKeywordCoverage(decision.keyword ?? "", candidate.phrase)) fail("KEYWORD_LITERAL_COVERAGE_INVALID", `${candidate.id}: буквальное покрытие выбранным ключом не подтверждено.`);
      if (decision.disposition === "COVERED" && target && [...target.campaign.negative_keywords, ...target.group.negative_keywords].some(n => literalNegativeEffect(decision.keyword ?? "", n, candidate.phrase) === "EXCLUDES")) fail("KEYWORD_COVERAGE_EXCLUDED", `${candidate.id}: минус-фраза исключает покрываемый запрос.`);
    } else if (decision.group_id !== null || decision.keyword !== null || decision.coverage_basis !== null) fail("KEYWORD_DISPOSITION_TARGET_INVALID", `${candidate.id}: исключённый или отложенный кандидат не является включённым ключом.`);
  }
  for (const { campaign, group } of groups) {
    for (const keyword of group.keywords) if (!review.decisions.some(d => d.disposition === "INCLUDED" && d.group_id === group.id && d.keyword === keyword.phrase)) fail("KEYWORD_UNRESEARCHED_SELECTION", `${group.id}: выбранная фраза отсутствует в исследовании.`);
    if (campaign.autotargeting !== "TARGETED") fail("SEARCH_AUTOTARGETING_REQUIRED", "Для нового поискового профиля ЕПК нужна как минимум одна категория автотаргетинга.");
    const row = review.groups.find(g => g.group_id === group.id);
    if (!row) continue;
    if (!sameSet(row.keywords, group.keywords.map(k => k.phrase)) || !sameSet(row.campaign_negatives, campaign.negative_keywords) || !sameSet(row.group_negatives, group.negative_keywords)) fail("KEYWORD_REVIEW_STALE", `${group.id}: фразы или минусы изменились после проверки.`);
    const negatives = [...new Set([...campaign.negative_keywords, ...group.negative_keywords])];
    const ignored = group.keywords.flatMap(k => negatives.filter(n => literalNegativeEffect(k.phrase, n, k.phrase) === "IGNORED_FULL_OVERLAP").map(n => `${k.phrase}\n${n}`));
    if (!sameSet(row.ignored_negatives.map(n => `${n.keyword}\n${n.negative}`), ignored)) fail("IGNORED_NEGATIVE_UNREVIEWED", `${group.id}: объясните каждое полное пересечение минуса с ключом — такой минус игнорируется.`);
    if (!row.examples.some(e => e.desired === "ALLOW") || negatives.length > 0 && !row.examples.some(e => e.desired === "EXCLUDE")) fail("KEYWORD_EXAMPLES_MISSING", `${group.id}: нужны примеры целевого и, при наличии минусов, нежелательного запроса.`);
    for (const example of row.examples) {
      if (!group.keywords.some(k => k.phrase === example.keyword) || example.negative !== null && !negatives.includes(example.negative)) fail("KEYWORD_EXAMPLE_TARGET_INVALID", `${group.id}: пример должен ссылаться на реальные ключ и минус.`);
      if (example.desired === "ALLOW" && negatives.some(n => literalNegativeEffect(example.keyword, n, example.query) === "EXCLUDES")) fail("DESIRED_QUERY_EXCLUDED", `${group.id}: нужный пример исключается действующим минусом.`);
      if (example.desired === "EXCLUDE" && (!example.negative || literalNegativeEffect(example.keyword, example.negative, example.query) === "IGNORED_FULL_OVERLAP" || example.basis === "LITERAL" && literalNegativeEffect(example.keyword, example.negative, example.query) !== "EXCLUDES")) fail("NEGATIVE_EXAMPLE_INEFFECTIVE", `${group.id}: указанный минус не подтверждает исключение примера.`);
      if (example.basis === "LITERAL" && !literalKeywordCoverage(example.keyword, example.query)) fail("KEYWORD_EXAMPLE_MATCH_INVALID", `${group.id}: пример не имеет заявленного буквального соответствия.`);
    }
  }
  return issues;
}
export function keywordPreparationInstructions() {
  return { version: KEYWORD_PREPARATION_VERSION,
    objective: "Expand and select commercially relevant search expressions that can contribute to the exact owner Goal. The candidate pool and activated keys are different. There is no target count, minimum expansion percentage or frequency prerequisite for a useful curated candidate.",
    research: "Output research.keyword_research. Establish advertiser role and brand relation. Review product, action, synonyms, professional vocabulary, formats, own brand and meaningful geography/calendar. Create natural expressions both within existing intents and across missing lexical families. Use applicable query history, Wordstat nested/related queries and the actual offer. Link all candidates to findings. SOURCE_QUERY means the exact phrase is present in the cited source; SITE_LANGUAGE is exact site wording; combinations/rewording are CURATED even when source-grounded. Curated is not observed. Preserve unavailable sources and scope. Candidates discovered downstream require a research return and a fresh saved input.",
    strategy: "Compare funding the useful keyword families, including own-brand versus incremental category demand. Choose groups by intent, offer and landing, not synonyms alone. Do not confuse a low measured subset, no rows or unavailable auction forecast with absence of demand or a measured budget optimum.",
    campaigns: "Output keyword_review with one disposition per researched candidate and an INCLUDED row for each actual key. COVERED requires the specific selected key and LITERAL or justified MORPHOLOGICAL coverage; a semantic-match assumption alone cannot remove a material synonym. EXCLUDED and DEFERRED require their business reason. Each search group freezes its actual keys and both negative scopes, landing fit, incremental value and a separate autotargeting review. Review useful and unwanted query examples; list every ignored full-overlap negative with its reason. Local literal checks are bounded: AGENT_REVIEW remains a reasoned judgment, not a provider simulation. Operators, morphology and semantic reach require appropriate review. Never manufacture frequency, CPC, conversion, reach or probability.",
    completion: "Read all material families and exclusions, resolve decision-changing gaps through available reads, then explain diminishing decision value. Broader candidate generation does not itself improve performance. After authorized traffic, use actual search queries with costs and the exact qualified outcome, duplicate rules and dates to revise selection; clicks/form submits alone are proxies. No automatic publication or spend authority.",
    platform_reference: "https://yandex.ru/support/direct/ru/keywords/negative-keywords",
  };
}

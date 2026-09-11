import { formArray, formEnum, formId, formIds, formObject, formRefs, formText, type FormationPlan, type FormationResearch, type FormationViolation } from "./campaign-formation-method.ts";

export const CAMPAIGN_OPPORTUNITY_AXES = ["BUYERS", "INTENTS", "OFFER_ANGLES", "CHANNELS", "GEOGRAPHY_AND_TIMING", "FIRST_PARTY_HISTORY"] as const;
export const CAMPAIGN_DECISION_METRICS = ["QUALIFIED_DEMAND", "CPC", "QUALIFICATION", "SEASONALITY", "ATTRIBUTION_AND_DELAY", "OFFER_PROOF", "OTHER"] as const;
export type CampaignOpportunitySearch = {
  axes: Array<{ axis: typeof CAMPAIGN_OPPORTUNITY_AXES[number]; status: "RESEARCHED" | "NOT_APPLICABLE" | "UNAVAILABLE"; finding_ids: string[]; candidate_ids: string[]; conclusion: string }>;
  candidates: Array<{ id: string; name: string; audience: string; intent: string; offer: string; channel: "SEARCH" | "NETWORK" | "RETARGETING"; mechanism: string; added_value: string;
    disposition: "SELECTED" | "DEFERRED" | "EXCLUDED"; direction_id: string | null; reason: string; evidence_refs: string[]; viability?: { status: "VIABLE" | "NEEDS_EVIDENCE" | "NOT_VIABLE"; contribution: "QUALIFIED_REACH" | "PERSUASION" | "LOWER_COST" | "RESILIENCE" | "NONE"; overlap_with: string[]; overlap_resolution: string; budget_and_deadline: string; evidence_refs: string[] } }>;
  investigations: Array<{ id: string; metric: typeof CAMPAIGN_DECISION_METRICS[number]; question: string; decision_impact: string; material: boolean;
    status: "RESOLVED" | "UNAVAILABLE" | "LOW_DECISION_VALUE" | "OPEN"; candidate_ids: string[]; evidence_refs: string[]; outcome: string; next_action: string }>;
  continuation: { first_candidate_id: string; considered_after_first: string[]; additional_value: string; stopping_reason: string; single_campaign_reason: string | null };
};

export function campaignOpportunitySearchSchema(refs: string[], viabilityRequired = false) {
  return formObject({
    axes: formArray(formObject({ axis: formEnum(CAMPAIGN_OPPORTUNITY_AXES), status: formEnum(["RESEARCHED", "NOT_APPLICABLE", "UNAVAILABLE"]), finding_ids: formIds(), candidate_ids: formIds(), conclusion: formText() }), CAMPAIGN_OPPORTUNITY_AXES.length, CAMPAIGN_OPPORTUNITY_AXES.length),
    candidates: formArray(formObject({ id: formId(), name: formText(255), audience: formText(), intent: formText(), offer: formText(), channel: formEnum(["SEARCH", "NETWORK", "RETARGETING"]), mechanism: formText(), added_value: formText(),
      disposition: formEnum(["SELECTED", "DEFERRED", "EXCLUDED"]), direction_id: { type: ["string", "null"], maxLength: 100 }, reason: formText(), evidence_refs: formRefs(refs), ...(viabilityRequired ? { viability: formObject({ status: formEnum(["VIABLE", "NEEDS_EVIDENCE", "NOT_VIABLE"]), contribution: formEnum(["QUALIFIED_REACH", "PERSUASION", "LOWER_COST", "RESILIENCE", "NONE"]), overlap_with: formIds(), overlap_resolution: formText(), budget_and_deadline: formText(), evidence_refs: formRefs(refs) }) } : {}) }), null, 1),
    investigations: formArray(formObject({ id: formId(), metric: formEnum(CAMPAIGN_DECISION_METRICS), question: formText(), decision_impact: formText(), material: { type: "boolean" },
      status: formEnum(["RESOLVED", "UNAVAILABLE", "LOW_DECISION_VALUE", "OPEN"]), candidate_ids: formIds(null, 1), evidence_refs: formRefs(refs), outcome: formText(), next_action: formText() }), null),
    continuation: formObject({ first_candidate_id: formId(), considered_after_first: formIds(), additional_value: formText(), stopping_reason: formText(4000), single_campaign_reason: { type: ["string", "null"], minLength: 1, maxLength: 2000 } }),
  });
}
const normalized = (s: string) => s.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/ё/gu, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const sameIds = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === a.length && b.every(id => a.includes(id));

/** Records coverage and executable decisions. The controlling Codex investigates and chooses the portfolio. */
export function verifyCampaignOpportunitySearch(search: CampaignOpportunitySearch, plan: FormationPlan, research: FormationResearch, viabilityRequired = false) {
  const violations: FormationViolation[] = [];
  const add = (code: string, message: string) => violations.push({ code, pointer: "/formation_plan/goal_preparation/portfolio_search", message });
  const ids = search.candidates.map(c => c.id), directions = plan.directions.map(d => d.id), findingIds = research.findings.map(f => f.id);
  if (new Set(ids).size !== ids.length || new Set(search.investigations.map(i => i.id)).size !== search.investigations.length) add("OPPORTUNITY_ID_DUPLICATE", "Возможности кампаний и исследования должны иметь уникальные идентификаторы.");
  if (!sameIds(search.axes.map(a => a.axis), [...CAMPAIGN_OPPORTUNITY_AXES])) add("OPPORTUNITY_SEARCH_INCOMPLETE", "Проверьте покупателей, намерения, предложения, каналы, географию и сроки, собственную историю.");
  for (const axis of search.axes) {
    if (axis.candidate_ids.some(id => !ids.includes(id)) || axis.finding_ids.some(id => !findingIds.includes(id))) add("OPPORTUNITY_REFERENCE_UNKNOWN", "Область поиска должна ссылаться на существующие выводы и варианты.");
    if (axis.status === "RESEARCHED" && !axis.finding_ids.length) add("OPPORTUNITY_FINDING_MISSING", "Проведённое исследование должно иметь зафиксированные выводы.");
  }
  if (ids.some(id => !search.axes.some(a => a.candidate_ids.includes(id)))) add("OPPORTUNITY_UNACCOUNTED", "Каждый вариант должен быть учтён в поиске возможностей.");
  const selected = search.candidates.filter(c => c.disposition === "SELECTED");
  if (!sameIds(selected.map(c => c.direction_id ?? ""), directions)) add("OPPORTUNITY_SELECTED_NOT_IMPLEMENTED", "Все выбранные сильные варианты должны стать направлениями стратегии; каждое направление должно иметь выбранный вариант.");
  for (const candidate of search.candidates) {
    if (viabilityRequired) {
      const viability = candidate.viability;
      if (!viability || viability.overlap_with.some(id => id === candidate.id || !ids.includes(id))) add("OPPORTUNITY_VIABILITY_MISSING", "Оцените жизнеспособность и пересечения каждого варианта с остальным портфелем.");
      if (viability && candidate.disposition === "SELECTED" && (viability.status !== "VIABLE" || viability.contribution === "NONE" || !viability.evidence_refs.length)) add("OPPORTUNITY_NOT_VIABLE", "Выбранная кампания должна иметь подтверждённый механизм, дополнительную пользу и обоснование в бюджете и сроке цели.");
      if (viability?.status === "VIABLE" && viability.contribution !== "NONE" && candidate.disposition !== "SELECTED") add("OPPORTUNITY_USEFUL_CANDIDATE_OMITTED", "Жизнеспособный вариант с дополнительной пользой должен быть включён. Если он дублирует портфель или мешает цели, исправьте оценку вклада с обоснованием.");
    }
    if (candidate.disposition === "SELECTED") {
      const direction = plan.directions.find(d => d.id === candidate.direction_id);
      if (!candidate.evidence_refs.length) add("OPPORTUNITY_EVIDENCE_MISSING", "Выбранный вариант требует основания в собранных материалах.");
      if (direction && (candidate.channel !== direction.channel || candidate.audience !== direction.audience || candidate.intent !== direction.intent || candidate.offer !== direction.offer)) add("OPPORTUNITY_DIRECTION_CHANGED", "Выбранные аудитория, намерение, предложение и канал должны перейти в кампанию без подмены.");
    } else if (candidate.direction_id !== null) add("OPPORTUNITY_REJECTED_IMPLEMENTED", "Отложенный или исключённый вариант не должен занимать место выбранной кампании.");
  }
  const signatures = search.candidates.map(c => normalized([c.channel, c.audience, c.intent, c.offer, c.mechanism].join(" ")));
  if (new Set(signatures).size !== signatures.length) add("OPPORTUNITY_DUPLICATED", "Переименование одного подхода не создаёт другую сильную кампанию.");
  const continuation = search.continuation;
  if (!ids.includes(continuation.first_candidate_id) || !sameIds(continuation.considered_after_first, ids.filter(id => id !== continuation.first_candidate_id))) add("OPPORTUNITY_CONTINUATION_MISSING", "После первого варианта рассмотрите остальные перспективные кампании и зафиксируйте результат поиска.");
  if (selected.length === 1 && !continuation.single_campaign_reason?.trim()) add("OPPORTUNITY_SINGLE_CAMPAIGN_UNJUSTIFIED", "Объясните, почему после дополнительного поиска одна кампания лучше набора кампаний при данных целях и бюджете.");
  for (const investigation of search.investigations) {
    if (investigation.candidate_ids.some(id => !ids.includes(id))) add("OPPORTUNITY_INVESTIGATION_UNKNOWN", "Исследование должно относиться к существующему варианту.");
    if (investigation.status === "RESOLVED" && !investigation.evidence_refs.length) add("OPPORTUNITY_RESEARCH_EVIDENCE_MISSING", "Закрытый исследовательский вопрос требует источника ответа.");
    if (investigation.material && (investigation.status === "OPEN" || investigation.status === "LOW_DECISION_VALUE")) add("OPPORTUNITY_MATERIAL_RESEARCH_OPEN", "Сначала разрешите вопрос, который меняет существенное решение. Недоступность источника фиксируется отдельно.");
  }
  return violations;
}

export function portfolioSearchInstructions() {
  return {
    ownership: "The human completes Goal; one controlling Codex independently completes Evidence, Strategy and Campaigns. The deliverable is a strong portfolio of local campaign templates for later owner publication. No provider creation, launch, spend or post-launch operation is part of this task.",
    breadth: "Do not stop after the first valid campaign. Investigate additional material buyer segments, intents, offer angles, channels, geography/calendar opportunities and first-party history. There is no total limit or target count for campaigns, groups or ads. Retain every viable opportunity with positive incremental value; one or a thousand is immaterial. Produce complementary strong campaigns where they add qualified reach or persuasion under the same budget. A different name or duplicate keyword set is not another opportunity. One campaign is acceptable only after the broader search shows why more campaigns would not improve the result.",
    evidence: "Choose additional metrics and research by decision impact: relevant demand, CPC, qualification rate, seasonality, unique versus overlapping outcomes and time to qualification before the deadline, offer proof and objections. Record the question, affected campaign choices, source answer or actual access limitation. Use the existing source tools and permitted APIs; collect additional evidence before using it. Avoid exhaustive low-value collection and never fabricate favorable metrics.",
    portfolio: "Account for every candidate as selected, deferred or excluded. Implement every selected opportunity as an actual direction and campaign, with its own value and budget justification. A selected overall approach may contain several campaigns; it does not mean choose only one campaign. For each candidate assess viability of intent, offer, landing, reachable demand, budget and deadline, identify overlaps with the other candidates and explain their treatment. Viability is a sourced mechanism, not proof of goal attainment. Exclude redundant or damaging additions with their business reason; do not omit a viable additive candidate to obey a count or token quota. Each ad must also explain its additional persuasion or qualified reach and overlap. Record what was considered after the first candidate and why further search would not materially improve this portfolio. Small budget or absent campaign history alone is not a limit of one template; evaluate concentration versus distinct reach without multiplying the shared budget.",
    creation: "Inspect existing Direct campaign structures through the API and current official create-field contracts. Consider multiple ads per group, sitelinks, callouts, images, attribution, exclusions and audience dependencies. Every new ad includes an explicit extensions decision: provide relevant grounded sitelinks and callouts or explain why they add no supported value. Link only to verified own-site pages or verified sections. Preserve the complete template extensions for later mapping to SitelinksSets/AdExtensions; do not copy read IDs, irrelevant service links, unknown audience exclusions or unrelated claims. This prepares local templates; it never creates provider objects.",
    joint_goal: "Evaluate quantity of unique qualified results obtained by the deadline, total shared spending jointly within the owner total budget. Subtract expected duplicate outcomes across campaigns and allow for qualification delays. Leave an unknown overlap or deadline factor unknown. Do not count the same audience opportunity or delayed results twice. Distinguish an initial-period contribution from coverage of the complete goal.",
  };
}

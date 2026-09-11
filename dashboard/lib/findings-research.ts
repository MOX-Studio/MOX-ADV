import { goalResultCostCeiling, goalTotalBudgetRub, type GoalRevision } from "./goal-revision.ts";

export const FINDINGS_POLICY = "p0-findings-research-v1";
export const FINDINGS_AREAS = ["company", "product", "buyer", "demand", "competitors", "economics", "marketing", "measurement"] as const;
export type FindingsArea = typeof FINDINGS_AREAS[number];
/** Exact extraction contract; legacy business-model predicates are handled separately below. */
export const BUSINESS_RESEARCH_FIELDS: Record<FindingsArea, readonly string[]> = {
  company: ["company_capabilities"],
  product: ["product", "value_proposition", "offer_terms"],
  buyer: ["buyer_roles", "customer_jobs", "choice_criteria", "objections"],
  demand: ["seasonality"], competitors: [],
  economics: ["average_sale_value_rub", "gross_margin_percent", "lead_to_sale_percent", "capacity", "sales_cycle"],
  marketing: ["sales_process", "conversion_path"], measurement: [],
};
export type FindingState = "SUPPORTED" | "INDICATIVE" | "UNKNOWN" | "CONFLICT" | "STALE";
export type ResearchQuestion = { id: string; area: FindingsArea; question: string; decisions: string[]; terms: string[] };
export const RESEARCH_QUESTIONS: ResearchQuestion[] = [
  { id: "company", area: "company", question: "Кто продаёт, чем подтверждены компетенции и какие ограничения исполнения?", decisions: ["advertised_offer", "core_message", "weekly_budget"], terms: ["about", "company", "partner", "компан", "о-нас", "кейс", "возможност"] },
  { id: "product", area: "product", question: "Что входит в предложение, каковы условия и доказанная польза для покупателя в период цели?", decisions: ["campaign_focus", "advertised_offer", "core_message", "landing_page"], terms: ["product", "service", "particip", "price", "tariff", "услов", "участ", "продукт", "цен", "каталог"] },
  { id: "buyer", area: "buyer", question: "Кто покупает, зачем, кто принимает решение, каковы критерии выбора и возражения?", decisions: ["target_audience", "exclusions", "core_message"], terms: ["customer", "client", "faq", "case", "клиент", "вопрос", "отзыв", "экспонент"] },
  { id: "demand", area: "demand", question: "Какие целевые намерения наблюдаются в нужной географии и как меняются по сезонам?", decisions: ["geography", "period", "campaign_focus", "weekly_budget"], terms: ["market", "industry", "рынок", "отрасл", "статист"] },
  { id: "competitors", area: "competitors", question: "Какие предложения решают ту же задачу покупателя и по каким критериям отличаются от нашего?", decisions: ["advertised_offer", "target_audience", "core_message"], terms: ["alternative", "compare", "сравнен", "альтернатив"] },
  { id: "economics", area: "economics", question: "Каковы экономика продажи, конверсия квалифицированного обращения и предел мощности?", decisions: ["target_result_cost", "weekly_budget", "period"], terms: ["price", "terms", "стоим", "цен", "услов", "оплат"] },
  { id: "marketing", area: "marketing", question: "Какие результаты измерены ранее и что мешает пройти путь от объявления до продажи?", decisions: ["landing_page", "core_message", "campaign_focus"], terms: ["contact", "application", "register", "контакт", "заявк", "регистра"] },
  { id: "measurement", area: "measurement", question: "Как проверить квалификацию, уникальность и связь обращения с рекламой и продажей?", decisions: ["qualified_result", "target_result_cost"], terms: ["crm", "аналитик", "измерен"] },
];
export type FindingsResearchPlan = {
  schema_version: typeof FINDINGS_POLICY;
  goal: { revision_id: string; digest: string; desired_outcome: string; qualified_action: string; geography: string; deadline: string; owner_cost_limit: number | null; total_budget_rub?: number | null };
  questions: ResearchQuestion[];
  limits: { max_rounds: number | null; max_pages: number | null; max_elapsed_ms: number | null };
};
export function buildFindingsResearchPlan(goal: GoalRevision): FindingsResearchPlan {
  if (!goal.customer_geography || !goal.success_criterion) throw new Error("FINDINGS_GOAL_INCOMPLETE: Требуется полная Цель.");
  return { schema_version: FINDINGS_POLICY, goal: { revision_id: goal.goal_revision_id, digest: goal.digest,
    desired_outcome: goal.desired_outcome, qualified_action: goal.qualified_action, geography: goal.customer_geography,
    deadline: goal.success_criterion.deadline, owner_cost_limit: goalResultCostCeiling(goal.success_criterion), ...(goalTotalBudgetRub(goal.success_criterion) !== null ? { total_budget_rub: goalTotalBudgetRub(goal.success_criterion) } : {}) },
    questions: structuredClone(RESEARCH_QUESTIONS), limits: { max_rounds: null, max_pages: null, max_elapsed_ms: null } };
}

export type BusinessResearchObservation = { area: FindingsArea; field: string; value: string; source_url: string; quote: string;
  applicability: "CURRENT" | "UNKNOWN" | "OUT_OF_SCOPE"; limitation: string };
export type BusinessResearchResult = { schema_version: typeof FINDINGS_POLICY; plan: FindingsResearchPlan;
  supporting_materials?: Array<{ id: string; kind: "RESEARCH_SUMMARY" | "OFFICIAL_OBSERVATIONS"; label: string; source_urls: string[]; observed_at: string; content: Record<string, unknown> }>;
  sources: Array<{ url: string; text: string }>;
  observations: BusinessResearchObservation[]; attempts: Array<{ round: number; questions: string[]; urls: string[]; outcome: string }>;
  gaps: Array<{ area: FindingsArea; question: string; reason: string; next_action: string }>; observed_at: string; completion_reason?: string };

export type FindingFact = { id: string; field: string; value: string; state: FindingState; sources: string[]; evidence_refs: string[]; limitation: string };
export type FindingsSection = { id: FindingsArea; title: string; summary: string; state: FindingState; facts: FindingFact[]; gaps: string[]; decisions: string[] };
export type FindingsDecisionSupport = { decision: string; status: "SUPPORTED" | "HYPOTHESIS" | "NEEDS_RESEARCH"; evidence_refs: string[]; limitations: string[] };
export type FindingsReport = { schema_version: typeof FINDINGS_POLICY; snapshot_id: string; goal_revision_id: string;
  collected_at: string; summary: string; sections: FindingsSection[]; decisions: FindingsDecisionSupport[];
  next_action: string; limitations: string[]; attempts: BusinessResearchResult["attempts"] };
type Data = Record<string, unknown>;
const obj = (v: unknown): Data => v && typeof v === "object" && !Array.isArray(v) ? v as Data : {};
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const txt = (v: unknown): string => v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v).trim();
const strings = (v: unknown) => arr(v).map(txt).filter(Boolean);
const unique = (v: string[]) => [...new Set(v.filter(Boolean))];
const TITLES: Record<FindingsArea, string> = { company: "Компания", product: "Продукт и предложение", buyer: "Покупатели", demand: "Рынок и спрос",
  competitors: "Конкуренты", economics: "Экономика", marketing: "Маркетинг и продажи", measurement: "Измерение результата" };
const FIELDS: Record<FindingsArea, string[]> = {
  company: ["company", "brand", "capabilities", "company_capabilities", "revenue_model", "key_constraints"],
  product: ["product", "offer", "advertised_offer", "value", "value_proposition", "offer_terms", "price"],
  buyer: ["audience", "target_audience", "customer_context", "buying_context", "buyer_roles", "customer_jobs", "choice_criteria", "objections", "exclusions"],
  demand: ["seasonality", "market_context"], competitors: [],
  economics: ["average_sale_value_rub", "gross_margin_percent", "lead_to_sale_percent", "capacity", "sales_cycle"],
  marketing: ["landing_page", "conversion_path", "sales_process"], measurement: ["qualified_outcome", "qualified_result", "measurement", "crm_qualification"],
};

export function claimFindingState(claim: Data, records: Data[], asOf = ""): FindingState {
  const confidence = obj(claim.confidence);
  if (["conflicted", "scope_mismatch"].includes(txt(confidence.consistency))) return "CONFLICT";
  if (confidence.freshness === "stale") return "STALE";
  if (claim.value == null || txt(claim.value) === "" || claim.classification === "unknown" || confidence.tier === "BLOCKED_UNKNOWN" || !records.length) return "UNKNOWN";
  // An old event edition in an offer cannot become current because its page was fetched today.
  if (["product", "offer", "value", "advertised_offer", "value_proposition"].includes(txt(claim.predicate))) {
    const years = txt(claim.value).match(/\b20\d{2}\b/gu)?.map(Number) ?? [];
    if (years.length && asOf && Math.max(...years) < Number(asOf.slice(0, 4))) return "STALE";
  }
  if (["TIER_1_VERIFIED", "TIER_2_CORROBORATED"].includes(txt(confidence.tier)) && confidence.freshness === "current") return "SUPPORTED";
  return "INDICATIVE";
}

/** One read-only interpretation for both the Strategy Agent and the Dashboard; legacy snapshots are never upgraded in place. */
export function buildFindingsReport(input: unknown): FindingsReport {
  const snapshot = obj(input), goal = obj(snapshot.goal_context), research = obj(snapshot.business_research);
  const evidence = arr(snapshot.evidence).map(obj), claims = arr(snapshot.claims).map(obj);
  const sourceUrls = (records: Data[]) => unique(records.flatMap(r => [txt(r.source_url), txt(obj(r.source_locator).url), ...strings(obj(r.normalized).source_urls)]).filter(v => /^https:\/\//u.test(v)));
  const byArea = Object.fromEntries(FINDINGS_AREAS.map(area => [area, [] as FindingFact[]])) as Record<FindingsArea, FindingFact[]>;
  for (const claim of claims.filter(c => c.subject === "business_model")) {
    const refs = strings(claim.evidence_ids), records = evidence.filter(e => refs.includes(txt(e.evidence_id)));
    for (const area of FINDINGS_AREAS.filter(a => FIELDS[a].includes(txt(claim.predicate)))) byArea[area].push({
      id: txt(claim.claim_id), field: txt(claim.predicate), value: txt(claim.value), state: claimFindingState(claim, records, txt(snapshot.as_of)),
      sources: sourceUrls(records), evidence_refs: refs, limitation: strings(obj(claim.confidence).uncertainty).join("; "),
    });
  }
  for (const raw of arr(research.observations)) {
    const item = obj(raw), area = txt(item.area) as FindingsArea;
    if (!FINDINGS_AREAS.includes(area) || !txt(item.quote) || !txt(item.source_url)) continue;
    // The extraction proves what the source says, not customers' actual buying behaviour.
    const datedYears = ["product", "advertised_offer", "value_proposition", "offer_terms"].includes(txt(item.field)) ? txt(item.value).match(/\b20\d{2}\b/gu)?.map(Number) ?? [] : [];
    const expiredEdition = datedYears.length > 0 && Math.max(...datedYears) < Number(txt(snapshot.as_of).slice(0, 4));
    byArea[area].push({ id: `research:${area}:${byArea[area].length}`, field: txt(item.field), value: txt(item.value),
      state: item.applicability === "OUT_OF_SCOPE" || expiredEdition ? "STALE" : item.applicability === "UNKNOWN" ? "UNKNOWN" : "INDICATIVE", sources: [txt(item.source_url)],
      evidence_refs: [txt(snapshot.snapshot_id)], limitation: txt(item.limitation) || "Опубликованные сведения; поведение покупателей требует отдельной проверки." });
  }
  if (txt(goal.qualified_action)) byArea.measurement.unshift({ id: "goal:qualified_action", field: "qualified_action", value: txt(goal.qualified_action),
    state: "SUPPORTED", sources: [], evidence_refs: [txt(goal.goal_revision_id)], limitation: "Определение владельца; настройка измерения проверяется отдельно." });
  const history = obj(snapshot.first_party_history), market = obj(snapshot.market_evidence), frequency = obj(market.frequency);
  const observed = (area: FindingsArea, field: string, value: string, state: FindingState, limitation: string) => byArea[area].push({
    id: `${area}:${field}`, field, value, state, sources: [], evidence_refs: [txt(snapshot.snapshot_id)], limitation,
  });
  const ranks = arr(obj(snapshot.competitor_research).ranking ? obj(obj(snapshot.competitor_research).ranking).candidates : obj(snapshot.competitor_ranking).candidates).map(obj);
  const matrix = obj(snapshot.competitor_matrix);
  const competitorNames = unique(ranks.map(r => txt(r.competitor)).filter(Boolean));
  if (!competitorNames.length) competitorNames.push(...arr(matrix.rows).map(obj).filter(r => r.observation_status === "OBSERVED" && ["DIRECT_COMPETITOR", "SUBSTITUTE_COMPETITOR"].includes(txt(r.competitive_relation))).map(r => txt(r.competitor)));
  if (competitorNames.length) observed("competitors", "comparison", competitorNames.slice(0, 5).join(" · "), "INDICATIVE", "Сопоставимость зависит от сегмента; публичные предложения не доказывают эффективность рекламы.");
  if (frequency.status === "AVAILABLE" || frequency.status === "PARTIAL") observed("demand", "search_interest", "Получены наблюдения поискового интереса", "INDICATIVE", "Частоты относятся к запросам, региону и периоду; пересечения фраз не дают уникальный объём покупателей.");
  if (["AVAILABLE", "PARTIAL"].includes(txt(history.status))) observed("marketing", "history", "История рекламы и наблюдаемых конверсий доступна", "INDICATIVE", "Квалификация, зрелость результата и сопоставимость проверяются отдельно.");
  const pages = evidence.filter(e => txt(e.source_kind).includes("first_party") || e.source_id === "first-party-web");
  if (pages.length && !byArea.marketing.length) observed("marketing", "landing", "Посадочные страницы исследованы", "INDICATIVE", "Наличие формы не доказывает успешную обработку обращения и продажу.");
  const gaps = arr(research.gaps).map(obj);
  const sections = FINDINGS_AREAS.map((area): FindingsSection => {
    const facts = byArea[area], useful = facts.filter(f => ["SUPPORTED", "INDICATIVE"].includes(f.state));
    const externalCovered = ["demand", "competitors", "marketing"].includes(area) && useful.some(f => ["search_interest", "comparison", "history"].includes(f.field));
    const missing = unique(gaps.filter(g => g.area === area && !externalCovered).map(g => txt(g.question) + (txt(g.reason) ? ` ${txt(g.reason)}` : "")));
    if (!useful.length) missing.push(RESEARCH_QUESTIONS.find(q => q.area === area)!.question);
    const requireAny = (names: string[], question: string) => { if (!useful.some(f => names.includes(f.field))) missing.push(question); };
    if (area === "company") requireAny(["capabilities", "company_capabilities"], "Какие возможности и ограничения компании подтверждены?");
    if (area === "product") {
      requireAny(["product", "offer", "advertised_offer"], "Какое предложение актуально для периода цели?");
      requireAny(["offer_terms"], "Каковы состав и условия покупки?");
      requireAny(["value", "value_proposition"], "Чем подтверждена ценность для покупателя?");
    }
    if (area === "buyer") {
      requireAny(["buyer_roles", "buying_context"], "Кто покупает и участвует в принятии решения?");
      requireAny(["customer_jobs"], "Какие задачи покупателя подтверждены?");
      requireAny(["choice_criteria"], "Каковы критерии выбора?");
      requireAny(["objections"], "Каковы возражения и причины отказа?");
    }
    if (area === "measurement" && !facts.some(f => f.field === "crm_qualification" && f.state === "SUPPORTED")) missing.push("Связь рекламы с квалифицированным обращением и продажей не подтверждена.");
    if (area === "economics") for (const field of ["average_sale_value_rub", "gross_margin_percent", "lead_to_sale_percent", "capacity"]) if (!facts.some(f => f.field === field && f.state === "SUPPORTED")) missing.push(`Требуется подтверждение: ${field}.`);
    const state: FindingState = facts.some(f => f.state === "CONFLICT") ? "CONFLICT" : useful.length ? missing.length || useful.some(f => f.state !== "SUPPORTED") ? "INDICATIVE" : "SUPPORTED" : facts.some(f => f.state === "STALE") ? "STALE" : "UNKNOWN";
    const preferred = area === "buyer" ? useful.filter(f => ["buyer_roles", "buying_context", "customer_jobs"].includes(f.field)) : useful;
    let summary = unique((preferred.length ? preferred : useful).map(f => f.value)).slice(0, 1).join(" · ") || (state === "STALE" ? "Найдены сведения другого периода" : "Данных пока недостаточно");
    if (area === "buyer" && !preferred.length && useful.length) summary = "Профиль покупателя требует уточнения";
    if (area === "measurement") summary = facts.some(f => f.field === "crm_qualification" && f.state === "SUPPORTED") ? "Есть сведения о квалификации обращений" : "Связь рекламы с квалифицированным результатом не подтверждена";
    return { id: area, title: TITLES[area], summary, state, facts, gaps: unique(missing), decisions: RESEARCH_QUESTIONS.find(q => q.area === area)!.decisions };
  });
  const decisions = unique(RESEARCH_QUESTIONS.flatMap(q => q.decisions)).map((decision): FindingsDecisionSupport => {
    const related = sections.filter(s => s.decisions.includes(decision));
    const facts = related.flatMap(s => s.facts).filter(f => ["SUPPORTED", "INDICATIVE"].includes(f.state));
    return { decision, status: related.some(s => s.state === "CONFLICT" || s.state === "STALE") || !facts.length || (["target_result_cost", "weekly_budget"].includes(decision) && related.some(s => s.id === "economics" && s.gaps.length)) ? "NEEDS_RESEARCH" : related.every(s => s.state === "SUPPORTED") ? "SUPPORTED" : "HYPOTHESIS",
      evidence_refs: unique(facts.flatMap(f => f.evidence_refs)), limitations: unique(related.flatMap(s => [...s.gaps, ...s.facts.filter(f => f.state !== "SUPPORTED").map(f => f.limitation)])) };
  });
  if (txt(goal.goal_revision_id)) decisions.unshift({ decision: "business_goal", status: "SUPPORTED", evidence_refs: [txt(goal.goal_revision_id)], limitations: [] });
  const limitations = unique(sections.flatMap(s => s.gaps));
  const conflict = sections.find(s => s.state === "CONFLICT");
  const next = conflict ?? sections.find(s => ["product", "buyer", "economics", "measurement"].includes(s.id) && s.gaps.length);
  return { schema_version: FINDINGS_POLICY, snapshot_id: txt(snapshot.snapshot_id), goal_revision_id: txt(goal.goal_revision_id), collected_at: txt(snapshot.generated_at),
    summary: !snapshot.snapshot_id ? "Исследование ещё не завершено" : conflict ? "Есть противоречия, влияющие на стратегию" : limitations.length ? "Основания для стратегии собраны частично" : "Основные основания для стратегии собраны",
    sections, decisions, next_action: next ? `${next.title}: ${next.gaps[0] || "нужно проверить противоречивые сведения"}` : "Проверить стратегические гипотезы по квалифицированным результатам.",
    limitations, attempts: arr(research.attempts) as BusinessResearchResult["attempts"] };
}

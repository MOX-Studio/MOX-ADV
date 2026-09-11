import { keywordTargetIdentity, keywordReviewSchema, verifyKeywordReview, type KeywordReview } from "./keyword-preparation.ts";
import { CAMPAIGN_FORMATION_METHOD, formObject, formText, formArray, formId, formIds, formMoney, formEnum, formRefs, validateFormationShape, formationError, type FormationPlan, type FormationResearch, type FormationViolation } from "./campaign-formation-method.ts";
import { validateFormationCopy, type CampaignDesignContentContext } from "./campaign-design-content.ts";
import { searchPhraseIdentity } from "./campaign-search-semantics.ts";
import { GOAL_OUTCOME_PREPARATION_VERSION, usesTotalGoalBudget, goalCampaignReviewSchema, verifyGoalCampaignReview, type GoalCampaignReview, type GoalPreparationVersion } from "./campaign-goal-preparation.ts";
import { verifyGoalOutcomeReview } from "./goal-prelaunch.ts";
import { verifyPreparationCompletion } from "./campaign-preparation-completion.ts";
import { directPreparationIssues, type FormationImageAsset } from "./direct-preparation-check.ts";
import { campaignRefinementRecordSchema, type CampaignRefinementRecord } from "./campaign-refinement.ts";
import { campaignOptimizationSchema, verifyCampaignOptimization, type CampaignOptimizationReview } from "./campaign-optimization.ts";

export const FORMATION_PROJECTION_SCHEMA = "p0-direct-projection-v6";
export const FORMATION_PROFILE = "campaign-formation-local-v1";
export type FormationKeyword = { phrase: string; state: "OBSERVED_BROAD" | "OBSERVED_EXACT" | "CURATED_UNMEASURED" | "NO_ROWS_RETURNED"; count: number | null; period: string | null; observation_ref: string | null; rationale: string };
export type FormationAdExtensions = { sitelinks: Array<{ title: string; description: string; url: string; source_refs: string[] }>; callouts: Array<{ text: string; source_refs: string[] }>; reason: string };
export type FormationAd = { id: string; titles: string[]; texts: string[]; url: string; source_refs: string[]; image_ids: string[]; variant_id: string | null; valid_until: string | null; extensions?: FormationAdExtensions };
export type FormationAllocation = { phase_id: string; cap_rub: number };
export type FormationGroup = { id: string; name: string; intent: string; finding_ids: string[]; allocations: FormationAllocation[]; keywords: FormationKeyword[]; themes: string[]; negative_keywords: string[]; include_segments: string[]; exclude_segments: string[]; ads: FormationAd[] };
export type FormationCampaign = { id: string; name: string; direction_id: string; channel: "SEARCH" | "NETWORK" | "RETARGETING"; weekly_budget_rub: number; allocations: FormationAllocation[]; activation_condition: string; bidding: { type: "MANUAL_CPC" | "MAX_CLICKS" | "MAX_CONVERSIONS"; initial_bid_rub: number | null; average_cpc_rub: number | null; rationale: string }; autotargeting: "TARGETED" | "OFF"; negative_keywords: string[]; exclude_segments: string[]; groups: FormationGroup[] };
export type FormationPortfolio = { keyword_review?: KeywordReview; refinement_review?: CampaignRefinementRecord; optimization_review?: CampaignOptimizationReview; goal_review?: GoalCampaignReview; campaigns: FormationCampaign[]; images: Array<{ id: string; url: string; alt: string; origin: string; rights: string; asset?: FormationImageAsset }>; segments: Array<{ id: string; rule: string; lookback_days: number; readiness: "NOT_CREATED" | "VERIFIED"; evidence_refs: string[] }>; applications: Array<{ finding_id: string; target_ids: string[]; explanation: string }>; semantic_dispositions: Array<{ phrase: string; disposition: "DEFERRED" | "EXCLUDED"; reason: string }>; selection_rationale: string };
export type FormationBundle = { method: typeof CAMPAIGN_FORMATION_METHOD; research: FormationResearch; plan: FormationPlan; portfolio: FormationPortfolio; campaign_id: string };
const strings = (max = 200, min = 0, length = 2000) => ({ ...formArray(formText(length), max, min), uniqueItems: true });
const nullableText = (maximum = 4096) => ({ type: ["string", "null"], maxLength: maximum });
const nullableNumber = () => ({ type: ["number", "null"], minimum: 0 });
const allocations = () => formArray(formObject({ phase_id: formId(), cap_rub: formMoney() }), 12, 1);

export function formationPortfolioSchema(copy: CampaignDesignContentContext, refs: string[], goalReviewRequired = false, version?: GoalPreparationVersion, optimizationRequired = false, keywordRequired = false) {
  const factualRefs = copy.sources.filter(s => !["DEMAND", "AUDIENCE_HYPOTHESIS", "EXCLUSION"].includes(s.purpose)).map(s => s.source_ref);
  const extensions = formObject({ sitelinks: formArray(formObject({ title: formText(30), description: formText(60, 0), url: formText(1024), source_refs: formRefs(factualRefs, 1) }), 8), callouts: formArray(formObject({ text: formText(25), source_refs: formRefs(factualRefs, 1) }), 8), reason: formText() });
  const keyword = formObject({ phrase: formText(4096), state: formEnum(["OBSERVED_BROAD", "OBSERVED_EXACT", "CURATED_UNMEASURED", "NO_ROWS_RETURNED"]), count: nullableNumber(), period: nullableText(200), observation_ref: nullableText(255), rationale: formText() });
  const ad = formObject({ id: formId(), titles: strings(7, 1, 56), texts: strings(3, 1, 81), url: formText(4096), source_refs: formRefs(factualRefs, 1), image_ids: formIds(10), variant_id: nullableText(100), valid_until: nullableText(100), extensions }, usesTotalGoalBudget(version) ? [] : ["extensions"]);
  const group = formObject({ id: formId(), name: formText(255), intent: formText(), finding_ids: formIds(500, 1), allocations: allocations(), keywords: formArray(keyword, 200), themes: strings(200), negative_keywords: strings(200), include_segments: formIds(100), exclude_segments: formIds(100), ads: formArray(ad, null, 1) });
  const campaign = formObject({ id: formId(), name: formText(255), direction_id: formId(), channel: formEnum(["SEARCH", "NETWORK", "RETARGETING"]), weekly_budget_rub: { type: "integer", minimum: 1 }, allocations: allocations(), activation_condition: formText(), bidding: formObject({ type: formEnum(["MANUAL_CPC", "MAX_CLICKS", "MAX_CONVERSIONS"]), initial_bid_rub: nullableNumber(), average_cpc_rub: nullableNumber(), rationale: formText() }), autotargeting: formEnum(["TARGETED", "OFF"]), negative_keywords: strings(200), exclude_segments: formIds(100), groups: formArray(group, null, 1) });
  return formObject({
    ...(keywordRequired ? { keyword_review: keywordReviewSchema() } : {}),
    goal_review: goalCampaignReviewSchema(copy, version, refs),
    optimization_review: campaignOptimizationSchema(refs),
    refinement_review: campaignRefinementRecordSchema(),
    campaigns: formArray(campaign, null, 1),
    images: formArray(formObject({ id: formId(), url: formText(4096), alt: formText(1000), origin: formText(), rights: formText(), asset: formObject({ format: formEnum(["PNG", "JPEG", "GIF"]), width: { type: "integer", minimum: 1 }, height: { type: "integer", minimum: 1 }, bytes: { type: "integer", minimum: 1 }, sha256: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" } }) }, ["asset"]), null),
    segments: formArray(formObject({ id: formId(), rule: formText(), lookback_days: { type: "integer", minimum: 1, maximum: 540 }, readiness: formEnum(["NOT_CREATED", "VERIFIED"]), evidence_refs: formRefs(refs) }), null),
    applications: formArray(formObject({ finding_id: formId(), target_ids: formIds(null, 1), explanation: formText() }), null),
    semantic_dispositions: formArray(formObject({ phrase: formText(), disposition: formEnum(["DEFERRED", "EXCLUDED"]), reason: formText() }), 2000),
    selection_rationale: formText(4000),
  }, [...(goalReviewRequired ? [] : ["goal_review"]), ...(optimizationRequired ? [] : ["optimization_review"]), "refinement_review"]);
}
const words = (s: string) => s.toLocaleLowerCase("ru-RU").replace(/ё/gu, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/u);
const data = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const observationPeriod = (value: unknown): string | null => {
  const text = String(value ?? ""), range = [...text.matchAll(/(\d{2}\.\d{2}\.\d{4})\s*[–—-]\s*(\d{2}\.\d{2}\.\d{4})/gu)].at(-1);
  return range ? `${range[1]} — ${range[2]}` : text || null;
};

export function verifyFormationPortfolio(input: { proposal: unknown; plan: FormationPlan; research: FormationResearch; copy: CampaignDesignContentContext; allowedRefs: string[]; snapshot: Record<string, unknown>; checkCopy?: boolean; checkObservations?: boolean; checkTransfer?: boolean; optimizationRequired?: boolean; keywordRequired?: boolean }): FormationPortfolio {
  const shape = validateFormationShape(formationPortfolioSchema(input.copy, input.allowedRefs, !!input.plan.goal_preparation, input.plan.goal_preparation?.version, input.optimizationRequired, input.keywordRequired || !!input.research.keyword_research), input.proposal);
  if (shape.length) formationError(shape);
  const portfolio = input.proposal as FormationPortfolio, plan = input.plan;
  const violations: FormationViolation[] = [];
  if (input.checkTransfer) violations.push(...directPreparationIssues(portfolio));
  const add = (code: string, pointer: string, message: string) => violations.push({ code, pointer, message });
  const groups = portfolio.campaigns.flatMap(c => c.groups), ads = groups.flatMap(g => g.ads);
  const allIds = [...portfolio.campaigns, ...groups, ...ads, ...portfolio.images, ...portfolio.segments].map(o => o.id);
  if (new Set(allIds).size !== allIds.length) add("FORMATION_ID_DUPLICATE", "/", "Кампании, группы, объявления, изображения и сегменты должны иметь уникальные ID.");
  const directions = new Map(plan.directions.map(d => [d.id, d]));
  if (portfolio.campaigns.length !== directions.size || new Set(portfolio.campaigns.map(c => c.direction_id)).size !== directions.size || portfolio.campaigns.some(c => !directions.has(c.direction_id))) add("DIRECTION_NOT_IMPLEMENTED", "/campaigns", "Каждое принятое направление должно стать ровно одной кампанией.");
  const phases = plan.budget.phases.map(p => p.id);
  function checkAlloc(rows: FormationAllocation[], pointer: string) {
    if (rows.length !== phases.length || new Set(rows.map(r => r.phase_id)).size !== phases.length || rows.some(r => !phases.includes(r.phase_id))) add("BUDGET_PHASE_MISSING", pointer, "Укажите предел каждой фазы бюджета, включая ноль для резерва.");
  }
  const positiveKeys = new Set<string>();
  const findings = new Set(input.research.findings.map(f => f.id));
  const segmentIds = new Set(portfolio.segments.map(s => s.id));
  const imageIds = new Set(portfolio.images.map(i => i.id));
  const readObservation = (ref: string, phrase: string): { count: number | null; seen: boolean; period: string | null; operator: string; empty: boolean } => {
    const source = input.copy.sources.find(s => s.demand?.observation_id === ref && searchPhraseIdentity(s.text) === searchPhraseIdentity(phrase));
    if (source) return { count: source.demand?.frequency?.count ?? null, seen: true, period: source.demand?.frequency?.window ?? null, operator: source.demand?.frequency?.operator_profile ?? "", empty: false };
    let result = { count: null as number | null, seen: false, period: null as string | null, operator: "", empty: false };
    const visit = (value: unknown, observedRef = "", meta: Record<string, unknown> = {}) => {
      if (Array.isArray(value)) { value.forEach(v => visit(v, observedRef, meta)); return; }
      if (!value || typeof value !== "object") return;
      const row = data(value), current = String(row.observation_id ?? row.observationId ?? row.observed_ref ?? observedRef);
      const inherited = { ...meta, ...row, ...data(row.scope) };
      if (current === ref && searchPhraseIdentity(String(row.phrase ?? row.query ?? row.exact_query ?? "")) === searchPhraseIdentity(phrase)) result = { seen: true, count: typeof row.count === "number" ? row.count : null, period: observationPeriod(inherited.declared_window ?? inherited.window), operator: String(inherited.operator_profile ?? ""), empty: inherited.result_state === "NO_ROWS_RETURNED" || inherited.state === "NO_ROWS_RETURNED" };
      Object.values(row).forEach(v => visit(v, current, inherited));
    };
    visit(input.snapshot); return result;
  };
  for (const [ci, campaign] of portfolio.campaigns.entries()) {
    const cp = `/campaigns/${ci}`, direction = directions.get(campaign.direction_id);
    if (direction && (campaign.channel !== direction.channel || campaign.weekly_budget_rub !== direction.weekly_budget_rub)) add("DIRECTION_CHANGED", cp, "Канал и недельный бюджет должны совпадать с принятой стратегией.");
    checkAlloc(campaign.allocations, cp + "/allocations");
    if (campaign.channel !== "SEARCH" && (campaign.autotargeting !== "OFF" || campaign.bidding.type === "MANUAL_CPC" || campaign.bidding.initial_bid_rub !== null)) add("NETWORK_BIDDING_INVALID", cp, "РСЯ использует автоматическую стратегию и отдельную логику аудитории.");
    if (campaign.bidding.type === "MANUAL_CPC" && !(Number(campaign.bidding.initial_bid_rub) > 0)) add("INITIAL_BID_MISSING", cp, "Для ручного поиска нужна начальная ставка.");
    if (campaign.bidding.type !== "MANUAL_CPC" && campaign.bidding.initial_bid_rub !== null) add("AUTOMATIC_INITIAL_BID_INVALID", cp, "Автоматическая стратегия не использует ручную начальную ставку.");
    if (campaign.channel === "RETARGETING" && campaign.allocations.some(a => a.cap_rub > 0) && !campaign.activation_condition.trim()) add("AUDIENCE_CONDITION_MISSING", cp, "Возврат требует условия доступности аудитории.");
    if (campaign.exclude_segments.some(id => !segmentIds.has(id))) add("SEGMENT_UNKNOWN", cp, "Неизвестное исключение аудитории.");
    for (const [gi, group] of campaign.groups.entries()) {
      const gp = cp + `/groups/${gi}`; checkAlloc(group.allocations, gp + "/allocations");
      if (group.finding_ids.some(id => !findings.has(id))) add("GROUP_FINDING_UNKNOWN", gp, "Группа ссылается на неизвестный вывод.");
      if ([...group.include_segments, ...group.exclude_segments].some(id => !segmentIds.has(id))) add("SEGMENT_UNKNOWN", gp, "Условия аудитории должны ссылаться на подготовленные сегменты.");
      if (group.include_segments.some(id => group.exclude_segments.includes(id) || campaign.exclude_segments.includes(id))) add("AUDIENCE_SELF_EXCLUDED", gp, "Включённый сегмент одновременно исключён.");
      if (campaign.channel === "SEARCH" ? !group.keywords.length || group.themes.length || group.include_segments.length : group.keywords.length > 0) add("TARGETING_CHANNEL_MISMATCH", gp, "Поиск использует фразы; РСЯ — темы или аудитории, без поисковых ключей.");
      if (campaign.channel === "NETWORK" && (!group.themes.length || group.include_segments.length)) add("NETWORK_THEME_MISSING", gp, "Новая аудитория РСЯ требует тем; возврат выделяется отдельно.");
      if (campaign.channel === "RETARGETING" && (!group.include_segments.length || group.themes.length)) add("RETARGETING_BROADENED", gp, "Возврат требует сегментов без расширяющих тем.");
      for (const [ki, keyword] of group.keywords.entries()) {
        const kp = gp + `/keywords/${ki}`, normalized = keywordTargetIdentity(keyword.phrase);
        if (positiveKeys.has(normalized)) add("KEYWORD_DUPLICATE", kp, "Фраза повторяется между группами.");
        positiveKeys.add(normalized);
        if (words(keyword.phrase).length > 7) add("KEYWORD_WORD_LIMIT", kp, "В поисковой фразе допускается до 7 слов.");
        // Full overlap is ignored by Direct, not a blocked positive keyword.
        // Versioned keyword_review checks effective examples and ignored negatives.
        if (keyword.state.startsWith("OBSERVED")) {
          const actual = keyword.observation_ref ? readObservation(keyword.observation_ref, keyword.phrase) : { seen: false, count: null, period: null, operator: "", empty: false };
          if ((input.checkObservations !== false && (!actual.seen || actual.count !== keyword.count)) || keyword.count === null || !keyword.period) add("KEYWORD_OBSERVATION_INVALID", kp, "Частота и фраза должны совпадать с датированным наблюдением.");
          if (input.checkObservations !== false && ((actual.period && actual.period.replace(/\s*[–—-]\s*/gu, "-") !== keyword.period?.replace(/\s*[–—-]\s*/gu, "-")) || (keyword.state === "OBSERVED_EXACT" && !/EXACT|FIXED|PHRASE_MATCH/u.test(actual.operator)))) add("KEYWORD_SCOPE_CHANGED", kp, "Период и соответствие должны сохраняться; широкий срез нельзя объявлять точным.");
        } else if (keyword.count !== null || (keyword.state === "NO_ROWS_RETURNED" && (!keyword.observation_ref || (input.checkObservations !== false && !readObservation(keyword.observation_ref, keyword.phrase).empty)))) add("KEYWORD_UNKNOWN_IS_NOT_ZERO", kp, "Неизмеренная частота остаётся пустой; пустая выдача требует своего наблюдения.");
      }
      for (const [ai, ad] of group.ads.entries()) {
        const ap = gp + `/ads/${ai}`;
        if (ad.image_ids.some(id => !imageIds.has(id)) || (campaign.channel !== "SEARCH" && !ad.image_ids.length)) add("AD_IMAGE_MISSING", ap, "Объявление РСЯ должно ссылаться на подготовленное изображение.");
        if (input.checkCopy !== false) violations.push(...validateFormationCopy({ ...ad, context: input.copy }).map(v => ({ ...v, pointer: ap + v.pointer })));
        if (ad.titles.some(t => t.split(/\s+/u).some(w => w.length > 22)) || ad.texts.some(t => t.split(/\s+/u).some(w => w.length > 23))) add("AD_WORD_TOO_LONG", ap, "Слово превышает ограничение объявления.");
        try {
          const url = new URL(ad.url), landing = new URL(plan.landing.url);
          if (url.protocol !== "https:" || url.username || url.password || url.origin !== landing.origin || url.pathname !== landing.pathname || !url.searchParams.get("utm_campaign") || !url.searchParams.get("utm_content")) throw new Error();
        } catch { add("AD_URL_INVALID", ap, "Нужны согласованная посадочная и отдельные метки кампании и объявления."); }
        if (ad.valid_until && !Number.isFinite(Date.parse(ad.valid_until))) add("AD_EXPIRY_INVALID", ap, "Неверная дата завершения временного предложения.");
        if (ad.extensions) {
          const publicSources = new Set((Array.isArray(input.snapshot.sources) ? input.snapshot.sources : []).map(data).filter(s => s.provenance_class === "FIRST_PARTY_PUBLIC" && s.status !== "UNAVAILABLE").map(s => String(s.source_id)));
          const canonicalUrl = (value: string) => { const url = new URL(value); for (const key of [...url.searchParams.keys()]) if (key.startsWith("utm_")) url.searchParams.delete(key); return url.href; };
          const observedUrls = new Set([canonicalUrl(plan.landing.url), ...(Array.isArray(input.snapshot.evidence) ? input.snapshot.evidence : []).map(data).filter(e => publicSources.has(String(e.source_id))).flatMap(e => { try { return [canonicalUrl(String(data(e.source_locator).url))]; } catch { return []; } })]);
          const links = ad.extensions.sitelinks;
          if (new Set(links.map(l => words(l.title).join(" "))).size !== links.length || new Set(links.map(l => l.url)).size !== links.length || new Set(ad.extensions.callouts.map(c => words(c.text).join(" "))).size !== ad.extensions.callouts.length) add("AD_EXTENSION_DUPLICATE", ap, "Расширения должны добавлять различающуюся информацию.");
          for (const link of links) {
            try { const url = new URL(link.url); if (url.protocol !== "https:" || url.username || url.password || url.origin !== new URL(plan.landing.url).origin || (input.checkObservations !== false && !observedUrls.has(canonicalUrl(link.url)))) throw new Error(); }
            catch { add("SITELINK_DESTINATION_UNVERIFIED", ap, "Быстрая ссылка должна вести на проверенную страницу или проверенный раздел своего сайта."); }
            if (input.checkCopy !== false) violations.push(...validateFormationCopy({ titles: [link.title], texts: link.description ? [link.description] : [], source_refs: link.source_refs, context: input.copy }).map(v => ({ ...v, pointer: ap + "/extensions/sitelinks" + v.pointer })));
          }
          if (input.checkCopy !== false) for (const callout of ad.extensions.callouts) violations.push(...validateFormationCopy({ titles: [callout.text], texts: [], source_refs: callout.source_refs, context: input.copy }).map(v => ({ ...v, pointer: ap + "/extensions/callouts" + v.pointer })));
        }
      }
    }
    for (const allocation of campaign.allocations) if (campaign.groups.reduce((sum, g) => sum + (g.allocations.find(a => a.phase_id === allocation.phase_id)?.cap_rub ?? 0), 0) !== allocation.cap_rub) add("GROUP_BUDGET_SUM_MISMATCH", cp, "Лимиты групп должны суммироваться в лимит кампании по каждой фазе.");
  }
  for (const phase of plan.budget.phases) if (portfolio.campaigns.reduce((sum, c) => sum + (c.allocations.find(a => a.phase_id === phase.id)?.cap_rub ?? 0), 0) !== phase.cap_rub) add("PORTFOLIO_PHASE_SUM_MISMATCH", "/campaigns", "Распределение кампаний должно совпадать с пределом фазы стратегии.");
  if (new Set(ads.map(a => a.url)).size !== ads.length) add("AD_ATTRIBUTION_DUPLICATE", "/campaigns", "Каждому объявлению нужна собственная метка.");
  for (const image of portfolio.images) if (!/^https:\/\//u.test(image.url) && !/^\/campaign-assets\/[A-Za-z0-9_.-]+$/u.test(image.url)) add("IMAGE_URL_INVALID", "/images", "Укажите HTTPS-изображение или локальный материал кампании.");
  for (const segment of portfolio.segments) if (segment.readiness === "VERIFIED" && !segment.evidence_refs.length) add("SEGMENT_FALSE_READY", "/segments", "Готовность реального сегмента требует источника; тест не создаёт аудиторию.");
  const variants = plan.experiments.flatMap(e => e.variants);
  if (ads.some(a => a.variant_id && !variants.some(v => v.id === a.variant_id))) add("VARIANT_UNKNOWN", "/campaigns", "Объявление использует неизвестный вариант гипотезы.");
  for (const variant of variants) {
    const matching = portfolio.campaigns.flatMap(c => c.groups.flatMap(g => g.ads.filter(a => a.variant_id === variant.id).map(a => ({ c, g, a }))));
    if (matching.length !== 1 || matching[0].c.direction_id !== variant.direction_id) add("VARIANT_NOT_IMPLEMENTED", "/campaigns", `${variant.id}: вариант должен стать одним объявлением в принятом направлении.`);
  }
  for (const experiment of plan.experiments.filter(e => e.comparison === "CONTROLLED_VARIANT")) {
    const variants = experiment.variants.map(v => groups.flatMap(g => g.ads.filter(a => a.variant_id === v.id).map(a => ({ g, a })))[0]).filter(Boolean);
    if (variants.some(v => v.a.titles.length !== 1 || v.a.texts.length !== 1) || new Set(variants.map(v => v.g.id)).size > 1) add("CONTROLLED_VARIANT_CONFOUNDED", "/campaigns", `${experiment.id}: контролируемое сравнение требует отдельных фиксированных объявлений в одной группе.`);
  }
  const targets = new Set([...allIds, "landing", "measurement", "budget", "planning", "semantics"]);
  const applied = plan.decisions.filter(d => d.disposition === "APPLIED");
  if (portfolio.applications.length !== applied.length || new Set(portfolio.applications.map(a => a.finding_id)).size !== applied.length || applied.some(d => !portfolio.applications.some(a => a.finding_id === d.finding_id))) add("APPLICATION_MISSING", "/applications", "Каждое применённое решение должно указывать фактические объекты готовых кампаний.");
  for (const application of portfolio.applications) if (application.target_ids.some(id => !targets.has(id))) add("APPLICATION_TARGET_UNKNOWN", "/applications", "Место применения отсутствует в подготовленных материалах.");
  for (const decision of applied) {
    const application = portfolio.applications.find(a => a.finding_id === decision.finding_id);
    if (!application) continue;
    for (const target of decision.target_ids) {
      const campaign = portfolio.campaigns.find(c => c.direction_id === target);
      const experiment = plan.experiments.find(e => e.id === target);
      const allowed = campaign ? [campaign.id, ...campaign.groups.flatMap(g => [g.id, ...g.ads.map(a => a.id)])]
        : experiment ? ads.filter(a => experiment.variants.some(v => v.id === a.variant_id)).map(a => a.id) : [target];
      if (!application.target_ids.some(id => allowed.includes(id))) add("APPLICATION_DOES_NOT_IMPLEMENT_DECISION", "/applications", `${decision.finding_id}: не реализовано принятое место применения ${target}.`);
    }
  }
  if (plan.goal_preparation && portfolio.goal_review) violations.push(...verifyGoalCampaignReview(portfolio.goal_review, plan.goal_preparation, portfolio, input.copy, input.research.mode === "TEST_SCENARIO", input.checkCopy !== false));
  else if (portfolio.goal_review) add("GOAL_REVIEW_WITHOUT_STRATEGY", "/goal_review", "Итоговая оценка требует сравнения подходов в стратегии.");
  if (plan.goal_preparation?.version === GOAL_OUTCOME_PREPARATION_VERSION) violations.push(...verifyGoalOutcomeReview(plan, input.research, portfolio));
  if (input.keywordRequired || input.research.keyword_research) violations.push(...verifyKeywordReview(input.research, portfolio));
  if (portfolio.optimization_review) violations.push(...verifyCampaignOptimization(plan, input.research, portfolio));
  if (portfolio.goal_review?.preparation_decision) violations.push(...verifyPreparationCompletion(plan, portfolio.goal_review));
  if (violations.length) formationError(violations);
  return structuredClone(portfolio);
}

/** Desired local object graph. Provider mapping is deliberately separate from accepted business decisions. */
export function formationDirectGraph(bundle: FormationBundle, period: { start_date: string; end_date: string }, geography: string) {
  const c = bundle.portfolio.campaigns.find(c => c.id === bundle.campaign_id)!;
  return {
    campaign: { Name: c.name, StartDate: period.start_date, EndDate: period.end_date, TimeZone: "Europe/Moscow", Geography: geography,
      DeliveryPlan: { channel: c.channel, bidding: c.bidding, autotargeting: c.autotargeting, weekly_budget_rub: c.weekly_budget_rub, allocations: c.allocations, activation_condition: c.activation_condition, negative_keywords: c.negative_keywords, exclude_segments: c.exclude_segments } },
    ad_groups: c.groups.map(g => ({ local_ref: g.id, campaign_ref: "campaign:primary", provider_fields: { Name: g.name, Intent: g.intent, NegativeKeywords: { Items: g.negative_keywords }, Allocations: g.allocations, IncludeSegments: g.include_segments, ExcludeSegments: g.exclude_segments }, evidence_refs: g.finding_ids })),
    keywords: c.groups.flatMap(g => [
      ...g.keywords.map((k, i) => ({ local_ref: `${g.id}:keyword:${i + 1}`, ad_group_ref: g.id, kind: "EXPLICIT_KEYWORD" as const, provider_fields: { Keyword: k.phrase, Evidence: k } })),
      ...g.themes.map((t, i) => ({ local_ref: `${g.id}:theme:${i + 1}`, ad_group_ref: g.id, kind: "NETWORK_THEME" as const, provider_fields: { Theme: t } })),
      ...g.include_segments.map((s, i) => ({ local_ref: `${g.id}:segment:${i + 1}`, ad_group_ref: g.id, kind: "RETARGETING_SEGMENT" as const, provider_fields: { SegmentRef: s } })),
    ]),
    ads: c.groups.flatMap(g => g.ads.map(a => ({ local_ref: a.id, ad_group_ref: g.id, ad_type: "RESPONSIVE_AD" as const, provider_fields: { ResponsiveAd: { Titles: a.titles, Texts: a.texts, Href: a.url, ImageRefs: a.image_ids, VariantRef: a.variant_id, ValidUntil: a.valid_until } }, ...(a.extensions ? { template_extensions: structuredClone(a.extensions) } : {}), evidence_refs: a.source_refs }))),
  };
}

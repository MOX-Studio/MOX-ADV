import { formArray, formEnum, formId, formIds, formObject, formText, type FormationPlan, type FormationResearch, type FormationViolation } from "./campaign-formation-method.ts";
import type { FormationPortfolio } from "./campaign-formation-portfolio.ts";
import { pipelineDigest } from "./pipeline-orchestrator.ts";

export const CAMPAIGN_REFINEMENT_VERSION = "campaign-refinement-v1";
export const CREATIVE_CRITERIA = ["BUYER_FIT", "VALUE_AND_PROOF", "QUALIFIED_ACTION", "LANDING_CONTINUITY", "CLARITY", "FACTUAL_SCOPE"] as const;
export const REPAIR_SCOPES = ["COPY", "TARGETING", "CREATIVE", "LANDING", "DELIVERY", "BUDGET"] as const;
type RepairScope = typeof REPAIR_SCOPES[number];
export type CampaignCritique = {
  version: typeof CAMPAIGN_REFINEMENT_VERSION;
  draft_digest: string;
  recommendation: "ACCEPT" | "REVISE";
  summary: string;
  ads: Array<{ ad_id: string; decision: "KEEP" | "REVISE" | "REMOVE"; strongest_alternative_id: string;
    alternative_advantage: string; choice_reason: string;
    checks: Array<{ criterion: typeof CREATIVE_CRITERIA[number]; status: "SUPPORTED" | "WEAK" | "NOT_APPLICABLE"; ad_fragments: string[]; explanation: string; finding_ids: string[]; issue_ids: string[] }> }>;
  issues: Array<{ id: string; ad_ids: string[]; scope: RepairScope; problem: string; required_change: string; finding_ids: string[]; research_required: boolean }>;
  stopping_reason: string;
};
export type CampaignRefinementRecord = { version: typeof CAMPAIGN_REFINEMENT_VERSION; final_review: CampaignCritique; previous_reviews: CampaignCritique[] };
export type CampaignRefinementState = { phase: "REVIEW" | "REVISION"; round: number; draft: FormationPortfolio; draft_digest: string; previous_reviews: CampaignCritique[]; revision_request: CampaignCritique | null };
const digestSchema = () => ({ type: "string", pattern: "^sha256:[a-f0-9]{64}$" });

export function campaignCritiqueSchema() {
  return formObject({ version: formEnum([CAMPAIGN_REFINEMENT_VERSION]), draft_digest: digestSchema(), recommendation: formEnum(["ACCEPT", "REVISE"]), summary: formText(4000),
    ads: formArray(formObject({ ad_id: formId(), decision: formEnum(["KEEP", "REVISE", "REMOVE"]), strongest_alternative_id: formId(), alternative_advantage: formText(), choice_reason: formText(),
      checks: formArray(formObject({ criterion: formEnum(CREATIVE_CRITERIA), status: formEnum(["SUPPORTED", "WEAK", "NOT_APPLICABLE"]), ad_fragments: formArray(formText(4096)), explanation: formText(), finding_ids: formIds(null, 1), issue_ids: formIds() }), CREATIVE_CRITERIA.length, CREATIVE_CRITERIA.length) }), null, 1),
    issues: formArray(formObject({ id: formId(), ad_ids: formIds(null, 1), scope: formEnum(REPAIR_SCOPES), problem: formText(), required_change: formText(), finding_ids: formIds(null, 1), research_required: { type: "boolean" } })),
    stopping_reason: formText(4000) });
}
export function campaignRefinementRecordSchema() {
  return formObject({ version: formEnum([CAMPAIGN_REFINEMENT_VERSION]), final_review: campaignCritiqueSchema(), previous_reviews: formArray(campaignCritiqueSchema()) });
}
export function campaignDraftDigest(portfolio: FormationPortfolio) {
  const { refinement_review: excluded, ...draft } = portfolio;
  void excluded;
  return pipelineDigest(draft);
}
const exact = (a: string[], b: readonly string[]) => a.length === b.length && new Set(a).size === a.length && b.every(id => a.includes(id));
const adRows = (p: FormationPortfolio) => p.campaigns.flatMap(campaign => campaign.groups.flatMap(group => group.ads.map(ad => ({ campaign, group, ad }))));

/** Validate an agent's substantive critique against the saved draft; no quality score or model judgment is manufactured. */
export async function verifyCampaignCritique(review: CampaignCritique, draft: FormationPortfolio, research: FormationResearch): Promise<FormationViolation[]> {
  const violations: FormationViolation[] = [];
  const add = (code: string, message: string) => violations.push({ code, pointer: "/creative_review", message });
  const rows = adRows(draft), ids = rows.map(r => r.ad.id), findings = new Set(research.findings.map(f => f.id));
  if (review.draft_digest !== await campaignDraftDigest(draft)) add("CRITIQUE_DRAFT_CHANGED", "Разбор должен относиться к точному сохранённому проекту объявлений.");
  if (!exact(review.ads.map(a => a.ad_id), ids)) add("CRITIQUE_AD_MISSING", "Проверьте каждое фактическое объявление без пропусков и подмены идентификаторов.");
  if (new Set(review.issues.map(i => i.id)).size !== review.issues.length) add("CRITIQUE_ISSUE_DUPLICATE", "Замечания должны иметь уникальные идентификаторы.");
  const checkFindings = (refs: string[]) => { if (!refs.length || refs.some(id => !findings.has(id))) add("CRITIQUE_FINDING_UNKNOWN", "Оценка должна опираться на выводы сохранённого исследования."); };
  for (const issue of review.issues) {
    checkFindings(issue.finding_ids);
    if (issue.ad_ids.some(id => !ids.includes(id))) add("CRITIQUE_ISSUE_TARGET_UNKNOWN", "Замечание должно относиться к существующему объявлению.");
    if (issue.ad_ids.some(id => !review.ads.some(a => a.ad_id === id && a.decision !== "KEEP"))) add("CRITIQUE_DEFECT_IGNORED", "Объявление с существенным недостатком нельзя оставить без доработки.");
  }
  for (const row of review.ads) {
    const actual = rows.find(r => r.ad.id === row.ad_id);
    if (!actual) continue;
    const candidates = draft.goal_review?.groups.find(g => g.group_id === actual.group.id)?.candidates ?? [];
    const alternative = candidates.find(c => c.id === row.strongest_alternative_id);
    if (!alternative || alternative.ad_id === row.ad_id) add("CRITIQUE_ALTERNATIVE_INVALID", "Сравните объявление с другим реальным вариантом для той же покупательской задачи.");
    if (!exact(row.checks.map(c => c.criterion), CREATIVE_CRITERIA)) add("CRITIQUE_CRITERION_MISSING", "Проверьте покупателя, ценность и доказательства, нужное действие, посадочную, ясность и границы фактов.");
    const surfaces = [...actual.ad.titles, ...actual.ad.texts, actual.ad.url, ...actual.ad.extensions?.callouts.map(c => c.text) ?? [], ...actual.ad.extensions?.sitelinks.flatMap(l => [l.title, l.description, l.url]) ?? []];
    for (const check of row.checks) {
      checkFindings(check.finding_ids);
      if (check.ad_fragments.some(fragment => !fragment.trim() || !surfaces.some(text => text.includes(fragment)))) add("CRITIQUE_FRAGMENT_NOT_IN_AD", "Объяснение должно указывать реальные фрагменты проверяемого объявления.");
      if (check.status === "SUPPORTED" && !check.ad_fragments.length) add("CRITIQUE_SUPPORT_NOT_SHOWN", "Покажите, каким фрагментом объявления выполнен критерий.");
      if (check.status === "NOT_APPLICABLE" && ["BUYER_FIT", "FACTUAL_SCOPE", "CLARITY"].includes(check.criterion)) add("CRITIQUE_CORE_CRITERION_SKIPPED", "Соответствие покупателю, ясность и достоверность обязательны для каждого объявления.");
      if (check.issue_ids.some(id => !review.issues.some(i => i.id === id && i.ad_ids.includes(row.ad_id)))) add("CRITIQUE_ISSUE_LINK_INVALID", "Свяжите замечание с затронутым объявлением и конкретным исправлением.");
      if (check.status === "WEAK" && (row.decision === "KEEP" || !check.issue_ids.length)) add("CRITIQUE_WEAKNESS_IGNORED", "Слабый критерий требует конкретной доработки или удаления объявления.");
      if (check.status !== "WEAK" && check.issue_ids.length) add("CRITIQUE_STATUS_CONFLICT", "Критерий с существенным замечанием не может быть отмечен как выполненный.");
    }
    if (row.decision !== "KEEP" && !review.issues.some(i => i.ad_ids.includes(row.ad_id))) add("CRITIQUE_REPAIR_UNSPECIFIED", "Для доработки или удаления укажите проблему и необходимое изменение.");
  }
  const requiresRevision = review.issues.length > 0 || review.ads.some(a => a.decision !== "KEEP");
  if ((review.recommendation === "REVISE") !== requiresRevision) add("CRITIQUE_RECOMMENDATION_CONFLICT", "Решение о завершении должно соответствовать замечаниям по объявлениям.");
  return violations;
}

const normalized = (text: string) => text.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/ё/gu, "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function adScopeValue(row: ReturnType<typeof adRows>[number], portfolio: FormationPortfolio, plan: FormationPlan, scope: RepairScope): unknown {
  const { ad, group, campaign } = row;
  const copySet = (items: string[]) => [...new Set(items.map(normalized))].sort();
  const phraseSet = (items: string[]) => items.map(s => s.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/\s+/gu, " ").trim()).sort();
  const segments = (ids: string[]) => ids.map(id => portfolio.segments.find(s => s.id === id)).map(s => s ? [normalized(s.rule), s.lookback_days] : null).sort();
  if (scope === "COPY") return [copySet(ad.titles), copySet(ad.texts), copySet(ad.extensions?.callouts.map(c => c.text) ?? []), copySet(ad.extensions?.sitelinks.map(l => `${l.title}\n${l.description}`) ?? [])];
  if (scope === "TARGETING") return [campaign.channel, campaign.autotargeting, phraseSet(campaign.negative_keywords), segments(campaign.exclude_segments), phraseSet(group.keywords.map(k => k.phrase)), phraseSet(group.themes), phraseSet(group.negative_keywords), segments(group.include_segments), segments(group.exclude_segments)];
  if (scope === "CREATIVE") return [ad.image_ids.map(id => portfolio.images.find(i => i.id === id)).map(i => i?.asset?.sha256 ?? i?.url), ad.extensions?.sitelinks.map(l => [normalized(l.title), normalized(l.description), l.url]), ad.extensions?.callouts.map(c => normalized(c.text))];
  if (scope === "LANDING") { const url = new URL(ad.url); for (const key of [...url.searchParams.keys()]) if (key.startsWith("utm_") || key === "yclid") url.searchParams.delete(key); return [url.href, plan.landing, plan.measurement]; }
  if (scope === "DELIVERY") return [campaign.bidding.type, campaign.bidding.initial_bid_rub, campaign.bidding.average_cpc_rub, campaign.autotargeting, campaign.activation_condition, ad.valid_until];
  return [campaign.weekly_budget_rub, campaign.allocations.map(a => a.cap_rub), group.allocations.map(a => a.cap_rub), plan.budget.total_cap_rub, plan.budget.phases.map(p => [p.cap_rub, normalized(p.release_condition)]), normalized(plan.budget.reserve_rule), plan.goal_preparation?.forecast.period];
}

/** A claimed revision must change the criticized content/settings; renaming IDs, prose or punctuation cannot discharge it. */
export async function verifyCampaignRevision(previous: CampaignRefinementState, candidate: FormationPortfolio, plan: FormationPlan): Promise<FormationViolation[]> {
  const violations: FormationViolation[] = [];
  const oldRows = adRows(previous.draft), newRows = adRows(candidate);
  for (const issue of previous.revision_request?.issues ?? []) {
    if (issue.research_required) { violations.push({ code: "REFINEMENT_RESEARCH_REQUIRED", pointer: "/campaigns", message: "Сначала вернитесь к исследованию и обновите сведения, необходимые для исправления." }); continue; }
    for (const id of issue.ad_ids) {
      const old = oldRows.find(r => r.ad.id === id);
      if (!old) continue;
      const sameId = newRows.find(r => r.ad.id === id);
      const oldValue = await pipelineDigest(adScopeValue(old, previous.draft, plan, issue.scope));
      const substitutes = [...(sameId ? [sameId] : []), ...newRows.filter(r => !oldRows.some(previous => previous.ad.id === r.ad.id))];
      if (await Promise.all(substitutes.map(row => pipelineDigest(adScopeValue(row, candidate, plan, issue.scope)))).then(values => values.includes(oldValue))) violations.push({ code: "REFINEMENT_DEFECT_UNCHANGED", pointer: `/campaigns/${id}`, message: `${issue.problem} Требуемое изменение не внесено: ${issue.required_change}` });
    }
  }
  return violations;
}

export function campaignRefinementInstructions(state?: CampaignRefinementState) {
  return { version: CAMPAIGN_REFINEMENT_VERSION, phase: state?.phase ?? "DRAFT", round: state?.round ?? 1,
    objective: "Generate a strong answer to the exact buyer task and qualified Goal. A completed table or a copied old portfolio is not the deliverable. Existing work is a reference that must earn its place again.",
    draft: "Develop competing credible messages from the evidence: buyer motive/objection, verified benefit or useful condition, qualification cue and a clear next action continuous with the landing. Draft the actual headlines, body, extensions, images and targeting. Prefer the strongest feasible challenger, not a deliberately generic straw man. Preserve useful shared headlines and settings when they serve intent. The first valid submission saves a provisional draft and cannot finish Campaigns. Then get the next task yourself.",
    review: "Read the SAVED draft as a buyer before filling the separate critique. Inspect each actual ad against BUYER_FIT, VALUE_AND_PROOF, QUALIFIED_ACTION, LANDING_CONTINUITY, CLARITY and FACTUAL_SCOPE. Quote real ad fragments for each supported criterion, connect to actual findings and compare with its strongest real alternative. A topical title plus a generic CTA may be weak when available facts offer a clearer benefit; a raw source quotation may be weak when it hides the buyer action. Plain language and intent fit matter more than copying every fact. No invented performance scores. This is the same controlling agent taking a separate review pass, not an independent measured evaluation.",
    revision: "Mark material shortcomings WEAK and give concrete issue IDs, affected ads, repair scope and required change. Return REVISE; the next task will require changes to those exact values. Naming a different ad ID, changing punctuation or rewriting its justification is not a repair. If the fix needs new facts or a different strategy, set research_required and use the existing upstream research UI. After revision, obtain a new critique task; old critiques cannot approve changed drafts. Keep going without an owner prompt or arbitrary iteration limit.",
    completion: "ACCEPT is allowed only when every actual ad is reviewed, every material weakness has been resolved and no stronger feasible unaddressed alternative remains. State the diminishing decision value of further preparation. This completes LOCAL preparation subject to the existing full-Goal/cold-start checks; actual effectiveness and numerical success probability remain unknown without applicable outcomes. Use NOT_APPLICABLE only with a concrete reason (for example a direct action may be delegated to another visible ad element); never exempt buyer fit, clarity or factual scope.",
  };
}

import { CAMPAIGN_REFINEMENT_VERSION, CREATIVE_CRITERIA } from "../../lib/campaign-refinement.ts";

// Explicit synthetic reviewer for workflow tests. It is never used by production or as evidence of creative quality.
export function critiqueFixture(task) {
  const state = task.source.campaign_refinement;
  return { version: CAMPAIGN_REFINEMENT_VERSION, draft_digest: state.draft_digest, recommendation: "ACCEPT", summary: "Изолированная проверка принятия отдельного разбора.",
    ads: state.draft.campaigns.flatMap(c => c.groups.flatMap(g => g.ads.map(ad => ({ ad_id: ad.id, decision: "KEEP",
      strongest_alternative_id: state.draft.goal_review.groups.find(row => row.group_id === g.id).candidates.find(row => row.disposition === "REJECTED").id,
      alternative_advantage: "Изолированный вариант короче", choice_reason: "Изолированный пример выбора", checks: CREATIVE_CRITERIA.map(criterion => ({ criterion, status: "SUPPORTED", ad_fragments: [ad.titles[0]], explanation: "Синтетический разбор для проверки переходов состояния.", finding_ids: ["F1"], issue_ids: [] })) })))),
    issues: [], stopping_reason: "Изолированный пример принятия, не свидетельство рекламной эффективности." };
}

import { CAMPAIGN_OPTIMIZATION_VERSION, campaignOptimizationParameters } from "../../lib/campaign-optimization.ts";

// Synthetic contract fixture; no business claim or live workspace mutation.
export function optimizationReviewFixture(plan, portfolio) {
  return { version: CAMPAIGN_OPTIMIZATION_VERSION, goal_revision_id: plan.goal_preparation.goal.revision_id, basis: "PRELAUNCH_JUDGMENT",
    groups: campaignOptimizationParameters(plan, portfolio).map(group => ({ ...group, strongest_counterargument: "Изолированный пример: квалификация пока неизвестна.", selection_reason: "Изолированный выбор конкретного действия по намерению покупателя.",
      parameters: group.parameters.map(row => {
        const alternative = JSON.parse(row.selected_value_json);
        if (row.parameter === "OFFER_AND_COPY") {
          const rejected = portfolio.goal_review.groups.find(g => g.group_id === group.group_id).candidates.find(c => c.disposition === "REJECTED");
          Object.assign(alternative.ads[0], { titles: rejected.titles, texts: rejected.texts, source_refs: rejected.source_refs });
        }
        return { ...row, decision: row.parameter === "OFFER_AND_COPY" ? "COMPARED" : "HELD", reason: "Изолированный пример сохранения параметра по принятому плану.", finding_ids: ["F1"],
          alternatives: row.parameter === "OFFER_AND_COPY" ? [{ label: "Предложение без следующего шага", value_json: JSON.stringify(alternative), expected_advantage: "Краткое повторение предложения", principal_risk: "Не объясняет следующий шаг", rejection_reason: "Выбран конкретный призыв к квалифицированному действию", finding_ids: ["F1"] }] : [] };
      }) })),
    issues: [], stopping_reason: "Изолированный пример завершённого сравнения, не утверждение об эффективности." };
}

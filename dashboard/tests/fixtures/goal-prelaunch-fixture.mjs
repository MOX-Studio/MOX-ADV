import { goalMeasurement, goalComparison, goalTargetValue, goalTotalBudgetRub } from "../../lib/goal-revision.ts";
import { requiredGoalAreas, GOAL_PRELAUNCH_VERSION } from "../../lib/goal-prelaunch.ts";
import { GOAL_OUTCOME_PREPARATION_VERSION } from "../../lib/campaign-goal-preparation.ts";

const note = "Изолированный пример контракта; не наблюдение реального бизнеса.";
export function goalRequirementsFixture(research, goal, refs) {
  const requirements = requiredGoalAreas(goalMeasurement(goal)).map(area => ({ id: `requirement-${area}`, area, condition: `${area}: ${note}`, criticality: "CRITICAL",
    status: ["BUDGET", "TIMING"].includes(area) ? "SUPPORTED" : area === "MEASUREMENT" ? "UNAVAILABLE" : "ASSUMPTION",
    resolution_scope: area === "MEASUREMENT" ? "EXTERNAL" : area === "REACH" ? "PERFORMANCE" : "PRELAUNCH", evidence_basis: ["BUDGET", "TIMING"].includes(area) ? "OWNER_GOAL" : area === "MEASUREMENT" ? "UNKNOWN" : "INFERENCE",
    finding_ids: research.findings.slice(0, 1).map(f => f.id), evidence_refs: refs.slice(0, 1), decision_impact: note, next_step: note }));
  return { version: GOAL_PRELAUNCH_VERSION, goal_revision_id: goal.goal_revision_id, goal_digest: goal.digest,
    requirements, measurements: [], decision_gaps: [{ id: "measurement-gap", requirement_ids: ["requirement-MEASUREMENT"], question: note, status: "UNAVAILABLE", attempts: [note], finding_ids: [], evidence_refs: [], decision_impact: note, conclusion: note }] };
}
export function upgradeGoalPreparationFixture(preparation, goal, research) {
  preparation.version = GOAL_OUTCOME_PREPARATION_VERSION;
  preparation.goal = { revision_id: goal.goal_revision_id, digest: goal.digest, qualified_result: goal.qualified_action, target_value: goalTargetValue(goal.success_criterion), comparison: goalComparison(goal.success_criterion), metric: goalMeasurement(goal), deadline: goal.success_criterion.deadline, total_budget_rub: goalTotalBudgetRub(goal.success_criterion), customer_geography: goal.customer_geography };
  preparation.forecast.metric_inputs = [];
  preparation.forecast.effect_basis = "ASSUMPTION";
  preparation.outcome_plan = { requirement_decisions: research.goal_requirements.requirements.map(r => ({ requirement_id: r.id, disposition: r.status === "SUPPORTED" ? "ADDRESS" : "HOLD_AS_CONDITION", direction_ids: preparation.directions.map(d => d.direction_id), action: note, evidence_refs: [] })),
    candidate_comparisons: preparation.alternatives.map(a => ({ alternative_id: a.id, requirement_ids: research.goal_requirements.requirements.map(r => r.id), package: { audience: a.audience, offer: a.offer, landing: note, action: goal.qualified_action, measurement: note, budget_and_timing: note }, ranking: a.id === preparation.selected_alternative_id ? "PREFERRED" : "ALTERNATIVE", advantage: a.strongest_reason, strongest_counterargument: a.principal_risk, decision_reason: note })), stopping_reason: note };
  return preparation;
}
export function upgradeGoalReviewFixture(review, research) {
  review.version = GOAL_OUTCOME_PREPARATION_VERSION;
  review.outcome_review = { creative_combinations: review.groups.flatMap(g => g.candidates.filter(c => c.ad_id).flatMap(c => c.titles.flatMap(title => c.texts.map(text => ({ ad_id: c.ad_id, title, text, status: "COMPATIBLE", explanation: note }))))), requirements: research.goal_requirements.requirements.map(r => ({ requirement_id: r.id, status: r.status === "SUPPORTED" ? "SATISFIED" : "CONDITION", target_ids: ["portfolio"], explanation: note, evidence_refs: [], repaired_issue_ids: [] })),
    group_selections: review.groups.map(g => ({ group_id: g.group_id, candidate_ids: g.candidates.map(c => c.id), requirement_ids: research.goal_requirements.requirements.map(r => r.id), ranking: "PREFERRED", main_advantage: note, strongest_counterargument: note, unknowns: [{ question: note, decision_impact: note }], conclusion: note })), success_probability: null, material_limits: [note] };
  if (review.preparation_decision) review.preparation_decision.validation_plan.observations = ["COST", "CLICKS", "GOAL_OUTCOME_RECORDS", "GOAL_OUTCOME_DATE", "CAMPAIGN_AND_AD"].map(field => ({ field, collection_method: note }));
  return review;
}

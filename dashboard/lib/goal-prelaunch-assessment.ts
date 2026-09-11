import type { FormationBundle } from "./campaign-formation-portfolio.ts";
import { GOAL_OUTCOME_PREPARATION_VERSION } from "./campaign-goal-preparation.ts";
import { hasCompletedLocalPreparation } from "./campaign-preparation-completion.ts";
import { analyzeGoalPortfolio } from "./goal-portfolio-analysis.ts";
import { verifyGoalOutcomeReview } from "./goal-prelaunch.ts";
import { directPreparationIssues } from "./direct-preparation-check.ts";

/** Independent axes; none certify API acceptance, moderation, launch or a business outcome. */
export function assessGoalPrelaunch(bundle: FormationBundle, active: boolean) {
  const preparation = bundle.plan.goal_preparation;
  if (preparation?.version !== GOAL_OUTCOME_PREPARATION_VERSION) return null;
  const reviewIssues = verifyGoalOutcomeReview(bundle.plan, bundle.research, bundle.portfolio);
  const analysis = analyzeGoalPortfolio(preparation);
  const technicalIssues = directPreparationIssues(bundle.portfolio);
  const testScenario = bundle.research.mode === "TEST_SCENARIO";
  return {
    preparation: !active && bundle.portfolio.refinement_review && !reviewIssues.length && hasCompletedLocalPreparation(bundle.plan, bundle.portfolio.goal_review) ? "PERMITTED_PREPARATION_COMPLETE" as const : "NEEDS_WORK" as const,
    goal_support: testScenario ? "UNASSESSED" as const : analysis.conclusion === "OUTSIDE_SUPPLIED_BOUNDS" ? "CONSTRAINT_SHORTFALL" as const : analysis.forecast.supportsGoal ? "CONDITIONAL_SUPPORT" as const : "UNASSESSED" as const,
    technical: technicalIssues.length ? "BLOCKED" as const : "CHECKED" as const,
    technical_scope: "STATIC_PREPARATION_CHECKS_ONLY" as const,
    success_probability: null,
    conditions: bundle.portfolio.goal_review?.outcome_review?.requirements.filter(r => r.status === "CONDITION").map(r => r.explanation) ?? [],
    review_issues: reviewIssues, technical_issues: technicalIssues,
  };
}

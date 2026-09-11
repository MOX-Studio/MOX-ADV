import assert from "node:assert/strict";
import test from "node:test";
import { campaignOptimizationSchema, verifyCampaignOptimization } from "../lib/campaign-optimization.ts";
import { validateFormationShape } from "../lib/campaign-formation-method.ts";
import { formationEvidence, formationPlan, formationPortfolio } from "./fixtures/campaign-formation-fixture.mjs";
import { goalPreparationFixture } from "./fixtures/goal-preparation-fixture.mjs";

function fixture() {
  const research = formationEvidence("snapshot").research;
  const goal = { goal_revision_id: "goal:r1", customer_geography: "Россия", qualified_action: "Заявка компании", success_criterion: { target_count: 30, deadline: "2027-06-30", total_budget_rub: 30000 } };
  const values = { target_audience: "Промышленные компании", advertised_offer: "Участие со стендом", core_message: "Участие со стендом", weekly_budget: 30000, landing_page: "https://owner.example/", qualified_result: goal.qualified_action };
  const plan = formationPlan(values, research);
  plan.goal_preparation = goalPreparationFixture(plan, goal, ["snapshot"], { start_date: "2026-09-09", end_date: "2027-06-30" });
  const copy = { sources: [{ source_ref: "strategy:advertised_offer", purpose: "OFFER", text: values.advertised_offer }] };
  const portfolio = formationPortfolio({ context: { formation_plan: plan, content_context: copy, campaign_optimization: {} } });
  return { plan, research, portfolio, review: portfolio.optimization_review, verify: () => verifyCampaignOptimization(plan, research, portfolio) };
}

test("comparison stays bound to actual targeting, copy, assets, landing, delivery, and shared budget", () => {
  const edits = [
    f => f.portfolio.campaigns[0].groups[0].negative_keywords.push("посетитель"),
    f => f.portfolio.campaigns[0].groups[0].ads[0].texts[0] = "Другой призыв",
    f => f.portfolio.campaigns[0].groups[0].ads[0].extensions.callouts.push({ text: "Условия", source_refs: [] }),
    f => f.plan.landing.qualification_fields.push("Срок участия"),
    f => f.portfolio.campaigns[0].bidding.average_cpc_rub = 90,
    f => f.plan.goal_preparation.goal.deadline = "2027-07-01",
  ];
  for (const edit of edits) {
    const f = fixture(); assert.deepEqual(f.verify(), []); edit(f);
    assert(f.verify().some(v => v.code === "OPTIMIZATION_SELECTION_CHANGED"));
  }
});

test("a renamed comparison or invented rejection does not replace an actual alternative", () => {
  const f = fixture(), copy = f.review.groups[0].parameters.find(p => p.parameter === "OFFER_AND_COPY");
  copy.alternatives[0].value_json = copy.selected_value_json;
  assert(f.verify().some(v => v.code === "OPTIMIZATION_ALTERNATIVE_IDENTICAL"));
  assert(f.verify().some(v => v.code === "OPTIMIZATION_REJECTED_COPY_MISSING"));
  copy.decision = "HELD"; copy.alternatives = [];
  assert(f.verify().some(v => v.code === "OPTIMIZATION_COPY_NOT_COMPARED"));
});

test("preparation defects cannot become limitations and unknown performance cannot become a repaired winner", () => {
  const f = fixture();
  const issue = { id: "I1", kind: "PREPARATION_DEFECT", status: "ACCEPTED_LIMITATION", finding: "Не устранён недостаток", action: "Сохранить", affected_ids: ["G1"], evidence_refs: [], repair: null };
  f.review.issues.push(issue);
  assert(f.verify().some(v => v.code === "OPTIMIZATION_REWORK_REQUIRED"));
  issue.kind = "PERFORMANCE_UNKNOWN";
  assert.deepEqual(f.verify(), []);
  issue.status = "REPAIRED";
  assert(f.verify().some(v => v.code === "OPTIMIZATION_FALSE_PERFORMANCE_REPAIR"));
  issue.kind = "PREPARATION_DEFECT";
  const value = f.review.groups[0].parameters[0].selected_value_json;
  issue.repair = { group_id: "G1", parameter: "AUDIENCE_AND_INTENT", before_value_json: value, after_value_json: value };
  assert(f.verify().some(v => v.code === "OPTIMIZATION_REPAIR_NOT_IMPLEMENTED"));
  f.review.basis = "MEASURED_WINNER";
  assert(validateFormationShape(campaignOptimizationSchema(["snapshot"]), f.review).length > 0);
});

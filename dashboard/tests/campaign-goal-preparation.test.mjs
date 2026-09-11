import assert from "node:assert/strict";
import test from "node:test";
import { GOAL_PREPARATION_VERSION, calculateGoalForecast, verifyGoalPreparation } from "../lib/campaign-goal-preparation.ts";
import { formationPlanSchema, validateFormationShape } from "../lib/campaign-formation-method.ts";
import { verifyFormationPortfolio, formationDirectGraph } from "../lib/campaign-formation-portfolio.ts";
import { formationEvidence, formationPlan, formationPortfolio } from "./fixtures/campaign-formation-fixture.mjs";
import { goalPreparationFixture, preparationDecisionFixture } from "./fixtures/goal-preparation-fixture.mjs";
import { verifyCampaignOpportunitySearch } from "../lib/campaign-opportunity-search.ts";

const goal = { goal_revision_id: "goal:r1", customer_geography: "Россия", qualified_action: "Заявка компании", success_criterion: { target_count: 30, deadline: "2027-06-30", total_budget_rub: 30000 } };

test("v3 retains 1001 campaigns and 1001 ads in a group without dropping relationships", async () => {
  const { plan, research, portfolio, copy } = fixture();
  const { goalReviewFixture } = await import("./fixtures/goal-preparation-fixture.mjs");
  const count = 1001, baseDirection = structuredClone(plan.directions[0]), baseCampaign = structuredClone(portfolio.campaigns[0]);
  const budget = i => i === count - 1 ? 30000 - 29 * (count - 1) : 29;
  plan.directions = Array.from({ length: count }, (_, i) => ({ ...structuredClone(baseDirection), id: `D${i + 1}`, name: `Isolated campaign ${i + 1}`, intent: `Isolated buyer intent ${i + 1}`, weekly_budget_rub: budget(i) }));
  plan.decisions[0].target_ids = plan.directions.map(d => d.id);
  plan.goal_preparation = goalPreparationFixture(plan, goal, ["snapshot"], period);
  portfolio.campaigns = plan.directions.map((d, i) => {
    const c = structuredClone(baseCampaign); c.id = `C${i + 1}`; c.direction_id = d.id; c.name = d.name; c.weekly_budget_rub = d.weekly_budget_rub;
    c.allocations[0].cap_rub = plan.goal_preparation.directions[i].budget_rub;
    c.groups[0].id = `G${i + 1}`; c.groups[0].allocations[0].cap_rub = c.allocations[0].cap_rub;
    c.groups[0].keywords[0].phrase = `участие компании ${i + 1}`;
    c.groups[0].ads.forEach((a, n) => { a.id = `C${i + 1}-A${n + 1}`; a.url = `${plan.landing.url}?utm_campaign=c${i + 1}&utm_content=a${n + 1}`; if (i) a.variant_id = null; });
    return c;
  });
  const group = portfolio.campaigns[0].groups[0], baseAd = structuredClone(group.ads[0]);
  for (let i = 2; i < 1001; i++) group.ads.push({ ...structuredClone(baseAd), id: `C1-A${i + 1}`, texts: [`Изолированный вариант ${i + 1}.`], variant_id: null, url: `${plan.landing.url}?utm_campaign=c1&utm_content=a${i + 1}` });
  portfolio.applications[0].target_ids = portfolio.campaigns.map(c => c.id);
  portfolio.goal_review = goalReviewFixture(portfolio, plan, copy);
  portfolio.goal_review.groups.forEach(g => g.reuse_reason = "Изолированная проверка сохранения графа, не реальные объявления.");
  assert.deepEqual(validateFormationShape(formationPlanSchema(["snapshot"], true), plan), []);
  assert.deepEqual(verifyGoalPreparation(plan.goal_preparation, plan, goal, period, research), []);
  const checked = verifyFormationPortfolio({ proposal: portfolio, plan, research, copy, allowedRefs: ["snapshot"], snapshot: {}, checkCopy: false });
  assert.equal(checked.campaigns.length, 1001); assert.equal(checked.campaigns[0].groups[0].ads.length, 1001);
  assert.equal(checked.goal_review.groups.length, 1001);
  assert.equal(checked.goal_review.groups[0].candidates.filter(c => c.disposition === "SELECTED").length, 1001);
  assert.equal(checked.applications[0].target_ids.length, 1001);
  assert.equal(checked.campaigns.reduce((sum, c) => sum + c.allocations[0].cap_rub, 0), 30000);
});
test("v3 rejects an unviable selected opportunity or an omitted viable contribution", () => {
  const { plan, research } = fixture(), search = plan.goal_preparation.portfolio_search;
  search.candidates[0].viability.status = "NEEDS_EVIDENCE";
  assert.ok(verifyGoalPreparation(plan.goal_preparation, plan, goal, period, research).some(v => v.code === "OPPORTUNITY_NOT_VIABLE"));
  search.candidates[0].viability.status = "VIABLE";
  search.candidates[1].viability.status = "VIABLE"; search.candidates[1].viability.contribution = "LOWER_COST";
  assert.ok(verifyGoalPreparation(plan.goal_preparation, plan, goal, period, research).some(v => v.code === "OPPORTUNITY_USEFUL_CANDIDATE_OMITTED"));
  search.candidates[1].viability.contribution = "NONE";
  assert.deepEqual(verifyGoalPreparation(plan.goal_preparation, plan, goal, period, research), []);
});
test("v3 minimizes spending among comparably supported plans, not by a scenario threshold alone", () => {
  const { plan, research } = fixture(), p = plan.goal_preparation;
  completeForecast(p);
  p.forecast.inputs[0].cpc_rub = estimate(50, 50);
  p.forecast.inputs[0].obtainable_clicks = estimate(1000, 1000);
  const cheaper = p.forecast.allocation_options.find(o => o.id === "less");
  assert.equal(calculateGoalForecast(p, cheaper.allocations).supportsGoal, true);
  assert.ok(verifyGoalPreparation(p, plan, goal, period, research).some(v => v.code === "GOAL_CHEAPER_PLAN_SUPPORTS_TARGET"));
  cheaper.goal_support_vs_selected = "WEAKER";
  cheaper.rationale = "Изолированное решение контроллера: минимальный вариант едва покрывает сценарное количество, а выбранный сохраняет запас по результатам. Случайная вариативность этим сценарием не измерена; равные шансы не установлены.";
  assert.deepEqual(verifyGoalPreparation(p, plan, goal, period, research), []);
  cheaper.goal_support_vs_selected = "UNASSESSED";
  assert.ok(verifyGoalPreparation(p, plan, goal, period, research).some(v => v.code === "GOAL_SPEND_RELIABILITY_UNASSESSED"));
});
const period = { start_date: "2026-09-09", end_date: "2026-10-08" };
function fixture() {
  const research = formationEvidence("snapshot").research;
  const values = { target_audience: "Промышленные компании", advertised_offer: "Участие со стендом", core_message: "Участие со стендом", weekly_budget: 30000, landing_page: "https://owner.example/", qualified_result: goal.qualified_action };
  const plan = formationPlan(values, research);
  plan.goal_preparation = goalPreparationFixture(plan, goal, ["snapshot"], period);
  const copy = { sources: [{ source_ref: "strategy:advertised_offer", purpose: "OFFER", text: values.advertised_offer, evidence_refs: ["snapshot"], admissible_copy_units: [values.advertised_offer] }], safe_call_to_action_units: ["Узнайте подробности", "Оставьте заявку на сайте"] };
  const portfolio = formationPortfolio({ context: { formation_plan: plan, content_context: copy } });
  const verify = (proposal = portfolio) => verifyFormationPortfolio({ proposal, plan, research, copy, allowedRefs: ["snapshot"], snapshot: {} });
  return { plan, research, portfolio, copy, verify };
}
const hasCode = expected => error => error.violations?.some(v => v.code === expected);
const estimate = (low, high) => ({ range: { low, high }, basis: "INFERENCE", evidence_refs: ["snapshot"], explanation: "Изолированная проверка сценарной арифметики и границ, не реальные наблюдения." });
function completeForecast(preparation) {
  preparation.forecast.scope = "FULL_GOAL";
  preparation.forecast.duplicate_result_percent = estimate(0, 0);
  preparation.forecast.result_before_deadline_percent = estimate(100, 100);
  Object.assign(preparation.forecast.inputs[0], { cpc_rub: estimate(50, 100), click_to_qualified_percent: estimate(10, 20), obtainable_clicks: estimate(300, 500) });
}

test("new preparation requires comparison but historical plans remain readable", () => {
  const { plan } = fixture();
  assert.deepEqual(validateFormationShape(formationPlanSchema(["snapshot"], true), plan), []);
  delete plan.goal_preparation;
  assert.deepEqual(validateFormationShape(formationPlanSchema(["snapshot"]), plan), []);
  assert.ok(validateFormationShape(formationPlanSchema(["snapshot"], true), plan).length);
});
test("changing quantity, deadline, price or result cannot improve the declared feasibility", () => {
  const { plan } = fixture();
  assert.deepEqual(verifyGoalPreparation(plan.goal_preparation, plan, goal, period), []);
  for (const [key, value] of Object.entries({ target_count: 1, deadline: "2029-01-01", total_budget_rub: 100000, qualified_result: "Отправка формы", revision_id: "different" })) {
    const p = structuredClone(plan.goal_preparation); p.goal[key] = value;
    assert.ok(verifyGoalPreparation(p, plan, goal, period).some(v => v.code === "GOAL_PREPARATION_GOAL_CHANGED"), key);
  }
});
test("period, directions and budget stay bound to the actual strategy", () => {
  const { plan } = fixture(); const original = plan.goal_preparation;
  const cases = [
    [p => p.forecast.period.end_date = "2027-06-30", "GOAL_FORECAST_PERIOD_INVALID"],
    [p => p.forecast.inputs = [], "GOAL_DIRECTION_MISSING"],
    [p => p.directions[0].budget_rub++, "GOAL_BUDGET_MISMATCH"],
    [p => p.selected_alternative_id = "missing", "GOAL_ALTERNATIVE_INVALID"],
    [p => p.alternatives[1] = { ...p.alternatives[0], id: "other" }, "GOAL_ALTERNATIVES_IDENTICAL"],
  ];
  for (const [change, code] of cases) { const p = structuredClone(original); change(p); assert.ok(verifyGoalPreparation(p, plan, goal, period).some(v => v.code === code), code); }
});
test("estimates cannot invent an observed number, invert a range or exceed 100 percent", () => {
  const { plan } = fixture(); const p = plan.goal_preparation;
  p.forecast.inputs[0].cpc_rub = estimate(100, 50);
  assert.ok(verifyGoalPreparation(p, plan, goal, period).some(v => v.code === "GOAL_ESTIMATE_RANGE_INVALID"));
  p.forecast.inputs[0].cpc_rub = estimate(50, 100); p.forecast.inputs[0].cpc_rub.evidence_refs = [];
  assert.ok(verifyGoalPreparation(p, plan, goal, period).some(v => v.code === "GOAL_ESTIMATE_BASIS_INVALID"));
  p.forecast.inputs[0].cpc_rub.basis = "UNKNOWN";
  assert.ok(verifyGoalPreparation(p, plan, goal, period).some(v => v.code === "GOAL_ESTIMATE_BASIS_INVALID"));
  p.forecast.inputs[0].click_to_qualified_percent = estimate(50, 101);
  assert.ok(verifyGoalPreparation(p, plan, goal, period).some(v => v.code === "GOAL_ESTIMATE_RANGE_INVALID"));
});
test("demand caps limit the scenario; missing and zero outcomes never establish success", () => {
  const { plan } = fixture(); const p = plan.goal_preparation;
  assert.equal(calculateGoalForecast(p).results, null);
  completeForecast(p); let f = calculateGoalForecast(p);
  assert.deepEqual(f.rows[0].clicks, { low: 300, high: 500 });
  assert.deepEqual(f.results, { low: 30, high: 100 }); assert.deepEqual(f.cost, { low: 300, high: 1000 }); assert.equal(f.supportsGoal, true); assert.equal(f.actuals, null);
  p.forecast.scope = "INITIAL_PERIOD"; assert.equal(calculateGoalForecast(p).supportsGoal, false);
  p.forecast.scope = "FULL_GOAL"; p.forecast.inputs[0].obtainable_clicks.range = { low: 10, high: 20 };
  assert.deepEqual(calculateGoalForecast(p).results, { low: 1, high: 4 }); assert.equal(calculateGoalForecast(p).supportsGoal, false);
  p.forecast.inputs[0].click_to_qualified_percent.range = { low: 0, high: 0 };
  f = calculateGoalForecast(p); assert.deepEqual(f.results, { low: 0, high: 0 }); assert.equal(f.cost, null); assert.equal(f.supportsGoal, false);
  p.forecast.inputs[0].obtainable_clicks.range = null; assert.equal(calculateGoalForecast(p).results, null);
});
test("unknown, partial-period and test scenarios cannot be presented as supporting the whole goal", () => {
  const { plan, portfolio, research, verify } = fixture();
  assert.equal(verify().goal_review.goal_attainment, "UNASSESSED");
  portfolio.goal_review.goal_attainment = "SUPPORTED_BY_ESTIMATE";
  assert.throws(() => verify(), hasCode("GOAL_ATTAINMENT_UNSUPPORTED"));
  completeForecast(plan.goal_preparation); assert.equal(verify().goal_review.goal_attainment, "SUPPORTED_BY_ESTIMATE");
  plan.goal_preparation.forecast.scope = "INITIAL_PERIOD"; assert.throws(() => verify(), hasCode("GOAL_ATTAINMENT_UNSUPPORTED"));
  plan.goal_preparation.forecast.scope = "FULL_GOAL"; research.mode = "TEST_SCENARIO";
  assert.throws(() => verify(), hasCode("GOAL_ATTAINMENT_UNSUPPORTED"));
});
test("every actual ad needs a matching selected candidate and a real rejected alternative", () => {
  const { portfolio, verify } = fixture();
  assert.equal(verify().goal_review.version, GOAL_PREPARATION_VERSION);
  const noReview = structuredClone(portfolio); delete noReview.goal_review;
  assert.throws(() => verify(noReview), hasCode("FORMATION_SHAPE_INVALID"));
  const missing = structuredClone(portfolio); missing.goal_review.groups[0].candidates.pop();
  assert.throws(() => verify(missing), hasCode("GOAL_CREATIVE_COMPARISON_MISSING"));
  const changed = structuredClone(portfolio); changed.goal_review.groups[0].candidates[0].texts = ["Участие со стендом."];
  assert.throws(() => verify(changed), hasCode("GOAL_SELECTED_CREATIVE_CHANGED"));
  const duplicate = structuredClone(portfolio); const variants = duplicate.goal_review.groups[0].candidates;
  variants[2] = { ...variants[0], id: "other", disposition: "REJECTED", ad_id: null };
  assert.throws(() => verify(duplicate), hasCode("GOAL_CREATIVE_ALTERNATIVES_IDENTICAL"));
  const inventedClaim = structuredClone(portfolio); inventedClaim.goal_review.groups[0].candidates[2].texts = ["Гарантируем продажи на миллион рублей."];
  assert.throws(() => verify(inventedClaim), hasCode("CONTENT_FACT_UNSUPPORTED"));
});
test("a critical finding or changed budget blocks completion even when the graph is valid", () => {
  const { portfolio, verify } = fixture();
  const blocker = structuredClone(portfolio); blocker.goal_review.checks[0].status = "BLOCKER";
  assert.throws(() => verify(blocker), hasCode("GOAL_REVIEW_NOT_READY"));
  const noIntentReview = structuredClone(portfolio); noIntentReview.goal_review.checks[0].area = noIntentReview.goal_review.checks[1].area;
  assert.throws(() => verify(noIntentReview), hasCode("GOAL_CRITICAL_REVIEW_MISSING"));
  const wrongGoal = structuredClone(portfolio); wrongGoal.goal_review.goal_revision_id = "other";
  assert.throws(() => verify(wrongGoal), hasCode("GOAL_REVIEW_STALE"));
  const changedBudget = structuredClone(portfolio); changedBudget.campaigns[0].allocations[0].cap_rub++;
  assert.throws(() => verify(changedBudget), hasCode("GOAL_REVIEW_BUDGET_CHANGED"));
});
test("generic copy reused across groups needs an explicit comparative justification", () => {
  const { portfolio, plan, verify } = fixture();
  plan.experiments = [];
  const original = portfolio.campaigns[0].groups[0]; original.ads.forEach(a => a.variant_id = null);
  const second = structuredClone(original); second.id = "G2"; second.name = "Другая аудитория";
  second.keywords[0].phrase = "участие компании в выставке";
  second.allocations[0].cap_rub = 15000; original.allocations[0].cap_rub = 15000;
  second.ads.forEach((a, i) => { a.id = `B${i + 1}`; a.url = `https://owner.example/?utm_campaign=c1&utm_content=b${i + 1}`; });
  portfolio.campaigns[0].groups.push(second);
  const review = structuredClone(portfolio.goal_review.groups[0]); review.group_id = "G2";
  review.candidates.forEach((c, i) => { c.id = `second-${c.id}`; if (c.disposition === "SELECTED") c.ad_id = `B${i + 1}`; });
  portfolio.goal_review.groups.push(review);
  assert.throws(() => verify(), hasCode("GOAL_CREATIVE_REUSE_UNEXPLAINED"));
  portfolio.goal_review.groups.forEach(g => g.reuse_reason = "Обе группы выбирают тот же формат; отраслевое обещание не подтверждено. Проверено, что общий оффер сохраняет точность.");
  assert.equal(verify().campaigns[0].groups.length, 2);
});
test("opportunity search must continue after the first campaign and implement all selected opportunities", () => {
  const { plan, research } = fixture(); const search = plan.goal_preparation.portfolio_search;
  assert.deepEqual(verifyCampaignOpportunitySearch(search, plan, research), []);
  const single = structuredClone(search); single.continuation.single_campaign_reason = null;
  assert.ok(verifyCampaignOpportunitySearch(single, plan, research).some(v => v.code === "OPPORTUNITY_SINGLE_CAMPAIGN_UNJUSTIFIED"));
  const stopped = structuredClone(search); stopped.continuation.considered_after_first = [];
  assert.ok(verifyCampaignOpportunitySearch(stopped, plan, research).some(v => v.code === "OPPORTUNITY_CONTINUATION_MISSING"));
  const omitted = structuredClone(search); omitted.candidates[1].disposition = "SELECTED"; omitted.candidates[1].direction_id = "unimplemented";
  assert.ok(verifyCampaignOpportunitySearch(omitted, plan, research).some(v => v.code === "OPPORTUNITY_SELECTED_NOT_IMPLEMENTED"));
  const unresolved = structuredClone(search); unresolved.investigations[0].status = "OPEN";
  assert.ok(verifyCampaignOpportunitySearch(unresolved, plan, research).some(v => v.code === "OPPORTUNITY_MATERIAL_RESEARCH_OPEN"));
});
test("duplicates and delayed qualification reduce the goal contribution", () => {
  const { plan } = fixture(); const p = plan.goal_preparation; completeForecast(p);
  assert.equal(calculateGoalForecast(p).supportsGoal, true);
  p.forecast.duplicate_result_percent = estimate(10, 20);
  p.forecast.result_before_deadline_percent = estimate(50, 80);
  const result = calculateGoalForecast(p);
  assert.deepEqual(result.rawResults, { low: 30, high: 100 });
  assert.deepEqual(result.results, { low: 12, high: 72 }); assert.equal(result.supportsGoal, false);
  p.forecast.duplicate_result_percent.range = null; assert.equal(calculateGoalForecast(p).results, null);
});
test("the minimum-spend objective rejects a selected allocation when a cheaper compared option reaches the goal", () => {
  const { plan, research } = fixture(); const p = plan.goal_preparation; completeForecast(p);
  p.forecast.inputs[0].click_to_qualified_percent = estimate(30, 40);
  assert.ok(verifyGoalPreparation(p, plan, goal, period, research).some(v => v.code === "GOAL_CHEAPER_PLAN_SUPPORTS_TARGET"));
  const changed = structuredClone(plan); changed.budget.total_cap_rub = 15000; changed.budget.phases[0].cap_rub = 15000;
  changed.goal_preparation.directions[0].budget_rub = 15000;
  changed.goal_preparation.forecast.selected_allocation_id = "less";
  changed.goal_preparation.forecast.allocation_options.push({ id: "lower", allocations: [{ budget_rub: 5000, direction_id: "D1" }], rationale: "Проверено ещё меньшее расходование" });
  assert.deepEqual(verifyGoalPreparation(changed.goal_preparation, changed, goal, period, research), []);
  assert.equal(calculateGoalForecast(changed.goal_preparation).unallocatedBudgetRub, 15000);
});
test("grounded extensions survive the full local graph and unknown destinations are rejected", () => {
  const { plan, research, portfolio, verify } = fixture();
  const ad = portfolio.campaigns[0].groups[0].ads[0];
  ad.extensions = { sitelinks: [{ title: "Участие со стендом", description: "", url: plan.landing.url, source_refs: ["strategy:advertised_offer"] }], callouts: [{ text: "Участие со стендом", source_refs: ["strategy:advertised_offer"] }], reason: "Доступ к подтверждённым условиям участия" };
  verify();
  const graph = formationDirectGraph({ method: "evidence-to-campaign-v1", plan, research, portfolio, campaign_id: "C1" }, period, "Россия");
  assert.deepEqual(graph.ads[0].template_extensions, ad.extensions);
  ad.extensions.sitelinks[0].url += "#invented";
  assert.throws(() => verify(), hasCode("SITELINK_DESTINATION_UNVERIFIED"));
  ad.extensions.sitelinks[0].url = plan.landing.url; ad.extensions.callouts[0].text = "Гарантируем продажи";
  assert.throws(() => verify(), hasCode("CONTENT_FACT_UNSUPPORTED"));
});

test("explicit cold-start completion preserves unknowns, exact qualified result and existing budget", () => {
  const { plan, portfolio, verify } = fixture(); plan.goal_preparation.forecast.scope = "FULL_GOAL";
  portfolio.goal_review.preparation_decision = preparationDecisionFixture(plan);
  assert.equal(verify().goal_review.goal_attainment, "UNASSESSED");
  for (const [code, mutate] of [
    ["PREPARATION_UNKNOWN_OMITTED", d => d.remaining_unknowns.pop()],
    ["PREPARATION_RESULT_CHANGED", d => d.validation_plan.qualified_result = "Любая форма"],
    ["PREPARATION_VALIDATION_BUDGET_INVALID", d => d.validation_plan.maximum_spend_rub++],
    ["PREPARATION_MEASUREMENT_INCOMPLETE", d => d.validation_plan.observations[4].field = "CLICKS"],
  ]) { const candidate = structuredClone(portfolio); mutate(candidate.goal_review.preparation_decision); assert.throws(() => verify(candidate), hasCode(code)); }
  plan.goal_preparation.forecast.scope = "INITIAL_PERIOD";
  assert.throws(() => verify(), hasCode("PREPARATION_GOAL_SCOPE_INCOMPLETE"));
});

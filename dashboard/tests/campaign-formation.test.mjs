import assert from "node:assert/strict";
import test from "node:test";
import { formationResearchSchema, validateFormationShape, verifyFormationResearch, verifyFormationPlan, calculateFormationModel } from "../lib/campaign-formation-method.ts";
import { verifyFormationPortfolio } from "../lib/campaign-formation-portfolio.ts";
import { formationEvidence, formationPlan, formationPortfolio } from "./fixtures/campaign-formation-fixture.mjs";

const values = { target_audience: "Промышленные компании", advertised_offer: "Участие со стендом", core_message: "Участие со стендом", weekly_budget: 30000, landing_page: "https://owner.example/", qualified_result: "Заявка компании" };
function fixture() {
  const research = formationEvidence("snapshot", { test: true }).research;
  const plan = formationPlan(values, research);
  const copy = { sources: [{ source_ref: "strategy:advertised_offer", purpose: "OFFER", text: values.advertised_offer, evidence_refs: ["snapshot"], admissible_copy_units: [values.advertised_offer] }], safe_call_to_action_units: ["Узнайте подробности", "Оставьте заявку на сайте"] };
  const portfolio = formationPortfolio({ context: { formation_plan: plan, content_context: copy } });
  const verify = (proposal = portfolio, snapshot = {}) => verifyFormationPortfolio({ proposal, plan, research, copy, allowedRefs: ["snapshot"], snapshot });
  return { research, plan, copy, portfolio, verify };
}
const code = expected => error => error.violations?.some(v => v.code === expected);
test("raw Wordstat observations retain the declared period from their nested scope", () => {
  const f = fixture(), keyword = f.portfolio.campaigns[0].groups[0].keywords[0];
  Object.assign(keyword, { state: "OBSERVED_BROAD", count: 20, period: "08.08.2026 — 08.09.2026", observation_ref: "observed:raw" });
  const source = { observations: [{ observation_id: "observed:raw", exact_query: keyword.phrase, operator_profile: "BROAD_CONTAINING", scope: { declared_window: `Топ частотных запросов «${keyword.phrase}», ${keyword.period}, Россия, все устройства` }, rows: [{ phrase: keyword.phrase, count: 20 }] }] };
  f.verify(f.portfolio, source);
  keyword.period = "01.01.2026 — 31.01.2026";
  assert.throws(() => f.verify(f.portfolio, source), code("KEYWORD_SCOPE_CHANGED"));
});
test("all research areas and more than sixteen material findings are preserved", () => {
  const evidence = formationEvidence("snapshot");
  for (let i = 11; i <= 60; i++) evidence.research.findings.push({ id: `F${i}`, area: "offer", finding: `Условие предложения ${i}`, state: "OBSERVED", evidence_refs: ["snapshot"], limitation: "Нужна проверка применимости" });
  evidence.research.coverage[0].finding_ids = evidence.research.findings.filter(f => f.area === "offer").map(f => f.id);
  assert.deepEqual(validateFormationShape(formationResearchSchema(["snapshot"], []), evidence), []);
  verifyFormationResearch(evidence.research);
  evidence.research.coverage[0].finding_ids.pop();
  assert.throws(() => verifyFormationResearch(evidence.research), code("FINDING_OMITTED"));
});
test("strategy rejects an omitted finding and a fabricated place of application", () => {
  const { plan, research } = fixture();
  const verify = p => verifyFormationPlan(p, research, 30000, values.landing_page, values.qualified_result);
  verify(plan); const missing = structuredClone(plan); missing.decisions.pop(); assert.throws(() => verify(missing), code("RESEARCH_DECISION_MISSING"));
  const invented = structuredClone(plan); invented.decisions[0].target_ids = ["missing-group"]; assert.throws(() => verify(invented), code("DECISION_TARGET_INVALID"));
});
test("test inputs require declared mode and exact numeric provenance", () => {
  const { research, plan } = fixture();
  const hidden = structuredClone(research); hidden.mode = "REAL_INPUTS";
  assert.throws(() => verifyFormationResearch(hidden), code("TEST_DATA_UNDECLARED"));
  plan.planning_inputs[0].value = 900000;
  assert.throws(() => verifyFormationPlan(plan, research, 30000, values.landing_page, values.qualified_result), code("TEST_DATA_PROVENANCE_INVALID"));
});
test("complete ads implement variants with distinct attribution and balanced budgets", () => {
  const { verify, portfolio } = fixture();
  assert.equal(verify().campaigns[0].groups[0].ads.length, 2);
  const missing = structuredClone(portfolio); missing.campaigns[0].groups[0].ads.pop(); assert.throws(() => verify(missing), code("VARIANT_NOT_IMPLEMENTED"));
  const overspend = structuredClone(portfolio); overspend.campaigns[0].groups[0].allocations[0].cap_rub++; assert.throws(() => verify(overspend), code("GROUP_BUDGET_SUM_MISMATCH"));
  const duplicate = structuredClone(portfolio); duplicate.campaigns[0].groups[0].ads[1].url = duplicate.campaigns[0].groups[0].ads[0].url; assert.throws(() => verify(duplicate), code("AD_ATTRIBUTION_DUPLICATE"));
});
test("unknown, no rows and observed zero remain different, with exact period and matching", () => {
  const { verify, portfolio } = fixture();
  const key = portfolio.campaigns[0].groups[0].keywords[0];
  key.count = 0; assert.throws(() => verify(), code("KEYWORD_UNKNOWN_IS_NOT_ZERO"));
  key.state = "OBSERVED_BROAD"; key.observation_ref = "obs1"; key.period = "01.08.2026 — 01.09.2026";
  const snapshot = { observations: [{ observation_id: "obs1", declared_window: key.period, operator_profile: "BROAD_CONTAINING", result_state: "ROWS_RETURNED", rows: [{ phrase: key.phrase, count: 0 }] }] };
  assert.equal(verify(portfolio, snapshot).campaigns[0].groups[0].keywords[0].count, 0);
  key.state = "OBSERVED_EXACT"; assert.throws(() => verify(portfolio, snapshot), code("KEYWORD_SCOPE_CHANGED"));
  key.state = "NO_ROWS_RETURNED"; key.count = null; assert.throws(() => verify(portfolio, snapshot), code("KEYWORD_UNKNOWN_IS_NOT_ZERO"));
  snapshot.observations[0] = { observation_id: "obs1", exact_query: key.phrase, result_state: "NO_ROWS_RETURNED", declared_window: key.period };
  assert.equal(verify(portfolio, snapshot).campaigns[0].groups[0].keywords[0].count, null);
});
test("test values cannot certify an advertising claim", () => {
  const { portfolio, verify } = fixture();
  portfolio.campaigns[0].groups[0].ads[0].source_refs = ["T1"];
  assert.throws(() => verify(), code("FORMATION_SHAPE_INVALID"));
  portfolio.campaigns[0].groups[0].ads[0].source_refs = ["strategy:advertised_offer"];
  portfolio.campaigns[0].groups[0].ads[0].titles = ["Гарантия прибыли 100000 рублей"];
  assert.throws(() => verify(), code("CONTENT_FACT_UNSUPPORTED"));
});
test("network and return campaigns use themes and segments instead of keyword copies", () => {
  const { plan, portfolio, verify } = fixture();
  plan.experiments = []; const c = portfolio.campaigns[0]; c.groups[0].ads.forEach(a => a.variant_id = null);
  plan.directions[0].channel = "NETWORK"; c.channel = "NETWORK"; c.autotargeting = "OFF";
  c.groups[0].keywords = []; c.groups[0].themes = ["Промышленное оборудование"];
  portfolio.images = [{ id: "I1", url: "/campaign-assets/test.png", alt: "Демонстрация", origin: "Тестовая иллюстрация", rights: "Локальная проверка" }]; c.groups[0].ads.forEach(a => a.image_ids = ["I1"]);
  assert.equal(verify().campaigns[0].channel, "NETWORK");
  plan.directions[0].channel = "RETARGETING"; c.channel = "RETARGETING";
  portfolio.segments = [{ id: "S1", rule: "Посетитель условий", lookback_days: 30, readiness: "NOT_CREATED", evidence_refs: [] }];
  c.groups[0].include_segments = ["S1"];
  assert.throws(() => verify(), code("RETARGETING_BROADENED"));
  c.groups[0].themes = []; assert.equal(verify().segments[0].readiness, "NOT_CREATED");
  portfolio.segments[0].readiness = "VERIFIED"; assert.throws(() => verify(), code("SEGMENT_FALSE_READY"));
});

test("scenario arithmetic separates conditional reserve and propagates missing economics", () => {
  const { plan } = fixture();
  plan.planning_inputs = Object.entries({ CPC: 100, CTR: 5, FORM_CR: 10, QUALIFICATION_RATE: 50, CLOSE_RATE: 10, MARGIN: 10000 }).map(([metric, value]) => ({ id: metric, metric, direction_id: null, label: metric, value, state: "TEST_DATA", unit: "test", evidence_refs: [], test_data_id: metric }));
  const allocations = [{ direction_id: "A", spend: 10000, conditional: false }, { direction_id: "R", spend: 2000, conditional: true }];
  const base = calculateFormationModel(plan, allocations);
  assert.equal(base.spend, 12000); assert.equal(base.qualified, 6); assert.equal(base.actuals, null);
  const reserve = calculateFormationModel(plan, allocations, false);
  assert.equal(reserve.spend, 10000); assert.equal(reserve.qualified, 5); assert.equal(reserve.paid, 0.5);
  plan.planning_inputs.find(p => p.metric === "MARGIN").value = null;
  const partial = calculateFormationModel(plan, allocations);
  assert.equal(partial.qualified, 6); assert.equal(partial.contribution_after_ads, null); assert.ok(partial.missing.includes("A:MARGIN"));
});


test("keyword identity retains operators and rejects plain permutations without false negative blocking", () => {
  const f = fixture(), group = f.portfolio.campaigns[0].groups[0];
  f.portfolio.campaigns[0].negative_keywords = ["стендом"];
  assert.doesNotThrow(() => f.verify(), "A fully overlapping negative is ignored by Direct");
  group.keywords.push({ ...group.keywords[0], phrase: '!участие со стендом' });
  assert.doesNotThrow(() => f.verify(), "A word-form operator changes matching");
  group.keywords.push({ ...group.keywords[0], phrase: 'стендом со участие' });
  assert.throws(() => f.verify(), code("KEYWORD_DUPLICATE"));
});

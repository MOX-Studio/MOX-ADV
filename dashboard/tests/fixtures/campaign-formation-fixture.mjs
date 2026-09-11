import { keywordReviewFixture } from "./keyword-preparation-fixture.mjs";
import { FORMATION_AREAS } from "../../lib/campaign-formation-method.ts";
import { goalReviewFixture } from "./goal-preparation-fixture.mjs";
import { optimizationReviewFixture } from "./campaign-optimization-fixture.mjs";

export function formationEvidence(snapshotId, options = {}) {
  const findings = FORMATION_AREAS.map((area, i) => ({ id: `F${i + 1}`, area, finding: area === "offer" ? "На сайте есть предложение участия со стендом." : `Область ${area}: сведения требуют уточнения.`, state: area === "offer" ? "OBSERVED" : "UNKNOWN", evidence_refs: area === "offer" ? [snapshotId] : [], limitation: "Пример для проверки контракта, без вывода об эффективности." }));
  return { summary: "Предложение изучено, внутренние данные недоступны.", evidence_refs: [snapshotId], gap_refs: [], research: {
    mode: options.test ? "TEST_SCENARIO" : "REAL_INPUTS", findings,
    coverage: FORMATION_AREAS.map(area => ({ area, status: area === "offer" ? "RESEARCHED" : "UNAVAILABLE", finding_ids: findings.filter(f => f.area === area).map(f => f.id), explanation: "Проверен сохранённый источник; подробных данных нет." })),
    test_data: options.test ? [{ id: "T1", label: "Маржа договора", value: 100000, reason_unavailable: "CRM и расходы организатора не получены.", attempted_sources: ["Официальная страница: маржа не раскрыта"], affects: ["Плановая прибыль"] }] : [],
  } };
}
export function formationPlan(values, research) {
  return {
    directions: [{ id: "D1", name: "Участие со стендом", channel: "SEARCH", audience: values.target_audience, intent: "Запрос условий участия", offer: values.advertised_offer, message: values.core_message, weekly_budget_rub: values.weekly_budget, activation_condition: "После готовности измерения", finding_ids: ["F1"] }],
    decisions: research.findings.map(f => ({ finding_id: f.id, disposition: f.id === "F1" ? "APPLIED" : "DEFERRED", reason: f.id === "F1" ? "Предложение положено в основу кампании" : "Данных недостаточно", target_ids: f.id === "F1" ? ["D1"] : [] })),
    experiments: [{ id: "H1", question: "Какой призыв приводит подходящих заявителей?", variable: "Текст призыва", metric: values.qualified_result, activation_condition: "После подключения квалификации", comparison: "CONTROLLED_VARIANT", variants: [{ id: "H1-A", label: "Подробнее", direction_id: "D1" }, { id: "H1-B", label: "Заявка", direction_id: "D1" }], limitations: "Сравнение не проводилось" }],
    budget: { total_cap_rub: values.weekly_budget, phases: [{ id: "P1", label: "Первая неделя", cap_rub: values.weekly_budget, release_condition: "После подготовки" }], reserve_rule: "Не расходовать без готовых условий" },
    landing: { url: values.landing_page, required_fields: ["Компания", "Контакт"], qualification_fields: ["Продукт"], proof: "Показать подтверждённое предложение", missing: ["Проверка настоящей заявки"] },
    measurement: { qualified_result: values.qualified_result, paid_result: "Оплаченный договор", attribution: "UTM → заявка → договор", crm_status: "Не подключена", followup: "Ответить менеджеру", missing: ["CRM и цели"] },
    planning_inputs: research.mode === "TEST_SCENARIO" ? [{ id: "margin", label: "Маржа договора", value: 100000, unit: "₽", state: "TEST_DATA", evidence_refs: [], test_data_id: "T1" }] : [],
  };
}
export function formationPortfolio(task) {
  const plan = task.context.formation_plan, context = task.context.content_context;
  const offer = context.sources.find(s => s.source_ref === "strategy:advertised_offer");
  const sourceRefs = [offer.source_ref];
  const portfolio = {
    campaigns: [{ id: "C1", name: "Участие со стендом", direction_id: "D1", channel: "SEARCH", weekly_budget_rub: plan.directions[0].weekly_budget_rub,
      allocations: [{ phase_id: "P1", cap_rub: plan.budget.total_cap_rub }], activation_condition: "После проверки целей и источников", bidding: { type: "MAX_CLICKS", initial_bid_rub: null, average_cpc_rub: null, rationale: "Изучить спрос в пределах бюджета" }, autotargeting: "TARGETED", negative_keywords: [], exclude_segments: [],
      groups: [{ id: "G1", name: "Запрос участия", intent: "Выбор формата участия компании", finding_ids: ["F1"], allocations: [{ phase_id: "P1", cap_rub: plan.budget.total_cap_rub }],
        keywords: [{ phrase: "участие со стендом", state: "CURATED_UNMEASURED", count: null, period: null, observation_ref: null, rationale: "Подбор намерения; частота неизвестна" }], themes: [], negative_keywords: [], include_segments: [], exclude_segments: [],
        ads: ["A", "B"].map((variant, i) => ({ id: `A${i + 1}`, titles: [offer.text], texts: [i ? "Оставьте заявку на сайте." : "Узнайте подробности."], url: plan.landing.url + `?utm_campaign=c1&utm_content=a${i + 1}`, source_refs: sourceRefs, image_ids: [], variant_id: `H1-${variant}`, valid_until: null })),
      }],
    }], images: [], segments: [], applications: [{ finding_id: "F1", target_ids: ["C1", "G1", "A1", "A2"], explanation: "Предложение использовано в группе и объявлениях" }], semantic_dispositions: [], selection_rationale: "Одно намерение соответствует имеющемуся предложению; другие требуют данных.",
  };
  if (plan.goal_preparation) {
    if (["goal-directed-preparation-v2", "goal-directed-preparation-v3", "goal-directed-preparation-v4"].includes(plan.goal_preparation.version)) portfolio.campaigns.forEach(c => c.groups.forEach(g => g.ads.forEach(a => { a.extensions = { sitelinks: [], callouts: [], reason: "В изолированном примере нет дополнительных проверенных предложений и разделов." }; })));
    portfolio.goal_review = goalReviewFixture(portfolio, plan, context);
  }
  if (task.context.campaign_optimization) portfolio.optimization_review = optimizationReviewFixture(plan, portfolio);
  if (task.context.keyword_preparation || task.context.formation_research?.keyword_research) portfolio.keyword_review = keywordReviewFixture(task.context.formation_research, portfolio);
  return portfolio;
}

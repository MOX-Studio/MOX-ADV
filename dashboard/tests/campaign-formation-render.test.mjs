import assert from "node:assert/strict";
import { readFile, writeFile, rm } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { formationEvidence, formationPlan, formationPortfolio } from "./fixtures/campaign-formation-fixture.mjs";
import { goalPreparationFixture } from "./fixtures/goal-preparation-fixture.mjs";
import { optimizationReviewFixture } from "./fixtures/campaign-optimization-fixture.mjs";
import { presentFormationResearch } from "../lib/formation-presentation.ts";
import { buyerSituation, presentDirection, strategyApproach } from "../lib/direction-presentation.ts";

function textOutsideDisclosures(html) {
  let depth = 0;
  const text = [];
  for (const token of html.match(/<[^>]*>|[^<]+/g) ?? []) {
    if (/^<details\b/.test(token)) depth++;
    else if (/^<\/details>/.test(token)) depth--;
    else if (!depth && !token.startsWith("<")) text.push(token);
  }
  return text.join(" ");
}

test("campaign simplification preserves test provenance, uncertainty, every object and actual decision destinations", async t => {
  const file = new URL(`../app/.formation-render-${process.pid}.mjs`, import.meta.url);
  const basisFile = new URL(`../app/.formation-basis-${process.pid}.mjs`, import.meta.url);
  const basisSource = (await readFile(new URL("../app/EvidenceBasis.tsx", import.meta.url), "utf8")).replace(/import (\w+) from "[^"]+\.css";/gu, 'const $1 = new Proxy({}, { get(_target, key) { return String(key); } });');
  await writeFile(basisFile, ts.transpileModule(basisSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText);
  t.after(() => rm(basisFile, { force: true }));
  const archiveFile = new URL(`../app/.formation-archive-${process.pid}.mjs`, import.meta.url);
  const archiveSource = (await readFile(new URL("../app/FormationArchive.tsx", import.meta.url), "utf8")).replace(/import (\w+) from "[^"]+\.css";/gu, 'const $1 = new Proxy({}, { get(_target, key) { return String(key); } });');
  await writeFile(archiveFile, ts.transpileModule(archiveSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText);
  t.after(() => rm(archiveFile, { force: true }));
  const prelaunchFile = new URL(`../app/.formation-prelaunch-${process.pid}.mjs`, import.meta.url);
  const prelaunchSource = (await readFile(new URL("../app/GoalPrelaunchStatus.tsx", import.meta.url), "utf8")).replace(/import (\w+) from "[^"]+\.css";/gu, 'const $1 = new Proxy({}, { get(_target, key) { return String(key); } });');
  await writeFile(prelaunchFile, ts.transpileModule(prelaunchSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText);
  t.after(() => rm(prelaunchFile, { force: true }));
  const source = (await readFile(new URL("../app/CampaignFormation.tsx", import.meta.url), "utf8"))
    .replace('import styles from "./campaign-formation.module.css";', 'const styles = new Proxy({}, { get(_target, key) { return String(key); } });')
    .replace('"./EvidenceBasis.tsx"', JSON.stringify(basisFile.href))
    .replace('"./GoalPrelaunchStatus.tsx"', JSON.stringify(prelaunchFile.href))
    .replace('"./FormationArchive.tsx"', JSON.stringify(archiveFile.href));
  await writeFile(file, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText);
  t.after(() => rm(file, { force: true }));
  const { FormationStrategyView, FormationResearchView, GoalPreparationSummary, FormationPortfolioView } = await import(file.href);
  const research = formationEvidence("snapshot", { test: true }).research;
  const plan = formationPlan({ target_audience: "Компания", advertised_offer: "Участие со стендом", core_message: "Участие", qualified_result: "Запрос", weekly_budget: 30000, landing_page: "https://owner.example/" }, research);
  const html = renderToStaticMarkup(React.createElement(FormationStrategyView, { plan, research }));
  assert.match(html, /Тестовый расчёт · используются условные значения/);
  assert.match(html, /100000/); assert.match(html, /учёт обращений и расходы организатора не получены/);
  assert.match(html, /Официальная страница: маржа не раскрыта/); assert.match(html, /Плановая прибыль/);
  assert.doesNotMatch(html, /<th>Факт<\/th>|data-formation-fact/);
  const findings = renderToStaticMarkup(React.createElement(FormationResearchView, { research, summary: formationEvidence("snapshot", { test: true }).summary }));
  assert.equal((findings.match(/data-finding-id=/g) ?? []).length, 10);
  assert.match(findings, /Предложение изучено, внутренние данные недоступны/);
  assert.match(findings, /data-formation-technical="true"><summary>Подробности исследования<\/summary>/);
  assert.match(findings, /data-research-row="offer"/);
  assert.equal((findings.match(/Стратегия формируется/g) ?? []).length, 1);
  assert.doesNotMatch(findings, /<th>Что это меняет<\/th>/);
  assert.match(findings, /Кейсы продвижения/); assert.match(findings, /Данные не получены/);
  assert.match(html, /data-goal-assessment="NOT_ASSESSED"/);
  const grouped = renderToStaticMarkup(React.createElement(FormationResearchView, { research, plan, presentation: { rows: [{ id: "offer", title: "Предложение", statement: research.findings[0].finding, impact: plan.decisions[0].reason, findingIds: ["F1"], sourceRefs: ["snapshot"], state: "OBSERVED", limitations: ["Сравнение не проводилось"] }] } }));
  assert.equal((grouped.match(/data-research-row=/g) ?? []).length, 1);
  assert.match(grouped, /<dt>Предложение<\/dt>/);
  assert.match(grouped, /Выводы и влияние на рекламу/);
  assert.ok(grouped.includes(plan.decisions[0].reason), "The decision impact remains available in research details");
  assert.equal((grouped.match(/data-finding-id=/g) ?? []).length, research.findings.length);
  assert.ok(grouped.indexOf("Сравнение не проводилось") < grouped.indexOf('data-formation-technical="true"'));
  const extensiveResearch = structuredClone(research);
  const additionalFindings = Array.from({ length: 41 }, (_, index) => ({
    id: `demand-${index}`, area: "demand", state: index === 40 ? "CONFLICT" : "OBSERVED",
    finding: `Наблюдение спроса ${index}. Дополнительный фрагмент сохранённого источника ${index}. Не подтверждает количество обращений ${index}.`,
    evidence_refs: [`source-${index}`], source_urls: [`https://owner.example/research/${index}`], limitation: index === 40 ? "Последний источник противоречит предыдущему измерению." : "",
  }));
  const observedDemandLimit = "Сумма наблюдённых строк — нижняя граница для указанного региона. Не отражает весь спрос и число обращений.";
  const unknownDemandLimit = "Частота отдельного запроса не получена. Нельзя считать её нулевой.";
  additionalFindings[0].limitation = observedDemandLimit;
  extensiveResearch.findings.find(finding => finding.area === "demand").limitation = unknownDemandLimit;
  extensiveResearch.findings.push(...additionalFindings);
  const savedBeforePresentation = structuredClone(extensiveResearch);
  const projection = presentFormationResearch(extensiveResearch);
  assert.deepEqual(extensiveResearch, savedBeforePresentation, "Presentation must not mutate saved findings");
  assert.deepEqual(new Set(projection.rows.flatMap(row => row.findingIds)), new Set(extensiveResearch.findings.map(item => item.id)), "Every finding must remain linked regardless of its position");
  const demandRow = projection.rows.find(row => row.id === "demand");
  assert.equal(demandRow.state, "CONFLICT");
  assert.ok(demandRow.limitations.includes("Последний источник противоречит предыдущему измерению."));
  assert.ok(demandRow.limitations.includes(observedDemandLimit), "Observed facts retain scoped lower-bound limitations");
  assert.ok(demandRow.limitations.includes(unknownDemandLimit), "Unknown frequencies cannot become zero through presentation");
  for (const finding of additionalFindings) {
    assert.ok(demandRow.sourceRefs.includes(finding.evidence_refs[0]));
    assert.ok(demandRow.statement.includes(finding.finding.split(". ")[0]));
  }
  const extensiveHtml = renderToStaticMarkup(React.createElement(FormationResearchView, { research: extensiveResearch }));
  assert.equal((extensiveHtml.match(/data-finding-id=/g) ?? []).length, extensiveResearch.findings.length);
  const primaryLimits = [...extensiveHtml.matchAll(/<ul class="[^"]*\browLimits\b[^"]*">([\s\S]*?)<\/ul>/g)].map(match => match[1]).join(" ");
  const numericFirst = { ...extensiveResearch, findings: [additionalFindings[0], ...extensiveResearch.findings.filter(f => f.id !== additionalFindings[0].id)] };
  const numericHtml = renderToStaticMarkup(React.createElement(FormationResearchView, { research: numericFirst }));
  const numericPrimary = numericHtml.slice(0, numericHtml.indexOf('data-formation-technical="true"'));
  assert.ok(numericPrimary.includes(additionalFindings[0].finding.split(". ")[0]), "The fixture displays the numerical observation in the compact primary view");
  assert.ok(numericPrimary.includes(observedDemandLimit.split(". ")[0]), "A visible numerical observation retains its lower-bound scope");
  assert.ok(primaryLimits.includes(unknownDemandLimit.split(". ")[0]), "Unknown frequency remains visibly unknown");
  const archiveHtml = extensiveHtml.slice(extensiveHtml.indexOf('data-formation-technical="true"'));
  assert.ok(archiveHtml.includes(observedDemandLimit), "The full limit remains available in details");
  assert.ok(archiveHtml.includes(unknownDemandLimit), "Details preserve that unknown frequency cannot be treated as zero");
  for (const finding of additionalFindings) {
    assert.ok(archiveHtml.includes(finding.finding), `Full archived finding lost: ${finding.id}`);
    assert.ok(archiveHtml.includes(finding.source_urls[0]), `Original source lost: ${finding.id}`);
  }


  const goal = { goal_revision_id: "goal:r1", customer_geography: "Россия", qualified_action: "Запрос", success_criterion: { target_count: 30, deadline: "2027-06-30", total_budget_rub: 30000 } };
  plan.goal_preparation = goalPreparationFixture(plan, goal, ["snapshot"], { start_date: "2026-09-09", end_date: "2026-10-08" });
  const budgetPlan = structuredClone(plan);
  budgetPlan.budget.total_cap_rub = 18000;
  budgetPlan.budget.phases = [{ id: "P1", label: "Первая фаза", cap_rub: 3000, release_condition: "После проверки" }, { id: "P2", label: "Остальной план", cap_rub: 15000, release_condition: "При подтверждении" }];
  const budgetHtml = renderToStaticMarkup(React.createElement(FormationStrategyView, { plan: budgetPlan, research }));
  const budgetSummary = budgetHtml.match(/<dl[^>]*aria-label="План расходов"[^>]*>([\s\S]*?)<\/dl>/)?.[1] ?? "";
  for (const amount of ["18", "30", "3", "12"]) assert.match(budgetSummary, new RegExp(`${amount}(?:\\u00a0| )000 ₽`), "Plan, total, first phase and unallocated money remain visible");
  const budgetText = budgetSummary.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  assert.match(budgetText, /План расходов до 18 000 ₽ из 30 000 ₽/, "Plan cap is distinguished from the owner's total budget");
  assert.match(budgetText, /Первый этап до 3 000 ₽/, "First-phase spend is a part of the plan");
  assert.match(budgetText, /Не распределено 12 000 ₽/, "Unallocated budget is not additional spending");
  assert.equal((budgetHtml.match(/data-formation-technical=/g) ?? []).length, 1);
  const unassessed = renderToStaticMarkup(React.createElement(GoalPreparationSummary, { plan }));
  assert.match(unassessed, /Не оценено/); assert.match(unassessed, /Подготовлен первый период\. Достижение всей количественной цели пока не обосновано/);
  const compactUnknown = renderToStaticMarkup(React.createElement(GoalPreparationSummary, { plan, compact: true }));
  assert.match(compactUnknown, /Прогноз/); assert.match(compactUnknown, /неизвестен/);
  assert.doesNotMatch(compactUnknown, /Расчёт поддерживает цель/);
  plan.goal_preparation.forecast.scope = "FULL_GOAL";
  const estimate = (low, high) => ({ range: { low, high }, basis: "INFERENCE", evidence_refs: ["snapshot"], explanation: "Изолированный сценарий для проверки отображения" });
  plan.goal_preparation.forecast.duplicate_result_percent = estimate(0, 0);
  plan.goal_preparation.forecast.result_before_deadline_percent = estimate(100, 100);
  Object.assign(plan.goal_preparation.forecast.inputs[0], { cpc_rub: estimate(50, 100), click_to_qualified_percent: estimate(10, 20), obtainable_clicks: estimate(300, 500) });
  const review = { recommendation: "BEST_SUPPORTED", goal_attainment: "SUPPORTED_BY_ESTIMATE", summary: "Рекомендация по рассмотренным вариантам", checks: [] };
  const supported = renderToStaticMarkup(React.createElement(GoalPreparationSummary, { plan, review }));
  assert.match(supported, /Расчёт поддерживает цель/); assert.match(supported, /30–100/); assert.match(supported, /Оценка по источникам/);
  const simulated = renderToStaticMarkup(React.createElement(GoalPreparationSummary, { plan, review, testScenario: true }));
  assert.match(simulated, /Тестовый расчёт/); assert.doesNotMatch(simulated, /Расчёт поддерживает цель/);
  const compactSimulated = renderToStaticMarkup(React.createElement(GoalPreparationSummary, { plan, review, testScenario: true, compact: true }));
  assert.match(compactSimulated, /Тестовый расчёт/); assert.match(compactSimulated, /не подтверждён/);
  assert.doesNotMatch(compactSimulated, /Расчёт поддерживает цель/);
  const portfolio = formationPortfolio({ context: { formation_plan: plan, content_context: { sources: [{ source_ref: "strategy:advertised_offer", text: "Участие со стендом" }] } } });
  const bundle = { method: "evidence-to-campaign-v1", campaign_id: "C1", research, plan, portfolio };
  const campaignHtml = renderToStaticMarkup(React.createElement(FormationPortfolioView, { bundle, active: false }));
  assert.doesNotMatch(campaignHtml, /Как агент выбрал объявления/, "Historical portfolios do not acquire a new review badge");
  const reviewed = structuredClone(bundle);
  reviewed.portfolio.optimization_review = optimizationReviewFixture(plan, reviewed.portfolio);
  reviewed.portfolio.optimization_review.issues.push({ id: "unknown-delay", kind: "PERFORMANCE_UNKNOWN", status: "ACCEPTED_LIMITATION", finding: "Срок подтверждения обращения неизвестен.", action: "Измерить срок до следующего распределения денег.", affected_ids: ["portfolio"], evidence_refs: [], repair: null });
  const reviewedHtml = renderToStaticMarkup(React.createElement(FormationPortfolioView, { bundle: reviewed, active: false }));
  assert.match(reviewedHtml, /Как агент выбрал объявления/);
  assert.match(reviewedHtml, /Предложение без следующего шага/);
  assert.match(reviewedHtml, /Главное возражение/);
  assert.match(reviewedHtml, /Отклик на рекламу ещё не измерен/);
  assert.doesNotMatch(reviewedHtml, /selected_value_json|value_json|PRELAUNCH_JUDGMENT|goal-campaign-optimization/);
  assert.ok(textOutsideDisclosures(reviewedHtml).includes("Срок подтверждения обращения неизвестен"), "Material unknowns remain visible outside the comparison archive");
  assert.match(campaignHtml, /Одно намерение соответствует имеющемуся предложению/);
  const campaignHeader = campaignHtml.match(/data-formation-campaign="C1"><summary(.*?)<\/summary>/s)?.[1] ?? "";
  assert.match(campaignHeader, /30(?:\u00a0| )000 ₽/);
  assert.ok(campaignHtml.includes(plan.directions[0].intent));
  assert.ok(campaignHtml.includes(plan.goal_preparation.portfolio_search.candidates[0].reason));
  for (const campaign of portfolio.campaigns) {
    const campaignTag = [...campaignHtml.matchAll(/<details\b[^>]*>/g)].find(match => match[0].includes(`data-formation-campaign="${campaign.id}"`));
    assert.ok(campaignTag, `Campaign has its own disclosure: ${campaign.id}`);
    assert.doesNotMatch(campaignTag[0], /\sopen(?:\s|=|>)/, "Campaign previews are initially collapsed");
    const campaignSummary = campaignHtml.slice(campaignTag.index + campaignTag[0].length).match(/^<summary\b[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? "";
    assert.ok(campaignSummary.includes(campaign.name), "Closed campaign identifies the prepared campaign");
    assert.ok(campaignSummary.includes(buyerSituation(plan.directions.find(direction => direction.id === campaign.direction_id).intent)), "Closed campaign explains the buyer situation");
    assert.ok(campaignSummary.includes("Поиск"));
    assert.ok(campaignSummary.includes("2 объявления"), "Ad count is readable without expanding previews");
    assert.ok(campaignSummary.includes(`${campaign.allocations.reduce((total, item) => total + item.cap_rub, 0).toLocaleString("ru-RU")} ₽`), "Closed campaign shows its full planned allocation");
  }
  let disclosureDepth = 0;
  for (const tag of campaignHtml.matchAll(/<\/?(?:details|article|section)\b[^>]*>/g)) {
    if (tag[0].startsWith("</details")) disclosureDepth--;
    else if (tag[0].startsWith("<details")) disclosureDepth++;
    else if (/data-formation-(?:group|ad)=/.test(tag[0])) assert.equal(disclosureDepth, 1, `Objects must remain directly inside their campaign disclosure: ${tag[0]}`);
  }
  const primaryAds = campaignHtml.slice(0, campaignHtml.indexOf('data-formation-technical="true"'));
  for (const ad of portfolio.campaigns.flatMap(c => c.groups.flatMap(g => g.ads))) {
    assert.ok(primaryAds.includes(`<h4>${ad.titles[0]}</h4>`));
    assert.ok(primaryAds.includes(`<p>${ad.texts[0]}</p>`));
    assert.equal(primaryAds.split(`<p>${ad.texts[0]}</p>`).length - 1, 1, "Evidence basis must not repeat the ad as its own implication");
  }
  assert.equal((campaignHtml.match(/data-formation-technical=/g) ?? []).length, 1);
  assert.ok(campaignHtml.includes(`Аудитория: ${plan.directions[0].audience}`));
  assert.ok(campaignHtml.includes(`Намерение: ${plan.directions[0].intent}`));
  assert.equal((campaignHtml.match(/data-formation-campaign=/g) ?? []).length, portfolio.campaigns.length);
  assert.equal((campaignHtml.match(/data-formation-group=/g) ?? []).length, portfolio.campaigns.flatMap(c => c.groups).length);
  assert.equal((campaignHtml.match(/data-formation-ad=/g) ?? []).length, portfolio.campaigns.flatMap(c => c.groups.flatMap(g => g.ads)).length);
  assert.equal((campaignHtml.match(/data-decision=/g) ?? []).length, plan.decisions.length);
  for (const match of campaignHtml.matchAll(/href="#(formation-[^"]+)"/g)) assert.ok(campaignHtml.includes(`id="${match[1]}"`), `Missing decision destination: ${match[1]}`);
  assert.match(campaignHtml, /Предложение положено в основу кампании/);
  assert.match(campaignHtml, /Предложение использовано в группе и объявлениях/);
  assert.match(campaignHtml, /Проверка настоящей заявки/);
  assert.match(campaignHtml, /учёт обращений и цели/);
  assert.match(campaignHtml, /Прогноз количества обращений неизвестен/);
  assert.match(campaignHtml, /<h3>Посадочная и измерение<\/h3>/);
  assert.match(campaignHtml, /data-formation-keyword-state="CURATED_UNMEASURED"/);
  assert.match(campaignHtml, /частота неизвестна/);
  assert.doesNotMatch(campaignHtml, /class="adReason"/);
  assert.match(campaignHtml, /Подтверждённое предложение с конкретным следующим действием/);
  assert.equal((campaignHtml.match(/Повторяет предмет предложения и не объясняет следующий шаг/g) ?? []).length, 1);
  assert.equal((campaignHtml.match(/aria-label="Оценка достижения цели"/g) ?? []).length, 1);
  assert.match(campaignHtml, /Расчёт результатов по допущениям/);
  assert.doesNotMatch(campaignHtml, /<th>Факт<\/th>|Учитывать ретаргетинг|Перед запуском|Требуется проверка/);
  const unrelatedReviewBundle = structuredClone(bundle);
  unrelatedReviewBundle.portfolio.goal_review.checks = [{ area: "EVIDENCE_LIMITS", status: "LIMITATION", finding: "Спрос за прошлый сезон неизвестен", action: "Уточнить сезонность", affected_ids: ["semantics"] }];
  const unrelatedReviewText = textOutsideDisclosures(renderToStaticMarkup(React.createElement(FormationPortfolioView, { bundle: unrelatedReviewBundle, active: false })));
  assert.match(unrelatedReviewText, /Спрос за прошлый сезон неизвестен/);
  assert.match(unrelatedReviewText, /Проверка настоящей заявки/, "An unrelated review does not hide unresolved landing prerequisites");
  assert.match(unrelatedReviewText, /учёт обращений и цели/, "An unrelated review does not hide unresolved measurement prerequisites");
  const cleanBundle = structuredClone(bundle);
  cleanBundle.plan.landing.missing = [];
  cleanBundle.plan.measurement.missing = [];
  cleanBundle.portfolio.goal_review.checks = [];
  const cleanHtml = renderToStaticMarkup(React.createElement(FormationPortfolioView, { bundle: cleanBundle, active: false }));
  assert.doesNotMatch(cleanHtml, /aria-label="Ограничения плана"/);
  cleanBundle.portfolio.goal_review.checks = [{ area: "LANDING_AND_QUALIFICATION", status: "BLOCKER", finding: "Квалификация не настроена", action: "Подключить проверку обращения", affected_ids: ["measurement"] }];
  const blockedHtml = renderToStaticMarkup(React.createElement(FormationPortfolioView, { bundle: cleanBundle, active: false }));
  const blockedPrimary = blockedHtml.slice(0, blockedHtml.indexOf('data-formation-technical="true"'));
  assert.match(blockedPrimary, /data-limit-status="BLOCKER"><strong class="blocker">Требует решения<\/strong><p>Квалификация не настроена<\/p><p>Подключить проверку обращения<\/p>/);
  assert.match(textOutsideDisclosures(blockedHtml), /Квалификация не настроена/);
  assert.match(textOutsideDisclosures(blockedHtml), /Подключить проверку обращения/);

  const diagnosticBundle = structuredClone(cleanBundle);
  const internalRef = "urn:mox:claim:private-provenance";
  const internalHash = `sha256:${"a".repeat(64)}`;
  const narrative = `Условия участия подтверждены. API вернул HTTP 403. Версия схемы: JSON schema_version source_refs ${internalRef} ${internalHash}. Ошибка исправлена в сборщике.`;
  diagnosticBundle.research.findings[0].finding = narrative;
  diagnosticBundle.research.findings[0].evidence_refs = [internalRef, internalHash];
  diagnosticBundle.research.findings[0].source_urls = ["https://api.owner.example/v5/campaigns", "https://owner.example/conditions"];
  diagnosticBundle.plan.decisions[0].reason = narrative;
  diagnosticBundle.plan.planning_inputs[0].evidence_refs = [internalRef];
  diagnosticBundle.plan.measurement.attribution = "UTM → заявка → договор";
  diagnosticBundle.portfolio.selection_rationale = narrative;
  const diagnosticAd = diagnosticBundle.portfolio.campaigns[0].groups[0].ads[0];
  diagnosticAd.source_refs = [internalRef, internalHash];
  diagnosticAd.extensions.reason = narrative;
  diagnosticBundle.portfolio.campaigns[0].bidding.rationale = "План ограничивает расходы. CPC пока неизвестна.";
  const expandedViews = [
    renderToStaticMarkup(React.createElement(FormationPortfolioView, { bundle: diagnosticBundle, active: false })),
    renderToStaticMarkup(React.createElement(FormationStrategyView, { plan: diagnosticBundle.plan, research: diagnosticBundle.research })),
    renderToStaticMarkup(React.createElement(FormationResearchView, { research: diagnosticBundle.research, plan: diagnosticBundle.plan, summary: narrative })),
  ];
  for (const view of expandedViews) {
    // Strip only markup, not closed details: this covers every expanded record as well as the primary screen.
    const allOwnerText = view.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ");
    assert.doesNotMatch(allOwnerText, /urn:mox:|sha256:|source_refs|evidence_refs|schema_version|snapshot_id|\b(?:JSON|CPC|CRM|UTM|API|HTTP|MAX_CLICKS|TARGETED)\b|api\.owner\.example|Ошибка исправлена в сборщике/u);
    assert.match(allOwnerText, /Условия участия подтверждены/);
    assert.match(allOwnerText, /отказ в доступе/);
    assert.match(allOwnerText, /Тестовый расчёт/);
  }
  assert.match(expandedViews[0], /Подробности кампаний/);
  assert.match(expandedViews[2], /Подробности исследования/);
  for (const ad of diagnosticBundle.portfolio.campaigns.flatMap(c => c.groups.flatMap(g => g.ads))) {
    assert.ok(expandedViews[0].includes(`<h4>${ad.titles[0]}</h4>`));
    assert.ok(expandedViews[0].includes(`<p>${ad.texts[0]}</p>`));
  }
  assert.match(expandedViews[0], /Квалификация не настроена/);
  assert.match(expandedViews[0], /Подключить проверку обращения/);
  assert.doesNotMatch(expandedViews[2], /href="https:\/\/api\.owner\.example/);

});


test("buyer descriptions separate writing instructions while preserving qualifications and actual saved grounds", () => {
  const research = formationEvidence("buyer-description").research;
  const plan = formationPlan({ target_audience: "Компания", advertised_offer: "Участие со стендом", core_message: "Запросить условия участия. Настроить отдельную группу.", qualified_result: "Запрос", weekly_budget: 30000, landing_page: "https://owner.example/" }, research);
  plan.directions[0].intent = "Компания ищет условия участия; только для своего региона. Отдельные группы разделяют вопросы цены и формата.";
  const before = structuredClone(plan);
  const shown = presentDirection(plan.directions[0], plan, research);
  assert.equal(shown.situation, "Компания ищет условия участия; только для своего региона.");
  assert.equal(shown.response, "Запросить условия участия.");
  assert.equal(shown.reasonKind, "FINDING");
  assert.equal(shown.reason, research.findings[0].finding);
  assert.deepEqual(plan, before);
  assert.equal(buyerSituation("Компания запрашивает участие; вопросы цены выделяются в следующую группу."), "Компания запрашивает участие.");
  assert.equal(buyerSituation("Компания запрашивает участие; но бюджет пока неизвестен."), "Компания запрашивает участие; но бюджет пока неизвестен.");
  const goal = { goal_revision_id: "goal:r1", customer_geography: "Россия", qualified_action: "Запрос", success_criterion: { target_count: 30, deadline: "2027-06-30", total_budget_rub: 30000 } };
  plan.goal_preparation = goalPreparationFixture(plan, goal, ["buyer-description"], { start_date: "2026-09-09", end_date: "2026-10-08" });
  const selected = plan.goal_preparation.alternatives.find(item => item.id === plan.goal_preparation.selected_alternative_id);
  selected.approach = "Внутреннее название подхода";
  selected.mechanism = "Компания видит условия в ответ на свой запрос. Каждая группа получает отдельный текст.";
  assert.equal(strategyApproach(plan), "Компания видит условия в ответ на свой запрос.");
});

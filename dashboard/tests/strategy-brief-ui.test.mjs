import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { formationEvidence, formationPlan } from "./fixtures/campaign-formation-fixture.mjs";

async function component(t) {
  const sourceUrl = new URL("../app/StrategyBrief.tsx", import.meta.url);
  const outputUrl = new URL(`../app/.strategy-brief-render-${process.pid}-${Date.now()}.mjs`, import.meta.url);
  const formationUrl = new URL(`../app/.strategy-formation-render-${process.pid}-${Date.now()}.mjs`, import.meta.url);
  const basisUrl = new URL(`../app/.strategy-basis-render-${process.pid}-${Date.now()}.mjs`, import.meta.url);
  const basisSource = (await readFile(new URL("../app/EvidenceBasis.tsx", import.meta.url), "utf8"))
    .replace(/import (\w+) from "[^"]+\.css";/gu, 'const $1 = new Proxy({}, { get(_target, key) { return String(key); } });');
  await writeFile(basisUrl, ts.transpileModule(basisSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText);
  t.after(() => rm(basisUrl, { force: true }));
  const archiveUrl = new URL(`../app/.strategy-archive-render-${process.pid}-${Date.now()}.mjs`, import.meta.url);
  const archiveSource = (await readFile(new URL("../app/FormationArchive.tsx", import.meta.url), "utf8"))
    .replace(/import (\w+) from "[^"]+\.css";/gu, 'const $1 = new Proxy({}, { get(_target, key) { return String(key); } });');
  await writeFile(archiveUrl, ts.transpileModule(archiveSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText);
  t.after(() => rm(archiveUrl, { force: true }));
  const formationSource = (await readFile(new URL("../app/CampaignFormation.tsx", import.meta.url), "utf8"))
    .replace('import styles from "./campaign-formation.module.css";', 'const styles = new Proxy({}, { get(_target, key) { return String(key); } });')
    .replace('"./EvidenceBasis.tsx"', JSON.stringify(basisUrl.href))
    .replace('"./FormationArchive.tsx"', JSON.stringify(archiveUrl.href));
  await writeFile(formationUrl, ts.transpileModule(formationSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText);
  t.after(() => rm(formationUrl, { force: true }));
  const source = (await readFile(sourceUrl, "utf8"))
    .replace('import { FormationStrategyView } from "./CampaignFormation.tsx";', `import { FormationStrategyView } from "./${formationUrl.pathname.split("/").pop()}";`)
    .replace('import styles from "./strategy-brief.module.css";', 'const styles = new Proxy({}, { get(_target, key) { return String(key); } });');
  await writeFile(outputUrl, ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, "utf8");
  t.after(() => rm(outputUrl, { force: true }));
  return (await import(outputUrl.href)).default;
}

function props(overrides = {}) {
  const values = {
    business_goal: "Получать заявки на участие в выставке",
    campaign_focus: `Поисковая реклама для участников выставки. ${"Условия участия проверяются отдельно. ".repeat(12)}`.trim(),
    advertised_offer: "Участие в промышленной выставке",
    target_audience: "Представители промышленных компаний",
    qualified_result: "Заявка от компании с подтверждённым интересом к стенду",
    exclusions: "Посещение выставки без участия со стендом",
    geography: "Россия",
    period: { start: "2026-09-04", end: "2027-06-30" },
    landing_page: "https://example.com/participate",
    weekly_budget: 21000,
    target_result_cost: 30000,
    core_message: "Обсудить участие со стендом",
  };
  return {
    strategy: { ownerReview: null, recommendations: [], materialQuestions: [], decisionGate: null },
    currentResult: {
      stateRevision: 7,
      products: {
        strategy: {
          status: "AGENT_ACCEPTED",
          dimensions: Object.entries(values).map(([id, value], index) => ({ id, value, confidence: "CONFIRMED", rationale: `Основание решения №${index + 1}.` })),
        },
        evidence: null,
        campaignPairs: [{}],
      },
      preflight: {
        status: "BLOCKED", passed: 1, total: 7,
        preflightGates: Array.from({ length: 7 }, (_, i) => ({ label: `Проверка ${i + 1}`, status: i === 0 ? "Пройдено" : "Заблокировано", explanation: `Объяснение ${i + 1}` })),
      },
    },
    businessModel: null,
    demandResearch: null,
    competitorMatrix: null,
    materialUnknowns: ["Качество обращений пока не подтверждено"],
    active: false,
    busy: false,
    onCorrect: async () => undefined,
    ...overrides,
  };
}

test("strategy shows a compact business summary and keeps complete decisions in closed disclosures", async (t) => {
  const View = await component(t);
  const html = renderToStaticMarkup(React.createElement(View, props()));
  const overview = html.slice(0, html.indexOf('<div class="details">'));
  for (const label of ["Стратегия рекламы", "Что рекламируем", "Кому", "Как привлекаем", "Бюджет в неделю", "Предельная цена результата"]) {
    assert.ok(overview.includes(label), label);
  }
  assert.match(overview, /data-strategy-status="ready"/u);
  assert.match(overview, /2026-09-04 — 2027-06-30/u);
  assert.doesNotMatch(html, /\[object Object\]/u);
  assert.doesNotMatch(overview, /AGENT_ACCEPTED|Strategy Agent|Message \/ proof|Основание business_goal|Получать заявки/u);
  assert.equal((html.match(/<details class="disclosure">/gu) ?? []).length, 2);
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:=|>|\s)/u);
  const full = html.split('<dl class="fullFields">')[1].split('</dl>')[0];
  assert.equal((full.match(/<dt>/gu) ?? []).length, 5);
  for (const dimension of props().currentResult.products.strategy.dimensions) {
    assert.equal(html.split(dimension.rationale).length - 1, 1, dimension.id);
  }
  assert.match(full, /Посещение выставки без участия со стендом/u);
  assert.match(full, /https:\/\/example\.com\/participate/u);
  assert.ok(html.includes(props().currentResult.products.strategy.dimensions[1].value));
});

test("an accepted strategy retains every unresolved placement condition without technical checks and counters", async (t) => {
  const View = await component(t);
  const html = renderToStaticMarkup(React.createElement(View, props()));
  assert.match(html, /<summary><span>Ограничения<\/span><small[^>]*data-state="blocked">Размещение пока недоступно<\/small><\/summary>/u);
  assert.doesNotMatch(html, /из 7 проверок пройдено/u);
  assert.match(html, /Объяснение 7/u);
  assert.match(html, /Качество обращений пока не подтверждено/u);
  assert.doesNotMatch(html, /aria-label="Готовность стратегии"/u);
});

test("a total-budget plan has one explanation with complete legacy parameters, gaps and checks in its archive", async (t) => {
  const View = await component(t);
  const values = props();
  const research = formationEvidence("snapshot-ui").research;
  const strategy = values.currentResult.products.strategy;
  strategy.formationPlan = formationPlan(Object.fromEntries(strategy.dimensions.map(field => [field.id, field.value])), research);
  values.currentResult.products.evidence = { formationResearch: research };
  values.currentResult.products.campaignPairs = [];
  const html = renderToStaticMarkup(React.createElement(View, values));
  const [overview, archive] = html.split('<summary>Разбор выбора</summary>');
  assert.doesNotMatch(overview, /Что рекламируем|География|Предельная цена результата|Бюджет в неделю|Как привлекаем|>Принята</u);
  assert.doesNotMatch(html, /Параметры и основания|Ограничения и проверки/u);
  assert.equal((html.match(/aria-label="План формирования кампаний"/gu) ?? []).length, 1);
  assert.match(archive, /Целевая стоимость результата/u);
  for (const dimension of strategy.dimensions) assert.ok(archive.includes(dimension.rationale), dimension.id);
  assert.match(archive, /Качество обращений пока не подтверждено/u);
  assert.ok(archive.includes(strategy.dimensions.find(field => field.id === "campaign_focus").value));
  assert.doesNotMatch(html, /Проверки перед запуском|Проверки появятся после подготовки/u);
  values.currentResult.products.campaignPairs = [{}];
  const withChecks = renderToStaticMarkup(React.createElement(View, values));
  const [beforeChecks, checksArchive] = withChecks.split('<summary>Разбор выбора</summary>');
  assert.match(beforeChecks, /Размещение пока недоступно/u);
  assert.doesNotMatch(beforeChecks, /Объяснение 7/u);
  assert.match(checksArchive, /Объяснение 7/u);
  assert.doesNotMatch(checksArchive, /из 7 проверок пройдено|CONFIRMED/u);
  const message = strategy.dimensions.find(field => field.id === "core_message");
  message.confidence = "MEDIUM";
  message.rationale = "Наблюдаемая CPA неизвестна. CPC пока не подтверждена.";
  values.strategy.ownerReview = { versionLabel: "schema_version: internal-v3", exactBinding: "sha256:1234567890abcdef1234567890abcdef" };
  values.currentResult.preflight.preflightGates[1] = { label: "LOCAL_PROFILE_WRITE_UNIMPLEMENTED", status: "Заблокировано", explanation: "Публикация полного графа пока недоступна." };
  const businessOnly = renderToStaticMarkup(React.createElement(View, values));
  assert.match(businessOnly, /стоимость обращения неизвестна/u);
  assert.match(businessOnly, /цена клика пока не подтверждена/u);
  assert.match(businessOnly, /Размещение этих кампаний пока недоступно/u);
  assert.doesNotMatch(businessOnly, /MEDIUM|CONFIRMED|\bCPA\b|\bCPC\b|schema_version|sha256:|LOCAL_PROFILE|полного графа/u);
  values.currentResult.products.campaignPairs = [];
  strategy.dimensions = strategy.dimensions.filter(field => field.id !== "target_result_cost");
  const missingCeiling = renderToStaticMarkup(React.createElement(View, values));
  assert.match(missingCeiling, /data-strategy-status="limited"/u);
  assert.match(missingCeiling, /Целевая стоимость результата: не подтверждено/u);
  const period = strategy.dimensions.find(field => field.id === "period");
  for (const savedPeriod of [{ start_date: "2026-09-04", end_date: "2027-06-30" }, "2026-09-04 — 2027-06-30"]) {
    period.value = savedPeriod;
    const rendered = renderToStaticMarkup(React.createElement(View, values));
    assert.match(rendered, /2026-09-04 — 2027-06-30/u);
    assert.doesNotMatch(rendered, /\[object Object\]/u);
  }
});

test("missing strategy stays unconfirmed and missing financial limits are not displayed as zero", async (t) => {
  const View = await component(t);
  const html = renderToStaticMarkup(React.createElement(View, props({ currentResult: undefined })));
  assert.match(html, /data-strategy-status="limited"/u);
  assert.match(html, /Требует проверки/u);
  assert.match(html, /Не подтверждено/u);
  assert.doesNotMatch(html, /0 ₽|>Принята</u);
});

test("a decision needed from the owner remains outside closed details", async (t) => {
  const View = await component(t);
  const html = renderToStaticMarkup(React.createElement(View, props({
    strategy: { ownerReview: null, recommendations: [], materialQuestions: [], decisionGate: {
      recommendation: "Уточните допустимую стоимость обращения", consequences: "Она ограничивает бюджет кампании",
    } },
  })));
  const overview = html.slice(0, html.indexOf('<div class="details">'));
  assert.match(overview, /Нужно ваше решение/u);
  assert.match(overview, /Уточните допустимую стоимость обращения/u);
  assert.match(overview, /Она ограничивает бюджет кампании/u);
});

test("strategy retains the typed correction fields and does not render raw search phrases", async () => {
  const source = await readFile(new URL("../app/StrategyBrief.tsx", import.meta.url), "utf8");
  for (const name of ["geography", "weekly_budget", "target_result_cost", "core_message"]) {
    assert.ok(source.includes(`name="${name}"`));
  }
  assert.match(source, /onSubmit=\{onCorrect\}/u);
  assert.match(source, /Сохранить и перепроверить/u);
  assert.doesNotMatch(source, /\.formulations\.map/u);
});

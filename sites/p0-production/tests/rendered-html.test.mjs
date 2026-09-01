import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const clientSource = await readFile(new URL("../app/P0Client.tsx", import.meta.url), "utf8");
const ownerSource = await readFile(new URL("../lib/p0-owner-journey.ts", import.meta.url), "utf8");
const ownerStyles = await readFile(new URL("../app/owner-journey.css", import.meta.url), "utf8");
const analyticsStyles = await readFile(new URL("../app/analytics-summary.css", import.meta.url), "utf8");
const globalStyles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const prototypeStyles = await readFile(new URL("../app/prototype/prd-149/prototype.module.css", import.meta.url), "utf8");

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the MOX-ADV owner journey shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Стратегия и рекламные кампании — MOX-ADV<\/title>/i);
  assert.match(html, /Загрузка дашборда/u);
  assert.doesNotMatch(html, /Готовлю путь владельца|Собираю текущий бизнес-вывод/u);
  assert.doesNotMatch(html, /Production Module|Test Scenario|schema_version|provider_ids/i);
});

test("production page consumes only the typed owner projection", () => {
  assert.match(clientSource, /OwnerJourneyProjection/u);
  assert.match(clientSource, /projection\.journey\.stages/u);
  assert.match(clientSource, /projection\.businessOutcome/u);
  assert.match(clientSource, /projection\.currentRecommendation/u);
  assert.match(clientSource, /projection\.primaryAction/u);
  assert.doesNotMatch(clientSource, /payload\.state|workflow\.allowed_commands|context_preflight|write_readiness/u);
  assert.doesNotMatch(clientSource, /schema_version|revision_history|provider_ids|publish_fingerprint/u);
});

test("owner Dashboard does not promote legacy readiness checks to the main screen", () => {
  assert.doesNotMatch(clientSource, /projection\.businessReadiness|data-measurement-state|Все проверки измеримости/u);
  assert.match(ownerSource, /projectMeasurementReadinessForOwner/u);
});

test("owner Dashboard exposes sanitized current-result provenance and question flow", () => {
  assert.match(clientSource, /Версии для воспроизводимости/u);
  assert.match(clientSource, /Спросить о текущем результате/u);
  assert.match(clientSource, /pipeline_action: "EXPLAIN"/u);
  assert.match(clientSource, /name="question"/u);
  assert.match(clientSource, /name="pair_key"/u);
  assert.doesNotMatch(clientSource, /provider_ids|publish_fingerprint/u);
});

test("campaign stage surfaces the Wordstat analysis and auction boundaries before the editable pair", () => {
  for (const label of [
    "Аукцион и анализ Wordstat",
    "АНАЛИЗ WORDSTAT",
    "УЧАСТИЕ В АУКЦИОНЕ",
    "Сопоставимая стоимость перехода",
    "Предел ставки — верхняя граница",
  ]) assert.match(clientSource, new RegExp(label, "u"));
  assert.match(clientSource, /currentAuctionSummary\(pair\.publishProjection\)/u);
  assert.match(ownerStyles, /\.owner-current-market-grid \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/u);
});

test("verified goal omits technical evidence and constraint blocks", () => {
  assert.doesNotMatch(clientSource, /owner-goal-formation-grid|<h3>Доказательства<\/h3>|<h3>Известные ограничения<\/h3>/u);
  assert.doesNotMatch(ownerStyles, /\.owner-goal-formation-grid/u);
});

test("goal correction editor keeps fields and action in a styled grid", () => {
  assert.match(clientSource, /className="owner-goal-correction"/u);
  assert.match(ownerStyles, /\.owner-goal-correction \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/u);
  assert.match(ownerStyles, /\.owner-goal-correction textarea \{[^}]*width: 100%;[^}]*min-height: 82px/u);
  assert.match(ownerStyles, /\.owner-goal-correction > h3, \.owner-goal-correction > p, \.owner-goal-correction > button \{ grid-column: 1 \/ -1; \}/u);
});

test("target result cost has an accessible definition and formula tooltip", () => {
  assert.match(clientSource, /aria-label="Описание целевой стоимости результата"/u);
  assert.match(clientSource, /role="tooltip"/u);
  assert.match(clientSource, /ценность продажи × валовая маржа × конверсия обращения в продажу/u);
  assert.match(ownerStyles, /\.owner-term-info:hover \.owner-term-tooltip, \.owner-term-info:focus \.owner-term-tooltip/u);
});

test("Dashboard typography uses a compact scale with a smaller top navigation", () => {
  const sizes = [ownerStyles, analyticsStyles, globalStyles, prototypeStyles]
    .flatMap((stylesheet) => [...stylesheet.matchAll(/font-size:\s*(\d+)px/gu)].map((match) => Number(match[1])));
  assert.ok(sizes.length > 0);
  assert.deepEqual([...new Set(sizes)].sort((left, right) => left - right), [10, 12, 14, 16]);
  assert.match(prototypeStyles, /\.topbar nav a, \.topbar nav > span \{[^}]*font-size: 12px/u);
  assert.match(prototypeStyles, /\.topbar nav i \{[^}]*font-size: 10px/u);
});

test("production Dashboard omits the campaign agent rail and uses the full workspace width", () => {
  assert.doesNotMatch(clientSource, /AgentRail|Контекст работы агента|Карта автоматизации/u);
  assert.match(clientSource, /styles\.ownerWorkspaceFull/u);
  assert.match(prototypeStyles, /\.ownerWorkspace\.ownerWorkspaceFull \{ grid-template-columns: minmax\(0, 1fr\); \}/u);
});

test("definition grids prevent label collisions and collapsed previews cannot leak content", () => {
  assert.match(ownerStyles, /\.owner-model-grid dl div \{[^}]*grid-template-columns: minmax\(0, \.28fr\) minmax\(0, \.72fr\)/u);
  assert.match(ownerStyles, /\.owner-campaigns article dl div \{[^}]*grid-template-columns: minmax\(0, \.28fr\) minmax\(0, \.72fr\)/u);
  assert.match(ownerStyles, /\.owner-publish-preview details:not\(\[open\]\) > :not\(summary\) \{ display: none; \}/u);
  assert.match(analyticsStyles, /\.owner-analytics-findings dl div \{[^}]*grid-template-columns: minmax\(0, \.3fr\) minmax\(0, \.7fr\)/u);
  assert.match(globalStyles, /\.campaign-draft-card dl > div \{[^}]*grid-template-columns: minmax\(0, \.28fr\) minmax\(0, \.72fr\)/u);
});

test("goal interview renders recommendations, corrections, saved answers and accessible keyboard status without technical identifiers", () => {
  for (const label of [
    "ДИАЛОГ С АГЕНТОМ",
    "Рекомендованный ответ",
    "Исправление владельца",
    "Сохранённые ответы",
    "Цель рекламной кампании",
    "Ctrl/⌘ + Enter",
  ]) {
    assert.match(clientSource, new RegExp(label.replace(/[+]/gu, "\\+"), "u"));
  }
  assert.match(clientSource, /role="alert"/u);
  assert.match(clientSource, /role="status"/u);
  assert.match(clientSource, /interviewHeadingRef\.current\?\.focus/u);
  assert.doesNotMatch(clientSource, /interviewKey|questionKey|schema_version/u);
  assert.match(ownerStyles, /\.owner-interview\b/u);
});

test("owner Dashboard omits routine Strategy confirmation while preserving the historical contract", () => {
  assert.doesNotMatch(clientSource, /Подтвердить точную версию|Проверка точной версии стратегии|StrategyOwnerReview/u);
  assert.match(ownerSource, /confirm_strategy_review/u);
  assert.match(ownerSource, /reject_strategy_review/u);
  assert.match(ownerSource, /review_strategy/u);
});

test("owner Dashboard shows at most one actionable problem and explicit autonomous or terminal state", () => {
  assert.match(clientSource, /projection\.cards\.find\(\(card\) => card\.kind === "human-decision-gate"\)/u);
  assert.match(clientSource, /projection\.cards\.find\(\(card\) => card\.kind === "problem"\)/u);
  assert.doesNotMatch(clientSource, /projection\.cards\.map/u);
  assert.match(clientSource, /Агент продолжает работу/u);
  assert.match(clientSource, /owner-terminal-result/u);
  assert.match(ownerStyles, /\.owner-terminal-result\b/u);
});

test("owner Direct report omits the guidance cards below its verified details", () => {
  assert.match(clientSource, /owner-direct-details/u);
  assert.doesNotMatch(clientSource, /owner-direct-guidance/u);
  assert.doesNotMatch(ownerStyles, /\.owner-direct-guidance\b/u);
});

test("competitor disclosure separates testable hypotheses from performance facts and shows exact evidence", () => {
  assert.match(clientSource, /Гипотезы для кампании — не факты эффективности/u);
  assert.match(clientSource, /Проверяемая гипотеза/u);
  assert.match(clientSource, /Точный набор доказательств/u);
  assert.match(clientSource, /hypothesis\.evidenceSet/u);
  assert.match(ownerSource, /TESTABLE_HYPOTHESIS_NOT_PERFORMANCE_FACT|не факт эффективности или прогноз результата/u);
  assert.match(ownerStyles, /\.owner-competitor-hypotheses\b/u);
});

test("owner interface fixes the accepted five stages and exposes only planned product modules", () => {
  for (const label of ["Цель", "Что узнал агент", "Стратегия", "Кампании", "Проверка публикации"]) {
    assert.match(ownerSource, new RegExp(label, "u"));
  }
  for (const label of ["Стратегия", "Управление", "Мониторинг", "SEO", "Каналы", "VK · В РАЗРАБОТКЕ"]) {
    assert.match(clientSource, new RegExp(label, "u"));
  }
  assert.match(clientSource, /styles\.activeNav/u);
  assert.match(clientSource, /aria-current="page"/u);
  assert.doesNotMatch(clientSource, /Обзор/u);
  assert.doesNotMatch(clientSource, /owner-roadmap/u);
});

import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

async function loadComponent(t) {
  const sourceUrl = new URL("../app/AnalyticsSummaryDisclosure.tsx", import.meta.url);
  const outputUrl = new URL(`../app/.analytics-summary-ui-test-${process.pid}-${Date.now()}.mjs`, import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  await writeFile(outputUrl, compiled, "utf8");
  t.after(() => rm(outputUrl, { force: true }));
  return (await import(outputUrl.href)).default;
}

function summary(status = "Есть существенные пробелы") {
  return {
    status,
    headline: status === "Недостаточно доказательств" ? "Подтверждений недостаточно для честной готовности" : "Основные выводы собраны, но часть решений требует осторожности",
    conclusion: "Доступные факты можно использовать только вместе с показанными ограничениями.",
    quality: {
      coverage: "3 из 6 областей подтверждены; частично — 2; недоступно — 1.",
      freshness: "Свежесть части выводов ограничена или не подтверждена.",
      consistency: "Неразрешённых существенных противоречий не выявлено.",
      limitation: "Сводный статус не скрывает частичные, устаревшие или недоступные доказательства.",
    },
    findings: [
      { area: "Модель бизнеса", status: "Подтверждено", finding: "Предложение и аудитория подтверждены.", source: "Публичные страницы компании и подтверждения владельца", freshness: "Актуально на момент снимка", confidence: "Высокая", limitation: "Изменение бизнеса требует новой проверки." },
      { area: "Текущее продвижение", status: "Частично", finding: "Часть кампаний видна, часть неизвестна.", source: "Подтверждённый срез выбранного рекламного аккаунта", freshness: "Смешанная свежесть", confidence: "Ограниченная", limitation: "Недоступное не считается нулевым." },
      { area: "Поисковый спрос", status: "Недоступно", finding: "Спрос не подтверждён и не подменён нулём.", source: "Официальный срез поискового спроса в выбранной области", freshness: "Свежесть не подтверждена", confidence: "Недостаточная", limitation: "Нужен повторный сбор." },
    ],
    observedSegmentRevenueShare: {
      label: "Observed Segment Revenue Share",
      status: "Доступно только для наблюдаемого набора",
      value: "33.33%",
      numerator: "150 000 000 ₽ · 1 организация компании · строка 2110 за 2024 год",
      denominator: "450 000 000 ₽ · 2 наблюдаемые организации · строка 2110 за 2024 год",
      coverage: "2 наблюдаемых из 3 организаций frame; покрытие по числу организаций — 66.67%; покрытие по выручке неизвестно.",
      missingEntities: ["ООО Конкурент без отчётности — отчётность не найдена"],
      scope: "Участие со стендом · география 77 · 2024-01-01—2024-12-31 · ОКВЭД 82.30",
      limitation: "Это доля сопоставимой бухгалтерской выручки только среди наблюдаемых принятых юрлиц в указанном frame, а не доля рынка.",
    },
    remediation: [
      { priority: 1, impact: "Блокирует допустимость кампаний", area: "Текущее продвижение", problem: "Текущий состав кампаний известен не полностью.", action: "Восстановить подтверждённый срез выбранного рекламного аккаунта." },
      { priority: 2, impact: "Меняет стратегию", area: "Поисковый спрос", problem: "Спрос в выбранной области не подтверждён.", action: "Повторить недоступные формулировки в той же области." },
    ],
  };
}

test("owner analytics disclosure renders facts, evidence quality and impact-ordered repairs", async (t) => {
  const AnalyticsSummaryDisclosure = await loadComponent(t);
  const html = renderToStaticMarkup(React.createElement(AnalyticsSummaryDisclosure, { summary: summary() }));

  assert.match(html, /СВОДКА АНАЛИТИКИ/u);
  assert.match(html, /Есть существенные пробелы/u);
  assert.match(html, /Качество доказательств/u);
  assert.match(html, /Модель бизнеса/u);
  assert.match(html, /Подтверждено/u);
  assert.match(html, /Текущее продвижение/u);
  assert.match(html, /Частично/u);
  assert.match(html, /Поисковый спрос/u);
  assert.match(html, /Недоступно/u);
  assert.match(html, /Observed Segment Revenue Share/u);
  assert.match(html, /Числитель.*150 000 000 ₽/su);
  assert.match(html, /Знаменатель.*450 000 000 ₽/su);
  assert.match(html, /Покрытие.*2 наблюдаемых из 3/su);
  assert.match(html, /Отсутствующие организации.*ООО Конкурент без отчётности/su);
  assert.match(html, /не доля рынка/u);
  assert.match(html, /Что исправить прежде всего/u);
  assert.ok(html.indexOf("Блокирует допустимость кампаний") < html.indexOf("Меняет стратегию"));
  assert.doesNotMatch(html, /snapshot|schema|provider|sha256|Campaigns\.get|_id/iu);
});

test("insufficient analytics is visibly blocked rather than presented as ready", async (t) => {
  const AnalyticsSummaryDisclosure = await loadComponent(t);
  const html = renderToStaticMarkup(React.createElement(AnalyticsSummaryDisclosure, { summary: summary("Недостаточно доказательств") }));

  assert.match(html, /data-analytics-state="blocked"/u);
  assert.match(html, /Подтверждений недостаточно для честной готовности/u);
  assert.doesNotMatch(html, /data-analytics-state="ready"/u);
});

import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

async function loadComponent(t) {
  const sourceUrl = new URL("../app/OwnerViabilitySummary.tsx", import.meta.url);
  const outputUrl = new URL(`../app/.owner-viability-ui-test-${process.pid}-${Date.now()}.mjs`, import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  await writeFile(outputUrl, compiled, "utf8");
  t.after(() => rm(outputUrl, { force: true }));
  return import(outputUrl.href);
}

function campaign(status, overrides = {}) {
  return {
    name: `Кампания ${status}`,
    status,
    comparativeScore: "78/100 · только сравнительный приоритет, не прогноз",
    evidenceCoverage: "88%",
    sensitivity: "68–86",
    reasons: ["Спрос повышает сравнительный приоритет.", "Стоимость остаётся проверяемым пробелом."],
    ...overrides,
  };
}

test("owner viability summary distinguishes viable and testable priority without promising effectiveness", async (t) => {
  const { OwnerViabilitySummary } = await loadComponent(t);
  const viable = renderToStaticMarkup(React.createElement(OwnerViabilitySummary, { campaign: campaign("VIABLE", { evidenceCoverage: "100%", sensitivity: "82–82" }) }));
  assert.match(viable, /Допустима для предстартового теста/);
  assert.match(viable, /78\/100 · только сравнительный приоритет, не прогноз/);
  assert.match(viable, /Покрытие доказательств/);
  assert.match(viable, /100%/);
  assert.match(viable, /82–82/);
  assert.match(viable, /Главные причины сравнительного приоритета/);
  assert.match(viable, /не вероятность, не прогноз результата и не обещание эффективности/);

  const testable = renderToStaticMarkup(React.createElement(OwnerViabilitySummary, { campaign: campaign("TESTABLE_WITH_GAPS") }));
  assert.match(testable, /Допустима с проверяемыми пробелами/);
  assert.match(testable, /Необязательные пробелы не подменяются фактами/);
  assert.match(testable, /Главные причины и проверяемые пробелы/);
  assert.equal((testable.match(/<li>/gu) || []).length, 2);
});

test("owner viability summary keeps blocked and insufficient drafts scoreless with exact repairs", async (t) => {
  const { OwnerViabilitySummary } = await loadComponent(t);
  const insufficient = renderToStaticMarkup(React.createElement(OwnerViabilitySummary, { campaign: campaign("INSUFFICIENT_EVIDENCE", {
    comparativeScore: "Не рассчитывается до прохождения обязательных условий",
    evidenceCoverage: "64%",
    sensitivity: "Недоступна до оценки",
    reasons: ["Не подтверждено текущее доказательство спроса."],
  }) }));
  assert.match(insufficient, /Недостаточно доказательств для балла/);
  assert.match(insufficient, /Каких доказательств не хватает/);
  assert.match(insufficient, /Балл появится только после прохождения обязательных условий/);
  assert.doesNotMatch(insufficient, /\d+\/100/u);

  const blocked = renderToStaticMarkup(React.createElement(OwnerViabilitySummary, { campaign: campaign("BLOCKED", {
    comparativeScore: "Не рассчитывается до прохождения обязательных условий",
    evidenceCoverage: "100%",
    sensitivity: "Недоступна до оценки",
    reasons: ["Точная проекция Яндекс Директа не прошла обязательную проверку."],
  }) }));
  assert.match(blocked, /Заблокирована жёстким условием/);
  assert.match(blocked, /Положительные факторы не усредняют и не скрывают блокировку/);
  assert.match(blocked, /Что блокирует допустимость/);
  assert.doesNotMatch(blocked, /\d+\/100/u);
});

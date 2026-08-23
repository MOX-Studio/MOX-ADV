import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

async function loadComponent(t) {
  const sourceUrl = new URL("../app/ProductFocusDisclosure.tsx", import.meta.url);
  const outputUrl = new URL(`../app/.product-focus-ui-test-${process.pid}-${Date.now()}.mjs`, import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  await writeFile(outputUrl, compiled, "utf8");
  t.after(() => rm(outputUrl, { force: true }));
  return (await import(outputUrl.href)).ProductFocusDisclosure;
}

function dimension(status, score, reasons = []) {
  return { status, score, reasons };
}

function focusState() {
  return {
    decision_status: "HUMAN_DECISION_REQUIRED",
    selected_offer_id: "offer:primary",
    recommended_offer_id: "offer:primary",
    selection_source: "AGENT_RECOMMENDATION",
    catalog: {
      offers: [
        {
          offer_id: "offer:primary",
          label: "Участие со стендом",
          material_axes: {
            offer: "Участие со стендом в промышленной выставке",
            audience: "Руководители промышленных компаний",
            qualified_outcome: "Заявка на участие",
            economics: "Пакет от 500 000 ₽",
            destination: "https://owner.example/exhibit",
          },
          value_proposition: "Новые квалифицированные контакты",
          current_promotion: "NOT_OBSERVED",
          unresolved_facts: [],
        },
        {
          offer_id: "offer:alternative",
          label: "Партнёрская программа",
          material_axes: {
            offer: "Партнёрский пакет выставки",
            audience: "Поставщики оборудования",
            qualified_outcome: "Заявка на партнёрство",
            economics: "",
            destination: "https://owner.example/partners",
          },
          value_proposition: "Доступ к партнёрам",
          current_promotion: "UNKNOWN",
          unresolved_facts: ["Экономика предложения не подтверждена"],
        },
      ],
    },
    focus_opportunities: {
      recommendation_status: "HUMAN_DECISION_REQUIRED",
      cards: [
        {
          offer_id: "offer:primary",
          label: "Участие со стендом",
          disposition: "INSUFFICIENT_EVIDENCE",
          market_opportunity: { ...dimension("UNAVAILABLE", null, [{ code: "MARKET_OPPORTUNITY_UNAVAILABLE", detail: "Спрос в точном охвате пока недоступен." }]), observed_lower_bound: null },
          launch_readiness: { ...dimension("READY", 100), blockers: [], gaps: [] },
          evidence_coverage: { ...dimension("SUFFICIENT", 86), percent: 86, covered_dimensions: ["offer", "audience"], missing_dimensions: ["market_demand"] },
          reasons: [{ code: "MARKET_OPPORTUNITY_UNAVAILABLE", detail: "Спрос в точном охвате пока недоступен." }],
        },
        {
          offer_id: "offer:alternative",
          label: "Партнёрская программа",
          disposition: "INSUFFICIENT_EVIDENCE",
          market_opportunity: { ...dimension("UNAVAILABLE", null), observed_lower_bound: null },
          launch_readiness: { ...dimension("GAPS", 80), blockers: [], gaps: ["Экономика предложения не подтверждена"] },
          evidence_coverage: { ...dimension("PARTIAL", 57), percent: 57, covered_dimensions: ["offer"], missing_dimensions: ["economics", "market_demand"] },
          reasons: [{ code: "LAUNCH_READINESS_GAP", detail: "Экономика предложения не подтверждена" }],
        },
      ],
      nearest_alternative_offer_ids: ["offer:alternative"],
      blocked_or_insufficient_offer_ids: ["offer:primary", "offer:alternative"],
      prepared_human_decision_gate: {
        reason_code: "UNSTABLE_RECOMMENDATION",
        question: "Подтвердить предложенный фокус или выбрать альтернативу?",
        recommendation: "Участие со стендом; подтвердите с учётом пробела спроса.",
        confidence: "LOW",
        options: [],
        evidence: ["Участие со стендом: готовность к запуску — готово.", "Участие со стендом: покрытие доказательств — 86%."],
        consequences: ["Выбранный фокус определяет следующую стратегию кампании.", "Изменение фокуса отменит зависимые результаты до пересчёта."],
      },
    },
  };
}

test("business projection keeps opportunity, launch readiness and evidence coverage visibly separate", async (t) => {
  const ProductFocusDisclosure = await loadComponent(t);
  const html = renderToStaticMarkup(React.createElement(ProductFocusDisclosure, {
    focus: focusState(),
    onSelect: () => {},
  }));

  assert.match(html, /Каталог предложений и рекламный фокус/);
  assert.match(html, /Рыночная возможность/);
  assert.match(html, /Готовность к запуску/);
  assert.match(html, /Покрытие доказательств/);
  assert.match(html, /Участие со стендом/);
  assert.match(html, /Партнёрская программа/);
  assert.match(html, /Ближайшая альтернатива/);
  assert.doesNotMatch(html, /Материально различимые продукты, услуги и предложения|Карточки не смешивают рыночную возможность|НУЖНО ОДНО РЕШЕНИЕ|Почему этот вариант не выбран автоматически/);
  assert.doesNotMatch(html, /offer:(?:primary|alternative)|sha256:|Campaign Strategy|Campaign Draft|market opportunity|launch readiness|evidence coverage|revision/);
});

test("business projection renders exactly one prepared Human Decision Gate with a complete decision packet", async (t) => {
  const ProductFocusDisclosure = await loadComponent(t);
  const html = renderToStaticMarkup(React.createElement(ProductFocusDisclosure, {
    focus: focusState(),
    onSelect: () => {},
  }));

  assert.equal((html.match(/Подготовленное решение владельца/g) || []).length, 1);
  assert.match(html, /Подтвердить предложенный фокус или выбрать альтернативу/);
  assert.match(html, /Рекомендация:<\/b> Участие со стендом/);
  assert.match(html, /Основания/);
  assert.match(html, /Последствия/);
  assert.match(html, /Выбранный фокус определяет следующую стратегию кампании/);
});

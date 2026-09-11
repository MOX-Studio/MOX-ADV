import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { competitorDossier } from "./fixtures/competitor-ranking-fixture.mjs";

async function loadComponent(t) {
  const sourceUrl = new URL("../app/FindingsReadiness.tsx", import.meta.url);
  const outputUrl = new URL(`../app/.findings-readiness-test-${process.pid}-${Date.now()}.mjs`, import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const competitorUrl = new URL(`../app/.competitor-top-test-${process.pid}-${Date.now()}.mjs`, import.meta.url);
  const competitorSource = await readFile(new URL("../app/CompetitorTop.tsx", import.meta.url), "utf8");
  await writeFile(competitorUrl, ts.transpileModule(competitorSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText);
  t.after(() => rm(competitorUrl, { force: true }));
  const compiled = ts.transpileModule(source.replace('"./CompetitorTop.tsx"', JSON.stringify(competitorUrl.href)), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  await writeFile(outputUrl, compiled, "utf8");
  t.after(() => rm(outputUrl, { force: true }));
  return (await import(outputUrl.href)).default;
}

function projection(formulations) {
  return {
    journey: { currentStage: "findings", stages: [] },
    businessOutcome: { status: "ready" },
    demandCostResearch: {
      demand: {
        status: "Доступно",
        conclusion: "Сумма частот исследованных фраз: 48 420 запросов.",
        source: "Яндекс Wordstat",
        observedAt: "2026-09-03T12:12:00.000Z",
        scope: "Россия · все устройства",
        window: "Последние 30 дней",
        coverage: "Исследовано 620 уникальных запросов · 11 кластеров · 6 формулировок показано",
        formulations,
        seasonality: "Месячная динамика сохранена отдельно.",
        gaps: [],
        limitation: "",
      },
      cost: { status: "Недоступно", limitation: "Сопоставимая стоимость не подтверждена." },
    },
  };
}

test('empty Wordstat queries retain their source limitation while access failures remain visible', async (t) => {
  const View = await loadComponent(t);
  const input = projection([]);
  const empty = 'Wordstat вернул штатную пустую выдачу; отсутствующие строки не считаются нулевым спросом.';
  const denied = 'Wordstat отклонил доступ к данным.';
  input.demandCostResearch.demand.gaps = [empty, denied];
  const html = renderToStaticMarkup(React.createElement(View, {
    projection: input, busy: false, active: false, onRefresh: async () => {},
  }));
  const beforeLog = html.slice(0, html.indexOf('<summary>Источники исследования'));
  assert.ok(!beforeLog.includes(empty));
  assert.ok(beforeLog.includes(denied));
  assert.ok(html.includes(empty));
});

test("Findings показывает только результативные формулировки Wordstat", async (t) => {
  const FindingsReadiness = await loadComponent(t);
  const html = renderToStaticMarkup(React.createElement(FindingsReadiness, {
    projection: projection([
      { phrase: "участие со стендом на выставке", frequency: "1 240 запросов", status: "Частота получена" },
      { phrase: "выставка для производителей", frequency: "0 запросов", status: "Частота получена" },
      { phrase: "заявка на участие в закупке", frequency: "Частота недоступна", status: "Частота недоступна" },
    ]),
    busy: false,
    active: false,
    onRefresh: async () => undefined,
  }));

  assert.match(html, /участие со стендом на выставке/iu);
  assert.match(html, /1 240 запросов/iu);
  assert.match(html, /Условия измерения/iu);
  assert.match(html, /<summary><strong>Поисковые запросы<\/strong>/u);
  assert.match(html, /Поисковые запросы/u);
  assert.match(html, /<th scope="col">Частота<\/th>/u);
  assert.match(html, /Исследовано 620 уникальных запросов · 11 кластеров · 6 формулировок показано/iu);
  assert.doesNotMatch(html, /заявка на участие в закупке/iu);
  assert.doesNotMatch(html, /Частота недоступна/iu);
  assert.match(html, /Условия измерения для всех строк/u);
  assert.match(html, /Дата наблюдения для всех строк/u);
  const table = html.slice(html.indexOf('<table>'), html.indexOf('</table>'));
  assert.match(table, /выставка для производителей<\/th><td>0 запросов/u);
  assert.doesNotMatch(table, /Россия · все устройства|Профиль запроса не указан/u);

  const varied = renderToStaticMarkup(React.createElement(FindingsReadiness, {
    projection: projection([
      { phrase: "Широкий запрос", frequency: "100 запросов", status: "Частота получена", operator: "Без операторов", scope: "Москва · компьютеры", observedAt: "2026-09-01T10:00:00Z" },
      { phrase: "Точная формулировка", frequency: "0 запросов", status: "Частота получена", operator: "Фиксированное число слов", scope: "Казань · телефоны", observedAt: "2026-09-02T10:00:00Z" },
    ]), busy: false, active: false, onRefresh: async () => {},
  }));
  assert.match(varied, /Широкий запрос<\/th><td>100 запросов<\/td><td>Без операторов<small>Москва · компьютеры<\/small><\/td><td>1 сент\./u);
  assert.match(varied, /Точная формулировка<\/th><td>0 запросов<\/td><td>Фиксированное число слов<small>Казань · телефоны<\/small><\/td><td>2 сент\./u);
  assert.doesNotMatch(varied, /для всех строк/u);
});

test("Findings показывает результат проверки без подстановки подрядчиков и отдельное обновление конкурентов", async (t) => {
  const FindingsReadiness = await loadComponent(t);
  const html = renderToStaticMarkup(React.createElement(FindingsReadiness, {
    projection: {
      ...projection([]),
      currentResult: { products: { evidence: {
        generatedAt: "2026-09-07T10:00:00Z",
        provenance: { company: { facts: [] }, sources: [], integrations: [] },
        competitorAnalysis: { assessmentStatus: "CURRENT", competitors: [], candidateCount: 0, observedOfferCount: 0, financialProfiles: [], financialStatus: "UNAVAILABLE", limitations: [] },
        competitorRefresh: { refreshedAt: "2026-09-07T10:30:00Z" },
      } } },
    },
    busy: false, active: false, onRefresh: async () => undefined, onCompetitorRefresh: async () => undefined,
  }));
  assert.match(html, /В проверенном наборе конкуренты не найдены/u);
  assert.match(html, /Конкуренты проверены/u);
  assert.match(html, /Обновить конкурентов/u);
  assert.doesNotMatch(html, /3 из 3 публичных предложений/u);
});

test("Findings displays five ranked competitors with analysis and separates research coverage from the top size", async (t) => {
  const FindingsReadiness = await loadComponent(t);
  const sources = Array.from({ length: 6 }, (_, index) => ({ competitor: `Выставка ${index + 1}`, url: `https://expo-${index}.example/`, text: "Участие со стендом для производителей" }));
  const competitors = sources.map((source, index) => ({ name: source.competitor, observationStatus: "OBSERVED", observedOffer: source.text,
    competitiveRelation: "DIRECT_COMPETITOR", rationale: "Тот же покупатель", landingUrl: source.url, observedAt: "2026-09-07T10:00:00Z",
    analysis: { ...competitorDossier(source.competitor, sources), rank: index + 1 } }));
  const html = renderToStaticMarkup(React.createElement(FindingsReadiness, { projection: {
    ...projection([]), currentResult: { products: { evidence: { generatedAt: "2026-09-07T10:00:00Z",
      provenance: { company: { facts: [] }, sources: [], integrations: [] }, competitorAnalysis: {
        assessmentStatus: "CURRENT", candidateCount: 6, observedOfferCount: 6, competitors, financialProfiles: [], financialStatus: "UNAVAILABLE", limitations: [],
        research: { coverage: { discovered_count: 12, observed_count: 10, confirmed_count: 6, excluded_count: 4, unavailable_count: 2, rounds: 2, target_count: 5, target_met: true }, searchQueries: ["Промышленные выставки"], exclusions: [] },
      } } } },
  }, busy: false, active: false, onRefresh: async () => {} }));
  assert.match(html, /Сравнение с нашим предложением/u);
  assert.match(html, /Сравнение подготовлено/u);
  assert.doesNotMatch(html, /Проходов поиска|Исследовано кандидатов|при одинаковых оценках/iu);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:[\s=>])/u);
  assert.equal((html.match(/class="findings-brief-row"/gu) ?? []).length, 9);
  assert.equal((html.match(/class="competitor-top-card"/gu) ?? []).length, 5);
  assert.match(html, /Выставка 5/u);
  assert.doesNotMatch(html, /Выставка 6/u);
  assert.match(html, /Почему такое место в топе/u);
  assert.match(html, /Ограничения и неизвестное/u);
  assert.match(html, /Что проверить в нашей рекламе/u);
  assert.match(html, /Охват поиска и причины исключения/u);
});

test('refresh keeps a dated previous analysis available without presenting it as current', async (t) => {
  const { buildFindingsReport } = await import('../lib/findings-research.ts');
  const FindingsReadiness = await loadComponent(t);
  const old = buildFindingsReport({ snapshot_id: 'old', generated_at: '2026-09-01T10:00:00Z' });
  const html = renderToStaticMarkup(React.createElement(FindingsReadiness, {
    projection: { ...projection([]), pipeline: { currentStage: 'findings' }, currentResult: { products: { evidence: null, previousEvidence: { generatedAt: '2026-09-01T10:00:00Z', goal: 'Прежняя цель', findings: old, competitorAnalysis: { competitors: [], assessmentStatus: 'CURRENT' } } } } },
    busy: false, active: true, onRefresh: async () => {},
  }));
  assert.match(html, /Обновление выполняется/);
  assert.match(html, /последний сохранённый анализ/);
  assert.match(html, /Прежняя цель/);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:[\s=>])/u);
  assert.doesNotMatch(html, /Подтверждённые конкуренты пока не найдены/);
  assert.match(html, /Требуется подтверждение: средняя ценность продажи\./u);
  assert.match(html, /Требуется подтверждение: валовая маржа\./u);
  assert.match(html, /Требуется подтверждение: конверсия обращения в продажу\./u);
  assert.match(html, /Требуется подтверждение: мощность продаж\./u);
  assert.doesNotMatch(html, /average_sale_|gross_margin_percent|lead_to_sale_percent/u);
  assert.doesNotMatch(html, /<summary>Что нужно уточнить/u);
  const gaps = html.slice(html.indexOf('aria-label="Ограничения исследования"'), html.indexOf('<summary>Подробности по темам'));
  for (const section of old.sections) for (const gap of section.gaps.filter(value => !/[a-z]/iu.test(value))) {
    assert.ok(gaps.includes(gap), `The limitations disclosure must keep the saved gap: ${gap}`);
  }
});

test('comparison never substitutes a product description for missing price terms or buyer roles', async (t) => {
  const { buildFindingsReport } = await import('../lib/findings-research.ts');
  const FindingsReadiness = await loadComponent(t);
  const report = buildFindingsReport({ snapshot_id: 'test', claims: [{ subject: 'business_model', predicate: 'product', value: 'Наш продукт', claim_id: 'p', evidence_ids: ['p'] }], evidence: [{ evidence_id: 'p' }] });
  const html = renderToStaticMarkup(React.createElement(FindingsReadiness, { projection: {
    ...projection([]), currentResult: { products: { evidence: { findings: report, provenance: { sources: [] }, competitorAnalysis: { competitors: [{ name: 'Конкурент', landingUrl: 'https://competitor.example/', observedOffer: 'Другое предложение' }], financialProfiles: [] } } } },
  }, busy: false, active: false, onRefresh: async () => {} }));
  assert.match(html, /Наше предложение<\/th><td>Наш продукт<\/td><td>Не подтверждено<\/td><td>Не подтверждено<\/td>/);
});

test('an interrupted run shows saved competitors in the primary rows instead of an empty report', async (t) => {
  const { buildFindingsReport } = await import('../lib/findings-research.ts');
  const FindingsReadiness = await loadComponent(t);
  const old = buildFindingsReport({ snapshot_id: 'old', generated_at: '2026-09-01T10:00:00Z', competitor_research: { ranking: { candidates: [{competitor:'Сохранённая выставка'}] } } });
  const base = { ...projection([]), pipeline: { currentStage: 'findings', status: 'STOPPED' }, currentResult: { products: {
    evidence: null, previousEvidence: { generatedAt: '2026-09-01T10:00:00Z', goal: 'Прежняя цель', matchesCurrentGoal: false, findings: old,
      provenance: { sources: [] }, competitorAnalysis: { competitors: [{name:'Сохранённая выставка', landingUrl:'https://expo.example/', observedOffer:'Участие со стендом'}], assessmentStatus:'CURRENT', financialProfiles:[] } },
  } } };
  const render = projection => renderToStaticMarkup(React.createElement(FindingsReadiness, { projection, busy:false, active:false, onRefresh:async()=>{} }));
  const html = render(base);
  assert.match(html, /Показан последний сохранённый анализ/);
  assert.match(html, /Этот анализ относится к предыдущей версии цели/);
  assert.match(html, /<summary><strong>Конкуренты<\/strong><span class="findings-brief-value">Сохранённая выставка<\/span>/);
  assert.equal((html.match(/class="findings-brief-row"/gu) ?? []).length,9);
  assert.doesNotMatch(html, /Исследование ещё не завершено/);
  const current = structuredClone(base);
  current.currentResult.products.evidence = { findings:buildFindingsReport({snapshot_id:'new',generated_at:'2026-09-07T10:00:00Z'}), provenance:{sources:[]}, competitorAnalysis:{competitors:[],assessmentStatus:'CURRENT',financialProfiles:[]} };
  const currentHtml = render(current);
  assert.doesNotMatch(currentHtml, /Показан последний сохранённый анализ/);
  assert.match(currentHtml, /Предыдущий анализ/);
});

test('unavailable search research displays the saved failure without claiming zero demand', async (t) => {
  const { buildFindingsReport } = await import('../lib/findings-research.ts');
  const FindingsReadiness = await loadComponent(t);
  const unavailable = projection([]).demandCostResearch;
  unavailable.demand.status = 'Недоступно';
  unavailable.demand.gaps = ['Wordstat не вернул подтверждённый ответ.'];
  unavailable.demand.nextAction = 'Повторить официальный сбор Wordstat.';
  const html = renderToStaticMarkup(React.createElement(FindingsReadiness, {
    projection: { ...projection([{ phrase: 'Запрос другого среза', frequency: '100 запросов', status: 'Частота получена' }]),
      currentResult: { products: { evidence: null, previousEvidence: {
        generatedAt: '2026-09-01T10:00:00Z', goal: 'Прежняя цель',
        findings: buildFindingsReport({ snapshot_id: 'previous' }), demandCostResearch: unavailable,
        provenance: { sources: [{ id: 'wordstat', title: 'Спрос и Wordstat', status: 'UNAVAILABLE', limitations: ['Network connection lost.', 'HTTP 403'], sourceUrls: ['https://api.wordstat.yandex.net/v1/topRequests', 'https://wordstat.yandex.ru/'] }] },
        competitorAnalysis: { competitors: [] },
      } } },
    }, busy: false, active: false, onRefresh: async () => {},
  }));
  assert.match(html, /<summary><strong>Поисковые запросы<\/strong><span class="findings-brief-value">Соединение с Wordstat прервалось<\/span>/u);
  assert.match(html, /Причина: соединение с Wordstat прервалось во время сбора данных/u);
  assert.match(html, /Подтверждённые частоты не получены/u);
  assert.match(html, /Повторить официальный сбор Wordstat/u);
  assert.match(html, /Период измерения не подтверждён/u);
  assert.doesNotMatch(html, /Запрос другого среза|<table|0 запросов/u);
  assert.match(html, /отказ в доступе/u);
  assert.match(html, /href="https:\/\/wordstat\.yandex\.ru\/"/u);
  assert.doesNotMatch(html, /Network connection lost|HTTP 403|api\.wordstat|Технический журнал|Проход \d/u);
});

test('current and previous search analysis keep their own phrases and observation scope', async (t) => {
  const { buildFindingsReport } = await import('../lib/findings-research.ts');
  const FindingsReadiness = await loadComponent(t);
  const research = (phrase, scope) => {
    const result = projection([{ phrase, frequency: '0 запросов', status: 'Частота получена', operator: 'Фиксированное число слов', scope }]).demandCostResearch;
    result.demand.scope = scope;
    return result;
  };
  const previous = {
    generatedAt: '2026-09-01T10:00:00Z', goal: 'Прежняя цель',
    findings: buildFindingsReport({ snapshot_id: 'previous' }),
    demandCostResearch: research('Сохранённый запрос', 'Казань · телефоны'),
    provenance: { sources: [] }, competitorAnalysis: { competitors: [] },
  };
  const products = { evidence: null, previousEvidence: previous, demandCostResearch: research('Текущий запрос', 'Москва · компьютеры') };
  const render = (embedded = false, view = "full") => renderToStaticMarkup(React.createElement(FindingsReadiness, {
    projection: { ...projection([]), currentResult: { products } }, busy: false, active: false, embedded, view, onRefresh: async () => {},
  }));
  const saved = render();
  assert.match(saved, /Сохранённый запрос/u);
  assert.match(saved, /Казань · телефоны/u);
  assert.doesNotMatch(saved, /Текущий запрос|Москва · компьютеры/u);
  products.evidence = { generatedAt: '2026-09-07T10:00:00Z', findings: buildFindingsReport({ snapshot_id: 'current' }), provenance: { sources: [] }, competitorAnalysis: { competitors: [] } };
  const [current, history] = render().split('Предыдущий анализ');
  assert.match(current, /Текущий запрос/u);
  assert.match(current, /Москва · компьютеры/u);
  assert.match(current, /0 запросов/u);
  assert.match(current, /Фиксированное число слов/u);
  assert.doesNotMatch(current, /Сохранённый запрос|Казань · телефоны/u);
  assert.match(history, /Сохранённый запрос/u);
  assert.match(history, /Казань · телефоны/u);
  assert.doesNotMatch(history, /Текущий запрос|Москва · компьютеры/u);
  const [embeddedCurrent, embeddedHistory] = render(true).split('Предыдущий анализ');
  assert.doesNotMatch(embeddedCurrent, /<h2>Сбор сведений<\/h2>/u);
  assert.equal((embeddedCurrent.match(/<strong>Поисковые запросы<\/strong>/gu) ?? []).length, 1);
  assert.match(embeddedCurrent, /Текущий запрос/u);
  assert.match(embeddedCurrent, /Ограничения исследования/u);
  assert.match(embeddedHistory, /Сохранённый запрос/u);
  const search = render(true, "search");
  assert.match(search, /<summary><strong>Поисковые запросы<\/strong>/u);
  assert.match(search, /Текущий запрос/u);
  assert.doesNotMatch(search, /Ограничения исследования|Подробности по темам|Источники и ход исследования|Сохранённый запрос/u);
  const [archive, previousArchive] = render(true, "archive").split("Предыдущий анализ");
  assert.match(archive, /Данные от/u);
  assert.match(archive, /Ограничения исследования/u);
  assert.match(archive, /Требуется подтверждение: средняя ценность продажи\./u);
  assert.match(archive, /Требуется подтверждение: валовая маржа\./u);
  assert.match(archive, /Требуется подтверждение: конверсия обращения в продажу\./u);
  assert.doesNotMatch(archive, /<summary>Ограничения исследования|<summary>Подробности по темам|<strong>Поисковые запросы<\/strong>/u);
  assert.match(previousArchive, /Сохранённый запрос/u);
  assert.match(previousArchive, /Казань · телефоны/u);
  assert.doesNotMatch(previousArchive, /Текущий запрос|Москва · компьютеры/u);
});

test('search analysis remains discoverable before collection and during the first run', async (t) => {
  const FindingsReadiness = await loadComponent(t);
  for (const active of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(FindingsReadiness, {
      projection: { ...projection([]), demandCostResearch: null, pipeline: { currentStage: 'findings' } },
      busy: false, active, onRefresh: async () => {},
    }));
    assert.match(html, /<summary><strong>Поисковые запросы<\/strong>/u);
    assert.doesNotMatch(html, /<table/u);
    if (active) {
      assert.match(html, /Сбор запросов выполняется/u);
      assert.doesNotMatch(html, /Нет данных/u);
    } else {
      assert.match(html, /Подтверждённые частоты не получены/u);
      assert.match(html, /Повторить сбор запросов/u);
    }
  }
});

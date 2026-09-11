import assert from "node:assert/strict";
import { readFile, writeFile, rm } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { buildReadableEvidence } from "../lib/readable-evidence.ts";
import { businessText } from "../lib/owner-business-copy.ts";

const research = (findings = []) => ({ findings });
const fact = (patch = {}) => ({ id: "claim:1", aliases: [], kind: "FACT", label: "Предложение", value: "Участие со стендом", basis: "OBSERVATION", sources: [], limitations: [], ...patch });
async function loadComponent(t) {
  const file = new URL(`../app/.evidence-basis-test-${process.pid}.mjs`, import.meta.url);
  const source = (await readFile(new URL("../app/EvidenceBasis.tsx", import.meta.url), "utf8")).replace(/import (\w+) from "[^"]+\.css";/gu, 'const $1 = new Proxy({}, { get(_target, key) { return String(key); } });');
  await writeFile(file, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText);
  t.after(() => rm(file, { force: true }));
  return (await import(file.href)).default;
}

test("evidence disclosure explains stored facts, scope and limitations without presenting container labels as facts", async t => {
  const EvidenceBasis = await loadComponent(t);
  const render = props => renderToStaticMarkup(React.createElement(EvidenceBasis, props));
  await t.test("research material and snapshot refs show the actual linked finding and distinct source pages", () => {
    const materialLabel = "Посадочная, сроки и форматы: проверка текущего прогона";
    const urls = ["https://example.com/participation", "https://example.com/standard", "https://example.com/business", "https://example.org/exhibition", "https://example.org/terms"];
    const sources = urls.map(url => ({ title: materialLabel, url, observedAt: "2026-09-09", scope: [materialLabel] }));
    const statement = "Посадочная предлагает участие компании со стендом; состав оснащения зависит от категории.";
    const html = render({ research: research([{ id: "finding:offer", finding: statement, state: "INFERRED", evidence_refs: ["material:1", "snapshot:1"], limitation: "Оснащение нельзя переносить между категориями." }]), findingIds: ["finding:offer"],
      sourceFacts: [fact({ id: "material:1", kind: "MATERIAL", label: materialLabel, value: materialLabel, basis: "INFERENCE", sources }), fact({ id: "snapshot:1", kind: "SNAPSHOT", label: "Срез исследования", value: "Набор сохранённых источников", basis: "UNKNOWN" })],
      choice: "Созданы разные предложения для оснащённого стенда и свободной площади.",
    });
    assert.match(html, /data-basis-finding="true"/); assert(html.includes(statement)); assert.match(html, /Вывод исследования/);
    assert.doesNotMatch(html, /data-readable-evidence="(?:material|snapshot):1"|Набор сохранённых источников|<p>Посадочная, сроки/);
    assert.equal((html.match(new RegExp(businessText(materialLabel), "g")) ?? []).length, 1, "Shared material scope should be printed once");
    for (const url of urls) assert(html.includes(`href="${url}"`));
    assert.match(html, />example.com\/standard<\/a>/); assert.match(html, />example.com\/business<\/a>/);
    assert.equal((html.match(/Дата: 09.09.2026/g) ?? []).length, urls.length);
    assert(html.includes("Оснащение нельзя переносить между категориями."));
  });
  await t.test("ad fact, identical copy and a combined excerpt appear once while missing primary quote remains visible", () => {
    const title = "Условия участия в ИННОПРОМ-2027", body = "Участие в выставке со стендом";
    const source = { title: "Компания и продукты · first-party public", url: "https://expo.example/participation", observedAt: "2026-09-09", excerpt: title + " · " + body, excerptStatus: "MISSING" };
    const limitation = "No recoverable first-party evidence span is available.";
    const facts = [fact({ id: "offer", value: title, sources: [source], limitations: [limitation] }), fact({ id: "product", label: "Продукт", value: body, sources: [source], limitations: [limitation, "Оснащение зависит от категории."] }), fact({ id: "record:quote", value: title + " · " + body, sources: [source], limitations: [limitation] })];
    const reason = "Разделили оснащённый стенд и свободную площадь, поскольку их состав различается.";
    const html = render({ research: research(), sourceFacts: facts, sourceRefs: facts.map(f => f.id), choice: title + " · " + body, explanation: reason });
    assert.equal((html.match(new RegExp(title, "g")) ?? []).length, 1); assert.equal((html.match(new RegExp(body, "g")) ?? []).length, 1);
    assert.equal((html.match(new RegExp(reason, "g")) ?? []).length, 1);
    assert.equal((html.match(/href="https:\/\/expo.example\/participation"/g) ?? []).length, 1);
    assert.doesNotMatch(html, />По источнику<|<blockquote>/);
    assert(html.indexOf("Подтверждающая цитата со страницы недоступна") < html.indexOf("data-readable-evidence"));
    assert.match(html, /Без подтверждающей цитаты/); assert.match(html, /<summary>Ограничения источников<\/summary>/); assert(html.includes("Оснащение зависит от категории."));
  });
  await t.test("owner input, unknown data and dated conflict retain their meaning and full original limits", () => {
    const originalLimit = "При изменении периода нужно заново проверить условия и сравнимость отчётов.";
    const facts = [fact({ id: "owner:offer", value: "Условия владельца", basis: "OWNER" }), fact({ id: "unknown", value: "Стоимость не установлена", basis: "UNKNOWN" }), fact({ id: "historical", value: "Условия выставки 2025 года", limitations: ["Источник относится к более раннему периоду.", "В источниках есть противоречие.", originalLimit] })];
    const html = render({ research: research(), sourceFacts: facts, sourceRefs: facts.map(f => f.id) });
    const beforeFacts = html.slice(0, html.indexOf("data-readable-evidence"));
    assert.match(beforeFacts, /Источник относится к другому периоду/); assert.match(beforeFacts, /В источниках есть противоречие/);
    assert.match(html, /Данные владельца/); assert.match(html, /Не подтверждено/); assert(html.includes(originalLimit));
  });
  await t.test("source dates and different geographic scopes survive deduplication; unsafe links never render", () => {
    const sources = [{ title: "Один отчёт", url: "https://example.com/report?period=2026", observedAt: "2026-09-08", scope: ["Регион: Москва"], excerpt: "Московское наблюдение" },
      { title: "Один отчёт", url: "https://example.com/report?period=2026", observedAt: "2026-09-09", scope: ["Регион: Казань"], excerpt: "Казанское наблюдение" },
      { title: "Закрытая ссылка", url: "https://example.com/?token=secret", observedAt: null }];
    const html = render({ research: research(), sourceFacts: [fact({ sources })], sourceRefs: ["claim:1"] });
    assert.equal((html.match(/href="https:\/\/example.com\/report\?period=2026"/g) ?? []).length, 2);
    assert.match(html, /Регион: Москва/); assert.match(html, /Регион: Казань/); assert.match(html, /Дата: 08.09.2026/); assert.match(html, /Дата: 09.09.2026/);
    assert.doesNotMatch(html, /token=secret/); assert.match(html, /Дата неизвестна/);
  });
  await t.test("unresolved and empty structured facts cannot claim a readable factual basis", () => {
    const sourceFacts = buildReadableEvidence({ snapshot_id: "snapshot", claims: [{ claim_id: "opaque", value: { secret_nested: "MUST_NOT_APPEAR" }, evidence_ids: [], classification: "unknown" }] }, { references: ["snapshot", "opaque", "missing"] });
    const html = render({ research: research(), sourceFacts, sourceRefs: ["snapshot", "opaque", "missing"] });
    assert.doesNotMatch(html, /data-readable-evidence|Набор сохранённых источников|MUST_NOT_APPEAR/);
    assert.match(html, /Подтверждение этого вывода недоступно/);
  });
  await t.test("machine references and service links never reach expanded evidence; literal prices and unavailable evidence remain honest", () => {
    const hash = "abcdef01".repeat(8), id = "urn:mox:claim:" + hash;
    const price = "Цена стенда — 403 ₽; доставка — 0 ₽. ИННОПРОМ-2027.";
    const facts = [fact({ id, value: price, limitations: ["Данные источника недоступны.", "No recoverable first-party evidence span is available.", "schema_version: p0-analytics-v7"],
      sources: [{ title: "Источник", url: "https://api.direct.yandex.com/json/v5/campaigns", observedAt: "2026-09-09", scope: ["schema_version: p0-analytics-v7", "Регион: Москва"] }, { title: "Условия участия", url: "https://expo.example/participation", observedAt: "2026-09-08" }] }),
      fact({ id: "backend", value: "source_id: DIRECT-TEMPLATES-42; sha256:" + hash }),
    ];
    const html = render({ research: research(), sourceFacts: facts, sourceRefs: [id, "backend"] });
    assert(html.includes(price)); assert.match(html, /Подтверждающая цитата со страницы недоступна/); assert.match(html, /Данные источника недоступны/);
    assert.match(html, /href="https:\/\/expo.example\/participation"/); assert.match(html, /Дата: 08.09.2026/); assert.match(html, /Регион: Москва/);
    assert.doesNotMatch(html, /urn:mox|sha256|abcdef01|source_id|DIRECT-TEMPLATES|p0-analytics|schema_version|api.direct|\/json\/v5|сохранённой записи|не восстановлен/);
  });
});

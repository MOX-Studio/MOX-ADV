import assert from "node:assert/strict";
import { readFile, writeFile, rm } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

async function loadArchive(t) {
  const output = new URL(`../app/.formation-archive-test-${process.pid}-${Date.now()}.mjs`, import.meta.url);
  const source = (await readFile(new URL("../app/FormationArchive.tsx", import.meta.url), "utf8"))
    .replace(/import (\w+) from "[^"]+\.css";/gu, 'const $1 = new Proxy({}, { get(_target, key) { return String(key); } });');
  await writeFile(output, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText);
  t.after(() => rm(output, { force: true }));
  return import(output.href);
}

test("archive retains every original record and exact destination while adding accessible navigation", async t => {
  const { default: Archive } = await loadArchive(t);
  const records = Array.from({ length: 75 }, (_, index) => React.createElement("section", { id: `formation-record-${index}`, key: index },
    React.createElement("h3", null, `Исследование ${index}`),
    React.createElement("p", null, `Полное сохранённое наблюдение ${index}`),
    React.createElement("a", { href: `#formation-record-${(index + 1) % 75}` }, "Связанная запись"),
  ));
  const html = renderToStaticMarkup(React.createElement(Archive, null, records));
  for (let index = 0; index < 75; index++) {
    assert.ok(html.includes(`id="formation-record-${index}"`));
    assert.ok(html.includes(`href="#formation-record-${index}"`));
    assert.ok(html.includes(`Полное сохранённое наблюдение ${index}`));
  }
  assert.match(html, /<input[^>]*type="search"/u);
  assert.match(html, /aria-label="Разделы архива"/u);
  assert.match(html, /Все разделы/u);
  assert.doesNotMatch(html, /<details|disabled/u);
});

test("archive search finds late records, combined title and text terms, and returns full data on reset", async t => {
  const { matchingArchiveChapters } = await loadArchive(t);
  const chapters = Array.from({ length: 90 }, (_, index) => ({ id: `record-${index}`, title: `Раздел ${index}`, text: `Сведения ${index}` }));
  chapters[89] = { id: "measurement", title: "Счётчик и измерение", text: "Квалификация обращения не подтверждена. Требуется CRM." };
  const before = structuredClone(chapters);
  assert.deepEqual(matchingArchiveChapters(chapters, "СЧЕТЧИК   crm"), [chapters[89]]);
  assert.deepEqual(matchingArchiveChapters(chapters, "не подтверждена"), [chapters[89]]);
  assert.deepEqual(matchingArchiveChapters(chapters, "нет такого наблюдения"), []);
  assert.deepEqual(matchingArchiveChapters(chapters, "   "), chapters);
  assert.deepEqual(chapters, before, "Searching must preserve the original archived records");
});

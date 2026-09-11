import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

async function component(t) {
  const sourceUrl = new URL("../app/EvidenceReuseActions.tsx", import.meta.url);
  const outputUrl = new URL(`../app/.evidence-reuse-render-${process.pid}-${Date.now()}.mjs`, import.meta.url);
  const source = (await readFile(sourceUrl, "utf8"))
    .replace('import styles from "./production-dashboard.module.css";', 'const styles = new Proxy({}, { get(_target, key) { return String(key); } });');
  await writeFile(outputUrl, ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, "utf8");
  t.after(() => rm(outputUrl, { force: true }));
  return (await import(outputUrl.href)).default;
}

function props(overrides = {}) {
  return {
    available: true,
    reason: "Собранные сведения подходят для действующей цели.",
    refreshAvailable: true,
    busy: false,
    active: false,
    onRegenerate: async () => undefined,
    onRefresh: async () => undefined,
    ...overrides,
  };
}

test("reuse controls distinguish regeneration from source refresh without explanatory copy", async (t) => {
  const View = await component(t);
  const html = renderToStaticMarkup(React.createElement(View, props()));
  assert.match(html, /Продолжить по собранным сведениям/u);
  assert.match(html, /Собрать сведения заново/u);
  assert.doesNotMatch(html, /<h2|<p|<time|Сведения собраны:|Проверенная стратегия также подходит/u);
  assert.doesNotMatch(html, /disabled|только что|собраны заново|свежие сведения/iu);
});

test("inapplicable evidence disables reuse with its actual reason while explicit refresh remains available", async (t) => {
  const View = await component(t);
  const reason = "Срок применимости сведений истёк. Обновите источники.";
  const html = renderToStaticMarkup(React.createElement(View, props({ available: false, reason })));
  assert.ok(html.includes(`title="${reason}"`));
  assert.match(html, /<button[^>]+disabled=""[^>]*>Продолжить по собранным сведениям<\/button>/u);
  assert.match(html, /<button type="button">Собрать сведения заново<\/button>/u);
  assert.doesNotMatch(html, /Проверенная стратегия также подходит/u);
});

test("active work, busy state and incomplete Goal keep the relevant controls disabled", async (t) => {
  const View = await component(t);
  for (const override of [{ active: true }, { busy: true }, { available: false, refreshAvailable: false }]) {
    const html = renderToStaticMarkup(React.createElement(View, props(override)));
    assert.equal((html.match(/disabled=""/gu) ?? []).length, 2);
  }
  const missing = renderToStaticMarkup(React.createElement(View, props({ available: false, reason: "Проверенные сведения ещё не сохранены." })));
  assert.match(missing, /Проверенные сведения ещё не сохранены/u);
  assert.doesNotMatch(missing, /<time|Сведения собраны:/u);
});

test("reuse and refresh buttons call separate actions", async (t) => {
  const View = await component(t);
  let reused = 0;
  let refreshed = 0;
  const tree = View(props({ onRegenerate: async () => { reused += 1; }, onRefresh: async () => { refreshed += 1; } }));
  const buttons = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "button") buttons.push(node);
    React.Children.forEach(node.props?.children, visit);
  };
  visit(tree);
  await buttons[0].props.onClick();
  assert.equal(reused, 1);
  assert.equal(refreshed, 0);
  await buttons[1].props.onClick();
  assert.equal(reused, 1);
  assert.equal(refreshed, 1);
});

test("Dashboard sends only the typed reuse CAS contract and never falls back to collection", async () => {
  const source = await readFile(new URL("../app/P0Client.tsx", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf("async function regenerateFromEvidence()"), source.indexOf("async function stopPipeline()"));
  assert.match(handler, /pipeline_action: "REGENERATE_FROM_EVIDENCE"/u);
  assert.match(handler, /expected_state_revision: evidenceReuse\.expectedStateRevision/u);
  assert.match(handler, /reuse_token: evidenceReuse\.reuseToken/u);
  assert.match(handler, /!evidenceReuse\?\.available/u);
  assert.doesNotMatch(handler, /REFRESH_EVIDENCE|pipeline_action: "START"|refreshEvidence\(/u);
  assert.match(source, /refreshAvailable=\{!goalNeedsClarification\(projection\)\}/u);
  assert.doesNotMatch(source, /schema_version|publish_fingerprint/u);
});

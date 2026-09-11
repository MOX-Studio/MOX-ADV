import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, rm } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

test("owner preparation omits the service console while the separate agent surface preserves controls", async t => {
  const output = new URL(`../app/.owner-workspace-${process.pid}.mjs`, import.meta.url);
  const source = (await readFile(new URL("../app/SingleCodexWorkspace.tsx", import.meta.url), "utf8"))
    .replace('import styles from "./single-codex-workspace.module.css";', 'const styles = new Proxy({}, { get: (_, key) => String(key) });')
    .replace('import { FormationPortfolioView } from "./CampaignFormation.tsx";', 'const FormationPortfolioView = () => null;');
  await writeFile(output, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText);
  t.after(() => rm(output, { force: true }));
  const Workspace = (await import(output.href)).default;
  const pipeline = { active: true, canStart: false, evidenceReuse: null, stages: [{ pipelineStageId: "STRATEGY", label: "Стратегия" }], singleCodex: { phase: "READY", stage: "STRATEGY", revision: 2, sessionId: null, runId: "run-private", controllerActive: false, testScenario: false, dispatch: { status: "FAILED", error: "HTTP 403 PRIVATE_KEY" }, lastError: { message: "Не удалось получить данные источника.", violations: [{ code: "PRIVATE_SCHEMA_CODE", pointer: "/source_refs" }] } } };
  const props = { pipeline, busy: false, onAction: async () => null, onStop: () => {} };
  const owner = renderToStaticMarkup(React.createElement(Workspace, props));
  assert.match(owner, /Остановить текущий запуск/);
  assert.match(owner, /Не удалось продолжить подготовку/);
  assert.match(owner, /Не удалось получить данные источника/);
  assert.doesNotMatch(owner, /Инструменты агента|<pre|<textarea|JSON|source_refs|PRIVATE_SCHEMA|PRIVATE_KEY|HTTP 403|Взять управление|Загрузить результат/);
  const agent = renderToStaticMarkup(React.createElement(Workspace, { ...props, operatorView: true }));
  assert.match(agent, /Инструменты агента/);
  assert.match(agent, /Взять управление/);
  assert.match(agent, /PRIVATE_SCHEMA_CODE/);
  assert.equal(pipeline.singleCodex.lastError.violations[0].code, "PRIVATE_SCHEMA_CODE");
});

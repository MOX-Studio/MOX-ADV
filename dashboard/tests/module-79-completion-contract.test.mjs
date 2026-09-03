import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeSource = await readFile(new URL("../app/api/p0/route.ts", import.meta.url), "utf8");
const executorSource = await readFile(new URL("../lib/pipeline-production-executor.ts", import.meta.url), "utf8");
const controllerSource = await readFile(new URL("../lib/pipeline-owner-dashboard.ts", import.meta.url), "utf8");
const currentContractSource = await readFile(new URL("../lib/pipeline-current-contract.ts", import.meta.url), "utf8");
const currentEditsSource = await readFile(new URL("../lib/pipeline-current-edits.ts", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../app/P0Client.tsx", import.meta.url), "utf8");
const productionSource = await readFile(new URL("../lib/p0.ts", import.meta.url), "utf8");


test("the production query path is canonical and a started run remains observable before background execution", () => {
  assert.match(routeSource, /projectCurrentPipelineContract/u);
  assert.doesNotMatch(routeSource, /ownerOverview as productionOwnerOverview|ownerSnapshot as productionOwnerSnapshot/u);
  assert.match(routeSource, /waitUntil\(controller\.execute/u);
  assert.match(routeSource, /controller\.start\(key/u);
  assert.doesNotMatch(routeSource, /controller\.startAndExecute/u);
});


test("the executor accepts the owner Goal before agent work starts at Evidence", () => {
  const goalIndex = executorSource.indexOf("acceptGoalRevision");
  const evidenceIndex = executorSource.indexOf("input.agents.analyzeEvidence");
  const strategyIndex = executorSource.indexOf("input.agents.formStrategy");
  const designIndex = executorSource.indexOf("input.agents.designCampaigns");
  assert.ok(goalIndex > -1 && evidenceIndex > goalIndex && strategyIndex > evidenceIndex && designIndex > strategyIndex);
  assert.doesNotMatch(executorSource, /input\.agents\.formGoal|goal-agent|GOAL_AGENT/u);
  assert.match(executorSource, /PRODUCTION_OWNER_GOAL_REQUIRED/u);
  assert.match(controllerSource, /async execute\(ownerKey/u);
});


test("the current action contract exposes typed Strategy, pair, and Playbook actions without legacy handles", () => {
  for (const action of ["CORRECT_STRATEGY", "EDIT_CAMPAIGN_PAIR", "PLAYBOOK_STEWARD_DECISION"]) {
    assert.match(currentContractSource, new RegExp(action, "u"));
  }
  assert.doesNotMatch(routeSource, /currentBackend\.applyAction\(payload\)/u);
  assert.match(currentEditsSource, /compileDirectProjection/u);
  assert.match(currentEditsSource, /PIPELINE_CAMPAIGN_PAIR_EDIT_CONTEXT_SCHEMA/u);
  assert.match(currentEditsSource, /fingerprintDirectProjection/u);
});


test("the current Dashboard keeps reproducibility and preflight without the removed result-question panel", () => {
  assert.doesNotMatch(clientSource, /Спросить о текущем результате|owner-result-questions|pipeline_action: "EXPLAIN"/u);
  assert.match(clientSource, /Технические версии/u);
  assert.match(clientSource, /preflightGates/u);
  assert.doesNotMatch(clientSource, /Принять или отклонить точный пакет|Только отдельное подтверждение откроет черновики кампаний/u);
});


test("Financial Intelligence and governed Playbook stores are instantiated by production wiring", () => {
  assert.match(productionSource, /D1CampaignPlaybookGovernanceStore/u);
  assert.match(productionSource, /D1CampaignPlaybookKnowledgeStore/u);
  assert.match(productionSource, /productionFinancialCompetitorIntelligence/u);
  assert.match(productionSource, /productionMethodologyAgent\(\)/u);
});

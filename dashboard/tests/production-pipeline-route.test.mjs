import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeSource = await readFile(new URL("../app/api/p0/route.ts", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../app/P0Client.tsx", import.meta.url), "utf8");
const productionSource = await readFile(new URL("../lib/p0.ts", import.meta.url), "utf8");
const wordstatClientSource = await readFile(new URL("../lib/wordstat-ui-client.ts", import.meta.url), "utf8");

test("production route prepares real owner inputs without fixture or legacy-table dependency", () => {
  assert.doesNotMatch(routeSource, /p0-e2e|pipeline-acceptance-fixture|p0-e2e-runtime/iu);
  assert.doesNotMatch(routeSource, /archiveLegacyPipelineDocument/iu);
  assert.match(routeSource, /operatorDiagnostics as productionOperatorDiagnostics/u);
  assert.doesNotMatch(routeSource, /ownerOverview as productionOwnerOverview|submitOwnerAction as productionSubmitOwnerAction/u);
  assert.match(routeSource, /historicalView\(key\)/u);
  assert.match(routeSource, /historicalView\(key\)\.catch\(\(\) => null\)/u);
  assert.match(routeSource, /historicalState: historical\?\.state/u);
  assert.match(routeSource, /canonicalOwnerResult/u);
  assert.match(productionSource, /export async function operatorDiagnostics\(key: string\)\s*\{\s*return application\.persistedPipelineInput\(key\);/u);
  assert.match(routeSource, /codex\.start\(key/u);
  assert.doesNotMatch(routeSource, /waitUntil|stageAgents:|controller\.execute\(/u);
  assert.match(routeSource, /productionPipelineEvidenceCollector/u);
  assert.match(routeSource, /return productionPipelineEvidenceCollector\(input\)/u);
  assert.doesNotMatch(routeSource, /controller\.startAndExecute\(key/u);
});

test("invalid local preparation exposes an explicit owner recovery without touching external systems", () => {
  assert.match(routeSource, /RESET_INVALID_LOCAL_P0_STATE/u);
  assert.match(routeSource, /productionRecoverOwnerState/u);
  assert.match(routeSource, /Начать безопасную подготовку заново/u);
  assert.match(clientSource, /recoverInvalidLocalState/u);
  assert.match(clientSource, /recovery\.label/u);
});

test("production route keeps only typed current actions and removes legacy handles", () => {
  assert.match(routeSource, /assertCurrentPipelineAction\(payload\)/u);
  assert.match(routeSource, /Legacy handles are disabled/u);
  assert.doesNotMatch(routeSource, /currentBackend\.applyAction|productionSubmitOwnerAction/u);
  assert.match(routeSource, /CORRECT_STRATEGY|EDIT_CAMPAIGN_PAIR/u);
});

test("canonical evidence reuse action carries exact CAS identity and has no implicit collection fallback", () => {
  const start = routeSource.indexOf('if (pipelineAction === "REGENERATE_FROM_EVIDENCE")');
  const branch = routeSource.slice(start, routeSource.indexOf('if (pipelineAction === "CORRECT_GOAL")', start));
  assert.ok(start >= 0);
  assert.match(branch, /controller\.prepareEvidenceReuse/u);
  assert.match(branch, /codex\.start\(key, historical, control\.sessionId, reuse\.plan, payload\.test_scenario === true\)/u);
  assert.match(branch, /payload\.expected_state_revision/u);
  assert.match(branch, /payload\.reuse_token/u);
  assert.doesNotMatch(branch, /controller\.start\(|controller\.execute\(|evidenceCollector/u);
});

test("production composition never substitutes built-in competitor or financial evidence", () => {
  assert.doesNotMatch(productionSource, /public-competitor-analysis|buildPublicCompetitorAnalysis/u);
  assert.match(productionSource, /if \(!researchConfig\) return null/u);
  assert.match(productionSource, /if \(!bridgeUrl && !bridgeToken\) return null/u);
});

test("production Wordstat evidence uses only the authenticated headless UI bridge", () => {
  assert.match(productionSource, /collectHeadlessWordstatUiBatch/u);
  assert.match(productionSource, /P0_WORDSTAT_BRIDGE_URL/u);
  assert.match(wordstatClientSource, /adaptCompleteWordstatUiBatch/u);
  assert.match(wordstatClientSource, /WORDSTAT_UI_REQUEST_TIMEOUT/u);
  assert.doesNotMatch(productionSource, /collectOfficialWordstatBatch/u);
  assert.doesNotMatch(productionSource, /YANDEX_WORDSTAT_OAUTH_TOKEN|YANDEX_WORDSTAT_CLIENT_ID/u);
});

test("cold-start Strategy planning does not require Direct read credentials", () => {
  assert.match(productionSource, /async function readPlanningCurrencyLimits\(\)/u);
  assert.match(productionSource, /readCurrencyLimits: readPlanningCurrencyLimits/u);
  assert.match(productionSource, /minimum_weekly_budget_rub: null/u);
});

test("Dashboard lets the owner revise economics and rebuild dependent evidence without assistance", () => {
  assert.match(clientSource, /projection\.businessModel\.editor && <BusinessModelEditor/u);
  assert.match(clientSource, /function BusinessModelEditor\(/u);
  assert.match(clientSource, /Сохранить и пересобрать/u);
  assert.match(productionSource, /wordstatUiBridgeUrl: runtime\.P0_WORDSTAT_BRIDGE_URL/u);
});

test("Dashboard omits routine Strategy confirmation and exposes only typed material correction", () => {
  assert.doesNotMatch(clientSource, /projection\.campaignStrategy\.ownerReview|function StrategyOwnerReview\(|submitStrategyDecision|Подтвердить точную версию/u);
  assert.match(clientSource, /pipeline_action: "CORRECT_STRATEGY"/u);
  assert.match(clientSource, /Важная правка с полной повторной проверкой/u);
  assert.match(clientSource, /Сохранить и перепроверить/u);
});

test("canonical Dashboard omits the removed top-level run control and keeps typed current-product editors", () => {
  assert.doesNotMatch(clientSource, /PipelineControl|owner-pipeline-control/u);
  assert.match(clientSource, /pipeline_action: "CORRECT_GOAL"/u);
  assert.match(clientSource, /<SingleCodexWorkspace/u);
  assert.doesNotMatch(clientSource, /pipeline_action: "START"/u);
  assert.match(clientSource, /pipeline_action: "CORRECT_STRATEGY"/u);
  assert.match(clientSource, /pipeline_action: "EDIT_CAMPAIGN_PAIR"/u);
  assert.match(clientSource, /name="pair_key"/u);
  assert.doesNotMatch(clientSource, /status: pipeline \? "Ожидает"/u);
});


test("production has no model wiring and the former coordinator endpoint is retired", async () => {
  const retired = await readFile(new URL("../app/api/p0/agent/route.ts", import.meta.url), "utf8");
  assert.match(retired, /status: 410/u);
  assert.doesNotMatch(retired, /runAgent|new .*Agent|create.*Model/u);
  assert.doesNotMatch(productionSource, /createProductionStageAgents|new BoundedStageAgentModel|configuredModelAdapter|coordinateOwnerAgent|new P0AgentRuntime|researchBusinessEvidence:/u);
  assert.match(routeSource, /new SingleCodexPipeline/u);
  for (const name of ["pipeline-stage-tools", "pipeline-campaign-tools", "pipeline-stage-context", "single-codex-pipeline"]) {
    const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /model\.generate|new BoundedStageAgentModel|createProductionStageAgents|Promise\.all\([^)]*agent/u);
  }
});

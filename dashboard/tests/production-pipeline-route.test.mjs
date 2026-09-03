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
  assert.match(routeSource, /controller\.start\(key, historical\)/u);
  assert.match(routeSource, /waitUntil\(controller\.execute\(key, pipeline\.runId, historical\)/u);
  assert.match(routeSource, /productionPipelineEvidenceCollector/u);
  assert.match(routeSource, /evidenceCollector: productionPipelineEvidenceCollector/u);
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
  assert.match(clientSource, /pipeline_action: "CORRECT_GOAL"[\s\S]*pipeline_action: "START"/u);
  assert.match(clientSource, /pipeline_action: "CORRECT_STRATEGY"/u);
  assert.match(clientSource, /pipeline_action: "EDIT_CAMPAIGN_PAIR"/u);
  assert.match(clientSource, /name="pair_key"/u);
  assert.doesNotMatch(clientSource, /status: pipeline \? "Ожидает"/u);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeSource = await readFile(new URL("../app/api/p0/route.ts", import.meta.url), "utf8");
const clientSource = await readFile(new URL("../app/P0Client.tsx", import.meta.url), "utf8");
const productionSource = await readFile(new URL("../lib/p0.ts", import.meta.url), "utf8");

test("production route prepares real owner inputs without fixture or legacy-table dependency", () => {
  assert.doesNotMatch(routeSource, /p0-e2e|pipeline-acceptance-fixture|p0-e2e-runtime/iu);
  assert.doesNotMatch(routeSource, /archiveLegacyPipelineDocument/iu);
  assert.match(routeSource, /operatorDiagnostics as productionOperatorDiagnostics/u);
  assert.match(routeSource, /ownerOverview as productionOwnerOverview/u);
  assert.match(routeSource, /submitOwnerAction as productionSubmitOwnerAction/u);
  assert.match(routeSource, /currentBackend\.diagnostics\(\)/u);
  assert.match(routeSource, /controller\.startAndExecute\(key, diagnostics/u);
});

test("production route keeps pipeline actions typed and denies editing while a run is active", () => {
  assert.match(routeSource, /assertCurrentPipelineAction\(payload\)/u);
  assert.match(routeSource, /currentPipeline\.editingLocked/u);
  assert.match(routeSource, /Редактирование недоступно во время активного запуска/u);
});

test("production Wordstat evidence uses only the authenticated headless UI bridge", () => {
  assert.match(productionSource, /collectHeadlessWordstatUiBatch/u);
  assert.match(productionSource, /P0_WORDSTAT_BRIDGE_URL/u);
  assert.match(productionSource, /adaptCompleteWordstatUiBatch/u);
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

test("Dashboard exposes the exact Strategy Review decision instead of a terminal placeholder", () => {
  assert.match(clientSource, /projection\.campaignStrategy\.ownerReview && <StrategyOwnerReview/u);
  assert.match(clientSource, /function StrategyOwnerReview\(/u);
  assert.match(clientSource, /onDecision=\{submitStrategyDecision\}/u);
  assert.match(clientSource, /Подтвердить точную версию/u);
});

test("NOT_STARTED pipeline keeps owner-journey actions and exposes Start only for current Drafts at review", () => {
  assert.match(clientSource, /projection\.pipeline && projection\.pipeline\.status !== "NOT_STARTED"\s*\? projection\.pipeline\.stages\.find/u);
  assert.match(clientSource, /projection\.journey\.currentStage === "review" && projection\.campaignOptions\.length > 0/u);
  assert.doesNotMatch(clientSource, /status: pipeline \? "Ожидает"/u);
});

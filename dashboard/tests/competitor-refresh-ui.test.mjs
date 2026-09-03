import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const clientSource = await readFile(new URL("../app/P0Client.tsx", import.meta.url), "utf8");
const routeSource = await readFile(new URL("../app/api/p0/route.ts", import.meta.url), "utf8");
const contractSource = await readFile(new URL("../lib/pipeline-current-contract.ts", import.meta.url), "utf8");
const refreshSource = await readFile(new URL("../lib/pipeline-competitor-refresh.ts", import.meta.url), "utf8");
const dashboardSource = await readFile(new URL("../lib/pipeline-owner-dashboard.ts", import.meta.url), "utf8");
const stageAgentSource = await readFile(new URL("../lib/production-stage-agents.ts", import.meta.url), "utf8");

test("Dashboard exposes typed full-evidence and bounded competitor refresh actions", () => {
  assert.match(contractSource, /"REFRESH_EVIDENCE"/u);
  assert.match(routeSource, /pipelineAction === "REFRESH_EVIDENCE"/u);
  assert.match(routeSource, /controller\.start\(key, historical\)/u);
  assert.match(routeSource, /controller\.execute\(key, pipeline\.runId, historical\)/u);
  assert.match(clientSource, /pipeline_action: "REFRESH_EVIDENCE"/u);
  assert.match(clientSource, /DASHBOARD_REQUEST_TIMEOUT_MS = 165_000/u);
  assert.match(clientSource, /new AbortController\(\)/u);
  assert.match(clientSource, /Запрос остановлен через/u);
  assert.match(clientSource, /projection\.pipeline\.stateText/u);
  assert.match(clientSource, /ЗАПУСК ОСТАНОВЛЕН/u);
  assert.match(clientSource, /Собрать все сведения заново/u);
  assert.match(routeSource, /pipelineAction === "STOP"/u);
  assert.match(clientSource, /pipeline_action: "STOP"/u);
  assert.match(clientSource, /Остановить текущий запуск/u);
  assert.match(clientSource, /Сбор выполняют read-only adapters/u);
  assert.match(clientSource, /Evidence Analyst интерпретирует уже собранный snapshot/u);

  assert.match(contractSource, /"REFRESH_COMPETITOR_ANALYSIS"/u);
  assert.match(routeSource, /pipelineAction === "REFRESH_COMPETITOR_ANALYSIS"/u);
  assert.match(routeSource, /controller\.refreshCompetitors/u);
  assert.match(clientSource, /pipeline_action: "REFRESH_COMPETITOR_ANALYSIS"/u);
  assert.match(clientSource, /expected_state_revision: currentResult\.stateRevision/u);
  assert.match(clientSource, /Обновить данные о конкурентах/u);
  assert.match(dashboardSource, /analyst: this\.stageAgents\.assessCompetitorEvidence/u);
  assert.match(stageAgentSource, /agent_id: "evidence-analyst-competitor-assessment"/u);
});

test("findings stage renders company, integrations, market and source provenance from the current snapshot", () => {
  assert.match(dashboardSource, /projectEvidenceSnapshotForDashboard\(evidence\)/u);
  assert.match(clientSource, /provenance\.company\.facts/u);
  assert.match(clientSource, /provenance\.integrations/u);
  assert.match(clientSource, /provenance\.sources/u);
  assert.match(clientSource, /competitor\.observedAt/u);
  assert.match(clientSource, /competitor\.evidenceQuote/u);
  assert.match(clientSource, /evidence\.competitorRefresh\?\.refreshedAt/u);
  assert.match(clientSource, /Текущий Evidence Snapshot/u);
  assert.match(clientSource, /Источник и дата наблюдения/u);
  assert.match(clientSource, /Свежесть/u);
  assert.match(clientSource, /Ограничения/u);
  assert.match(clientSource, /stage === "findings" && <EvidenceMarketResearch/u);
  assert.match(clientSource, /Недоступно — не означает ноль/u);
});

test("competitor refresh core preserves the closed zero-write boundary without private provider reads", () => {
  assert.match(refreshSource, /external_write: "DENIED"/u);
  assert.match(refreshSource, /publication: "NOT_AUTHORIZED"/u);
  assert.match(refreshSource, /impressions: 0/u);
  assert.match(refreshSource, /spend_micros: 0/u);
  assert.doesNotMatch(refreshSource, /readContext|readDirect|readMetrika|YANDEX_DIRECT|YANDEX_METRIKA/u);
});

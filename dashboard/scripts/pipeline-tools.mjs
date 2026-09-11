#!/usr/bin/env node
// Offline tools for the one controlling Codex. Never calls a model or the Dashboard API.
import { readFile, writeFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { compilePipelineStageTask, preparePipelineStageTask } from "../lib/pipeline-stage-tools.ts";
import { campaignOptimizationParameters } from "../lib/campaign-optimization.ts";
import { evaluatePipelineSubmission } from "../lib/pipeline-campaign-refinement.ts";
import { pipelineDigest } from "../lib/pipeline-orchestrator.ts";
import { buildAnalyticsEvidence, verifyAnalyticsEvidenceSnapshot, withBusinessResearchMaterial } from "../lib/analytics-evidence.ts";
import { researchPublicFirstPartySite } from "../lib/site-research.ts";
import { collectDirectTemplateResearch } from "../lib/direct-template-research.ts";
import { calculateGoalForecast } from "../lib/campaign-goal-preparation.ts";
import { analyzeGoalPortfolio, assessGoalPortfolioReadiness } from "../lib/goal-portfolio-analysis.ts";
import { inspectDirectImage, verifyLocalFormationAssets } from "./direct-asset-files.mjs";
import { fileURLToPath } from "node:url";

const [command, first, second, third] = process.argv.slice(2);
const readJson = async path => JSON.parse(await readFile(path, "utf8"));
const writeJson = async (path, value) => {
  if (!path) throw new Error("Укажите путь к выходному JSON-файлу.");
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
};
try {
  if (command === "validate" || command === "package" || command === "analyze-plan") {
    if (!first || !second || (command === "package" && !third)) throw new Error("Использование: pipeline-tools.mjs validate TASK.json CANDIDATE.json | package TASK.json CANDIDATE.json RESULT.json");
    const task = await readJson(first);
    const candidate = await readJson(second);
    if (command === "analyze-plan") {
      const preparation = candidate.formation_plan?.goal_preparation;
      if (task.stage !== "STRATEGY" || !preparation) throw new Error("Оценка расходов требует полного проекта стратегии и материалов её этапа.");
      let validation = { status: "VALID", violations: [] };
      try { await compilePipelineStageTask(task, candidate); }
      catch (error) { validation = { status: "INVALID", violations: error.violations ?? [{ message: error.message }] }; }
      process.stdout.write(`${JSON.stringify({ ...validation, analysis: analyzeGoalPortfolio(preparation), comparisons: preparation.forecast.allocation_options?.map(option => ({ id: option.id, ...calculateGoalForecast(preparation, option.allocations) })) ?? [], persisted: false }, null, 2)}\n`);
      if (validation.status === "INVALID") process.exitCode = 1;
    } else {
    const submission = await evaluatePipelineSubmission(task, candidate);
    const portfolio = submission.kind === "PROGRESS" ? submission.refinement.draft : submission.portfolio;
    if (portfolio) await verifyLocalFormationAssets(portfolio, fileURLToPath(new URL("../public/", import.meta.url)));
    const preparation = task.source.strategy?.formation_plan?.goal_preparation;
    const readiness = task.stage === "CAMPAIGNS" && preparation && submission.kind === "PRODUCT" ? assessGoalPortfolioReadiness(preparation, portfolio?.goal_review, task.source.test_data_allowed === true) : null;
    if (command === "package") await writeJson(third, {
      schema_version: "p0-single-codex-result-v1", run_id: task.run_id, input_digest: task.input_digest, result: candidate,
    });
    process.stdout.write(`${JSON.stringify({ status: "VALID", stage: task.stage, disposition: submission.kind === "PROGRESS" ? "CONTINUE_REFINEMENT" : "VERIFIED_PRODUCT", next_step: submission.kind === "PROGRESS" ? submission.refinement.phase : null, goal_readiness: readiness, summary: submission.summary, output: submission.kind === "PRODUCT" ? submission.compiled.attempt.output : null, persisted: false })}\n`);
    }
  } else if (command === "optimization-inputs") {
    const task = await readJson(first), candidate = await readJson(second);
    const { input_digest: digest, ...body } = task;
    if (task.stage !== "CAMPAIGNS" || !task.source.strategy?.formation_plan || digest !== await pipelineDigest(body) || digest !== (await preparePipelineStageTask(task.source)).input_digest) throw new Error("Получите актуальные материалы этапа кампаний через UI.");
    const groups = campaignOptimizationParameters(task.source.strategy.formation_plan, candidate);
    await writeJson(third, { goal_revision_id: task.source.strategy.formation_plan.goal_preparation?.goal.revision_id, groups });
    process.stdout.write(`${JSON.stringify({ status: "INSPECTED", groups: groups.length, decisions_generated: false, persisted: false })}\n`);
  } else if (command === "inspect-image") {
    const asset = await inspectDirectImage(first);
    await writeJson(second, asset);
    process.stdout.write(`${JSON.stringify({ status: "INSPECTED", asset, persisted: false })}\n`);
  } else if (command === "read-direct") {
    const until = new Date(); until.setUTCDate(until.getUTCDate() - 3);
    const from = new Date(until); from.setUTCDate(from.getUTCDate() - 89);
    const snapshot = await collectDirectTemplateResearch({ token: process.env.YANDEX_DIRECT_OAUTH_TOKEN ?? "", account: process.env.YANDEX_DIRECT_CLIENT_LOGIN ?? "", metricaToken: process.env.YANDEX_METRICA_OAUTH_TOKEN,
      dateFrom: second ?? from.toISOString().slice(0, 10), dateTo: third ?? until.toISOString().slice(0, 10) }, { fetch, now: () => new Date().toISOString() });
    await writeJson(first, snapshot);
    process.stdout.write(`${JSON.stringify({ status: "COLLECTED", campaigns: snapshot.collections.campaigns?.objects.length ?? 0, templates: snapshot.templates.length, collections: Object.fromEntries(Object.entries(snapshot.collections).map(([key, value]) => [key, { status: value.status, count: value.objects.length, limitation: value.limitation }])), reports: snapshot.reports.map(r => ({ type: r.report_type, goal: r.goal_id, status: r.status, rows: r.rows.length, limitation: r.limitation })), persisted: false })}\n`);
  } else if (command === "attach-direct") {
    const source = await readJson(first), research = await readJson(second);
    if (!source.goal_context || !await verifyAnalyticsEvidenceSnapshot(source) || research.schema_version !== "direct-template-research-v1" || research.authority?.provider_writes !== false || research.authority?.browser_cabinet !== false) throw new Error("Нужны проверенный срез цели и наблюдения из API Директа.");
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(research)));
    const digest = [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, "0")).join("");
    const updated = await withBusinessResearchMaterial(source, { id: `DIRECT-TEMPLATES-${digest.slice(0, 24)}`, kind: "OFFICIAL_OBSERVATIONS", label: "Структура и история кампаний Директа", observed_at: research.observed_at,
      source_urls: ["https://api.direct.yandex.com/json/v501/campaigns", "https://api.direct.yandex.com/json/v5/reports"], content: research });
    await writeJson(third, updated);
    process.stdout.write(`${JSON.stringify({ status: "VALID", snapshot_id: updated.snapshot_id, persisted: false })}\n`);
  } else if (command === "build-evidence") {
    const snapshot = await buildAnalyticsEvidence(await readJson(first));
    if (!snapshot.goal_context || !await verifyAnalyticsEvidenceSnapshot(snapshot)) throw new Error("Срез должен быть целостным и привязанным к текущей цели (model.goal_research_scope).");
    await writeJson(second, snapshot);
    process.stdout.write(`${JSON.stringify({ status: "VALID", snapshot_id: snapshot.snapshot_id, persisted: false })}\n`);
  } else if (command === "read-site") {
    if (!first || !second) throw new Error("Использование: pipeline-tools.mjs read-site HTTPS_URL OUTPUT.json");
    const site = await researchPublicFirstPartySite(first, {
      fetch, resolveHostname: async hostname => (await lookup(hostname, { all: true })).map(item => item.address),
      now: () => new Date().toISOString(),
    });
    await writeJson(second, site);
    process.stdout.write(`${JSON.stringify({ status: "COLLECTED", url: site.url, persisted: false })}\n`);
  } else {
    process.stdout.write("Детерминированные инструменты Codex:\n  validate TASK.json CANDIDATE.json\n  package TASK.json CANDIDATE.json RESULT.json\n  analyze-plan TASK.json STRATEGY.json\n  optimization-inputs TASK.json CANDIDATE.json OUTPUT.json\n  inspect-image IMAGE_FILE OUTPUT.json\n  read-direct OUTPUT.json [FROM_DATE TO_DATE]\n  attach-direct SNAPSHOT.json DIRECT.json UPDATED_SNAPSHOT.json\n  read-site HTTPS_URL OUTPUT.json\n  build-evidence INPUT.json SNAPSHOT.json\nСохранение в Dashboard выполняется только через его интерфейс.\n");
    if (command && !["help", "--help"].includes(command)) process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: "INVALID", message: error.message, violations: error.violations ?? [], persisted: false }, null, 2)}\n`);
  process.exitCode = 1;
}

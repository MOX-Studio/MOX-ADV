import { keywordResearchFixture, keywordReviewFixture } from "./fixtures/keyword-preparation-fixture.mjs";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { buildAnalyticsEvidence } from "../lib/analytics-evidence.ts";
import { SingleCodexPipeline } from "../lib/single-codex-pipeline.ts";
import { D1SingleCodexWorkspaceStore } from "../lib/single-codex-pipeline-d1-store.ts";
import { playbookSnapshot } from "../lib/pipeline-stage-context.ts";
import { compilePipelineStageTask, preparePipelineStageTask } from "../lib/pipeline-stage-tools.ts";
import { FINDINGS_POLICY, buildFindingsResearchPlan } from "../lib/findings-research.ts";
import { verifyAnalyticsEvidenceSnapshot, withBusinessResearchMaterial } from "../lib/analytics-evidence.ts";
import { createEvidenceReuseHarness, replaySnapshotInput } from "./fixtures/pipeline-evidence-reuse-fixture.mjs";
import { formationEvidence, formationPlan, formationPortfolio } from "./fixtures/campaign-formation-fixture.mjs";
import { goalPreparationFixture, goalReviewFixture, preparationDecisionFixture } from "./fixtures/goal-preparation-fixture.mjs";
import { optimizationReviewFixture } from "./fixtures/campaign-optimization-fixture.mjs";
import { CAMPAIGN_OPTIMIZATION_VERSION, campaignOptimizationParameters } from "../lib/campaign-optimization.ts";
import { critiqueFixture } from "./fixtures/campaign-refinement-fixture.mjs";
import { goalRequirementsFixture, upgradeGoalPreparationFixture, upgradeGoalReviewFixture } from "./fixtures/goal-prelaunch-fixture.mjs";
import { createCurrentGoal } from "../lib/goal-revision-lifecycle.ts";
import { goalMetricPreset } from "../lib/goal-metric.ts";

function d1(database) {
  const wrap = (statement, values = []) => ({
    bind(...next) { return wrap(statement, next); },
    async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; },
    async first() { return statement.get(...values) ?? null; },
    async all() { return { results: statement.all(...values) }; },
  });
  return { prepare(sql) { return wrap(database.prepare(sql)); } };
}
async function harness(outcome) {
  const h = await createEvidenceReuseHarness({ now: "2026-09-09T10:00:00.000Z" });
  if (outcome) {
    const action = "Изолированный пример засчитываемого оплаченного результата";
    const metric = goalMetricPreset(outcome, action, outcome === "CUSTOM" ? "RATIO" : "COUNT");
    if (outcome === "CUSTOM") Object.assign(metric, { eligibility_rule: "Целевое событие когорты", deduplication_rule: "Одна запись на участника", reversal_rule: "Повторы исключаются", measurement_definition: "Связанные события и полный объём когорты", denominator_definition: "Все участники когорты", minimum_denominator: 100 });
    h.goals.current = await createCurrentGoal({ owner_key: "owner", desired_outcome: "Проверить сохранение единицы результата рекламы", qualified_action: action, customer_geography: "Москва", success_criterion: { target_value: outcome === "CUSTOM" ? 10 : outcome === "PAID_ORDER" ? 30 : 10000, metric, comparison: "AT_LEAST", total_budget_rub: 30000, deadline: "2027-06-30" }, created_at: "2026-09-09T10:00:00Z" });
  }
  let time = "2026-09-09T10:00:00.000Z";
  const database = new DatabaseSync(":memory:");
  const workspaces = new D1SingleCodexWorkspaceStore(d1(database));
  const input = replaySnapshotInput(); input.model.goal_research_scope = h.goals.current.revision;
  input.generatedAt = time; input.site.fetched_at = time; input.context.direct.observed_at = time;
  const snapshot = await buildAnalyticsEvidence(input);
  let collections = 0;
  const deps = { runs: h.runStore, goals: h.goals, products: h.products, workspaces,
    collect: async () => { collections++; return structuredClone(snapshot); },
    playbook: playbookSnapshot, now: () => time, newRunId: () => `single-codex:${h.runStore.order.length + 1}` };
  const service = () => new SingleCodexPipeline(deps);
  const control = async (session = "codex-session-one") => {
    const current = await service().projection("owner");
    if (!current.sessionId && current.phase !== "COMPLETED" && current.phase !== "STOPPED") await service().claim("owner", { sessionId: session, expectedRevision: current.revision });
    return { sessionId: session, expectedRevision: (await service().projection("owner")).revision };
  };
  const submitRaw = async result => {
    const c = await control(); const task = await service().task("owner", c);
    await service().submit("owner", c, { schema_version: "p0-single-codex-result-v1", run_id: task.run_id, input_digest: task.input_digest, result });
  };
  // Existing product scenarios use a reviewed product; refinement-specific cases below call submitRaw step by step.
  const submit = async result => {
    await submitRaw(result);
    const projection = await service().projection("owner");
    if (projection.phase === "READY" && projection.stage === "CAMPAIGNS") {
      const task = await service().task("owner", await control());
      if (task.source.campaign_refinement?.phase === "REVIEW") await submitRaw(critiqueFixture(task));
    }
  };
  const evidence = async () => {
    await service().collect("owner", await control());
    await submit(evidenceProposal());
  };
  const evidenceProposal = (options = {}) => {
    const candidate = formationEvidence(snapshot.snapshot_id, options);
    candidate.research.keyword_research = keywordResearchFixture(candidate.research, ["участие со стендом", "формат участия компании"]);
    candidate.research.goal_requirements = goalRequirementsFixture(candidate.research, h.goals.current.revision, [snapshot.snapshot_id]);
    return candidate;
  };
  return { ...h, database, deps, workspaces, snapshot, service, control, submit, submitRaw, evidence, evidenceProposal,
    get collections() { return collections; }, setTime(value) { time = value; } };
}

test("fresh collector snapshots accept research additions and preserve verified demand during source corrections", async () => {
  const h = await harness(), original = structuredClone(h.snapshot);
  assert.equal(h.snapshot.business_research, undefined);
  const material = { id: "PUBLIC-CHECK", kind: "OFFICIAL_OBSERVATIONS", label: "Additional public source", source_urls: ["https://owner.example/"], observed_at: "2026-09-09T10:00:00Z", content: { observation: "Isolated source attachment check" } };
  const enriched = await withBusinessResearchMaterial(h.snapshot, material);
  assert.equal(await verifyAnalyticsEvidenceSnapshot(enriched), true);
  assert.deepEqual(enriched.business_research.supporting_materials, [material]);
  assert.equal(enriched.business_research.plan.goal.digest, h.goals.current.revision.digest);
  const input = replaySnapshotInput(); input.model.goal_research_scope = h.goals.current.revision;
  input.marketEvidenceSource = enriched;
  const corrected = await buildAnalyticsEvidence(input);
  assert.equal(await verifyAnalyticsEvidenceSnapshot(corrected), true);
  assert.deepEqual(corrected.market_evidence, enriched.market_evidence);
  assert.deepEqual(h.snapshot, original);
  await assert.rejects(buildAnalyticsEvidence({ ...input, site: { ...input.site, url: "https://another.example/" } }), /той же цели и компании/u);
  const tampered = structuredClone(enriched); tampered.market_evidence.frequency.status = "INVENTED";
  await assert.rejects(buildAnalyticsEvidence({ ...input, marketEvidenceSource: tampered }), /той же цели и компании/u);
});
function strategyProposal(task) {
  const values = { business_goal: task.source.run.goal_formation.revision.desired_outcome, campaign_focus: "Получение заявок на участие со стендом",
    advertised_offer: "Участие со стендом", target_audience: "Промышленные компании", qualified_result: "Заявка компании", exclusions: "Посетители", geography: "Москва",
    period: { start_date: "2026-09-09", end_date: "2026-10-01" }, landing_page: "https://owner.example/", weekly_budget: 30000, target_result_cost: 5000,
    core_message: "Участие со стендом для промышленных компаний." };
  Object.assign(values, task.context.inputs.business_input.content.locked_business_constraints);
  values.target_result_cost = task.context.inputs.business_input.content.previous_strategy_recommendations.target_result_cost ?? null;
  const plan = formationPlan(values, task.context.formation_research);
  if (task.context.goal_preparation) plan.goal_preparation = goalPreparationFixture(plan, task.source.run.goal_formation.revision, task.context.evidence_reference_ids, values.period);
  if (task.context.goal_preparation?.version === "goal-directed-preparation-v4") upgradeGoalPreparationFixture(plan.goal_preparation, task.source.run.goal_formation.revision, task.context.formation_research);
  return { dimensions: task.context.canonical_dimensions.map(dimension_id => ({ dimension_id, value: values[dimension_id],
    rationale: "Предложение из источника; выбор аудитории является гипотезой.", confidence: "LOW", evidence_refs: task.context.evidence_reference_ids.slice(0, 8) })),
    rationale: "Проверка спроса на участие со стендом в пределах бюджета. Результативность пока неизвестна.", confidence: "LOW", formation_plan: plan };
}
function portfolio(task) {
  const result = formationPortfolio(task);
  if (task.context.formation_plan.goal_preparation.version === "goal-directed-preparation-v4") upgradeGoalReviewFixture(result.goal_review, task.context.formation_research);
  return result;
}
function supportedStrategy(task) {
  const proposal = strategyProposal(task), forecast = proposal.formation_plan.goal_preparation.forecast;
  const estimate = (low, high) => ({ range: { low, high }, basis: "INFERENCE", evidence_refs: task.context.evidence_reference_ids.slice(0, 1), explanation: "Изолированный сценарий проверки перехода; не реальные бизнес-данные." });
  forecast.scope = "FULL_GOAL";
  forecast.duplicate_result_percent = estimate(0, 0); forecast.result_before_deadline_percent = estimate(100, 100);
  forecast.inputs.forEach(row => Object.assign(row, { cpc_rub: estimate(100, 100), click_to_qualified_percent: estimate(10, 10), obtainable_clicks: estimate(500, 500) }));
  return proposal;
}
function supportedPortfolio(task) {
  const result = portfolio(task); result.goal_review.goal_attainment = "SUPPORTED_BY_ESTIMATE"; return result;
}


test("owner Start leaves the controller lease free and dispatches the existing run once", async () => {
  const h = await harness(); let calls = 0;
  h.deps.dispatch = async request => { calls++; assert.equal((await h.service().projection("owner")).sessionId, null); return { status: "QUEUED", request_id: request.request_id }; };
  await h.service().start("owner", h.view, "owner-browser-session");
  let view = await h.service().projection("owner");
  assert.equal(view.sessionId, null); assert.equal(view.dispatch.status, "QUEUED"); assert.equal(calls, 1);
  await h.service().requestDispatch("owner", view.runId, view.revision); assert.equal(calls, 1);
  await h.control(); view = await h.service().projection("owner");
  assert.equal(view.dispatch.status, "ACKNOWLEDGED"); assert.equal(view.controllerActive, true);
});

test("explicit Wordstat phases require existing evidence and preserve the frozen goal", async () => {
  const h = await harness(); await h.service().start("owner", h.view, "codex-session-one");
  const request = { queries: ["участие в выставке"], region: { id: 225, name: "Россия" }, similar: true };
  await assert.rejects(h.service().collect("owner", await h.control(), request), /Сначала загрузите срез/);
  await h.service().collect("owner", await h.control());
  const before = await h.service().task("owner", await h.control());
  let received; h.deps.collect = async input => { received = input; return h.snapshot; };
  await h.service().collect("owner", await h.control(), request);
  const after = await h.service().task("owner", await h.control());
  assert.deepEqual(received.wordstatResearch, request);
  assert.deepEqual(received.seedSnapshot, before.source.snapshot);
  assert.deepEqual(after.context.goal, before.context.goal);
  assert.equal(after.stage, "EVIDENCE_COLLECTION");
  await assert.rejects(h.service().collect("owner", await h.control("other-session"), request), /управление/);
});

test("failed dispatch preserves the run and can resume without repeating Goal", async () => {
  const h = await harness(); let calls = 0;
  h.deps.dispatch = async request => { if (++calls === 1) throw new Error("delivery unavailable"); return { status: "QUEUED", request_id: request.request_id }; };
  await h.service().start("owner", h.view, "owner-browser-session");
  const view = await h.service().projection("owner"), events = (await h.runStore.loadAudit(view.runId)).length;
  assert.equal(view.dispatch.status, "FAILED"); assert.equal(view.phase, "READY"); assert.equal(view.sessionId, null);
  await h.service().requestDispatch("owner", view.runId, view.revision);
  assert.equal((await h.service().projection("owner")).dispatch.status, "QUEUED");
  assert.equal((await h.runStore.loadAudit(view.runId)).length, events); assert.equal(calls, 2);
});

test("controller acknowledgement racing the queue receipt is not overwritten", async () => {
  const h = await harness();
  h.deps.dispatch = async request => { await h.control(); return { status: "QUEUED", request_id: request.request_id }; };
  await h.service().start("owner", h.view, "owner-browser-session");
  const view = await h.service().projection("owner");
  assert.equal(view.dispatch.status, "ACKNOWLEDGED"); assert.equal(view.sessionId, "codex-session-one");
});

test("one Codex completes all stages through durable handoffs across service instances", async () => {
  const h = await harness(); await h.service().start("owner", h.view, "codex-session-one");
  assert.equal(h.collections, 0); assert.equal((await h.service().projection("owner")).stage, "EVIDENCE_COLLECTION");
  await h.evidence(); let task = await h.service().task("owner", await h.control()); assert.equal(task.stage, "STRATEGY");
  await h.submit(supportedStrategy(task)); task = await h.service().task("owner", await h.control()); assert.equal(task.stage, "CAMPAIGNS");
  assert.equal(task.context.content_context.limits.campaigns, undefined);
  assert.equal(task.context.content_context.limits.groups, undefined);
  assert.equal(task.context.generation_context.optimization.objective, "ACHIEVE_QUALIFIED_TARGET_WITH_MINIMUM_SPEND");
  await h.submit(supportedPortfolio(task));
  assert.equal((await h.service().projection("owner")).phase, "COMPLETED"); assert.equal(h.products.current.campaign_pairs.length, 1);
  assert.equal(h.products.current.campaign_strategy.strategy.accepted_by.kind, "SINGLE_CODEX");
  const events = await h.runStore.loadAudit(h.products.current.run_id);
  assert.deepEqual([...new Set(events.filter(e => e.actor.actor_type === "AGENT").map(e => e.actor.role))], ["SINGLE_CODEX"]);
  assert.equal(h.collections, 1); assert.equal(h.products.current.authority.spend_micros, 0);
});
test("a cold-start goal preserves several working templates without certifying unknown goal attainment", async () => {
  const h = await harness(); await h.service().start("owner", h.view, "codex-session-one"); await h.evidence();
  let task = await h.service().task("owner", await h.control()); const proposal = strategyProposal(task), plan = proposal.formation_plan;
  const half = Math.floor(plan.directions[0].weekly_budget_rub / 2);
  plan.directions[0].weekly_budget_rub = half;
  plan.directions.push({ ...structuredClone(plan.directions[0]), id: "D2", name: "Выбор оснащённого формата", intent: "Выбор оснащённого формата участия", weekly_budget_rub: half });
  plan.decisions.find(d => d.finding_id === "F1").target_ids.push("D2");
  plan.goal_preparation = goalPreparationFixture(plan, task.source.run.goal_formation.revision, task.context.evidence_reference_ids, plan.goal_preparation.forecast.period);
  upgradeGoalPreparationFixture(plan.goal_preparation, task.source.run.goal_formation.revision, task.context.formation_research);
  await h.submit(proposal); task = await h.service().task("owner", await h.control());
  const result = portfolio(task), first = result.campaigns[0], second = structuredClone(first);
  first.allocations[0].cap_rub = plan.goal_preparation.directions[0].budget_rub; first.groups[0].allocations[0].cap_rub = first.allocations[0].cap_rub;
  second.id = "C2"; second.direction_id = "D2"; second.name = "Выбор оснащённого формата"; second.allocations[0].cap_rub = plan.goal_preparation.directions[1].budget_rub;
  second.groups[0].id = "G2"; second.groups[0].allocations[0].cap_rub = second.allocations[0].cap_rub; second.groups[0].keywords[0].phrase = "формат участия компании";
  second.groups[0].ads.forEach((a, i) => { a.id = `C2-A${i + 1}`; a.variant_id = null; a.url = `${plan.landing.url}?utm_campaign=c2&utm_content=a${i + 1}`; });
  result.campaigns.push(second); result.applications[0].target_ids.push("C2", "G2");
  result.goal_review = goalReviewFixture(result, plan, task.context.content_context);
  upgradeGoalReviewFixture(result.goal_review, task.context.formation_research);
  result.goal_review.groups.forEach(g => g.reuse_reason = "В изолированном тесте проверяется сохранение двух структур; факты предложения совпадают.");
  result.keyword_review = keywordReviewFixture(task.context.formation_research, result);
  result.optimization_review = optimizationReviewFixture(plan, result);
  await h.submit(result);
  const saved = await h.service().projection("owner");
  assert.equal(saved.phase, "READY"); assert.equal(saved.workingCampaigns.readiness.status, "NEEDS_EVIDENCE");
  assert.equal(saved.workingCampaigns.bundle.portfolio.campaigns.length, 2);
  assert.equal(h.products.current.campaign_pairs.length, 0);
  assert.ok(JSON.stringify(saved.workingCampaigns).includes("candidate-D2"));
  assert.equal(result.campaigns.reduce((s, c) => s + c.allocations[0].cap_rub, 0), plan.budget.total_cap_rub);
});
test("offline plan analysis and history attachment preserve the goal and reach stage materials", async t => {
  const h = await harness(); await h.service().start("owner", h.view, "codex-session-one");
  const initialTask = await h.service().task("owner", await h.control());
  await h.evidence(); const task = await h.service().task("owner", await h.control());
  const dir = await mkdtemp(join(tmpdir(), "goal-template-tools-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const script = new URL("../scripts/pipeline-tools.mjs", import.meta.url).pathname, run = promisify(execFile);
  await writeFile(join(dir, "task.json"), JSON.stringify(task), { mode: 0o600 }); await writeFile(join(dir, "strategy.json"), JSON.stringify(strategyProposal(task)), { mode: 0o600 });
  const analysis = JSON.parse((await run(process.execPath, [script, "analyze-plan", join(dir, "task.json"), join(dir, "strategy.json")])).stdout);
  assert.equal(analysis.persisted, false); assert.equal(analysis.analysis.forecast.results, null); assert.equal(analysis.comparisons.length, 2);
  const input = replaySnapshotInput(); input.model.goal_research_scope = h.goals.current.revision;
  input.model.business_research = { schema_version: FINDINGS_POLICY, plan: buildFindingsResearchPlan(h.goals.current.revision), sources: [], observations: [], attempts: [], gaps: [], observed_at: input.generatedAt, completion_reason: "Изолированная проверка передачи истории" };
  const source = await buildAnalyticsEvidence(input);
  const history = { schema_version: "direct-template-research-v1", observed_at: "2026-09-09T10:00:00Z", account: "test-account", period: { from: "2026-06-09", to: "2026-09-06" }, authority: { provider_writes: false, browser_cabinet: false }, collections: {}, templates: [], reports: [], measurement: [], limitations: ["Изолированный пример передачи, не бизнес-результат"] };
  await writeFile(join(dir, "snapshot.json"), JSON.stringify(source), { mode: 0o600 }); await writeFile(join(dir, "direct.json"), JSON.stringify(history), { mode: 0o600 });
  await run(process.execPath, [script, "attach-direct", join(dir, "snapshot.json"), join(dir, "direct.json"), join(dir, "updated.json")]);
  const updated = JSON.parse(await readFile(join(dir, "updated.json"), "utf8"));
  assert.equal(await verifyAnalyticsEvidenceSnapshot(updated), true); assert.deepEqual(updated.goal_context, source.goal_context); assert.notEqual(updated.snapshot_id, source.snapshot_id);
  assert.equal((await stat(join(dir, "updated.json"))).mode & 0o777, 0o600);
  const next = await preparePipelineStageTask({ ...initialTask.source, snapshot: updated });
  assert.equal(next.context.direct_campaign_research.length, 1); assert.equal(next.context.direct_campaign_research[0].account, "test-account");
});
test("new run enforces goal comparison and review before advancing or accepting campaign work", async () => {
  const h = await harness(); await h.service().start("owner", h.view, "codex-session-one"); await h.evidence();
  let task = await h.service().task("owner", await h.control());
  assert.equal(task.context.goal_preparation.version, "goal-directed-preparation-v4");
  const strategy = strategyProposal(task), missing = structuredClone(strategy); delete missing.formation_plan.goal_preparation;
  await assert.rejects(h.submit(missing), error => error.violations?.some(v => v.code === "FORMATION_SHAPE_INVALID"));
  assert.equal((await h.service().projection("owner")).stage, "STRATEGY");
  await h.submit(strategy); task = await h.service().task("owner", await h.control());
  const candidate = portfolio(task), weak = structuredClone(candidate); weak.goal_review.checks[0].status = "BLOCKER";
  await assert.rejects(h.submit(weak), error => error.violations?.some(v => v.code === "GOAL_REVIEW_NOT_READY"));
  assert.equal((await h.service().projection("owner")).stage, "CAMPAIGNS");
  const inflated = structuredClone(candidate); inflated.goal_review.goal_attainment = "SUPPORTED_BY_ESTIMATE";
  await assert.rejects(h.submit(inflated), error => error.violations?.some(v => v.code === "GOAL_ATTAINMENT_UNSUPPORTED"));
  const productsBefore = structuredClone(h.products.current), eventsBefore = await h.runStore.loadAudit(task.run_id);
  await h.submit(candidate);
  const saved = await h.service().projection("owner");
  assert.equal(saved.phase, "READY"); assert.equal(saved.stage, "CAMPAIGNS");
  assert.equal(saved.workingCampaigns.readiness.status, "NEEDS_EVIDENCE");
  assert.deepEqual(h.products.current, productsBefore);
  assert.deepEqual(await h.runStore.loadAudit(task.run_id), eventsBefore);
  await h.service().release("owner", await h.control());
  const resumed = await h.service().task("owner", await h.control("codex-session-two"));
  const { refinement_review, ...savedCandidate } = resumed.source.saved_campaign_candidate.candidate;
  assert.equal(refinement_review.final_review.recommendation, "ACCEPT");
  assert.deepEqual(savedCandidate, candidate);
  assert.notEqual(resumed.input_digest, task.input_digest);
  await assert.rejects(h.service().submit("owner", await h.control("codex-session-two"), { schema_version: "p0-single-codex-result-v1", run_id: task.run_id, input_digest: task.input_digest, result: candidate }), /другой версии/);
  await h.service().requestResearch("owner", await h.control("codex-session-two"), "Получить сопоставимую квалификацию и стоимость клика для оценки всей цели");
  assert.equal((await h.service().projection("owner")).stage, "EVIDENCE_COLLECTION");
  assert.equal((await h.service().projection("owner")).workingCampaigns, undefined);
  assert.equal((await h.service().task("owner", await h.control("codex-session-two"))).source.saved_campaign_candidate.candidate.campaigns.length, 1);
});
test("Start freezes optimization obligations; rejected decisions survive restart and cannot silently advance", async () => {
  const h = await harness(); await h.service().start("owner", h.view, "owner-browser-session");
  const first = await h.service().task("owner", await h.control());
  assert.equal(first.source.campaign_optimization_version, CAMPAIGN_OPTIMIZATION_VERSION);
  assert.equal(first.context.campaign_optimization.version, CAMPAIGN_OPTIMIZATION_VERSION);
  await h.evidence(); let task = await h.service().task("owner", await h.control());
  assert.equal(task.context.campaign_optimization.stage, "STRATEGY");
  await h.submit(supportedStrategy(task)); task = await h.service().task("owner", await h.control());
  assert(task.output_schema.required.includes("optimization_review"));
  const good = supportedPortfolio(task), missing = structuredClone(good); delete missing.optimization_review;
  const productsBefore = structuredClone(h.products.current), auditBefore = await h.runStore.loadAudit(task.run_id);
  await assert.rejects(h.submit(missing), e => e.violations?.some(v => v.code === "FORMATION_SHAPE_INVALID"));
  assert.deepEqual(h.products.current, productsBefore); assert.deepEqual(await h.runStore.loadAudit(task.run_id), auditBefore);
  await h.service().release("owner", await h.control());
  const control = await h.control("codex-session-two"), resumed = await h.service().task("owner", control);
  assert.deepEqual(resumed.source.repair_context.rejected_candidate, missing);
  assert(resumed.context.repair_context.violations.some(v => v.code === "FORMATION_SHAPE_INVALID"));
  assert.notEqual(resumed.input_digest, task.input_digest);
  await h.service().submit("owner", control, { schema_version: "p0-single-codex-result-v1", run_id: resumed.run_id, input_digest: resumed.input_digest, result: good });
  const critiqueTask = await h.service().task("owner", await h.control("codex-session-two"));
  assert.equal(critiqueTask.source.campaign_refinement.phase, "REVIEW");
  await h.service().submit("owner", await h.control("codex-session-two"), { schema_version: "p0-single-codex-result-v1", run_id: critiqueTask.run_id, input_digest: critiqueTask.input_digest, result: critiqueFixture(critiqueTask) });
  assert.equal((await h.service().projection("owner")).phase, "COMPLETED");
  const workspace = await h.workspaces.load(task.run_id);
  assert.equal(workspace.rejected_proposal, null); assert.equal(workspace.last_error, null);
  assert.equal(h.products.current.authority.spend_micros, 0);
});

test("actual settings invalidate old comparisons, while repaired review preserves cold-start completion", async () => {
  const h = await harness(); await h.service().start("owner", h.view, "owner-browser-session"); await h.evidence();
  let task = await h.service().task("owner", await h.control()); const strategy = strategyProposal(task);
  strategy.formation_plan.goal_preparation.forecast.scope = "FULL_GOAL";
  await h.submit(strategy); task = await h.service().task("owner", await h.control());
  const candidate = portfolio(task), plan = task.context.formation_plan;
  const before = candidate.optimization_review.groups[0].parameters.find(p => p.parameter === "DELIVERY").selected_value_json;
  candidate.campaigns[0].bidding.average_cpc_rub = 100;
  await assert.rejects(h.submit(candidate), e => e.violations?.some(v => v.code === "OPTIMIZATION_SELECTION_CHANGED"));
  candidate.optimization_review = optimizationReviewFixture(plan, candidate);
  const after = candidate.optimization_review.groups[0].parameters.find(p => p.parameter === "DELIVERY").selected_value_json;
  candidate.optimization_review.issues.push({ id: "repair-targeting", kind: "PREPARATION_DEFECT", status: "REPAIRED", finding: "Изолированная проверка изменения ограничения цены клика", action: "В примере ограничена средняя цена клика", affected_ids: ["C1"], evidence_refs: [], repair: { group_id: "G1", parameter: "DELIVERY", before_value_json: before, after_value_json: after } });
  candidate.goal_review.preparation_decision = preparationDecisionFixture(plan);
  await h.submit(candidate);
  assert.equal((await h.service().projection("owner")).phase, "COMPLETED");
  assert.equal(candidate.goal_review.goal_attainment, "UNASSESSED");
  const stored = h.products.current.campaign_pairs[0].draft.publish_projection.formation;
  assert.equal(stored.portfolio.optimization_review.issues[0].repair.after_value_json, after);
});

test("offline optimization inputs inspect final settings without choosing a winner or changing application state", async t => {
  const h = await harness(); await h.service().start("owner", h.view, "owner-browser-session"); await h.evidence();
  let task = await h.service().task("owner", await h.control()); await h.submit(supportedStrategy(task)); task = await h.service().task("owner", await h.control());
  const candidate = portfolio(task); delete candidate.optimization_review;
  const dir = await mkdtemp(join(tmpdir(), "optimization-inputs-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const taskPath = join(dir, "task.json"), candidatePath = join(dir, "candidate.json"), output = join(dir, "inputs.json");
  await writeFile(taskPath, JSON.stringify(task)); await writeFile(candidatePath, JSON.stringify(candidate));
  const before = structuredClone(h.products.current);
  const result = JSON.parse((await promisify(execFile)(process.execPath, [new URL("../scripts/pipeline-tools.mjs", import.meta.url).pathname, "optimization-inputs", taskPath, candidatePath, output])).stdout);
  assert.equal(result.decisions_generated, false); assert.equal(result.persisted, false);
  const inspected = JSON.parse(await readFile(output, "utf8"));
  assert.deepEqual(inspected.groups, campaignOptimizationParameters(task.context.formation_plan, candidate));
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  assert.deepEqual(h.products.current, before);
});

test("draft, critique, substantive revision and final review are separate durable steps", async () => {
  const h = await harness(); await h.service().start("owner", h.view, "owner-browser-session"); await h.evidence();
  let task = await h.service().task("owner", await h.control()); await h.submit(supportedStrategy(task));
  task = await h.service().task("owner", await h.control());
  const candidate = supportedPortfolio(task), stageVersion = task.run_version, beforeProducts = structuredClone(h.products.current);
  await h.submitRaw(candidate);
  assert.deepEqual(h.products.current, beforeProducts, "A first draft cannot publish a finished local product");
  let critiqueTask = await h.service().task("owner", await h.control());
  assert.equal(critiqueTask.run_version, stageVersion); assert.equal(critiqueTask.source.campaign_refinement.phase, "REVIEW");
  assert.notEqual(critiqueTask.input_digest, task.input_digest);
  const review = critiqueFixture(critiqueTask);
  review.recommendation = "REVISE";
  review.issues = [{ id: "ACTION-UNCLEAR", ad_ids: ["A1"], scope: "COPY", problem: "Призыв не ведёт к заявке компании", required_change: "Сформулировать действие заявки со стендом", finding_ids: ["F1"], research_required: false }];
  const adReview = review.ads.find(a => a.ad_id === "A1"); adReview.decision = "REVISE";
  Object.assign(adReview.checks.find(c => c.criterion === "QUALIFIED_ACTION"), { status: "WEAK", ad_fragments: ["Узнайте подробности."], issue_ids: ["ACTION-UNCLEAR"] });
  await h.submitRaw(review);
  const unchanged = structuredClone(candidate); unchanged.selection_rationale = "Новое обоснование без изменения объявления";
  await assert.rejects(h.submitRaw(unchanged), e => e.violations?.some(v => v.code === "REFINEMENT_DEFECT_UNCHANGED"));
  const punctuation = structuredClone(candidate); punctuation.campaigns[0].groups[0].ads[0].texts[0] = "Узнайте подробности!";
  punctuation.goal_review.groups[0].candidates.find(c => c.ad_id === "A1").texts = ["Узнайте подробности!"];
  punctuation.goal_review.outcome_review.creative_combinations.find(c => c.ad_id === "A1").text = "Узнайте подробности!";
  punctuation.optimization_review = optimizationReviewFixture(task.context.formation_plan, punctuation);
  await assert.rejects(h.submitRaw(punctuation), e => e.violations?.some(v => v.code === "REFINEMENT_DEFECT_UNCHANGED"));
  const renamed = structuredClone(candidate);
  renamed.campaigns[0].groups[0].id = "G-renamed"; renamed.campaigns[0].groups[0].ads[0].id = "A-renamed";
  renamed.goal_review.groups[0].group_id = "G-renamed"; renamed.goal_review.groups[0].candidates.find(c => c.ad_id === "A1").ad_id = "A-renamed";
  renamed.goal_review.outcome_review.group_selections[0].group_id = "G-renamed";
  renamed.goal_review.outcome_review.creative_combinations.filter(c => c.ad_id === "A1").forEach(c => { c.ad_id = "A-renamed"; });
  renamed.applications.forEach(a => { a.target_ids = a.target_ids.map(id => id === "G1" ? "G-renamed" : id === "A1" ? "A-renamed" : id); });
  renamed.keyword_review = keywordReviewFixture(task.context.formation_research, renamed);
  renamed.optimization_review = optimizationReviewFixture(task.context.formation_plan, renamed);
  await assert.rejects(h.submitRaw(renamed), e => e.violations?.some(v => v.code === "REFINEMENT_DEFECT_UNCHANGED"));
  await h.service().release("owner", await h.control());
  const resumed = await h.service().task("owner", await h.control("codex-session-two"));
  assert.equal(resumed.source.campaign_refinement.phase, "REVISION");
  assert.deepEqual(resumed.source.campaign_refinement.revision_request, review);
  const revised = structuredClone(candidate), newText = "Участие со стендом. Оставьте заявку на сайте.";
  revised.campaigns[0].groups[0].ads[0].texts = [newText];
  revised.goal_review.groups[0].candidates.find(c => c.ad_id === "A1").texts = [newText];
  revised.goal_review.outcome_review.creative_combinations.find(c => c.ad_id === "A1").text = newText;
  revised.optimization_review = optimizationReviewFixture(task.context.formation_plan, revised);
  const submitAsSecond = async result => { const control = await h.control("codex-session-two"), current = await h.service().task("owner", control); await h.service().submit("owner", control, { schema_version: "p0-single-codex-result-v1", run_id: current.run_id, input_digest: current.input_digest, result }); };
  await submitAsSecond(revised);
  critiqueTask = await h.service().task("owner", await h.control("codex-session-two"));
  assert.equal(critiqueTask.source.campaign_refinement.phase, "REVIEW"); assert.equal(critiqueTask.source.campaign_refinement.round, 2);
  await assert.rejects(submitAsSecond(review), e => e.violations?.some(v => v.code === "CRITIQUE_DRAFT_CHANGED"));
  const invalid = critiqueFixture(await h.service().task("owner", await h.control("codex-session-two")));
  invalid.ads[0].checks[0].ad_fragments = ["Обещание, которого в объявлении нет"];
  await assert.rejects(submitAsSecond(invalid), e => e.violations?.some(v => v.code === "CRITIQUE_FRAGMENT_NOT_IN_AD"));
  const final = critiqueFixture(await h.service().task("owner", await h.control("codex-session-two")));
  await submitAsSecond(final);
  assert.equal((await h.service().projection("owner")).phase, "COMPLETED");
  const stored = h.products.current.campaign_pairs[0].draft.publish_projection.formation.portfolio;
  assert.equal(stored.campaigns[0].groups[0].ads[0].texts[0], newText);
  assert.equal(stored.refinement_review.previous_reviews.length, 1);
  assert.equal(stored.refinement_review.previous_reviews[0].recommendation, "REVISE");
  assert.equal(stored.refinement_review.final_review.draft_digest, final.draft_digest);
  assert.equal(h.products.current.authority.spend_micros, 0);
  const tampered = structuredClone(stored); tampered.selection_rationale += " Изменено после разбора.";
  await assert.rejects(compilePipelineStageTask(critiqueTask, tampered), e => e.violations?.some(v => v.code === "CRITIQUE_DRAFT_CHANGED"));
});

test("research requested by critique survives upstream return and must receive an explicit finding", async () => {
  const h = await harness(); await h.service().start("owner", h.view, "owner-browser-session"); await h.evidence();
  let task = await h.service().task("owner", await h.control()); await h.submit(supportedStrategy(task));
  task = await h.service().task("owner", await h.control()); const candidate = supportedPortfolio(task); await h.submitRaw(candidate);
  const critique = critiqueFixture(await h.service().task("owner", await h.control()));
  critique.recommendation = "REVISE";
  critique.issues = [{ id: "OFFER-SCOPE", ad_ids: ["A1"], scope: "COPY", problem: "Область применимости предложения требует уточнения", required_change: "Уточнить область предложения в источнике", finding_ids: ["F1"], research_required: true }];
  critique.ads[0].decision = "REVISE";
  Object.assign(critique.ads[0].checks.find(c => c.criterion === "FACTUAL_SCOPE"), { status: "WEAK", issue_ids: ["OFFER-SCOPE"] });
  await h.submitRaw(critique);
  await assert.rejects(h.submitRaw(candidate), e => e.violations?.some(v => v.code === "REFINEMENT_RESEARCH_REQUIRED"));
  await h.service().requestResearch("owner", await h.control(), "Уточнить область предложения из критического разбора объявлений");
  task = await h.service().task("owner", await h.control());
  assert.equal(task.stage, "EVIDENCE_COLLECTION"); assert.equal(task.source.campaign_refinement, undefined);
  assert.deepEqual(task.source.previous_campaign_draft, candidate);
  assert.equal(task.context.required_refinement_findings[0].finding_id, "refinement:OFFER-SCOPE");
  const evidence = h.evidenceProposal();
  await assert.rejects(h.submitRaw(evidence), e => e.violations?.some(v => v.code === "REFINEMENT_RESEARCH_UNANSWERED"));
  evidence.research.findings.push({ id: "refinement:OFFER-SCOPE", area: "offer", state: "UNKNOWN", finding: "Изолированный пример: дополнительная область предложения не установлена.", evidence_refs: [], limitation: "Не использовать неподтверждённое расширение предложения." });
  evidence.research.coverage.find(c => c.area === "offer").finding_ids.push("refinement:OFFER-SCOPE");
  await h.submitRaw(evidence);
  task = await h.service().task("owner", await h.control());
  assert.equal(task.stage, "STRATEGY"); assert.deepEqual(task.source.previous_campaign_draft, candidate);
  assert(task.context.formation_research.findings.some(f => f.id === "refinement:OFFER-SCOPE" && f.state === "UNKNOWN"));
});

test("lease excludes another session and supports explicit transfer and expiry", async () => {
  const h = await harness(); await h.service().start("owner", h.view, "codex-session-one");
  assert.equal((await h.service().projection("owner")).sessionId, null);
  await h.control();
  await assert.rejects(h.service().claim("owner", await h.control("codex-session-two")), /другой сессии/);
  await h.service().release("owner", await h.control()); await h.service().claim("owner", await h.control("codex-session-two"));
  await assert.rejects(h.service().task("owner", await h.control()), /возьмите управление/);
  assert.equal((await h.service().task("owner", await h.control("codex-session-two"))).stage, "EVIDENCE_COLLECTION");
  h.setTime("2026-09-09T10:31:00.000Z"); await h.service().claim("owner", await h.control());
  assert.equal((await h.service().projection("owner")).sessionId, "codex-session-one");
});
test("invalid and stale proposals cannot advance or replace products", async () => {
  const h = await harness(); await h.service().start("owner", h.view, "codex-session-one"); await h.service().collect("owner", await h.control());
  const task = await h.service().task("owner", await h.control()); const original = structuredClone(h.products.current);
  await assert.rejects(h.submit({ summary: "Некорректный анализ", findings: [], evidence_refs: ["invented-evidence"], gap_refs: [] }), /не прошёл проверку/);
  assert.deepEqual(h.products.current, original); assert.equal((await h.service().projection("owner")).stage, "EVIDENCE_COLLECTION");
  assert.ok((await h.service().projection("owner")).lastError.violations.length);
  h.setTime("2026-09-09T10:01:00.000Z"); await h.service().collect("owner", await h.control());
  await assert.rejects(h.service().submit("owner", await h.control(), { schema_version: "p0-single-codex-result-v1", run_id: task.run_id, input_digest: task.input_digest, result: {} }), /другой версии/);
});
test("interrupted product commit resumes without duplicate audit events", async () => {
  const h = await harness(); await h.service().start("owner", h.view, "codex-session-one"); await h.service().collect("owner", await h.control());
  const original = h.products.compareAndSwap.bind(h.products); h.products.compareAndSwap = async () => { throw new Error("simulated storage interruption"); };
  await assert.rejects(h.submit(h.evidenceProposal()), /storage interruption/);
  assert.equal((await h.service().projection("owner")).phase, "COMMITTING"); const count = (await h.runStore.loadAudit(h.products.current.run_id)).length;
  h.products.compareAndSwap = original; await h.service().resume("owner", await h.control());
  assert.equal((await h.runStore.loadAudit(h.products.current.run_id)).length, count); assert.equal((await h.service().projection("owner")).stage, "STRATEGY");
});
test("late collection after Stop cannot change evidence", async () => {
  const h = await harness(); await h.service().start("owner", h.view, "codex-session-one");
  let finish; h.deps.collect = () => new Promise(resolve => { finish = resolve; });
  const collecting = h.service().collect("owner", await h.control()); while (!finish) await new Promise(resolve => setImmediate(resolve));
  const current = await h.controller.current("owner"); await h.controller.stop("owner", { runId: current.runId, expectedVersion: current.version });
  finish(h.snapshot); await assert.rejects(collecting, /остановлен/); assert.equal(h.products.current.analytics_evidence_snapshot, null);
});
test("exported source is sanitized and tampering fails offline verification", async () => {
  const h = await harness(); h.view.state.business_model.private_api_token = "secret-value"; await h.service().start("owner", h.view, "codex-session-one");
  const task = await h.service().task("owner", await h.control()); assert.doesNotMatch(JSON.stringify(task), /secret-value|private_api_token/);
  task.source.preparedAt = "2026-09-10T10:00:00.000Z"; await assert.rejects(compilePipelineStageTask(task, {}), /Входные данные этапа изменились/);
  assert.throws(() => h.database.prepare("DELETE FROM p0_single_codex_workspace_revisions").run(), /immutable/);
});

test("verified sources can seed a new single-Codex run without fresh collection", async () => {
  const h = await harness(); await h.service().start("owner", h.view, "codex-session-one"); await h.evidence();
  await h.submit(supportedStrategy(await h.service().task("owner", await h.control())));
  await h.submit(supportedPortfolio(await h.service().task("owner", await h.control())));
  assert.ok(h.products.current.prior_verified_evidence.interpretation, "the saved interpretation remains reusable");
  const reuse = await h.controller.prepareEvidenceReuse("owner", await h.controller.frozenInputVersions("owner", h.view));
  assert.ok(reuse.plan, reuse.availability.reason);
  await h.service().start("owner", h.view, "codex-session-one", reuse.plan);
  assert.equal((await h.service().projection("owner")).hasEvidence, true);
  await assert.rejects(h.service().collect("owner", await h.control()), /датированный срез/);
  await h.submit(h.evidenceProposal());
  assert.equal((await h.service().task("owner", await h.control())).stage, "STRATEGY");
  assert.equal(h.collections, 1);
});

test("failed workspace initialization leaves no orphan active run or changed products", async () => {
  const h = await harness(); h.deps.workspaces = { load: async () => null, compareAndSwap: async () => false };
  await assert.rejects(h.service().start("owner", h.view, "codex-session-one"), /Рабочее состояние изменилось/);
  assert.equal(await h.runStore.loadActive("owner"), null); assert.equal(h.products.current, null);
});

test("Codex returns to research without changing the human goal and resumes an interrupted return", async () => {
  const h = await harness(); await h.service().start("owner", h.view, "codex-session-one"); await h.evidence();
  const oldTask = await h.service().task("owner", await h.control());
  const goal = JSON.stringify(h.goals.current);
  const original = h.products.compareAndSwap.bind(h.products); h.products.compareAndSwap = async () => { throw new Error("return storage interruption"); };
  await assert.rejects(h.service().requestResearch("owner", await h.control(), "Уточнить состав пакета перед выбором сообщения."), /return storage interruption/);
  const auditCount = (await h.runStore.loadAudit(oldTask.run_id)).length;
  h.products.compareAndSwap = original; await h.service().resume("owner", await h.control());
  assert.equal((await h.runStore.loadAudit(oldTask.run_id)).length, auditCount);
  const task = await h.service().task("owner", await h.control());
  assert.equal(task.stage, "EVIDENCE_COLLECTION"); assert.match(task.context.research_request, /состав пакета/);
  assert.equal(JSON.stringify(h.goals.current), goal); assert.equal(h.products.current.campaign_strategy, null);
  assert.deepEqual(h.products.current.campaign_pairs, []); assert.ok(h.products.current.prior_verified_evidence);
  await assert.rejects(h.service().submit("owner", await h.control(), { schema_version: "p0-single-codex-result-v1", run_id: oldTask.run_id, input_digest: oldTask.input_digest, result: strategyProposal(oldTask) }), /другой версии/);
  await h.evidence(); assert.equal((await h.service().task("owner", await h.control())).stage, "STRATEGY");
});

test("test scenario requires explicit run authorization and stays separate from source observations", async () => {
  const h = await harness(); await h.service().start("owner", h.view, "codex-session-one"); await h.service().collect("owner", await h.control());
  await assert.rejects(h.submit(h.evidenceProposal({ test: true })), e => e.violations?.some(v => v.code === "TEST_DATA_NOT_AUTHORIZED"));
  const run = await h.controller.current("owner"); await h.controller.stop("owner", { runId: run.runId, expectedVersion: run.version });
  await h.service().start("owner", h.view, "codex-session-one", undefined, true); await h.service().collect("owner", await h.control());
  await h.submit(h.evidenceProposal({ test: true }));
  const task = await h.service().task("owner", await h.control());
  assert.equal(task.context.formation_research.test_data[0].value, 100000);
  assert.equal(task.source.snapshot.test_data, undefined);
  await h.submit(strategyProposal(task)); await h.submit(portfolio(await h.service().task("owner", await h.control())));
  assert.ok(h.products.current.campaign_pairs[0].draft.publication_readiness.blockers.some(b => b.code === "TEST_SCENARIO_INPUTS"));
});

test("an expired collection cannot publish over its successor's workspace", async () => {
  const h = await harness(); await h.service().start("owner", h.view, "codex-session-one");
  let finish; h.deps.collect = () => new Promise(resolve => { finish = resolve; });
  const collecting = h.service().collect("owner", await h.control()); while (!finish) await new Promise(resolve => setImmediate(resolve));
  h.setTime("2026-09-09T10:31:00.000Z"); await h.service().claim("owner", await h.control("codex-session-two"));
  finish(h.snapshot); await assert.rejects(collecting, /остановлен или изменился/);
  assert.equal((await h.service().projection("owner")).sessionId, "codex-session-two");
  assert.equal((await h.service().projection("owner")).hasEvidence, false);
});


test("offline CLI packages a verified result, rejects errors and never overwrites files", async () => {
  const h = await harness(); await h.service().start("owner", h.view, "codex-session-one"); await h.service().collect("owner", await h.control());
  const task = await h.service().task("owner", await h.control());
  const dir = await mkdtemp(join(tmpdir(), "mox-codex-tools-"));
  try {
    const taskPath = join(dir, "task.json"), candidatePath = join(dir, "candidate.json"), resultPath = join(dir, "result.json");
    await writeFile(taskPath, JSON.stringify(task));
    await writeFile(candidatePath, JSON.stringify(h.evidenceProposal()));
    const script = new URL("../scripts/pipeline-tools.mjs", import.meta.url).pathname;
    const run = promisify(execFile);
    const output = await run(process.execPath, [script, "package", taskPath, candidatePath, resultPath]);
    assert.equal(JSON.parse(output.stdout).persisted, false);
    const envelope = JSON.parse(await readFile(resultPath, "utf8"));
    assert.equal(envelope.input_digest, task.input_digest); assert.equal(envelope.run_id, task.run_id);
    assert.equal((await stat(resultPath)).mode & 0o777, 0o600);
    await assert.rejects(run(process.execPath, [script, "package", taskPath, candidatePath, resultPath]), /EEXIST/);
    await writeFile(candidatePath, JSON.stringify({ ...h.evidenceProposal(), evidence_refs: ["invented"] }));
    await assert.rejects(run(process.execPath, [script, "validate", taskPath, candidatePath]), /FORMATION_SHAPE_INVALID/);
    assert.equal(h.products.current.current_stage, "CAMPAIGN_GOAL");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("cold start completes all stages with explicit local preparation review while numerical attainment stays unknown", async () => {
  const h = await harness(); await h.service().start("owner", h.view, "codex-session-one"); await h.evidence();
  let task = await h.service().task("owner", await h.control());
  assert.match(JSON.stringify(task.context), /Local preparation and measured effectiveness|READY_FOR_VALIDATION/);
  const proposal = strategyProposal(task); proposal.formation_plan.goal_preparation.forecast.scope = "FULL_GOAL";
  await h.submit(proposal); task = await h.service().task("owner", await h.control());
  const candidate = portfolio(task); candidate.goal_review.preparation_decision = preparationDecisionFixture(proposal.formation_plan);
  await h.submit(candidate);
  const saved = await h.service().projection("owner");
  assert.equal(saved.phase, "COMPLETED"); assert.equal(saved.sessionId, null);
  assert.equal(h.products.current.campaign_pairs.length, 1);
  assert.equal(candidate.goal_review.goal_attainment, "UNASSESSED");
  assert.equal(proposal.formation_plan.goal_preparation.forecast.inputs[0].cpc_rub.range, null);
  const persisted = JSON.stringify(h.products.current);
  assert.ok(persisted.includes("READY_FOR_VALIDATION")); assert.ok(persisted.includes("UNASSESSED"));
});
test("local preparation decision cannot bypass known full-goal shortfalls", async () => {
  const h = await harness(); await h.service().start("owner", h.view, "codex-session-one"); await h.evidence();
  let task = await h.service().task("owner", await h.control());
  const proposal = supportedStrategy(task); proposal.formation_plan.goal_preparation.forecast.inputs[0].cpc_rub.range = { low: 1000, high: 1000 };
  await h.submit(proposal); task = await h.service().task("owner", await h.control());
  const candidate = portfolio(task); candidate.goal_review.preparation_decision = preparationDecisionFixture(proposal.formation_plan);
  await h.submit(candidate);
  const saved = await h.service().projection("owner"); assert.equal(saved.phase, "READY"); assert.equal(saved.workingCampaigns.readiness.status, "NEEDS_REWORK");
  assert.equal(h.products.current.campaign_pairs.length, 0);
});

test("new campaign submission rejects an SVG master as a Direct upload asset", async () => {
  const h = await harness(); await h.service().start("owner", h.view, "codex-session-one"); await h.evidence();
  let task = await h.service().task("owner", await h.control()); await h.submit(supportedStrategy(task));
  task = await h.service().task("owner", await h.control());
  assert.equal(task.context.direct_preparation_rules.adType, "RESPONSIVE_AD");
  const candidate = supportedPortfolio(task);
  candidate.images = [{ id: "fixture-image", url: "https://owner.example/master.svg", alt: "Isolated fixture", origin: "Isolated test", rights: "Isolated test" }];
  candidate.campaigns[0].groups[0].ads[0].image_ids = ["fixture-image"];
  await assert.rejects(h.submit(candidate), error => error.violations?.some(v => v.code === "DIRECT_IMAGE_FORMAT_UNSUPPORTED"));
  assert.equal(h.products.current.campaign_pairs.length, 0);
});

test("new runs reject missing, stale or proxy-substituted goal requirements before advancing", async () => {
  const h = await harness();await h.service().start("owner", h.view, "codex-session-one");await h.service().collect("owner", await h.control());
  const missing = h.evidenceProposal();delete missing.research.goal_requirements;
  await assert.rejects(h.submitRaw(missing), e => e.violations?.some(v => v.code === "FORMATION_SHAPE_INVALID"));
  const stale = h.evidenceProposal();stale.research.goal_requirements.goal_digest = "sha256:" + "0".repeat(64);
  await assert.rejects(h.submitRaw(stale), e => e.violations?.some(v => v.code === "GOAL_REQUIREMENTS_STALE"));
  const proxy = h.evidenceProposal();proxy.research.goal_requirements.measurements = [{ source_ref: h.snapshot.snapshot_id, observed_outcome: "Отправка формы", outcome_type: "FORM_SUBMISSION", unit: "RESULT", relation: "EXACT", evidence_class: "BEHAVIORAL_OBSERVATION", observed_at: "2026-09-09T10:00:00Z", population: "Изолированный пример", period: null, permitted_use: "GOAL_ESTIMATE", limitation: "Квалификация не проверена" }];
  await assert.rejects(h.submitRaw(proxy), e => e.violations?.some(v => v.code === "GOAL_MEASUREMENT_PROXY_SUBSTITUTION"));
  assert.equal((await h.service().projection("owner")).stage, "EVIDENCE_COLLECTION");
  await h.submitRaw(h.evidenceProposal());assert.equal((await h.service().projection("owner")).stage, "STRATEGY");
});

test("paid orders, revenue, profit and proportions retain their metric through a full cold-start preparation", async () => {
  for (const outcome of ["PAID_ORDER", "REVENUE", "PROFIT", "CUSTOM"]) {
    const h = await harness(outcome);await h.service().start("owner", h.view, "codex-session-one");await h.evidence();
    let task = await h.service().task("owner", await h.control());
    assert.equal(task.context.goal_prelaunch.exact_metric.outcome_type, outcome);
    const proposal = strategyProposal(task), p = proposal.formation_plan.goal_preparation;
    p.forecast.scope = "FULL_GOAL";
    const unknown = () => ({ range: null, basis: "UNKNOWN", evidence_refs: [], explanation: "Изолированный пример отсутствующего исхода" });
    if (p.goal.metric.family !== "COUNT") {
      p.forecast.inputs = [];p.forecast.duplicate_result_percent = null;p.forecast.result_before_deadline_percent = null;
      p.forecast.metric_inputs = p.directions.map(d => ({ direction_id: d.direction_id, budget_rub: d.budget_rub, value_unit: p.goal.metric.family === "SUM" ? "RUB" : "RESULT", value: unknown(), denominator: p.goal.metric.family === "RATIO" ? unknown() : null, population: "Изолированная когорта", adjustments: "Повторы, срок, возвраты и расходы относятся к определению цели" }));
    }
    await h.submit(proposal);task = await h.service().task("owner", await h.control());
    assert.equal(task.context.generation_context.optimization.goal_metric.outcome_type, outcome);
    if (p.goal.metric.family !== "COUNT") assert.equal(task.context.generation_context.optimization.target_result_cost_rub, null);
    const candidate = portfolio(task);candidate.goal_review.preparation_decision = preparationDecisionFixture(proposal.formation_plan);
    if (p.goal.metric.family !== "COUNT") candidate.goal_review.preparation_decision.remaining_unknowns = ["OUTCOME_VALUE", ...(p.goal.metric.family === "RATIO" ? ["DENOMINATOR"] : [])].map(metric => ({ metric, why_unavailable: "Изолированный пример", resolution: "MEASURED_VALIDATION", decision_impact: "Пересчитать вклад после измерения" }));
    await h.submit(candidate);
    assert.equal((await h.service().projection("owner")).phase, "COMPLETED");
    const saved = h.products.current.campaign_pairs[0].draft.publish_projection.formation;
    assert.equal(saved.plan.goal_preparation.goal.metric.outcome_type, outcome);
    assert.equal(saved.portfolio.goal_review.goal_attainment, "UNASSESSED");
    assert.equal(saved.portfolio.goal_review.outcome_review.success_probability, null);
    assert.equal(h.products.current.authority.spend_micros, 0);
  }
});


test("new keyword contract is frozen, rejects a missing map, and survives source reuse", async () => {
  const h = await harness(); await h.service().start("owner", h.view, "owner-browser-session");
  let task = await h.service().task("owner", await h.control());
  assert.equal(task.source.keyword_preparation_version, "keyword-preparation-v1");
  assert.equal(task.context.keyword_preparation.version, "keyword-preparation-v1");
  await h.service().collect("owner", await h.control());
  const omitted = h.evidenceProposal(); delete omitted.research.keyword_research;
  await assert.rejects(h.submitRaw(omitted), e => e.violations?.some(v => v.code === "FORMATION_SHAPE_INVALID"));
  assert.equal((await h.service().projection("owner")).stage, "EVIDENCE_COLLECTION");
  await h.submitRaw(h.evidenceProposal()); task = await h.service().task("owner", await h.control());
  await h.submitRaw(strategyProposal(task)); task = await h.service().task("owner", await h.control());
  const proposal = portfolio(task); delete proposal.keyword_review;
  await assert.rejects(h.submitRaw(proposal), e => e.violations?.some(v => v.code === "FORMATION_SHAPE_INVALID"));
  assert.equal((await h.service().projection("owner")).stage, "CAMPAIGNS");
});

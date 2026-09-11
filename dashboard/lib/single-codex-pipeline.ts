import { KEYWORD_PREPARATION_VERSION } from "./keyword-preparation.ts";
import { runPipelineExecutionOnce } from "./pipeline-execution-cancellation.ts";
import { assertGoalReady } from "./goal-revision.ts";
import type { CurrentGoalStore } from "./goal-revision-lifecycle.ts";
import { verifyGoalEvidenceScope } from "./goal-evidence-scope.ts";
import { ANALYTICS_EVIDENCE_SCHEMA, verifyAnalyticsEvidenceSnapshot } from "./analytics-evidence.ts";
import { pipelineInputVersions, type PipelineHistoricalView } from "./pipeline-owner-dashboard.ts";
import { resolvePriorStrategyInput, saveVerifiedPipelineProduct, returnPipelineProductsToResearch, type PipelineCurrentProductStore, type PipelineVerifiedProduct } from "./pipeline-current-products.ts";
import { PipelineOrchestrator, type PipelineRunStore, type PipelineVerifiedAttempt } from "./pipeline-orchestrator.ts";
import { preparePipelineStageTask, type PipelineToolInput } from "./pipeline-stage-tools.ts";
import type { ProductionPipelineEvidenceCollector } from "./pipeline-production-executor.ts";
import type { ProductionStrategyArtifact } from "./production-stage-agents.ts";
import type { CampaignPlaybookStrategySnapshot } from "./campaign-playbook-governance.ts";
import { assessPipelineEvidenceReuse, type PipelineEvidenceReusePlan } from "./pipeline-evidence-reuse.ts";
import { CAMPAIGN_FORMATION_METHOD } from "./campaign-formation-method.ts";
import { GOAL_OUTCOME_PREPARATION_VERSION, usesCompleteGoalPreparation } from "./campaign-goal-preparation.ts";
import { CAMPAIGN_OPTIMIZATION_VERSION } from "./campaign-optimization.ts";
import { CAMPAIGN_REFINEMENT_VERSION } from "./campaign-refinement.ts";
import { evaluatePipelineSubmission } from "./pipeline-campaign-refinement.ts";
import type { CodexDispatchRequest, CodexDispatchReceipt } from "./codex-dispatch.ts";
import { validateWordstatQueryResearch } from "./wordstat-query-research.ts";
import { assessGoalPortfolioReadiness, type GoalPortfolioReadiness } from "./goal-portfolio-analysis.ts";
import { hasCompletedLocalPreparation } from "./campaign-preparation-completion.ts";
import type { FormationBundle, FormationPortfolio } from "./campaign-formation-portfolio.ts";
import { buildReadableEvidence, collectReadableEvidenceRefs, type ReadableEvidenceFact } from "./readable-evidence.ts";

export const SINGLE_CODEX_WORKSPACE_SCHEMA = "p0-single-codex-workspace-v1";
const LEASE_MS = 30 * 60 * 1000;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export type SingleCodexWorkspace = {
  rejected_proposal?: { stage: PipelineToolInput["run"]["current_stage"]; source_version: number; candidate: unknown } | null;
  working_campaigns?: { source_version: number; input_digest: string; candidate: FormationPortfolio; readiness: GoalPortfolioReadiness; saved_at: string } | null;
  dispatch?: { status: "PENDING" | "QUEUED" | "FAILED" | "ACKNOWLEDGED"; request_id: string; error: string | null };
  pending_research?: { reason: string; source_stage: "STRATEGY" | "CAMPAIGNS"; source_version: number } | null;
  schema_version: typeof SINGLE_CODEX_WORKSPACE_SCHEMA;
  owner_key: string;
  run_id: string;
  revision: number;
  lease: { session_id: string; expires_at: string } | null;
  phase: "READY" | "COLLECTING" | "COMMITTING" | "COMPLETED";
  input: PipelineToolInput;
  seed_snapshot: Record<string, unknown> | null;
  reuse: PipelineEvidenceReusePlan | null;
  pending: null | { product: PipelineVerifiedProduct; attempt: PipelineVerifiedAttempt | null; summary: string; expected_product_revision: number | null };
  operation_id: string | null;
  last_error: { message: string; violations: unknown[] } | null;
  updated_at: string;
};
export interface SingleCodexWorkspaceStore {
  load(runId: string): Promise<SingleCodexWorkspace | null>;
  compareAndSwap(runId: string, expectedRevision: number | null, workspace: SingleCodexWorkspace): Promise<boolean>;
}
export type SingleCodexProjection = {
  workingCampaigns?: { bundle: FormationBundle; readiness: GoalPortfolioReadiness; savedAt: string; sourceFacts: ReadableEvidenceFact[] };
  dispatch?: SingleCodexWorkspace["dispatch"];
  controllerActive?: boolean;
  testScenario?: boolean;
  method?: string;
  mode: "SINGLE_CODEX";
  runId: string | null;
  revision: number | null;
  phase: SingleCodexWorkspace["phase"] | "NOT_STARTED" | "LEGACY" | "STOPPED";
  sessionId: string | null;
  leaseExpiresAt: string | null;
  hasEvidence: boolean;
  collectionAllowed: boolean;
  stage: PipelineToolInput["run"]["current_stage"] | null;
  lastError: SingleCodexWorkspace["last_error"];
};
export type CodexControl = { sessionId: string; expectedRevision: number };

function sessionId(value: string) {
  if (!/^[a-zA-Z0-9_-]{8,128}$/u.test(value)) throw new Error("Неверный идентификатор сессии Codex.");
  return value;
}
function sourceView(view: PipelineHistoricalView): PipelineHistoricalView {
  // Export only business inputs consumed by deterministic tools, never adapter configuration.
  const fields = ["site_analysis", "business_model", "product_focus", "owner_goal_interview", "strategy", "context_state", "measurement_destination_readiness", "recommendation_set", "current_pipeline_strategy", "current_pipeline_strategy_source", "pipeline_evidence_replay"];
  const scrub = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(scrub);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/(?:token|password|secret|authorization|cookie|api_key|headers)/iu.test(key)).map(([key, child]) => [key, scrub(child)]));
  };
  return { revision: view.revision, state: Object.fromEntries(fields.filter(key => Object.hasOwn(view.state, key)).map(key => [key, scrub(view.state[key])])) };
}

/** One external Codex owns decisions. This service only collects, validates and commits explicit commands. */
export class SingleCodexPipeline {
  private readonly orchestrator: PipelineOrchestrator;
  private readonly now: () => string;
  private readonly dependencies: {
    runs: PipelineRunStore;
    workspaces: SingleCodexWorkspaceStore;
    goals: CurrentGoalStore;
    products: PipelineCurrentProductStore;
    collect: ProductionPipelineEvidenceCollector;
    dispatch?: (request: CodexDispatchRequest) => Promise<CodexDispatchReceipt>;
    playbook: () => Promise<CampaignPlaybookStrategySnapshot>;
    now?: () => string;
    newRunId?: () => string;
  };
  constructor(dependencies: SingleCodexPipeline["dependencies"]) {
    this.dependencies = dependencies;
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.orchestrator = new PipelineOrchestrator({ store: dependencies.runs, now: this.now, newRunId: dependencies.newRunId });
  }
  private lease(session: string) { return { session_id: sessionId(session), expires_at: new Date(Date.parse(this.now()) + LEASE_MS).toISOString() }; }
  private async write(previous: SingleCodexWorkspace | null, next: SingleCodexWorkspace) {
    next.revision = (previous?.revision ?? -1) + 1;
    next.updated_at = this.now();
    if (!await this.dependencies.workspaces.compareAndSwap(next.run_id, previous?.revision ?? null, next)) throw new Error("Рабочее состояние изменилось в другой сессии. Обновите Dashboard.");
    return next;
  }
  private async current(ownerKey: string) {
    const run = await this.orchestrator.current(ownerKey);
    const workspace = run ? await this.dependencies.workspaces.load(run.run_id) : null;
    if (workspace && (workspace.owner_key !== ownerKey || workspace.run_id !== run?.run_id)) throw new Error("Рабочее состояние принадлежит другому запуску.");
    return { run, workspace };
  }
  async projection(ownerKey: string): Promise<SingleCodexProjection> {
    const { run, workspace } = await this.current(ownerKey);
    const working = workspace?.working_campaigns;
    const plan = workspace?.input.strategy?.formation_plan;
    const research = workspace?.input.interpretation?.formation_research;
    return { mode: "SINGLE_CODEX", runId: run?.run_id ?? null, revision: workspace?.revision ?? null,
      ...(working && plan && research && working.source_version === run?.version ? { workingCampaigns: { readiness: working.readiness, savedAt: working.saved_at,
        sourceFacts: buildReadableEvidence(workspace!.input.snapshot, {
          references: collectReadableEvidenceRefs([research, plan, working.candidate]),
          strategy: workspace!.input.strategy?.strategy,
          catalog: workspace!.input.strategy?.inputs.analytics_evidence_snapshot.content.grounding_catalog,
        }),
        bundle: { method: CAMPAIGN_FORMATION_METHOD, plan, research, portfolio: working.candidate, campaign_id: working.candidate.campaigns[0]?.id ?? "" } } } : {}),
      dispatch: workspace?.dispatch, controllerActive: Boolean(workspace?.lease && Date.parse(workspace.lease.expires_at) > Date.parse(this.now())),
      testScenario: workspace?.input.test_data_allowed === true, method: workspace?.input.formation_method,
      phase: !run ? "NOT_STARTED" : run.status === "STOPPED" || run.status === "FAILED" ? "STOPPED" : !workspace ? "LEGACY" : workspace.phase,
      sessionId: workspace?.lease?.session_id ?? null, leaseExpiresAt: workspace?.lease?.expires_at ?? null,
      hasEvidence: Boolean(workspace?.input.snapshot), collectionAllowed: Boolean(workspace && !workspace.reuse && workspace.phase === "READY" && run?.status === "ACTIVE" && run.current_stage === "EVIDENCE_COLLECTION"), stage: run?.current_stage ?? null, lastError: workspace?.last_error ?? null };
  }
  private async controlled(ownerKey: string, control: CodexControl, allowCommit = false) {
    const { run, workspace } = await this.current(ownerKey);
    if (!run || !workspace || (run.status !== "ACTIVE" && !(allowCommit && run.status === "COMPLETED" && workspace.phase === "COMMITTING"))) throw new Error("Нет активного запуска под управлением Codex.");
    if (workspace.revision !== control.expectedRevision) throw new Error("Версия рабочего состояния изменилась. Обновите Dashboard.");
    if (workspace.lease?.session_id !== sessionId(control.sessionId) || Date.parse(workspace.lease.expires_at) <= Date.parse(this.now())) throw new Error("Сначала возьмите управление запуском в этой сессии.");
    if (workspace.phase !== "COMMITTING" && (workspace.input.run.version !== run.version || workspace.input.run.current_stage !== run.current_stage)) throw new Error("Этап изменился. Рабочее состояние требует восстановления.");
    return workspace;
  }
  async claim(ownerKey: string, control: CodexControl) {
    const { run, workspace } = await this.current(ownerKey);
    if (!run || !workspace || (run.status !== "ACTIVE" && !(run.status === "COMPLETED" && workspace.phase === "COMMITTING"))) throw new Error("Сначала начните новый запуск Codex.");
    if (workspace.revision !== control.expectedRevision) throw new Error("Рабочее состояние изменилось.");
    if (workspace.lease && workspace.lease.session_id !== sessionId(control.sessionId) && Date.parse(workspace.lease.expires_at) > Date.parse(this.now())) throw new Error("Запуск уже находится под управлением другой сессии Codex.");
    if (workspace.phase === "COLLECTING" && Date.parse(workspace.lease?.expires_at ?? "") > Date.parse(this.now())) throw new Error("Сбор ещё выполняется; дождитесь результата или остановите запуск.");
    const next = structuredClone(workspace);
    next.lease = this.lease(control.sessionId);
    if (next.dispatch) next.dispatch = { ...next.dispatch, status: "ACKNOWLEDGED", error: null };
    // Expired collection has no accepted result; invalidate its operation token before retry.
    if (next.phase === "COLLECTING" && Date.parse(workspace.lease?.expires_at ?? "") <= Date.parse(this.now())) {
      next.phase = "READY"; next.operation_id = null;
    }
    await this.write(workspace, next);
  }
  async release(ownerKey: string, control: CodexControl) {
    const workspace = await this.controlled(ownerKey, control, true);
    if (workspace.phase === "COLLECTING") throw new Error("Дождитесь завершения сбора или остановите запуск.");
    await this.write(workspace, { ...structuredClone(workspace), lease: null });
  }
  async requestDispatch(ownerKey: string, expectedRunId: string, expectedRevision: number) {
    const { run, workspace } = await this.current(ownerKey);
    if (!run || !workspace || run.status !== "ACTIVE" || run.run_id !== expectedRunId || workspace.revision !== expectedRevision) throw new Error("Запуск изменился. Обновите Dashboard.");
    if (workspace.phase !== "READY") throw new Error("Текущая операция ещё выполняется.");
    if (workspace.dispatch?.status === "QUEUED" || (workspace.lease && Date.parse(workspace.lease.expires_at) > Date.parse(this.now()))) return;
    const request = { run_id: run.run_id, request_id: `${run.run_id}:start` };
    await this.write(workspace, { ...structuredClone(workspace), dispatch: { status: "PENDING", request_id: request.request_id, error: null } });
    let error: string | null = null;
    try {
      if (!this.dependencies.dispatch) throw new Error("Передача агенту не настроена.");
      const receipt = await this.dependencies.dispatch(request);
      if (receipt.status !== "QUEUED" || receipt.request_id !== request.request_id) throw new Error("Агент не подтвердил получение запуска.");
    } catch (cause) { error = cause instanceof Error ? cause.message : "Не удалось передать запуск агенту."; }
    const latest = await this.current(ownerKey);
    // Claim/Stop may race acknowledgement. Preserve that newer state.
    if (latest.run?.run_id === run.run_id && latest.run.status === "ACTIVE" && latest.workspace?.dispatch?.status === "PENDING") {
      await this.write(latest.workspace, { ...structuredClone(latest.workspace), dispatch: { status: error ? "FAILED" : "QUEUED", request_id: request.request_id, error } });
    }
  }
  async start(ownerKey: string, view: PipelineHistoricalView, session: string, reuse?: PipelineEvidenceReusePlan, testDataAllowed = false) {
    sessionId(session);
    const [goal, previous, playbook] = await Promise.all([this.dependencies.goals.loadCurrent(ownerKey), this.dependencies.products.loadCurrent(ownerKey), this.dependencies.playbook()]);
    assertGoalReady(goal?.revision, true);
    if (!goal) throw new Error("Сначала сохраните цель.");
    const frozen = structuredClone(view);
    const prior = await resolvePriorStrategyInput(previous);
    frozen.state.current_pipeline_strategy = prior?.artifact ?? null;
    frozen.state.current_pipeline_strategy_source = prior ? { schema_version: "p0-current-strategy-input-source-v1", run_id: prior.source_run_id, state_revision: prior.source_state_revision, strategy_digest: prior.reference.digest } : null;
    const versions = await pipelineInputVersions(frozen);
    versions.goal_revision = { schema_version: goal.revision.schema_version, revision_id: goal.revision.goal_revision_id, digest: goal.revision.digest };
    if (reuse) {
      const checked = await assessPipelineEvidenceReuse({ currentOwnerKey: ownerKey, evidence: reuse.evidence, sourceRun: reuse.source_run,
        sourceAudit: await this.orchestrator.audit(reuse.evidence.source_run_id), currentGoal: goal.revision, currentVersions: versions,
        currentState: frozen.state, stateRevision: previous?.state_revision ?? -1, evaluatedAt: this.now() });
      if (!checked.plan || checked.plan.reuse_token !== reuse.reuse_token) throw new Error("Сведения или область повторного использования изменились.");
      versions.analytics_evidence_snapshot = structuredClone(reuse.evidence.evidence_reference);
      frozen.state.pipeline_evidence_replay = structuredClone(reuse.assessment);
    }
    const run = await this.orchestrator.start(ownerKey, versions);
    const input: PipelineToolInput = { formation_method: CAMPAIGN_FORMATION_METHOD, keyword_preparation_version: KEYWORD_PREPARATION_VERSION, goal_preparation_version: GOAL_OUTCOME_PREPARATION_VERSION, campaign_optimization_version: CAMPAIGN_OPTIMIZATION_VERSION, campaign_refinement_version: CAMPAIGN_REFINEMENT_VERSION, test_data_allowed: testDataAllowed, run, view: sourceView(frozen), snapshot: reuse ? structuredClone(reuse.evidence.snapshot) : null,
      interpretation: null, strategy: null, playbook, preparedAt: this.now() };
    let workspace: SingleCodexWorkspace;
    try {
      workspace = await this.write(null, { schema_version: SINGLE_CODEX_WORKSPACE_SCHEMA, owner_key: ownerKey, run_id: run.run_id,
      revision: 0, lease: null, phase: "COMMITTING", input, seed_snapshot: previous?.analytics_evidence_snapshot ?? null, reuse: reuse ?? null,
      pending: { product: { stage: "CAMPAIGN_GOAL", value: goal.revision }, attempt: null, summary: "Цель принята. Codex управляет дальнейшей подготовкой.", expected_product_revision: previous?.state_revision ?? null },
      operation_id: null, last_error: null, updated_at: this.now() });
    } catch (error) {
      // No recoverable workspace exists yet. Do not leave an orphan active run.
      await this.orchestrator.stop({ run_id: run.run_id, expected_version: run.version, reason_code: "CODEX_WORKSPACE_SETUP_FAILED", reason: "Рабочее состояние не создано. Повторите запуск." });
      throw error;
    }
    await this.finishCommit(workspace);
    if (this.dependencies.dispatch) {
      const current = await this.projection(ownerKey);
      await this.requestDispatch(ownerKey, run.run_id, current.revision!);
    }
  }
  async task(ownerKey: string, control: CodexControl) {
    const workspace = await this.controlled(ownerKey, control);
    if (workspace.phase !== "READY") throw new Error("Сначала завершите текущую операцию.");
    const rejected = workspace.rejected_proposal;
    const repair = workspace.last_error && rejected?.stage === workspace.input.run.current_stage && rejected.source_version === workspace.input.run.version
      ? { rejected_candidate: rejected.candidate, ...workspace.last_error } : undefined;
    return preparePipelineStageTask({ ...workspace.input, ...(workspace.working_campaigns ? { saved_campaign_candidate: workspace.working_campaigns } : {}), ...(repair ? { repair_context: repair } : {}) });
  }
  async collect(ownerKey: string, control: CodexControl, wordstatResearch?: unknown) {
    const workspace = await this.controlled(ownerKey, control);
    if (workspace.phase !== "READY" || workspace.input.run.current_stage !== "EVIDENCE_COLLECTION") throw new Error("Сбор доступен на этапе сведений.");
    if (workspace.reuse) throw new Error("Этот запуск использует датированный срез. Для свежих источников начните новый сбор.");
    const goal = workspace.input.run.goal_formation;
    if (goal.status !== "VERIFIED") throw new Error("Цель не проверена.");
    const explicitResearch = wordstatResearch === undefined ? undefined : validateWordstatQueryResearch(wordstatResearch, goal.revision.customer_geography ?? "");
    if (explicitResearch && !workspace.input.snapshot) throw new Error("Сначала загрузите срез источников для дополнительного исследования.");
    const operation = crypto.randomUUID();
    const collecting = await this.write(workspace, { ...structuredClone(workspace), phase: "COLLECTING", operation_id: operation, last_error: null, lease: this.lease(control.sessionId) });
    try {
      const snapshot = await runPipelineExecutionOnce({ ownerKey, runId: workspace.run_id,
        checkCancelled: async () => {
          const latest = await this.orchestrator.current(ownerKey);
          const currentWorkspace = await this.dependencies.workspaces.load(workspace.run_id);
          return latest?.run_id !== workspace.run_id || latest.status !== "ACTIVE" || currentWorkspace?.operation_id !== operation;
        },
        work: signal => this.dependencies.collect({ ownerKey, view: workspace.input.view, signal,
        goal: { schema_version: goal.revision.schema_version, revision_id: goal.revision.goal_revision_id, digest: goal.revision.digest }, goalRevision: goal.revision,
        seed: workspace.input.run.input_versions.analytics_evidence_snapshot, seedSnapshot: explicitResearch ? workspace.input.snapshot : workspace.seed_snapshot,
        ...(explicitResearch ? { wordstatResearch: explicitResearch } : {}) }),
      });
      await this.acceptSnapshot(collecting, snapshot);
    } catch (error) {
      const current = await this.dependencies.workspaces.load(workspace.run_id);
      if (current?.revision === collecting.revision && current.operation_id === operation) await this.write(current, {
        ...structuredClone(current), phase: "READY", operation_id: null, last_error: this.error(error),
      });
      throw error;
    }
  }
  private error(error: unknown) { return { message: error instanceof Error ? error.message : String(error), violations: Array.isArray(record(error).violations) ? record(error).violations as unknown[] : [] }; }
  private async acceptSnapshot(workspace: SingleCodexWorkspace, snapshot: Record<string, unknown>) {
    if (snapshot?.schema_version !== ANALYTICS_EVIDENCE_SCHEMA || !snapshot.goal_context || !await verifyAnalyticsEvidenceSnapshot(snapshot)) throw new Error("Срез источников не прошёл проверку целостности.");
    const goal = workspace.input.run.goal_formation;
    if (goal.status !== "VERIFIED") throw new Error("Цель не проверена.");
    if (snapshot.goal_context) await verifyGoalEvidenceScope({ goal: { schema_version: goal.revision.schema_version, revision_id: goal.revision.goal_revision_id, digest: goal.revision.digest }, goalRevision: snapshot.goal_context as never });
    const { run, workspace: current } = await this.current(workspace.owner_key);
    if (!run || run.status !== "ACTIVE" || run.version !== workspace.input.run.version || current?.revision !== workspace.revision) throw new Error("Запуск остановлен или изменился; поздний результат сбора не принят.");
    await this.write(current, { ...structuredClone(current), phase: "READY", operation_id: null, last_error: null, rejected_proposal: null,
      input: { ...current.input, snapshot: structuredClone(snapshot), interpretation: null, preparedAt: this.now() } });
  }
  async importSnapshot(ownerKey: string, control: CodexControl, digest: string, snapshot: Record<string, unknown>) {
    const workspace = await this.controlled(ownerKey, control);
    const task = await this.task(ownerKey, control);
    if (task.stage !== "EVIDENCE_COLLECTION" || task.input_digest !== digest || workspace.reuse) throw new Error("Срез не соответствует текущей задаче сбора.");
    await this.acceptSnapshot(workspace, snapshot);
  }
  async submit(ownerKey: string, control: CodexControl, envelope: Record<string, unknown>) {
    const workspace = await this.controlled(ownerKey, control);
    const task = await this.task(ownerKey, control);
    if (envelope?.schema_version !== "p0-single-codex-result-v1" || envelope.run_id !== task.run_id || envelope.input_digest !== task.input_digest) throw new Error("Результат относится к другой версии входных данных.");
    let submission: Awaited<ReturnType<typeof evaluatePipelineSubmission>>;
    try { submission = await evaluatePipelineSubmission(task, envelope.result); }
    catch (error) {
      await this.write(workspace, { ...structuredClone(workspace), last_error: this.error(error), lease: this.lease(control.sessionId),
        rejected_proposal: { stage: task.stage, source_version: task.run_version, candidate: structuredClone(envelope.result) } });
      throw error;
    }
    const latestRun = await this.orchestrator.current(ownerKey);
    if (latestRun?.run_id !== workspace.run_id || latestRun.status !== "ACTIVE" || latestRun.version !== workspace.input.run.version) throw new Error("Запуск остановлен или изменился; поздний результат не принят.");
    if (submission.kind === "PROGRESS") {
      await this.write(workspace, { ...structuredClone(workspace), last_error: null, rejected_proposal: null, lease: this.lease(control.sessionId),
        input: { ...workspace.input, campaign_refinement: submission.refinement } });
      return;
    }
    const result = submission.compiled;
    const products = await this.dependencies.products.loadCurrent(ownerKey);
    if (products?.run_id !== workspace.run_id || products.run_version !== workspace.input.run.version) throw new Error("Текущие результаты изменились вне этого этапа.");
    if (task.stage === "CAMPAIGNS" && usesCompleteGoalPreparation(workspace.input.goal_preparation_version)) {
      const candidate = submission.portfolio ?? envelope.result as FormationPortfolio;
      const readiness = assessGoalPortfolioReadiness(workspace.input.strategy!.formation_plan!.goal_preparation!, candidate.goal_review, workspace.input.test_data_allowed === true);
      // A cold start can finish local preparation with an explicit bounded validation plan.
      // Known goal shortfalls and unfinished work still require repair; completion never certifies actual results.
      const coldStartPrepared = readiness.status === "NEEDS_EVIDENCE" && hasCompletedLocalPreparation(workspace.input.strategy!.formation_plan!, candidate.goal_review);
      if (readiness.status !== "SUPPORTED_PLAN" && readiness.status !== "TEST_ONLY" && !coldStartPrepared) {
        const refinement = workspace.input.campaign_refinement;
        await this.write(workspace, { ...structuredClone(workspace), last_error: null, rejected_proposal: null, lease: this.lease(control.sessionId),
          input: { ...workspace.input, ...(refinement && candidate.refinement_review ? { campaign_refinement: { ...refinement, phase: "REVISION" as const, revision_request: null, previous_reviews: [...refinement.previous_reviews, candidate.refinement_review.final_review] } } : {}) },
          working_campaigns: { source_version: workspace.input.run.version, input_digest: task.input_digest, candidate: structuredClone(candidate), readiness, saved_at: this.now() } });
        return;
      }
    }
    if (result.product.stage === "EVIDENCE_COLLECTION" && workspace.reuse) result.product.reusedEvidence = workspace.reuse.evidence;
    const next = await this.write(workspace, { ...structuredClone(workspace), phase: "COMMITTING", last_error: null, lease: this.lease(control.sessionId),
      pending: { ...result, expected_product_revision: products?.state_revision ?? null } });
    await this.finishCommit(next);
  }
  async resume(ownerKey: string, control: CodexControl) {
    const workspace = await this.controlled(ownerKey, control, true);
    if (workspace.phase !== "COMMITTING") throw new Error("Нет незавершённого сохранения.");
    await this.finishCommit(workspace);
  }
  async requestResearch(ownerKey: string, control: CodexControl, reason: string) {
    const workspace = await this.controlled(ownerKey, control);
    const stage = workspace.input.run.current_stage;
    if (workspace.phase !== "READY" || !["STRATEGY", "CAMPAIGNS"].includes(stage)) throw new Error("Дополнительное исследование запрашивается из стратегии или кампаний.");
    if (typeof reason !== "string" || reason.trim().length < 10 || reason.length > 2000) throw new Error("Укажите, каких сведений не хватает и на какое решение они влияют.");
    const next = await this.write(workspace, { ...structuredClone(workspace), phase: "COMMITTING", pending: null,
      pending_research: { reason: reason.trim(), source_stage: stage as "STRATEGY" | "CAMPAIGNS", source_version: workspace.input.run.version }, lease: this.lease(control.sessionId), last_error: null });
    await this.finishCommit(next);
  }
  private async finishResearchReturn(workspace: SingleCodexWorkspace) {
    const request = workspace.pending_research!;
    let run = await this.orchestrator.current(workspace.owner_key);
    if (!run || run.run_id !== workspace.run_id || run.status !== "ACTIVE") throw new Error("Запуск изменён до возврата к исследованию.");
    if (run.version === request.source_version && run.current_stage === request.source_stage) {
      const versions = run.input_versions;
      run = await this.orchestrator.returnTo({ run_id: run.run_id, expected_version: run.version, source_stage: request.source_stage, cause: "EVIDENCE_REQUEST", reason: request.reason,
        attempt: { actor: { actor_id: "codex", actor_type: "AGENT", role: "SINGLE_CODEX" },
          inputs: [versions.goal_revision!, ...(versions.analytics_evidence_snapshot ? [versions.analytics_evidence_snapshot] : [])],
          evidence: versions.analytics_evidence_snapshot ? [versions.analytics_evidence_snapshot] : [], output: null,
          checks: [{ check_id: "MATERIAL_RESEARCH_GAP", status: "FAILED", policy: versions.pipeline_policy }],
          schemas: [versions.pipeline_policy], policies: [versions.pipeline_policy], campaign_playbook: versions.campaign_playbook } });
    } else if (run.version !== request.source_version + 1 || run.current_stage !== "EVIDENCE_COLLECTION" || run.last_transition.kind !== "RETURN") throw new Error("Возврат относится к другой версии запуска.");
    await returnPipelineProductsToResearch(this.dependencies.products, run);
    const next = structuredClone(workspace);
    next.phase = "READY"; next.pending_research = null; next.reuse = null; next.seed_snapshot = next.input.snapshot;
    next.rejected_proposal = null; next.last_error = null;
    next.input = { ...next.input, run, interpretation: null, strategy: null, research_request: request.reason, preparedAt: this.now() };
    if (next.input.campaign_refinement) {
      next.input.previous_campaign_draft = next.input.campaign_refinement.draft;
      next.input.refinement_research_requests = next.input.campaign_refinement.revision_request?.issues.filter(issue => issue.research_required) ?? [];
    }
    delete next.input.campaign_refinement;
    delete next.input.view.state.pipeline_evidence_replay;
    await this.write(workspace, next);
  }
  private async finishCommit(workspace: SingleCodexWorkspace) {
    if (workspace.pending_research) return this.finishResearchReturn(workspace);
    const pending = workspace.pending;
    if (!pending) throw new Error("Отсутствует результат для сохранения.");
    const before = workspace.input.run;
    let run = await this.orchestrator.current(workspace.owner_key);
    if (!run || run.run_id !== workspace.run_id || ["STOPPED", "FAILED"].includes(run.status)) throw new Error("Запуск остановлен; результат не принят.");
    if (run.version === before.version) {
      if (pending.product.stage === "CAMPAIGN_GOAL") run = await this.orchestrator.acceptGoalRevision({ run_id: run.run_id, expected_version: run.version, revision: pending.product.value });
      else {
        if (!pending.attempt) throw new Error("Отсутствует подтверждение проверки этапа.");
        run = await this.orchestrator.advance({ run_id: run.run_id, expected_version: run.version, source_stage: pending.product.stage,
          reason_code: "SINGLE_CODEX_STAGE_VERIFIED", reason: pending.summary.slice(0, 1000), attempt: pending.attempt });
      }
    } else {
      const audit = await this.orchestrator.audit(run.run_id);
      const last = audit.at(-1);
      const expectedDigest = pending.product.stage === "CAMPAIGN_GOAL" ? pending.product.value.digest : pending.attempt?.output.digest;
      if (run.version !== before.version + 1 || last?.output.reference?.digest !== expectedDigest || last?.stage !== pending.product.stage) throw new Error("Сохранение расходится с журналом этапа.");
    }
    let current = await this.dependencies.products.loadCurrent(workspace.owner_key);
    const alreadySaved = current?.run_id === run.run_id && current.run_version === run.version && current.current_stage === pending.product.stage;
    if (!alreadySaved) {
      if ((current?.state_revision ?? null) !== pending.expected_product_revision) throw new Error("Результаты изменились во время сохранения. Восстановление требует проверки версий.");
      const expected = current;
      current = await saveVerifiedPipelineProduct({ run, product: pending.product, recordedAt: run.updated_at,
        store: { loadCurrent: async () => expected, compareAndSwap: (...args) => this.dependencies.products.compareAndSwap(...args) } });
    }
    if (!current) throw new Error("Результат этапа не сохранён.");
    const next = structuredClone(workspace);
    next.input.run = run;
    next.input.snapshot = current.analytics_evidence_snapshot ?? next.input.snapshot;
    next.input.interpretation = current.evidence_interpretation ?? null;
    next.input.strategy = current.campaign_strategy as ProductionStrategyArtifact | null;
    next.input.preparedAt = this.now();
    delete next.input.campaign_refinement;
    if (pending.product.stage === "CAMPAIGNS") { delete next.input.previous_campaign_draft; delete next.input.refinement_research_requests; }
    next.pending = null; next.working_campaigns = null; next.phase = run.status === "COMPLETED" ? "COMPLETED" : "READY";
    next.operation_id = null; next.last_error = null; next.rejected_proposal = null;
    if (next.phase === "COMPLETED") next.lease = null;
    await this.write(workspace, next);
  }
}

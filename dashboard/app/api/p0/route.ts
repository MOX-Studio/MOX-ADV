import { SingleCodexPipeline } from "../../../lib/single-codex-pipeline";
import { D1SingleCodexWorkspaceStore } from "../../../lib/single-codex-pipeline-d1-store";
import { env } from "cloudflare:workers";
import {
  operatorDiagnostics as productionOperatorDiagnostics,
  productionCampaignPlaybookGovernance,
  productionPipelineEvidenceCollector,
  recoverOwnerState as productionRecoverOwnerState,
  userKey,
} from "../../../lib/p0";
import {
  assertCurrentPipelineAction,
  projectCurrentPipelineContract,
} from "../../../lib/pipeline-current-contract";
import { D1PipelineRunStore } from "../../../lib/pipeline-orchestrator-d1-store";
import { D1CurrentGoalStore } from "../../../lib/goal-revision-d1-store";
import { D1PipelineCurrentProductStore } from "../../../lib/pipeline-current-products-d1-store";
import { ensureWordstatServiceReady } from "../../../lib/wordstat-service-readiness";
import { dispatchToCodex } from "../../../lib/codex-dispatch";
import type { CampaignPairEditRequest } from "../../../lib/campaign-pair-edit";
import {
  OwnerPipelineController,
  type OwnerPipelineProjection,
  type PipelineHistoricalView,
} from "../../../lib/pipeline-owner-dashboard";

function failure(error?: unknown) {
  return {
    message: error instanceof Error
      ? error.message
      : "Действие не выполнено. Обновите страницу и повторите текущее бизнес-решение.",
  };
}

function invalidLocalState(error: unknown) {
  return error && typeof error === "object" && "code" in error
    && ["P0_MIGRATION_LINEAGE_INVALID", "P0_STATE_INVALID"].includes(String(error.code));
}

function recoveryRequired() {
  return {
    message: "Сохранённая локальная подготовка несовместима с текущей версией. Внешние рекламные системы не затронуты.",
    recovery: {
      action: "RESET_INVALID_LOCAL_P0_STATE",
      label: "Начать безопасную подготовку заново",
      description: "Старая локальная версия останется в истории. Директ, Метрика, публикация, показы и расходы не изменятся.",
    },
  };
}

function pipelineController() {
  return new OwnerPipelineController(new D1PipelineRunStore(env.DB), {
    goalStore: new D1CurrentGoalStore(env.DB),
    productStore: new D1PipelineCurrentProductStore(env.DB),
  });
}

function singleCodexController() {
  return new SingleCodexPipeline({
    runs: new D1PipelineRunStore(env.DB), workspaces: new D1SingleCodexWorkspaceStore(env.DB),
    goals: new D1CurrentGoalStore(env.DB), products: new D1PipelineCurrentProductStore(env.DB),
    dispatch: input => dispatchToCodex(env as unknown as Record<string, string | undefined>, input),
    collect: async input => {
      await ensureWordstatServiceReady(env as unknown as Record<string, string | undefined>);
      return productionPipelineEvidenceCollector(input);
    },
    playbook: () => productionCampaignPlaybookGovernance().strategySnapshot(),
  });
}

async function historicalView(key: string) {
  return productionOperatorDiagnostics(key) as Promise<PipelineHistoricalView>;
}

async function canonicalOwnerResult(
  key: string,
  controller: OwnerPipelineController,
  pipeline?: OwnerPipelineProjection,
) {
  const [current, historical, playbookGovernance, singleCodex] = await Promise.all([
    pipeline ? Promise.resolve(pipeline) : controller.current(key),
    historicalView(key).catch(() => null),
    productionCampaignPlaybookGovernance().projection(),
    singleCodexController().projection(key),
  ]);
  const evidenceReuse = historical ? await controller.evidenceReuse(key, historical) : undefined;
  return projectCurrentPipelineContract({ ...current, singleCodex, ...(evidenceReuse ? { evidenceReuse } : {}) }, {
    historicalState: historical?.state,
    playbookGovernance,
  });
}

export async function GET(request: Request) {
  try {
    const key = userKey(request);
    return Response.json(await canonicalOwnerResult(key, pipelineController()));
  } catch (error) {
    return invalidLocalState(error)
      ? Response.json(recoveryRequired(), { status: 409 })
      : Response.json(failure(error), { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const key = userKey(request);
    const controller = pipelineController();
    if (payload.recovery_action !== undefined) {
      if (payload.recovery_action !== "RESET_INVALID_LOCAL_P0_STATE"
        || payload.confirmation !== "RESET_INVALID_LOCAL_P0_STATE") {
        throw new Error("Local recovery requires exact confirmation.");
      }
      const current = await controller.current(key);
      if (current.active) throw new Error("Local preparation cannot be reset during an active pipeline run.");
      await productionRecoverOwnerState(key, payload.confirmation);
      return Response.json(await canonicalOwnerResult(key, controller), { status: 201 });
    }
    if (payload.pipeline_action === undefined) {
      throw new Error("Legacy handles are disabled; use one typed current Pipeline action.");
    }
    const pipelineAction = assertCurrentPipelineAction(payload);
    const codex = singleCodexController();
    const control = { sessionId: String(payload.session_id ?? ""), expectedRevision: Number(payload.workspace_revision) };
    if (pipelineAction === "GET_STAGE_TASK") return Response.json({ task: await codex.task(key, control) });
    if (pipelineAction === "DISPATCH_CODEX") {
      await codex.requestDispatch(key, String(payload.run_id ?? ""), control.expectedRevision);
      return Response.json(await canonicalOwnerResult(key, controller), { status: 201 });
    }
    if (["CLAIM_CONTROL", "RELEASE_CONTROL", "COLLECT_EVIDENCE", "IMPORT_EVIDENCE", "REQUEST_RESEARCH", "SUBMIT_STAGE_RESULT", "RESUME_COMMIT"].includes(pipelineAction)) {
      if (pipelineAction === "CLAIM_CONTROL") await codex.claim(key, control);
      else if (pipelineAction === "RELEASE_CONTROL") await codex.release(key, control);
      else if (pipelineAction === "COLLECT_EVIDENCE") await codex.collect(key, control, payload.wordstat_research);
      else if (pipelineAction === "IMPORT_EVIDENCE") await codex.importSnapshot(key, control, String(payload.input_digest ?? ""), payload.snapshot as Record<string, unknown>);
      else if (pipelineAction === "REQUEST_RESEARCH") await codex.requestResearch(key, control, String(payload.reason ?? ""));
      else if (pipelineAction === "SUBMIT_STAGE_RESULT") await codex.submit(key, control, payload.result as Record<string, unknown>);
      else await codex.resume(key, control);
      return Response.json(await canonicalOwnerResult(key, controller), { status: 201 });
    }
    if (pipelineAction === "EXPLAIN") {
      return Response.json(await controller.explain(key, {
        question: payload.question,
        pairKey: payload.pair_key,
      }));
    }
    if (pipelineAction === "STOP") {
      const current = await controller.current(key);
      if (!current.active || !current.runId || current.version === null) {
        throw new Error("Активный запуск для остановки не найден.");
      }
      const pipeline = await controller.stop(key, {
        runId: current.runId,
        expectedVersion: current.version,
      });
      return Response.json(await canonicalOwnerResult(key, controller, pipeline), { status: 201 });
    }
    if (pipelineAction === "START" || pipelineAction === "REFRESH_EVIDENCE") {
      await codex.start(key, await historicalView(key), control.sessionId, undefined, payload.test_scenario === true);
      return Response.json(await canonicalOwnerResult(key, controller), { status: 201 });
    }
    if (pipelineAction === "REGENERATE_FROM_EVIDENCE") {
      const historical = await historicalView(key);
      const reuse = await controller.prepareEvidenceReuse(key, await controller.frozenInputVersions(key, historical));
      if (!reuse.plan || !reuse.availability.available || reuse.plan.reuse_token !== payload.reuse_token
        || reuse.plan.expected_state_revision !== Number(payload.expected_state_revision)) throw new Error("Проверенные сведения или область повторного использования изменились.");
      await codex.start(key, historical, control.sessionId, reuse.plan, payload.test_scenario === true);
      return Response.json(await canonicalOwnerResult(key, controller), { status: 201 });
    }
    if (pipelineAction === "CORRECT_GOAL") {
      if (Object.hasOwn(payload, "max_result_cost_rub") || !Object.hasOwn(payload, "total_budget_rub")) throw new Error("Укажите общий бюджет цели. Максимальная цена результата больше не является полем первого этапа.");
      if ((payload.metric !== undefined && payload.target_count !== undefined) || (payload.metric === undefined && payload.target_value !== undefined)) throw new Error("Укажите один показатель с соответствующим ему типом измерения.");
      const pipeline = await controller.correctGoal(key, {
        desiredOutcome: payload.desired_outcome,
        qualifiedAction: payload.qualified_action,
        targetCount: payload.target_count,
        targetValue: payload.target_value,
        metric: payload.metric,
        comparison: payload.comparison,
        deadline: payload.deadline,
        totalBudgetRub: payload.total_budget_rub,
        customerGeography: payload.customer_geography,
        countingPolicy: payload.counting_policy,
      });
      return Response.json(await canonicalOwnerResult(key, controller, pipeline), { status: 201 });
    }
    if (pipelineAction === "EDIT_CAMPAIGN_PAIR") {
      const edited = await controller.editCampaignPair(key, {
        expectedStateRevision: Number(payload.expected_state_revision),
        edit: payload.edit as CampaignPairEditRequest,
      });
      return Response.json({
        ...await canonicalOwnerResult(key, controller, edited.pipeline),
        actionResult: edited.result,
      }, { status: 201 });
    }
    if (pipelineAction === "PLAYBOOK_STEWARD_DECISION") {
      const result = await productionCampaignPlaybookGovernance().stewardDecision({
        action: String(payload.action ?? "") as "ACTIVATE_RELEASE" | "STOP_PLAYBOOK_USE",
        reason: String(payload.reason ?? ""),
        expected_release_digest: String(payload.expected_release_digest ?? ""),
        expected_policy_digest: String(payload.expected_policy_digest ?? ""),
        expected_delegation_digest: String(payload.expected_delegation_digest ?? ""),
        expected_latest_decision_digest: String(payload.expected_latest_decision_digest ?? ""),
      });
      return Response.json({
        ...await canonicalOwnerResult(key, controller),
        actionResult: result.decision,
      }, { status: 201 });
    }
    const pipeline = await controller.stop(key, {
      runId: String(payload.run_id ?? ""),
      expectedVersion: Number(payload.expected_version),
    });
    return Response.json(await canonicalOwnerResult(key, controller, pipeline), { status: 201 });
  } catch (error) {
    return Response.json(failure(error), { status: 409 });
  }
}

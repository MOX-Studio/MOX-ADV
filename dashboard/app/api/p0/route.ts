import { env, waitUntil } from "cloudflare:workers";
import {
  operatorDiagnostics as productionOperatorDiagnostics,
  productionCampaignPlaybookGovernance,
  productionPipelineEvidenceCollector,
  productionPipelineStageAgents,
  productionPublicCompetitorRefresh,
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
import type { CampaignStrategyCorrectionChanges } from "../../../lib/campaign-strategy-correction";
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
    stageAgents: productionPipelineStageAgents(),
    evidenceCollector: productionPipelineEvidenceCollector,
    productStore: new D1PipelineCurrentProductStore(env.DB),
    competitorCollector: productionPublicCompetitorRefresh,
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
  const [current, historical, playbookGovernance] = await Promise.all([
    pipeline ? Promise.resolve(pipeline) : controller.current(key),
    historicalView(key).catch(() => null),
    productionCampaignPlaybookGovernance().projection(),
  ]);
  return projectCurrentPipelineContract(current, {
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
      const current = await controller.current(key);
      if (current.active) throw new Error("У владельца уже есть активный запуск.");
      const historical = await historicalView(key);
      const pipeline = await controller.start(key, historical);
      if (!pipeline.runId) throw new Error("Новый запуск не получил точный run_id.");
      waitUntil(controller.execute(key, pipeline.runId, historical).catch(() => undefined));
      return Response.json(await canonicalOwnerResult(key, controller, pipeline), { status: 201 });
    }
    if (pipelineAction === "CORRECT_GOAL") {
      const pipeline = await controller.correctGoal(key, {
        desiredOutcome: String(payload.desired_outcome ?? ""),
        qualifiedAction: String(payload.qualified_action ?? ""),
        targetCount: Number(payload.target_count),
        deadline: String(payload.deadline ?? ""),
        maxResultCostRub: Number(payload.max_result_cost_rub),
      });
      return Response.json(await canonicalOwnerResult(key, controller, pipeline), { status: 201 });
    }
    if (pipelineAction === "REFRESH_COMPETITOR_ANALYSIS") {
      const pipeline = await controller.refreshCompetitors(key, {
        expectedStateRevision: Number(payload.expected_state_revision),
      });
      return Response.json(await canonicalOwnerResult(key, controller, pipeline), { status: 201 });
    }
    if (pipelineAction === "CORRECT_STRATEGY") {
      const corrected = await controller.correctStrategy(key, {
        expectedStateRevision: Number(payload.expected_state_revision),
        expectedStrategyRevisionId: String(payload.expected_strategy_revision_id ?? ""),
        changes: payload.changes as CampaignStrategyCorrectionChanges,
      });
      return Response.json({
        ...await canonicalOwnerResult(key, controller, corrected.pipeline),
        actionResult: corrected.result,
      }, { status: 201 });
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
    if (pipelineAction === "PROPOSE_PLAYBOOK_CANDIDATE") {
      const outcomes = Array.isArray(payload.outcomes) ? payload.outcomes : [];
      const candidate = await productionCampaignPlaybookGovernance().proposeMethodologyCandidate(outcomes as never);
      return Response.json({
        ...await canonicalOwnerResult(key, controller),
        actionResult: candidate,
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

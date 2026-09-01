import { env } from "cloudflare:workers";
import {
  operatorDiagnostics as productionOperatorDiagnostics,
  ownerOverview as productionOwnerOverview,
  ownerSnapshot as productionOwnerSnapshot,
  productionPipelineStageAgents,
  recoverOwnerState as productionRecoverOwnerState,
  submitOwnerAction as productionSubmitOwnerAction,
  userKey,
} from "../../../lib/p0";
import {
  assertCurrentPipelineAction,
  projectCurrentPipelineContract,
} from "../../../lib/pipeline-current-contract";
import { D1PipelineRunStore } from "../../../lib/pipeline-orchestrator-d1-store";
import { D1CurrentGoalStore } from "../../../lib/goal-revision-d1-store";
import {
  OwnerPipelineController,
  type PipelineHistoricalView,
} from "../../../lib/pipeline-owner-dashboard";
import {
  isPublicationReviewHandoff,
  projectPublicationReviewBoundary,
  publicationReviewAcceptsDraftEdit,
} from "../../../lib/publication-review-boundary";

function failure() {
  return {
    message: "Действие не выполнено. Обновите страницу и повторите текущее бизнес-решение.",
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
  });
}

function productionBackend(key: string) {
  return {
    overview: () => productionOwnerOverview(key),
    snapshot: () => productionOwnerSnapshot(key),
    diagnostics: () => productionOperatorDiagnostics(key),
    applyAction: (payload: Record<string, unknown>) => productionSubmitOwnerAction(key, payload),
  };
}

export async function GET(request: Request) {
  try {
    const key = userKey(request);
    const currentBackend = productionBackend(key);
    const pipeline = await pipelineController().current(key);
    const value = pipeline.active
      ? await currentBackend.snapshot()
      : await currentBackend.overview();
    return Response.json(projectPublicationReviewBoundary(value, pipeline));
  } catch (error) {
    return invalidLocalState(error)
      ? Response.json(recoveryRequired(), { status: 409 })
      : Response.json(failure(), { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const key = userKey(request);
    const currentBackend = productionBackend(key);
    const controller = pipelineController();
    if (payload.recovery_action !== undefined) {
      if (payload.recovery_action !== "RESET_INVALID_LOCAL_P0_STATE"
        || payload.confirmation !== "RESET_INVALID_LOCAL_P0_STATE") {
        throw new Error("Local recovery requires exact confirmation.");
      }
      const current = await controller.current(key);
      if (current.active) throw new Error("Local preparation cannot be reset during an active pipeline run.");
      const value = await productionRecoverOwnerState(key, payload.confirmation);
      return Response.json(projectPublicationReviewBoundary(value, await controller.current(key)), { status: 201 });
    }
    if (payload.pipeline_action !== undefined) {
      const pipelineAction = assertCurrentPipelineAction(payload);
      if (pipelineAction === "EXPLAIN") {
        return Response.json(await controller.explain(key, {
          question: payload.question,
          pairKey: payload.pair_key,
        }));
      }
      if (pipelineAction === "START") {
        const current = await controller.current(key);
        if (current.active) throw new Error("У владельца уже есть активный запуск.");
        const [value, diagnostics] = await Promise.all([
          currentBackend.snapshot(),
          currentBackend.diagnostics(),
        ]);
        const pipeline = await controller.startAndExecute(key, diagnostics as unknown as PipelineHistoricalView);
        return Response.json(projectPublicationReviewBoundary(value, pipeline), { status: 201 });
      }
      if (pipelineAction === "CORRECT_GOAL") {
        const pipeline = await controller.correctGoal(key, {
          desiredOutcome: String(payload.desired_outcome ?? ""),
          qualifiedAction: String(payload.qualified_action ?? ""),
        });
        return Response.json(projectCurrentPipelineContract(pipeline), { status: 201 });
      }
      const pipeline = await controller.stop(key, {
        runId: String(payload.run_id ?? ""),
        expectedVersion: Number(payload.expected_version),
      });
      return Response.json(projectCurrentPipelineContract(pipeline), { status: 201 });
    }

    const currentPipeline = await controller.current(key);
    if (currentPipeline.editingLocked) {
      throw new Error("Редактирование недоступно во время активного запуска.");
    }
    if (isPublicationReviewHandoff(currentPipeline)) {
      const current = await currentBackend.overview();
      if (!publicationReviewAcceptsDraftEdit(current, payload)) {
        throw new Error("На проверке публикации доступны только правки текущих Draft.");
      }
    }
    const value = await currentBackend.applyAction(payload);
    return Response.json(projectPublicationReviewBoundary(value, await controller.current(key)), { status: 201 });
  } catch {
    return Response.json(failure(), { status: 409 });
  }
}

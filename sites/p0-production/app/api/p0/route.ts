import { env } from "cloudflare:workers";
import { localP0E2EFixtureScenario } from "../../../lib/p0-e2e-boundary";
import {
  operatorDiagnostics as productionOperatorDiagnostics,
  ownerOverview as productionOwnerOverview,
  ownerSnapshot as productionOwnerSnapshot,
  submitOwnerAction as productionSubmitOwnerAction,
  userKey,
} from "../../../lib/p0";
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

function localFixtureScenario(request: Request) {
  return localP0E2EFixtureScenario(
    request.url,
    (env as unknown as { P0_E2E_FIXTURE_SCENARIO?: string })
      .P0_E2E_FIXTURE_SCENARIO,
  );
}

async function fixtureBackend(request: Request) {
  const scenario = localFixtureScenario(request);
  if (!scenario) return null;
  const fixture = await import("../../../lib/p0-e2e-runtime");
  const key = userKey(request);
  return {
    overview: () => fixture.fixtureOwnerOverview(scenario, key),
    snapshot: () => fixture.fixtureOwnerSnapshot(scenario, key),
    diagnostics: () => fixture.fixtureOperatorDiagnostics(scenario, key),
    applyAction: (payload: Record<string, unknown>) => fixture.fixtureSubmitOwnerAction(scenario, key, payload),
  };
}

function pipelineController() {
  return new OwnerPipelineController(new D1PipelineRunStore(env.DB), {
    goalStore: new D1CurrentGoalStore(env.DB),
  });
}

async function backend(request: Request) {
  const fixture = await fixtureBackend(request);
  const key = userKey(request);
  return fixture ?? {
    overview: () => productionOwnerOverview(key),
    snapshot: () => productionOwnerSnapshot(key),
    diagnostics: () => productionOperatorDiagnostics(key),
    applyAction: (payload: Record<string, unknown>) => productionSubmitOwnerAction(key, payload),
  };
}

export async function GET(request: Request) {
  try {
    const key = userKey(request);
    const currentBackend = await backend(request);
    const pipeline = await pipelineController().current(key);
    const value = pipeline.active
      ? await currentBackend.snapshot()
      : await currentBackend.overview();
    return Response.json(projectPublicationReviewBoundary(value, pipeline));
  } catch {
    return Response.json(failure(), { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const key = userKey(request);
    const currentBackend = await backend(request);
    const controller = pipelineController();
    const pipelineAction = String(payload.pipeline_action ?? "");
    if (pipelineAction === "START") {
      const current = await controller.current(key);
      if (current.active) throw new Error("У владельца уже есть активный запуск.");
      const [value, diagnostics] = await Promise.all([
        currentBackend.snapshot(),
        currentBackend.diagnostics(),
      ]);
      const pipeline = await controller.start(key, diagnostics as unknown as PipelineHistoricalView);
      return Response.json({ ...value, pipeline }, { status: 201 });
    }
    if (pipelineAction === "STOP") {
      const pipeline = await controller.stop(key, {
        runId: String(payload.run_id ?? ""),
        expectedVersion: Number(payload.expected_version),
      });
      return Response.json({ ...(await currentBackend.snapshot()), pipeline }, { status: 201 });
    }
    if (pipelineAction === "CORRECT_GOAL") {
      const pipeline = await controller.correctGoal(key, {
        desiredOutcome: String(payload.desired_outcome ?? ""),
        qualifiedAction: String(payload.qualified_action ?? ""),
      });
      return Response.json({ ...(await currentBackend.snapshot()), pipeline }, { status: 201 });
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

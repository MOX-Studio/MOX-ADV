import { env } from "cloudflare:workers";
import { localP0E2EFixtureScenario } from "../../../lib/p0-e2e-boundary";
import {
  assertCurrentPipelineAction,
  projectCurrentPipelineContract,
} from "../../../lib/pipeline-current-contract";
import {
  PipelineLegacyMigrationError,
  archiveLegacyPipelineDocument,
} from "../../../lib/pipeline-legacy-migration";
import { D1PipelineRunStore } from "../../../lib/pipeline-orchestrator-d1-store";
import { D1CurrentGoalStore } from "../../../lib/goal-revision-d1-store";
import {
  OwnerPipelineController,
  type PipelineHistoricalView,
} from "../../../lib/pipeline-owner-dashboard";

function failure(error?: unknown) {
  if (error instanceof PipelineLegacyMigrationError) {
    return { code: error.code, message: error.message };
  }
  return {
    message: "Действие не выполнено. Обновите страницу и повторите текущее бизнес-решение.",
  };
}

function userKey(request: Request) {
  const hostname = new URL(request.url).hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "local-preview";
  throw new Error("Для production-модуля требуется отдельный адаптер идентификации пользователя.");
}

function localFixtureScenario(request: Request) {
  return localP0E2EFixtureScenario(
    request.url,
    (env as unknown as { P0_E2E_FIXTURE_SCENARIO?: string })
      .P0_E2E_FIXTURE_SCENARIO,
  );
}

async function historicalView(request: Request, key: string): Promise<PipelineHistoricalView> {
  const scenario = localFixtureScenario(request);
  if (scenario) {
    const fixture = await import("../../../lib/p0-e2e-runtime");
    return fixture.fixtureOperatorDiagnostics(scenario, key) as unknown as PipelineHistoricalView;
  }
  return archiveLegacyPipelineDocument(env.DB, key);
}

function pipelineController() {
  return new OwnerPipelineController(new D1PipelineRunStore(env.DB), {
    goalStore: new D1CurrentGoalStore(env.DB),
  });
}

export async function GET(request: Request) {
  try {
    const pipeline = await pipelineController().current(userKey(request));
    return Response.json(projectCurrentPipelineContract(pipeline));
  } catch (error) {
    return Response.json(failure(error), { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const key = userKey(request);
    const controller = pipelineController();
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
      const pipeline = await controller.start(key, await historicalView(request, key));
      return Response.json(projectCurrentPipelineContract(pipeline), { status: 201 });
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
  } catch (error) {
    return Response.json(failure(error), { status: 409 });
  }
}

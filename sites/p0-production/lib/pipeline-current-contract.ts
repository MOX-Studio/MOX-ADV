import type { OwnerJourneyProjection } from "./p0-owner-journey.ts";
import { OWNER_JOURNEY_STAGES } from "./p0-owner-journey.ts";
import type { OwnerPipelineProjection } from "./pipeline-owner-dashboard.ts";

/**
 * Public query projection after cutover. Legacy application documents are not
 * accepted as current product state; only the new orchestrator projection is
 * returned to the Dashboard.
 */
export function projectCurrentPipelineContract(
  pipeline: OwnerPipelineProjection,
): OwnerJourneyProjection & { pipeline: OwnerPipelineProjection } {
  const goal = pipeline.goalFormation.status === "VERIFIED"
    ? pipeline.goalFormation.desiredOutcome
    : null;
  const summary = pipeline.status === "NOT_STARTED"
    ? "Исторические документы сохранены только для аудита. Новый запуск сформирует текущие объекты заново."
    : pipeline.stateText;
  const currentStage = pipeline.currentStage;
  return {
    pipeline,
    accessReadiness: null,
    goalInterview: null,
    campaignGoal: goal,
    campaignGoalConfirmed: pipeline.goalFormation.status === "VERIFIED",
    journey: {
      currentStage,
      stages: OWNER_JOURNEY_STAGES.map((stage) => ({
        ...stage,
        status: stage.id === currentStage
          ? "current" as const
          : "upcoming" as const,
      })),
    },
    introduction: {
      title: "Новый базовый пайплайн",
      body: "Текущий результат определяется только пятью этапами Pipeline Orchestrator.",
    },
    businessOutcome: {
      status: pipeline.status === "COMPLETED" ? "complete" : pipeline.active ? "working" : "ready",
      headline: goal ?? (pipeline.status === "NOT_STARTED" ? "Готово к новому запуску" : pipeline.currentTask),
      summary,
    },
    currentRecommendation: null,
    directReport: null,
    competitorMatrix: null,
    analyticsSummary: null,
    demandCostResearch: null,
    businessModel: null,
    campaignStrategy: null,
    appliedPractice: null,
    businessReadiness: null,
    materialUnknowns: [],
    agentActivity: null,
    cards: [],
    campaignOptions: [],
    packageSummary: null,
    packageDecision: null,
    primaryAction: null,
    roadmap: [
      { label: "Управление", horizon: "P1", interactive: false },
      { label: "Мониторинг", horizon: "P2", interactive: false },
      { label: "SEO", horizon: "P3", interactive: false },
      { label: "VK", horizon: "Будущий канал", interactive: false },
    ],
  };
}

export function assertCurrentPipelineAction(payload: Record<string, unknown>) {
  const action = String(payload.pipeline_action ?? "");
  if (!new Set(["START", "STOP", "CORRECT_GOAL", "EXPLAIN"]).has(action)) {
    throw new Error("Старый action-контракт отключён; доступны только действия нового Pipeline Orchestrator.");
  }
  return action as "START" | "STOP" | "CORRECT_GOAL" | "EXPLAIN";
}

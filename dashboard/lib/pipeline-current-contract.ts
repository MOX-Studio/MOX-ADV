import type { OwnerJourneyProjection } from "./p0-owner-journey.ts";
import { OWNER_JOURNEY_STAGES } from "./p0-owner-journey.ts";
import type { OwnerPipelineProjection } from "./pipeline-owner-dashboard.ts";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function list(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function currentPreflight(state: Record<string, unknown>) {
  const packageReview = record(state.package_review);
  const humanGate = record(state.human_decision_gate);
  const businessProjection = record(packageReview.business_projection ?? humanGate.business_projection);
  const preflight = record(businessProjection.preflight);
  const gates = list(preflight.gates).map(record).map((gate) => ({
    label: text(gate.label || gate.name || gate.gate_id || gate.code) || "Проверка",
    status: gate.status === "PASS" || gate.passed === true ? "Пройдено" as const : "Заблокировано" as const,
    explanation: text(gate.explanation || gate.message || gate.reason) || (gate.status === "PASS" ? "Проверка пройдена." : "Требуется подтверждённое evidence."),
  }));
  const passed = Number(preflight.passed ?? gates.filter((gate) => gate.status === "Пройдено").length);
  const total = Number(preflight.total ?? (gates.length || 9));
  return {
    status: text(preflight.status) || (passed === total ? "PASS" : "BLOCKED"),
    passed: Number.isFinite(passed) ? passed : 0,
    total: Number.isFinite(total) && total > 0 ? total : 9,
    preflightGates: gates,
  };
}

export type CurrentPipelineOwnerResult = {
  schemaVersion: "p0-current-pipeline-owner-result-v1";
  stateRevision: number | null;
  products: OwnerPipelineProjection["currentProducts"];
  preflight: ReturnType<typeof currentPreflight>;
  reproducibilityVersions: Array<{ label: string; value: string }>;
  playbookGovernance: Record<string, unknown> | null;
  questions: Array<{ label: string; prompt: string }>;
};

/**
 * Canonical public query after cutover. Historical state contributes bounded
 * evidence/preflight context only; current Goal, Strategy, Campaign pairs and
 * stage truth always come from the Pipeline Orchestrator and current-products store.
 */
export function projectCurrentPipelineContract(
  pipeline: OwnerPipelineProjection,
  context: { historicalState?: Record<string, unknown>; playbookGovernance?: Record<string, unknown> | null } = {},
): OwnerJourneyProjection & { pipeline: OwnerPipelineProjection; currentResult: CurrentPipelineOwnerResult } {
  const goal = pipeline.goalFormation.status === "VERIFIED"
    ? pipeline.goalFormation.desiredOutcome
    : null;
  const summary = pipeline.status === "NOT_STARTED"
    ? "Исторические документы сохранены только как входные evidence. Новый запуск сформирует текущие объекты заново."
    : pipeline.stateText;
  const currentStage = pipeline.currentStage;
  const stageState = new Map(pipeline.stages.map((stage) => [stage.id, stage.tone]));
  const reproducibilityVersions = [
    ...(pipeline.currentProducts?.campaignPairs.flatMap((pair) => pair.reproducibility) ?? []),
    ...(pipeline.provenance ? [
      { label: "Pipeline contract", value: pipeline.provenance.versions.policy.schemaVersion },
      { label: "Campaign Playbook", value: pipeline.provenance.versions.campaignPlaybook.schemaVersion },
    ] : []),
  ].filter((item, index, values) => values.findIndex((candidate) => candidate.label === item.label && candidate.value === item.value) === index);
  const currentResult: CurrentPipelineOwnerResult = {
    schemaVersion: "p0-current-pipeline-owner-result-v1",
    stateRevision: pipeline.currentProducts?.stateRevision ?? null,
    products: pipeline.currentProducts,
    preflight: currentPreflight(context.historicalState ?? {}),
    reproducibilityVersions,
    playbookGovernance: context.playbookGovernance ? structuredClone(context.playbookGovernance) : null,
    questions: [
      { label: "Спросить о текущем результате", prompt: "Почему получился текущий результат?" },
      { label: "Проверить источник", prompt: "На каких evidence основан текущий результат?" },
      { label: "Понять следующий шаг", prompt: "Что блокирует следующий этап?" },
    ],
  };
  return {
    pipeline,
    currentResult,
    accessReadiness: null,
    goalInterview: null,
    campaignGoal: goal,
    campaignGoalConfirmed: pipeline.goalFormation.status === "VERIFIED",
    journey: {
      currentStage,
      stages: OWNER_JOURNEY_STAGES.map((stage) => ({
        ...stage,
        status: stageState.get(stage.id) === "complete"
          ? "complete" as const
          : stage.id === currentStage ? "current" as const : "upcoming" as const,
      })),
    },
    introduction: {
      title: "Campaign Draft Pipeline",
      body: "Текущий результат определяется пятью этапами Pipeline Orchestrator; внешняя запись, публикация и расходы не разрешены.",
    },
    businessOutcome: {
      status: pipeline.status === "COMPLETED" ? "complete" : pipeline.active ? "working" : pipeline.status === "FAILED" ? "blocked" : "ready",
      headline: goal ?? (pipeline.status === "NOT_STARTED" ? "Готово к новому запуску" : pipeline.currentTask),
      summary,
    },
    currentRecommendation: null,
    directReport: null,
    competitorMatrix: null,
    analyticsSummary: null,
    demandCostResearch: pipeline.currentProducts?.demandCostResearch ?? null,
    businessModel: null,
    campaignStrategy: null,
    appliedPractice: null,
    businessReadiness: null,
    materialUnknowns: [],
    agentActivity: pipeline.active ? {
      status: "working",
      summary: `${pipeline.currentTask} ${pipeline.stateText}`,
      completed: pipeline.stages.filter((stage) => stage.tone === "complete").length,
      total: pipeline.stages.length,
      nextBusinessStep: "Можно остановить запуск; внешняя запись не выполняется.",
    } : null,
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

export const CURRENT_PIPELINE_ACTIONS = [
  "START",
  "STOP",
  "CORRECT_GOAL",
  "REFRESH_EVIDENCE",
  "REFRESH_COMPETITOR_ANALYSIS",
  "CORRECT_STRATEGY",
  "EDIT_CAMPAIGN_PAIR",
  "EXPLAIN",
  "PLAYBOOK_STEWARD_DECISION",
  "PROPOSE_PLAYBOOK_CANDIDATE",
] as const;

export type CurrentPipelineAction = (typeof CURRENT_PIPELINE_ACTIONS)[number];

export function assertCurrentPipelineAction(payload: Record<string, unknown>) {
  const action = String(payload.pipeline_action ?? "");
  if (!CURRENT_PIPELINE_ACTIONS.includes(action as CurrentPipelineAction)) {
    throw new Error("Старый action-контракт отключён; доступны только действия нового Pipeline Orchestrator.");
  }
  return action as CurrentPipelineAction;
}

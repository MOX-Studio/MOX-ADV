import type { GoalCandidate } from "./goal-revision.ts";
import {
  PIPELINE_INPUT_VERSIONS_SCHEMA,
  PIPELINE_STAGES,
  PipelineOrchestrator,
  pipelineDigest,
  type PipelineInputVersions,
  type PipelineRunState,
  type PipelineRunStore,
  type PipelineStageId,
  type PipelineStageStatus,
} from "./pipeline-orchestrator.ts";

export type OwnerPipelineStageId = "goal" | "findings" | "strategy" | "campaigns" | "review";
export type OwnerPipelineStageStatus = "Завершён" | "Выполняется" | "Ожидает" | "Возвращён" | "Остановлен";

export type OwnerPipelineProjection = {
  runId: string | null;
  version: number | null;
  status: "NOT_STARTED" | PipelineRunState["status"];
  active: boolean;
  editingLocked: boolean;
  currentStage: OwnerPipelineStageId;
  currentTask: string;
  stateText: string;
  stages: Array<{
    id: OwnerPipelineStageId;
    pipelineStageId: PipelineStageId;
    label: string;
    status: OwnerPipelineStageStatus;
    icon: "✓" | "…" | "○" | "↩" | "■";
    tone: "complete" | "active" | "pending" | "returned" | "stopped";
  }>;
  return: null | {
    source: string;
    reason: string;
    target: string;
  };
  goalFormation:
    | { status: "PENDING" }
    | {
        status: "VERIFIED";
        versionLabel: string;
        desiredOutcome: string;
        qualifiedAction: string;
        provenance: string[];
        knownConstraints: string[];
        ownerConfirmationRequired: false;
      }
    | {
        status: "MATERIAL_DECISION_REQUIRED";
        reason: string;
        recommendation: string;
        options: Array<{
          id: string;
          desiredOutcome: string;
          qualifiedAction: string;
          evidence: string[];
          consequences: string[];
          recommended: boolean;
        }>;
      };
  canStart: boolean;
  canStop: boolean;
};

export type PipelineHistoricalView = {
  revision: number;
  state: Record<string, unknown>;
};

const OWNER_STAGE_BY_PIPELINE: Record<PipelineStageId, OwnerPipelineStageId> = {
  CAMPAIGN_GOAL: "goal",
  EVIDENCE_COLLECTION: "findings",
  STRATEGY: "strategy",
  CAMPAIGNS: "campaigns",
  PUBLICATION_REVIEW: "review",
};

const TASK_BY_STAGE: Record<PipelineStageId, string> = {
  CAMPAIGN_GOAL: "Формирую полный желаемый бизнес-результат и известные ограничения.",
  EVIDENCE_COLLECTION: "Собираю и проверяю разрешённые сведения для текущей цели.",
  STRATEGY: "Формирую и проверяю одну текущую Campaign Strategy.",
  CAMPAIGNS: "Собираю полные пары Campaign Hypothesis + Campaign Draft.",
  PUBLICATION_REVIEW: "Проверяю готовые черновики без публикации и внешней записи.",
};

const PRESENTATION_BY_STATUS: Record<PipelineStageStatus, {
  status: OwnerPipelineStageStatus;
  icon: OwnerPipelineProjection["stages"][number]["icon"];
  tone: OwnerPipelineProjection["stages"][number]["tone"];
}> = {
  COMPLETED: { status: "Завершён", icon: "✓", tone: "complete" },
  ACTIVE: { status: "Выполняется", icon: "…", tone: "active" },
  PENDING: { status: "Ожидает", icon: "○", tone: "pending" },
  RETURNED: { status: "Возвращён", icon: "↩", tone: "returned" },
  STOPPED: { status: "Остановлен", icon: "■", tone: "stopped" },
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function list(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function schema(value: unknown, fallback: string) {
  const valueSchema = String(record(value).schema_version ?? "").trim();
  return valueSchema || fallback;
}

function identifier(value: unknown, fallback: string) {
  const candidate = String(value ?? "").trim();
  return candidate && candidate.length <= 255 ? candidate : fallback;
}

async function versionReference(
  value: unknown,
  fallbackSchema: string,
  fallbackRevisionId: string,
  preferredRevisionId?: unknown,
) {
  return {
    schema_version: schema(value, fallbackSchema),
    revision_id: identifier(preferredRevisionId, fallbackRevisionId),
    digest: await pipelineDigest(value),
  };
}

/**
 * Freezes the exact saved owner inputs that a new run is allowed to consume.
 * This reads the historical document but never mutates it.
 */
export async function pipelineInputVersions(view: PipelineHistoricalView): Promise<PipelineInputVersions> {
  const state = record(view.state);
  const context = record(state.context_state);
  const goal = record(context.business_goal_decision);
  const evidence = record(state.analytics_evidence_snapshot);
  const strategy = record(state.strategy);
  const recommendationSet = record(state.recommendation_set);
  const businessInput = {
    owner_goal_interview: state.owner_goal_interview ?? null,
    business_model: state.business_model ?? null,
    business_goal_decision: context.business_goal_decision ?? null,
    strategy_review: state.strategy_review ?? null,
  };
  const campaignPairs = [];
  for (const [index, value] of list(recommendationSet.drafts).entries()) {
    const draft = record(value);
    const hypothesis = record(record(draft.variant).hypothesis);
    if (!Object.keys(hypothesis).length) continue;
    campaignPairs.push({
      hypothesis: await versionReference(
        hypothesis,
        "campaign-hypothesis-v1",
        `campaign-hypothesis:${view.revision}:${index + 1}`,
        hypothesis.hypothesis_id,
      ),
      draft: await versionReference(
        draft,
        "campaign-draft-v1",
        `campaign-draft:${view.revision}:${index + 1}`,
        draft.draft_revision_id ?? draft.draft_id,
      ),
    });
  }
  return {
    schema_version: PIPELINE_INPUT_VERSIONS_SCHEMA,
    historical_document: {
      schema_version: schema(state, "p0-application-document"),
      revision: view.revision,
      digest: await pipelineDigest(state),
    },
    business_input: await versionReference(
      businessInput,
      "p0-owner-business-input-v1",
      `owner-business-input:${view.revision}`,
    ),
    goal_revision: Object.keys(goal).length
      ? await versionReference(goal, "goal-revision-v1", `goal-revision:${view.revision}`, goal.goal_revision_id ?? goal.decision_id)
      : null,
    analytics_evidence_snapshot: Object.keys(evidence).length
      ? await versionReference(evidence, "analytics-evidence-snapshot-v1", `analytics-evidence:${view.revision}`, evidence.snapshot_id)
      : null,
    campaign_strategy_revision: Object.keys(strategy).length
      ? await versionReference(strategy, "campaign-strategy-revision-v1", `campaign-strategy:${view.revision}`, strategy.strategy_revision_id)
      : null,
    campaign_pairs: campaignPairs,
    pipeline_policy: await versionReference(
      { schema_version: "p0-pipeline-policy-v1", canonical_path: PIPELINE_STAGES.map((stage) => stage.id), external_write: "DENIED" },
      "p0-pipeline-policy-v1",
      "p0-pipeline-policy:1.0.0",
    ),
    campaign_playbook: await versionReference(
      { schema_version: "campaign-playbook-binding-v1", active_release: record(strategy.playbook).release_id ?? "p0-curated-playbook-v1" },
      "campaign-playbook-binding-v1",
      identifier(record(strategy.playbook).release_id, "p0-curated-playbook-v1"),
    ),
  };
}

function stageLabel(stageId: PipelineStageId) {
  return PIPELINE_STAGES.find((stage) => stage.id === stageId)?.label ?? stageId;
}

export function projectOwnerPipeline(run: PipelineRunState | null): OwnerPipelineProjection {
  if (!run) {
    return {
      runId: null,
      version: null,
      status: "NOT_STARTED",
      active: false,
      editingLocked: false,
      currentStage: "goal",
      currentTask: "Сохранённые правки готовы для нового запуска.",
      stateText: "Запуск ещё не начат. Редактирование доступно.",
      stages: PIPELINE_STAGES.map((stage) => ({
        id: OWNER_STAGE_BY_PIPELINE[stage.id],
        pipelineStageId: stage.id,
        label: stage.label,
        status: "Ожидает",
        icon: "○",
        tone: "pending",
      })),
      return: null,
      goalFormation: { status: "PENDING" },
      canStart: true,
      canStop: false,
    };
  }
  const stateText = run.status === "ACTIVE"
    ? `Выполняется этап «${stageLabel(run.current_stage)}».`
    : run.status === "STOPPED"
      ? `Запуск остановлен на этапе «${stageLabel(run.current_stage)}». Следующий запуск будет новым.`
      : run.status === "COMPLETED"
        ? "Пять этапов завершены. Внешняя запись не выполнялась."
        : "Запуск завершён технической ошибкой без внешней записи.";
  const persistedGoalFormation = run.goal_formation;
  const goalFormation: OwnerPipelineProjection["goalFormation"] = persistedGoalFormation.status === "VERIFIED"
    ? {
        status: "VERIFIED",
        versionLabel: `Версия ${persistedGoalFormation.revision.version}`,
        desiredOutcome: persistedGoalFormation.revision.desired_outcome,
        qualifiedAction: persistedGoalFormation.revision.qualified_action,
        provenance: persistedGoalFormation.revision.provenance.map((item) => `${item.evidence} · ${item.locator}`),
        knownConstraints: persistedGoalFormation.revision.known_constraints.map((item) => item.constraint),
        ownerConfirmationRequired: false,
      }
    : persistedGoalFormation.status === "MATERIAL_DECISION_REQUIRED"
      ? {
          status: "MATERIAL_DECISION_REQUIRED",
          reason: persistedGoalFormation.reason,
          recommendation: persistedGoalFormation.options.find((option) => option.option_id === persistedGoalFormation.recommendation)?.desired_outcome ?? "",
          options: persistedGoalFormation.options.map((option) => ({
            id: option.option_id,
            desiredOutcome: option.desired_outcome,
            qualifiedAction: option.qualified_action,
            evidence: option.evidence.map((item) => `${item.evidence} · ${item.locator}`),
            consequences: [...option.consequences],
            recommended: option.recommended,
          })),
        }
      : { status: "PENDING" };
  return {
    runId: run.run_id,
    version: run.version,
    status: run.status,
    active: run.status === "ACTIVE",
    editingLocked: run.status === "ACTIVE",
    currentStage: OWNER_STAGE_BY_PIPELINE[run.current_stage],
    currentTask: run.status === "ACTIVE" ? TASK_BY_STAGE[run.current_stage] : stateText,
    stateText,
    stages: run.stages.map((stage) => ({
      id: OWNER_STAGE_BY_PIPELINE[stage.id],
      pipelineStageId: stage.id,
      label: stage.label,
      ...PRESENTATION_BY_STATUS[stage.status],
    })),
    return: run.last_transition.kind === "RETURN" && run.last_transition.source_stage && run.last_transition.target_stage
      ? {
          source: stageLabel(run.last_transition.source_stage),
          reason: run.last_transition.reason,
          target: stageLabel(run.last_transition.target_stage),
        }
      : null,
    goalFormation,
    canStart: run.status !== "ACTIVE",
    canStop: run.status === "ACTIVE",
  };
}

export class OwnerPipelineController {
  private readonly orchestrator: PipelineOrchestrator;

  constructor(store: PipelineRunStore, input: { now?: () => string; newRunId?: () => string } = {}) {
    this.orchestrator = new PipelineOrchestrator({ store, ...input });
  }

  async current(ownerKey: string) {
    return projectOwnerPipeline(await this.orchestrator.current(ownerKey));
  }

  async start(ownerKey: string, view: PipelineHistoricalView) {
    return projectOwnerPipeline(await this.orchestrator.start(ownerKey, await pipelineInputVersions(view)));
  }

  async recordGoalCandidate(ownerKey: string, input: { runId: string; expectedVersion: number; candidate: GoalCandidate }) {
    const current = await this.orchestrator.current(ownerKey);
    if (!current || current.run_id !== input.runId) {
      throw new Error("Активный запуск изменился. Обновите Dashboard.");
    }
    return projectOwnerPipeline(await this.orchestrator.recordGoalCandidate({
      run_id: input.runId,
      expected_version: input.expectedVersion,
      candidate: input.candidate,
    }));
  }

  async stop(ownerKey: string, input: { runId: string; expectedVersion: number }) {
    const current = await this.orchestrator.current(ownerKey);
    if (!current || current.run_id !== input.runId) {
      throw new Error("Активный запуск изменился. Обновите Dashboard.");
    }
    return projectOwnerPipeline(await this.orchestrator.stop({
      run_id: input.runId,
      expected_version: input.expectedVersion,
    }));
  }
}

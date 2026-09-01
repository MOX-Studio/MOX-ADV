import { validateCampaignPairs } from "./campaign-pair-validation.ts";
import {
  projectDemandCostResearchForOwner,
  type OwnerJourneyProjection,
} from "./p0-owner-journey.ts";
import {
  projectCampaignPairDossier,
  type OwnerCampaignPairDossier,
} from "./campaign-pair-dossier.ts";
import type { CompiledCampaignPair } from "./campaign-design-agent.ts";
import type { AutonomousCampaignStrategy } from "./campaign-strategy-agent.ts";
import type { GoalCandidate } from "./goal-revision.ts";
import {
  CURRENT_GOAL_SCHEMA,
  goalDependencies,
  reviseCurrentGoal,
  type CurrentGoal,
  type CurrentGoalStore,
} from "./goal-revision-lifecycle.ts";
import {
  explainCurrentResultQuestion,
  projectCurrentResultProvenance,
  type CurrentCampaignPairReference,
  type OwnerResultExplanation,
  type OwnerResultProvenance,
} from "./pipeline-result-explanation.ts";
import { executeProductionPipeline } from "./pipeline-production-executor.ts";
import {
  saveVerifiedPipelineProduct,
  type PipelineCurrentProducts,
  type PipelineCurrentProductStore,
} from "./pipeline-current-products.ts";
import {
  saveCurrentPipelineCampaignPairEdit,
  saveCurrentPipelineStrategyCorrection,
} from "./pipeline-current-edits.ts";
import type { CampaignStrategyCorrectionChanges } from "./campaign-strategy-correction.ts";
import type { CampaignPairEditRequest } from "./campaign-pair-edit.ts";
import type { ProductionStageAgents } from "./production-stage-agents.ts";
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
  provenance: OwnerResultProvenance | null;
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
  campaignDossier: OwnerCampaignPairDossier | null;
  campaignDossiers: OwnerCampaignPairDossier[];
  currentProducts: null | {
    stateRevision: number;
    currentStage: OwnerPipelineStageId;
    updatedAt: string;
    evidence: { schemaVersion: string; revisionId: string; generatedAt: string; capabilityStatus: string } | null;
    demandCostResearch: OwnerJourneyProjection["demandCostResearch"];
    strategy: {
      revisionId: string;
      status: string;
      dimensions: Array<{ id: string; value: unknown; confidence: string; rationale: string }>;
    } | null;
    campaignPairs: Array<{
      pairKey: string;
      hypothesisRevisionId: string;
      draftRevisionId: string;
      hypothesis: Record<string, unknown>;
      publishProjection: Record<string, unknown>;
      auctionProtocol: Record<string, unknown>;
      reproducibility: Array<{ label: string; value: string }>;
    }>;
    pairValidation: { status: string; disposition: string; violations: string[] };
    publicationReview: null | {
      status: string;
      pairCount: number;
      externalWrite: "DENIED";
      publication: "NOT_AUTHORIZED";
      impressions: 0;
      spendMicros: 0;
    };
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
        rebuildRequired: string[];
        canCorrect: boolean;
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

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
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
  const campaignPairChecks = await validateCampaignPairs({
    recommendationSet,
    strategy,
    analyticsEvidence: evidence,
  });
  const includedDraftIds = new Set(campaignPairChecks.pairs.filter((pair) => pair.included).map((pair) => pair.draft_id));
  const campaignPairs = [];
  for (const [index, value] of list(recommendationSet.drafts).entries()) {
    const draft = record(value);
    if (!includedDraftIds.has(text(draft.draft_id))) continue;
    const hypothesis = record(record(draft.variant).hypothesis);
    if (!Object.keys(hypothesis).length
      || (hypothesis.draft_revision_id && hypothesis.draft_revision_id !== draft.draft_revision_id)
      || (hypothesis.future_campaign_id && hypothesis.future_campaign_id !== draft.future_campaign_id)) continue;
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
    campaign_pair_checks: campaignPairChecks,
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

function currentProductProjection(value: Awaited<ReturnType<PipelineCurrentProductStore["loadCurrent"]>>): OwnerPipelineProjection["currentProducts"] {
  if (!value) return null;
  const evidence = record(value.analytics_evidence_snapshot);
  const strategyProduct = record(value.campaign_strategy);
  const strategy = record(strategyProduct.strategy ?? strategyProduct);
  const dimensions = list(strategy.dimensions).map(record).map((dimension) => ({
    id: text(dimension.dimension_id),
    value: structuredClone(dimension.value),
    confidence: text(dimension.confidence),
    rationale: text(dimension.rationale),
  })).filter((dimension) => dimension.id);
  const campaignPairs = value.campaign_pairs.map((item, index) => {
    const pair = record(item);
    const hypothesis = record(pair.hypothesis);
    const draft = record(pair.draft);
    const publishProjection = record(draft.publish_projection);
    const lineage = record(publishProjection.lineage);
    const accountBinding = record(draft.account_binding);
    return {
      pairKey: identifier(pair.pair_revision_id ?? pair.pair_id, `pair-${index + 1}`),
      hypothesisRevisionId: identifier(hypothesis.hypothesis_revision_id ?? hypothesis.hypothesis_id, `hypothesis-${index + 1}`),
      draftRevisionId: identifier(
        draft.draft_revision_id ?? lineage.draft_revision_id ?? pair.draft_revision_id,
        `draft:${text(draft.publish_fingerprint ?? pair.publish_fingerprint).slice(7, 31) || index + 1}`,
      ),
      hypothesis: structuredClone(hypothesis),
      publishProjection: structuredClone(publishProjection),
      auctionProtocol: structuredClone(record(draft.auction_protocol)),
      reproducibility: [
        { label: "Direct Compiler", value: text(draft.schema_version) || "direct-v501-projection-compiler" },
        { label: "Профиль", value: [text(draft.profile_id), text(draft.profile_version)].filter(Boolean).join(" · ") || "p0-campaign-creation-profile-v1" },
        { label: "Applicability", value: text(draft.applicability_registry_version) || "current" },
        { label: "Account binding", value: text(accountBinding.currency) || "exact capability snapshot" },
      ],
    };
  });
  const pairChecks = record(value.campaign_pair_checks);
  const publication = value.publication_review ? record(value.publication_review) : null;
  return {
    stateRevision: value.state_revision,
    currentStage: OWNER_STAGE_BY_PIPELINE[value.current_stage],
    updatedAt: value.updated_at,
    evidence: Object.keys(evidence).length ? {
      schemaVersion: text(evidence.schema_version),
      revisionId: identifier(evidence.snapshot_revision_id ?? evidence.snapshot_id, "current-evidence"),
      generatedAt: text(evidence.generated_at),
      capabilityStatus: text(record(evidence.financial_competitor_intelligence).capability_status) || "UNAVAILABLE",
    } : null,
    demandCostResearch: projectDemandCostResearchForOwner(evidence),
    strategy: Object.keys(strategy).length ? {
      revisionId: identifier(strategy.strategy_revision_id, "current-strategy"),
      status: text(strategy.status),
      dimensions,
    } : null,
    campaignPairs,
    pairValidation: {
      status: text(pairChecks.status),
      disposition: text(pairChecks.set_disposition),
      violations: list(pairChecks.violations).map((violation) => text(record(violation).message || violation)).filter(Boolean),
    },
    publicationReview: publication ? {
      status: text(publication.status),
      pairCount: Number(publication.pair_count ?? campaignPairs.length),
      externalWrite: "DENIED",
      publication: "NOT_AUTHORIZED",
      impressions: 0,
      spendMicros: 0,
    } : null,
  };
}

function currentPairReferences(value: PipelineCurrentProducts | null): CurrentCampaignPairReference[] {
  if (!value) return [];
  return value.campaign_pairs.flatMap((item) => {
    const pair = record(item);
    const hypothesis = record(pair.hypothesis);
    const draft = record(pair.draft);
    const lineage = record(record(draft.publish_projection).lineage);
    const key = text(pair.pair_revision_id ?? pair.pair_id);
    const hypothesisRevisionId = text(hypothesis.hypothesis_revision_id ?? hypothesis.hypothesis_id);
    const draftRevisionId = text(draft.draft_revision_id ?? lineage.draft_revision_id ?? pair.draft_revision_id);
    const hypothesisSchema = text(hypothesis.schema_version);
    const draftSchema = text(draft.schema_version);
    if (!key || !hypothesisRevisionId || !draftRevisionId || !hypothesisSchema || !draftSchema) return [];
    return [{
      key,
      hypothesis: { schema_version: hypothesisSchema, revision_id: hypothesisRevisionId },
      draft: { schema_version: draftSchema, revision_id: draftRevisionId },
    }];
  });
}

export async function projectCurrentCampaignDossiers(value: PipelineCurrentProducts | null) {
  if (!value?.campaign_strategy || !value.campaign_pairs.length) return [];
  const stageProduct = record(value.campaign_strategy);
  const strategy = record(stageProduct.strategy ?? stageProduct) as AutonomousCampaignStrategy;
  const dossiers = await Promise.all(value.campaign_pairs.map((pair) => projectCampaignPairDossier({
    strategy,
    result: { status: "COMPLETED", pair: structuredClone(pair) as unknown as CompiledCampaignPair },
  })));
  return dossiers.every((dossier): dossier is OwnerCampaignPairDossier => dossier !== null) ? dossiers : [];
}

function stageLabel(stageId: PipelineStageId) {
  return PIPELINE_STAGES.find((stage) => stage.id === stageId)?.label ?? stageId;
}

export function projectOwnerPipeline(
  run: PipelineRunState | null,
  currentGoal: CurrentGoal | null = null,
  provenance: OwnerResultProvenance | null = null,
  campaignDossier: OwnerCampaignPairDossier | null = null,
  currentProducts: OwnerPipelineProjection["currentProducts"] = null,
  campaignDossiers: OwnerCampaignPairDossier[] = campaignDossier ? [campaignDossier] : [],
): OwnerPipelineProjection {
  if (!run) {
    return {
      runId: null,
      provenance: null,
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
      campaignDossier,
      campaignDossiers,
      currentProducts,
      goalFormation: currentGoal ? {
        status: "VERIFIED",
        versionLabel: `Версия ${currentGoal.revision.version}`,
        desiredOutcome: currentGoal.revision.desired_outcome,
        qualifiedAction: currentGoal.revision.qualified_action,
        provenance: currentGoal.revision.provenance.map((item) => `${item.evidence} · ${item.locator}`),
        knownConstraints: currentGoal.revision.known_constraints.map((item) => item.constraint),
        ownerConfirmationRequired: false,
        rebuildRequired: currentGoal.invalidation?.dependencies.map((item) => item.explanation) ?? [],
        canCorrect: true,
      } : { status: "PENDING" },
      canStart: true,
      canStop: false,
    };
  }
  const goalInvalidated = Boolean(currentGoal?.invalidation);
  const stateText = goalInvalidated
    ? "Текущая Цель исправлена. Зависимые результаты помечены для пересборки в новом запуске."
    : run.status === "ACTIVE"
      ? `Выполняется этап «${stageLabel(run.current_stage)}».`
      : run.status === "STOPPED"
        ? `Запуск остановлен на этапе «${stageLabel(run.current_stage)}». Следующий запуск будет новым.`
        : run.status === "COMPLETED"
          ? "Пять этапов завершены. Внешняя запись не выполнялась."
          : "Запуск завершён технической ошибкой без внешней записи.";
  const persistedGoalFormation = currentGoal
    ? { status: "VERIFIED" as const, revision: currentGoal.revision }
    : run.goal_formation;
  const goalFormation: OwnerPipelineProjection["goalFormation"] = persistedGoalFormation.status === "VERIFIED"
    ? {
        status: "VERIFIED",
        versionLabel: `Версия ${persistedGoalFormation.revision.version}`,
        desiredOutcome: persistedGoalFormation.revision.desired_outcome,
        qualifiedAction: persistedGoalFormation.revision.qualified_action,
        provenance: persistedGoalFormation.revision.provenance.map((item) => `${item.evidence} · ${item.locator}`),
        knownConstraints: persistedGoalFormation.revision.known_constraints.map((item) => item.constraint),
        ownerConfirmationRequired: false,
        rebuildRequired: currentGoal?.invalidation?.dependencies.map((item) => item.explanation) ?? [],
        canCorrect: run.status !== "ACTIVE",
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
    provenance,
    version: run.version,
    status: run.status,
    active: run.status === "ACTIVE",
    editingLocked: run.status === "ACTIVE",
    currentStage: goalInvalidated ? "goal" : OWNER_STAGE_BY_PIPELINE[run.current_stage],
    currentTask: goalInvalidated
      ? "Сохранённая правка Цели готова для нового запуска."
      : run.status === "ACTIVE" ? TASK_BY_STAGE[run.current_stage] : stateText,
    stateText,
    stages: run.stages.map((stage, index) => ({
      id: OWNER_STAGE_BY_PIPELINE[stage.id],
      pipelineStageId: stage.id,
      label: stage.label,
      ...(goalInvalidated
        ? PRESENTATION_BY_STATUS[index === 0 ? "COMPLETED" : "PENDING"]
        : PRESENTATION_BY_STATUS[stage.status]),
    })),
    return: run.last_transition.kind === "RETURN" && run.last_transition.source_stage && run.last_transition.target_stage
      ? {
          source: stageLabel(run.last_transition.source_stage),
          reason: run.last_transition.reason,
          target: stageLabel(run.last_transition.target_stage),
        }
      : null,
    campaignDossier,
    campaignDossiers,
    currentProducts,
    goalFormation,
    canStart: run.status !== "ACTIVE",
    canStop: run.status === "ACTIVE",
  };
}

export class OwnerPipelineController {
  private readonly orchestrator: PipelineOrchestrator;
  private readonly goalStore: CurrentGoalStore | null;
  private readonly stageAgents: ProductionStageAgents | null;
  private readonly productStore: PipelineCurrentProductStore | null;
  private readonly now: () => string;

  constructor(
    store: PipelineRunStore,
    input: {
      now?: () => string;
      newRunId?: () => string;
      goalStore?: CurrentGoalStore;
      stageAgents?: ProductionStageAgents;
      productStore?: PipelineCurrentProductStore;
    } = {},
  ) {
    this.orchestrator = new PipelineOrchestrator({ store, ...input });
    this.goalStore = input.goalStore ?? null;
    this.stageAgents = input.stageAgents ?? null;
    this.productStore = input.productStore ?? null;
    this.now = input.now ?? (() => new Date().toISOString());
  }

  private async project(run: PipelineRunState | null, ownerKey = run?.owner_key) {
    const [currentGoal, products] = ownerKey ? await Promise.all([
      this.goalStore?.loadCurrent(ownerKey) ?? null,
      this.productStore?.loadCurrent(ownerKey) ?? null,
    ]) : [null, null];
    const scopedProducts = !run || products?.run_id === run.run_id ? products : null;
    const [currentProducts, campaignDossiers] = await Promise.all([
      Promise.resolve(currentProductProjection(scopedProducts)),
      projectCurrentCampaignDossiers(scopedProducts),
    ]);
    if (!run) return projectOwnerPipeline(null, currentGoal, null, campaignDossiers[0] ?? null, currentProducts, campaignDossiers);
    const provenance = await projectCurrentResultProvenance(
      run,
      await this.orchestrator.audit(run.run_id),
      currentPairReferences(scopedProducts),
    );
    return projectOwnerPipeline(run, currentGoal, provenance, campaignDossiers[0] ?? null, currentProducts, campaignDossiers);
  }

  async current(ownerKey: string) {
    return this.project(await this.orchestrator.current(ownerKey), ownerKey);
  }

  private async frozenInputVersions(ownerKey: string, view: PipelineHistoricalView) {
    const [versions, currentGoal] = await Promise.all([
      pipelineInputVersions(view),
      this.goalStore?.loadCurrent(ownerKey) ?? null,
    ]);
    if (currentGoal) {
      versions.goal_revision = {
        schema_version: currentGoal.revision.schema_version,
        revision_id: currentGoal.revision.goal_revision_id,
        digest: currentGoal.revision.digest,
      };
    }
    return { versions, currentGoal };
  }

  private async persistFormedGoal(ownerKey: string, run: PipelineRunState) {
    let savedGoal = await this.goalStore?.loadCurrent(ownerKey) ?? null;
    if (this.goalStore && run.goal_formation.status === "VERIFIED" && !savedGoal) {
      const formed: CurrentGoal = {
        schema_version: CURRENT_GOAL_SCHEMA,
        owner_key: ownerKey,
        revision: run.goal_formation.revision,
        source: "GOAL_AGENT",
        invalidation: null,
      };
      if (!await this.goalStore.append(formed, null)) throw new Error("Текущая Цель изменилась. Обновите Dashboard.");
      savedGoal = formed;
    }
    return savedGoal;
  }

  async start(ownerKey: string, view: PipelineHistoricalView) {
    const { versions } = await this.frozenInputVersions(ownerKey, view);
    return this.project(await this.orchestrator.start(ownerKey, versions), ownerKey);
  }

  async execute(ownerKey: string, runId: string, view: PipelineHistoricalView) {
    if (!this.stageAgents) throw new Error("Production stage agents are not configured; deterministic substitution is forbidden.");
    const [started, currentGoal] = await Promise.all([
      this.orchestrator.current(ownerKey),
      this.goalStore?.loadCurrent(ownerKey) ?? null,
    ]);
    if (!started || started.run_id !== runId) throw new Error("Активный запуск изменился до начала исполнения.");
    if (started.status !== "ACTIVE") return this.project(started, ownerKey);
    try {
      const completed = await executeProductionPipeline({
        orchestrator: this.orchestrator,
        run: started,
        view,
        currentGoal,
        agents: this.stageAgents,
        onVerifiedProduct: this.productStore
          ? ({ run, product }) => saveVerifiedPipelineProduct({ store: this.productStore!, run, product, recordedAt: this.now() }).then(() => undefined)
          : undefined,
      });
      await this.persistFormedGoal(ownerKey, completed);
      return this.project(completed, ownerKey);
    } catch (error) {
      const current = await this.orchestrator.current(ownerKey);
      if (current?.run_id === runId && current.status === "STOPPED") return this.project(current, ownerKey);
      if (current?.run_id === runId && current.status === "ACTIVE") {
        await this.orchestrator.stop({
          run_id: current.run_id,
          expected_version: current.version,
          reason_code: "PRODUCTION_EXECUTION_FAILED",
          reason: "Production executor безопасно остановлен до внешней записи.",
        });
      }
      throw error;
    }
  }

  async startAndExecute(ownerKey: string, view: PipelineHistoricalView) {
    if (!this.stageAgents) throw new Error("Production stage agents are not configured; deterministic substitution is forbidden.");
    const { versions, currentGoal } = await this.frozenInputVersions(ownerKey, view);
    const started = await this.orchestrator.start(ownerKey, versions);
    try {
      const completed = await executeProductionPipeline({
        orchestrator: this.orchestrator,
        run: started,
        view,
        currentGoal,
        agents: this.stageAgents,
        onVerifiedProduct: this.productStore
          ? ({ run, product }) => saveVerifiedPipelineProduct({ store: this.productStore!, run, product, recordedAt: this.now() }).then(() => undefined)
          : undefined,
      });
      await this.persistFormedGoal(ownerKey, completed);
      return this.project(completed, ownerKey);
    } catch (error) {
      const current = await this.orchestrator.current(ownerKey);
      if (current?.run_id === started.run_id && current.status === "ACTIVE") {
        await this.orchestrator.stop({
          run_id: current.run_id,
          expected_version: current.version,
          reason_code: "PRODUCTION_EXECUTION_FAILED",
          reason: "Production executor безопасно остановлен до внешней записи.",
        });
      }
      throw error;
    }
  }

  async explain(ownerKey: string, input: { question: unknown; pairKey?: unknown }): Promise<OwnerResultExplanation> {
    const [run, products] = await Promise.all([
      this.orchestrator.current(ownerKey),
      this.productStore?.loadCurrent(ownerKey) ?? null,
    ]);
    if (!run) throw new Error("Текущий запуск ещё не создан.");
    const provenance = await projectCurrentResultProvenance(
      run,
      await this.orchestrator.audit(run.run_id),
      currentPairReferences(products?.run_id === run.run_id ? products : null),
    );
    return explainCurrentResultQuestion(provenance, input.question, input.pairKey);
  }

  async recordGoalCandidate(ownerKey: string, input: { runId: string; expectedVersion: number; candidate: GoalCandidate }) {
    const current = await this.orchestrator.current(ownerKey);
    if (!current || current.run_id !== input.runId) {
      throw new Error("Активный запуск изменился. Обновите Dashboard.");
    }
    const run = await this.orchestrator.recordGoalCandidate({
      run_id: input.runId,
      expected_version: input.expectedVersion,
      candidate: input.candidate,
    });
    await this.persistFormedGoal(ownerKey, run);
    return this.project(run, ownerKey);
  }

  async correctGoal(ownerKey: string, input: { desiredOutcome: string; qualifiedAction: string }) {
    if (!this.goalStore) throw new Error("Хранилище текущей Цели недоступно.");
    const [run, currentGoal] = await Promise.all([
      this.orchestrator.current(ownerKey),
      this.goalStore.loadCurrent(ownerKey),
    ]);
    if (run?.status === "ACTIVE") throw new Error("Остановите активный запуск перед исправлением Цели.");
    if (!currentGoal) throw new Error("Сначала сформируйте проверенную Цель.");
    const result = await reviseCurrentGoal({
      current: currentGoal,
      desired_outcome: input.desiredOutcome,
      qualified_action: input.qualifiedAction,
      corrected_at: this.now(),
      dependencies: run ? goalDependencies(run.input_versions) : [],
    });
    if (result.material_change
      && !await this.goalStore.append(result.current, currentGoal.revision.version)) {
      throw new Error("Текущая Цель изменилась. Обновите Dashboard.");
    }
    return this.project(run, ownerKey);
  }

  async correctStrategy(ownerKey: string, input: {
    expectedStateRevision: number;
    expectedStrategyRevisionId: string;
    changes: CampaignStrategyCorrectionChanges;
  }) {
    if (!this.productStore || !this.stageAgents) throw new Error("Текущая Strategy недоступна для production correction.");
    const run = await this.orchestrator.current(ownerKey);
    if (run?.status === "ACTIVE") throw new Error("Остановите активный запуск перед исправлением Strategy.");
    const result = await saveCurrentPipelineStrategyCorrection({
      store: this.productStore,
      ownerKey,
      runStatus: run?.status ?? "NOT_STARTED",
      expectedStateRevision: input.expectedStateRevision,
      expectedStrategyRevisionId: input.expectedStrategyRevisionId,
      changes: input.changes,
      model: this.stageAgents.strategy_correction_model,
      correctedAt: this.now(),
    });
    return { result, pipeline: await this.project(run, ownerKey) };
  }

  async editCampaignPair(ownerKey: string, input: {
    expectedStateRevision: number;
    edit: CampaignPairEditRequest;
  }) {
    if (!this.productStore) throw new Error("Текущие Campaign pairs недоступны для production edit.");
    const run = await this.orchestrator.current(ownerKey);
    if (run?.status === "ACTIVE") throw new Error("Остановите активный запуск перед исправлением Campaign pair.");
    const result = await saveCurrentPipelineCampaignPairEdit({
      store: this.productStore,
      ownerKey,
      runStatus: run?.status ?? "NOT_STARTED",
      expectedStateRevision: input.expectedStateRevision,
      edit: input.edit,
      editedAt: this.now(),
    });
    return { result, pipeline: await this.project(run, ownerKey) };
  }

  async stop(ownerKey: string, input: { runId: string; expectedVersion: number }) {
    const current = await this.orchestrator.current(ownerKey);
    if (!current || current.run_id !== input.runId) {
      throw new Error("Активный запуск изменился. Обновите Dashboard.");
    }
    const stopped = await this.orchestrator.stop({
      run_id: input.runId,
      expected_version: input.expectedVersion,
    });
    return this.project(stopped, ownerKey);
  }
}

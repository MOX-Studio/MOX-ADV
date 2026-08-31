const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u;
const REASON_CODE = /^[A-Z][A-Z0-9_]{1,79}$/u;

export const PIPELINE_ORCHESTRATOR_CONTRACT = "mox-adv.p0.pipeline-orchestrator";
export const PIPELINE_ORCHESTRATOR_VERSION = "1.1.0";
export const PIPELINE_RUN_SCHEMA = "p0-pipeline-run-v1";
export const PIPELINE_INPUT_VERSIONS_SCHEMA = "p0-pipeline-input-versions-v1";

export const PIPELINE_STAGES = [
  { id: "CAMPAIGN_GOAL", label: "Цель кампании" },
  { id: "EVIDENCE_COLLECTION", label: "Сбор сведений" },
  { id: "STRATEGY", label: "Стратегия" },
  { id: "CAMPAIGNS", label: "Кампании" },
  { id: "PUBLICATION_REVIEW", label: "Проверка публикации" },
] as const;

export type PipelineStageId = (typeof PIPELINE_STAGES)[number]["id"];
export type PipelineStageStatus = "PENDING" | "ACTIVE" | "COMPLETED" | "RETURNED" | "STOPPED";
export type PipelineRunStatus = "ACTIVE" | "STOPPED" | "COMPLETED" | "FAILED";
export type PipelineReturnCause = "GOAL_CONFLICT" | "EVIDENCE_REQUEST" | "STRATEGY_DEFECT";
export type PipelineTransitionKind = "START" | "ADVANCE" | "RETURN" | "RETRY" | "STOP" | "COMPLETE";

export type PipelineVersionReference = {
  schema_version: string;
  revision_id: string;
  digest: string;
};

export type PipelineInputVersions = {
  schema_version: typeof PIPELINE_INPUT_VERSIONS_SCHEMA;
  historical_document: {
    schema_version: string;
    revision: number;
    digest: string;
  };
  business_input: PipelineVersionReference;
  goal_revision: PipelineVersionReference | null;
  analytics_evidence_snapshot: PipelineVersionReference | null;
  campaign_strategy_revision: PipelineVersionReference | null;
  campaign_pairs: Array<{
    hypothesis: PipelineVersionReference;
    draft: PipelineVersionReference;
  }>;
  pipeline_policy: PipelineVersionReference;
  campaign_playbook: PipelineVersionReference;
};

export type PipelineTransition = {
  kind: PipelineTransitionKind;
  source_stage: PipelineStageId | null;
  target_stage: PipelineStageId | null;
  reason_code: string;
  reason: string;
  recorded_at: string;
};

export type PipelineRunState = {
  schema_version: typeof PIPELINE_RUN_SCHEMA;
  contract: {
    name: typeof PIPELINE_ORCHESTRATOR_CONTRACT;
    version: typeof PIPELINE_ORCHESTRATOR_VERSION;
  };
  run_id: string;
  owner_key: string;
  version: number;
  status: PipelineRunStatus;
  current_stage: PipelineStageId;
  stage_attempt: number;
  stages: Array<{
    id: PipelineStageId;
    label: string;
    status: PipelineStageStatus;
  }>;
  last_transition: PipelineTransition;
  work_control: {
    issue_actions: boolean;
    cancellation: "NONE" | "REQUESTED";
    unverified_output: "NEVER_PERSISTED";
  };
  initiator: {
    kind: "OWNER";
    action: "START";
  };
  input_versions: PipelineInputVersions;
  input_versions_digest: string;
  ownership: {
    state: "PIPELINE_ORCHESTRATOR";
    transitions: "PIPELINE_ORCHESTRATOR";
    authority: "PIPELINE_ORCHESTRATOR";
    persistence: "PIPELINE_ORCHESTRATOR";
  };
  authority: {
    external_write: "DENIED";
    external_write_operations: [];
    model: {
      state_write: false;
      transition: false;
      authority_grant: false;
      persistence: false;
      external_write: false;
    };
  };
  started_at: string;
  updated_at: string;
};

export interface PipelineRunStore {
  load(runId: string): Promise<PipelineRunState | null>;
  loadCurrent(ownerKey: string): Promise<PipelineRunState | null>;
  loadActive(ownerKey: string): Promise<PipelineRunState | null>;
  initialize(state: PipelineRunState): Promise<boolean>;
  compareAndSwap(runId: string, expectedVersion: number, state: PipelineRunState): Promise<boolean>;
}

export class PipelineOrchestratorError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PipelineOrchestratorError";
    this.code = code;
  }
}

function exactKeys(value: object, keys: string[]) {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function validText(value: unknown, maximum = 255): value is string {
  return typeof value === "string" && value.trim().length > 0 && value === value.trim() && value.length <= maximum;
}

function validVersionReference(value: unknown): value is PipelineVersionReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return exactKeys(candidate, ["schema_version", "revision_id", "digest"])
    && validText(candidate.schema_version)
    && validText(candidate.revision_id)
    && SHA256_DIGEST.test(String(candidate.digest));
}

export function assertPipelineInputVersions(value: unknown): asserts value is PipelineInputVersions {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PipelineOrchestratorError("PIPELINE_INPUT_VERSIONS_INVALID", "Pipeline input versions are required.");
  }
  const candidate = value as Record<string, unknown>;
  if (!exactKeys(candidate, [
    "schema_version",
    "historical_document",
    "business_input",
    "goal_revision",
    "analytics_evidence_snapshot",
    "campaign_strategy_revision",
    "campaign_pairs",
    "pipeline_policy",
    "campaign_playbook",
  ]) || candidate.schema_version !== PIPELINE_INPUT_VERSIONS_SCHEMA) {
    throw new PipelineOrchestratorError("PIPELINE_INPUT_VERSIONS_INVALID", "Pipeline input versions do not match the closed schema.");
  }
  const historical = candidate.historical_document;
  if (!historical || typeof historical !== "object" || Array.isArray(historical)
    || !exactKeys(historical, ["schema_version", "revision", "digest"])
    || !validText((historical as Record<string, unknown>).schema_version)
    || !Number.isSafeInteger((historical as Record<string, unknown>).revision)
    || Number((historical as Record<string, unknown>).revision) < 0
    || !SHA256_DIGEST.test(String((historical as Record<string, unknown>).digest))) {
    throw new PipelineOrchestratorError("PIPELINE_INPUT_VERSIONS_INVALID", "Historical document version is incomplete.");
  }
  for (const key of ["business_input", "pipeline_policy", "campaign_playbook"] as const) {
    if (!validVersionReference(candidate[key])) {
      throw new PipelineOrchestratorError("PIPELINE_INPUT_VERSIONS_INVALID", `${key} must identify one exact revision.`);
    }
  }
  for (const key of ["goal_revision", "analytics_evidence_snapshot", "campaign_strategy_revision"] as const) {
    if (candidate[key] !== null && !validVersionReference(candidate[key])) {
      throw new PipelineOrchestratorError("PIPELINE_INPUT_VERSIONS_INVALID", `${key} must be null or identify one exact revision.`);
    }
  }
  if (!Array.isArray(candidate.campaign_pairs) || candidate.campaign_pairs.some((pair) => {
    if (!pair || typeof pair !== "object" || Array.isArray(pair) || !exactKeys(pair, ["hypothesis", "draft"])) return true;
    const typed = pair as Record<string, unknown>;
    return !validVersionReference(typed.hypothesis) || !validVersionReference(typed.draft);
  })) {
    throw new PipelineOrchestratorError("PIPELINE_INPUT_VERSIONS_INVALID", "Campaign pairs must contain exact Hypothesis and Draft revisions.");
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]));
}

export async function pipelineDigest(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(result)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stageId(value: unknown): value is PipelineStageId {
  return PIPELINE_STAGES.some((stage) => stage.id === value);
}

function assertTransition(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PipelineOrchestratorError("PIPELINE_RUN_CORRUPT", "Pipeline transition is missing.");
  }
  const transition = value as PipelineTransition;
  if (!exactKeys(transition, ["kind", "source_stage", "target_stage", "reason_code", "reason", "recorded_at"])
    || !["START", "ADVANCE", "RETURN", "RETRY", "STOP", "COMPLETE"].includes(transition.kind)
    || (transition.source_stage !== null && !stageId(transition.source_stage))
    || (transition.target_stage !== null && !stageId(transition.target_stage))
    || !REASON_CODE.test(String(transition.reason_code))
    || !validText(transition.reason, 1_000)
    || !validText(transition.recorded_at)) {
    throw new PipelineOrchestratorError("PIPELINE_RUN_CORRUPT", "Pipeline transition metadata is invalid.");
  }
}

export function assertPipelineRunState(value: unknown): asserts value is PipelineRunState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PipelineOrchestratorError("PIPELINE_RUN_CORRUPT", "Pipeline run is not an object.");
  }
  const run = value as PipelineRunState;
  if (!exactKeys(run, [
    "schema_version",
    "contract",
    "run_id",
    "owner_key",
    "version",
    "status",
    "current_stage",
    "stage_attempt",
    "stages",
    "last_transition",
    "work_control",
    "initiator",
    "input_versions",
    "input_versions_digest",
    "ownership",
    "authority",
    "started_at",
    "updated_at",
  ])) {
    throw new PipelineOrchestratorError("PIPELINE_RUN_CORRUPT", "Pipeline run contains fields outside the closed schema.");
  }
  assertPipelineInputVersions(run.input_versions);
  assertTransition(run.last_transition);
  if (run.schema_version !== PIPELINE_RUN_SCHEMA
    || run.contract?.name !== PIPELINE_ORCHESTRATOR_CONTRACT
    || run.contract?.version !== PIPELINE_ORCHESTRATOR_VERSION
    || !IDENTIFIER.test(String(run.run_id))
    || !validText(run.owner_key)
    || !Number.isSafeInteger(run.version) || run.version < 0
    || !["ACTIVE", "STOPPED", "COMPLETED", "FAILED"].includes(run.status)
    || !stageId(run.current_stage)
    || !Number.isSafeInteger(run.stage_attempt) || run.stage_attempt < 1
    || !SHA256_DIGEST.test(String(run.input_versions_digest))
    || !validText(run.started_at) || !validText(run.updated_at)) {
    throw new PipelineOrchestratorError("PIPELINE_RUN_CORRUPT", "Pipeline run metadata is invalid.");
  }
  if (!Array.isArray(run.stages) || run.stages.length !== PIPELINE_STAGES.length
    || run.stages.some((stage, index) => !exactKeys(stage, ["id", "label", "status"])
      || stage.id !== PIPELINE_STAGES[index].id
      || stage.label !== PIPELINE_STAGES[index].label
      || !["PENDING", "ACTIVE", "COMPLETED", "RETURNED", "STOPPED"].includes(stage.status))) {
    throw new PipelineOrchestratorError("PIPELINE_RUN_CORRUPT", "Pipeline stages do not match the canonical path.");
  }
  const activeStages = run.stages.filter((stage) => stage.status === "ACTIVE");
  const stoppedStages = run.stages.filter((stage) => stage.status === "STOPPED");
  if ((run.status === "ACTIVE" && (activeStages.length !== 1 || activeStages[0].id !== run.current_stage))
    || (run.status !== "ACTIVE" && activeStages.length !== 0)
    || (run.status === "STOPPED" && (stoppedStages.length !== 1 || stoppedStages[0].id !== run.current_stage))
    || (run.status !== "STOPPED" && stoppedStages.length !== 0)
    || (run.status === "COMPLETED" && run.stages.some((stage) => stage.status !== "COMPLETED"))) {
    throw new PipelineOrchestratorError("PIPELINE_RUN_CORRUPT", "Pipeline run and stage statuses disagree.");
  }
  const expectedWorkControl = run.status === "ACTIVE"
    ? { issue_actions: true, cancellation: "NONE", unverified_output: "NEVER_PERSISTED" }
    : {
        issue_actions: false,
        cancellation: run.status === "STOPPED" ? "REQUESTED" : "NONE",
        unverified_output: "NEVER_PERSISTED",
      };
  if (!run.work_control || !exactKeys(run.work_control, ["issue_actions", "cancellation", "unverified_output"])
    || JSON.stringify(run.work_control) !== JSON.stringify(expectedWorkControl)) {
    throw new PipelineOrchestratorError("PIPELINE_RUN_CORRUPT", "Pipeline work control does not match the run status.");
  }
  if (!run.contract || !exactKeys(run.contract, ["name", "version"])
    || !run.initiator || !exactKeys(run.initiator, ["kind", "action"])
    || !run.ownership || !exactKeys(run.ownership, ["state", "transitions", "authority", "persistence"])
    || !run.authority || !exactKeys(run.authority, ["external_write", "external_write_operations", "model"])
    || !run.authority.model || !exactKeys(run.authority.model, ["state_write", "transition", "authority_grant", "persistence", "external_write"])
    || run.initiator?.kind !== "OWNER" || run.initiator?.action !== "START"
    || JSON.stringify(run.ownership) !== JSON.stringify({ state: "PIPELINE_ORCHESTRATOR", transitions: "PIPELINE_ORCHESTRATOR", authority: "PIPELINE_ORCHESTRATOR", persistence: "PIPELINE_ORCHESTRATOR" })
    || JSON.stringify(run.authority) !== JSON.stringify({ external_write: "DENIED", external_write_operations: [], model: { state_write: false, transition: false, authority_grant: false, persistence: false, external_write: false } })) {
    throw new PipelineOrchestratorError("PIPELINE_RUN_CORRUPT", "Pipeline ownership or authority was widened.");
  }
}

export async function verifyPipelineRunState(value: unknown): Promise<PipelineRunState> {
  assertPipelineRunState(value);
  if (await pipelineDigest(value.input_versions) !== value.input_versions_digest) {
    throw new PipelineOrchestratorError("PIPELINE_RUN_CORRUPT", "Pipeline input versions digest does not match the persisted inputs.");
  }
  return value;
}

function transitionReason(reasonCode: unknown, reason: unknown) {
  const code = String(reasonCode ?? "").trim();
  const message = String(reason ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!REASON_CODE.test(code) || !validText(message, 1_000)) {
    throw new PipelineOrchestratorError("PIPELINE_TRANSITION_REASON_INVALID", "A typed exact transition reason is required.");
  }
  return { reason_code: code, reason: message };
}

const RETURN_TARGETS: Record<PipelineReturnCause, PipelineStageId> = {
  GOAL_CONFLICT: "CAMPAIGN_GOAL",
  EVIDENCE_REQUEST: "EVIDENCE_COLLECTION",
  STRATEGY_DEFECT: "STRATEGY",
};

export class PipelineOrchestrator {
  private readonly store: PipelineRunStore;
  private readonly now: () => string;
  private readonly newRunId: () => string;

  constructor(input: {
    store: PipelineRunStore;
    now?: () => string;
    newRunId?: () => string;
  }) {
    this.store = input.store;
    this.now = input.now ?? (() => new Date().toISOString());
    this.newRunId = input.newRunId ?? (() => `pipeline-${crypto.randomUUID()}`);
  }

  async current(ownerKey: string) {
    const state = await this.store.loadCurrent(ownerKey);
    if (state) await verifyPipelineRunState(state);
    return state ? clone(state) : null;
  }

  async start(ownerKey: string, inputVersions: PipelineInputVersions) {
    if (!validText(ownerKey)) {
      throw new PipelineOrchestratorError("PIPELINE_OWNER_INVALID", "Pipeline owner key is required.");
    }
    assertPipelineInputVersions(inputVersions);
    if (await this.store.loadActive(ownerKey)) {
      throw new PipelineOrchestratorError("PIPELINE_RUN_ALREADY_ACTIVE", "Stop the active pipeline run before starting a new one.");
    }

    const frozenInputs = clone(inputVersions);
    const inputVersionsDigest = await pipelineDigest(frozenInputs);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const runId = this.newRunId();
      const timestamp = this.now();
      const state: PipelineRunState = {
        schema_version: PIPELINE_RUN_SCHEMA,
        contract: { name: PIPELINE_ORCHESTRATOR_CONTRACT, version: PIPELINE_ORCHESTRATOR_VERSION },
        run_id: runId,
        owner_key: ownerKey,
        version: 0,
        status: "ACTIVE",
        current_stage: "CAMPAIGN_GOAL",
        stage_attempt: 1,
        stages: PIPELINE_STAGES.map((stage, index) => ({ ...stage, status: index === 0 ? "ACTIVE" : "PENDING" })),
        last_transition: {
          kind: "START",
          source_stage: null,
          target_stage: "CAMPAIGN_GOAL",
          reason_code: "OWNER_START",
          reason: "Владелец запустил новый путь подготовки кампаний.",
          recorded_at: timestamp,
        },
        work_control: { issue_actions: true, cancellation: "NONE", unverified_output: "NEVER_PERSISTED" },
        initiator: { kind: "OWNER", action: "START" },
        input_versions: frozenInputs,
        input_versions_digest: inputVersionsDigest,
        ownership: { state: "PIPELINE_ORCHESTRATOR", transitions: "PIPELINE_ORCHESTRATOR", authority: "PIPELINE_ORCHESTRATOR", persistence: "PIPELINE_ORCHESTRATOR" },
        authority: {
          external_write: "DENIED",
          external_write_operations: [],
          model: { state_write: false, transition: false, authority_grant: false, persistence: false, external_write: false },
        },
        started_at: timestamp,
        updated_at: timestamp,
      };
      await verifyPipelineRunState(state);
      if (await this.store.initialize(state)) return clone(state);
      if (await this.store.loadActive(ownerKey)) {
        throw new PipelineOrchestratorError("PIPELINE_RUN_ALREADY_ACTIVE", "Another start action created the active pipeline run.");
      }
    }
    throw new PipelineOrchestratorError("PIPELINE_RUN_ID_CONFLICT", "A unique pipeline run ID could not be allocated.");
  }

  async stop(input: {
    run_id: string;
    expected_version: number;
    reason_code?: string;
    reason?: string;
  }) {
    const current = await this.activeRun(input.run_id, input.expected_version);
    const timestamp = this.now();
    const typedReason = transitionReason(
      input.reason_code ?? "OWNER_STOP",
      input.reason ?? "Владелец остановил активный путь до внешней записи.",
    );
    const next = clone(current);
    next.version += 1;
    next.status = "STOPPED";
    next.stages = next.stages.map((stage) => stage.id === current.current_stage ? { ...stage, status: "STOPPED" } : stage);
    next.last_transition = {
      kind: "STOP",
      source_stage: current.current_stage,
      target_stage: null,
      ...typedReason,
      recorded_at: timestamp,
    };
    next.work_control = { issue_actions: false, cancellation: "REQUESTED", unverified_output: "NEVER_PERSISTED" };
    next.updated_at = timestamp;
    return this.persist(current, next);
  }

  async advance(input: {
    run_id: string;
    expected_version: number;
    source_stage: PipelineStageId;
    reason_code: string;
    reason: string;
  }) {
    const current = await this.activeRun(input.run_id, input.expected_version, input.source_stage);
    const typedReason = transitionReason(input.reason_code, input.reason);
    const sourceIndex = PIPELINE_STAGES.findIndex((stage) => stage.id === current.current_stage);
    const timestamp = this.now();
    const next = clone(current);
    next.version += 1;
    next.stage_attempt = 1;
    next.updated_at = timestamp;
    if (sourceIndex === PIPELINE_STAGES.length - 1) {
      next.status = "COMPLETED";
      next.stages = next.stages.map((stage) => ({ ...stage, status: "COMPLETED" }));
      next.last_transition = {
        kind: "COMPLETE",
        source_stage: current.current_stage,
        target_stage: null,
        ...typedReason,
        recorded_at: timestamp,
      };
      next.work_control = { issue_actions: false, cancellation: "NONE", unverified_output: "NEVER_PERSISTED" };
      return this.persist(current, next);
    }
    const target = PIPELINE_STAGES[sourceIndex + 1].id;
    next.current_stage = target;
    next.stages = next.stages.map((stage, index) => ({
      ...stage,
      status: index <= sourceIndex
        ? "COMPLETED"
        : index === sourceIndex + 1
          ? "ACTIVE"
          : stage.status === "RETURNED"
            ? "RETURNED"
            : "PENDING",
    }));
    next.last_transition = {
      kind: "ADVANCE",
      source_stage: current.current_stage,
      target_stage: target,
      ...typedReason,
      recorded_at: timestamp,
    };
    return this.persist(current, next);
  }

  async returnTo(input: {
    run_id: string;
    expected_version: number;
    source_stage: PipelineStageId;
    cause: PipelineReturnCause;
    reason: string;
  }) {
    const current = await this.activeRun(input.run_id, input.expected_version, input.source_stage);
    const target = RETURN_TARGETS[input.cause];
    if (!target) {
      throw new PipelineOrchestratorError("PIPELINE_RETURN_CAUSE_INVALID", "The return cause is not supported by the deterministic transition table.");
    }
    const sourceIndex = PIPELINE_STAGES.findIndex((stage) => stage.id === current.current_stage);
    const targetIndex = PIPELINE_STAGES.findIndex((stage) => stage.id === target);
    if (targetIndex >= sourceIndex) {
      throw new PipelineOrchestratorError("PIPELINE_RETURN_INVALID", "A pipeline return must target an earlier canonical stage.");
    }
    const typedReason = transitionReason(input.cause, input.reason);
    const timestamp = this.now();
    const next = clone(current);
    next.version += 1;
    next.current_stage = target;
    next.stage_attempt = 1;
    next.stages = next.stages.map((stage, index) => ({
      ...stage,
      status: index < targetIndex
        ? "COMPLETED"
        : index === targetIndex
          ? "ACTIVE"
          : index === sourceIndex
            ? "RETURNED"
            : "PENDING",
    }));
    next.last_transition = {
      kind: "RETURN",
      source_stage: current.current_stage,
      target_stage: target,
      ...typedReason,
      recorded_at: timestamp,
    };
    next.updated_at = timestamp;
    return this.persist(current, next);
  }

  async retry(input: {
    run_id: string;
    expected_version: number;
    source_stage: PipelineStageId;
    reason_code: string;
    reason: string;
  }) {
    const current = await this.activeRun(input.run_id, input.expected_version, input.source_stage);
    const typedReason = transitionReason(input.reason_code, input.reason);
    const timestamp = this.now();
    const next = clone(current);
    next.version += 1;
    next.stage_attempt += 1;
    next.last_transition = {
      kind: "RETRY",
      source_stage: current.current_stage,
      target_stage: current.current_stage,
      ...typedReason,
      recorded_at: timestamp,
    };
    next.updated_at = timestamp;
    return this.persist(current, next);
  }

  private async activeRun(runId: string, expectedVersion: number, sourceStage?: PipelineStageId) {
    const current = await this.store.load(runId);
    if (!current) throw new PipelineOrchestratorError("PIPELINE_RUN_NOT_FOUND", "Pipeline run was not found.");
    await verifyPipelineRunState(current);
    if (current.status !== "ACTIVE" || !current.work_control.issue_actions) {
      throw new PipelineOrchestratorError("PIPELINE_RUN_NOT_ACTIVE", "Stopped or terminal pipeline runs cannot issue or accept work.");
    }
    if (current.version !== expectedVersion) {
      throw new PipelineOrchestratorError("PIPELINE_RUN_STALE", "Pipeline run changed before this action could be committed.");
    }
    if (sourceStage !== undefined && current.current_stage !== sourceStage) {
      throw new PipelineOrchestratorError("PIPELINE_STAGE_STALE", "The result does not belong to the current pipeline stage.");
    }
    return current;
  }

  private async persist(current: PipelineRunState, next: PipelineRunState) {
    await verifyPipelineRunState(next);
    if (!await this.store.compareAndSwap(current.run_id, current.version, next)) {
      throw new PipelineOrchestratorError("PIPELINE_RUN_STALE", "Another deterministic transition won the compare-and-swap.");
    }
    return clone(next);
  }
}

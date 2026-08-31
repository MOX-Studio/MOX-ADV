import {
  assertCampaignPairValidationResult,
  type CampaignPairValidationResult,
} from "./campaign-pair-validation.ts";
import {
  verifyGoalCandidate,
  verifyGoalFormationResult,
  type GoalCandidate,
  type GoalFormationResult,
  type GoalInputReference,
} from "./goal-revision.ts";

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u;
const REASON_CODE = /^[A-Z][A-Z0-9_]{1,79}$/u;

export const PIPELINE_ORCHESTRATOR_CONTRACT = "mox-adv.p0.pipeline-orchestrator";
export const PIPELINE_ORCHESTRATOR_VERSION = "1.2.0";
export const PIPELINE_RUN_SCHEMA = "p0-pipeline-run-v1";
export const PIPELINE_INPUT_VERSIONS_SCHEMA = "p0-pipeline-input-versions-v2";
export const PIPELINE_AUDIT_EVENT_SCHEMA = "p0-pipeline-audit-event-v1";

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
export type PipelineAuditEventKind = "RUN_STARTED" | "STAGE_VERIFIED" | "ATTEMPT_DISCARDED" | "RUN_STOPPED" | "RUN_COMPLETED";

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
  campaign_pair_checks: CampaignPairValidationResult;
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

export type PipelineAuditActor = {
  actor_id: string;
  actor_type: "OWNER" | "AGENT" | "DETERMINISTIC_SERVICE";
  role: string;
};

export type PipelineAuditCheck = {
  check_id: string;
  status: "PASSED" | "FAILED";
  policy: PipelineVersionReference;
};

export type PipelineVerifiedAttempt = {
  actor: PipelineAuditActor;
  inputs: PipelineVersionReference[];
  evidence: PipelineVersionReference[];
  output: PipelineVersionReference;
  checks: PipelineAuditCheck[];
  schemas: PipelineVersionReference[];
  policies: PipelineVersionReference[];
  campaign_playbook: PipelineVersionReference;
};

export type PipelineDiscardedAttempt = Omit<PipelineVerifiedAttempt, "output"> & {
  output: PipelineVersionReference | null;
};

export type PipelineAuditEvent = {
  schema_version: typeof PIPELINE_AUDIT_EVENT_SCHEMA;
  run_id: string;
  sequence: number;
  run_version: number;
  event_kind: PipelineAuditEventKind;
  stage: PipelineStageId;
  attempt: number;
  actor: PipelineAuditActor;
  input_versions_digest: string;
  inputs: PipelineVersionReference[];
  evidence: PipelineVersionReference[];
  output: {
    status: "NONE" | "VERIFIED" | "DISCARDED";
    reference: PipelineVersionReference | null;
  };
  checks: PipelineAuditCheck[];
  schemas: PipelineVersionReference[];
  policies: PipelineVersionReference[];
  campaign_playbook: PipelineVersionReference;
  retry: { next_attempt: number } | null;
  return: { target_stage: PipelineStageId } | null;
  handoff: { target_stage: PipelineStageId } | null;
  current_product_link: PipelineVersionReference | null;
  reason_code: string;
  recorded_at: string;
  previous_event_digest: string | null;
  event_digest: string;
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
  goal_formation: { status: "PENDING" } | GoalFormationResult;
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
  loadAudit(runId: string): Promise<PipelineAuditEvent[]>;
  initialize(state: PipelineRunState, event: PipelineAuditEvent): Promise<boolean>;
  compareAndSwap(runId: string, expectedVersion: number, state: PipelineRunState, event: PipelineAuditEvent): Promise<boolean>;
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
    "campaign_pair_checks",
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
  try {
    assertCampaignPairValidationResult(candidate.campaign_pair_checks);
  } catch {
    throw new PipelineOrchestratorError("PIPELINE_INPUT_VERSIONS_INVALID", "Campaign pair checks must contain the authoritative typed validation result.");
  }
  const includedChecks = candidate.campaign_pair_checks.pairs.filter((pair) => pair.included);
  if (includedChecks.length !== candidate.campaign_pairs.length
    || candidate.campaign_pairs.some((pair, index) => pair.hypothesis.revision_id !== includedChecks[index].hypothesis_revision_id
      || pair.draft.revision_id !== includedChecks[index].draft_revision_id)) {
    throw new PipelineOrchestratorError("PIPELINE_INPUT_VERSIONS_INVALID", "Only automatically verified Campaign pairs may enter the current pipeline contract.");
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

function sameReference(left: PipelineVersionReference, right: PipelineVersionReference) {
  return left.schema_version === right.schema_version
    && left.revision_id === right.revision_id
    && left.digest === right.digest;
}

function validActor(value: unknown): value is PipelineAuditActor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actor = value as Record<string, unknown>;
  return exactKeys(actor, ["actor_id", "actor_type", "role"])
    && IDENTIFIER.test(String(actor.actor_id))
    && ["OWNER", "AGENT", "DETERMINISTIC_SERVICE"].includes(String(actor.actor_type))
    && REASON_CODE.test(String(actor.role));
}

function validReferences(value: unknown, minimum = 0): value is PipelineVersionReference[] {
  return Array.isArray(value) && value.length >= minimum && value.every(validVersionReference);
}

function validChecks(value: unknown, minimum = 0): value is PipelineAuditCheck[] {
  return Array.isArray(value) && value.length >= minimum && value.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const check = item as Record<string, unknown>;
    return exactKeys(check, ["check_id", "status", "policy"])
      && REASON_CODE.test(String(check.check_id))
      && ["PASSED", "FAILED"].includes(String(check.status))
      && validVersionReference(check.policy);
  });
}

function assertVerifiedAttempt(attempt: PipelineVerifiedAttempt, inputs: PipelineInputVersions) {
  if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)
    || !exactKeys(attempt, ["actor", "inputs", "evidence", "output", "checks", "schemas", "policies", "campaign_playbook"])
    || !validActor(attempt.actor)
    || !validReferences(attempt.inputs, 1)
    || !validReferences(attempt.evidence, 1)
    || !validVersionReference(attempt.output)
    || !validChecks(attempt.checks, 1)
    || attempt.checks.some((check) => check.status !== "PASSED")
    || !validReferences(attempt.schemas, 1)
    || !validReferences(attempt.policies, 1)
    || !validVersionReference(attempt.campaign_playbook)
    || !attempt.policies.some((policy) => sameReference(policy, inputs.pipeline_policy))
    || !sameReference(attempt.campaign_playbook, inputs.campaign_playbook)) {
    throw new PipelineOrchestratorError("PIPELINE_VERIFIED_ATTEMPT_INVALID", "A verified output requires typed inputs, evidence, passed checks, schemas, policy, and Campaign Playbook bindings.");
  }
}

function assertDiscardedAttempt(attempt: PipelineDiscardedAttempt, inputs: PipelineInputVersions) {
  if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)
    || !exactKeys(attempt, ["actor", "inputs", "evidence", "output", "checks", "schemas", "policies", "campaign_playbook"])
    || !validActor(attempt.actor)
    || !validReferences(attempt.inputs)
    || !validReferences(attempt.evidence)
    || (attempt.output !== null && !validVersionReference(attempt.output))
    || !validChecks(attempt.checks)
    || !validReferences(attempt.schemas)
    || !validReferences(attempt.policies)
    || !validVersionReference(attempt.campaign_playbook)
    || !sameReference(attempt.campaign_playbook, inputs.campaign_playbook)) {
    throw new PipelineOrchestratorError("PIPELINE_DISCARDED_ATTEMPT_INVALID", "A discarded attempt may persist only typed sanitized provenance metadata.");
  }
}

export async function verifyPipelineAuditTrail(events: unknown, run?: PipelineRunState): Promise<PipelineAuditEvent[]> {
  if (!Array.isArray(events)) {
    throw new PipelineOrchestratorError("PIPELINE_AUDIT_CORRUPT", "Pipeline audit trail is not an array.");
  }
  let previousDigest: string | null = null;
  for (let index = 0; index < events.length; index += 1) {
    const value = events[index];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new PipelineOrchestratorError("PIPELINE_AUDIT_CORRUPT", "Pipeline audit event is not an object.");
    }
    const event = value as PipelineAuditEvent;
    if (!exactKeys(event, [
      "schema_version", "run_id", "sequence", "run_version", "event_kind", "stage", "attempt", "actor",
      "input_versions_digest", "inputs", "evidence", "output", "checks", "schemas", "policies", "campaign_playbook",
      "retry", "return", "handoff", "current_product_link", "reason_code", "recorded_at", "previous_event_digest", "event_digest",
    ])
      || event.schema_version !== PIPELINE_AUDIT_EVENT_SCHEMA
      || !IDENTIFIER.test(String(event.run_id))
      || event.sequence !== index || event.run_version !== index
      || !["RUN_STARTED", "STAGE_VERIFIED", "ATTEMPT_DISCARDED", "RUN_STOPPED", "RUN_COMPLETED"].includes(event.event_kind)
      || !stageId(event.stage)
      || !Number.isSafeInteger(event.attempt) || event.attempt < 1
      || !validActor(event.actor)
      || !SHA256_DIGEST.test(String(event.input_versions_digest))
      || !validReferences(event.inputs) || !validReferences(event.evidence)
      || !event.output || !exactKeys(event.output, ["status", "reference"])
      || !["NONE", "VERIFIED", "DISCARDED"].includes(event.output.status)
      || (event.output.reference !== null && !validVersionReference(event.output.reference))
      || !validChecks(event.checks) || !validReferences(event.schemas) || !validReferences(event.policies)
      || !validVersionReference(event.campaign_playbook)
      || (event.retry !== null && (!exactKeys(event.retry, ["next_attempt"]) || !Number.isSafeInteger(event.retry.next_attempt) || event.retry.next_attempt <= event.attempt))
      || (event.return !== null && (!exactKeys(event.return, ["target_stage"]) || !stageId(event.return.target_stage)))
      || (event.handoff !== null && (!exactKeys(event.handoff, ["target_stage"]) || !stageId(event.handoff.target_stage)))
      || (event.current_product_link !== null && !validVersionReference(event.current_product_link))
      || !REASON_CODE.test(String(event.reason_code))
      || !validText(event.recorded_at)
      || event.previous_event_digest !== previousDigest
      || !SHA256_DIGEST.test(String(event.event_digest))) {
      throw new PipelineOrchestratorError("PIPELINE_AUDIT_CORRUPT", "Pipeline audit event violates the closed sanitized schema.");
    }
    if (["STAGE_VERIFIED", "RUN_COMPLETED"].includes(event.event_kind)) {
      if (event.output.status !== "VERIFIED" || event.output.reference === null || event.current_product_link === null
        || !sameReference(event.output.reference, event.current_product_link)
        || event.inputs.length === 0 || event.evidence.length === 0 || event.checks.length === 0
        || event.checks.some((check) => check.status !== "PASSED") || event.schemas.length === 0 || event.policies.length === 0) {
        throw new PipelineOrchestratorError("PIPELINE_AUDIT_CORRUPT", "Verified audit output is missing reproducibility bindings.");
      }
    } else if (event.current_product_link !== null) {
      throw new PipelineOrchestratorError("PIPELINE_AUDIT_CORRUPT", "Only a verified output may receive a current product link.");
    }
    if (event.event_kind === "RUN_STARTED"
      && (event.sequence !== 0 || event.output.status !== "NONE" || event.handoff?.target_stage !== event.stage
        || event.retry !== null || event.return !== null)) {
      throw new PipelineOrchestratorError("PIPELINE_AUDIT_CORRUPT", "Pipeline start provenance is inconsistent.");
    }
    if (event.event_kind === "STAGE_VERIFIED" && event.handoff === null) {
      throw new PipelineOrchestratorError("PIPELINE_AUDIT_CORRUPT", "A verified stage must record its handoff.");
    }
    if (event.event_kind === "RUN_COMPLETED" && (event.handoff !== null || event.retry !== null || event.return !== null)) {
      throw new PipelineOrchestratorError("PIPELINE_AUDIT_CORRUPT", "Completed run provenance cannot transfer more work.");
    }
    if (event.event_kind === "ATTEMPT_DISCARDED"
      && (event.output.status !== "DISCARDED" || Number(event.retry !== null) + Number(event.return !== null) !== 1
        || event.handoff !== null)) {
      throw new PipelineOrchestratorError("PIPELINE_AUDIT_CORRUPT", "An unverified attempt must be discarded as one retry or return.");
    }
    if (event.event_kind === "RUN_STOPPED"
      && (event.output.status !== "NONE" || event.retry !== null || event.return !== null || event.handoff !== null)) {
      throw new PipelineOrchestratorError("PIPELINE_AUDIT_CORRUPT", "Stopped run provenance cannot retain or transfer output.");
    }
    const unsigned = Object.fromEntries(Object.entries(event).filter(([key]) => key !== "event_digest"));
    if (await pipelineDigest(unsigned) !== event.event_digest) {
      throw new PipelineOrchestratorError("PIPELINE_AUDIT_CORRUPT", "Pipeline audit digest chain does not verify.");
    }
    if (run && (event.run_id !== run.run_id
      || event.input_versions_digest !== run.input_versions_digest
      || !sameReference(event.campaign_playbook, run.input_versions.campaign_playbook)
      || (["STAGE_VERIFIED", "RUN_COMPLETED"].includes(event.event_kind)
        && !event.policies.some((policy) => sameReference(policy, run.input_versions.pipeline_policy))))) {
      throw new PipelineOrchestratorError("PIPELINE_AUDIT_CORRUPT", "Pipeline audit event is not bound to the persisted run inputs.");
    }
    previousDigest = event.event_digest;
  }
  if (run && (events.length !== run.version + 1 || events.at(-1)?.run_version !== run.version)) {
    throw new PipelineOrchestratorError("PIPELINE_AUDIT_CORRUPT", "Pipeline state does not have one immutable audit event per revision.");
  }
  return events as PipelineAuditEvent[];
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
    "goal_formation",
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
  if (!run.goal_formation || typeof run.goal_formation !== "object"
    || (run.goal_formation.status === "PENDING" && !exactKeys(run.goal_formation, ["status"]))
    || !["PENDING", "VERIFIED", "MATERIAL_DECISION_REQUIRED"].includes(run.goal_formation.status)) {
    throw new PipelineOrchestratorError("PIPELINE_RUN_CORRUPT", "Pipeline Goal formation state is invalid.");
  }
  const currentStageIndex = PIPELINE_STAGES.findIndex((stage) => stage.id === run.current_stage);
  if (currentStageIndex > 0 && run.goal_formation.status !== "VERIFIED") {
    throw new PipelineOrchestratorError("PIPELINE_RUN_CORRUPT", "A pipeline cannot pass Campaign Goal without a verified GoalRevision.");
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
  if (value.goal_formation.status !== "PENDING") {
    try {
      await verifyGoalFormationResult(value.goal_formation);
    } catch (error) {
      throw new PipelineOrchestratorError("PIPELINE_RUN_CORRUPT", error instanceof Error ? error.message : "Pipeline Goal result is invalid.");
    }
  }
  return value;
}

export function pipelineGoalInputReferences(input: PipelineInputVersions): GoalInputReference[] {
  const references: GoalInputReference[] = [{
    input_id: "historical_document",
    schema_version: input.historical_document.schema_version,
    revision_id: `historical-document:${input.historical_document.revision}`,
    digest: input.historical_document.digest,
  }, {
    input_id: "business_input",
    ...input.business_input,
  }];
  if (input.goal_revision) references.push({ input_id: "priority_goal_revision", ...input.goal_revision });
  return references;
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

type AuditEventValues = {
  event_kind: PipelineAuditEventKind;
  stage: PipelineStageId;
  attempt: number;
  actor: PipelineAuditActor;
  inputs?: PipelineVersionReference[];
  evidence?: PipelineVersionReference[];
  output?: PipelineAuditEvent["output"];
  checks?: PipelineAuditCheck[];
  schemas?: PipelineVersionReference[];
  policies?: PipelineVersionReference[];
  retry?: PipelineAuditEvent["retry"];
  return?: PipelineAuditEvent["return"];
  handoff?: PipelineAuditEvent["handoff"];
  current_product_link?: PipelineVersionReference | null;
  reason_code: string;
};

async function sealAuditEvent(input: {
  run: PipelineRunState;
  sequence: number;
  recorded_at: string;
  previous_event_digest: string | null;
  values: AuditEventValues;
}): Promise<PipelineAuditEvent> {
  const eventWithoutDigest: Omit<PipelineAuditEvent, "event_digest"> = {
    schema_version: PIPELINE_AUDIT_EVENT_SCHEMA,
    run_id: input.run.run_id,
    sequence: input.sequence,
    run_version: input.sequence,
    event_kind: input.values.event_kind,
    stage: input.values.stage,
    attempt: input.values.attempt,
    actor: clone(input.values.actor),
    input_versions_digest: input.run.input_versions_digest,
    inputs: clone(input.values.inputs ?? []),
    evidence: clone(input.values.evidence ?? []),
    output: clone(input.values.output ?? { status: "NONE", reference: null }),
    checks: clone(input.values.checks ?? []),
    schemas: clone(input.values.schemas ?? []),
    policies: clone(input.values.policies ?? []),
    campaign_playbook: clone(input.run.input_versions.campaign_playbook),
    retry: clone(input.values.retry ?? null),
    return: clone(input.values.return ?? null),
    handoff: clone(input.values.handoff ?? null),
    current_product_link: clone(input.values.current_product_link ?? null),
    reason_code: input.values.reason_code,
    recorded_at: input.recorded_at,
    previous_event_digest: input.previous_event_digest,
  };
  return {
    ...eventWithoutDigest,
    event_digest: await pipelineDigest(eventWithoutDigest),
  };
}

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

  async audit(runId: string) {
    const state = await this.store.load(runId);
    if (!state) throw new PipelineOrchestratorError("PIPELINE_RUN_NOT_FOUND", "Pipeline run was not found.");
    const events = await this.store.loadAudit(runId);
    await verifyPipelineAuditTrail(events, state);
    return clone(events);
  }

  async start(ownerKey: string, inputVersions: PipelineInputVersions) {
    if (!IDENTIFIER.test(ownerKey)) {
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
        goal_formation: { status: "PENDING" },
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
      const event = await sealAuditEvent({
        run: state,
        sequence: 0,
        recorded_at: timestamp,
        previous_event_digest: null,
        values: {
          event_kind: "RUN_STARTED",
          stage: "CAMPAIGN_GOAL",
          attempt: 1,
          actor: { actor_id: ownerKey, actor_type: "OWNER", role: "PIPELINE_OWNER" },
          handoff: { target_stage: "CAMPAIGN_GOAL" },
          reason_code: "OWNER_START",
        },
      });
      await verifyPipelineAuditTrail([event], state);
      if (await this.store.initialize(state, event)) return clone(state);
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
    return this.persist(current, next, {
      event_kind: "RUN_STOPPED",
      stage: current.current_stage,
      attempt: current.stage_attempt,
      actor: { actor_id: current.owner_key, actor_type: "OWNER", role: "PIPELINE_OWNER" },
      reason_code: typedReason.reason_code,
    });
  }

  async recordGoalCandidate(input: {
    run_id: string;
    expected_version: number;
    candidate: GoalCandidate;
  }) {
    const current = await this.activeRun(input.run_id, input.expected_version, "CAMPAIGN_GOAL");
    const timestamp = this.now();
    const result = await verifyGoalCandidate({
      candidate: input.candidate,
      exact_inputs: pipelineGoalInputReferences(current.input_versions),
      verified_at: timestamp,
    });
    const next = clone(current);
    next.version += 1;
    next.goal_formation = result;
    next.updated_at = timestamp;
    const exactInputs = pipelineGoalInputReferences(current.input_versions).map((reference) => ({
      schema_version: reference.schema_version,
      revision_id: reference.revision_id,
      digest: reference.digest,
    }));
    const goalSchema = {
      schema_version: "p0-goal-revision-contract",
      revision_id: "1.0.0",
      digest: await pipelineDigest({ schema_version: "p0-goal-revision-v1", contract_version: "1.0.0" }),
    };
    const actor: PipelineAuditActor = {
      actor_id: "goal-revision-verifier",
      actor_type: "DETERMINISTIC_SERVICE",
      role: "GOAL_VALIDATOR",
    };
    if (result.status === "MATERIAL_DECISION_REQUIRED") {
      next.stage_attempt += 1;
      next.last_transition = {
        kind: "RETRY",
        source_stage: "CAMPAIGN_GOAL",
        target_stage: "CAMPAIGN_GOAL",
        reason_code: "GOAL_MATERIAL_AMBIGUITY",
        reason: result.reason,
        recorded_at: timestamp,
      };
      const discardedDecision = {
        schema_version: "p0-goal-material-decision-v1",
        revision_id: `${current.run_id}:goal-attempt:${current.stage_attempt}`,
        digest: await pipelineDigest(result),
      };
      return this.persist(current, next, {
        event_kind: "ATTEMPT_DISCARDED",
        stage: "CAMPAIGN_GOAL",
        attempt: current.stage_attempt,
        actor,
        inputs: exactInputs,
        evidence: exactInputs,
        output: { status: "DISCARDED", reference: discardedDecision },
        checks: [{ check_id: "GOAL_MATERIAL_AMBIGUITY", status: "FAILED", policy: current.input_versions.pipeline_policy }],
        schemas: [goalSchema],
        policies: [current.input_versions.pipeline_policy],
        retry: { next_attempt: next.stage_attempt },
        reason_code: "GOAL_MATERIAL_AMBIGUITY",
      });
    }
    next.current_stage = "EVIDENCE_COLLECTION";
    next.stage_attempt = 1;
    next.stages = next.stages.map((stage, index) => ({
      ...stage,
      status: index === 0 ? "COMPLETED" : index === 1 ? "ACTIVE" : "PENDING",
    }));
    next.last_transition = {
      kind: "ADVANCE",
      source_stage: "CAMPAIGN_GOAL",
      target_stage: "EVIDENCE_COLLECTION",
      reason_code: "GOAL_VERIFIED",
      reason: "Полная GoalRevision прошла детерминированную проверку.",
      recorded_at: timestamp,
    };
    const goalRevision = {
      schema_version: result.revision.schema_version,
      revision_id: result.revision.goal_revision_id,
      digest: result.revision.digest,
    };
    return this.persist(current, next, {
      event_kind: "STAGE_VERIFIED",
      stage: "CAMPAIGN_GOAL",
      attempt: current.stage_attempt,
      actor,
      inputs: exactInputs,
      evidence: exactInputs,
      output: { status: "VERIFIED", reference: goalRevision },
      checks: [{ check_id: "GOAL_REVISION_VERIFIED", status: "PASSED", policy: current.input_versions.pipeline_policy }],
      schemas: [goalSchema],
      policies: [current.input_versions.pipeline_policy],
      handoff: { target_stage: "EVIDENCE_COLLECTION" },
      current_product_link: goalRevision,
      reason_code: "GOAL_VERIFIED",
    });
  }

  async advance(input: {
    run_id: string;
    expected_version: number;
    source_stage: PipelineStageId;
    reason_code: string;
    reason: string;
    attempt: PipelineVerifiedAttempt;
  }) {
    const current = await this.activeRun(input.run_id, input.expected_version, input.source_stage);
    if (current.current_stage === "CAMPAIGN_GOAL") {
      throw new PipelineOrchestratorError("PIPELINE_GOAL_RESULT_REQUIRED", "Campaign Goal advances only through a verified Goal Agent candidate.");
    }
    const typedReason = transitionReason(input.reason_code, input.reason);
    assertVerifiedAttempt(input.attempt, current.input_versions);
    const sourceIndex = PIPELINE_STAGES.findIndex((stage) => stage.id === current.current_stage);
    const timestamp = this.now();
    const next = clone(current);
    next.version += 1;
    next.stage_attempt = 1;
    next.updated_at = timestamp;
    // A successful base run hands complete Drafts to publication review; review is
    // deliberately outside the run so it cannot acquire publication authority.
    if (sourceIndex >= PIPELINE_STAGES.length - 2) {
      const target = sourceIndex === PIPELINE_STAGES.length - 2
        ? "PUBLICATION_REVIEW"
        : null;
      next.status = "COMPLETED";
      next.current_stage = "PUBLICATION_REVIEW";
      next.stages = next.stages.map((stage) => ({ ...stage, status: "COMPLETED" }));
      next.last_transition = {
        kind: "COMPLETE",
        source_stage: current.current_stage,
        target_stage: target,
        ...typedReason,
        recorded_at: timestamp,
      };
      next.work_control = { issue_actions: false, cancellation: "NONE", unverified_output: "NEVER_PERSISTED" };
      return this.persist(current, next, {
        event_kind: "RUN_COMPLETED",
        stage: current.current_stage,
        attempt: current.stage_attempt,
        actor: input.attempt.actor,
        inputs: input.attempt.inputs,
        evidence: input.attempt.evidence,
        output: { status: "VERIFIED", reference: input.attempt.output },
        checks: input.attempt.checks,
        schemas: input.attempt.schemas,
        policies: input.attempt.policies,
        current_product_link: input.attempt.output,
        reason_code: typedReason.reason_code,
      });
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
    return this.persist(current, next, {
      event_kind: "STAGE_VERIFIED",
      stage: current.current_stage,
      attempt: current.stage_attempt,
      actor: input.attempt.actor,
      inputs: input.attempt.inputs,
      evidence: input.attempt.evidence,
      output: { status: "VERIFIED", reference: input.attempt.output },
      checks: input.attempt.checks,
      schemas: input.attempt.schemas,
      policies: input.attempt.policies,
      handoff: { target_stage: target },
      current_product_link: input.attempt.output,
      reason_code: typedReason.reason_code,
    });
  }

  async returnTo(input: {
    run_id: string;
    expected_version: number;
    source_stage: PipelineStageId;
    cause: PipelineReturnCause;
    reason: string;
    attempt: PipelineDiscardedAttempt;
  }) {
    const current = await this.activeRun(input.run_id, input.expected_version, input.source_stage);
    assertDiscardedAttempt(input.attempt, current.input_versions);
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
    return this.persist(current, next, {
      event_kind: "ATTEMPT_DISCARDED",
      stage: current.current_stage,
      attempt: current.stage_attempt,
      actor: input.attempt.actor,
      inputs: input.attempt.inputs,
      evidence: input.attempt.evidence,
      output: { status: "DISCARDED", reference: input.attempt.output },
      checks: input.attempt.checks,
      schemas: input.attempt.schemas,
      policies: input.attempt.policies,
      return: { target_stage: target },
      reason_code: typedReason.reason_code,
    });
  }

  async retry(input: {
    run_id: string;
    expected_version: number;
    source_stage: PipelineStageId;
    reason_code: string;
    reason: string;
    attempt: PipelineDiscardedAttempt;
  }) {
    const current = await this.activeRun(input.run_id, input.expected_version, input.source_stage);
    const typedReason = transitionReason(input.reason_code, input.reason);
    assertDiscardedAttempt(input.attempt, current.input_versions);
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
    return this.persist(current, next, {
      event_kind: "ATTEMPT_DISCARDED",
      stage: current.current_stage,
      attempt: current.stage_attempt,
      actor: input.attempt.actor,
      inputs: input.attempt.inputs,
      evidence: input.attempt.evidence,
      output: { status: "DISCARDED", reference: input.attempt.output },
      checks: input.attempt.checks,
      schemas: input.attempt.schemas,
      policies: input.attempt.policies,
      retry: { next_attempt: next.stage_attempt },
      reason_code: typedReason.reason_code,
    });
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

  private async persist(current: PipelineRunState, next: PipelineRunState, values: AuditEventValues) {
    await verifyPipelineRunState(next);
    const trail = await this.store.loadAudit(current.run_id);
    await verifyPipelineAuditTrail(trail, current);
    const event = await sealAuditEvent({
      run: next,
      sequence: next.version,
      recorded_at: next.updated_at,
      previous_event_digest: trail.at(-1)?.event_digest ?? null,
      values,
    });
    await verifyPipelineAuditTrail([...trail, event], next);
    if (!await this.store.compareAndSwap(current.run_id, current.version, next, event)) {
      throw new PipelineOrchestratorError("PIPELINE_RUN_STALE", "Another deterministic transition won the compare-and-swap.");
    }
    return clone(next);
  }
}

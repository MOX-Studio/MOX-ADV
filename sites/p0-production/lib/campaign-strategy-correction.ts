import {
  AUTONOMOUS_CAMPAIGN_STRATEGY_SCHEMA,
  CAMPAIGN_STRATEGY_AGENT_INPUT_SCHEMA,
  CAMPAIGN_STRATEGY_DIMENSIONS,
  campaignStrategyAgentDigest,
  formAutonomousCampaignStrategy,
  sealCampaignStrategyAgentArtifact,
  type AutonomousCampaignStrategy,
  type CampaignStrategyAgentArtifact,
  type CampaignStrategyAgentInput,
  type CampaignStrategyAgentProposal,
  type CampaignStrategyAgentRequest,
  type CampaignStrategyDimensionId,
  type CampaignStrategyDimensionValue,
  type CampaignStrategyEvidenceRef,
} from "./campaign-strategy-agent.ts";

export const CAMPAIGN_STRATEGY_CORRECTION_CONTRACT = "mox-adv.p0.campaign-strategy-correction";
export const CAMPAIGN_STRATEGY_CORRECTION_VERSION = "1.0.0";
export const CURRENT_CAMPAIGN_STRATEGY_SCHEMA = "p0-current-campaign-strategy-v1";
export const CAMPAIGN_STRATEGY_INVALIDATION_SCHEMA = "p0-campaign-strategy-invalidation-v1";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u;

export type CampaignLaunchStatus = "NOT_STARTED" | "ACTIVE" | "STOPPED" | "COMPLETED";

export type CampaignStrategyDependentPair = {
  pair_revision_id: string;
  hypothesis_revision_id: string;
  draft_revision_id: string;
};

export type CampaignStrategyCorrectionChanges = Partial<Record<
  CampaignStrategyDimensionId,
  CampaignStrategyDimensionValue
>>;

export type CampaignStrategyConflictSource =
  | "CONFIRMED_FACT"
  | "MANDATORY_POLICY"
  | "DIRECT_CAPABILITY";

export type CampaignStrategyEditConflict = {
  code: string;
  dimension_id: CampaignStrategyDimensionId;
  edited_value: CampaignStrategyDimensionValue;
  source_kind: CampaignStrategyConflictSource;
  source: CampaignStrategyEvidenceRef & { path: string };
  description: string;
};

export type CampaignStrategyCorrectionModelResult =
  | { kind: "CANDIDATE"; proposal: CampaignStrategyAgentProposal }
  | { kind: "CONFLICT"; conflict: CampaignStrategyEditConflict };

export type CampaignStrategyCorrectionAgentRequest = {
  contract: {
    name: typeof CAMPAIGN_STRATEGY_CORRECTION_CONTRACT;
    version: typeof CAMPAIGN_STRATEGY_CORRECTION_VERSION;
  };
  strategy_request: CampaignStrategyAgentRequest;
  correction: {
    expected_strategy_revision_id: string;
    priority: "OWNER_BUSINESS_INPUT";
    changes: CampaignStrategyCorrectionChanges;
  };
};

export interface CampaignStrategyCorrectionModel {
  readonly model_id: string;
  recheckCampaignStrategy(
    request: Readonly<CampaignStrategyCorrectionAgentRequest>,
  ): Promise<CampaignStrategyCorrectionModelResult>;
}

export type CurrentCampaignStrategyState = {
  schema_version: typeof CURRENT_CAMPAIGN_STRATEGY_SCHEMA;
  owner_key: string;
  state_revision: number;
  updated_at: string;
  launch_status: CampaignLaunchStatus;
  strategy: AutonomousCampaignStrategy;
  inputs: CampaignStrategyAgentInput;
  campaign_pairs: CampaignStrategyDependentPair[];
  last_invalidation: null | {
    schema_version: typeof CAMPAIGN_STRATEGY_INVALIDATION_SCHEMA;
    previous_strategy_revision_id: string;
    current_strategy_revision_id: string;
    invalidated_at: string;
    pairs: CampaignStrategyDependentPair[];
  };
};

export interface CurrentCampaignStrategyStore {
  loadCurrent(ownerKey: string): Promise<CurrentCampaignStrategyState | null>;
  compareAndSwap(
    ownerKey: string,
    expectedStateRevision: number,
    current: CurrentCampaignStrategyState,
  ): Promise<boolean>;
}

export type CampaignStrategyCorrectionResult =
  | {
      status: "NO_OP";
      material_change: false;
      current: CurrentCampaignStrategyState;
    }
  | {
      status: "CONFLICT";
      material_change: false;
      current: CurrentCampaignStrategyState;
      conflict: CampaignStrategyEditConflict;
    }
  | {
      status: "SAVED";
      material_change: true;
      current: CurrentCampaignStrategyState;
      invalidated_pairs: CampaignStrategyDependentPair[];
    };

export class CampaignStrategyCorrectionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CampaignStrategyCorrectionError";
    this.code = code;
  }
}

class ExactCorrectionConflict extends Error {
  readonly conflict: CampaignStrategyEditConflict;

  constructor(conflict: CampaignStrategyEditConflict) {
    super("Strategy Agent reported an exact owner-correction conflict.");
    this.conflict = conflict;
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function exactKeys(value: object, keys: string[]) {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function formalText(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function validDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeChangedValue(
  dimensionId: CampaignStrategyDimensionId,
  value: unknown,
): CampaignStrategyDimensionValue {
  if (dimensionId === "period") {
    const period = record(value);
    if (!exactKeys(period, ["start_date", "end_date"])) {
      throw new CampaignStrategyCorrectionError("STRATEGY_CORRECTION_VALUE_INVALID", "Strategy period correction must be one exact date range.");
    }
    const startDate = formalText(String(period.start_date ?? ""));
    const endDate = formalText(String(period.end_date ?? ""));
    if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
      throw new CampaignStrategyCorrectionError("STRATEGY_CORRECTION_VALUE_INVALID", "Strategy period correction must contain valid ordered dates.");
    }
    return { start_date: startDate, end_date: endDate };
  }
  if (dimensionId === "weekly_budget" || dimensionId === "target_result_cost") {
    if (dimensionId === "target_result_cost" && value === null) return null;
    if (!Number.isSafeInteger(value) || Number(value) <= 0) {
      throw new CampaignStrategyCorrectionError("STRATEGY_CORRECTION_VALUE_INVALID", `${dimensionId} correction must be a positive integer${dimensionId === "target_result_cost" ? " or null" : ""}.`);
    }
    return Number(value);
  }
  if (typeof value !== "string") {
    throw new CampaignStrategyCorrectionError("STRATEGY_CORRECTION_VALUE_INVALID", `${dimensionId} correction must be bounded non-empty text.`);
  }
  const normalized = formalText(value);
  if (!normalized || normalized.length > 2_000) {
    throw new CampaignStrategyCorrectionError("STRATEGY_CORRECTION_VALUE_INVALID", `${dimensionId} correction must be bounded non-empty text.`);
  }
  return normalized;
}

function normalizeChanges(value: unknown): CampaignStrategyCorrectionChanges {
  const changes = record(value);
  const unsupported = Object.keys(changes).find((key) => !CAMPAIGN_STRATEGY_DIMENSIONS.includes(key as CampaignStrategyDimensionId));
  if (unsupported) {
    throw new CampaignStrategyCorrectionError("STRATEGY_CORRECTION_FIELD_UNSUPPORTED", `Campaign Strategy dimension ${unsupported} is not editable.`);
  }
  if (Object.keys(changes).length === 0) {
    throw new CampaignStrategyCorrectionError("STRATEGY_CORRECTION_EMPTY", "Campaign Strategy correction must change at least one dimension.");
  }
  return Object.fromEntries(CAMPAIGN_STRATEGY_DIMENSIONS
    .filter((dimensionId) => Object.hasOwn(changes, dimensionId))
    .map((dimensionId) => [dimensionId, normalizeChangedValue(dimensionId, changes[dimensionId])])) as CampaignStrategyCorrectionChanges;
}

function strategyValues(strategy: AutonomousCampaignStrategy) {
  return Object.fromEntries(strategy.dimensions.map((dimension) => [
    dimension.dimension_id,
    normalizeChangedValue(dimension.dimension_id, dimension.value),
  ])) as Record<CampaignStrategyDimensionId, CampaignStrategyDimensionValue>;
}

function sameValue(left: CampaignStrategyDimensionValue, right: CampaignStrategyDimensionValue) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactIdentifier(value: unknown, label: string) {
  const result = String(value ?? "");
  if (!IDENTIFIER.test(result)) {
    throw new CampaignStrategyCorrectionError("STRATEGY_CORRECTION_INVALID", `${label} must be one exact identifier.`);
  }
  return result;
}

function evidenceArtifactForConflict(
  input: CampaignStrategyAgentInput,
  sourceKind: CampaignStrategyConflictSource,
  reference: CampaignStrategyEvidenceRef,
): CampaignStrategyAgentArtifact | null {
  if (sourceKind === "MANDATORY_POLICY") {
    return input.policies.find((artifact) => artifact.kind === reference.input_kind
      && artifact.revision_id === reference.revision_id) ?? null;
  }
  if (sourceKind === "DIRECT_CAPABILITY") {
    const artifact = input.supported_draft_profile;
    return artifact.kind === reference.input_kind && artifact.revision_id === reference.revision_id ? artifact : null;
  }
  const artifacts = [input.goal_revision, input.analytics_evidence_snapshot];
  return artifacts.find((artifact) => artifact.kind === reference.input_kind
    && artifact.revision_id === reference.revision_id) ?? null;
}

function validateConflict(
  value: unknown,
  changes: CampaignStrategyCorrectionChanges,
  inputs: CampaignStrategyAgentInput,
): CampaignStrategyEditConflict {
  const conflict = record(value);
  const source = record(conflict.source);
  if (!exactKeys(conflict, ["code", "dimension_id", "edited_value", "source_kind", "source", "description"])
    || !exactKeys(source, ["input_kind", "revision_id", "evidence_id", "path"])
    || !/^[A-Z][A-Z0-9_]{1,79}$/u.test(String(conflict.code))
    || !CAMPAIGN_STRATEGY_DIMENSIONS.includes(conflict.dimension_id as CampaignStrategyDimensionId)
    || !["CONFIRMED_FACT", "MANDATORY_POLICY", "DIRECT_CAPABILITY"].includes(String(conflict.source_kind))
    || typeof conflict.description !== "string"
    || formalText(conflict.description) !== conflict.description
    || !conflict.description
    || conflict.description.length > 2_000) {
    throw new CampaignStrategyCorrectionError("STRATEGY_CORRECTION_CONFLICT_INVALID", "Strategy correction conflict does not match the exact typed contract.");
  }
  const dimensionId = conflict.dimension_id as CampaignStrategyDimensionId;
  if (!Object.hasOwn(changes, dimensionId)
    || !sameValue(normalizeChangedValue(dimensionId, conflict.edited_value), changes[dimensionId] as CampaignStrategyDimensionValue)) {
    throw new CampaignStrategyCorrectionError("STRATEGY_CORRECTION_CONFLICT_INVALID", "Strategy correction conflict must identify the exact edited dimension and value.");
  }
  const reference = source as CampaignStrategyEvidenceRef & { path: string };
  const artifact = evidenceArtifactForConflict(inputs, conflict.source_kind as CampaignStrategyConflictSource, reference);
  const indexedEvidence = artifact?.evidence.find((item) => item.evidence_id === reference.evidence_id);
  if (!artifact || !indexedEvidence || indexedEvidence.path !== reference.path) {
    throw new CampaignStrategyCorrectionError("STRATEGY_CORRECTION_CONFLICT_SOURCE_UNKNOWN", "Strategy correction conflict must name one exact confirmed fact, mandatory policy, or Direct capability input.");
  }
  return clone(value) as CampaignStrategyEditConflict;
}

async function priorityBusinessInput(
  current: CurrentCampaignStrategyState,
  changes: CampaignStrategyCorrectionChanges,
) {
  const material = {
    expected_strategy_revision_id: current.strategy.strategy_revision_id,
    changes,
  };
  const digest = await campaignStrategyAgentDigest(material);
  const shortDigest = digest.slice("sha256:".length, "sha256:".length + 24);
  const correctionRevisionId = `strategy-correction:${shortDigest}`;
  const correctionEvidenceIds = Object.keys(changes).map((dimensionId) => `owner-correction-${shortDigest}-${dimensionId}`);
  const base = current.inputs.business_input;
  const artifact = await sealCampaignStrategyAgentArtifact({
    kind: "BUSINESS_INPUT",
    schema_version: "p0-priority-strategy-business-input-v1",
    revision_id: correctionRevisionId,
    evidence: [
      ...base.evidence.map((item) => ({
        evidence_id: item.evidence_id,
        path: `/base_business_input/content${item.path}`,
      })),
      ...Object.keys(changes).map((dimensionId, index) => ({
        evidence_id: correctionEvidenceIds[index],
        path: `/owner_strategy_correction/changes/${dimensionId}`,
      })),
    ],
    content: {
      base_business_input: {
        schema_version: base.schema_version,
        revision_id: base.revision_id,
        digest: base.digest,
        content: clone(base.content),
      },
      owner_strategy_correction: {
        precedence: "PRIORITY_BUSINESS_INPUT",
        expected_strategy_revision_id: current.strategy.strategy_revision_id,
        changes: clone(changes),
      },
    },
  });
  return {
    artifact,
    evidenceByDimension: Object.fromEntries(Object.keys(changes).map((dimensionId, index) => [
      dimensionId,
      correctionEvidenceIds[index],
    ])) as Partial<Record<CampaignStrategyDimensionId, string>>,
  };
}

function assertCorrectionApplied(
  strategy: AutonomousCampaignStrategy,
  changes: CampaignStrategyCorrectionChanges,
  businessInput: CampaignStrategyAgentArtifact,
  evidenceByDimension: Partial<Record<CampaignStrategyDimensionId, string>>,
) {
  const values = strategyValues(strategy);
  for (const dimensionId of CAMPAIGN_STRATEGY_DIMENSIONS.filter((item) => Object.hasOwn(changes, item))) {
    if (!sameValue(values[dimensionId], changes[dimensionId] as CampaignStrategyDimensionValue)) {
      throw new CampaignStrategyCorrectionError(
        "STRATEGY_CORRECTION_SILENTLY_DROPPED",
        `Strategy Agent did not apply owner correction ${dimensionId} and returned no exact conflict; no current Strategy was changed.`,
      );
    }
    const dimension = strategy.dimensions.find((item) => item.dimension_id === dimensionId);
    const evidenceId = evidenceByDimension[dimensionId];
    if (!dimension?.evidence_refs.some((reference) => reference.input_kind === "BUSINESS_INPUT"
      && reference.revision_id === businessInput.revision_id
      && reference.evidence_id === evidenceId)) {
      throw new CampaignStrategyCorrectionError(
        "STRATEGY_CORRECTION_PRIORITY_EVIDENCE_MISSING",
        `Strategy dimension ${dimensionId} does not retain the priority business input lineage; no current Strategy was changed.`,
      );
    }
  }
}

export async function saveCampaignStrategyCorrection(input: {
  store: CurrentCampaignStrategyStore;
  owner_key: string;
  expected_state_revision: number;
  expected_strategy_revision_id: string;
  changes: CampaignStrategyCorrectionChanges;
  model: CampaignStrategyCorrectionModel;
  corrected_at: string;
}): Promise<CampaignStrategyCorrectionResult> {
  const ownerKey = exactIdentifier(input.owner_key, "Owner key");
  const expectedStrategyRevisionId = exactIdentifier(input.expected_strategy_revision_id, "Expected Strategy revision");
  if (!Number.isSafeInteger(input.expected_state_revision) || input.expected_state_revision < 0
    || !Number.isFinite(Date.parse(input.corrected_at))
    || !input.model || !String(input.model.model_id ?? "").trim()) {
    throw new CampaignStrategyCorrectionError("STRATEGY_CORRECTION_INVALID", "Strategy correction revision, time, and Agent identity are required.");
  }
  const current = await input.store.loadCurrent(ownerKey);
  if (!current) {
    throw new CampaignStrategyCorrectionError("STRATEGY_CORRECTION_NOT_FOUND", "Current Campaign Strategy was not found.");
  }
  if (current.state_revision !== input.expected_state_revision
    || current.strategy.strategy_revision_id !== expectedStrategyRevisionId) {
    throw new CampaignStrategyCorrectionError("STRATEGY_CORRECTION_STALE", "Campaign Strategy no longer matches the expected current revision; no field merge was attempted.");
  }
  if (current.owner_key !== ownerKey
    || !["NOT_STARTED", "ACTIVE", "STOPPED", "COMPLETED"].includes(current.launch_status)
    || current.schema_version !== CURRENT_CAMPAIGN_STRATEGY_SCHEMA
    || current.strategy.schema_version !== AUTONOMOUS_CAMPAIGN_STRATEGY_SCHEMA
    || current.strategy.status !== "AGENT_ACCEPTED"
    || current.inputs.schema_version !== CAMPAIGN_STRATEGY_AGENT_INPUT_SCHEMA) {
    throw new CampaignStrategyCorrectionError("STRATEGY_CORRECTION_STATE_INVALID", "Current Campaign Strategy state does not match the autonomous Strategy contract.");
  }
  if (current.launch_status === "ACTIVE") {
    throw new CampaignStrategyCorrectionError("STRATEGY_CORRECTION_ACTIVE_LAUNCH", "Campaign Strategy is editable only outside an active launch; no current Strategy was changed.");
  }

  const changes = normalizeChanges(input.changes);
  const currentValues = strategyValues(current.strategy);
  if (Object.entries(changes).every(([dimensionId, value]) => sameValue(
    currentValues[dimensionId as CampaignStrategyDimensionId],
    value as CampaignStrategyDimensionValue,
  ))) {
    return { status: "NO_OP", material_change: false, current: clone(current) };
  }

  const priority = await priorityBusinessInput(current, changes);
  const revisedInputs: CampaignStrategyAgentInput = {
    ...clone(current.inputs),
    business_input: priority.artifact,
  };
  let conflict: CampaignStrategyEditConflict | null = null;
  let strategy: Readonly<AutonomousCampaignStrategy>;
  try {
    strategy = await formAutonomousCampaignStrategy({
      inputs: revisedInputs,
      acceptedAt: input.corrected_at,
      model: {
        model_id: input.model.model_id,
        async formCampaignStrategy(strategyRequest) {
          const request = deepFreeze({
            contract: {
              name: CAMPAIGN_STRATEGY_CORRECTION_CONTRACT,
              version: CAMPAIGN_STRATEGY_CORRECTION_VERSION,
            } as const,
            strategy_request: strategyRequest,
            correction: {
              expected_strategy_revision_id: current.strategy.strategy_revision_id,
              priority: "OWNER_BUSINESS_INPUT" as const,
              changes: clone(changes),
            },
          });
          const result = await input.model.recheckCampaignStrategy(request);
          if (result?.kind === "CONFLICT") {
            throw new ExactCorrectionConflict(validateConflict(result.conflict, changes, current.inputs));
          }
          if (result?.kind !== "CANDIDATE") {
            throw new CampaignStrategyCorrectionError("STRATEGY_CORRECTION_AGENT_RESULT_INVALID", "Strategy Agent must return a full candidate or one exact conflict.");
          }
          return result.proposal;
        },
      },
    });
  } catch (error) {
    if (!(error instanceof ExactCorrectionConflict)) throw error;
    conflict = error.conflict;
    return {
      status: "CONFLICT",
      material_change: false,
      current: clone(current),
      conflict: clone(conflict),
    };
  }

  assertCorrectionApplied(strategy, changes, priority.artifact, priority.evidenceByDimension);
  if (strategy.strategy_revision_id === current.strategy.strategy_revision_id) {
    throw new CampaignStrategyCorrectionError("STRATEGY_CORRECTION_REVISION_REUSED", "A material Strategy correction must create a new current revision.");
  }
  const invalidatedPairs = clone(current.campaign_pairs);
  const next: CurrentCampaignStrategyState = {
    schema_version: CURRENT_CAMPAIGN_STRATEGY_SCHEMA,
    owner_key: current.owner_key,
    state_revision: current.state_revision + 1,
    updated_at: input.corrected_at,
    launch_status: current.launch_status,
    strategy: clone(strategy),
    inputs: clone(revisedInputs),
    campaign_pairs: [],
    last_invalidation: {
      schema_version: CAMPAIGN_STRATEGY_INVALIDATION_SCHEMA,
      previous_strategy_revision_id: current.strategy.strategy_revision_id,
      current_strategy_revision_id: strategy.strategy_revision_id,
      invalidated_at: input.corrected_at,
      pairs: clone(invalidatedPairs),
    },
  };
  if (!await input.store.compareAndSwap(ownerKey, input.expected_state_revision, next)) {
    throw new CampaignStrategyCorrectionError("STRATEGY_CORRECTION_STALE", "Campaign Strategy changed during full recheck; the newer current revision was preserved.");
  }
  return {
    status: "SAVED",
    material_change: true,
    current: clone(next),
    invalidated_pairs: invalidatedPairs,
  };
}

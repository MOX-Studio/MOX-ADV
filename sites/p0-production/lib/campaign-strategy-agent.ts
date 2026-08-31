export const CAMPAIGN_STRATEGY_AGENT_CONTRACT = "mox-adv.p0.campaign-strategy-agent";
export const CAMPAIGN_STRATEGY_AGENT_VERSION = "1.0.0";
export const CAMPAIGN_STRATEGY_AGENT_INPUT_SCHEMA = "p0-campaign-strategy-agent-input-v1";
export const AUTONOMOUS_CAMPAIGN_STRATEGY_SCHEMA = "p0-autonomous-campaign-strategy-v1";

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u;
const CONFLICT_CODE = /^[A-Z][A-Z0-9_]{1,79}$/u;

export const CAMPAIGN_STRATEGY_DIMENSIONS = [
  "business_goal",
  "campaign_focus",
  "advertised_offer",
  "target_audience",
  "qualified_result",
  "exclusions",
  "geography",
  "period",
  "landing_page",
  "weekly_budget",
  "target_result_cost",
  "core_message",
] as const;

export type CampaignStrategyDimensionId = (typeof CAMPAIGN_STRATEGY_DIMENSIONS)[number];
export type CampaignStrategyInputKind =
  | "GOAL_REVISION"
  | "BUSINESS_INPUT"
  | "ANALYTICS_EVIDENCE_SNAPSHOT"
  | "MANDATORY_POLICY"
  | "SUPPORTED_DRAFT_PROFILE"
  | "CAMPAIGN_PLAYBOOK";

export type CampaignStrategyEvidenceSource = {
  evidence_id: string;
  path: string;
};

export type CampaignStrategyAgentArtifact = {
  kind: CampaignStrategyInputKind;
  schema_version: string;
  revision_id: string;
  digest: string;
  evidence: CampaignStrategyEvidenceSource[];
  content: Record<string, unknown>;
};

export type CampaignStrategyEvidenceRef = {
  input_kind: CampaignStrategyInputKind;
  revision_id: string;
  evidence_id: string;
};

export type CampaignStrategyPeriod = {
  start_date: string;
  end_date: string;
};

export type CampaignStrategyDimensionValue = string | number | CampaignStrategyPeriod | null;

export type CampaignStrategyAgentProposal = {
  dimensions: Array<{
    dimension_id: CampaignStrategyDimensionId;
    value: CampaignStrategyDimensionValue;
    rationale: string;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    evidence_refs: CampaignStrategyEvidenceRef[];
  }>;
  rationale: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  conflicts: Array<{
    code: string;
    description: string;
    evidence_refs: CampaignStrategyEvidenceRef[];
  }>;
};

export type CampaignStrategyAgentInput = {
  schema_version: typeof CAMPAIGN_STRATEGY_AGENT_INPUT_SCHEMA;
  goal_revision: CampaignStrategyAgentArtifact;
  business_input: CampaignStrategyAgentArtifact;
  analytics_evidence_snapshot: CampaignStrategyAgentArtifact;
  policies: CampaignStrategyAgentArtifact[];
  supported_draft_profile: CampaignStrategyAgentArtifact;
  campaign_playbook: CampaignStrategyAgentArtifact;
};

export type CampaignStrategyAgentRequest = CampaignStrategyAgentInput & {
  contract: {
    name: typeof CAMPAIGN_STRATEGY_AGENT_CONTRACT;
    version: typeof CAMPAIGN_STRATEGY_AGENT_VERSION;
  };
  authority: {
    external_read: false;
    persistence: false;
    adjacent_stage_mutation: false;
    mandate_grant: false;
    publication: false;
    spend: false;
  };
};

export interface CampaignStrategyModel {
  readonly model_id: string;
  formCampaignStrategy(request: Readonly<CampaignStrategyAgentRequest>): Promise<CampaignStrategyAgentProposal>;
}

export type AutonomousCampaignStrategy = {
  schema_version: typeof AUTONOMOUS_CAMPAIGN_STRATEGY_SCHEMA;
  contract: {
    name: typeof CAMPAIGN_STRATEGY_AGENT_CONTRACT;
    version: typeof CAMPAIGN_STRATEGY_AGENT_VERSION;
  };
  strategy_revision_id: string;
  digest: string;
  status: "AGENT_ACCEPTED";
  accepted_at: string;
  accepted_by: {
    kind: "STRATEGY_AGENT";
    model_id: string;
  };
  input_lineage: {
    goal_revision: ArtifactReference;
    business_input: ArtifactReference;
    analytics_evidence_snapshot: ArtifactReference;
    policies: ArtifactReference[];
    supported_draft_profile: ArtifactReference;
    campaign_playbook: ArtifactReference;
  };
  dimensions: CampaignStrategyAgentProposal["dimensions"];
  rationale: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  conflicts: CampaignStrategyAgentProposal["conflicts"];
  budget_boundary: {
    weekly_budget: number;
    semantics: "RECOMMENDATION_ONLY";
    creates_mandate: false;
    authorizes_spend: false;
  };
  authority: {
    mandate: "NOT_GRANTED";
    publication: "NOT_AUTHORIZED";
    spend: "NOT_AUTHORIZED";
    performance_promise: false;
  };
};

type ArtifactReference = {
  schema_version: string;
  revision_id: string;
  digest: string;
};

export class CampaignStrategyAgentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CampaignStrategyAgentError";
    this.code = code;
  }
}

function exactKeys(value: object, keys: string[]) {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function text(value: unknown, maximum = 2_000): value is string {
  return typeof value === "string"
    && value === value.trim()
    && value.length > 0
    && value.length <= maximum;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalize(item)]));
}

export async function campaignStrategyAgentDigest(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
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

export async function sealCampaignStrategyAgentArtifact(input: Omit<CampaignStrategyAgentArtifact, "digest">) {
  const artifact = clone(input) as CampaignStrategyAgentArtifact;
  artifact.digest = await campaignStrategyAgentDigest(input);
  return deepFreeze(artifact) as CampaignStrategyAgentArtifact;
}

async function assertArtifact(value: unknown, expectedKind: CampaignStrategyInputKind) {
  const artifact = record(value);
  if (!exactKeys(artifact, ["kind", "schema_version", "revision_id", "digest", "evidence", "content"])
    || artifact.kind !== expectedKind
    || !text(artifact.schema_version, 255)
    || !IDENTIFIER.test(String(artifact.revision_id))
    || !SHA256_DIGEST.test(String(artifact.digest))
    || !Array.isArray(artifact.evidence)
    || !artifact.content || typeof artifact.content !== "object" || Array.isArray(artifact.content)) {
    throw new CampaignStrategyAgentError("STRATEGY_INPUT_INVALID", `${expectedKind} does not match the immutable artifact contract.`);
  }
  const evidence = artifact.evidence as unknown[];
  if (evidence.some((item) => {
    const source = record(item);
    return !exactKeys(source, ["evidence_id", "path"])
      || !IDENTIFIER.test(String(source.evidence_id))
      || !text(source.path, 1_000)
      || !String(source.path).startsWith("/");
  }) || new Set(evidence.map((item) => String(record(item).evidence_id))).size !== evidence.length) {
    throw new CampaignStrategyAgentError("STRATEGY_INPUT_INVALID", `${expectedKind} evidence index is invalid.`);
  }
  const unsigned = {
    kind: artifact.kind,
    schema_version: artifact.schema_version,
    revision_id: artifact.revision_id,
    evidence: artifact.evidence,
    content: artifact.content,
  };
  if (await campaignStrategyAgentDigest(unsigned) !== artifact.digest) {
    throw new CampaignStrategyAgentError("STRATEGY_INPUT_DIGEST_MISMATCH", `${expectedKind} digest does not match its exact content.`);
  }
}

function assertArtifactState(artifact: CampaignStrategyAgentArtifact) {
  const content = record(artifact.content);
  if (artifact.kind === "MANDATORY_POLICY"
    && (content.status !== "MANDATORY" || !text(content.policy_id, 255) || !text(content.policy_version, 100))) {
    throw new CampaignStrategyAgentError("STRATEGY_POLICY_INVALID", "Every policy must be an exact mandatory version.");
  }
  if (artifact.kind === "SUPPORTED_DRAFT_PROFILE"
    && (content.status !== "SUPPORTED" || !text(content.profile_id, 255) || !text(content.profile_version, 100))) {
    throw new CampaignStrategyAgentError("STRATEGY_PROFILE_UNSUPPORTED", "The Draft profile must identify one supported exact version.");
  }
  if (artifact.kind === "CAMPAIGN_PLAYBOOK"
    && (content.status !== "ACTIVE" || !text(content.release_id, 255) || !text(content.release_version, 100))) {
    throw new CampaignStrategyAgentError("STRATEGY_PLAYBOOK_NOT_ACTIVE", "Campaign Playbook must identify one exact active release.");
  }
}

async function assertInputs(input: CampaignStrategyAgentInput) {
  if (!exactKeys(input, [
    "schema_version",
    "goal_revision",
    "business_input",
    "analytics_evidence_snapshot",
    "policies",
    "supported_draft_profile",
    "campaign_playbook",
  ]) || input.schema_version !== CAMPAIGN_STRATEGY_AGENT_INPUT_SCHEMA) {
    throw new CampaignStrategyAgentError("STRATEGY_INPUT_INVALID", "Strategy Agent inputs do not match the closed typed schema.");
  }
  if (!Array.isArray(input.policies) || input.policies.length === 0) {
    throw new CampaignStrategyAgentError("STRATEGY_INPUT_INVALID", "At least one exact mandatory policy is required.");
  }
  await Promise.all([
    assertArtifact(input.goal_revision, "GOAL_REVISION"),
    assertArtifact(input.business_input, "BUSINESS_INPUT"),
    assertArtifact(input.analytics_evidence_snapshot, "ANALYTICS_EVIDENCE_SNAPSHOT"),
    ...input.policies.map((policy) => assertArtifact(policy, "MANDATORY_POLICY")),
    assertArtifact(input.supported_draft_profile, "SUPPORTED_DRAFT_PROFILE"),
    assertArtifact(input.campaign_playbook, "CAMPAIGN_PLAYBOOK"),
  ]);
  const policyRevisions = input.policies.map((policy) => policy.revision_id);
  if (new Set(policyRevisions).size !== policyRevisions.length) {
    throw new CampaignStrategyAgentError("STRATEGY_INPUT_INVALID", "Mandatory policy revisions must be unique.");
  }
  [...input.policies, input.supported_draft_profile, input.campaign_playbook].forEach(assertArtifactState);
}

function evidenceKey(reference: CampaignStrategyEvidenceRef) {
  return `${reference.input_kind}\u0000${reference.revision_id}\u0000${reference.evidence_id}`;
}

function allowedEvidence(input: CampaignStrategyAgentInput) {
  const artifacts = [
    input.goal_revision,
    input.business_input,
    input.analytics_evidence_snapshot,
    ...input.policies,
    input.supported_draft_profile,
    input.campaign_playbook,
  ];
  return new Set(artifacts.flatMap((artifact) => artifact.evidence.map((source) => evidenceKey({
    input_kind: artifact.kind,
    revision_id: artifact.revision_id,
    evidence_id: source.evidence_id,
  }))));
}

function assertEvidenceRefs(value: unknown, allowed: Set<string>, label: string) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CampaignStrategyAgentError("STRATEGY_EVIDENCE_REQUIRED", `${label} requires at least one exact evidence reference.`);
  }
  const keys = value.map((item) => {
    const reference = record(item);
    if (!exactKeys(reference, ["input_kind", "revision_id", "evidence_id"])
      || !["GOAL_REVISION", "BUSINESS_INPUT", "ANALYTICS_EVIDENCE_SNAPSHOT", "MANDATORY_POLICY", "SUPPORTED_DRAFT_PROFILE", "CAMPAIGN_PLAYBOOK"].includes(String(reference.input_kind))
      || !IDENTIFIER.test(String(reference.revision_id))
      || !IDENTIFIER.test(String(reference.evidence_id))) {
      throw new CampaignStrategyAgentError("STRATEGY_EVIDENCE_INVALID", `${label} contains a malformed evidence reference.`);
    }
    const key = evidenceKey(reference as CampaignStrategyEvidenceRef);
    if (!allowed.has(key)) {
      throw new CampaignStrategyAgentError("STRATEGY_EVIDENCE_UNKNOWN", `${label} references evidence outside the immutable inputs.`);
    }
    return key;
  });
  if (new Set(keys).size !== keys.length) {
    throw new CampaignStrategyAgentError("STRATEGY_EVIDENCE_INVALID", `${label} repeats an evidence reference.`);
  }
}

function validDate(value: unknown) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/u.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`));
}

function assertDimensionValue(dimensionId: CampaignStrategyDimensionId, value: unknown) {
  if (dimensionId === "period") {
    const period = record(value);
    if (!exactKeys(period, ["start_date", "end_date"])
      || !validDate(period.start_date)
      || !validDate(period.end_date)
      || String(period.start_date) > String(period.end_date)) {
      throw new CampaignStrategyAgentError("STRATEGY_DIMENSION_INVALID", "Strategy period must be one exact valid date range.");
    }
    return;
  }
  if (dimensionId === "weekly_budget") {
    if (!Number.isSafeInteger(value) || Number(value) <= 0) {
      throw new CampaignStrategyAgentError("STRATEGY_DIMENSION_INVALID", "Recommended weekly budget must be a positive integer.");
    }
    return;
  }
  if (dimensionId === "target_result_cost" && value === null) return;
  if (!text(value)) {
    throw new CampaignStrategyAgentError("STRATEGY_DIMENSION_INVALID", `${dimensionId} must contain a bounded business value.`);
  }
}

function assertProposal(proposal: CampaignStrategyAgentProposal, input: CampaignStrategyAgentInput) {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)
    || !exactKeys(proposal, ["dimensions", "rationale", "confidence", "conflicts"])
    || !text(proposal.rationale, 2_000)
    || !["HIGH", "MEDIUM", "LOW"].includes(proposal.confidence)
    || !Array.isArray(proposal.dimensions)
    || !Array.isArray(proposal.conflicts)) {
    throw new CampaignStrategyAgentError("STRATEGY_PROPOSAL_INVALID", "Strategy Agent proposal does not match the closed output schema.");
  }
  const dimensionIds = proposal.dimensions.map((dimension) => dimension?.dimension_id);
  if (JSON.stringify(dimensionIds) !== JSON.stringify(CAMPAIGN_STRATEGY_DIMENSIONS)) {
    throw new CampaignStrategyAgentError("STRATEGY_DIMENSIONS_INCOMPLETE", "Campaign Strategy must contain all twelve dimensions once and in canonical order.");
  }
  const allowed = allowedEvidence(input);
  for (const dimension of proposal.dimensions) {
    if (!dimension || typeof dimension !== "object" || Array.isArray(dimension)
      || !exactKeys(dimension, ["dimension_id", "value", "rationale", "confidence", "evidence_refs"])
      || !text(dimension.rationale, 2_000)
      || !["HIGH", "MEDIUM", "LOW"].includes(dimension.confidence)) {
      throw new CampaignStrategyAgentError("STRATEGY_DIMENSION_INVALID", "A Strategy dimension does not match the closed schema.");
    }
    assertDimensionValue(dimension.dimension_id, dimension.value);
    assertEvidenceRefs(dimension.evidence_refs, allowed, `Strategy dimension ${dimension.dimension_id}`);
  }
  for (const conflict of proposal.conflicts) {
    if (!conflict || typeof conflict !== "object" || Array.isArray(conflict)
      || !exactKeys(conflict, ["code", "description", "evidence_refs"])
      || !CONFLICT_CODE.test(String(conflict.code))
      || !text(conflict.description, 2_000)) {
      throw new CampaignStrategyAgentError("STRATEGY_CONFLICT_INVALID", "Strategy conflict does not match the typed contract.");
    }
    assertEvidenceRefs(conflict.evidence_refs, allowed, `Strategy conflict ${conflict.code}`);
  }
}

function reference(artifact: CampaignStrategyAgentArtifact): ArtifactReference {
  return {
    schema_version: artifact.schema_version,
    revision_id: artifact.revision_id,
    digest: artifact.digest,
  };
}

export async function formAutonomousCampaignStrategy(input: {
  inputs: CampaignStrategyAgentInput;
  model: CampaignStrategyModel;
  acceptedAt: string;
}): Promise<Readonly<AutonomousCampaignStrategy>> {
  if (!input.model || !text(input.model.model_id, 255) || !text(input.acceptedAt, 100)
    || !Number.isFinite(Date.parse(input.acceptedAt))) {
    throw new CampaignStrategyAgentError("STRATEGY_AGENT_INVALID", "Strategy Agent identity and acceptance time are required.");
  }
  const immutableInputs = clone(input.inputs);
  await assertInputs(immutableInputs);
  const request = deepFreeze({
    ...immutableInputs,
    contract: { name: CAMPAIGN_STRATEGY_AGENT_CONTRACT, version: CAMPAIGN_STRATEGY_AGENT_VERSION },
    authority: {
      external_read: false,
      persistence: false,
      adjacent_stage_mutation: false,
      mandate_grant: false,
      publication: false,
      spend: false,
    },
  } satisfies CampaignStrategyAgentRequest);
  const proposal = clone(await input.model.formCampaignStrategy(request));
  assertProposal(proposal, immutableInputs);

  const inputLineage = {
    goal_revision: reference(immutableInputs.goal_revision),
    business_input: reference(immutableInputs.business_input),
    analytics_evidence_snapshot: reference(immutableInputs.analytics_evidence_snapshot),
    policies: immutableInputs.policies.map(reference),
    supported_draft_profile: reference(immutableInputs.supported_draft_profile),
    campaign_playbook: reference(immutableInputs.campaign_playbook),
  };
  const identity = {
    contract: { name: CAMPAIGN_STRATEGY_AGENT_CONTRACT, version: CAMPAIGN_STRATEGY_AGENT_VERSION } as const,
    accepted_at: input.acceptedAt,
    accepted_by: { kind: "STRATEGY_AGENT" as const, model_id: input.model.model_id },
    input_lineage: inputLineage,
    dimensions: proposal.dimensions,
    rationale: proposal.rationale,
    confidence: proposal.confidence,
    conflicts: proposal.conflicts,
  };
  const digest = await campaignStrategyAgentDigest(identity);
  const weeklyBudget = proposal.dimensions.find((dimension) => dimension.dimension_id === "weekly_budget")?.value;
  const strategy: AutonomousCampaignStrategy = {
    schema_version: AUTONOMOUS_CAMPAIGN_STRATEGY_SCHEMA,
    contract: identity.contract,
    strategy_revision_id: `campaign-strategy:${digest.slice("sha256:".length, "sha256:".length + 24)}`,
    digest,
    status: "AGENT_ACCEPTED",
    accepted_at: input.acceptedAt,
    accepted_by: identity.accepted_by,
    input_lineage: inputLineage,
    dimensions: proposal.dimensions,
    rationale: proposal.rationale,
    confidence: proposal.confidence,
    conflicts: proposal.conflicts,
    budget_boundary: {
      weekly_budget: Number(weeklyBudget),
      semantics: "RECOMMENDATION_ONLY",
      creates_mandate: false,
      authorizes_spend: false,
    },
    authority: {
      mandate: "NOT_GRANTED",
      publication: "NOT_AUTHORIZED",
      spend: "NOT_AUTHORIZED",
      performance_promise: false,
    },
  };
  return deepFreeze(strategy);
}

import {
  assertCampaignPlaybookStrategySnapshot,
  campaignPlaybookStrategyRevisionId,
  type AppliedPlaybookRuleReference,
  type CampaignPlaybookStrategySnapshot,
  type PlaybookPolicyReference,
  type PlaybookReleaseReference,
} from "./campaign-playbook-governance.ts";

export const CAMPAIGN_STRATEGY_AGENT_CONTRACT = "mox-adv.p0.campaign-strategy-agent";
export const CAMPAIGN_STRATEGY_AGENT_VERSION = "1.1.0";
export const CAMPAIGN_STRATEGY_AGENT_INPUT_SCHEMA = "p0-campaign-strategy-agent-input-v1";
export const CAMPAIGN_STRATEGY_VALIDATION_SCHEMA = "p0-campaign-strategy-validation-v1";
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

export type CampaignStrategyViolation = {
  code: string;
  path: string;
  message: string;
};

export type CampaignStrategyValidationPackage = {
  schema_version: typeof CAMPAIGN_STRATEGY_VALIDATION_SCHEMA;
  status: "CONTENT_REJECTED";
  attempt: 1 | 2;
  violations: CampaignStrategyViolation[];
};

export type CampaignStrategyAgentRequest = CampaignStrategyAgentInput & {
  contract: {
    name: typeof CAMPAIGN_STRATEGY_AGENT_CONTRACT;
    version: typeof CAMPAIGN_STRATEGY_AGENT_VERSION;
  };
  attempt: 1 | 2;
  repair: null | {
    rejected_proposal: unknown;
    validation: CampaignStrategyValidationPackage;
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
  playbook_lineage: {
    release: PlaybookReleaseReference;
    promotion_policy: PlaybookPolicyReference;
    applied_rules: AppliedPlaybookRuleReference[];
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

export type CampaignStrategyTechnicalFailure = {
  status: "TECHNICAL_FAILURE";
  reason: "STRATEGY_CONTENT_REJECTED_TWICE";
  validation_attempts: [CampaignStrategyValidationPackage, CampaignStrategyValidationPackage];
};

export class CampaignStrategyAgentError extends Error {
  readonly code: string;
  readonly details: CampaignStrategyTechnicalFailure | null;

  constructor(code: string, message: string, details: CampaignStrategyTechnicalFailure | null = null) {
    super(message);
    this.name = "CampaignStrategyAgentError";
    this.code = code;
    this.details = details;
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
  if (artifact.kind === "CAMPAIGN_PLAYBOOK") {
    try {
      assertCampaignPlaybookStrategySnapshot(artifact.content);
      if (artifact.revision_id !== campaignPlaybookStrategyRevisionId(artifact.content as CampaignPlaybookStrategySnapshot)) {
        throw new CampaignStrategyAgentError("STRATEGY_PLAYBOOK_NOT_ACTIVE", "Campaign Playbook artifact revision does not identify its exact active release.");
      }
    } catch (error) {
      if (error instanceof CampaignStrategyAgentError) throw error;
      throw new CampaignStrategyAgentError("STRATEGY_PLAYBOOK_NOT_ACTIVE", "Campaign Playbook must contain one exact active approved release and applicable rules.");
    }
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

const INPUT_KINDS: CampaignStrategyInputKind[] = [
  "GOAL_REVISION",
  "BUSINESS_INPUT",
  "ANALYTICS_EVIDENCE_SNAPSHOT",
  "MANDATORY_POLICY",
  "SUPPORTED_DRAFT_PROFILE",
  "CAMPAIGN_PLAYBOOK",
];

function formalText(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function normalizeProposal(value: unknown): unknown {
  const normalized = clone(value);
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) return normalized;
  const proposal = normalized as Record<string, unknown>;
  if (typeof proposal.rationale === "string") proposal.rationale = formalText(proposal.rationale);
  if (Array.isArray(proposal.dimensions)) {
    const dimensions = proposal.dimensions.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const dimension = item as Record<string, unknown>;
      if (typeof dimension.rationale === "string") dimension.rationale = formalText(dimension.rationale);
      if (typeof dimension.value === "string") dimension.value = formalText(dimension.value);
      if (dimension.dimension_id === "period") {
        const period = record(dimension.value);
        if (typeof period.start_date === "string") period.start_date = formalText(period.start_date);
        if (typeof period.end_date === "string") period.end_date = formalText(period.end_date);
      }
      return dimension;
    });
    const ids = dimensions.map((item) => record(item).dimension_id);
    if (ids.length === CAMPAIGN_STRATEGY_DIMENSIONS.length
      && new Set(ids).size === ids.length
      && ids.every((id) => CAMPAIGN_STRATEGY_DIMENSIONS.includes(id as CampaignStrategyDimensionId))) {
      dimensions.sort((left, right) => (
        CAMPAIGN_STRATEGY_DIMENSIONS.indexOf(record(left).dimension_id as CampaignStrategyDimensionId)
        - CAMPAIGN_STRATEGY_DIMENSIONS.indexOf(record(right).dimension_id as CampaignStrategyDimensionId)
      ));
    }
    proposal.dimensions = dimensions;
  }
  if (Array.isArray(proposal.conflicts)) {
    proposal.conflicts = proposal.conflicts.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const conflict = item as Record<string, unknown>;
      if (typeof conflict.description === "string") conflict.description = formalText(conflict.description);
      return conflict;
    });
  }
  return normalized;
}

function addViolation(violations: CampaignStrategyViolation[], code: string, path: string, message: string) {
  violations.push({ code, path, message });
}

function validateEvidenceRefs(
  value: unknown,
  allowed: Set<string>,
  path: string,
  violations: CampaignStrategyViolation[],
) {
  if (!Array.isArray(value) || value.length === 0) {
    addViolation(violations, "STRATEGY_EVIDENCE_REQUIRED", path, "At least one exact evidence reference is required.");
    return;
  }
  const validKeys: string[] = [];
  value.forEach((item, index) => {
    const reference = record(item);
    const referencePath = `${path}/${index}`;
    if (!exactKeys(reference, ["input_kind", "revision_id", "evidence_id"])
      || !INPUT_KINDS.includes(reference.input_kind as CampaignStrategyInputKind)
      || !IDENTIFIER.test(String(reference.revision_id))
      || !IDENTIFIER.test(String(reference.evidence_id))) {
      addViolation(violations, "STRATEGY_EVIDENCE_INVALID", referencePath, "Evidence reference does not match the closed typed contract.");
      return;
    }
    const key = evidenceKey(reference as CampaignStrategyEvidenceRef);
    validKeys.push(key);
    if (!allowed.has(key)) {
      addViolation(violations, "STRATEGY_EVIDENCE_UNKNOWN", referencePath, "Evidence reference is outside the immutable inputs.");
    }
  });
  validKeys.forEach((key, index) => {
    if (validKeys.indexOf(key) !== index) {
      addViolation(violations, "STRATEGY_EVIDENCE_DUPLICATE", `${path}/${index}`, "Evidence reference is repeated.");
    }
  });
}

function validDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validateDimensionValue(
  dimensionId: CampaignStrategyDimensionId,
  value: unknown,
  path: string,
  violations: CampaignStrategyViolation[],
) {
  if (dimensionId === "period") {
    const period = record(value);
    if (!exactKeys(period, ["start_date", "end_date"])
      || !validDate(period.start_date)
      || !validDate(period.end_date)
      || String(period.start_date) > String(period.end_date)) {
      addViolation(violations, "STRATEGY_PERIOD_INVALID", path, "Strategy period must be one exact valid date range.");
    }
    return;
  }
  if (dimensionId === "weekly_budget") {
    if (!Number.isSafeInteger(value) || Number(value) <= 0) {
      addViolation(violations, "STRATEGY_WEEKLY_BUDGET_INVALID", path, "Recommended weekly budget must be a positive integer.");
    }
    return;
  }
  if (dimensionId === "target_result_cost") {
    if (value === null) return;
    if (!Number.isSafeInteger(value) || Number(value) <= 0) {
      addViolation(violations, "STRATEGY_TARGET_RESULT_COST_INVALID", path, "Target result cost must be null or a positive integer.");
    }
    return;
  }
  if (!text(value)) {
    addViolation(violations, "STRATEGY_DIMENSION_VALUE_INVALID", path, `${dimensionId} must contain a bounded business value.`);
  }
}

function proposalViolations(value: unknown, input: CampaignStrategyAgentInput) {
  const violations: CampaignStrategyViolation[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    addViolation(violations, "STRATEGY_PROPOSAL_INVALID", "/", "Strategy proposal must be an object.");
    return violations;
  }
  const proposal = value as Record<string, unknown>;
  if (!exactKeys(proposal, ["dimensions", "rationale", "confidence", "conflicts"])) {
    addViolation(violations, "STRATEGY_PROPOSAL_SHAPE_INVALID", "/", "Strategy proposal does not match the closed output schema.");
  }
  if (!text(proposal.rationale, 2_000)) {
    addViolation(violations, "STRATEGY_RATIONALE_INVALID", "/rationale", "Strategy rationale must be non-empty bounded text.");
  }
  if (!["HIGH", "MEDIUM", "LOW"].includes(String(proposal.confidence))) {
    addViolation(violations, "STRATEGY_CONFIDENCE_INVALID", "/confidence", "Strategy confidence must use the typed scale.");
  }
  const allowed = allowedEvidence(input);
  if (!Array.isArray(proposal.dimensions)) {
    addViolation(violations, "STRATEGY_DIMENSIONS_INCOMPLETE", "/dimensions", "Campaign Strategy must contain all twelve dimensions once.");
  } else {
    const dimensionIds = proposal.dimensions.map((dimension) => record(dimension).dimension_id);
    if (JSON.stringify(dimensionIds) !== JSON.stringify(CAMPAIGN_STRATEGY_DIMENSIONS)) {
      addViolation(violations, "STRATEGY_DIMENSIONS_INCOMPLETE", "/dimensions", "Campaign Strategy must contain all twelve dimensions once and in canonical order.");
    }
    proposal.dimensions.forEach((item, index) => {
      const dimension = record(item);
      const path = `/dimensions/${index}`;
      if (!item || typeof item !== "object" || Array.isArray(item)
        || !exactKeys(dimension, ["dimension_id", "value", "rationale", "confidence", "evidence_refs"])) {
        addViolation(violations, "STRATEGY_DIMENSION_INVALID", path, "Strategy dimension does not match the closed schema.");
      }
      if (!CAMPAIGN_STRATEGY_DIMENSIONS.includes(dimension.dimension_id as CampaignStrategyDimensionId)) {
        addViolation(violations, "STRATEGY_DIMENSION_UNKNOWN", `${path}/dimension_id`, "Strategy dimension identifier is unknown.");
      } else {
        validateDimensionValue(dimension.dimension_id as CampaignStrategyDimensionId, dimension.value, `${path}/value`, violations);
      }
      if (!text(dimension.rationale, 2_000)) {
        addViolation(violations, "STRATEGY_DIMENSION_RATIONALE_INVALID", `${path}/rationale`, "Dimension rationale must be non-empty bounded text.");
      }
      if (!["HIGH", "MEDIUM", "LOW"].includes(String(dimension.confidence))) {
        addViolation(violations, "STRATEGY_DIMENSION_CONFIDENCE_INVALID", `${path}/confidence`, "Dimension confidence must use the typed scale.");
      }
      validateEvidenceRefs(dimension.evidence_refs, allowed, `${path}/evidence_refs`, violations);
    });
  }
  if (!Array.isArray(proposal.conflicts)) {
    addViolation(violations, "STRATEGY_CONFLICTS_INVALID", "/conflicts", "Strategy conflicts must be a typed array.");
  } else {
    proposal.conflicts.forEach((item, index) => {
      const conflict = record(item);
      const path = `/conflicts/${index}`;
      if (!item || typeof item !== "object" || Array.isArray(item)
        || !exactKeys(conflict, ["code", "description", "evidence_refs"])
        || !CONFLICT_CODE.test(String(conflict.code))
        || !text(conflict.description, 2_000)) {
        addViolation(violations, "STRATEGY_CONFLICT_INVALID", path, "Strategy conflict does not match the typed contract.");
      }
      validateEvidenceRefs(conflict.evidence_refs, allowed, `${path}/evidence_refs`, violations);
      addViolation(violations, "STRATEGY_CONFLICT_UNRESOLVED", path, "A Strategy with a substantive unresolved conflict cannot be accepted.");
    });
  }
  return violations;
}

function validationPackage(attempt: 1 | 2, violations: CampaignStrategyViolation[]): CampaignStrategyValidationPackage {
  return deepFreeze({
    schema_version: CAMPAIGN_STRATEGY_VALIDATION_SCHEMA,
    status: "CONTENT_REJECTED",
    attempt,
    violations: clone(violations),
  }) as CampaignStrategyValidationPackage;
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
  const request = (attempt: 1 | 2, repair: CampaignStrategyAgentRequest["repair"]) => deepFreeze({
    ...immutableInputs,
    contract: { name: CAMPAIGN_STRATEGY_AGENT_CONTRACT, version: CAMPAIGN_STRATEGY_AGENT_VERSION },
    attempt,
    repair,
    authority: {
      external_read: false,
      persistence: false,
      adjacent_stage_mutation: false,
      mandate_grant: false,
      publication: false,
      spend: false,
    },
  } satisfies CampaignStrategyAgentRequest);

  const firstProposal = normalizeProposal(await input.model.formCampaignStrategy(request(1, null)));
  const firstViolations = proposalViolations(firstProposal, immutableInputs);
  let proposal: CampaignStrategyAgentProposal;
  if (firstViolations.length === 0) {
    proposal = firstProposal as CampaignStrategyAgentProposal;
  } else {
    const firstValidation = validationPackage(1, firstViolations);
    const secondProposal = normalizeProposal(await input.model.formCampaignStrategy(request(2, {
      rejected_proposal: clone(firstProposal),
      validation: firstValidation,
    })));
    const secondViolations = proposalViolations(secondProposal, immutableInputs);
    if (secondViolations.length > 0) {
      const secondValidation = validationPackage(2, secondViolations);
      const details = deepFreeze({
        status: "TECHNICAL_FAILURE" as const,
        reason: "STRATEGY_CONTENT_REJECTED_TWICE" as const,
        validation_attempts: [firstValidation, secondValidation] as [CampaignStrategyValidationPackage, CampaignStrategyValidationPackage],
      }) as CampaignStrategyTechnicalFailure;
      throw new CampaignStrategyAgentError(
        "TECHNICAL_FAILURE",
        "Campaign Strategy failed consolidated content validation twice.",
        details,
      );
    }
    proposal = secondProposal as CampaignStrategyAgentProposal;
  }

  const inputLineage = {
    goal_revision: reference(immutableInputs.goal_revision),
    business_input: reference(immutableInputs.business_input),
    analytics_evidence_snapshot: reference(immutableInputs.analytics_evidence_snapshot),
    policies: immutableInputs.policies.map(reference),
    supported_draft_profile: reference(immutableInputs.supported_draft_profile),
    campaign_playbook: reference(immutableInputs.campaign_playbook),
  };
  const playbookSnapshot = immutableInputs.campaign_playbook.content as CampaignPlaybookStrategySnapshot;
  const playbookLineage = {
    release: clone(playbookSnapshot.release),
    promotion_policy: clone(playbookSnapshot.promotion_policy),
    applied_rules: playbookSnapshot.applicable_rules.map(({ rule_id, rule_version, content_digest }) => ({
      rule_id,
      rule_version,
      content_digest,
    })),
  };
  const identity = {
    contract: { name: CAMPAIGN_STRATEGY_AGENT_CONTRACT, version: CAMPAIGN_STRATEGY_AGENT_VERSION } as const,
    accepted_at: input.acceptedAt,
    accepted_by: { kind: "STRATEGY_AGENT" as const, model_id: input.model.model_id },
    input_lineage: inputLineage,
    playbook_lineage: playbookLineage,
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
    playbook_lineage: playbookLineage,
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

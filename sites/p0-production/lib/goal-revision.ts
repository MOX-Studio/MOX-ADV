const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u;

export const GOAL_CANDIDATE_SCHEMA = "p0-goal-candidate-v1";
export const GOAL_REVISION_SCHEMA = "p0-goal-revision-v1";
export const GOAL_REVISION_CONTRACT_VERSION = "1.0.0";

export type GoalInputReference = {
  input_id: string;
  schema_version: string;
  revision_id: string;
  digest: string;
};

export type GoalEvidenceReference = {
  supports: "DESIRED_OUTCOME" | "QUALIFIED_ACTION";
  input_id: string;
  locator: string;
  evidence: string;
};

export type GoalCandidateOption = {
  option_id: string;
  desired_outcome: string;
  qualified_action: string;
  evidence: GoalEvidenceReference[];
  consequences: string[];
  recommended: boolean;
};

export type GoalCandidate = {
  schema_version: typeof GOAL_CANDIDATE_SCHEMA;
  desired_outcome: string;
  qualified_action: string;
  used_input_ids: string[];
  provenance: GoalEvidenceReference[];
  known_constraints: Array<{
    constraint: string;
    input_ids: string[];
  }>;
  material_ambiguity: null | {
    reason: string;
    options: GoalCandidateOption[];
  };
};

export type GoalRevision = {
  schema_version: typeof GOAL_REVISION_SCHEMA;
  contract_version: typeof GOAL_REVISION_CONTRACT_VERSION;
  goal_revision_id: string;
  version: number;
  digest: string;
  desired_outcome: string;
  qualified_action: string;
  exact_inputs: GoalInputReference[];
  provenance: GoalEvidenceReference[];
  known_constraints: GoalCandidate["known_constraints"];
  validation: {
    status: "VERIFIED";
    validator: "DETERMINISTIC_CODE";
    owner_confirmation_required: false;
    verified_at: string;
  };
};

export type GoalMaterialDecision = {
  status: "MATERIAL_DECISION_REQUIRED";
  reason: string;
  recommendation: string;
  options: Array<{
    option_id: string;
    desired_outcome: string;
    qualified_action: string;
    evidence: GoalEvidenceReference[];
    consequences: string[];
    recommended: boolean;
  }>;
};

export type GoalFormationResult =
  | { status: "VERIFIED"; revision: GoalRevision }
  | GoalMaterialDecision;

export class GoalRevisionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GoalRevisionError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new GoalRevisionError(code, message);
}

function exactKeys(value: object, keys: string[]) {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function normalizedText(value: unknown, label: string, maximum = 1_000) {
  const text = String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!text || text.length > maximum) fail("GOAL_CANDIDATE_INVALID", `${label} is required and must be at most ${maximum} characters.`);
  return text;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalize(item)]));
}

async function digest(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(hash)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

function validateInputReferences(input: GoalInputReference[]) {
  if (!Array.isArray(input) || input.length < 1) fail("GOAL_INPUTS_INVALID", "At least one exact Goal input is required.");
  const ids = new Set<string>();
  for (const reference of input) {
    if (!reference || typeof reference !== "object" || !exactKeys(reference, ["input_id", "schema_version", "revision_id", "digest"])
      || !IDENTIFIER.test(String(reference.input_id))
      || !IDENTIFIER.test(String(reference.revision_id))
      || !normalizedText(reference.schema_version, "Input schema version", 255)
      || !SHA256_DIGEST.test(String(reference.digest))
      || ids.has(reference.input_id)) {
      fail("GOAL_INPUTS_INVALID", "Goal inputs must be unique exact version references.");
    }
    ids.add(reference.input_id);
  }
  return ids;
}

function validateEvidence(value: unknown, availableInputs: Set<string>): GoalEvidenceReference {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !exactKeys(value, ["supports", "input_id", "locator", "evidence"])) {
    fail("GOAL_PROVENANCE_INVALID", "Goal evidence must use the closed provenance schema.");
  }
  const evidence = value as GoalEvidenceReference;
  if (!availableInputs.has(evidence.input_id) || !["DESIRED_OUTCOME", "QUALIFIED_ACTION"].includes(evidence.supports)) {
    fail("GOAL_PROVENANCE_INVALID", "Goal evidence must support one typed field from the exact input set.");
  }
  return {
    supports: evidence.supports,
    input_id: evidence.input_id,
    locator: normalizedText(evidence.locator, "Evidence locator", 500),
    evidence: normalizedText(evidence.evidence, "Evidence", 1_000),
  };
}

function normalizeCandidate(candidate: GoalCandidate, exactInputs: GoalInputReference[]): GoalCandidate {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)
    || !exactKeys(candidate, ["schema_version", "desired_outcome", "qualified_action", "used_input_ids", "provenance", "known_constraints", "material_ambiguity"])
    || candidate.schema_version !== GOAL_CANDIDATE_SCHEMA) {
    fail("GOAL_CANDIDATE_INVALID", "Goal Agent candidate does not match the closed schema.");
  }
  const availableInputs = validateInputReferences(exactInputs);
  if (!Array.isArray(candidate.used_input_ids) || candidate.used_input_ids.length < 1
    || new Set(candidate.used_input_ids).size !== candidate.used_input_ids.length
    || candidate.used_input_ids.some((inputId) => !availableInputs.has(inputId))) {
    fail("GOAL_INPUTS_INVALID", "The candidate must name every used input from the exact input set.");
  }
  const usedInputs = new Set(candidate.used_input_ids);
  if (!Array.isArray(candidate.provenance) || candidate.provenance.length < 1) {
    fail("GOAL_PROVENANCE_INVALID", "Desired outcome and qualified action require evidence.");
  }
  const provenance = candidate.provenance.map((item) => validateEvidence(item, usedInputs));
  if (!provenance.some((item) => item.supports === "DESIRED_OUTCOME")
    || !provenance.some((item) => item.supports === "QUALIFIED_ACTION")) {
    fail("GOAL_PROVENANCE_INVALID", "Desired outcome and qualified action each require typed provenance.");
  }
  if (!Array.isArray(candidate.known_constraints)) fail("GOAL_CONSTRAINTS_INVALID", "Known constraints must be an explicit array.");
  const knownConstraints = candidate.known_constraints.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || !exactKeys(item, ["constraint", "input_ids"])
      || !Array.isArray(item.input_ids) || item.input_ids.length < 1
      || new Set(item.input_ids).size !== item.input_ids.length
      || item.input_ids.some((inputId) => !usedInputs.has(inputId))) {
      fail("GOAL_CONSTRAINTS_INVALID", "Each known constraint must link to one or more used inputs.");
    }
    return {
      constraint: normalizedText(item.constraint, "Known constraint", 1_000),
      input_ids: [...item.input_ids],
    };
  });
  const normalized: GoalCandidate = {
    schema_version: GOAL_CANDIDATE_SCHEMA,
    desired_outcome: normalizedText(candidate.desired_outcome, "Desired business outcome"),
    qualified_action: normalizedText(candidate.qualified_action, "Qualified action"),
    used_input_ids: [...candidate.used_input_ids],
    provenance,
    known_constraints: knownConstraints,
    material_ambiguity: null,
  };
  if (candidate.material_ambiguity === null) return normalized;
  const ambiguity = candidate.material_ambiguity;
  if (!ambiguity || typeof ambiguity !== "object" || Array.isArray(ambiguity)
    || !exactKeys(ambiguity, ["reason", "options"])
    || !Array.isArray(ambiguity.options) || ambiguity.options.length < 2 || ambiguity.options.length > 5) {
    fail("GOAL_AMBIGUITY_INVALID", "Material ambiguity requires two to five prepared options.");
  }
  const options = ambiguity.options.map((option) => {
    if (!option || typeof option !== "object" || Array.isArray(option)
      || !exactKeys(option, ["option_id", "desired_outcome", "qualified_action", "evidence", "consequences", "recommended"])
      || !IDENTIFIER.test(String(option.option_id))
      || !Array.isArray(option.evidence) || option.evidence.length < 1
      || !Array.isArray(option.consequences) || option.consequences.length < 1
      || typeof option.recommended !== "boolean") {
      fail("GOAL_AMBIGUITY_INVALID", "Each Goal option needs evidence, consequences, and a recommendation flag.");
    }
    return {
      option_id: option.option_id,
      desired_outcome: normalizedText(option.desired_outcome, "Option desired outcome"),
      qualified_action: normalizedText(option.qualified_action, "Option qualified action"),
      evidence: option.evidence.map((item) => validateEvidence(item, usedInputs)),
      consequences: option.consequences.map((item) => normalizedText(item, "Option consequence")),
      recommended: option.recommended,
    };
  });
  if (options.some((option) => !option.evidence.some((item) => item.supports === "DESIRED_OUTCOME")
    || !option.evidence.some((item) => item.supports === "QUALIFIED_ACTION"))) {
    fail("GOAL_PROVENANCE_INVALID", "Every material option needs evidence for its desired outcome and qualified action.");
  }
  const distinctOutcomes = new Set(options.map((option) => option.desired_outcome.toLocaleLowerCase("ru-RU")));
  if (distinctOutcomes.size !== options.length || new Set(options.map((option) => option.option_id)).size !== options.length
    || options.filter((option) => option.recommended).length !== 1) {
    fail("GOAL_AMBIGUITY_NOT_MATERIAL", "Options must have materially different desired outcomes and exactly one recommendation.");
  }
  const recommendation = options.find((option) => option.recommended)!;
  if (recommendation.desired_outcome !== normalized.desired_outcome || recommendation.qualified_action !== normalized.qualified_action) {
    fail("GOAL_AMBIGUITY_INVALID", "The candidate must carry the exact recommended option as its proposed goal.");
  }
  normalized.material_ambiguity = {
    reason: normalizedText(ambiguity.reason, "Material ambiguity reason"),
    options,
  };
  return normalized;
}

function revisionMaterial(revision: Omit<GoalRevision, "goal_revision_id" | "digest">) {
  return revision;
}

export async function verifyGoalCandidate(input: {
  candidate: GoalCandidate;
  exact_inputs: GoalInputReference[];
  verified_at: string;
  previous_version?: number | null;
}): Promise<GoalFormationResult> {
  const candidate = normalizeCandidate(input.candidate, input.exact_inputs);
  const verifiedAt = normalizedText(input.verified_at, "Verification time", 100);
  if (!Number.isFinite(Date.parse(verifiedAt))) fail("GOAL_VERIFICATION_TIME_INVALID", "Goal verification time must be ISO-8601.");
  if (input.previous_version !== undefined && input.previous_version !== null
    && (!Number.isSafeInteger(input.previous_version) || input.previous_version < 1)) {
    fail("GOAL_VERSION_INVALID", "Previous Goal version must be a positive integer.");
  }
  if (candidate.material_ambiguity) {
    const recommended = candidate.material_ambiguity.options.find((option) => option.recommended)!;
    return {
      status: "MATERIAL_DECISION_REQUIRED",
      reason: candidate.material_ambiguity.reason,
      recommendation: recommended.option_id,
      options: structuredClone(candidate.material_ambiguity.options),
    };
  }
  const exactInputById = new Map(input.exact_inputs.map((reference) => [reference.input_id, reference]));
  const base: Omit<GoalRevision, "goal_revision_id" | "digest"> = {
    schema_version: GOAL_REVISION_SCHEMA,
    contract_version: GOAL_REVISION_CONTRACT_VERSION,
    version: (input.previous_version ?? 0) + 1,
    desired_outcome: candidate.desired_outcome,
    qualified_action: candidate.qualified_action,
    exact_inputs: candidate.used_input_ids.map((inputId) => structuredClone(exactInputById.get(inputId)!)),
    provenance: candidate.provenance,
    known_constraints: candidate.known_constraints,
    validation: {
      status: "VERIFIED",
      validator: "DETERMINISTIC_CODE",
      owner_confirmation_required: false,
      verified_at: verifiedAt,
    },
  };
  const materialDigest = await digest(revisionMaterial(base));
  return {
    status: "VERIFIED",
    revision: {
      ...base,
      goal_revision_id: `goal-revision:${materialDigest.slice("sha256:".length, "sha256:".length + 24)}`,
      digest: materialDigest,
    },
  };
}

export async function verifyGoalFormationResult(value: GoalFormationResult) {
  if (value?.status === "MATERIAL_DECISION_REQUIRED") {
    if (!exactKeys(value, ["status", "reason", "recommendation", "options"])) fail("GOAL_RESULT_INVALID", "Goal decision packet contains unknown fields.");
    const candidate: GoalCandidate = {
      schema_version: GOAL_CANDIDATE_SCHEMA,
      desired_outcome: value.options.find((option) => option.recommended)?.desired_outcome ?? "",
      qualified_action: value.options.find((option) => option.recommended)?.qualified_action ?? "",
      used_input_ids: [...new Set(value.options.flatMap((option) => option.evidence.map((item) => item.input_id)))],
      provenance: value.options.flatMap((option) => option.evidence),
      known_constraints: [],
      material_ambiguity: { reason: value.reason, options: value.options },
    };
    const exactInputs = candidate.used_input_ids.map((inputId) => ({
      input_id: inputId,
      schema_version: "decision-packet-check",
      revision_id: `decision-packet:${inputId}`,
      digest: `sha256:${"0".repeat(64)}`,
    }));
    const checked = await verifyGoalCandidate({ candidate, exact_inputs: exactInputs, verified_at: "2000-01-01T00:00:00.000Z" });
    if (checked.status !== "MATERIAL_DECISION_REQUIRED" || checked.recommendation !== value.recommendation) fail("GOAL_RESULT_INVALID", "Goal decision recommendation is inconsistent.");
    return;
  }
  if (value?.status !== "VERIFIED" || !value.revision || !exactKeys(value, ["status", "revision"])) fail("GOAL_RESULT_INVALID", "Goal formation result is invalid.");
  const revision = value.revision;
  if (!exactKeys(revision, ["schema_version", "contract_version", "goal_revision_id", "version", "digest", "desired_outcome", "qualified_action", "exact_inputs", "provenance", "known_constraints", "validation"])
    || revision.schema_version !== GOAL_REVISION_SCHEMA
    || revision.contract_version !== GOAL_REVISION_CONTRACT_VERSION
    || !IDENTIFIER.test(revision.goal_revision_id)
    || !Number.isSafeInteger(revision.version) || revision.version < 1
    || !SHA256_DIGEST.test(revision.digest)
    || !revision.validation || !exactKeys(revision.validation, ["status", "validator", "owner_confirmation_required", "verified_at"])
    || revision.validation.status !== "VERIFIED"
    || revision.validation.validator !== "DETERMINISTIC_CODE"
    || revision.validation?.owner_confirmation_required !== false) {
    fail("GOAL_REVISION_INVALID", "Verified GoalRevision metadata is invalid.");
  }
  const candidate: GoalCandidate = {
    schema_version: GOAL_CANDIDATE_SCHEMA,
    desired_outcome: revision.desired_outcome,
    qualified_action: revision.qualified_action,
    used_input_ids: revision.exact_inputs.map((item) => item.input_id),
    provenance: revision.provenance,
    known_constraints: revision.known_constraints,
    material_ambiguity: null,
  };
  normalizeCandidate(candidate, revision.exact_inputs);
  if (!Number.isFinite(Date.parse(revision.validation.verified_at))) fail("GOAL_REVISION_INVALID", "GoalRevision verification time is invalid.");
  const { goal_revision_id: sealedId, digest: sealedDigest, ...base } = revision;
  if (!sealedId || !sealedDigest) fail("GOAL_REVISION_INVALID", "GoalRevision seal is missing.");
  if (await digest(revisionMaterial(base)) !== revision.digest
    || revision.goal_revision_id !== `goal-revision:${revision.digest.slice("sha256:".length, "sha256:".length + 24)}`) {
    fail("GOAL_REVISION_DIGEST_MISMATCH", "GoalRevision digest does not match its exact contents.");
  }
}

import type { PlaybookApplicability, PlaybookChangedFamily } from "./campaign-playbook.ts";
import { curatedPlaybookContentDigest } from "./campaign-playbook.ts";

export const KNOWLEDGE_CANDIDATE_CONTRACT = "mox-adv.campaign-playbook-knowledge-candidate";
export const KNOWLEDGE_CANDIDATE_VERSION = "1.0.0";
export const PROMOTION_POLICY_CONTRACT = "mox-adv.campaign-playbook-promotion-policy";
export const PROMOTION_POLICY_VERSION = "1.0.0";
export const PROMOTION_ASSESSMENT_CONTRACT = "mox-adv.campaign-playbook-promotion-assessment";
export const PROMOTION_ASSESSMENT_VERSION = "1.0.0";

export type KnowledgeEvidenceLevel = "E0" | "E1" | "E2" | "E3" | "E4";
export type KnowledgeCausalStatus =
  | "NONE"
  | "ASSOCIATIONAL"
  | "QUASI_EXPERIMENTAL"
  | "RANDOMIZED_CAUSAL_LOCAL"
  | "RANDOMIZED_CAUSAL_REPLICATED";
export type KnowledgeEvidenceSourceKind =
  | "OWNER_EDIT"
  | "SINGLE_RESULT"
  | "MODERATION_OUTCOME"
  | "PREREGISTERED_EXPERIMENT_RESULT"
  | "OFFICIAL_GUIDANCE";

export type KnowledgeCandidateEvidence = {
  evidence_id: string;
  content_digest: string;
  source_kind: KnowledgeEvidenceSourceKind;
  observed_at: string;
  scope_key: string;
  independent_result_id: string | null;
  evidence_level: KnowledgeEvidenceLevel;
  causal_status: KnowledgeCausalStatus;
  validity: "PASS" | "FAIL" | "UNKNOWN";
  maturity: "MATURE" | "IMMATURE";
};

export type KnowledgeCandidate = {
  contract: { name: typeof KNOWLEDGE_CANDIDATE_CONTRACT; version: typeof KNOWLEDGE_CANDIDATE_VERSION };
  candidate_id: string;
  candidate_version: string;
  content_digest: string;
  created_at: string;
  supersedes_candidate_digest: string | null;
  rule_family: PlaybookChangedFamily;
  mechanism: string;
  proposed_changed_fields: string[];
  provenance: KnowledgeCandidateEvidence[];
  applicability: PlaybookApplicability;
  contradictions: Array<{
    contradiction_id: string;
    evidence_ids: string[];
    scope_overlap: "NONE" | "MATERIAL";
    status: "RESOLVED" | "UNRESOLVED";
  }>;
  eval: {
    fixture_id: string;
    fixture_digest: string;
    status: "PASS" | "FAIL";
  };
  authority_boundary: {
    effect: "NONE";
    changed_resources: [];
  };
};

export type PromotionDisposition = "QUARANTINED" | "DEMOTED" | "REJECTED";

export type FamilyPromotionRule = {
  rule_family: PlaybookChangedFamily;
  minimum_evidence_level: KnowledgeEvidenceLevel;
  minimum_causal_status: KnowledgeCausalStatus;
  minimum_independent_results: number;
  maximum_evidence_age_days: number;
  require_validity_pass: true;
  require_mature_evidence: true;
  on_insufficient: PromotionDisposition;
  on_stale: PromotionDisposition;
  on_contradiction: PromotionDisposition;
  on_eval_failure: PromotionDisposition;
};

export type PromotionPolicy = {
  contract: { name: typeof PROMOTION_POLICY_CONTRACT; version: typeof PROMOTION_POLICY_VERSION };
  policy_id: string;
  policy_version: string;
  content_digest: string;
  approved_at: string;
  approval: {
    status: "APPROVED";
    actor_id: string;
    actor_role: "KNOWLEDGE_STEWARD";
    decision_id: string;
  };
  automatic_promotion: false;
  candidate_authority_effect: "NONE";
  prohibited_self_promotion_inputs: Array<"OWNER_EDIT" | "SINGLE_RESULT" | "MODERATION_OUTCOME">;
  family_rules: FamilyPromotionRule[];
};

export type EvidenceGate =
  | "AUTHORITY_NEUTRAL"
  | "PROVENANCE_QUALIFIED"
  | "EVIDENCE_LEVEL_SUFFICIENT"
  | "CAUSAL_STATUS_SUFFICIENT"
  | "VALIDITY_PASSED"
  | "EVIDENCE_MATURE"
  | "INDEPENDENT_REPLICATIONS_SUFFICIENT"
  | "EVIDENCE_CURRENT"
  | "NO_UNRESOLVED_CONTRADICTION"
  | "APPLICABILITY_COMPLETE"
  | "EVAL_PASSED";

export type PromotionHardCheck = {
  gate: EvidenceGate;
  status: "PASS" | "FAIL";
  reason_codes: string[];
};

export type PromotionAssessment = {
  contract: { name: typeof PROMOTION_ASSESSMENT_CONTRACT; version: typeof PROMOTION_ASSESSMENT_VERSION };
  assessment_id: string;
  content_digest: string;
  evaluated_at: string;
  candidate: { candidate_id: string; candidate_version: string; content_digest: string };
  policy: { policy_id: string; policy_version: string; content_digest: string };
  disposition: "ELIGIBLE_FOR_STEWARD_REVIEW" | PromotionDisposition;
  automatic_promotion: false;
  authority_effect: "NONE";
  hard_checks: PromotionHardCheck[];
};

export class CampaignPlaybookKnowledgeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CampaignPlaybookKnowledgeError";
    this.code = code;
  }
}

const sha256Pattern = /^sha256:[a-f0-9]{64}$/u;
const semverPattern = /^\d+\.\d+\.\d+$/u;
const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{1,254}$/u;
const families = new Set<PlaybookChangedFamily>([
  "MESSAGE_OFFER",
  "AUDIENCE_SPECIFICITY",
  "QUALIFIED_ACTION",
  "CRITERIA_AUTOTARGETING",
  "PLACEMENT",
  "EXTENSION",
]);
const evidenceLevels: KnowledgeEvidenceLevel[] = ["E0", "E1", "E2", "E3", "E4"];
const causalStatuses: KnowledgeCausalStatus[] = [
  "NONE",
  "ASSOCIATIONAL",
  "QUASI_EXPERIMENTAL",
  "RANDOMIZED_CAUSAL_LOCAL",
  "RANDOMIZED_CAUSAL_REPLICATED",
];
const selfPromotionInputs = new Set<KnowledgeEvidenceSourceKind>(["OWNER_EDIT", "SINGLE_RESULT", "MODERATION_OUTCOME"]);

const text = (value: unknown) => String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
const isoTime = (value: unknown) => {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const uniqueNonempty = (value: unknown) => Array.isArray(value)
  && value.length > 0
  && value.every((item) => Boolean(text(item)))
  && new Set(value.map(text)).size === value.length;
const exactKeys = (value: unknown, keys: string[]) => Boolean(value)
  && typeof value === "object"
  && !Array.isArray(value)
  && JSON.stringify(Object.keys(value as Record<string, unknown>).sort()) === JSON.stringify([...keys].sort());

function unsigned(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "content_digest"));
}

function assertApplicability(value: PlaybookApplicability) {
  if (!exactKeys(value, [
    "campaign_fanout_contract",
    "capability_profile_ids",
    "campaign_types",
    "placements",
    "required_strategy_fields",
    "measurement_statuses",
  ])
    || value.campaign_fanout_contract !== "campaign-fanout-v1"
    || !uniqueNonempty(value.capability_profile_ids)
    || !uniqueNonempty(value.campaign_types)
    || !uniqueNonempty(value.placements)
    || !uniqueNonempty(value.required_strategy_fields)
    || !uniqueNonempty(value.measurement_statuses)) {
    throw new CampaignPlaybookKnowledgeError("KNOWLEDGE_APPLICABILITY_INVALID", "Candidate applicability must be a complete closed predicate.");
  }
}

function assertEvidence(evidence: KnowledgeCandidateEvidence[]) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new CampaignPlaybookKnowledgeError("KNOWLEDGE_PROVENANCE_REQUIRED", "A knowledge candidate requires immutable provenance.");
  }
  const ids = new Set<string>();
  for (const item of evidence) {
    if (!exactKeys(item, [
      "evidence_id", "content_digest", "source_kind", "observed_at", "scope_key", "independent_result_id",
      "evidence_level", "causal_status", "validity", "maturity",
    ])
      || !identifierPattern.test(text(item.evidence_id))
      || ids.has(item.evidence_id)
      || !sha256Pattern.test(item.content_digest)
      || !["OWNER_EDIT", "SINGLE_RESULT", "MODERATION_OUTCOME", "PREREGISTERED_EXPERIMENT_RESULT", "OFFICIAL_GUIDANCE"].includes(item.source_kind)
      || isoTime(item.observed_at) === null
      || !text(item.scope_key)
      || (item.independent_result_id !== null && !identifierPattern.test(text(item.independent_result_id)))
      || !evidenceLevels.includes(item.evidence_level)
      || !causalStatuses.includes(item.causal_status)
      || !["PASS", "FAIL", "UNKNOWN"].includes(item.validity)
      || !["MATURE", "IMMATURE"].includes(item.maturity)) {
      throw new CampaignPlaybookKnowledgeError("KNOWLEDGE_PROVENANCE_INVALID", "Candidate provenance is malformed or duplicated.");
    }
    ids.add(item.evidence_id);
  }
}

export async function assertKnowledgeCandidate(candidate: KnowledgeCandidate) {
  if (!exactKeys(candidate, [
    "contract", "candidate_id", "candidate_version", "content_digest", "created_at", "supersedes_candidate_digest",
    "rule_family", "mechanism", "proposed_changed_fields", "provenance", "applicability", "contradictions", "eval",
    "authority_boundary",
  ])
    || !exactKeys(candidate.contract, ["name", "version"])
    || candidate.contract.name !== KNOWLEDGE_CANDIDATE_CONTRACT
    || candidate.contract.version !== KNOWLEDGE_CANDIDATE_VERSION
    || !identifierPattern.test(text(candidate.candidate_id))
    || !semverPattern.test(candidate.candidate_version)
    || isoTime(candidate.created_at) === null
    || (candidate.supersedes_candidate_digest !== null && !sha256Pattern.test(candidate.supersedes_candidate_digest))
    || !families.has(candidate.rule_family)
    || !text(candidate.mechanism)
    || !uniqueNonempty(candidate.proposed_changed_fields)
    || candidate.proposed_changed_fields.some((pointer) => !pointer.startsWith("/direct/"))) {
    throw new CampaignPlaybookKnowledgeError("KNOWLEDGE_CANDIDATE_INVALID", "Knowledge candidate contract or authority-safe proposal is invalid.");
  }
  assertEvidence(candidate.provenance);
  assertApplicability(candidate.applicability);
  if (!Array.isArray(candidate.contradictions) || candidate.contradictions.some((item) => !exactKeys(item, [
    "contradiction_id", "evidence_ids", "scope_overlap", "status",
  ])
    || !identifierPattern.test(text(item.contradiction_id))
    || !uniqueNonempty(item.evidence_ids)
    || item.evidence_ids.some((id) => !candidate.provenance.some((evidence) => evidence.evidence_id === id))
    || !["NONE", "MATERIAL"].includes(item.scope_overlap)
    || !["RESOLVED", "UNRESOLVED"].includes(item.status))) {
    throw new CampaignPlaybookKnowledgeError("KNOWLEDGE_CONTRADICTIONS_INVALID", "Candidate contradictions must reference preserved evidence.");
  }
  if (!exactKeys(candidate.eval, ["fixture_id", "fixture_digest", "status"])
    || !identifierPattern.test(text(candidate.eval.fixture_id))
    || !sha256Pattern.test(candidate.eval.fixture_digest)
    || !["PASS", "FAIL"].includes(candidate.eval.status)) {
    throw new CampaignPlaybookKnowledgeError("KNOWLEDGE_EVAL_INVALID", "Candidate eval must identify an immutable fixture and typed outcome.");
  }
  if (!exactKeys(candidate.authority_boundary, ["effect", "changed_resources"])
    || candidate.authority_boundary.effect !== "NONE"
    || !Array.isArray(candidate.authority_boundary.changed_resources)
    || candidate.authority_boundary.changed_resources.length !== 0) {
    throw new CampaignPlaybookKnowledgeError("KNOWLEDGE_AUTHORITY_EXPANSION_FORBIDDEN", "Knowledge candidates cannot mutate authority or campaign state.");
  }
  if (!sha256Pattern.test(candidate.content_digest)
    || candidate.content_digest !== await curatedPlaybookContentDigest(unsigned(candidate as unknown as Record<string, unknown>))) {
    throw new CampaignPlaybookKnowledgeError("KNOWLEDGE_CANDIDATE_DIGEST_INVALID", "Knowledge candidate content digest does not match its immutable content.");
  }
}

export async function sealKnowledgeCandidate(
  input: Omit<KnowledgeCandidate, "content_digest"> & { content_digest?: string },
): Promise<KnowledgeCandidate> {
  const candidate = {
    ...input,
    content_digest: await curatedPlaybookContentDigest(unsigned(input as unknown as Record<string, unknown>)),
  } as KnowledgeCandidate;
  await assertKnowledgeCandidate(candidate);
  return structuredClone(candidate);
}

function assertFamilyRule(rule: FamilyPromotionRule) {
  if (!exactKeys(rule, [
    "rule_family", "minimum_evidence_level", "minimum_causal_status", "minimum_independent_results",
    "maximum_evidence_age_days", "require_validity_pass", "require_mature_evidence", "on_insufficient", "on_stale",
    "on_contradiction", "on_eval_failure",
  ])
    || !families.has(rule.rule_family)
    || !evidenceLevels.includes(rule.minimum_evidence_level)
    || !causalStatuses.includes(rule.minimum_causal_status)
    || !Number.isSafeInteger(rule.minimum_independent_results)
    || rule.minimum_independent_results < 2
    || !Number.isSafeInteger(rule.maximum_evidence_age_days)
    || rule.maximum_evidence_age_days < 1
    || rule.require_validity_pass !== true
    || rule.require_mature_evidence !== true
    || ![rule.on_insufficient, rule.on_stale, rule.on_contradiction, rule.on_eval_failure]
      .every((item) => ["QUARANTINED", "DEMOTED", "REJECTED"].includes(item))) {
    throw new CampaignPlaybookKnowledgeError("PROMOTION_FAMILY_RULE_INVALID", "Promotion Policy family rules must define typed fail-closed evidence gates.");
  }
}

export async function assertPromotionPolicy(policy: PromotionPolicy) {
  if (!exactKeys(policy, [
    "contract", "policy_id", "policy_version", "content_digest", "approved_at", "approval", "automatic_promotion",
    "candidate_authority_effect", "prohibited_self_promotion_inputs", "family_rules",
  ])
    || !exactKeys(policy.contract, ["name", "version"])
    || policy.contract.name !== PROMOTION_POLICY_CONTRACT
    || policy.contract.version !== PROMOTION_POLICY_VERSION
    || !identifierPattern.test(text(policy.policy_id))
    || !semverPattern.test(policy.policy_version)
    || isoTime(policy.approved_at) === null
    || !exactKeys(policy.approval, ["status", "actor_id", "actor_role", "decision_id"])
    || policy.approval.status !== "APPROVED"
    || !identifierPattern.test(text(policy.approval.actor_id))
    || policy.approval.actor_role !== "KNOWLEDGE_STEWARD"
    || !identifierPattern.test(text(policy.approval.decision_id))
    || policy.automatic_promotion !== false
    || policy.candidate_authority_effect !== "NONE"
    || !Array.isArray(policy.prohibited_self_promotion_inputs)
    || !policy.prohibited_self_promotion_inputs.every((item) => ["OWNER_EDIT", "SINGLE_RESULT", "MODERATION_OUTCOME"].includes(item))
    || !["OWNER_EDIT", "SINGLE_RESULT", "MODERATION_OUTCOME"].every((item) => policy.prohibited_self_promotion_inputs.includes(item as "OWNER_EDIT" | "SINGLE_RESULT" | "MODERATION_OUTCOME"))
    || new Set(policy.prohibited_self_promotion_inputs).size !== policy.prohibited_self_promotion_inputs.length
    || !Array.isArray(policy.family_rules)
    || policy.family_rules.length === 0) {
    throw new CampaignPlaybookKnowledgeError("PROMOTION_POLICY_INVALID", "Promotion Policy is malformed, unapproved, or permits automatic authority changes.");
  }
  policy.family_rules.forEach(assertFamilyRule);
  if (new Set(policy.family_rules.map((rule) => rule.rule_family)).size !== policy.family_rules.length) {
    throw new CampaignPlaybookKnowledgeError("PROMOTION_POLICY_INVALID", "Promotion Policy must define at most one rule per family.");
  }
  if (!sha256Pattern.test(policy.content_digest)
    || policy.content_digest !== await curatedPlaybookContentDigest(unsigned(policy as unknown as Record<string, unknown>))) {
    throw new CampaignPlaybookKnowledgeError("PROMOTION_POLICY_DIGEST_INVALID", "Promotion Policy content digest does not match its immutable content.");
  }
}

export async function sealPromotionPolicy(
  input: Omit<PromotionPolicy, "content_digest"> & { content_digest?: string },
): Promise<PromotionPolicy> {
  const policy = {
    ...input,
    content_digest: await curatedPlaybookContentDigest(unsigned(input as unknown as Record<string, unknown>)),
  } as PromotionPolicy;
  await assertPromotionPolicy(policy);
  return structuredClone(policy);
}

const pass = (gate: EvidenceGate): PromotionHardCheck => ({ gate, status: "PASS", reason_codes: [] });
const fail = (gate: EvidenceGate, ...reasonCodes: string[]): PromotionHardCheck => ({ gate, status: "FAIL", reason_codes: reasonCodes });

function levelAtLeast(actual: KnowledgeEvidenceLevel, minimum: KnowledgeEvidenceLevel) {
  return evidenceLevels.indexOf(actual) >= evidenceLevels.indexOf(minimum);
}

function causalAtLeast(actual: KnowledgeCausalStatus, minimum: KnowledgeCausalStatus) {
  return causalStatuses.indexOf(actual) >= causalStatuses.indexOf(minimum);
}

export async function evaluateKnowledgeCandidate(
  candidate: KnowledgeCandidate,
  policy: PromotionPolicy,
  evaluatedAt: string,
): Promise<PromotionAssessment> {
  await assertKnowledgeCandidate(candidate);
  await assertPromotionPolicy(policy);
  const evaluatedTime = isoTime(evaluatedAt);
  if (evaluatedTime === null) {
    throw new CampaignPlaybookKnowledgeError("PROMOTION_EVALUATION_TIME_INVALID", "Promotion evaluation requires an exact timestamp.");
  }
  const familyRule = policy.family_rules.find((rule) => rule.rule_family === candidate.rule_family);
  if (!familyRule) {
    throw new CampaignPlaybookKnowledgeError("PROMOTION_FAMILY_POLICY_MISSING", "Promotion Policy has no rule for the candidate family.");
  }

  const qualified = candidate.provenance.filter((item) => !selfPromotionInputs.has(item.source_kind));
  const independentResults = new Set(qualified
    .filter((item) => item.source_kind === "PREREGISTERED_EXPERIMENT_RESULT" && item.independent_result_id)
    .map((item) => item.independent_result_id));
  const ageLimitMs = familyRule.maximum_evidence_age_days * 86_400_000;
  const staleEvidence = qualified.filter((item) => Number(evaluatedTime) - Number(isoTime(item.observed_at)) > ageLimitMs);
  const unresolvedContradictions = candidate.contradictions.filter((item) => item.scope_overlap === "MATERIAL" && item.status === "UNRESOLVED");
  const checks: PromotionHardCheck[] = [
    pass("AUTHORITY_NEUTRAL"),
    qualified.length > 0 ? pass("PROVENANCE_QUALIFIED") : fail("PROVENANCE_QUALIFIED", "SELF_PROMOTION_INPUTS_ONLY"),
    qualified.some((item) => levelAtLeast(item.evidence_level, familyRule.minimum_evidence_level))
      ? pass("EVIDENCE_LEVEL_SUFFICIENT") : fail("EVIDENCE_LEVEL_SUFFICIENT", "MINIMUM_EVIDENCE_LEVEL_NOT_MET"),
    qualified.some((item) => causalAtLeast(item.causal_status, familyRule.minimum_causal_status))
      ? pass("CAUSAL_STATUS_SUFFICIENT") : fail("CAUSAL_STATUS_SUFFICIENT", "MINIMUM_CAUSAL_STATUS_NOT_MET"),
    qualified.length > 0 && qualified.every((item) => item.validity === "PASS")
      ? pass("VALIDITY_PASSED") : fail("VALIDITY_PASSED", "VALIDITY_NOT_PASSED"),
    qualified.length > 0 && qualified.every((item) => item.maturity === "MATURE")
      ? pass("EVIDENCE_MATURE") : fail("EVIDENCE_MATURE", "IMMATURE_EVIDENCE"),
    independentResults.size >= familyRule.minimum_independent_results
      ? pass("INDEPENDENT_REPLICATIONS_SUFFICIENT") : fail("INDEPENDENT_REPLICATIONS_SUFFICIENT", "REPLICATION_REQUIREMENT_NOT_MET"),
    staleEvidence.length === 0 ? pass("EVIDENCE_CURRENT") : fail("EVIDENCE_CURRENT", "STALE_EVIDENCE"),
    unresolvedContradictions.length === 0
      ? pass("NO_UNRESOLVED_CONTRADICTION") : fail("NO_UNRESOLVED_CONTRADICTION", "MATERIAL_CONTRADICTION_UNRESOLVED"),
    pass("APPLICABILITY_COMPLETE"),
    candidate.eval.status === "PASS" ? pass("EVAL_PASSED") : fail("EVAL_PASSED", "CANDIDATE_EVAL_FAILED"),
  ];

  let disposition: PromotionAssessment["disposition"] = "ELIGIBLE_FOR_STEWARD_REVIEW";
  if (unresolvedContradictions.length > 0) disposition = familyRule.on_contradiction;
  else if (staleEvidence.length > 0) disposition = familyRule.on_stale;
  else if (candidate.eval.status !== "PASS") disposition = familyRule.on_eval_failure;
  else if (checks.some((check) => check.status === "FAIL")) disposition = familyRule.on_insufficient;

  const assessmentWithoutDigest = {
    contract: { name: PROMOTION_ASSESSMENT_CONTRACT, version: PROMOTION_ASSESSMENT_VERSION } as const,
    assessment_id: `promotion:${candidate.candidate_id}:${candidate.candidate_version}:${policy.policy_id}:${policy.policy_version}:${evaluatedAt}`,
    evaluated_at: evaluatedAt,
    candidate: {
      candidate_id: candidate.candidate_id,
      candidate_version: candidate.candidate_version,
      content_digest: candidate.content_digest,
    },
    policy: {
      policy_id: policy.policy_id,
      policy_version: policy.policy_version,
      content_digest: policy.content_digest,
    },
    disposition,
    automatic_promotion: false as const,
    authority_effect: "NONE" as const,
    hard_checks: checks,
  };
  return {
    ...assessmentWithoutDigest,
    content_digest: await curatedPlaybookContentDigest(assessmentWithoutDigest),
  };
}

export async function assertPromotionAssessment(assessment: PromotionAssessment) {
  const expectedGates: EvidenceGate[] = [
    "AUTHORITY_NEUTRAL",
    "PROVENANCE_QUALIFIED",
    "EVIDENCE_LEVEL_SUFFICIENT",
    "CAUSAL_STATUS_SUFFICIENT",
    "VALIDITY_PASSED",
    "EVIDENCE_MATURE",
    "INDEPENDENT_REPLICATIONS_SUFFICIENT",
    "EVIDENCE_CURRENT",
    "NO_UNRESOLVED_CONTRADICTION",
    "APPLICABILITY_COMPLETE",
    "EVAL_PASSED",
  ];
  if (!exactKeys(assessment, [
    "contract", "assessment_id", "content_digest", "evaluated_at", "candidate", "policy", "disposition",
    "automatic_promotion", "authority_effect", "hard_checks",
  ])
    || !exactKeys(assessment.contract, ["name", "version"])
    || assessment.contract.name !== PROMOTION_ASSESSMENT_CONTRACT
    || assessment.contract.version !== PROMOTION_ASSESSMENT_VERSION
    || !text(assessment.assessment_id)
    || isoTime(assessment.evaluated_at) === null
    || !exactKeys(assessment.candidate, ["candidate_id", "candidate_version", "content_digest"])
    || !identifierPattern.test(text(assessment.candidate.candidate_id))
    || !semverPattern.test(assessment.candidate.candidate_version)
    || !sha256Pattern.test(assessment.candidate.content_digest)
    || !exactKeys(assessment.policy, ["policy_id", "policy_version", "content_digest"])
    || !identifierPattern.test(text(assessment.policy.policy_id))
    || !semverPattern.test(assessment.policy.policy_version)
    || !sha256Pattern.test(assessment.policy.content_digest)
    || !["ELIGIBLE_FOR_STEWARD_REVIEW", "QUARANTINED", "DEMOTED", "REJECTED"].includes(assessment.disposition)
    || assessment.automatic_promotion !== false
    || assessment.authority_effect !== "NONE"
    || !Array.isArray(assessment.hard_checks)
    || assessment.hard_checks.length !== expectedGates.length
    || assessment.hard_checks.some((check) => !exactKeys(check, ["gate", "status", "reason_codes"])
      || !expectedGates.includes(check.gate)
      || !["PASS", "FAIL"].includes(check.status)
      || !Array.isArray(check.reason_codes)
      || check.reason_codes.some((reason) => !text(reason))
      || (check.status === "PASS" && check.reason_codes.length !== 0)
      || (check.status === "FAIL" && check.reason_codes.length === 0))
    || new Set(assessment.hard_checks.map((check) => check.gate)).size !== expectedGates.length
    || !sha256Pattern.test(assessment.content_digest)
    || assessment.content_digest !== await curatedPlaybookContentDigest(unsigned(assessment as unknown as Record<string, unknown>))) {
    throw new CampaignPlaybookKnowledgeError("PROMOTION_ASSESSMENT_INVALID", "Promotion assessment integrity or authority boundary is invalid.");
  }
}

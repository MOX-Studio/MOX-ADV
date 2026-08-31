import {
  assertPromotionAssessment,
  assertPromotionPolicy,
  CampaignPlaybookKnowledgeError,
  type PromotionAssessment,
  type PromotionPolicy,
} from "./campaign-playbook-candidates.ts";
import {
  curatedPlaybookContentDigest,
  resolveCuratedPlaybookReleases,
  type CuratedPlaybookRelease,
  type PlaybookApplicationContext,
} from "./campaign-playbook.ts";

export const KNOWLEDGE_STEWARD_DELEGATION_CONTRACT = "mox-adv.campaign-playbook-knowledge-steward-delegation";
export const KNOWLEDGE_STEWARD_DELEGATION_VERSION = "1.0.0";
export const PLAYBOOK_RELEASE_DECISION_CONTRACT = "mox-adv.campaign-playbook-release-decision";
export const PLAYBOOK_RELEASE_DECISION_VERSION = "1.0.0";
export const PLAYBOOK_STRATEGY_SNAPSHOT_SCHEMA = "p0-campaign-playbook-strategy-snapshot-v1";
export const PLAYBOOK_CONSUMPTION_TRACE_SCHEMA = "p0-campaign-playbook-consumption-trace-v1";

export type PlaybookReleaseReference = {
  release_id: string;
  release_version: string;
  content_digest: string;
};

export type PlaybookPolicyReference = {
  policy_id: string;
  policy_version: string;
  content_digest: string;
};

export type AppliedPlaybookRuleReference = {
  rule_id: string;
  rule_version: string;
  content_digest: string;
};

export type KnowledgeStewardDelegation = {
  contract: {
    name: typeof KNOWLEDGE_STEWARD_DELEGATION_CONTRACT;
    version: typeof KNOWLEDGE_STEWARD_DELEGATION_VERSION;
  };
  delegation_id: string;
  delegation_version: string;
  content_digest: string;
  status: "ACTIVE" | "REVOKED";
  steward_id: string;
  delegated_by: {
    actor_id: string;
    actor_role: "MANDATE_OWNER";
    decision_id: string;
  };
  valid_from: string;
  expires_at: string;
  scope: {
    release_ids: string[];
    promotion_policy_ids: string[];
  };
  permissions: {
    activate_release: true;
    stop_playbook_use: true;
    evidence_override: false;
    mandate_grant: false;
    campaign_execution: false;
  };
  supersedes_delegation_digest: string | null;
};

export type PlaybookReleaseDecision = {
  contract: {
    name: typeof PLAYBOOK_RELEASE_DECISION_CONTRACT;
    version: typeof PLAYBOOK_RELEASE_DECISION_VERSION;
  };
  decision_id: string;
  content_digest: string;
  action: "ACTIVATE_RELEASE" | "STOP_PLAYBOOK_USE";
  decided_at: string;
  actor: {
    actor_id: string;
    actor_role: "KNOWLEDGE_STEWARD";
  };
  delegation: {
    delegation_id: string;
    delegation_version: string;
    content_digest: string;
  };
  release: PlaybookReleaseReference;
  promotion_policy: PlaybookPolicyReference;
  approved_rules: Array<{
    rule: AppliedPlaybookRuleReference;
    assessment: {
      assessment_id: string;
      content_digest: string;
    };
  }>;
  reason: string;
  authority: {
    evidence_override: false;
    mandate_grant: false;
    campaign_execution: false;
    campaign_publication: false;
    spend: false;
  };
};

export type CampaignPlaybookStrategySnapshot = {
  schema_version: typeof PLAYBOOK_STRATEGY_SNAPSHOT_SCHEMA;
  status: "ACTIVE_APPROVED";
  release: PlaybookReleaseReference;
  promotion_policy: PlaybookPolicyReference;
  activation_decision: {
    decision_id: string;
    content_digest: string;
  };
  steward_delegation: {
    delegation_id: string;
    delegation_version: string;
    content_digest: string;
  };
  applicable_rules: Array<AppliedPlaybookRuleReference & {
    changed_family: string;
    mechanism: string;
    changed_fields: string[];
    assessment_id: string;
    assessment_digest: string;
  }>;
  authority: {
    evidence_override: false;
    mandate_grant: false;
    campaign_execution: false;
    campaign_publication: false;
    spend: false;
  };
};

export type CampaignPlaybookConsumptionTrace = {
  schema_version: typeof PLAYBOOK_CONSUMPTION_TRACE_SCHEMA;
  trace_id: string;
  content_digest: string;
  evaluated_at: string;
  outcome: "APPLIED" | "STOPPED" | "BLOCKED";
  reason_codes: string[];
  release: PlaybookReleaseReference | null;
  promotion_policy: PlaybookPolicyReference | null;
  steward_decision: { decision_id: string; content_digest: string } | null;
  steward_delegation: { delegation_id: string; delegation_version: string; content_digest: string } | null;
  applied_rules: AppliedPlaybookRuleReference[];
  authority: {
    evidence_override: false;
    mandate_grant: false;
    campaign_execution: false;
    campaign_publication: false;
    spend: false;
  };
};

export type CampaignPlaybookConsumption = {
  snapshot: CampaignPlaybookStrategySnapshot | null;
  trace: CampaignPlaybookConsumptionTrace;
};

export class CampaignPlaybookGovernanceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CampaignPlaybookGovernanceError";
    this.code = code;
  }
}

const sha256Pattern = /^sha256:[a-f0-9]{64}$/u;
const semverPattern = /^\d+\.\d+\.\d+$/u;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,254}$/u;
const authorityBoundary = Object.freeze({
  evidence_override: false as const,
  mandate_grant: false as const,
  campaign_execution: false as const,
  campaign_publication: false as const,
  spend: false as const,
});

const text = (value: unknown) => String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
const exactKeys = (value: unknown, keys: string[]) => Boolean(value)
  && typeof value === "object"
  && !Array.isArray(value)
  && JSON.stringify(Object.keys(value as Record<string, unknown>).sort()) === JSON.stringify([...keys].sort());
const isoTime = (value: unknown) => {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const uniqueIdentifiers = (value: unknown) => Array.isArray(value)
  && value.length > 0
  && value.every((item) => identifierPattern.test(text(item)))
  && new Set(value.map(text)).size === value.length;

function unsigned(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "content_digest"));
}

function releaseReference(release: CuratedPlaybookRelease): PlaybookReleaseReference {
  return {
    release_id: release.release_id,
    release_version: release.release_version,
    content_digest: release.content_digest,
  };
}

function policyReference(policy: PromotionPolicy): PlaybookPolicyReference {
  return {
    policy_id: policy.policy_id,
    policy_version: policy.policy_version,
    content_digest: policy.content_digest,
  };
}

function sameRelease(left: PlaybookReleaseReference, right: PlaybookReleaseReference) {
  return left.release_id === right.release_id
    && left.release_version === right.release_version
    && left.content_digest === right.content_digest;
}

function samePolicy(left: PlaybookPolicyReference, right: PlaybookPolicyReference) {
  return left.policy_id === right.policy_id
    && left.policy_version === right.policy_version
    && left.content_digest === right.content_digest;
}

function validReleaseReference(value: unknown): value is PlaybookReleaseReference {
  if (!exactKeys(value, ["release_id", "release_version", "content_digest"])) return false;
  const reference = value as PlaybookReleaseReference;
  return identifierPattern.test(text(reference.release_id))
    && semverPattern.test(reference.release_version)
    && sha256Pattern.test(reference.content_digest);
}

function validPolicyReference(value: unknown): value is PlaybookPolicyReference {
  if (!exactKeys(value, ["policy_id", "policy_version", "content_digest"])) return false;
  const reference = value as PlaybookPolicyReference;
  return identifierPattern.test(text(reference.policy_id))
    && semverPattern.test(reference.policy_version)
    && sha256Pattern.test(reference.content_digest);
}

function validRuleReference(value: unknown): value is AppliedPlaybookRuleReference {
  if (!exactKeys(value, ["rule_id", "rule_version", "content_digest"])) return false;
  const reference = value as AppliedPlaybookRuleReference;
  return identifierPattern.test(text(reference.rule_id))
    && semverPattern.test(reference.rule_version)
    && sha256Pattern.test(reference.content_digest);
}

export async function assertKnowledgeStewardDelegation(delegation: KnowledgeStewardDelegation) {
  if (!exactKeys(delegation, [
    "contract", "delegation_id", "delegation_version", "content_digest", "status", "steward_id", "delegated_by",
    "valid_from", "expires_at", "scope", "permissions", "supersedes_delegation_digest",
  ])
    || !exactKeys(delegation.contract, ["name", "version"])
    || delegation.contract.name !== KNOWLEDGE_STEWARD_DELEGATION_CONTRACT
    || delegation.contract.version !== KNOWLEDGE_STEWARD_DELEGATION_VERSION
    || !identifierPattern.test(text(delegation.delegation_id))
    || !semverPattern.test(delegation.delegation_version)
    || !["ACTIVE", "REVOKED"].includes(delegation.status)
    || !identifierPattern.test(text(delegation.steward_id))
    || !exactKeys(delegation.delegated_by, ["actor_id", "actor_role", "decision_id"])
    || !identifierPattern.test(text(delegation.delegated_by.actor_id))
    || delegation.delegated_by.actor_role !== "MANDATE_OWNER"
    || !identifierPattern.test(text(delegation.delegated_by.decision_id))
    || isoTime(delegation.valid_from) === null
    || isoTime(delegation.expires_at) === null
    || Number(isoTime(delegation.valid_from)) >= Number(isoTime(delegation.expires_at))
    || !exactKeys(delegation.scope, ["release_ids", "promotion_policy_ids"])
    || !uniqueIdentifiers(delegation.scope.release_ids)
    || !uniqueIdentifiers(delegation.scope.promotion_policy_ids)
    || !exactKeys(delegation.permissions, [
      "activate_release", "stop_playbook_use", "evidence_override", "mandate_grant", "campaign_execution",
    ])
    || delegation.permissions.activate_release !== true
    || delegation.permissions.stop_playbook_use !== true
    || delegation.permissions.evidence_override !== false
    || delegation.permissions.mandate_grant !== false
    || delegation.permissions.campaign_execution !== false
    || (delegation.supersedes_delegation_digest !== null && !sha256Pattern.test(delegation.supersedes_delegation_digest))) {
    throw new CampaignPlaybookGovernanceError("PLAYBOOK_DELEGATION_INVALID", "Knowledge Steward delegation is malformed or exceeds governance authority.");
  }
  if (!sha256Pattern.test(delegation.content_digest)
    || delegation.content_digest !== await curatedPlaybookContentDigest(unsigned(delegation as unknown as Record<string, unknown>))) {
    throw new CampaignPlaybookGovernanceError("PLAYBOOK_DELEGATION_DIGEST_INVALID", "Knowledge Steward delegation digest does not match its immutable content.");
  }
}

export async function sealKnowledgeStewardDelegation(
  input: Omit<KnowledgeStewardDelegation, "content_digest"> & { content_digest?: string },
): Promise<KnowledgeStewardDelegation> {
  const delegation = {
    ...input,
    content_digest: await curatedPlaybookContentDigest(unsigned(input as unknown as Record<string, unknown>)),
  } as KnowledgeStewardDelegation;
  await assertKnowledgeStewardDelegation(delegation);
  return structuredClone(delegation);
}

export async function assertPlaybookReleaseDecision(decision: PlaybookReleaseDecision) {
  const validAuthority = exactKeys(decision.authority, [
    "evidence_override", "mandate_grant", "campaign_execution", "campaign_publication", "spend",
  ]) && Object.entries(authorityBoundary).every(([key, expected]) => decision.authority[key as keyof typeof decision.authority] === expected);
  if (!exactKeys(decision, [
    "contract", "decision_id", "content_digest", "action", "decided_at", "actor", "delegation", "release",
    "promotion_policy", "approved_rules", "reason", "authority",
  ])
    || !exactKeys(decision.contract, ["name", "version"])
    || decision.contract.name !== PLAYBOOK_RELEASE_DECISION_CONTRACT
    || decision.contract.version !== PLAYBOOK_RELEASE_DECISION_VERSION
    || !identifierPattern.test(text(decision.decision_id))
    || !["ACTIVATE_RELEASE", "STOP_PLAYBOOK_USE"].includes(decision.action)
    || isoTime(decision.decided_at) === null
    || !exactKeys(decision.actor, ["actor_id", "actor_role"])
    || !identifierPattern.test(text(decision.actor.actor_id))
    || decision.actor.actor_role !== "KNOWLEDGE_STEWARD"
    || !exactKeys(decision.delegation, ["delegation_id", "delegation_version", "content_digest"])
    || !identifierPattern.test(text(decision.delegation.delegation_id))
    || !semverPattern.test(decision.delegation.delegation_version)
    || !sha256Pattern.test(decision.delegation.content_digest)
    || !validReleaseReference(decision.release)
    || !validPolicyReference(decision.promotion_policy)
    || !Array.isArray(decision.approved_rules)
    || !text(decision.reason)
    || !validAuthority) {
    throw new CampaignPlaybookGovernanceError("PLAYBOOK_RELEASE_DECISION_INVALID", "Knowledge Steward release decision is malformed or exceeds governance authority.");
  }
  if (decision.action === "ACTIVATE_RELEASE" && decision.approved_rules.length === 0) {
    throw new CampaignPlaybookGovernanceError("PLAYBOOK_RELEASE_DECISION_INVALID", "Activation requires exact eligible rule assessments.");
  }
  if (decision.action === "STOP_PLAYBOOK_USE" && decision.approved_rules.length !== 0) {
    throw new CampaignPlaybookGovernanceError("PLAYBOOK_RELEASE_DECISION_INVALID", "A stop decision cannot rewrite or approve evidence.");
  }
  const ruleIds = new Set<string>();
  for (const item of decision.approved_rules) {
    if (!exactKeys(item, ["rule", "assessment"])
      || !validRuleReference(item.rule)
      || !exactKeys(item.assessment, ["assessment_id", "content_digest"])
      || !text(item.assessment.assessment_id)
      || !sha256Pattern.test(item.assessment.content_digest)
      || ruleIds.has(item.rule.rule_id)) {
      throw new CampaignPlaybookGovernanceError("PLAYBOOK_RELEASE_DECISION_INVALID", "Activation rule assessments must be exact and unique.");
    }
    ruleIds.add(item.rule.rule_id);
  }
  if (!sha256Pattern.test(decision.content_digest)
    || decision.content_digest !== await curatedPlaybookContentDigest(unsigned(decision as unknown as Record<string, unknown>))) {
    throw new CampaignPlaybookGovernanceError("PLAYBOOK_RELEASE_DECISION_DIGEST_INVALID", "Release decision digest does not match its immutable content.");
  }
}

export async function sealPlaybookReleaseDecision(
  input: Omit<PlaybookReleaseDecision, "content_digest"> & { content_digest?: string },
): Promise<PlaybookReleaseDecision> {
  const decision = {
    ...input,
    content_digest: await curatedPlaybookContentDigest(unsigned(input as unknown as Record<string, unknown>)),
  } as PlaybookReleaseDecision;
  await assertPlaybookReleaseDecision(decision);
  return structuredClone(decision);
}

function delegationReference(delegation: KnowledgeStewardDelegation) {
  return {
    delegation_id: delegation.delegation_id,
    delegation_version: delegation.delegation_version,
    content_digest: delegation.content_digest,
  };
}

function sameDelegationReference(decision: PlaybookReleaseDecision, delegation: KnowledgeStewardDelegation) {
  return decision.delegation.delegation_id === delegation.delegation_id
    && decision.delegation.delegation_version === delegation.delegation_version
    && decision.delegation.content_digest === delegation.content_digest;
}

async function finalizeTrace(
  evaluatedAt: string,
  outcome: CampaignPlaybookConsumptionTrace["outcome"],
  reasonCodes: string[],
  release: PlaybookReleaseReference | null,
  policy: PlaybookPolicyReference | null,
  decision: PlaybookReleaseDecision | null,
  delegation: KnowledgeStewardDelegation | null,
  appliedRules: AppliedPlaybookRuleReference[],
): Promise<CampaignPlaybookConsumptionTrace> {
  const identity = {
    schema_version: PLAYBOOK_CONSUMPTION_TRACE_SCHEMA as typeof PLAYBOOK_CONSUMPTION_TRACE_SCHEMA,
    evaluated_at: evaluatedAt,
    outcome,
    reason_codes: [...new Set(reasonCodes)].sort(),
    release,
    promotion_policy: policy,
    steward_decision: decision ? { decision_id: decision.decision_id, content_digest: decision.content_digest } : null,
    steward_delegation: delegation ? delegationReference(delegation) : null,
    applied_rules: appliedRules,
    authority: authorityBoundary,
  };
  const contentDigest = await curatedPlaybookContentDigest(identity);
  return {
    ...identity,
    trace_id: `playbook-consumption:${contentDigest.slice("sha256:".length, "sha256:".length + 24)}`,
    content_digest: contentDigest,
  };
}

export async function assertCampaignPlaybookConsumptionTrace(trace: CampaignPlaybookConsumptionTrace) {
  if (!exactKeys(trace, [
    "schema_version", "trace_id", "content_digest", "evaluated_at", "outcome", "reason_codes", "release",
    "promotion_policy", "steward_decision", "steward_delegation", "applied_rules", "authority",
  ]) || trace.schema_version !== PLAYBOOK_CONSUMPTION_TRACE_SCHEMA || !text(trace.trace_id)
    || !sha256Pattern.test(trace.content_digest) || isoTime(trace.evaluated_at) === null
    || !["APPLIED", "STOPPED", "BLOCKED"].includes(trace.outcome)
    || !Array.isArray(trace.reason_codes) || trace.reason_codes.some((reason) => !text(reason))
    || (trace.release !== null && !validReleaseReference(trace.release))
    || (trace.promotion_policy !== null && !validPolicyReference(trace.promotion_policy))
    || (trace.steward_decision !== null && (!exactKeys(trace.steward_decision, ["decision_id", "content_digest"])
      || !identifierPattern.test(text(trace.steward_decision.decision_id)) || !sha256Pattern.test(trace.steward_decision.content_digest)))
    || (trace.steward_delegation !== null && (!exactKeys(trace.steward_delegation, ["delegation_id", "delegation_version", "content_digest"])
      || !identifierPattern.test(text(trace.steward_delegation.delegation_id))
      || !semverPattern.test(trace.steward_delegation.delegation_version) || !sha256Pattern.test(trace.steward_delegation.content_digest)))
    || !Array.isArray(trace.applied_rules) || trace.applied_rules.some((rule) => !validRuleReference(rule))
    || !exactKeys(trace.authority, ["evidence_override", "mandate_grant", "campaign_execution", "campaign_publication", "spend"])
    || Object.entries(authorityBoundary).some(([key, expected]) => trace.authority[key as keyof typeof trace.authority] !== expected)
    || (trace.outcome === "APPLIED" && (!trace.release || !trace.promotion_policy || !trace.steward_decision
      || !trace.steward_delegation || trace.applied_rules.length === 0 || trace.reason_codes.length !== 0))
    || (trace.outcome === "STOPPED" && (!trace.release || !trace.promotion_policy || !trace.steward_decision
      || !trace.steward_delegation || trace.applied_rules.length !== 0))
    || (trace.outcome === "BLOCKED" && (trace.applied_rules.length !== 0 || trace.reason_codes.length === 0))) {
    throw new CampaignPlaybookGovernanceError("PLAYBOOK_CONSUMPTION_TRACE_INVALID", "Playbook consumption trace is malformed.");
  }
  const unsignedTrace = Object.fromEntries(Object.entries(trace).filter(([key]) => !["trace_id", "content_digest"].includes(key)));
  const expected = await curatedPlaybookContentDigest(unsignedTrace);
  if (trace.content_digest !== expected
    || trace.trace_id !== `playbook-consumption:${expected.slice("sha256:".length, "sha256:".length + 24)}`) {
    throw new CampaignPlaybookGovernanceError("PLAYBOOK_CONSUMPTION_TRACE_INVALID", "Playbook consumption trace integrity failed.");
  }
}

export function campaignPlaybookStrategyRevisionId(snapshot: CampaignPlaybookStrategySnapshot) {
  return `playbook-release:${snapshot.release.release_id}:${snapshot.release.release_version}:${snapshot.release.content_digest.slice("sha256:".length, "sha256:".length + 16)}`;
}

export function assertCampaignPlaybookStrategySnapshot(value: unknown): asserts value is CampaignPlaybookStrategySnapshot {
  if (!exactKeys(value, [
    "schema_version", "status", "release", "promotion_policy", "activation_decision", "steward_delegation",
    "applicable_rules", "authority",
  ])) throw new CampaignPlaybookGovernanceError("STRATEGY_PLAYBOOK_INVALID", "Strategy Playbook snapshot does not match the closed schema.");
  const snapshot = value as CampaignPlaybookStrategySnapshot;
  if (snapshot.schema_version !== PLAYBOOK_STRATEGY_SNAPSHOT_SCHEMA
    || snapshot.status !== "ACTIVE_APPROVED"
    || !validReleaseReference(snapshot.release)
    || !validPolicyReference(snapshot.promotion_policy)
    || !exactKeys(snapshot.activation_decision, ["decision_id", "content_digest"])
    || !identifierPattern.test(text(snapshot.activation_decision.decision_id))
    || !sha256Pattern.test(snapshot.activation_decision.content_digest)
    || !exactKeys(snapshot.steward_delegation, ["delegation_id", "delegation_version", "content_digest"])
    || !identifierPattern.test(text(snapshot.steward_delegation.delegation_id))
    || !semverPattern.test(snapshot.steward_delegation.delegation_version)
    || !sha256Pattern.test(snapshot.steward_delegation.content_digest)
    || !Array.isArray(snapshot.applicable_rules)
    || snapshot.applicable_rules.length === 0
    || snapshot.applicable_rules.some((rule) => !exactKeys(rule, [
      "rule_id", "rule_version", "content_digest", "changed_family", "mechanism", "changed_fields", "assessment_id", "assessment_digest",
    ]) || !validRuleReference({ rule_id: rule.rule_id, rule_version: rule.rule_version, content_digest: rule.content_digest })
      || !text(rule.changed_family) || !text(rule.mechanism)
      || !Array.isArray(rule.changed_fields) || rule.changed_fields.length === 0 || rule.changed_fields.some((field) => !text(field))
      || !text(rule.assessment_id) || !sha256Pattern.test(rule.assessment_digest))
    || new Set(snapshot.applicable_rules.map((rule) => rule.rule_id)).size !== snapshot.applicable_rules.length
    || !exactKeys(snapshot.authority, ["evidence_override", "mandate_grant", "campaign_execution", "campaign_publication", "spend"])
    || Object.entries(authorityBoundary).some(([key, expected]) => snapshot.authority[key as keyof typeof snapshot.authority] !== expected)) {
    throw new CampaignPlaybookGovernanceError("STRATEGY_PLAYBOOK_INVALID", "Strategy Playbook snapshot is not an exact authority-neutral active release.");
  }
}

export async function resolveCampaignPlaybookConsumption(input: {
  releases: CuratedPlaybookRelease[];
  promotionPolicies: PromotionPolicy[];
  promotionAssessments: PromotionAssessment[];
  delegations: KnowledgeStewardDelegation[];
  decisions: PlaybookReleaseDecision[];
  evaluatedAt: string;
  applicability: PlaybookApplicationContext;
}): Promise<CampaignPlaybookConsumption> {
  const evaluatedTime = isoTime(input.evaluatedAt);
  if (evaluatedTime === null) {
    return {
      snapshot: null,
      trace: await finalizeTrace(input.evaluatedAt, "BLOCKED", ["PLAYBOOK_EVALUATION_TIME_INVALID"], null, null, null, null, []),
    };
  }
  const resolved = await resolveCuratedPlaybookReleases(input.releases, {
    evaluatedAt: input.evaluatedAt,
    applicability: input.applicability,
  });
  const release = resolved.release;
  if (!release || resolved.rules.length === 0) {
    return {
      snapshot: null,
      trace: await finalizeTrace(
        input.evaluatedAt,
        "BLOCKED",
        [...resolved.audits.map((audit) => audit.reason_code), ...(release ? ["PLAYBOOK_NO_APPLICABLE_RULES"] : [])],
        release ? releaseReference(release) : null,
        null,
        null,
        null,
        [],
      ),
    };
  }

  try {
    await Promise.all(input.promotionPolicies.map(assertPromotionPolicy));
    await Promise.all(input.promotionAssessments.map(assertPromotionAssessment));
    await Promise.all(input.delegations.map(assertKnowledgeStewardDelegation));
    await Promise.all(input.decisions.map(assertPlaybookReleaseDecision));
  } catch (error) {
    const code = error instanceof CampaignPlaybookKnowledgeError || error instanceof CampaignPlaybookGovernanceError
      ? error.code : "PLAYBOOK_GOVERNANCE_INVALID";
    return {
      snapshot: null,
      trace: await finalizeTrace(input.evaluatedAt, "BLOCKED", [code], releaseReference(release), null, null, null, []),
    };
  }

  const effectivePolicies = input.promotionPolicies.filter((policy) => policy.policy_id === release.promotion_policy.policy_id
    && Number(isoTime(policy.approved_at)) <= evaluatedTime)
    .sort((left, right) => Number(isoTime(left.approved_at)) - Number(isoTime(right.approved_at))
      || left.policy_version.localeCompare(right.policy_version));
  const policy = effectivePolicies.at(-1);
  const previousPolicy = effectivePolicies.at(-2);
  if (!policy
    || (previousPolicy && previousPolicy.approved_at === policy.approved_at)
    || policy.policy_version !== release.promotion_policy.policy_version
    || policy.content_digest !== release.promotion_policy.content_digest) {
    return {
      snapshot: null,
      trace: await finalizeTrace(input.evaluatedAt, "BLOCKED", ["PLAYBOOK_PROMOTION_POLICY_NOT_CURRENT"], releaseReference(release), null, null, null, []),
    };
  }
  const releaseRef = releaseReference(release);
  const policyRef = policyReference(policy);
  const effectiveDecisions = input.decisions.filter((decision) => Number(isoTime(decision.decided_at)) <= evaluatedTime)
    .sort((left, right) => Number(isoTime(left.decided_at)) - Number(isoTime(right.decided_at)) || left.decision_id.localeCompare(right.decision_id));
  if (effectiveDecisions.length === 0) {
    return {
      snapshot: null,
      trace: await finalizeTrace(input.evaluatedAt, "BLOCKED", ["PLAYBOOK_STEWARD_DECISION_MISSING"], releaseRef, policyRef, null, null, []),
    };
  }
  const latest = effectiveDecisions.at(-1)!;
  const previous = effectiveDecisions.at(-2);
  if (previous && previous.decided_at === latest.decided_at) {
    return {
      snapshot: null,
      trace: await finalizeTrace(input.evaluatedAt, "BLOCKED", ["PLAYBOOK_STEWARD_DECISION_AMBIGUOUS"], releaseRef, policyRef, null, null, []),
    };
  }
  const delegation = input.delegations.find((candidate) => sameDelegationReference(latest, candidate));
  const decisionTime = Number(isoTime(latest.decided_at));
  const delegationAuthorized = delegation
    && delegation.status === "ACTIVE"
    && delegation.steward_id === latest.actor.actor_id
    && Number(isoTime(delegation.valid_from)) <= decisionTime
    && decisionTime < Number(isoTime(delegation.expires_at))
    && delegation.scope.release_ids.includes(latest.release.release_id)
    && delegation.scope.promotion_policy_ids.includes(latest.promotion_policy.policy_id);
  if (!delegationAuthorized) {
    return {
      snapshot: null,
      trace: await finalizeTrace(input.evaluatedAt, "BLOCKED", ["PLAYBOOK_STEWARD_DELEGATION_INVALID"], releaseRef, policyRef, latest, null, []),
    };
  }
  if (latest.action === "STOP_PLAYBOOK_USE") {
    return {
      snapshot: null,
      trace: await finalizeTrace(input.evaluatedAt, "STOPPED", ["PLAYBOOK_USE_STOPPED_BY_STEWARD"], releaseRef, policyRef, latest, delegation, []),
    };
  }
  if (!sameRelease(latest.release, releaseRef) || !samePolicy(latest.promotion_policy, policyRef)) {
    return {
      snapshot: null,
      trace: await finalizeTrace(input.evaluatedAt, "BLOCKED", ["PLAYBOOK_STEWARD_DECISION_LINEAGE_MISMATCH"], releaseRef, policyRef, latest, delegation, []),
    };
  }
  if (Number(isoTime(policy.approved_at)) > decisionTime) {
    return {
      snapshot: null,
      trace: await finalizeTrace(input.evaluatedAt, "BLOCKED", ["PLAYBOOK_PROMOTION_POLICY_NOT_CURRENT"], releaseRef, policyRef, latest, delegation, []),
    };
  }

  const approvedAssessments = new Map<string, PromotionAssessment>();
  for (const approval of latest.approved_rules) {
    const releaseRule = release.rules.find((rule) => rule.rule_id === approval.rule.rule_id
      && rule.rule_version === approval.rule.rule_version
      && rule.content_digest === approval.rule.content_digest);
    const assessment = input.promotionAssessments.find((item) => item.assessment_id === approval.assessment.assessment_id
      && item.content_digest === approval.assessment.content_digest);
    const eligible = assessment
      && assessment.disposition === "ELIGIBLE_FOR_STEWARD_REVIEW"
      && assessment.hard_checks.every((check) => check.status === "PASS")
      && assessment.policy.policy_id === policy.policy_id
      && assessment.policy.policy_version === policy.policy_version
      && assessment.policy.content_digest === policy.content_digest
      && Number(isoTime(assessment.evaluated_at)) <= decisionTime;
    if (!releaseRule || !eligible || !assessment) {
      return {
        snapshot: null,
        trace: await finalizeTrace(input.evaluatedAt, "BLOCKED", ["PLAYBOOK_RULE_EVIDENCE_GATE_NOT_PASSED"], releaseRef, policyRef, latest, delegation, []),
      };
    }
    approvedAssessments.set(releaseRule.rule_id, assessment);
  }

  const applicableRules: CampaignPlaybookStrategySnapshot["applicable_rules"] = [];
  for (const rule of resolved.rules) {
    const assessment = approvedAssessments.get(rule.rule_id);
    if (!assessment) {
      return {
        snapshot: null,
        trace: await finalizeTrace(input.evaluatedAt, "BLOCKED", ["PLAYBOOK_RULE_EVIDENCE_GATE_NOT_PASSED"], releaseRef, policyRef, latest, delegation, []),
      };
    }
    applicableRules.push({
      rule_id: rule.rule_id,
      rule_version: rule.rule_version,
      content_digest: rule.content_digest,
      changed_family: rule.changed_family,
      mechanism: rule.mechanism,
      changed_fields: structuredClone(rule.changed_fields),
      assessment_id: assessment.assessment_id,
      assessment_digest: assessment.content_digest,
    });
  }

  const snapshot: CampaignPlaybookStrategySnapshot = {
    schema_version: PLAYBOOK_STRATEGY_SNAPSHOT_SCHEMA,
    status: "ACTIVE_APPROVED",
    release: releaseRef,
    promotion_policy: policyRef,
    activation_decision: { decision_id: latest.decision_id, content_digest: latest.content_digest },
    steward_delegation: delegationReference(delegation),
    applicable_rules: applicableRules,
    authority: authorityBoundary,
  };
  assertCampaignPlaybookStrategySnapshot(snapshot);
  const appliedRules = applicableRules.map(({ rule_id, rule_version, content_digest }) => ({ rule_id, rule_version, content_digest }));
  return {
    snapshot,
    trace: await finalizeTrace(input.evaluatedAt, "APPLIED", [], releaseRef, policyRef, latest, delegation, appliedRules),
  };
}

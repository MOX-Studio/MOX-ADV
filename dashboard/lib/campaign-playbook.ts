export const CURATED_PLAYBOOK_RELEASE_SCHEMA = "p0-curated-playbook-release-v1";
export const CURATED_PLAYBOOK_RELEASE_CONTRACT_VERSION = "1.0.0";
export const PLAYBOOK_RULE_CONTRACT_VERSION = "1.0.0";

export type PlaybookChangedFamily =
  | "MESSAGE_OFFER"
  | "AUDIENCE_SPECIFICITY"
  | "QUALIFIED_ACTION"
  | "CRITERIA_AUTOTARGETING"
  | "PLACEMENT"
  | "EXTENSION";

export type PlaybookApplicability = {
  campaign_fanout_contract: "campaign-fanout-v1" | string;
  capability_profile_ids: string[];
  campaign_types: string[];
  placements: string[];
  required_strategy_fields: string[];
  measurement_statuses: string[];
};

export type PlaybookApplicationContext = {
  campaign_fanout_contract: string;
  capability_profile_id: string;
  campaign_type: string;
  placement: string;
  strategy_fields: string[];
  measurement_status: string;
};

export type CuratedPlaybookRule = {
  rule_id: string;
  rule_version: string;
  contract_version: string;
  content_digest: string;
  state: "ACTIVE" | "QUARANTINED" | "CONTRADICTED" | "DEACTIVATED" | "SUPERSEDED";
  approval_status: "APPROVED" | "UNAPPROVED";
  changed_family: PlaybookChangedFamily;
  mechanism: string;
  changed_fields: string[];
  required_capabilities: string[];
  evidence_quality: number;
  priority: number;
  promotion_policy_id: string;
  qualified_evidence_refs: string[];
  applicability: PlaybookApplicability;
  official_source: {
    authority: "YANDEX_DIRECT";
    title: string;
    url: string;
  };
  observed_at: string;
  review_due_at: string;
  expires_at: string;
  conflicts: Array<{ code: string; effect: "NOT_APPLICABLE" | "FAIL_CLOSED" }>;
  exceptions: Array<{ code: string; effect: "NOT_APPLICABLE" | "FAIL_CLOSED" }>;
  eval_fixture: {
    fixture_id: string;
    path: string;
    expected_outcome: "APPLIED" | "NOT_APPLICABLE" | "FAIL_CLOSED";
  };
  admission: {
    method: "CURATED_PROJECT_RELEASE";
    source_kind: "OFFICIAL_SOURCE_AND_ACCEPTED_PROJECT_DECISION";
    automatic_promotion: false;
    authority_effect: "NONE";
  };
  superseded_by_rule_id: string | null;
};

export type CompetitiveSampleRule = {
  sample_rule_id: string;
  sample_rule_version: string;
  state: "ACTIVE" | "QUARANTINED" | "CONTRADICTED" | "DEACTIVATED";
  approval_status: "APPROVED" | "UNAPPROVED";
  minimum_independent_sources: number;
  required_source_status: "VERIFIED";
  require_pattern_id: true;
  require_evidence_ids: true;
};

export type CuratedPlaybookRelease = {
  schema_version: string;
  contract_version: string;
  release_id: string;
  release_version: string;
  content_digest: string;
  status: "ACTIVE" | "APPROVED" | "QUARANTINED" | "DEACTIVATED" | "SUPERSEDED";
  approval_status: "APPROVED" | "UNAPPROVED";
  observed_at: string;
  review_due_at: string;
  expires_at: string;
  previous_release_digest: string | null;
  promotion_policy: {
    policy_id: string;
    policy_version: string;
    content_digest: string;
  };
  approval_attestation: {
    decision_id: string;
    actor_id: string;
    actor_role: "KNOWLEDGE_STEWARD";
    approved_at: string;
    basis_url: string;
  } | null;
  superseded_by_release_id: string | null;
  rules: CuratedPlaybookRule[];
  competitive_sample_rules: CompetitiveSampleRule[];
};

export type PlaybookAuditRecord = {
  audit_id: string;
  subject_type: "RELEASE" | "RULE" | "COMPETITIVE_SAMPLE_RULE";
  subject_id: string;
  visibility: "HIDDEN";
  reason_code: string;
  release_id: string | null;
  rule_id: string | null;
};

const text = (value: unknown) => String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
const semver = (value: unknown) => /^\d+\.\d+\.\d+$/u.test(text(value));
const sha256Pattern = /^sha256:[a-f0-9]{64}$/u;
const codePattern = /^[A-Z][A-Z0-9_]{1,127}$/u;
const releaseFields = [
  "schema_version", "contract_version", "release_id", "release_version", "content_digest", "status", "approval_status",
  "observed_at", "review_due_at", "expires_at", "previous_release_digest", "promotion_policy", "approval_attestation",
  "superseded_by_release_id", "rules", "competitive_sample_rules",
];
const ruleFields = [
  "rule_id", "rule_version", "contract_version", "content_digest", "state", "approval_status", "changed_family", "mechanism",
  "changed_fields", "required_capabilities", "evidence_quality", "priority", "promotion_policy_id", "qualified_evidence_refs",
  "applicability", "official_source", "observed_at", "review_due_at", "expires_at", "conflicts", "exceptions", "eval_fixture",
  "admission", "superseded_by_rule_id",
];
const allowedFamilies = new Set<PlaybookChangedFamily>([
  "MESSAGE_OFFER",
  "AUDIENCE_SPECIFICITY",
  "QUALIFIED_ACTION",
  "CRITERIA_AUTOTARGETING",
  "PLACEMENT",
  "EXTENSION",
]);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

export async function curatedPlaybookContentDigest(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const result = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(result)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

export async function sealCuratedPlaybookRule(
  input: Omit<CuratedPlaybookRule, "content_digest"> & { content_digest?: string },
): Promise<CuratedPlaybookRule> {
  const unsigned = Object.fromEntries(Object.entries(input).filter(([key]) => key !== "content_digest"));
  return { ...input, content_digest: await curatedPlaybookContentDigest(unsigned) } as CuratedPlaybookRule;
}

export async function sealCuratedPlaybookRelease(
  input: Omit<CuratedPlaybookRelease, "content_digest" | "rules"> & {
    content_digest?: string;
    rules: Array<Omit<CuratedPlaybookRule, "content_digest"> & { content_digest?: string }>;
  },
): Promise<CuratedPlaybookRelease> {
  const rules = await Promise.all((input.rules ?? []).map((rule) => rule.content_digest
    ? rule
    : sealCuratedPlaybookRule(rule)));
  const value = { ...input, rules };
  const unsigned = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "content_digest"));
  return { ...value, content_digest: await curatedPlaybookContentDigest(unsigned) } as CuratedPlaybookRelease;
}

async function contentDigestMatches(value: Record<string, unknown>) {
  if (!sha256Pattern.test(text(value.content_digest))) return false;
  const unsigned = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "content_digest"));
  return value.content_digest === await curatedPlaybookContentDigest(unsigned);
}

function hasExactKeys(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return JSON.stringify(Object.keys(value as Record<string, unknown>).sort()) === JSON.stringify([...keys].sort());
}

function isoTime(value: unknown) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function nonemptyUniqueStrings(value: unknown) {
  return Array.isArray(value) && value.length > 0
    && value.every((item) => Boolean(text(item)))
    && new Set(value.map(text)).size === value.length;
}

function optionalUniqueStrings(value: unknown) {
  return Array.isArray(value)
    && value.every((item) => Boolean(text(item)))
    && new Set(value.map(text)).size === value.length;
}

function officialYandexUrl(value: unknown) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && ["yandex.ru", "www.yandex.ru", "yandex.com", "www.yandex.com"].includes(url.hostname);
  } catch {
    return false;
  }
}

function releaseAudit(release: Partial<CuratedPlaybookRelease>, reasonCode: string): PlaybookAuditRecord {
  const releaseId = text(release.release_id) || null;
  return {
    audit_id: `playbook-release:${releaseId ?? "unknown"}:${reasonCode}`,
    subject_type: "RELEASE",
    subject_id: releaseId ?? "UNKNOWN_RELEASE",
    visibility: "HIDDEN",
    reason_code: reasonCode,
    release_id: releaseId,
    rule_id: null,
  };
}

function ruleAudit(releaseId: string, rule: Partial<CuratedPlaybookRule>, reasonCode: string): PlaybookAuditRecord {
  const ruleId = text(rule.rule_id) || "UNKNOWN_RULE";
  return {
    audit_id: `playbook-rule:${releaseId}:${ruleId}:${reasonCode}`,
    subject_type: "RULE",
    subject_id: ruleId,
    visibility: "HIDDEN",
    reason_code: reasonCode,
    release_id: releaseId,
    rule_id: ruleId,
  };
}

function sampleRuleAudit(releaseId: string, rule: Partial<CompetitiveSampleRule>, reasonCode: string): PlaybookAuditRecord {
  const ruleId = text(rule.sample_rule_id) || "UNKNOWN_SAMPLE_RULE";
  return {
    audit_id: `playbook-sample-rule:${releaseId}:${ruleId}:${reasonCode}`,
    subject_type: "COMPETITIVE_SAMPLE_RULE",
    subject_id: ruleId,
    visibility: "HIDDEN",
    reason_code: reasonCode,
    release_id: releaseId,
    rule_id: ruleId,
  };
}

function datedWindowIsValid(observedAt: unknown, reviewDueAt: unknown, expiresAt: unknown) {
  const observed = isoTime(observedAt);
  const review = isoTime(reviewDueAt);
  const expiry = isoTime(expiresAt);
  return observed !== null && review !== null && expiry !== null && observed < review && review < expiry;
}

function governedEffects(value: unknown) {
  return Array.isArray(value) && value.length > 0 && value.every((item) =>
    hasExactKeys(item, ["code", "effect"])
    && codePattern.test(text((item as Record<string, unknown>).code))
    && ["NOT_APPLICABLE", "FAIL_CLOSED"].includes(text((item as Record<string, unknown>).effect)));
}

function applicabilityIsValid(value: unknown) {
  if (!hasExactKeys(value, [
    "campaign_fanout_contract",
    "capability_profile_ids",
    "campaign_types",
    "placements",
    "required_strategy_fields",
    "measurement_statuses",
  ])) return false;
  const candidate = value as PlaybookApplicability;
  return candidate.campaign_fanout_contract === "campaign-fanout-v1"
    && nonemptyUniqueStrings(candidate.capability_profile_ids)
    && nonemptyUniqueStrings(candidate.campaign_types)
    && nonemptyUniqueStrings(candidate.placements)
    && nonemptyUniqueStrings(candidate.required_strategy_fields)
    && nonemptyUniqueStrings(candidate.measurement_statuses);
}

async function ruleExclusionReason(rule: Partial<CuratedPlaybookRule>, evaluatedAt: number) {
  if (!hasExactKeys(rule, ruleFields)) return "PLAYBOOK_RULE_MALFORMED";
  if (rule.contract_version !== PLAYBOOK_RULE_CONTRACT_VERSION) return "PLAYBOOK_RULE_UNKNOWN_VERSION";
  if (!text(rule.rule_id) || !semver(rule.rule_version) || !allowedFamilies.has(rule.changed_family as PlaybookChangedFamily)
    || !await contentDigestMatches(rule as Record<string, unknown>)) return "PLAYBOOK_RULE_MALFORMED";
  if (!text(rule.mechanism) || !nonemptyUniqueStrings(rule.changed_fields)
    || rule.changed_fields!.some((pointer) => !text(pointer).startsWith("/direct/"))
    || !optionalUniqueStrings(rule.required_capabilities)
    || !Number.isFinite(rule.evidence_quality) || Number(rule.evidence_quality) < 0 || Number(rule.evidence_quality) > 100
    || !Number.isSafeInteger(rule.priority) || !text(rule.promotion_policy_id)
    || !nonemptyUniqueStrings(rule.qualified_evidence_refs)
    || !applicabilityIsValid(rule.applicability)
    || !hasExactKeys(rule.official_source, ["authority", "title", "url"])
    || rule.official_source?.authority !== "YANDEX_DIRECT" || !text(rule.official_source?.title)
    || !officialYandexUrl(rule.official_source?.url)
    || !datedWindowIsValid(rule.observed_at, rule.review_due_at, rule.expires_at)
    || !governedEffects(rule.conflicts) || !governedEffects(rule.exceptions)
    || !hasExactKeys(rule.eval_fixture, ["fixture_id", "path", "expected_outcome"])
    || !text(rule.eval_fixture?.fixture_id) || !text(rule.eval_fixture?.path).startsWith("tests/fixtures/playbook/")
    || !["APPLIED", "NOT_APPLICABLE", "FAIL_CLOSED"].includes(text(rule.eval_fixture?.expected_outcome))
    || !hasExactKeys(rule.admission, ["method", "source_kind", "automatic_promotion", "authority_effect"])) {
    return "PLAYBOOK_RULE_MALFORMED";
  }
  if (rule.admission?.method !== "CURATED_PROJECT_RELEASE"
    || rule.admission?.source_kind !== "OFFICIAL_SOURCE_AND_ACCEPTED_PROJECT_DECISION"
    || rule.admission?.automatic_promotion !== false || rule.admission?.authority_effect !== "NONE") {
    return "PLAYBOOK_RULE_SELF_PROMOTION_FORBIDDEN";
  }
  if (rule.approval_status !== "APPROVED") return "PLAYBOOK_RULE_UNAPPROVED";
  if (rule.state === "QUARANTINED") return "PLAYBOOK_RULE_QUARANTINED";
  if (rule.state === "CONTRADICTED") return "PLAYBOOK_RULE_CONTRADICTED";
  if (rule.state === "DEACTIVATED") return "PLAYBOOK_RULE_DEACTIVATED";
  if (rule.state === "SUPERSEDED" || text(rule.superseded_by_rule_id)) return "PLAYBOOK_RULE_SUPERSEDED";
  if (rule.state !== "ACTIVE") return "PLAYBOOK_RULE_UNKNOWN_STATE";
  if (evaluatedAt >= Number(isoTime(rule.expires_at))) return "PLAYBOOK_RULE_EXPIRED";
  if (evaluatedAt >= Number(isoTime(rule.review_due_at))) return "PLAYBOOK_RULE_STALE";
  return null;
}

function ruleApplies(rule: CuratedPlaybookRule, context: PlaybookApplicationContext | undefined) {
  if (!context) return false;
  const predicate = rule.applicability;
  const availableFields = new Set(context.strategy_fields.map(text));
  return context.campaign_fanout_contract === predicate.campaign_fanout_contract
    && predicate.capability_profile_ids.includes(context.capability_profile_id)
    && predicate.campaign_types.includes(context.campaign_type)
    && predicate.placements.includes(context.placement)
    && predicate.required_strategy_fields.every((field) => availableFields.has(field))
    && predicate.measurement_statuses.includes(context.measurement_status);
}

function sampleRuleExclusionReason(rule: Partial<CompetitiveSampleRule>) {
  if (!text(rule.sample_rule_id) || !semver(rule.sample_rule_version)
    || !Number.isSafeInteger(rule.minimum_independent_sources) || Number(rule.minimum_independent_sources) < 2
    || rule.required_source_status !== "VERIFIED" || rule.require_pattern_id !== true || rule.require_evidence_ids !== true) {
    return "COMPETITIVE_SAMPLE_RULE_MALFORMED";
  }
  if (rule.approval_status !== "APPROVED") return "COMPETITIVE_SAMPLE_RULE_UNAPPROVED";
  if (rule.state !== "ACTIVE") return `COMPETITIVE_SAMPLE_RULE_${text(rule.state) || "UNKNOWN_STATE"}`;
  return null;
}

export async function resolveCuratedPlaybookReleases(
  releases: CuratedPlaybookRelease[],
  options: { evaluatedAt: string; applicability?: PlaybookApplicationContext },
) {
  const audits: PlaybookAuditRecord[] = [];
  const accepted: CuratedPlaybookRelease[] = [];
  const evaluatedAt = isoTime(options?.evaluatedAt);
  if (evaluatedAt === null) {
    audits.push(releaseAudit({}, "PLAYBOOK_EVALUATION_TIME_INVALID"));
    return { release: null, rules: [] as CuratedPlaybookRule[], competitiveSampleRules: [] as CompetitiveSampleRule[], audits };
  }
  for (const release of releases) {
    let reason: string | null = null;
    if (!hasExactKeys(release, releaseFields)) reason = "PLAYBOOK_RELEASE_MALFORMED";
    else if (release.schema_version !== CURATED_PLAYBOOK_RELEASE_SCHEMA
      || release.contract_version !== CURATED_PLAYBOOK_RELEASE_CONTRACT_VERSION) reason = "PLAYBOOK_RELEASE_UNKNOWN_VERSION";
    else if (!text(release.release_id) || !semver(release.release_version) || !Array.isArray(release.rules)
      || !Array.isArray(release.competitive_sample_rules) || !await contentDigestMatches(release as unknown as Record<string, unknown>)
      || !datedWindowIsValid(release.observed_at, release.review_due_at, release.expires_at)
      || (release.previous_release_digest !== null && !sha256Pattern.test(text(release.previous_release_digest)))) reason = "PLAYBOOK_RELEASE_MALFORMED";
    else if (release.approval_status !== "APPROVED"
      || !hasExactKeys(release.promotion_policy, ["policy_id", "policy_version", "content_digest"])
      || !text(release.promotion_policy?.policy_id) || !semver(release.promotion_policy?.policy_version)
      || !sha256Pattern.test(text(release.promotion_policy?.content_digest))
      || !hasExactKeys(release.approval_attestation, ["decision_id", "actor_id", "actor_role", "approved_at", "basis_url"])
      || !text(release.approval_attestation?.decision_id) || !text(release.approval_attestation?.actor_id)
      || release.approval_attestation?.actor_role !== "KNOWLEDGE_STEWARD"
      || isoTime(release.approval_attestation?.approved_at) === null
      || !String(release.approval_attestation?.basis_url ?? "").startsWith("https://github.com/ElJeskos/MOX-ADV/issues/")) reason = "PLAYBOOK_RELEASE_UNAPPROVED";
    else if (release.status !== "ACTIVE") reason = `PLAYBOOK_RELEASE_${text(release.status) || "UNKNOWN_STATE"}`;
    else if (text(release.superseded_by_release_id)) reason = "PLAYBOOK_RELEASE_SUPERSEDED";
    else if (evaluatedAt >= Number(isoTime(release.expires_at))) reason = "PLAYBOOK_RELEASE_EXPIRED";
    else if (evaluatedAt >= Number(isoTime(release.review_due_at))) reason = "PLAYBOOK_RELEASE_STALE";
    if (reason) audits.push(releaseAudit(release, reason));
    else accepted.push(release);
  }
  if (accepted.length !== 1) {
    if (accepted.length === 0) audits.push(releaseAudit({}, "PLAYBOOK_NO_ACTIVE_APPROVED_RELEASE"));
    for (const release of accepted) audits.push(releaseAudit(release, "PLAYBOOK_MULTIPLE_ACTIVE_APPROVED_RELEASES"));
    return { release: null, rules: [] as CuratedPlaybookRule[], competitiveSampleRules: [] as CompetitiveSampleRule[], audits };
  }
  const release = accepted[0];
  const rules: CuratedPlaybookRule[] = [];
  for (const rule of release.rules) {
    const reason = await ruleExclusionReason(rule, evaluatedAt)
      ?? (rule.promotion_policy_id !== release.promotion_policy.policy_id ? "PLAYBOOK_RULE_PROMOTION_POLICY_MISMATCH" : null)
      ?? (!ruleApplies(rule, options.applicability) ? "PLAYBOOK_RULE_NOT_APPLICABLE" : null);
    if (reason) audits.push(ruleAudit(release.release_id, rule, reason));
    else rules.push(rule);
  }
  const competitiveSampleRules: CompetitiveSampleRule[] = [];
  for (const rule of release.competitive_sample_rules) {
    const reason = sampleRuleExclusionReason(rule);
    if (reason) audits.push(sampleRuleAudit(release.release_id, rule, reason));
    else competitiveSampleRules.push(rule);
  }
  return {
    release,
    rules: rules.sort((left, right) => left.priority - right.priority
      || right.evidence_quality - left.evidence_quality
      || left.rule_id.localeCompare(right.rule_id)),
    competitiveSampleRules: competitiveSampleRules.sort((left, right) => left.sample_rule_id.localeCompare(right.sample_rule_id)),
    audits,
  };
}

import { normalizePublicHttpsUrl } from "./site-url.ts";
import {
  buildProductFocusArtifacts,
  type FocusOpportunitySet,
  type OfferCandidateInput,
  type OfferCatalog,
} from "./business-model.ts";
import {
  buildMarketEvidence,
  unavailableWordstatBatch,
  type MarketEvidenceInput,
} from "./market-evidence.ts";
import {
  BOUNDED_COMPETITOR_RESEARCH_SCHEMA,
  buildCompetitorMatrix,
  containsCompetitorPromptInjection,
  containsHiddenCompetitorPerformance,
  createBoundedCompetitorCandidateSet,
  type CompetitorMatrix,
  type CompetitorMatrixRowInput,
} from "./competitor-research.ts";

export const ANALYTICS_EVIDENCE_SCHEMA = "p0-analytics-evidence-v5";
export const ANALYTICS_EVIDENCE_CONTRACT_VERSION = "5.0.0";
const LEGACY_ANALYTICS_EVIDENCE_SCHEMAS = new Set(["p0-analytics-evidence-v1", "p0-analytics-evidence-v2", "p0-analytics-evidence-v3", "p0-analytics-evidence-v4"]);
const CANONICALIZATION_VERSION = "mox-canonical-json-v1";
const NORMALIZER_VERSION = "mox-evidence-normalizer-v2";
const REDACTION_VERSION = "mox-artifact-redaction-v1";
const MAX_RAW_STRING_LENGTH = 1_000;
const MAX_RAW_ARRAY_ITEMS = 50;
const MAX_RAW_OBJECT_KEYS = 50;
const MAX_RAW_DEPTH = 5;

export type EvidenceSourceStatus = "VERIFIED" | "PARTIAL" | "UNAVAILABLE";
export type EvidenceQuality = "A" | "B" | "C" | "D" | "U";
export type ConfidenceVector = {
  quality: "PRIMARY_ONLY" | "MIXED_ALLOWED" | "UNKNOWN";
  freshness: "CURRENT" | "MIXED" | "UNKNOWN";
  consistency: "SINGLE_SOURCE" | "CORROBORATED" | "CONFLICTED" | "NOT_EVALUATED";
  coverage: "COMPLETE_FOR_SCOPE" | "PARTIAL" | "UNKNOWN";
  uncertainty: string[];
};

type ClaimConfidence = {
  quality: EvidenceQuality;
  freshness: "current" | "aging" | "stale" | "unknown";
  consistency: "single" | "corroborated" | "conflicted" | "scope_mismatch" | "not_evaluated";
  coverage: "complete_for_scope" | "sampled_with_denominator" | "partial" | "unknown";
  uncertainty: string[];
  tier: "TIER_1_VERIFIED" | "TIER_2_CORROBORATED" | "TIER_3_INDICATIVE" | "TIER_4_INFERENCE" | "BLOCKED_UNKNOWN";
};

export type EvidenceSource = {
  source_id: string;
  title: string;
  source_kind: string;
  provenance_class: "FIRST_PARTY_PUBLIC" | "OWNER_CONFIRMED" | "DIRECT_OFFICIAL_API" | "METRIKA_OFFICIAL_API" | "COMPETITOR_PUBLIC" | "WORDSTAT_OFFICIAL_API";
  status: EvidenceSourceStatus;
  observed_at: string | null;
  generated_at: string;
  scope: Record<string, unknown>;
  access: "public" | "owner_authorized" | "unavailable";
  collection_policy: Record<string, unknown>;
  versions: { schema: string; extractor: string; policy: string };
  facts: string[];
  limitations: string[];
  evidence_ids: string[];
  manifest_hash: string;
};

export type EvidenceRecord = {
  evidence_id: string;
  record_hash: string;
  source_id: string;
  claim_links: Array<{ claim_id: string; relation: "supports" | "contradicts" }>;
  source_kind: string;
  source_locator: Record<string, unknown>;
  fetched_at: string;
  observed_at: string;
  effective_interval: { from: string | null; to: string | null; basis: "published" | "report_window" | "unknown" };
  scope: Record<string, unknown>;
  collection_policy: Record<string, unknown>;
  extraction: {
    method: string;
    version: string;
    selector_or_jsonpath: string | null;
    request_digest: string | null;
  };
  raw: {
    value: unknown;
    quote?: string;
    sha256: string;
    immutable_pointer: string;
    bounded: {
      maximum_string_length: number;
      maximum_array_items: number;
      maximum_object_keys: number;
      truncated: boolean;
      redactions: string[];
    };
  };
  normalized: Record<string, unknown>;
  transforms: Array<{
    rule_id: string;
    version: string;
    input_sha256: string;
    output_sha256: string;
  }>;
  versions: { schema: string; extractor: string; normalizer: string; redaction: string };
  freshness: { policy_id: string; age_seconds: number | null; status: "fresh" | "aging" | "stale" | "unknown" };
  conflicts: string[];
  limitations: string[];
  quality_flags: string[];
  provider_metadata: Record<string, unknown>;
};

export type EvidenceClaim = {
  claim_id: string;
  claim_hash: string;
  subject: string;
  predicate: string;
  value: unknown;
  normalized: { value: unknown; datatype: string; language?: string; unit?: string };
  classification: "observed" | "owner_confirmed" | "documented_api_fact" | "derived" | "unknown";
  evidence_ids: string[];
  confidence: ClaimConfidence;
};

export type EvidenceConflict = {
  conflict_id: string;
  conflict_hash: string;
  claim_ids: string[];
  predicate: string;
  left_value: unknown;
  right_value: unknown;
  relation: "contradicts" | "supersedes" | "scope_mismatch";
  material: boolean;
  resolution: string;
};

export type EvidenceGap = {
  gap_id: string;
  gap_hash: string;
  code: string;
  source_id: string;
  description: string;
  material: boolean;
  status: "UNAVAILABLE";
  limitations: string[];
};

export type AnalyticsEvidenceBundle = {
  schema_version: typeof ANALYTICS_EVIDENCE_SCHEMA;
  contract_version: typeof ANALYTICS_EVIDENCE_CONTRACT_VERSION;
  snapshot_id: string;
  generated_at: string;
  as_of: string;
  scope: {
    company_host: string;
    direct_client_login: string;
    direct_client_id: string;
    metrika_counter_id: string;
    metrika_goal_id: string;
  };
  immutability: {
    content_addressed: true;
    canonicalization: typeof CANONICALIZATION_VERSION;
    revision_required_for_change: true;
  };
  recommendation_status: "EVIDENCE_READY_WITH_GAPS" | "BLOCKED_UNKNOWN";
  summary: {
    sources_total: number;
    sources_verified: number;
    sources_partial: number;
    sources_unavailable: number;
    claims_supported: number;
    hard_blockers: string[];
  };
  confidence: ConfidenceVector;
  sources: EvidenceSource[];
  claims: EvidenceClaim[];
  evidence: EvidenceRecord[];
  conflicts: EvidenceConflict[];
  gaps: EvidenceGap[];
  material_uncertainties: string[];
  competitor_matrix: CompetitorMatrix | null;
  product_catalog: OfferCatalog;
  focus_opportunities: FocusOpportunitySet;
  market_evidence: Awaited<ReturnType<typeof buildMarketEvidence>>;
  prelaunch_cost: Awaited<ReturnType<typeof buildMarketEvidence>>["cost"];
  versions: {
    schema: string;
    contract: string;
    canonicalization: string;
    normalizer: string;
    redaction: string;
    model_extractor: string;
    direct_adapter: string;
    metrika_adapter: string;
    wordstat_adapter: string;
    competitor_policy: string;
  };
  hashes: {
    input_root_sha256: string;
    sources_sha256: string;
    claims_sha256: string;
    evidence_sha256: string;
    conflicts_sha256: string;
    gaps_sha256: string;
    competitor_matrix_sha256: string;
    product_catalog_sha256: string;
    focus_opportunities_sha256: string;
    market_evidence_sha256: string;
  };
  contract_path: string;
};

type AnalyticsEvidenceInput = {
  site: Record<string, unknown>;
  model: Record<string, unknown>;
  context: Record<string, unknown>;
  generatedAt?: string;
};

type BoundedValue = {
  value: unknown;
  truncated: boolean;
  redactions: Set<string>;
};

export class AnalyticsEvidenceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AnalyticsEvidenceError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new AnalyticsEvidenceError(code, message);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return typeof value === "string" ? value.normalize("NFKC").replace(/\s+/gu, " ").trim() : "";
}

function numberOr(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalizeEvidence(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalizeEvidence).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => compareText(left, right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalizeEvidence(item)}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return "null";
  return JSON.stringify(value) ?? "null";
}

async function contentHash(value: unknown) {
  const bytes = new TextEncoder().encode(canonicalizeEvidence(value));
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(hash)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

function redactText(input: string, redactions: Set<string>) {
  let value = input.normalize("NFKC");
  const replacements: Array<[RegExp, string, string]> = [
    [/\b(?:Authorization\s*:\s*)?(?:Bearer|OAuth|Api-Key)\s+[^\s,;]+/giu, "[REDACTED_CREDENTIAL]", "credential"],
    [/\b(?:access[_-]?token|oauth[_-]?token|api[_-]?key|password|passwd|secret|signature|sig)\s*[=:]\s*[^\s,;&]+/giu, "[REDACTED_CREDENTIAL]", "credential"],
    [/[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu, "[REDACTED_PII]", "pii"],
    [/(?:\+\d(?:[\s().-]*\d){9,15}|\b\d{3}[\s().-]+\d(?:[\s().-]*\d){6,12}\b)/gu, "[REDACTED_PII]", "pii"],
  ];
  for (const [pattern, replacement, label] of replacements) {
    if (pattern.test(value)) redactions.add(label);
    pattern.lastIndex = 0;
    value = value.replace(pattern, replacement);
  }
  return value.replace(/\s+/gu, " ").trim();
}

export function redactSensitiveEvidenceText(input: unknown, maximum = MAX_RAW_STRING_LENGTH) {
  const redactions = new Set<string>();
  const safe = redactText(String(input ?? ""), redactions);
  return safe.length <= maximum ? safe : `${safe.slice(0, maximum)}…[TRUNCATED]`;
}

function boundArtifact(value: unknown, depth = 0, inherited?: Set<string>): BoundedValue {
  const redactions = inherited ?? new Set<string>();
  if (depth > MAX_RAW_DEPTH) return { value: "[TRUNCATED_DEPTH]", truncated: true, redactions };
  if (typeof value === "string") {
    const safe = redactText(value, redactions);
    if (safe.length <= MAX_RAW_STRING_LENGTH) return { value: safe, truncated: false, redactions };
    return { value: `${safe.slice(0, MAX_RAW_STRING_LENGTH)}…[TRUNCATED]`, truncated: true, redactions };
  }
  if (typeof value === "number") return { value: Number.isFinite(value) ? value : null, truncated: !Number.isFinite(value), redactions };
  if (typeof value === "boolean" || value === null) return { value, truncated: false, redactions };
  if (Array.isArray(value)) {
    let truncated = value.length > MAX_RAW_ARRAY_ITEMS;
    const items: unknown[] = [];
    for (const item of value.slice(0, MAX_RAW_ARRAY_ITEMS)) {
      const bounded = boundArtifact(item, depth + 1, redactions);
      truncated ||= bounded.truncated;
      items.push(bounded.value);
    }
    return { value: items, truncated, redactions };
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/(?:authorization|cookie|credential|oauth|token|password|passwd|secret|signature|api[_-]?key)/iu.test(key))
      .sort(([left], [right]) => compareText(left, right));
    let truncated = entries.length > MAX_RAW_OBJECT_KEYS
      || Object.keys(value as Record<string, unknown>).length !== entries.length;
    const output: Record<string, unknown> = {};
    for (const [key, item] of entries.slice(0, MAX_RAW_OBJECT_KEYS)) {
      const bounded = boundArtifact(item, depth + 1, redactions);
      truncated ||= bounded.truncated;
      output[key] = bounded.value;
    }
    return { value: output, truncated, redactions };
  }
  return { value: null, truncated: value !== undefined, redactions };
}

function safeValue(value: unknown) {
  return boundArtifact(value).value;
}

function isoTimestamp(value: unknown) {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? new Date(candidate).toISOString() : null;
}

function latestTimestamp(values: Array<string | null>) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort(compareText)
    .at(-1) ?? null;
}

function ageSeconds(observedAt: string | null, asOf: string) {
  if (!observedAt) return null;
  const age = (Date.parse(asOf) - Date.parse(observedAt)) / 1_000;
  return Number.isFinite(age) ? Math.max(0, Math.round(age)) : null;
}

function freshnessStatus(observedAt: string | null, asOf: string) {
  const age = ageSeconds(observedAt, asOf);
  if (age === null) return "unknown" as const;
  if (age <= 3 * 24 * 60 * 60) return "fresh" as const;
  if (age <= 30 * 24 * 60 * 60) return "aging" as const;
  return "stale" as const;
}

function claimFreshness(observedAt: string | null, asOf: string): ClaimConfidence["freshness"] {
  const status = freshnessStatus(observedAt, asOf);
  return status === "fresh" ? "current" : status;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  }
  return value;
}

function urlHost(value: unknown) {
  try {
    return normalizePublicHttpsUrl(text(value)).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function officialDirectScope(direct: Record<string, unknown>) {
  const binding = record(direct.binding);
  const account = text(direct.account);
  return direct.authority === "VERIFIED"
    && direct.access === "YANDEX_DIRECT_API_V501"
    && binding.matched === true
    && text(binding.expected_account) === account
    && text(binding.api_account) === account;
}

function officialMetrikaScope(metrika: Record<string, unknown>) {
  const binding = record(metrika.binding);
  const goalBinding = record(metrika.goal_binding);
  const counter = text(metrika.counter_id);
  const goal = text(metrika.goal_id);
  return metrika.authority === "VERIFIED"
    && metrika.access === "YANDEX_METRIKA_MANAGEMENT_AND_REPORTS_API"
    && binding.matched === true
    && goalBinding.matched === true
    && text(binding.expected_counter_id) === counter
    && text(binding.api_counter_id) === counter
    && text(goalBinding.expected_goal_id) === goal
    && text(goalBinding.api_goal_id) === goal;
}

async function makeEvidenceRecord(input: {
  sourceId: string;
  claimId: string;
  relation?: "supports" | "contradicts";
  sourceKind: string;
  sourceLocator: Record<string, unknown>;
  fetchedAt: string;
  observedAt: string;
  effectiveInterval?: EvidenceRecord["effective_interval"];
  scope: Record<string, unknown>;
  collectionPolicy: Record<string, unknown>;
  extraction: EvidenceRecord["extraction"];
  rawValue: unknown;
  rawQuote?: string;
  normalized: Record<string, unknown>;
  limitations?: string[];
  qualityFlags?: string[];
  providerMetadata?: Record<string, unknown>;
  freshnessPolicy?: string;
  asOf: string;
}): Promise<EvidenceRecord> {
  const bounded = boundArtifact(input.rawValue);
  const rawHash = await contentHash(bounded.value);
  const normalized = safeValue(input.normalized) as Record<string, unknown>;
  const outputHash = await contentHash(normalized);
  const body = {
    source_id: input.sourceId,
    claim_links: [{ claim_id: input.claimId, relation: input.relation ?? "supports" }],
    source_kind: input.sourceKind,
    source_locator: safeValue(input.sourceLocator) as Record<string, unknown>,
    fetched_at: input.fetchedAt,
    observed_at: input.observedAt,
    effective_interval: input.effectiveInterval ?? { from: null, to: null, basis: "unknown" as const },
    scope: safeValue(input.scope) as Record<string, unknown>,
    collection_policy: safeValue(input.collectionPolicy) as Record<string, unknown>,
    extraction: input.extraction,
    raw: {
      value: bounded.value,
      ...(input.rawQuote ? { quote: text(boundArtifact(input.rawQuote).value) } : {}),
      sha256: rawHash,
      immutable_pointer: `evidence://${rawHash}`,
      bounded: {
        maximum_string_length: MAX_RAW_STRING_LENGTH,
        maximum_array_items: MAX_RAW_ARRAY_ITEMS,
        maximum_object_keys: MAX_RAW_OBJECT_KEYS,
        truncated: bounded.truncated,
        redactions: [...bounded.redactions].sort(compareText),
      },
    },
    normalized,
    transforms: [{
      rule_id: "redact-bound-normalize",
      version: NORMALIZER_VERSION,
      input_sha256: rawHash,
      output_sha256: outputHash,
    }],
    versions: {
      schema: ANALYTICS_EVIDENCE_SCHEMA,
      extractor: input.extraction.version,
      normalizer: NORMALIZER_VERSION,
      redaction: REDACTION_VERSION,
    },
    freshness: {
      policy_id: input.freshnessPolicy ?? "observation/30d-v1",
      age_seconds: ageSeconds(input.observedAt, input.asOf),
      status: freshnessStatus(input.observedAt, input.asOf),
    },
    conflicts: [] as string[],
    limitations: (input.limitations ?? []).map((item) => text(safeValue(item))).filter(Boolean),
    quality_flags: (input.qualityFlags ?? []).map((item) => text(item)).filter(Boolean),
    provider_metadata: safeValue(input.providerMetadata ?? {}) as Record<string, unknown>,
  };
  const recordHash = await contentHash(body);
  return {
    evidence_id: `urn:mox:evidence:${recordHash.slice("sha256:".length)}`,
    record_hash: recordHash,
    ...body,
  };
}

async function makeClaim(input: Omit<EvidenceClaim, "claim_id" | "claim_hash">): Promise<EvidenceClaim> {
  const normalizedValue = safeValue(input.value);
  const body = {
    ...input,
    value: normalizedValue,
    normalized: { ...input.normalized, value: safeValue(input.normalized.value) },
    evidence_ids: [...input.evidence_ids].sort(compareText),
  };
  const identityHash = await contentHash({
    subject: body.subject,
    predicate: body.predicate,
    normalized: body.normalized,
  });
  const claimHash = await contentHash(body);
  return {
    claim_id: `urn:mox:claim:${identityHash.slice("sha256:".length)}`,
    claim_hash: claimHash,
    ...body,
  };
}

async function makeSource(input: Omit<EvidenceSource, "manifest_hash">): Promise<EvidenceSource> {
  const body = {
    ...input,
    facts: input.facts.map((item) => text(safeValue(item))).filter(Boolean),
    limitations: input.limitations.map((item) => text(safeValue(item))).filter(Boolean),
    evidence_ids: [...input.evidence_ids].sort(compareText),
  };
  return { ...body, manifest_hash: await contentHash(body) };
}

async function makeGap(input: Omit<EvidenceGap, "gap_id" | "gap_hash" | "status">): Promise<EvidenceGap> {
  const body = { ...input, status: "UNAVAILABLE" as const };
  const hash = await contentHash(body);
  return { gap_id: `urn:mox:gap:${hash.slice("sha256:".length)}`, gap_hash: hash, ...body };
}

async function makeConflict(input: Omit<EvidenceConflict, "conflict_id" | "conflict_hash">): Promise<EvidenceConflict> {
  const body = { ...input, left_value: safeValue(input.left_value), right_value: safeValue(input.right_value) };
  const hash = await contentHash(body);
  return { conflict_id: `urn:mox:conflict:${hash.slice("sha256:".length)}`, conflict_hash: hash, ...body };
}

function confidenceForClaim(input: Partial<ClaimConfidence> & Pick<ClaimConfidence, "quality">): ClaimConfidence {
  return {
    quality: input.quality,
    freshness: input.freshness ?? "unknown",
    consistency: input.consistency ?? "single",
    coverage: input.coverage ?? "unknown",
    uncertainty: input.uncertainty ?? [],
    tier: input.tier ?? "TIER_3_INDICATIVE",
  };
}

function containsForbiddenCompetitorPerformance(value: unknown) {
  return containsHiddenCompetitorPerformance(value);
}

function assertCompetitorObservation(observation: Record<string, unknown>, requireExactDestination = false) {
  const locator = record(observation.locator);
  const policy = record(observation.policy);
  const scope = record(observation.scope);
  const claim = record(observation.claim);
  let url: URL;
  try {
    url = normalizePublicHttpsUrl(text(locator.url) || text(observation.source_url));
  } catch {
    fail("PUBLIC_LOCATOR_UNSAFE", "Public competitor locator должен быть безопасным HTTPS URL.");
  }
  const allowedHosts = list(policy.allowed_hosts).map(text).map((item) => item.toLowerCase()).filter(Boolean);
  const allowedDestinations = list(policy.allowed_destinations).map((item) => {
    try { return normalizePublicHttpsUrl(text(item)).toString(); } catch { return ""; }
  }).filter(Boolean);
  if (!allowedHosts.includes(url.hostname.toLowerCase()) || text(scope.host).toLowerCase() !== url.hostname.toLowerCase()) {
    fail("PUBLIC_HOST_NOT_ALLOWLISTED", "Public competitor host отсутствует в exact allowlist observation policy.");
  }
  if (requireExactDestination && !allowedDestinations.length) {
    fail("PUBLIC_DESTINATION_ALLOWLIST_REQUIRED", "Detailed competitor matrix требует exact destination allowlist.");
  }
  if (allowedDestinations.length && !allowedDestinations.includes(url.toString())) {
    fail("PUBLIC_DESTINATION_NOT_ALLOWLISTED", "Public competitor locator отсутствует в exact destination allowlist.");
  }
  if (observation.collected_via !== "PUBLIC_RESEARCH_EGRESS_V1" || policy.access !== "PUBLIC_NO_AUTH") {
    fail("PUBLIC_COLLECTION_POLICY_INVALID", "Competitor observation должен проходить credential-free public research egress.");
  }
  const predicate = text(claim.predicate);
  if (
    containsForbiddenCompetitorPerformance(predicate)
    || containsForbiddenCompetitorPerformance(claim.value)
    || containsForbiddenCompetitorPerformance(observation.raw_quote)
  ) {
    fail("COMPETITOR_HIDDEN_CLAIM_FORBIDDEN", "Скрытые performance/strategy claims конкурентов запрещены.");
  }
  if (containsCompetitorPromptInjection(claim.value) || containsCompetitorPromptInjection(observation.raw_quote)) {
    fail("COMPETITOR_PROMPT_INJECTION_REJECTED", "Prompt injection из public competitor evidence отклонён.");
  }
  if (!predicate || !text(claim.subject)) {
    fail("COMPETITOR_CLAIM_INVALID", "Public competitor observation требует атомарный normalized claim.");
  }
  return { url, policy, scope, claim };
}

export async function buildAnalyticsEvidence({
  site,
  model,
  context,
  generatedAt,
}: AnalyticsEvidenceInput): Promise<AnalyticsEvidenceBundle> {
  const siteResearch = record(site.research);
  const direct = record(context.direct);
  const directBinding = record(direct.binding);
  const directReadLimitations = record(direct.read_limitations);
  const directAudit = record(direct.audit);
  const directAuditBinding = record(directAudit.account_binding);
  const directAuditCounts = record(directAudit.object_counts);
  const metrika = record(context.metrika);
  const performance = record(context.performance);
  const performanceProvenance = record(performance.provenance);
  const sampling = record(performanceProvenance.sampling);
  const campaignCatalog = record(context.campaign_catalog);
  const fieldEvidence = record(model.field_evidence);
  const modelResearch = record(model.research);
  const missingQuestions = list(model.missing_questions).map(text).filter(Boolean);
  const siteObservedAt = isoTimestamp(site.fetched_at);
  const directObservedAt = isoTimestamp(direct.observed_at);
  const metrikaObservedAt = isoTimestamp(performanceProvenance.observed_at) ?? isoTimestamp(metrika.observed_at);
  const competitorInputs = list(context.competitor_observations)
    .map(record)
    .sort((left, right) => compareText(text(record(left.locator).url), text(record(right.locator).url)));
  const rawCandidateSet = record(context.competitor_candidate_set);
  if (Object.keys(rawCandidateSet).length && text(rawCandidateSet.schema_version) !== BOUNDED_COMPETITOR_RESEARCH_SCHEMA) {
    fail("COMPETITOR_SCHEMA_UNSUPPORTED", "Competitor candidate set schema не поддерживается.");
  }
  const competitorCandidateSet = Object.keys(rawCandidateSet).length
    ? createBoundedCompetitorCandidateSet({
        rule: text(rawCandidateSet.competitor_set_rule),
        candidates: list(rawCandidateSet.candidates).map((candidateValue) => {
          const candidate = record(candidateValue);
          return {
            competitor: text(candidate.competitor),
            rationale: text(candidate.rationale),
            exactDestinations: list(candidate.exact_destinations).map(text),
          };
        }),
      })
    : null;
  const competitorMatrix = competitorCandidateSet
    ? buildCompetitorMatrix({
        candidateSet: competitorCandidateSet,
        rows: competitorInputs.map((observation) => record(observation.matrix_row)).filter((row) => Object.keys(row).length).map((row) => {
          const price = record(row.published_price);
          const sample = record(row.ad_visibility_sample);
          const source = record(row.source);
          return {
            competitor: text(row.competitor),
            productsServices: list(row.products_services).map(text),
            observedOfferMessage: text(row.observed_offer_message),
            publishedPrice: price.status === "PUBLISHED"
              ? { status: "PUBLISHED", value: text(price.value) }
              : { status: "NOT_PUBLISHED", value: null },
            exactLanding: text(row.exact_landing),
            source: { label: text(source.label), url: text(source.url) },
            geography: text(row.geography),
            device: text(row.device),
            observedAt: text(row.observation_date),
            adVisibilitySample: {
              status: text(sample.status) as CompetitorMatrixRowInput["adVisibilitySample"]["status"],
              query: sample.query === null ? null : text(sample.query),
              source: text(sample.source),
              geography: text(sample.geography),
              device: text(sample.device),
              observedAt: text(sample.observation_date),
            },
          } satisfies CompetitorMatrixRowInput;
        }),
      })
    : null;
  const competitorObservedAts = competitorInputs.map((item) => isoTimestamp(item.observed_at));
  const ownerObservedAts = Object.values(fieldEvidence).map((item) => isoTimestamp(record(item).owner_confirmed_at));
  const rawMarketInput = record(context.market_evidence_input);
  const marketBatchObservedAt = isoTimestamp(record(rawMarketInput.wordstat_batch).batch_finished_at);
  const asOf = latestTimestamp([siteObservedAt, directObservedAt, metrikaObservedAt, marketBatchObservedAt, ...competitorObservedAts, ...ownerObservedAts])
    ?? "1970-01-01T00:00:00.000Z";
  const generated = isoTimestamp(generatedAt) ?? asOf;
  const marketInput = rawMarketInput.wordstat_batch
    ? rawMarketInput as unknown as MarketEvidenceInput
    : {
        wordstat_batch: await unavailableWordstatBatch("Official scoped Wordstat observation was not collected for this Model revision.", generated),
        demand_clusters: [],
        cost_observations: [],
      };
  const marketEvidence = await buildMarketEvidence(marketInput);
  const fallbackProductEvidence = record(fieldEvidence.product);
  const offerCandidates = list(model.offer_candidates).length
    ? list(model.offer_candidates).map((candidate) => safeValue(candidate) as OfferCandidateInput)
    : [safeValue({
        label: model.product,
        offer: model.product,
        audience: model.audience,
        value: model.value,
        qualified_outcome: model.qualified_result,
        economics: model.economics,
        destination: site.url,
        current_promotion: "UNKNOWN",
        unresolved_facts: list(model.missing_questions),
        evidence_refs: text(fallbackProductEvidence.quote) && text(fallbackProductEvidence.source_url)
          ? [{ source_url: fallbackProductEvidence.source_url, quote: fallbackProductEvidence.quote, field: "offer" }]
          : [],
      } satisfies OfferCandidateInput) as OfferCandidateInput];
  const productFocus = await buildProductFocusArtifacts({
    candidates: offerCandidates,
    marketEvidence,
    generatedAt: generated,
  });
  const companyHost = urlHost(site.url) || urlHost(record(list(site.pages)[0]).url);
  const directAccount = text(direct.account);
  const directClientId = text(direct.client_id);
  const metrikaCounterId = text(metrika.counter_id);
  const metrikaGoalId = text(metrika.goal_id);
  const scope = {
    company_host: companyHost,
    direct_client_login: directAccount,
    direct_client_id: directClientId,
    metrika_counter_id: metrikaCounterId,
    metrika_goal_id: metrikaGoalId,
  };

  const evidence: EvidenceRecord[] = [];
  const claims: EvidenceClaim[] = [];
  const sourceEvidence: Record<string, string[]> = {
    "first-party-web": [],
    "owner-confirmed": [],
    direct: [],
    metrika: [],
    competitors: [],
    wordstat: [],
  };

  for (const [field, rawItem] of Object.entries(fieldEvidence).sort(([left], [right]) => compareText(left, right))) {
    const item = record(rawItem);
    const rawModelValue = model[field] ?? "";
    const normalizedValue = safeValue(rawModelValue);
    const quote = text(item.quote);
    const sourceUrl = text(item.source_url);
    const ownerConfirmed = item.owner_confirmed === true || text(item.confidence) === "OWNER_CONFIRMED";
    const ownerConfirmedAt = isoTimestamp(item.owner_confirmed_at);
    const identityHash = await contentHash({
      subject: "business_model",
      predicate: field,
      normalized: { value: normalizedValue, datatype: "string", language: "ru" },
    });
    const claimId = `urn:mox:claim:${identityHash.slice("sha256:".length)}`;
    const recordIds: string[] = [];
    if (quote && sourceUrl) {
      const webRecord = await makeEvidenceRecord({
        sourceId: "first-party-web",
        claimId,
        sourceKind: "first_party_web",
        sourceLocator: { url: sourceUrl, field, selector_or_span: "evidence_span" },
        fetchedAt: siteObservedAt ?? generated,
        observedAt: siteObservedAt ?? generated,
        scope: { access: "public", company_host: companyHost },
        collectionPolicy: { policy_id: "first-party-public-https", version: "1.0.0", no_auth: true },
        extraction: {
          method: "evidence_span",
          version: text(modelResearch.agent) || "GPT_SITES_EVIDENCE_RESEARCH_V3",
          selector_or_jsonpath: `business_model.${field}`,
          request_digest: await contentHash({ url: sourceUrl, scope: "FIRST_PARTY_PUBLIC_HTTPS" }),
        },
        rawValue: quote,
        rawQuote: quote,
        normalized: { value: normalizedValue, datatype: "string", language: "ru" },
        asOf,
      });
      evidence.push(webRecord);
      recordIds.push(webRecord.evidence_id);
      sourceEvidence["first-party-web"].push(webRecord.evidence_id);
    }
    if (ownerConfirmed) {
      const ownerRecord = await makeEvidenceRecord({
        sourceId: "owner-confirmed",
        claimId,
        sourceKind: "owner_confirmation",
        sourceLocator: { state_path: `business_model.${field}`, field },
        fetchedAt: ownerConfirmedAt ?? generated,
        observedAt: ownerConfirmedAt ?? generated,
        scope: { access: "owner_authorized", company_host: companyHost },
        collectionPolicy: { policy_id: "owner-confirmation", version: "1.0.0", actor: "business_owner" },
        extraction: {
          method: "owner_confirmation",
          version: "p0-owner-confirmation-v1",
          selector_or_jsonpath: `$.business_model.${field}`,
          request_digest: null,
        },
        rawValue: normalizedValue,
        normalized: { value: normalizedValue, datatype: "string", language: "ru" },
        asOf,
      });
      evidence.push(ownerRecord);
      recordIds.push(ownerRecord.evidence_id);
      sourceEvidence["owner-confirmed"].push(ownerRecord.evidence_id);
    }
    if (!recordIds.length) continue;
    const claim = await makeClaim({
      subject: "business_model",
      predicate: field,
      value: normalizedValue,
      normalized: { value: normalizedValue, datatype: "string", language: "ru" },
      classification: ownerConfirmed ? "owner_confirmed" : "observed",
      evidence_ids: recordIds,
      confidence: confidenceForClaim({
        quality: ownerConfirmed ? "A" : "B",
        freshness: claimFreshness(ownerConfirmedAt ?? siteObservedAt, asOf),
        consistency: recordIds.length > 1 ? "corroborated" : "single",
        coverage: "complete_for_scope",
        uncertainty: [],
        tier: ownerConfirmed ? "TIER_1_VERIFIED" : "TIER_3_INDICATIVE",
      }),
    });
    claims.push(claim);
  }

  for (const offer of productFocus.catalog.offers) {
    if (!offer.evidence_refs.length) continue;
    const normalizedOffer = {
      offer_id: offer.offer_id,
      material_axes: offer.material_axes,
      value_proposition: offer.value_proposition,
      current_promotion: offer.current_promotion,
      unresolved_facts: offer.unresolved_facts,
    };
    const identityHash = await contentHash({
      subject: `offer:${offer.offer_id}`,
      predicate: "material_offer",
      normalized: { value: normalizedOffer, datatype: "object" },
    });
    const claimId = `urn:mox:claim:${identityHash.slice("sha256:".length)}`;
    const recordIds: string[] = [];
    for (const reference of offer.evidence_refs) {
      const catalogRecord = await makeEvidenceRecord({
        sourceId: "first-party-web",
        claimId,
        sourceKind: "first_party_offer_catalog",
        sourceLocator: { url: reference.source_url, field: reference.field, offer_id: offer.offer_id },
        fetchedAt: siteObservedAt ?? generated,
        observedAt: siteObservedAt ?? generated,
        scope: { access: "public", company_host: companyHost, catalog_id: productFocus.catalog.catalog_id },
        collectionPolicy: { policy_id: "first-party-public-https", version: "1.0.0", no_auth: true },
        extraction: {
          method: "material_offer_inventory",
          version: text(modelResearch.agent) || "GPT_SITES_EVIDENCE_RESEARCH_V3",
          selector_or_jsonpath: `product_catalog.${offer.offer_id}`,
          request_digest: await contentHash({ url: reference.source_url, offer_id: offer.offer_id }),
        },
        rawValue: reference.quote,
        rawQuote: reference.quote,
        normalized: normalizedOffer,
        limitations: offer.unresolved_facts,
        qualityFlags: ["MATERIAL_AXES_SEPARATED", "NO_SKU_ONLY_SPLIT"],
        asOf,
      });
      evidence.push(catalogRecord);
      recordIds.push(catalogRecord.evidence_id);
      sourceEvidence["first-party-web"].push(catalogRecord.evidence_id);
    }
    claims.push(await makeClaim({
      subject: `offer:${offer.offer_id}`,
      predicate: "material_offer",
      value: normalizedOffer,
      normalized: { value: normalizedOffer, datatype: "object" },
      classification: "observed",
      evidence_ids: recordIds,
      confidence: confidenceForClaim({
        quality: "B",
        freshness: claimFreshness(siteObservedAt, asOf),
        consistency: recordIds.length > 1 ? "corroborated" : "single",
        coverage: offer.unresolved_facts.length ? "partial" : "complete_for_scope",
        uncertainty: offer.unresolved_facts,
        tier: offer.unresolved_facts.length ? "TIER_3_INDICATIVE" : "TIER_2_CORROBORATED",
      }),
    }));
  }

  const directOfficial = officialDirectScope(direct);
  const directInventoryReady = direct.inventory_ready === true && directOfficial;
  const directAuditReady = directAudit.schema_version === "direct-read-audit-summary-v1"
    && ["COMPLETE", "PARTIAL"].includes(text(directAudit.status))
    && directAuditBinding.matched === true
    && text(directAuditBinding.expected_account) === directAccount
    && text(directAuditBinding.api_account) === directAccount
    && text(directAuditBinding.client_id) === directClientId
    && directAudit.browser_cabinet_used === false
    && directAudit.provider_write_methods_reachable === false;
  if (directInventoryReady) {
    const activeCampaigns = list(campaignCatalog.active).map((item) => {
      const campaign = record(item);
      return {
        campaign_id: text(campaign.campaign_id),
        name: safeValue(campaign.name),
        state: text(campaign.state),
        status: text(campaign.status),
      };
    });
    const methodsRead = list(directReadLimitations.methods_read).map(text).filter(Boolean);
    const methodsNotRead = list(directReadLimitations.methods_not_read).map(text).filter(Boolean);
    const providerLimitations = [...new Set([
      ...list(directReadLimitations.provider_limitations).map(text).filter(Boolean),
      ...list(directAudit.limitations).map(text).filter(Boolean),
    ])];
    const artifactReferences = directAuditReady
      ? list(directAudit.artifact_references).map((item) => {
          const reference = record(item);
          return {
            artifact_id: text(reference.artifact_id),
            kind: text(reference.kind),
            digest: text(reference.digest),
            byte_length: numberOr(reference.byte_length),
            object_count: numberOr(reference.object_count),
            observed_at: text(reference.observed_at),
          };
        })
      : [];
    const normalized = {
      account: directAccount,
      client_id: directClientId,
      campaigns_total: numberOr(direct.campaigns_total),
      campaign_summaries: activeCampaigns,
      ...(directAuditReady ? {
        complete_read_audit: {
          audit_id: text(directAudit.audit_id),
          status: text(directAudit.status),
          graph_complete: directAudit.graph_complete === true,
          object_counts: safeValue(directAuditCounts),
          report_summaries: safeValue(directAudit.report_summaries),
          artifact_references: artifactReferences,
          browser_cabinet_used: false,
          provider_write_methods_reachable: false,
        },
      } : {}),
    };
    const predicate = directAuditReady ? "complete_account_audit" : "campaign_inventory";
    const claimIdentity = await contentHash({
      subject: "current_direct_account",
      predicate,
      normalized: { value: normalized, datatype: "object" },
    });
    const claimId = `urn:mox:claim:${claimIdentity.slice("sha256:".length)}`;
    const directRecord = await makeEvidenceRecord({
      sourceId: "direct",
      claimId,
      sourceKind: "direct_management_api",
      sourceLocator: directAuditReady ? {
        service: "Direct object graph and Reports",
        method: "read-only get/reports",
        endpoint_host: "api.direct.yandex.com",
        client_login: directAccount,
        response_locator: `direct-audit:${text(directAudit.audit_id)}`,
      } : {
        service: "Campaigns",
        method: "get",
        endpoint: "https://api.direct.yandex.com/json/v501/campaigns",
        client_login: directAccount,
        response_locator: "$.result.Campaigns",
      },
      fetchedAt: directObservedAt ?? generated,
      observedAt: directObservedAt ?? generated,
      scope: { access: "owner_authorized", client_login: directAccount, client_id: directClientId },
      collectionPolicy: directAuditReady ? {
        policy_id: "official-yandex-direct-read-only",
        version: "v501-object-graph-and-reports-v1",
        allowed_host: "api.direct.yandex.com",
        allowed_operation: methodsRead,
        browser_cabinet_allowed: false,
        provider_write_methods_reachable: false,
      } : {
        policy_id: "official-yandex-direct-read-only",
        version: "v501",
        allowed_host: "api.direct.yandex.com",
        allowed_operation: "Campaigns.get",
        browser_cabinet_allowed: false,
      },
      extraction: {
        method: "api_parser",
        version: directAuditReady ? "direct-v501-complete-audit-v1" : "direct-v501-campaign-inventory-v2",
        selector_or_jsonpath: directAuditReady ? `direct-audit:${text(directAudit.audit_id)}` : "$.result.Campaigns",
        request_digest: await contentHash(directAuditReady ? {
          audit_id: text(directAudit.audit_id),
          client_login: directAccount,
          methods_read: methodsRead,
          artifact_digests: artifactReferences.map((reference) => reference.digest),
        } : {
          method: "get",
          client_login: directAccount,
          field_names: ["Id", "Name", "Type", "Status", "State", "StartDate", "EndDate"],
        }),
      },
      rawValue: normalized,
      normalized,
      limitations: [
        ...methodsNotRead.map((method) => `${method} не прочитан в этом snapshot.`),
        ...providerLimitations,
      ],
      qualityFlags: ["DIRECT_LAST_3_DAYS_PROVISIONAL"],
      providerMetadata: {
        direct_read: {
          ...(directAuditReady ? {
            audit_id: text(directAudit.audit_id),
            audit_status: text(directAudit.status),
          } : {}),
          inventory_complete: directReadLimitations.inventory_complete === true,
          limited_by: directReadLimitations.limited_by ?? null,
          methods_read: methodsRead,
          methods_not_read: methodsNotRead,
          ...(directAuditReady ? {
            report_summaries: safeValue(directAudit.report_summaries),
            artifact_references: artifactReferences,
          } : {}),
          statistics_provisional_days: numberOr(directReadLimitations.statistics_provisional_days, 3),
        },
        account_binding: {
          expected_account: text(directBinding.expected_account),
          api_account: text(directBinding.api_account),
          matched: directBinding.matched === true,
        },
      },
      freshnessPolicy: directAuditReady ? "direct-audit/5m-v1" : "direct-inventory/5m-v1",
      asOf,
    });
    evidence.push(directRecord);
    sourceEvidence.direct.push(directRecord.evidence_id);
    claims.push(await makeClaim({
      subject: "current_direct_account",
      predicate,
      value: normalized,
      normalized: { value: normalized, datatype: "object" },
      classification: "documented_api_fact",
      evidence_ids: [directRecord.evidence_id],
      confidence: confidenceForClaim({
        quality: "A",
        freshness: claimFreshness(directObservedAt, asOf),
        consistency: "single",
        coverage: methodsNotRead.length || text(directAudit.status) === "PARTIAL" ? "partial" : "complete_for_scope",
        uncertainty: directAuditReady
          ? methodsNotRead.length || text(directAudit.status) === "PARTIAL"
            ? ["Direct audit preserves provider limitations and unavailable methods for this exact account scope."]
            : []
          : methodsNotRead.length
            ? ["Direct child object graph and search-query coverage are not read in this snapshot."]
            : [],
        tier: methodsNotRead.length || text(directAudit.status) === "PARTIAL" ? "TIER_3_INDICATIVE" : "TIER_1_VERIFIED",
      }),
    }));
  }

  const metrikaOfficial = officialMetrikaScope(metrika);
  const metrikaManagementReady = metrika.ready === true && metrikaOfficial;
  const metrikaReportOfficial = text(performanceProvenance.source_kind) === "METRIKA_REPORTS_API";
  const metrikaReportReady = metrikaManagementReady
    && metrikaReportOfficial
    && Boolean(text(performance.period_start) && text(performance.period_end));
  if (metrikaManagementReady) {
    const normalizedBinding = { counter_id: metrikaCounterId, goal_id: metrikaGoalId, goal_exists: true };
    const bindingIdentity = await contentHash({
      subject: "metrika_goal",
      predicate: "exact_goal_binding",
      normalized: { value: normalizedBinding, datatype: "object" },
    });
    const bindingClaimId = `urn:mox:claim:${bindingIdentity.slice("sha256:".length)}`;
    const bindingRecord = await makeEvidenceRecord({
      sourceId: "metrika",
      claimId: bindingClaimId,
      sourceKind: "metrica_management_api",
      sourceLocator: {
        service: "Management",
        method: "GET counter + goals",
        endpoint_host: "api-metrika.yandex.net",
        counter_id: metrikaCounterId,
        goal_id: metrikaGoalId,
      },
      fetchedAt: isoTimestamp(metrika.observed_at) ?? generated,
      observedAt: isoTimestamp(metrika.observed_at) ?? generated,
      scope: { access: "owner_authorized", counter_id: metrikaCounterId, goal_id: metrikaGoalId },
      collectionPolicy: {
        policy_id: "official-yandex-metrika-read-only",
        version: "management-v1",
        allowed_host: "api-metrika.yandex.net",
        browser_cabinet_allowed: false,
      },
      extraction: {
        method: "api_parser",
        version: "metrika-management-binding-v1",
        selector_or_jsonpath: "$.counter.id + $.goals[*].id",
        request_digest: await contentHash({ counter_id: metrikaCounterId, goal_id: metrikaGoalId }),
      },
      rawValue: normalizedBinding,
      normalized: normalizedBinding,
      limitations: ["Goal object existence does not prove instrumentation semantics or observed reaches."],
      providerMetadata: {
        counter_binding: record(metrika.binding),
        goal_binding: record(metrika.goal_binding),
      },
      asOf,
    });
    evidence.push(bindingRecord);
    sourceEvidence.metrika.push(bindingRecord.evidence_id);
    claims.push(await makeClaim({
      subject: "metrika_goal",
      predicate: "exact_goal_binding",
      value: normalizedBinding,
      normalized: { value: normalizedBinding, datatype: "object" },
      classification: "documented_api_fact",
      evidence_ids: [bindingRecord.evidence_id],
      confidence: confidenceForClaim({
        quality: "A",
        freshness: claimFreshness(isoTimestamp(metrika.observed_at), asOf),
        consistency: "single",
        coverage: "complete_for_scope",
        uncertainty: ["Goal existence alone does not prove event instrumentation semantics."],
        tier: "TIER_1_VERIFIED",
      }),
    }));
  }
  const samplingMetadataKeys = [
    "sampled",
    "contains_sensitive_data",
    "sample_share",
    "sample_size",
    "sample_space",
    "data_lag",
  ];
  const samplingMetadataComplete = sampling.metadata_complete === true
    || (sampling.metadata_complete === undefined
      && samplingMetadataKeys.every((key) => Object.hasOwn(sampling, key)));
  const metrikaPartial = !samplingMetadataComplete
    || sampling.sampled === true
    || sampling.contains_sensitive_data === true
    || numberOr(sampling.data_lag) > 0;
  if (metrikaReportReady) {
    const reportMetadata = {
      metadata_complete: samplingMetadataComplete,
      sampled: samplingMetadataComplete ? sampling.sampled === true : null,
      contains_sensitive_data: samplingMetadataComplete ? sampling.contains_sensitive_data === true : null,
      sample_share: samplingMetadataComplete ? numberOr(sampling.sample_share, 1) : null,
      sample_size: samplingMetadataComplete ? numberOr(sampling.sample_size) : null,
      sample_space: samplingMetadataComplete ? numberOr(sampling.sample_space) : null,
      data_lag: samplingMetadataComplete ? numberOr(sampling.data_lag) : null,
      attribution: text(performanceProvenance.attribution) || "unspecified",
      timezone: text(performanceProvenance.timezone) || "unspecified",
      dimensions: list(performanceProvenance.dimensions).map(text).filter(Boolean),
      filters: text(performanceProvenance.filters),
      period_start: text(performance.period_start),
      period_end: text(performance.period_end),
    };
    const displayMetrics = record(performance.display_metrics);
    const normalized = {
      counter_id: metrikaCounterId,
      goal_id: metrikaGoalId,
      visits: text(displayMetrics.visits),
      goal_visits: text(displayMetrics.goal_visits),
      report: reportMetadata,
    };
    const reportIdentity = await contentHash({
      subject: "metrika_goal",
      predicate: "observed_performance",
      normalized: { value: normalized, datatype: "metric_observation" },
    });
    const reportClaimId = `urn:mox:claim:${reportIdentity.slice("sha256:".length)}`;
    const uncertainty = [
      ...(!samplingMetadataComplete ? ["Metrika sampling/privacy/lag metadata unavailable; unsampled completeness cannot be asserted."] : []),
      ...(sampling.sampled === true ? ["Metrika sampling limits report coverage."] : []),
      ...(sampling.contains_sensitive_data === true ? ["Metrika privacy limitation restricts disclosed data."] : []),
      ...(numberOr(sampling.data_lag) > 0 ? [`Metrika platform lag is ${numberOr(sampling.data_lag)} seconds.`] : []),
    ];
    const reportRecord = await makeEvidenceRecord({
      sourceId: "metrika",
      claimId: reportClaimId,
      sourceKind: "metrica_reports_api",
      sourceLocator: {
        service: "Statistics",
        method: "get",
        endpoint: "https://api-metrika.yandex.net/stat/v1/data",
        counter_id: metrikaCounterId,
        goal_id: metrikaGoalId,
        row_locator: "$.data[*]",
      },
      fetchedAt: metrikaObservedAt ?? generated,
      observedAt: metrikaObservedAt ?? generated,
      effectiveInterval: {
        from: text(performance.period_start) || null,
        to: text(performance.period_end) || null,
        basis: "report_window",
      },
      scope: { access: "owner_authorized", counter_id: metrikaCounterId, goal_id: metrikaGoalId },
      collectionPolicy: {
        policy_id: "official-yandex-metrika-read-only",
        version: "reports-v1",
        allowed_host: "api-metrika.yandex.net",
        allowed_operation: "Statistics.get",
        browser_cabinet_allowed: false,
      },
      extraction: {
        method: "api_parser",
        version: "metrika-stat-v2",
        selector_or_jsonpath: "$.data[*].metrics",
        request_digest: await contentHash({
          counter_id: metrikaCounterId,
          goal_id: metrikaGoalId,
          report: reportMetadata,
        }),
      },
      rawValue: normalized,
      normalized,
      limitations: uncertainty,
      qualityFlags: [
        ...(!samplingMetadataComplete ? ["SAMPLING_METADATA_UNAVAILABLE"] : []),
        ...(sampling.sampled === true ? ["SAMPLED"] : []),
        ...(sampling.contains_sensitive_data === true ? ["PRIVACY_LIMITED"] : []),
        ...(numberOr(sampling.data_lag) > 0 ? ["DATA_LAG"] : []),
      ],
      providerMetadata: { metrika_report: reportMetadata },
      freshnessPolicy: "metrika-report/24h-v1",
      asOf,
    });
    evidence.push(reportRecord);
    sourceEvidence.metrika.push(reportRecord.evidence_id);
    claims.push(await makeClaim({
      subject: "metrika_goal",
      predicate: "observed_performance",
      value: normalized,
      normalized: { value: normalized, datatype: "metric_observation" },
      classification: "documented_api_fact",
      evidence_ids: [reportRecord.evidence_id],
      confidence: confidenceForClaim({
        quality: "A",
        freshness: claimFreshness(metrikaObservedAt, asOf),
        consistency: "single",
        coverage: metrikaPartial ? "partial" : "complete_for_scope",
        uncertainty,
        tier: metrikaPartial ? "TIER_3_INDICATIVE" : "TIER_1_VERIFIED",
      }),
    }));
  }

  for (const observation of competitorInputs) {
    const checked = assertCompetitorObservation(observation, Boolean(competitorCandidateSet));
    const normalizedClaim = safeValue(checked.claim.value);
    const identity = await contentHash({
      subject: text(checked.claim.subject),
      predicate: text(checked.claim.predicate),
      normalized: { value: normalizedClaim, datatype: "string", language: "ru" },
    });
    const claimId = `urn:mox:claim:${identity.slice("sha256:".length)}`;
    const observedAt = isoTimestamp(observation.observed_at) ?? generated;
    const limitations = [
      ...list(observation.limitations).map(text).filter(Boolean),
      "Public observation does not reveal competitor budgets, CPC, conversions, account state or internal strategy.",
    ];
    const competitorRecord = await makeEvidenceRecord({
      sourceId: "competitors",
      claimId,
      sourceKind: "competitor_public_web",
      sourceLocator: {
        url: checked.url.toString(),
        selector: text(record(observation.locator).selector) || null,
      },
      fetchedAt: observedAt,
      observedAt,
      scope: {
        access: "public",
        host: text(checked.scope.host),
        pages_observed: numberOr(checked.scope.pages_observed, 1),
        observation_scope: text(checked.scope.observation_scope),
      },
      collectionPolicy: {
        policy_id: text(checked.policy.policy_id),
        version: text(checked.policy.version),
        policy_url: text(checked.policy.policy_url),
        access: "PUBLIC_NO_AUTH",
        allowed_hosts: list(checked.policy.allowed_hosts).map(text).sort(compareText),
        allowed_destinations: list(checked.policy.allowed_destinations).map(text).sort(compareText),
      },
      extraction: {
        method: "dom_selector",
        version: "public-competitor-observation-v1",
        selector_or_jsonpath: text(record(observation.locator).selector) || null,
        request_digest: await contentHash({ url: checked.url.toString(), access: "PUBLIC_NO_AUTH" }),
      },
      rawValue: { quote: observation.raw_quote, matrix_row: observation.matrix_row ?? null },
      rawQuote: text(observation.raw_quote),
      normalized: { value: normalizedClaim, datatype: "string", language: "ru", matrix_row: observation.matrix_row ?? null },
      limitations,
      qualityFlags: ["PUBLIC_OBSERVATION_ONLY", "NO_HIDDEN_PERFORMANCE_INFERENCE"],
      providerMetadata: { collected_via: "PUBLIC_RESEARCH_EGRESS_V1" },
      freshnessPolicy: "competitor-public-page/7d-v1",
      asOf,
    });
    evidence.push(competitorRecord);
    sourceEvidence.competitors.push(competitorRecord.evidence_id);
    claims.push(await makeClaim({
      subject: text(checked.claim.subject),
      predicate: text(checked.claim.predicate),
      value: normalizedClaim,
      normalized: { value: normalizedClaim, datatype: "string", language: "ru" },
      classification: "observed",
      evidence_ids: [competitorRecord.evidence_id],
      confidence: confidenceForClaim({
        quality: "C",
        freshness: claimFreshness(observedAt, asOf),
        consistency: "single",
        coverage: "partial",
        uncertainty: limitations,
        tier: "TIER_3_INDICATIVE",
      }),
    }));
  }

  if (marketEvidence.frequency.status !== "UNAVAILABLE") {
    const normalizedDemand = marketEvidence.frequency;
    const boundedDemand = safeValue(normalizedDemand);
    const identity = await contentHash({
      subject: "market_demand",
      predicate: "scoped_wordstat_frequency",
      normalized: { value: boundedDemand, datatype: "metric_observation" },
    });
    const claimId = `urn:mox:claim:${identity.slice("sha256:".length)}`;
    const wordstatRecord = await makeEvidenceRecord({
      sourceId: "wordstat",
      claimId,
      sourceKind: "wordstat_api",
      sourceLocator: {
        endpoint_host: "api.wordstat.yandex.net",
        methods: ["/v1/topRequests", "/v1/dynamics", "/v1/regions"],
        batch_id: marketEvidence.snapshot_batch_id,
      },
      fetchedAt: marketEvidence.batch_finished_at,
      observedAt: marketEvidence.batch_finished_at,
      effectiveInterval: { from: null, to: null, basis: "unknown" },
      scope: {
        batch_id: marketEvidence.snapshot_batch_id,
        scopes: marketEvidence.frequency.scopes,
        declared_window: marketEvidence.frequency.declared_window,
        source_window_end: marketEvidence.frequency.source_window_end,
      },
      collectionPolicy: {
        policy_id: "official-yandex-wordstat-read-only",
        version: "v1",
        allowed_host: "api.wordstat.yandex.net",
        allowed_methods: ["POST /v1/topRequests", "POST /v1/dynamics", "POST /v1/regions"],
        browser_cabinet_allowed: false,
      },
      extraction: {
        method: "api_parser",
        version: "wordstat-v1-scoped-demand-v1",
        selector_or_jsonpath: "$.topRequests + $.dynamics + $.regions",
        request_digest: await contentHash(marketEvidence.frequency.scopes),
      },
      rawValue: normalizedDemand,
      normalized: normalizedDemand,
      limitations: [
        "Observed unique top rows are a lower bound, not exhaustive demand.",
        "The API does not disclose the exact rolling-window end date.",
        ...marketEvidence.frequency.gaps.map((gap) => gap.detail),
      ],
      qualityFlags: ["LOWER_BOUND_OBSERVED_TOP_ROWS", "SOURCE_WINDOW_END_UNDISCLOSED"],
      providerMetadata: {
        snapshot_batch_id: marketEvidence.snapshot_batch_id,
        unique_assigned_row_ids: marketEvidence.frequency.unique_assigned_rows.map((row) => row.row_id),
      },
      freshnessPolicy: "wordstat-rolling-30d/24h-v1",
      asOf,
    });
    evidence.push(wordstatRecord);
    sourceEvidence.wordstat.push(wordstatRecord.evidence_id);
    claims.push(await makeClaim({
      subject: "market_demand",
      predicate: "scoped_wordstat_frequency",
      value: normalizedDemand,
      normalized: { value: normalizedDemand, datatype: "metric_observation" },
      classification: "documented_api_fact",
      evidence_ids: [wordstatRecord.evidence_id],
      confidence: confidenceForClaim({
        quality: "A",
        freshness: claimFreshness(isoTimestamp(marketEvidence.batch_finished_at), asOf),
        consistency: marketEvidence.frequency.status === "PARTIAL" ? "scope_mismatch" : "single",
        coverage: marketEvidence.frequency.status === "AVAILABLE" ? "complete_for_scope" : "partial",
        uncertainty: ["Wordstat top rows are non-exhaustive; the aggregate is explicitly a lower bound."],
        tier: marketEvidence.frequency.status === "AVAILABLE" ? "TIER_1_VERIFIED" : "TIER_3_INDICATIVE",
      }),
    }));
  }

  if (marketEvidence.cost.status !== "UNAVAILABLE") {
    const normalizedCost = marketEvidence.cost;
    const boundedCost = safeValue(normalizedCost);
    const identity = await contentHash({
      subject: "prelaunch_cost",
      predicate: "qualified_cost_range",
      normalized: { value: boundedCost, datatype: "money_range" },
    });
    const claimId = `urn:mox:claim:${identity.slice("sha256:".length)}`;
    const costRecord = await makeEvidenceRecord({
      sourceId: "direct",
      claimId,
      sourceKind: "direct_cost_evidence",
      sourceLocator: {
        official_host: "api.direct.yandex.com",
        source: normalizedCost.compact_source,
        observation_id: normalizedCost.observations.find((item) => item.source === normalizedCost.compact_source)?.observation_id ?? null,
      },
      fetchedAt: normalizedCost.as_of ?? generated,
      observedAt: normalizedCost.as_of ?? generated,
      scope: normalizedCost.scope ?? {},
      collectionPolicy: {
        policy_id: "official-yandex-direct-read-only-cost",
        version: "v1",
        allowed_hosts: ["api.direct.yandex.com", "api.direct.yandex.ru"],
        browser_cabinet_allowed: false,
        source_precedence: ["LEGACY_LIVE4_SCENARIO", "KEYWORDBIDS_V5_CURRENT_PROXY", "DIRECT_HISTORY_OWN_EMPIRICAL"],
        averaging_allowed: false,
      },
      extraction: {
        method: "qualified_source_selection",
        version: "prelaunch-cost-precedence-v1",
        selector_or_jsonpath: null,
        request_digest: await contentHash({ source: normalizedCost.compact_source, scope: normalizedCost.scope }),
      },
      rawValue: normalizedCost.observations,
      normalized: normalizedCost,
      limitations: ["The selected range is a scenario or empirical range, not a performance guarantee."],
      qualityFlags: ["FIRST_QUALIFIED_SOURCE_NO_AVERAGING"],
      providerMetadata: { precedence: normalizedCost.aggregation },
      asOf,
    });
    evidence.push(costRecord);
    sourceEvidence.direct.push(costRecord.evidence_id);
    claims.push(await makeClaim({
      subject: "prelaunch_cost",
      predicate: "qualified_cost_range",
      value: normalizedCost,
      normalized: { value: normalizedCost, datatype: "money_range" },
      classification: "documented_api_fact",
      evidence_ids: [costRecord.evidence_id],
      confidence: confidenceForClaim({
        quality: "A",
        freshness: claimFreshness(isoTimestamp(normalizedCost.as_of), asOf),
        consistency: "single",
        coverage: "complete_for_scope",
        uncertainty: ["Source-labelled pre-launch cost is not a conversion or profitability forecast."],
        tier: "TIER_1_VERIFIED",
      }),
    }));
  }

  claims.sort((left, right) => compareText(left.claim_id, right.claim_id));
  evidence.sort((left, right) => compareText(left.evidence_id, right.evidence_id));

  const conflicts: EvidenceConflict[] = [];
  for (const rawConflict of list(model.conflicts).map(record)) {
    const predicate = text(rawConflict.predicate);
    conflicts.push(await makeConflict({
      claim_ids: claims.filter((claim) => claim.predicate === predicate).map((claim) => claim.claim_id),
      predicate,
      left_value: rawConflict.left_value,
      right_value: rawConflict.right_value,
      relation: ["supersedes", "scope_mismatch"].includes(text(rawConflict.relation))
        ? text(rawConflict.relation) as "supersedes" | "scope_mismatch"
        : "contradicts",
      material: rawConflict.material === true,
      resolution: text(rawConflict.resolution) || "UNRESOLVED",
    }));
  }
  conflicts.sort((left, right) => compareText(left.conflict_id, right.conflict_id));
  const conflictedPredicates = new Set(conflicts.filter((item) => item.resolution.startsWith("UNRESOLVED")).map((item) => item.predicate));
  for (const claim of claims) {
    if (conflictedPredicates.has(claim.predicate)) {
      (claim.confidence as ClaimConfidence).consistency = "conflicted";
      (claim.confidence as ClaimConfidence).uncertainty = [...claim.confidence.uncertainty, "Unresolved conflicting evidence."];
    }
    const claimBody = { ...claim } as Record<string, unknown>;
    delete claimBody.claim_id;
    delete claimBody.claim_hash;
    claim.claim_hash = await contentHash(claimBody);
  }

  const gaps: EvidenceGap[] = [];
  for (const question of missingQuestions) {
    gaps.push(await makeGap({
      code: "BUSINESS_MODEL_EVIDENCE_MISSING",
      source_id: "first-party-web",
      description: question,
      material: true,
      limitations: ["Material business fact remains unresolved after permitted first-party research."],
    }));
  }
  if (!directInventoryReady) {
    gaps.push(await makeGap({
      code: "CURRENT_DIRECT_INVENTORY_UNAVAILABLE",
      source_id: "direct",
      description: "Current Direct inventory is unavailable; duplicate and already-covered demand status is unknown, not zero activity.",
      material: true,
      limitations: list(direct.blockers).map(text).filter(Boolean),
    }));
  }
  if (!metrikaReportReady) {
    gaps.push(await makeGap({
      code: "METRIKA_REPORT_UNAVAILABLE",
      source_id: "metrika",
      description: "Metrika report evidence is unavailable for the exact counter and goal binding.",
      material: false,
      limitations: list(metrika.blockers).map(text).filter(Boolean),
    }));
  }
  if (!sourceEvidence.competitors.length) {
    gaps.push(await makeGap({
      code: "PUBLIC_COMPETITOR_OBSERVATIONS_UNAVAILABLE",
      source_id: "competitors",
      description: "No allowlisted policy-bound public competitor observation was collected.",
      material: false,
      limitations: ["Unavailable competitor evidence remains unavailable and cannot become a competitive control."],
    }));
  }
  gaps.push(await makeGap({
    code: "COMPETITOR_INTERNAL_PERFORMANCE_UNAVAILABLE",
    source_id: "competitors",
    description: "Competitor budgets, CPC, conversions, account state and internal strategy are unavailable by policy.",
    material: false,
    limitations: ["Public observations cannot establish hidden competitor performance facts."],
  }));
  for (const gap of marketEvidence.frequency.gaps) {
    gaps.push(await makeGap({
      code: gap.code,
      source_id: "wordstat",
      description: gap.detail,
      material: marketEvidence.frequency.status === "UNAVAILABLE",
      limitations: ["Unavailable or partial Wordstat evidence is not zero demand."],
    }));
  }
  if (marketEvidence.cost.status === "UNAVAILABLE") {
    gaps.push(await makeGap({
      code: "PRELAUNCH_COST_UNAVAILABLE",
      source_id: "direct",
      description: "No qualified account-specific preflight, comparable current auction proxy or comparable first-party historical CPC is available.",
      material: false,
      limitations: marketEvidence.cost.missing_or_conflict_reasons,
    }));
  }
  gaps.sort((left, right) => compareText(left.gap_id, right.gap_id));

  const modelFields = ["product", "audience", "value", "qualified_result", "exclusions"];
  const populatedModelFields = modelFields.filter((field) => text(model[field])).length;
  const publicEvidenceFields = modelFields.filter((field) => {
    const item = record(fieldEvidence[field]);
    return Boolean(text(item.quote) && text(item.source_url));
  }).length;
  const firstPartyStatus: EvidenceSourceStatus = sourceEvidence["first-party-web"].length
    ? missingQuestions.length === 0 && publicEvidenceFields >= populatedModelFields
      ? "VERIFIED"
      : "PARTIAL"
    : list(site.pages).length
      ? "PARTIAL"
      : "UNAVAILABLE";
  const ownerStatus: EvidenceSourceStatus = sourceEvidence["owner-confirmed"].length ? "VERIFIED" : "UNAVAILABLE";
  const directAuditComplete = directAuditReady
    && text(directAudit.status) === "COMPLETE"
    && list(directReadLimitations.methods_not_read).length === 0;
  const directStatus: EvidenceSourceStatus = directInventoryReady
    ? directAuditComplete ? "VERIFIED" : "PARTIAL"
    : "UNAVAILABLE";
  const metrikaStatus: EvidenceSourceStatus = metrikaReportReady
    ? metrikaPartial ? "PARTIAL" : "VERIFIED"
    : metrikaManagementReady ? "PARTIAL" : "UNAVAILABLE";
  const competitorStatus: EvidenceSourceStatus = sourceEvidence.competitors.length ? "PARTIAL" : "UNAVAILABLE";
  const wordstatStatus: EvidenceSourceStatus = marketEvidence.frequency.status === "AVAILABLE"
    && ["AVAILABLE", "INSUFFICIENT_HISTORY"].includes(marketEvidence.frequency.seasonality.status)
    && marketEvidence.frequency.geo_evidence.status === "AVAILABLE"
    ? "VERIFIED"
    : marketEvidence.frequency.status === "UNAVAILABLE" ? "UNAVAILABLE" : "PARTIAL";

  const sources = await Promise.all([
    makeSource({
      source_id: "first-party-web",
      title: "Компания и продукты · first-party public",
      source_kind: "first_party_web",
      provenance_class: "FIRST_PARTY_PUBLIC",
      status: firstPartyStatus,
      observed_at: siteObservedAt,
      generated_at: generated,
      scope: { company_host: companyHost, pages_analyzed: numberOr(siteResearch.pages_analyzed, list(site.pages).length) },
      access: firstPartyStatus === "UNAVAILABLE" ? "unavailable" : "public",
      collection_policy: { policy_id: "first-party-public-https", version: "1.0.0", no_auth: true },
      versions: { schema: ANALYTICS_EVIDENCE_SCHEMA, extractor: text(modelResearch.agent) || "GPT_SITES_EVIDENCE_RESEARCH_V3", policy: "first-party-public-https/1.0.0" },
      facts: [`${sourceEvidence["first-party-web"].length} first-party Evidence Records`],
      limitations: firstPartyStatus === "VERIFIED" ? [] : ["No recoverable first-party evidence span is available."],
      evidence_ids: sourceEvidence["first-party-web"],
    }),
    makeSource({
      source_id: "owner-confirmed",
      title: "Подтверждения владельца",
      source_kind: "owner_confirmation",
      provenance_class: "OWNER_CONFIRMED",
      status: ownerStatus,
      observed_at: latestTimestamp(ownerObservedAts),
      generated_at: generated,
      scope: { company_host: companyHost, state_path: "business_model" },
      access: ownerStatus === "UNAVAILABLE" ? "unavailable" : "owner_authorized",
      collection_policy: { policy_id: "owner-confirmation", version: "1.0.0" },
      versions: { schema: ANALYTICS_EVIDENCE_SCHEMA, extractor: "p0-owner-confirmation-v1", policy: "owner-confirmation/1.0.0" },
      facts: [`${sourceEvidence["owner-confirmed"].length} owner-confirmed Evidence Records`],
      limitations: ownerStatus === "UNAVAILABLE" ? ["No separately timestamped owner confirmation exists in this revision."] : [],
      evidence_ids: sourceEvidence["owner-confirmed"],
    }),
    makeSource({
      source_id: "direct",
      title: "Текущий Яндекс Директ",
      source_kind: "direct_management_api",
      provenance_class: "DIRECT_OFFICIAL_API",
      status: directStatus,
      observed_at: directObservedAt,
      generated_at: generated,
      scope: { client_login: directAccount, client_id: directClientId },
      access: directOfficial ? "owner_authorized" : "unavailable",
      collection_policy: directAuditReady ? {
        policy_id: "official-yandex-direct-read-only",
        version: "v501-object-graph-and-reports-v1",
        allowed_host: "api.direct.yandex.com",
        browser_cabinet_allowed: false,
        provider_write_methods_reachable: false,
      } : {
        policy_id: "official-yandex-direct-read-only",
        version: "v501",
        allowed_host: "api.direct.yandex.com",
        browser_cabinet_allowed: false,
      },
      versions: {
        schema: ANALYTICS_EVIDENCE_SCHEMA,
        extractor: directAuditReady ? "direct-v501-complete-audit-v1" : "direct-v501-campaign-inventory-v2",
        policy: directAuditReady ? "official-yandex-direct-read-only/v501-object-graph-and-reports-v1" : "official-yandex-direct-read-only/v501",
      },
      facts: directInventoryReady ? directAuditReady
        ? [
            `${numberOr(directAuditCounts.campaigns)} campaigns, ${numberOr(directAuditCounts.adgroups)} groups, ${numberOr(directAuditCounts.keywords)} keywords/autotargetings and ${numberOr(directAuditCounts.ads)} ads are linked to durable audit artifacts.`,
            `${list(directAudit.report_summaries).filter((item) => text(record(item).status) === "COMPLETE").length} Direct Reports artifacts completed for the exact account.`,
          ]
        : [`${numberOr(direct.campaigns_total)} current campaign objects read through Campaigns.get`]
        : [],
      limitations: directInventoryReady
        ? directAuditReady
          ? [
              ...list(directAudit.limitations).map(text).filter(Boolean),
              ...list(directReadLimitations.methods_not_read).map((method) => `${text(method)} не прочитан в этом snapshot.`),
              "Direct statistics for the last three days remain provisional.",
            ]
          : ["AdGroups.get, Keywords.get, Ads.get and Search Query reports are not part of this snapshot.", "Direct statistics for the last three days remain provisional."]
        : ["Current Direct inventory unavailable; activity is unknown, not zero.", ...list(direct.blockers).map(text).filter(Boolean)],
      evidence_ids: sourceEvidence.direct,
    }),
    makeSource({
      source_id: "metrika",
      title: "Яндекс Метрика",
      source_kind: "metrica_management_api_and_reports_api",
      provenance_class: "METRIKA_OFFICIAL_API",
      status: metrikaStatus,
      observed_at: metrikaObservedAt,
      generated_at: generated,
      scope: { counter_id: metrikaCounterId, goal_id: metrikaGoalId },
      access: metrikaOfficial ? "owner_authorized" : "unavailable",
      collection_policy: { policy_id: "official-yandex-metrika-read-only", version: "management-and-reports-v1", allowed_host: "api-metrika.yandex.net", browser_cabinet_allowed: false },
      versions: { schema: ANALYTICS_EVIDENCE_SCHEMA, extractor: "metrika-stat-v2", policy: "official-yandex-metrika-read-only/v1" },
      facts: metrikaReportReady ? [`Report is bound to counter ${metrikaCounterId} and goal ${metrikaGoalId}`] : [],
      limitations: [
        ...(!metrikaReportReady ? [metrikaReportOfficial
          ? "Exact-bound Metrika report unavailable."
          : "Metrika report provenance is not the official METRIKA_REPORTS_API adapter."] : []),
        ...(!samplingMetadataComplete ? ["Sampling/privacy/lag metadata unavailable; coverage is partial."] : []),
        ...(sampling.sampled === true ? ["Response is sampled; coverage is partial."] : []),
        ...(sampling.contains_sensitive_data === true ? ["Privacy limitation is attached; coverage is partial."] : []),
        ...(numberOr(sampling.data_lag) > 0 ? [`Provider data lag: ${numberOr(sampling.data_lag)} seconds.`] : []),
      ],
      evidence_ids: sourceEvidence.metrika,
    }),
    makeSource({
      source_id: "competitors",
      title: "Допустимые публичные наблюдения конкурентов",
      source_kind: "competitor_public_web",
      provenance_class: "COMPETITOR_PUBLIC",
      status: competitorStatus,
      observed_at: latestTimestamp(competitorObservedAts),
      generated_at: generated,
      scope: {
        observations: sourceEvidence.competitors.length,
        collection: "PUBLIC_RESEARCH_EGRESS_V1",
        competitor_set_rule: competitorMatrix?.candidate_set.competitor_set_rule ?? "UNAVAILABLE",
        denominator: competitorMatrix?.candidate_set.candidates.length ?? null,
        observed_count: competitorMatrix?.rows.length ? new Set(competitorMatrix.rows.map((row) => row.competitor)).size : null,
      },
      access: competitorStatus === "UNAVAILABLE" ? "unavailable" : "public",
      collection_policy: { policy_id: "public-competitor-pages", version: "2.0.0", exact_host_allowlist: true, exact_destination_allowlist: true, public_no_auth: true },
      versions: { schema: ANALYTICS_EVIDENCE_SCHEMA, extractor: "bounded-competitor-matrix-v1", policy: "public-competitor-pages/2.0.0" },
      facts: competitorMatrix?.rows.length ? [
        `${competitorMatrix.rows.length} bounded public landing observations`,
        `Candidate set denominator: ${competitorMatrix.candidate_set.candidates.length}`,
      ] : [],
      limitations: [
        ...(sourceEvidence.competitors.length ? ["Public observations are indicative and do not prove prevalence or effectiveness."] : ["No policy-bound public competitor observations are available."]),
        "Budgets, CPC, conversions, account state and internal strategy remain unavailable.",
      ],
      evidence_ids: sourceEvidence.competitors,
    }),
    makeSource({
      source_id: "wordstat",
      title: "Спрос и Wordstat",
      source_kind: "wordstat_api",
      provenance_class: "WORDSTAT_OFFICIAL_API",
      status: wordstatStatus,
      observed_at: wordstatStatus === "UNAVAILABLE" ? null : marketEvidence.batch_finished_at,
      generated_at: generated,
      scope: {
        batch_id: marketEvidence.snapshot_batch_id,
        scopes: marketEvidence.frequency.scopes,
        declared_window: marketEvidence.frequency.declared_window,
        source_window_end: marketEvidence.frequency.source_window_end,
      },
      access: wordstatStatus === "UNAVAILABLE" ? "unavailable" : "owner_authorized",
      collection_policy: {
        policy_id: "official-yandex-wordstat-read-only",
        version: "v1",
        allowed_host: "api.wordstat.yandex.net",
        allowed_methods: ["POST /v1/topRequests", "POST /v1/dynamics", "POST /v1/regions"],
        browser_cabinet_allowed: false,
      },
      versions: { schema: ANALYTICS_EVIDENCE_SCHEMA, extractor: "wordstat-v1-scoped-demand-v1", policy: "official-yandex-wordstat-read-only/v1" },
      facts: marketEvidence.frequency.status === "UNAVAILABLE" ? [] : [
        `${marketEvidence.frequency.unique_assigned_rows.length} unique assigned Wordstat top rows`,
        "Cluster frequency is LOWER_BOUND_OBSERVED_TOP_ROWS.",
      ],
      limitations: [
        "Wordstat frequency is not CPC, users, clicks, guaranteed impressions or a budget forecast.",
        "The exact rolling 30-day source window end is undisclosed by the API.",
        ...marketEvidence.frequency.gaps.map((gap) => gap.detail),
      ],
      evidence_ids: sourceEvidence.wordstat,
    }),
  ]);

  const statuses = sources.map((source) => source.status);
  const materialConflictBlockers = conflicts
    .filter((item) => item.material && item.resolution.startsWith("UNRESOLVED"))
    .map((item) => `Unresolved material conflict: ${item.predicate}.`);
  const hardBlockers = [
    ...missingQuestions.map((question) => `Не разрешено: ${question}`),
    ...(firstPartyStatus === "UNAVAILABLE" && ownerStatus === "UNAVAILABLE"
      ? ["First-party business model has no recoverable evidence or owner confirmation."]
      : []),
    ...(!directInventoryReady ? ["Current Direct inventory недоступен: duplicates and already-covered demand are unknown, not zero."] : []),
    ...materialConflictBlockers,
  ];
  const materialUncertainties = [
    ...gaps.map((gap) => gap.description),
    ...conflicts.filter((item) => item.resolution.startsWith("UNRESOLVED")).map((item) => `Conflict: ${item.predicate}.`),
    ...(metrikaPartial ? ["Metrika sampling, privacy or lag metadata limits coverage."] : []),
  ];
  const availableObservedAts = sources.filter((source) => source.status !== "UNAVAILABLE").map((source) => source.observed_at);
  const freshnessValues = availableObservedAts.map((value) => freshnessStatus(value, asOf));
  const confidence: ConfidenceVector = {
    quality: sourceEvidence.competitors.length ? "MIXED_ALLOWED" : claims.length ? "PRIMARY_ONLY" : "UNKNOWN",
    freshness: freshnessValues.length === 0
      ? "UNKNOWN"
      : freshnessValues.every((value) => value === "fresh") ? "CURRENT" : "MIXED",
    consistency: conflicts.some((item) => item.resolution.startsWith("UNRESOLVED"))
      ? "CONFLICTED"
      : claims.some((claim) => claim.confidence.consistency === "corroborated") ? "CORROBORATED" : "SINGLE_SOURCE",
    coverage: statuses.every((status) => status === "VERIFIED") ? "COMPLETE_FOR_SCOPE" : "PARTIAL",
    uncertainty: materialUncertainties,
  };
  const versions = {
    schema: ANALYTICS_EVIDENCE_SCHEMA,
    contract: ANALYTICS_EVIDENCE_CONTRACT_VERSION,
    canonicalization: CANONICALIZATION_VERSION,
    normalizer: NORMALIZER_VERSION,
    redaction: REDACTION_VERSION,
    model_extractor: text(modelResearch.agent) || "GPT_SITES_EVIDENCE_RESEARCH_V3",
    direct_adapter: "direct-v501-campaign-inventory-v2",
    metrika_adapter: "metrika-management-and-stat-v2",
    wordstat_adapter: "wordstat-v1-scoped-demand-v1",
    competitor_policy: "public-competitor-pages-v2",
  };
  const hashes = {
    input_root_sha256: await contentHash({
      scope,
      generated_at: generated,
      as_of: asOf,
      versions,
      sources,
      claims,
      evidence,
      conflicts,
      gaps,
      competitor_matrix: competitorMatrix,
      product_catalog: productFocus.catalog,
      focus_opportunities: productFocus.focus_opportunities,
      market_evidence: marketEvidence,
    }),
    sources_sha256: await contentHash(sources),
    claims_sha256: await contentHash(claims),
    evidence_sha256: await contentHash(evidence),
    conflicts_sha256: await contentHash(conflicts),
    gaps_sha256: await contentHash(gaps),
    competitor_matrix_sha256: await contentHash(competitorMatrix),
    product_catalog_sha256: await contentHash(productFocus.catalog),
    focus_opportunities_sha256: await contentHash(productFocus.focus_opportunities),
    market_evidence_sha256: await contentHash(marketEvidence),
  };
  const unsigned: Omit<AnalyticsEvidenceBundle, "snapshot_id"> = {
    schema_version: ANALYTICS_EVIDENCE_SCHEMA,
    contract_version: ANALYTICS_EVIDENCE_CONTRACT_VERSION,
    generated_at: generated,
    as_of: asOf,
    scope,
    immutability: {
      content_addressed: true as const,
      canonicalization: CANONICALIZATION_VERSION,
      revision_required_for_change: true as const,
    },
    recommendation_status: hardBlockers.length ? "BLOCKED_UNKNOWN" as const : "EVIDENCE_READY_WITH_GAPS" as const,
    summary: {
      sources_total: sources.length,
      sources_verified: statuses.filter((status) => status === "VERIFIED").length,
      sources_partial: statuses.filter((status) => status === "PARTIAL").length,
      sources_unavailable: statuses.filter((status) => status === "UNAVAILABLE").length,
      claims_supported: claims.length,
      hard_blockers: hardBlockers,
    },
    confidence,
    sources,
    claims,
    evidence,
    conflicts,
    gaps,
    material_uncertainties: materialUncertainties,
    competitor_matrix: competitorMatrix,
    product_catalog: productFocus.catalog,
    focus_opportunities: productFocus.focus_opportunities,
    market_evidence: marketEvidence,
    prelaunch_cost: marketEvidence.cost,
    versions,
    hashes,
    contract_path: "docs/research/analytics-evidence-contract.md",
  };
  const snapshotId = await contentHash(unsigned);
  const snapshot: AnalyticsEvidenceBundle = { ...unsigned, snapshot_id: snapshotId };
  if (JSON.stringify(snapshot).match(/(?:Bearer|OAuth|Api-Key)\s+[^\s";,]+/iu)) {
    fail("EVIDENCE_ARTIFACT_SENSITIVE", "Evidence artifact contains a credential pattern after redaction.");
  }
  return deepFreeze(snapshot);
}

export async function verifyAnalyticsEvidenceSnapshot(snapshot: AnalyticsEvidenceBundle | unknown) {
  try {
    const candidate = record(snapshot);
    const snapshotId = text(candidate.snapshot_id);
    if (!snapshotId) return false;
    if (candidate.schema_version === "p0-analytics-evidence-v1") {
      const unsigned = { ...candidate };
      delete unsigned.snapshot_id;
      return snapshotId === await contentHash(unsigned);
    }
    if (candidate.schema_version !== ANALYTICS_EVIDENCE_SCHEMA && !LEGACY_ANALYTICS_EVIDENCE_SCHEMAS.has(String(candidate.schema_version))) return false;
    const current = candidate as unknown as AnalyticsEvidenceBundle;
    for (const source of current.sources) {
      const { manifest_hash: manifestHash, ...body } = source;
      if (manifestHash !== await contentHash(body)) return false;
    }
    const claimIds = new Set(current.claims.map((claim) => claim.claim_id));
    for (const claim of current.claims) {
      const body = { ...claim } as Record<string, unknown>;
      delete body.claim_id;
      delete body.claim_hash;
      if (claim.claim_hash !== await contentHash(body)) return false;
    }
    for (const evidenceRecord of current.evidence) {
      if (evidenceRecord.claim_links.some((link) => !claimIds.has(link.claim_id))) return false;
      const { evidence_id: evidenceId, record_hash: recordHash, ...body } = evidenceRecord;
      if (recordHash !== await contentHash(body)) return false;
      if (evidenceId !== `urn:mox:evidence:${recordHash.slice("sha256:".length)}`) return false;
      if (evidenceRecord.raw.sha256 !== await contentHash(evidenceRecord.raw.value)) return false;
    }
    for (const conflict of current.conflicts) {
      const { conflict_id: conflictId, conflict_hash: conflictHash, ...body } = conflict;
      if (conflictHash !== await contentHash(body)) return false;
      if (conflictId !== `urn:mox:conflict:${conflictHash.slice("sha256:".length)}`) return false;
    }
    for (const gap of current.gaps) {
      const { gap_id: gapId, gap_hash: gapHash, ...body } = gap;
      if (gapHash !== await contentHash(body)) return false;
      if (gapId !== `urn:mox:gap:${gapHash.slice("sha256:".length)}`) return false;
    }
    if (current.hashes.sources_sha256 !== await contentHash(current.sources)) return false;
    if (current.hashes.claims_sha256 !== await contentHash(current.claims)) return false;
    if (current.hashes.evidence_sha256 !== await contentHash(current.evidence)) return false;
    if (current.hashes.conflicts_sha256 !== await contentHash(current.conflicts)) return false;
    if (current.hashes.gaps_sha256 !== await contentHash(current.gaps)) return false;
    const hasCompetitorMatrix = Object.hasOwn(current as unknown as Record<string, unknown>, "competitor_matrix");
    if (candidate.schema_version === ANALYTICS_EVIDENCE_SCHEMA && !hasCompetitorMatrix) return false;
    if (hasCompetitorMatrix && current.hashes.competitor_matrix_sha256 !== await contentHash(current.competitor_matrix)) return false;
    const hasMarketEvidence = Boolean((current as unknown as Record<string, unknown>).market_evidence);
    if (hasMarketEvidence && current.hashes.market_evidence_sha256 !== await contentHash(current.market_evidence)) return false;
    const hasProductFocus = Boolean(
      (current as unknown as Record<string, unknown>).product_catalog
      && (current as unknown as Record<string, unknown>).focus_opportunities,
    );
    if (candidate.schema_version === ANALYTICS_EVIDENCE_SCHEMA && !hasProductFocus) return false;
    if (hasProductFocus) {
      const { catalog_id: catalogId, ...catalogBody } = current.product_catalog;
      if (catalogId !== await contentHash(catalogBody)) return false;
      const { recommendation_id: recommendationId, ...recommendationBody } = current.focus_opportunities;
      if (recommendationId !== await contentHash(recommendationBody)) return false;
      if (current.focus_opportunities.catalog_id !== catalogId) return false;
      if (current.hashes.product_catalog_sha256 !== await contentHash(current.product_catalog)) return false;
      if (current.hashes.focus_opportunities_sha256 !== await contentHash(current.focus_opportunities)) return false;
    }
    const inputRoot = {
      scope: current.scope,
      generated_at: current.generated_at,
      as_of: current.as_of,
      versions: current.versions,
      sources: current.sources,
      claims: current.claims,
      evidence: current.evidence,
      conflicts: current.conflicts,
      gaps: current.gaps,
      ...(hasCompetitorMatrix ? { competitor_matrix: current.competitor_matrix } : {}),
      ...(hasProductFocus ? {
        product_catalog: current.product_catalog,
        focus_opportunities: current.focus_opportunities,
      } : {}),
      ...(hasMarketEvidence ? { market_evidence: current.market_evidence } : {}),
    };
    if (current.hashes.input_root_sha256 !== await contentHash(inputRoot)) return false;
    const unsigned = { ...current } as Record<string, unknown>;
    delete unsigned.snapshot_id;
    return snapshotId === await contentHash(unsigned);
  } catch {
    return false;
  }
}

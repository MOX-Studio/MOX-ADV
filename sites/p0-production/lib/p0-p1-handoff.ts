import {
  canonicalizeEvidence,
  verifyAnalyticsEvidenceSnapshot,
  type AnalyticsEvidenceBundle,
} from "./analytics-evidence.ts";
import {
  BUSINESS_MODEL_FIELD_ORDER,
  BUSINESS_MODEL_SCHEMA,
  type BusinessModelContract,
} from "./business-model-contract.ts";
import {
  verifyAuctionProtocol,
  verifyAuctionProtocolContentHash,
  type AuctionProtocol,
} from "./auction-protocol.ts";
import {
  verifyHumanDecisionGate,
  type HumanDecisionGate,
  type PackageReview,
} from "./campaign-decision-gate.ts";
import {
  verifyPackageCorrection,
  type PackageCorrection,
} from "./campaign-correction.ts";
import type { CampaignRecommendationSet } from "./campaign-fanout.ts";
import {
  verifyPackageExecution,
  type PackageExecution,
  type PackageItemExecution,
} from "./campaign-package-execution.ts";
import {
  CAMPAIGN_STRATEGY_SCHEMA,
  strategyAnswersFingerprint,
  type CampaignStrategyRevision,
} from "./campaign-strategy.ts";

export const P0_P1_HANDOFF_SCHEMA = "p0-p1-campaign-handoff-v1";
export const P0_P1_HANDOFF_CONTRACT_VERSION = "1.0.0";
const CAMPAIGN_REVISION_SCHEMA = "p0-created-campaign-revision-v1";
const STATE_EVIDENCE_SCHEMA = "p0-final-campaign-state-evidence-v1";

export type P0P1FinalState = {
  schema_version: typeof STATE_EVIDENCE_SCHEMA;
  state_evidence_id: string;
  observed_at: string;
  creation: "CONFIRMED_CREATED" | "NOT_CREATED" | "PENDING" | "UNKNOWN" | "FAILED";
  moderation: "ACCEPTED" | "PENDING" | "REJECTED" | "NOT_APPLICABLE" | "UNKNOWN";
  serving: "SUSPENDED" | "NOT_APPLICABLE" | "RECONCILIATION_REQUIRED" | "UNKNOWN";
  supported_graph: "VERIFIED" | "NOT_APPLICABLE" | "INCOMPLETE" | "UNKNOWN";
};

export type P0P1CampaignAttempt = {
  attempt_kind: "INITIAL_CREATION" | "CORRECTED_CREATION";
  campaign_revision: {
    schema_version: typeof CAMPAIGN_REVISION_SCHEMA;
    campaign_revision_id: string;
    source_draft_id: string;
    source_draft_revision_id: string;
    strategy_revision_id: string;
    publish_fingerprint: string;
    business_shape: {
      name: string;
      product: string;
      audience: string;
      offer: string;
      keyword_cluster: string;
    };
  };
  lineage: {
    strategy_revision_id: string;
    strategy_material_fingerprint: string;
    previous_strategy_revision_id: string | null;
    business_model_revision_id: string;
    business_model_material_fingerprint: string;
    analytics_evidence: {
      schema_version: string;
      contract_version: string;
      snapshot_id: string;
      as_of: string;
      hashes: AnalyticsEvidenceBundle["hashes"];
    };
  };
  frozen_auction_protocol: AuctionProtocol;
  final_state: P0P1FinalState;
};

export type P0P1ExcludedOutcome = P0P1CampaignAttempt & {
  reason:
    | "CREATION_PENDING"
    | "CREATION_REJECTED"
    | "MODERATION_PENDING"
    | "MODERATION_REJECTED"
    | "RECONCILIATION_REQUIRED"
    | "SYSTEM_FAILURE"
    | "INCOMPLETE_LINEAGE";
};

export type P0P1Handoff = {
  schema_version: typeof P0_P1_HANDOFF_SCHEMA;
  contract_version: typeof P0_P1_HANDOFF_CONTRACT_VERSION;
  handoff_id: string;
  produced_by: "P0";
  consumed_by: "P1";
  reproduced_at: string;
  admitted_campaigns: P0P1CampaignAttempt[];
  excluded_outcomes: P0P1ExcludedOutcome[];
  capability_boundary: {
    serving: "NOT_GRANTED";
    resume: "NOT_GRANTED";
    spend: "NOT_GRANTED";
    mutable_direct_credentials: "OMITTED";
    internal_journals: "OMITTED";
    provider_diagnostics: "OMITTED";
  };
  learning_boundary: {
    mature_result_owner: "P1";
    knowledge_claim_owner: "P1";
    permitted_import_effects: ["RANK_FUTURE_HYPOTHESES", "DRAFT_FUTURE_HYPOTHESIS"];
    prohibited_direct_effects: ["CAMPAIGN_MUTATION", "EXECUTION_AUTHORITY_MUTATION", "POLICY_MUTATION", "PLAYBOOK_MUTATION", "P0_AUTHORITY_MUTATION"];
  };
};

export type P0P1HandoffSource = {
  business_model: { owner_contract: BusinessModelContract } | Record<string, unknown> | null;
  strategy: CampaignStrategyRevision | Record<string, unknown> | null;
  analytics_evidence_snapshot: AnalyticsEvidenceBundle | null;
  recommendation_set: CampaignRecommendationSet | null;
  package_review: PackageReview | null;
  human_decision_gate: HumanDecisionGate | null;
  package_execution: PackageExecution | null;
  package_corrections: PackageCorrection[];
};

type AttemptSource = {
  kind: P0P1CampaignAttempt["attempt_kind"];
  execution: PackageExecution;
  review: PackageReview;
  gate: HumanDecisionGate;
  recommendationSet: CampaignRecommendationSet;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function exactKeys(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return JSON.stringify(Object.keys(value as Record<string, unknown>).sort())
    === JSON.stringify([...keys].sort());
}

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(canonicalizeEvidence(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

function text(value: unknown, maximum = 2_000) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, maximum);
}

function hasDigest(value: unknown) {
  return /^sha256:[a-f0-9]{64}$/u.test(String(value ?? ""));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

async function verifyBusinessModel(contract: BusinessModelContract) {
  if (contract.schema_version !== BUSINESS_MODEL_SCHEMA
    || !contract.model_revision_id
    || !hasDigest(contract.material_fingerprint)
    || !contract.fields) return false;
  const material = BUSINESS_MODEL_FIELD_ORDER.map((field) => ({
    field,
    value: contract.fields[field]?.value,
    owner_confirmed: contract.fields[field]?.owner_confirmed,
    assumption: contract.fields[field]?.assumption,
  }));
  const digest = await sha256(material);
  return contract.material_fingerprint === digest
    && contract.model_revision_id === `business-model:${digest.slice("sha256:".length, "sha256:".length + 24)}`;
}

async function verifyStrategy(strategy: CampaignStrategyRevision, model: BusinessModelContract, evidence: AnalyticsEvidenceBundle) {
  if (strategy.schema_version !== CAMPAIGN_STRATEGY_SCHEMA
    || strategy.business_model_revision_id !== model.model_revision_id
    || strategy.analytics_evidence_snapshot_id !== evidence.snapshot_id
    || !strategy.strategy_revision_id
    || !Array.isArray(strategy.answers)
    || strategy.approved_by !== "OWNER"
    || strategy.approval_command !== "APPROVE_CAMPAIGN_STRATEGY") return false;
  const answers = Object.fromEntries(strategy.answers.map((answer) => [answer.field_id, answer.value]));
  return strategy.material_fingerprint === await strategyAnswersFingerprint(answers as never);
}

function attemptReason(item: PackageItemExecution): P0P1ExcludedOutcome["reason"] | null {
  if (item.status === "DIRECT_ACCEPTED"
    && item.accountability.direct_accepted === true
    && item.accountability.supported_graph_verified === true
    && item.accountability.campaign_suspended === true
    && item.progress.creation === "CREATED"
    && item.progress.suspension === "CONFIRMED_SUSPENDED"
    && item.progress.readback === "VERIFIED"
    && item.progress.moderation === "ACCEPTED"
    && item.campaign_state === "SUSPENDED"
    && item.containment === "CONFIRMED_SUSPENDED") return null;
  if (item.status === "RECONCILIATION_REQUIRED" || item.status === "OUTCOME_UNKNOWN") return "RECONCILIATION_REQUIRED";
  if (item.status === "MODERATION_PENDING") return "MODERATION_PENDING";
  if (item.status === "REJECTED_NEEDS_EDIT") return "MODERATION_REJECTED";
  if (item.status === "PROVIDER_REJECTED") return "CREATION_REJECTED";
  if (item.status === "QUEUED" || item.status === "DISPATCHING") return "CREATION_PENDING";
  if (item.status === "SYSTEM_FAILED") return "SYSTEM_FAILURE";
  return "INCOMPLETE_LINEAGE";
}

async function stateEvidence(item: PackageItemExecution): Promise<P0P1FinalState> {
  const creation: P0P1FinalState["creation"] = item.progress.creation === "CREATED" ? "CONFIRMED_CREATED"
    : item.progress.creation === "NOT_ATTEMPTED" || item.progress.creation === "REJECTED" ? "NOT_CREATED"
      : item.progress.creation === "PENDING" ? "PENDING"
        : item.progress.creation === "UNKNOWN" ? "UNKNOWN" : "FAILED";
  const moderation: P0P1FinalState["moderation"] = item.progress.moderation === "ACCEPTED" ? "ACCEPTED"
    : item.progress.moderation === "REJECTED" ? "REJECTED"
      : item.progress.moderation === "PENDING" ? "PENDING"
        : item.progress.moderation === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : "UNKNOWN";
  const serving: P0P1FinalState["serving"] = item.progress.suspension === "CONFIRMED_SUSPENDED" && item.campaign_state === "SUSPENDED"
    ? "SUSPENDED"
    : item.status === "RECONCILIATION_REQUIRED" || item.status === "OUTCOME_UNKNOWN" ? "RECONCILIATION_REQUIRED"
      : item.progress.suspension === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : "UNKNOWN";
  const supportedGraph: P0P1FinalState["supported_graph"] = item.accountability.supported_graph_verified === true ? "VERIFIED"
    : item.progress.child_graph === "NOT_APPLICABLE" ? "NOT_APPLICABLE"
      : item.progress.child_graph === "UNKNOWN" || item.progress.readback === "UNKNOWN" ? "UNKNOWN" : "INCOMPLETE";
  const unsigned = {
    schema_version: STATE_EVIDENCE_SCHEMA as typeof STATE_EVIDENCE_SCHEMA,
    observed_at: item.updated_at,
    creation,
    moderation,
    serving,
    supported_graph: supportedGraph,
  };
  return { ...unsigned, state_evidence_id: await sha256(unsigned) };
}

async function campaignAttempt(input: {
  kind: P0P1CampaignAttempt["attempt_kind"];
  item: PackageItemExecution;
  draft: CampaignRecommendationSet["drafts"][number];
  strategy: CampaignStrategyRevision;
  model: BusinessModelContract;
  evidence: AnalyticsEvidenceBundle;
}): Promise<P0P1CampaignAttempt> {
  const dimensions = record(input.draft.dimensions);
  const businessShape = {
    name: text(input.draft.campaign_name, 255),
    product: text(dimensions.product, 500),
    audience: text(dimensions.audience, 500),
    offer: text(dimensions.offer, 500),
    keyword_cluster: text(dimensions.keyword_cluster, 500),
  };
  const campaignUnsigned = {
    schema_version: CAMPAIGN_REVISION_SCHEMA as typeof CAMPAIGN_REVISION_SCHEMA,
    source_draft_id: input.draft.draft_id,
    source_draft_revision_id: input.draft.draft_revision_id,
    strategy_revision_id: input.draft.strategy_revision_id,
    publish_fingerprint: input.draft.publish_fingerprint,
    business_shape: businessShape,
  };
  return {
    attempt_kind: input.kind,
    campaign_revision: {
      ...campaignUnsigned,
      campaign_revision_id: await sha256(campaignUnsigned),
    },
    lineage: {
      strategy_revision_id: input.strategy.strategy_revision_id,
      strategy_material_fingerprint: input.strategy.material_fingerprint,
      previous_strategy_revision_id: input.strategy.lineage.previous_strategy_revision_id,
      business_model_revision_id: input.model.model_revision_id,
      business_model_material_fingerprint: input.model.material_fingerprint,
      analytics_evidence: {
        schema_version: input.evidence.schema_version,
        contract_version: input.evidence.contract_version,
        snapshot_id: input.evidence.snapshot_id,
        as_of: input.evidence.as_of,
        hashes: structuredClone(input.evidence.hashes),
      },
    },
    frozen_auction_protocol: structuredClone(input.draft.auction_protocol),
    final_state: await stateEvidence(input.item),
  };
}

function sourceAttempts(source: P0P1HandoffSource): AttemptSource[] {
  if (!source.package_execution || !source.package_review || !source.human_decision_gate || !source.recommendation_set) {
    throw new Error("P0_P1_HANDOFF_EXECUTION_REQUIRED");
  }
  const attempts: AttemptSource[] = [{
    kind: "INITIAL_CREATION",
    execution: source.package_execution,
    review: source.package_review,
    gate: source.human_decision_gate,
    recommendationSet: source.recommendation_set,
  }];
  for (const correction of source.package_corrections) {
    if (!correction.execution) continue;
    if (!correction.package_review || !correction.human_decision_gate || !correction.corrected_recommendation_set) {
      throw new Error("P0_P1_HANDOFF_CORRECTION_LINEAGE_INVALID");
    }
    attempts.push({
      kind: "CORRECTED_CREATION",
      execution: correction.execution,
      review: correction.package_review,
      gate: correction.human_decision_gate,
      recommendationSet: correction.corrected_recommendation_set,
    });
  }
  return attempts;
}

function containsLeak(value: unknown): boolean {
  const forbiddenKeys = /^(?:(?:provider|direct|technical|internal).*(?:^|_)id|campaign_id|ad_id|ad_group_id|keyword_id|credential_profile|credentials|token|access_token|oauth_token|api_key|password|secret|journal|provider_issues|readback|direct_account_binding|client_id|internal_diagnostics)$/iu;
  const sensitiveValue = /(?:Bearer|OAuth|Api-Key)\s+[^\s";,]+|(?:access[_-]?token|oauth[_-]?token|api[_-]?key|password|secret)\s*[=:]/iu;
  if (typeof value === "string") return sensitiveValue.test(value);
  if (Array.isArray(value)) return value.some(containsLeak);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, item]) => forbiddenKeys.test(key) || containsLeak(item));
}

export async function buildP0P1Handoff(source: P0P1HandoffSource): Promise<P0P1Handoff> {
  const businessModel = record(source.business_model).owner_contract as BusinessModelContract;
  const strategy = source.strategy as CampaignStrategyRevision;
  const evidence = source.analytics_evidence_snapshot;
  if (!businessModel || !strategy || !evidence
    || !await verifyBusinessModel(businessModel)
    || !await verifyAnalyticsEvidenceSnapshot(evidence)
    || !await verifyStrategy(strategy, businessModel, evidence)) {
    throw new Error("P0_P1_HANDOFF_ROOT_LINEAGE_INVALID");
  }

  const admittedCampaigns: P0P1CampaignAttempt[] = [];
  const excludedOutcomes: P0P1ExcludedOutcome[] = [];
  const attempts = sourceAttempts(source);
  for (const attempt of attempts) {
    if (!await verifyHumanDecisionGate(attempt.gate, attempt.review)
      || !await verifyPackageExecution({ execution: attempt.execution, gate: attempt.gate, recommendationSet: attempt.recommendationSet })) {
      throw new Error("P0_P1_HANDOFF_EXECUTION_INTEGRITY_INVALID");
    }
    if (attempt.gate.authority.strategy_revision_id !== undefined
      && attempt.gate.authority.strategy_revision_id !== strategy.strategy_revision_id) {
      throw new Error("P0_P1_HANDOFF_STRATEGY_LINEAGE_INVALID");
    }
    const authorityStrategy = record(attempt.gate.authority.strategy_snapshot);
    const authorityModel = record(record(attempt.gate.authority.business_model_snapshot).owner_contract);
    const authorityEvidence = record(attempt.gate.authority.analytics_evidence_snapshot);
    if (Object.keys(authorityStrategy).length && JSON.stringify(authorityStrategy) !== JSON.stringify(strategy)
      || Object.keys(authorityModel).length && JSON.stringify(authorityModel) !== JSON.stringify(businessModel)
      || Object.keys(authorityEvidence).length && JSON.stringify(authorityEvidence) !== JSON.stringify(evidence)) {
      throw new Error("P0_P1_HANDOFF_FROZEN_AUTHORITY_LINEAGE_INVALID");
    }
    for (const item of attempt.execution.items) {
      const draft = attempt.recommendationSet.drafts.find((candidate) => candidate.draft_id === item.selection.draft_id);
      if (!draft
        || draft.draft_revision_id !== item.selection.draft_revision_id
        || draft.strategy_revision_id !== strategy.strategy_revision_id
        || draft.publish_fingerprint !== item.selection.publish_fingerprint
        || attempt.recommendationSet.analytics_evidence_snapshot_id !== evidence.snapshot_id
        || !await verifyAuctionProtocol(draft.auction_protocol, draft)) {
        throw new Error("P0_P1_HANDOFF_CAMPAIGN_LINEAGE_INVALID");
      }
      const frozen = attempt.gate.authority.frozen_auction_protocols?.[item.position];
      if (frozen && JSON.stringify(frozen) !== JSON.stringify(draft.auction_protocol)) {
        throw new Error("P0_P1_HANDOFF_AUCTION_PROTOCOL_INVALID");
      }
      const exported = await campaignAttempt({
        kind: attempt.kind,
        item,
        draft,
        strategy,
        model: businessModel,
        evidence,
      });
      const reason = attemptReason(item);
      if (reason === null) admittedCampaigns.push(exported);
      else excludedOutcomes.push({ ...exported, reason });
    }
  }

  for (const correction of source.package_corrections) {
    if (!await verifyPackageCorrection({
      correction,
      sourceExecution: source.package_execution!,
      sourceRecommendationSet: source.recommendation_set!,
    })) throw new Error("P0_P1_HANDOFF_CORRECTION_INTEGRITY_INVALID");
  }

  const reproducedAt = attempts.map((attempt) => attempt.execution.updated_at).sort().at(-1)!;
  const unsigned = {
    schema_version: P0_P1_HANDOFF_SCHEMA as typeof P0_P1_HANDOFF_SCHEMA,
    contract_version: P0_P1_HANDOFF_CONTRACT_VERSION as typeof P0_P1_HANDOFF_CONTRACT_VERSION,
    produced_by: "P0" as const,
    consumed_by: "P1" as const,
    reproduced_at: reproducedAt,
    admitted_campaigns: admittedCampaigns,
    excluded_outcomes: excludedOutcomes,
    capability_boundary: {
      serving: "NOT_GRANTED" as const,
      resume: "NOT_GRANTED" as const,
      spend: "NOT_GRANTED" as const,
      mutable_direct_credentials: "OMITTED" as const,
      internal_journals: "OMITTED" as const,
      provider_diagnostics: "OMITTED" as const,
    },
    learning_boundary: {
      mature_result_owner: "P1" as const,
      knowledge_claim_owner: "P1" as const,
      permitted_import_effects: ["RANK_FUTURE_HYPOTHESES", "DRAFT_FUTURE_HYPOTHESIS"] as ["RANK_FUTURE_HYPOTHESES", "DRAFT_FUTURE_HYPOTHESIS"],
      prohibited_direct_effects: ["CAMPAIGN_MUTATION", "EXECUTION_AUTHORITY_MUTATION", "POLICY_MUTATION", "PLAYBOOK_MUTATION", "P0_AUTHORITY_MUTATION"] as ["CAMPAIGN_MUTATION", "EXECUTION_AUTHORITY_MUTATION", "POLICY_MUTATION", "PLAYBOOK_MUTATION", "P0_AUTHORITY_MUTATION"],
    },
  };
  if (containsLeak(unsigned)) throw new Error("P0_P1_HANDOFF_FORBIDDEN_LEAKAGE");
  return deepFreeze({ ...unsigned, handoff_id: await sha256(unsigned) });
}

function auctionProtocolShapeIsClosed(protocol: AuctionProtocol) {
  return exactKeys(protocol, [
    "schema_version", "contract_version", "protocol_revision_id", "previous_protocol_revision_id", "draft_id", "draft_revision_id",
    "strategy_revision_id", "evidence_snapshot_id", "affected_draft_ids", "control", "tested_change", "bidding", "query_matching",
    "autotargeting_policy", "traffic_split", "test_budget_rub", "test_period", "measurement_goal", "success_threshold", "stop_condition",
    "attribution", "provider_facts", "test_assumptions", "knowledge_status", "registered_at", "registered_by", "p1_lineage", "content_hash",
  ])
    && exactKeys(protocol.bidding, ["strategy", "ceiling_rub"])
    && exactKeys(protocol.traffic_split, ["comparator_percent", "treatment_percent"])
    && exactKeys(protocol.test_period, ["start_date", "end_date"])
    && exactKeys(protocol.attribution, ["status", "one_factor_claim_allowed", "comparator_draft_id", "material_families", "explanation"])
    && exactKeys(protocol.provider_facts, ["source", "bidding_strategy_code", "weekly_spend_limit_micro_rub", "bid_ceiling_micro_rub", "keyword", "autotargeting_selected"])
    && exactKeys(protocol.test_assumptions, ["source", "uncertainty"])
    && exactKeys(protocol.p1_lineage, ["handoff_contract", "protocol_revision_id", "draft_revision_id", "evidence_snapshot_id", "authority_effect"]);
}

async function verifyAttempt(value: P0P1CampaignAttempt, admitted: boolean) {
  if (!exactKeys(value, ["attempt_kind", "campaign_revision", "lineage", "frozen_auction_protocol", "final_state"])
    || !["INITIAL_CREATION", "CORRECTED_CREATION"].includes(value.attempt_kind)
    || !exactKeys(value.campaign_revision, ["schema_version", "campaign_revision_id", "source_draft_id", "source_draft_revision_id", "strategy_revision_id", "publish_fingerprint", "business_shape"])
    || !exactKeys(value.campaign_revision.business_shape, ["name", "product", "audience", "offer", "keyword_cluster"])
    || !exactKeys(value.lineage, ["strategy_revision_id", "strategy_material_fingerprint", "previous_strategy_revision_id", "business_model_revision_id", "business_model_material_fingerprint", "analytics_evidence"])
    || !exactKeys(value.lineage.analytics_evidence, ["schema_version", "contract_version", "snapshot_id", "as_of", "hashes"])
    || !exactKeys(value.lineage.analytics_evidence.hashes, ["input_root_sha256", "sources_sha256", "claims_sha256", "evidence_sha256", "conflicts_sha256", "gaps_sha256", "domain_manifest_sha256", "competitor_matrix_sha256", "product_catalog_sha256", "focus_opportunities_sha256", "market_evidence_sha256"])
    || !exactKeys(value.final_state, ["schema_version", "state_evidence_id", "observed_at", "creation", "moderation", "serving", "supported_graph"]) 
    || value.campaign_revision.schema_version !== CAMPAIGN_REVISION_SCHEMA
    || value.final_state.schema_version !== STATE_EVIDENCE_SCHEMA
    || !Number.isFinite(Date.parse(value.final_state.observed_at))
    || value.campaign_revision.strategy_revision_id !== value.lineage.strategy_revision_id
    || value.frozen_auction_protocol.strategy_revision_id !== value.lineage.strategy_revision_id
    || value.frozen_auction_protocol.draft_id !== value.campaign_revision.source_draft_id
    || value.frozen_auction_protocol.draft_revision_id !== value.campaign_revision.source_draft_revision_id
    || value.frozen_auction_protocol.evidence_snapshot_id !== value.lineage.analytics_evidence.snapshot_id
    || !value.campaign_revision.source_draft_id
    || !value.campaign_revision.source_draft_revision_id
    || !value.lineage.strategy_revision_id
    || !value.lineage.business_model_revision_id
    || !hasDigest(value.campaign_revision.publish_fingerprint)
    || !hasDigest(value.lineage.strategy_material_fingerprint)
    || !hasDigest(value.lineage.business_model_material_fingerprint)
    || !hasDigest(value.lineage.analytics_evidence.snapshot_id)
    || Object.values(value.lineage.analytics_evidence.hashes).some((digest) => !hasDigest(digest))
    || !["CONFIRMED_CREATED", "NOT_CREATED", "PENDING", "UNKNOWN", "FAILED"].includes(value.final_state.creation)
    || !["ACCEPTED", "PENDING", "REJECTED", "NOT_APPLICABLE", "UNKNOWN"].includes(value.final_state.moderation)
    || !["SUSPENDED", "NOT_APPLICABLE", "RECONCILIATION_REQUIRED", "UNKNOWN"].includes(value.final_state.serving)
    || !["VERIFIED", "NOT_APPLICABLE", "INCOMPLETE", "UNKNOWN"].includes(value.final_state.supported_graph)
    || !auctionProtocolShapeIsClosed(value.frozen_auction_protocol)
    || !await verifyAuctionProtocolContentHash(value.frozen_auction_protocol)) return false;
  const campaignUnsigned = { ...value.campaign_revision } as Record<string, unknown>;
  delete campaignUnsigned.campaign_revision_id;
  if (value.campaign_revision.campaign_revision_id !== await sha256(campaignUnsigned)) return false;
  const stateUnsigned = { ...value.final_state } as Record<string, unknown>;
  delete stateUnsigned.state_evidence_id;
  if (value.final_state.state_evidence_id !== await sha256(stateUnsigned)) return false;
  return !admitted || (
    value.final_state.creation === "CONFIRMED_CREATED"
    && value.final_state.moderation === "ACCEPTED"
    && value.final_state.serving === "SUSPENDED"
    && value.final_state.supported_graph === "VERIFIED"
  );
}

export async function verifyP0P1Handoff(value: P0P1Handoff | unknown) {
  try {
    const candidate = record(value) as P0P1Handoff;
    if (!exactKeys(candidate, ["schema_version", "contract_version", "handoff_id", "produced_by", "consumed_by", "reproduced_at", "admitted_campaigns", "excluded_outcomes", "capability_boundary", "learning_boundary"])
      || candidate.schema_version !== P0_P1_HANDOFF_SCHEMA
      || candidate.contract_version !== P0_P1_HANDOFF_CONTRACT_VERSION
      || candidate.produced_by !== "P0"
      || candidate.consumed_by !== "P1"
      || !Number.isFinite(Date.parse(candidate.reproduced_at))
      || !Array.isArray(candidate.admitted_campaigns)
      || !Array.isArray(candidate.excluded_outcomes)
      || !exactKeys(candidate.capability_boundary, ["serving", "resume", "spend", "mutable_direct_credentials", "internal_journals", "provider_diagnostics"])
      || JSON.stringify(candidate.capability_boundary) !== JSON.stringify({ serving: "NOT_GRANTED", resume: "NOT_GRANTED", spend: "NOT_GRANTED", mutable_direct_credentials: "OMITTED", internal_journals: "OMITTED", provider_diagnostics: "OMITTED" })
      || !exactKeys(candidate.learning_boundary, ["mature_result_owner", "knowledge_claim_owner", "permitted_import_effects", "prohibited_direct_effects"])
      || JSON.stringify(candidate.learning_boundary) !== JSON.stringify({ mature_result_owner: "P1", knowledge_claim_owner: "P1", permitted_import_effects: ["RANK_FUTURE_HYPOTHESES", "DRAFT_FUTURE_HYPOTHESIS"], prohibited_direct_effects: ["CAMPAIGN_MUTATION", "EXECUTION_AUTHORITY_MUTATION", "POLICY_MUTATION", "PLAYBOOK_MUTATION", "P0_AUTHORITY_MUTATION"] })
      || containsLeak(candidate)) return false;
    for (const attempt of candidate.admitted_campaigns) if (!await verifyAttempt(attempt, true)) return false;
    const reasons = new Set(["CREATION_PENDING", "CREATION_REJECTED", "MODERATION_PENDING", "MODERATION_REJECTED", "RECONCILIATION_REQUIRED", "SYSTEM_FAILURE", "INCOMPLETE_LINEAGE"]);
    for (const excluded of candidate.excluded_outcomes) {
      if (!exactKeys(excluded, ["attempt_kind", "campaign_revision", "lineage", "frozen_auction_protocol", "final_state", "reason"]) || !reasons.has(excluded.reason)) return false;
      if (excluded.reason === "CREATION_PENDING" && excluded.final_state.creation !== "PENDING") return false;
      if (excluded.reason === "CREATION_REJECTED" && excluded.final_state.creation !== "NOT_CREATED") return false;
      if (excluded.reason === "MODERATION_PENDING" && excluded.final_state.moderation !== "PENDING") return false;
      if (excluded.reason === "MODERATION_REJECTED" && excluded.final_state.moderation !== "REJECTED") return false;
      const attempt = { ...excluded } as Record<string, unknown>;
      delete attempt.reason;
      if (!await verifyAttempt(attempt as P0P1CampaignAttempt, false)) return false;
    }
    const revisionIds = [...candidate.admitted_campaigns, ...candidate.excluded_outcomes]
      .map((attempt) => attempt.campaign_revision.campaign_revision_id);
    if (new Set(revisionIds).size !== revisionIds.length) return false;
    const unsigned = { ...candidate } as Record<string, unknown>;
    delete unsigned.handoff_id;
    return candidate.handoff_id === await sha256(unsigned);
  } catch {
    return false;
  }
}

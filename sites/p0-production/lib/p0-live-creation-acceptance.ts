import { canonicalizeEvidence } from "./analytics-evidence.ts";
import type { PackageExecution } from "./campaign-package-execution.ts";
import type { DirectExecutionRecord } from "./execution-safety.ts";
import type { LiveCreationAuthority } from "./live-creation-authority.ts";

export const LIVE_CREATION_ACCEPTANCE_SCHEMA = "p0-live-creation-acceptance-v1";

export type LiveDeliveryVerification = {
  item_execution_id: string;
  source: "YANDEX_DIRECT_REPORTS_API";
  observed_at: string;
  impressions: number;
  spend_rub: number;
};

export type LiveCreationAcceptanceInput = {
  evidence_mode: "CONTROLLED_OFFICIAL_SHAPE_FIXTURE" | "LIVE_OFFICIAL_API";
  generated_at: string;
  package_execution: PackageExecution;
  live_authorities: LiveCreationAuthority[];
  execution_records: DirectExecutionRecord[];
  delivery_verifications: LiveDeliveryVerification[];
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function sha256(value: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalizeEvidence(value)));
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function alias(kind: string, value: unknown) {
  return `${kind}-${(await sha256({ kind, value: String(value ?? "") })).slice(0, 16)}`;
}

function exactOperations(recordValue: DirectExecutionRecord) {
  return recordValue.dispatch_audit.map((entry) => ({
    sequence: entry.sequence,
    operation: entry.operation.replace(/^([a-z])/u, (letter) => letter.toUpperCase()),
    outcome: entry.outcome,
    object_count: entry.request_summary.object_count,
    selection_count: entry.request_summary.selection_count,
  }));
}

function nonNegativeInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function nonNegativeMoney(value: unknown) {
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

export async function buildLiveCreationAcceptanceArtifact(input: LiveCreationAcceptanceInput) {
  const executionById = new Map(input.execution_records.map((item) => [item.execution_id, item]));
  const deliveryById = new Map(input.delivery_verifications.map((item) => [item.item_execution_id, item]));
  const authorityByExecutionId = new Map(input.live_authorities
    .filter((item) => item.status === "CONSUMED" && item.package_execution_id)
    .map((item) => [item.package_execution_id!, item]));
  const packageAuthority = authorityByExecutionId.get(input.package_execution.package_execution_id) ?? null;
  const authorityUnsigned = packageAuthority ? { ...packageAuthority } as Record<string, unknown> : null;
  if (authorityUnsigned) delete authorityUnsigned.content_hash;
  const authorityContentHashValid = Boolean(packageAuthority && authorityUnsigned
    && packageAuthority.content_hash === `sha256:${await sha256(authorityUnsigned)}`);
  const items = await Promise.all(input.package_execution.items.map(async (item) => {
    const execution = executionById.get(item.item_execution_id) ?? null;
    const delivery = deliveryById.get(item.item_execution_id) ?? null;
    const readback = record(item.readback);
    const campaign = record(readback.campaign);
    const operations = execution ? exactOperations(execution) : [];
    const ambiguous = ["RECONCILIATION_REQUIRED", "OUTCOME_UNKNOWN"].includes(item.status)
      || item.account_lock === "HELD_FOR_RECONCILIATION"
      || operations.some((operation) => operation.outcome === "AMBIGUOUS");
    const suspended = item.campaign_state === "SUSPENDED"
      && campaign.State === "SUSPENDED"
      && item.accountability.campaign_suspended === true;
    const zeroDelivery = Boolean(delivery
      && delivery.source === "YANDEX_DIRECT_REPORTS_API"
      && nonNegativeInteger(delivery.impressions)
      && nonNegativeMoney(delivery.spend_rub)
      && delivery.impressions === 0
      && delivery.spend_rub === 0);
    return {
      order: item.position + 1,
      item_alias: await alias("campaign", item.item_execution_id),
      outcome: item.status,
      accepted: item.status === "DIRECT_ACCEPTED" && item.accountability.direct_accepted === true,
      campaign_state: item.campaign_state ?? "UNKNOWN",
      supported_graph_verified: item.accountability.supported_graph_verified,
      moderation_status: item.moderation.provider_status,
      official_requests: operations,
      official_readback: {
        source: "YANDEX_DIRECT_API_V501" as const,
        campaign_suspended: suspended,
        complete_supported_graph: item.accountability.supported_graph_verified,
        all_ads_terminal: item.accountability.all_ads_terminal,
        moderation_relationships_verified: item.accountability.moderation_relationships_verified,
      },
      delivery_verification: delivery ? {
        source: delivery.source,
        observed_at: delivery.observed_at,
        impressions: delivery.impressions,
        spend_rub: delivery.spend_rub,
        zero_delivery_confirmed: zeroDelivery,
      } : null,
      ambiguous,
      provider_issue_count: item.provider_issues.length,
    };
  }));
  const operations = items.flatMap((item) => item.official_requests);
  const resumeCalls = operations.filter((item) => item.operation.toLowerCase() === "campaigns.resume").length;
  const mutationCalls = operations.filter((item) => !item.operation.toLowerCase().endsWith(".get")).length;
  const allSuspended = items.length > 0 && items.every((item) => item.official_readback.campaign_suspended);
  const allDeliveryZero = items.length > 0 && items.every((item) => item.delivery_verification?.zero_delivery_confirmed === true);
  const ambiguousItems = items.filter((item) => item.ambiguous).length;
  const authorityValid = Boolean(packageAuthority
    && authorityContentHashValid
    && packageAuthority.status === "CONSUMED"
    && packageAuthority.permissions.allowed_action === "CREATE_EXACT_SUSPENDED_CAMPAIGNS"
    && packageAuthority.permissions.official_api_only
    && !packageAuthority.permissions.resume_authority
    && !packageAuthority.permissions.impressions_authority
    && !packageAuthority.permissions.spend_authority);
  const liveReady = input.evidence_mode === "LIVE_OFFICIAL_API"
    && authorityValid
    && items.length === input.package_execution.selected_count
    && items.every((item) => item.accepted)
    && allSuspended
    && allDeliveryZero
    && ambiguousItems === 0
    && resumeCalls === 0;
  return {
    schema_version: LIVE_CREATION_ACCEPTANCE_SCHEMA,
    feature_issue: 250,
    implemented_tasks: [291, 292, 293, 294],
    generated_at: input.generated_at,
    evidence_mode: input.evidence_mode,
    status: liveReady ? "READY_FOR_OWNER_CHECKPOINT" : "BLOCKED_OR_AWAITING_LIVE_EVIDENCE",
    authority: {
      exact_one_time_authority_consumed: authorityValid,
      content_hash_verified: authorityContentHashValid,
      exact_package_bound: Boolean(packageAuthority
        && packageAuthority.package_id === input.package_execution.package_id
        && packageAuthority.gate_id === input.package_execution.gate_id),
      agent_or_model_may_expand: false,
      official_api_only: true,
    },
    official_api: {
      provider: "YANDEX_DIRECT_API_V501",
      browser_cabinets_used: false,
      request_count: operations.length,
      mutation_request_count: mutationCalls,
      resume_calls: resumeCalls,
      every_mutation_has_pre_dispatch_intent: input.execution_records.every((execution) =>
        execution.dispatch_audit.every((entry) => Boolean(entry.request_fingerprint && entry.dispatched_at))),
    },
    items,
    safety: {
      all_campaigns_confirmed_suspended: allSuspended,
      all_delivery_reports_zero: allDeliveryZero,
      impressions_total: items.reduce((sum, item) => sum + Number(item.delivery_verification?.impressions ?? 0), 0),
      spend_total_rub: items.reduce((sum, item) => sum + Number(item.delivery_verification?.spend_rub ?? 0), 0),
      resume_calls: resumeCalls,
      ambiguous_items: ambiguousItems,
      ambiguous_result_blocks_acceptance: true,
    },
    redaction: {
      account_alias: await alias("direct-account", packageAuthority?.direct_account_binding.account ?? "missing"),
      raw_provider_ids_included: false,
      oauth_tokens_included: false,
      authorization_headers_included: false,
      raw_provider_responses_included: false,
      owner_internal_diagnostics_included: false,
      request_hashes_included: false,
    },
    human_checkpoint: {
      issue: 253,
      required: true,
      verdict: "PENDING_OWNER_VERDICT",
      implementation_may_claim_acceptance: liveReady,
      acceptance_checks: [
        "Каждая принятая кампания создана официальным API и подтверждена как SUSPENDED.",
        "Неоднозначный, ожидающий, отклонённый или требующий сверки результат блокирует приёмку.",
        "Campaigns.resume отсутствует; отчёты подтверждают нулевые показы и расходы.",
      ],
    },
  };
}

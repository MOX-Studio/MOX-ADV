import { canonicalizeEvidence } from "./analytics-evidence.ts";
import {
  verifyHumanDecisionGate,
  type HumanDecisionGate,
  type PackageReview,
} from "./campaign-decision-gate.ts";

export const LIVE_CREATION_AUTHORITY_SCHEMA = "p0-live-creation-authority-v1";
export const LIVE_CREATION_CONFIRMATION_TOKEN = "AUTHORIZE_EXACT_SUSPENDED_CREATION";

const ALLOWED_PROVIDER_OPERATIONS = [
  "Campaigns.add",
  "Campaigns.suspend",
  "Campaigns.get",
  "AdGroups.add",
  "AdGroups.get",
  "Keywords.add",
  "Keywords.get",
  "Ads.add",
  "Ads.get",
  "Ads.moderate",
] as const;

const FORBIDDEN_ACTIONS = [
  "Campaigns.resume",
  "START_IMPRESSIONS",
  "START_SPEND",
  "CHANGE_EXACT_PACKAGE",
  "CHANGE_BOUND_ACCOUNT",
  "EXPAND_BY_AGENT_OR_MODEL",
] as const;

export type LiveCreationAuthority = {
  schema_version: typeof LIVE_CREATION_AUTHORITY_SCHEMA;
  contract_version: "1.0.0";
  grant_id: string;
  package_review_id: string;
  package_id: string;
  gate_id: string;
  owner_decision_id: string;
  authorized_at: string;
  authorized_by: "OWNER";
  confirmation_token: typeof LIVE_CREATION_CONFIRMATION_TOKEN;
  status: "ACTIVE_UNCONSUMED" | "CONSUMED";
  exact_authority_digest: string;
  direct_account_binding: PackageReview["authority"]["direct_account_binding"];
  capability_profile_identity: {
    profile_id: string;
    profile_version: string;
  };
  selected_count: number;
  permissions: {
    allowed_action: "CREATE_EXACT_SUSPENDED_CAMPAIGNS";
    allowed_provider_operations: [...typeof ALLOWED_PROVIDER_OPERATIONS];
    forbidden_actions: [...typeof FORBIDDEN_ACTIONS];
    official_api_only: true;
    browser_cabinet_automation: false;
    impressions_authority: false;
    spend_authority: false;
    resume_authority: false;
    agent_or_model_may_expand: false;
  };
  consumed_at: string | null;
  package_execution_id: string | null;
  content_hash: string;
};

type UnsignedAuthority = Omit<LiveCreationAuthority, "content_hash">;

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(canonicalizeEvidence(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

async function grantId(input: {
  review: PackageReview;
  gate: HumanDecisionGate;
  authorizedAt: string;
}) {
  return sha256({
    schema_version: LIVE_CREATION_AUTHORITY_SCHEMA,
    package_review_id: input.review.package_review_id,
    package_id: input.review.package_id,
    gate_id: input.gate.gate_id,
    owner_decision_id: input.gate.owner_decision_id,
    authorized_at: input.authorizedAt,
    exact_authority_digest: await sha256(input.review.authority),
  });
}

async function seal(value: UnsignedAuthority): Promise<LiveCreationAuthority> {
  return { ...value, content_hash: await sha256(value) };
}

function exactPermissions(value: LiveCreationAuthority["permissions"]) {
  return value.allowed_action === "CREATE_EXACT_SUSPENDED_CAMPAIGNS"
    && JSON.stringify(value.allowed_provider_operations) === JSON.stringify(ALLOWED_PROVIDER_OPERATIONS)
    && JSON.stringify(value.forbidden_actions) === JSON.stringify(FORBIDDEN_ACTIONS)
    && value.official_api_only === true
    && value.browser_cabinet_automation === false
    && value.impressions_authority === false
    && value.spend_authority === false
    && value.resume_authority === false
    && value.agent_or_model_may_expand === false;
}

export async function buildLiveCreationAuthority(input: {
  review: PackageReview;
  gate: HumanDecisionGate;
  authorizedAt: string;
}) {
  if (!await verifyHumanDecisionGate(input.gate, input.review)) {
    throw new Error("Live creation authority requires the current exact accepted package Gate.");
  }
  if (input.review.business_projection.preflight.status !== "PASS"
    || input.review.business_projection.preflight.passed !== 9) {
    throw new Error("Live creation authority requires complete publish preflight 9/9.");
  }
  const unsigned: UnsignedAuthority = {
    schema_version: LIVE_CREATION_AUTHORITY_SCHEMA,
    contract_version: "1.0.0",
    grant_id: await grantId(input),
    package_review_id: input.review.package_review_id,
    package_id: input.review.package_id,
    gate_id: input.gate.gate_id,
    owner_decision_id: input.gate.owner_decision_id,
    authorized_at: input.authorizedAt,
    authorized_by: "OWNER",
    confirmation_token: LIVE_CREATION_CONFIRMATION_TOKEN,
    status: "ACTIVE_UNCONSUMED",
    exact_authority_digest: await sha256(input.review.authority),
    direct_account_binding: structuredClone(input.review.authority.direct_account_binding),
    capability_profile_identity: {
      profile_id: String(input.review.authority.capability_profile.profile_id ?? ""),
      profile_version: String(input.review.authority.capability_profile.profile_version ?? ""),
    },
    selected_count: input.review.authority.ordered_selections.length,
    permissions: {
      allowed_action: "CREATE_EXACT_SUSPENDED_CAMPAIGNS",
      allowed_provider_operations: [...ALLOWED_PROVIDER_OPERATIONS],
      forbidden_actions: [...FORBIDDEN_ACTIONS],
      official_api_only: true,
      browser_cabinet_automation: false,
      impressions_authority: false,
      spend_authority: false,
      resume_authority: false,
      agent_or_model_may_expand: false,
    },
    consumed_at: null,
    package_execution_id: null,
  };
  return seal(unsigned);
}

export async function consumeLiveCreationAuthority(
  value: LiveCreationAuthority,
  packageExecutionId: string,
  consumedAt: string,
) {
  if (value.status !== "ACTIVE_UNCONSUMED" || value.consumed_at || value.package_execution_id) {
    throw new Error("Live creation authority is already consumed.");
  }
  if (!packageExecutionId.trim()) throw new Error("Package execution identity is required.");
  const unsigned = { ...structuredClone(value) } as Record<string, unknown>;
  delete unsigned.content_hash;
  return seal({
    ...unsigned,
    status: "CONSUMED",
    consumed_at: consumedAt,
    package_execution_id: packageExecutionId,
  } as UnsignedAuthority);
}

export function liveCreationAuthorityCanStart(
  value: LiveCreationAuthority | null | undefined,
  gate: HumanDecisionGate | null | undefined,
) {
  return Boolean(value && gate
    && value.status === "ACTIVE_UNCONSUMED"
    && value.consumed_at === null
    && value.package_execution_id === null
    && value.package_id === gate.package_id
    && value.package_review_id === gate.package_review_id
    && value.gate_id === gate.gate_id
    && value.owner_decision_id === gate.owner_decision_id);
}

export function liveCreationAuthorityCanContinue(
  value: LiveCreationAuthority | null | undefined,
  packageExecutionId: string | null | undefined,
) {
  return Boolean(value && packageExecutionId
    && value.status === "CONSUMED"
    && value.package_execution_id === packageExecutionId
    && Boolean(value.consumed_at));
}

export async function verifyLiveCreationAuthority(input: {
  authority: LiveCreationAuthority | unknown;
  review: PackageReview;
  gate: HumanDecisionGate;
}) {
  const candidate = input.authority as LiveCreationAuthority;
  if (!candidate || typeof candidate !== "object"
    || candidate.schema_version !== LIVE_CREATION_AUTHORITY_SCHEMA
    || candidate.contract_version !== "1.0.0"
    || candidate.confirmation_token !== LIVE_CREATION_CONFIRMATION_TOKEN
    || candidate.authorized_by !== "OWNER"
    || !candidate.authorized_at
    || candidate.package_review_id !== input.review.package_review_id
    || candidate.package_id !== input.review.package_id
    || candidate.gate_id !== input.gate.gate_id
    || candidate.owner_decision_id !== input.gate.owner_decision_id
    || candidate.exact_authority_digest !== await sha256(input.review.authority)
    || JSON.stringify(candidate.direct_account_binding) !== JSON.stringify(input.review.authority.direct_account_binding)
    || candidate.capability_profile_identity?.profile_id !== String(input.review.authority.capability_profile.profile_id ?? "")
    || candidate.capability_profile_identity?.profile_version !== String(input.review.authority.capability_profile.profile_version ?? "")
    || candidate.selected_count !== input.review.authority.ordered_selections.length
    || !exactPermissions(candidate.permissions)
    || !await verifyHumanDecisionGate(input.gate, input.review)) return false;
  if (candidate.status === "ACTIVE_UNCONSUMED") {
    if (candidate.consumed_at !== null || candidate.package_execution_id !== null) return false;
  } else if (candidate.status === "CONSUMED") {
    if (!candidate.consumed_at || !candidate.package_execution_id) return false;
  } else return false;
  if (candidate.grant_id !== await grantId({
    review: input.review,
    gate: input.gate,
    authorizedAt: candidate.authorized_at,
  })) return false;
  const unsigned = { ...candidate } as Record<string, unknown>;
  delete unsigned.content_hash;
  return candidate.content_hash === await sha256(unsigned);
}

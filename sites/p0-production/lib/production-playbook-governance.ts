import {
  D1CampaignPlaybookKnowledgeStore,
} from "./campaign-playbook-candidates-d1-store.ts";
import {
  D1CampaignPlaybookGovernanceStore,
} from "./campaign-playbook-governance-d1-store.ts";
import {
  curatedApprovalAssessmentReference,
  resolveCampaignPlaybookConsumption,
  sealKnowledgeStewardDelegation,
  sealPlaybookReleaseDecision,
  KNOWLEDGE_STEWARD_DELEGATION_CONTRACT,
  KNOWLEDGE_STEWARD_DELEGATION_VERSION,
  PLAYBOOK_RELEASE_DECISION_CONTRACT,
  PLAYBOOK_RELEASE_DECISION_VERSION,
  type CampaignPlaybookStrategySnapshot,
  type KnowledgeStewardDelegation,
  type PlaybookReleaseDecision,
} from "./campaign-playbook-governance.ts";
import {
  readP0CuratedPlaybookPromotionPolicyV1,
  readP0CuratedPlaybookV1,
} from "./p0-curated-playbook-v1.ts";
import { pipelineDigest } from "./pipeline-orchestrator.ts";
import {
  ProductionMethodologyAgent,
  type MethodologyOutcomeReference,
} from "./methodology-agent.ts";

export const PRODUCTION_PLAYBOOK_APPLICABILITY = Object.freeze({
  campaign_fanout_contract: "campaign-fanout-v1",
  capability_profile_id: "p0-campaign-creation-profile-v1",
  campaign_type: "UNIFIED_CAMPAIGN",
  placement: "SEARCH",
  strategy_fields: ["advertised_offer", "qualified_result"],
  measurement_status: "READY",
} as const);

async function baselineDelegation(): Promise<KnowledgeStewardDelegation> {
  const release = readP0CuratedPlaybookV1();
  const policy = readP0CuratedPlaybookPromotionPolicyV1();
  const attestation = release.approval_attestation;
  if (!attestation) throw new Error("Curated Playbook release has no exact approval attestation.");
  return sealKnowledgeStewardDelegation({
    contract: { name: KNOWLEDGE_STEWARD_DELEGATION_CONTRACT, version: KNOWLEDGE_STEWARD_DELEGATION_VERSION },
    delegation_id: "p0-curated-playbook-steward-delegation",
    delegation_version: "1.0.0",
    status: "ACTIVE",
    steward_id: attestation.actor_id,
    delegated_by: {
      actor_id: "mox-adv-mandate-owner",
      actor_role: "MANDATE_OWNER",
      decision_id: "github-issue-149-steward-delegation",
    },
    valid_from: release.observed_at,
    expires_at: release.expires_at,
    scope: { release_ids: [release.release_id], promotion_policy_ids: [policy.policy_id] },
    permissions: {
      activate_release: true,
      stop_playbook_use: true,
      evidence_override: false,
      mandate_grant: false,
      campaign_execution: false,
    },
    supersedes_delegation_digest: null,
  });
}

async function baselineActivation(delegation: KnowledgeStewardDelegation): Promise<PlaybookReleaseDecision> {
  const release = readP0CuratedPlaybookV1();
  const policy = readP0CuratedPlaybookPromotionPolicyV1();
  const attestation = release.approval_attestation;
  if (!attestation) throw new Error("Curated Playbook release has no exact approval attestation.");
  const approvedRules = [];
  for (const rule of release.rules) {
    const assessment = await curatedApprovalAssessmentReference(release, rule);
    if (!assessment) throw new Error("Curated Playbook rule has no exact curated approval reference.");
    approvedRules.push({
      rule: { rule_id: rule.rule_id, rule_version: rule.rule_version, content_digest: rule.content_digest },
      assessment,
    });
  }
  return sealPlaybookReleaseDecision({
    contract: { name: PLAYBOOK_RELEASE_DECISION_CONTRACT, version: PLAYBOOK_RELEASE_DECISION_VERSION },
    decision_id: attestation.decision_id,
    action: "ACTIVATE_RELEASE",
    decided_at: attestation.approved_at,
    actor: { actor_id: attestation.actor_id, actor_role: "KNOWLEDGE_STEWARD" },
    delegation: {
      delegation_id: delegation.delegation_id,
      delegation_version: delegation.delegation_version,
      content_digest: delegation.content_digest,
    },
    release: { release_id: release.release_id, release_version: release.release_version, content_digest: release.content_digest },
    promotion_policy: { policy_id: policy.policy_id, policy_version: policy.policy_version, content_digest: policy.content_digest },
    approved_rules: approvedRules,
    reason: `Accepted project decision: ${attestation.basis_url}`,
    authority: {
      evidence_override: false,
      mandate_grant: false,
      campaign_execution: false,
      campaign_publication: false,
      spend: false,
    },
  });
}

export class ProductionCampaignPlaybookGovernance {
  private readonly knowledge: D1CampaignPlaybookKnowledgeStore;
  private readonly governance: D1CampaignPlaybookGovernanceStore;
  private readonly methodology: ProductionMethodologyAgent;
  private readonly now: () => string;

  constructor(
    knowledge: D1CampaignPlaybookKnowledgeStore,
    governance: D1CampaignPlaybookGovernanceStore,
    methodology: ProductionMethodologyAgent,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.knowledge = knowledge;
    this.governance = governance;
    this.methodology = methodology;
    this.now = now;
  }

  async ensureBaseline() {
    const release = readP0CuratedPlaybookV1();
    const policy = readP0CuratedPlaybookPromotionPolicyV1();
    const delegation = await baselineDelegation();
    const activation = await baselineActivation(delegation);
    await this.knowledge.savePolicy(policy);
    await this.governance.appendRelease(release, release.approval_attestation?.approved_at ?? release.observed_at);
    const delegations = await this.governance.loadDelegations();
    if (!delegations.some((item) => item.content_digest === delegation.content_digest)) {
      await this.governance.appendDelegation(delegation);
    }
    const decisions = await this.governance.loadDecisions();
    if (!decisions.some((item) => item.content_digest === activation.content_digest)) {
      await this.governance.appendDecision(activation);
    }
  }

  private async consumption(evaluatedAt: string) {
    await this.ensureBaseline();
    const consumption = await resolveCampaignPlaybookConsumption({
      releases: await this.governance.loadReleases(),
      promotionPolicies: await this.knowledge.loadPolicies(),
      promotionAssessments: await this.knowledge.loadAssessments(),
      delegations: await this.governance.loadDelegations(),
      decisions: await this.governance.loadDecisions(),
      evaluatedAt,
      applicability: {
        campaign_fanout_contract: PRODUCTION_PLAYBOOK_APPLICABILITY.campaign_fanout_contract,
        capability_profile_id: PRODUCTION_PLAYBOOK_APPLICABILITY.capability_profile_id,
        campaign_type: PRODUCTION_PLAYBOOK_APPLICABILITY.campaign_type,
        placement: PRODUCTION_PLAYBOOK_APPLICABILITY.placement,
        strategy_fields: [...PRODUCTION_PLAYBOOK_APPLICABILITY.strategy_fields],
        measurement_status: PRODUCTION_PLAYBOOK_APPLICABILITY.measurement_status,
      },
    });
    await this.governance.appendConsumptionTrace(consumption.trace);
    return consumption;
  }

  async strategySnapshot(): Promise<CampaignPlaybookStrategySnapshot> {
    const consumption = await this.consumption(this.now());
    if (!consumption.snapshot) {
      throw new Error(`Campaign Playbook is not consumable: ${consumption.trace.reason_codes.join(", ") || consumption.trace.outcome}`);
    }
    return consumption.snapshot;
  }

  async projection() {
    const evaluatedAt = this.now();
    const consumption = await this.consumption(evaluatedAt);
    const [candidates, decisions, delegations, releases, policies] = await Promise.all([
      this.knowledge.loadMethodologyCandidates(),
      this.governance.loadDecisions(),
      this.governance.loadDelegations(),
      this.governance.loadReleases(),
      this.knowledge.loadPolicies(),
    ]);
    const release = releases.at(-1) ?? null;
    const policy = policies.at(-1) ?? null;
    const delegation = delegations.at(-1) ?? null;
    const decision = decisions.at(-1) ?? null;
    return {
      schema_version: "p0-production-playbook-governance-projection-v1",
      status: consumption.snapshot ? "ACTIVE_APPROVED" : consumption.trace.outcome,
      reason_codes: [...consumption.trace.reason_codes],
      evaluated_at: evaluatedAt,
      release: release ? { release_id: release.release_id, release_version: release.release_version, content_digest: release.content_digest } : null,
      promotion_policy: policy ? { policy_id: policy.policy_id, policy_version: policy.policy_version, content_digest: policy.content_digest } : null,
      delegation: delegation ? { delegation_id: delegation.delegation_id, delegation_version: delegation.delegation_version, content_digest: delegation.content_digest, steward_id: delegation.steward_id } : null,
      latest_decision: decision ? { decision_id: decision.decision_id, action: decision.action, content_digest: decision.content_digest, decided_at: decision.decided_at } : null,
      methodology_candidate_count: candidates.length,
      authority: { evidence_override: false, mandate_grant: false, campaign_execution: false, campaign_publication: false, spend: false },
    };
  }

  async proposeMethodologyCandidate(outcomes: MethodologyOutcomeReference[]) {
    await this.ensureBaseline();
    const releases = await this.governance.loadReleases();
    const current = releases.at(-1);
    if (!current) throw new Error("Methodology Agent requires one exact current Playbook release.");
    const candidate = await this.methodology.propose({
      outcomes,
      current_playbook: { release_id: current.release_id, release_version: current.release_version, content_digest: current.content_digest },
    });
    await this.knowledge.appendMethodologyCandidate(candidate);
    return candidate;
  }

  async stewardDecision(input: {
    action: "ACTIVATE_RELEASE" | "STOP_PLAYBOOK_USE";
    reason: string;
    expected_release_digest: string;
    expected_policy_digest: string;
    expected_delegation_digest: string;
    expected_latest_decision_digest: string;
  }) {
    await this.ensureBaseline();
    const [releases, policies, delegations, decisions] = await Promise.all([
      this.governance.loadReleases(),
      this.knowledge.loadPolicies(),
      this.governance.loadDelegations(),
      this.governance.loadDecisions(),
    ]);
    const release = releases.at(-1);
    const policy = policies.at(-1);
    const delegation = delegations.at(-1);
    const previous = decisions.at(-1);
    if (!release || !policy || !delegation || !previous
      || release.content_digest !== input.expected_release_digest
      || policy.content_digest !== input.expected_policy_digest
      || delegation.content_digest !== input.expected_delegation_digest
      || previous.content_digest !== input.expected_latest_decision_digest) {
      throw new Error("Campaign Playbook governance state changed; no Steward decision was recorded.");
    }
    if (delegation.status !== "ACTIVE" || Date.parse(this.now()) >= Date.parse(delegation.expires_at)) {
      throw new Error("Knowledge Steward delegation is not active.");
    }
    const approvedRules = [];
    if (input.action === "ACTIVATE_RELEASE") {
      for (const rule of release.rules) {
        const assessment = await curatedApprovalAssessmentReference(release, rule);
        if (!assessment) throw new Error("Activation requires an exact passing assessment for every rule.");
        approvedRules.push({ rule: { rule_id: rule.rule_id, rule_version: rule.rule_version, content_digest: rule.content_digest }, assessment });
      }
    }
    const decidedAt = this.now();
    const decisionId = `playbook-decision:${(await pipelineDigest({ input, decidedAt })).slice(7, 31)}`;
    const decision = await sealPlaybookReleaseDecision({
      contract: { name: PLAYBOOK_RELEASE_DECISION_CONTRACT, version: PLAYBOOK_RELEASE_DECISION_VERSION },
      decision_id: decisionId,
      action: input.action,
      decided_at: decidedAt,
      actor: { actor_id: delegation.steward_id, actor_role: "KNOWLEDGE_STEWARD" },
      delegation: { delegation_id: delegation.delegation_id, delegation_version: delegation.delegation_version, content_digest: delegation.content_digest },
      release: { release_id: release.release_id, release_version: release.release_version, content_digest: release.content_digest },
      promotion_policy: { policy_id: policy.policy_id, policy_version: policy.policy_version, content_digest: policy.content_digest },
      approved_rules: approvedRules,
      reason: input.reason,
      authority: { evidence_override: false, mandate_grant: false, campaign_execution: false, campaign_publication: false, spend: false },
    });
    await this.governance.appendDecision(decision);
    return { decision, projection: await this.projection() };
  }
}

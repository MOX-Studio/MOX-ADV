import { ensureCampaignPlaybookKnowledgeTables } from "./campaign-playbook-candidates-d1-store.ts";
import {
  assertPromotionAssessment,
  assertPromotionPolicy,
  type PromotionAssessment,
  type PromotionPolicy,
} from "./campaign-playbook-candidates.ts";
import {
  assertCampaignPlaybookConsumptionTrace,
  assertKnowledgeStewardDelegation,
  assertPlaybookReleaseDecision,
  curatedApprovalAssessmentReference,
  CampaignPlaybookGovernanceError,
  type CampaignPlaybookConsumptionTrace,
  type KnowledgeStewardDelegation,
  type PlaybookReleaseDecision,
} from "./campaign-playbook-governance.ts";
import {
  resolveCuratedPlaybookReleases,
  type CuratedPlaybookRelease,
  type PlaybookApplicationContext,
} from "./campaign-playbook.ts";

type ValueRow = { value_json: string };

export async function ensureCampaignPlaybookGovernanceTables(db: D1Database) {
  await ensureCampaignPlaybookKnowledgeTables(db);
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS p0_playbook_releases (release_id TEXT NOT NULL, release_version TEXT NOT NULL, content_digest TEXT NOT NULL UNIQUE, value_json TEXT NOT NULL, recorded_at TEXT NOT NULL, PRIMARY KEY (release_id, release_version))",
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS p0_playbook_steward_delegations (delegation_id TEXT NOT NULL, delegation_version TEXT NOT NULL, content_digest TEXT NOT NULL UNIQUE, supersedes_delegation_digest TEXT, value_json TEXT NOT NULL, recorded_at TEXT NOT NULL, PRIMARY KEY (delegation_id, delegation_version))",
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS p0_playbook_release_decisions (decision_id TEXT PRIMARY KEY, content_digest TEXT NOT NULL UNIQUE, action TEXT NOT NULL, release_digest TEXT NOT NULL, policy_digest TEXT NOT NULL, delegation_digest TEXT NOT NULL, value_json TEXT NOT NULL, decided_at TEXT NOT NULL)",
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS p0_playbook_consumption_traces (trace_id TEXT PRIMARY KEY, content_digest TEXT NOT NULL UNIQUE, outcome TEXT NOT NULL, release_digest TEXT, decision_digest TEXT, value_json TEXT NOT NULL, evaluated_at TEXT NOT NULL)",
  ).run();
  for (const table of [
    "p0_playbook_releases",
    "p0_playbook_steward_delegations",
    "p0_playbook_release_decisions",
    "p0_playbook_consumption_traces",
  ]) {
    await db.prepare(
      `CREATE TRIGGER IF NOT EXISTS ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} rows are immutable'); END`,
    ).run();
    await db.prepare(
      `CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} rows are immutable'); END`,
    ).run();
  }
}

function compareSemver(left: string, right: string) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

function releaseValidationContext(release: CuratedPlaybookRelease): PlaybookApplicationContext {
  const rule = release.rules[0];
  return {
    campaign_fanout_contract: rule?.applicability.campaign_fanout_contract ?? "campaign-fanout-v1",
    capability_profile_id: rule?.applicability.capability_profile_ids[0] ?? "p0-campaign-creation-profile-v1",
    campaign_type: rule?.applicability.campaign_types[0] ?? "UNIFIED_CAMPAIGN",
    placement: rule?.applicability.placements[0] ?? "SEARCH",
    strategy_fields: structuredClone(rule?.applicability.required_strategy_fields ?? []),
    measurement_status: rule?.applicability.measurement_statuses[0] ?? "READY",
  };
}

async function assertPersistableRelease(release: CuratedPlaybookRelease, evaluatedAt: string) {
  const resolved = await resolveCuratedPlaybookReleases([release], {
    evaluatedAt,
    applicability: releaseValidationContext(release),
  });
  const integrityReasons = new Set([
    "PLAYBOOK_RELEASE_MALFORMED",
    "PLAYBOOK_RELEASE_UNKNOWN_VERSION",
    "PLAYBOOK_RELEASE_UNAPPROVED",
    "PLAYBOOK_RULE_MALFORMED",
    "PLAYBOOK_RULE_UNKNOWN_VERSION",
    "PLAYBOOK_RULE_SELF_PROMOTION_FORBIDDEN",
    "COMPETITIVE_SAMPLE_RULE_MALFORMED",
  ]);
  if (!resolved.release || resolved.audits.some((audit) => integrityReasons.has(audit.reason_code))) {
    throw new CampaignPlaybookGovernanceError("PLAYBOOK_RELEASE_NOT_PERSISTABLE", "Only an exact current ACTIVE and APPROVED release can enter governed release history.");
  }
}

export class D1CampaignPlaybookGovernanceStore {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async appendRelease(release: CuratedPlaybookRelease, recordedAt: string) {
    await ensureCampaignPlaybookGovernanceTables(this.db);
    await assertPersistableRelease(release, recordedAt);
    const result = await this.db.prepare(
      "INSERT OR IGNORE INTO p0_playbook_releases(release_id, release_version, content_digest, value_json, recorded_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(release.release_id, release.release_version, release.content_digest, JSON.stringify(release), recordedAt).run();
    return Number(result.meta.changes) === 1;
  }

  async appendDelegation(delegation: KnowledgeStewardDelegation) {
    await ensureCampaignPlaybookGovernanceTables(this.db);
    await assertKnowledgeStewardDelegation(delegation);
    const latest = await this.db.prepare(
      "SELECT value_json FROM p0_playbook_steward_delegations WHERE delegation_id = ? ORDER BY recorded_at DESC, rowid DESC LIMIT 1",
    ).bind(delegation.delegation_id).first<ValueRow>();
    if (!latest && delegation.supersedes_delegation_digest !== null) {
      throw new CampaignPlaybookGovernanceError("PLAYBOOK_DELEGATION_LINEAGE_INVALID", "The first delegation version cannot supersede unknown content.");
    }
    if (latest) {
      const previous = JSON.parse(latest.value_json) as KnowledgeStewardDelegation;
      await assertKnowledgeStewardDelegation(previous);
      if (delegation.supersedes_delegation_digest !== previous.content_digest
        || compareSemver(delegation.delegation_version, previous.delegation_version) <= 0
        || Date.parse(delegation.valid_from) <= Date.parse(previous.valid_from)) {
        throw new CampaignPlaybookGovernanceError("PLAYBOOK_DELEGATION_LINEAGE_INVALID", "A delegation revision must supersede the exact latest digest with a later version and validity time.");
      }
    }
    const result = await this.db.prepare(
      "INSERT OR IGNORE INTO p0_playbook_steward_delegations(delegation_id, delegation_version, content_digest, supersedes_delegation_digest, value_json, recorded_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(
      delegation.delegation_id,
      delegation.delegation_version,
      delegation.content_digest,
      delegation.supersedes_delegation_digest,
      JSON.stringify(delegation),
      delegation.valid_from,
    ).run();
    return Number(result.meta.changes) === 1;
  }

  async appendDecision(decision: PlaybookReleaseDecision) {
    await ensureCampaignPlaybookGovernanceTables(this.db);
    await assertPlaybookReleaseDecision(decision);
    const releaseRow = await this.db.prepare("SELECT value_json FROM p0_playbook_releases WHERE content_digest = ?")
      .bind(decision.release.content_digest).first<ValueRow>();
    const delegationRow = await this.db.prepare("SELECT value_json FROM p0_playbook_steward_delegations WHERE content_digest = ?")
      .bind(decision.delegation.content_digest).first<ValueRow>();
    const policyRow = await this.db.prepare("SELECT value_json FROM p0_playbook_promotion_policies WHERE content_digest = ?")
      .bind(decision.promotion_policy.content_digest).first<ValueRow>();
    if (!releaseRow || !delegationRow || !policyRow) {
      throw new CampaignPlaybookGovernanceError("PLAYBOOK_DECISION_LINEAGE_MISSING", "Release decisions require exact persisted release, delegation, and Promotion Policy inputs.");
    }
    const release = JSON.parse(releaseRow.value_json) as CuratedPlaybookRelease;
    const delegation = JSON.parse(delegationRow.value_json) as KnowledgeStewardDelegation;
    const policy = JSON.parse(policyRow.value_json) as PromotionPolicy;
    await assertKnowledgeStewardDelegation(delegation);
    await assertPromotionPolicy(policy);
    const decisionTime = Date.parse(decision.decided_at);
    if (release.release_id !== decision.release.release_id
      || release.release_version !== decision.release.release_version
      || policy.policy_id !== decision.promotion_policy.policy_id
      || policy.policy_version !== decision.promotion_policy.policy_version
      || delegation.delegation_id !== decision.delegation.delegation_id
      || delegation.delegation_version !== decision.delegation.delegation_version
      || delegation.status !== "ACTIVE"
      || delegation.steward_id !== decision.actor.actor_id
      || Date.parse(delegation.valid_from) > decisionTime
      || decisionTime >= Date.parse(delegation.expires_at)
      || !delegation.scope.release_ids.includes(release.release_id)
      || !delegation.scope.promotion_policy_ids.includes(policy.policy_id)) {
      throw new CampaignPlaybookGovernanceError("PLAYBOOK_DECISION_LINEAGE_INVALID", "Release decision lineage or delegated scope is invalid.");
    }
    for (const approval of decision.approved_rules) {
      const rule = release.rules.find((candidate) => candidate.rule_id === approval.rule.rule_id
        && candidate.rule_version === approval.rule.rule_version
        && candidate.content_digest === approval.rule.content_digest);
      if (!rule) {
        throw new CampaignPlaybookGovernanceError("PLAYBOOK_RULE_EVIDENCE_GATE_NOT_PASSED", "Knowledge Steward cannot bind approval to unknown rule content.");
      }
      const curatedAssessment = await curatedApprovalAssessmentReference(release, rule);
      if (curatedAssessment
        && curatedAssessment.assessment_id === approval.assessment.assessment_id
        && curatedAssessment.content_digest === approval.assessment.content_digest) continue;
      const assessmentRow = await this.db.prepare("SELECT value_json FROM p0_playbook_promotion_assessments WHERE content_digest = ?")
        .bind(approval.assessment.content_digest).first<ValueRow>();
      if (!assessmentRow) throw new CampaignPlaybookGovernanceError("PLAYBOOK_DECISION_LINEAGE_MISSING", "Every non-curated approved rule requires its persisted exact assessment.");
      const assessment = JSON.parse(assessmentRow.value_json) as PromotionAssessment;
      await assertPromotionAssessment(assessment);
      if (assessment.assessment_id !== approval.assessment.assessment_id
        || assessment.disposition !== "ELIGIBLE_FOR_STEWARD_REVIEW"
        || assessment.hard_checks.some((check) => check.status !== "PASS")
        || assessment.policy.content_digest !== policy.content_digest
        || Date.parse(assessment.evaluated_at) > decisionTime) {
        throw new CampaignPlaybookGovernanceError("PLAYBOOK_RULE_EVIDENCE_GATE_NOT_PASSED", "Knowledge Steward cannot override an assessment or bind it to different rule content.");
      }
    }
    const result = await this.db.prepare(
      "INSERT OR IGNORE INTO p0_playbook_release_decisions(decision_id, content_digest, action, release_digest, policy_digest, delegation_digest, value_json, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      decision.decision_id,
      decision.content_digest,
      decision.action,
      decision.release.content_digest,
      decision.promotion_policy.content_digest,
      decision.delegation.content_digest,
      JSON.stringify(decision),
      decision.decided_at,
    ).run();
    return Number(result.meta.changes) === 1;
  }

  async appendConsumptionTrace(trace: CampaignPlaybookConsumptionTrace) {
    await ensureCampaignPlaybookGovernanceTables(this.db);
    await assertCampaignPlaybookConsumptionTrace(trace);
    const result = await this.db.prepare(
      "INSERT OR IGNORE INTO p0_playbook_consumption_traces(trace_id, content_digest, outcome, release_digest, decision_digest, value_json, evaluated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      trace.trace_id,
      trace.content_digest,
      trace.outcome,
      trace.release?.content_digest ?? null,
      trace.steward_decision?.content_digest ?? null,
      JSON.stringify(trace),
      trace.evaluated_at,
    ).run();
    return Number(result.meta.changes) === 1;
  }

  async loadReleases() {
    await ensureCampaignPlaybookGovernanceTables(this.db);
    const rows = await this.db.prepare("SELECT value_json FROM p0_playbook_releases ORDER BY recorded_at, rowid").all<ValueRow>();
    return rows.results.map((row) => JSON.parse(row.value_json) as CuratedPlaybookRelease);
  }

  async loadDelegations() {
    await ensureCampaignPlaybookGovernanceTables(this.db);
    const rows = await this.db.prepare("SELECT value_json FROM p0_playbook_steward_delegations ORDER BY recorded_at, rowid").all<ValueRow>();
    const values = rows.results.map((row) => JSON.parse(row.value_json) as KnowledgeStewardDelegation);
    for (const value of values) await assertKnowledgeStewardDelegation(value);
    return values;
  }

  async loadDecisions() {
    await ensureCampaignPlaybookGovernanceTables(this.db);
    const rows = await this.db.prepare("SELECT value_json FROM p0_playbook_release_decisions ORDER BY decided_at, rowid").all<ValueRow>();
    const values = rows.results.map((row) => JSON.parse(row.value_json) as PlaybookReleaseDecision);
    for (const value of values) await assertPlaybookReleaseDecision(value);
    return values;
  }

  async loadConsumptionTrace(traceId: string) {
    await ensureCampaignPlaybookGovernanceTables(this.db);
    const row = await this.db.prepare("SELECT value_json FROM p0_playbook_consumption_traces WHERE trace_id = ?")
      .bind(traceId).first<ValueRow>();
    if (!row) return null;
    const trace = JSON.parse(row.value_json) as CampaignPlaybookConsumptionTrace;
    await assertCampaignPlaybookConsumptionTrace(trace);
    return trace;
  }
}

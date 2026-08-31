import {
  assertKnowledgeCandidate,
  assertPromotionAssessment,
  assertPromotionPolicy,
  CampaignPlaybookKnowledgeError,
  type KnowledgeCandidate,
  type PromotionAssessment,
  type PromotionPolicy,
} from "./campaign-playbook-candidates.ts";

type ValueRow = { value_json: string };

export async function ensureCampaignPlaybookKnowledgeTables(db: D1Database) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS p0_playbook_knowledge_candidates (candidate_id TEXT NOT NULL, candidate_version TEXT NOT NULL, content_digest TEXT NOT NULL UNIQUE, supersedes_candidate_digest TEXT, value_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (candidate_id, candidate_version))",
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS p0_playbook_promotion_policies (policy_id TEXT NOT NULL, policy_version TEXT NOT NULL, content_digest TEXT NOT NULL UNIQUE, value_json TEXT NOT NULL, approved_at TEXT NOT NULL, PRIMARY KEY (policy_id, policy_version))",
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS p0_playbook_promotion_assessments (assessment_id TEXT PRIMARY KEY, content_digest TEXT NOT NULL UNIQUE, candidate_digest TEXT NOT NULL, policy_digest TEXT NOT NULL, disposition TEXT NOT NULL, value_json TEXT NOT NULL, evaluated_at TEXT NOT NULL)",
  ).run();
  for (const table of [
    "p0_playbook_knowledge_candidates",
    "p0_playbook_promotion_policies",
    "p0_playbook_promotion_assessments",
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

export class D1CampaignPlaybookKnowledgeStore {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async appendCandidate(candidate: KnowledgeCandidate) {
    await ensureCampaignPlaybookKnowledgeTables(this.db);
    await assertKnowledgeCandidate(candidate);
    const latest = await this.db.prepare(
      "SELECT value_json FROM p0_playbook_knowledge_candidates WHERE candidate_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
    ).bind(candidate.candidate_id).first<ValueRow>();
    if (!latest && candidate.supersedes_candidate_digest !== null) {
      throw new CampaignPlaybookKnowledgeError("KNOWLEDGE_LINEAGE_INVALID", "The first candidate version cannot supersede unknown content.");
    }
    if (latest) {
      const previous = JSON.parse(latest.value_json) as KnowledgeCandidate;
      await assertKnowledgeCandidate(previous);
      if (candidate.supersedes_candidate_digest !== previous.content_digest
        || compareSemver(candidate.candidate_version, previous.candidate_version) <= 0
        || Date.parse(candidate.created_at) <= Date.parse(previous.created_at)) {
        throw new CampaignPlaybookKnowledgeError("KNOWLEDGE_LINEAGE_INVALID", "A new candidate version must supersede the exact latest digest with a greater version and later timestamp.");
      }
    }
    const result = await this.db.prepare(
      "INSERT OR IGNORE INTO p0_playbook_knowledge_candidates(candidate_id, candidate_version, content_digest, supersedes_candidate_digest, value_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(
      candidate.candidate_id,
      candidate.candidate_version,
      candidate.content_digest,
      candidate.supersedes_candidate_digest,
      JSON.stringify(candidate),
      candidate.created_at,
    ).run();
    return Number(result.meta.changes) === 1;
  }

  async loadCandidate(candidateId: string, candidateVersion: string) {
    await ensureCampaignPlaybookKnowledgeTables(this.db);
    const row = await this.db.prepare(
      "SELECT value_json FROM p0_playbook_knowledge_candidates WHERE candidate_id = ? AND candidate_version = ?",
    ).bind(candidateId, candidateVersion).first<ValueRow>();
    if (!row) return null;
    const candidate = JSON.parse(row.value_json) as KnowledgeCandidate;
    await assertKnowledgeCandidate(candidate);
    return candidate;
  }

  async loadCandidateHistory(candidateId: string) {
    await ensureCampaignPlaybookKnowledgeTables(this.db);
    const rows = await this.db.prepare(
      "SELECT value_json FROM p0_playbook_knowledge_candidates WHERE candidate_id = ? ORDER BY created_at, rowid",
    ).bind(candidateId).all<ValueRow>();
    const history = rows.results.map((row) => JSON.parse(row.value_json) as KnowledgeCandidate);
    for (const candidate of history) await assertKnowledgeCandidate(candidate);
    return history;
  }

  async savePolicy(policy: PromotionPolicy) {
    await ensureCampaignPlaybookKnowledgeTables(this.db);
    await assertPromotionPolicy(policy);
    const result = await this.db.prepare(
      "INSERT OR IGNORE INTO p0_playbook_promotion_policies(policy_id, policy_version, content_digest, value_json, approved_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(policy.policy_id, policy.policy_version, policy.content_digest, JSON.stringify(policy), policy.approved_at).run();
    return Number(result.meta.changes) === 1;
  }

  async loadPolicy(policyId: string, policyVersion: string) {
    await ensureCampaignPlaybookKnowledgeTables(this.db);
    const row = await this.db.prepare(
      "SELECT value_json FROM p0_playbook_promotion_policies WHERE policy_id = ? AND policy_version = ?",
    ).bind(policyId, policyVersion).first<ValueRow>();
    if (!row) return null;
    const policy = JSON.parse(row.value_json) as PromotionPolicy;
    await assertPromotionPolicy(policy);
    return policy;
  }

  async appendAssessment(assessment: PromotionAssessment) {
    await ensureCampaignPlaybookKnowledgeTables(this.db);
    await assertPromotionAssessment(assessment);
    const candidateRow = await this.db.prepare(
      "SELECT value_json FROM p0_playbook_knowledge_candidates WHERE content_digest = ?",
    ).bind(assessment.candidate.content_digest).first<ValueRow>();
    const policyRow = await this.db.prepare(
      "SELECT value_json FROM p0_playbook_promotion_policies WHERE content_digest = ?",
    ).bind(assessment.policy.content_digest).first<ValueRow>();
    if (!candidateRow || !policyRow) {
      throw new CampaignPlaybookKnowledgeError("PROMOTION_ASSESSMENT_LINEAGE_MISSING", "Assessment inputs must be persisted before the immutable assessment.");
    }
    const candidate = JSON.parse(candidateRow.value_json) as KnowledgeCandidate;
    const policy = JSON.parse(policyRow.value_json) as PromotionPolicy;
    await assertKnowledgeCandidate(candidate);
    await assertPromotionPolicy(policy);
    if (candidate.candidate_id !== assessment.candidate.candidate_id
      || candidate.candidate_version !== assessment.candidate.candidate_version
      || policy.policy_id !== assessment.policy.policy_id
      || policy.policy_version !== assessment.policy.policy_version) {
      throw new CampaignPlaybookKnowledgeError("PROMOTION_ASSESSMENT_LINEAGE_MISSING", "Assessment metadata must match its exact persisted inputs.");
    }
    const result = await this.db.prepare(
      "INSERT OR IGNORE INTO p0_playbook_promotion_assessments(assessment_id, content_digest, candidate_digest, policy_digest, disposition, value_json, evaluated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      assessment.assessment_id,
      assessment.content_digest,
      assessment.candidate.content_digest,
      assessment.policy.content_digest,
      assessment.disposition,
      JSON.stringify(assessment),
      assessment.evaluated_at,
    ).run();
    return Number(result.meta.changes) === 1;
  }

  async loadAssessment(assessmentId: string) {
    await ensureCampaignPlaybookKnowledgeTables(this.db);
    const row = await this.db.prepare(
      "SELECT value_json FROM p0_playbook_promotion_assessments WHERE assessment_id = ?",
    ).bind(assessmentId).first<ValueRow>();
    if (!row) return null;
    const assessment = JSON.parse(row.value_json) as PromotionAssessment;
    await assertPromotionAssessment(assessment);
    return assessment;
  }
}

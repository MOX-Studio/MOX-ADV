import type {
  DirectAuditArtifact,
  DirectAuditArtifactReference,
  DirectAuditCheckpoint,
  DirectAuditStore,
} from "./direct-audit.ts";

type AuditRow = {
  audit_id: string;
  version: number;
  state_json: string;
};

type ArtifactRow = {
  digest: string;
  value_json: string;
};

function nextRetryAt(state: DirectAuditCheckpoint) {
  return [
    ...Object.values(state.collections).map((collection) => collection.next_retry_at),
    ...state.reports.map((report) => report.next_retry_at),
  ].filter((value): value is string => Boolean(value)).sort()[0] ?? null;
}

export async function ensureP0DirectAuditTables(db: D1Database) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS p0_direct_audits (owner_key TEXT NOT NULL, account_key TEXT NOT NULL, audit_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, next_retry_at TEXT, state_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT, PRIMARY KEY (owner_key, account_key))",
  ).run();
  await db.prepare(
    "CREATE UNIQUE INDEX IF NOT EXISTS p0_direct_audits_audit_id_unique ON p0_direct_audits(audit_id)",
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS p0_direct_audit_artifacts (artifact_id TEXT PRIMARY KEY, audit_id TEXT NOT NULL, owner_key TEXT NOT NULL, account_key TEXT NOT NULL, kind TEXT NOT NULL, digest TEXT NOT NULL, byte_length INTEGER NOT NULL, object_count INTEGER NOT NULL, value_json TEXT NOT NULL, created_at TEXT NOT NULL)",
  ).run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS p0_direct_audit_artifacts_audit_id_idx ON p0_direct_audit_artifacts(audit_id)",
  ).run();
}

export class D1DirectAuditStore implements DirectAuditStore {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async loadCurrent(ownerKey: string, account: string) {
    await ensureP0DirectAuditTables(this.db);
    const row = await this.db.prepare(
      "SELECT audit_id, version, state_json FROM p0_direct_audits WHERE owner_key = ? AND account_key = ?",
    ).bind(ownerKey, account).first<AuditRow>();
    if (!row) return null;
    const state = JSON.parse(row.state_json) as DirectAuditCheckpoint;
    if (state.audit_id !== row.audit_id || state.version !== row.version) {
      throw new Error("Durable Direct audit checkpoint drift detected.");
    }
    return state;
  }

  async start(state: DirectAuditCheckpoint, expectedAuditId: string | null) {
    await ensureP0DirectAuditTables(this.db);
    const valueJson = JSON.stringify(state);
    if (expectedAuditId === null) {
      const result = await this.db.prepare(
        "INSERT OR IGNORE INTO p0_direct_audits(owner_key, account_key, audit_id, version, status, next_retry_at, state_json, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        state.owner_key,
        state.account,
        state.audit_id,
        state.version,
        state.status,
        nextRetryAt(state),
        valueJson,
        state.created_at,
        state.updated_at,
        state.completed_at,
      ).run();
      return Number(result.meta.changes) === 1;
    }
    const result = await this.db.prepare(
      "UPDATE p0_direct_audits SET audit_id = ?, version = ?, status = ?, next_retry_at = ?, state_json = ?, created_at = ?, updated_at = ?, completed_at = ? WHERE owner_key = ? AND account_key = ? AND audit_id = ?",
    ).bind(
      state.audit_id,
      state.version,
      state.status,
      nextRetryAt(state),
      valueJson,
      state.created_at,
      state.updated_at,
      state.completed_at,
      state.owner_key,
      state.account,
      expectedAuditId,
    ).run();
    return Number(result.meta.changes) === 1;
  }

  async compareAndSwap(auditId: string, expectedVersion: number, state: DirectAuditCheckpoint) {
    await ensureP0DirectAuditTables(this.db);
    if (auditId !== state.audit_id) return false;
    const result = await this.db.prepare(
      "UPDATE p0_direct_audits SET version = ?, status = ?, next_retry_at = ?, state_json = ?, updated_at = ?, completed_at = ? WHERE owner_key = ? AND account_key = ? AND audit_id = ? AND version = ?",
    ).bind(
      state.version,
      state.status,
      nextRetryAt(state),
      JSON.stringify(state),
      state.updated_at,
      state.completed_at,
      state.owner_key,
      state.account,
      auditId,
      expectedVersion,
    ).run();
    return Number(result.meta.changes) === 1;
  }

  async putArtifact(artifact: DirectAuditArtifact): Promise<DirectAuditArtifactReference> {
    await ensureP0DirectAuditTables(this.db);
    const valueJson = JSON.stringify(artifact.value);
    const result = await this.db.prepare(
      "INSERT OR IGNORE INTO p0_direct_audit_artifacts(artifact_id, audit_id, owner_key, account_key, kind, digest, byte_length, object_count, value_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      artifact.reference.artifact_id,
      artifact.reference.audit_id,
      artifact.owner_key,
      artifact.account,
      artifact.reference.kind,
      artifact.reference.digest,
      artifact.reference.byte_length,
      artifact.reference.object_count,
      valueJson,
      artifact.reference.observed_at,
    ).run();
    if (Number(result.meta.changes) !== 1) {
      const current = await this.db.prepare(
        "SELECT digest, value_json FROM p0_direct_audit_artifacts WHERE artifact_id = ?",
      ).bind(artifact.reference.artifact_id).first<ArtifactRow>();
      if (!current || current.digest !== artifact.reference.digest || current.value_json !== valueJson) {
        throw new Error("Durable Direct audit artifact identity drift detected.");
      }
    }
    return structuredClone(artifact.reference);
  }

  async getArtifact(artifactId: string) {
    await ensureP0DirectAuditTables(this.db);
    const row = await this.db.prepare(
      "SELECT digest, value_json FROM p0_direct_audit_artifacts WHERE artifact_id = ?",
    ).bind(artifactId).first<ArtifactRow>();
    return row ? JSON.parse(row.value_json) as unknown : null;
  }
}

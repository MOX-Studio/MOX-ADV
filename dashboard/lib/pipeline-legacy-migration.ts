import { pipelineDigest } from "./pipeline-orchestrator.ts";
import type { PipelineHistoricalView } from "./pipeline-owner-dashboard.ts";

const LEGACY_DOCUMENT_SCHEMA = /^p0-application-document-v(?:[1-9]|1[0-9])$/u;

export const PIPELINE_LEGACY_AUDIT_SCHEMA = "p0-pipeline-legacy-audit-v1";

export class PipelineLegacyMigrationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PipelineLegacyMigrationError";
    this.code = code;
  }
}

type HistoricalRow = {
  revision: number;
  updated_at: string;
  value_json: string;
};

type AuditRow = {
  source_digest: string;
  value_json: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function lineageError(message: string): never {
  throw new PipelineLegacyMigrationError(
    "PIPELINE_LEGACY_LINEAGE_INVALID",
    `Historical P0 document cannot enter the current pipeline: ${message}`,
  );
}

/**
 * Rejects legacy current-product lineage unless it can be referenced exactly.
 * Package, score and write objects are deliberately not migrated: the complete
 * source document remains in the immutable audit row instead.
 */
export function assertRecoverableHistoricalDocument(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    lineageError("document root is not an object.");
  }
  const state = value as Record<string, unknown>;
  const schema = text(state.schema_version);
  if (!LEGACY_DOCUMENT_SCHEMA.test(schema)) {
    throw new PipelineLegacyMigrationError(
      "PIPELINE_LEGACY_SCHEMA_UNSUPPORTED",
      `Historical P0 document schema ${schema || "<missing>"} is not supported.`,
    );
  }

  const evidence = record(state.analytics_evidence_snapshot);
  const strategy = record(state.strategy);
  const recommendationSet = record(state.recommendation_set);
  const drafts = Array.isArray(recommendationSet.drafts) ? recommendationSet.drafts : [];

  if (Object.keys(evidence).length && (!text(evidence.schema_version) || !text(evidence.snapshot_id))) {
    lineageError("Analytics Evidence Snapshot identity is incomplete.");
  }
  if (Object.keys(strategy).length) {
    if (!Object.keys(record(state.business_model)).length || !text(strategy.schema_version) || !text(strategy.strategy_revision_id)) {
      lineageError("Campaign Strategy identity or Business Model parent is incomplete.");
    }
    if (Object.keys(evidence).length
      && text(strategy.analytics_evidence_snapshot_id) !== text(evidence.snapshot_id)) {
      lineageError("Campaign Strategy has incomplete or conflicting Analytics Evidence Snapshot lineage.");
    }
  }
  if (Object.keys(recommendationSet).length && !Object.keys(strategy).length) {
    lineageError("campaign collection has no Campaign Strategy parent.");
  }
  if (Object.keys(recommendationSet).length && !Array.isArray(recommendationSet.drafts)) {
    lineageError("campaign collection drafts are not an array.");
  }
  if (Object.keys(recommendationSet).length
    && (text(recommendationSet.strategy_revision_id) !== text(strategy.strategy_revision_id)
      || (Object.keys(evidence).length
        && text(recommendationSet.analytics_evidence_snapshot_id) !== text(evidence.snapshot_id)))) {
    lineageError("campaign collection has incomplete or conflicting Strategy/Evidence lineage.");
  }

  for (const [index, item] of drafts.entries()) {
    const draft = record(item);
    const hypothesis = record(record(draft.variant).hypothesis);
    const projectionLineage = record(record(draft.publish_projection).lineage);
    const draftId = text(draft.draft_id);
    const draftRevisionId = text(draft.draft_revision_id);
    const strategyRevisionId = text(strategy.strategy_revision_id);
    if (!draftId || !draftRevisionId || !text(draft.schema_version)
      || text(draft.strategy_revision_id) !== strategyRevisionId
      || !text(hypothesis.schema_version) || !text(hypothesis.hypothesis_id)
      || (text(hypothesis.draft_revision_id) && text(hypothesis.draft_revision_id) !== draftRevisionId)
      || text(projectionLineage.strategy_revision_id) !== strategyRevisionId
      || text(projectionLineage.draft_id) !== draftId
      || text(projectionLineage.draft_revision_id) !== draftRevisionId) {
      lineageError(`Campaign Hypothesis + Draft pair ${index + 1} has incomplete or conflicting lineage.`);
    }
  }
}

export async function ensurePipelineLegacyAuditTables(db: D1Database) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS p0_pipeline_legacy_audit (owner_key TEXT NOT NULL, revision INTEGER NOT NULL, audit_schema TEXT NOT NULL, source_schema TEXT NOT NULL, source_updated_at TEXT NOT NULL, source_digest TEXT NOT NULL, value_json TEXT NOT NULL, archived_at TEXT NOT NULL, PRIMARY KEY (owner_key, revision))",
  ).run();
  await db.prepare(
    "CREATE TRIGGER IF NOT EXISTS p0_pipeline_legacy_audit_no_update BEFORE UPDATE ON p0_pipeline_legacy_audit BEGIN SELECT RAISE(ABORT, 'pipeline legacy audit is immutable'); END",
  ).run();
  await db.prepare(
    "CREATE TRIGGER IF NOT EXISTS p0_pipeline_legacy_audit_no_delete BEFORE DELETE ON p0_pipeline_legacy_audit BEGIN SELECT RAISE(ABORT, 'pipeline legacy audit is immutable'); END",
  ).run();
}

/** Archives the byte-equivalent legacy JSON before attempting recovery. */
export async function archiveLegacyPipelineDocument(
  db: D1Database,
  ownerKey: string,
  archivedAt = new Date().toISOString(),
): Promise<PipelineHistoricalView> {
  await ensurePipelineLegacyAuditTables(db);
  const row = await db.prepare(
    "SELECT revision, updated_at, value_json FROM p0_state WHERE user_key = ?",
  ).bind(ownerKey).first<HistoricalRow>();
  if (!row) {
    throw new PipelineLegacyMigrationError(
      "PIPELINE_HISTORICAL_DOCUMENT_MISSING",
      "Historical P0 document was not found; no migration was written.",
    );
  }
  if (!Number.isSafeInteger(row.revision) || row.revision < 0) {
    throw new PipelineLegacyMigrationError(
      "PIPELINE_HISTORICAL_DOCUMENT_INVALID",
      "Historical P0 document revision is invalid.",
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(row.value_json);
  } catch {
    decoded = null;
  }
  const sourceSchema = text(record(decoded).schema_version) || "UNKNOWN";
  const sourceDigest = await pipelineDigest(row.value_json);
  await db.prepare(
    "INSERT OR IGNORE INTO p0_pipeline_legacy_audit(owner_key, revision, audit_schema, source_schema, source_updated_at, source_digest, value_json, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    ownerKey,
    row.revision,
    PIPELINE_LEGACY_AUDIT_SCHEMA,
    sourceSchema,
    row.updated_at,
    sourceDigest,
    row.value_json,
    archivedAt,
  ).run();
  const archived = await db.prepare(
    "SELECT source_digest, value_json FROM p0_pipeline_legacy_audit WHERE owner_key = ? AND revision = ?",
  ).bind(ownerKey, row.revision).first<AuditRow>();
  if (!archived || archived.source_digest !== sourceDigest || archived.value_json !== row.value_json) {
    throw new PipelineLegacyMigrationError(
      "PIPELINE_LEGACY_AUDIT_CONFLICT",
      "Historical P0 revision differs from its immutable audit copy; current migration was rejected.",
    );
  }

  if (decoded === null) {
    throw new PipelineLegacyMigrationError(
      "PIPELINE_HISTORICAL_DOCUMENT_INVALID",
      "Historical P0 document contains invalid JSON; the exact bytes were preserved for audit.",
    );
  }
  assertRecoverableHistoricalDocument(decoded);
  return { revision: row.revision, state: structuredClone(decoded) };
}

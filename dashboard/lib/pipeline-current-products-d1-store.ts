import {
  PIPELINE_CURRENT_PRODUCTS_SCHEMA,
  type PipelineCurrentProducts,
  type PipelineCurrentProductStore,
} from "./pipeline-current-products.ts";

const COMPRESSED_VALUE_PREFIX = "p0:gzip-base64:v1:";

type CurrentRow = { state_revision: number; value_json: string };

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 32_768));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function compressValue(value: string) {
  const body = new Response(new TextEncoder().encode(value)).body;
  if (!body) throw new Error("Pipeline product compression stream is unavailable.");
  const compressed = new Uint8Array(await new Response(
    body.pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer());
  return `${COMPRESSED_VALUE_PREFIX}${bytesToBase64(compressed)}`;
}

async function decompressValue(value: string) {
  if (!value.startsWith(COMPRESSED_VALUE_PREFIX)) return value;
  const body = new Response(base64ToBytes(value.slice(COMPRESSED_VALUE_PREFIX.length))).body;
  if (!body) throw new Error("Pipeline product decompression stream is unavailable.");
  return new TextDecoder().decode(await new Response(
    body.pipeThrough(new DecompressionStream("gzip")),
  ).arrayBuffer());
}

function assertCurrentProducts(value: unknown): asserts value is PipelineCurrentProducts {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Current pipeline products are corrupt.");
  const current = value as PipelineCurrentProducts;
  if (current.schema_version !== PIPELINE_CURRENT_PRODUCTS_SCHEMA
    || !current.owner_key || !current.run_id
    || !Number.isSafeInteger(current.state_revision) || current.state_revision < 0
    || current.authority?.external_write !== "DENIED"
    || current.authority?.publication !== "NOT_AUTHORIZED"
    || current.authority?.impressions !== 0
    || current.authority?.spend_micros !== 0) {
    throw new Error("Current pipeline products violate the closed zero-write schema.");
  }
  const refresh = current.competitor_evidence_refresh;
  if (refresh && (
    refresh.schema_version !== "p0-pipeline-competitor-evidence-refresh-v1"
    || !refresh.revision_id || !refresh.refreshed_at || !refresh.evidence_pack_id
    || refresh.authority?.external_write !== "DENIED"
    || refresh.authority?.publication !== "NOT_AUTHORIZED"
    || refresh.authority?.impressions !== 0
    || refresh.authority?.spend_micros !== 0
  )) {
    throw new Error("Current competitor evidence refresh violates the closed zero-write schema.");
  }
}

export async function ensurePipelineCurrentProductTables(db: D1Database) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS p0_pipeline_current_products (owner_key TEXT PRIMARY KEY, state_revision INTEGER NOT NULL, run_id TEXT NOT NULL, run_version INTEGER NOT NULL, current_stage TEXT NOT NULL, updated_at TEXT NOT NULL, value_json TEXT NOT NULL)",
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS p0_pipeline_product_revisions (owner_key TEXT NOT NULL, state_revision INTEGER NOT NULL, run_id TEXT NOT NULL, run_version INTEGER NOT NULL, current_stage TEXT NOT NULL, updated_at TEXT NOT NULL, value_json TEXT NOT NULL, PRIMARY KEY (owner_key, state_revision))",
  ).run();
  await db.prepare(
    "CREATE TRIGGER IF NOT EXISTS p0_pipeline_product_revisions_no_update BEFORE UPDATE ON p0_pipeline_product_revisions BEGIN SELECT RAISE(ABORT, 'pipeline product revisions are immutable'); END",
  ).run();
  await db.prepare(
    "CREATE TRIGGER IF NOT EXISTS p0_pipeline_product_revisions_no_delete BEFORE DELETE ON p0_pipeline_product_revisions BEGIN SELECT RAISE(ABORT, 'pipeline product revisions are immutable'); END",
  ).run();
  await db.prepare(
    "CREATE TRIGGER IF NOT EXISTS p0_pipeline_current_products_history_insert AFTER INSERT ON p0_pipeline_current_products BEGIN INSERT INTO p0_pipeline_product_revisions(owner_key, state_revision, run_id, run_version, current_stage, updated_at, value_json) VALUES (NEW.owner_key, NEW.state_revision, NEW.run_id, NEW.run_version, NEW.current_stage, NEW.updated_at, NEW.value_json); END",
  ).run();
  await db.prepare(
    "CREATE TRIGGER IF NOT EXISTS p0_pipeline_current_products_history_update AFTER UPDATE ON p0_pipeline_current_products BEGIN INSERT INTO p0_pipeline_product_revisions(owner_key, state_revision, run_id, run_version, current_stage, updated_at, value_json) VALUES (NEW.owner_key, NEW.state_revision, NEW.run_id, NEW.run_version, NEW.current_stage, NEW.updated_at, NEW.value_json); END",
  ).run();
}

export class D1PipelineCurrentProductStore implements PipelineCurrentProductStore {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async loadCurrent(ownerKey: string) {
    await ensurePipelineCurrentProductTables(this.db);
    const row = await this.db.prepare(
      "SELECT state_revision, value_json FROM p0_pipeline_current_products WHERE owner_key = ?",
    ).bind(ownerKey).first<CurrentRow>();
    if (!row) return null;
    const value = JSON.parse(await decompressValue(row.value_json)) as unknown;
    assertCurrentProducts(value);
    if (value.owner_key !== ownerKey || value.state_revision !== row.state_revision) {
      throw new Error("Current pipeline product row identity is corrupt.");
    }
    return structuredClone(value);
  }

  async compareAndSwap(ownerKey: string, expectedStateRevision: number | null, current: PipelineCurrentProducts) {
    await ensurePipelineCurrentProductTables(this.db);
    assertCurrentProducts(current);
    if (current.owner_key !== ownerKey || current.state_revision !== (expectedStateRevision ?? -1) + 1) {
      throw new Error("Current pipeline product CAS metadata is invalid.");
    }
    const stored = await compressValue(JSON.stringify(current));
    const statement = expectedStateRevision === null
      ? this.db.prepare(
          "INSERT OR IGNORE INTO p0_pipeline_current_products(owner_key, state_revision, run_id, run_version, current_stage, updated_at, value_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).bind(ownerKey, current.state_revision, current.run_id, current.run_version, current.current_stage, current.updated_at, stored)
      : this.db.prepare(
          "UPDATE p0_pipeline_current_products SET state_revision = ?, run_id = ?, run_version = ?, current_stage = ?, updated_at = ?, value_json = ? WHERE owner_key = ? AND state_revision = ?",
        ).bind(current.state_revision, current.run_id, current.run_version, current.current_stage, current.updated_at, stored, ownerKey, expectedStateRevision);
    const result = await statement.run();
    const changes = Number(result.meta.changes);
    // D1 may report trigger-side immutable-history insertion in addition to the
    // one current-row mutation. Zero still unambiguously means the CAS lost.
    if (!Number.isSafeInteger(changes) || changes < 1) return false;
    const revision = await this.db.prepare(
      "SELECT value_json FROM p0_pipeline_product_revisions WHERE owner_key = ? AND state_revision = ?",
    ).bind(ownerKey, current.state_revision).first<{ value_json: string }>();
    return revision?.value_json === stored;
  }
}

import {
  assertPipelineRunState,
  verifyPipelineRunState,
  type PipelineRunState,
  type PipelineRunStore,
} from "./pipeline-orchestrator.ts";

type PipelineRunRow = {
  version: number;
  value_json: string;
};

export async function ensurePipelineOrchestratorTables(db: D1Database) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS p0_pipeline_runs (run_id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, current_stage TEXT NOT NULL, input_versions_json TEXT NOT NULL, input_versions_digest TEXT NOT NULL, authority_json TEXT NOT NULL, value_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  ).run();
  await db.prepare(
    "CREATE UNIQUE INDEX IF NOT EXISTS p0_pipeline_runs_one_active_owner ON p0_pipeline_runs(owner_key) WHERE status = 'ACTIVE'",
  ).run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS p0_pipeline_runs_owner_created ON p0_pipeline_runs(owner_key, created_at)",
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS p0_pipeline_run_revisions (run_id TEXT NOT NULL, version INTEGER NOT NULL, value_json TEXT NOT NULL, recorded_at TEXT NOT NULL, PRIMARY KEY (run_id, version))",
  ).run();
}

function parse(row: PipelineRunRow | null) {
  if (!row) return null;
  const state = JSON.parse(row.value_json) as PipelineRunState;
  if (state.version !== row.version) throw new Error("Durable pipeline run version drift detected.");
  return state;
}

export class D1PipelineRunStore implements PipelineRunStore {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async load(runId: string) {
    await ensurePipelineOrchestratorTables(this.db);
    const row = await this.db
      .prepare("SELECT version, value_json FROM p0_pipeline_runs WHERE run_id = ?")
      .bind(runId)
      .first<PipelineRunRow>();
    const state = parse(row);
    if (state) await verifyPipelineRunState(state);
    return state;
  }

  async loadCurrent(ownerKey: string) {
    await ensurePipelineOrchestratorTables(this.db);
    const row = await this.db
      .prepare("SELECT version, value_json FROM p0_pipeline_runs WHERE owner_key = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .bind(ownerKey)
      .first<PipelineRunRow>();
    const state = parse(row);
    if (state) await verifyPipelineRunState(state);
    return state;
  }

  async loadActive(ownerKey: string) {
    await ensurePipelineOrchestratorTables(this.db);
    const row = await this.db
      .prepare("SELECT version, value_json FROM p0_pipeline_runs WHERE owner_key = ? AND status = 'ACTIVE' LIMIT 1")
      .bind(ownerKey)
      .first<PipelineRunRow>();
    const state = parse(row);
    if (state) await verifyPipelineRunState(state);
    return state;
  }

  async initialize(state: PipelineRunState) {
    await ensurePipelineOrchestratorTables(this.db);
    assertPipelineRunState(state);
    if (state.version !== 0 || state.status !== "ACTIVE") return false;
    await verifyPipelineRunState(state);
    const valueJson = JSON.stringify(state);
    const results = await this.db.batch([
      this.db.prepare(
        "INSERT OR IGNORE INTO p0_pipeline_runs(run_id, owner_key, version, status, current_stage, input_versions_json, input_versions_digest, authority_json, value_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        state.run_id,
        state.owner_key,
        state.version,
        state.status,
        state.current_stage,
        JSON.stringify(state.input_versions),
        state.input_versions_digest,
        JSON.stringify(state.authority),
        valueJson,
        state.started_at,
        state.updated_at,
      ),
      this.db.prepare(
        "INSERT OR IGNORE INTO p0_pipeline_run_revisions(run_id, version, value_json, recorded_at) SELECT run_id, version, value_json, updated_at FROM p0_pipeline_runs WHERE run_id = ? AND version = ? AND value_json = ?",
      ).bind(state.run_id, state.version, valueJson),
    ]);
    return Number(results[0].meta.changes) === 1;
  }

  async compareAndSwap(runId: string, expectedVersion: number, state: PipelineRunState) {
    await ensurePipelineOrchestratorTables(this.db);
    assertPipelineRunState(state);
    if (runId !== state.run_id || state.version !== expectedVersion + 1) return false;
    await verifyPipelineRunState(state);
    const valueJson = JSON.stringify(state);
    const results = await this.db.batch([
      this.db.prepare(
        "UPDATE p0_pipeline_runs SET version = ?, status = ?, current_stage = ?, input_versions_json = ?, input_versions_digest = ?, authority_json = ?, value_json = ?, updated_at = ? WHERE run_id = ? AND version = ?",
      ).bind(
        state.version,
        state.status,
        state.current_stage,
        JSON.stringify(state.input_versions),
        state.input_versions_digest,
        JSON.stringify(state.authority),
        valueJson,
        state.updated_at,
        runId,
        expectedVersion,
      ),
      this.db.prepare(
        "INSERT OR IGNORE INTO p0_pipeline_run_revisions(run_id, version, value_json, recorded_at) SELECT run_id, version, value_json, updated_at FROM p0_pipeline_runs WHERE run_id = ? AND version = ? AND value_json = ?",
      ).bind(runId, state.version, valueJson),
    ]);
    return Number(results[0].meta.changes) === 1;
  }
}

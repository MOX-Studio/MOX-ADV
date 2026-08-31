import {
  PIPELINE_ORCHESTRATOR_CONTRACT,
  PIPELINE_ORCHESTRATOR_VERSION,
  assertPipelineRunState,
  verifyPipelineAuditTrail,
  verifyPipelineRunState,
  type PipelineAuditEvent,
  type PipelineRunState,
  type PipelineRunStore,
} from "./pipeline-orchestrator.ts";

type PipelineRunRow = {
  version: number;
  value_json: string;
};

type PipelineAuditRow = {
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
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS p0_pipeline_audit_events (run_id TEXT NOT NULL, sequence INTEGER NOT NULL, run_version INTEGER NOT NULL, event_kind TEXT NOT NULL, stage TEXT NOT NULL, attempt INTEGER NOT NULL, actor_id TEXT NOT NULL, input_versions_digest TEXT NOT NULL, previous_event_digest TEXT, event_digest TEXT NOT NULL UNIQUE, value_json TEXT NOT NULL, recorded_at TEXT NOT NULL, PRIMARY KEY (run_id, sequence))",
  ).run();
  await db.prepare(
    "CREATE TRIGGER IF NOT EXISTS p0_pipeline_audit_events_no_update BEFORE UPDATE ON p0_pipeline_audit_events BEGIN SELECT RAISE(ABORT, 'pipeline audit events are immutable'); END",
  ).run();
  await db.prepare(
    "CREATE TRIGGER IF NOT EXISTS p0_pipeline_audit_events_no_delete BEFORE DELETE ON p0_pipeline_audit_events BEGIN SELECT RAISE(ABORT, 'pipeline audit events are immutable'); END",
  ).run();
}

function parse(row: PipelineRunRow | null) {
  if (!row) return null;
  const persisted = JSON.parse(row.value_json) as Record<string, unknown>;
  const contract = persisted.contract as Record<string, unknown> | undefined;
  if (contract?.name === PIPELINE_ORCHESTRATOR_CONTRACT
    && contract.version === "1.1.0"
    && !Object.hasOwn(persisted, "goal_formation")) {
    if (persisted.current_stage !== "CAMPAIGN_GOAL") {
      throw new Error("Legacy pipeline passed Campaign Goal without a verifiable GoalRevision.");
    }
    persisted.contract = { name: PIPELINE_ORCHESTRATOR_CONTRACT, version: PIPELINE_ORCHESTRATOR_VERSION };
    persisted.goal_formation = { status: "PENDING" };
  }
  const state = persisted as PipelineRunState;
  if (state.version !== row.version) throw new Error("Durable pipeline run version drift detected.");
  return state;
}

export class D1PipelineRunStore implements PipelineRunStore {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  private async verifyState(state: PipelineRunState | null) {
    if (!state) return null;
    await verifyPipelineRunState(state);
    await verifyPipelineAuditTrail(await this.loadAudit(state.run_id), state);
    return state;
  }

  async load(runId: string) {
    await ensurePipelineOrchestratorTables(this.db);
    const row = await this.db
      .prepare("SELECT version, value_json FROM p0_pipeline_runs WHERE run_id = ?")
      .bind(runId)
      .first<PipelineRunRow>();
    return this.verifyState(parse(row));
  }

  async loadCurrent(ownerKey: string) {
    await ensurePipelineOrchestratorTables(this.db);
    const row = await this.db
      .prepare("SELECT version, value_json FROM p0_pipeline_runs WHERE owner_key = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .bind(ownerKey)
      .first<PipelineRunRow>();
    return this.verifyState(parse(row));
  }

  async loadActive(ownerKey: string) {
    await ensurePipelineOrchestratorTables(this.db);
    const row = await this.db
      .prepare("SELECT version, value_json FROM p0_pipeline_runs WHERE owner_key = ? AND status = 'ACTIVE' LIMIT 1")
      .bind(ownerKey)
      .first<PipelineRunRow>();
    return this.verifyState(parse(row));
  }

  async loadAudit(runId: string) {
    await ensurePipelineOrchestratorTables(this.db);
    const rows = await this.db
      .prepare("SELECT value_json FROM p0_pipeline_audit_events WHERE run_id = ? ORDER BY sequence")
      .bind(runId)
      .all<PipelineAuditRow>();
    const events = rows.results.map((row) => JSON.parse(row.value_json) as PipelineAuditEvent);
    return verifyPipelineAuditTrail(events);
  }

  async initialize(state: PipelineRunState, event: PipelineAuditEvent) {
    await ensurePipelineOrchestratorTables(this.db);
    assertPipelineRunState(state);
    if (state.version !== 0 || state.status !== "ACTIVE") return false;
    await verifyPipelineRunState(state);
    await verifyPipelineAuditTrail([event], state);
    const valueJson = JSON.stringify(state);
    const eventJson = JSON.stringify(event);
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
      this.db.prepare(
        "INSERT OR IGNORE INTO p0_pipeline_audit_events(run_id, sequence, run_version, event_kind, stage, attempt, actor_id, input_versions_digest, previous_event_digest, event_digest, value_json, recorded_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM p0_pipeline_runs WHERE run_id = ? AND version = ? AND value_json = ?)",
      ).bind(
        event.run_id, event.sequence, event.run_version, event.event_kind, event.stage, event.attempt,
        event.actor.actor_id, event.input_versions_digest, event.previous_event_digest, event.event_digest,
        eventJson, event.recorded_at, state.run_id, state.version, valueJson,
      ),
    ]);
    return Number(results[0].meta.changes) === 1 && Number(results[2].meta.changes) === 1;
  }

  async compareAndSwap(runId: string, expectedVersion: number, state: PipelineRunState, event: PipelineAuditEvent) {
    await ensurePipelineOrchestratorTables(this.db);
    assertPipelineRunState(state);
    if (runId !== state.run_id || state.version !== expectedVersion + 1) return false;
    const current = await this.load(runId);
    if (!current || current.version !== expectedVersion) return false;
    await verifyPipelineRunState(state);
    const trail = await this.loadAudit(runId);
    await verifyPipelineAuditTrail([...trail, event], state);
    const valueJson = JSON.stringify(state);
    const eventJson = JSON.stringify(event);
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
      this.db.prepare(
        "INSERT OR IGNORE INTO p0_pipeline_audit_events(run_id, sequence, run_version, event_kind, stage, attempt, actor_id, input_versions_digest, previous_event_digest, event_digest, value_json, recorded_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM p0_pipeline_runs WHERE run_id = ? AND version = ? AND value_json = ?)",
      ).bind(
        event.run_id, event.sequence, event.run_version, event.event_kind, event.stage, event.attempt,
        event.actor.actor_id, event.input_versions_digest, event.previous_event_digest, event.event_digest,
        eventJson, event.recorded_at, runId, state.version, valueJson,
      ),
    ]);
    return Number(results[0].meta.changes) === 1 && Number(results[2].meta.changes) === 1;
  }
}

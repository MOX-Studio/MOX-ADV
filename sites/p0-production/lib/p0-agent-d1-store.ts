import type {
  P0AgentRunState,
  P0AgentRunStore,
} from "./p0-agent-runtime.ts";

type AgentRunRow = {
  version: number;
  value_json: string;
};

export async function ensureP0AgentTables(db: D1Database) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS p0_agent_runs (run_id TEXT PRIMARY KEY, user_key TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, stop_reason TEXT, application_revision INTEGER NOT NULL, authority_digest TEXT NOT NULL, prior_outcomes_digest TEXT NOT NULL, budget_json TEXT NOT NULL, value_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS p0_agent_checkpoints (run_id TEXT NOT NULL, sequence INTEGER NOT NULL, kind TEXT NOT NULL, application_revision INTEGER NOT NULL, authority_digest TEXT NOT NULL, prior_outcomes_digest TEXT NOT NULL, observation_count INTEGER NOT NULL, budget_usage_json TEXT NOT NULL, recorded_at TEXT NOT NULL, PRIMARY KEY (run_id, sequence))",
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS p0_agent_observations (run_id TEXT NOT NULL, sequence INTEGER NOT NULL, tool_call_id TEXT NOT NULL, tool_name TEXT NOT NULL, trust TEXT NOT NULL, summary TEXT NOT NULL, facts_json TEXT NOT NULL, source_references_json TEXT NOT NULL, application_revision INTEGER NOT NULL, authority_digest TEXT NOT NULL, prior_outcomes_digest TEXT NOT NULL, observed_at TEXT NOT NULL, PRIMARY KEY (run_id, sequence))",
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS p0_agent_budget_events (run_id TEXT NOT NULL, checkpoint_sequence INTEGER NOT NULL, usage_json TEXT NOT NULL, remaining_json TEXT NOT NULL, recorded_at TEXT NOT NULL, PRIMARY KEY (run_id, checkpoint_sequence))",
  ).run();
}

function eventStatements(db: D1Database, state: P0AgentRunState, valueJson: string) {
  const currentRun = "EXISTS (SELECT 1 FROM p0_agent_runs WHERE run_id = ? AND version = ? AND value_json = ?)";
  const checkpointStatements = state.checkpoints.map((item) => db.prepare(
    `INSERT OR IGNORE INTO p0_agent_checkpoints(run_id, sequence, kind, application_revision, authority_digest, prior_outcomes_digest, observation_count, budget_usage_json, recorded_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${currentRun}`,
  ).bind(
    state.run_id,
    item.sequence,
    item.kind,
    item.application_revision,
    item.authority_digest,
    item.prior_outcomes_digest,
    item.observation_count,
    JSON.stringify(item.budget_usage),
    item.recorded_at,
    state.run_id,
    state.version,
    valueJson,
  ));
  const observationStatements = state.observations.map((item) => db.prepare(
    `INSERT OR IGNORE INTO p0_agent_observations(run_id, sequence, tool_call_id, tool_name, trust, summary, facts_json, source_references_json, application_revision, authority_digest, prior_outcomes_digest, observed_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${currentRun}`,
  ).bind(
    state.run_id,
    item.sequence,
    item.tool_call_id,
    item.tool_name,
    item.trust,
    item.summary,
    JSON.stringify(item.facts),
    JSON.stringify(item.source_references),
    item.application_revision,
    item.authority_digest,
    item.prior_outcomes_digest,
    item.observed_at,
    state.run_id,
    state.version,
    valueJson,
  ));
  const budgetStatements = state.checkpoints.map((item) => {
    const usage = item.budget_usage;
    const limits = state.budget.limits;
    const remaining = {
      max_model_calls: Math.max(0, limits.max_model_calls - usage.model_calls),
      max_tool_calls: Math.max(0, limits.max_tool_calls - usage.tool_calls),
      max_input_tokens: Math.max(0, limits.max_input_tokens - usage.input_tokens),
      max_output_tokens: Math.max(0, limits.max_output_tokens - usage.output_tokens),
      max_elapsed_ms: Math.max(0, limits.max_elapsed_ms - usage.elapsed_ms),
      max_cost_microusd: Math.max(0, limits.max_cost_microusd - usage.cost_microusd),
    };
    return db.prepare(
      `INSERT OR IGNORE INTO p0_agent_budget_events(run_id, checkpoint_sequence, usage_json, remaining_json, recorded_at) SELECT ?, ?, ?, ?, ? WHERE ${currentRun}`,
    ).bind(
      state.run_id,
      item.sequence,
      JSON.stringify(usage),
      JSON.stringify(remaining),
      item.recorded_at,
      state.run_id,
      state.version,
      valueJson,
    );
  });
  return [...checkpointStatements, ...observationStatements, ...budgetStatements];
}

export class D1P0AgentRunStore implements P0AgentRunStore {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async load(runId: string): Promise<P0AgentRunState | null> {
    await ensureP0AgentTables(this.db);
    const row = await this.db
      .prepare("SELECT version, value_json FROM p0_agent_runs WHERE run_id = ?")
      .bind(runId)
      .first<AgentRunRow>();
    if (!row) return null;
    const state = JSON.parse(row.value_json) as P0AgentRunState;
    if (state.version !== row.version) throw new Error("Durable agent run version drift detected.");
    return state;
  }

  async loadCurrent(ownerKey: string): Promise<P0AgentRunState | null> {
    await ensureP0AgentTables(this.db);
    const row = await this.db
      .prepare("SELECT version, value_json FROM p0_agent_runs WHERE user_key = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .bind(ownerKey)
      .first<AgentRunRow>();
    if (!row) return null;
    const state = JSON.parse(row.value_json) as P0AgentRunState;
    if (state.version !== row.version) throw new Error("Durable agent run version drift detected.");
    return state;
  }

  async initialize(state: P0AgentRunState) {
    await ensureP0AgentTables(this.db);
    const valueJson = JSON.stringify(state);
    const results = await this.db.batch([
      this.db.prepare(
        "INSERT OR IGNORE INTO p0_agent_runs(run_id, user_key, version, status, stop_reason, application_revision, authority_digest, prior_outcomes_digest, budget_json, value_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        state.run_id,
        state.owner_key,
        state.version,
        state.status,
        state.stop_reason?.code ?? null,
        state.authority.application_revision,
        state.authority.authority_digest,
        state.authority.prior_outcomes_digest,
        JSON.stringify(state.budget),
        valueJson,
        state.created_at,
        state.updated_at,
      ),
      ...eventStatements(this.db, state, valueJson),
    ]);
    return Number(results[0].meta.changes) === 1;
  }

  async compareAndSwap(runId: string, expectedVersion: number, state: P0AgentRunState) {
    await ensureP0AgentTables(this.db);
    if (runId !== state.run_id) return false;
    const valueJson = JSON.stringify(state);
    const results = await this.db.batch([
      this.db.prepare(
        "UPDATE p0_agent_runs SET version = ?, status = ?, stop_reason = ?, application_revision = ?, authority_digest = ?, prior_outcomes_digest = ?, budget_json = ?, value_json = ?, updated_at = ? WHERE run_id = ? AND version = ?",
      ).bind(
        state.version,
        state.status,
        state.stop_reason?.code ?? null,
        state.authority.application_revision,
        state.authority.authority_digest,
        state.authority.prior_outcomes_digest,
        JSON.stringify(state.budget),
        valueJson,
        state.updated_at,
        runId,
        expectedVersion,
      ),
      ...eventStatements(this.db, state, valueJson),
    ]);
    return Number(results[0].meta.changes) === 1;
  }
}

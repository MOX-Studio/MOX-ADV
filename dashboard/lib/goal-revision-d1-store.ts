import {
  CURRENT_GOAL_SCHEMA,
  type CurrentGoal,
  type CurrentGoalStore,
} from "./goal-revision-lifecycle.ts";
import { verifyGoalFormationResult } from "./goal-revision.ts";

export async function ensureCurrentGoalTable(db: D1Database) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS p0_goal_revisions (owner_key TEXT NOT NULL, version INTEGER NOT NULL, goal_revision_id TEXT NOT NULL UNIQUE, value_json TEXT NOT NULL, recorded_at TEXT NOT NULL, PRIMARY KEY (owner_key, version))",
  ).run();
}

async function verifyCurrentGoal(value: CurrentGoal) {
  if (value.schema_version !== CURRENT_GOAL_SCHEMA
    || !value.owner_key
    || !["GOAL_AGENT", "OWNER_INPUT", "OWNER_CORRECTION"].includes(value.source)
    || value.revision.version < 1) {
    throw new Error("Current Goal record is invalid.");
  }
  await verifyGoalFormationResult({ status: "VERIFIED", revision: value.revision });
  if (value.invalidation && value.invalidation.current_goal_revision_id !== value.revision.goal_revision_id) {
    throw new Error("Current Goal invalidation does not point to its revision.");
  }
  return value;
}

export class D1CurrentGoalStore implements CurrentGoalStore {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async loadCurrent(ownerKey: string) {
    await ensureCurrentGoalTable(this.db);
    const row = await this.db.prepare(
      "SELECT value_json FROM p0_goal_revisions WHERE owner_key = ? ORDER BY version DESC LIMIT 1",
    ).bind(ownerKey).first<{ value_json: string }>();
    return row ? verifyCurrentGoal(JSON.parse(row.value_json) as CurrentGoal) : null;
  }

  async append(current: CurrentGoal, expectedVersion: number | null) {
    await ensureCurrentGoalTable(this.db);
    await verifyCurrentGoal(current);
    const expected = expectedVersion ?? 0;
    if (current.revision.version !== expected + 1) return false;
    const result = await this.db.prepare(
      "INSERT OR IGNORE INTO p0_goal_revisions(owner_key, version, goal_revision_id, value_json, recorded_at) SELECT ?, ?, ?, ?, ? WHERE COALESCE((SELECT MAX(version) FROM p0_goal_revisions WHERE owner_key = ?), 0) = ?",
    ).bind(
      current.owner_key,
      current.revision.version,
      current.revision.goal_revision_id,
      JSON.stringify(current),
      current.revision.validation.verified_at,
      current.owner_key,
      expected,
    ).run();
    return Number(result.meta.changes) === 1;
  }
}

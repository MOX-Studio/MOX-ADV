import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const p0States = sqliteTable("p0_state", {
  userKey: text("user_key").primaryKey(),
  revision: integer("revision").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
  valueJson: text("value_json").notNull(),
});

export const p0StateRevisions = sqliteTable("p0_state_revisions", {
  userKey: text("user_key").notNull(),
  revision: integer("revision").notNull(),
  updatedAt: text("updated_at").notNull(),
  valueJson: text("value_json").notNull(),
}, (table) => [primaryKey({ columns: [table.userKey, table.revision] })]);

export const p0Executions = sqliteTable("p0_executions", {
  executionId: text("execution_id").primaryKey(),
  userKey: text("user_key").notNull(),
  accountKey: text("account_key").notNull(),
  status: text("status").notNull(),
  campaignId: text("campaign_id"),
  projectionJson: text("projection_json").notNull(),
  resultJson: text("result_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const p0AccountLocks = sqliteTable("p0_account_locks", {
  accountKey: text("account_key").primaryKey(),
  executionId: text("execution_id").notNull(),
  ownerKey: text("owner_key").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const p0AgentRuns = sqliteTable("p0_agent_runs", {
  runId: text("run_id").primaryKey(),
  userKey: text("user_key").notNull(),
  version: integer("version").notNull().default(0),
  status: text("status").notNull(),
  stopReason: text("stop_reason"),
  applicationRevision: integer("application_revision").notNull(),
  authorityDigest: text("authority_digest").notNull(),
  priorOutcomesDigest: text("prior_outcomes_digest").notNull(),
  budgetJson: text("budget_json").notNull(),
  valueJson: text("value_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const p0AgentCheckpoints = sqliteTable("p0_agent_checkpoints", {
  runId: text("run_id").notNull(),
  sequence: integer("sequence").notNull(),
  kind: text("kind").notNull(),
  applicationRevision: integer("application_revision").notNull(),
  authorityDigest: text("authority_digest").notNull(),
  priorOutcomesDigest: text("prior_outcomes_digest").notNull(),
  observationCount: integer("observation_count").notNull(),
  budgetUsageJson: text("budget_usage_json").notNull(),
  recordedAt: text("recorded_at").notNull(),
}, (table) => [primaryKey({ columns: [table.runId, table.sequence] })]);

export const p0AgentObservations = sqliteTable("p0_agent_observations", {
  runId: text("run_id").notNull(),
  sequence: integer("sequence").notNull(),
  toolCallId: text("tool_call_id").notNull(),
  toolName: text("tool_name").notNull(),
  trust: text("trust").notNull(),
  summary: text("summary").notNull(),
  factsJson: text("facts_json").notNull(),
  sourceReferencesJson: text("source_references_json").notNull(),
  applicationRevision: integer("application_revision").notNull(),
  authorityDigest: text("authority_digest").notNull(),
  priorOutcomesDigest: text("prior_outcomes_digest").notNull(),
  observedAt: text("observed_at").notNull(),
}, (table) => [primaryKey({ columns: [table.runId, table.sequence] })]);

export const p0AgentBudgetEvents = sqliteTable("p0_agent_budget_events", {
  runId: text("run_id").notNull(),
  checkpointSequence: integer("checkpoint_sequence").notNull(),
  usageJson: text("usage_json").notNull(),
  remainingJson: text("remaining_json").notNull(),
  recordedAt: text("recorded_at").notNull(),
}, (table) => [primaryKey({ columns: [table.runId, table.checkpointSequence] })]);

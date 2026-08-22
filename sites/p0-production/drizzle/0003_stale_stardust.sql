CREATE TABLE `p0_agent_budget_events` (
	`run_id` text NOT NULL,
	`checkpoint_sequence` integer NOT NULL,
	`usage_json` text NOT NULL,
	`remaining_json` text NOT NULL,
	`recorded_at` text NOT NULL,
	PRIMARY KEY(`run_id`, `checkpoint_sequence`)
);
--> statement-breakpoint
CREATE TABLE `p0_agent_checkpoints` (
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`application_revision` integer NOT NULL,
	`authority_digest` text NOT NULL,
	`prior_outcomes_digest` text NOT NULL,
	`observation_count` integer NOT NULL,
	`budget_usage_json` text NOT NULL,
	`recorded_at` text NOT NULL,
	PRIMARY KEY(`run_id`, `sequence`)
);
--> statement-breakpoint
CREATE TABLE `p0_agent_observations` (
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`tool_call_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`trust` text NOT NULL,
	`summary` text NOT NULL,
	`facts_json` text NOT NULL,
	`source_references_json` text NOT NULL,
	`application_revision` integer NOT NULL,
	`authority_digest` text NOT NULL,
	`prior_outcomes_digest` text NOT NULL,
	`observed_at` text NOT NULL,
	PRIMARY KEY(`run_id`, `sequence`)
);
--> statement-breakpoint
CREATE TABLE `p0_agent_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`user_key` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`stop_reason` text,
	`application_revision` integer NOT NULL,
	`authority_digest` text NOT NULL,
	`prior_outcomes_digest` text NOT NULL,
	`budget_json` text NOT NULL,
	`value_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `p0_direct_audit_artifacts` (
	`artifact_id` text PRIMARY KEY NOT NULL,
	`audit_id` text NOT NULL,
	`owner_key` text NOT NULL,
	`account_key` text NOT NULL,
	`kind` text NOT NULL,
	`digest` text NOT NULL,
	`byte_length` integer NOT NULL,
	`object_count` integer NOT NULL,
	`value_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `p0_direct_audit_artifacts_audit_id_idx` ON `p0_direct_audit_artifacts` (`audit_id`);--> statement-breakpoint
CREATE TABLE `p0_direct_audits` (
	`owner_key` text NOT NULL,
	`account_key` text NOT NULL,
	`audit_id` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`next_retry_at` text,
	`state_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	PRIMARY KEY(`owner_key`, `account_key`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `p0_direct_audits_audit_id_unique` ON `p0_direct_audits` (`audit_id`);
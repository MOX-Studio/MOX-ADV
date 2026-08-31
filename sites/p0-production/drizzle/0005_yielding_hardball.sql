CREATE TABLE `p0_pipeline_run_revisions` (
	`run_id` text NOT NULL,
	`version` integer NOT NULL,
	`value_json` text NOT NULL,
	`recorded_at` text NOT NULL,
	PRIMARY KEY(`run_id`, `version`)
);
--> statement-breakpoint
CREATE TABLE `p0_pipeline_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`owner_key` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`current_stage` text NOT NULL,
	`input_versions_json` text NOT NULL,
	`input_versions_digest` text NOT NULL,
	`authority_json` text NOT NULL,
	`value_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `p0_pipeline_runs_one_active_owner` ON `p0_pipeline_runs` (`owner_key`) WHERE "p0_pipeline_runs"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX `p0_pipeline_runs_owner_created` ON `p0_pipeline_runs` (`owner_key`,`created_at`);
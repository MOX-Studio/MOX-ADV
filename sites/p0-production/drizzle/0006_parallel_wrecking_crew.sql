CREATE TABLE `p0_pipeline_audit_events` (
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`run_version` integer NOT NULL,
	`event_kind` text NOT NULL,
	`stage` text NOT NULL,
	`attempt` integer NOT NULL,
	`actor_id` text NOT NULL,
	`input_versions_digest` text NOT NULL,
	`previous_event_digest` text,
	`event_digest` text NOT NULL,
	`value_json` text NOT NULL,
	`recorded_at` text NOT NULL,
	PRIMARY KEY(`run_id`, `sequence`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `p0_pipeline_audit_events_event_digest_unique` ON `p0_pipeline_audit_events` (`event_digest`);--> statement-breakpoint
CREATE TRIGGER `p0_pipeline_audit_events_no_update`
BEFORE UPDATE ON `p0_pipeline_audit_events`
BEGIN
	SELECT RAISE(ABORT, 'pipeline audit events are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `p0_pipeline_audit_events_no_delete`
BEFORE DELETE ON `p0_pipeline_audit_events`
BEGIN
	SELECT RAISE(ABORT, 'pipeline audit events are immutable');
END;
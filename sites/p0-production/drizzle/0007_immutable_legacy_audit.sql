CREATE TABLE `p0_pipeline_legacy_audit` (
	`owner_key` text NOT NULL,
	`revision` integer NOT NULL,
	`audit_schema` text NOT NULL,
	`source_schema` text NOT NULL,
	`source_updated_at` text NOT NULL,
	`source_digest` text NOT NULL,
	`value_json` text NOT NULL,
	`archived_at` text NOT NULL,
	PRIMARY KEY(`owner_key`, `revision`)
);
--> statement-breakpoint
CREATE TRIGGER `p0_pipeline_legacy_audit_no_update`
BEFORE UPDATE ON `p0_pipeline_legacy_audit`
BEGIN
	SELECT RAISE(ABORT, 'pipeline legacy audit is immutable');
END;--> statement-breakpoint
CREATE TRIGGER `p0_pipeline_legacy_audit_no_delete`
BEFORE DELETE ON `p0_pipeline_legacy_audit`
BEGIN
	SELECT RAISE(ABORT, 'pipeline legacy audit is immutable');
END;

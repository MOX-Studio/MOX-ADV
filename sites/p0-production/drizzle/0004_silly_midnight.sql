CREATE TABLE `p0_direct_audit_snapshots` (
	`snapshot_id` text PRIMARY KEY NOT NULL,
	`audit_id` text NOT NULL,
	`audit_version` integer NOT NULL,
	`owner_key` text NOT NULL,
	`account_key` text NOT NULL,
	`client_id` text NOT NULL,
	`capability_snapshot_id` text NOT NULL,
	`capability_fingerprint` text NOT NULL,
	`value_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `p0_direct_audit_snapshots_audit_id_unique` ON `p0_direct_audit_snapshots` (`audit_id`);--> statement-breakpoint
CREATE INDEX `p0_direct_audit_snapshots_owner_account_idx` ON `p0_direct_audit_snapshots` (`owner_key`,`account_key`);
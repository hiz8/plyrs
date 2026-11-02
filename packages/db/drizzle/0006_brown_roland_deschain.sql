CREATE TABLE `record_history` (
	`record_id` text NOT NULL,
	`history_seq` integer NOT NULL,
	`kind` text NOT NULL,
	`version` integer NOT NULL,
	`source_version` integer,
	`status` text NOT NULL,
	`data` text,
	`diff` text,
	`field_versions` text NOT NULL,
	`changed_fields` text DEFAULT '[]' NOT NULL,
	`actor` text NOT NULL,
	`via` text NOT NULL,
	`token_id` text,
	`client_id` text,
	`restored_from` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`record_id`, `history_seq`)
);
--> statement-breakpoint
CREATE INDEX `idx_record_history_kind` ON `record_history` (`record_id`,`kind`);
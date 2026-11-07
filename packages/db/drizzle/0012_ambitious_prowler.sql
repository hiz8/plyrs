CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`type` text NOT NULL,
	`kind` text NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`input` text,
	`changed_fields` text DEFAULT '[]' NOT NULL,
	`request_digest` text DEFAULT '' NOT NULL,
	`status` text,
	`base_version` integer NOT NULL,
	`note` text,
	`actor` text NOT NULL,
	`via` text NOT NULL,
	`token_id` text,
	`client_id` text,
	`created_at` text NOT NULL,
	`resolved_at` text,
	`resolved_by` text,
	`resolution_note` text,
	`result_history_seq` integer
);
--> statement-breakpoint
CREATE INDEX `idx_proposals_state` ON `proposals` (`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_proposals_record` ON `proposals` (`record_id`,`state`);--> statement-breakpoint
ALTER TABLE `record_history` ADD `proposal_id` text;
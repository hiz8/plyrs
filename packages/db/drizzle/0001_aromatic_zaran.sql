CREATE TABLE `alarm_registry` (
	`kind` text PRIMARY KEY NOT NULL,
	`due_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `do_config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`job_type` text NOT NULL,
	`record_id` text NOT NULL,
	`source_version` integer NOT NULL,
	`enqueued_at` text NOT NULL,
	`sent` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_outbox_unsent` ON `outbox` (`sent`,`enqueued_at`);--> statement-breakpoint
CREATE TABLE `published_snapshots` (
	`record_id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`relations` text NOT NULL,
	`published_at` text NOT NULL,
	`published_by` text NOT NULL,
	`source_version` integer NOT NULL
);

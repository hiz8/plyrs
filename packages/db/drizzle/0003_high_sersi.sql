CREATE TABLE `module_events` (
	`id` text PRIMARY KEY NOT NULL,
	`module_id` text NOT NULL,
	`event` text NOT NULL,
	`record_id` text NOT NULL,
	`type` text NOT NULL,
	`enqueued_at` text NOT NULL,
	`sent` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_module_events_unsent` ON `module_events` (`sent`,`enqueued_at`);--> statement-breakpoint
CREATE TABLE `module_registry` (
	`module_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`applied_version` integer DEFAULT 0 NOT NULL,
	`permissions` text DEFAULT '{}' NOT NULL,
	`updated_at` text NOT NULL
);

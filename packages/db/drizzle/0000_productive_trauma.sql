CREATE TABLE `content_types` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`fields` text NOT NULL,
	`source` text DEFAULT 'user' NOT NULL,
	`plugin_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_content_types_key` ON `content_types` (`key`);--> statement-breakpoint
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`field_versions` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`seq` integer NOT NULL,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_records_type` ON `records` (`type`);--> statement-breakpoint
CREATE INDEX `idx_records_type_status` ON `records` (`type`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_records_seq` ON `records` (`seq`);--> statement-breakpoint
CREATE TABLE `relations` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`source_field` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`ordinal` integer DEFAULT 0 NOT NULL,
	`origin` text DEFAULT 'field' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_relations_source` ON `relations` (`source_id`,`source_field`);--> statement-breakpoint
CREATE INDEX `idx_relations_target` ON `relations` (`target_id`);--> statement-breakpoint
CREATE INDEX `idx_relations_target_type` ON `relations` (`target_type`,`target_id`);
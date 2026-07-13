CREATE TABLE `projected_records` (
	`tenant_id` text NOT NULL,
	`record_id` text NOT NULL,
	`type` text NOT NULL,
	`slug` text,
	`published_at` text NOT NULL,
	`data` text NOT NULL,
	`source_version` integer NOT NULL,
	`projected_at` integer NOT NULL,
	PRIMARY KEY(`tenant_id`, `record_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_projected_records_type_published` ON `projected_records` (`tenant_id`,`type`,`published_at`);--> statement-breakpoint
CREATE INDEX `idx_projected_records_type_slug` ON `projected_records` (`tenant_id`,`type`,`slug`);--> statement-breakpoint
CREATE INDEX `idx_projected_records_sweep` ON `projected_records` (`tenant_id`,`projected_at`);--> statement-breakpoint
CREATE TABLE `projected_relations` (
	`tenant_id` text NOT NULL,
	`source_id` text NOT NULL,
	`source_field` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`ordinal` integer DEFAULT 0 NOT NULL,
	`origin` text DEFAULT 'field' NOT NULL,
	PRIMARY KEY(`tenant_id`, `source_id`, `source_field`, `origin`, `ordinal`)
);
--> statement-breakpoint
CREATE INDEX `idx_projected_relations_target` ON `projected_relations` (`tenant_id`,`target_id`);--> statement-breakpoint
CREATE INDEX `idx_projected_relations_target_type` ON `projected_relations` (`tenant_id`,`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `projection_index` (
	`tenant_id` text NOT NULL,
	`type` text NOT NULL,
	`field_key` text NOT NULL,
	`value_text` text,
	`value_num` real,
	`value_date` text,
	`record_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_projection_index_text` ON `projection_index` (`tenant_id`,`type`,`field_key`,`value_text`);--> statement-breakpoint
CREATE INDEX `idx_projection_index_num` ON `projection_index` (`tenant_id`,`type`,`field_key`,`value_num`);--> statement-breakpoint
CREATE INDEX `idx_projection_index_date` ON `projection_index` (`tenant_id`,`type`,`field_key`,`value_date`);--> statement-breakpoint
CREATE INDEX `idx_projection_index_record` ON `projection_index` (`tenant_id`,`record_id`);
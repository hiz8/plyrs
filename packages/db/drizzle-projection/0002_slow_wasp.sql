CREATE TABLE `projection_tombstones` (
	`tenant_id` text NOT NULL,
	`record_id` text NOT NULL,
	`publish_seq` integer NOT NULL,
	`tombstoned_at` integer NOT NULL,
	PRIMARY KEY(`tenant_id`, `record_id`)
);

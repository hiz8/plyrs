CREATE TABLE `projection_fields` (
	`tenant_id` text NOT NULL,
	`type` text NOT NULL,
	`field_key` text NOT NULL,
	`kind` text NOT NULL,
	`multi` integer DEFAULT 0 NOT NULL,
	`projected_at` integer NOT NULL,
	PRIMARY KEY(`tenant_id`, `type`, `field_key`)
);

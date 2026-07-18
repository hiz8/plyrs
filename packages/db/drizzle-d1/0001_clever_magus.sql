CREATE TABLE `tenant_modules` (
	`tenant_id` text NOT NULL,
	`module_id` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `module_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_tenant_modules_module` ON `tenant_modules` (`module_id`,`enabled`);
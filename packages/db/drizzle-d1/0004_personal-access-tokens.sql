CREATE TABLE `personal_access_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`scopes` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pat_token_hash` ON `personal_access_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_pat_user_tenant` ON `personal_access_tokens` (`user_id`,`tenant_id`);
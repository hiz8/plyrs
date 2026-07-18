CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_logs_created` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_target` ON `audit_logs` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `dead_letters` (
	`id` text PRIMARY KEY NOT NULL,
	`queue` text NOT NULL,
	`body` text NOT NULL,
	`failed_at` text NOT NULL,
	`replayed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_dead_letters_queue` ON `dead_letters` (`queue`,`failed_at`);--> statement-breakpoint
CREATE TABLE `super_admins` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`totp_secret` text NOT NULL,
	`totp_last_counter` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_super_admins_email` ON `super_admins` (`email`);--> statement-breakpoint
CREATE TABLE `super_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`admin_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_super_sessions_token_hash` ON `super_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_super_sessions_admin` ON `super_sessions` (`admin_id`);
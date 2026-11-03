CREATE TABLE `asset_upload_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`token_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_asset_upload_tokens_expires` ON `asset_upload_tokens` (`expires_at`);
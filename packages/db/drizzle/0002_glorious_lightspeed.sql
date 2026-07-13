ALTER TABLE `outbox` ADD `publish_seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `published_snapshots` ADD `publish_seq` integer DEFAULT 0 NOT NULL;
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_players` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_key` text NOT NULL,
	`name` text NOT NULL,
	`play_style` text DEFAULT 'unknown' NOT NULL,
	`bluff_level` integer DEFAULT 0 NOT NULL,
	`preflop_tags` text DEFAULT '[]' NOT NULL,
	`postflop_tags` text DEFAULT '[]' NOT NULL,
	`preflop_notes` text DEFAULT '' NOT NULL,
	`postflop_notes` text DEFAULT '' NOT NULL,
	`tells_notes` text DEFAULT '' NOT NULL,
	`showdown_notes` text DEFAULT '' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_players`("id", "owner_key", "name", "play_style", "bluff_level", "preflop_tags", "postflop_tags", "preflop_notes", "postflop_notes", "tells_notes", "showdown_notes", "archived", "created_at", "updated_at") SELECT "id", "owner_key", "name", "play_style", "bluff_level", "preflop_tags", "postflop_tags", "preflop_notes", "postflop_notes", "tells_notes", "showdown_notes", "archived", "created_at", "updated_at" FROM `players`;--> statement-breakpoint
UPDATE `__new_players` SET `bluff_level` = 0 WHERE `bluff_level` = 2;--> statement-breakpoint
DROP TABLE `players`;--> statement-breakpoint
ALTER TABLE `__new_players` RENAME TO `players`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `players_owner_idx` ON `players` (`owner_key`);--> statement-breakpoint
CREATE INDEX `players_owner_updated_idx` ON `players` (`owner_key`,`updated_at`);

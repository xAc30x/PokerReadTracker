CREATE TABLE `observations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_key` text NOT NULL,
	`player_id` text NOT NULL,
	`phase` text NOT NULL,
	`action` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `observations_owner_player_idx` ON `observations` (`owner_key`,`player_id`);--> statement-breakpoint
CREATE INDEX `observations_owner_created_idx` ON `observations` (`owner_key`,`created_at`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_key` text NOT NULL,
	`name` text NOT NULL,
	`play_style` text DEFAULT 'unknown' NOT NULL,
	`bluff_level` integer DEFAULT 2 NOT NULL,
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
CREATE INDEX `players_owner_idx` ON `players` (`owner_key`);--> statement-breakpoint
CREATE INDEX `players_owner_updated_idx` ON `players` (`owner_key`,`updated_at`);--> statement-breakpoint
CREATE TABLE `seats` (
	`owner_key` text NOT NULL,
	`seat_no` integer NOT NULL,
	`player_id` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`owner_key`, `seat_no`),
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seats_owner_player_idx` ON `seats` (`owner_key`,`player_id`);
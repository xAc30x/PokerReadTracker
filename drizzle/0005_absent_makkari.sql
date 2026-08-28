CREATE TABLE `game_results` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_key` text NOT NULL,
	`category` text NOT NULL,
	`played_at` text NOT NULL,
	`name` text NOT NULL,
	`venue` text DEFAULT '' NOT NULL,
	`stakes` text DEFAULT '' NOT NULL,
	`buy_in_cents` integer DEFAULT 0 NOT NULL,
	`cash_out_cents` integer DEFAULT 0 NOT NULL,
	`winnings_cents` integer DEFAULT 0 NOT NULL,
	`duration_minutes` integer DEFAULT 0 NOT NULL,
	`finishing_place` integer,
	`field_size` integer,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `game_results_owner_category_date_idx` ON `game_results` (`owner_key`,`category`,`played_at`);
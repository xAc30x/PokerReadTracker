CREATE TABLE `table_state` (
	`owner_key` text PRIMARY KEY NOT NULL,
	`position_offset` integer DEFAULT 0 NOT NULL,
	`hand_number` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE `observations` ADD `hand_id` text DEFAULT '' NOT NULL;
ALTER TABLE `observations` ADD `hand_number` integer DEFAULT 0 NOT NULL;
ALTER TABLE `observations` ADD `seat_no` integer;
ALTER TABLE `observations` ADD `position` text DEFAULT '' NOT NULL;
ALTER TABLE `observations` ADD `sequence` integer DEFAULT 0 NOT NULL;
ALTER TABLE `observations` ADD `preflop_context` text DEFAULT '' NOT NULL;
ALTER TABLE `table_state` ADD `current_hand_id` text DEFAULT '' NOT NULL;
CREATE INDEX `observations_owner_hand_idx` ON `observations` (`owner_key`,`hand_id`,`sequence`);

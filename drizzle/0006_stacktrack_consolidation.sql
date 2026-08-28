ALTER TABLE `game_results` ADD `rake_cents` integer DEFAULT 0 NOT NULL;
ALTER TABLE `game_results` ADD `prize_pool_cents` integer DEFAULT 0 NOT NULL;
ALTER TABLE `game_results` ADD `poker_format` text DEFAULT 'NL Hold''em' NOT NULL;

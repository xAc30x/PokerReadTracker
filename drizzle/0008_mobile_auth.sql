CREATE TABLE IF NOT EXISTS `mobile_pairing_codes` (
  `code_hash` text PRIMARY KEY NOT NULL,
  `owner_key` text NOT NULL,
  `expires_at` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `mobile_pairing_owner_idx` ON `mobile_pairing_codes` (`owner_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `mobile_pairing_expiry_idx` ON `mobile_pairing_codes` (`expires_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mobile_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_key` text NOT NULL,
  `token_hash` text NOT NULL,
  `device_name` text NOT NULL DEFAULT 'iPhone',
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_used_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `mobile_sessions_token_idx` ON `mobile_sessions` (`token_hash`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `mobile_sessions_owner_idx` ON `mobile_sessions` (`owner_key`, `revoked_at`);

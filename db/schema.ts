import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const players = sqliteTable(
  "players",
  {
    id: text("id").primaryKey(),
    ownerKey: text("owner_key").notNull(),
    name: text("name").notNull(),
    playStyle: text("play_style").notNull().default("unknown"),
    bluffLevel: integer("bluff_level").notNull().default(0),
    preflopTags: text("preflop_tags").notNull().default("[]"),
    postflopTags: text("postflop_tags").notNull().default("[]"),
    preflopNotes: text("preflop_notes").notNull().default(""),
    postflopNotes: text("postflop_notes").notNull().default(""),
    tellsNotes: text("tells_notes").notNull().default(""),
    showdownNotes: text("showdown_notes").notNull().default(""),
    archived: integer("archived", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("players_owner_idx").on(table.ownerKey),
    index("players_owner_updated_idx").on(table.ownerKey, table.updatedAt),
  ],
);

export const seats = sqliteTable(
  "seats",
  {
    ownerKey: text("owner_key").notNull(),
    seatNo: integer("seat_no").notNull(),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    primaryKey({ columns: [table.ownerKey, table.seatNo] }),
    uniqueIndex("seats_owner_player_idx").on(table.ownerKey, table.playerId),
  ],
);

export const observations = sqliteTable(
  "observations",
  {
    id: text("id").primaryKey(),
    ownerKey: text("owner_key").notNull(),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    phase: text("phase").notNull(),
    action: text("action").notNull(),
    handId: text("hand_id").notNull().default(""),
    handNumber: integer("hand_number").notNull().default(0),
    seatNo: integer("seat_no"),
    position: text("position").notNull().default(""),
    sequence: integer("sequence").notNull().default(0),
    preflopContext: text("preflop_context").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("observations_owner_player_idx").on(
      table.ownerKey,
      table.playerId,
    ),
    index("observations_owner_created_idx").on(
      table.ownerKey,
      table.createdAt,
    ),
    index("observations_owner_hand_idx").on(
      table.ownerKey,
      table.handId,
      table.sequence,
    ),
  ],
);

export const tableState = sqliteTable("table_state", {
  ownerKey: text("owner_key").primaryKey(),
  positionOffset: integer("position_offset").notNull().default(0),
  handNumber: integer("hand_number").notNull().default(1),
  tableSize: integer("table_size").notNull().default(6),
  currentHandId: text("current_hand_id").notNull().default(""),
  lastAdvanceId: text("last_advance_id").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const gameResults = sqliteTable(
  "game_results",
  {
    id: text("id").primaryKey(),
    ownerKey: text("owner_key").notNull(),
    category: text("category").notNull(),
    playedAt: text("played_at").notNull(),
    name: text("name").notNull(),
    venue: text("venue").notNull().default(""),
    stakes: text("stakes").notNull().default(""),
    buyInCents: integer("buy_in_cents").notNull().default(0),
    cashOutCents: integer("cash_out_cents").notNull().default(0),
    winningsCents: integer("winnings_cents").notNull().default(0),
    rakeCents: integer("rake_cents").notNull().default(0),
    prizePoolCents: integer("prize_pool_cents").notNull().default(0),
    pokerFormat: text("poker_format").notNull().default("NL Hold'em"),
    durationMinutes: integer("duration_minutes").notNull().default(0),
    finishingPlace: integer("finishing_place"),
    fieldSize: integer("field_size"),
    notes: text("notes").notNull().default(""),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("game_results_owner_category_date_idx").on(
      table.ownerKey,
      table.category,
      table.playedAt,
    ),
  ],
);

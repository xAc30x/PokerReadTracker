import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getD1, getDb } from "@/db";
import { observations, players, seats, tableState } from "@/db/schema";
import {
  PLAY_STYLES,
  type PlayerPatch,
  type TrackerMutation,
} from "@/app/tracker-types";

export const dynamic = "force-dynamic";

const OWNER_HEADER = "oai-authenticated-user-email";
const VALID_PHASES = new Set(["preflop", "postflop", "showdown"]);
const VALID_ACTIONS = new Set([
  "fold",
  "limp-call",
  "raise",
  "three-bet",
  "check",
  "call",
  "bet",
  "postflop-raise",
  "postflop-fold",
  "bluff-shown",
  "value-shown",
]);

type CountRow = {
  player_id: string;
  phase: string;
  action: string;
  count: number;
};

function getOwner(request: Request): string | null {
  const owner = request.headers.get(OWNER_HEADER)?.trim().toLowerCase();
  if (owner) return owner;

  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "terminal.local"
    ? "local-preview"
    : null;
}

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,64}$/.test(value);
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  return value.trim().slice(0, max);
}

function cleanTags(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 40))
        .filter(Boolean),
    ),
  ).slice(0, 12);
}

function cleanPatch(input: unknown): PlayerPatch {
  if (!input || typeof input !== "object") return {};
  const source = input as Record<string, unknown>;
  const patch: PlayerPatch = {};

  if ("name" in source) {
    const name = cleanText(source.name, 80);
    if (name) patch.name = name;
  }
  if (
    typeof source.playStyle === "string" &&
    PLAY_STYLES.includes(source.playStyle as (typeof PLAY_STYLES)[number])
  ) {
    patch.playStyle = source.playStyle as (typeof PLAY_STYLES)[number];
  }
  if (typeof source.bluffLevel === "number" && Number.isFinite(source.bluffLevel)) {
    patch.bluffLevel = Math.max(0, Math.min(4, Math.round(source.bluffLevel)));
  }

  for (const key of [
    "preflopNotes",
    "postflopNotes",
    "tellsNotes",
    "showdownNotes",
  ] as const) {
    if (key in source) {
      const value = cleanText(source[key], 2000);
      if (value !== null) patch[key] = value;
    }
  }

  for (const key of ["preflopTags", "postflopTags"] as const) {
    if (key in source) {
      const value = cleanTags(source[key]);
      if (value) patch[key] = value;
    }
  }

  return patch;
}

function parseTags(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

async function getState(ownerKey: string) {
  const db = getDb();
  const [playerRows, seatRows, aggregate, tableRows] = await Promise.all([
    db
      .select()
      .from(players)
      .where(and(eq(players.ownerKey, ownerKey), eq(players.archived, false)))
      .orderBy(desc(players.updatedAt), asc(players.name)),
    db
      .select({ seatNo: seats.seatNo, playerId: seats.playerId })
      .from(seats)
      .where(eq(seats.ownerKey, ownerKey))
      .orderBy(asc(seats.seatNo)),
    getD1()
      .prepare(
        `SELECT player_id, phase, action, COUNT(*) AS count
         FROM observations
         WHERE owner_key = ?
         GROUP BY player_id, phase, action`,
      )
      .bind(ownerKey)
      .all<CountRow>(),
    db
      .select({
        positionOffset: tableState.positionOffset,
        handNumber: tableState.handNumber,
        tableSize: tableState.tableSize,
      })
      .from(tableState)
      .where(eq(tableState.ownerKey, ownerKey))
      .limit(1),
  ]);

  const counts: Record<string, Record<string, Record<string, number>>> = {};
  for (const row of aggregate.results ?? []) {
    counts[row.player_id] ??= {};
    counts[row.player_id][row.phase] ??= {};
    counts[row.player_id][row.phase][row.action] = Number(row.count);
  }

  return {
    players: playerRows.map(({ ownerKey: _owner, archived: _archived, ...player }) => ({
      ...player,
      preflopTags: parseTags(player.preflopTags),
      postflopTags: parseTags(player.postflopTags),
    })),
    seats: seatRows,
    counts,
    table: tableRows[0] ?? { positionOffset: 0, handNumber: 1, tableSize: 6 },
  };
}

async function assignSeat(ownerKey: string, seatNo: number, playerId: string | null) {
  if (!Number.isInteger(seatNo) || seatNo < 1 || seatNo > 8) {
    throw new Error("Seat must be between 1 and 8.");
  }

  const currentTable = await getDb()
    .select({ tableSize: tableState.tableSize })
    .from(tableState)
    .where(eq(tableState.ownerKey, ownerKey))
    .limit(1);
  const tableSize = currentTable[0]?.tableSize === 8 ? 8 : 6;
  if (seatNo > tableSize) throw new Error(`Seat ${seatNo} is not available at a ${tableSize}-player table.`);

  const d1 = getD1();
  const statements = [
    d1.prepare("DELETE FROM seats WHERE owner_key = ? AND seat_no = ?").bind(
      ownerKey,
      seatNo,
    ),
  ];

  if (playerId) {
    if (!isSafeId(playerId)) throw new Error("Invalid player id.");
    statements.unshift(
      d1.prepare("DELETE FROM seats WHERE owner_key = ? AND player_id = ?").bind(
        ownerKey,
        playerId,
      ),
    );
    statements.push(
      d1
        .prepare(
          `INSERT INTO seats (owner_key, seat_no, player_id, updated_at)
           SELECT ?, ?, id, CURRENT_TIMESTAMP
           FROM players
           WHERE id = ? AND owner_key = ? AND archived = 0`,
        )
        .bind(ownerKey, seatNo, playerId, ownerKey),
    );
  }

  await d1.batch(statements);
}

export async function GET(request: Request) {
  const owner = getOwner(request);
  if (!owner) return jsonError("Sign in is required.", 401);

  try {
    return Response.json(await getState(owner));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load tracker.";
    return jsonError(message, 500);
  }
}

export async function POST(request: Request) {
  const owner = getOwner(request);
  if (!owner) return jsonError("Sign in is required.", 401);

  let mutation: TrackerMutation;
  try {
    mutation = (await request.json()) as TrackerMutation;
  } catch {
    return jsonError("Invalid JSON body.");
  }

  try {
    const db = getDb();

    switch (mutation.type) {
      case "createPlayer": {
        if (!isSafeId(mutation.id)) return jsonError("Invalid player id.");
        const name = cleanText(mutation.name, 80);
        if (!name) return jsonError("Player name is required.");

        await getD1()
          .prepare(
            `INSERT OR IGNORE INTO players
             (id, owner_key, name, play_style, bluff_level, preflop_tags,
              postflop_tags, preflop_notes, postflop_notes, tells_notes,
              showdown_notes, archived, created_at, updated_at)
             VALUES (?, ?, ?, 'unknown', 0, '[]', '[]', '', '', '', '', 0,
                     CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          )
          .bind(mutation.id, owner, name)
          .run();
        if (mutation.seatNo !== null) {
          await assignSeat(owner, mutation.seatNo, mutation.id);
        }
        break;
      }

      case "updatePlayer": {
        if (!isSafeId(mutation.playerId)) return jsonError("Invalid player id.");
        const patch = cleanPatch(mutation.patch);
        if (Object.keys(patch).length === 0) return jsonError("No valid changes supplied.");
        const databasePatch: Record<string, unknown> = {
          ...patch,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        };
        if (patch.preflopTags) databasePatch.preflopTags = JSON.stringify(patch.preflopTags);
        if (patch.postflopTags) databasePatch.postflopTags = JSON.stringify(patch.postflopTags);
        await db
          .update(players)
          .set(databasePatch)
          .where(and(eq(players.id, mutation.playerId), eq(players.ownerKey, owner)));
        break;
      }

      case "assignSeat":
        await assignSeat(owner, mutation.seatNo, mutation.playerId);
        break;

      case "setTableSize": {
        if (mutation.tableSize !== 6 && mutation.tableSize !== 8) {
          return jsonError("Table size must be 6 or 8.");
        }
        const d1 = getD1();
        await d1.batch([
          d1
            .prepare("DELETE FROM seats WHERE owner_key = ? AND seat_no > ?")
            .bind(owner, mutation.tableSize),
          d1
            .prepare(
              `INSERT INTO table_state
               (owner_key, position_offset, hand_number, table_size, last_advance_id, updated_at)
               VALUES (?, 0, 1, ?, '', CURRENT_TIMESTAMP)
               ON CONFLICT(owner_key) DO UPDATE SET
                 position_offset = 0,
                 table_size = excluded.table_size,
                 last_advance_id = '',
                 updated_at = CURRENT_TIMESTAMP`,
            )
            .bind(owner, mutation.tableSize),
        ]);
        break;
      }

      case "advanceHand":
        if (!isSafeId(mutation.id)) return jsonError("Invalid hand id.");
        await getD1()
          .prepare(
            `INSERT INTO table_state
             (owner_key, position_offset, hand_number, table_size, last_advance_id, updated_at)
             VALUES (?, 1, 2, 6, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(owner_key) DO UPDATE SET
               position_offset = CASE
                 WHEN last_advance_id <> excluded.last_advance_id
                 THEN (position_offset + 1) % table_size
                 ELSE position_offset
               END,
               hand_number = CASE
                 WHEN last_advance_id <> excluded.last_advance_id
                 THEN hand_number + 1
                 ELSE hand_number
               END,
               last_advance_id = excluded.last_advance_id,
               updated_at = CURRENT_TIMESTAMP`,
          )
          .bind(owner, mutation.id)
          .run();
        break;

      case "clearSeats": {
        const d1 = getD1();
        await d1.batch([
          d1.prepare("DELETE FROM seats WHERE owner_key = ?").bind(owner),
          d1
            .prepare(
              `INSERT INTO table_state
               (owner_key, position_offset, hand_number, last_advance_id, updated_at)
               VALUES (?, 0, 1, '', CURRENT_TIMESTAMP)
               ON CONFLICT(owner_key) DO UPDATE SET
                 position_offset = 0,
                 hand_number = 1,
                 last_advance_id = '',
                 updated_at = CURRENT_TIMESTAMP`,
            )
            .bind(owner),
        ]);
        break;
      }

      case "addObservation": {
        if (!isSafeId(mutation.id) || !isSafeId(mutation.playerId)) {
          return jsonError("Invalid observation.");
        }
        if (!VALID_PHASES.has(mutation.phase) || !VALID_ACTIONS.has(mutation.action)) {
          return jsonError("Unknown observation type.");
        }
        await getD1()
          .prepare(
            `INSERT OR IGNORE INTO observations
             (id, owner_key, player_id, phase, action, created_at)
             SELECT ?, ?, id, ?, ?, CURRENT_TIMESTAMP
             FROM players
             WHERE id = ? AND owner_key = ? AND archived = 0`,
          )
          .bind(
            mutation.id,
            owner,
            mutation.phase,
            mutation.action,
            mutation.playerId,
            owner,
          )
          .run();
        break;
      }

      case "undoObservation":
        if (!isSafeId(mutation.observationId)) return jsonError("Invalid observation id.");
        await db
          .delete(observations)
          .where(
            and(
              eq(observations.id, mutation.observationId),
              eq(observations.ownerKey, owner),
            ),
          );
        break;

      case "archivePlayer":
        if (!isSafeId(mutation.playerId)) return jsonError("Invalid player id.");
        await getD1().batch([
          getD1()
            .prepare("DELETE FROM seats WHERE owner_key = ? AND player_id = ?")
            .bind(owner, mutation.playerId),
          getD1()
            .prepare(
              "UPDATE players SET archived = 1, updated_at = CURRENT_TIMESTAMP WHERE owner_key = ? AND id = ?",
            )
            .bind(owner, mutation.playerId),
        ]);
        break;

      default:
        return jsonError("Unknown mutation.");
    }

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save change.";
    return jsonError(message, 500);
  }
}

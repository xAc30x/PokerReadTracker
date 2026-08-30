import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getD1, getDb } from "@/db";
import { observations, players, seats, tableState } from "@/db/schema";
import {
  PLAY_STYLES,
  type PlayerHudStats,
  type PlayerPatch,
  type PreflopContext,
  type RecentHand,
  type RecentObservation,
  type TrackerMutation,
} from "@/app/tracker-types";

export const dynamic = "force-dynamic";

const OWNER_HEADER = "oai-authenticated-user-email";
const VALID_PHASES = new Set(["preflop", "postflop", "showdown"]);
const VALID_PREFLOP_CONTEXTS = new Set<PreflopContext>(["unopened", "facing-raise"]);
const VALID_ACTIONS = new Set([
  "fold",
  "limp",
  "call",
  "open-raise",
  "three-bet",
  "four-bet-plus",
  "all-in",
  "squeeze",
  "cold-call",
  "check",
  "bet",
  "postflop-raise",
  "postflop-fold",
  "check-raise",
  "donk-bet",
  "postflop-all-in",
  "bluff-shown",
  "value-shown",
  "draw-shown",
  "slowplay-shown",
  "hero-call-shown",
  "mucked-unknown",
  // Keep legacy action ids valid so queued/offline observations from older builds still sync.
  "limp-call",
  "raise",
]);
const PREFLOP_AGGRESSION = new Set([
  "open-raise",
  "raise",
  "three-bet",
  "four-bet-plus",
  "all-in",
  "squeeze",
]);
const POSITION_ORDERS: Record<6 | 8, readonly string[]> = {
  6: ["BB", "UTG", "HJ", "CO", "BTN", "SB"],
  8: ["BB", "UTG", "UTG+1", "MP", "HJ", "CO", "BTN", "SB"],
};

type CountRow = {
  player_id: string;
  phase: string;
  action: string;
  count: number;
};

type HudStatRow = {
  player_id: string;
  sample_hands: number;
  vpip_hands: number;
  pfr_hands: number;
  three_bet_hands: number;
  three_bet_opportunities: number;
};

type RecentRow = {
  id: string;
  player_id: string;
  player_name: string;
  phase: string;
  action: string;
  hand_id: string;
  hand_number: number;
  seat_no: number | null;
  position: string;
  sequence: number;
  preflop_context: string;
  created_at: string;
};

type CurrentTableRow = {
  positionOffset: number;
  handNumber: number;
  tableSize: number;
  currentHandId: string;
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

function percentage(numerator: number, denominator: number, precision = 0) {
  if (denominator <= 0) return null;
  const factor = 10 ** precision;
  return Math.round((numerator / denominator) * 100 * factor) / factor;
}

function positionForSeat(seatNo: number, positionOffset: number, tableSizeValue: number) {
  const tableSize: 6 | 8 = tableSizeValue === 8 ? 8 : 6;
  const normalizedOffset = ((positionOffset % tableSize) + tableSize) % tableSize;
  const positionIndex = (seatNo - 1 - normalizedOffset + tableSize) % tableSize;
  return POSITION_ORDERS[tableSize][positionIndex] ?? "";
}

async function ensureCurrentHand(ownerKey: string) {
  const current = await getDb()
    .select({ currentHandId: tableState.currentHandId })
    .from(tableState)
    .where(eq(tableState.ownerKey, ownerKey))
    .limit(1);

  if (current[0]?.currentHandId) return;

  const handId = crypto.randomUUID();
  await getD1()
    .prepare(
      `INSERT INTO table_state
       (owner_key, position_offset, hand_number, table_size, current_hand_id, last_advance_id, updated_at)
       VALUES (?, 0, 1, 6, ?, '', CURRENT_TIMESTAMP)
       ON CONFLICT(owner_key) DO UPDATE SET
         current_hand_id = CASE
           WHEN current_hand_id = '' THEN excluded.current_hand_id
           ELSE current_hand_id
         END,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(ownerKey, handId)
    .run();
}

async function getCurrentTable(ownerKey: string): Promise<CurrentTableRow> {
  await ensureCurrentHand(ownerKey);
  const rows = await getDb()
    .select({
      positionOffset: tableState.positionOffset,
      handNumber: tableState.handNumber,
      tableSize: tableState.tableSize,
      currentHandId: tableState.currentHandId,
    })
    .from(tableState)
    .where(eq(tableState.ownerKey, ownerKey))
    .limit(1);

  return rows[0] ?? {
    positionOffset: 0,
    handNumber: 1,
    tableSize: 6,
    currentHandId: crypto.randomUUID(),
  };
}

function buildRecentHands(rows: RecentRow[]): RecentHand[] {
  const groups = new Map<string, RecentHand>();

  for (const row of rows) {
    if (!row.hand_id || !VALID_PHASES.has(row.phase)) continue;
    const observation: RecentObservation = {
      id: row.id,
      playerId: row.player_id,
      playerName: row.player_name,
      phase: row.phase as RecentObservation["phase"],
      action: row.action,
      handId: row.hand_id,
      handNumber: Number(row.hand_number),
      seatNo: row.seat_no === null ? null : Number(row.seat_no),
      position: row.position,
      sequence: Number(row.sequence),
      preflopContext: VALID_PREFLOP_CONTEXTS.has(row.preflop_context as PreflopContext)
        ? (row.preflop_context as PreflopContext)
        : null,
      createdAt: row.created_at,
    };

    const existing = groups.get(row.hand_id);
    if (existing) {
      existing.observations.push(observation);
      if (row.created_at > existing.createdAt) existing.createdAt = row.created_at;
      continue;
    }

    if (groups.size >= 12) continue;
    groups.set(row.hand_id, {
      id: row.hand_id,
      handNumber: Number(row.hand_number),
      createdAt: row.created_at,
      observations: [observation],
    });
  }

  return Array.from(groups.values()).map((hand) => ({
    ...hand,
    observations: hand.observations.sort(
      (a, b) => a.sequence - b.sequence || a.createdAt.localeCompare(b.createdAt),
    ),
  }));
}

async function getState(ownerKey: string) {
  await ensureCurrentHand(ownerKey);
  const db = getDb();
  const d1 = getD1();
  const [playerRows, seatRows, aggregate, statsResult, recentResult, tableRows] = await Promise.all([
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
    d1
      .prepare(
        `SELECT player_id, phase, action, COUNT(*) AS count
         FROM observations
         WHERE owner_key = ?
         GROUP BY player_id, phase, action`,
      )
      .bind(ownerKey)
      .all<CountRow>(),
    d1
      .prepare(
        `SELECT
           player_id,
           COUNT(DISTINCT CASE
             WHEN phase = 'preflop' AND hand_id <> '' THEN hand_id END
           ) AS sample_hands,
           COUNT(DISTINCT CASE
             WHEN phase = 'preflop' AND hand_id <> '' AND action <> 'fold' THEN hand_id END
           ) AS vpip_hands,
           COUNT(DISTINCT CASE
             WHEN phase = 'preflop' AND hand_id <> '' AND action IN
               ('open-raise', 'raise', 'three-bet', 'four-bet-plus', 'all-in', 'squeeze')
             THEN hand_id END
           ) AS pfr_hands,
           COUNT(DISTINCT CASE
             WHEN phase = 'preflop' AND hand_id <> '' AND preflop_context = 'facing-raise'
             THEN hand_id END
           ) AS three_bet_opportunities,
           COUNT(DISTINCT CASE
             WHEN phase = 'preflop' AND hand_id <> '' AND preflop_context = 'facing-raise'
               AND action IN ('three-bet', 'squeeze')
             THEN hand_id END
           ) AS three_bet_hands
         FROM observations
         WHERE owner_key = ?
         GROUP BY player_id`,
      )
      .bind(ownerKey)
      .all<HudStatRow>(),
    d1
      .prepare(
        `SELECT
           o.id,
           o.player_id,
           p.name AS player_name,
           o.phase,
           o.action,
           o.hand_id,
           o.hand_number,
           o.seat_no,
           o.position,
           o.sequence,
           o.preflop_context,
           o.created_at
         FROM observations o
         JOIN players p ON p.id = o.player_id AND p.owner_key = o.owner_key
         WHERE o.owner_key = ? AND o.hand_id <> ''
         ORDER BY o.created_at DESC, o.sequence DESC
         LIMIT 180`,
      )
      .bind(ownerKey)
      .all<RecentRow>(),
    db
      .select({
        positionOffset: tableState.positionOffset,
        handNumber: tableState.handNumber,
        tableSize: tableState.tableSize,
        currentHandId: tableState.currentHandId,
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

  const hudStats: Record<string, PlayerHudStats> = {};
  for (const row of statsResult.results ?? []) {
    const sampleHands = Number(row.sample_hands);
    const vpipHands = Number(row.vpip_hands);
    const pfrHands = Number(row.pfr_hands);
    const threeBetHands = Number(row.three_bet_hands);
    const threeBetOpportunities = Number(row.three_bet_opportunities);
    hudStats[row.player_id] = {
      playerId: row.player_id,
      sampleHands,
      vpipHands,
      pfrHands,
      threeBetHands,
      threeBetOpportunities,
      vpipPct: percentage(vpipHands, sampleHands),
      pfrPct: percentage(pfrHands, sampleHands),
      threeBetPct: percentage(threeBetHands, threeBetOpportunities, 1),
    };
  }

  return {
    players: playerRows.map(({ ownerKey: _owner, archived: _archived, ...player }) => ({
      ...player,
      preflopTags: parseTags(player.preflopTags),
      postflopTags: parseTags(player.postflopTags),
    })),
    seats: seatRows,
    counts,
    hudStats,
    recentHands: buildRecentHands(recentResult.results ?? []),
    table: tableRows[0] ?? {
      positionOffset: 0,
      handNumber: 1,
      tableSize: 6,
      currentHandId: crypto.randomUUID(),
    },
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

async function inferObservationContext(ownerKey: string, mutation: Extract<TrackerMutation, { type: "addObservation" }>) {
  const d1 = getD1();
  const currentTable = await getCurrentTable(ownerKey);
  const handId = isSafeId(mutation.handId) ? mutation.handId : currentTable.currentHandId;
  const handNumber = Number.isInteger(mutation.handNumber) && (mutation.handNumber ?? 0) > 0
    ? Math.min(2_000_000_000, mutation.handNumber!)
    : currentTable.handNumber;

  let seatNo = Number.isInteger(mutation.seatNo) && (mutation.seatNo ?? 0) >= 1 && (mutation.seatNo ?? 0) <= 8
    ? mutation.seatNo!
    : null;
  if (seatNo === null) {
    const seatResult = await d1
      .prepare("SELECT seat_no FROM seats WHERE owner_key = ? AND player_id = ? LIMIT 1")
      .bind(ownerKey, mutation.playerId)
      .first<{ seat_no: number }>();
    seatNo = seatResult ? Number(seatResult.seat_no) : null;
  }

  const suppliedPosition = cleanText(mutation.position, 12) ?? "";
  const position = suppliedPosition || (seatNo
    ? positionForSeat(seatNo, currentTable.positionOffset, currentTable.tableSize)
    : "");

  let sequence = Number.isInteger(mutation.sequence) && (mutation.sequence ?? 0) > 0
    ? Math.min(1000, mutation.sequence!)
    : 0;
  if (!sequence && handId) {
    const sequenceResult = await d1
      .prepare(
        "SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM observations WHERE owner_key = ? AND hand_id = ?",
      )
      .bind(ownerKey, handId)
      .first<{ next_sequence: number }>();
    sequence = Number(sequenceResult?.next_sequence ?? 1);
  }

  let preflopContext = mutation.phase === "preflop" && mutation.preflopContext && VALID_PREFLOP_CONTEXTS.has(mutation.preflopContext)
    ? mutation.preflopContext
    : "";

  if (mutation.phase === "preflop" && !preflopContext) {
    if (["three-bet", "squeeze", "cold-call"].includes(mutation.action)) {
      preflopContext = "facing-raise";
    } else if (["open-raise", "raise", "limp"].includes(mutation.action)) {
      preflopContext = "unopened";
    } else if (handId && ["fold", "call"].includes(mutation.action)) {
      const previous = await d1
        .prepare(
          `SELECT action
           FROM observations
           WHERE owner_key = ? AND hand_id = ? AND phase = 'preflop'
           ORDER BY sequence DESC, created_at DESC
           LIMIT 1`,
        )
        .bind(ownerKey, handId)
        .first<{ action: string }>();
      if (previous?.action && ["open-raise", "raise"].includes(previous.action)) {
        preflopContext = "facing-raise";
      }
    }
  }

  return {
    handId,
    handNumber,
    seatNo,
    position,
    sequence,
    preflopContext,
  };
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
        const handId = isSafeId(mutation.handId) ? mutation.handId : crypto.randomUUID();
        const d1 = getD1();
        await d1.batch([
          d1
            .prepare("DELETE FROM seats WHERE owner_key = ? AND seat_no > ?")
            .bind(owner, mutation.tableSize),
          d1
            .prepare(
              `INSERT INTO table_state
               (owner_key, position_offset, hand_number, table_size, current_hand_id, last_advance_id, updated_at)
               VALUES (?, 0, 1, ?, ?, '', CURRENT_TIMESTAMP)
               ON CONFLICT(owner_key) DO UPDATE SET
                 position_offset = 0,
                 hand_number = 1,
                 table_size = excluded.table_size,
                 current_hand_id = excluded.current_hand_id,
                 last_advance_id = '',
                 updated_at = CURRENT_TIMESTAMP`,
            )
            .bind(owner, mutation.tableSize, handId),
        ]);
        break;
      }

      case "advanceHand":
        if (!isSafeId(mutation.id)) return jsonError("Invalid hand id.");
        await getD1()
          .prepare(
            `INSERT INTO table_state
             (owner_key, position_offset, hand_number, table_size, current_hand_id, last_advance_id, updated_at)
             VALUES (?, 1, 2, 6, ?, ?, CURRENT_TIMESTAMP)
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
               current_hand_id = CASE
                 WHEN last_advance_id <> excluded.last_advance_id
                 THEN excluded.current_hand_id
                 ELSE current_hand_id
               END,
               last_advance_id = excluded.last_advance_id,
               updated_at = CURRENT_TIMESTAMP`,
          )
          .bind(owner, mutation.id, mutation.id)
          .run();
        break;

      case "clearSeats": {
        const handId = isSafeId(mutation.handId) ? mutation.handId : crypto.randomUUID();
        const currentTable = await getCurrentTable(owner);
        const d1 = getD1();
        await d1.batch([
          d1.prepare("DELETE FROM seats WHERE owner_key = ?").bind(owner),
          d1
            .prepare(
              `INSERT INTO table_state
               (owner_key, position_offset, hand_number, table_size, current_hand_id, last_advance_id, updated_at)
               VALUES (?, 0, 1, ?, ?, '', CURRENT_TIMESTAMP)
               ON CONFLICT(owner_key) DO UPDATE SET
                 position_offset = 0,
                 hand_number = 1,
                 current_hand_id = excluded.current_hand_id,
                 last_advance_id = '',
                 updated_at = CURRENT_TIMESTAMP`,
            )
            .bind(owner, currentTable.tableSize === 8 ? 8 : 6, handId),
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

        const context = await inferObservationContext(owner, mutation);
        await getD1()
          .prepare(
            `INSERT OR IGNORE INTO observations
             (id, owner_key, player_id, phase, action, hand_id, hand_number,
              seat_no, position, sequence, preflop_context, created_at)
             SELECT ?, ?, id, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
             FROM players
             WHERE id = ? AND owner_key = ? AND archived = 0`,
          )
          .bind(
            mutation.id,
            owner,
            mutation.phase,
            mutation.action,
            context.handId,
            context.handNumber,
            context.seatNo,
            context.position,
            context.sequence,
            context.preflopContext,
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

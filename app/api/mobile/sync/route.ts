import { getD1 } from "@/db";
import { resolveBearerOwner } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

const VALID_PHASES = new Set(["preflop", "postflop", "showdown"]);
const VALID_STREETS = new Set(["flop", "turn", "river"]);
const VALID_ACTIONS = new Set([
  "fold", "limp", "call", "open-raise", "three-bet", "four-bet-plus", "all-in", "squeeze",
  "check", "bet", "postflop-raise", "postflop-fold", "check-raise", "donk-bet", "postflop-all-in",
  "bluff-shown", "value-shown", "draw-shown", "mucked-unknown",
]);

type PlayerRow = {
  id: string;
  name: string;
  play_style: string;
  bluff_level: number;
  preflop_tags: string;
  postflop_tags: string;
  preflop_notes: string;
  postflop_notes: string;
  tells_notes: string;
  showdown_notes: string;
  updated_at: string;
};

type ObservationRow = {
  id: string;
  player_id: string;
  phase: string;
  street: string;
  action: string;
  hand_id: string;
  hand_number: number;
  created_at: string;
};

type SyncPlayer = { id?: unknown; name?: unknown };
type SyncObservation = {
  id?: unknown;
  playerId?: unknown;
  phase?: unknown;
  street?: unknown;
  action?: unknown;
  handId?: unknown;
  handNumber?: unknown;
  createdAt?: unknown;
};

type SyncBody = {
  players?: SyncPlayer[];
  observations?: SyncObservation[];
  deletedObservationIds?: unknown[];
};

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,64}$/.test(value);
}

function parseTags(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

async function loadSnapshot(ownerKey: string) {
  const d1 = getD1();
  const [playerResult, observationResult] = await Promise.all([
    d1
      .prepare(
        `SELECT id, name, play_style, bluff_level, preflop_tags, postflop_tags,
                preflop_notes, postflop_notes, tells_notes, showdown_notes, updated_at
         FROM players
         WHERE owner_key = ? AND archived = 0
         ORDER BY updated_at ASC, id ASC`,
      )
      .bind(ownerKey)
      .all<PlayerRow>(),
    d1
      .prepare(
        `SELECT id, player_id, phase, street, action, hand_id, hand_number, created_at
         FROM observations
         WHERE owner_key = ?
         ORDER BY created_at ASC, sequence ASC, id ASC
         LIMIT 10000`,
      )
      .bind(ownerKey)
      .all<ObservationRow>(),
  ]);

  return {
    players: (playerResult.results ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      playStyle: row.play_style,
      bluffLevel: Number(row.bluff_level),
      preflopTags: parseTags(row.preflop_tags),
      postflopTags: parseTags(row.postflop_tags),
      preflopNotes: row.preflop_notes,
      postflopNotes: row.postflop_notes,
      tellsNotes: row.tells_notes,
      showdownNotes: row.showdown_notes,
      updatedAt: row.updated_at,
    })),
    observations: (observationResult.results ?? []).map((row) => ({
      id: row.id,
      playerId: row.player_id,
      phase: row.phase,
      street: VALID_STREETS.has(row.street) ? row.street : null,
      action: row.action,
      handId: row.hand_id,
      handNumber: Number(row.hand_number),
      createdAt: row.created_at,
    })),
    truncated: (observationResult.results?.length ?? 0) >= 10000,
  };
}

export async function GET(request: Request) {
  try {
    const session = await resolveBearerOwner(request);
    if (!session) return Response.json({ error: "Invalid mobile session." }, { status: 401 });
    return Response.json(await loadSnapshot(session.ownerKey));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to synchronize tracker.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await resolveBearerOwner(request);
    if (!session) return Response.json({ error: "Invalid mobile session." }, { status: 401 });

    let body: SyncBody;
    try {
      body = (await request.json()) as SyncBody;
    } catch {
      return Response.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const incomingPlayers = Array.isArray(body.players) ? body.players.slice(0, 500) : [];
    const incomingObservations = Array.isArray(body.observations) ? body.observations.slice(0, 5000) : [];
    const deletedIds = Array.isArray(body.deletedObservationIds)
      ? body.deletedObservationIds.filter(isSafeId).slice(0, 1000)
      : [];
    const d1 = getD1();

    const playerStatements = incomingPlayers.flatMap((player) => {
      if (!isSafeId(player.id) || typeof player.name !== "string") return [];
      const name = player.name.trim().slice(0, 80);
      if (!name) return [];
      return [
        d1
          .prepare(
            `INSERT OR IGNORE INTO players
             (id, owner_key, name, play_style, bluff_level, preflop_tags, postflop_tags,
              preflop_notes, postflop_notes, tells_notes, showdown_notes, archived, created_at, updated_at)
             VALUES (?, ?, ?, 'unknown', 0, '[]', '[]', '', '', '', '', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          )
          .bind(player.id, session.ownerKey, name),
      ];
    });

    const deleteStatements = deletedIds.map((id) =>
      d1.prepare("DELETE FROM observations WHERE owner_key = ? AND id = ?").bind(session.ownerKey, id),
    );

    const observationStatements = incomingObservations.flatMap((item) => {
      if (
        !isSafeId(item.id) ||
        !isSafeId(item.playerId) ||
        !isSafeId(item.handId) ||
        typeof item.phase !== "string" ||
        typeof item.action !== "string" ||
        !VALID_PHASES.has(item.phase) ||
        !VALID_ACTIONS.has(item.action)
      ) return [];

      const street = item.phase === "postflop" && typeof item.street === "string" && VALID_STREETS.has(item.street)
        ? item.street
        : "";
      const handNumber = typeof item.handNumber === "number" && Number.isInteger(item.handNumber) && item.handNumber > 0
        ? Math.min(item.handNumber, 2_000_000_000)
        : 0;
      const createdAt = typeof item.createdAt === "string" && !Number.isNaN(Date.parse(item.createdAt))
        ? new Date(item.createdAt).toISOString()
        : new Date().toISOString();

      return [
        d1
          .prepare(
            `INSERT OR IGNORE INTO observations
             (id, owner_key, player_id, phase, street, action, hand_id, hand_number,
              seat_no, position, sequence, preflop_context, created_at)
             SELECT ?, ?, id, ?, ?, ?, ?, ?, NULL, '', 0, '', ?
             FROM players
             WHERE id = ? AND owner_key = ? AND archived = 0`,
          )
          .bind(
            item.id,
            session.ownerKey,
            item.phase,
            street,
            item.action,
            item.handId,
            handNumber,
            createdAt,
            item.playerId,
            session.ownerKey,
          ),
      ];
    });

    const statements = [...playerStatements, ...deleteStatements, ...observationStatements];
    if (statements.length) await d1.batch(statements);

    return Response.json(await loadSnapshot(session.ownerKey));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to synchronize tracker.";
    return Response.json({ error: message }, { status: 500 });
  }
}

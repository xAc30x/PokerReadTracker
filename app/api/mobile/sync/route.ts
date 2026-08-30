import { getD1 } from "@/db";
import { resolveBearerOwner } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

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
  action: string;
  hand_id: string;
  hand_number: number;
  created_at: string;
};

function parseTags(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  try {
    const session = await resolveBearerOwner(request);
    if (!session) return Response.json({ error: "Invalid mobile session." }, { status: 401 });

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
        .bind(session.ownerKey)
        .all<PlayerRow>(),
      d1
        .prepare(
          `SELECT id, player_id, phase, action, hand_id, hand_number, created_at
           FROM observations
           WHERE owner_key = ?
           ORDER BY created_at ASC, sequence ASC, id ASC
           LIMIT 10000`,
        )
        .bind(session.ownerKey)
        .all<ObservationRow>(),
    ]);

    return Response.json({
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
        action: row.action,
        handId: row.hand_id,
        handNumber: Number(row.hand_number),
        createdAt: row.created_at,
      })),
      truncated: (observationResult.results?.length ?? 0) >= 10000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to synchronize tracker.";
    return Response.json({ error: message }, { status: 500 });
  }
}

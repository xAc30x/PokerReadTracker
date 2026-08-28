import { getD1 } from "@/db";
import type {
  CreateGameResult,
  GameCategory,
  GameResult,
  PokerFormat,
} from "@/app/game-result-types";

export const dynamic = "force-dynamic";

const OWNER_HEADER = "oai-authenticated-user-email";
const POKER_FORMATS: readonly PokerFormat[] = [
  "NL Hold'em",
  "PL Omaha",
  "PLO8",
  "Limit Hold'em",
  "Mixed",
  "Other",
];

type ResultRow = {
  id: string;
  category: GameCategory;
  played_at: string;
  name: string;
  venue: string;
  stakes: string;
  buy_in_cents: number;
  cash_out_cents: number;
  winnings_cents: number;
  rake_cents: number;
  prize_pool_cents: number;
  poker_format: PokerFormat;
  duration_minutes: number;
  finishing_place: number | null;
  field_size: number | null;
  notes: string;
  created_at: string;
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

function cleanText(value: unknown, max: number, required = false): string | null {
  if (typeof value !== "string") return required ? null : "";
  const cleaned = value.trim().slice(0, max);
  return required && !cleaned ? null : cleaned;
}

function cleanNonNegativeInteger(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
    return null;
  }
  return value;
}

function cleanPositiveInteger(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) {
    return null;
  }
  return value;
}

function cleanPokerFormat(value: unknown): PokerFormat | null {
  return typeof value === "string" && POKER_FORMATS.includes(value as PokerFormat)
    ? (value as PokerFormat)
    : null;
}

function mapResult(row: ResultRow): GameResult {
  return {
    id: row.id,
    category: row.category,
    playedAt: row.played_at,
    name: row.name,
    venue: row.venue,
    stakes: row.stakes,
    buyInCents: Number(row.buy_in_cents),
    cashOutCents: Number(row.cash_out_cents),
    winningsCents: Number(row.winnings_cents),
    rakeCents: Number(row.rake_cents),
    prizePoolCents: Number(row.prize_pool_cents),
    pokerFormat: row.poker_format,
    durationMinutes: Number(row.duration_minutes),
    finishingPlace: row.finishing_place === null ? null : Number(row.finishing_place),
    fieldSize: row.field_size === null ? null : Number(row.field_size),
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export async function GET(request: Request) {
  const owner = getOwner(request);
  if (!owner) return jsonError("Sign in is required.", 401);

  try {
    const response = await getD1()
      .prepare(
        `SELECT id, category, played_at, name, venue, stakes, buy_in_cents,
                cash_out_cents, winnings_cents, rake_cents, prize_pool_cents,
                poker_format, duration_minutes, finishing_place, field_size,
                notes, created_at
         FROM game_results
         WHERE owner_key = ?
         ORDER BY played_at DESC, created_at DESC`,
      )
      .bind(owner)
      .all<ResultRow>();
    return Response.json({ results: (response.results ?? []).map(mapResult) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load results.";
    return jsonError(message, 500);
  }
}

export async function POST(request: Request) {
  const owner = getOwner(request);
  if (!owner) return jsonError("Sign in is required.", 401);

  let input: CreateGameResult;
  try {
    input = (await request.json()) as CreateGameResult;
  } catch {
    return jsonError("Invalid JSON body.");
  }

  if (!isSafeId(input.id)) return jsonError("Invalid result id.");
  if (input.category !== "cash" && input.category !== "tournament") {
    return jsonError("Category must be cash or tournament.");
  }
  if (typeof input.playedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.playedAt)) {
    return jsonError("A valid session date is required.");
  }

  const name = cleanText(input.name, 100, true);
  const venue = cleanText(input.venue, 100) ?? "";
  const stakes = cleanText(input.stakes, 40) ?? "";
  const notes = cleanText(input.notes, 2000) ?? "";
  const pokerFormat = cleanPokerFormat(input.pokerFormat);
  const buyInCents = cleanNonNegativeInteger(input.buyInCents, 100_000_000);
  const cashOutCents = cleanNonNegativeInteger(input.cashOutCents, 100_000_000);
  const winningsCents = cleanNonNegativeInteger(input.winningsCents, 100_000_000);
  const rakeCents = cleanNonNegativeInteger(input.rakeCents, 100_000_000);
  const prizePoolCents = cleanNonNegativeInteger(input.prizePoolCents, 10_000_000_000);
  const durationMinutes = cleanNonNegativeInteger(input.durationMinutes, 100_000);
  if (
    !name ||
    !pokerFormat ||
    buyInCents === null ||
    cashOutCents === null ||
    winningsCents === null ||
    rakeCents === null ||
    prizePoolCents === null ||
    durationMinutes === null
  ) {
    return jsonError("One or more result fields are invalid.");
  }

  const finishingPlace = input.category === "tournament"
    ? cleanPositiveInteger(input.finishingPlace, 1_000_000)
    : null;
  const fieldSize = input.category === "tournament"
    ? cleanPositiveInteger(input.fieldSize, 1_000_000)
    : null;
  if (input.category === "tournament" && (!finishingPlace || !fieldSize || finishingPlace > fieldSize)) {
    return jsonError("Finishing place must be between 1 and the field size.");
  }

  try {
    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO game_results
         (id, owner_key, category, played_at, name, venue, stakes,
          buy_in_cents, cash_out_cents, winnings_cents, rake_cents,
          prize_pool_cents, poker_format, duration_minutes, finishing_place,
          field_size, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .bind(
        input.id,
        owner,
        input.category,
        input.playedAt,
        name,
        venue,
        input.category === "cash" ? stakes : "",
        buyInCents,
        input.category === "cash" ? cashOutCents : 0,
        input.category === "tournament" ? winningsCents : 0,
        input.category === "tournament" ? rakeCents : 0,
        input.category === "tournament" ? prizePoolCents : 0,
        pokerFormat,
        durationMinutes,
        finishingPlace,
        fieldSize,
        notes,
      )
      .run();

    const result: GameResult = {
      ...input,
      name,
      venue,
      stakes: input.category === "cash" ? stakes : "",
      buyInCents,
      cashOutCents: input.category === "cash" ? cashOutCents : 0,
      winningsCents: input.category === "tournament" ? winningsCents : 0,
      rakeCents: input.category === "tournament" ? rakeCents : 0,
      prizePoolCents: input.category === "tournament" ? prizePoolCents : 0,
      pokerFormat,
      durationMinutes,
      finishingPlace,
      fieldSize,
      notes,
      createdAt: new Date().toISOString(),
    };
    return Response.json({ result }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save result.";
    return jsonError(message, 500);
  }
}

export async function DELETE(request: Request) {
  const owner = getOwner(request);
  if (!owner) return jsonError("Sign in is required.", 401);

  let id: unknown;
  try {
    ({ id } = (await request.json()) as { id?: unknown });
  } catch {
    return jsonError("Invalid JSON body.");
  }
  if (!isSafeId(id)) return jsonError("Invalid result id.");

  try {
    await getD1()
      .prepare("DELETE FROM game_results WHERE owner_key = ? AND id = ?")
      .bind(owner, id)
      .run();
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to remove result.";
    return jsonError(message, 500);
  }
}

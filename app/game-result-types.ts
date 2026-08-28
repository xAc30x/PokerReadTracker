export type GameCategory = "cash" | "tournament";

export type PokerFormat =
  | "NL Hold'em"
  | "PL Omaha"
  | "PLO8"
  | "Limit Hold'em"
  | "Mixed"
  | "Other";

export type GameResult = {
  id: string;
  category: GameCategory;
  playedAt: string;
  name: string;
  venue: string;
  stakes: string;
  buyInCents: number;
  cashOutCents: number;
  winningsCents: number;
  rakeCents: number;
  prizePoolCents: number;
  pokerFormat: PokerFormat;
  durationMinutes: number;
  finishingPlace: number | null;
  fieldSize: number | null;
  notes: string;
  createdAt: string;
};

export type CreateGameResult = Omit<GameResult, "createdAt">;

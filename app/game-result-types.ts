export type GameCategory = "cash" | "tournament";

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
  durationMinutes: number;
  finishingPlace: number | null;
  fieldSize: number | null;
  notes: string;
  createdAt: string;
};

export type CreateGameResult = Omit<GameResult, "createdAt">;

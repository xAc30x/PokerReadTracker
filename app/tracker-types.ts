export const PLAY_STYLES = [
  "unknown",
  "nit",
  "tag",
  "lag",
  "calling-station",
  "maniac",
] as const;

export type PlayStyle = (typeof PLAY_STYLES)[number];

export type Player = {
  id: string;
  name: string;
  playStyle: PlayStyle;
  bluffLevel: number;
  preflopTags: string[];
  postflopTags: string[];
  preflopNotes: string;
  postflopNotes: string;
  tellsNotes: string;
  showdownNotes: string;
  createdAt: string;
  updatedAt: string;
};

export type Seat = {
  seatNo: number;
  playerId: string;
};

export type TableSize = 6 | 8;

export type ObservationCounts = Record<
  string,
  Record<string, Record<string, number>>
>;

export type TableState = {
  positionOffset: number;
  handNumber: number;
  tableSize: TableSize;
};

export type TrackerState = {
  players: Player[];
  seats: Seat[];
  counts: ObservationCounts;
  table: TableState;
};

export type PlayerPatch = Partial<
  Pick<
    Player,
    | "name"
    | "playStyle"
    | "bluffLevel"
    | "preflopTags"
    | "postflopTags"
    | "preflopNotes"
    | "postflopNotes"
    | "tellsNotes"
    | "showdownNotes"
  >
>;

export type TrackerMutation =
  | {
      type: "createPlayer";
      id: string;
      name: string;
      seatNo: number | null;
    }
  | { type: "updatePlayer"; playerId: string; patch: PlayerPatch }
  | { type: "assignSeat"; seatNo: number; playerId: string | null }
  | { type: "setTableSize"; tableSize: TableSize }
  | { type: "advanceHand"; id: string }
  | { type: "clearSeats" }
  | {
      type: "addObservation";
      id: string;
      playerId: string;
      phase: "preflop" | "postflop" | "showdown";
      action: string;
    }
  | {
      type: "undoObservation";
      observationId: string;
      playerId?: string;
      phase?: "preflop" | "postflop" | "showdown";
      action?: string;
    }
  | { type: "archivePlayer"; playerId: string };

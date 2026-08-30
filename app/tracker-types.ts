export const PLAY_STYLES = [
  "unknown",
  "nit",
  "tag",
  "lag",
  "calling-station",
  "maniac",
] as const;

export type PlayStyle = (typeof PLAY_STYLES)[number];
export type ObservationPhase = "preflop" | "postflop" | "showdown";
export type ObservationStreet = "flop" | "turn" | "river";
export type PreflopContext = "unopened" | "facing-raise";

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

export type RecentObservation = {
  id: string;
  playerId: string;
  playerName: string;
  phase: ObservationPhase;
  street?: ObservationStreet | null;
  action: string;
  handId: string;
  handNumber: number;
  seatNo: number | null;
  position: string;
  sequence: number;
  preflopContext: PreflopContext | null;
  createdAt: string;
};

export type RecentHand = {
  id: string;
  handNumber: number;
  createdAt: string;
  observations: RecentObservation[];
};

export type PlayerHudStats = {
  playerId: string;
  sampleHands: number;
  vpipHands: number;
  pfrHands: number;
  threeBetHands: number;
  threeBetOpportunities: number;
  vpipPct: number | null;
  pfrPct: number | null;
  threeBetPct: number | null;
};

export type TableState = {
  positionOffset: number;
  handNumber: number;
  tableSize: TableSize;
  currentHandId: string;
};

export type TrackerState = {
  players: Player[];
  seats: Seat[];
  counts: ObservationCounts;
  hudStats: Record<string, PlayerHudStats>;
  recentHands: RecentHand[];
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
  | { type: "setTableSize"; tableSize: TableSize; handId?: string }
  | { type: "advanceHand"; id: string }
  | { type: "clearSeats"; handId?: string }
  | {
      type: "addObservation";
      id: string;
      playerId: string;
      phase: ObservationPhase;
      street?: ObservationStreet;
      action: string;
      handId?: string;
      handNumber?: number;
      seatNo?: number | null;
      position?: string;
      sequence?: number;
      preflopContext?: PreflopContext;
    }
  | {
      type: "undoObservation";
      observationId: string;
      playerId?: string;
      phase?: ObservationPhase;
      action?: string;
    }
  | { type: "archivePlayer"; playerId: string };

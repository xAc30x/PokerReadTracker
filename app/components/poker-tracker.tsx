"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PLAY_STYLES,
  type ObservationPhase,
  type Player,
  type PlayerPatch,
  type PlayStyle,
  type TableSize,
  type TrackerMutation,
  type TrackerState,
} from "../tracker-types";

const EMPTY_STATE: TrackerState = {
  players: [],
  seats: [],
  counts: {},
  hudStats: {},
  recentHands: [],
  table: { positionOffset: 0, handNumber: 1, tableSize: 6, currentHandId: "" },
};
const CACHE_KEY = "tableread.state.v1";
const QUEUE_KEY = "tableread.pending.v1";
const TABLE_SIZES: readonly TableSize[] = [6, 8];
const PHYSICAL_SEATS: Record<TableSize, readonly number[]> = {
  6: [1, 2, 3, 4, 5, 6],
  8: [1, 2, 3, 4, 5, 6, 7, 8],
};
const POSITION_ORDERS = {
  6: [
    { short: "BB", name: "Big Blind" },
    { short: "UTG", name: "Under the Gun" },
    { short: "HJ", name: "Hijack" },
    { short: "CO", name: "Cutoff" },
    { short: "BTN", name: "Button" },
    { short: "SB", name: "Small Blind" },
  ],
  8: [
    { short: "BB", name: "Big Blind" },
    { short: "UTG", name: "Under the Gun" },
    { short: "UTG+1", name: "Under the Gun +1" },
    { short: "MP", name: "Middle Position" },
    { short: "HJ", name: "Hijack" },
    { short: "CO", name: "Cutoff" },
    { short: "BTN", name: "Button" },
    { short: "SB", name: "Small Blind" },
  ],
} as const satisfies Record<
  TableSize,
  readonly { short: string; name: string }[]
>;

const STYLE_LABELS: Record<PlayStyle, string> = {
  unknown: "Unknown",
  nit: "Nit",
  tag: "TAG",
  lag: "LAG",
  "calling-station": "Calling station",
  maniac: "Maniac",
};

const BLUFF_LABELS = ["Not set", "Rare", "Sometimes", "Often", "Very often"];
const PREFLOP_TAGS = [
  "Limp-heavy",
  "Opens wide",
  "Opens tight",
  "3-bets light",
  "Calls 3-bets",
  "Overfolds blinds",
];
const POSTFLOP_TAGS = [
  "C-bets often",
  "Gives up turns",
  "Check-raises",
  "Chases draws",
  "Calls too wide",
  "Folds to pressure",
];

type SaveStatus = "loading" | "saved" | "saving" | "queued" | "error";
type PanelTab = "quick" | "profile";
type ActionDefinition = {
  phase: ObservationPhase;
  action: string;
  label: string;
  glyph: string;
  tone?: "positive" | "warning";
};
type LastLog = ActionDefinition & { id: string; playerId: string; playerName: string };

const PREFLOP_ACTIONS: ActionDefinition[] = [
  { phase: "preflop", action: "fold", label: "Fold", glyph: "F" },
  { phase: "preflop", action: "limp", label: "Limp", glyph: "L" },
  { phase: "preflop", action: "call", label: "Call", glyph: "C" },
  { phase: "preflop", action: "open-raise", label: "Open Raise", glyph: "OR", tone: "positive" },
  { phase: "preflop", action: "three-bet", label: "3-Bet", glyph: "3B", tone: "warning" },
  { phase: "preflop", action: "four-bet-plus", label: "4-Bet+", glyph: "4+", tone: "warning" },
  { phase: "preflop", action: "all-in", label: "All-In", glyph: "AI", tone: "warning" },
  { phase: "preflop", action: "squeeze", label: "Squeeze", glyph: "SQ", tone: "warning" },
  { phase: "preflop", action: "cold-call", label: "Cold Call", glyph: "CC" },
];
const POSTFLOP_ACTIONS: ActionDefinition[] = [
  { phase: "postflop", action: "check", label: "Check", glyph: "X" },
  { phase: "postflop", action: "bet", label: "Bet", glyph: "B", tone: "positive" },
  { phase: "postflop", action: "call", label: "Call", glyph: "C" },
  { phase: "postflop", action: "postflop-raise", label: "Raise", glyph: "R+", tone: "warning" },
  { phase: "postflop", action: "postflop-fold", label: "Fold", glyph: "F" },
  { phase: "postflop", action: "check-raise", label: "Check-Raise", glyph: "XR", tone: "warning" },
  { phase: "postflop", action: "donk-bet", label: "Donk Bet", glyph: "DB", tone: "positive" },
  { phase: "postflop", action: "postflop-all-in", label: "All-In", glyph: "AI", tone: "warning" },
];
const SHOWDOWN_ACTIONS: ActionDefinition[] = [
  { phase: "showdown", action: "bluff-shown", label: "Showed Bluff", glyph: "BL", tone: "warning" },
  { phase: "showdown", action: "value-shown", label: "Showed Value", glyph: "V", tone: "positive" },
  { phase: "showdown", action: "draw-shown", label: "Showed Draw", glyph: "DR" },
  { phase: "showdown", action: "slowplay-shown", label: "Slow-Played", glyph: "SP", tone: "positive" },
  { phase: "showdown", action: "hero-call-shown", label: "Hero / Light Call", glyph: "HC" },
  { phase: "showdown", action: "mucked-unknown", label: "Mucked / Unknown", glyph: "?" },
];
const ACTION_LABELS = new Map(
  [...PREFLOP_ACTIONS, ...POSTFLOP_ACTIONS, ...SHOWDOWN_ACTIONS].map((item) => [item.action, item.label]),
);

function LogoMark() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <path d="M20 4 6 14l14 22 14-22L20 4Z" fill="currentColor" />
      <path d="M20 10v18M12 16h16" stroke="#07120f" strokeWidth="3" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5.5 20c.6-4 2.7-6 6.5-6s5.9 2 6.5 6" />
    </svg>
  );
}

function playerInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function readStored<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function storeValue(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Server persistence remains authoritative if the local safety cache is full.
  }
}

function normalizeState(state: TrackerState): TrackerState {
  const currentTable = state.table ?? EMPTY_STATE.table;
  const tableSize: TableSize = currentTable.tableSize === 8 ? 8 : 6;
  return {
    ...state,
    seats: (state.seats ?? []).filter((seat) => seat.seatNo <= tableSize),
    counts: state.counts ?? {},
    hudStats: state.hudStats ?? {},
    recentHands: state.recentHands ?? [],
    table: {
      positionOffset: currentTable.positionOffset ?? 0,
      handNumber: currentTable.handNumber ?? 1,
      tableSize,
      currentHandId: currentTable.currentHandId ?? "",
    },
  };
}

function positionForSeat(
  seatNo: number,
  positionOffset: number,
  tableSize: TableSize,
) {
  const normalizedOffset = ((positionOffset % tableSize) + tableSize) % tableSize;
  const positionIndex = (seatNo - 1 - normalizedOffset + tableSize) % tableSize;
  return POSITION_ORDERS[tableSize][positionIndex]!;
}

function updateCount(
  state: TrackerState,
  playerId: string,
  phase: string,
  action: string,
  delta: number,
): TrackerState {
  const current = state.counts[playerId]?.[phase]?.[action] ?? 0;
  return {
    ...state,
    counts: {
      ...state.counts,
      [playerId]: {
        ...(state.counts[playerId] ?? {}),
        [phase]: {
          ...(state.counts[playerId]?.[phase] ?? {}),
          [action]: Math.max(0, current + delta),
        },
      },
    },
  };
}

function applyOptimistic(state: TrackerState, mutation: TrackerMutation): TrackerState {
  const now = new Date().toISOString();

  switch (mutation.type) {
    case "createPlayer": {
      const player: Player = {
        id: mutation.id,
        name: mutation.name.trim(),
        playStyle: "unknown",
        bluffLevel: 0,
        preflopTags: [],
        postflopTags: [],
        preflopNotes: "",
        postflopNotes: "",
        tellsNotes: "",
        showdownNotes: "",
        createdAt: now,
        updatedAt: now,
      };
      const players = state.players.some((item) => item.id === player.id)
        ? state.players
        : [player, ...state.players];
      const seats = mutation.seatNo === null
        ? state.seats
        : [
            ...state.seats.filter(
              (seat) => seat.seatNo !== mutation.seatNo && seat.playerId !== mutation.id,
            ),
            { seatNo: mutation.seatNo, playerId: mutation.id },
          ];
      return { ...state, players, seats };
    }
    case "updatePlayer":
      return {
        ...state,
        players: state.players.map((player) =>
          player.id === mutation.playerId
            ? { ...player, ...mutation.patch, updatedAt: now }
            : player,
        ),
      };
    case "assignSeat":
      return {
        ...state,
        seats: [
          ...state.seats.filter(
            (seat) =>
              seat.seatNo !== mutation.seatNo &&
              (!mutation.playerId || seat.playerId !== mutation.playerId),
          ),
          ...(mutation.playerId
            ? [{ seatNo: mutation.seatNo, playerId: mutation.playerId }]
            : []),
        ],
      };
    case "setTableSize":
      return {
        ...state,
        seats: state.seats.filter((seat) => seat.seatNo <= mutation.tableSize),
        table: {
          ...state.table,
          positionOffset: 0,
          handNumber: 1,
          tableSize: mutation.tableSize,
          currentHandId: mutation.handId ?? state.table.currentHandId,
        },
      };
    case "advanceHand":
      return {
        ...state,
        table: {
          ...state.table,
          positionOffset:
            (state.table.positionOffset + 1) % state.table.tableSize,
          handNumber: state.table.handNumber + 1,
          currentHandId: mutation.id,
        },
      };
    case "clearSeats":
      return {
        ...state,
        seats: [],
        table: {
          ...state.table,
          positionOffset: 0,
          handNumber: 1,
          currentHandId: mutation.handId ?? state.table.currentHandId,
        },
      };
    case "addObservation":
      return updateCount(state, mutation.playerId, mutation.phase, mutation.action, 1);
    case "undoObservation":
      return mutation.playerId && mutation.phase && mutation.action
        ? updateCount(state, mutation.playerId, mutation.phase, mutation.action, -1)
        : state;
    case "archivePlayer":
      return {
        ...state,
        players: state.players.filter((player) => player.id !== mutation.playerId),
        seats: state.seats.filter((seat) => seat.playerId !== mutation.playerId),
        counts: Object.fromEntries(
          Object.entries(state.counts).filter(([playerId]) => playerId !== mutation.playerId),
        ),
        hudStats: Object.fromEntries(
          Object.entries(state.hudStats).filter(([playerId]) => playerId !== mutation.playerId),
        ),
      };
  }
}

function sumCounts(values: Record<string, number> | undefined) {
  return Object.values(values ?? {}).reduce((sum, value) => sum + value, 0);
}

function hudValue(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function PokerTracker() {
  const [data, setData] = useState<TrackerState>(EMPTY_STATE);
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>("quick");
  const [addDestination, setAddDestination] = useState<number | "pool" | null>(null);
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastLog, setLastLog] = useState<LastLog | null>(null);
  const [removeCandidate, setRemoveCandidate] = useState<Pick<Player, "id" | "name"> | null>(null);

  const queueRef = useRef<TrackerMutation[]>([]);
  const flushingRef = useRef(false);
  const flushTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  const replaceData = useCallback((next: TrackerState) => {
    setData(next);
    storeValue(CACHE_KEY, next);
  }, []);

  const changeData = useCallback((updater: (current: TrackerState) => TrackerState) => {
    setData((current) => {
      const next = updater(current);
      storeValue(CACHE_KEY, next);
      return next;
    });
  }, []);

  const persistQueue = useCallback(() => {
    storeValue(QUEUE_KEY, queueRef.current);
  }, []);

  const loadState = useCallback(async () => {
    try {
      const response = await fetch("/api/tracker", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load your saved table");
      const next = normalizeState((await response.json()) as TrackerState);
      replaceData(next);
      if (queueRef.current.length === 0) setStatus("saved");
      setErrorMessage(null);
      return true;
    } catch (error) {
      setStatus(queueRef.current.length ? "queued" : "error");
      setErrorMessage(error instanceof Error ? error.message : "Could not load your table");
      return false;
    }
  }, [replaceData]);

  const flushQueue = useCallback(async () => {
    if (flushingRef.current) return false;
    flushingRef.current = true;
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    try {
      while (queueRef.current.length > 0) {
        setStatus("saving");
        const mutation = queueRef.current[0];
        let response: Response;
        try {
          response = await fetch("/api/tracker", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(mutation),
          });
        } catch {
          setStatus("queued");
          return false;
        }

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) {
            queueRef.current.shift();
            persistQueue();
            setErrorMessage(body?.error ?? "One change could not be saved");
            continue;
          }
          setStatus("queued");
          return false;
        }

        queueRef.current.shift();
        persistQueue();
      }

      setStatus("saved");
      return true;
    } finally {
      flushingRef.current = false;
    }
  }, [persistQueue]);

  const enqueueMutation = useCallback(
    (mutation: TrackerMutation, defer = false) => {
      changeData((current) => applyOptimistic(current, mutation));

      if (mutation.type === "updatePlayer") {
        const firstMutableIndex = flushingRef.current ? 1 : 0;
        let matchIndex = -1;
        for (let index = queueRef.current.length - 1; index >= firstMutableIndex; index -= 1) {
          const pending = queueRef.current[index];
          if (pending.type === "updatePlayer" && pending.playerId === mutation.playerId) {
            matchIndex = index;
            break;
          }
        }
        if (matchIndex >= 0) {
          const pending = queueRef.current[matchIndex] as Extract<TrackerMutation, { type: "updatePlayer" }>;
          queueRef.current[matchIndex] = {
            ...pending,
            patch: { ...pending.patch, ...mutation.patch },
          };
        } else {
          queueRef.current.push(mutation);
        }
      } else {
        queueRef.current.push(mutation);
      }

      persistQueue();
      setStatus(defer ? "queued" : "saving");

      const shouldRefresh = [
        "addObservation",
        "undoObservation",
        "advanceHand",
        "setTableSize",
        "clearSeats",
      ].includes(mutation.type);

      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
      if (defer) {
        flushTimerRef.current = window.setTimeout(() => void flushQueue(), 650);
      } else {
        void (async () => {
          const synced = await flushQueue();
          if (synced && shouldRefresh) await loadState();
        })();
      }
    },
    [changeData, flushQueue, loadState, persistQueue],
  );

  useEffect(() => {
    const cached = readStored<TrackerState | null>(CACHE_KEY, null);
    const pending = readStored<TrackerMutation[]>(QUEUE_KEY, []);
    queueRef.current = Array.isArray(pending) ? pending : [];
    if (cached) setData(normalizeState(cached));

    void (async () => {
      const synced = await flushQueue();
      if (synced) await loadState();
    })();

    const handleOnline = () => {
      void (async () => {
        const synced = await flushQueue();
        if (synced) await loadState();
      })();
    };
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    };
  }, [flushQueue, loadState]);

  const seatsByNumber = useMemo(
    () => new Map(data.seats.map((seat) => [seat.seatNo, seat.playerId])),
    [data.seats],
  );
  const playersById = useMemo(
    () => new Map(data.players.map((player) => [player.id, player])),
    [data.players],
  );
  const selectedPlayer = selectedId ? playersById.get(selectedId) ?? null : null;
  const selectedSeat = selectedId
    ? data.seats.find((seat) => seat.playerId === selectedId)?.seatNo ?? null
    : null;
  const selectedPosition = selectedSeat
    ? positionForSeat(selectedSeat, data.table.positionOffset, data.table.tableSize)
    : null;
  const physicalSeats = PHYSICAL_SEATS[data.table.tableSize];
  const seatedIds = useMemo(
    () => new Set(data.seats.map((seat) => seat.playerId)),
    [data.seats],
  );
  const availablePlayers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.players.filter(
      (player) =>
        !seatedIds.has(player.id) &&
        (!query || player.name.toLowerCase().includes(query)),
    );
  }, [data.players, search, seatedIds]);

  const selectedCounts = selectedPlayer ? data.counts[selectedPlayer.id] ?? {} : {};
  const selectedHud = selectedPlayer ? data.hudStats[selectedPlayer.id] : undefined;
  const selectedRecentHands = useMemo(
    () => selectedPlayer
      ? data.recentHands
          .filter((hand) => hand.observations.some((item) => item.playerId === selectedPlayer.id))
          .slice(0, 6)
      : [],
    [data.recentHands, selectedPlayer],
  );
  const preflopTotal = sumCounts(selectedCounts.preflop);
  const postflopTotal = sumCounts(selectedCounts.postflop);
  const bluffShown = selectedCounts.showdown?.["bluff-shown"] ?? 0;
  const valueShown = selectedCounts.showdown?.["value-shown"] ?? 0;
  const showdownTotal = bluffShown + valueShown;
  const revealedBluffRate = showdownTotal
    ? `${Math.round((bluffShown / showdownTotal) * 100)}%`
    : "—";
  const tableSample = Math.max(0, ...Object.values(data.hudStats).map((stats) => stats.sampleHands));

  function openPlayer(playerId: string) {
    setSelectedId(playerId);
    setPanelTab("quick");
    if (window.matchMedia("(max-width: 980px)").matches) {
      window.setTimeout(
        () => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        0,
      );
    }
  }

  function createPlayer() {
    const name = newName.trim();
    if (!name || addDestination === null) return;
    const id = crypto.randomUUID();
    enqueueMutation({
      type: "createPlayer",
      id,
      name,
      seatNo: addDestination === "pool" ? null : addDestination,
    });
    setSelectedId(id);
    setPanelTab("quick");
    setNewName("");
    setSearch("");
    setAddDestination(null);
  }

  function seatExisting(playerId: string) {
    if (addDestination === null || addDestination === "pool") return;
    enqueueMutation({ type: "assignSeat", seatNo: addDestination, playerId });
    setSelectedId(playerId);
    setPanelTab("quick");
    setSearch("");
    setAddDestination(null);
  }

  function advanceHand() {
    enqueueMutation({ type: "advanceHand", id: crypto.randomUUID() });
    setLastLog(null);
    if ("vibrate" in navigator) navigator.vibrate([12, 35, 12]);
  }

  function changeTableSize(tableSize: TableSize) {
    if (tableSize === data.table.tableSize) return;
    setAddDestination(null);
    enqueueMutation({ type: "setTableSize", tableSize, handId: crypto.randomUUID() });
  }

  function updatePlayer(patch: PlayerPatch, defer = false) {
    if (!selectedPlayer) return;
    enqueueMutation({ type: "updatePlayer", playerId: selectedPlayer.id, patch }, defer);
  }

  function toggleTag(field: "preflopTags" | "postflopTags", tag: string) {
    if (!selectedPlayer) return;
    const current = selectedPlayer[field];
    const next = current.includes(tag)
      ? current.filter((item) => item !== tag)
      : [...current, tag];
    updatePlayer({ [field]: next });
  }

  function logAction(definition: ActionDefinition) {
    if (!selectedPlayer) return;
    const id = crypto.randomUUID();
    enqueueMutation({
      type: "addObservation",
      id,
      playerId: selectedPlayer.id,
      phase: definition.phase,
      action: definition.action,
      handId: data.table.currentHandId || undefined,
      handNumber: data.table.handNumber,
      seatNo: selectedSeat,
      position: selectedPosition?.short,
    });
    setLastLog({ ...definition, id, playerId: selectedPlayer.id, playerName: selectedPlayer.name });
    if ("vibrate" in navigator) navigator.vibrate(12);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setLastLog(null), 4500);
  }

  function undoLastLog() {
    if (!lastLog) return;
    enqueueMutation({
      type: "undoObservation",
      observationId: lastLog.id,
      playerId: lastLog.playerId,
      phase: lastLog.phase,
      action: lastLog.action,
    });
    setLastLog(null);
  }

  function removePlayer() {
    if (!removeCandidate) return;
    enqueueMutation({ type: "archivePlayer", playerId: removeCandidate.id });
    if (selectedId === removeCandidate.id) {
      setSelectedId(null);
      setPanelTab("quick");
    }
    if (lastLog?.playerId === removeCandidate.id) setLastLog(null);
    setRemoveCandidate(null);
  }

  function countFor(definition: ActionDefinition) {
    return selectedCounts[definition.phase]?.[definition.action] ?? 0;
  }

  function renderActionGroup(title: string, helper: string, actions: ActionDefinition[]) {
    return (
      <section className="action-group">
        <div className="panel-label-row">
          <h3>{title}</h3>
          <span>{helper}</span>
        </div>
        <div className={`action-grid action-grid--${actions.length}`}>
          {actions.map((definition) => (
            <button
              key={`${definition.phase}-${definition.action}`}
              type="button"
              className={definition.tone ? `action-button action-button--${definition.tone}` : "action-button"}
              onClick={() => logAction(definition)}
              aria-label={`Log ${definition.label} for ${selectedPlayer?.name}`}
            >
              <span className="action-glyph">{definition.glyph}</span>
              <span className="action-copy">
                <strong>{definition.label}</strong>
                <small>{countFor(definition)} logged</small>
              </span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><LogoMark /></span>
          <span>
            <strong>TableRead</strong>
            <small>Live poker intel</small>
          </span>
        </div>
        <button
          className={`save-status save-status--${status}`}
          type="button"
          onClick={() => void flushQueue().then((synced) => synced && loadState())}
          aria-label={status === "queued" ? "Retry syncing saved changes" : "Save status"}
        >
          <span />
          {status === "loading" && "Loading"}
          {status === "saving" && "Syncing"}
          {status === "saved" && "Live"}
          {status === "queued" && "Waiting to sync"}
          {status === "error" && "Tap to retry"}
        </button>
      </header>

      <div className="workspace">
        <section className="table-section" aria-labelledby="table-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Current lineup</p>
              <h1 id="table-heading">{data.table.tableSize}-max table</h1>
            </div>
            <div className="table-heading-actions">
              <div className="table-size-switch" role="group" aria-label="Table session size">
                {TABLE_SIZES.map((tableSize) => (
                  <button
                    key={tableSize}
                    type="button"
                    className={data.table.tableSize === tableSize ? "is-active" : ""}
                    aria-pressed={data.table.tableSize === tableSize}
                    onClick={() => changeTableSize(tableSize)}
                  >
                    {tableSize}-player
                  </button>
                ))}
              </div>
              {data.seats.length > 0 && (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => enqueueMutation({ type: "clearSeats", handId: crypto.randomUUID() })}
                >
                  Clear seats
                </button>
              )}
            </div>
          </div>

          <div className="live-session-strip" aria-label="Current hand summary">
            <div><span>Hand</span><strong>#{data.table.handNumber}</strong></div>
            <div><span>Dealer</span><strong>BTN</strong><small>Next: SB</small></div>
            <div><span>Sample</span><strong>{tableSample}</strong><small>max observed hands</small></div>
          </div>

          <div className={`table-wrap table-wrap--${data.table.tableSize}`}>
            <div className="felt-table">
              <span className="table-kicker">HAND {data.table.handNumber}</span>
              <button
                className="next-hand-button"
                type="button"
                onClick={advanceHand}
                aria-label="Start the next hand and move every poker position one player clockwise"
              >
                <span className="dealer-chip" aria-hidden="true">D</span>
                <span className="next-hand-copy">
                  <strong>Move dealer</strong>
                  <small>Start next hand</small>
                </span>
              </button>
              <span className="table-seated">
                {data.seats.length}/{data.table.tableSize} players seated
              </span>
            </div>

            {physicalSeats.map((seatNo) => {
              const position = positionForSeat(
                seatNo,
                data.table.positionOffset,
                data.table.tableSize,
              );
              const playerId = seatsByNumber.get(seatNo);
              const player = playerId ? playersById.get(playerId) : undefined;
              const isSelected = player?.id === selectedId;
              const hud = player ? data.hudStats[player.id] : undefined;
              return (
                <button
                  className={`seat seat--${seatNo}${isSelected ? " seat--selected" : ""}`}
                  key={seatNo}
                  type="button"
                  onClick={() => {
                    if (player) openPlayer(player.id);
                    else setAddDestination(seatNo);
                  }}
                  aria-label={
                    player
                      ? `Open reads for ${player.name} in the ${position.name} position`
                      : `Add player to the ${position.name} position`
                  }
                >
                  <span
                    className={`seat-position${position.short === "BTN" ? " seat-position--button" : ""}`}
                    title={position.name}
                  >
                    {position.short}
                  </span>
                  {player ? (
                    <>
                      <span className="avatar seat-avatar">{playerInitials(player.name)}</span>
                      <span className="seat-copy seat-copy--hud">
                        <strong>{player.name}</strong>
                        {hud?.sampleHands ? (
                          <>
                            <span className="seat-hud-line" title="Observed VPIP / PFR / 3-bet">
                              <b>{hudValue(hud.vpipPct)}</b><i>/</i><b>{hudValue(hud.pfrPct)}</b><i>/</i><b>{hudValue(hud.threeBetPct)}</b>
                            </span>
                            <small>{hud.sampleHands} hands · VPIP / PFR / 3B</small>
                          </>
                        ) : (
                          <small>{position.short} · {STYLE_LABELS[player.playStyle]} · no hand sample yet</small>
                        )}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="avatar avatar--empty"><PlusIcon /></span>
                      <span className="seat-copy">
                        <strong>Add player</strong>
                        <small>{position.name}</small>
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <aside className="intel-panel" aria-label="Player details" ref={panelRef}>
          {selectedPlayer ? (
            <>
              <div className="player-heading">
                <span className="avatar avatar--large">{playerInitials(selectedPlayer.name)}</span>
                <div className="player-title-copy">
                  <p className="eyebrow">
                    {selectedPosition
                      ? `${selectedPosition.name} · ${selectedPosition.short}`
                      : "Player pool"}
                  </p>
                  <h2>{selectedPlayer.name}</h2>
                  <span>{STYLE_LABELS[selectedPlayer.playStyle]} · {BLUFF_LABELS[selectedPlayer.bluffLevel]} bluffs</span>
                </div>
                {selectedSeat && (
                  <button
                    className="unseat-button"
                    type="button"
                    onClick={() => enqueueMutation({ type: "assignSeat", seatNo: selectedSeat, playerId: null })}
                  >
                    Unseat
                  </button>
                )}
              </div>

              <div className="panel-tabs" role="tablist" aria-label="Player tracking views">
                <button
                  type="button"
                  role="tab"
                  aria-selected={panelTab === "quick"}
                  className={panelTab === "quick" ? "is-active" : ""}
                  onClick={() => setPanelTab("quick")}
                >
                  Quick log
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={panelTab === "profile"}
                  className={panelTab === "profile" ? "is-active" : ""}
                  onClick={() => setPanelTab("profile")}
                >
                  Full profile
                </button>
              </div>

              {panelTab === "quick" ? (
                <div className="quick-panel" role="tabpanel">
                  <div className="hud-stat-strip" aria-label="Observed poker HUD statistics">
                    <div><strong>{hudValue(selectedHud?.vpipPct)}</strong><span>VPIP</span><small>n={selectedHud?.sampleHands ?? 0}</small></div>
                    <div><strong>{hudValue(selectedHud?.pfrPct)}</strong><span>PFR</span><small>n={selectedHud?.sampleHands ?? 0}</small></div>
                    <div><strong>{hudValue(selectedHud?.threeBetPct)}</strong><span>3-Bet</span><small>n={selectedHud?.threeBetOpportunities ?? 0} known opps</small></div>
                  </div>
                  <p className="hud-stat-note">HUD percentages use hand-linked observations only. Legacy aggregate reads stay available below but do not enter these denominators.</p>
                  {renderActionGroup("Pre-Flop", "one tap per observed action", PREFLOP_ACTIONS)}
                  {renderActionGroup("Post-Flop", "log the defining action", POSTFLOP_ACTIONS)}
                  {renderActionGroup("Showdown Evidence", "kept separate from action stats", SHOWDOWN_ACTIONS)}

                  <section className="hand-timeline" aria-labelledby="hand-timeline-heading">
                    <div className="panel-label-row">
                      <h3 id="hand-timeline-heading">Recent hand evidence</h3>
                      <span>sample-aware history</span>
                    </div>
                    {selectedRecentHands.length ? (
                      <div className="hand-timeline-list">
                        {selectedRecentHands.map((hand) => {
                          const observations = hand.observations.filter((item) => item.playerId === selectedPlayer.id);
                          return (
                            <article key={hand.id} className="hand-timeline-item">
                              <div className="hand-timeline-head">
                                <strong>Hand #{hand.handNumber}</strong>
                                <span>{observations[0]?.position || "—"}</span>
                              </div>
                              <div className="hand-evidence-chips">
                                {observations.map((item) => (
                                  <span key={item.id} data-phase={item.phase}>
                                    {item.phase === "preflop" ? "PF" : item.phase === "postflop" ? "POST" : "SD"} · {ACTION_LABELS.get(item.action) ?? item.action}
                                  </span>
                                ))}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="timeline-empty">New actions will appear here grouped by hand after they sync.</p>
                    )}
                  </section>

                  <div className="legacy-read-summary">
                    <span>{preflopTotal} pre-flop reads</span>
                    <span>{postflopTotal} post-flop reads</span>
                    <span>{revealedBluffRate} shown bluffs · n={showdownTotal}</span>
                  </div>
                  <p className="quick-tip">Counts are direct observations. Showdown evidence remains separate from ordinary post-flop action, and only hand-linked evidence contributes to HUD percentages.</p>
                </div>
              ) : (
                <div className="profile-panel" role="tabpanel">
                  <section className="profile-block profile-block--identity">
                    <label htmlFor="profile-player-name">Player name</label>
                    <input
                      id="profile-player-name"
                      maxLength={80}
                      value={selectedPlayer.name}
                      onChange={(event) => updatePlayer({ name: event.target.value }, true)}
                    />
                  </section>

                  <section className="profile-block">
                    <div className="panel-label-row"><h3>Play style</h3><span>overall classification</span></div>
                    <div className="style-grid">
                      {PLAY_STYLES.map((style) => (
                        <button
                          className={selectedPlayer.playStyle === style ? "is-active" : ""}
                          type="button"
                          key={style}
                          onClick={() => updatePlayer({ playStyle: style })}
                        >
                          {STYLE_LABELS[style]}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="profile-block">
                    <div className="panel-label-row"><h3>Bluff estimate</h3><span>your current read</span></div>
                    <div className="bluff-scale">
                      {BLUFF_LABELS.map((label, index) => (
                        <button
                          key={label}
                          type="button"
                          className={selectedPlayer.bluffLevel === index ? "is-active" : ""}
                          onClick={() => updatePlayer({ bluffLevel: index })}
                        >
                          <span>{index === 0 ? "?" : index}</span>{label}
                        </button>
                      ))}
                    </div>
                    <p className="field-help">Shown-card evidence stays separate in Quick log so estimates never masquerade as facts.</p>
                  </section>

                  <section className="profile-block">
                    <div className="panel-label-row"><h3>Pre-flop reads</h3><span>tap all that apply</span></div>
                    <div className="tag-grid">
                      {PREFLOP_TAGS.map((tag) => (
                        <button
                          type="button"
                          key={tag}
                          aria-pressed={selectedPlayer.preflopTags.includes(tag)}
                          className={selectedPlayer.preflopTags.includes(tag) ? "is-active" : ""}
                          onClick={() => toggleTag("preflopTags", tag)}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                    <label className="notes-label" htmlFor="preflop-notes">Pre-flop notes</label>
                    <textarea
                      id="preflop-notes"
                      rows={3}
                      maxLength={2000}
                      placeholder="Sizing tells, position leaks, unusual ranges…"
                      value={selectedPlayer.preflopNotes}
                      onChange={(event) => updatePlayer({ preflopNotes: event.target.value }, true)}
                    />
                  </section>

                  <section className="profile-block">
                    <div className="panel-label-row"><h3>Post-flop reads</h3><span>tap all that apply</span></div>
                    <div className="tag-grid">
                      {POSTFLOP_TAGS.map((tag) => (
                        <button
                          type="button"
                          key={tag}
                          aria-pressed={selectedPlayer.postflopTags.includes(tag)}
                          className={selectedPlayer.postflopTags.includes(tag) ? "is-active" : ""}
                          onClick={() => toggleTag("postflopTags", tag)}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                    <label className="notes-label" htmlFor="postflop-notes">Post-flop notes</label>
                    <textarea
                      id="postflop-notes"
                      rows={3}
                      maxLength={2000}
                      placeholder="C-bet sizing, turn behavior, river decisions…"
                      value={selectedPlayer.postflopNotes}
                      onChange={(event) => updatePlayer({ postflopNotes: event.target.value }, true)}
                    />
                  </section>

                  <section className="profile-block profile-block--split">
                    <div>
                      <label className="notes-label notes-label--top" htmlFor="tells-notes">Physical / timing tells</label>
                      <textarea
                        id="tells-notes"
                        rows={4}
                        maxLength={2000}
                        placeholder="Long tank then raise = strength…"
                        value={selectedPlayer.tellsNotes}
                        onChange={(event) => updatePlayer({ tellsNotes: event.target.value }, true)}
                      />
                    </div>
                    <div>
                      <label className="notes-label notes-label--top" htmlFor="showdown-notes">Showdown notes</label>
                      <textarea
                        id="showdown-notes"
                        rows={4}
                        maxLength={2000}
                        placeholder="Called 3-bet with AJo; overvalued top pair…"
                        value={selectedPlayer.showdownNotes}
                        onChange={(event) => updatePlayer({ showdownNotes: event.target.value }, true)}
                      />
                    </div>
                  </section>

                  <section className="profile-block profile-block--danger">
                    <div>
                      <h3>Remove from player log</h3>
                      <p>Removes this player from saved players and clears their table seat.</p>
                    </div>
                    <button
                      className="remove-player-button"
                      type="button"
                      onClick={() => setRemoveCandidate({ id: selectedPlayer.id, name: selectedPlayer.name })}
                    >
                      Remove player
                    </button>
                  </section>
                </div>
              )}
            </>
          ) : (
            <div className="panel-empty">
              <span className="panel-empty-icon"><UserIcon /></span>
              <h2>Select a player</h2>
              <p>Tap any occupied seat to log actions and open their full read.</p>
            </div>
          )}
        </aside>
      </div>

      <section className="roster-section" aria-labelledby="roster-heading">
        <div className="section-heading section-heading--compact">
          <div>
            <p className="eyebrow">Player pool</p>
            <h2 id="roster-heading">Saved players</h2>
          </div>
          <div className="roster-actions">
            <span className="count-pill">{data.players.length}</span>
            <button
              className="add-pool-button"
              type="button"
              onClick={() => setAddDestination("pool")}
            >
              + Add player
            </button>
          </div>
        </div>
        {data.players.length === 0 ? (
          <div className="roster-empty">Add a player here to save their profile without seating them at the table.</div>
        ) : (
          <div className="roster-list">
            {data.players.map((player) => {
              const evidence = sumCounts(data.counts[player.id]?.preflop) + sumCounts(data.counts[player.id]?.postflop);
              const hud = data.hudStats[player.id];
              return (
                <button key={player.id} type="button" onClick={() => openPlayer(player.id)}>
                  <span className="avatar">{playerInitials(player.name)}</span>
                  <span className="roster-copy">
                    <strong>{player.name}</strong>
                    <small>
                      {seatedIds.has(player.id) ? "At table" : STYLE_LABELS[player.playStyle]} · {hud?.sampleHands ?? 0} hands · {evidence} reads
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {addDestination !== null && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setAddDestination(null)}>
          <section
            className="player-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-player-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-handle" />
            <div className="modal-heading">
              <div>
                <p className="eyebrow">
                  {addDestination === "pool"
                    ? "Player pool"
                    : positionForSeat(
                        addDestination,
                        data.table.positionOffset,
                        data.table.tableSize,
                      ).name}
                </p>
                <h2 id="add-player-title">
                  {addDestination === "pool" ? "Save a new player" : "Add a player"}
                </h2>
              </div>
              <button className="close-button" type="button" onClick={() => setAddDestination(null)} aria-label="Close">×</button>
            </div>
            <label className="field-label" htmlFor="player-name">New player name</label>
            <div className="inline-form">
              <input
                id="player-name"
                value={newName}
                maxLength={80}
                autoFocus
                autoComplete="off"
                placeholder="Name or screen name"
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") createPlayer(); }}
              />
              <button type="button" disabled={!newName.trim()} onClick={createPlayer}>
                {addDestination === "pool" ? "Save" : "Add"}
              </button>
            </div>
            {addDestination !== "pool" && data.players.length > 0 && (
              <>
                <div className="divider"><span>or seat someone saved</span></div>
                <input
                  className="search-input"
                  value={search}
                  placeholder="Search available players"
                  aria-label="Search available players"
                  onChange={(event) => setSearch(event.target.value)}
                />
                <div className="saved-player-list">
                  {availablePlayers.length ? availablePlayers.map((player) => (
                    <button key={player.id} type="button" onClick={() => seatExisting(player.id)}>
                      <span className="avatar">{playerInitials(player.name)}</span>
                      <span><strong>{player.name}</strong><small>{STYLE_LABELS[player.playStyle]}</small></span>
                      <span className="seat-action">Seat</span>
                    </button>
                  )) : <p className="no-results">No available saved players match.</p>}
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {removeCandidate && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setRemoveCandidate(null)}>
          <section
            className="player-modal confirm-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="remove-player-title"
            aria-describedby="remove-player-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-handle" />
            <div className="confirm-modal__icon" aria-hidden="true">!</div>
            <p className="eyebrow">Confirm removal</p>
            <h2 id="remove-player-title">Remove {removeCandidate.name}?</h2>
            <p id="remove-player-description">
              This removes the player from your main log, their table seat, and their logged reads.
            </p>
            <div className="confirm-modal__actions">
              <button className="cancel-remove-button" type="button" onClick={() => setRemoveCandidate(null)} autoFocus>
                Keep player
              </button>
              <button className="confirm-remove-button" type="button" onClick={removePlayer}>
                Remove player
              </button>
            </div>
          </section>
        </div>
      )}

      {errorMessage && (
        <div className="toast toast--error" role="alert">
          <span>{errorMessage}</span>
          <button type="button" onClick={() => { setErrorMessage(null); void flushQueue().then((synced) => synced && loadState()); }}>Retry</button>
        </div>
      )}
      {!errorMessage && lastLog && (
        <div className="toast toast--success" role="status">
          <span><strong>{lastLog.label}</strong> logged for {lastLog.playerName}</span>
          <button type="button" onClick={undoLastLog}>Undo</button>
        </div>
      )}
    </main>
  );
}

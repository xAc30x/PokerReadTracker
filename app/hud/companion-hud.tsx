"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Player, TrackerMutation, TrackerState } from "../tracker-types";

type Street = "flop" | "turn" | "river";
type SessionMode = "cash" | "tournament";
type SyncState = "loading" | "live" | "saving" | "queued" | "error";

type PlayerMeta = {
  stack: string;
  wallet: string;
  color: string;
  sessionNote: string;
};

type HudMeta = {
  sessionMode: SessionMode;
  gameMode: boolean;
  selectedId: string;
  street: Street;
  playerMeta: Record<string, PlayerMeta>;
};

type Action = { id: string; label: string; short: string };

type LastLog = {
  id: string;
  playerId: string;
  label: string;
  phase: "preflop" | "postflop" | "showdown";
  action: string;
};

const EMPTY_STATE: TrackerState = {
  players: [],
  seats: [],
  counts: {},
  hudStats: {},
  recentHands: [],
  table: { positionOffset: 0, handNumber: 1, tableSize: 6, currentHandId: "" },
};

const META_KEY = "tableread.hud.phase2.meta.v1";
const QUEUE_KEY = "tableread.hud.phase2.queue.v1";
const DEFAULT_META: HudMeta = {
  sessionMode: "cash",
  gameMode: false,
  selectedId: "",
  street: "flop",
  playerMeta: {},
};

const PLAYER_COLORS = ["neutral", "green", "yellow", "orange", "red", "blue"] as const;

const PREFLOP_ACTIONS: Action[] = [
  { id: "fold", label: "Fold", short: "F" },
  { id: "limp", label: "Limp", short: "L" },
  { id: "call", label: "Call", short: "C" },
  { id: "open-raise", label: "Open", short: "OR" },
  { id: "three-bet", label: "3-Bet", short: "3B" },
  { id: "four-bet-plus", label: "4-Bet+", short: "4+" },
  { id: "squeeze", label: "Squeeze", short: "SQ" },
  { id: "all-in", label: "All-In", short: "AI" },
];

const STREET_ACTIONS: Action[] = [
  { id: "check", label: "Check", short: "X" },
  { id: "bet", label: "Bet", short: "B" },
  { id: "call", label: "Call", short: "C" },
  { id: "raise", label: "Raise", short: "R+" },
  { id: "fold", label: "Fold", short: "F" },
  { id: "check-raise", label: "Check-Raise", short: "XR" },
  { id: "donk-bet", label: "Donk", short: "DB" },
  { id: "all-in", label: "All-In", short: "AI" },
];

const SHOWDOWN_ACTIONS: Action[] = [
  { id: "bluff-shown", label: "Bluff", short: "BL" },
  { id: "value-shown", label: "Value", short: "V" },
  { id: "draw-shown", label: "Draw", short: "DR" },
  { id: "mucked-unknown", label: "Muck", short: "?" },
];

const POSITION_ORDERS = {
  6: ["BB", "UTG", "HJ", "CO", "BTN", "SB"],
  8: ["BB", "UTG", "UTG+1", "MP", "HJ", "CO", "BTN", "SB"],
} as const;

function safeRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function safeWrite(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local metadata is convenience state. Tracker observations remain server-backed.
  }
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function pct(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `${value}%`;
}

function positionForSeat(seatNo: number, state: TrackerState) {
  const size = state.table.tableSize === 8 ? 8 : 6;
  const offset = ((state.table.positionOffset % size) + size) % size;
  return POSITION_ORDERS[size][(seatNo - 1 - offset + size) % size] ?? "";
}

function optimistic(state: TrackerState, mutation: TrackerMutation): TrackerState {
  if (mutation.type === "addObservation") {
    const playerCounts = state.counts[mutation.playerId] ?? {};
    const phaseCounts = playerCounts[mutation.phase] ?? {};
    return {
      ...state,
      counts: {
        ...state.counts,
        [mutation.playerId]: {
          ...playerCounts,
          [mutation.phase]: {
            ...phaseCounts,
            [mutation.action]: (phaseCounts[mutation.action] ?? 0) + 1,
          },
        },
      },
    };
  }
  if (mutation.type === "undoObservation" && mutation.playerId && mutation.phase && mutation.action) {
    const playerCounts = state.counts[mutation.playerId] ?? {};
    const phaseCounts = playerCounts[mutation.phase] ?? {};
    return {
      ...state,
      counts: {
        ...state.counts,
        [mutation.playerId]: {
          ...playerCounts,
          [mutation.phase]: {
            ...phaseCounts,
            [mutation.action]: Math.max(0, (phaseCounts[mutation.action] ?? 0) - 1),
          },
        },
      },
    };
  }
  if (mutation.type === "advanceHand") {
    return {
      ...state,
      table: {
        ...state.table,
        handNumber: state.table.handNumber + 1,
        positionOffset: (state.table.positionOffset + 1) % state.table.tableSize,
        currentHandId: mutation.id,
      },
    };
  }
  return state;
}

export function CompanionHud() {
  const [data, setData] = useState<TrackerState>(EMPTY_STATE);
  const [meta, setMeta] = useState<HudMeta>(DEFAULT_META);
  const [syncState, setSyncState] = useState<SyncState>("loading");
  const [lastLog, setLastLog] = useState<LastLog | null>(null);
  const [error, setError] = useState("");
  const queueRef = useRef<TrackerMutation[]>([]);
  const flushingRef = useRef(false);

  const saveMeta = useCallback((updater: (current: HudMeta) => HudMeta) => {
    setMeta((current) => {
      const next = updater(current);
      safeWrite(META_KEY, next);
      return next;
    });
  }, []);

  const loadState = useCallback(async () => {
    try {
      const response = await fetch("/api/tracker", { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 401 ? "Sign in required" : "Could not load table");
      const next = (await response.json()) as TrackerState;
      setData(next);
      setError("");
      if (!queueRef.current.length) setSyncState("live");
      return true;
    } catch (reason) {
      setSyncState(queueRef.current.length ? "queued" : "error");
      setError(reason instanceof Error ? reason.message : "Could not load table");
      return false;
    }
  }, []);

  const flushQueue = useCallback(async () => {
    if (flushingRef.current) return false;
    flushingRef.current = true;
    try {
      while (queueRef.current.length) {
        setSyncState("saving");
        let response: Response;
        try {
          response = await fetch("/api/tracker", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(queueRef.current[0]),
          });
        } catch {
          setSyncState("queued");
          return false;
        }
        if (!response.ok) {
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            const body = (await response.json().catch(() => null)) as { error?: string } | null;
            queueRef.current.shift();
            safeWrite(QUEUE_KEY, queueRef.current);
            setError(body?.error ?? "One HUD action was rejected");
            continue;
          }
          setSyncState("queued");
          return false;
        }
        queueRef.current.shift();
        safeWrite(QUEUE_KEY, queueRef.current);
      }
      setSyncState("live");
      return true;
    } finally {
      flushingRef.current = false;
    }
  }, []);

  const enqueue = useCallback((mutation: TrackerMutation) => {
    setData((current) => optimistic(current, mutation));
    queueRef.current.push(mutation);
    safeWrite(QUEUE_KEY, queueRef.current);
    setSyncState("saving");
    void (async () => {
      const synced = await flushQueue();
      if (synced) await loadState();
    })();
  }, [flushQueue, loadState]);

  useEffect(() => {
    const storedMeta = safeRead<HudMeta>(META_KEY, DEFAULT_META);
    setMeta({ ...DEFAULT_META, ...storedMeta, playerMeta: storedMeta.playerMeta ?? {} });
    queueRef.current = safeRead<TrackerMutation[]>(QUEUE_KEY, []);
    void (async () => {
      const synced = await flushQueue();
      if (synced) await loadState();
      else await loadState();
    })();
    const online = () => void flushQueue().then((synced) => synced && loadState());
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [flushQueue, loadState]);

  const playersById = useMemo(() => new Map(data.players.map((player) => [player.id, player])), [data.players]);
  const seatedPlayers = useMemo(() => data.seats
    .slice()
    .sort((a, b) => a.seatNo - b.seatNo)
    .map((seat) => ({ seat, player: playersById.get(seat.playerId) }))
    .filter((item): item is { seat: { seatNo: number; playerId: string }; player: Player } => Boolean(item.player)), [data.seats, playersById]);

  const selectedId = meta.selectedId && playersById.has(meta.selectedId)
    ? meta.selectedId
    : seatedPlayers[0]?.player.id ?? "";
  const selectedPlayer = selectedId ? playersById.get(selectedId) ?? null : null;
  const selectedSeat = selectedId ? data.seats.find((seat) => seat.playerId === selectedId)?.seatNo ?? null : null;
  const selectedPosition = selectedSeat ? positionForSeat(selectedSeat, data) : "";
  const selectedHud = selectedPlayer ? data.hudStats[selectedPlayer.id] : undefined;
  const playerMeta = selectedId
    ? meta.playerMeta[selectedId] ?? { stack: "", wallet: "", color: "neutral", sessionNote: "" }
    : { stack: "", wallet: "", color: "neutral", sessionNote: "" };

  useEffect(() => {
    if (!meta.selectedId && selectedId) {
      saveMeta((current) => ({ ...current, selectedId }));
    }
  }, [meta.selectedId, saveMeta, selectedId]);

  function updatePlayerMeta(patch: Partial<PlayerMeta>) {
    if (!selectedId) return;
    saveMeta((current) => ({
      ...current,
      playerMeta: {
        ...current.playerMeta,
        [selectedId]: {
          stack: "",
          wallet: "",
          color: "neutral",
          sessionNote: "",
          ...(current.playerMeta[selectedId] ?? {}),
          ...patch,
        },
      },
    }));
  }

  function logAction(phase: LastLog["phase"], action: string, label: string) {
    if (!selectedPlayer) return;
    const id = crypto.randomUUID();
    const persistedAction = phase === "postflop" ? `${meta.street}-${action}` : action;
    enqueue({
      type: "addObservation",
      id,
      playerId: selectedPlayer.id,
      phase,
      action: persistedAction,
      handId: data.table.currentHandId || undefined,
      handNumber: data.table.handNumber,
      seatNo: selectedSeat,
      position: selectedPosition,
    });
    setLastLog({ id, playerId: selectedPlayer.id, label, phase, action: persistedAction });
  }

  function undoLast() {
    if (!lastLog) return;
    enqueue({
      type: "undoObservation",
      observationId: lastLog.id,
      playerId: lastLog.playerId,
      phase: lastLog.phase,
      action: lastLog.action,
    });
    setLastLog(null);
  }

  function nextHand() {
    enqueue({ type: "advanceHand", id: crypto.randomUUID() });
    saveMeta((current) => ({ ...current, street: "flop" }));
    setLastLog(null);
  }

  function count(phase: string, action: string) {
    if (!selectedPlayer) return 0;
    return data.counts[selectedPlayer.id]?.[phase]?.[action] ?? 0;
  }

  return (
    <main className={`hud2${meta.gameMode ? " hud2--game" : ""}`}>
      <header className="hud2__topbar">
        <div>
          <span className="hud2__eyebrow">TableRead · iOS HUD</span>
          <strong>{meta.sessionMode === "cash" ? "Cash session" : "Tournament"}</strong>
        </div>
        <button
          type="button"
          className={`hud2__sync hud2__sync--${syncState}`}
          onClick={() => void flushQueue().then((synced) => synced && loadState())}
        >
          {syncState === "loading" ? "Loading" : syncState === "saving" ? "Saving" : syncState === "queued" ? "Offline queue" : syncState === "error" ? "Retry" : "Live"}
        </button>
      </header>

      <section className="hud2__session-bar">
        <div className="hud2__segment" role="group" aria-label="Session type">
          {(["cash", "tournament"] as const).map((mode) => (
            <button key={mode} type="button" className={meta.sessionMode === mode ? "is-active" : ""} onClick={() => saveMeta((current) => ({ ...current, sessionMode: mode }))}>
              {mode === "cash" ? "Cash" : "Tournament"}
            </button>
          ))}
        </div>
        <button type="button" className="hud2__game-toggle" aria-pressed={meta.gameMode} onClick={() => saveMeta((current) => ({ ...current, gameMode: !current.gameMode }))}>
          {meta.gameMode ? "Exit game mode" : "Game mode"}
        </button>
      </section>

      <section className="hud2__handbar">
        <div><span>Hand</span><strong>#{data.table.handNumber}</strong></div>
        <div><span>Table</span><strong>{data.table.tableSize}-max</strong></div>
        <div><span>Street</span><strong>{meta.street.toUpperCase()}</strong></div>
        <button type="button" onClick={nextHand}>Next hand</button>
      </section>

      <nav className="hud2__players" aria-label="Fast player switcher">
        {seatedPlayers.length ? seatedPlayers.map(({ seat, player }) => {
          const local = meta.playerMeta[player.id];
          const position = positionForSeat(seat.seatNo, data);
          return (
            <button
              key={player.id}
              type="button"
              className={player.id === selectedId ? "is-active" : ""}
              data-color={local?.color ?? "neutral"}
              onClick={() => saveMeta((current) => ({ ...current, selectedId: player.id }))}
            >
              <span className="hud2__avatar">{initials(player.name)}</span>
              <span className="hud2__player-copy">
                <strong>{player.name}</strong>
                <small>{position}{local?.stack ? ` · ${local.stack}` : ""}</small>
                {local?.wallet ? <em>Wallet {local.wallet}</em> : null}
              </span>
            </button>
          );
        }) : (
          <div className="hud2__empty">No players are seated. <a href="/">Open full table setup</a>.</div>
        )}
      </nav>

      {selectedPlayer ? (
        <>
          <section className="hud2__player-head" data-color={playerMeta.color}>
            <div className="hud2__avatar hud2__avatar--large">{initials(selectedPlayer.name)}</div>
            <div>
              <span>{selectedPosition || "Player pool"}</span>
              <h1>{selectedPlayer.name}</h1>
              <p>{selectedPlayer.playStyle.toUpperCase()} · {selectedHud?.sampleHands ?? 0} observed hands</p>
            </div>
            <div className="hud2__mini-stats">
              <span><b>{pct(selectedHud?.vpipPct)}</b>VPIP</span>
              <span><b>{pct(selectedHud?.pfrPct)}</b>PFR</span>
              <span><b>{pct(selectedHud?.threeBetPct)}</b>3B</span>
            </div>
          </section>

          <section className="hud2__local-meta hud2__setup-only">
            <label>Stack<input inputMode="decimal" placeholder="e.g. 82 BB" value={playerMeta.stack} onChange={(event) => updatePlayerMeta({ stack: event.target.value.slice(0, 24) })} /></label>
            <label>Wallet<input inputMode="decimal" placeholder="$ / chips" value={playerMeta.wallet} onChange={(event) => updatePlayerMeta({ wallet: event.target.value.slice(0, 24) })} /></label>
            <div className="hud2__colors" aria-label="Player color tag">
              {PLAYER_COLORS.map((color) => <button key={color} type="button" data-color={color} className={playerMeta.color === color ? "is-active" : ""} aria-label={`Tag ${selectedPlayer.name} ${color}`} onClick={() => updatePlayerMeta({ color })} />)}
            </div>
          </section>

          <section className="hud2__block">
            <div className="hud2__block-title"><h2>Pre-Flop</h2><span>manual observations</span></div>
            <div className="hud2__actions">
              {PREFLOP_ACTIONS.map((action) => (
                <button key={action.id} type="button" onClick={() => logAction("preflop", action.id, action.label)}>
                  <b>{action.short}</b><span>{action.label}</span><small>{count("preflop", action.id)}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="hud2__block hud2__street-block">
            <div className="hud2__street-tabs" role="tablist" aria-label="Post-flop street">
              {(["flop", "turn", "river"] as const).map((street) => (
                <button key={street} type="button" role="tab" aria-selected={meta.street === street} className={meta.street === street ? "is-active" : ""} onClick={() => saveMeta((current) => ({ ...current, street }))}>{street}</button>
              ))}
            </div>
            <div className="hud2__actions">
              {STREET_ACTIONS.map((action) => {
                const persisted = `${meta.street}-${action.id}`;
                return (
                  <button key={action.id} type="button" onClick={() => logAction("postflop", action.id, `${meta.street} ${action.label}`)}>
                    <b>{action.short}</b><span>{action.label}</span><small>{count("postflop", persisted)}</small>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="hud2__block hud2__setup-only">
            <div className="hud2__block-title"><h2>Showdown</h2><span>evidence only</span></div>
            <div className="hud2__actions hud2__actions--four">
              {SHOWDOWN_ACTIONS.map((action) => (
                <button key={action.id} type="button" onClick={() => logAction("showdown", action.id, action.label)}>
                  <b>{action.short}</b><span>{action.label}</span><small>{count("showdown", action.id)}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="hud2__notes hud2__setup-only">
            <label htmlFor="hud-session-note">Session note for {selectedPlayer.name}</label>
            <textarea id="hud-session-note" rows={3} maxLength={1200} placeholder="Session-specific read, sizing tell, table dynamic…" value={playerMeta.sessionNote} onChange={(event) => updatePlayerMeta({ sessionNote: event.target.value })} />
          </section>
        </>
      ) : null}

      <footer className="hud2__footer">
        <a href="/">Full tracker</a>
        <span>Manual observation HUD · no solver/RTA</span>
      </footer>

      {lastLog ? (
        <div className="hud2__toast" role="status"><span><strong>{lastLog.label}</strong> logged</span><button type="button" onClick={undoLast}>Undo</button></div>
      ) : null}
      {error ? <div className="hud2__error" role="alert">{error}</div> : null}
    </main>
  );
}

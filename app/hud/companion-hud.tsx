"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Player, TrackerMutation, TrackerState } from "../tracker-types";

type Street = "flop" | "turn" | "river";
type SessionMode = "cash" | "tournament";
type SyncState = "loading" | "live" | "saving" | "queued" | "error";
type Phase = "preflop" | "postflop" | "showdown";
type PlayerMeta = { stack: string; wallet: string; color: string; sessionNote: string };
type StreetLog = { id: string; playerId: string; handNumber: number; street: Street; action: string; label: string; createdAt: string };
type HudMeta = { sessionMode: SessionMode; gameMode: boolean; selectedId: string; street: Street; playerMeta: Record<string, PlayerMeta>; streetLogs: StreetLog[] };
type Action = { id: string; label: string; short: string };
type LastLog = { id: string; playerId: string; label: string; phase: Phase; action: string; streetLogId?: string };

const EMPTY_STATE: TrackerState = { players: [], seats: [], counts: {}, hudStats: {}, recentHands: [], table: { positionOffset: 0, handNumber: 1, tableSize: 6, currentHandId: "" } };
const META_KEY = "tableread.hud.phase2.meta.v2";
const QUEUE_KEY = "tableread.hud.phase2.queue.v1";
const DEFAULT_META: HudMeta = { sessionMode: "cash", gameMode: false, selectedId: "", street: "flop", playerMeta: {}, streetLogs: [] };
const COLORS = ["neutral", "green", "yellow", "orange", "red", "blue"] as const;
const PREFLOP: Action[] = [
  { id: "fold", label: "Fold", short: "F" }, { id: "limp", label: "Limp", short: "L" }, { id: "call", label: "Call", short: "C" },
  { id: "open-raise", label: "Open", short: "OR" }, { id: "three-bet", label: "3-Bet", short: "3B" }, { id: "four-bet-plus", label: "4-Bet+", short: "4+" },
  { id: "squeeze", label: "Squeeze", short: "SQ" }, { id: "all-in", label: "All-In", short: "AI" },
];
const POSTFLOP: Action[] = [
  { id: "check", label: "Check", short: "X" }, { id: "bet", label: "Bet", short: "B" }, { id: "call", label: "Call", short: "C" },
  { id: "postflop-raise", label: "Raise", short: "R+" }, { id: "postflop-fold", label: "Fold", short: "F" }, { id: "check-raise", label: "Check-Raise", short: "XR" },
  { id: "donk-bet", label: "Donk", short: "DB" }, { id: "postflop-all-in", label: "All-In", short: "AI" },
];
const SHOWDOWN: Action[] = [
  { id: "bluff-shown", label: "Bluff", short: "BL" }, { id: "value-shown", label: "Value", short: "V" }, { id: "draw-shown", label: "Draw", short: "DR" },
  { id: "mucked-unknown", label: "Muck", short: "?" },
];
const POSITIONS = { 6: ["BB", "UTG", "HJ", "CO", "BTN", "SB"], 8: ["BB", "UTG", "UTG+1", "MP", "HJ", "CO", "BTN", "SB"] } as const;

function readLocal<T>(key: string, fallback: T): T { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } }
function writeLocal(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
function initialMeta(): HudMeta {
  if (typeof window === "undefined") return DEFAULT_META;
  const stored = readLocal<HudMeta>(META_KEY, DEFAULT_META);
  return { ...DEFAULT_META, ...stored, playerMeta: stored.playerMeta ?? {}, streetLogs: stored.streetLogs ?? [] };
}
function initialQueue(): TrackerMutation[] { return typeof window === "undefined" ? [] : readLocal<TrackerMutation[]>(QUEUE_KEY, []); }
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join(""); }
function pct(value: number | null | undefined) { return value == null ? "—" : `${value}%`; }
function seatPosition(seatNo: number, state: TrackerState) {
  const size = state.table.tableSize === 8 ? 8 : 6;
  const offset = ((state.table.positionOffset % size) + size) % size;
  return POSITIONS[size][(seatNo - 1 - offset + size) % size] ?? "";
}
function optimistic(state: TrackerState, mutation: TrackerMutation): TrackerState {
  if (mutation.type === "addObservation") {
    const byPlayer = state.counts[mutation.playerId] ?? {}; const byPhase = byPlayer[mutation.phase] ?? {};
    return { ...state, counts: { ...state.counts, [mutation.playerId]: { ...byPlayer, [mutation.phase]: { ...byPhase, [mutation.action]: (byPhase[mutation.action] ?? 0) + 1 } } } };
  }
  if (mutation.type === "undoObservation" && mutation.playerId && mutation.phase && mutation.action) {
    const byPlayer = state.counts[mutation.playerId] ?? {}; const byPhase = byPlayer[mutation.phase] ?? {};
    return { ...state, counts: { ...state.counts, [mutation.playerId]: { ...byPlayer, [mutation.phase]: { ...byPhase, [mutation.action]: Math.max(0, (byPhase[mutation.action] ?? 0) - 1) } } } };
  }
  if (mutation.type === "advanceHand") return { ...state, table: { ...state.table, handNumber: state.table.handNumber + 1, positionOffset: (state.table.positionOffset + 1) % state.table.tableSize, currentHandId: mutation.id } };
  return state;
}

export function CompanionHud() {
  const [data, setData] = useState<TrackerState>(EMPTY_STATE);
  const [meta, setMeta] = useState<HudMeta>(initialMeta);
  const [sync, setSync] = useState<SyncState>("loading");
  const [lastLog, setLastLog] = useState<LastLog | null>(null);
  const [error, setError] = useState("");
  const queue = useRef<TrackerMutation[]>(initialQueue());
  const flushing = useRef(false);

  const saveMeta = useCallback((fn: (current: HudMeta) => HudMeta) => {
    setMeta((current) => { const next = fn(current); writeLocal(META_KEY, next); return next; });
  }, []);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/tracker", { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 401 ? "Sign in required" : "Could not load table");
      setData(await response.json() as TrackerState); setError(""); if (!queue.current.length) setSync("live"); return true;
    } catch (e) { setSync(queue.current.length ? "queued" : "error"); setError(e instanceof Error ? e.message : "Could not load table"); return false; }
  }, []);
  const flush = useCallback(async () => {
    if (flushing.current) return false;
    flushing.current = true;
    try {
      while (queue.current.length) {
        setSync("saving");
        let response: Response;
        try { response = await fetch("/api/tracker", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(queue.current[0]) }); }
        catch { setSync("queued"); return false; }
        if (!response.ok) {
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            const body = await response.json().catch(() => null) as { error?: string } | null;
            queue.current.shift(); writeLocal(QUEUE_KEY, queue.current); setError(body?.error ?? "HUD action rejected"); continue;
          }
          setSync("queued"); return false;
        }
        queue.current.shift(); writeLocal(QUEUE_KEY, queue.current);
      }
      setSync("live"); return true;
    } finally { flushing.current = false; }
  }, []);
  const enqueue = useCallback((mutation: TrackerMutation) => {
    setData((current) => optimistic(current, mutation)); queue.current.push(mutation); writeLocal(QUEUE_KEY, queue.current); setSync("saving");
    void flush().then((ok) => ok && load());
  }, [flush, load]);

  useEffect(() => {
    void flush().then(() => load());
    const onOnline = () => void flush().then((ok) => ok && load());
    window.addEventListener("online", onOnline); return () => window.removeEventListener("online", onOnline);
  }, [flush, load]);

  const byId = useMemo(() => new Map(data.players.map((p) => [p.id, p])), [data.players]);
  const seated = useMemo(() => data.seats.slice().sort((a, b) => a.seatNo - b.seatNo).map((seat) => ({ seat, player: byId.get(seat.playerId) })).filter((x): x is { seat: { seatNo: number; playerId: string }; player: Player } => Boolean(x.player)), [byId, data.seats]);
  const selectedId = meta.selectedId && byId.has(meta.selectedId) ? meta.selectedId : seated[0]?.player.id ?? "";
  const player = selectedId ? byId.get(selectedId) ?? null : null;
  const seatNo = selectedId ? data.seats.find((s) => s.playerId === selectedId)?.seatNo ?? null : null;
  const position = seatNo ? seatPosition(seatNo, data) : "";
  const hud = player ? data.hudStats[player.id] : undefined;
  const local = selectedId ? meta.playerMeta[selectedId] ?? { stack: "", wallet: "", color: "neutral", sessionNote: "" } : { stack: "", wallet: "", color: "neutral", sessionNote: "" };

  function patchPlayer(patch: Partial<PlayerMeta>) {
    if (!selectedId) return;
    saveMeta((m) => ({ ...m, playerMeta: { ...m.playerMeta, [selectedId]: { stack: "", wallet: "", color: "neutral", sessionNote: "", ...(m.playerMeta[selectedId] ?? {}), ...patch } } }));
  }
  function count(phase: string, action: string) { return player ? data.counts[player.id]?.[phase]?.[action] ?? 0 : 0; }
  function streetCount(action: string) { return meta.streetLogs.filter((x) => x.playerId === selectedId && x.street === meta.street && x.action === action).length; }
  function log(phase: Phase, action: string, label: string) {
    if (!player) return;
    const id = crypto.randomUUID(); let streetLogId: string | undefined;
    if (phase === "postflop") {
      streetLogId = crypto.randomUUID();
      const entry: StreetLog = { id: streetLogId, playerId: player.id, handNumber: data.table.handNumber, street: meta.street, action, label, createdAt: new Date().toISOString() };
      saveMeta((m) => ({ ...m, streetLogs: [...m.streetLogs.slice(-499), entry] }));
    }
    enqueue({ type: "addObservation", id, playerId: player.id, phase, action, handId: data.table.currentHandId || undefined, handNumber: data.table.handNumber, seatNo, position });
    setLastLog({ id, playerId: player.id, label: phase === "postflop" ? `${meta.street} ${label}` : label, phase, action, streetLogId });
  }
  function undo() {
    if (!lastLog) return;
    enqueue({ type: "undoObservation", observationId: lastLog.id, playerId: lastLog.playerId, phase: lastLog.phase, action: lastLog.action });
    if (lastLog.streetLogId) saveMeta((m) => ({ ...m, streetLogs: m.streetLogs.filter((x) => x.id !== lastLog.streetLogId) }));
    setLastLog(null);
  }
  function nextHand() { enqueue({ type: "advanceHand", id: crypto.randomUUID() }); saveMeta((m) => ({ ...m, street: "flop" })); setLastLog(null); }

  return <main className={`hud2${meta.gameMode ? " hud2--game" : ""}`}>
    <header className="hud2__topbar"><div><span className="hud2__eyebrow">TableRead · iOS HUD</span><strong>{meta.sessionMode === "cash" ? "Cash session" : "Tournament"}</strong></div><button type="button" className={`hud2__sync hud2__sync--${sync}`} onClick={() => void flush().then((ok) => ok && load())}>{sync === "loading" ? "Loading" : sync === "saving" ? "Saving" : sync === "queued" ? "Offline queue" : sync === "error" ? "Retry" : "Live"}</button></header>
    <section className="hud2__session-bar"><div className="hud2__segment">{(["cash", "tournament"] as const).map((mode) => <button key={mode} type="button" className={meta.sessionMode === mode ? "is-active" : ""} onClick={() => saveMeta((m) => ({ ...m, sessionMode: mode }))}>{mode === "cash" ? "Cash" : "Tournament"}</button>)}</div><button type="button" className="hud2__game-toggle" aria-pressed={meta.gameMode} onClick={() => saveMeta((m) => ({ ...m, gameMode: !m.gameMode }))}>{meta.gameMode ? "Exit game mode" : "Game mode"}</button></section>
    <section className="hud2__handbar"><div><span>Hand</span><strong>#{data.table.handNumber}</strong></div><div><span>Table</span><strong>{data.table.tableSize}-max</strong></div><div><span>Street</span><strong>{meta.street.toUpperCase()}</strong></div><button type="button" onClick={nextHand}>Next hand</button></section>
    <nav className="hud2__players" aria-label="Fast player switcher">{seated.length ? seated.map(({ seat, player: p }) => { const pm = meta.playerMeta[p.id]; return <button key={p.id} type="button" className={p.id === selectedId ? "is-active" : ""} data-color={pm?.color ?? "neutral"} onClick={() => saveMeta((m) => ({ ...m, selectedId: p.id }))}><span className="hud2__avatar">{initials(p.name)}</span><span className="hud2__player-copy"><strong>{p.name}</strong><small>{seatPosition(seat.seatNo, data)}{pm?.stack ? ` · ${pm.stack}` : ""}</small>{pm?.wallet ? <em>Wallet {pm.wallet}</em> : null}</span></button>; }) : <div className="hud2__empty">No players are seated. <Link href="/">Open full table setup</Link>.</div>}</nav>
    {player ? <>
      <section className="hud2__player-head" data-color={local.color}><div className="hud2__avatar hud2__avatar--large">{initials(player.name)}</div><div><span>{position || "Player pool"}</span><h1>{player.name}</h1><p>{player.playStyle.toUpperCase()} · {hud?.sampleHands ?? 0} observed hands</p></div><div className="hud2__mini-stats"><span><b>{pct(hud?.vpipPct)}</b>VPIP</span><span><b>{pct(hud?.pfrPct)}</b>PFR</span><span><b>{pct(hud?.threeBetPct)}</b>3B</span></div></section>
      <section className="hud2__local-meta hud2__setup-only"><label>Stack<input inputMode="decimal" placeholder="e.g. 82 BB" value={local.stack} onChange={(e) => patchPlayer({ stack: e.target.value.slice(0, 24) })} /></label><label>Wallet<input inputMode="decimal" placeholder="$ / chips" value={local.wallet} onChange={(e) => patchPlayer({ wallet: e.target.value.slice(0, 24) })} /></label><div className="hud2__colors">{COLORS.map((color) => <button key={color} type="button" data-color={color} className={local.color === color ? "is-active" : ""} aria-label={`Tag ${player.name} ${color}`} onClick={() => patchPlayer({ color })} />)}</div></section>
      <section className="hud2__block"><div className="hud2__block-title"><h2>Pre-Flop</h2><span>manual observations</span></div><div className="hud2__actions">{PREFLOP.map((a) => <button key={a.id} type="button" onClick={() => log("preflop", a.id, a.label)}><b>{a.short}</b><span>{a.label}</span><small>{count("preflop", a.id)}</small></button>)}</div></section>
      <section className="hud2__block hud2__street-block"><div className="hud2__street-tabs" role="tablist" aria-label="Post-flop street">{(["flop", "turn", "river"] as const).map((street) => <button key={street} type="button" role="tab" className={meta.street === street ? "is-active" : ""} aria-selected={meta.street === street} onClick={() => saveMeta((m) => ({ ...m, street }))}>{street}</button>)}</div><div className="hud2__actions">{POSTFLOP.map((a) => <button key={a.id} type="button" onClick={() => log("postflop", a.id, a.label)}><b>{a.short}</b><span>{a.label}</span><small>{streetCount(a.id)}</small></button>)}</div></section>
      <section className="hud2__block hud2__setup-only"><div className="hud2__block-title"><h2>Showdown</h2><span>evidence only</span></div><div className="hud2__actions hud2__actions--four">{SHOWDOWN.map((a) => <button key={a.id} type="button" onClick={() => log("showdown", a.id, a.label)}><b>{a.short}</b><span>{a.label}</span><small>{count("showdown", a.id)}</small></button>)}</div></section>
      <section className="hud2__notes hud2__setup-only"><label htmlFor="hud-session-note">Session note for {player.name}</label><textarea id="hud-session-note" rows={3} maxLength={1200} placeholder="Session-specific read, sizing tell, table dynamic…" value={local.sessionNote} onChange={(e) => patchPlayer({ sessionNote: e.target.value })} /></section>
    </> : null}
    <footer className="hud2__footer"><Link href="/">Full tracker</Link><span>Manual observation HUD · no solver/RTA</span></footer>
    {lastLog ? <div className="hud2__toast" role="status"><span><strong>{lastLog.label}</strong> logged</span><button type="button" onClick={undo}>Undo</button></div> : null}
    {error ? <div className="hud2__error" role="alert">{error}</div> : null}
  </main>;
}

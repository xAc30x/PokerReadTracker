"use client";

import { useEffect, useMemo, useState } from "react";
import type { GameResult } from "../game-result-types";
import type { Player, TrackerState } from "../tracker-types";
import styles from "./analytics-dashboard.module.css";

type LoadState = "loading" | "ready" | "error";

type PlayerRead = {
  player: Player;
  total: number;
  preflop: number;
  postflop: number;
  showdown: number;
  aggression: number;
  passive: number;
  folds: number;
  bluffShown: number;
  valueShown: number;
};

const EMPTY_TRACKER: TrackerState = {
  players: [],
  seats: [],
  counts: {},
  table: { positionOffset: 0, handNumber: 1, tableSize: 6 },
};

const STYLE_LABELS: Record<Player["playStyle"], string> = {
  unknown: "Unknown",
  nit: "Nit",
  tag: "TAG",
  lag: "LAG",
  "calling-station": "Calling station",
  maniac: "Maniac",
};

const BLUFF_LABELS = ["Not set", "Rare", "Sometimes", "Often", "Very often"];

function sum(values: Record<string, number> | undefined) {
  return Object.values(values ?? {}).reduce((total, value) => total + value, 0);
}

function actionCount(values: Record<string, number> | undefined, actions: readonly string[]) {
  return actions.reduce((total, action) => total + (values?.[action] ?? 0), 0);
}

function resultNet(result: GameResult) {
  return result.category === "cash"
    ? result.cashOutCents - result.buyInCents
    : result.winningsCents - result.buyInCents - result.rakeCents;
}

function money(cents: number) {
  const absolute = Math.abs(cents) / 100;
  const formatted = absolute.toLocaleString("en-CA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (cents > 0) return `+C$${formatted}`;
  if (cents < 0) return `−C$${formatted}`;
  return "C$0.00";
}

function percentage(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function buildTrendPoints(values: number[]) {
  if (values.length === 0) return "";
  if (values.length === 1) return "0,24 100,24";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 44 - ((value - min) / range) * 36;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function AnalyticsDashboard() {
  const [tracker, setTracker] = useState<TrackerState>(EMPTY_TRACKER);
  const [results, setResults] = useState<GameResult[]>([]);
  const [status, setStatus] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void Promise.all([
      fetch("/api/tracker", { cache: "no-store" }),
      fetch("/api/results", { cache: "no-store" }),
    ])
      .then(async ([trackerResponse, resultsResponse]) => {
        const trackerBody = (await trackerResponse.json().catch(() => null)) as
          | (TrackerState & { error?: string })
          | null;
        const resultsBody = (await resultsResponse.json().catch(() => null)) as
          | { results?: GameResult[]; error?: string }
          | null;

        if (!trackerResponse.ok) {
          throw new Error(trackerBody?.error ?? "Could not load player analytics");
        }
        if (!resultsResponse.ok) {
          throw new Error(resultsBody?.error ?? "Could not load results analytics");
        }

        if (!active) return;
        setTracker(trackerBody ?? EMPTY_TRACKER);
        setResults(resultsBody?.results ?? []);
        setStatus("ready");
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Could not load analytics");
        setStatus("error");
      });

    return () => {
      active = false;
    };
  }, []);

  const playerReads = useMemo<PlayerRead[]>(() => {
    return tracker.players
      .map((player) => {
        const counts = tracker.counts[player.id] ?? {};
        const preflopCounts = counts.preflop;
        const postflopCounts = counts.postflop;
        const showdownCounts = counts.showdown;
        const preflop = sum(preflopCounts);
        const postflop = sum(postflopCounts);
        const showdown = sum(showdownCounts);
        const aggression =
          actionCount(preflopCounts, [
            "open-raise",
            "raise",
            "three-bet",
            "four-bet-plus",
            "all-in",
            "squeeze",
          ]) +
          actionCount(postflopCounts, [
            "bet",
            "postflop-raise",
            "check-raise",
            "donk-bet",
            "postflop-all-in",
          ]);
        const passive =
          actionCount(preflopCounts, ["limp", "limp-call", "call", "cold-call"]) +
          actionCount(postflopCounts, ["check", "call"]);
        const folds =
          actionCount(preflopCounts, ["fold"]) + actionCount(postflopCounts, ["postflop-fold"]);

        return {
          player,
          total: preflop + postflop + showdown,
          preflop,
          postflop,
          showdown,
          aggression,
          passive,
          folds,
          bluffShown: showdownCounts?.["bluff-shown"] ?? 0,
          valueShown: showdownCounts?.["value-shown"] ?? 0,
        };
      })
      .sort((a, b) => b.total - a.total || a.player.name.localeCompare(b.player.name));
  }, [tracker]);

  const resultAnalytics = useMemo(() => {
    const chronological = [...results].sort(
      (a, b) => a.playedAt.localeCompare(b.playedAt) || a.createdAt.localeCompare(b.createdAt),
    );
    const net = results.reduce((total, result) => total + resultNet(result), 0);
    const minutes = results.reduce((total, result) => total + result.durationMinutes, 0);
    const cash = results.filter((result) => result.category === "cash");
    const tournaments = results.filter((result) => result.category === "tournament");
    const cashNet = cash.reduce((total, result) => total + resultNet(result), 0);
    const tournamentNet = tournaments.reduce((total, result) => total + resultNet(result), 0);
    const tournamentCashes = tournaments.filter((result) => result.winningsCents > 0).length;

    let running = 0;
    const cumulative = chronological.map((result) => {
      running += resultNet(result);
      return running;
    });
    const recent = chronological.slice(-10);
    const priorIndex = cumulative.length - recent.length - 1;
    let recentRunning = priorIndex >= 0 ? cumulative[priorIndex] ?? 0 : 0;
    const recentCumulative = recent.map((result) => {
      recentRunning += resultNet(result);
      return recentRunning;
    });

    return {
      net,
      hours: minutes / 60,
      hourly: minutes > 0 ? Math.round((net / minutes) * 60) : 0,
      cashNet,
      tournamentNet,
      cashSessions: cash.length,
      tournaments: tournaments.length,
      tournamentCashes,
      trendPoints: buildTrendPoints(recentCumulative),
      recent,
    };
  }, [results]);

  const totalReads = playerReads.reduce((total, read) => total + read.total, 0);
  const showdownSamples = playerReads.reduce((total, read) => total + read.showdown, 0);

  if (status === "loading") {
    return <section className={styles.loading}>Building your analytics view…</section>;
  }

  if (status === "error") {
    return (
      <section className={styles.loading} role="alert">
        {error ?? "Could not load analytics."}
      </section>
    );
  }

  return (
    <main className={styles.dashboard}>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Study mode</p>
          <h1>Performance & player analytics</h1>
          <p className={styles.heroCopy}>
            Review direct observations and recorded results away from the live table. Observation shares are descriptive evidence, not inferred HUD statistics.
          </p>
        </div>
        <div className={styles.samplePill}>{totalReads} direct reads</div>
      </header>

      <section className={styles.metrics} aria-label="Analytics summary">
        <article>
          <span>Tracked players</span>
          <strong>{tracker.players.length}</strong>
          <small>{tracker.seats.length} currently seated</small>
        </article>
        <article>
          <span>Direct reads</span>
          <strong>{totalReads}</strong>
          <small>{showdownSamples} showdown evidence samples</small>
        </article>
        <article>
          <span>Recorded sessions</span>
          <strong>{results.length}</strong>
          <small>{resultAnalytics.hours.toFixed(1)} total hours</small>
        </article>
        <article>
          <span>Net result</span>
          <strong className={resultAnalytics.net >= 0 ? styles.positive : styles.negative}>
            {money(resultAnalytics.net)}
          </strong>
          <small>{money(resultAnalytics.hourly)} / hour recorded</small>
        </article>
      </section>

      <div className={styles.grid}>
        <section className={styles.panel} aria-labelledby="trend-heading">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>Results trend</p>
              <h2 id="trend-heading">Recent bankroll direction</h2>
            </div>
            <span>Last {resultAnalytics.recent.length} sessions</span>
          </div>
          {resultAnalytics.recent.length ? (
            <>
              <div className={styles.trendChart} aria-label="Cumulative net results trend">
                <svg viewBox="0 0 100 52" preserveAspectRatio="none" role="img">
                  <line x1="0" y1="46" x2="100" y2="46" className={styles.chartBaseline} />
                  <polyline points={resultAnalytics.trendPoints} className={styles.chartLine} />
                </svg>
              </div>
              <div className={styles.splitStats}>
                <div>
                  <span>Cash</span>
                  <strong>{money(resultAnalytics.cashNet)}</strong>
                  <small>{resultAnalytics.cashSessions} sessions</small>
                </div>
                <div>
                  <span>Tournaments</span>
                  <strong>{money(resultAnalytics.tournamentNet)}</strong>
                  <small>
                    {resultAnalytics.tournamentCashes}/{resultAnalytics.tournaments} recorded cashes
                  </small>
                </div>
              </div>
            </>
          ) : (
            <p className={styles.empty}>Record cash or tournament results to populate performance trends.</p>
          )}
        </section>

        <section className={styles.panel} aria-labelledby="evidence-heading">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>Evidence quality</p>
              <h2 id="evidence-heading">Most observed opponents</h2>
            </div>
            <span>Sample-aware reads</span>
          </div>
          {playerReads.length ? (
            <div className={styles.ranking}>
              {playerReads.slice(0, 5).map((read, index) => (
                <div key={read.player.id} className={styles.rankRow}>
                  <span className={styles.rankNumber}>{index + 1}</span>
                  <div className={styles.rankCopy}>
                    <strong>{read.player.name}</strong>
                    <span>{STYLE_LABELS[read.player.playStyle]} · {read.total} samples</span>
                  </div>
                  <div className={styles.sampleBar} aria-hidden="true">
                    <span style={{ width: `${Math.max(8, percentage(read.total, playerReads[0]?.total ?? 1))}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.empty}>Log opponent actions to build a ranked evidence view.</p>
          )}
        </section>
      </div>

      <section className={styles.playerPanel} aria-labelledby="player-analytics-heading">
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.eyebrow}>Opponent study</p>
            <h2 id="player-analytics-heading">Player tendency board</h2>
          </div>
          <span>Direct observations only</span>
        </div>

        {playerReads.length ? (
          <div className={styles.playerGrid}>
            {playerReads.map((read) => {
              const behavioralTotal = read.aggression + read.passive + read.folds;
              const aggressionShare = percentage(read.aggression, behavioralTotal);
              const passiveShare = percentage(read.passive, behavioralTotal);
              const foldShare = percentage(read.folds, behavioralTotal);
              const shownTotal = read.bluffShown + read.valueShown;
              const bluffEvidence = percentage(read.bluffShown, shownTotal);

              return (
                <article key={read.player.id} className={styles.playerCard} data-style={read.player.playStyle}>
                  <div className={styles.playerHeader}>
                    <div>
                      <strong>{read.player.name}</strong>
                      <span>{STYLE_LABELS[read.player.playStyle]}</span>
                    </div>
                    <span className={styles.readCount}>{read.total} reads</span>
                  </div>

                  <div className={styles.phaseCounts}>
                    <span><strong>{read.preflop}</strong> pre-flop</span>
                    <span><strong>{read.postflop}</strong> post-flop</span>
                    <span><strong>{read.showdown}</strong> showdown</span>
                  </div>

                  <div className={styles.tendencyRow}>
                    <div><span>Aggressive</span><strong>{aggressionShare}%</strong></div>
                    <div className={styles.track}><span style={{ width: `${aggressionShare}%` }} /></div>
                  </div>
                  <div className={styles.tendencyRow}>
                    <div><span>Passive</span><strong>{passiveShare}%</strong></div>
                    <div className={styles.track}><span style={{ width: `${passiveShare}%` }} /></div>
                  </div>
                  <div className={styles.tendencyRow}>
                    <div><span>Fold evidence</span><strong>{foldShare}%</strong></div>
                    <div className={styles.track}><span style={{ width: `${foldShare}%` }} /></div>
                  </div>

                  <footer className={styles.playerFooter}>
                    <span>Bluff read: {BLUFF_LABELS[read.player.bluffLevel]}</span>
                    <span>Shown bluff evidence: {shownTotal ? `${bluffEvidence}% · n=${shownTotal}` : "—"}</span>
                  </footer>
                </article>
              );
            })}
          </div>
        ) : (
          <p className={styles.empty}>No player observations yet.</p>
        )}
      </section>
    </main>
  );
}

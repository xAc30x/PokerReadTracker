"use client";

import { useState } from "react";
import { AnalyticsDashboard } from "./analytics-dashboard";
import { GameResults } from "./game-results";
import { PokerTracker } from "./poker-tracker";
import styles from "./command-center-shell.module.css";

type WorkspaceMode = "live" | "analytics" | "results";

const MODES: readonly {
  id: WorkspaceMode;
  label: string;
  shortLabel: string;
  helper: string;
}[] = [
  {
    id: "live",
    label: "Live Command Center",
    shortLabel: "Live",
    helper: "Track the table",
  },
  {
    id: "analytics",
    label: "Analytics",
    shortLabel: "Study",
    helper: "Review player reads",
  },
  {
    id: "results",
    label: "Results",
    shortLabel: "Results",
    helper: "Log performance",
  },
];

function TableIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5.5" width="17" height="13" rx="6.5" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

function AnalyticsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 19V9M12 19V5M19 19v-7" />
      <path d="M3 19.5h18" />
    </svg>
  );
}

function ResultsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4.5h14v15H5z" />
      <path d="M8 9h8M8 13h5M8 16h7" />
    </svg>
  );
}

function ModeIcon({ mode }: { mode: WorkspaceMode }) {
  if (mode === "analytics") return <AnalyticsIcon />;
  if (mode === "results") return <ResultsIcon />;
  return <TableIcon />;
}

export function CommandCenterShell() {
  const [mode, setMode] = useState<WorkspaceMode>("live");

  return (
    <div className={styles.shell}>
      <nav className={styles.workspaceNav} aria-label="TableRead workspace">
        <div className={styles.workspaceBrand}>
          <span className={styles.brandDot} />
          <div>
            <strong>TableRead Command Center</strong>
            <span>Live reads + study analytics</span>
          </div>
        </div>
        <div className={styles.desktopModes} role="tablist" aria-label="Workspace mode">
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={mode === item.id}
              className={mode === item.id ? styles.activeMode : ""}
              onClick={() => setMode(item.id)}
            >
              <span className={styles.modeIcon}><ModeIcon mode={item.id} /></span>
              <span>
                <strong>{item.label}</strong>
                <small>{item.helper}</small>
              </span>
            </button>
          ))}
        </div>
      </nav>

      <section
        className={`${styles.workspaceView} ${mode === "live" ? styles.visible : styles.hidden}`}
        aria-hidden={mode !== "live"}
      >
        <div className={styles.liveOnly}>
          <PokerTracker />
        </div>
      </section>

      <section
        className={`${styles.workspaceView} ${mode === "analytics" ? styles.visible : styles.hidden}`}
        aria-hidden={mode !== "analytics"}
      >
        {mode === "analytics" ? <AnalyticsDashboard /> : null}
      </section>

      <section
        className={`${styles.workspaceView} ${mode === "results" ? styles.visible : styles.hidden}`}
        aria-hidden={mode !== "results"}
      >
        {mode === "results" ? (
          <div className={styles.resultsWorkspace}>
            <header className={styles.resultsHero}>
              <p>Performance log</p>
              <h1>Cash & tournament results</h1>
              <span>Keep session logging separate from live opponent tracking so the table screen stays fast.</span>
            </header>
            <GameResults />
          </div>
        ) : null}
      </section>

      <nav className={styles.mobileNav} aria-label="Mobile workspace mode">
        {MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={mode === item.id ? "page" : undefined}
            className={mode === item.id ? styles.mobileActive : ""}
            onClick={() => setMode(item.id)}
          >
            <span><ModeIcon mode={item.id} /></span>
            <strong>{item.shortLabel}</strong>
          </button>
        ))}
      </nav>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  CreateGameResult,
  GameCategory,
  GameResult,
  PokerFormat,
} from "../game-result-types";

const POKER_FORMATS: readonly PokerFormat[] = [
  "NL Hold'em",
  "PL Omaha",
  "PLO8",
  "Limit Hold'em",
  "Mixed",
  "Other",
];

type FormState = {
  playedAt: string;
  name: string;
  venue: string;
  stakes: string;
  buyIn: string;
  cashOut: string;
  winnings: string;
  rake: string;
  prizePool: string;
  pokerFormat: PokerFormat;
  durationHours: string;
  finishingPlace: string;
  fieldSize: string;
  notes: string;
};

function localDateValue() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function emptyForm(category: GameCategory): FormState {
  return {
    playedAt: localDateValue(),
    name: category === "cash" ? "Cash game" : "",
    venue: "",
    stakes: "",
    buyIn: "",
    cashOut: "",
    winnings: "",
    rake: "",
    prizePool: "",
    pokerFormat: "NL Hold'em",
    durationHours: "",
    finishingPlace: "",
    fieldSize: "",
    notes: "",
  };
}

function dollarsToCents(value: string) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}

function positiveInteger(value: string) {
  const amount = Number(value);
  return Number.isInteger(amount) && amount > 0 ? amount : null;
}

function money(cents: number, signed = false) {
  const absolute = Math.abs(cents) / 100;
  const formatted = absolute.toLocaleString("en-CA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (!signed) return `C$${formatted}`;
  if (cents > 0) return `+C$${formatted}`;
  if (cents < 0) return `−C$${formatted}`;
  return "C$0.00";
}

function resultNet(result: GameResult) {
  return result.category === "cash"
    ? result.cashOutCents - result.buyInCents
    : result.winningsCents - result.buyInCents - result.rakeCents;
}

function displayDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ordinal(value: number | null) {
  if (!value) return "—";
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${value}th`;
  if (value % 10 === 1) return `${value}st`;
  if (value % 10 === 2) return `${value}nd`;
  if (value % 10 === 3) return `${value}rd`;
  return `${value}th`;
}

export function GameResults() {
  const [category, setCategory] = useState<GameCategory>("cash");
  const [results, setResults] = useState<GameResult[]>([]);
  const [form, setForm] = useState<FormState>(() => emptyForm("cash"));
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/results", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as
          | { results?: GameResult[]; error?: string }
          | null;
        if (!response.ok) throw new Error(body?.error ?? "Could not load game results");
        if (active) setResults(body?.results ?? []);
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Could not load game results");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const visibleResults = useMemo(
    () => results.filter((result) => result.category === category),
    [category, results],
  );
  const net = visibleResults.reduce((total, result) => total + resultNet(result), 0);
  const hours = visibleResults.reduce((total, result) => total + result.durationMinutes, 0) / 60;
  const tournamentCashes = visibleResults.filter((result) => result.winningsCents > 0).length;

  function switchCategory(nextCategory: GameCategory) {
    setCategory(nextCategory);
    setForm(emptyForm(nextCategory));
    setFormOpen(false);
    setError(null);
  }

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submitResult(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const buyInCents = dollarsToCents(form.buyIn);
    const cashOutCents = dollarsToCents(form.cashOut);
    const winningsCents = dollarsToCents(form.winnings);
    const rakeCents = dollarsToCents(form.rake);
    const prizePoolCents = dollarsToCents(form.prizePool);
    const durationHours = Number(form.durationHours || 0);
    const finishingPlace = positiveInteger(form.finishingPlace);
    const fieldSize = positiveInteger(form.fieldSize);

    if (
      !form.name.trim() ||
      buyInCents === null ||
      cashOutCents === null ||
      winningsCents === null ||
      rakeCents === null ||
      prizePoolCents === null
    ) {
      setError("Enter a name and valid non-negative money amounts.");
      return;
    }
    if (!Number.isFinite(durationHours) || durationHours < 0) {
      setError("Session length must be zero or more hours.");
      return;
    }
    if (category === "tournament" && (!finishingPlace || !fieldSize || finishingPlace > fieldSize)) {
      setError("Enter a finishing place between 1 and the total number of entries.");
      return;
    }

    const payload: CreateGameResult = {
      id: crypto.randomUUID(),
      category,
      playedAt: form.playedAt,
      name: form.name.trim(),
      venue: form.venue.trim(),
      stakes: category === "cash" ? form.stakes.trim() : "",
      buyInCents,
      cashOutCents: category === "cash" ? cashOutCents : 0,
      winningsCents: category === "tournament" ? winningsCents : 0,
      rakeCents: category === "tournament" ? rakeCents : 0,
      prizePoolCents: category === "tournament" ? prizePoolCents : 0,
      pokerFormat: form.pokerFormat,
      durationMinutes: Math.round(durationHours * 60),
      finishingPlace: category === "tournament" ? finishingPlace : null,
      fieldSize: category === "tournament" ? fieldSize : null,
      notes: form.notes.trim(),
    };

    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/results", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as
        | { result?: GameResult; error?: string }
        | null;
      if (!response.ok || !body?.result) throw new Error(body?.error ?? "Could not save result");
      setResults((current) =>
        [body.result!, ...current].sort((a, b) =>
          b.playedAt.localeCompare(a.playedAt) || b.createdAt.localeCompare(a.createdAt),
        ),
      );
      setForm(emptyForm(category));
      setFormOpen(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save result");
    } finally {
      setSaving(false);
    }
  }

  async function removeResult(result: GameResult) {
    if (!window.confirm(`Remove ${result.name} from your ${result.category} results?`)) return;
    setError(null);
    try {
      const response = await fetch("/api/results", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: result.id }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "Could not remove result");
      setResults((current) => current.filter((item) => item.id !== result.id));
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Could not remove result");
    }
  }

  return (
    <section className="results-section" aria-labelledby="results-heading">
      <div className="results-header">
        <div>
          <p className="eyebrow">My poker results</p>
          <h2 id="results-heading">Game log</h2>
        </div>
        <button
          className="add-result-button"
          type="button"
          onClick={() => {
            setForm(emptyForm(category));
            setFormOpen((open) => !open);
            setError(null);
          }}
        >
          {formOpen ? "Cancel" : category === "cash" ? "+ Log cash game" : "+ Log tournament"}
        </button>
      </div>

      <div className="result-category-tabs" role="tablist" aria-label="Game result categories">
        <button
          type="button"
          role="tab"
          aria-selected={category === "cash"}
          className={category === "cash" ? "is-active" : ""}
          onClick={() => switchCategory("cash")}
        >
          Cash games
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={category === "tournament"}
          className={category === "tournament" ? "is-active" : ""}
          onClick={() => switchCategory("tournament")}
        >
          Tournaments
        </button>
      </div>

      <div className="result-summary" aria-label={`${category} results summary`}>
        <div><span>{category === "cash" ? "Sessions" : "Played"}</span><strong>{visibleResults.length}</strong></div>
        <div><span>{category === "cash" ? "Hours" : "Cashes"}</span><strong>{category === "cash" ? hours.toFixed(1) : tournamentCashes}</strong></div>
        <div className={net >= 0 ? "result-positive" : "result-negative"}><span>Net result</span><strong>{money(net, true)}</strong></div>
      </div>

      {formOpen && (
        <form className="result-form" onSubmit={submitResult}>
          <div className="result-form-grid">
            <label>
              Date
              <input type="date" required value={form.playedAt} onChange={(event) => updateField("playedAt", event.target.value)} />
            </label>
            <label>
              {category === "cash" ? "Session name" : "Tournament name"}
              <input required maxLength={100} value={form.name} placeholder={category === "cash" ? "Friday cash game" : "6-Max Deepstack"} onChange={(event) => updateField("name", event.target.value)} />
            </label>
            <label>
              Site or venue
              <input maxLength={100} value={form.venue} placeholder="BetMGM or cardroom" onChange={(event) => updateField("venue", event.target.value)} />
            </label>
            <label>
              Poker format
              <select value={form.pokerFormat} onChange={(event) => updateField("pokerFormat", event.target.value)}>
                {POKER_FORMATS.map((format) => <option key={format} value={format}>{format}</option>)}
              </select>
            </label>
            {category === "cash" && (
              <label>
                Stakes
                <input maxLength={40} value={form.stakes} placeholder="C$0.05 / C$0.10" onChange={(event) => updateField("stakes", event.target.value)} />
              </label>
            )}
            <label>
              Buy-in (C$)
              <input type="number" min="0" step="0.01" inputMode="decimal" required value={form.buyIn} onChange={(event) => updateField("buyIn", event.target.value)} />
            </label>
            {category === "cash" ? (
              <label>
                Cash-out (C$)
                <input type="number" min="0" step="0.01" inputMode="decimal" required value={form.cashOut} onChange={(event) => updateField("cashOut", event.target.value)} />
              </label>
            ) : (
              <>
                <label>
                  Rake / fee (C$)
                  <input type="number" min="0" step="0.01" inputMode="decimal" value={form.rake} onChange={(event) => updateField("rake", event.target.value)} />
                </label>
                <label>
                  Prize pool (C$)
                  <input type="number" min="0" step="0.01" inputMode="decimal" value={form.prizePool} onChange={(event) => updateField("prizePool", event.target.value)} />
                </label>
                <label>
                  Winnings (C$)
                  <input type="number" min="0" step="0.01" inputMode="decimal" required value={form.winnings} onChange={(event) => updateField("winnings", event.target.value)} />
                </label>
                <label>
                  Finishing place
                  <input type="number" min="1" step="1" inputMode="numeric" required value={form.finishingPlace} placeholder="5" onChange={(event) => updateField("finishingPlace", event.target.value)} />
                </label>
                <label>
                  Total entries
                  <input type="number" min="1" step="1" inputMode="numeric" required value={form.fieldSize} placeholder="33" onChange={(event) => updateField("fieldSize", event.target.value)} />
                </label>
              </>
            )}
            <label>
              Session length (hours)
              <input type="number" min="0" step="0.25" inputMode="decimal" value={form.durationHours} onChange={(event) => updateField("durationHours", event.target.value)} />
            </label>
          </div>
          <label className="result-notes-label">
            Notes
            <textarea maxLength={2000} value={form.notes} placeholder="Key hands, decisions, or lessons from this game" onChange={(event) => updateField("notes", event.target.value)} />
          </label>
          {error && <p className="result-error" role="alert">{error}</p>}
          <button className="save-result-button" type="submit" disabled={saving}>
            {saving ? "Saving…" : category === "cash" ? "Save cash game" : "Save tournament"}
          </button>
        </form>
      )}

      {!formOpen && error && <p className="result-error result-error--standalone" role="alert">{error}</p>}

      {loading ? (
        <div className="results-empty">Loading your game history…</div>
      ) : visibleResults.length === 0 ? (
        <div className="results-empty">
          {category === "cash"
            ? "No cash games logged yet. Add your first session to start tracking profit and playing time."
            : "No tournaments logged yet. Add your first result to track finishes, cashes, and profit."}
        </div>
      ) : (
        <div className="result-list">
          {visibleResults.map((result) => {
            const netResult = resultNet(result);
            const tournamentMeta = result.category === "tournament"
              ? [
                  result.pokerFormat,
                  `${ordinal(result.finishingPlace)} of ${result.fieldSize}`,
                  result.prizePoolCents > 0 ? `${money(result.prizePoolCents)} prize pool` : "",
                ]
              : [result.pokerFormat, result.stakes];
            return (
              <article className="result-card" key={result.id}>
                <div className="result-card-main">
                  <p className="result-date">{displayDate(result.playedAt)}</p>
                  <h3>{result.name}</h3>
                  <p className="result-meta">
                    {[result.venue, ...tournamentMeta].filter(Boolean).join(" · ")}
                  </p>
                  {result.notes && <p className="result-notes">{result.notes}</p>}
                </div>
                <div className="result-card-numbers">
                  <strong className={netResult >= 0 ? "result-positive" : "result-negative"}>{money(netResult, true)}</strong>
                  <span>
                    {result.category === "cash"
                      ? `${(result.durationMinutes / 60).toFixed(1)} hours`
                      : `${money(result.winningsCents)} won${result.rakeCents > 0 ? ` · ${money(result.rakeCents)} fee` : ""}`}
                  </span>
                  <button type="button" onClick={() => void removeResult(result)}>Remove</button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

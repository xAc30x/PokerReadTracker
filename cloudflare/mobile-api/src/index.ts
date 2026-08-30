interface D1Result<T = unknown> {
  results?: T[];
  success?: boolean;
  error?: string;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

interface Env {
  DB: D1Database;
  PAIRING_ADMIN_SECRET?: string;
  DEFAULT_OWNER_KEY?: string;
  ALLOWED_ORIGIN?: string;
}

type Session = { ownerKey: string; sessionId: string };
type PairingRow = { owner_key: string };
type SessionRow = { id: string; owner_key: string };
type PlayerRow = {
  id: string;
  name: string;
  play_style: string;
  bluff_level: number;
  preflop_tags: string;
  postflop_tags: string;
  preflop_notes: string;
  postflop_notes: string;
  tells_notes: string;
  showdown_notes: string;
  updated_at: string;
};
type ObservationRow = {
  id: string;
  player_id: string;
  phase: string;
  street: string;
  action: string;
  hand_id: string;
  hand_number: number;
  created_at: string;
};

const TOKEN_PREFIX = "tr_live_";
const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_TTL_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 2_000_000;
const MAX_PLAYERS = 500;
const MAX_OBSERVATIONS = 10_000;
const MAX_DELETIONS = 10_000;
const MAX_SNAPSHOT_OBSERVATIONS = 10_000;
const VALID_PHASES = new Set(["preflop", "postflop", "showdown"]);
const VALID_STREETS = new Set(["flop", "turn", "river"]);
const VALID_ACTIONS = new Set([
  "fold",
  "limp",
  "call",
  "open-raise",
  "three-bet",
  "four-bet-plus",
  "all-in",
  "squeeze",
  "cold-call",
  "check",
  "bet",
  "postflop-raise",
  "postflop-fold",
  "check-raise",
  "donk-bet",
  "postflop-all-in",
  "bluff-shown",
  "value-shown",
  "draw-shown",
  "slowplay-shown",
  "hero-call-shown",
  "mucked-unknown",
  "limp-call",
  "raise",
]);

function securityHeaders() {
  return {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
}

function corsHeaders(request: Request, env: Env) {
  const origin = request.headers.get("origin");
  if (!origin || !env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "Authorization,Content-Type,X-Admin-Secret",
    "access-control-max-age": "3600",
    vary: "Origin",
  };
}

function json(request: Request, env: Env, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...securityHeaders(),
      ...corsHeaders(request, env),
    },
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanText(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().slice(0, max);
  return cleaned || null;
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9-]{8,64}$/.test(value);
}

function cleanOwnerKey(value: unknown) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().toLowerCase();
  return /^[a-z0-9@._:+-]{3,160}$/.test(cleaned) ? cleaned : null;
}

function cleanPairingCode(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.toUpperCase().replace(/[^A-Z2-9]/g, "");
  return normalized.length === 8 ? normalized : null;
}

function cleanIsoDate(value: unknown) {
  if (typeof value !== "string") return new Date().toISOString();
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return new Date().toISOString();
  return new Date(millis).toISOString();
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Bytes(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function sha256Hex(value: string) {
  const digest = await sha256Bytes(value);
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function secretEqual(left: string, right: string) {
  const [a, b] = await Promise.all([sha256Bytes(left), sha256Bytes(right)]);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function randomPairingCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length]).join("");
}

function randomToken() {
  return `${TOKEN_PREFIX}${bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

async function readJson(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) throw new Error("Request body is too large.");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new Error("Request body is too large.");
  if (!text) return {};
  return JSON.parse(text) as unknown;
}

async function resolveBearer(request: Request, env: Env): Promise<Session | null> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  if (!token.startsWith(TOKEN_PREFIX) || token.length < 40 || token.length > 128) return null;

  const tokenHash = await sha256Hex(token);
  const row = await env.DB
    .prepare(
      `SELECT id, owner_key
       FROM mobile_sessions
       WHERE token_hash = ? AND revoked_at IS NULL
       LIMIT 1`,
    )
    .bind(tokenHash)
    .first<SessionRow>();
  if (!row?.owner_key) return null;

  await env.DB
    .prepare("UPDATE mobile_sessions SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(row.id)
    .run();
  return { ownerKey: row.owner_key, sessionId: row.id };
}

async function runBatches(env: Env, statements: D1PreparedStatement[], chunkSize = 50) {
  for (let start = 0; start < statements.length; start += chunkSize) {
    await env.DB.batch(statements.slice(start, start + chunkSize));
  }
}

function inferPreflopContext(action: string) {
  if (["three-bet", "squeeze", "cold-call"].includes(action)) return "facing-raise";
  if (["open-raise", "raise", "limp"].includes(action)) return "unopened";
  return "";
}

function parseTags(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

async function snapshot(ownerKey: string, env: Env) {
  const [playerResult, observationResult] = await Promise.all([
    env.DB
      .prepare(
        `SELECT id, name, play_style, bluff_level, preflop_tags, postflop_tags,
                preflop_notes, postflop_notes, tells_notes, showdown_notes, updated_at
         FROM players
         WHERE owner_key = ? AND archived = 0
         ORDER BY updated_at ASC, id ASC`,
      )
      .bind(ownerKey)
      .all<PlayerRow>(),
    env.DB
      .prepare(
        `SELECT id, player_id, phase, street, action, hand_id, hand_number, created_at
         FROM observations
         WHERE owner_key = ?
         ORDER BY created_at ASC, sequence ASC, id ASC
         LIMIT ?`,
      )
      .bind(ownerKey, MAX_SNAPSHOT_OBSERVATIONS + 1)
      .all<ObservationRow>(),
  ]);

  const observationRows = observationResult.results ?? [];
  const truncated = observationRows.length > MAX_SNAPSHOT_OBSERVATIONS;
  return {
    players: (playerResult.results ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      playStyle: row.play_style,
      bluffLevel: Number(row.bluff_level),
      preflopTags: parseTags(row.preflop_tags),
      postflopTags: parseTags(row.postflop_tags),
      preflopNotes: row.preflop_notes,
      postflopNotes: row.postflop_notes,
      tellsNotes: row.tells_notes,
      showdownNotes: row.showdown_notes,
      updatedAt: row.updated_at,
    })),
    observations: observationRows.slice(0, MAX_SNAPSHOT_OBSERVATIONS).map((row) => ({
      id: row.id,
      playerId: row.player_id,
      phase: row.phase,
      street: row.street || null,
      action: row.action,
      handId: row.hand_id,
      handNumber: Number(row.hand_number),
      createdAt: row.created_at,
    })),
    truncated,
  };
}

async function createPairing(request: Request, env: Env) {
  const configuredSecret = env.PAIRING_ADMIN_SECRET?.trim();
  if (!configuredSecret) return json(request, env, { error: "Pairing administration is not configured." }, 503);
  const suppliedSecret = request.headers.get("x-admin-secret") ?? "";
  if (!suppliedSecret || !(await secretEqual(suppliedSecret, configuredSecret))) {
    return json(request, env, { error: "Pairing administrator authorization failed." }, 401);
  }

  let body: unknown;
  try {
    body = await readJson(request);
  } catch (error) {
    return json(request, env, { error: error instanceof Error ? error.message : "Invalid JSON body." }, 400);
  }
  const record = asRecord(body) ?? {};
  const ownerKey = cleanOwnerKey(env.DEFAULT_OWNER_KEY) ?? cleanOwnerKey(record.ownerKey);
  if (!ownerKey) return json(request, env, { error: "A valid owner key is required." }, 400);

  const code = randomPairingCode();
  const codeHash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();
  await env.DB.batch([
    env.DB
      .prepare("DELETE FROM mobile_pairing_codes WHERE datetime(expires_at) <= datetime('now') OR owner_key = ?")
      .bind(ownerKey),
    env.DB
      .prepare(
        `INSERT INTO mobile_pairing_codes
         (code_hash, owner_key, expires_at, created_at, consumed_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP, NULL)`,
      )
      .bind(codeHash, ownerKey, expiresAt),
  ]);
  return json(request, env, { code, expiresAt });
}

async function exchangePairing(request: Request, env: Env) {
  let body: unknown;
  try {
    body = await readJson(request);
  } catch (error) {
    return json(request, env, { error: error instanceof Error ? error.message : "Invalid JSON body." }, 400);
  }
  const record = asRecord(body);
  const code = cleanPairingCode(record?.code);
  const deviceName = cleanText(record?.deviceName, 80) ?? "iPhone";
  if (!code) return json(request, env, { error: "Invalid or expired pairing code." }, 401);

  const codeHash = await sha256Hex(code);
  const pairing = await env.DB
    .prepare(
      `UPDATE mobile_pairing_codes
       SET consumed_at = CURRENT_TIMESTAMP
       WHERE code_hash = ?
         AND consumed_at IS NULL
         AND datetime(expires_at) > datetime('now')
       RETURNING owner_key`,
    )
    .bind(codeHash)
    .first<PairingRow>();
  if (!pairing?.owner_key) return json(request, env, { error: "Invalid or expired pairing code." }, 401);

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const sessionId = crypto.randomUUID();
  await env.DB
    .prepare(
      `INSERT INTO mobile_sessions
       (id, owner_key, token_hash, device_name, created_at, last_used_at, revoked_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)`,
    )
    .bind(sessionId, pairing.owner_key, tokenHash, deviceName)
    .run();
  return json(request, env, { token, sessionId });
}

function validateSyncPlayer(value: unknown) {
  const record = asRecord(value);
  if (!record || !isSafeId(record.id)) return null;
  const name = cleanText(record.name, 80);
  if (!name) return null;
  return { id: record.id, name };
}

function validateSyncObservation(value: unknown) {
  const record = asRecord(value);
  if (!record || !isSafeId(record.id) || !isSafeId(record.playerId) || !isSafeId(record.handId)) return null;
  if (typeof record.phase !== "string" || !VALID_PHASES.has(record.phase)) return null;
  if (typeof record.action !== "string" || !VALID_ACTIONS.has(record.action)) return null;

  const phase = record.phase;
  let street = "";
  if (phase === "postflop") {
    if (typeof record.street !== "string" || !VALID_STREETS.has(record.street)) return null;
    street = record.street;
  }
  const handNumber = typeof record.handNumber === "number" && Number.isInteger(record.handNumber)
    ? Math.max(1, Math.min(2_000_000_000, record.handNumber))
    : 1;
  return {
    id: record.id,
    playerId: record.playerId,
    phase,
    street,
    action: record.action,
    handId: record.handId,
    handNumber,
    createdAt: cleanIsoDate(record.createdAt),
  };
}

async function sync(request: Request, env: Env) {
  const session = await resolveBearer(request, env);
  if (!session) return json(request, env, { error: "Invalid mobile session." }, 401);

  if (request.method === "GET") return json(request, env, await snapshot(session.ownerKey, env));

  let body: unknown;
  try {
    body = await readJson(request);
  } catch (error) {
    return json(request, env, { error: error instanceof Error ? error.message : "Invalid JSON body." }, 400);
  }
  const record = asRecord(body);
  const rawPlayers = Array.isArray(record?.players) ? record.players : [];
  const rawObservations = Array.isArray(record?.observations) ? record.observations : [];
  const rawDeletions = Array.isArray(record?.deletedObservationIds) ? record.deletedObservationIds : [];
  if (rawPlayers.length > MAX_PLAYERS || rawObservations.length > MAX_OBSERVATIONS || rawDeletions.length > MAX_DELETIONS) {
    return json(request, env, { error: "Synchronization payload exceeds limits." }, 413);
  }

  const players = rawPlayers.map(validateSyncPlayer);
  if (players.some((item) => item === null)) return json(request, env, { error: "Synchronization contains an invalid player." }, 400);
  const observations = rawObservations.map(validateSyncObservation);
  if (observations.some((item) => item === null)) return json(request, env, { error: "Synchronization contains an invalid observation." }, 400);
  if (rawDeletions.some((id) => !isSafeId(id))) return json(request, env, { error: "Synchronization contains an invalid deletion." }, 400);

  const playerStatements = players.map((player) => {
    if (!player) throw new Error("Invalid player.");
    return env.DB
      .prepare(
        `INSERT INTO players
         (id, owner_key, name, play_style, bluff_level, preflop_tags, postflop_tags,
          preflop_notes, postflop_notes, tells_notes, showdown_notes, archived, created_at, updated_at)
         VALUES (?, ?, ?, 'unknown', 0, '[]', '[]', '', '', '', '', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           archived = 0,
           updated_at = CURRENT_TIMESTAMP
         WHERE players.owner_key = excluded.owner_key`,
      )
      .bind(player.id, session.ownerKey, player.name);
  });
  await runBatches(env, playerStatements);

  const deletionStatements = rawDeletions.map((id) =>
    env.DB.prepare("DELETE FROM observations WHERE owner_key = ? AND id = ?").bind(session.ownerKey, id),
  );
  await runBatches(env, deletionStatements);

  const observationStatements = observations.map((observation) => {
    if (!observation) throw new Error("Invalid observation.");
    return env.DB
      .prepare(
        `INSERT OR IGNORE INTO observations
         (id, owner_key, player_id, phase, street, action, hand_id, hand_number,
          seat_no, position, sequence, preflop_context, created_at)
         SELECT ?, ?, id, ?, ?, ?, ?, ?, NULL, '', 0, ?, ?
         FROM players
         WHERE id = ? AND owner_key = ? AND archived = 0`,
      )
      .bind(
        observation.id,
        session.ownerKey,
        observation.phase,
        observation.street,
        observation.action,
        observation.handId,
        observation.handNumber,
        observation.phase === "preflop" ? inferPreflopContext(observation.action) : "",
        observation.createdAt,
        observation.playerId,
        session.ownerKey,
      );
  });
  await runBatches(env, observationStatements);

  return json(request, env, await snapshot(session.ownerKey, env));
}

async function revoke(request: Request, env: Env) {
  const session = await resolveBearer(request, env);
  if (!session) return json(request, env, { error: "Invalid mobile session." }, 401);
  await env.DB
    .prepare("UPDATE mobile_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(session.sessionId)
    .run();
  return json(request, env, { ok: true });
}

async function health(request: Request, env: Env) {
  try {
    await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return json(request, env, { ok: true, service: "tableread-mobile-api", version: 1 });
  } catch {
    return json(request, env, { ok: false, service: "tableread-mobile-api" }, 503);
  }
}

function pairingPage() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TableRead iPhone Pairing</title>
<style>body{font:16px system-ui;margin:0;background:#07120f;color:#f3fff9}main{max-width:520px;margin:auto;padding:32px 20px}section{background:#10231c;border:1px solid #254438;border-radius:18px;padding:20px}input,button{box-sizing:border-box;width:100%;font:inherit;border-radius:12px;padding:14px;margin-top:10px}input{background:#07120f;color:#fff;border:1px solid #315d4b}button{border:0;background:#d9ff6b;color:#122000;font-weight:700}#code{font:700 34px ui-monospace,monospace;letter-spacing:.16em;text-align:center;margin:20px 0}.muted{color:#9bb8ad;font-size:14px}</style></head>
<body><main><h1>Pair TableRead iPhone</h1><section><p class="muted">Enter the Cloudflare pairing administrator secret. It is sent only to this Worker over HTTPS and is not stored by this page.</p><input id="secret" type="password" autocomplete="off" placeholder="Pairing administrator secret"><button id="create">Create 10-minute code</button><div id="code"></div><div id="status" class="muted"></div></section></main>
<script>const button=document.getElementById('create'),status=document.getElementById('status'),code=document.getElementById('code');button.onclick=async()=>{button.disabled=true;status.textContent='Creating…';code.textContent='';try{const response=await fetch('/api/mobile/pair',{method:'POST',headers:{'content-type':'application/json','x-admin-secret':document.getElementById('secret').value},body:'{}'});const body=await response.json();if(!response.ok)throw new Error(body.error||'Pairing failed');code.textContent=body.code;status.textContent='Enter this code in the TableRead iOS app. It expires in 10 minutes.'}catch(error){status.textContent=error instanceof Error?error.message:'Pairing failed'}finally{button.disabled=false}};</script></body></html>`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...securityHeaders(), ...corsHeaders(request, env) } });
    }

    const url = new URL(request.url);
    try {
      if (url.pathname === "/health" && request.method === "GET") return await health(request, env);
      if (url.pathname === "/pair" && request.method === "GET") {
        return new Response(pairingPage(), {
          headers: {
            "content-type": "text/html; charset=utf-8",
            ...securityHeaders(),
            "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
          },
        });
      }
      if ((url.pathname === "/api/mobile/pair" || url.pathname === "/v1/pairing/create") && request.method === "POST") {
        return await createPairing(request, env);
      }
      if ((url.pathname === "/api/mobile/exchange" || url.pathname === "/v1/exchange") && request.method === "POST") {
        return await exchangePairing(request, env);
      }
      if ((url.pathname === "/api/mobile/sync" || url.pathname === "/v1/sync") && (request.method === "GET" || request.method === "POST")) {
        return await sync(request, env);
      }
      if ((url.pathname === "/api/mobile/revoke" || url.pathname === "/v1/revoke") && request.method === "POST") {
        return await revoke(request, env);
      }
      return json(request, env, { error: "Not found." }, 404);
    } catch (error) {
      console.error("mobile-api", error);
      return json(request, env, { error: "Internal server error." }, 500);
    }
  },
};

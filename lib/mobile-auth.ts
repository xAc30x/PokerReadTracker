import { getD1 } from "@/db";

const TOKEN_PREFIX = "tr_live_";
const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_TTL_MS = 10 * 60 * 1000;

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomPairingCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length]).join("");
}

function randomToken() {
  return `${TOKEN_PREFIX}${bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

export async function createPairingCode(ownerKey: string) {
  const code = randomPairingCode();
  const codeHash = await sha256(code);
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();
  const d1 = getD1();

  await d1.batch([
    d1
      .prepare("DELETE FROM mobile_pairing_codes WHERE owner_key = ? OR expires_at <= CURRENT_TIMESTAMP")
      .bind(ownerKey),
    d1
      .prepare(
        `INSERT INTO mobile_pairing_codes
         (code_hash, owner_key, expires_at, created_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .bind(codeHash, ownerKey, expiresAt),
  ]);

  return { code, expiresAt };
}

export async function exchangePairingCode(code: string, deviceName: string) {
  const normalized = code.trim().toUpperCase().replace(/[^A-Z2-9]/g, "");
  if (normalized.length !== 8) return null;

  const codeHash = await sha256(normalized);
  const d1 = getD1();
  const row = await d1
    .prepare(
      `SELECT owner_key
       FROM mobile_pairing_codes
       WHERE code_hash = ? AND expires_at > CURRENT_TIMESTAMP
       LIMIT 1`,
    )
    .bind(codeHash)
    .first<{ owner_key: string }>();

  if (!row?.owner_key) return null;

  const token = randomToken();
  const tokenHash = await sha256(token);
  const sessionId = crypto.randomUUID();
  const cleanDeviceName = deviceName.trim().slice(0, 80) || "iPhone";

  await d1.batch([
    d1.prepare("DELETE FROM mobile_pairing_codes WHERE code_hash = ?").bind(codeHash),
    d1
      .prepare(
        `INSERT INTO mobile_sessions
         (id, owner_key, token_hash, device_name, created_at, last_used_at, revoked_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)`,
      )
      .bind(sessionId, row.owner_key, tokenHash, cleanDeviceName),
  ]);

  return { token, sessionId };
}

export async function resolveBearerOwner(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;

  const token = authorization.slice(7).trim();
  if (!token.startsWith(TOKEN_PREFIX) || token.length < 40 || token.length > 128) return null;

  const tokenHash = await sha256(token);
  const d1 = getD1();
  const row = await d1
    .prepare(
      `SELECT id, owner_key
       FROM mobile_sessions
       WHERE token_hash = ? AND revoked_at IS NULL
       LIMIT 1`,
    )
    .bind(tokenHash)
    .first<{ id: string; owner_key: string }>();

  if (!row?.owner_key) return null;

  await d1
    .prepare("UPDATE mobile_sessions SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(row.id)
    .run();

  return { ownerKey: row.owner_key, sessionId: row.id };
}

export async function revokeBearerSession(request: Request) {
  const resolved = await resolveBearerOwner(request);
  if (!resolved) return false;

  await getD1()
    .prepare("UPDATE mobile_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(resolved.sessionId)
    .run();
  return true;
}

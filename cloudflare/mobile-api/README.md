# TableRead Cloudflare Mobile API

This Worker is the public API for the native iOS client. It exists because the ChatGPT Sites gateway requires a browser ChatGPT session before requests reach the application and therefore cannot serve as the native bearer-token API origin.

## Architecture

- Runtime: Cloudflare Workers
- Database: dedicated Cloudflare D1 database named `table-read-mobile-api`
- Worker name: `table-read-mobile-api`
- Native authentication: one-time pairing code -> revocable bearer token
- Session-token storage on iOS: Keychain
- Session-token storage on the server: SHA-256 hash only
- Sync model: idempotent player/observation upserts plus durable queued observation deletions

The dedicated D1 database is intentionally separate from the ChatGPT Sites-managed D1 database because the Sites control plane does not expose its underlying Cloudflare database UUID for external Worker binding. Existing web data must be migrated or bridged deliberately before the two clients are treated as sharing one canonical data set.

## Public routes

| Route | Method | Authentication | Purpose |
| --- | --- | --- | --- |
| `/health` | GET | None | Worker/D1 health probe |
| `/pair` | GET | None | Pairing-code administration UI |
| `/api/mobile/pair` | POST | `X-Admin-Secret` | Create a 10-minute pairing code |
| `/api/mobile/exchange` | POST | Pairing code | Mint a revocable bearer session |
| `/api/mobile/sync` | GET/POST | Bearer token | Read or synchronize native tracker data |
| `/api/mobile/revoke` | POST | Bearer token | Revoke the current native session |

Legacy-compatible aliases under `/v1/*` are also supported.

## Required GitHub Actions secrets

The manual `Deploy Cloudflare Mobile API` workflow requires:

- `CLOUDFLARE_API_TOKEN` — a Cloudflare API token allowed to manage Workers and D1 for the target account.
- `CLOUDFLARE_ACCOUNT_ID` — the target Cloudflare account ID.
- `TABLEREAD_PAIRING_ADMIN_SECRET` — a high-entropy secret used only to authorize creation of pairing codes. Use at least 32 random bytes. It is installed into the Worker as an encrypted secret and is never committed.

The deployment workflow discovers an existing D1 database named `table-read-mobile-api` or creates it automatically, applies `migrations/`, deploys the Worker to `workers.dev`, and performs a production health check.

## Local/CI validation

From the repository root:

```sh
npm run install:ci
npm run mobile-api:check
```

`mobile-api:check` runs a Wrangler dry-run compile using `wrangler.check.jsonc`. The database UUID in that file is deliberately non-production and is used only to validate the Worker bundle.

## iOS configuration

The XcodeGen project exposes the build setting:

```text
TABLEREAD_API_BASE_URL
```

It is written into `TableReadAPIBaseURL` in the generated Info.plist. The repository default is the reserved host:

```text
https://table-read-mobile-api.invalid
```

This is intentional. Native networking fails closed until the deployed Worker URL is explicitly configured. After deployment, set the build setting to the exact `https://table-read-mobile-api.<account-subdomain>.workers.dev` URL or a production custom domain.

## Production verification

A release is not considered network-verified until all of these succeed against the deployed Worker:

1. `GET /health` returns `{ "ok": true }`.
2. Pairing administration creates a fresh 10-minute code.
3. The iPhone exchanges the code for a bearer token and stores it in Keychain.
4. `POST /api/mobile/sync` succeeds with that bearer token.
5. A test player/action created on the phone survives app restart and a second sync.
6. A synced observation can be undone offline and is deleted remotely after reconnect.
7. Revoking/unpairing the device causes the old bearer token to return HTTP 401.

## Security notes

- Pairing codes are single-use and expire after 10 minutes.
- Pairing-code consumption uses an atomic `UPDATE ... RETURNING` operation.
- Raw bearer tokens are returned only once and are never stored in D1.
- Pairing administration requires a separate secret and is not protected by the native bearer token itself.
- Request bodies and sync collection sizes are bounded.
- CORS is restricted to the configured web origin; native iOS requests do not depend on CORS.
- The Worker sends no-store, no-sniff, frame-ancestor, and referrer hardening headers.

# TableRead Poker Tracker

A mobile-first poker session companion for recording table positions, opponent tendencies, hand-by-hand actions, and results while you play.

Live app: https://table-read-poker-tracker.xac30x.chatgpt.site

## Features

- Run 6-player or 8-player table sessions
- Rotate table positions clockwise after each hand without moving players
- Add players to the current table or saved player pool
- Record preflop, postflop, bluffing, and general play-style notes
- Track hand-by-hand player actions
- Remove saved players from their full profile
- Keep separate cash-game and tournament result logs

## Tech stack

- TypeScript
- React 19
- Next.js 16
- Vinext and Vite
- Cloudflare Workers
- Cloudflare D1
- Drizzle ORM

## Requirements

- Node.js 22.13 or newer
- npm
- Linux for the included Sites lifecycle scripts

## Local development

```bash
npm ci
npm run dev
```

The application uses the `DB` D1 binding declared in `.openai/hosting.json`. Local runtime data is disposable and is excluded from Git.

## Quality checks

```bash
npm run lint
npm test
npm run build
```

## Project structure

- `app/components/poker-tracker.tsx` — live session, seats, player pool, and opponent notes
- `app/components/game-results.tsx` — cash-game and tournament logs
- `app/api/` — tracker and results persistence endpoints
- `db/` — Drizzle schema and database access
- `drizzle/` — D1 migrations and metadata
- `worker/` — Cloudflare Worker entry point
- `tests/` — rendered application checks

## Deployment

This project is configured for ChatGPT Sites. Production builds are created with:

```bash
npm run build
```

No secrets are stored in this repository. Keep local environment files out of Git.

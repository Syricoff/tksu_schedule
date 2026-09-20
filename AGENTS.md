# AGENTS.md

## Project overview

This repository contains a schedule app for KSU (КГУ им. К.Э. Циолковского) that runs as:

- a modern web application in `src/` (React 19 + TypeScript + Vite)
- an archived legacy static app in `legacy/` (vanilla HTML/JS/CSS)
- a Telegram Mini App / bot in `bot/` (entrypoint `bot.py` or `bot/bot.py`)
- a reliable data prefetch pipeline in `scripts/fetch_data.py`

The primary frontend is built with React 19, TypeScript, and Vite, deployed automatically to GitHub Pages via `.github/workflows/deploy.yml`.

## Key conventions

- Do not expose API tokens or secrets in client-side code.
- Treat `data/` as generated content. Prefer updating the fetch pipeline (`scripts/fetch_data.py`) rather than editing JSON by hand.
- Frontend architecture in `src/`:
  - `src/app/`: `App.tsx` (navigation & tabs), `app.css` (design system & Telegram theming)
  - `src/components/`: `students/`, `teachers/`, `schedule/` UI components
  - `src/data/`: data source interfaces (`dataSource.ts`, `staticDataSource.ts`, `normalize.ts`, `types.ts`)
  - `src/platform/`: platform detection and abstraction (`platform.ts`, `telegram.ts`)
  - `src/storage/`: typed local storage and offline cache (`storage.ts`, `scheduleCache.ts`)
  - `src/lib/`: dates, error handling, analytics
- Legacy frontend in `legacy/`:
  - Kept for backward compatibility and archival reference
  - Uses `export var DATA_BASE = '../data/'` to resolve schedule JSONs
  - Built into `dist/legacy` during production bundle
- Preserve Telegram/browser platform-aware behavior.

## Local workflow

```bash
# 1. Install Node dependencies and start Vite dev server
npm install
npm run dev

# 2. Run TypeScript checks and Vitest suite
npm run typecheck
npm run test

# 3. Production build
npm run build
npm run preview

# 4. Data pipeline (Python 3.12+)
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python scripts/fetch_data.py

# 5. Run Telegram bot
python bot.py
```

## Important project-specific rules

- `scripts/fetch_data.py` reads secrets from `.env` or environment variables; the web application only reads static JSON files from `data/`.
- `bot.py` expects `BOT_TOKEN` and `WEBAPP_URL` to exist in the environment.
- The GitHub Pages workflow in `.github/workflows/deploy.yml` fetches data before deploy, executes `typecheck` and `test`, builds Vite into `dist/`, and publishes `dist`.
- Always run `npm run typecheck` and `npm run test` before committing frontend changes.

## Files to inspect first

- `README.md` for product and deployment documentation
- `src/app/App.tsx` for main frontend state and tab routing
- `src/platform/telegram.ts` for Telegram Mini App integration
- `scripts/fetch_data.py` for API data prefetch with token bucket rate limiting
- `bot.py` and `bot/bot.py` for bot commands and notifications

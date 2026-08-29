# AGENTS.md

## Project overview

This repository contains a static schedule app for KSU (КГУ им. К.Э. Циолковского) that runs as:

- a browser app in `index.html` + `js/`
- a Telegram Mini App / bot in `bot.py`
- a data prefetch pipeline in `scripts/fetch_data.py`

The frontend is intentionally simple: vanilla JavaScript modules, no framework, no build step, and no direct API access from browser code.

## Key conventions

- Do not expose API tokens or secrets in client-side code.
- Treat `data/` as generated content. Prefer updating the fetch pipeline rather than editing JSON by hand.
- Keep the front-end logic aligned with the existing module split in `js/`:
  - `app.js` entry and event wiring
  - `students.js` / `teachers.js` schedule logic
  - `storage.js` local storage / platform persistence
  - `platform.js` Telegram / VK / browser abstraction
  - `renderer.js` rendering and formatting
  - `utils.js` date and helper logic
- Preserve the current platform-aware behavior: Telegram and VK have different back/navigation handling.

## Local workflow

```bash
# create or activate environment
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# refresh static data from API
python scripts/fetch_data.py

# run local web app
python -m http.server 8080

# run Telegram bot
python bot.py
```

## Important project-specific rules

- `scripts/fetch_data.py` reads secrets from environment variables or `.env`; the browser only reads static JSON files.
- `bot.py` expects `BOT_TOKEN` and `WEBAPP_URL` to exist in the environment.
- The GitHub Pages workflow in `.github/workflows/deploy.yml` fetches data before deploy and expects `TOKEN_STUDENTS` and `TOKEN_TEACHERS` secrets.
- There is no app build system or test suite in this repo; validate changes with direct, targeted checks and the existing runtime behavior.

## Files to inspect first

- `README.md` for deployment and product intent
- `js/app.js` for app bootstrapping and event flow
- `scripts/fetch_data.py` for data source and caching behavior
- `bot.py` for bot commands and schedule text output

## Contribution guidance

- Prefer surgical changes over broad refactors.
- Keep behavior platform-neutral unless a feature explicitly targets Telegram or VK.
- If a change affects schedule data flow, inspect both the fetch script and the client render path.
- If you add new fields to the schedule JSON, confirm both the parser and the UI can handle them without breaking existing views.

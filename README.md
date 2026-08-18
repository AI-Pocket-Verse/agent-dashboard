# Agent Dashboard

English | [中文](README-CN.md)

A web dashboard for orchestrating multiple Claude Code agents as DAG workflows. Draw agents on a canvas, wire them into a pipeline, and watch each node spawn a real `claude` CLI process with live streaming logs.

![Workflow canvas](docs/images/canvas.png)

![Create a task](docs/images/dashboard.png)

## Features

- **DAG workflow canvas** — compose custom agents and OMC agents into serial or parallel pipelines (powered by @xyflow); node outputs flow into downstream prompts via `{{nodes.<id>.output}}` interpolation.
- **Real process execution** — each node runs `claude` CLI in an isolated per-run workspace, with live log streaming over WebSocket.
- **AI agent selection** — describe a task and let the Anthropic API pick and wire the right agents for you.
- **Auto-fix loop** — when a `code-reviewer` node finds blocking issues, the dashboard offers up to 3 automatic fix rounds routed to the right agent.
- **Run history & workspace browser** — inspect every run's files, preview generated HTML prototypes, and page through logs.
- **Bilingual UI** — follows your system language (Simplified Chinese / English) out of the box, with an in-app switcher (bottom of the sidebar) to change it live.
- **Optional password auth** — leave `DASHBOARD_SECRET` empty for zero-friction local use (no login, nothing to remember); set it and one password protects both the HTTP API (Bearer, timing-safe) and the WebSocket channel via a login gate. Always set it for any deployment reachable by others.

## Requirements

- Node.js 22+, pnpm
- [Claude Code](https://claude.com/claude-code) CLI installed and authenticated (`claude` on PATH)
- `ANTHROPIC_API_KEY` (only for the AI agent-selection feature)

## Run locally

```bash
git clone <repo-url> && cd agent-dashboard
./start.sh
```

That's it — no password by default. On first run `start.sh`:

1. Generates `.env` (empty `DASHBOARD_SECRET` = auth disabled, `PROJECT_ROOT` = parent directory).
2. Installs dependencies (`pnpm install`) if needed.
3. Starts the server (port 3001, WebSocket 3002) and the client (port 5173).
4. Opens `http://localhost:5173` in your browser.

Stop with `Ctrl+C`; `./restart.sh` frees the ports and starts fresh. Prefer manual control?

```bash
pnpm install
pnpm dev          # = server (tsx watch) + client (vite) together
```

To require a password locally (e.g. the dashboard is reachable on your LAN), set a value in `.env` and restart:

```bash
DASHBOARD_SECRET=$(openssl rand -hex 16)
```

## Deploy with Docker

For servers, `DASHBOARD_SECRET` is **required** — without it the dashboard is open to anyone who can reach the host.

```bash
DASHBOARD_SECRET=$(openssl rand -hex 16) \
PROJECT_ROOT=/path/to/your/projects \
ANTHROPIC_API_KEY=sk-ant-... \
docker compose up -d --build
```

Then open `http://<host>/` and enter your `DASHBOARD_SECRET` in the login gate. Architecture:

- Only nginx (port 80, the `client` container) is exposed; it serves the web UI and proxies `/api` → server:3001 and `/ws` → server:3002 on the internal network.
- The server container ships the `claude` CLI and authenticates it with `ANTHROPIC_API_KEY`.
- Run history persists in `./server/data` on the host; agent workspaces live under `PROJECT_ROOT/workspace`.
- For anything reachable from the internet, put TLS in front (the token travels in headers and the WS query string).

**Never set `VITE_DASHBOARD_SECRET` for a production build** — it would bake the secret into the JS bundle. It exists only as a local-dev convenience.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `DASHBOARD_SECRET` | (empty) | Shared password for API + WebSocket; empty disables auth (local mode). Required for deployments |
| `PROJECT_ROOT` | — (required) | Root directory browsable in the file picker |
| `WORKSPACE_ROOT` | `$PROJECT_ROOT/workspace` | Where per-run agent workspaces are created |
| `CLAUDE_BIN` | `claude` | Claude CLI binary |
| `PORT` | `3001` | HTTP port (WebSocket uses `PORT+1`) |
| `DATA_DIR` | `server/data` | SQLite + run history storage |

## Build from source

```bash
pnpm install
pnpm --filter server test && pnpm --filter client test
pnpm dev   # server + client with hot reload
```

## License

[Apache-2.0](LICENSE)

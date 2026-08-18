# Agent Dashboard

English | [中文](README-CN.md)

A web dashboard for orchestrating multiple Claude Code agents as DAG workflows. Draw agents on a canvas, wire them into a pipeline, and watch each node spawn a real `claude` CLI process with live streaming logs.

## Features

- **DAG workflow canvas** — compose custom agents and OMC agents into serial or parallel pipelines (powered by @xyflow); node outputs flow into downstream prompts via `{{nodes.<id>.output}}` interpolation.
- **Real process execution** — each node runs `claude` CLI in an isolated per-run workspace, with live log streaming over WebSocket.
- **AI agent selection** — describe a task and let the Anthropic API pick and wire the right agents for you.
- **Auto-fix loop** — when a `code-reviewer` node finds blocking issues, the dashboard offers up to 3 automatic fix rounds routed to the right agent.
- **Run history & workspace browser** — inspect every run's files, preview generated HTML prototypes, and page through logs.
- **Single-password auth** — one `DASHBOARD_SECRET` protects both the HTTP API (Bearer, timing-safe) and the WebSocket channel; the web UI asks for it once via a login gate.

## Requirements

- Node.js 22+, pnpm
- [Claude Code](https://claude.com/claude-code) CLI installed and authenticated (`claude` on PATH)
- `ANTHROPIC_API_KEY` (only for the AI agent-selection feature)

## Quick start (local)

```bash
git clone <repo-url> && cd agent-dashboard
./start.sh
```

`start.sh` generates a `.env` with a random `DASHBOARD_SECRET` on first run, installs dependencies, starts the server (port 3001, WebSocket 3002) and the client (port 5173), prints the password, and opens your browser. Enter the printed password in the login gate.

## Deploy with Docker

```bash
DASHBOARD_SECRET=<strong-random-secret> \
PROJECT_ROOT=/path/to/your/projects \
ANTHROPIC_API_KEY=sk-ant-... \
docker compose up -d --build
```

Then open `http://<host>/` and enter your `DASHBOARD_SECRET`. Only nginx (port 80) is exposed; it proxies `/api` and `/ws` to the internal server. For anything reachable from the internet, put TLS in front (the token travels in headers and the WS query string).

**Never set `VITE_DASHBOARD_SECRET` for a production build** — it would bake the secret into the JS bundle. It exists only as a local-dev convenience.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `DASHBOARD_SECRET` | — (required) | Shared password for API + WebSocket |
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

MIT

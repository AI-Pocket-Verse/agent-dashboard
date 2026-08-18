#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[info] stopping old processes..."

# Kill processes on dashboard ports
for PORT in 3001 3002 5173; do
  PID=$(lsof -ti tcp:$PORT 2>/dev/null || true)
  if [ -n "$PID" ]; then
    kill "$PID" 2>/dev/null || true
    echo "[ok]   port $PORT released (PID $PID)"
  fi
done

sleep 1

echo "[info] restarting..."
exec "$DIR/start.sh"

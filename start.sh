#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$DIR/.env"

# Use the project Node version even when the script is launched from a shell
# that has not loaded nvm. Native deps such as better-sqlite3 are ABI-bound.
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  if [ -f "$DIR/.nvmrc" ]; then
    nvm use --silent "$(cat "$DIR/.nvmrc")" >/dev/null
  fi
fi

echo "[info] Node: $(node -v) ($(command -v node))"

# ── 1. 生成 .env（如果不存在）──────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  echo "[info] 未找到 .env，自动生成..."
  PROJECT_ROOT_VAL="$(dirname "$DIR")"
  cat > "$ENV_FILE" <<EOF
# 留空 = 本机免密模式（不弹登录页）；部署到服务器必须设置，例如：openssl rand -hex 16
DASHBOARD_SECRET=
PROJECT_ROOT=$PROJECT_ROOT_VAL
WORKSPACE_ROOT=$PROJECT_ROOT_VAL/workspace
CLAUDE_BIN=claude
PORT=3001
NODE_ENV=development
EOF
  echo "[ok]   .env 已生成：$ENV_FILE"
fi

# ── 2. 读取配置 ────────────────────────────────────────────────────────────────
set -a; source "$ENV_FILE"; set +a

PORT="${PORT:-3001}"
CLIENT_PORT=5173
SECRET="$DASHBOARD_SECRET"
WORKSPACE="${WORKSPACE_ROOT:-$(dirname "$DIR")/workspace}"

# 确保 workspace 目录存在
mkdir -p "$WORKSPACE"

# ── 3. 检查依赖 ────────────────────────────────────────────────────────────────
if [ ! -d "$DIR/node_modules" ]; then
  echo "[info] 安装依赖..."
  cd "$DIR" && pnpm install --silent
fi

# ── 4. 日志文件 ────────────────────────────────────────────────────────────────
SERVER_LOG="/tmp/agent-dashboard-server.log"
CLIENT_LOG="/tmp/agent-dashboard-client.log"
> "$SERVER_LOG"
> "$CLIENT_LOG"

# 带前缀实时转发日志到控制台
prefix_log() {
  local prefix="$1"
  local file="$2"
  tail -f "$file" | sed "s/^/[$prefix] /" &
}

# ── 5. 清理旧进程 ──────────────────────────────────────────────────────────────
cleanup() {
  echo ""
  echo "[info] 停止服务..."
  kill "$SERVER_PID" "$CLIENT_PID" "$TAIL_SERVER_PID" "$TAIL_CLIENT_PID" 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

# ── 6. 启动 Server ─────────────────────────────────────────────────────────────
echo "[server] 启动中 (端口 $PORT)..."
cd "$DIR" && pnpm --filter server dev > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!
prefix_log "server" "$SERVER_LOG"
TAIL_SERVER_PID=$!

# ── 7. 启动 Client ─────────────────────────────────────────────────────────────
echo "[client] 启动中 (端口 $CLIENT_PORT)..."
cd "$DIR" && VITE_DASHBOARD_SECRET="$SECRET" VITE_WS_URL="ws://localhost:$((PORT + 1))" \
  pnpm --filter client dev > "$CLIENT_LOG" 2>&1 &
CLIENT_PID=$!
prefix_log "client" "$CLIENT_LOG"
TAIL_CLIENT_PID=$!

# ── 8. 等待服务就绪 ────────────────────────────────────────────────────────────
echo "[info] 等待服务启动..."
for i in $(seq 1 30); do
  SERVER_OK=false
  CLIENT_OK=false
  curl -sf -H "Authorization: Bearer $SECRET" "http://localhost:$PORT/api/health" > /dev/null 2>&1 && SERVER_OK=true
  curl -sf "http://localhost:$CLIENT_PORT" > /dev/null 2>&1 && CLIENT_OK=true
  if $SERVER_OK && $CLIENT_OK; then break; fi
  sleep 1
done

# ── 9. 输出访问信息 ────────────────────────────────────────────────────────────
echo ""
echo "================================================"
echo "  Agent Dashboard 已启动"
echo ""
echo "  Web UI  ->  http://localhost:$CLIENT_PORT"
echo "  API     ->  http://localhost:$PORT/api"
if [ -n "$SECRET" ]; then
  echo "  密码    ->  $SECRET"
else
  echo "  密码    ->  （未设置，本机免密模式）"
fi
echo "================================================"
echo ""

# 在 macOS 上自动打开浏览器
if command -v open &>/dev/null; then
  open "http://localhost:$CLIENT_PORT"
fi

# ── 10. 保持运行（日志已实时流出到控制台）────────────────────────────────────
wait "$SERVER_PID" "$CLIENT_PID"

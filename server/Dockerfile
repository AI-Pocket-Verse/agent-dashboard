# Build context must be the repo root (see docker-compose.yml):
# the server depends on the @agent-dashboard/shared workspace package.
FROM node:22-bookworm-slim

RUN npm install -g pnpm@10.34.9 @anthropic-ai/claude-code && npm cache clean --force

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared ./shared
COPY server ./server
# --prod skips devDependencies (tsx lives in dependencies: it is the runtime).
RUN pnpm install --frozen-lockfile --prod --filter server... \
  && mkdir -p /app/data

# Starts as root only to fix ownership of /app/data, then drops to PUID/PGID
# (default 1000, the image's "node" user) before running anything else.
COPY server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]

# shared/ ships TypeScript sources (main: types.ts), so the server runs via tsx.
# node itself is the main process (no pnpm wrapper), so SIGTERM from `docker stop`
# reaches the server's handler, which terminates agent process groups.
WORKDIR /app/server
CMD ["node", "--import", "tsx", "src/index.ts"]

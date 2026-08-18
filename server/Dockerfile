# Build context must be the repo root (see docker-compose.yml):
# the server depends on the @agent-dashboard/shared workspace package.
FROM node:22-bookworm-slim

RUN npm install -g pnpm@10 @anthropic-ai/claude-code

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared ./shared
COPY server ./server
RUN pnpm install --frozen-lockfile --filter server...

# shared/ ships TypeScript sources (main: types.ts), so the server runs via tsx.
CMD ["pnpm", "--filter", "server", "exec", "tsx", "src/index.ts"]

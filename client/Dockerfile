# Build context must be the repo root (see docker-compose.yml):
# the client resolves @agent-dashboard/shared from ../shared.
FROM node:22-bookworm-slim AS build

RUN npm install -g pnpm@10.34.9

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared ./shared
COPY client ./client
# No VITE_DASHBOARD_SECRET here: the token is entered at runtime via the login gate.
RUN pnpm install --frozen-lockfile --filter client... && pnpm --filter client build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html

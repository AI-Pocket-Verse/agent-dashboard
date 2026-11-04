#!/usr/bin/env bash
# Smoke checks for a running `docker compose up -d` (see docker-smoke.yml).
# Expects DASHBOARD_SECRET and PUID in the environment.
set -euo pipefail

BASE=http://localhost
AUTH="Authorization: Bearer ${DASHBOARD_SECRET}"

wait_healthy() {
  for _ in $(seq 1 60); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" "$BASE/api/health")" = "200" ]; then return 0; fi
    sleep 1
  done
  echo "server did not become healthy through nginx"; return 1
}

expect_eq() { # name actual expected
  if [ "$2" != "$3" ]; then echo "FAIL $1: got '$2', expected '$3'"; exit 1; fi
  echo "ok   $1: $2"
}

wait_healthy

expect_eq "health without token" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health")" 401
expect_eq "health with token" "$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" "$BASE/api/health")" 200
expect_eq "web UI served" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")" 200

# PID 1 is tini (init: true) and stays root; the node server is its child and must be dropped to PUID
node_uid() { docker compose exec -T server sh -c 'for p in /proc/[0-9]*; do if [ "$(cat "$p/comm" 2>/dev/null)" = node ]; then stat -c %u "$p"; exit 0; fi; done; echo none'; }
expect_eq "server (node) process uid" "$(node_uid)" "$PUID"
expect_eq "database owner" "$(stat -c %u server/data/app.db)" "$PUID"
expect_eq "legacy root-owned data handed over" "$(stat -c %u server/data/legacy-root-file)" "$PUID"

docker compose exec -T client nginx -t
echo "ok   nginx -t"

node .github/scripts/ws-check.mjs "ws://localhost/ws" "$DASHBOARD_SECRET"

# A recreated server container can get a new IP; nginx must re-resolve it.
# A placeholder joins the network after the old container is removed, taking
# the next free address, so the new server container lands on a different one.
# This relies on Docker's IPAM handing out free addresses in order; if that ever
# changes the check fails loudly ("kept its IP") rather than passing silently.
server_ip() { docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$(docker compose ps -q server)"; }
network="$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{end}}' "$(docker compose ps -q server)")"
old_ip="$(server_ip)"
docker compose rm -sf server
docker run -d --rm --name ip-placeholder --network "$network" alpine:3.20 sleep 600 > /dev/null
docker compose up -d --no-deps server
new_ip="$(server_ip)"
if [ "$new_ip" = "$old_ip" ]; then echo "FAIL server kept its IP ($old_ip); re-resolution not exercised"; exit 1; fi
echo "ok   server moved $old_ip -> $new_ip"
wait_healthy
docker rm -f ip-placeholder > /dev/null
echo "ok   nginx reaches the recreated server"

# docker stop must reach the server's SIGTERM handler (exit 143, agent groups
# cleaned up), not time out into SIGKILL (137)
docker compose stop -t 20 server
expect_eq "server exit code on docker stop" "$(docker inspect -f '{{.State.ExitCode}}' "$(docker compose ps -aq server)")" 143

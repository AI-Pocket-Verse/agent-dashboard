#!/bin/sh
# Runs the server as an unprivileged user (PUID/PGID, default 1000 = the image's
# "node" user) so files agents create in the mounted project are owned by the
# host user rather than root.
set -eu

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
export HOME=/home/node

if [ "$PUID" = "0" ]; then
  echo "warning: PUID=0 runs agents as root; set PUID/PGID to your own user instead" >&2
fi

if [ "$(id -u)" = "0" ]; then
  # Data written by older root-run containers (and bind mounts Docker created as
  # root) must be handed over, or SQLite cannot write after the upgrade.
  # The mounted PROJECT_ROOT is the user's own tree and is never chowned.
  chown -R "$PUID:$PGID" /app/data "$HOME"
  exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups -- "$@"
fi

exec "$@"

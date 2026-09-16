#!/bin/sh
set -e

# supervisord runs as root so caddy can bind the privileged :80 port; the
# app processes drop to the non-root `ozpos` user. Fix volume ownership
# here in case a volume was created by an earlier root-based image.
# DOCKER-11: a single /data volume serves both functions — sync SQLite at
# /data/kasir.db and PocketBase at /data/pb_data.
if [ "$(id -u)" = "0" ]; then
    mkdir -p /data /data/pb_data
    chown -R ozpos:ozpos /data || true
fi

exec "$@"

#!/bin/sh
# Start uvicorn so the API is ALWAYS available; run Litestream alongside it only
# when R2 is configured. A Litestream/R2 problem must never take the API down
# (the previous `litestream replicate -exec uvicorn` coupling did exactly that).
set -u

DB_PATH="${DB_PATH:-/data/finance.db}"
PORT="${PORT:-8000}"
export DB_PATH

if [ -n "${LITESTREAM_REPLICA_BUCKET:-}" ] && [ -n "${LITESTREAM_REPLICA_ENDPOINT:-}" ]; then
  # Restore on boot if the local DB is missing but a replica exists.
  if [ ! -f "$DB_PATH" ]; then
    echo "[entrypoint] No DB at $DB_PATH; attempting Litestream restore..."
    litestream restore -if-replica-exists -config litestream.yml -o "$DB_PATH" "$DB_PATH" \
      || echo "[entrypoint] Restore skipped/failed; continuing with a fresh DB."
  fi
  echo "[entrypoint] Starting Litestream replication in the background."
  litestream replicate -config litestream.yml &
else
  echo "[entrypoint] LITESTREAM_* not configured; running WITHOUT replication (no backups)."
fi

echo "[entrypoint] Starting uvicorn on 0.0.0.0:$PORT"
exec uvicorn backend.main:app --host 0.0.0.0 --port "$PORT"

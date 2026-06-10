# Litestream — DB durability for claudeFinance

The SQLite database (`DB_PATH`, prod `/data/finance.db`) is continuously
replicated to Cloudflare R2 by [Litestream](https://litestream.io). Config lives
in [`litestream.yml`](../litestream.yml); the binary is installed and the start
command set by the [`Dockerfile`](../Dockerfile) (Railway builds via Dockerfile —
see [`railway.toml`](../railway.toml)). nixpacks was dropped because it would not
reliably place the Litestream binary on PATH.

## How it runs in production

```
litestream replicate -config litestream.yml -exec "uvicorn backend.main:app --host 0.0.0.0 --port $PORT"
```

Litestream streams WAL frames to R2 while uvicorn runs, and does a final sync when
uvicorn exits.

> **Restore-on-boot caveat.** `replicate -exec` does **not** restore on startup —
> it only replicates. On a *fresh* volume (empty `/data`), the app starts with an
> empty DB (init_db creates the schema) and Litestream begins a new generation.
> To recover existing data after volume loss, run a one-time restore before the
> first replicate (see below), or front the start command with:
> `litestream restore -if-replica-exists -o "$DB_PATH" "$DB_PATH" && litestream replicate ...`.

## Owner manual steps (one-time)

1. **Cloudflare R2:** create a bucket and an API token (Access Key ID + Secret).
   Note the S3 endpoint: `https://<account-id>.r2.cloudflarestorage.com`.
2. **Railway volume:** create a volume, mount at `/data`.
3. **Railway env vars:**
   - `DB_PATH=/data/finance.db`
   - `LITESTREAM_REPLICA_BUCKET=<bucket>`
   - `LITESTREAM_REPLICA_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`
   - `LITESTREAM_ACCESS_KEY_ID=<key>`
   - `LITESTREAM_SECRET_ACCESS_KEY=<secret>`

## Disaster recovery (restore from R2)

```
litestream restore -config litestream.yml -o /data/finance.db /data/finance.db
```

## Local verification (executed 2026-06-10, Litestream v0.3.13)

A `file://` replica round-trip proves the replicate → restore → boot cycle without
needing R2. Replace the `s3` replica with a `file` replica pointing at a temp dir,
then:

```
# 1. create a source DB with the real schema + a marker row
DB_PATH=/tmp/ls-verify/source.db python -c "from backend.db import init_db, execute; init_db(); execute('INSERT INTO users (stytch_user_id,email,created_at) VALUES (?,?,?)',('marker','restore@test.io','2026-06-10'))"

# 2. replicate (runs during the exec window, then final-syncs)
litestream replicate -config /tmp/ls-verify/ls.yml -exec "sleep 3"

# 3. restore to a fresh path
litestream restore -config /tmp/ls-verify/ls.yml -o /tmp/ls-verify/restored.db /tmp/ls-verify/source.db

# 4. boot the app's DB layer against the restored copy
DB_PATH=/tmp/ls-verify/restored.db python -c "from backend.db import fetchone; print(dict(fetchone('SELECT email FROM users WHERE stytch_user_id=?', ('marker',))))"
```

Result: the marker row (`restore@test.io`) was present in the restored DB and the
app's DB layer read it successfully — **RESTORE VERIFIED OK**.

> Note: Homebrew has no `litestream` formula; install from the GitHub release
> binary (`litestream-v0.3.13-darwin-arm64.zip`) for local testing.

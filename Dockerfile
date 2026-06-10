# Backend image for Railway (api.finance.dalty.io).
# Replaces the nixpacks build because nixpacks would not reliably place the
# Litestream binary on PATH. The frontend is served by Vercel, so this image is
# API-only (no node/frontend build).

FROM python:3.12-slim

# --- Litestream binary (pinned) ---
# ADD fetches the release tarball; Debian slim already includes tar.
ADD https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.tar.gz /tmp/litestream.tar.gz
RUN tar -C /usr/local/bin -xzf /tmp/litestream.tar.gz && rm /tmp/litestream.tar.gz && litestream version

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Litestream continuously replicates the SQLite DB (DB_PATH=/data/finance.db) to
# R2 while uvicorn runs. Shell form so $PORT expands at runtime.
CMD litestream replicate -config litestream.yml -exec "uvicorn backend.main:app --host 0.0.0.0 --port $PORT"

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
RUN chmod +x /app/entrypoint.sh

# entrypoint.sh always starts uvicorn; it runs Litestream alongside only when R2
# is configured, so backup/replication issues can't take the API down.
CMD ["/app/entrypoint.sh"]

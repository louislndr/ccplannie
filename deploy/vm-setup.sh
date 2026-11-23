#!/bin/bash
# Runs ON the server (as root) via scripts/deploy-gcp.sh. Idempotent: safe to re-run for every update.
# Installs Node and Caddy, unpacks the app into /opt/ccplannie, keeps data/ and .env, and runs the company
# console as a systemd service behind Caddy (automatic HTTPS for the given hostname).
set -euo pipefail
HOST="$1"
export DEBIAN_FRONTEND=noninteractive

# The free e2-micro has 1 GB of RAM: add swap so npm installs don't run out of memory.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! node -v 2>/dev/null | grep -qE '^v(2[2-9]|[3-9][0-9])'; then
  apt-get update -q && apt-get install -yq ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -yq nodejs
fi

if ! command -v caddy >/dev/null; then
  apt-get install -yq debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -yq caddy
fi

id plannie >/dev/null 2>&1 || useradd --system --home /opt/ccplannie --shell /usr/sbin/nologin plannie
mkdir -p /opt/ccplannie/data
# Replace code, keep the database (data/) and secrets (.env).
find /opt/ccplannie -mindepth 1 -maxdepth 1 ! -name data ! -name .env -exec rm -rf {} +
tar xzf /tmp/ccplannie.tgz -C /opt/ccplannie
install -m 600 /tmp/plannie.env /opt/ccplannie/.env
rm -f /tmp/plannie.env
cd /opt/ccplannie && npm ci --omit=dev --no-audit --no-fund --loglevel=error
chown -R plannie:plannie /opt/ccplannie

cat > /etc/systemd/system/plannie.service <<UNIT
[Unit]
Description=cc Plannie company console
After=network-online.target
Wants=network-online.target

[Service]
User=plannie
WorkingDirectory=/opt/ccplannie
Environment=PLANNIE_MODE=company
Environment=PORT=3001
Environment=PLANNIE_DB=data/company.sqlite
ExecStart=/usr/bin/node --no-warnings server.mjs
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/ccplannie/data
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/caddy/Caddyfile <<CADDY
$HOST {
  encode gzip
  reverse_proxy 127.0.0.1:3001
}
CADDY

systemctl daemon-reload
systemctl enable plannie >/dev/null
systemctl restart plannie
systemctl reload caddy || systemctl restart caddy
sleep 3
systemctl --no-pager --lines=8 status plannie | tail -8

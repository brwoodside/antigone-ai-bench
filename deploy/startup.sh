#!/bin/bash
set -euxo pipefail
exec > >(tee -a /var/log/antigone-startup.log) 2>&1
echo "=== antigone startup $(date -Iseconds) ==="

PROJECT_REGION=us-west1
AR_HOST=${PROJECT_REGION}-docker.pkg.dev
AR_PATH=${AR_HOST}/brw-homepage/antigone-bench

if ! command -v docker >/dev/null; then
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi

TOKEN=$(curl -sS -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
echo "$TOKEN" | docker login -u oauth2accesstoken --password-stdin "$AR_HOST"

mkdir -p /opt/antigone/data
chown -R 10001:10001 /opt/antigone/data
cat > /opt/antigone/Caddyfile <<'EOF'
bench.brw.ai {
    handle /api/* {
        reverse_proxy backend:8080
    }
    handle {
        reverse_proxy frontend:80
    }
}
EOF

cat > /opt/antigone/compose.yml <<EOF
services:
  backend:
    image: ${AR_PATH}/backend:v1
    volumes:
      - ./data:/app/data
    environment:
      - DB_PATH=/app/data/history.db
      - ALLOWED_ORIGINS=https://bench.brw.ai
    restart: unless-stopped

  frontend:
    image: ${AR_PATH}/frontend:v2
    restart: unless-stopped

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - frontend
      - backend

volumes:
  caddy_data:
  caddy_config:
EOF

cd /opt/antigone
docker compose pull
docker compose up -d
echo "=== antigone up $(date -Iseconds) ==="

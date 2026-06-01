#!/usr/bin/env bash
#
# Mukhtar_Abbasi_VotersTreeSys — DigitalOcean Droplet bootstrap.
#
# Target: fresh Ubuntu 24.04 LTS, 2 vCPU / 4 GB / 80 GB ($24 plan).
# Run as root the first time (paste this into the DO web console or SSH).
# The script is idempotent: it's safe to re-run after editing .env files.
#
# Usage (root shell on the Droplet):
#   curl -fsSL https://raw.githubusercontent.com/umerslone/Mukhtar_Abbasi_VotersTreeSys/main/infra/droplet/bootstrap.sh \
#     | DOMAIN=voters.example.com bash
#
# Or upload the file and run:
#   DOMAIN=voters.example.com bash bootstrap.sh
#
# Omit DOMAIN to skip nginx + TLS (you'll hit Next.js directly on port 3000).
#
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/umerslone/Mukhtar_Abbasi_VotersTreeSys.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_DIR="/home/${DEPLOY_USER}/Mukhtar_Abbasi_VotersTreeSys"
DOMAIN="${DOMAIN:-}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-admin@${DOMAIN:-example.com}}"

log() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m⚠ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root: sudo bash $0"

# ── 1. System packages ────────────────────────────────────────────────
log "Updating apt and installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq \
  curl git ufw nginx ca-certificates gnupg \
  python3-venv python3-pip poppler-utils libgl1 \
  build-essential

# Node.js 22 LTS
if ! command -v node >/dev/null || ! node -v | grep -q '^v22\.'; then
  log "Installing Node.js 22.x"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

# pm2 (process manager)
if ! command -v pm2 >/dev/null; then
  log "Installing pm2"
  npm install -g pm2
fi

# certbot only if a domain is set
if [[ -n "$DOMAIN" ]]; then
  apt-get install -y -qq certbot python3-certbot-nginx
fi

# ── 2. 2 GB swap (safety net for PaddleOCR warm-up) ───────────────────
if [[ ! -f /swapfile ]]; then
  log "Creating 2 GB swapfile"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ── 3. Firewall ───────────────────────────────────────────────────────
log "Configuring UFW firewall"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null || ufw allow 80/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
yes | ufw enable >/dev/null 2>&1 || true

# ── 4. Deploy user ────────────────────────────────────────────────────
if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  log "Creating user '$DEPLOY_USER'"
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
  usermod -aG sudo "$DEPLOY_USER"
  mkdir -p "/home/$DEPLOY_USER/.ssh"
  if [[ -f /root/.ssh/authorized_keys ]]; then
    cp /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/"
    chown -R "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
    chmod 700 "/home/$DEPLOY_USER/.ssh"
    chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
  fi
fi

# ── 5. Clone or pull repo ─────────────────────────────────────────────
if [[ -d "$APP_DIR/.git" ]]; then
  log "Pulling latest from origin/$REPO_BRANCH"
  sudo -u "$DEPLOY_USER" bash -c "cd '$APP_DIR' && git fetch origin && git checkout $REPO_BRANCH && git pull --ff-only"
else
  log "Cloning $REPO_URL into $APP_DIR"
  sudo -u "$DEPLOY_USER" git clone --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
fi

# ── 6. Bootstrap .env files if missing ────────────────────────────────
WEB_ENV="$APP_DIR/web_app/.env"
OCR_ENV="$APP_DIR/voter_ocr_service/.env"
MISSING_ENV=0

if [[ ! -f "$WEB_ENV" ]]; then
  log "Seeding $WEB_ENV from .env.example"
  sudo -u "$DEPLOY_USER" cp "$APP_DIR/web_app/.env.example" "$WEB_ENV"
  # Default OCR_SERVICE_URL to local Flask for this Droplet
  sudo -u "$DEPLOY_USER" sed -i 's|^OCR_SERVICE_URL=.*|OCR_SERVICE_URL="http://127.0.0.1:5005"|' "$WEB_ENV"
  MISSING_ENV=1
fi

if [[ ! -f "$OCR_ENV" && -f "$APP_DIR/voter_ocr_service/.env.example" ]]; then
  log "Seeding $OCR_ENV from .env.example"
  sudo -u "$DEPLOY_USER" cp "$APP_DIR/voter_ocr_service/.env.example" "$OCR_ENV"
  sudo -u "$DEPLOY_USER" sed -i 's|^HOST=.*|HOST=127.0.0.1|; s|^PORT=.*|PORT=5005|; s|^OCR_WORKERS=.*|OCR_WORKERS=1|' "$OCR_ENV"
fi

if [[ $MISSING_ENV -eq 1 ]]; then
  warn "Stopping: fill in secrets, then re-run this script."
  cat <<EOM

  Required edits before re-running:
    1) ${WEB_ENV}
       - DATABASE_URL=...                 (Neon postgres URL)
       - DIRECT_URL=...                   (Neon direct URL, optional)
       - NEXTAUTH_URL=https://${DOMAIN:-your-domain.example}
       - NEXTAUTH_SECRET=$(openssl rand -base64 32)
       - AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=...
       - AZURE_DOCUMENT_INTELLIGENCE_KEY=...
       - AZURE_OPENAI_*                   (if you use the cleanup pipeline)
       - OCR_SERVICE_URL=http://127.0.0.1:5005   (already set)

    2) ${OCR_ENV}                        (defaults are fine for local-only)

  Edit them:
       sudo -u ${DEPLOY_USER} nano ${WEB_ENV}
       sudo -u ${DEPLOY_USER} nano ${OCR_ENV}

  Then rerun:
       DOMAIN=${DOMAIN:-your-domain.example} bash $0

EOM
  exit 0
fi

# ── 7. Build Next.js ──────────────────────────────────────────────────
log "Installing & building Next.js (web_app/)"
sudo -u "$DEPLOY_USER" bash -lc "
  cd '$APP_DIR/web_app' &&
  npm ci &&
  npx prisma generate &&
  npm run build
"

# ── 8. Build Flask/PaddleOCR venv ─────────────────────────────────────
log "Installing Python venv for voter_ocr_service/ (this takes ~10 min on first run)"
sudo -u "$DEPLOY_USER" bash -lc "
  cd '$APP_DIR/voter_ocr_service' &&
  [[ -d .venv ]] || python3 -m venv .venv &&
  . .venv/bin/activate &&
  pip install --upgrade pip wheel -q &&
  pip install -r requirements.txt
"

# ── 9. pm2 processes ──────────────────────────────────────────────────
log "Starting / reloading pm2 processes"
sudo -u "$DEPLOY_USER" bash -lc "
  cd '$APP_DIR' &&
  pm2 describe voters-web >/dev/null 2>&1 \
    && pm2 reload voters-web --update-env \
    || pm2 start 'npm start' --name voters-web --cwd '$APP_DIR/web_app'

  pm2 describe voters-ocr >/dev/null 2>&1 \
    && pm2 reload voters-ocr --update-env \
    || pm2 start '.venv/bin/waitress-serve --listen=127.0.0.1:5005 app:app' \
         --name voters-ocr --cwd '$APP_DIR/voter_ocr_service'

  pm2 save
"

# Persist pm2 across reboots (only first time)
if ! systemctl is-enabled "pm2-${DEPLOY_USER}" >/dev/null 2>&1; then
  log "Enabling pm2 systemd unit for ${DEPLOY_USER}"
  env PATH=$PATH:/usr/bin pm2 startup systemd -u "$DEPLOY_USER" --hp "/home/${DEPLOY_USER}" >/dev/null
  sudo -u "$DEPLOY_USER" pm2 save >/dev/null
fi

# ── 10. nginx + TLS (only if DOMAIN set) ──────────────────────────────
if [[ -n "$DOMAIN" ]]; then
  log "Configuring nginx for $DOMAIN"
  cat > /etc/nginx/sites-available/voters <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};
    client_max_body_size 60M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
NGINX
  ln -sf /etc/nginx/sites-available/voters /etc/nginx/sites-enabled/voters
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl reload nginx

  if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
    log "Issuing Let's Encrypt cert for $DOMAIN"
    certbot --nginx -n --agree-tos -m "$LETSENCRYPT_EMAIL" -d "$DOMAIN" --redirect || \
      warn "certbot failed — check DNS A record for $DOMAIN points at $(curl -s ifconfig.me)"
  fi
else
  warn "DOMAIN not set — skipping nginx + TLS. Next.js is reachable on http://<droplet-ip>:3000 (open port 3000 in UFW if you need this)."
fi

# ── 11. Summary ───────────────────────────────────────────────────────
log "Done. Process status:"
sudo -u "$DEPLOY_USER" pm2 status

cat <<EOM

Next steps:
  • Test:   curl -sS http://127.0.0.1:3000 | head
  • Logs:   sudo -u ${DEPLOY_USER} pm2 logs voters-web --lines 100
            sudo -u ${DEPLOY_USER} pm2 logs voters-ocr --lines 100
  • Update: cd ${APP_DIR} && sudo -u ${DEPLOY_USER} git pull && bash $0
  • Public URL: ${DOMAIN:+https://${DOMAIN}}${DOMAIN:-http://$(curl -s ifconfig.me):3000}

EOM

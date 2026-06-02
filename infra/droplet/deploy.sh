#!/usr/bin/env bash
#
# Incremental deploy. Runs on the Droplet as the `deploy` user via GitHub
# Actions (or manually). Pulls latest main, only reinstalls deps when their
# lockfiles changed, rebuilds Next.js, reloads pm2.
#
# Idempotent and safe to run repeatedly.
#
set -euo pipefail

cd "$(dirname "$0")/../.."   # repo root
APP_DIR="$(pwd)"

echo "▶ Pulling latest main"
git fetch origin
git reset --hard origin/main

# ── Next.js ──────────────────────────────────────────────────────────
cd "$APP_DIR/web_app"

# Reinstall node_modules only when package-lock.json changed since last deploy
HASH_FILE=".deploy-lock-hash"
NEW_HASH="$(sha256sum package-lock.json | cut -d' ' -f1)"
OLD_HASH="$(cat "$HASH_FILE" 2>/dev/null || true)"

if [[ "$NEW_HASH" != "$OLD_HASH" ]]; then
  echo "▶ package-lock changed → npm ci"
  npm ci --no-audit --no-fund
  echo "$NEW_HASH" > "$HASH_FILE"
else
  echo "▶ package-lock unchanged → skipping npm ci"
fi

echo "▶ prisma generate"
npx prisma generate

# Apply any schema changes pushed from dev (no migrations folder in this repo)
if [[ "${RUN_DB_PUSH:-0}" = "1" ]]; then
  echo "▶ prisma db push"
  npx prisma db push --skip-generate
  echo "▶ backfill CNIC keys"
  npm run cnic:backfill
fi

echo "▶ next build"
npm run build

# ── OCR service ──────────────────────────────────────────────────────
cd "$APP_DIR/voter_ocr_service"
OCR_HASH_FILE=".deploy-req-hash"
NEW_OCR_HASH="$(sha256sum requirements.txt | cut -d' ' -f1)"
OLD_OCR_HASH="$(cat "$OCR_HASH_FILE" 2>/dev/null || true)"

if [[ "$NEW_OCR_HASH" != "$OLD_OCR_HASH" ]]; then
  echo "▶ requirements.txt changed → reinstalling Python deps"
  [[ -d .venv ]] || python3 -m venv .venv
  . .venv/bin/activate
  pip install --upgrade pip wheel -q
  pip install -r requirements.txt
  echo "$NEW_OCR_HASH" > "$OCR_HASH_FILE"
else
  echo "▶ requirements.txt unchanged → skipping pip install"
fi

# ── Reload pm2 ───────────────────────────────────────────────────────
echo "▶ pm2 reload"
pm2 reload voters-web --update-env
pm2 reload voters-ocr --update-env
pm2 save

echo "✅ Deploy complete: $(git rev-parse --short HEAD)"

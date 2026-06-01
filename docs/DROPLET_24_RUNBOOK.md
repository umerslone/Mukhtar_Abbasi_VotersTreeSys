# DigitalOcean $24/mo Droplet runbook — Next.js + PaddleOCR side by side

This guide stands up a single Ubuntu 24.04 Droplet that hosts **both**
the Next.js web app and the Flask/PaddleOCR sidecar, so you can flip
between the two OCR engines per upload (`?engine=azure|paddle` on
`/api/ocr-extract`, or the radio toggle on `/ingest`).

| Item            | Value                                                |
| --------------- | ---------------------------------------------------- |
| Droplet plan    | Basic Regular Intel, **2 vCPU / 4 GB RAM / 80 GB**  |
| Price (Jun 2026)| $24 / month                                          |
| OS image        | Ubuntu 24.04 LTS x64                                 |
| Region          | Pick the one nearest your users (BLR / SGP for AJK) |

## 1. Provision

```bash
# from your workstation
ssh root@<droplet-ip>
adduser deploy && usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh/ /home/deploy/.ssh/
```

Add 2 GB swap (safety net for PaddleOCR warm-up):

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 2. System packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git nginx certbot python3-certbot-nginx \
                    python3-venv python3-pip poppler-utils \
                    build-essential libgl1
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2
```

`poppler-utils` is required by `pdf2image`; `libgl1` is needed by OpenCV
inside PaddleOCR.

## 3. Clone the repo

```bash
su - deploy
git clone https://github.com/umerslone/Mukhtar_Abbasi_VotersTreeSys.git
cd Mukhtar_Abbasi_VotersTreeSys
```

## 4. Flask / PaddleOCR sidecar (`voter_ocr_service/`)

```bash
cd ~/Mukhtar_Abbasi_VotersTreeSys/voter_ocr_service
python3 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip wheel
pip install -r requirements.txt        # ~10 min — pulls PaddlePaddle CPU
cp .env.example .env
```

Edit `.env`:

```ini
HOST=127.0.0.1
PORT=5005
OCR_WORKERS=1          # 2 vCPU + Paddle = keep this at 1
LOG_LEVEL=info
```

Start it under pm2 (uses the gevent-friendly `waitress` server already
in `requirements.txt`):

```bash
pm2 start ".venv/bin/waitress-serve --listen=127.0.0.1:5005 app:app" \
    --name voters-ocr \
    --cwd /home/deploy/Mukhtar_Abbasi_VotersTreeSys/voter_ocr_service
pm2 logs voters-ocr   # watch first request download ~200 MB of models
```

## 5. Next.js web app (`web_app/`)

```bash
cd ~/Mukhtar_Abbasi_VotersTreeSys/web_app
cp .env.example .env
# fill: DATABASE_URL, NEXTAUTH_URL, NEXTAUTH_SECRET,
#       AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT / _KEY,
#       AZURE_OPENAI_*,
#       OCR_SERVICE_URL=http://127.0.0.1:5005
npm ci
npx prisma generate
npm run build

pm2 start "npm start" --name voters-web \
    --cwd /home/deploy/Mukhtar_Abbasi_VotersTreeSys/web_app
```

Persist both processes across reboots:

```bash
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u deploy --hp /home/deploy
```

## 6. nginx + TLS

`/etc/nginx/sites-available/voters`:

```nginx
server {
    listen 80;
    server_name your-domain.example;

    client_max_body_size 60M;   # PDF uploads up to ~50 MB

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;    # Paddle pages can take 30s+
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/voters /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d your-domain.example
```

The Flask service stays bound to `127.0.0.1:5005` and is **never**
exposed to the internet — the Next.js process is the only client.

## 7. Smoke test

```bash
# from the Droplet:
curl -F file=@sample.pdf http://127.0.0.1:5005/extract-voters | head

# from your laptop, hit each engine:
curl -F file=@sample.pdf "https://your-domain.example/api/ocr-extract?engine=azure"
curl -F file=@sample.pdf "https://your-domain.example/api/ocr-extract?engine=paddle"
```

In the UI, `/ingest` now shows two pills — **Azure Document
Intelligence** (default) and **PaddleOCR (self-hosted)**.

## 8. Sizing notes for 4 GB / 2 vCPU

- Paddle's first request downloads detection + recognition + table
  models into `~/.paddleocr/` (~200 MB) and warms up — budget **30–60 s**
  cold start. Subsequent pages: **10–30 s/page**.
- Keep `OCR_WORKERS=1`. Two workers will OOM on a 4 GB box once Next.js
  is also serving traffic.
- If Paddle alone saturates the box during a batch, run the OCR job
  off-peak or temporarily stop `voters-web` (`pm2 stop voters-web`).
- For Azure-only traffic, this Droplet is huge — you can downgrade to
  the $12 plan (1 vCPU / 2 GB) and disable `voters-ocr`.

## 9. Day-2 ops

```bash
pm2 status                       # see both processes
pm2 logs voters-web --lines 200
pm2 logs voters-ocr --lines 200
pm2 restart voters-web
cd ~/Mukhtar_Abbasi_VotersTreeSys && git pull \
  && (cd web_app && npm ci && npm run build && pm2 restart voters-web) \
  && (cd voter_ocr_service && . .venv/bin/activate && pip install -r requirements.txt && pm2 restart voters-ocr)
```

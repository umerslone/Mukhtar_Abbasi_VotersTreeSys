# Voter OCR Microservice

Production-grade Flask microservice that turns scanned **Urdu voter list PDFs/images** into structured, ingest-ready JSON / CSV — using **PaddleOCR + PPStructure** for table-aware Urdu OCR.

> Drop-in companion to the existing Next.js + Prisma `web_app/` in this repo. Output JSON shape **matches the Prisma `Voter` model exactly**, so the existing `/api/ingest` endpoint accepts it without any code changes.

---

## Folder layout

```
voter_ocr_service/
├── app.py                    # Flask entrypoint
├── config.py                 # env-driven config
├── requirements.txt
├── .env.example
├── uploads/                  # raw incoming files
├── outputs/                  # generated voters_<job>.json / .csv
├── temp/                     # rasterized PDF pages per job
├── services/
│   ├── pdf_service.py        # pdf2image → PNG pages
│   ├── image_service.py      # OpenCV preprocessing (deskew, denoise, CLAHE)
│   ├── table_service.py      # PPStructure + row-clustering fallback
│   ├── ocr_service.py        # PaddleOCR / PPStructure singletons
│   ├── parser_service.py     # cells → VoterRecord (CNIC/age/gender/serial regex)
│   ├── cleaner_service.py    # Urdu normalization per-cell
│   ├── export_service.py     # JSON + CSV writers
│   ├── search_service.py     # in-memory fuzzy search (rapidfuzz)
│   └── relationship_service.py  # ولد/بنت/زوجہ → father edges
├── routes/
│   ├── upload_routes.py      # POST /extract-voters
│   ├── search_routes.py      # GET  /search
│   └── export_routes.py      # GET  /exports/<file>
├── utils/
│   ├── urdu_normalizer.py    # reuses etl_pipeline/urdu_alphabet.py when on path
│   ├── regex_patterns.py     # CNIC, block code, gender, integer, rel markers
│   └── logger.py
└── models/
    └── voter_model.py        # VoterRecord dataclass (matches Prisma)
```

---

## Quick start (Windows / PowerShell)

```powershell
# 1. Install Poppler (required by pdf2image)
#    Download:  https://github.com/oschwartz10612/poppler-windows/releases
#    Extract to e.g.  C:\poppler-24.07.0\
#    Either add  C:\poppler-24.07.0\Library\bin  to PATH,
#    or set POPPLER_PATH in .env.

# 2. Python venv + deps
cd D:\Mukhtar_Abbasi_VotersTreeSys\voter_ocr_service
python -m venv .venv
. .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# 3. Config
Copy-Item .env.example .env
# edit .env — set POPPLER_PATH if Poppler isn't on PATH

# 4. Run
python app.py
# → http://localhost:5005/health
```

## Quick start (Linux / macOS)

```bash
sudo apt-get install -y poppler-utils        # or `brew install poppler` on macOS

cd voter_ocr_service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
gunicorn -w 2 -b 0.0.0.0:5005 app:app
```

> **First request takes 30–60s** while PaddleOCR downloads the Arabic detection/recognition/cls model weights (≈200 MB). Subsequent requests are fast.

---

## API

### `POST /extract-voters`
multipart/form-data, field `file` = `.pdf` / `.png` / `.jpg` / `.jpeg` / `.tiff` / `.bmp`.

Response:
```json
{
  "success": true,
  "job_id": "a1b2c3d4e5f6",
  "total_voters": 1153,
  "polling_station": "822310202007",
  "pages": 24,
  "elapsed_seconds": 92.4,
  "outputs": {
    "json": "/exports/voters_a1b2c3d4e5f6.json",
    "csv":  "/exports/voters_a1b2c3d4e5f6.csv"
  },
  "edges": [ { "person_cnic": "...", "father_name": "..." } ],
  "data": [
    {
      "serial_no": "1",
      "name": "محمد اسلم",
      "father_husband_name": "عبدالحمید",
      "cnic": "82203-7608904-1",
      "gender": "مرد",
      "age": 72,
      "block_code": "822310202007",
      "address": "",
      "profession": "",
      "inferred_family_id": "8e1d…",
      "source_page": 1
    }
  ]
}
```

Errors return `{"success": false, "message": "..."}` with HTTP 4xx/5xx.

### `GET /search?name=&cnic=&father_name=&limit=50`
Fuzzy (rapidfuzz) over the most-recently-extracted batch. Use partial Urdu, partial CNIC (`82203`), or partial father name.

### `GET /exports/<filename>`
Download the generated JSON or CSV for a previous job.

### `GET /health`
Liveness probe.

---

## React + Node integration

The existing Next.js app has a proxy route at **`/api/ocr-extract`** that forwards multipart uploads here. To enable it, set in `web_app/.env`:

```
OCR_SERVICE_URL=http://localhost:5005
```

Then from React:
```ts
const fd = new FormData();
fd.append('file', file);
const res = await fetch('/api/ocr-extract', { method: 'POST', body: fd });
const out = await res.json();   // already in Prisma Voter shape
```

The proxy can optionally chain the result straight into `/api/ingest` (see `web_app/src/app/api/ocr-extract/route.ts`) — same auth, same dedupe-by-CNIC behavior as the existing JSON/CSV ingest path.

---

## How the OCR works (under the hood)

1. **PDF → images** at `PDF_DPI` (default 300) via `pdf2image`.
2. **OpenCV preprocessing**: grayscale → deskew (minimum-area-rect) → fastNlMeans denoise → CLAHE contrast → unsharp mask. Output stays 3-channel BGR for PaddleOCR.
3. **PPStructure** runs first. If it finds a `table` block, its cell grid (with per-cell text) is used directly.
4. **Fallback** if no table is detected: plain PaddleOCR + Y-centroid row clustering (tolerance `ROW_CLUSTER_TOL`), then X-sort RTL.
5. **Parser** is column-order agnostic: locates CNIC by regex, gender by lexicon, then assigns the two leading small integers to serial / age. Remaining cells become name + father_husband_name. Relationship markers (`ولد`, `بنت`, `زوجہ`, `s/o`, `w/o`) are split out.
6. **Urdu cleaner** routes every cell through `utils/urdu_normalizer.clean_urdu_text` — same canonicalization as `etl_pipeline/urdu_alphabet.py` and `web_app/src/lib/urdu_alphabet.ts`, so OCR output is byte-compatible with the rest of the platform.
7. **Dedupe by CNIC**, persist JSON + CSV, refresh in-memory search index, return.

---

## Extending to MongoDB / Neo4j

* `models/voter_model.VoterRecord.to_dict()` is already Mongo-ready.
* `services/relationship_service.build_edges()` emits `{person_cnic, father_name, block_code, inferred_family_id}` tuples — feed straight into Cypher:

  ```cypher
  UNWIND $edges AS e
  MERGE (p:Person {cnic: e.person_cnic})
    ON CREATE SET p.name = e.person_name
  MERGE (f:Person {name: e.father_name, family: e.inferred_family_id})
  MERGE (p)-[:CHILD_OF]->(f)
  ```

## Notes & caveats

* PaddleOCR's `arabic` model covers Urdu glyphs well but not perfectly — pair the output with the existing `urdu_alphabet` correction library (already wired in).
* Heavy scans (>50 pages) can take minutes on CPU. Set `OCR_USE_GPU=true` and install `paddlepaddle-gpu` to accelerate.
* For Vercel deployment of the Next.js side, host this microservice **separately** (Railway / Fly / a small VM) — Vercel functions can't run Paddle. The proxy route makes the seam clean.

"""Runtime configuration loaded from environment variables.

All paths default to repo-relative folders so the service is portable.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent

# ── Storage ──────────────────────────────────────────────────────────
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", BASE_DIR / "uploads"))
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", BASE_DIR / "outputs"))
TEMP_DIR = Path(os.getenv("TEMP_DIR", BASE_DIR / "temp"))

for _d in (UPLOAD_DIR, OUTPUT_DIR, TEMP_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# ── Upload limits ────────────────────────────────────────────────────
MAX_CONTENT_MB = int(os.getenv("MAX_CONTENT_MB", "100"))
MAX_CONTENT_LENGTH = MAX_CONTENT_MB * 1024 * 1024
ALLOWED_EXTENSIONS = {"pdf", "png", "jpg", "jpeg", "tif", "tiff", "bmp"}

# ── PDF rendering ────────────────────────────────────────────────────
PDF_DPI = int(os.getenv("PDF_DPI", "300"))
POPPLER_PATH = os.getenv("POPPLER_PATH") or None  # let pdf2image probe PATH

# ── PaddleOCR ────────────────────────────────────────────────────────
# `arabic` model covers Urdu glyphs; PPStructure handles table layout.
OCR_LANG = os.getenv("OCR_LANG", "arabic")
OCR_USE_GPU = os.getenv("OCR_USE_GPU", "false").lower() in {"1", "true", "yes"}
OCR_USE_ANGLE_CLS = True
OCR_DET_LIMIT = int(os.getenv("OCR_DET_LIMIT", "1600"))

# Cell-grouping tolerance (pixels) for row alignment when raw OCR is used.
ROW_CLUSTER_TOL = int(os.getenv("ROW_CLUSTER_TOL", "18"))

# ── Server ───────────────────────────────────────────────────────────
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "5005"))
DEBUG = os.getenv("FLASK_DEBUG", "false").lower() in {"1", "true", "yes"}

# CORS: comma-separated list. Default open for local dev.
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]

# Worker pool size (page-level parallelism).
WORKERS = max(1, int(os.getenv("OCR_WORKERS", "2")))

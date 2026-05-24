"""POST /extract-voters — the headline endpoint."""
from __future__ import annotations

import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import List

import cv2
from flask import Blueprint, jsonify, request
from werkzeug.utils import secure_filename

from config import ALLOWED_EXTENSIONS, MAX_CONTENT_MB, UPLOAD_DIR, WORKERS
from services.export_service import export_all
from services.image_service import preprocess
from services.parser_service import parse_rows
from services.pdf_service import pdf_to_images
from services.relationship_service import build_edges
from services.search_service import replace_index
from services.table_service import extract_table
from utils.logger import get_logger

log = get_logger(__name__)
upload_bp = Blueprint("upload", __name__)


def _ext(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def _process_page(image_path: Path, page_no: int) -> dict:
    img = preprocess(image_path)
    return extract_table(img, page_no)


@upload_bp.post("/extract-voters")
def extract_voters():
    started = time.time()
    if "file" not in request.files:
        return jsonify(success=False, message="Missing 'file' in form-data"), 400

    upload = request.files["file"]
    if not upload.filename:
        return jsonify(success=False, message="Empty filename"), 400

    ext = _ext(upload.filename)
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify(
            success=False,
            message=f"Unsupported file type .{ext}. Allowed: {sorted(ALLOWED_EXTENSIONS)}",
        ), 400

    job_id = uuid.uuid4().hex[:12]
    safe_name = secure_filename(upload.filename) or f"upload.{ext}"
    saved = UPLOAD_DIR / f"{job_id}_{safe_name}"
    upload.save(saved)
    log.info("Job %s: stored upload at %s (%s bytes)", job_id, saved, saved.stat().st_size)

    try:
        # 1. Page list
        if ext == "pdf":
            pages = pdf_to_images(saved, job_id)
        else:
            pages = [saved]

        if not pages:
            return jsonify(success=False, message="No pages rendered from upload"), 422

        # 2. OCR each page (bounded thread pool)
        per_page_results: list[dict] = []
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = {pool.submit(_process_page, p, i): i for i, p in enumerate(pages, start=1)}
            for fut in as_completed(futures):
                try:
                    per_page_results.append(fut.result())
                except Exception as exc:
                    log.exception("Page %d failed: %s", futures[fut], exc)
        per_page_results.sort(key=lambda r: r.get("page", 0))

        # 3. Parse, with block-code threading across pages
        all_records = []
        block_code = ""
        for page in per_page_results:
            recs, block_code = parse_rows(page["rows"], page_no=page["page"], current_block=block_code)
            all_records.extend(recs)

        records_dicts = [r.to_dict() for r in all_records]

        # 4. Dedupe by CNIC (keep first)
        seen = set()
        deduped: list[dict] = []
        for r in records_dicts:
            cnic = r.get("cnic")
            if cnic and cnic in seen:
                continue
            if cnic:
                seen.add(cnic)
            deduped.append(r)

        # 5. Persist + index
        json_path, csv_path = export_all(deduped, job_id)
        replace_index(deduped)

        polling_station = next((r.get("block_code") for r in deduped if r.get("block_code")), block_code)

        elapsed = round(time.time() - started, 2)
        log.info("Job %s: %d voters in %.2fs", job_id, len(deduped), elapsed)

        return jsonify(
            success=True,
            job_id=job_id,
            total_voters=len(deduped),
            polling_station=polling_station,
            pages=len(per_page_results),
            elapsed_seconds=elapsed,
            outputs={
                "json": f"/exports/{json_path.name}",
                "csv": f"/exports/{csv_path.name}",
            },
            edges=build_edges(deduped),
            data=deduped,
        )

    except Exception as exc:
        log.error("Job %s failed: %s\n%s", job_id, exc, traceback.format_exc())
        return jsonify(success=False, message=f"Extraction failed: {exc}"), 500

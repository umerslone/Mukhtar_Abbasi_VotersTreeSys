"""PDF → page-image rasterization using pdf2image (Poppler under the hood)."""
from __future__ import annotations

from pathlib import Path
from typing import List

from pdf2image import convert_from_path

from config import PDF_DPI, POPPLER_PATH, TEMP_DIR
from utils.logger import get_logger

log = get_logger(__name__)


def pdf_to_images(pdf_path: Path, job_id: str) -> List[Path]:
    """Render every page of ``pdf_path`` to PNG at PDF_DPI.

    Returns the list of image paths in page order. Files land in
    ``TEMP_DIR/<job_id>/page_NNN.png``.
    """
    out_dir = TEMP_DIR / job_id
    out_dir.mkdir(parents=True, exist_ok=True)

    log.info("Rasterizing %s at %d DPI -> %s", pdf_path.name, PDF_DPI, out_dir)
    images = convert_from_path(
        str(pdf_path),
        dpi=PDF_DPI,
        poppler_path=POPPLER_PATH,
        thread_count=2,
        fmt="png",
    )

    paths: list[Path] = []
    for idx, img in enumerate(images, start=1):
        p = out_dir / f"page_{idx:03d}.png"
        img.save(p, "PNG")
        paths.append(p)
    log.info("Rasterized %d page(s) for job %s", len(paths), job_id)
    return paths

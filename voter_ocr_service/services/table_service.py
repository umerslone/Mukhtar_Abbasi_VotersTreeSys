"""Table extraction.

Strategy:
1. Run PPStructure on the page. If it detects ≥1 `table` block, use its
   cell grid directly — each cell already has its OCR text.
2. Otherwise (or as supplement) fall back to plain OCR and cluster
   detected text boxes into rows by Y-centroid, then split into columns
   by sorting X-centroids inside each row.

Both paths emit the same shape::

    {"page": 1, "rows": [[cell, cell, …], …]}

so downstream parsing is uniform.
"""
from __future__ import annotations

from typing import Any, Dict, List

import numpy as np

from config import ROW_CLUSTER_TOL
from services.ocr_service import run_ocr, run_structure
from utils.logger import get_logger

log = get_logger(__name__)


def _bbox_center(box: List[List[float]]) -> tuple[float, float]:
    xs = [p[0] for p in box]
    ys = [p[1] for p in box]
    return (sum(xs) / 4.0, sum(ys) / 4.0)


def extract_table(image: np.ndarray, page_no: int) -> Dict[str, Any]:
    """Return ``{"page": page_no, "rows": [[…], …], "method": "structure|raw"}``."""
    blocks = run_structure(image)
    rows = _rows_from_structure(blocks)
    if rows:
        return {"page": page_no, "rows": rows, "method": "structure"}

    log.info("Page %d: PPStructure found no table — falling back to row clustering", page_no)
    raw = run_ocr(image)
    rows = _rows_from_raw(raw)
    return {"page": page_no, "rows": rows, "method": "raw"}


# ── PPStructure path ────────────────────────────────────────────────
def _rows_from_structure(blocks: List[dict]) -> List[List[str]]:
    rows: list[list[str]] = []
    for block in blocks:
        if block.get("type") != "table":
            continue
        res = block.get("res") or {}
        cells = res.get("cells") or res.get("cell_bbox") or []
        if cells:
            rows.extend(_cells_to_rows(cells))
        elif "html" in res:
            rows.extend(_html_to_rows(res["html"]))
    return rows


def _cells_to_rows(cells: List[dict]) -> List[List[str]]:
    """Cluster cells by Y, then sort each cluster by X."""
    items: list[tuple[float, float, str]] = []
    for c in cells:
        bbox = c.get("bbox") or c.get("box")
        text = (c.get("text") or "").strip()
        if not bbox or not text:
            continue
        # bbox may be [x1,y1,x2,y2] or polygon — normalize.
        if len(bbox) == 4 and not isinstance(bbox[0], (list, tuple)):
            x1, y1, x2, y2 = bbox
            cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
        else:
            cx, cy = _bbox_center(bbox)
        items.append((cy, cx, text))
    return _cluster_by_y(items)


def _html_to_rows(html: str) -> List[List[str]]:
    import re
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, flags=re.S | re.I):
        cells = [re.sub(r"<[^>]+>", "", td).strip()
                 for td in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, flags=re.S | re.I)]
        if any(cells):
            rows.append(cells)
    return rows


# ── Raw-OCR fallback ────────────────────────────────────────────────
def _rows_from_raw(entries: list) -> List[List[str]]:
    items: list[tuple[float, float, str]] = []
    for box, text, _score in entries:
        text = (text or "").strip()
        if not text:
            continue
        cx, cy = _bbox_center(box)
        items.append((cy, cx, text))
    return _cluster_by_y(items)


def _cluster_by_y(items: list[tuple[float, float, str]]) -> List[List[str]]:
    """Group by Y-centroid using ROW_CLUSTER_TOL, sort each row by X (RTL friendly)."""
    if not items:
        return []
    items.sort(key=lambda t: t[0])  # by Y
    clusters: list[list[tuple[float, float, str]]] = [[items[0]]]
    for it in items[1:]:
        if abs(it[0] - clusters[-1][-1][0]) <= ROW_CLUSTER_TOL:
            clusters[-1].append(it)
        else:
            clusters.append([it])

    rows: list[list[str]] = []
    for cluster in clusters:
        # Voter lists are RTL — sort right-to-left so column 1 (serial) lands first
        # when the layout puts serial on the far right of the page. Downstream
        # parser is forgiving either way.
        cluster.sort(key=lambda t: -t[1])
        rows.append([cell for _, _, cell in cluster])
    return rows

"""PaddleOCR + PPStructure singletons.

PaddleOCR is heavy (~hundreds of MB of model weights) so we lazy-load
both engines on first use and keep them as module-level singletons for
the lifetime of the process. Worker processes warm them again on demand.
"""
from __future__ import annotations

import threading
from typing import Any, List, Optional, Tuple

import numpy as np

from config import OCR_DET_LIMIT, OCR_LANG, OCR_USE_ANGLE_CLS, OCR_USE_GPU
from utils.logger import get_logger

log = get_logger(__name__)

_ocr_lock = threading.Lock()
_table_lock = threading.Lock()
_ocr_engine: Any = None
_table_engine: Any = None


def get_ocr_engine() -> Any:
    """Return the cached `PaddleOCR` instance, building it on first call."""
    global _ocr_engine
    if _ocr_engine is not None:
        return _ocr_engine
    with _ocr_lock:
        if _ocr_engine is None:
            from paddleocr import PaddleOCR  # local import keeps app startup fast

            log.info("Loading PaddleOCR (lang=%s, gpu=%s) — first call may take 30–60s",
                     OCR_LANG, OCR_USE_GPU)
            _ocr_engine = PaddleOCR(
                use_angle_cls=OCR_USE_ANGLE_CLS,
                lang=OCR_LANG,
                use_gpu=OCR_USE_GPU,
                show_log=False,
                det_limit_side_len=OCR_DET_LIMIT,
            )
    return _ocr_engine


def get_table_engine() -> Any:
    """Return the cached `PPStructure` instance."""
    global _table_engine
    if _table_engine is not None:
        return _table_engine
    with _table_lock:
        if _table_engine is None:
            from paddleocr import PPStructure

            log.info("Loading PPStructure (table layout)")
            # NOTE: PPStructure layout models only support 'en' / 'ch'.
            # The actual text recognition inside detected cells uses the
            # main PaddleOCR engine which is correctly configured for
            # OCR_LANG (e.g. arabic / urdu).
            _table_engine = PPStructure(
                show_log=False,
                lang='en',
                use_gpu=OCR_USE_GPU,
                ocr=True,
                layout=True,
                table=True,
            )
    return _table_engine


# ── Public OCR primitives ───────────────────────────────────────────
def run_ocr(image: np.ndarray) -> List[Tuple[List[List[float]], str, float]]:
    """Plain-text OCR fallback: returns ``[(box, text, score), …]``.

    `box` is a 4-point polygon (clockwise from top-left).
    """
    engine = get_ocr_engine()
    try:
        result = engine.ocr(image, cls=OCR_USE_ANGLE_CLS)
    except Exception as exc:
        log.warning("PaddleOCR.ocr failed: %s", exc)
        return []
    # PaddleOCR returns nested list per image; unwrap.
    if not result or result[0] is None:
        return []
    out: list[tuple[list[list[float]], str, float]] = []
    for entry in result[0]:
        try:
            box, (text, score) = entry
            out.append((box, text or "", float(score or 0.0)))
        except Exception:
            continue
    return out


def run_structure(image: np.ndarray) -> List[dict]:
    """PPStructure layout: returns blocks with `type` ('table','text',…) and `res`.

    For table blocks `res` is a dict with `html` plus `cells` containing
    bounding boxes and recognized text per cell.
    """
    engine = get_table_engine()
    try:
        return engine(image) or []
    except Exception as exc:
        log.warning("PPStructure failed: %s", exc)
        return []


def shutdown() -> None:
    """Optional hook so tests can clear the singletons."""
    global _ocr_engine, _table_engine
    _ocr_engine = None
    _table_engine = None


__all__ = ["get_ocr_engine", "get_table_engine", "run_ocr", "run_structure", "shutdown"]


def median_box_height(boxes: List[List[List[float]]]) -> Optional[float]:
    if not boxes:
        return None
    heights = [max(b[2][1], b[3][1]) - min(b[0][1], b[1][1]) for b in boxes]
    if not heights:
        return None
    return float(np.median(heights))

"""Apply Urdu normalization + heuristic cleanups to a raw row.

Public surface is intentionally tiny so the parser stays readable.
"""
from __future__ import annotations

from typing import List

from utils.regex_patterns import NOISE_RE, WS_RE
from utils.urdu_normalizer import clean_urdu_text


def clean_cell(text: str) -> str:
    if not text:
        return ""
    # Run through the canonical Urdu pipeline first, then strip stray OCR
    # symbols (`؛`, `*`, `~`, …) that survive normalization.
    cleaned = clean_urdu_text(text)
    cleaned = NOISE_RE.sub(" ", cleaned)
    cleaned = WS_RE.sub(" ", cleaned).strip()
    return cleaned


def clean_row(cells: List[str]) -> List[str]:
    return [clean_cell(c) for c in cells]

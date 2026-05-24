"""Urdu text normalization.

Mirrors `etl_pipeline/urdu_alphabet.py` (which is already used by the
existing ETL + the React app's TypeScript twin) so OCR output from this
service is byte-compatible with the rest of the platform.

If the canonical module is importable on PYTHONPATH we re-export from it;
otherwise we ship a self-contained equivalent here.
"""
from __future__ import annotations

import re
from typing import Final

try:
    # Reuse the canonical implementation when running inside the repo.
    from etl_pipeline.urdu_alphabet import (  # type: ignore[import-not-found]
        correct_name as _correct_name,
        to_canonical_urdu as _to_canonical_urdu,
        to_ascii_digits as _to_ascii_digits,
        strip_honorifics as _strip_honorifics,
    )

    def clean_urdu_text(text: str) -> str:
        return _correct_name(text or "")

    def normalize_urdu(text: str) -> str:
        return _to_canonical_urdu(text or "")

    def to_ascii_digits(text: str) -> str:
        return _to_ascii_digits(text or "")

    def strip_honorifics(text: str) -> str:
        return _strip_honorifics(text or "")

except Exception:  # pragma: no cover — fallback when module not on path
    # ── Self-contained fallback ───────────────────────────────────────
    ARABIC_TO_URDU: Final[dict[str, str]] = {
        # ya forms
        "\u064A": "\u06CC",  # ي  → ی
        "\u0649": "\u06CC",  # ى  → ی
        # kaf
        "\u0643": "\u06A9",  # ك  → ک
        # ha / ta-marbuta
        "\u0629": "\u06C1",  # ة  → ہ
        "\u0647": "\u06C1",  # ه  → ہ
        # hamza-on-ya variants
        "\u0626": "\u0626",
    }

    URDU_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
    ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"

    _HARAKAT = re.compile(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]")
    _TATWEEL = re.compile(r"\u0640")
    _ZW = re.compile(r"[\u200B-\u200F\u202A-\u202E]")
    _MULTI_WS = re.compile(r"\s+")
    _PUNCT = re.compile(r"[^\u0600-\u06FFA-Za-z0-9 \-/]+")

    _HONORIFICS = (
        "حاجی",
        "ملک",
        "چوہدری",
        "چودھری",
        "صاحب",
        "میاں",
        "میر",
        "پیر",
        "سید",
    )

    def normalize_urdu(text: str) -> str:
        t = text or ""
        t = "".join(ARABIC_TO_URDU.get(ch, ch) for ch in t)
        t = _HARAKAT.sub("", t)
        t = _TATWEEL.sub("", t)
        t = _ZW.sub("", t)
        return t

    def to_ascii_digits(text: str) -> str:
        out = []
        for ch in text or "":
            if ch in URDU_DIGITS:
                out.append(str(URDU_DIGITS.index(ch)))
            elif ch in ARABIC_DIGITS:
                out.append(str(ARABIC_DIGITS.index(ch)))
            else:
                out.append(ch)
        return "".join(out)

    def strip_honorifics(text: str) -> str:
        if not text:
            return ""
        tokens = [tok for tok in text.split() if tok not in _HONORIFICS]
        return " ".join(tokens)

    def clean_urdu_text(text: str) -> str:
        t = normalize_urdu(text or "")
        t = to_ascii_digits(t)
        t = strip_honorifics(t)
        t = _PUNCT.sub(" ", t)
        t = _MULTI_WS.sub(" ", t).strip()
        return t

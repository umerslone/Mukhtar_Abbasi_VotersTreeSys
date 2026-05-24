"""In-memory search over the last extracted batch.

For production you'd back this with Mongo/Postgres; here we keep an
in-process index over the most recent job so the API is exercised
end-to-end. Each `/extract-voters` call rebuilds the index.
"""
from __future__ import annotations

import threading
from typing import List, Optional

from rapidfuzz import fuzz, process

from utils.urdu_normalizer import clean_urdu_text, to_ascii_digits

_lock = threading.Lock()
_records: list[dict] = []


def replace_index(records: List[dict]) -> None:
    global _records
    with _lock:
        _records = list(records)


def all_records() -> List[dict]:
    with _lock:
        return list(_records)


def _normalize(text: str) -> str:
    return clean_urdu_text(text or "").lower()


def search(
    name: Optional[str] = None,
    cnic: Optional[str] = None,
    father_name: Optional[str] = None,
    limit: int = 50,
    min_score: int = 70,
) -> List[dict]:
    with _lock:
        snapshot = list(_records)

    if cnic:
        target = to_ascii_digits(cnic).replace(" ", "").replace("-", "")
        return [r for r in snapshot
                if to_ascii_digits(r.get("cnic", "")).replace("-", "").startswith(target)][:limit]

    field, query = None, None
    if name:
        field, query = "name", _normalize(name)
    elif father_name:
        field, query = "father_husband_name", _normalize(father_name)
    else:
        return snapshot[:limit]

    haystack = {idx: _normalize(rec.get(field, "")) for idx, rec in enumerate(snapshot)}
    matches = process.extract(
        query,
        haystack,
        scorer=fuzz.token_set_ratio,
        limit=limit,
        score_cutoff=min_score,
    )
    return [snapshot[idx] for _value, _score, idx in matches]

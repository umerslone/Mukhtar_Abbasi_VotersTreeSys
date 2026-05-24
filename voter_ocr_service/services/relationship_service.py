"""Relationship parsing — extract `father` / `husband` from Urdu strings.

We support these markers (Urdu + transliteration):

    ولد  / بن            → son of
    بنت  / دختر          → daughter of
    زوجہ                 → wife of
    s/o, d/o, w/o, …    → ASCII variants

Output is the trimmed "after-marker" tail. The parent module decides
whether to keep both halves (name + father) or only one.
"""
from __future__ import annotations

import re
from typing import Optional

_MARKERS = re.compile(
    r"\bولد\b|\bبن\b|\bبنت\b|\bدختر\b|\bزوجہ\b"
    r"|\bs/o\b|\bd/o\b|\bw/o\b|\bson of\b|\bdaughter of\b|\bwife of\b",
    re.IGNORECASE,
)


def split_relationship(text: str) -> Optional[str]:
    """Return the father/husband portion after the marker, or None."""
    if not text:
        return None
    m = _MARKERS.search(text)
    if not m:
        return None
    return text[m.end():].strip(" :،,-")


def build_edges(records: list[dict]) -> list[dict]:
    """Build Neo4j-friendly relationship edges.

    Returns a list of ``{"person": cnic_or_name, "father": name}`` dicts
    so the downstream graph builder can match by CNIC where present and
    fall back to (block_code, father_name) otherwise.
    """
    edges: list[dict] = []
    for rec in records:
        father = (rec.get("father_husband_name") or "").strip()
        if not father:
            continue
        edges.append({
            "person_cnic": rec.get("cnic"),
            "person_name": rec.get("name"),
            "father_name": father,
            "block_code": rec.get("block_code"),
            "inferred_family_id": rec.get("inferred_family_id"),
        })
    return edges

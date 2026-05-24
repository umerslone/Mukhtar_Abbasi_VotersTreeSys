"""Turn raw OCR rows into structured `VoterRecord` objects.

Voter list rows on AJK lists typically carry these columns (RTL order):
    serial  |  name  |  father/husband name  |  CNIC  |  age  |  gender

Real-world tables vary, so the parser is column-order agnostic:
it identifies CNIC and ages by regex anywhere in the row, then assigns
the remaining cells to name / father-name by position. Polling-station
codes are discovered in header rows and propagated forward.
"""
from __future__ import annotations

import hashlib
import re
from typing import Iterable, List, Optional

from models.voter_model import VoterRecord
from services.cleaner_service import clean_cell, clean_row
from services.relationship_service import split_relationship
from utils.regex_patterns import (
    BLOCK_CODE_RE,
    CNIC_RE,
    GENDER_FEMALE_RE,
    GENDER_MALE_RE,
    INT_RE,
)
from utils.urdu_normalizer import to_ascii_digits


def _detect_cnic(cells: List[str]) -> tuple[Optional[str], Optional[int]]:
    for idx, cell in enumerate(cells):
        ascii_cell = to_ascii_digits(cell)
        m = CNIC_RE.search(ascii_cell)
        if m:
            return f"{m.group(1)}-{m.group(2)}-{m.group(3)}", idx
    return None, None


def _detect_block_code(cells: List[str]) -> Optional[str]:
    joined = " ".join(to_ascii_digits(c) for c in cells)
    m = BLOCK_CODE_RE.search(joined)
    return m.group(0) if m else None


def _detect_gender(cells: List[str]) -> tuple[Optional[str], Optional[int]]:
    for idx, cell in enumerate(cells):
        if GENDER_MALE_RE.search(cell):
            return "مرد", idx
        if GENDER_FEMALE_RE.search(cell):
            return "عورت", idx
    return None, None


def _detect_serial_age(cells: List[str], skip: set[int]) -> tuple[Optional[str], Optional[int], dict[int, str]]:
    """Walk left-to-right; first small int is serial, second is age."""
    ints: list[tuple[int, str]] = []
    for idx, cell in enumerate(cells):
        if idx in skip:
            continue
        ascii_cell = to_ascii_digits(cell).strip()
        if INT_RE.match(ascii_cell):
            ints.append((idx, ascii_cell))
    serial: Optional[str] = None
    age: Optional[int] = None
    used: dict[int, str] = {}
    if ints:
        sidx, sval = ints[0]
        serial, used[sidx] = sval, "serial"
    if len(ints) >= 2:
        aidx, aval = ints[1]
        try:
            age = int(aval)
            used[aidx] = "age"
        except ValueError:
            pass
    return serial, age, used


def _family_id(father: str, block_code: str) -> str:
    if not father:
        return ""
    payload = f"{block_code}::{father}".encode("utf-8")
    return hashlib.sha1(payload).hexdigest()[:12]


def parse_rows(rows: Iterable[List[str]], *, page_no: int,
               current_block: str = "") -> tuple[list[VoterRecord], str]:
    """Convert cleaned rows to voter records.

    Returns ``(records, updated_block_code)``. The block code is
    threaded through pages so a polling-station header on page N
    applies to subsequent rows.
    """
    out: list[VoterRecord] = []
    block_code = current_block

    for raw in rows:
        cells = clean_row(raw)
        cells = [c for c in cells if c]
        if not cells:
            continue

        # Header line carrying the polling-station code?
        bc = _detect_block_code(cells)
        if bc:
            block_code = bc
            # Header rows are rarely also voter rows — only proceed if
            # we still see a CNIC.
            if not CNIC_RE.search(to_ascii_digits(" ".join(cells))):
                continue

        cnic, cnic_idx = _detect_cnic(cells)
        if not cnic:
            continue  # not a voter row

        gender, gender_idx = _detect_gender(cells)
        used: set[int] = set()
        if cnic_idx is not None:
            used.add(cnic_idx)
        if gender_idx is not None:
            used.add(gender_idx)

        serial, age, idx_map = _detect_serial_age(cells, used)
        used.update(idx_map.keys())

        # Remaining cells are name material; order them left→right.
        name_cells = [c for i, c in enumerate(cells) if i not in used]

        name = name_cells[0] if name_cells else ""
        father = name_cells[1] if len(name_cells) >= 2 else ""

        # If father cell carries a relationship marker (ولد / بنت / w/o)
        # split it out.
        if father:
            rel = split_relationship(father)
            if rel:
                father = rel

        if not name:
            # Try last-ditch: if cells joined contain ولد, split.
            joined = " ".join(name_cells)
            rel = split_relationship(joined)
            if rel:
                # name = before, father = after
                parts = re.split(r"\bولد\b|\bبنت\b|\bدختر\b|\bزوجہ\b", joined, maxsplit=1)
                if len(parts) == 2:
                    name = clean_cell(parts[0])
                    father = clean_cell(parts[1])

        rec = VoterRecord(
            serial_no=serial or "",
            name=name,
            father_husband_name=father,
            cnic=cnic,
            gender=gender,
            age=age,
            block_code=block_code,
            inferred_family_id=_family_id(father, block_code),
            source_page=page_no,
            raw_row=cells,
        )
        if rec.is_valid():
            out.append(rec)

    return out, block_code

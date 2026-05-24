"""JSON + CSV export. UTF-8 with BOM for Excel-compat CSV."""
from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import List

import pandas as pd

from config import OUTPUT_DIR
from utils.logger import get_logger

log = get_logger(__name__)


CSV_COLUMNS = [
    "serial_no",
    "name",
    "father_husband_name",
    "cnic",
    "gender",
    "age",
    "block_code",
    "address",
    "profession",
    "inferred_family_id",
    "source_page",
]


def export_json(records: List[dict], job_id: str) -> Path:
    path = OUTPUT_DIR / f"voters_{job_id}.json"
    path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("Wrote %s (%d records)", path, len(records))
    return path


def export_csv(records: List[dict], job_id: str) -> Path:
    path = OUTPUT_DIR / f"voters_{job_id}.csv"
    df = pd.DataFrame(records)
    for col in CSV_COLUMNS:
        if col not in df.columns:
            df[col] = ""
    df = df[CSV_COLUMNS]
    # utf-8-sig so Excel auto-detects UTF-8.
    df.to_csv(path, index=False, encoding="utf-8-sig", quoting=csv.QUOTE_MINIMAL)
    log.info("Wrote %s (%d rows)", path, len(records))
    return path


def export_all(records: List[dict], job_id: str) -> tuple[Path, Path]:
    return export_json(records, job_id), export_csv(records, job_id)

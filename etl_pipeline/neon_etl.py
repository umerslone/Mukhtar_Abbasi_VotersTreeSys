"""Neon Postgres ingestion: ghost-tree family inference from flat voter data.

Usage:
    python neon_etl.py --input voters.json        # JSON list or {"rows": [...]}
    python neon_etl.py --input voters_db.sqlite   # SQLite from voters_etl.py
    python neon_etl.py --input voters.csv         # CSV with matching headers

Environment:
    DATABASE_URL   Neon Postgres connection string (sslmode=require).
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sqlite3
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

import psycopg2
from psycopg2.extras import execute_batch

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS "Voter" (
    id TEXT PRIMARY KEY,
    block_code TEXT NOT NULL,
    serial_no TEXT NOT NULL,
    name TEXT NOT NULL,
    father_husband_name TEXT NOT NULL,
    cnic TEXT NOT NULL,
    profession TEXT DEFAULT '',
    age INTEGER,
    address TEXT NOT NULL,
    inferred_family_id TEXT NOT NULL,
    gender TEXT,
    voter_status TEXT NOT NULL DEFAULT 'Unsurveyed',
    is_on_duty BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_voter_family ON "Voter"(inferred_family_id);
CREATE INDEX IF NOT EXISTS idx_voter_block_address ON "Voter"(block_code, address);
CREATE INDEX IF NOT EXISTS idx_voter_cnic ON "Voter"(cnic);
CREATE INDEX IF NOT EXISTS idx_voter_name ON "Voter"(name);
"""


def normalize(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def gender_from_cnic(cnic: str) -> str:
    digits = re.sub(r"\D", "", str(cnic or ""))
    if not digits:
        return "unknown"
    return "male" if int(digits[-1]) % 2 else "female"


def _load_from_sqlite(source_path: Path) -> list[dict[str, Any]]:
    with sqlite3.connect(source_path) as connection:
        connection.row_factory = sqlite3.Row
        cursor = connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('voters','Voter')"
        )
        table_row = cursor.fetchone()
        if not table_row:
            raise ValueError("SQLite file has no 'voters' or 'Voter' table.")
        table = table_row[0]
        rows = connection.execute(f'SELECT * FROM "{table}"').fetchall()
        return [dict(row) for row in rows]


def _load_from_csv(source_path: Path) -> list[dict[str, Any]]:
    with source_path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def _load_from_json(source_path: Path) -> list[dict[str, Any]]:
    payload = json.loads(source_path.read_text(encoding="utf-8"))
    if isinstance(payload, dict) and "rows" in payload:
        rows = payload["rows"]
    elif isinstance(payload, list):
        rows = payload
    else:
        raise ValueError("Expected a JSON list of voters or an object with a 'rows' array.")
    if not isinstance(rows, list):
        raise ValueError("Voter rows must be a list.")
    return rows


def load_rows(source_path: Path) -> list[dict[str, Any]]:
    if not source_path.exists():
        raise SystemExit(
            f"Input file not found: {source_path}\n"
            "Provide a .json, .csv, .sqlite, or .db file. "
            "For a quick demo run: python neon_etl.py --input sample_voters.json"
        )
    suffix = source_path.suffix.lower()
    if suffix in {".sqlite", ".db", ".sqlite3"}:
        return _load_from_sqlite(source_path)
    if suffix == ".csv":
        return _load_from_csv(source_path)
    return _load_from_json(source_path)


def infer_family_ids(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], list[int]] = defaultdict(list)
    for index, row in enumerate(rows):
        grouped[(normalize(row.get("block_code")), normalize(row.get("address")))].append(index)

    result = [dict(row) for row in rows]

    for indices in grouped.values():
        name_to_indices: dict[str, list[int]] = defaultdict(list)
        for index in indices:
            name_to_indices[normalize(rows[index].get("name"))].append(index)

        parent = {index: index for index in indices}

        def find(node: int) -> int:
            while parent[node] != node:
                parent[node] = parent[parent[node]]
                node = parent[node]
            return node

        def union(left: int, right: int) -> None:
            root_left = find(left)
            root_right = find(right)
            if root_left != root_right:
                parent[root_right] = root_left

        for index in indices:
            relative = normalize(rows[index].get("father_husband_name"))
            if relative and relative in name_to_indices:
                for candidate in name_to_indices[relative]:
                    if candidate != index:
                        union(index, candidate)

        family_ids: dict[int, str] = {}
        for index in indices:
            root = find(index)
            if root not in family_ids:
                family_ids[root] = str(uuid.uuid4())
            result[index]["inferred_family_id"] = family_ids[root]
            result[index]["gender"] = gender_from_cnic(rows[index].get("cnic", ""))

    return result


def to_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        match = re.search(r"\d+", str(value))
        return int(match.group(0)) if match else None


def insert_rows(connection: "psycopg2.extensions.connection", rows: Iterable[dict[str, Any]]) -> int:
    payload = [
        (
            str(row.get("id") or uuid.uuid4()),
            str(row.get("block_code", "")).strip(),
            str(row.get("serial_no", "")).strip(),
            str(row.get("name", "")).strip(),
            str(row.get("father_husband_name", "")).strip(),
            str(row.get("cnic", "")).strip(),
            str(row.get("profession", "")).strip(),
            to_int(row.get("age")),
            str(row.get("address", "")).strip(),
            str(row.get("inferred_family_id", "")).strip(),
            str(row.get("gender", "unknown")),
            str(row.get("voter_status") or "Unsurveyed"),
            bool(row.get("is_on_duty", False)),
        )
        for row in rows
    ]

    with connection.cursor() as cursor:
        cursor.execute(SCHEMA_SQL)
        execute_batch(
            cursor,
            """
            INSERT INTO "Voter" (
                id, block_code, serial_no, name, father_husband_name, cnic,
                profession, age, address, inferred_family_id, gender,
                voter_status, is_on_duty
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                block_code = EXCLUDED.block_code,
                serial_no = EXCLUDED.serial_no,
                name = EXCLUDED.name,
                father_husband_name = EXCLUDED.father_husband_name,
                cnic = EXCLUDED.cnic,
                profession = EXCLUDED.profession,
                age = EXCLUDED.age,
                address = EXCLUDED.address,
                inferred_family_id = EXCLUDED.inferred_family_id,
                gender = EXCLUDED.gender
            """,
            payload,
            page_size=500,
        )

    connection.commit()
    return len(payload)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest OCR voter JSON into Neon Postgres.")
    parser.add_argument("--input", required=True, help="Path to flat OCR voter JSON.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required (Neon Postgres connection string).")

    rows = load_rows(Path(args.input).expanduser().resolve())
    enriched = infer_family_ids(rows)

    with psycopg2.connect(database_url) as connection:
        count = insert_rows(connection, enriched)

    print(f"Inserted/updated {count} voters into Neon Postgres.")


if __name__ == "__main__":
    main()

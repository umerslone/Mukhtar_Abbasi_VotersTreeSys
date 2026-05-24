from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import uuid
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import io

from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.core.credentials import AzureKeyCredential
from openai import AzureOpenAI
from pypdf import PdfReader, PdfWriter

# Max pages per Document Intelligence request to stay below the 500MB / size limits.
PDF_CHUNK_PAGES = int(os.getenv("PDF_CHUNK_PAGES", "20"))
# Max bytes per request. Free tier (F0) caps at ~4 MB; paid (S0) at 500 MB.
# Default conservative for F0; raise via env for S0.
PDF_CHUNK_MAX_BYTES = int(os.getenv("PDF_CHUNK_MAX_BYTES", str(3_500_000)))

DB_SCHEMA = """
CREATE TABLE IF NOT EXISTS voters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    block_code TEXT NOT NULL,
    serial_no TEXT NOT NULL,
    name TEXT NOT NULL,
    father_husband_name TEXT NOT NULL,
    cnic TEXT NOT NULL,
    profession TEXT DEFAULT '',
    age INTEGER,
    address TEXT NOT NULL,
    inferred_family_id TEXT NOT NULL,
    voter_status TEXT NOT NULL DEFAULT 'Unsurveyed',
    is_on_duty INTEGER NOT NULL DEFAULT 0
);
"""

STATUS_VALUES = {"Supporter", "Leaning", "Undecided", "Opposition", "Hostile", "Unsurveyed"}


@dataclass
class RawVoterRow:
    block_code: str
    serial_no: str
    name: str
    father_husband_name: str
    cnic: str
    profession: str
    age: int | None
    address: str


@dataclass
class CleanVoterRow(RawVoterRow):
    inferred_family_id: str = ""
    voter_status: str = "Unsurveyed"
    is_on_duty: int = 0


def create_connection(database_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(database_path)
    connection.execute("PRAGMA journal_mode=WAL;")
    connection.execute("PRAGMA synchronous=NORMAL;")
    connection.execute(DB_SCHEMA)
    connection.execute("CREATE INDEX IF NOT EXISTS idx_voters_block_address ON voters(block_code, address);")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_voters_family ON voters(inferred_family_id);")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_voters_cnic ON voters(cnic);")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_voters_name ON voters(name);")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_voters_serial ON voters(serial_no);")
    return connection


def load_ocr_client() -> DocumentIntelligenceClient:
    endpoint = os.environ["AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT"]
    key = os.environ["AZURE_DOCUMENT_INTELLIGENCE_KEY"]
    return DocumentIntelligenceClient(endpoint=endpoint, credential=AzureKeyCredential(key))


def load_openai_client() -> AzureOpenAI:
    return AzureOpenAI(
        api_key=os.environ["AZURE_OPENAI_API_KEY"],
        azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
        api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-10-21")
    )


def _analyze_pdf_bytes(client: DocumentIntelligenceClient, pdf_bytes: bytes) -> list[dict[str, Any]]:
    poller = client.begin_analyze_document(model_id="prebuilt-layout", body=pdf_bytes)
    result = poller.result()
    tables: list[dict[str, Any]] = []
    for table in getattr(result, "tables", []) or []:
        cells: list[dict[str, Any]] = []
        for cell in table.cells:
            cells.append(
                {
                    "row_index": cell.row_index,
                    "column_index": cell.column_index,
                    "text": (cell.content or "").strip()
                }
            )
        tables.append(
            {
                "row_count": table.row_count,
                "column_count": table.column_count,
                "cells": cells
            }
        )
    return tables


def _pages_to_bytes(reader: PdfReader, start: int, end: int) -> bytes:
    writer = PdfWriter()
    for i in range(start, end):
        writer.add_page(reader.pages[i])
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def _iter_pdf_chunks(source_path: Path, chunk_pages: int, max_bytes: int) -> Iterable[tuple[int, int, bytes]]:
    reader = PdfReader(str(source_path))
    total = len(reader.pages)
    # Stack of (start, end) page ranges (end exclusive).
    pending: list[tuple[int, int]] = []
    for start in range(0, total, chunk_pages):
        pending.append((start, min(start + chunk_pages, total)))
    pending.reverse()  # process in order via pop()

    while pending:
        start, end = pending.pop()
        data = _pages_to_bytes(reader, start, end)
        if len(data) <= max_bytes or end - start <= 1:
            yield start + 1, end, data
            continue
        # Too big — split in half and retry.
        mid = (start + end) // 2
        pending.append((mid, end))
        pending.append((start, mid))


def extract_layout_tables(source_path: Path) -> list[dict[str, Any]]:
    client = load_ocr_client()
    suffix = source_path.suffix.lower()

    # Non-PDF (e.g. image): send as-is.
    if suffix != ".pdf":
        with source_path.open("rb") as handle:
            return _analyze_pdf_bytes(client, handle.read())

    all_tables: list[dict[str, Any]] = []
    for start_page, end_page, chunk_bytes in _iter_pdf_chunks(source_path, PDF_CHUNK_PAGES, PDF_CHUNK_MAX_BYTES):
        size_mb = len(chunk_bytes) / (1024 * 1024)
        print(f"[OCR] analyzing pages {start_page}-{end_page} ({size_mb:.1f} MB)...", flush=True)
        all_tables.extend(_analyze_pdf_bytes(client, chunk_bytes))
    return all_tables


def cells_to_rows(table: dict[str, Any]) -> list[list[str]]:
    matrix = [["" for _ in range(table["column_count"])] for _ in range(table["row_count"])]
    for cell in table["cells"]:
        row_index = int(cell["row_index"])
        column_index = int(cell["column_index"])
        text = str(cell["text"] or "").strip()
        if 0 <= row_index < len(matrix) and 0 <= column_index < len(matrix[row_index]):
            matrix[row_index][column_index] = text
    return matrix


CNIC_RE = re.compile(r"\d{5}-\d{7}-\d")
BLOCK_RE = re.compile(r"\b\d{12}\b")


def _looks_like_voter_table(matrix: list[list[str]]) -> bool:
    """A voter table has >=6 columns and at least one row with a CNIC in any cell."""
    if not matrix or len(matrix[0]) < 6:
        return False
    for row in matrix:
        for cell in row:
            if CNIC_RE.search(cell or ""):
                return True
    return False


def _find_cnic_column(matrix: list[list[str]]) -> int:
    """Return the column index that most frequently contains a CNIC."""
    col_hits: dict[int, int] = {}
    for row in matrix:
        for idx, cell in enumerate(row):
            if CNIC_RE.search(cell or ""):
                col_hits[idx] = col_hits.get(idx, 0) + 1
    if not col_hits:
        return -1
    return max(col_hits.items(), key=lambda kv: kv[1])[0]


def _positional_record(row: list[str], cnic_col: int, ncols: int, block_code: str) -> RawVoterRow | None:
    """Map a row by position relative to the CNIC column.

    Expected layout (Pakistani ECP voter list, left-to-right as OCR returns it):
        serial | name | father/husband | CNIC | profession | age | address
    The CNIC column anchors everything; surrounding columns are offset from it.
    """
    def get(i: int) -> str:
        return row[i].strip() if 0 <= i < len(row) else ""

    cnic_cell = get(cnic_col)
    m = CNIC_RE.search(cnic_cell)
    if not m:
        return None
    cnic = m.group(0)

    serial = get(cnic_col - 3)
    name = get(cnic_col - 2)
    father = get(cnic_col - 1)
    profession = get(cnic_col + 1)
    age_text = get(cnic_col + 2)
    address = get(cnic_col + 3)

    # Header rows / totals rows: serial must be numeric.
    if not re.fullmatch(r"\d{1,6}", serial.strip()):
        return None

    age_match = re.search(r"\d{1,3}", age_text)
    return RawVoterRow(
        block_code=block_code,
        serial_no=serial,
        name=name,
        father_husband_name=father,
        cnic=cnic,
        profession=profession,
        age=int(age_match.group(0)) if age_match else None,
        address=address,
    )


def table_row_to_record(columns: list[str], row: list[str]) -> RawVoterRow | None:
    values = {columns[index].strip().lower(): (row[index].strip() if index < len(row) else "") for index in range(len(columns))}
    block_code = values.get("block code") or values.get("block_code") or values.get("block") or ""
    serial_no = values.get("serial no") or values.get("serial_no") or values.get("serial") or ""
    name = values.get("name") or ""
    father_husband_name = values.get("father/husband name") or values.get("father husband name") or values.get("father_husband_name") or ""
    cnic = values.get("cnic") or ""
    profession = values.get("profession") or ""
    age_text = values.get("age") or ""
    address = values.get("address") or values.get("house") or ""

    if not any([block_code, serial_no, name, father_husband_name, cnic, address]):
        return None

    age_match = re.search(r"\d+", age_text)
    return RawVoterRow(
        block_code=block_code,
        serial_no=serial_no,
        name=name,
        father_husband_name=father_husband_name,
        cnic=cnic,
        profession=profession,
        age=int(age_match.group(0)) if age_match else None,
        address=address
    )


def extract_rows_from_tables(tables: list[dict[str, Any]]) -> list[RawVoterRow]:
    rows: list[RawVoterRow] = []

    # Sniff a block code (12-digit number) from any cell across all tables; fall back to "UNKNOWN".
    block_code = "UNKNOWN"
    for table in tables:
        for cell in table.get("cells", []):
            m = BLOCK_RE.search(cell.get("text") or "")
            if m:
                block_code = m.group(0)
                break
        if block_code != "UNKNOWN":
            break

    english_header_aliases = {"cnic", "name", "serial no", "block code"}

    for table in tables:
        matrix = cells_to_rows(table)
        if not matrix:
            continue

        # Path A: legacy English-header parser.
        headers = [cell.strip().lower() for cell in matrix[0]]
        if any(h in english_header_aliases for h in headers):
            for row in matrix[1:]:
                record = table_row_to_record(matrix[0], row)
                if record:
                    if not record.block_code:
                        record.block_code = block_code
                    rows.append(record)
            continue

        # Path B: Pakistani Urdu voter list — positional detection via CNIC pattern.
        if _looks_like_voter_table(matrix):
            cnic_col = _find_cnic_column(matrix)
            if cnic_col < 0:
                continue
            ncols = len(matrix[0])
            for row in matrix:
                record = _positional_record(row, cnic_col, ncols, block_code)
                if record:
                    rows.append(record)

    return rows


def ai_cleanup_rows(rows: list[RawVoterRow]) -> list[dict[str, Any]]:
    if not rows:
        return []

    client = load_openai_client()
    system_prompt = "You are an Urdu OCR corrector. Fix broken characters in these names. Output strict JSON matching the DB schema."
    payload = [row.__dict__ for row in rows]

    response = client.chat.completions.create(
        model=os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o-mini"),
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "rows": payload,
                        "schema": {
                            "block_code": "string",
                            "serial_no": "string",
                            "name": "string",
                            "father_husband_name": "string",
                            "cnic": "string",
                            "profession": "string",
                            "age": "integer|null",
                            "address": "string"
                        }
                    },
                    ensure_ascii=False
                )
            }
        ]
    )

    content = response.choices[0].message.content or "{}"
    parsed = json.loads(content)
    cleaned_rows = parsed.get("rows", parsed if isinstance(parsed, list) else [])
    if not isinstance(cleaned_rows, list):
        raise ValueError("Azure OpenAI cleanup did not return a JSON array under rows.")

    return cleaned_rows


def cnic_gender(cnic: str) -> str:
    digits = re.sub(r"\D", "", cnic)
    if not digits:
        return "unknown"
    return "male" if int(digits[-1]) % 2 else "female"


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def infer_family_ids(rows: list[dict[str, Any]]) -> list[CleanVoterRow]:
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[(normalize_text(str(row.get("block_code", ""))), normalize_text(str(row.get("address", ""))))].append(row)

    cleaned: list[CleanVoterRow] = []
    for _, group_rows in grouped.items():
        name_map: dict[str, list[int]] = defaultdict(list)
        for index, row in enumerate(group_rows):
            name_map[normalize_text(str(row.get("name", "")))].append(index)

        parent: dict[int, int] = {index: index for index in range(len(group_rows))}

        def find(index: int) -> int:
            while parent[index] != index:
                parent[index] = parent[parent[index]]
                index = parent[index]
            return index

        def union(left: int, right: int) -> None:
            root_left = find(left)
            root_right = find(right)
            if root_left != root_right:
                parent[root_right] = root_left

        for index, row in enumerate(group_rows):
            relative_name = normalize_text(str(row.get("father_husband_name", "")))
            if relative_name in name_map:
                for candidate_index in name_map[relative_name]:
                    union(index, candidate_index)

        family_ids: dict[int, str] = {}
        for index, row in enumerate(group_rows):
            root = find(index)
            if root not in family_ids:
                family_ids[root] = str(uuid.uuid4())

            cleaned.append(
                CleanVoterRow(
                    block_code=str(row.get("block_code", "")).strip(),
                    serial_no=str(row.get("serial_no", "")).strip(),
                    name=str(row.get("name", "")).strip(),
                    father_husband_name=str(row.get("father_husband_name", "")).strip(),
                    cnic=str(row.get("cnic", "")).strip(),
                    profession=str(row.get("profession", "")).strip(),
                    age=row.get("age") if row.get("age") in (None, "") else int(row.get("age")),
                    address=str(row.get("address", "")).strip(),
                    inferred_family_id=family_ids[root],
                    voter_status=str(row.get("voter_status", "Unsurveyed") or "Unsurveyed"),
                    is_on_duty=int(bool(row.get("is_on_duty", 0)))
                )
            )

    return cleaned


def build_rows_from_source(source_path: Path) -> list[dict[str, Any]]:
    tables = extract_layout_tables(source_path)
    raw_rows = extract_rows_from_tables(tables)
    cleaned_rows = ai_cleanup_rows(raw_rows)
    for row in cleaned_rows:
        row.setdefault("voter_status", "Unsurveyed")
        row.setdefault("is_on_duty", 0)
        if row.get("voter_status") not in STATUS_VALUES:
            row["voter_status"] = "Unsurveyed"
    return cleaned_rows


def insert_rows(connection: sqlite3.Connection, rows: Iterable[CleanVoterRow]) -> None:
    connection.executemany(
        """
        INSERT INTO voters (
            block_code,
            serial_no,
            name,
            father_husband_name,
            cnic,
            profession,
            age,
            address,
            inferred_family_id,
            voter_status,
            is_on_duty
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                row.block_code,
                row.serial_no,
                row.name,
                row.father_husband_name,
                row.cnic,
                row.profession,
                row.age,
                row.address,
                row.inferred_family_id,
                row.voter_status,
                row.is_on_duty,
            )
            for row in rows
        ]
    )
    connection.commit()


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the offline voters SQLite database from OCR inputs.")
    parser.add_argument("--input", required=True, help="Path to a scanned electoral roll PDF or image.")
    parser.add_argument("--output", default="voters_db.sqlite", help="SQLite output path.")
    return parser.parse_args()


def main() -> None:
    args = parse_arguments()
    source_path = Path(args.input).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()

    structured_rows = build_rows_from_source(source_path)
    family_rows = infer_family_ids(structured_rows)

    if output_path.suffix.lower() == ".json":
        payload = [
            {
                "block_code": row.block_code,
                "serial_no": row.serial_no,
                "name": row.name,
                "father_husband_name": row.father_husband_name,
                "cnic": row.cnic,
                "profession": row.profession,
                "age": row.age,
                "address": row.address,
                "inferred_family_id": row.inferred_family_id,
                "voter_status": row.voter_status,
                "is_on_duty": bool(row.is_on_duty),
            }
            for row in family_rows
        ]
        output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Wrote {len(payload)} voters to {output_path}")
        return

    connection = create_connection(output_path)
    connection.execute("DELETE FROM voters;")
    insert_rows(connection, family_rows)
    connection.close()

    print(f"Wrote {len(family_rows)} voters to {output_path}")


if __name__ == "__main__":
    main()

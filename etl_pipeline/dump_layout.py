"""Dump first-2-pages OCR layout of a PDF to inspect column headers + structure."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Load .env from web_app
ENV_PATH = Path(__file__).resolve().parent.parent / "web_app" / ".env"
if ENV_PATH.exists():
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        v = v.strip().strip('"').strip("'")
        os.environ[k.strip()] = v

import io
from pypdf import PdfReader, PdfWriter
from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.core.credentials import AzureKeyCredential

if len(sys.argv) < 2:
    print("Usage: python dump_layout.py <pdf>")
    sys.exit(1)

pdf = Path(sys.argv[1])
reader = PdfReader(str(pdf))
writer = PdfWriter()
for i in range(min(2, len(reader.pages))):
    writer.add_page(reader.pages[i])
buf = io.BytesIO()
writer.write(buf)

client = DocumentIntelligenceClient(
    endpoint=os.environ["AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT"],
    credential=AzureKeyCredential(os.environ["AZURE_DOCUMENT_INTELLIGENCE_KEY"]),
)
print(f"Analyzing {pdf.name} pages 1-2 ({len(buf.getvalue())/1024/1024:.2f} MB)...")
poller = client.begin_analyze_document(model_id="prebuilt-layout", body=buf.getvalue())
result = poller.result()

tables_out = []
for t_idx, table in enumerate(getattr(result, "tables", []) or []):
    matrix = [["" for _ in range(table.column_count)] for _ in range(table.row_count)]
    for cell in table.cells:
        if 0 <= cell.row_index < table.row_count and 0 <= cell.column_index < table.column_count:
            matrix[cell.row_index][cell.column_index] = (cell.content or "").strip()
    tables_out.append({"index": t_idx, "rows": table.row_count, "cols": table.column_count, "matrix": matrix})

# Also dump first ~80 lines of raw text for reference
lines_out = []
for page in (result.pages or []):
    for ln in (page.lines or [])[:60]:
        lines_out.append(ln.content)
    if len(lines_out) > 80:
        break

out_path = Path(__file__).with_name("layout_dump.json")
out_path.write_text(json.dumps({"tables": tables_out, "first_lines": lines_out[:80]}, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Wrote {out_path}  (tables: {len(tables_out)})")
for t in tables_out[:3]:
    print(f"\n--- Table #{t['index']}: {t['rows']}x{t['cols']} ---")
    for r in t["matrix"][:4]:
        print(" | ".join(c[:40] for c in r))

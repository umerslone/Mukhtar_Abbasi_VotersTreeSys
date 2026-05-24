"""One-off cleanup: remove the seeded sample voters (block_code B-001 / B-002)."""
from pathlib import Path
import os
import sys

from dotenv import load_dotenv
import psycopg2

load_dotenv(Path(__file__).resolve().parent.parent / "web_app" / ".env")

dsn = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
if not dsn:
    sys.exit("DATABASE_URL / POSTGRES_URL not set")

conn = psycopg2.connect(dsn)
conn.autocommit = True
with conn.cursor() as cur:
    cur.execute('SELECT COUNT(*) FROM "Voter" WHERE block_code IN (%s, %s)', ("B-001", "B-002"))
    before = cur.fetchone()[0]
    cur.execute('DELETE FROM "Voter" WHERE block_code IN (%s, %s)', ("B-001", "B-002"))
    print(f"Deleted {before} sample voters (block_code B-001/B-002).")
conn.close()

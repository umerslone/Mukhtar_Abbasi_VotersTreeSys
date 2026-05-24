"""Run neon_etl.py using DATABASE_URL from ../web_app/.env"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def load_env_file(path: Path) -> None:
    if not path.exists():
        sys.exit(f"Missing env file: {path}")
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit("Usage: python run_neon_etl.py <input.sqlite|input.json|input.csv>")

    here = Path(__file__).resolve().parent
    load_env_file(here.parent / "web_app" / ".env")

    if not os.environ.get("DATABASE_URL"):
        sys.exit("DATABASE_URL not found in web_app/.env")

    result = subprocess.run(
        [sys.executable, str(here / "neon_etl.py"), "--input", sys.argv[1]],
        check=False,
    )
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()

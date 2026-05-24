"""Run voters_etl.py using AZURE_* credentials from ../web_app/.env

Usage:
    python run_voters_etl.py --input "C:\\path\\to\\voter_list.pdf" --output voters_db.sqlite
"""
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
        os.environ[key] = value


def main() -> None:
    here = Path(__file__).resolve().parent
    load_env_file(here.parent / "web_app" / ".env")

    required = [
        "AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT",
        "AZURE_DOCUMENT_INTELLIGENCE_KEY",
        "AZURE_OPENAI_ENDPOINT",
        "AZURE_OPENAI_API_KEY",
    ]
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        sys.exit(f"Missing required env vars in web_app/.env: {', '.join(missing)}")

    result = subprocess.run(
        [sys.executable, str(here / "voters_etl.py"), *sys.argv[1:]],
        check=False,
    )
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()

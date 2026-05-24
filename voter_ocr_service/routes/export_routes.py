"""GET /exports/<file> — serve generated JSON/CSV."""
from __future__ import annotations

from flask import Blueprint, abort, send_from_directory

from config import OUTPUT_DIR

export_bp = Blueprint("exports", __name__)


@export_bp.get("/exports/<path:filename>")
def fetch_export(filename: str):
    # Guard against traversal — werkzeug's send_from_directory already
    # blocks `..`, but be explicit.
    if "/" in filename or "\\" in filename:
        abort(400)
    return send_from_directory(OUTPUT_DIR, filename, as_attachment=True)

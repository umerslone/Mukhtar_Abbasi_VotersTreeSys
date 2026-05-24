"""GET /search — name/cnic/father_name lookup over the most recent batch."""
from __future__ import annotations

from flask import Blueprint, jsonify, request

from services.search_service import all_records, search

search_bp = Blueprint("search", __name__)


@search_bp.get("/search")
def do_search():
    name = request.args.get("name")
    cnic = request.args.get("cnic")
    father = request.args.get("father_name")
    limit = int(request.args.get("limit", "50"))
    if not any((name, cnic, father)):
        return jsonify(success=True, total=len(all_records()), data=all_records()[:limit])

    hits = search(name=name, cnic=cnic, father_name=father, limit=limit)
    return jsonify(success=True, total=len(hits), data=hits)

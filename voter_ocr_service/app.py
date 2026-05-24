"""Flask entrypoint for the Voter OCR microservice.

Run locally:
    python app.py
Production (Linux):
    gunicorn -w 2 -b 0.0.0.0:5005 app:app
Production (Windows):
    waitress-serve --listen=0.0.0.0:5005 app:app
"""
from __future__ import annotations

from flask import Flask, jsonify
from flask_cors import CORS

from config import CORS_ORIGINS, DEBUG, HOST, MAX_CONTENT_LENGTH, PORT
from routes.export_routes import export_bp
from routes.search_routes import search_bp
from routes.upload_routes import upload_bp
from utils.logger import get_logger

log = get_logger("app")


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH
    app.config["JSON_AS_ASCII"] = False
    app.config["JSONIFY_PRETTYPRINT_REGULAR"] = False

    CORS(
        app,
        resources={r"/*": {"origins": CORS_ORIGINS or "*"}},
        supports_credentials=False,
    )

    app.register_blueprint(upload_bp)
    app.register_blueprint(search_bp)
    app.register_blueprint(export_bp)

    @app.get("/")
    @app.get("/health")
    def health():
        return jsonify(
            service="voter-ocr-service",
            status="ok",
            endpoints=[
                "POST /extract-voters",
                "GET  /search?name=&cnic=&father_name=",
                "GET  /exports/<file>",
            ],
        )

    @app.errorhandler(413)
    def too_large(_e):
        return jsonify(success=False, message="File exceeds size limit"), 413

    @app.errorhandler(404)
    def not_found(_e):
        return jsonify(success=False, message="Not found"), 404

    @app.errorhandler(500)
    def server_error(e):
        log.exception("Unhandled 500: %s", e)
        return jsonify(success=False, message="Internal server error"), 500

    return app


app = create_app()


if __name__ == "__main__":
    log.info("Starting voter-ocr-service on %s:%d (debug=%s)", HOST, PORT, DEBUG)
    app.run(host=HOST, port=PORT, debug=DEBUG)

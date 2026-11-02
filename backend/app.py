"""Notera sticky notes store — Flask + MongoDB backend.

Run:  python app.py      then open http://localhost:5000
The backend serves the pages in ../frontend and the JSON API under /api.
"""
import os

from flask import Flask, abort, jsonify, request, send_from_directory
from flask_cors import CORS
from pymongo.errors import PyMongoError
from werkzeug.exceptions import HTTPException

from config import Config
from db import init_db
from utils import ApiError

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def create_app(config=None, mongo_client=None):
    app = Flask(__name__, static_folder=None)
    app.config.from_object(Config)
    if config:
        app.config.update(config)
    app.json.sort_keys = False

    CORS(app, resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}},
         supports_credentials=True, allow_headers=["Content-Type", "X-Requested-With"])

    db = init_db(app, mongo_client)

    # First start with an empty database: load products and settings from the HTML.
    if app.config.get("AUTO_SEED", True) and db.products.count_documents({}) == 0:
        from seed import seed
        seed(db, app.config["FRONTEND_DIR"], config=app.config, quiet=True)
        app.logger.warning("Database was empty: products and settings loaded from the HTML")

    from routes import account, admin, auth, cart, catalog, newsletter, orders
    for module in (auth, account, catalog, cart, orders, newsletter, admin):
        app.register_blueprint(module.bp)

    # ---------- protection against cross-site form posts (CSRF) ----------
    # Every change must come from our own JavaScript, which sends this header.
    # Plain HTML forms on other websites cannot add it.
    @app.before_request
    def require_ajax_header():
        if request.path.startswith("/api/") and request.method not in SAFE_METHODS:
            if request.headers.get("X-Requested-With") != "fetch":
                raise ApiError(403, "forbidden", "Missing X-Requested-With header")

    @app.after_request
    def no_cache_api(response):
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    # ---------- JSON errors ----------
    @app.errorhandler(ApiError)
    def handle_api_error(err):
        payload = {"error": err.code, "message": err.message}
        payload.update(err.extra)
        return jsonify(payload), err.status

    @app.errorhandler(PyMongoError)
    def handle_db_error(err):
        app.logger.exception("Database error")
        return jsonify({"error": "database", "message": "The store database is not reachable"}), 503

    @app.errorhandler(HTTPException)
    def handle_http_error(err):
        if request.path.startswith("/api/"):
            return jsonify({"error": err.name.lower().replace(" ", "_"), "message": err.description}), err.code
        return err

    @app.get("/api/health")
    def health():
        app.extensions["mongo_client"].admin.command("ping")
        return jsonify({"ok": True, "database": app.config["MONGO_DB"]})

    # ---------- the website itself ----------
    frontend = app.config["FRONTEND_DIR"]

    @app.get("/")
    def home():
        return send_from_directory(frontend, "index.html")

    @app.get("/<path:filename>")
    def site_files(filename):
        if filename.startswith("api/"):
            abort(404)
        path = os.path.join(frontend, filename)
        if os.path.isdir(path):
            filename = os.path.join(filename, "index.html")
        return send_from_directory(frontend, filename)

    return app


if __name__ == "__main__":
    application = create_app()
    application.run(host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "5000")),
                    debug=os.getenv("FLASK_DEBUG", "0") == "1")

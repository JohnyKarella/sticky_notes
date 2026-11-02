"""Settings for the Notera backend, read from environment variables (or a .env file)."""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")


def _bool(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


class Config:
    # MongoDB
    MONGO_URI = os.getenv("MONGO_URI", "").strip()
    MONGO_DB = os.getenv("MONGO_DB", "notera_store")

    # Flask session cookie (holds the signed-in user id and the guest cart id)
    SECRET_KEY = os.getenv("SECRET_KEY", "change-this-secret-key-before-going-live")
    SESSION_COOKIE_NAME = "notera_session"
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = os.getenv("SESSION_COOKIE_SAMESITE", "Lax")
    SESSION_COOKIE_SECURE = _bool("SESSION_COOKIE_SECURE", False)
    PERMANENT_SESSION_LIFETIME = 60 * 60 * 24 * 30  # 30 days

    # Where the HTML/CSS/JS lives. The backend serves it, so one command runs the whole site.
    FRONTEND_DIR = os.getenv("FRONTEND_DIR", str((BASE_DIR.parent / "frontend").resolve()))

    # Only needed if the frontend is served from a different address (e.g. VS Code Live Server).
    CORS_ORIGINS = [o.strip() for o in os.getenv(
        "CORS_ORIGINS", "http://localhost:5500,http://127.0.0.1:5500").split(",") if o.strip()]

    # Admin panel login (admin.html), created by seed.py / first start
    ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
    ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "Notera@Admin2026")
    ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@notera.example")
    ADMIN_NAME = os.getenv("ADMIN_NAME", "Store Admin")

    # SMTP is used to send admin password-reset links.
    SMTP_HOST = os.getenv("SMTP_HOST", "")
    SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
    SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
    SMTP_FROM = os.getenv("SMTP_FROM", "")
    SMTP_USE_TLS = _bool("SMTP_USE_TLS", True)
    PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "")

    # Stock given to each product marked data-stock="in" when seeding
    DEFAULT_STOCK = int(os.getenv("DEFAULT_STOCK", "100"))

    TESTING = False

"""Shared helpers: JSON errors, sessions, sign-in checks and input validation."""
import re
import uuid
from datetime import datetime, timezone
from functools import wraps

from bson import ObjectId
from bson.errors import InvalidId
from flask import jsonify, request, session

from db import get_db

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")
PHONE_RE = re.compile(r"^[0-9+ ]{10,14}$")
PIN_RE = re.compile(r"^[0-9]{6}$")


class ApiError(Exception):
    """Raise anywhere in a route to send {"error": code, "message": ...} with a status."""

    def __init__(self, status, code, message="", **extra):
        super().__init__(message or code)
        self.status = status
        self.code = code
        self.message = message or code
        self.extra = extra


def now():
    return datetime.now(timezone.utc)


def iso(dt):
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def body():
    """The JSON body of the request (always a dict)."""
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def text(data, key, max_len=200, required=False, label=None):
    value = data.get(key, "")
    value = "" if value is None else str(value).strip()
    if required and not value:
        raise ApiError(400, "invalid", f"{label or key} is required", field=key)
    return value[:max_len]


def check_email(value, field="email"):
    value = (value or "").strip().lower()
    if not EMAIL_RE.match(value):
        raise ApiError(400, "invalid", "Please enter a valid email address", field=field)
    return value


def to_object_id(value):
    try:
        return ObjectId(str(value))
    except (InvalidId, TypeError):
        return None


def ok(payload=None, status=200):
    return jsonify(payload if payload is not None else {"ok": True}), status


# ---------------------------------------------------------------- sessions

def current_user():
    """The signed-in user document, or None."""
    uid = to_object_id(session.get("user_id"))
    if not uid:
        return None
    user = get_db().users.find_one({"_id": uid, "active": {"$ne": False}})
    if user and user.get("role") == "admin" and session.get("admin_auth_version") != user.get("auth_version", 0):
        session.clear()
        return None
    if not user:
        session.pop("user_id", None)
    return user


def guest_id():
    """A random id that ties a guest's cart and wishlist to this browser."""
    gid = session.get("guest_id")
    if not gid:
        gid = uuid.uuid4().hex
        session["guest_id"] = gid
        session.permanent = True
    return gid


def owner_key(user=None):
    """Carts and wishlists belong to 'u:<user id>' or 'g:<guest id>'."""
    user = user if user is not None else current_user()
    if user:
        return f"u:{user['_id']}"
    return f"g:{guest_id()}"


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user:
            raise ApiError(401, "auth_required", "Please sign in")
        return fn(user, *args, **kwargs)
    return wrapper


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user:
            raise ApiError(401, "auth_required", "Please sign in")
        if user.get("role") != "admin":
            raise ApiError(403, "forbidden", "Admins only")
        return fn(user, *args, **kwargs)
    return wrapper


def log_event(kind, user=None, email=""):
    """Save a sign-up / sign-in / failed attempt in the login_events collection."""
    get_db().login_events.insert_one({
        "type": kind,
        "user_id": user["_id"] if user else None,
        "name": (user or {}).get("name", ""),
        "email": (user or {}).get("email", "") or (email or "")[:120],
        "username": (user or {}).get("username", ""),
        "role": (user or {}).get("role", ""),
        "ip": (request.headers.get("X-Forwarded-For", request.remote_addr or "").split(",")[0].strip())[:60],
        "device": (request.headers.get("User-Agent") or "")[:200],
        "at": now(),
    })


def public_user(user):
    return {
        "id": str(user["_id"]),
        "name": user.get("name", ""),
        "email": user.get("email", ""),
        "phone": user.get("phone", ""),
        "role": user.get("role", "customer"),
        "username": user.get("username", "") if user.get("role") == "admin" else "",
        "addresses": [public_address(a) for a in user.get("addresses", [])],
    }


def public_address(a):
    return {k: a.get(k, "") for k in ("id", "label", "address", "city", "state", "pin", "country")}

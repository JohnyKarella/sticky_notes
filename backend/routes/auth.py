"""Sign up, sign in, sign out and "who am I"."""
from flask import Blueprint, session
from pymongo.errors import DuplicateKeyError
from werkzeug.security import check_password_hash, generate_password_hash

from db import get_db
from services import cart_payload, merge_guest_into_user, wishlist_payload
from utils import (PHONE_RE, ApiError, body, check_email, current_user, log_event, now, ok,
                   owner_key, public_user, text)

bp = Blueprint("auth", __name__, url_prefix="/api/auth")

MIN_PASSWORD = 8


def _start_session(user):
    """Sign the user in and move the guest cart/wishlist into the account."""
    guest = session.get("guest_id")
    session.clear()
    session.permanent = True
    session["user_id"] = str(user["_id"])
    if guest:
        merge_guest_into_user(f"g:{guest}", f"u:{user['_id']}")
    owner = owner_key(user)
    return {"user": public_user(user), "cart": cart_payload(owner), "wishlist": wishlist_payload(owner)}


@bp.post("/signup")
def signup():
    data = body()
    name = text(data, "name", 80, required=True, label="Name")
    email = check_email(data.get("email"))
    phone = text(data, "phone", 20)
    password = str(data.get("password") or "")
    if phone and not PHONE_RE.match(phone):
        raise ApiError(400, "invalid", "Please enter a valid phone number", field="phone")
    if len(password) < MIN_PASSWORD:
        raise ApiError(400, "invalid", f"Password must be at least {MIN_PASSWORD} characters", field="password")

    user = {
        "name": name, "email": email, "phone": phone,
        "password_hash": generate_password_hash(password),
        "role": "customer", "addresses": [], "active": True,
        "created_at": now(), "last_login": now(), "login_count": 1,
    }
    try:
        user["_id"] = get_db().users.insert_one(user).inserted_id
    except DuplicateKeyError:
        raise ApiError(409, "email_taken", "An account with this email already exists")
    log_event("signup", user)
    return ok(_start_session(user), 201)


@bp.post("/signin")
def signin():
    data = body()
    email = (data.get("email") or "").strip().lower()
    password = str(data.get("password") or "")
    user = get_db().users.find_one({"email": email, "active": {"$ne": False}})
    if not user or not check_password_hash(user.get("password_hash", ""), password):
        log_event("failed", user, email)
        raise ApiError(401, "bad_credentials", "Email or password is incorrect")
    get_db().users.update_one({"_id": user["_id"]}, {"$set": {"last_login": now()}, "$inc": {"login_count": 1}})
    log_event("signin", user)
    return ok(_start_session(user))


@bp.post("/signout")
def signout():
    session.clear()
    return ok()


@bp.get("/me")
def me():
    user = current_user()
    return ok({"user": public_user(user) if user else None})

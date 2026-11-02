"""Admin API used by frontend/admin.html. Every route needs a user with role "admin"."""
import secrets
import smtplib
from datetime import timedelta
from email.message import EmailMessage

from flask import Blueprint, current_app, request, session
from pymongo.errors import DuplicateKeyError
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

from db import get_db
from services import public_product
from utils import (ApiError, admin_required, body, check_email, iso, log_event, now, ok, public_user,
                   text, to_object_id)
from routes.catalog import public_review, refresh_rating
from routes.orders import STATUSES, public_order, set_status

bp = Blueprint("admin", __name__, url_prefix="/api/admin")

LOW_STOCK = 10
EVENT_TYPES = ["signup", "signin", "failed", "admin-signin", "admin-failed"]
RESET_SALT = "admin-password-reset"
RESET_MAX_AGE = 30 * 60


def send_admin_reset_email(recipient, reset_url):
    """Send a reset link using SMTP settings from the environment."""
    config = current_app.config
    required = ("SMTP_HOST", "SMTP_FROM", "PUBLIC_BASE_URL")
    missing = [key for key in required if not config.get(key)]
    if missing:
        current_app.logger.error("Admin password reset email is not configured: missing %s", ", ".join(missing))
        raise ApiError(503, "email_unavailable", "Password reset email is not configured")

    message = EmailMessage()
    message["Subject"] = "Reset your Notera admin password"
    message["From"] = config["SMTP_FROM"]
    message["To"] = recipient
    message.set_content(
        "A password reset was requested for your Notera admin account.\n\n"
        f"Use this one-time link within 30 minutes:\n{reset_url}\n\n"
        "If you did not request this, you can ignore this email."
    )

    try:
        with smtplib.SMTP(config["SMTP_HOST"], config["SMTP_PORT"], timeout=10) as smtp:
            if config.get("SMTP_USE_TLS", True):
                smtp.starttls()
            if config.get("SMTP_USERNAME"):
                smtp.login(config["SMTP_USERNAME"], config.get("SMTP_PASSWORD", ""))
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException):
        current_app.logger.exception("Could not send admin password reset email")
        raise ApiError(503, "email_unavailable", "Could not send the password reset email")


# ---------------------------------------------------------------- admin login (username + password)

@bp.post("/login")
def admin_login():
    data = body()
    username = str(data.get("username") or "").strip().lower()
    password = str(data.get("password") or "")
    admin = get_db().users.find_one({"username": username, "role": "admin", "active": {"$ne": False}})
    if not admin or not check_password_hash(admin.get("password_hash", ""), password):
        log_event("admin-failed", None, username)
        raise ApiError(401, "bad_credentials", "Username or password is incorrect")
    session.clear()
    session.permanent = True
    session["user_id"] = str(admin["_id"])
    session["admin_auth_version"] = admin.get("auth_version", 0)
    get_db().users.update_one({"_id": admin["_id"]}, {"$set": {"last_login": now()}, "$inc": {"login_count": 1}})
    log_event("admin-signin", admin)
    return ok({"user": dict(public_user(admin), username=admin.get("username", ""))})


@bp.post("/forgot-password")
def forgot_admin_password():
    data = body()
    email = check_email(str(data.get("email") or ""))
    config = current_app.config
    missing = [key for key in ("SMTP_HOST", "SMTP_FROM", "PUBLIC_BASE_URL") if not config.get(key)]
    if missing:
        current_app.logger.error("Admin password reset email is not configured: missing %s", ", ".join(missing))
        raise ApiError(503, "email_unavailable", "Password reset email is not configured")
    admin = get_db().users.find_one({"role": "admin", "email": email, "active": {"$ne": False}})
    if not admin:
        return ok({"message": "If that email belongs to an admin account, a reset link will be sent."})

    nonce = secrets.token_urlsafe(32)
    get_db().users.update_one({"_id": admin["_id"]}, {"$set": {"password_reset_nonce": nonce}})
    token = URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=RESET_SALT).dumps(
        {"admin_id": str(admin["_id"]), "nonce": nonce})
    base_url = config["PUBLIC_BASE_URL"].rstrip("/")
    reset_url = f"{base_url}/admin.html?reset={token}"
    try:
        send_admin_reset_email(admin["email"], reset_url)
    except ApiError:
        get_db().users.update_one(
            {"_id": admin["_id"], "password_reset_nonce": nonce},
            {"$unset": {"password_reset_nonce": ""}})
        raise
    return ok({"message": "If that email belongs to an admin account, a reset link will be sent."})


@bp.post("/reset-password")
def reset_admin_password():
    data = body()
    token = text(data, "token", max_len=4096, required=True)
    password = str(data.get("password") or "")
    if len(password) < 8:
        raise ApiError(400, "invalid", "Password must be at least 8 characters", field="password")
    serializer = URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=RESET_SALT)
    try:
        payload = serializer.loads(token, max_age=RESET_MAX_AGE)
    except SignatureExpired:
        raise ApiError(400, "invalid_reset", "This password reset link has expired")
    except BadSignature:
        raise ApiError(400, "invalid_reset", "This password reset link is invalid")

    if not isinstance(payload, dict):
        raise ApiError(400, "invalid_reset", "This password reset link is invalid")
    admin_id = to_object_id(payload.get("admin_id"))
    nonce = payload.get("nonce")
    if not admin_id or not isinstance(nonce, str):
        raise ApiError(400, "invalid_reset", "This password reset link is invalid")
    result = get_db().users.update_one(
        {"_id": admin_id, "role": "admin", "active": {"$ne": False}, "password_reset_nonce": nonce},
        {"$set": {"password_hash": generate_password_hash(password), "password_changed_at": now()},
         "$inc": {"auth_version": 1},
         "$unset": {"password_reset_nonce": ""}})
    if not result.modified_count:
        raise ApiError(400, "invalid_reset", "This password reset link is invalid or has already been used")
    return ok({"message": "Your admin password has been changed. You can now sign in."})


@bp.post("/logout")
def admin_logout():
    session.clear()
    return ok()


@bp.get("/activity")
@admin_required
def activity(_admin):
    """Every sign-up, sign-in and failed attempt, newest first."""
    query = {}
    if request.args.get("type") in EVENT_TYPES:
        query["type"] = request.args["type"]
    cursor = get_db().login_events.find(query).sort("at", -1).limit(1000)
    return ok({"events": [{"type": e.get("type"), "name": e.get("name", ""), "email": e.get("email", ""),
                           "ip": e.get("ip", ""), "device": e.get("device", ""), "date": iso(e.get("at"))}
                          for e in cursor]})


@bp.get("/stats")
@admin_required
def stats(_admin):
    db = get_db()
    live = list(db.orders.find({"status": {"$ne": "cancelled"}}, {"totals.total": 1}))
    return ok({
        "orders": db.orders.count_documents({}),
        "openOrders": db.orders.count_documents({"status": {"$in": ["placed", "packed", "shipped"]}}),
        "revenue": sum(o.get("totals", {}).get("total", 0) for o in live),
        "customers": db.users.count_documents({"role": "customer"}),
        "products": db.products.count_documents({}),
        "lowStock": db.products.count_documents({"stock_qty": {"$lte": LOW_STOCK}}),
        "subscribers": db.newsletter.count_documents({"active": True}),
        "signinsToday": db.login_events.count_documents(
            {"type": {"$in": ["signin", "signup"]}, "at": {"$gte": now() - timedelta(hours=24)}}),
        "statuses": STATUSES,
    })


# ---------------------------------------------------------------- orders

@bp.get("/orders")
@admin_required
def orders(_admin):
    query = {}
    if request.args.get("status") in STATUSES:
        query["status"] = request.args["status"]
    cursor = get_db().orders.find(query).sort("created_at", -1).limit(500)
    return ok({"orders": [public_order(o) for o in cursor]})


@bp.patch("/orders/<order_id>")
@admin_required
def update_order(_admin, order_id):
    order = get_db().orders.find_one({"_id": order_id})
    if not order:
        raise ApiError(404, "not_found", "Order not found")
    set_status(order, body().get("status"))
    return ok({"order": public_order(get_db().orders.find_one({"_id": order_id}))})


# ---------------------------------------------------------------- products

@bp.get("/products")
@admin_required
def products(_admin):
    cursor = get_db().products.find({}).sort("position", 1)
    return ok({"products": [public_product(p, full=True) for p in cursor]})


@bp.patch("/products/<product_id>")
@admin_required
def update_product(_admin, product_id):
    data = body()
    changes = {}
    for key, field in (("price", "price"), ("stockQty", "stock_qty")):
        if key in data:
            try:
                value = int(data[key])
            except (TypeError, ValueError):
                raise ApiError(400, "invalid", f"{key} must be a whole number", field=key)
            if value < 0:
                raise ApiError(400, "invalid", f"{key} cannot be negative", field=key)
            changes[field] = value
    if "compareAt" in data:
        changes["compare_at"] = int(data["compareAt"]) if data["compareAt"] not in (None, "") else None
    if "active" in data:
        changes["active"] = bool(data["active"])
    if not changes:
        raise ApiError(400, "invalid", "Nothing to update")
    changes["updated_at"] = now()
    res = get_db().products.update_one({"_id": product_id}, {"$set": changes})
    if not res.matched_count:
        raise ApiError(404, "not_found", "Product not found")
    return ok({"product": public_product(get_db().products.find_one({"_id": product_id}), full=True)})


# ---------------------------------------------------------------- customers & subscribers

@bp.get("/customers")
@admin_required
def customers(_admin):
    db = get_db()
    counts = {}
    for o in db.orders.find({"user_id": {"$ne": None}, "status": {"$ne": "cancelled"}},
                            {"user_id": 1, "totals.total": 1}):
        c = counts.setdefault(o["user_id"], [0, 0])
        c[0] += 1
        c[1] += o.get("totals", {}).get("total", 0)
    out = []
    for u in db.users.find({}).sort("created_at", -1).limit(1000):
        c = counts.get(u["_id"], [0, 0])
        out.append({"id": str(u["_id"]), "name": u.get("name", ""), "email": u.get("email", ""),
                    "phone": u.get("phone", ""), "role": u.get("role", "customer"),
                    "joined": iso(u.get("created_at")), "lastLogin": iso(u.get("last_login")),
                    "logins": u.get("login_count", 0), "orders": c[0], "spent": c[1]})
    return ok({"customers": out})


@bp.get("/newsletter")
@admin_required
def subscribers(_admin):
    cursor = get_db().newsletter.find({}).sort("subscribed_at", -1).limit(5000)
    return ok({"subscribers": [{"email": s["email"], "active": s.get("active", True),
                                "date": iso(s.get("subscribed_at"))} for s in cursor]})


# ---------------------------------------------------------------- promo codes

def public_promo(p):
    return {"code": p["code"], "percent": p.get("percent", 0), "active": p.get("active", True),
            "uses": p.get("uses", 0)}


@bp.get("/promos")
@admin_required
def promos(_admin):
    return ok({"promos": [public_promo(p) for p in get_db().promo_codes.find({}).sort("code", 1)]})


@bp.post("/promos")
@admin_required
def create_promo(_admin):
    data = body()
    code = str(data.get("code") or "").strip().upper()
    try:
        percent = int(data.get("percent"))
    except (TypeError, ValueError):
        percent = 0
    if not code.isalnum() or len(code) > 20:
        raise ApiError(400, "invalid", "Code must be letters and numbers only", field="code")
    if not 1 <= percent <= 90:
        raise ApiError(400, "invalid", "Percent must be between 1 and 90", field="percent")
    doc = {"code": code, "percent": percent, "active": True, "uses": 0, "created_at": now()}
    try:
        get_db().promo_codes.insert_one(doc)
    except DuplicateKeyError:
        raise ApiError(409, "exists", "That code already exists")
    return ok({"promo": public_promo(doc)}, 201)


@bp.patch("/promos/<code>")
@admin_required
def update_promo(_admin, code):
    data = body()
    changes = {}
    if "active" in data:
        changes["active"] = bool(data["active"])
    if "percent" in data:
        percent = int(data["percent"])
        if not 1 <= percent <= 90:
            raise ApiError(400, "invalid", "Percent must be between 1 and 90")
        changes["percent"] = percent
    res = get_db().promo_codes.update_one({"code": code.upper()}, {"$set": changes or {"updated_at": now()}})
    if not res.matched_count:
        raise ApiError(404, "not_found", "Code not found")
    return ok({"promo": public_promo(get_db().promo_codes.find_one({"code": code.upper()}))})


# ---------------------------------------------------------------- reviews

@bp.get("/reviews")
@admin_required
def reviews(_admin):
    cursor = get_db().reviews.find({}).sort("created_at", -1).limit(500)
    return ok({"reviews": [dict(public_review(r), hidden=bool(r.get("hidden"))) for r in cursor]})


@bp.patch("/reviews/<review_id>")
@admin_required
def moderate_review(_admin, review_id):
    rid = to_object_id(review_id)
    review = get_db().reviews.find_one({"_id": rid}) if rid else None
    if not review:
        raise ApiError(404, "not_found", "Review not found")
    get_db().reviews.update_one({"_id": rid}, {"$set": {"hidden": bool(body().get("hidden"))}})
    refresh_rating(review["product_id"])
    return ok()

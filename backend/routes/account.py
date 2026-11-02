"""Account page: profile, password and saved addresses."""
import uuid

from flask import Blueprint
from werkzeug.security import check_password_hash, generate_password_hash

from db import get_db
from utils import (PHONE_RE, PIN_RE, ApiError, body, login_required, now, ok, public_address,
                   public_user, text)

bp = Blueprint("account", __name__, url_prefix="/api/account")

MAX_ADDRESSES = 10


@bp.get("")
@login_required
def get_account(user):
    return ok({"user": public_user(user)})


@bp.put("/profile")
@login_required
def update_profile(user):
    data = body()
    name = text(data, "name", 80, required=True, label="Name")
    phone = text(data, "phone", 20)
    if phone and not PHONE_RE.match(phone):
        raise ApiError(400, "invalid", "Please enter a valid phone number", field="phone")
    get_db().users.update_one({"_id": user["_id"]},
                              {"$set": {"name": name, "phone": phone, "updated_at": now()}})
    user.update(name=name, phone=phone)
    return ok({"user": public_user(user)})


@bp.put("/password")
@login_required
def change_password(user):
    data = body()
    if not check_password_hash(user.get("password_hash", ""), str(data.get("currentPassword") or "")):
        raise ApiError(400, "bad_credentials", "Current password is incorrect", field="currentPassword")
    new = str(data.get("newPassword") or "")
    if len(new) < 8:
        raise ApiError(400, "invalid", "Password must be at least 8 characters", field="newPassword")
    get_db().users.update_one({"_id": user["_id"]},
                              {"$set": {"password_hash": generate_password_hash(new), "updated_at": now()}})
    return ok()


def clean_address(data):
    address = {
        "label": text(data, "label", 40) or text(data, "city", 40),
        "address": text(data, "address", 200, required=True, label="Address"),
        "city": text(data, "city", 80, required=True, label="City"),
        "state": text(data, "state", 80, required=True, label="State"),
        "pin": text(data, "pin", 6, required=True, label="PIN code"),
        "country": text(data, "country", 60) or "India",
    }
    if not PIN_RE.match(address["pin"]):
        raise ApiError(400, "invalid", "PIN code must be 6 digits", field="pin")
    return address


def add_address(user, address):
    """Save an address unless the same one is already saved."""
    existing = user.get("addresses", [])
    same = lambda a: all(a.get(k, "").lower() == address[k].lower() for k in ("address", "city", "pin"))
    if any(same(a) for a in existing):
        return existing
    if len(existing) >= MAX_ADDRESSES:
        raise ApiError(400, "too_many", f"You can save up to {MAX_ADDRESSES} addresses")
    address["id"] = uuid.uuid4().hex[:12]
    get_db().users.update_one({"_id": user["_id"]}, {"$push": {"addresses": address}})
    return existing + [address]


@bp.get("/addresses")
@login_required
def list_addresses(user):
    return ok({"addresses": [public_address(a) for a in user.get("addresses", [])]})


@bp.post("/addresses")
@login_required
def create_address(user):
    addresses = add_address(user, clean_address(body()))
    return ok({"addresses": [public_address(a) for a in addresses]}, 201)


@bp.delete("/addresses/<address_id>")
@login_required
def delete_address(user, address_id):
    get_db().users.update_one({"_id": user["_id"]}, {"$pull": {"addresses": {"id": address_id}}})
    fresh = get_db().users.find_one({"_id": user["_id"]})
    return ok({"addresses": [public_address(a) for a in fresh.get("addresses", [])]})

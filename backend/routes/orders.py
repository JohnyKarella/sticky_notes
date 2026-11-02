"""Checkout and orders.

POST /api/orders turns the cart stored in MongoDB into an order: it re-reads every
price from the products collection, checks and reserves stock, applies the promo
code and delivery fee, saves the order, and empties the cart.
Payment is simulated: card / UPI details never reach the server.
"""
from datetime import timedelta

from flask import Blueprint, session

from db import get_db, get_settings, next_sequence
from services import (compute_totals, delivery_option, expand_lines, find_promo, load_cart,
                      save_cart)
from utils import (PHONE_RE, PIN_RE, ApiError, body, check_email, current_user, iso,
                   login_required, now, ok, owner_key, text)
from routes.account import add_address

bp = Blueprint("orders", __name__, url_prefix="/api/orders")

STATUSES = ["placed", "packed", "shipped", "delivered", "cancelled"]
GUEST_ORDER_MEMORY = 20


def public_order(o):
    return {
        "id": o["_id"],
        "status": o.get("status", "placed"),
        "date": iso(o.get("created_at")),
        "etaDate": iso(o.get("eta")),
        "items": o.get("items", []),
        "totals": o.get("totals", {}),
        "promo": o.get("promo"),
        "delivery": (o.get("delivery") or {}).get("label", ""),
        "payment": (o.get("payment") or {}).get("method", ""),
        "paymentStatus": (o.get("payment") or {}).get("status", ""),
        "customer": o.get("customer", {}),
        "address": o.get("address_text", ""),
        "history": [{"status": h["status"], "date": iso(h.get("at"))} for h in o.get("history", [])],
    }


def reserve_stock(items):
    """Take the ordered quantity off each product's stock, all or nothing."""
    products = get_db().products
    done = []
    for item in items:
        res = products.update_one({"_id": item["id"], "active": {"$ne": False}, "stock_qty": {"$gte": item["qty"]}},
                                  {"$inc": {"stock_qty": -item["qty"], "sold": item["qty"]}})
        if res.modified_count != 1:
            for d in done:  # put back what was already taken
                products.update_one({"_id": d["id"]}, {"$inc": {"stock_qty": d["qty"], "sold": -d["qty"]}})
            left = (products.find_one({"_id": item["id"]}) or {}).get("stock_qty", 0)
            raise ApiError(409, "out_of_stock", f"Only {max(0, left)} left of {item['name']}",
                           productId=item["id"], available=max(0, left))
        done.append(item)


def release_stock(order):
    for item in order.get("items", []):
        get_db().products.update_one({"_id": item["id"]},
                                     {"$inc": {"stock_qty": item["qty"], "sold": -item["qty"]}})


@bp.post("")
def place_order():
    data = body()
    settings = get_settings()
    user = current_user()
    owner = owner_key(user)

    cart = load_cart(owner)
    items = expand_lines(cart.get("items", []))
    if not items:
        raise ApiError(400, "empty_cart", "Your cart is empty")

    first = text(data, "firstName", 60, required=True, label="First name")
    last = text(data, "lastName", 60)
    email = check_email(data.get("email"))
    phone = text(data, "phone", 20, required=True, label="Phone")
    if not PHONE_RE.match(phone):
        raise ApiError(400, "invalid", "Please enter a valid phone number", field="phone")
    address = {
        "address": text(data, "address", 200, required=True, label="Address"),
        "city": text(data, "city", 80, required=True, label="City"),
        "state": text(data, "state", 80, required=True, label="State"),
        "pin": text(data, "pin", 6, required=True, label="PIN code"),
        "country": text(data, "country", 60) or "India",
    }
    if not PIN_RE.match(address["pin"]):
        raise ApiError(400, "invalid", "PIN code must be 6 digits", field="pin")

    delivery = delivery_option(settings, data.get("delivery"))
    payment = text(data, "payment", 40)
    if payment not in settings["payment_methods"]:
        raise ApiError(400, "invalid", "Please choose a payment method", field="payment")

    promo = find_promo(cart.get("promo_code")) if cart.get("promo_code") else None
    totals = compute_totals(items, promo["percent"] if promo else 0, delivery, settings)
    totals.pop("remaining", None)

    reserve_stock(items)

    created = now()
    order_id = f"{settings.get('order_prefix', '')}{100000 + next_sequence('order')}"
    order = {
        "_id": order_id,
        "user_id": user["_id"] if user else None,
        "customer": {"name": f"{first} {last}".strip(), "email": email, "phone": phone},
        "address": address,
        "address_text": ", ".join(v for v in address.values() if v),
        "items": [{k: i[k] for k in ("id", "name", "price", "image", "href", "color", "size", "qty")}
                  for i in items],
        "totals": totals,
        "promo": {"code": promo["code"], "percent": promo["percent"]} if promo else None,
        "delivery": {"key": delivery.get("key"), "label": delivery.get("label"),
                     "fee": totals["shipping"], "days": delivery.get("days", 5)},
        "payment": {"method": payment, "status": "paid (simulated)"},
        "status": "placed",
        "history": [{"status": "placed", "at": created}],
        "created_at": created,
        "eta": created + timedelta(days=int(delivery.get("days", 5))),
    }
    get_db().orders.insert_one(order)
    if promo:
        get_db().promo_codes.update_one({"_id": promo["_id"]}, {"$inc": {"uses": 1}})

    save_cart(owner, [], None, keep_promo=False)

    if user and data.get("saveAddress"):
        add_address(user, dict(address, label=address["city"]))
    if not user:  # let this browser open its own confirmation page
        mine = session.get("guest_orders", [])
        session["guest_orders"] = (mine + [order_id])[-GUEST_ORDER_MEMORY:]

    return ok({"order": public_order(order)}, 201)


@bp.get("")
@login_required
def my_orders(user):
    cursor = get_db().orders.find({"user_id": user["_id"]}).sort("created_at", -1).limit(100)
    return ok({"orders": [public_order(o) for o in cursor]})


@bp.get("/<order_id>")
def get_order(order_id):
    order = get_db().orders.find_one({"_id": order_id})
    user = current_user()
    allowed = order and (
        (user and (order.get("user_id") == user["_id"] or user.get("role") == "admin"))
        or order_id in session.get("guest_orders", [])
    )
    if not allowed:
        raise ApiError(404, "not_found", "Order not found")
    return ok({"order": public_order(order)})


@bp.post("/<order_id>/cancel")
@login_required
def cancel_order(user, order_id):
    """Customers can cancel their own order until it is packed."""
    order = get_db().orders.find_one({"_id": order_id, "user_id": user["_id"]})
    if not order:
        raise ApiError(404, "not_found", "Order not found")
    if order.get("status") != "placed":
        raise ApiError(400, "too_late", "This order can no longer be cancelled")
    set_status(order, "cancelled")
    return ok({"order": public_order(get_db().orders.find_one({"_id": order_id}))})


def set_status(order, status):
    if status not in STATUSES:
        raise ApiError(400, "invalid", "Unknown status")
    if order.get("status") == status:
        return
    if order.get("status") == "cancelled":
        raise ApiError(400, "invalid", "A cancelled order cannot be changed")
    if status == "cancelled":
        release_stock(order)
    get_db().orders.update_one({"_id": order["_id"]}, {
        "$set": {"status": status, "updated_at": now()},
        "$push": {"history": {"status": status, "at": now()}},
    })

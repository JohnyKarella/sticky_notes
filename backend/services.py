"""Business rules shared by several routes: products, cart lines, totals and promo codes.

Prices always come from the products collection, never from the browser.
"""
from datetime import timedelta, timezone

from db import get_db, get_settings
from utils import ApiError, now

MAX_QTY = 99
GUEST_TTL = timedelta(days=60)


# ---------------------------------------------------------------- products

def stock_status(product):
    return "in" if product.get("active", True) and product.get("stock_qty", 0) > 0 else "out"


def public_product(p, full=False):
    data = {
        "id": p["_id"],
        "name": p.get("name", ""),
        "price": p.get("price", 0),
        "compareAt": p.get("compare_at"),
        "image": p.get("image", ""),
        "href": p.get("href") or f"product.html?id={p['_id']}",
        "collection": p.get("collection", ""),
        "colors": p.get("colors", []),
        "sizes": p.get("sizes", []),
        "shape": p.get("shape", ""),
        "stock": stock_status(p),
        "stockQty": max(0, p.get("stock_qty", 0)),
        "rating": p.get("rating"),
        "reviewCount": p.get("review_count", 0),
        "sold": p.get("sold", 0),
        "badge": p.get("badge", ""),
    }
    if full:
        data.update({
            "images": p.get("images", []),
            "description": p.get("description", ""),
            "active": p.get("active", True),
        })
    return data


def products_by_id(ids):
    ids = list({i for i in ids if isinstance(i, str)})
    if not ids:
        return {}
    return {p["_id"]: p for p in get_db().products.find({"_id": {"$in": ids}})}


def pick_option(value, options):
    """Use the chosen colour/size if the product has it, otherwise its first option."""
    value = (value or "").strip()
    if value in options:
        return value
    return options[0] if options else ""


def clean_lines(raw_items, merge=True):
    """Turn what the browser sent into safe cart lines: known products only,
    valid colour/size, quantity 1..99 and never more than the stock."""
    if not isinstance(raw_items, list):
        raise ApiError(400, "invalid", "items must be a list")
    raw_items = raw_items[:100]
    products = products_by_id([i.get("id") for i in raw_items if isinstance(i, dict)])
    lines, order = {}, []
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        p = products.get(raw.get("id"))
        if not p or not p.get("active", True):
            continue
        color = pick_option(raw.get("color"), p.get("colors", []))
        size = pick_option(raw.get("size"), p.get("sizes", []))
        try:
            qty = int(raw.get("qty", 1))
        except (TypeError, ValueError):
            qty = 1
        key = "|".join([p["_id"], color, size])
        if key in lines:
            qty = lines[key]["qty"] + qty if merge else qty
        else:
            order.append(key)
        lines[key] = {"key": key, "id": p["_id"], "color": color, "size": size,
                      "qty": max(1, min(MAX_QTY, qty))}
    return [lines[k] for k in order]


def expand_lines(lines):
    """Add name, price, photo and stock from the database to stored cart lines."""
    products = products_by_id([l["id"] for l in lines])
    out = []
    for l in lines:
        p = products.get(l["id"])
        if not p:
            continue
        out.append({
            "key": l["key"], "id": p["_id"], "name": p.get("name", ""), "price": p.get("price", 0),
            "image": p.get("image", ""), "href": p.get("href") or f"product.html?id={p['_id']}",
            "color": l.get("color", ""), "size": l.get("size", ""), "qty": l["qty"],
            "stock": stock_status(p), "stockQty": max(0, p.get("stock_qty", 0)),
        })
    return out


# ---------------------------------------------------------------- promo codes

def find_promo(code):
    code = (code or "").strip().upper()
    if not code:
        return None
    promo = get_db().promo_codes.find_one({"code": code, "active": True})
    if not promo:
        return None
    expires = promo.get("expires_at")
    if expires is not None:
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < now():
            return None
    return promo


# ---------------------------------------------------------------- totals

def delivery_option(settings, key):
    options = settings.get("delivery_options", [])
    for o in options:
        if o.get("key") == key:
            return o
    return options[0] if options else {"key": "standard", "label": "Standard delivery", "fee": "auto", "days": 5}


def compute_totals(items, percent=0, delivery=None, settings=None):
    """Same rules as the shop pages: discount on the subtotal, free shipping over
    the threshold for 'auto' delivery, fixed fee for other delivery options."""
    settings = settings or get_settings()
    subtotal = sum(i["price"] * i["qty"] for i in items)
    count = sum(i["qty"] for i in items)
    discount = round(subtotal * (percent or 0) / 100)
    free_over = settings.get("free_shipping_over", 0)
    shipping = 0
    if items:
        fee = (delivery or {}).get("fee", "auto")
        if fee == "auto" or fee is None:
            shipping = 0 if subtotal >= free_over else settings.get("shipping_fee", 0)
        else:
            shipping = int(fee)
    return {
        "subtotal": subtotal, "count": count, "discount": discount, "shipping": shipping,
        "total": subtotal - discount + shipping,
        "remaining": max(0, free_over - subtotal),
    }


# ---------------------------------------------------------------- cart / wishlist documents

def load_cart(owner):
    return get_db().carts.find_one({"owner": owner}) or {"owner": owner, "items": [], "promo_code": None}


def save_cart(owner, items, promo_code=None, keep_promo=True):
    update = {"items": items, "updated_at": now()}
    if not keep_promo:
        update["promo_code"] = promo_code
    update["expires_at"] = (now() + GUEST_TTL) if owner.startswith("g:") else None
    get_db().carts.update_one({"owner": owner}, {"$set": update, "$setOnInsert": {"created_at": now()}},
                              upsert=True)


def cart_payload(owner, delivery_key=None):
    cart = load_cart(owner)
    items = expand_lines(cart.get("items", []))
    promo = find_promo(cart.get("promo_code")) if cart.get("promo_code") else None
    settings = get_settings()
    delivery = delivery_option(settings, delivery_key) if delivery_key else None
    percent = promo["percent"] if promo else 0
    return {
        "items": items,
        "promo": {"code": promo["code"], "percent": promo["percent"]} if promo else None,
        "totals": compute_totals(items, percent, delivery, settings),
    }


def load_wishlist(owner):
    return get_db().wishlists.find_one({"owner": owner}) or {"owner": owner, "items": []}


def save_wishlist(owner, items):
    get_db().wishlists.update_one(
        {"owner": owner},
        {"$set": {"items": items, "updated_at": now(),
                  "expires_at": (now() + GUEST_TTL) if owner.startswith("g:") else None}},
        upsert=True)


def clean_wish_items(raw_items):
    if not isinstance(raw_items, list):
        raise ApiError(400, "invalid", "items must be a list")
    products = products_by_id([i.get("id") for i in raw_items[:200] if isinstance(i, dict)])
    seen, out = set(), []
    for raw in raw_items[:200]:
        if not isinstance(raw, dict):
            continue
        p = products.get(raw.get("id"))
        if not p or p["_id"] in seen:
            continue
        seen.add(p["_id"])
        out.append({"id": p["_id"], "color": pick_option(raw.get("color"), p.get("colors", [])),
                    "size": pick_option(raw.get("size"), p.get("sizes", [])),
                    "added_at": raw.get("added_at") or now()})
    return out


def wishlist_payload(owner):
    items = load_wishlist(owner).get("items", [])
    products = products_by_id([i["id"] for i in items])
    out = []
    for i in items:
        p = products.get(i["id"])
        if not p:
            continue
        out.append({"id": p["_id"], "name": p.get("name", ""), "price": p.get("price", 0),
                    "image": p.get("image", ""), "href": p.get("href") or f"product.html?id={p['_id']}",
                    "color": i.get("color", ""), "size": i.get("size", ""), "stock": stock_status(p)})
    return {"items": out}


def merge_guest_into_user(guest_owner, user_owner):
    """When a guest signs in, their cart and wishlist join the account's."""
    db = get_db()
    guest_cart = db.carts.find_one({"owner": guest_owner})
    if guest_cart and guest_cart.get("items"):
        user_cart = load_cart(user_owner)
        merged = clean_lines(user_cart.get("items", []) + guest_cart["items"], merge=True)
        save_cart(user_owner, merged)
        if guest_cart.get("promo_code") and not user_cart.get("promo_code"):
            db.carts.update_one({"owner": user_owner}, {"$set": {"promo_code": guest_cart["promo_code"]}})
    db.carts.delete_one({"owner": guest_owner})

    guest_wish = db.wishlists.find_one({"owner": guest_owner})
    if guest_wish and guest_wish.get("items"):
        user_wish = load_wishlist(user_owner)
        save_wishlist(user_owner, clean_wish_items(user_wish.get("items", []) + guest_wish["items"]))
    db.wishlists.delete_one({"owner": guest_owner})

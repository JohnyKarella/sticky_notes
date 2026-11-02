"""Cart, promo codes and wishlist. Work for guests (by browser) and signed-in users."""
from flask import Blueprint, request

from db import get_db
from services import (cart_payload, clean_lines, clean_wish_items, find_promo, load_cart,
                      load_wishlist, save_cart, save_wishlist, wishlist_payload)
from utils import ApiError, body, now, ok, owner_key

bp = Blueprint("cart", __name__, url_prefix="/api")


# ---------------------------------------------------------------- cart

@bp.get("/cart")
def get_cart():
    return ok(cart_payload(owner_key(), request.args.get("delivery")))


@bp.put("/cart")
def replace_cart():
    """The pages send the whole cart after each change: [{id, color, size, qty}]."""
    data = body()
    owner = owner_key()
    save_cart(owner, clean_lines(data.get("items", []), merge=True))
    return ok(cart_payload(owner, data.get("delivery")))


@bp.post("/cart/items")
def add_item():
    data = body()
    owner = owner_key()
    items = load_cart(owner).get("items", [])
    save_cart(owner, clean_lines(items + [data], merge=True))
    return ok(cart_payload(owner), 201)


@bp.patch("/cart/items/<path:key>")
def set_item_qty(key):
    owner = owner_key()
    items = load_cart(owner).get("items", [])
    qty = body().get("qty", 1)
    for item in items:
        if item["key"] == key:
            item["qty"] = qty
    save_cart(owner, clean_lines(items, merge=False))
    return ok(cart_payload(owner))


@bp.delete("/cart/items/<path:key>")
def remove_item(key):
    owner = owner_key()
    items = [i for i in load_cart(owner).get("items", []) if i["key"] != key]
    save_cart(owner, items)
    return ok(cart_payload(owner))


@bp.delete("/cart")
def clear_cart():
    owner = owner_key()
    save_cart(owner, [], None, keep_promo=False)
    return ok(cart_payload(owner))


@bp.post("/cart/promo")
def apply_promo():
    owner = owner_key()
    promo = find_promo(body().get("code"))
    if not promo:
        get_db().carts.update_one({"owner": owner}, {"$set": {"promo_code": None}})
        raise ApiError(400, "bad_promo", "This code is not valid", cart=cart_payload(owner))
    get_db().carts.update_one({"owner": owner},
                              {"$set": {"promo_code": promo["code"], "updated_at": now()},
                               "$setOnInsert": {"items": [], "created_at": now()}}, upsert=True)
    return ok(cart_payload(owner))


@bp.delete("/cart/promo")
def remove_promo():
    owner = owner_key()
    get_db().carts.update_one({"owner": owner}, {"$set": {"promo_code": None}})
    return ok(cart_payload(owner))


# ---------------------------------------------------------------- wishlist

@bp.get("/wishlist")
def get_wishlist():
    return ok(wishlist_payload(owner_key()))


@bp.put("/wishlist")
def replace_wishlist():
    owner = owner_key()
    save_wishlist(owner, clean_wish_items(body().get("items", [])))
    return ok(wishlist_payload(owner))


@bp.post("/wishlist/<product_id>")
def add_wish(product_id):
    owner = owner_key()
    data = body()
    items = load_wishlist(owner).get("items", [])
    save_wishlist(owner, clean_wish_items(items + [{"id": product_id, "color": data.get("color"),
                                                    "size": data.get("size")}]))
    return ok(wishlist_payload(owner), 201)


@bp.delete("/wishlist/<product_id>")
def remove_wish(product_id):
    owner = owner_key()
    items = [i for i in load_wishlist(owner).get("items", []) if i["id"] != product_id]
    save_wishlist(owner, items)
    return ok(wishlist_payload(owner))

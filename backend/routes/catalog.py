"""Products, live price/stock, store settings and reviews."""
import re

from flask import Blueprint, request
from pymongo import DESCENDING
from pymongo.errors import DuplicateKeyError

from db import get_db, get_settings
from services import public_product
from utils import ApiError, body, current_user, iso, login_required, now, ok, text

bp = Blueprint("catalog", __name__, url_prefix="/api")

SORTS = {
    "featured": [("position", 1)],
    "newest": [("added", -1)],
    "price-asc": [("price", 1)],
    "price-desc": [("price", -1)],
    "selling": [("sold", -1)],
    "rating": [("rating", -1)],
}


@bp.get("/products")
def list_products():
    """Same filters as shop.html: ?q= &collection= &color= &size= &shape= &max= &stock=in &sort="""
    args = request.args
    query = {"active": {"$ne": False}}
    if args.get("q"):
        rx = {"$regex": re.escape(args["q"].strip()[:60]), "$options": "i"}
        query["$or"] = [{"name": rx}, {"collection": rx}, {"shape": rx}, {"colors": rx}, {"keywords": rx}]
    for field, key in (("collection", "collection"), ("shape", "shape")):
        values = args.getlist(key)
        if values:
            query[field] = {"$in": values}
    for field, key in (("colors", "color"), ("sizes", "size")):
        values = args.getlist(key)
        if values:
            query[field] = {"$in": values}
    if args.get("max"):
        try:
            query["price"] = {"$lte": float(args["max"])}
        except ValueError:
            pass
    if args.get("stock") == "in":
        query["stock_qty"] = {"$gt": 0}
    cursor = get_db().products.find(query).sort(SORTS.get(args.get("sort"), SORTS["featured"]))
    items = [public_product(p) for p in cursor]
    return ok({"count": len(items), "items": items})


@bp.get("/products/status")
def products_status():
    """Small id -> {price, stock} map the pages use to show live price and stock."""
    out = {}
    for p in get_db().products.find({}, {"price": 1, "compare_at": 1, "stock_qty": 1, "active": 1}):
        out[p["_id"]] = {"price": p.get("price", 0), "compareAt": p.get("compare_at"),
                         "stock": "in" if p.get("active", True) and p.get("stock_qty", 0) > 0 else "out"}
    return ok({"products": out})


@bp.get("/products/<product_id>")
def get_product(product_id):
    p = get_db().products.find_one({"_id": product_id})
    if not p or p.get("active") is False:
        raise ApiError(404, "not_found", "Product not found")
    return ok({"product": public_product(p, full=True)})


@bp.get("/settings")
def store_settings():
    s = get_settings()
    return ok({"settings": {
        "brand": s["brand"], "currency": s["currency"], "freeShippingOver": s["free_shipping_over"],
        "shippingFee": s["shipping_fee"], "deliveryOptions": s["delivery_options"],
        "paymentMethods": s["payment_methods"],
    }})


# ---------------------------------------------------------------- reviews

def public_review(r, user=None):
    return {
        "id": str(r["_id"]), "productId": r["product_id"], "name": r.get("name", ""),
        "rating": r.get("rating", 0), "title": r.get("title", ""), "body": r.get("body", ""),
        "verified": bool(r.get("verified")), "date": iso(r.get("created_at")),
        "mine": bool(user and r.get("user_id") == user["_id"]),
    }


def refresh_rating(product_id):
    """Keep the product's average rating and review count in step with the reviews."""
    reviews = list(get_db().reviews.find({"product_id": product_id, "hidden": {"$ne": True}}, {"rating": 1}))
    if not reviews:
        return
    avg = round(sum(r["rating"] for r in reviews) / len(reviews), 1)
    get_db().products.update_one({"_id": product_id},
                                 {"$set": {"rating": avg, "customer_review_count": len(reviews)}})


@bp.get("/products/<product_id>/reviews")
def list_reviews(product_id):
    user = current_user()
    cursor = get_db().reviews.find({"product_id": product_id, "hidden": {"$ne": True}}).sort(
        "created_at", DESCENDING).limit(50)
    return ok({"reviews": [public_review(r, user) for r in cursor]})


@bp.post("/products/<product_id>/reviews")
@login_required
def create_review(user, product_id):
    if not get_db().products.find_one({"_id": product_id}):
        raise ApiError(404, "not_found", "Product not found")
    data = body()
    try:
        rating = int(data.get("rating"))
    except (TypeError, ValueError):
        rating = 0
    if not 1 <= rating <= 5:
        raise ApiError(400, "invalid", "Please choose a rating from 1 to 5", field="rating")
    review = {
        "product_id": product_id, "user_id": user["_id"],
        "name": user.get("name", "").split(" ")[0] or "Customer",
        "rating": rating,
        "title": text(data, "title", 80, required=True, label="Title"),
        "body": text(data, "body", 1000, required=True, label="Review"),
        "verified": bool(get_db().orders.find_one({"user_id": user["_id"], "items.id": product_id})),
        "created_at": now(),
    }
    try:
        review["_id"] = get_db().reviews.insert_one(review).inserted_id
    except DuplicateKeyError:
        raise ApiError(409, "already_reviewed", "You have already reviewed this product")
    refresh_rating(product_id)
    return ok({"review": public_review(review, user)}, 201)

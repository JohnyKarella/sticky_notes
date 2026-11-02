"""MongoDB connection and indexes.

Collections
-----------
users        customers and admins (password hashes, saved addresses)
products     the 20 sticky-note products (price, stock, photos...)
carts        one cart per signed-in user or guest browser
wishlists    one wishlist per signed-in user or guest browser
orders       placed orders with items, totals, address and status history
promo_codes  discount codes such as STICKY10
reviews      customer reviews per product
newsletter   newsletter subscribers
login_events every sign-up, sign-in, failed sign-in and admin login (shown in the admin panel)
settings     store settings (shipping fee, free-shipping threshold, delivery options...)
counters     running numbers (order numbers)
"""
from flask import current_app
from pymongo import ASCENDING, DESCENDING, MongoClient, ReturnDocument


def init_db(app, client=None):
    """Connect to MongoDB. Tests pass a mongomock client instead of a real one."""
    if client is None:
        mongo_uri = app.config["MONGO_URI"]
        if not mongo_uri.startswith("mongodb+srv://"):
            raise RuntimeError(
                "MONGO_URI must be a MongoDB Atlas SRV connection string. "
                "Set it in backend/.env."
            )
        client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000, tz_aware=True)
    db = client[app.config["MONGO_DB"]]
    app.extensions["mongo_client"] = client
    app.extensions["mongo_db"] = db
    ensure_indexes(db)
    return db


def get_db():
    return current_app.extensions["mongo_db"]


def ensure_indexes(db):
    db.users.create_index([("email", ASCENDING)], unique=True)
    db.users.create_index([("username", ASCENDING)], unique=True, sparse=True)
    db.login_events.create_index([("at", DESCENDING)])
    db.login_events.create_index([("user_id", ASCENDING), ("at", DESCENDING)])
    db.carts.create_index([("owner", ASCENDING)], unique=True)
    db.wishlists.create_index([("owner", ASCENDING)], unique=True)
    # guest carts / wishlists disappear 60 days after their last change
    db.carts.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0)
    db.wishlists.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0)
    db.orders.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    db.orders.create_index([("customer.email", ASCENDING)])
    db.orders.create_index([("status", ASCENDING)])
    db.products.create_index([("collection", ASCENDING)])
    db.promo_codes.create_index([("code", ASCENDING)], unique=True)
    db.reviews.create_index([("product_id", ASCENDING), ("created_at", DESCENDING)])
    db.reviews.create_index([("product_id", ASCENDING), ("user_id", ASCENDING)], unique=True)
    db.newsletter.create_index([("email", ASCENDING)], unique=True)


def next_sequence(name):
    """Atomic counter, used for order numbers."""
    doc = get_db().counters.find_one_and_update(
        {"_id": name}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER)
    return doc["seq"]


DEFAULT_SETTINGS = {
    "_id": "store",
    "brand": "Notera",
    "currency": "₹",
    "free_shipping_over": 499,
    "shipping_fee": 49,
    "order_prefix": "PL-",
    "delivery_options": [
        {"key": "standard", "label": "Standard delivery", "fee": "auto", "days": 5},
        {"key": "express", "label": "Express delivery", "fee": 99, "days": 2},
    ],
    "payment_methods": ["Credit card", "Debit card", "UPI", "Net banking", "Wallet"],
}


def get_settings():
    doc = get_db().settings.find_one({"_id": "store"})
    if not doc:
        return dict(DEFAULT_SETTINGS)
    merged = dict(DEFAULT_SETTINGS)
    merged.update(doc)
    return merged

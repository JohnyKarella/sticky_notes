"""Fill MongoDB from the website's HTML.

The HTML stays the place where products, prices, delivery options and the promo
code are written. This script reads them and saves them to MongoDB, so the
backend checks prices and stock against the same values the pages show.

    python seed.py                 # add / update products, settings, promo code, admin user
    python seed.py --reset-stock   # also set every product's stock back to DEFAULT_STOCK
    python seed.py --reset-admin   # set the admin username/password again from .env

Run it again whenever you change a product, price or setting in the HTML.
Stock, units sold and orders are kept unless you pass --reset-stock.
"""
import argparse
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup
from werkzeug.security import generate_password_hash

from config import Config
from db import DEFAULT_SETTINGS
from utils import now


def number(value, default=0):
    match = re.search(r"\d+(?:\.\d+)?", str(value or "").replace(",", ""))
    if not match:
        return default
    n = float(match.group())
    return int(n) if n.is_integer() else n


def split(value):
    return [v.strip() for v in (value or "").split(",") if v.strip()]


def soup(frontend, name):
    path = Path(frontend) / name
    if not path.exists():
        sys.exit(f"Cannot find {path}. Set FRONTEND_DIR in backend/.env")
    return BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser")


def read_products(frontend):
    """Products from product.html (details) and shop.html (order, badges, keywords)."""
    shop = soup(frontend, "shop.html")
    cards = {}
    for pos, card in enumerate(shop.select("[data-grid] [data-product]")):
        badge = card.select_one(".card__badge")
        cards[card["data-id"]] = {"position": pos, "badge": badge.get_text(strip=True) if badge else "",
                                  "keywords": card.get("data-keywords", "")}

    products = []
    for pdp in soup(frontend, "product.html").select("article.pdp[data-id]"):
        d = pdp.attrs
        pid = d["data-id"]
        price_el = pdp.select_one(".pdp__price")
        was = price_el.select_one("s") if price_el else None
        lede = pdp.select_one(".lede")
        review_count = pdp.select_one(".pdp__rating span:not(.rating)")
        images = [img["src"] for img in pdp.select(".gallery__thumbs img") if img.get("src")]
        card = cards.get(pid, {})
        products.append({
            "_id": pid,
            "name": d.get("data-name", "").strip(),
            "price": number(d.get("data-price")),
            "compare_at": number(was.get_text(), None) if was else None,
            "image": d.get("data-image", ""),
            "images": images or [d.get("data-image", "")],
            "href": d.get("data-href") or f"product.html?id={pid}",
            "collection": d.get("data-collection", ""),
            "colors": split(d.get("data-colors")),
            "sizes": split(d.get("data-sizes")),
            "shape": d.get("data-shape", ""),
            "rating": number(d.get("data-rating"), None),
            "review_count": number(review_count.get_text(), 0) if review_count else 0,
            "added": number(d.get("data-added")),
            "description": lede.get_text(" ", strip=True) if lede else "",
            "badge": card.get("badge", ""),
            "keywords": card.get("keywords", ""),
            "position": card.get("position", 1000 + len(products)),
            "_html_stock": d.get("data-stock", "in"),
            "_html_sold": number(d.get("data-sold")),
        })
    return products


def read_settings(frontend):
    settings = dict(DEFAULT_SETTINGS)
    index = soup(frontend, "index.html")
    body, html = index.body, index.html
    settings.update({
        "brand": body.get("data-brand", settings["brand"]),
        "currency": html.get("data-currency", settings["currency"]),
        "free_shipping_over": number(body.get("data-free-shipping-over"), settings["free_shipping_over"]),
        "shipping_fee": number(body.get("data-shipping-fee"), settings["shipping_fee"]),
        "order_prefix": body.get("data-order-prefix", settings["order_prefix"]),
    })
    checkout = soup(frontend, "checkout.html")
    delivery = []
    for r in checkout.select('input[name="delivery"]'):
        fee = r.get("data-fee", "auto")
        delivery.append({"key": r.get("value"), "label": r.get("data-label", r.get("value")),
                         "fee": "auto" if fee == "auto" else number(fee), "days": number(r.get("data-days"), 5)})
    if delivery:
        settings["delivery_options"] = delivery
    payments = [r.get("data-label") for r in checkout.select('input[name="payment"]') if r.get("data-label")]
    if payments:
        settings["payment_methods"] = payments
    return settings


def read_promos(frontend):
    promos = []
    for form in soup(frontend, "cart.html").select("[data-promo]"):
        if form.get("data-code"):
            promos.append({"code": form["data-code"].strip().upper(), "percent": number(form.get("data-percent"), 10)})
    return promos


def seed(db, frontend, config=Config, reset_stock=False, reset_admin=False, quiet=False):
    say = (lambda *a: None) if quiet else print
    cfg = (lambda k: config[k]) if isinstance(config, dict) else (lambda k: getattr(config, k))

    products = read_products(frontend)
    for p in products:
        html_stock, html_sold = p.pop("_html_stock"), p.pop("_html_sold")
        default_qty = cfg('DEFAULT_STOCK') if html_stock == "in" else 0
        update = {"$set": dict(p, updated_at=now()),
                  "$setOnInsert": {"created_at": now(), "active": True}}
        if reset_stock:
            update["$set"].update(stock_qty=default_qty, sold=html_sold)
        else:
            update["$setOnInsert"].update(stock_qty=default_qty, sold=html_sold)
        db.products.update_one({"_id": p["_id"]}, update, upsert=True)
    say(f"Products: {len(products)} saved")

    settings = read_settings(frontend)
    db.settings.replace_one({"_id": "store"}, settings, upsert=True)
    say(f"Settings: free shipping over {settings['free_shipping_over']}, fee {settings['shipping_fee']}, "
        f"{len(settings['delivery_options'])} delivery options, {len(settings['payment_methods'])} payment methods")

    for promo in read_promos(frontend):
        db.promo_codes.update_one({"code": promo["code"]},
                                  {"$set": {"percent": promo["percent"], "active": True},
                                   "$setOnInsert": {"uses": 0, "created_at": now()}}, upsert=True)
        say(f"Promo code: {promo['code']} ({promo['percent']}% off)")

    # Admin panel login: username + password from .env
    username = cfg('ADMIN_USERNAME').strip().lower()
    email = cfg('ADMIN_EMAIL').strip().lower()
    admin = db.users.find_one({"role": "admin", "username": {"$exists": True}}) or \
        db.users.find_one({"$or": [{"username": username}, {"email": email}]})
    if not admin:
        db.users.insert_one({
            "name": cfg('ADMIN_NAME'), "username": username, "email": email, "phone": "",
            "password_hash": generate_password_hash(cfg('ADMIN_PASSWORD')),
            "role": "admin", "addresses": [], "active": True, "created_at": now(), "login_count": 0,
        })
        say(f"Admin created  ->  username: {username}   password: (ADMIN_PASSWORD in .env)")
    elif reset_admin or not admin.get("username"):
        db.users.update_one({"_id": admin["_id"]}, {"$set": {
            "username": username, "email": email, "role": "admin", "active": True,
            "password_hash": generate_password_hash(cfg('ADMIN_PASSWORD')), "updated_at": now()}})
        say(f"Admin updated  ->  username: {username}   password: (ADMIN_PASSWORD in .env)")
    else:
        say(f"Admin exists   ->  username: {admin['username']}  (run 'python seed.py --reset-admin' "
            f"to apply a new username/password from .env)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Load products and settings from the HTML into MongoDB")
    parser.add_argument("--reset-stock", action="store_true", help="set every product's stock back to DEFAULT_STOCK")
    parser.add_argument("--reset-admin", action="store_true", help="set the admin username and password from .env")
    args = parser.parse_args()

    from pymongo import MongoClient
    from db import ensure_indexes

    if not Config.MONGO_URI.startswith("mongodb+srv://"):
        sys.exit("MONGO_URI must be a MongoDB Atlas SRV connection string. Set it in backend/.env.")

    client = MongoClient(Config.MONGO_URI, serverSelectionTimeoutMS=5000)
    try:
        client.admin.command("ping")
    except Exception as exc:  # noqa: BLE001
        sys.exit(f"Cannot reach the MongoDB Atlas cluster. Check MONGO_URI and Atlas network access.\n{exc}")
    database = client[Config.MONGO_DB]
    ensure_indexes(database)
    seed(database, Config.FRONTEND_DIR, reset_stock=args.reset_stock, reset_admin=args.reset_admin)
    print(f"Done. Database: {Config.MONGO_DB}")

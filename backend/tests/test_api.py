"""API tests. They use mongomock (an in-memory MongoDB), so no database server is needed:

    pip install -r requirements-dev.txt
    pytest -q
"""
import sys
from pathlib import Path

import mongomock
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import create_app  # noqa: E402
from db import init_db  # noqa: E402

H = {"X-Requested-With": "fetch"}


@pytest.mark.parametrize("mongo_uri", ["", "mongodb://localhost:27017"])
def test_database_requires_atlas_uri(mongo_uri):
    from flask import Flask

    app = Flask(__name__)
    app.config.update({"MONGO_URI": mongo_uri, "MONGO_DB": "notera_test"})

    with pytest.raises(RuntimeError, match="MongoDB Atlas"):
        init_db(app)


@pytest.fixture()
def app():
    return create_app({"TESTING": True, "MONGO_DB": "notera_test", "ADMIN_PASSWORD": "AdminPass1",
                       "PUBLIC_BASE_URL": "https://notera.example", "SMTP_HOST": "smtp.example",
                       "SMTP_FROM": "noreply@notera.example"},
                      mongo_client=mongomock.MongoClient(tz_aware=True))


@pytest.fixture()
def client(app):
    return app.test_client()


def post(c, url, json=None):
    return c.post(url, json=json or {}, headers=H)


def put(c, url, json=None):
    return c.put(url, json=json or {}, headers=H)


CHECKOUT = {"firstName": "Asha", "lastName": "Rao", "email": "asha@example.com", "phone": "9876543210",
            "address": "12 MG Road", "city": "Bengaluru", "state": "Karnataka", "pin": "560001",
            "country": "India", "delivery": "standard", "payment": "UPI"}


def test_products_seeded_from_html(client):
    res = client.get("/api/products").get_json()
    assert res["count"] == 20  # sold-out products are listed too
    assert client.get("/api/products?stock=in").get_json()["count"] == 19
    assert client.get("/api/products/status").get_json()["products"]["p12"]["stock"] == "out"
    assert client.get("/api/products/p01").get_json()["product"]["price"] == 199


def test_csrf_header_required(client):
    assert client.put("/api/cart", json={"items": []}).status_code == 403


def test_cart_uses_database_prices(client):
    res = put(client, "/api/cart", {"items": [{"id": "p01", "qty": 2, "price": 1}, {"id": "nope", "qty": 1}]}).get_json()
    assert len(res["items"]) == 1
    assert res["items"][0]["price"] == 199
    assert res["totals"]["subtotal"] == 398
    assert res["totals"]["shipping"] == 49  # under the 499 free-shipping line


def test_promo_and_free_shipping(client):
    put(client, "/api/cart", {"items": [{"id": "p01", "qty": 3}]})
    assert post(client, "/api/cart/promo", {"code": "nope"}).status_code == 400
    res = post(client, "/api/cart/promo", {"code": "sticky10"}).get_json()
    assert res["promo"]["percent"] == 10
    assert res["totals"]["discount"] == 60 and res["totals"]["shipping"] == 0


def test_signup_signin_merges_guest_cart(client):
    put(client, "/api/cart", {"items": [{"id": "p02", "qty": 1}]})
    put(client, "/api/wishlist", {"items": [{"id": "p03"}]})
    res = post(client, "/api/auth/signup", {"name": "Asha Rao", "email": "Asha@Example.com",
                                            "phone": "9876543210", "password": "secret123"})
    assert res.status_code == 201
    body = res.get_json()
    assert body["user"]["email"] == "asha@example.com"
    assert [i["id"] for i in body["cart"]["items"]] == ["p02"]
    assert [i["id"] for i in body["wishlist"]["items"]] == ["p03"]
    assert post(client, "/api/auth/signup", {"name": "X", "email": "asha@example.com",
                                             "password": "secret123"}).status_code == 409
    post(client, "/api/auth/signout")
    assert client.get("/api/auth/me").get_json()["user"] is None
    assert client.get("/api/cart").get_json()["items"] == []
    assert post(client, "/api/auth/signin", {"email": "asha@example.com", "password": "wrong"}).status_code == 401
    res = post(client, "/api/auth/signin", {"email": "asha@example.com", "password": "secret123"}).get_json()
    assert res["cart"]["items"][0]["id"] == "p02"


def test_guest_checkout_reduces_stock_and_clears_cart(client, app):
    db = app.extensions["mongo_db"]
    put(client, "/api/cart", {"items": [{"id": "p01", "qty": 2, "color": "Mint"}]})
    res = post(client, "/api/orders", CHECKOUT)
    assert res.status_code == 201, res.get_json()
    order = res.get_json()["order"]
    assert order["id"].startswith("PL-")
    assert order["items"][0]["color"] == "Mint"
    assert order["totals"]["total"] == 398 + 49
    assert db.products.find_one({"_id": "p01"})["stock_qty"] == 98
    assert client.get("/api/cart").get_json()["items"] == []
    assert client.get(f"/api/orders/{order['id']}").status_code == 200
    # another browser cannot read it
    assert app.test_client().get(f"/api/orders/{order['id']}").status_code == 404


def test_checkout_rejects_bad_input_and_stock(client, app):
    assert post(client, "/api/orders", CHECKOUT).status_code == 400  # empty cart
    put(client, "/api/cart", {"items": [{"id": "p01", "qty": 1}]})
    assert post(client, "/api/orders", dict(CHECKOUT, pin="12")).status_code == 400
    assert post(client, "/api/orders", dict(CHECKOUT, payment="Bitcoin")).status_code == 400
    app.extensions["mongo_db"].products.update_one({"_id": "p01"}, {"$set": {"stock_qty": 0}})
    res = post(client, "/api/orders", CHECKOUT)
    assert res.status_code == 409 and res.get_json()["productId"] == "p01"


def test_account_orders_addresses_and_admin(client, app):
    post(client, "/api/auth/signup", {"name": "Asha Rao", "email": "asha@example.com", "password": "secret123"})
    put(client, "/api/cart", {"items": [{"id": "p04", "qty": 1}]})
    order = post(client, "/api/orders", dict(CHECKOUT, delivery="express", saveAddress=True)).get_json()["order"]
    assert order["totals"]["shipping"] == 99
    assert client.get("/api/orders").get_json()["orders"][0]["id"] == order["id"]
    me = client.get("/api/auth/me").get_json()["user"]
    assert me["addresses"][0]["pin"] == "560001"
    res = put(client, "/api/account/profile", {"name": "Asha R", "phone": "9999999999"}).get_json()
    assert res["user"]["name"] == "Asha R"
    assert client.get("/api/admin/orders").status_code == 403

    admin = app.test_client()
    assert post(admin, "/api/admin/login", {"username": "admin", "password": "AdminPass1"}).status_code == 200
    assert admin.get("/api/admin/stats").get_json()["orders"] == 1
    res = admin.patch(f"/api/admin/orders/{order['id']}", json={"status": "cancelled"}, headers=H)
    assert res.get_json()["order"]["status"] == "cancelled"
    assert app.extensions["mongo_db"].products.find_one({"_id": "p04"})["stock_qty"] == 100
    res = admin.patch("/api/admin/products/p12", json={"stockQty": 5, "price": 250}, headers=H)
    assert res.get_json()["product"]["stock"] == "in"
    assert post(admin, "/api/admin/promos", {"code": "DIWALI20", "percent": 20}).status_code == 201


def test_reviews_and_newsletter(client):
    assert post(client, "/api/products/p01/reviews", {"rating": 5}).status_code == 401
    post(client, "/api/auth/signup", {"name": "Asha Rao", "email": "asha@example.com", "password": "secret123"})
    res = post(client, "/api/products/p01/reviews", {"rating": 5, "title": "Great", "body": "Sticks well"})
    assert res.status_code == 201
    assert post(client, "/api/products/p01/reviews", {"rating": 4, "title": "Again", "body": "x"}).status_code == 409
    assert client.get("/api/products/p01/reviews").get_json()["reviews"][0]["mine"] is True
    assert post(client, "/api/newsletter", {"email": "bad"}).status_code == 400
    assert post(client, "/api/newsletter", {"email": "a@b.co"}).status_code == 201


def test_serves_frontend(client):
    assert client.get("/").status_code == 200
    assert client.get("/shop.html").status_code == 200
    assert client.get("/css/style.css").status_code == 200


def test_admin_login_and_activity_log(client, app):
    assert post(client, "/api/admin/login", {"username": "admin", "password": "wrong"}).status_code == 401
    post(client, "/api/auth/signup", {"name": "Ravi K", "email": "ravi@example.com", "password": "secret123"})
    post(client, "/api/auth/signout")
    post(client, "/api/auth/signin", {"email": "ravi@example.com", "password": "nope1234"})
    post(client, "/api/auth/signin", {"email": "ravi@example.com", "password": "secret123"})
    post(client, "/api/auth/signout")
    # customers cannot use the admin login
    assert post(client, "/api/admin/login", {"username": "ravi@example.com", "password": "secret123"}).status_code == 401

    res = post(client, "/api/admin/login", {"username": "Admin", "password": "AdminPass1"})
    assert res.status_code == 200 and res.get_json()["user"]["role"] == "admin"
    events = client.get("/api/admin/activity").get_json()["events"]
    assert sorted(e["type"] for e in events) == sorted(["admin-signin", "admin-failed", "failed", "signin", "signup", "admin-failed"])
    assert any(e["email"] == "ravi@example.com" and e["type"] == "signup" for e in events)
    customers = client.get("/api/admin/customers").get_json()["customers"]
    ravi = next(c for c in customers if c["email"] == "ravi@example.com")
    assert ravi["logins"] == 2 and ravi["lastLogin"]
    assert client.get("/api/admin/stats").get_json()["signinsToday"] == 2


def test_admin_password_reset_is_single_use_and_invalidates_sessions(client, app, monkeypatch):
    sent = {}

    def capture_email(recipient, reset_url):
        sent.update(recipient=recipient, reset_url=reset_url)

    monkeypatch.setattr("routes.admin.send_admin_reset_email", capture_email)
    old_session = app.test_client()
    assert post(old_session, "/api/admin/login", {"username": "admin", "password": "AdminPass1"}).status_code == 200

    response = post(client, "/api/admin/forgot-password", {"email": "ADMIN@NOTERA.EXAMPLE"})
    assert response.status_code == 200
    assert "reset link will be sent" in response.get_json()["message"]
    assert sent["recipient"] == "admin@notera.example"
    from urllib.parse import parse_qs, urlparse
    token = parse_qs(urlparse(sent["reset_url"]).query)["reset"][0]

    assert post(client, "/api/admin/reset-password", {"token": token, "password": "short"}).status_code == 400
    response = post(client, "/api/admin/reset-password", {"token": token, "password": "ChangedPass2"})
    assert response.status_code == 200
    assert post(client, "/api/admin/reset-password", {"token": token, "password": "ChangedPass3"}).status_code == 400
    assert post(client, "/api/admin/login", {"username": "admin", "password": "AdminPass1"}).status_code == 401
    assert post(client, "/api/admin/login", {"username": "admin", "password": "ChangedPass2"}).status_code == 200
    assert old_session.get("/api/admin/stats").status_code == 401


def test_admin_password_reset_request_does_not_reveal_unknown_email(client, monkeypatch):
    monkeypatch.setattr("routes.admin.send_admin_reset_email", lambda recipient, reset_url: None)
    unknown = post(client, "/api/admin/forgot-password", {"email": "unknown@example.com"})
    known = post(client, "/api/admin/forgot-password", {"email": "admin@notera.example"})
    assert unknown.status_code == known.status_code == 200
    assert unknown.get_json() == known.get_json()

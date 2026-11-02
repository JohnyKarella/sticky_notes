# Notera — sticky notes store

An 11-page sticky notes shop (plus an admin page) with a **plain HTML / CSS / JavaScript frontend** and a **Python (Flask) backend** that stores everything in **MongoDB**.

```
notera-sticky-notes/
├── frontend/            the website: HTML pages, css/, js/, fonts/, images/
├── backend/             Python API + MongoDB
│   ├── app.py           starts the server (serves the website and the API)
│   ├── config.py        settings, read from backend/.env
│   ├── db.py            MongoDB connection, collections and indexes
│   ├── services.py      prices, cart lines, totals, promo codes
│   ├── seed.py          loads products and settings from the HTML into MongoDB
│   ├── routes/          auth, account, catalog, cart, orders, newsletter, admin
│   ├── tests/           API tests (run without a database server)
│   ├── requirements.txt
│   └── .env.example
```

## 1. Configure MongoDB Atlas

The backend connects directly to MongoDB Atlas; MongoDB Compass is only a database GUI and is not required to run the store.

1. Create an Atlas cluster and a database user with read/write access.
2. In Atlas **Network Access**, allow the IP address of the machine running the backend.
3. In **Connect → Drivers**, copy the Python connection string.
4. Copy `backend/.env.example` to `backend/.env` and set `MONGO_URI` to that connection string. Replace the username and password placeholders with the Atlas database user's credentials; URL-encode special characters in either value. Keep the URI private and do not commit `backend/.env`.
5. Set `MONGO_DB` to the database name you want the store to use.

Changing the connection string does not copy data from a local MongoDB deployment. Export and restore any existing local collections to Atlas with MongoDB Database Tools before switching over. On a new, empty Atlas database, the app seeds its initial catalog automatically.

## 2. Start the store

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate      macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env                  # macOS/Linux: cp .env.example .env
python seed.py                          # products, settings, STICKY10, admin user → MongoDB
python app.py
```

Open **http://localhost:5000**. The backend serves the pages and the API from one address, so the login cookie works without extra setup.

## Admin panel

Open **http://localhost:5000/admin.html** and sign in on that page with:

| Username | Password |
|---|---|
| `admin` | `Notera@Admin2026` |

These come from `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `backend/.env`. To change them, edit `.env` and run:

```bash
python seed.py --reset-admin
```

Change the password and set a long random `SECRET_KEY` before going live. Customer accounts cannot sign in to the admin panel.

The admin login includes a show/hide password control and a **Forgot password?** flow. Set `ADMIN_EMAIL` to the admin's working email address, then configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and `SMTP_FROM` in `backend/.env` to enable reset emails. Use an email-provider app password or SMTP credential. Set `PUBLIC_BASE_URL` to the canonical public origin used in reset links (for local development, `http://localhost:5000`). Reset links expire after 30 minutes and can only be used once. A reset updates the admin password in MongoDB; running `python seed.py --reset-admin` later will apply the username/password from `.env` again.

The admin panel shows:
- **Customers:** everyone who signed up, with sign-up date, last sign-in, number of sign-ins, orders and amount spent.
- **Sign-ups & sign-ins:** a log of every sign-up, sign-in and failed sign-in (customer and admin), with date and time, IP address and device. You can filter it by event type.
- **Orders, products & stock, promo codes, reviews and newsletter.**

> If the database is empty when `app.py` starts, it runs the seed automatically.

## What is stored in MongoDB

| Collection | What | Used by |
|---|---|---|
| `users` | customers and the admin (username), hashed passwords, saved addresses, last sign-in, sign-in count | sign up / sign in, account page, checkout, admin |
| `login_events` | every sign-up, sign-in and failed attempt, with time, IP and device | admin → Sign-ups & sign-ins |
| `products` | 20 products: price, was-price, stock, units sold, photos, rating | shop, product page, cart, checkout, admin |
| `carts` | one cart per signed-in user or guest browser, with the applied promo code | cart drawer, cart page, checkout |
| `wishlists` | one wishlist per user or guest browser | heart buttons, wishlist drawer and page |
| `orders` | items, prices, totals, address, delivery, payment method, status history | checkout, order confirmation, account orders, admin |
| `promo_codes` | codes, % off, active, times used | cart page promo box, admin |
| `reviews` | rating, title, text, verified-buyer flag | product page "Reviews" panel, admin |
| `newsletter` | subscriber emails | footer form on every page, admin |
| `settings` | free-shipping threshold, shipping fee, delivery options, payment methods, order prefix | totals and checkout |
| `counters` | running order number (PL-100001, PL-100002, …) | checkout |

Guest carts and wishlists expire 60 days after their last change. When a guest signs in or creates an account, their cart and wishlist move into the account.

## How the pages talk to the backend

- `frontend/js/api.js` sends every change to `/api/...` and keeps a local copy of the cart, wishlist and signed-in user so pages draw instantly. MongoDB holds the real data.
- **Prices are always taken from MongoDB** at checkout, never from the browser. Stock is checked and reduced when an order is placed, and returned if an order is cancelled.
- **Payment is simulated.** Card, UPI and bank details are checked in the browser and never sent to the server. To take real payments, connect a gateway (e.g. Razorpay) in `backend/routes/orders.py`.
- Live price and stock: product cards and product pages read `/api/products/status` and update the price shown and the "Add to cart" buttons, so changes made on the admin page appear without editing the HTML.

### Opening the pages from another server (e.g. VS Code Live Server)

Keep `python app.py` running, then on every page change `data-api="/api"` on the `<html>` tag to `data-api="http://localhost:5000/api"`, and add your page address (e.g. `http://localhost:5500`) to `CORS_ORIGINS` in `.env`. Use `localhost` in both addresses (not `127.0.0.1` in one and `localhost` in the other) so the login cookie is shared.

## API reference

All change requests (POST/PUT/PATCH/DELETE) must send the header `X-Requested-With: fetch` (the pages do this; it blocks cross-site form attacks).

| Method & path | Purpose |
|---|---|
| `POST /api/auth/signup` · `/signin` · `/signout`, `GET /api/auth/me` | accounts |
| `GET /api/account`, `PUT /api/account/profile`, `PUT /api/account/password` | profile |
| `GET/POST /api/account/addresses`, `DELETE /api/account/addresses/<id>` | saved addresses |
| `GET /api/products?q=&collection=&color=&size=&shape=&max=&stock=in&sort=` | product search and filters |
| `GET /api/products/<id>`, `GET /api/products/status` | one product; live price/stock map |
| `GET/POST /api/products/<id>/reviews` | reviews (posting needs sign-in) |
| `GET/PUT/DELETE /api/cart`, `POST /api/cart/items`, `PATCH/DELETE /api/cart/items/<key>` | cart |
| `POST/DELETE /api/cart/promo` | apply / remove a promo code |
| `GET/PUT /api/wishlist`, `POST/DELETE /api/wishlist/<id>` | wishlist |
| `POST /api/orders`, `GET /api/orders`, `GET /api/orders/<id>`, `POST /api/orders/<id>/cancel` | checkout and orders |
| `POST /api/newsletter`, `POST /api/newsletter/unsubscribe` | newsletter |
| `GET /api/settings`, `GET /api/health` | store settings; database check |
| `POST /api/admin/login` {username, password}, `POST /api/admin/logout` | admin panel sign in / out |
| `POST /api/admin/forgot-password` {email}, `POST /api/admin/reset-password` {token, password} | admin password reset by email |
| `/api/admin/stats` · `orders` · `products` · `customers` · `activity` · `promos` · `reviews` · `newsletter` | admin only |

## Where to edit what

**All text and image paths are still in the `.html` files; the `.js` files contain behaviour only.**

| To change | Edit |
|---|---|
| Product name, photo, description, colours, sizes | its card in `shop.html` / `index.html` and its `<article class="pdp">` in `product.html`, then run `python seed.py` |
| Product price or stock | the admin page (saved in MongoDB, shows on the site at once). To make a new price permanent in the HTML too, change `data-price` and the visible price, then `python seed.py` |
| Free-shipping threshold, shipping fee, order number prefix | `data-` attributes on `<body>` (every page), then `python seed.py` |
| Delivery prices and timings, payment method names | `data-fee` / `data-days` / `data-label` in `checkout.html`, then `python seed.py` |
| Promo codes | admin page → Promo codes (the `data-code` on the promo form in `cart.html` is loaded by the seed) |
| Order status words on the account page | the `<ul data-status-words>` list in `account.html` |
| Messages (toasts, form errors, review form) | the HTML: `#toast` block, `<p class="field-error">`, `<template id="tpl-review-form">` |
| Colours, fonts, spacing | CSS variables at the top of `css/style.css` |

`python seed.py` updates product details and settings but keeps stock, units sold, orders and customers. `python seed.py --reset-stock` also sets every product's stock back to `DEFAULT_STOCK`.

## Tests

```bash
cd backend
pip install -r requirements-dev.txt
pytest -q
```

The tests use an in-memory stand-in for MongoDB, so they run without a database server.

## Fixes in this version

- Brand rename damage repaired: the hover "peel" corner on notes and type tiles, the `peelin` entrance animation on the home page letters, and sentences such as "peels off clean" had all been turned into "Notera".
- The product page panels (Details, What's included, Specifications, Shipping, Returns, Reviews) never opened because the CSS did not match a button inside a heading. They open now.
- Passwords were stored in plain text in the browser; accounts, orders, cart and wishlist were only in `localStorage`. All now live in MongoDB, with hashed passwords and server-checked prices.
- Order numbers could repeat (they came from the clock); they are now a running number from the database.
- Sign-in `?next=` redirect could send people to another website; it now only allows pages of this site.
- Minimum password length raised to 8 characters (pages and server agree).
- Favicon declared with the wrong file type; `Thumbs.db` files removed.

## Before going live

- Set `SECRET_KEY`, `ADMIN_PASSWORD`, and `SESSION_COOKIE_SECURE=1` (with https).
- Run behind a production server, e.g. `pip install waitress` then `waitress-serve --port=5000 --call app:create_app`.
- Connect a real payment gateway and an email service for order confirmations.
- Reviews marked `SAMPLE REVIEWS` in `product.html` (and the review counts) are sample content; real reviews from customers appear above them.
- "Forgot password" shows a note only; a real reset needs an email service.

/* ==========================================================================
   api.js — the link between these pages and the Python + MongoDB backend.

   Every cart, wishlist, account, order, review and newsletter change is sent
   to the backend (/api/...). The browser keeps a copy of the cart, wishlist
   and signed-in user in localStorage only so pages can draw instantly; the
   copy in MongoDB is the real one and replaces it as soon as it arrives.

   The API address is the data-api attribute on <html>. Leave it as "/api"
   when the backend serves these pages (python app.py). If you open the pages
   from another server, set it to the full address, e.g.
   data-api="http://localhost:5000/api".
   ========================================================================== */
(function () {
  'use strict';
  var S = window.Sticky;
  var BASE = (document.documentElement.dataset.api || '/api').replace(/\/$/, '');
  var MIGRATED_KEY = 'sticky_api_synced';

  S.KEYS.promo = 'sticky_promo';

  /* ---------- fetch wrapper: JSON in, JSON out, errors thrown with .status and .code ---------- */
  function api(method, path, data) {
    var opts = {
      method: method,
      credentials: 'include',
      headers: { 'Accept': 'application/json', 'X-Requested-With': 'fetch' }
    };
    if (data !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(data);
    }
    return fetch(BASE + path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          var err = new Error(body.message || res.statusText);
          err.status = res.status; err.code = body.error || 'error'; err.body = body;
          throw err;
        }
        return body;
      });
    }, function () {
      var err = new Error('The store server could not be reached');
      err.status = 0; err.code = 'offline';
      throw err;
    });
  }

  /* Shows the right toast for an error; returns the error so callers can rethrow */
  function report(err) {
    if (!err) return err;
    if (err.status === 0 || err.status >= 500) S.toast('offline');
    else if (err.code === 'out_of_stock') S.toast('stock');
    else if (err.status === 400) S.toast('fix-form');
    if (window.console) console.warn('[api]', err.status, err.code, err.message);
    return err;
  }

  /* ---------- write the server's answer into the local copy ---------- */
  function applyCart(cart) {
    if (!cart) return;
    S.write(S.KEYS.promo, cart.promo || null);
    S.write(S.KEYS.cart, cart.items || []);
  }
  function applyWishlist(w) { if (w) S.write(S.KEYS.wishlist, w.items || []); }
  function applyUser(user) { S.write(S.KEYS.user, user || null); }
  function applySession(res) {
    applyUser(res.user);
    if (res.cart) applyCart(res.cart);
    if (res.wishlist) applyWishlist(res.wishlist);
  }

  /* ---------- send the whole cart / wishlist after each change ----------
     A counter makes sure an older, slower answer never overwrites a newer change. */
  var seq = { cart: 0, wish: 0 };
  var lastCartPush = Promise.resolve();

  function pushCart(items) {
    var n = ++seq.cart;
    lastCartPush = api('PUT', '/cart', {
      items: items.map(function (i) { return { id: i.id, color: i.color, size: i.size, qty: i.qty }; })
    }).then(function (cart) {
      if (n === seq.cart) applyCart(cart);
      return cart;
    }, function (err) { report(err); return null; });
    return lastCartPush;
  }

  function pushWishlist(items) {
    var n = ++seq.wish;
    return api('PUT', '/wishlist', {
      items: items.map(function (i) { return { id: i.id, color: i.color, size: i.size }; })
    }).then(function (w) {
      if (n === seq.wish) applyWishlist(w);
      return w;
    }, function (err) { report(err); return null; });
  }

  /* ---------- start-up: load the signed-in user, cart and wishlist from the server ---------- */
  /* Older versions of this site kept accounts and orders in the browser. They now live
     in MongoDB, so the old (unencrypted) copies are removed. */
  try { localStorage.removeItem('sticky_users'); localStorage.removeItem('sticky_orders'); } catch (e) {}

  var firstVisit = false;
  try { firstVisit = !localStorage.getItem(MIGRATED_KEY); } catch (e) {}

  S.ready = Promise.all([api('GET', '/auth/me'), api('GET', '/cart'), api('GET', '/wishlist')])
    .then(function (r) {
      applyUser(r[0].user);
      var localCart = S.read(S.KEYS.cart, []), localWish = S.read(S.KEYS.wishlist, []);
      try { localStorage.setItem(MIGRATED_KEY, '1'); } catch (e) {}
      /* first visit after the backend was added: keep what was already in the browser */
      if (firstVisit && !r[1].items.length && localCart.length) pushCart(localCart);
      else applyCart(r[1]);
      if (firstVisit && !r[2].items.length && localWish.length) pushWishlist(localWish);
      else applyWishlist(r[2]);
      return r[0].user;
    }, function (err) {
      report(err);
      return S.read(S.KEYS.user, null);
    });

  S.api = api;
  S.apiError = report;
  S.sync = {
    cart: pushCart,
    wishlist: pushWishlist,
    applyCart: applyCart,
    applyWishlist: applyWishlist,
    applyUser: applyUser,
    applySession: applySession,
    cartSettled: function () { return lastCartPush; }
  };
})();

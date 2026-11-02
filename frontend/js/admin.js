/* ==========================================================================
   admin.js — the store admin page (admin.html). Only accounts with the
   "admin" role can use it; the backend checks this on every request.
   ========================================================================== */
(function () {
  'use strict';
  var S = window.Sticky;
  var root = document.querySelector('[data-admin]');
  var gate = document.querySelector('[data-admin-gate]');
  if (!root) return;

  var words = {};
  document.querySelectorAll('[data-words] [data-word]').forEach(function (el) { words[el.dataset.word] = el.textContent; });
  var yesNo = function (v) { return v ? words.yes : words.no; };

  /* fill a table body from a list using its row template */
  function rows(tabId, list, map, after) {
    var body = document.querySelector('#tab-' + tabId + ' [data-rows]');
    body.textContent = '';
    list.forEach(function (item) {
      var node = S.stamp(body.dataset.rows, map(item));
      if (!node) return;
      if (after) after(node, item);
      body.appendChild(node);
    });
    var empty = document.querySelector('#tab-' + tabId + ' [data-empty]');
    if (empty) empty.hidden = list.length > 0;
  }

  /* ---------- loaders ---------- */
  function loadStats() {
    return S.api('GET', '/admin/stats').then(function (s) {
      S.fill(document.querySelector('[data-stats]'), {
        orders: String(s.orders), openOrders: String(s.openOrders), revenue: S.money(s.revenue),
        customers: String(s.customers), lowStock: String(s.lowStock), subscribers: String(s.subscribers),
        signinsToday: String(s.signinsToday || 0)
      });
    }, S.apiError);
  }

  var filter = document.querySelector('[data-order-filter]');
  function loadOrders() {
    var q = filter.value ? '?status=' + encodeURIComponent(filter.value) : '';
    return S.api('GET', '/admin/orders' + q).then(function (res) {
      rows('orders', res.orders, function (o) {
        return {
          id: o.id, href: 'order-success.html?order=' + encodeURIComponent(o.id), date: S.formatDate(o.date),
          name: o.customer.name, email: o.customer.email, phone: o.customer.phone,
          items: o.items.map(function (i) { return i.name + ' x ' + i.qty + ([i.color, i.size].filter(Boolean).length ? ' (' + [i.color, i.size].filter(Boolean).join(' / ') + ')' : ''); }).join(', '),
          address: o.address, total: S.money(o.totals.total), delivery: o.delivery,
          payment: o.payment + (o.promo ? ' · ' + o.promo.code : '')
        };
      }, function (node, o) {
        var select = node.querySelector('[data-order-status]');
        select.value = o.status;
        select.disabled = o.status === 'cancelled';
        select.dataset.orderId = o.id;
        select.dataset.was = o.status;
      });
    }, S.apiError);
  }

  function loadProducts() {
    return S.api('GET', '/admin/products').then(function (res) {
      rows('products', res.products, function (p) {
        return { id: p.id, name: p.name, image: p.image, href: p.href, sold: String(p.sold) };
      }, function (node, p) {
        node.dataset.productId = p.id;
        node.querySelector('[name="price"]').value = p.price;
        node.querySelector('[name="compareAt"]').value = p.compareAt == null ? '' : p.compareAt;
        node.querySelector('[name="stockQty"]').value = p.stockQty;
        node.querySelector('[name="active"]').checked = p.active !== false;
      });
    }, S.apiError);
  }

  function loadCustomers() {
    return S.api('GET', '/admin/customers').then(function (res) {
      rows('customers', res.customers, function (c) {
        return { name: c.name + (c.role === 'admin' ? ' (admin)' : ''), email: c.email, phone: c.phone || '-',
                 joined: S.formatDate(c.joined), lastLogin: c.lastLogin ? dateTime(c.lastLogin) : words.never,
                 logins: String(c.logins || 0), orders: String(c.orders), spent: S.money(c.spent) };
      });
    }, S.apiError);
  }

  /* "26 Oct 2026, 12:17 pm" */
  function dateTime(iso) {
    return iso ? new Date(iso).toLocaleString(S.settings.locale, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  }

  var activityFilter = document.querySelector('[data-activity-filter]');
  function loadActivity() {
    var q = activityFilter.value ? '?type=' + encodeURIComponent(activityFilter.value) : '';
    return S.api('GET', '/admin/activity' + q).then(function (res) {
      rows('activity', res.events, function (e) {
        return { date: dateTime(e.date), event: words[e.type] || e.type, name: e.name || '-',
                 email: e.email || '-', ip: e.ip || '-', device: e.device || '-' };
      }, function (node, e) { node.dataset.event = e.type; });
    }, S.apiError);
  }

  function loadPromos() {
    return S.api('GET', '/admin/promos').then(function (res) {
      rows('promos', res.promos, function (p) {
        return { code: p.code, percent: p.percent + '%', uses: String(p.uses) };
      }, function (node, p) {
        var box = node.querySelector('[data-promo-active]');
        box.checked = p.active; box.dataset.code = p.code;
      });
    }, S.apiError);
  }

  function loadReviews() {
    return S.api('GET', '/admin/reviews').then(function (res) {
      rows('reviews', res.reviews, function (r) {
        return { date: S.formatDate(r.date), product: r.productId, name: r.name, rating: r.rating + '/5', title: r.title, body: r.body };
      }, function (node, r) {
        var box = node.querySelector('[data-review-shown]');
        box.checked = !r.hidden; box.dataset.reviewId = r.id;
      });
    }, S.apiError);
  }

  function loadSubscribers() {
    return S.api('GET', '/admin/newsletter').then(function (res) {
      rows('newsletter', res.subscribers, function (s) {
        return { email: s.email, date: S.formatDate(s.date), active: yesNo(s.active) };
      });
    }, S.apiError);
  }

  var loaders = { orders: loadOrders, products: loadProducts, customers: loadCustomers, activity: loadActivity,
                  promos: loadPromos, reviews: loadReviews, newsletter: loadSubscribers };

  /* ---------- tabs ---------- */
  var tabs = root.querySelectorAll('[role="tab"]');
  function showTab(id) {
    if (!loaders[id]) id = 'orders';
    tabs.forEach(function (t) {
      var on = t.dataset.tab === id;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    });
    root.querySelectorAll('[role="tabpanel"]').forEach(function (p) { p.hidden = p.id !== 'tab-' + id; });
    loaders[id]();
  }
  tabs.forEach(function (t) {
    t.addEventListener('click', function () { showTab(t.dataset.tab); history.replaceState(null, '', '#' + t.dataset.tab); });
  });

  /* ---------- actions ---------- */
  filter.addEventListener('change', loadOrders);
  activityFilter.addEventListener('change', loadActivity);
  document.querySelector('[data-activity-refresh]').addEventListener('click', function () { loadActivity(); loadStats(); });

  root.addEventListener('change', function (e) {
    var el = e.target;
    if (el.matches('[data-order-status]')) {
      S.api('PATCH', '/admin/orders/' + encodeURIComponent(el.dataset.orderId), { status: el.value }).then(function () {
        S.toast('saved'); loadStats();
        if (el.value === 'cancelled') el.disabled = true;
        el.dataset.was = el.value;
      }, function (err) { el.value = el.dataset.was; S.apiError(err); });
    }
    if (el.matches('[data-promo-active]')) {
      S.api('PATCH', '/admin/promos/' + encodeURIComponent(el.dataset.code), { active: el.checked })
        .then(function () { S.toast('saved'); }, function (err) { el.checked = !el.checked; S.apiError(err); });
    }
    if (el.matches('[data-review-shown]')) {
      S.api('PATCH', '/admin/reviews/' + encodeURIComponent(el.dataset.reviewId), { hidden: !el.checked })
        .then(function () { S.toast('saved'); }, function (err) { el.checked = !el.checked; S.apiError(err); });
    }
  });

  root.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-save-product]');
    if (!btn) return;
    var row = btn.closest('[data-product-id]');
    var val = function (n) { return row.querySelector('[name="' + n + '"]'); };
    btn.disabled = true;
    S.api('PATCH', '/admin/products/' + encodeURIComponent(row.dataset.productId), {
      price: Number(val('price').value), compareAt: val('compareAt').value === '' ? null : Number(val('compareAt').value),
      stockQty: Number(val('stockQty').value), active: val('active').checked
    }).then(function () { S.toast('saved'); loadStats(); }, S.apiError).then(function () { btn.disabled = false; });
  });

  var promoForm = document.getElementById('promo-form');
  promoForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!S.validate(promoForm)) return;
    S.api('POST', '/admin/promos', { code: promoForm.code.value.trim(), percent: Number(promoForm.percent.value) })
      .then(function () { promoForm.reset(); S.toast('saved'); loadPromos(); }, S.apiError);
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('[data-logout]')) return;
    S.api('POST', '/admin/logout').then(function () {
      S.write(S.KEYS.user, null);
      window.location.href = 'admin.html';
    });
  });

  /* ---------- start: admins only ---------- */
  var denied = document.querySelector('[data-admin-denied]');
  var loginError = document.querySelector('[data-login-error]');
  var started = false;

  function enter(user) {
    var isAdmin = !!(user && user.role === 'admin');
    gate.hidden = isAdmin;
    root.hidden = !isAdmin;
    if (!isAdmin) {
      denied.hidden = !user;
      if (!gate.hidden) { var f = gate.querySelector('[data-autofocus]'); if (f) f.focus(); }
      return;
    }
    document.querySelector('[data-admin-who]').textContent = user.username || user.email;
    document.querySelectorAll('[data-admin-only]').forEach(function (el) { el.hidden = false; });
    loadStats();
    if (!started) { started = true; showTab(window.location.hash.slice(1)); }
  }

  /* Admin sign-in form: username + password (checked by POST /api/admin/login) */
  var loginForm = document.getElementById('admin-login-form');
  loginForm.addEventListener('submit', function (e) {
    e.preventDefault();
    loginError.hidden = true;
    denied.hidden = true;
    if (!S.validate(loginForm)) return;
    var button = loginForm.querySelector('[type="submit"]');
    button.disabled = true;
    S.api('POST', '/admin/login', { username: loginForm.username.value.trim(), password: loginForm.password.value })
      .then(function (res) {
        S.sync.applyUser(res.user);
        loginForm.reset();
        enter(res.user);
      }, function (err) {
        if (err.code === 'bad_credentials') loginError.hidden = false;
        else S.apiError(err);
      })
      .then(function () { button.disabled = false; });
  });

  var forgotForm = document.getElementById('admin-forgot-form');
  var resetForm = document.getElementById('admin-reset-form');
  var forgotLink = document.querySelector('[data-show-forgot]');
  var forgotError = document.querySelector('[data-forgot-error]');
  var forgotSuccess = document.querySelector('[data-forgot-success]');
  var resetError = document.querySelector('[data-reset-error]');
  var resetSuccess = document.querySelector('[data-reset-success]');

  function showAuthForm(form) {
    loginForm.hidden = form !== loginForm;
    forgotForm.hidden = form !== forgotForm;
    resetForm.hidden = form !== resetForm;
    forgotLink.hidden = form !== loginForm;
  }

  forgotLink.addEventListener('click', function () {
    forgotError.hidden = true;
    forgotSuccess.hidden = true;
    showAuthForm(forgotForm);
    forgotForm.email.focus();
  });
  document.querySelectorAll('[data-show-login]').forEach(function (button) {
    button.addEventListener('click', function () { showAuthForm(loginForm); });
  });
  document.querySelectorAll('[data-password-toggle]').forEach(function (button) {
    button.addEventListener('click', function () {
      var input = document.getElementById(button.dataset.passwordToggle);
      var visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      button.textContent = visible ? 'Hide' : 'Show';
      button.setAttribute('aria-label', (visible ? 'Hide' : 'Show') + ' password');
      button.setAttribute('aria-pressed', visible ? 'true' : 'false');
    });
  });

  forgotForm.addEventListener('submit', function (e) {
    e.preventDefault();
    forgotError.hidden = true;
    forgotSuccess.hidden = true;
    if (!S.validate(forgotForm)) return;
    var button = forgotForm.querySelector('[type="submit"]');
    button.disabled = true;
    S.api('POST', '/admin/forgot-password', { email: forgotForm.email.value.trim() })
      .then(function (res) {
        forgotSuccess.textContent = res.message;
        forgotSuccess.hidden = false;
        forgotForm.reset();
      }, function (err) {
        forgotError.textContent = err.message || 'Could not send a reset email. Please try again later.';
        forgotError.hidden = false;
      })
      .then(function () { button.disabled = false; });
  });

  resetForm.addEventListener('submit', function (e) {
    e.preventDefault();
    resetError.hidden = true;
    resetSuccess.hidden = true;
    if (!S.validate(resetForm)) return;
    var button = resetForm.querySelector('[type="submit"]');
    button.disabled = true;
    S.api('POST', '/admin/reset-password', {
      token: resetForm.token.value,
      password: resetForm.password.value
    }).then(function (res) {
      resetSuccess.textContent = res.message;
      resetSuccess.hidden = false;
      resetForm.reset();
      history.replaceState(null, '', 'admin.html');
    }, function (err) {
      resetError.textContent = err.message || 'Could not change your password. Request a new reset link.';
      resetError.hidden = false;
    }).then(function () { button.disabled = false; });
  });

  var resetToken = new URLSearchParams(window.location.search).get('reset');
  if (resetToken) {
    resetForm.token.value = resetToken;
    showAuthForm(resetForm);
  }

  S.ready.then(enter);
})();

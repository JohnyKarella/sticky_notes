/* ==========================================================================
   auth.js — sign up, sign in, sign out and the account page.
   Accounts live in MongoDB (users collection). Passwords are hashed on the
   server and never stored in the browser. The server remembers who is signed
   in with a secure session cookie.
   ========================================================================== */
(function () {
  'use strict';
  var S = window.Sticky;
  var params = new URLSearchParams(window.location.search);

  function currentUser() { return S.read(S.KEYS.user, null); }

  /* Resolves true when signed in, false for a wrong email/password */
  function signIn(email, password) {
    return S.api('POST', '/auth/signin', { email: String(email).trim(), password: password })
      .then(function (res) { S.sync.applySession(res); return true; }, function (err) {
        if (err.code === 'bad_credentials') return false;
        throw S.apiError(err);
      });
  }

  /* Resolves false when the email is already registered */
  function signUp(data) {
    return S.api('POST', '/auth/signup', {
      name: data.name.trim(), email: data.email.trim(), phone: (data.phone || '').trim(), password: data.password
    }).then(function (res) { S.sync.applySession(res); return true; }, function (err) {
      if (err.code === 'email_taken') return false;
      throw S.apiError(err);
    });
  }

  function signOut() {
    var done = function () {
      S.write(S.KEYS.user, null);
      S.write(S.KEYS.promo, null);
      S.write(S.KEYS.cart, []);
      S.write(S.KEYS.wishlist, []);
    };
    return S.api('POST', '/auth/signout').then(done, done);
  }

  /* Only go back to a page on this site after signing in */
  function safeNext(value) {
    return value && /^[a-z0-9-]+\.html([?#].*)?$/i.test(value) ? value : 'account.html';
  }

  function busy(form, on) {
    var b = form.querySelector('[type="submit"]');
    if (b) b.disabled = on;
  }

  S.auth = { current: currentUser, signIn: signIn, signUp: signUp, signOut: signOut };

  /* ---------- Sign in page ---------- */
  var signinForm = document.getElementById('signin-form');
  if (signinForm) {
    signinForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var error = signinForm.querySelector('[data-form-error]');
      error.hidden = true;
      if (!S.validate(signinForm)) return;
      busy(signinForm, true);
      signIn(signinForm.email.value, signinForm.password.value).then(function (ok) {
        if (ok) { window.location.href = safeNext(params.get('next')); return; }
        error.hidden = false;
        busy(signinForm, false);
      }, function () { busy(signinForm, false); });
    });
    var forgot = document.querySelector('[data-forgot]');
    if (forgot) forgot.addEventListener('click', function () {
      document.querySelector('[data-forgot-note]').hidden = false;
    });
  }

  /* ---------- Sign up page ---------- */
  var signupForm = document.getElementById('signup-form');
  if (signupForm) {
    signupForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var error = signupForm.querySelector('[data-form-error]');
      error.hidden = true;
      if (!S.validate(signupForm)) return;
      busy(signupForm, true);
      signUp({
        name: signupForm.elements.name.value, email: signupForm.email.value,
        phone: signupForm.phone.value, password: signupForm.password.value
      }).then(function (ok) {
        busy(signupForm, false);
        if (!ok) { error.hidden = false; return; }
        /* show the "account created" state written in the HTML */
        document.querySelector('[data-signup-form]').hidden = true;
        var done = document.querySelector('[data-signup-done]');
        done.hidden = false;
        S.fill(done, { name: signupForm.elements.name.value.trim().split(' ')[0] });
        done.querySelector('a').focus();
      }, function () { busy(signupForm, false); });
    });
  }

  /* ---------- Account page ---------- */
  var account = document.querySelector('[data-account]');
  if (account) S.ready.then(function (user) {
    document.querySelector('[data-account-guest]').hidden = !!user;
    account.hidden = !user;
    if (!user) return;

    S.fill(document.querySelector('[data-account-hello]'), { name: user.name.split(' ')[0], email: user.email });

    /* Tabs (also reachable by hash, e.g. account.html#orders) */
    var tabs = account.querySelectorAll('[role="tab"]');
    var showTab = function (id) {
      var found = false;
      tabs.forEach(function (t) { if (t.dataset.tab === id) found = true; });
      if (!found) id = tabs[0].dataset.tab;
      tabs.forEach(function (t) {
        var on = t.dataset.tab === id;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
      });
      account.querySelectorAll('[role="tabpanel"]').forEach(function (p) { p.hidden = p.id !== 'tab-' + id; });
    };
    tabs.forEach(function (t) {
      t.addEventListener('click', function () { showTab(t.dataset.tab); history.replaceState(null, '', '#' + t.dataset.tab); });
    });
    account.querySelector('[role="tablist"]').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var list = Array.prototype.slice.call(tabs);
      var i = list.indexOf(document.activeElement);
      var next = list[(i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length];
      next.focus(); next.click(); e.preventDefault();
    });
    showTab(window.location.hash.slice(1));

    /* Profile */
    var profile = document.getElementById('profile-form');
    profile.elements.name.value = user.name;
    profile.email.value = user.email;
    profile.phone.value = user.phone || '';
    profile.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!S.validate(profile)) return;
      busy(profile, true);
      S.api('PUT', '/account/profile', { name: profile.elements.name.value.trim(), phone: profile.phone.value.trim() })
        .then(function (res) { S.sync.applyUser(res.user); S.toast('saved'); }, S.apiError)
        .then(function () { busy(profile, false); });
    });

    /* Orders placed with this account (status words are written in the HTML) */
    var statusWords = {};
    document.querySelectorAll('[data-status-words] [data-status]').forEach(function (el) {
      statusWords[el.dataset.status] = el.textContent;
    });
    var orderList = document.querySelector('[data-order-list]');
    S.api('GET', '/orders').then(function (res) {
      orderList.textContent = '';
      res.orders.forEach(function (o) {
        var node = S.stamp('tpl-order', {
          id: o.id, date: S.formatDate(o.date), total: S.money(o.totals.total), eta: S.formatEta(o.etaDate),
          status: statusWords[o.status] || o.status,
          count: o.items.reduce(function (n, i) { return n + i.qty; }, 0),
          items: o.items.map(function (i) { return i.name + ' x ' + i.qty; }).join(', '),
          href: 'order-success.html?order=' + encodeURIComponent(o.id)
        });
        node.dataset.status = o.status;
        orderList.appendChild(node);
      });
      document.querySelector('[data-orders-empty]').hidden = res.orders.length > 0;
    }, S.apiError);

    /* Saved addresses */
    var addressList = document.querySelector('[data-address-list]');
    var renderAddresses = function (list) {
      addressList.textContent = '';
      list.forEach(function (a) {
        var node = S.stamp('tpl-address', { label: a.label, lines: [a.address, a.city, a.state, a.pin].filter(Boolean).join(', ') });
        node.dataset.addressId = a.id;
        addressList.appendChild(node);
      });
      document.querySelector('[data-addresses-empty]').hidden = list.length > 0;
      var u = currentUser();
      if (u) { u.addresses = list; S.write(S.KEYS.user, u); }
    };
    var addressForm = document.getElementById('address-form');
    addressForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!S.validate(addressForm)) return;
      busy(addressForm, true);
      S.api('POST', '/account/addresses', {
        label: addressForm.label.value.trim(), address: addressForm.address.value.trim(), city: addressForm.city.value.trim(),
        state: addressForm.state.value.trim(), pin: addressForm.pin.value.trim()
      }).then(function (res) {
        addressForm.reset();
        renderAddresses(res.addresses);
        S.toast('saved');
      }, S.apiError).then(function () { busy(addressForm, false); });
    });
    addressList.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-remove-address]');
      if (!btn) return;
      var id = btn.closest('[data-address-id]').dataset.addressId;
      S.api('DELETE', '/account/addresses/' + encodeURIComponent(id)).then(function (res) {
        renderAddresses(res.addresses);
      }, S.apiError);
    });
    renderAddresses(user.addresses || []);
  });

  /* Log out buttons (account page, mobile menu) */
  document.addEventListener('click', function (e) {
    if (!e.target.closest('[data-logout]')) return;
    e.preventDefault();
    signOut().then(function () { window.location.href = 'signin.html'; });
  });
})();

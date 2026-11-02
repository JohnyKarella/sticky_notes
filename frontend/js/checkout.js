/* ==========================================================================
   checkout.js — checkout form, order placement and the order success page.
   The order is created by the backend from the cart saved in MongoDB, with
   prices and stock checked there. Payment is simulated: card and UPI details
   are validated in the browser and never sent to the server.
   ========================================================================== */
(function () {
  'use strict';
  var S = window.Sticky;

  /* ======================= CHECKOUT PAGE ======================= */
  var form = document.getElementById('checkout-form');
  if (form) {
    var modeBox = document.querySelector('[data-checkout-modes]');
    var signedBox = document.querySelector('[data-signed-in]');
    var signinForm = document.getElementById('checkout-signin');
    var accountFields = form.querySelector('[data-create-fields]');

    /* Guest / create account / sign in */
    var setMode = function (mode) {
      signinForm.hidden = mode !== 'signin';
      accountFields.hidden = mode !== 'create';
      form.dataset.mode = mode;
    };

    var prefill = function () {
      var user = S.auth.current();
      modeBox.hidden = !!user;
      signedBox.hidden = !user;
      if (!user) return;
      setMode('user');
      S.fill(signedBox, { name: user.name, email: user.email });
      var parts = user.name.split(' ');
      form.firstName.value = form.firstName.value || parts[0];
      form.lastName.value = form.lastName.value || parts.slice(1).join(' ');
      form.email.value = user.email;
      form.phone.value = form.phone.value || user.phone || '';
      var saved = (user.addresses || [])[0];
      if (saved && !form.address.value) {
        form.address.value = saved.address; form.city.value = saved.city;
        form.state.value = saved.state; form.pin.value = saved.pin;
      }
    };

    modeBox.addEventListener('change', function (e) { if (e.target.name === 'mode') setMode(e.target.value); });
    setMode('guest');
    prefill();
    S.ready.then(prefill);

    signinForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var error = signinForm.querySelector('[data-form-error]');
      error.hidden = true;
      if (!S.validate(signinForm)) return;
      S.auth.signIn(signinForm.email.value, signinForm.password.value).then(function (ok) {
        if (ok) { signinForm.hidden = true; prefill(); }
        else error.hidden = false;
      }, function () {});
    });

    /* Delivery method changes the shipping line in the summary */
    var setDelivery = function () {
      var chosen = form.querySelector('[name="delivery"]:checked');
      S.deliveryFee = chosen.dataset.fee === 'auto' ? null : Number(chosen.dataset.fee);
      S.cart.render();
    };
    form.querySelectorAll('[name="delivery"]').forEach(function (r) { r.addEventListener('change', setDelivery); });
    setDelivery();

    /* Payment method shows its own fields */
    var setPayment = function () {
      var chosen = form.querySelector('[name="payment"]:checked');
      form.querySelectorAll('[data-pay-panel]').forEach(function (p) { p.hidden = p.dataset.payPanel !== chosen.dataset.pay; });
    };
    form.querySelectorAll('[name="payment"]').forEach(function (r) { r.addEventListener('change', setPayment); });
    setPayment();

    /* Tidy card inputs as they are typed */
    form.addEventListener('input', function (e) {
      var el = e.target;
      if (el.name === 'cardNumber') el.value = el.value.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
      if (el.name === 'cardExpiry') el.value = el.value.replace(/\D/g, '').slice(0, 4).replace(/^(\d{2})(\d)/, '$1/$2');
      if (el.name === 'cardCvv' || el.name === 'pin') el.value = el.value.replace(/\D/g, '').slice(0, el.name === 'pin' ? 6 : 4);
    });

    var button = form.querySelector('[type="submit"]');
    var setBusy = function (on) {
      button.disabled = on;
      button.querySelector('[data-pay-idle]').hidden = on;
      button.querySelector('[data-pay-busy]').hidden = !on;
    };

    /* Mark a field the server did not accept */
    var markField = function (name) {
      var el = name && form.querySelector('[name="' + name + '"]');
      if (!el) return;
      el.setAttribute('aria-invalid', 'true');
      var msg = (el.closest('.field') || el.parentElement).querySelector('.field-error');
      if (msg) msg.hidden = false;
      el.focus();
    };

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!S.cart.get().length) return;
      var accountError = form.querySelector('[data-account-error]');
      accountError.hidden = true;
      if (!S.validate(form)) { S.toast('fix-form'); return; }

      var name = (form.firstName.value.trim() + ' ' + form.lastName.value.trim()).trim();
      var delivery = form.querySelector('[name="delivery"]:checked');
      var payment = form.querySelector('[name="payment"]:checked');
      setBusy(true);

      /* 1. create the account first if that option was chosen */
      var step = Promise.resolve(true);
      if (form.dataset.mode === 'create') {
        step = S.auth.signUp({ name: name, email: form.email.value, phone: form.phone.value, password: form.newPassword.value });
      }

      step.then(function (made) {
        if (!made) {
          accountError.hidden = false;
          accountError.scrollIntoView({ block: 'center' });
          setBusy(false);
          return;
        }
        /* 2. make sure the server has the latest cart, then place the order */
        return S.sync.cartSettled().then(function () {
          return S.api('POST', '/orders', {
            firstName: form.firstName.value.trim(), lastName: form.lastName.value.trim(),
            email: form.email.value.trim(), phone: form.phone.value.trim(),
            address: form.address.value.trim(), city: form.city.value.trim(), state: form.state.value.trim(),
            pin: form.pin.value.trim(), country: form.country.value.trim(),
            delivery: delivery.value, payment: payment.dataset.label,
            saveAddress: !!(form.saveAddress && form.saveAddress.checked)
            /* card / UPI / bank details are deliberately NOT sent */
          });
        }).then(function (res) {
          S.cart.clear();
          window.location.href = 'order-success.html?order=' + encodeURIComponent(res.order.id);
        }, function (err) {
          setBusy(false);
          if (err.code === 'invalid') { markField(err.body && err.body.field); S.toast('fix-form'); return; }
          if (err.code === 'empty_cart') { S.cart.clear(); return; }
          S.apiError(err);
          if (err.code === 'out_of_stock') S.api('GET', '/cart').then(S.sync.applyCart);
        });
      }, function () { setBusy(false); });
    });
  }

  /* ======================= ORDER SUCCESS PAGE ======================= */
  var success = document.querySelector('[data-success]');
  if (success) {
    var wanted = new URLSearchParams(window.location.search).get('order');
    var none = document.querySelector('[data-success-none]');
    success.hidden = true;
    none.hidden = true;

    var show = function (order) {
      success.hidden = false;
      S.fill(success, {
        id: order.id, eta: S.formatEta(order.etaDate), date: S.formatDate(order.date),
        name: order.customer.name.split(' ')[0], email: order.customer.email,
        address: order.address, delivery: order.delivery, payment: order.payment,
        subtotal: S.money(order.totals.subtotal),
        discount: '-' + S.money(order.totals.discount),
        shipping: order.totals.shipping === 0 ? (document.body.dataset.freeLabel || '') : S.money(order.totals.shipping),
        total: S.money(order.totals.total)
      });
      success.querySelectorAll('[data-order-discount]').forEach(function (el) { el.hidden = order.totals.discount === 0; });
      var list = success.querySelector('[data-order-lines]');
      list.textContent = '';
      order.items.forEach(function (i) {
        list.appendChild(S.stamp('tpl-order-line', {
          name: i.name, image: i.image, qty: i.qty,
          variant: [i.color, i.size].filter(Boolean).join(' / '),
          price: S.money(i.price * i.qty)
        }));
      });
    };

    if (!wanted) none.hidden = false;
    else S.api('GET', '/orders/' + encodeURIComponent(wanted)).then(function (res) { show(res.order); }, function (err) {
      if (err.status !== 404) S.apiError(err);
      none.hidden = false;
    });
  }
})();

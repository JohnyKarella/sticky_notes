/* ==========================================================================
   cart.js — cart, the cart drawer, the cart page and order totals.
   The cart is saved in MongoDB through the API (api.js). Each change is shown
   at once from the local copy, then the server's answer (with the real prices
   and stock) replaces it.
   ========================================================================== */
(function () {
  'use strict';
  var S = window.Sticky;

  function getCart() { return S.read(S.KEYS.cart, []); }
  function saveCart(items) {
    S.write(S.KEYS.cart, items);
    if (S.sync) S.sync.cart(items);
  }
  function promoPercent() { return Number((S.read(S.KEYS.promo, null) || {}).percent || 0); }

  /* One cart line per product + colour + size */
  function addToCart(product, qty) {
    var items = getCart();
    var key = [product.id, product.color, product.size].join('|');
    var line = items.filter(function (i) { return i.key === key; })[0];
    if (line) line.qty = Math.min(99, line.qty + qty);
    else items.push({
      key: key, id: product.id, name: product.name, price: product.price,
      image: product.image, href: product.href, color: product.color,
      size: product.size, qty: qty
    });
    saveCart(items);
  }

  function setQty(key, qty) {
    var items = getCart();
    items.forEach(function (i) { if (i.key === key) i.qty = Math.max(1, Math.min(99, qty)); });
    saveCart(items);
  }

  function removeFromCart(key) {
    saveCart(getCart().filter(function (i) { return i.key !== key; }));
  }

  /* Subtotal, discount, shipping and total.
     S.deliveryFee is set by the checkout page when a paid delivery method is chosen. */
  function totals() {
    var items = getCart();
    var subtotal = items.reduce(function (sum, i) { return sum + i.price * i.qty; }, 0);
    var count = items.reduce(function (sum, i) { return sum + i.qty; }, 0);
    var percent = promoPercent();
    var discount = Math.round(subtotal * percent / 100);
    var free = S.settings.freeShippingOver;
    var shipping = 0;
    if (items.length) {
      if (typeof S.deliveryFee === 'number') shipping = S.deliveryFee;
      else shipping = subtotal >= free ? 0 : S.settings.shippingFee;
    }
    return {
      subtotal: subtotal, count: count, discount: discount, shipping: shipping,
      total: subtotal - discount + shipping,
      remaining: Math.max(0, free - subtotal),
      progress: free ? Math.min(100, subtotal / free * 100) : 100
    };
  }

  function lineData(i) {
    return {
      name: i.name, image: i.image, href: i.href, qty: i.qty,
      variant: [i.color, i.size].filter(Boolean).join(' / '),
      price: S.money(i.price * i.qty), unit: S.money(i.price)
    };
  }

  /* Draw every cart list on the page (drawer, cart page, checkout summary) */
  function renderCart() {
    var items = getCart();
    var t = totals();

    document.querySelectorAll('[data-cart-list]').forEach(function (list) {
      list.textContent = '';
      items.forEach(function (i) {
        var node = S.stamp(list.dataset.cartList, lineData(i));
        if (!node) return;
        node.dataset.key = i.key;
        list.appendChild(node);
      });
    });

    document.querySelectorAll('[data-cart-empty]').forEach(function (el) { el.hidden = items.length > 0; });
    document.querySelectorAll('[data-cart-filled]').forEach(function (el) { el.hidden = items.length === 0; });

    var freeLabel = document.body.dataset.freeLabel || '';
    var values = {
      subtotal: S.money(t.subtotal),
      discount: '-' + S.money(t.discount),
      shipping: t.shipping === 0 ? freeLabel : S.money(t.shipping),
      total: S.money(t.total),
      remaining: S.money(t.remaining),
      count: t.count
    };
    document.querySelectorAll('[data-sum]').forEach(function (el) {
      if (values[el.dataset.sum] !== undefined) el.textContent = values[el.dataset.sum];
    });
    document.querySelectorAll('[data-discount-row]').forEach(function (el) { el.hidden = t.discount === 0; });

    /* free-shipping meter */
    document.querySelectorAll('[data-ship-bar]').forEach(function (el) { el.style.width = t.progress + '%'; });
    document.querySelectorAll('[data-ship-more]').forEach(function (el) { el.hidden = t.remaining === 0; });
    document.querySelectorAll('[data-ship-done]').forEach(function (el) { el.hidden = t.remaining > 0; });

    S.setCount('[data-cart-count]', t.count);
  }

  function openCart() { S.openPanel('cart-drawer'); }
  function closeCart() { S.closePanel(); }

  /* ---------- Clicks ---------- */
  document.addEventListener('click', function (e) {
    var el;

    /* Add to cart / Quick add / Buy now */
    el = e.target.closest('[data-add], [data-buy]');
    if (el) {
      var scope = el.closest('[data-product]') ? el : document.querySelector('.pdp:not([hidden]) [data-add]');
      var product = scope && S.productFrom(scope);
      if (!product || product.stock !== 'in') return;
      /* on the product page, use the chosen colour, size and quantity */
      var host = product.host;
      var color = host.querySelector('[data-color][aria-pressed="true"]');
      var size = host.querySelector('[data-size][aria-pressed="true"]');
      var qtyInput = host.querySelector('[data-pdp-qty]');
      if (color) product.color = color.dataset.color;
      if (size) product.size = size.dataset.size;
      addToCart(product, qtyInput ? Math.max(1, Number(qtyInput.value) || 1) : 1);
      if (el.hasAttribute('data-buy')) { window.location.href = 'checkout.html'; return; }
      S.toast('cart-add');
      openCart();
      return;
    }

    /* Quantity steppers inside a cart line */
    el = e.target.closest('[data-step]');
    if (el && el.closest('[data-key]')) {
      var key = el.closest('[data-key]').dataset.key;
      var line = getCart().filter(function (i) { return i.key === key; })[0];
      if (line) setQty(key, line.qty + Number(el.dataset.step));
      return;
    }

    el = e.target.closest('[data-remove-cart]');
    if (el) {
      removeFromCart(el.closest('[data-key]').dataset.key);
      S.toast('cart-remove');
      return;
    }

    /* Move a cart line to the wishlist */
    el = e.target.closest('[data-cart-to-wish]');
    if (el && S.wishlist) {
      var k = el.closest('[data-key]').dataset.key;
      var item = getCart().filter(function (i) { return i.key === k; })[0];
      if (item) {
        S.wishlist.add({ id: item.id, name: item.name, price: item.price, image: item.image, href: item.href, color: item.color, size: item.size, stock: 'in' });
        removeFromCart(k);
        S.toast('wish-add');
      }
    }
  });

  /* ---------- Promo code: checked by the server against the promo_codes collection ---------- */
  document.querySelectorAll('[data-promo]').forEach(function (form) {
    var input = form.querySelector('input');
    var box = form.parentElement;
    var show = function (good) {
      box.querySelector('[data-promo-ok]').hidden = !good;
      box.querySelector('[data-promo-bad]').hidden = good;
    };
    /* show a code that is already applied */
    var applied = S.read(S.KEYS.promo, null);
    if (applied && input && !input.value) { input.value = applied.code; show(true); }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var code = input.value.trim();
      if (!code) return;
      S.sync.cartSettled().then(function () {
        return S.api('POST', '/cart/promo', { code: code });
      }).then(function (cart) {
        S.sync.applyCart(cart);
        show(true);
      }, function (err) {
        if (err.code === 'bad_promo') {
          if (err.body && err.body.cart) S.sync.applyCart(err.body.cart);
          show(false);
        } else S.apiError(err);
      });
    });
  });

  document.addEventListener('sticky:change', renderCart);
  window.addEventListener('storage', renderCart); // keep tabs in sync
  renderCart();

  S.cart = { get: getCart, add: addToCart, remove: removeFromCart, setQty: setQty, totals: totals, render: renderCart, clear: function () { S.write(S.KEYS.promo, null); S.write(S.KEYS.cart, []); } };
  window.openCart = openCart;
  window.closeCart = closeCart;
  window.renderCart = renderCart;
})();

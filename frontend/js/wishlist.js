/* ==========================================================================
   wishlist.js — wishlist (saved in MongoDB), drawer, wishlist page and heart buttons.
   ========================================================================== */
(function () {
  'use strict';
  var S = window.Sticky;

  function getWishlist() { return S.read(S.KEYS.wishlist, []); }
  /* saved locally for instant display, then in MongoDB through the API (api.js) */
  function saveWishlist(items) {
    S.write(S.KEYS.wishlist, items);
    if (S.sync) S.sync.wishlist(items);
  }
  function has(id) { return getWishlist().some(function (i) { return i.id === id; }); }

  function add(item) {
    if (has(item.id)) return;
    var items = getWishlist();
    items.push({ id: item.id, name: item.name, price: item.price, image: item.image, href: item.href, color: item.color, size: item.size, stock: item.stock });
    saveWishlist(items);
  }

  function remove(id) {
    saveWishlist(getWishlist().filter(function (i) { return i.id !== id; }));
  }

  function renderWishlist() {
    var items = getWishlist();

    document.querySelectorAll('[data-wish-list]').forEach(function (list) {
      list.textContent = '';
      items.forEach(function (i) {
        var node = S.stamp(list.dataset.wishList, {
          name: i.name, image: i.image, href: i.href, price: S.money(i.price), stock: i.stock
        });
        if (!node) return;
        node.dataset.wishId = i.id;
        /* sold-out items cannot be added to the cart */
        if (i.stock !== 'in') node.querySelectorAll('[data-wish-to-cart], [data-wish-add]').forEach(function (b) { b.disabled = true; });
        list.appendChild(node);
      });
    });

    document.querySelectorAll('[data-wish-empty]').forEach(function (el) { el.hidden = items.length > 0; });
    document.querySelectorAll('[data-wish-filled]').forEach(function (el) { el.hidden = items.length === 0; });

    /* heart buttons on cards and the product page */
    document.querySelectorAll('[data-wish]').forEach(function (btn) {
      var host = btn.closest('[data-product]');
      if (host) btn.setAttribute('aria-pressed', has(host.dataset.id) ? 'true' : 'false');
    });

    S.setCount('[data-wish-count]', items.length);
  }

  function openWishlist() { S.openPanel('wishlist-drawer'); }
  function closeWishlist() { S.closePanel(); }

  document.addEventListener('click', function (e) {
    var el;

    /* Heart toggle */
    el = e.target.closest('[data-wish]');
    if (el) {
      var product = S.productFrom(el);
      if (!product) return;
      el.classList.remove('is-pop'); void el.offsetWidth; el.classList.add('is-pop');
      if (has(product.id)) { remove(product.id); S.toast('wish-remove'); }
      else { add(product); S.toast('wish-add'); }
      return;
    }

    el = e.target.closest('[data-remove-wish]');
    if (el) { remove(el.closest('[data-wish-id]').dataset.wishId); S.toast('wish-remove'); return; }

    /* Move to cart (drawer) or add to cart and keep saved (wishlist page) */
    el = e.target.closest('[data-wish-to-cart], [data-wish-add]');
    if (el) {
      var id = el.closest('[data-wish-id]').dataset.wishId;
      var item = getWishlist().filter(function (i) { return i.id === id; })[0];
      if (!item || item.stock !== 'in') return;
      S.cart.add(item, 1);
      if (el.hasAttribute('data-wish-to-cart')) remove(id);
      S.toast('cart-add');
    }
  });

  document.addEventListener('sticky:change', renderWishlist);
  window.addEventListener('storage', renderWishlist);
  renderWishlist();

  S.wishlist = { get: getWishlist, add: add, remove: remove, has: has, render: renderWishlist };
  window.openWishlist = openWishlist;
  window.closeWishlist = closeWishlist;
  window.renderWishlist = renderWishlist;
})();

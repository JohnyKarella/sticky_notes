/* ==========================================================================
   products.js — shop filtering / sorting / search and the product page.

   There is NO product data in this file. Every product (name, price, photos,
   description) is written in the HTML as a card or a product section with
   data attributes. This file only reads them, shows, hides and reorders.
   At the end, live price and stock are read from the backend (MongoDB).
   ========================================================================== */
(function () {
  'use strict';
  var S = window.Sticky;
  var params = new URLSearchParams(window.location.search);

  /* ======================= SHOP PAGE ======================= */
  var grid = document.querySelector('[data-grid]');
  var form = document.getElementById('filters');

  if (grid && form) {
    var cards = Array.prototype.slice.call(grid.querySelectorAll('[data-product]'));
    cards.forEach(function (c, i) { c.dataset.order = i; }); // "Featured" = the order written in the HTML
    var searchInput = document.querySelector('[data-shop-search]');
    var sortSelect = document.querySelector('[data-sort]');
    var priceRange = form.querySelector('[data-price]');
    var priceOut = form.querySelector('[data-price-out]');

    /* start from the URL: shop.html?q=grid  or  shop.html?collection=Pastel */
    if (params.get('q') && searchInput) searchInput.value = params.get('q');
    ['collection', 'size', 'shape', 'color'].forEach(function (name) {
      if (!params.get(name)) return;
      form.querySelectorAll('[name="' + name + '"]').forEach(function (box) {
        box.checked = box.value === params.get(name);
      });
    });
    /* shop.html?max=200 sets the price filter; shop.html?sort=newest sets the sort order */
    if (params.get('max')) priceRange.value = params.get('max');
    if (params.get('sort')) sortSelect.value = params.get('sort');

    var checked = function (name) {
      return Array.prototype.map.call(form.querySelectorAll('[name="' + name + '"]:checked'), function (b) { return b.value; });
    };
    var anyOf = function (wanted, have) {
      return !wanted.length || wanted.some(function (w) { return have.indexOf(w) !== -1; });
    };

    var sorters = {
      featured: function (a, b) { return a.dataset.order - b.dataset.order; },
      newest: function (a, b) { return b.dataset.added - a.dataset.added; },
      'price-asc': function (a, b) { return a.dataset.price - b.dataset.price; },
      'price-desc': function (a, b) { return b.dataset.price - a.dataset.price; },
      selling: function (a, b) { return b.dataset.sold - a.dataset.sold; },
      rating: function (a, b) { return b.dataset.rating - a.dataset.rating; }
    };

    var apply = function () {
      var q = searchInput ? searchInput.value.trim().toLowerCase() : '';
      var collections = checked('collection'), colors = checked('color'),
          sizes = checked('size'), shapes = checked('shape');
      var inStockOnly = form.querySelector('[name="stock"]').checked;
      var maxPrice = Number(priceRange.value);
      if (priceOut) priceOut.textContent = S.money(maxPrice);

      var shown = 0;
      cards.forEach(function (card) {
        var d = card.dataset;
        var text = (d.name + ' ' + d.collection + ' ' + d.shape + ' ' + d.colors + ' ' + (d.keywords || '')).toLowerCase();
        var ok = (!q || text.indexOf(q) !== -1) &&
          anyOf(collections, [d.collection]) &&
          anyOf(colors, d.colors.split(',')) &&
          anyOf(sizes, d.sizes.split(',')) &&
          anyOf(shapes, [d.shape]) &&
          (!inStockOnly || d.stock === 'in') &&
          Number(d.price) <= maxPrice;
        card.hidden = !ok;
        if (ok) shown++;
      });

      cards.slice().sort(sorters[sortSelect.value] || sorters.featured)
        .forEach(function (card) { grid.appendChild(card); });

      document.querySelectorAll('[data-count]').forEach(function (el) { el.textContent = shown; });
      document.querySelector('[data-no-results]').hidden = shown > 0;
    };

    form.addEventListener('input', apply);
    form.addEventListener('reset', function () { setTimeout(function () { if (searchInput) searchInput.value = ''; apply(); }, 0); });
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    if (searchInput) searchInput.addEventListener('input', apply);
    sortSelect.addEventListener('change', apply);
    document.querySelectorAll('[data-clear-filters]').forEach(function (b) {
      b.addEventListener('click', function () { form.reset(); });
    });

    /* mobile: filters open as a bottom sheet */
    var closeFilters = function () { form.classList.remove('is-open'); };
    document.querySelectorAll('[data-open-filters]').forEach(function (b) {
      b.addEventListener('click', function () { form.classList.add('is-open'); S.showOverlay(closeFilters); });
    });
    form.querySelectorAll('[data-close-filters]').forEach(function (b) {
      b.addEventListener('click', function () { S.closePanel(); });
    });

    apply();
  }

  /* ======================= PRODUCT PAGE ======================= */
  var pdps = document.querySelectorAll('.pdp');
  if (pdps.length) {
    /* Show the product named in the URL (product.html?id=p03); default to the first */
    var current = document.querySelector('.pdp[data-id="' + params.get('id') + '"]') || pdps[0];
    pdps.forEach(function (p) { p.hidden = p !== current; });
    document.title = current.dataset.name + ' | ' + (document.body.dataset.brand || '');
    document.querySelectorAll('[data-current-name]').forEach(function (el) { el.textContent = current.dataset.name; });
    document.querySelectorAll('[data-current-price]').forEach(function (el) { el.textContent = S.money(Number(current.dataset.price)); });
    if (current.dataset.stock !== 'in') {
      document.querySelectorAll('.buybar [data-add]').forEach(function (b) { b.disabled = true; });
    }

    /* Gallery: thumbnails swap the main photo; click or move to zoom */
    current.addEventListener('click', function (e) {
      var thumb = e.target.closest('[data-thumb]');
      if (thumb) {
        var main = current.querySelector('[data-main-img]');
        var img = thumb.querySelector('img');
        main.src = img.getAttribute('src');
        main.alt = img.alt;
        main.parentElement.classList.remove('is-missing');
        current.querySelectorAll('[data-thumb]').forEach(function (t) { t.setAttribute('aria-pressed', t === thumb ? 'true' : 'false'); });
        return;
      }
      var frame = e.target.closest('.gallery__main');
      if (frame) { frame.classList.toggle('is-zoomed'); moveZoom(frame, e); return; }

      /* Colour and size options */
      var opt = e.target.closest('[data-color], [data-size]');
      if (opt) {
        var group = opt.closest('.option');
        group.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', b === opt ? 'true' : 'false'); });
        var label = group.querySelector('[data-chosen]');
        if (label) label.textContent = opt.dataset.color || opt.dataset.size;
        return;
      }

      /* Quantity */
      var step = e.target.closest('[data-pdp-step]');
      if (step) {
        var input = current.querySelector('[data-pdp-qty]');
        input.value = Math.max(1, Math.min(99, (Number(input.value) || 1) + Number(step.dataset.pdpStep)));
      }
    });

    var moveZoom = function (frame, e) {
      var r = frame.getBoundingClientRect();
      var img = frame.querySelector('img');
      img.style.transformOrigin = ((e.clientX - r.left) / r.width * 100) + '% ' + ((e.clientY - r.top) / r.height * 100) + '%';
    };
    current.querySelectorAll('.gallery__main').forEach(function (frame) {
      frame.addEventListener('pointermove', function (e) { if (frame.classList.contains('is-zoomed')) moveZoom(frame, e); });
      frame.addEventListener('pointerleave', function () { frame.classList.remove('is-zoomed'); });
    });

    /* "You may also like": same collection first, never the current product, four in total */
    var related = Array.prototype.slice.call(document.querySelectorAll('[data-related] [data-product]'));
    var picks = related.filter(function (c) { return c.dataset.id !== current.dataset.id; })
      .sort(function (a, b) {
        return (b.dataset.collection === current.dataset.collection) - (a.dataset.collection === current.dataset.collection);
      }).slice(0, 4);
    related.forEach(function (c) { c.hidden = picks.indexOf(c) === -1; });
    picks.forEach(function (c) { c.parentElement.appendChild(c); });
  }

  /* ======================= LIVE PRICE AND STOCK FROM MONGODB =======================
     Names, photos and words stay in the HTML. Price and stock come from the
     products collection, so a price change or a sold-out product in the admin
     page shows up here without editing the pages. */
  var hosts = document.querySelectorAll('[data-product][data-id]');
  if (hosts.length && S.api) {
    S.api('GET', '/products/status').then(function (res) {
      var live = res.products || {};
      hosts.forEach(function (el) {
        var p = live[el.dataset.id];
        if (!p) return;
        if (Number(el.dataset.price) !== p.price) {
          el.dataset.price = p.price;
          /* the price is the first words of .price / .pdp__price; the crossed-out "was" price stays */
          el.querySelectorAll('.price, .pdp__price').forEach(function (box) {
            var t = box.firstChild;
            if (t && t.nodeType === 3) t.textContent = S.money(p.price) + (/\s$/.test(t.textContent) ? ' ' : '');
          });
        }
        el.dataset.stock = p.stock;
        el.classList.toggle('is-soldout', p.stock !== 'in');
        el.querySelectorAll('[data-add], [data-buy]').forEach(function (b) { b.disabled = p.stock !== 'in'; });
      });
      /* product page: the sticky buy bar follows the product shown */
      var shown = document.querySelector('.pdp:not([hidden])');
      if (shown) {
        document.querySelectorAll('[data-current-price]').forEach(function (el) { el.textContent = S.money(Number(shown.dataset.price)); });
        document.querySelectorAll('.buybar [data-add], .buybar [data-buy]').forEach(function (b) { b.disabled = shown.dataset.stock !== 'in'; });
      }
      /* shop page: re-run the filters so "In stock only" and price sorting use live values */
      if (form) form.dispatchEvent(new Event('input'));
    }, function () { /* keep the HTML values if the server is unreachable */ });
  }
})();

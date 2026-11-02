/* ==========================================================================
   main.js — shared behaviour for every page.
   Functionality only: all words, prices and image paths live in the HTML.
   Exposes a small global helper object, window.Sticky, used by the other files.
   ========================================================================== */
(function () {
  'use strict';

  document.documentElement.classList.add('js');

  /* Motion switch: the visitor can pause all animation (remembered on this device).
     The footer button toggles it; CSS and animations.js read html[data-motion]. */
  var MOTION_KEY = 'sticky_motion';
  var motionOff = false;
  try { motionOff = localStorage.getItem(MOTION_KEY) === 'off'; } catch (e) {}
  if (motionOff) document.documentElement.dataset.motion = 'off';
  document.addEventListener('click', function (e) {
    if (!e.target.closest('[data-motion-toggle]')) return;
    try { localStorage.setItem(MOTION_KEY, motionOff ? 'on' : 'off'); } catch (err) {}
    window.location.reload();
  });
  document.querySelectorAll('[data-motion-toggle]').forEach(function (b) { b.setAttribute('aria-pressed', motionOff ? 'true' : 'false'); });

  /* ---------- localStorage helpers ---------- */
  /* Local copies only, for instant drawing. The real data lives in MongoDB (see api.js). */
  var KEYS = {
    cart: 'sticky_cart',
    wishlist: 'sticky_wishlist',
    user: 'sticky_user'
  };

  function read(key, fallback) {
    try {
      var value = JSON.parse(localStorage.getItem(key));
      return value === null || value === undefined ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* storage full or blocked: the page still works for this visit */ }
    document.dispatchEvent(new CustomEvent('sticky:change', { detail: { key: key } }));
  }

  /* ---------- Settings read from the HTML (<html> and <body> data attributes) ---------- */
  var root = document.documentElement;
  var settings = {
    currency: root.dataset.currency || '',
    locale: root.dataset.locale || 'en-IN',
    freeShippingOver: Number(document.body.dataset.freeShippingOver || 0),
    shippingFee: Number(document.body.dataset.shippingFee || 0)
  };

  function money(amount) {
    return settings.currency + Math.round(amount).toLocaleString(settings.locale);
  }

  /* Dates sent by the server (ISO text) shown the local way: "26 Oct 2026" / "Saturday, 31 Oct" */
  function formatDate(iso) {
    return iso ? new Date(iso).toLocaleDateString(settings.locale, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  }
  function formatEta(iso) {
    return iso ? new Date(iso).toLocaleDateString(settings.locale, { weekday: 'long', day: 'numeric', month: 'short' }) : '';
  }

  /* ---------- Template stamping ----------
     HTML <template> elements hold the markup and wording. JS copies one and
     fills the marked slots:
       data-f="name"        -> text content
       data-f-src="image"   -> img src
       data-f-alt="name"    -> img alt
       data-f-href="href"   -> link href
       data-f-label="name"  -> appended to the existing aria-label
       data-if="in"         -> kept only when data.stock matches            */
  function fill(node, data) {
    var all = [node].concat(Array.prototype.slice.call(node.querySelectorAll('*')));
    all.forEach(function (el) {
      var d = el.dataset;
      if (d.f && data[d.f] !== undefined) el.textContent = data[d.f];
      if (d.fSrc && data[d.fSrc]) el.setAttribute('src', data[d.fSrc]);
      if (d.fAlt && data[d.fAlt]) el.setAttribute('alt', data[d.fAlt]);
      if (d.fHref && data[d.fHref]) el.setAttribute('href', data[d.fHref]);
      if (d.fLabel && data[d.fLabel]) {
        el.setAttribute('aria-label', (el.getAttribute('aria-label') || '') + ' ' + data[d.fLabel]);
      }
      if (d.if && data.stock !== undefined) el.hidden = d.if !== data.stock;
    });
    return node;
  }

  function stamp(templateId, data) {
    var tpl = document.getElementById(templateId);
    if (!tpl) return null;
    return fill(tpl.content.firstElementChild.cloneNode(true), data);
  }

  /* Read a product from the data attributes of its HTML element */
  function productFrom(el) {
    var host = el.closest('[data-product]');
    if (!host) return null;
    var d = host.dataset;
    return {
      id: d.id,
      name: d.name,
      price: Number(d.price),
      image: d.image,
      href: d.href || ('product.html?id=' + d.id),
      color: (d.colors || '').split(',')[0] || '',
      size: (d.sizes || '').split(',')[0] || '',
      stock: d.stock || 'in',
      host: host
    };
  }

  /* ---------- Toast: messages are written in the HTML, picked by key ---------- */
  var toastEl = document.getElementById('toast');
  var toastTimer;
  function toast(key) {
    if (!toastEl) return;
    var found = false;
    toastEl.querySelectorAll('[data-toast]').forEach(function (m) {
      m.hidden = m.dataset.toast !== key;
      if (!m.hidden) found = true;
    });
    if (!found) return;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-on'); }, 2400);
  }

  /* ---------- Panels: cart drawer, wishlist drawer, search, mobile menu ---------- */
  var overlay = document.querySelector('.overlay');
  var openPanelEl = null;
  var lastFocus = null;
  var extraClose = null; // used by the mobile filter sheet

  document.querySelectorAll('[data-panel]').forEach(function (p) { p.inert = true; });

  function openPanel(id) {
    var panel = document.getElementById(id);
    if (!panel) return;
    if (openPanelEl) closePanel(true);
    lastFocus = document.activeElement;
    openPanelEl = panel;
    panel.inert = false;
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    overlay.classList.add('is-on');
    document.body.classList.add('no-scroll');
    var target = panel.querySelector('[data-autofocus]') || panel.querySelector('button, a, input');
    if (target) setTimeout(function () { target.focus(); }, 60);
  }

  function closePanel(keepOverlay) {
    if (openPanelEl) {
      openPanelEl.classList.remove('is-open');
      openPanelEl.setAttribute('aria-hidden', 'true');
      openPanelEl.inert = true;
      openPanelEl = null;
    }
    if (extraClose) { var fn = extraClose; extraClose = null; fn(); }
    if (!keepOverlay) {
      overlay.classList.remove('is-on');
      document.body.classList.remove('no-scroll');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
  }

  /* Lets another script borrow the overlay (the filter sheet does) */
  function showOverlay(onClose) {
    extraClose = onClose;
    overlay.classList.add('is-on');
    document.body.classList.add('no-scroll');
  }

  if (overlay) overlay.addEventListener('click', function () { closePanel(); });

  document.addEventListener('click', function (e) {
    var opener = e.target.closest('[data-open]');
    if (opener) { e.preventDefault(); openPanel(opener.dataset.open); return; }
    if (e.target.closest('[data-close]')) closePanel();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && (openPanelEl || extraClose)) closePanel();
    /* keep Tab inside the open panel */
    if (e.key === 'Tab' && openPanelEl) {
      var items = Array.prototype.filter.call(
        openPanelEl.querySelectorAll('a[href], button:not([disabled]), input, select, textarea'),
        function (el) { return el.offsetParent !== null; }
      );
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ---------- Header: always visible, compact after scrolling ---------- */
  var header = document.querySelector('.header');
  var lastY = window.scrollY;
  var ticking = false;
  var parallax = document.querySelectorAll('[data-depth]');

  function onScroll() {
    var y = window.scrollY;
    if (header) {
      header.classList.toggle('is-scrolled', y > 30);   // the menu bar stays stuck to the top; it only slims down
    }
    lastY = y;
    /* light parallax on the hero notes */
    if (parallax.length && y < window.innerHeight * 1.2) {
      parallax.forEach(function (el) {
        el.style.setProperty('--py', (y * Number(el.dataset.depth)).toFixed(1) + 'px');
      });
    }
    ticking = false;
  }
  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });

  /* Pointer drift on the hero notes (desktop only) */
  var stage = document.querySelector('.hero');
  var calm = motionOff || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (stage && !calm && window.matchMedia('(hover: hover)').matches) {
    var raf = null;
    stage.addEventListener('pointermove', function (e) {
      if (raf) return;
      raf = requestAnimationFrame(function () {
        var r = stage.getBoundingClientRect();
        var dx = (e.clientX - r.left) / r.width - 0.5;
        stage.querySelectorAll('[data-depth]').forEach(function (el) {
          el.style.setProperty('--px', (dx * 90 * Number(el.dataset.depth) * -4).toFixed(1) + 'px');
        });
        raf = null;
      });
    });
  }

  /* ---------- Categories dropdown in the menu bar ---------- */
  document.querySelectorAll('.nav__item').forEach(function (item) {
    var btn = item.querySelector('[aria-expanded]');
    var timer;
    var set = function (open) {
      clearTimeout(timer);
      item.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    var hoveredAt = 0;
    btn.addEventListener('click', function () {
      /* a click right after hover-opening keeps the menu open instead of closing it */
      if (Date.now() - hoveredAt < 600) { set(true); return; }
      set(!item.classList.contains('is-open'));
    });
    if (window.matchMedia('(hover: hover)').matches) {
      item.addEventListener('pointerenter', function () { hoveredAt = Date.now(); set(true); });
      item.addEventListener('pointerleave', function () { timer = setTimeout(function () { set(false); }, 180); });
    }
    item.addEventListener('focusout', function (e) { if (!item.contains(e.relatedTarget)) set(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && item.classList.contains('is-open')) { set(false); btn.focus(); } });
    document.addEventListener('click', function (e) { if (!item.contains(e.target)) set(false); });
  });

  /* ---------- Accordions ---------- */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.accordion__btn');
    if (!btn) return;
    btn.setAttribute('aria-expanded', btn.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
  });

  /* ---------- Form validation ----------
     Rules come from HTML attributes (required, type, minlength, pattern,
     data-match). The error wording is a hidden <p class="field-error"> in
     the same .field, so it is edited in the HTML.                          */
  function validate(form) {
    var ok = true, firstBad = null;
    form.querySelectorAll('input, select, textarea').forEach(function (el) {
      if (el.disabled || el.closest('[hidden]') || el.type === 'hidden') return;
      var value = el.type === 'checkbox' ? (el.checked ? 'on' : '') : el.value.trim();
      var bad = false;
      if (el.required && !value) bad = true;
      else if (value && el.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) bad = true;
      else if (value && el.minLength > 0 && value.length < el.minLength) bad = true;
      else if (value && el.pattern && !(new RegExp('^(?:' + el.pattern + ')$')).test(value)) bad = true;
      else if (el.dataset.match) {
        var other = form.querySelector('[name="' + el.dataset.match + '"]');
        if (other && other.value !== el.value) bad = true;
      }
      var field = el.closest('.field') || el.parentElement;
      var msg = field.querySelector('.field-error');
      if (msg) msg.hidden = !bad;
      if (bad) { el.setAttribute('aria-invalid', 'true'); ok = false; firstBad = firstBad || el; }
      else el.removeAttribute('aria-invalid');
    });
    if (firstBad) firstBad.focus();
    return ok;
  }

  /* Newsletter forms: validate, save the email in MongoDB, then show the thank-you line written in the HTML */
  document.querySelectorAll('[data-newsletter]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!validate(form)) return;
      var button = form.querySelector('[type="submit"]');
      if (button) button.disabled = true;
      window.Sticky.api('POST', '/newsletter', { email: form.email.value.trim(), source: location.pathname })
        .then(function () {
          form.reset();
          var done = form.parentElement.querySelector('[data-newsletter-done]');
          if (done) done.hidden = false;
          toast('newsletter');
        }, function (err) {
          if (err.status === 400) { form.email.setAttribute('aria-invalid', 'true'); toast('fix-form'); }
          else window.Sticky.apiError(err);
        })
        .then(function () { if (button) button.disabled = false; });
    });
  });

  /* ---------- Missing photo helper ----------
     If an image file is not in the images folder yet, show its expected
     path in the frame so it is obvious which photo to add.               */
  function flagMissing(img) {
    var frame = img.parentElement;
    if (frame.tagName === 'A') frame = frame.parentElement;
    if (frame.classList.contains('is-missing')) return;
    frame.classList.add('is-missing');
    frame.dataset.missing = img.getAttribute('src');
  }
  document.addEventListener('error', function (e) {
    if (e.target.tagName === 'IMG') flagMissing(e.target);
  }, true);
  document.querySelectorAll('img').forEach(function (img) {
    if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) flagMissing(img);
  });

  /* ---------- Header counters ---------- */
  function setCount(selector, n) {
    document.querySelectorAll(selector).forEach(function (el) {
      if (el.textContent !== String(n)) {
        el.classList.remove('is-bump');
        void el.offsetWidth;
        el.classList.add('is-bump');
      }
      el.textContent = n;
      el.hidden = n === 0;
    });
  }

  window.Sticky = {
    KEYS: KEYS, read: read, write: write, settings: settings, money: money,
    formatDate: formatDate, formatEta: formatEta,
    fill: fill, stamp: stamp, productFrom: productFrom, toast: toast,
    openPanel: openPanel, closePanel: closePanel, showOverlay: showOverlay,
    validate: validate, setCount: setCount
  };
})();

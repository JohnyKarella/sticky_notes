/* ==========================================================================
   animations.js — motion only: scroll reveals, text animation, carousels,
   tilt, click effects, sticky-note effects and page transitions.
   No words or image paths live here; everything animates what the HTML holds.
   ========================================================================== */
(function () {
  'use strict';
  /* calm   = the visitor pressed "Pause animations" (everything stops)
     gentle = the device asks for reduced motion: the site keeps its fades, floats
              and ticker but drops parallax, tilt and the page wipe            */
  var calm = document.documentElement.dataset.motion === 'off';
  var gentle = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canHover = window.matchMedia('(hover: hover)').matches;

  /* Number the children of [data-index] so the CSS can stagger them (--n) */
  document.querySelectorAll('[data-index]').forEach(function (box) {
    Array.prototype.forEach.call(box.children, function (child, i) { child.style.setProperty('--n', i); });
  });

  /* ---------- Text animation: wrap each word of [data-split] so it can rise ---------- */
  document.querySelectorAll('[data-split]').forEach(function (el) {
    var index = 0;
    var byLetter = el.dataset.split === 'chars';   // data-split="chars": every letter animates on its own
    if (byLetter) {
      /* screen readers get the whole line as one label instead of single letters */
      var copy = el.cloneNode(true);
      copy.querySelectorAll('[aria-hidden="true"]').forEach(function (n) { n.remove(); });
      el.setAttribute('aria-label', copy.textContent.replace(/\s+/g, ' ').trim());
    }
    var walk = function (node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (child) {
        if (child.nodeType === 3) {
          var frag = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) { if (frag.childNodes.length || child.previousSibling) frag.appendChild(document.createTextNode(' ')); return; }
            var outer = document.createElement('span'); outer.className = 'w';
            if (byLetter) {
              Array.prototype.forEach.call(part, function (letter) {
                var c = document.createElement('span'); c.className = 'c'; c.setAttribute('aria-hidden', 'true');
                c.style.setProperty('--i', index++);
                c.textContent = letter;
                outer.appendChild(c);
              });
            } else {
              var inner = document.createElement('span'); inner.className = 'w__i';
              inner.style.setProperty('--i', index++);
              inner.textContent = part;
              outer.appendChild(inner);
            }
            frag.appendChild(outer);
          });
          node.replaceChild(frag, child);
        } else if (child.nodeType === 1 && child.tagName !== 'BR' && !child.hasAttribute('data-nosplit') && child.namespaceURI !== 'http://www.w3.org/2000/svg') { walk(child); }
      });
    };
    walk(el);
  });

  /* ---------- Scroll reveal ----------
     [data-reveal] fades / slides in. [data-stagger] reveals its children one
     after another. After the animation the attribute is removed so hover
     effects written in the CSS take over again.                           */
  document.querySelectorAll('[data-stagger]').forEach(function (group) {
    var kind = group.dataset.stagger || 'up';
    Array.prototype.forEach.call(group.children, function (child) {
      if (!child.hasAttribute('data-reveal')) child.setAttribute('data-reveal', kind);
    });
  });

  var targets = document.querySelectorAll('[data-reveal], [data-split], [data-scene]');
  var show = function (el, order) {
    if (order) el.style.setProperty('--d', order);
    el.classList.add('is-in');
    if (el.hasAttribute('data-reveal')) {
      setTimeout(function () { el.removeAttribute('data-reveal'); el.style.removeProperty('--d'); }, 1700 + (order || 0) * 110);
    }
  };
  if ('IntersectionObserver' in window && !calm) {
    var io = new IntersectionObserver(function (entries) {
      /* items entering together are staggered left to right, top to bottom */
      var batch = entries.filter(function (e) { return e.isIntersecting; })
        .sort(function (a, b) { return (a.boundingClientRect.top - b.boundingClientRect.top) || (a.boundingClientRect.left - b.boundingClientRect.left); });
      batch.forEach(function (entry, i) {
        var el = entry.target;
        show(el, el.dataset.d ? Number(el.dataset.d) : Math.min(i, 7));
        io.unobserve(el);
      });
    }, { threshold: 0, rootMargin: '0px 0px -9% 0px' });
    targets.forEach(function (el) { io.observe(el); });
  } else {
    targets.forEach(function (el) { el.classList.add('is-in'); });
  }
  requestAnimationFrame(function () { document.body.classList.add('is-ready'); });

  /* ---------- Announcement bar: rotate the messages written in the HTML ---------- */
  var notices = document.querySelectorAll('.announce p');
  if (notices.length > 1 && !calm) {
    var current = 0;
    setInterval(function () {
      notices[current].classList.remove('is-on'); notices[current].classList.add('is-off');
      current = (current + 1) % notices.length;
      notices[current].classList.remove('is-off'); notices[current].classList.add('is-on');
    }, 4200);
  }

  /* ---------- Scroll-linked motion: progress bar, parallax, hero fan ---------- */
  var bar = document.querySelector('.progress');
  var parallax = Array.prototype.slice.call(document.querySelectorAll('[data-parallax]'));
  var fan = document.querySelector('.fan');
  var toTop = document.querySelector('[data-totop]');
  var tiltStage = document.querySelector('[data-scroll-tilt]');
  var ticking = false;

  var frame = function () {
    var y = window.scrollY, vh = window.innerHeight;
    if (bar) bar.style.transform = 'scaleX(' + Math.min(1, y / Math.max(1, document.documentElement.scrollHeight - vh)) + ')';
    if (toTop) toTop.classList.toggle('is-on', y > 600);
    if (!calm && !gentle) {
      parallax.forEach(function (el) {
        var r = el.parentElement.getBoundingClientRect();
        if (r.bottom < -100 || r.top > vh + 100) return;
        var offset = ((r.top + r.height / 2) - vh / 2) / vh;      // -0.5 .. 0.5 across the screen
        el.style.transform = 'translate3d(0,' + (offset * Number(el.dataset.parallax || -40)).toFixed(1) + 'px,0) scale(1.14)';
      });
      if (fan) {
        var fr = fan.getBoundingClientRect();
        if (fr.bottom > 0 && fr.top < vh) {
          var t = Math.max(0, Math.min(1, 1 - fr.top / vh));       // 0 when below the fold, 1 at the top
          var cards = fan.querySelectorAll('.fan__card');
          if (cards[0]) { cards[0].style.setProperty('--fr', (-12 + t * 9).toFixed(2) + 'deg'); cards[0].style.setProperty('--fy', (40 - t * 40).toFixed(1) + 'px'); }
          if (cards[2]) { cards[2].style.setProperty('--fr', (12 - t * 9).toFixed(2) + 'deg'); cards[2].style.setProperty('--fy', (40 - t * 40).toFixed(1) + 'px'); }
          if (cards[1]) cards[1].style.setProperty('--fy', (-t * 26).toFixed(1) + 'px');
        }
      }
    }
    /* Hero stage: the big picture starts tilted back and lies flat as it scrolls up the screen */
    if (tiltStage) {
      var sr = tiltStage.getBoundingClientRect();
      if (sr.bottom > 0 && sr.top < vh) {
        var flat = (calm || gentle) ? 1 : Math.max(0, Math.min(1, window.scrollY / (vh * 0.45)));   // tilted at the top of the page, flat after a short scroll
        tiltStage.style.setProperty('--tilt-x', (9 * (1 - flat)).toFixed(2) + 'deg');
        tiltStage.style.setProperty('--tilt-s', (0.96 + 0.04 * flat).toFixed(3));
      }
    }
    ticking = false;
  };
  window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }, { passive: true });
  window.addEventListener('resize', frame);
  frame();
  if (toTop) toTop.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' }); });

  /* ---------- Hero: the dotted grid lights up around the pointer ---------- */
  var heroBox = document.querySelector('[data-hero]');
  if (heroBox && canHover && !calm) {
    var glowFrame = null;
    heroBox.addEventListener('pointermove', function (e) {
      if (glowFrame) return;
      glowFrame = requestAnimationFrame(function () {
        var r = heroBox.getBoundingClientRect();
        heroBox.style.setProperty('--mx', (e.clientX - r.left).toFixed(0) + 'px');
        heroBox.style.setProperty('--my', (e.clientY - r.top).toFixed(0) + 'px');
        glowFrame = null;
      });
    });
  }

  /* ---------- Hero: the last word of the headline swaps like a fresh note ---------- */
  document.querySelectorAll('[data-swap]').forEach(function (box) {
    var words = box.children, i = 0;
    var fit = function () { box.style.setProperty('--w', words[i].offsetWidth + 'px'); };   // the highlight hugs the current word
    fit(); window.addEventListener('load', fit); window.addEventListener('resize', fit);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
    if (words.length < 2 || calm) return;
    setInterval(function () {
      if (document.hidden) return;
      var out = words[i];
      out.classList.remove('is-on'); out.classList.add('is-off');
      i = (i + 1) % words.length;
      words[i].classList.remove('is-off'); words[i].classList.add('is-on');
      fit();
      setTimeout(function () { out.classList.remove('is-off'); }, 750);
    }, 2600);
  });

  /* ---------- Clothesline ticker ----------
     Notes hang from a sagging string and travel in an endless loop. Each note
     rides the curve of the string, leans against its direction of travel, and
     the whole line speeds up (or runs backwards) with the page scroll.     */
  document.querySelectorAll('[data-line-ticker]').forEach(function (box) {
    if (calm) return;
    var track = box.querySelector('.line-ticker__track');
    var group = track.children[0];
    var ticks = Array.prototype.slice.call(track.querySelectorAll('.tick'));
    var PERIOD = 600;                      // distance between pegs on the string (matches the SVG pattern)
    var x = 0, loop = 1, centres = [], boost = 0, lastScroll = window.scrollY, lastTime = 0, visible = true, lean = 0;
    var measure = function () {
      loop = group.getBoundingClientRect().width;
      centres = ticks.map(function (t) { return t.offsetLeft + t.offsetWidth / 2; });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('load', measure);
    box.classList.add('is-live');
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (e) { visible = e[0].isIntersecting; }).observe(box);
    }
    var run = function (now) {
      requestAnimationFrame(run);
      var dt = Math.min(50, now - (lastTime || now)); lastTime = now;
      var sy = window.scrollY; boost += (sy - lastScroll) * 0.09; lastScroll = sy; boost *= 0.93;
      if (!visible) return;
      var v = -(0.75 + boost);             // pixels per 16 ms; negative = leftwards
      x += v * dt / 16.7;
      if (x <= -loop) x += loop; else if (x > 0) x -= loop;
      track.style.transform = 'translate3d(' + x.toFixed(2) + 'px,0,0)';
      lean += ((Math.max(-9, Math.min(9, -v * 1.6))) - lean) * 0.08;
      box.style.setProperty('--lean', lean.toFixed(2) + 'deg');
      for (var i = 0; i < ticks.length; i++) {
        var u = ((((centres[i] + x) % PERIOD) + PERIOD) % PERIOD) / PERIOD;
        ticks[i].style.setProperty('--sag', (104 * u * (1 - u) - 4).toFixed(1) + 'px');
      }
    };
    requestAnimationFrame(run);
  });

  /* ---------- Coupon: copy the code written in the HTML ---------- */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-copy]');
    if (!btn) return;
    var done = function () { if (window.Sticky) window.Sticky.toast('copied'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(btn.dataset.copy).then(done, done);
    else done();
  });

  /* ---------- Footer letters: click one and it peels off, then a fresh one sticks on ---------- */
  document.addEventListener('click', function (e) {
    var letter = e.target.closest('.letter');
    if (!letter || calm || letter.classList.contains('is-peeled')) return;
    letter.classList.add('is-peeled');
    letter.addEventListener('animationend', function () { letter.classList.remove('is-peeled'); }, { once: true });
  });

  /* ---------- Carousels: arrows, drag to scroll, progress, optional autoplay ---------- */
  document.querySelectorAll('[data-carousel]').forEach(function (box) {
    var track = box.querySelector('[data-track]');
    var prev = box.querySelector('[data-prev]'), next = box.querySelector('[data-next]');
    var fill = box.querySelector('[data-progress]');
    if (!track) return;
    var step = function () {
      var first = track.children[0];
      var gap = parseFloat(getComputedStyle(track).columnGap) || 16;
      return first ? first.getBoundingClientRect().width + gap : track.clientWidth * 0.8;
    };
    var update = function () {
      var max = track.scrollWidth - track.clientWidth;
      if (prev) prev.disabled = track.scrollLeft <= 4;
      if (next) next.disabled = track.scrollLeft >= max - 4;
      if (fill) {
        var share = Math.min(1, track.clientWidth / track.scrollWidth);
        fill.style.width = (share * 100) + '%';
        fill.style.transform = 'translateX(' + ((max > 0 ? track.scrollLeft / max : 0) * (100 / share - 100)) + '%)';
      }
    };
    /* Glide: every move is one eased animation (no abrupt snapping) */
    var gliding = null;
    var glide = function (to, duration) {
      var max = track.scrollWidth - track.clientWidth;
      to = Math.max(0, Math.min(max, to));
      if (calm) { track.scrollLeft = to; return; }
      cancelAnimationFrame(gliding);
      track.classList.add('is-gliding');
      var from = track.scrollLeft, start = null;
      var tick = function (now) {
        if (start === null) start = now;
        var p = Math.min(1, (now - start) / duration);
        var eased = p < 0.5 ? 16 * p * p * p * p * p : 1 - Math.pow(-2 * p + 2, 5) / 2;   // ease-in-out quint
        track.scrollLeft = from + (to - from) * eased;
        if (p < 1) gliding = requestAnimationFrame(tick);
        else track.classList.remove('is-gliding');
      };
      gliding = requestAnimationFrame(tick);
    };
    var snapped = function (left) { var s = step(); return Math.round(left / s) * s; };
    var go = function (dir) {
      var perView = Math.max(1, Math.floor(track.clientWidth / step()) - (track.clientWidth < 700 ? 0 : 1));
      glide(snapped(track.scrollLeft) + dir * step() * perView, 1100);
    };
    if (prev) prev.addEventListener('click', function () { go(-1); });
    if (next) next.addEventListener('click', function () { go(1); });
    track.addEventListener('scroll', function () { requestAnimationFrame(update); }, { passive: true });
    window.addEventListener('resize', update);
    update();

    /* drag with the mouse, with momentum on release; a drag must not count as a click */
    var down = false, startX = 0, startLeft = 0, moved = false, lastX = 0, lastT = 0, speed = 0;
    track.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      cancelAnimationFrame(gliding); track.classList.remove('is-gliding');
      down = true; moved = false; startX = lastX = e.clientX; startLeft = track.scrollLeft; lastT = performance.now(); speed = 0;
    });
    window.addEventListener('pointermove', function (e) {
      if (!down) return;
      var dx = e.clientX - startX;
      if (Math.abs(dx) > 6 && !moved) { moved = true; track.classList.add('is-dragging'); }
      if (!moved) return;
      var now = performance.now();
      speed = 0.75 * speed + 0.25 * ((lastX - e.clientX) / Math.max(1, now - lastT));   // px per ms, smoothed
      lastX = e.clientX; lastT = now;
      track.scrollLeft = startLeft - dx;
    });
    window.addEventListener('pointerup', function () {
      if (!down) return;
      down = false;
      if (moved) {
        track.classList.remove('is-dragging');
        glide(snapped(track.scrollLeft + speed * 320), 950);
      }
    });
    track.addEventListener('click', function (e) { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
    track.addEventListener('dragstart', function (e) { e.preventDefault(); });
    track.addEventListener('wheel', function () { cancelAnimationFrame(gliding); track.classList.remove('is-gliding'); }, { passive: true });
    track.addEventListener('touchstart', function () { cancelAnimationFrame(gliding); track.classList.remove('is-gliding'); }, { passive: true });

    /* autoplay (data-autoplay="4500"), paused while the pointer or focus is inside */
    var delay = Number(box.dataset.autoplay || 0), paused = false;
    if (delay && !calm) {
      box.addEventListener('pointerenter', function () { paused = true; });
      box.addEventListener('pointerleave', function () { paused = false; });
      box.addEventListener('focusin', function () { paused = true; });
      box.addEventListener('focusout', function () { paused = false; });
      setInterval(function () {
        var r = box.getBoundingClientRect();
        if (paused || down || document.hidden || r.bottom < 0 || r.top > window.innerHeight) return;
        if (track.scrollLeft >= track.scrollWidth - track.clientWidth - 4) glide(0, 1600);
        else glide(snapped(track.scrollLeft) + step(), 1300);
      }, delay);
    }
  });

  /* ---------- Tilt: cards lean toward the pointer ---------- */
  if (canHover && !calm && !gentle) {
    document.querySelectorAll('[data-tilt]').forEach(function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        el.style.setProperty('--ry', (((e.clientX - r.left) / r.width - 0.5) * 9).toFixed(2) + 'deg');
        el.style.setProperty('--rx', (((e.clientY - r.top) / r.height - 0.5) * -9).toFixed(2) + 'deg');
      });
      el.addEventListener('pointerleave', function () { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); });
    });
  }

  /* ---------- Click effects ---------- */
  document.addEventListener('pointerdown', function (e) {
    var el = e.target.closest('.btn, .pill, .chip, .tile, .arrow-btn');
    if (!el || calm || el.disabled) return;
    var r = el.getBoundingClientRect();
    var dot = document.createElement('span');
    dot.className = 'ripple';
    dot.style.left = (e.clientX - r.left) + 'px';
    dot.style.top = (e.clientY - r.top) + 'px';
    el.appendChild(dot);
    dot.addEventListener('animationend', function () { dot.remove(); });
  });

  /* Add to cart: a small sticky note flies from the button to the cart icon */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-add]');
    if (!btn || btn.disabled || calm || !document.body.animate) return;
    var cart = document.querySelector('.header [data-open="cart-drawer"]');
    if (!cart) return;
    var from = btn.getBoundingClientRect(), to = cart.getBoundingClientRect();
    var note = document.createElement('span');
    note.className = 'fly';
    document.body.appendChild(note);
    var x0 = from.left + from.width / 2 - 23, y0 = from.top + from.height / 2 - 23;
    var x1 = to.left + to.width / 2 - 23, y1 = to.top + to.height / 2 - 23;
    note.animate([
      { transform: 'translate(' + x0 + 'px,' + y0 + 'px) rotate(0deg) scale(1)', opacity: 1 },
      { transform: 'translate(' + ((x0 + x1) / 2) + 'px,' + (Math.min(y0, y1) - 90) + 'px) rotate(-200deg) scale(.9)', opacity: 1, offset: 0.55 },
      { transform: 'translate(' + x1 + 'px,' + y1 + 'px) rotate(-380deg) scale(.25)', opacity: 0.2 }
    ], { duration: 850, easing: 'cubic-bezier(.22,.8,.22,1)' }).onfinish = function () { note.remove(); };
  }, true);

  /* Celebration: a shower of little notes on the pages marked data-confetti */
  var party = function () {
    if (calm) return;
    for (var i = 0; i < 36; i++) {
      var bit = document.createElement('span');
      bit.className = 'confetti c' + (i % 6);
      bit.style.left = (Math.random() * 100) + 'vw';
      bit.style.setProperty('--dx', (Math.random() * 240 - 120) + 'px');
      bit.style.setProperty('--rot', (Math.random() * 900 - 450) + 'deg');
      bit.style.animationDuration = (2.2 + Math.random() * 2.2) + 's';
      bit.style.animationDelay = (Math.random() * 0.9) + 's';
      document.body.appendChild(bit);
      bit.addEventListener('animationend', function (ev) { ev.target.remove(); });
    }
  };
  document.querySelectorAll('[data-confetti]').forEach(function (el) {
    if (!el.hidden) { setTimeout(party, 700); return; }
    new MutationObserver(function (list, obs) { if (!el.hidden) { party(); obs.disconnect(); } })
      .observe(el, { attributes: true, attributeFilter: ['hidden'] });
  });

  /* ---------- Page transition: the note covers the page before leaving ---------- */
  var veil = document.querySelector('.veil');
  if (veil && !calm) {
    document.addEventListener('click', function (e) {
      var link = e.target.closest('a[href]');
      if (!link || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      if (link.target === '_blank' || link.hasAttribute('download')) return;
      var url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;                                   // mailto:, tel:, other sites
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;  // same page (#anchors)
      e.preventDefault();
      veil.classList.add('is-leaving');
      setTimeout(function () { window.location.href = link.href; }, 480);
    });
    /* coming back with the browser's Back button: lift the note again */
    window.addEventListener('pageshow', function (e) { if (e.persisted) veil.classList.remove('is-leaving'); });
  }
})();

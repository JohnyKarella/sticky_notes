/* ==========================================================================
   reviews.js — customer reviews on the product page, saved in MongoDB.
   The markup and wording are the <template id="tpl-review..."> blocks in
   product.html. Real reviews appear at the top of the "Reviews" panel.
   ========================================================================== */
(function () {
  'use strict';
  var S = window.Sticky;
  var pdp = document.querySelector('.pdp:not([hidden])');
  if (!pdp || !S.api) return;

  /* the panel under the "Reviews (...)" accordion button of this product */
  var panel = null;
  pdp.querySelectorAll('.accordion__btn').forEach(function (btn) {
    if (/review/i.test(btn.textContent)) panel = btn.closest('h3').nextElementSibling.firstElementChild;
  });
  if (!panel) return;

  var id = pdp.dataset.id;
  var list = document.createElement('div');
  list.className = 'review-list';
  panel.insertBefore(list, panel.firstChild);

  function addReview(r, atTop) {
    var node = S.stamp('tpl-review', { title: r.title, body: r.body, name: r.name, rating: String(r.rating) });
    if (!node) return;
    var v = node.querySelector('[data-verified]');
    if (v) v.hidden = !r.verified;
    if (atTop) list.insertBefore(node, list.firstChild); else list.appendChild(node);
  }

  function showForm(user, alreadyReviewed) {
    var old = panel.querySelector('.review-form');
    if (old) old.remove();
    if (!user) {
      var link = S.stamp('tpl-review-signin', { href: 'signin.html?next=' + encodeURIComponent('product.html?id=' + id) });
      if (link) panel.appendChild(link);
      return;
    }
    var form = S.stamp('tpl-review-form', {});
    if (!form) return;
    panel.appendChild(form);
    if (alreadyReviewed) {
      form.querySelectorAll('.field, [type="submit"]').forEach(function (el) { el.hidden = true; });
      form.querySelector('[data-review-taken]').hidden = false;
      return;
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!S.validate(form)) return;
      var button = form.querySelector('[type="submit"]');
      button.disabled = true;
      S.api('POST', '/products/' + encodeURIComponent(id) + '/reviews', {
        rating: Number(form.rating.value), title: form.title.value.trim(), body: form.body.value.trim()
      }).then(function (res) {
        addReview(res.review, true);
        showForm(user, true);
        S.toast('review');
      }, function (err) {
        button.disabled = false;
        if (err.code === 'already_reviewed') showForm(user, true);
        else S.apiError(err);
      });
    });
  }

  Promise.all([S.api('GET', '/products/' + encodeURIComponent(id) + '/reviews'), S.ready]).then(function (r) {
    var reviews = r[0].reviews || [];
    reviews.forEach(function (rev) { addReview(rev, false); });
    showForm(r[1], reviews.some(function (rev) { return rev.mine; }));
  }, function () { /* reviews stay as written in the HTML if the server is unreachable */ });
})();

/* gogh — the add to cart form, dressed (James: 'its pretty ugly').
 * WooCommerce's own form keeps doing the work: its select still holds the
 * choice and its scripts still find the variation. On top: each choice is a
 * chip, the quantity is a stepper as tall as the button, the button says
 * what it is waiting for instead of fading out, and the price at the top
 * becomes the chosen size's price instead of a second price below. */
(function () {
  var T = window.goghCartForm || {};
  var MAX_CHIPS = 12; // longer lists stay a (dressed) dropdown

  function txt(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  function chips(form, sel) {
    var opts = [].filter.call(sel.options, function (o) { return o.value; });
    if (!opts.length || opts.length > MAX_CHIPS) return null;
    var row = document.createElement('div');
    row.className = 'gogh-cf-chips';
    row.setAttribute('role', 'radiogroup');
    var lab = form.querySelector('label[for="' + sel.id + '"]');
    if (lab) {
      if (!lab.id) lab.id = 'gogh-cf-l-' + sel.id;
      row.setAttribute('aria-labelledby', lab.id);
    }
    sel.classList.add('gogh-cf-hidden');
    sel.setAttribute('tabindex', '-1');
    sel.setAttribute('aria-hidden', 'true');
    sel.parentNode.insertBefore(row, sel);
    var sync = function () {
      // Woo rewrites the options as choices narrow: mirror what it offers
      var live = {};
      [].forEach.call(sel.options, function (o) { if (o.value) live[o.value] = o; });
      [].forEach.call(row.children, function (c) {
        var o = live[c.dataset.value];
        var off = !o || o.disabled || (o.className && !/\benabled\b/.test(o.className));
        var on = sel.value === c.dataset.value;
        c.classList.toggle('is-on', on);
        c.setAttribute('aria-checked', on ? 'true' : 'false');
        c.classList.toggle('is-off', !!off);
        c.setAttribute('aria-disabled', off ? 'true' : 'false');
        c.tabIndex = on || (!sel.value && c === row.firstElementChild) ? 0 : -1;
      });
    };
    opts.forEach(function (o) {
      var c = document.createElement('button');
      c.type = 'button';
      c.className = 'gogh-cf-chip';
      c.setAttribute('role', 'radio');
      c.dataset.value = o.value;
      c.textContent = txt(o.textContent);
      row.appendChild(c);
    });
    var pick = function (c) {
      if (!c || c.classList.contains('is-off')) return;
      sel.value = sel.value === c.dataset.value ? '' : c.dataset.value; // a second press clears it
      if (window.jQuery) window.jQuery(sel).trigger('change');
      else sel.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
    };
    row.addEventListener('click', function (ev) { pick(ev.target.closest('.gogh-cf-chip')); });
    row.addEventListener('keydown', function (ev) {
      var dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
      if (!dir) return;
      ev.preventDefault();
      var list = [].filter.call(row.children, function (c) { return !c.classList.contains('is-off'); });
      var at = list.indexOf(document.activeElement);
      var next = list[(at + dir + list.length) % list.length];
      if (next) { next.focus(); pick(next); }
    });
    sel.addEventListener('change', sync);
    sync();
    return sync;
  }

  function stepper(form) {
    var q = form.querySelector('.quantity');
    var input = q && q.querySelector('input.qty');
    if (!input || input.type === 'hidden' || q.querySelector('.gogh-cf-step')) return;
    q.classList.add('gogh-cf-qty');
    var mk = function (d, label) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'gogh-cf-step';
      b.textContent = d < 0 ? '−' : '+';
      b.setAttribute('aria-label', label);
      b.addEventListener('click', function () {
        var step = parseFloat(input.step) || 1, min = parseFloat(input.min), max = parseFloat(input.max);
        var v = (parseFloat(input.value) || 0) + d * step;
        if (!isNaN(min)) v = Math.max(min, v);
        if (!isNaN(max) && max > 0) v = Math.min(max, v);
        input.value = v;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        if (window.jQuery) window.jQuery(input).trigger('change');
      });
      return b;
    };
    q.insertBefore(mk(-1, T.less || 'One fewer'), input);
    q.appendChild(mk(1, T.more || 'One more'));
  }

  function dress(form) {
    if (form.classList.contains('gogh-cf')) return;
    form.classList.add('gogh-cf');
    // the stepper and the chips take the corners of the theme's own button
    var btn = form.querySelector('.single_add_to_cart_button');
    if (btn) {
      var bs = getComputedStyle(btn);
      form.style.setProperty('--gogh-cf-r', bs.borderRadius || '0px');
      var bg = bs.backgroundColor;
      if (bg && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(bg)) {
        form.style.setProperty('--gogh-cf-on', bg);
        form.style.setProperty('--gogh-cf-ink', bs.color);
      }
      if (btn.offsetHeight >= 40) form.style.setProperty('--gogh-cf-h', btn.offsetHeight + 'px');
    }
    stepper(form);
    if (!form.classList.contains('variations_form')) return;
    var sels = form.querySelectorAll('table.variations select');
    var syncs = [];
    [].forEach.call(sels, function (s) { var f = chips(form, s); if (f) syncs.push(f); });
    var syncAll = function () { syncs.forEach(function (f) { f(); }); };
    // the price at the top is the one that changes
    var host = form.closest('.product, .wp-block-woocommerce-single-product, main') || document;
    // the inner element: it wears the block's font size
    var price = host.querySelector('.wp-block-woocommerce-product-price .wc-block-components-product-price') ||
      host.querySelector('.wp-block-woocommerce-product-price, .summary > .price, p.price');
    if (price && form.contains(price)) price = null;

    // the price block may be one WooCommerce redraws itself (an interactive
    // block): it is never touched; a plain copy wearing its classes stands in
    // while a choice is made, and steps out when the choice is cleared
    var priceAlt = null;
    var showPrice = function (html) {
      if (!price) return;
      if (!priceAlt) {
        priceAlt = price.cloneNode(false);
        [].slice.call(priceAlt.attributes).forEach(function (a) { if (/^data-wp-|^aria-live|^aria-atomic/.test(a.name)) priceAlt.removeAttribute(a.name); });
        priceAlt.classList.add('gogh-cf-price');
        priceAlt.setAttribute('aria-live', 'polite');
        price.parentNode.insertBefore(priceAlt, price.nextSibling);
      }
      priceAlt.innerHTML = html;
      price.style.display = 'none';
    };
    var hidePrice = function () {
      if (!price) return;
      price.style.display = '';
      if (priceAlt) { priceAlt.remove(); priceAlt = null; }
    };
    // the button says what it is waiting for, and asks rather than alerts
    var label = btn ? btn.textContent : '';
    var names = [].map.call(form.querySelectorAll('table.variations th label, table.variations .label label'), function (l) { return txt(l.textContent).toLowerCase(); });
    var waiting = names.length === 1 ? (T.chooseOne || 'Choose a %s').replace('%s', names[0]) : (T.chooseMany || 'Choose your options');
    var mark = function () {
      if (!btn) return;
      var needs = btn.classList.contains('wc-variation-selection-needed');
      var gone = btn.classList.contains('wc-variation-is-unavailable');
      form.classList.toggle('gogh-cf-needs', needs);
      btn.textContent = needs ? waiting : (gone ? (T.unavailable || 'Not available') : label);
    };
    if (btn) {
      btn.addEventListener('click', function (ev) {
        if (!btn.classList.contains('wc-variation-selection-needed')) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        var first = form.querySelector('.gogh-cf-chips');
        var empty = [].filter.call(sels, function (s) { return !s.value; })[0];
        var row = empty ? (empty.previousElementSibling && empty.previousElementSibling.classList.contains('gogh-cf-chips') ? empty.previousElementSibling : empty) : first;
        if (row) {
          row.classList.remove('gogh-cf-nudge');
          void row.offsetWidth;
          row.classList.add('gogh-cf-nudge');
          var f = row.querySelector ? (row.querySelector('.gogh-cf-chip:not(.is-off)') || row) : row;
          if (f.focus) f.focus();
        }
      }, true);
      new MutationObserver(mark).observe(btn, { attributes: true, attributeFilter: ['class'] });
      mark();
    }
    if (window.jQuery) {
      var $f = window.jQuery(form);
      $f.on('woocommerce_update_variation_values reset_data', syncAll);
      $f.on('found_variation show_variation', function (e, v) {
        syncAll();
        if (price && v && v.price_html) {
          var tmp = document.createElement('div');
          tmp.innerHTML = v.price_html;
          var inner = tmp.querySelector('.price');
          showPrice(inner ? inner.innerHTML : tmp.innerHTML);
          form.classList.add('gogh-cf-price-up');
        }
      });
      $f.on('hide_variation reset_data', function () {
        hidePrice();
        form.classList.remove('gogh-cf-price-up');
      });
    }
    // Woo's Clear link is the chips' second press now
    var clear = form.querySelector('.reset_variations');
    if (clear && syncs.length === sels.length) clear.classList.add('gogh-cf-hidden');
  }

  function run(scope) {
    [].forEach.call((scope || document).querySelectorAll('form.cart'), function (f) {
      if (f.closest('.gogh-editing, [contenteditable]')) return;
      dress(f);
    });
  }
  // Woo wires the variation form on ready; the chips follow it
  if (window.jQuery) window.jQuery(function () { run(); });
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { run(); });
  else run();
  window.goghCartForm = Object.assign(T, { run: run });
})();

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

  // ---------- a sized product's card: its sizes, and Add to cart in place ----------
  function card(opts) {
    if (opts.dataset.goghOn) return;
    opts.dataset.goghOn = '1';
    var vars = [];
    try { vars = JSON.parse(opts.dataset.vars || '[]'); } catch (e) { return; }
    var wrap = opts.nextElementSibling;
    var btn = wrap && wrap.querySelector('.wc-block-components-product-button__button, a, button');
    if (!btn) return;
    var span = btn.querySelector('span') || btn;
    var linkText = span.textContent;
    // the chips line up as the button does (centred on a card, left in a
    // Lookbook page or a list)
    var ai = getComputedStyle(wrap).alignItems;
    opts.style.justifyContent = /center/.test(ai) ? 'center' : /end/.test(ai) ? 'flex-end' : 'flex-start';
    // the picked chip wears the theme's own button colour
    var bs = getComputedStyle(btn);
    if (bs.backgroundColor && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(bs.backgroundColor)) {
      opts.style.setProperty('--gogh-card-on', bs.backgroundColor);
      opts.style.setProperty('--gogh-card-ink', bs.color);
    }
    var label = opts.dataset.label || '';
    var waiting = label ? (T.chooseOne || 'Choose a %s').replace('%s', label) : (T.chooseMany || 'Choose your options');
    var addText = T.addToCart || 'Add to cart';
    var chosen = null, busy = false;
    var match = function (value) {
      return vars.filter(function (v) { return v.value === value || v.value === ''; })[0] || null;
    };
    [].forEach.call(opts.children, function (c) {
      var v = match(c.dataset.value);
      if (!v || !v.stock) { c.classList.add('is-off'); c.setAttribute('aria-disabled', 'true'); }
    });
    // the card's own price line shows the chosen size's price, through a
    // stand-in (a price block may be one WooCommerce redraws itself)
    var li = opts.closest('li, .wc-block-product, .product') || opts.parentNode;
    var price = li.querySelector('.wc-block-components-product-price');
    var priceAlt = null;
    var showPrice = function () {
      if (!price) return;
      if (!chosen) {
        price.style.display = '';
        if (priceAlt) { priceAlt.remove(); priceAlt = null; }
        return;
      }
      if (!priceAlt) {
        priceAlt = price.cloneNode(false);
        [].slice.call(priceAlt.attributes).forEach(function (a) { if (/^data-wp-/.test(a.name)) priceAlt.removeAttribute(a.name); });
        priceAlt.setAttribute('aria-live', 'polite');
        price.parentNode.insertBefore(priceAlt, price.nextSibling);
      }
      priceAlt.textContent = chosen.price;
      price.style.display = 'none';
    };
    var paint = function () {
      [].forEach.call(opts.children, function (c) {
        var on = !!chosen && c.dataset.value === chosen.value;
        c.classList.toggle('is-on', on);
        c.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      showPrice();
      if (busy) return;
      span.textContent = chosen ? addText : waiting;
      opts.parentNode.classList.toggle('gogh-card-needs', !chosen);
    };
    opts.addEventListener('click', function (ev) {
      var c = ev.target.closest('.gogh-card-chip');
      if (!c || c.classList.contains('is-off') || busy) return;
      ev.preventDefault();
      ev.stopPropagation();
      var v = match(c.dataset.value);
      chosen = chosen && chosen.value === c.dataset.value ? null : (v && Object.assign({}, v, { value: c.dataset.value }));
      paint();
    });
    // the press is caught on its way DOWN, before Woo's own handler on the
    // link (it would open the product)
    wrap.addEventListener('click', function (ev) {
      if (!btn.contains(ev.target)) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (busy) return;
      if (!chosen) {
        opts.classList.remove('gogh-cf-nudge');
        void opts.offsetWidth;
        opts.classList.add('gogh-cf-nudge');
        var first = opts.querySelector('.gogh-card-chip:not(.is-off)');
        if (first) first.focus();
        return;
      }
      if (!T.ajax) { window.location.href = btn.href || window.location.href; return; }
      busy = true;
      btn.setAttribute('aria-busy', 'true');
      span.textContent = T.adding || 'Adding…';
      var body = new URLSearchParams();
      body.set('product_id', String(chosen.id));
      body.set('quantity', '1');
      fetch(T.ajax.replace('%%endpoint%%', 'add_to_cart'), { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (!res || res.error) throw new Error('not added');
          span.textContent = (T.added || 'Added') + ' \u2713';
          // the theme's cart (classic fragments, or the cart block) catches up
          if (window.jQuery) window.jQuery(document.body).trigger('added_to_cart', [res.fragments || {}, res.cart_hash || '', window.jQuery(btn)]);
          document.body.dispatchEvent(new CustomEvent('wc-blocks_added_to_cart', { bubbles: true, cancelable: true }));
          setTimeout(function () { busy = false; btn.removeAttribute('aria-busy'); paint(); }, 1800);
        })
        .catch(function () {
          busy = false;
          btn.removeAttribute('aria-busy');
          span.textContent = T.failed || linkText;
          setTimeout(function () { window.location.href = btn.href || window.location.href; }, 900);
        });
    }, true);
    paint();
  }

  function run(scope) {
    [].forEach.call((scope || document).querySelectorAll('form.cart'), function (f) {
      if (f.closest('.gogh-editing, [contenteditable]')) return;
      dress(f);
    });
    [].forEach.call((scope || document).querySelectorAll('.gogh-card-opts'), function (o) {
      if (o.closest('.gogh-editing, [contenteditable], .gogh-book-copy, .gogh-lay-stage')) return; // a Lookbook page-turn copy, a Layouts tile
      card(o);
    });
  }
  // Woo wires the variation form on ready; the chips follow it
  if (window.jQuery) window.jQuery(function () { run(); });
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { run(); });
  else run();
  window.goghCartForm = Object.assign(T, { run: run });
})();

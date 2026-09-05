/* gogh · admin — Variations: one modal with a live preview.
 *
 * What varies? Pick Colour, Size, Material or your own; type the options;
 * the storefront selector draws itself beside the form as you type. Every
 * combination becomes a Woo variation at the product's price — silently.
 * Per-product attributes by default (a shop with global ones sees them
 * offered as presets). Woo's own Variations tab stays for the rest.
 */
(function () {
  'use strict';
  var V = window.__goghVariations = {};

  V.PRESETS = [
    { name: 'Colour', values: [], hint: 'Red, Navy, Oat…' },
    { name: 'Size', values: ['S', 'M', 'L'], hint: 'S, M, L, XL' },
    { name: 'Material', values: [], hint: 'Cotton, Linen, Wool…' },
  ];

  // every combination of every attribute that has a name and at least one
  // option — the cartesian product, in the attributes' own order
  V.combos = function (attrs) {
    var live = (attrs || []).filter(function (a) { return a && String(a.name || '').trim() && a.values && a.values.length; });
    if (!live.length) return [];
    var out = [[]];
    live.forEach(function (a) {
      var next = [];
      out.forEach(function (row) {
        a.values.forEach(function (v) {
          next.push(row.concat([{ name: String(a.name).trim(), option: String(v).trim() }]));
        });
      });
      out = next;
    });
    return out;
  };
  V.key = function (combo) {
    return (combo || []).map(function (c) { return String(c.name).trim().toLowerCase() + '=' + String(c.option).trim().toLowerCase(); }).sort().join('|');
  };
  // what to create, what already exists, what no longer matches (kept —
  // an orphan may carry orders; deleting is Woo's screen's job, not ours)
  V.plan = function (attrs, existing, price, prices) {
    var want = V.combos(attrs);
    var have = {};
    (existing || []).forEach(function (v) { have[V.key(v.attributes)] = v; });
    var create = [], keep = [], update = [];
    want.forEach(function (c) {
      var k = V.key(c);
      var p = prices && prices[k] != null && prices[k] !== '' ? String(prices[k]) : String(price == null ? '' : price);
      if (have[k]) {
        // an existing variation keeps its own price unless a price was
        // typed for it here — the product's price never overwrites it
        keep.push(have[k]);
        var typed = prices && prices[k] != null && prices[k] !== '';
        if (typed && String(have[k].regular_price || '') !== String(prices[k])) update.push({ id: have[k].id, regular_price: String(prices[k]) });
      } else {
        create.push({ attributes: c, regular_price: p });
      }
    });
    var wantKeys = want.map(V.key);
    var orphan = (existing || []).filter(function (v) { return wantKeys.indexOf(V.key(v.attributes)) === -1; });
    return { create: create, keep: keep, update: update, orphan: orphan };
  };
  V.priceRange = function (attrs, price, prices) {
    var vals = V.combos(attrs).map(function (c) {
      var k = V.key(c);
      var p = prices && prices[k] != null && prices[k] !== '' ? prices[k] : price;
      return parseFloat(p);
    }).filter(function (n) { return !isNaN(n); });
    if (!vals.length) return null;
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    return { lo: lo, hi: hi };
  };

  // ---------- the screen: only on a product's edit page ----------
  var box = document.getElementById('gogh-variations-box');
  var cfg = window.GOGH_ADMIN;
  if (!box || !cfg) return;

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var money = function (n) {
    var num = parseFloat(n);
    if (isNaN(num)) return '';
    return cfg.currency + num.toFixed(2).replace(/\.00$/, '');
  };
  var api = function (method, path, body) {
    return fetch(cfg.restUrl + path, {
      method: method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error((data && data.message) || ('HTTP ' + res.status));
        return data;
      });
    });
  };

  var state = { attrs: [], existing: [], prices: {}, busy: false, loaded: false };
  var modal = null;

  function open() {
    if (modal) return;
    modal = document.createElement('div');
    modal.className = 'gogh-varmodal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Variations');
    modal.innerHTML =
      '<div class="gogh-var-sheet">' +
      '<header class="gogh-var-head"><div><em class="gogh-var-eyebrow">Variations</em><h2>' + esc(cfg.name || 'This product') + '</h2></div>' +
      '<button type="button" class="gogh-var-close" aria-label="Close">&times;</button></header>' +
      '<div class="gogh-var-body">' +
      '<section class="gogh-var-form">' +
      '<p class="gogh-var-lede">What varies? Pick one or more, then type the options. The shop draws itself on the right as you go.</p>' +
      '<div class="gogh-var-presets"></div>' +
      '<div class="gogh-var-attrs"></div>' +
      '<div class="gogh-var-prices"></div>' +
      '</section>' +
      '<aside class="gogh-var-preview"><em class="gogh-var-eyebrow">How it looks in the shop</em><div class="gogh-var-card"></div></aside>' +
      '</div>' +
      '<footer class="gogh-var-foot"><span class="gogh-var-note"></span><span class="gogh-var-actions">' +
      '<button type="button" class="button gogh-var-cancel">Not now</button>' +
      '<button type="button" class="button button-primary gogh-var-save" disabled>Create variations</button></span></footer>' +
      '</div>';
    document.body.appendChild(modal);
    document.body.classList.add('gogh-varmodal-open');
    modal.querySelector('.gogh-var-close').addEventListener('click', close);
    modal.querySelector('.gogh-var-cancel').addEventListener('click', close);
    modal.addEventListener('click', function (ev) { if (ev.target === modal) close(); });
    document.addEventListener('keydown', onKey);
    modal.querySelector('.gogh-var-save').addEventListener('click', save);
    renderPresets();
    renderAttrs();
    renderPrices();
    renderPreview();
    if (!state.loaded) load();
  }
  function onKey(ev) { if (ev.key === 'Escape' && !state.busy) close(); }
  function close() {
    if (!modal) return;
    document.removeEventListener('keydown', onKey);
    modal.remove();
    modal = null;
    document.body.classList.remove('gogh-varmodal-open');
  }

  // the product as Woo has it now: its variation attributes and its
  // variations (so a second visit edits, never duplicates)
  function load() {
    note('Reading the product…');
    Promise.all([
      api('GET', 'products/' + cfg.productId + '?_fields=id,type,attributes,regular_price,price'),
      api('GET', 'products/' + cfg.productId + '/variations?per_page=100&_fields=id,attributes,regular_price'),
    ]).then(function (r) {
      var product = r[0], vars = r[1];
      state.loaded = true;
      state.existing = Array.isArray(vars) ? vars : [];
      var attrs = (product.attributes || []).filter(function (a) { return a.variation; }).map(function (a) {
        return { name: a.name, values: (a.options || []).slice(), global: !!a.id };
      });
      if (attrs.length) state.attrs = attrs;
      state.existing.forEach(function (v) {
        if (v.regular_price !== '' && v.regular_price != null) state.prices[V.key(v.attributes)] = String(v.regular_price);
      });
      if (product.regular_price && !cfg.price) cfg.price = product.regular_price;
      if (!cfg.price) {
        // a variable product carries no price of its own: new combinations
        // start at the lowest price already on the shelf
        var lows = state.existing.map(function (v) { return parseFloat(v.regular_price); }).filter(function (n) { return !isNaN(n); });
        if (lows.length) cfg.price = String(Math.min.apply(null, lows));
      }
      note('');
      renderPresets(); renderAttrs(); renderPrices(); renderPreview();
    }).catch(function (err) {
      note('Could not read the product: ' + err.message, true);
    });
  }

  function note(text, bad) {
    if (!modal) return;
    var n = modal.querySelector('.gogh-var-note');
    n.textContent = text || '';
    n.classList.toggle('is-bad', !!bad);
  }

  function presetList() {
    var list = V.PRESETS.slice();
    (cfg.globals || []).forEach(function (g) {
      if (!list.some(function (p) { return p.name.toLowerCase() === g.toLowerCase(); })) list.push({ name: g, values: [], hint: '', global: true });
    });
    return list;
  }
  function renderPresets() {
    var row = modal.querySelector('.gogh-var-presets');
    row.innerHTML = presetList().map(function (p) {
      var on = state.attrs.some(function (a) { return a.name.toLowerCase() === p.name.toLowerCase(); });
      return '<button type="button" class="gogh-var-preset' + (on ? ' is-on' : '') + '" data-name="' + esc(p.name) + '">' + esc(p.name) + '</button>';
    }).join('') + '<button type="button" class="gogh-var-preset gogh-var-preset-custom" data-name="">Something else…</button>';
    row.querySelectorAll('.gogh-var-preset').forEach(function (b) {
      b.addEventListener('click', function () {
        var name = b.dataset.name;
        if (name) {
          var have = state.attrs.filter(function (a) { return a.name.toLowerCase() === name.toLowerCase(); })[0];
          if (have) { state.attrs.splice(state.attrs.indexOf(have), 1); }
          else {
            var p = presetList().filter(function (x) { return x.name === name; })[0];
            state.attrs.push({ name: p.name, values: p.values.slice(), hint: p.hint, fresh: true });
          }
        } else {
          state.attrs.push({ name: '', values: [], hint: 'Type an option, press Enter', custom: true, fresh: true });
        }
        renderPresets(); renderAttrs(); renderPrices(); renderPreview();
      });
    });
  }

  function renderAttrs() {
    var wrap = modal.querySelector('.gogh-var-attrs');
    if (!state.attrs.length) {
      wrap.innerHTML = '<p class="gogh-var-empty">Nothing varies yet. Pick something above — Size is the usual first one.</p>';
      return;
    }
    wrap.innerHTML = state.attrs.map(function (a, i) {
      return '<div class="gogh-var-attr" data-i="' + i + '">' +
        '<div class="gogh-var-attr-head">' +
        (a.custom
          ? '<input type="text" class="gogh-var-name" placeholder="What varies? e.g. Scent" value="' + esc(a.name) + '" />'
          : '<strong class="gogh-var-name-fixed">' + esc(a.name) + '</strong>') +
        '<button type="button" class="gogh-var-remove" aria-label="Remove ' + esc(a.name || 'this') + '">Remove</button></div>' +
        '<div class="gogh-var-chips">' +
        a.values.map(function (v, k) {
          return '<span class="gogh-var-chip">' + esc(v) + '<button type="button" class="gogh-var-chip-x" data-k="' + k + '" aria-label="Remove ' + esc(v) + '">&times;</button></span>';
        }).join('') +
        '<input type="text" class="gogh-var-add" placeholder="' + esc(a.values.length ? 'Another…' : (a.hint || 'Type an option, press Enter')) + '" />' +
        '</div></div>';
    }).join('');
    wrap.querySelectorAll('.gogh-var-attr').forEach(function (card) {
      var i = +card.dataset.i, a = state.attrs[i];
      var nameIn = card.querySelector('.gogh-var-name');
      if (nameIn) {
        nameIn.addEventListener('input', function () { a.name = nameIn.value; renderPrices(); renderPreview(); });
        if (a.fresh && a.custom) { nameIn.focus(); }
      }
      var add = card.querySelector('.gogh-var-add');
      var commit = function () {
        var raw = add.value;
        // "S, M, L" lands as three at once
        var parts = raw.split(/[,\n]/).map(function (s) { return s.trim(); }).filter(Boolean);
        var added = false;
        parts.forEach(function (p) {
          if (!a.values.some(function (v) { return v.toLowerCase() === p.toLowerCase(); })) { a.values.push(p); added = true; }
        });
        add.value = '';
        if (added) { renderAttrs(); renderPrices(); renderPreview(); focusAdd(i); }
      };
      add.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ',') { ev.preventDefault(); commit(); }
        if (ev.key === 'Backspace' && !add.value && a.values.length) { a.values.pop(); renderAttrs(); renderPrices(); renderPreview(); focusAdd(i); }
      });
      add.addEventListener('blur', function () { if (add.value.trim()) commit(); });
      if (a.fresh && !a.custom) { add.focus(); }
      a.fresh = false;
      card.querySelectorAll('.gogh-var-chip-x').forEach(function (x) {
        x.addEventListener('click', function () { a.values.splice(+x.dataset.k, 1); renderAttrs(); renderPrices(); renderPreview(); });
      });
      card.querySelector('.gogh-var-remove').addEventListener('click', function () {
        state.attrs.splice(i, 1); renderPresets(); renderAttrs(); renderPrices(); renderPreview();
      });
    });
  }
  function focusAdd(i) {
    var card = modal.querySelector('.gogh-var-attr[data-i="' + i + '"] .gogh-var-add');
    if (card) card.focus();
  }

  // prices: one line by default (every combination at the product's price);
  // the table opens for the maker whose large costs more
  function renderPrices() {
    var wrap = modal.querySelector('.gogh-var-prices');
    var combos = V.combos(state.attrs);
    var save = modal.querySelector('.gogh-var-save');
    var plan = V.plan(state.attrs, state.existing, cfg.price, state.prices);
    save.disabled = !combos.length || state.busy;
    save.textContent = !combos.length ? 'Create variations'
      : plan.create.length && plan.keep.length ? 'Create ' + plan.create.length + ' more' + (plan.update.length ? ' · update prices' : '')
      : plan.create.length ? 'Create ' + plan.create.length + ' variation' + (plan.create.length === 1 ? '' : 's')
      : plan.update.length ? 'Update prices' : 'Nothing to change';
    if (!combos.length) { wrap.innerHTML = ''; return; }
    var custom = Object.keys(state.prices).some(function (k) { return String(state.prices[k]) !== String(cfg.price); });
    var range = V.priceRange(state.attrs, cfg.price, state.prices);
    var head = '<p class="gogh-var-priceline">' +
      '<strong>' + combos.length + ' variation' + (combos.length === 1 ? '' : 's') + '</strong>' +
      (!range ? ', with no price yet' : range.lo === range.hi ? ', each at ' + money(range.lo) : ', from ' + money(range.lo) + ' to ' + money(range.hi)) +
      (combos.length <= 48 ? ' · <button type="button" class="gogh-var-linkbtn gogh-var-prices-toggle">' + (custom || state.pricesOpen ? 'Prices' : 'Some cost more?') + '</button>' : '') +
      '</p>';
    var table = '';
    if (state.pricesOpen && combos.length <= 48) {
      table = '<table class="gogh-var-table"><tbody>' + combos.map(function (c) {
        var k = V.key(c);
        var val = state.prices[k] != null ? state.prices[k] : (cfg.price || '');
        return '<tr><td>' + c.map(function (x) { return esc(x.option); }).join(' <span class="gogh-var-sep">·</span> ') + '</td>' +
          '<td class="gogh-var-pricecell"><span class="gogh-var-sym">' + esc(cfg.currency) + '</span><input type="text" inputmode="decimal" class="gogh-var-price" data-k="' + esc(k) + '" value="' + esc(val) + '" /></td></tr>';
      }).join('') + '</tbody></table>';
    }
    if (plan.orphan.length && !state.busy) {
      note(plan.orphan.length + ' existing variation' + (plan.orphan.length === 1 ? '' : 's') + ' no longer match' + (plan.orphan.length === 1 ? 'es' : '') + ' these options — kept; remove them in the Variations tab below if you want.');
    } else if (!state.busy && state.loaded) note('');
    wrap.innerHTML = head + table;
    var tog = wrap.querySelector('.gogh-var-prices-toggle');
    if (tog) tog.addEventListener('click', function () { state.pricesOpen = !state.pricesOpen; renderPrices(); });
    wrap.querySelectorAll('.gogh-var-price').forEach(function (inp) {
      inp.addEventListener('input', function () {
        state.prices[inp.dataset.k] = inp.value.trim();
        renderPreview();
        var plan2 = V.plan(state.attrs, state.existing, cfg.price, state.prices);
        save.textContent = plan2.create.length ? 'Create ' + plan2.create.length + (plan2.keep.length ? ' more' : ' variation' + (plan2.create.length === 1 ? '' : 's')) + (plan2.update.length ? ' · update prices' : '') : plan2.update.length ? 'Update prices' : 'Nothing to change';
      });
    });
  }

  // the storefront, as Woo will draw it: picture, name, price, one
  // selector per attribute, the button — live
  function renderPreview() {
    var card = modal.querySelector('.gogh-var-card');
    var live = state.attrs.filter(function (a) { return a.name.trim() && a.values.length; });
    var range = V.priceRange(state.attrs, cfg.price, state.prices);
    var price = !range ? (cfg.price ? money(cfg.price) : '') : range.lo === range.hi ? money(range.lo) : money(range.lo) + ' – ' + money(range.hi);
    card.innerHTML =
      (cfg.thumb ? '<img class="gogh-var-thumb" src="' + esc(cfg.thumb) + '" alt="" />' : '<div class="gogh-var-thumb gogh-var-thumb-empty"></div>') +
      '<h3>' + esc(cfg.name || 'Product name') + '</h3>' +
      '<p class="gogh-var-pv-price">' + esc(price) + '</p>' +
      (live.length
        ? '<table class="gogh-var-pv-vars">' + live.map(function (a) {
          return '<tr><th>' + esc(a.name) + '</th><td><select><option value="">Choose an option</option>' +
            a.values.map(function (v) { return '<option>' + esc(v) + '</option>'; }).join('') + '</select></td></tr>';
        }).join('') + '</table>'
        : '<p class="gogh-var-pv-hint">The selector appears here as you add options.</p>') +
      '<span class="gogh-var-pv-btn">Add to cart</span>';
  }

  function save() {
    var plan = V.plan(state.attrs, state.existing, cfg.price, state.prices);
    if (!plan.create.length && !plan.update.length) { close(); return; }
    state.busy = true;
    modal.classList.add('is-busy');
    modal.querySelector('.gogh-var-save').disabled = true;
    note('Creating your variations…');
    var live = state.attrs.filter(function (a) { return a.name.trim() && a.values.length; });
    var attrs = live.map(function (a, i) {
      return { name: a.name.trim(), position: i, visible: true, variation: true, options: a.values.slice() };
    });
    var chunks = [];
    for (var i = 0; i < plan.create.length; i += 50) chunks.push(plan.create.slice(i, i + 50));
    api('PUT', 'products/' + cfg.productId, { type: 'variable', attributes: attrs })
      .then(function () {
        var p = Promise.resolve();
        chunks.forEach(function (chunk) {
          p = p.then(function () { return api('POST', 'products/' + cfg.productId + '/variations/batch', { create: chunk }); });
        });
        if (plan.update.length) p = p.then(function () { return api('POST', 'products/' + cfg.productId + '/variations/batch', { update: plan.update }); });
        return p;
      })
      .then(function () {
        note('Done — reloading…');
        var url = new URL(window.location.href);
        url.searchParams.set('gogh-variations', 'done');
        window.location.href = url.toString();
      })
      .catch(function (err) {
        state.busy = false;
        modal.classList.remove('is-busy');
        modal.querySelector('.gogh-var-save').disabled = false;
        note('That did not save: ' + err.message, true);
      });
  }

  // an unsaved product offers no button yet (the box says why) — the rest
  // of this file must still run
  var openBtn = box.querySelector('.gogh-var-open');
  if (openBtn) openBtn.addEventListener('click', open);
})();

/* gogh · admin — the product form: one scrolling page with an anchored rail.
 *
 * Woo's classic screen keeps every node exactly where its own scripts expect
 * it. Gogh only changes the ORDER (a CSS grid over display:contents — nothing
 * that carries an editor is moved), shows every product-data panel at once
 * under a heading instead of behind tabs, parks whatever other plugins
 * inject under Extensions at the foot, and hangs a rail beside it all that
 * knows where you are and whether the product can sell yet.
 */
(function () {
  'use strict';
  var body = document.getElementById('post-body');
  if (!body || !document.body.classList.contains('gogh-productform')) return;
  var $ = window.jQuery;

  // ---------- the page's order (grid `order`, see gogh-admin.css) ----------
  var ORDER = {
    'titlediv': 10, 'postdivrich': 11, 'postexcerpt': 12,
    'postimagediv': 21, 'woocommerce-product-images': 22,
    'woocommerce-product-data': 31,
    'product_catdiv': 41, 'tagsdiv-product_tag': 42, 'product_branddiv': 43,
  };
  var SIDE = { 'submitdiv': 1, 'gogh-variations': 2 };
  var heading = function (id, text, order, cls) {
    var h = document.createElement('h2');
    h.className = 'gogh-pf-h' + (cls ? ' ' + cls : '');
    h.id = id;
    h.textContent = text;
    h.style.order = String(order);
    return h;
  };
  // the side column: Publish and Variations move (neither carries an
  // editor), the rail joins them, the lot sticks
  var side = document.createElement('div');
  side.className = 'gogh-pf-side';
  body.appendChild(side);
  Object.keys(SIDE).forEach(function (id) {
    var el = document.getElementById(id);
    if (el) { el.style.order = String(SIDE[id]); side.appendChild(el); }
  });
  var rail = document.createElement('nav');
  rail.className = 'gogh-pf-rail';
  rail.setAttribute('aria-label', 'Product sections');
  side.appendChild(rail);

  // every box gets its place; strangers gather under Extensions
  var extras = [];
  [].slice.call(body.querySelectorAll('.postbox, #titlediv, #postdivrich')).forEach(function (el) {
    if (side.contains(el)) return;
    if (ORDER[el.id] != null) { el.style.order = String(ORDER[el.id]); return; }
    el.style.order = '96';
    extras.push(el);
  });
  body.appendChild(heading('gogh-pf-details', 'Details', 9));
  body.appendChild(heading('gogh-pf-images', 'Images', 20));
  body.appendChild(heading('gogh-pf-organise', 'Organise', 40));
  var hasExtras = extras.some(function (el) { return el.offsetParent !== null || !/hide-if-js|closed/.test(el.className); });

  // ---------- the product data box: every panel at once, under a name ----------
  var box = document.getElementById('woocommerce-product-data');
  var PANELS = {
    general_product_data: { name: 'Price', section: 'price' },
    inventory_product_data: { name: 'Stock', section: 'price' },
    shipping_product_data: { name: 'Shipping', section: 'shipping' },
    linked_product_data: { name: 'Related products', section: 'advanced' },
    product_attributes: { name: 'Attributes', section: 'advanced' },
    variable_product_options: { name: 'Variations', section: 'advanced' },
    advanced_product_data: { name: 'Advanced', section: 'advanced' },
    marketplace_suggestions: { hide: true }, // no upsells mid-form
  };
  var SECTIONS = [
    { key: 'details', label: 'Details', anchor: 'gogh-pf-details' },
    { key: 'images', label: 'Images', anchor: 'gogh-pf-images' },
    { key: 'price', label: 'Price & stock', anchor: 'gogh-pf-price' },
    { key: 'shipping', label: 'Shipping', anchor: 'gogh-pf-shipping' },
    { key: 'advanced', label: 'Advanced', anchor: 'gogh-pf-advanced' },
    { key: 'organise', label: 'Organise', anchor: 'gogh-pf-organise' },
    { key: 'extensions', label: 'Extensions', anchor: 'gogh-pf-extensions' },
  ];
  var panelsWrap = box && box.querySelector('.panel-wrap');
  var panels = panelsWrap ? [].slice.call(panelsWrap.querySelectorAll(':scope > .panel')) : [];
  var tabFor = function (panel) { return document.querySelector('.product_data_tabs a[href="#' + panel.id + '"]'); };
  var strangers = [];
  if (panelsWrap) {
    // headings inside the box, before the first panel of each section
    var seen = {};
    panels.forEach(function (p) {
      var meta = PANELS[p.id];
      if (meta && meta.hide) { p.classList.add('gogh-pf-hidden'); return; }
      var section = meta ? meta.section : 'extensions';
      var name = meta ? meta.name : ((tabFor(p) && tabFor(p).textContent.trim()) || p.id);
      if (!seen[section]) {
        seen[section] = true;
        var def = SECTIONS.filter(function (s) { return s.key === section; })[0];
        if (def) panelsWrap.insertBefore(heading(def.anchor, def.label, 0, 'gogh-pf-h-in'), p);
      }
      var sub = document.createElement('h3');
      sub.className = 'gogh-pf-sub';
      sub.textContent = name;
      panelsWrap.insertBefore(sub, p);
      p.__goghSub = sub;
      if (!meta) strangers.push(p);
    });
    // strangers (other plugins' tabs) sit last, under Extensions
    strangers.forEach(function (p) { panelsWrap.appendChild(p.__goghSub); panelsWrap.appendChild(p); });
    var extH = panelsWrap.querySelector('#gogh-pf-extensions');
    if (extH && strangers.length) panelsWrap.insertBefore(extH, strangers[0].__goghSub);
  }
  if (hasExtras && !document.getElementById('gogh-pf-extensions')) body.appendChild(heading('gogh-pf-extensions', 'Extensions', 95));
  else if (hasExtras) body.appendChild(heading('gogh-pf-extensions-2', 'Extensions', 95));

  // a panel shows exactly when Woo would offer its tab (product type,
  // virtual, …) — Woo keeps flipping tabs, gogh keeps re-stacking
  var variationsLoaded = false;
  var stacking = false;
  function stack() {
    if (stacking || !panelsWrap) return;
    stacking = true;
    panels.forEach(function (p) {
      var meta = PANELS[p.id];
      if (meta && meta.hide) return;
      var tab = tabFor(p);
      var li = tab && tab.closest('li');
      // the tab list itself is hidden by gogh, so ask the tab's OWN display —
      // Woo shows and hides tabs inline, by product type
      var show = li ? window.getComputedStyle(li).display !== 'none' : true;
      if (show && p.id === 'variable_product_options' && !variationsLoaded && $) {
        // Woo loads variations on the tab's first click — give it that click
        variationsLoaded = true;
        $(tab).trigger('click');
      }
      if (show) { p.classList.remove('hidden'); p.style.display = 'block'; }
      else { p.style.display = 'none'; }
      if (p.__goghSub) p.__goghSub.style.display = show ? '' : 'none';
    });
    // section headings with nothing visible under them step aside
    ['gogh-pf-shipping', 'gogh-pf-advanced'].forEach(function (id) {
      var h = document.getElementById(id);
      if (!h) return;
      var any = panels.some(function (p) { return PANELS[p.id] && PANELS[p.id].section === (id === 'gogh-pf-shipping' ? 'shipping' : 'advanced') && p.style.display !== 'none'; });
      h.style.display = any ? '' : 'none';
    });
    stacking = false;
    paintRail();
  }
  function afterWoo() {
    stack();
    if (panelsWrap && window.MutationObserver) {
      var mo = new MutationObserver(function () { if (!stacking) stack(); });
      panels.forEach(function (p) { mo.observe(p, { attributes: true, attributeFilter: ['style', 'class'] }); });
      var tabs = document.querySelector('.product_data_tabs');
      if (tabs) mo.observe(tabs, { attributes: true, subtree: true, attributeFilter: ['style', 'class'] });
    }
    if ($) $(document.body).on('woocommerce-product-type-change', function () { setTimeout(stack, 0); });
  }

  // ---------- placeholders that teach ----------
  var price = document.getElementById('_regular_price');
  if (price && !price.placeholder) price.placeholder = '7.50';
  var sale = document.getElementById('_sale_price');
  if (sale && !sale.placeholder) sale.placeholder = 'Only when it is';
  var descHint = document.createElement('p');
  descHint.className = 'gogh-pf-hint gogh-pf-deschint';
  descHint.innerHTML = 'Say what it is, who it is for, and one detail that makes it yours. Forty words is plenty: ' +
    '<em>“Poured on Tuesdays in a kitchen in Frome, this lavender bar is cut by hand and cured for four weeks. It lathers like cream and lasts a month. If you only try one, try this.”</em>';
  var rich = document.getElementById('postdivrich');
  if (rich) { rich.insertBefore(descHint, rich.firstChild); }
  function descEmpty() {
    var ed = window.tinymce && window.tinymce.get('content');
    if (ed && !ed.isHidden()) return !ed.getContent({ format: 'text' }).trim();
    var ta = document.getElementById('content');
    return ta ? !ta.value.trim() : true;
  }
  function paintHint() { descHint.hidden = !descEmpty(); }

  // ---------- the rail: where you are, and whether it can sell ----------
  var links = {};
  function buildRail() {
    rail.innerHTML = '<p class="gogh-pf-status"></p><ol class="gogh-pf-links"></ol>';
    var ol = rail.querySelector('.gogh-pf-links');
    SECTIONS.forEach(function (s) {
      var target = document.getElementById(s.anchor) || document.getElementById(s.anchor + '-2');
      if (!target) return;
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + target.id;
      a.textContent = s.label;
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 60, behavior: 'smooth' });
      });
      li.appendChild(a);
      ol.appendChild(li);
      links[target.id] = li;
    });
  }
  function paintRail() {
    var name = (document.getElementById('title') || {}).value || '';
    var type = (document.getElementById('product-type') || {}).value || 'simple';
    var p = price ? price.value : '';
    var st = rail.querySelector('.gogh-pf-status');
    if (!st) return;
    var ok = name.trim() && (p.trim() || type === 'variable' || type === 'grouped' || type === 'external');
    st.className = 'gogh-pf-status ' + (ok ? 'is-ready' : 'is-waiting');
    st.textContent = ok ? 'Ready to sell — a name and a price is all it takes.'
      : !name.trim() ? 'Needs a name.' : 'Needs a price. A name and a price is all it takes.';
    Object.keys(links).forEach(function (id) {
      var h = document.getElementById(id);
      links[id].style.display = (h && h.style.display === 'none') ? 'none' : '';
    });
  }
  function spy() {
    var top = window.scrollY + 120;
    var current = null;
    Object.keys(links).forEach(function (id) {
      var h = document.getElementById(id);
      if (h && h.style.display !== 'none' && h.getBoundingClientRect().top + window.scrollY <= top) current = id;
    });
    Object.keys(links).forEach(function (id) { links[id].classList.toggle('is-here', id === current); });
  }

  window.__goghProductForm = { stack: stack, paintRail: paintRail, panels: panels, sections: SECTIONS };
  buildRail();
  paintRail();
  ['input', 'change'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      if (e.target && (e.target.id === 'title' || e.target.id === '_regular_price' || e.target.id === 'product-type')) paintRail();
    });
  });
  window.addEventListener('scroll', spy, { passive: true });
  var ready = function () {
    afterWoo();
    paintHint();
    if (window.tinymce) {
      var tryBind = function (n) {
        var ed = window.tinymce.get('content');
        if (ed) { ed.on('keyup change SetContent', paintHint); paintHint(); }
        else if (n > 0) setTimeout(function () { tryBind(n - 1); }, 300);
      };
      tryBind(20);
    }
    var ta = document.getElementById('content');
    if (ta) ta.addEventListener('input', paintHint);
    spy();
  };
  if ($) $(ready); else document.addEventListener('DOMContentLoaded', ready);
})();

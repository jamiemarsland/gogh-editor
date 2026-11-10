/* gogh: Page ▾ on the pages gogh's canvas doesn't edit, the Shop, the
 * posts page (v0.99.784) and product categories and tags (v0.99.785). The same button the editor puts dead centre of
 * the admin bar, and the same list of pages: the header menu's first,
 * then drafts and the rest after a line, Add a page at the end. Choosing a
 * page opens it in the editor; Add a page makes one and opens it the way
 * the editor does (gogh-new + gogh-from, so it arrives announced). The
 * styles are gogh-pagebar.css, shared with the editor. */
(function () {
  'use strict';
  var cfg = window.GOGH_PAGEBAR;
  if (!cfg) return;
  var HOUSE = '<span class="gogh-pagemenu-house" title="Home page"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg><span class="gogh-sr">Home page</span></span>';
  var CHEV = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  var PAGE_IC = '<svg class="gogh-pagebtn-ic" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function hdrs() { return { 'X-WP-Nonce': cfg.nonce, 'Content-Type': 'application/json' }; }
  function editUrl(link, extra) {
    var u = new URL(link, location.href);
    u.searchParams.set('gogh-edit', '1');
    Object.keys(extra || {}).forEach(function (k) { u.searchParams.set(k, extra[k]); });
    u.hash = '';
    return u.toString();
  }

  function start() {
    var root = document.getElementById('wp-admin-bar-root-default');
    if (!root || document.getElementById('wp-admin-bar-gogh-page')) return;
    var li = document.createElement('li');
    li.id = 'wp-admin-bar-gogh-page';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gogh-pagebtn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.title = 'On ' + cfg.name + ' · every page of the site';
    btn.setAttribute('aria-label', (cfg.label || 'Page') + ': ' + cfg.name + '. Every page of the site');
    btn.innerHTML = PAGE_IC + '<span class="gogh-pagebtn-lab">' + esc(cfg.label || 'Page') + '</span>' + (cfg.isFront ? HOUSE : '') + '<span class="gogh-pagebtn-name">' + esc(cfg.name) + '</span>' + CHEV;
    li.appendChild(btn);
    root.appendChild(li);

    // dead centre while it clears both groups of the bar, else in line
    function place() {
      li.classList.add('is-centred');
      var r = li.getBoundingClientRect(), left = 0, right = window.innerWidth;
      document.querySelectorAll('#wp-admin-bar-root-default > li').forEach(function (x) { if (x === li) return; var b = x.getBoundingClientRect(); if (b.width) left = Math.max(left, b.right); });
      document.querySelectorAll('#wp-admin-bar-top-secondary > li').forEach(function (x) { var b = x.getBoundingClientRect(); if (b.width) right = Math.min(right, b.left); });
      if (!r.width || r.left < left + 16 || r.right > right - 16) li.classList.remove('is-centred');
    }
    place();
    window.addEventListener('resize', place);
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(place);
      ['wp-admin-bar-root-default', 'wp-admin-bar-top-secondary'].forEach(function (id) { var el = document.getElementById(id); if (el) ro.observe(el); });
    }

    var menu = null, list = null;
    function close() {
      if (!menu || menu.hidden) return;
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', away, true);
    }
    function away(ev) { if (menu && !menu.contains(ev.target) && !btn.contains(ev.target)) close(); }
    function fetchPages() {
      if (list) return Promise.resolve(list);
      return fetch(cfg.rest + 'wp/v2/pages?context=edit&per_page=100&status=publish,draft,private,future&orderby=menu_order&order=asc&_fields=id,title,link,status', { headers: hdrs(), credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; })
        .then(function (l) {
          list = (Array.isArray(l) ? l : []).map(function (pg) {
            var t = (pg.title && (pg.title.raw != null ? pg.title.raw : pg.title.rendered)) || '';
            return { id: pg.id, name: String(t).replace(/<[^>]*>/g, '').trim() || 'Untitled page', link: pg.link, status: pg.status };
          });
          return list;
        });
    }
    // the pages the header's menu shows, in its order (read from the page)
    function menuOrder() {
      var head = document.querySelector('header.wp-block-template-part') || document.querySelector('header');
      var out = [];
      if (!head) return out;
      head.querySelectorAll('a[href]').forEach(function (a) {
        try { var u = new URL(a.href, location.href); if (u.origin === location.origin) out.push(u.pathname.replace(/\/+$/, '') + u.search); } catch (e) {}
      });
      return out;
    }
    function draw(pages) {
      var order = menuOrder(), inMenu = [], rest = [];
      pages.forEach(function (pg) {
        var k = '';
        try { var u = new URL(pg.link, location.href); k = u.pathname.replace(/\/+$/, '') + u.search; } catch (e) {}
        var at = order.indexOf(k);
        if (+pg.id === +cfg.frontId && at === -1) at = order.indexOf('');
        if (at !== -1) inMenu.push({ pg: pg, at: at }); else rest.push(pg);
      });
      inMenu.sort(function (a, b) { return a.at - b.at; });
      var row = function (pg) {
        var cur = +pg.id === +cfg.currentId, home = +pg.id === +cfg.frontId;
        return '<button type="button" role="option" class="gogh-pagemenu-it' + (cur ? ' is-current' : '') + '" aria-selected="' + cur + '" data-id="' + pg.id + '">' +
          '<span class="gogh-pagemenu-ic">' + (home ? HOUSE : '') + '</span>' +
          '<span class="gogh-pagemenu-name">' + esc(pg.name) +
          (pg.status === 'draft' ? '<span class="gogh-pagemenu-st"> · draft</span>' : pg.status === 'private' ? '<span class="gogh-pagemenu-st"> · private</span>' : pg.status === 'future' ? '<span class="gogh-pagemenu-st"> · scheduled</span>' : '') + '</span>' +
          (cur ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>' : '') + '</button>';
      };
      var html = '';
      if (pages.length > 8) html += '<label class="gogh-pagemenu-find"><span class="gogh-sr">Find a page</span><input type="text" placeholder="Find a page" autocomplete="off"></label>';
      html += '<div class="gogh-pagemenu-list" role="listbox" aria-label="Pages">' + inMenu.map(function (x) { return row(x.pg); }).join('');
      if (inMenu.length && rest.length) html += '<div class="gogh-pagemenu-sep" role="separator"></div>';
      html += rest.map(row).join('');
      if (!pages.length) html += '<div class="gogh-pagemenu-wait">No pages yet.</div>';
      html += '</div>';
      if (cfg.canAdd) html += '<div class="gogh-pagemenu-sep" role="separator"></div><button type="button" class="gogh-pagemenu-add">+ Add a page</button>';
      menu.innerHTML = html;
      menu.querySelectorAll('.gogh-pagemenu-it').forEach(function (b) {
        b.addEventListener('click', function () {
          var pg = pages.filter(function (x) { return +x.id === +b.dataset.id; })[0];
          close();
          if (pg && +pg.id !== +cfg.currentId) location.href = editUrl(pg.link);
        });
      });
      var find = menu.querySelector('.gogh-pagemenu-find input');
      if (find) {
        find.addEventListener('input', function () {
          var q = find.value.trim().toLowerCase();
          menu.querySelectorAll('.gogh-pagemenu-it').forEach(function (b) { b.hidden = !!q && b.querySelector('.gogh-pagemenu-name').textContent.toLowerCase().indexOf(q) === -1; });
        });
        find.focus();
      } else {
        var first = menu.querySelector('.gogh-pagemenu-it.is-current') || menu.querySelector('.gogh-pagemenu-it');
        if (first) first.focus();
      }
      var add = menu.querySelector('.gogh-pagemenu-add');
      if (add) add.addEventListener('click', function () { askTitle(add); });
    }
    // Add a page, in the list itself: a title, then the new page opens in
    // the editor, announced, as from the editor's own Add a page
    function askTitle(add) {
      var box = document.createElement('div');
      box.className = 'gogh-pagemenu-new';
      box.innerHTML = '<input type="text" maxlength="120" placeholder="Page title, e.g. Prices" aria-label="New page title"><button type="button">Add</button>';
      add.replaceWith(box);
      var inp = box.querySelector('input'), go = box.querySelector('button'), busy = false;
      var run = function () {
        var t = inp.value.trim();
        if (!t || busy) return;
        busy = true;
        go.textContent = 'Adding…';
        fetch(cfg.rest + 'wp/v2/pages', { method: 'POST', headers: hdrs(), credentials: 'same-origin', body: JSON.stringify({ title: t, status: 'publish', content: '' }) })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (pg) { location.href = editUrl(pg.link, { 'gogh-new': '1', 'gogh-from': location.pathname + location.search }); })
          .catch(function () { busy = false; go.textContent = 'Add'; inp.setCustomValidity('That page could not be added. Try again.'); inp.reportValidity(); });
      };
      go.addEventListener('click', run);
      inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') run(); });
      inp.addEventListener('input', function () { inp.setCustomValidity(''); });
      inp.focus();
    }
    function open() {
      if (!menu) {
        menu = document.createElement('div');
        menu.className = 'gogh-pagemenu';
        menu.hidden = true;
        document.body.appendChild(menu);
        menu.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { close(); btn.focus(); } });
      }
      var r = btn.getBoundingClientRect();
      menu.style.left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - 288))) + 'px';
      menu.style.top = Math.round(r.bottom + 6) + 'px';
      menu.style.width = '280px';
      menu.innerHTML = '<div class="gogh-pagemenu-wait">Finding your pages…</div>';
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', away, true);
      fetchPages().then(function (pages) { if (!menu.hidden) draw(pages); });
    }
    btn.addEventListener('click', function () { if (menu && !menu.hidden) close(); else open(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

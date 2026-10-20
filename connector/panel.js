
(function () {
  'use strict';
  var H = window.goghHost;
  document.getElementById('gw-root').innerHTML = "<div class=\"w\" id=\"w\">\n  <div class=\"bar\">\n    <select id=\"pages\" aria-label=\"Page\"></select>\n    <span class=\"pill\" id=\"pill\">Live</span>\n    <span class=\"saving\" id=\"saving\" aria-live=\"polite\"></span>\n    <button class=\"go\" id=\"exploreBtn\" type=\"button\" hidden>Explore this section</button><button class=\"chip\" id=\"editor\" type=\"button\">Open the editor</button><button class=\"chip\" id=\"back\" type=\"button\" hidden>Back to the page</button><button class=\"chip\" id=\"changes\" type=\"button\" hidden>0 changes</button><button class=\"chip\" id=\"discard\" type=\"button\" hidden>Throw away changes</button>\n    <button class=\"go\" id=\"publish\" type=\"button\" hidden>Publish</button>\n  </div>\n  <div class=\"ask\" id=\"ask\" role=\"alertdialog\" aria-live=\"assertive\"><span id=\"askText\"></span><button class=\"chip\" id=\"askNo\" type=\"button\">Cancel</button><button class=\"go\" id=\"askYes\" type=\"button\">Yes</button></div>\n  <div class=\"choices\" id=\"choices\" hidden></div><div class=\"log\" id=\"log\" hidden><ol id=\"logList\"></ol><div class=\"logBar\"><button class=\"chip\" id=\"undo\" type=\"button\">Undo the latest</button><button class=\"chip\" id=\"logClose\" type=\"button\">Close</button></div></div><div class=\"stale\" id=\"stale\" hidden>There\u2019s a newer view of this page below. This one no longer takes edits.</div><div class=\"hint\" id=\"hint\">Tap Do it on Claude\u2019s notes, or change things yourself: click any words to type over them, drag a section by its handle to move it.</div>\n  <div class=\"explore\" id=\"explore\" hidden></div><div class=\"pick\" id=\"pick\" hidden>\n    <div class=\"head\"><span id=\"pickTitle\">Add a section</span><button class=\"chip\" id=\"pickClose\" type=\"button\">Cancel</button></div>\n    <div class=\"tabs\" id=\"pickTabs\"></div>\n    <div class=\"grid\" id=\"pickGrid\"></div>\n  </div>\n  <div class=\"stage\" id=\"stage\"><div class=\"msg\" id=\"msg\">Opening your page\u2026</div></div>\n</div>";
  var st = null, busy = 0, frame = null, W = 1280, G = window.goghDraw, info = null;
  // the page and Claude's notes side by side (stacked when the chat is narrow)
  (function besideThePage() {
    var w = document.getElementById('w'), stage = document.getElementById('stage');
    var duo = document.createElement('div'); duo.className = 'duo'; duo.id = 'duo';
    var col = document.createElement('div'); col.className = 'pagecol'; col.id = 'pagecol';
    var th = document.createElement('aside'); th.className = 'thread'; th.id = 'thread'; th.setAttribute('aria-label', 'Claude\u2019s notes');
    th.innerHTML = '<div class="th-head"><span class="me" aria-hidden="true"></span><div><b>Claude</b><small>Your page\u2019s editor</small></div></div>' +
      '<div class="msgs" id="msgs" aria-live="polite"></div>' +
      '<div class="th-foot"><div class="about" id="about" hidden></div><div class="quick"><button class="chip" type="button" id="undoThat">Undo that</button></div>' +
      '<p class="tip">Anything else? Tell Claude in the chat. Tap part of your page first and say \u201cthis\u201d.</p></div>';
    w.insertBefore(duo, stage); col.appendChild(stage); duo.appendChild(col); duo.appendChild(th);
  })();
  (function simplerBar() {
    var bar = document.querySelector('#w > .bar'), pub = document.getElementById('publish');
    var mb = document.createElement('button'); mb.className = 'chip'; mb.id = 'moreBtn'; mb.type = 'button'; mb.textContent = 'More';
    var menu = document.createElement('div'); menu.className = 'moremenu'; menu.id = 'moreMenu'; menu.hidden = true;
    document.getElementById('editor').textContent = 'Edit by hand';
    ['exploreBtn', 'editor', 'changes', 'discard'].forEach(function (id) { var el = document.getElementById(id); if (el) menu.appendChild(el); });
    var sb = document.createElement('button'); sb.className = 'chip'; sb.id = 'sideBtn'; sb.type = 'button'; sb.textContent = 'Full screen'; sb.hidden = true;
    bar.insertBefore(sb, pub);
    bar.appendChild(pub); bar.appendChild(mb); bar.appendChild(menu);
    mb.onclick = function () { menu.hidden = !menu.hidden; sizeUp(); };
    menu.addEventListener('click', function (ev) { if (ev.target.closest('button')) setTimeout(function () { menu.hidden = true; }, 0); });
  })();

  /* ---------- the chat: the loader holds the conversation ---------- */
  var inHost = H.inHost;
  var request = H.request, notify = H.notify;
  H.handle = function (m) {
    var a = m.params || {};
    if (m.method === 'ui/notifications/tool-result' && a.structuredContent && a.structuredContent.preview) open(a.structuredContent);
    else if (m.method === 'ui/notifications/host-context-changed') { theme(a); if (a.displayMode) { full = a.displayMode === 'fullscreen'; layout(); } }
  };
  function theme(ctx) { if (ctx && (ctx.theme === 'dark' || ctx.theme === 'light')) document.documentElement.setAttribute('data-theme', ctx.theme); }
  var lastH = 0;
  function sizeUp() {
    if (!inHost) return;
    var h = Math.ceil(document.getElementById('w').getBoundingClientRect().height) + 4;
    if (Math.abs(h - lastH) < 2) return;
    lastH = h; notify('ui/notifications/size-changed', { height: h });
  }
  // a tool on the site, run through the chat as the signed-in person
  function tool(name, args) {
    busy++; saying('Saving…');
    st && (st.ownAt = Date.now());
    return request('tools/call', { name: name, arguments: Object.assign({ _panel: true }, args) }).then(function (r) {
      busy--;
      if (!r || r.isError) throw new Error((r && r.content && r.content[0] && r.content[0].text) || 'That did not work.');
      return r.structuredContent || {};
    }, function (e) { busy--; throw e; });
  }
  // what the agent knows about the panel. Each update replaces the last, so
  // it is always the whole picture: the page, what the person is pointing
  // at, the changes not live yet, and the latest thing they did
  var lastNote = '';
  function tell(text) { lastNote = text || lastNote; pushContext(); }
  function pushContext() {
    if (!st) return;
    var lines = ['The page panel shows "' + st.page.title + '" (page_id ' + st.page.id + ').'];
    if (st.sel) {
      lines.push('The person is pointing at ' + st.sel.label + ' (section_key ' + (st.sel.key || '-') + ', place ' + st.sel.n + (st.sel.piece ? ', piece ' + st.sel.piece : '') + '). When they say "this", "here" or "it", they mean this.');
    }
    var ch = st.changes || [];
    if (ch.length) lines.push('Changes not live yet (oldest first): ' + ch.map(function (c) { return (c.who === 'you' ? 'the person' : 'you') + ': ' + c.what; }).join('; ') + '.');
    if (ed.notes.length) {
      lines.push('Beside the page the panel shows your notes as a conversation' + (ed.goal ? ' (you read the page for: ' + ed.goal + ')' : '') + ': ' + ed.notes.map(function (n, i) { return (i + 1) + '. ' + n.q + ' (' + (ed.done[i] ? 'done' : ed.skipped[i] ? 'not now' : i === ed.cur ? 'showing now' : 'waiting') + ')'; }).join('; ') + '. When the person taps Do it the panel makes the change; do not make it yourself. If they ask for something else, do it with your tools: the panel shows it in the conversation. For new notes, call gogh_prepare_choices again (it replaces these).');
    } else lines.push('There are no notes beside the page yet. Right after opening a page, or when the person wants it better, read it and look at it as a visitor would and send your notes with gogh_prepare_choices: one card per note, most helpful first, with the goal you read the page for.');
    if (st.exploring && ex) lines.push(st.exploring);
    lines.push('If the person says "explore this", asks for options or versions, or says "more like this", answer by calling gogh_explore for the section they are pointing at (or exploring): 3 to 5 genuinely different versions of its words and up to two dials. The panel shows them; do not change the page yourself.');
    if (lastNote) lines.push('Latest in the panel: ' + lastNote);
    var content = [{ type: 'text', text: lines.join('\n') }];
    if (st.picture) {
      content[0].text += '\nThe picture shows ' + st.picture.label + ' as it looks now.';
      content.push({ type: 'image', data: st.picture.data, mimeType: 'image/jpeg' });
    }
    request('ui/update-model-context', { content: content, structuredContent: { page_id: st.page.id, selected: st.sel || null, changes: ch } }).catch(function () {});
  }

  // the site may name itself http:// or https:// depending on the request:
  // both become the address the chat can reach
  function toPublic(html) {
    var host = st.site_origin.replace(/^https?:\/\//, ''), pub = st.public_origin;
    return html.split('https://' + host).join(pub).split('http://' + host).join(pub)
      .split('https:\\/\\/' + host).join(pub.replace(/\//g, '\\/')).split('http:\\/\\/' + host).join(pub.replace(/\//g, '\\/'));
  }

  /* ---------- the bar ---------- */
  function saying(t) { document.getElementById('saving').textContent = t || ''; }
  function showChanges(list) {
    st.changes = list || [];
    receipts(st.changes);
    var b = document.getElementById('changes'), n = st.changes.length;
    b.hidden = !n || editing;
    b.textContent = n + (n === 1 ? ' change' : ' changes');
    var ol = document.getElementById('logList'); ol.innerHTML = '';
    st.changes.forEach(function (c) {
      var li = document.createElement('li');
      li.innerHTML = '<b></b> <span></span> <i></i>';
      li.querySelector('b').textContent = c.who === 'you' ? 'You' : 'Claude';
      li.querySelector('span').textContent = c.what;
      li.querySelector('i').textContent = c.ago + ' ago';
      ol.appendChild(li);
    });
    if (!n) document.getElementById('log').hidden = true;
    sizeUp();
  }
  function status(pending) {
    st.pending = !!pending;
    var pill = document.getElementById('pill');
    pill.textContent = pending ? 'Changes not live yet' : 'Live';
    pill.classList.toggle('pending', !!pending);
    document.getElementById('discard').hidden = !pending;
    document.getElementById('publish').hidden = !(pending || st.page.status !== 'publish') || !st.can_publish;
    document.getElementById('publish').textContent = 'Publish';
    document.getElementById('publish').classList.toggle('ready', !!pending || st.page.status !== 'publish');
    sizeUp();
  }
  var askFn = null;
  function ask(text, yes, fn) {
    document.getElementById('askText').textContent = text;
    document.getElementById('askYes').textContent = yes;
    document.getElementById('ask').classList.add('on');
    askFn = fn; document.getElementById('askYes').focus(); sizeUp();
  }
  function unask() { document.getElementById('ask').classList.remove('on'); askFn = null; sizeUp(); }
  document.getElementById('askNo').onclick = unask;
  document.getElementById('askYes').onclick = function () { var f = askFn; unask(); if (f) f(); };
  function oops(e) { saying(''); ask(String(e && e.message || e), 'OK', null); document.getElementById('askNo').hidden = true; setTimeout(function () { document.getElementById('askNo').hidden = false; }, 0); }

  document.getElementById('pages').onchange = function () {
    var id = +this.value;
    tool('gogh_open_page', { page_id: id }).then(function (d) { saying(''); open(d); }, oops);
  };
  document.getElementById('exploreBtn').onclick = function () { if (st && st.sel) exploreStart(st.sel.n); };
  document.getElementById('changes').onclick = function () { var l = document.getElementById('log'); l.hidden = !l.hidden; sizeUp(); };
  document.getElementById('logClose').onclick = function () { document.getElementById('log').hidden = true; sizeUp(); };
  document.getElementById('undo').onclick = function () {
    tool('gogh_undo_change', { page_id: st.page.id }).then(function (r) {
      saying(r.undone ? 'Undone: ' + r.undone : 'Nothing to undo.');
      status(!!(r.left));
      tell('The person undid the latest change' + (r.undone ? ' (' + (r.by === 'you' ? 'their own' : 'yours') + ': ' + r.undone + ')' : '') + '.');
      draw();
    }, oops);
  };
  document.getElementById('publish').onclick = function () {
    var ch = (st.changes || []).map(function (c) { return '• ' + (c.who === 'you' ? 'You' : 'Claude') + ': ' + c.what; });
    var q = (st.page.status === 'publish' ? 'Publish these changes? Everyone visiting your site will see them.' : 'Publish this page? Everyone visiting your site will see it.') + (ch.length ? '\n' + ch.join('\n') : '');
    ask(q, 'Publish', function () {
      tool('gogh_publish', { page_id: st.page.id }).then(function () {
        st.page.status = 'publish'; status(false); showChanges([]); saying('It’s live.');
        tell('The person published "' + st.page.title + '" from the page panel.');
      }, oops);
    });
  };
  document.getElementById('discard').onclick = function () {
    ask('Throw away the changes that are not live yet?', 'Throw away', function () {
      tool('gogh_discard_changes', { page_id: st.page.id }).then(function () {
        status(false); showChanges([]); saying('Changes thrown away.'); draw();
        tell('The person threw away the unpublished changes to "' + st.page.title + '".');
      }, oops);
    });
  };

  /* ---------- the page ---------- */
  function open(d) {
    if (!ed.page || ed.page !== d.page.id) resetNotes(d.page.id);
    st = d;
    var sel = document.getElementById('pages');
    sel.innerHTML = '';
    (d.pages || []).forEach(function (p) {
      var o = document.createElement('option'); o.value = p.id; o.textContent = p.title;
      if (p.id === d.page.id) o.selected = true;
      sel.appendChild(o);
    });
    status(d.unpublished_changes);
    showChanges(d.changes || []);
    st.sel = null;
    watch();
    if (G && d.pictures) { G.mediaPool.imgs = d.pictures.imgs || []; G.mediaPool.bgs = d.pictures.bgs || []; G.mediaPool.fetched = true; }
    // sections waiting in words are drawn once the page is on screen, so
    // their names never clash with the sections already there
    st.waiting = (G && d.compose && d.compose.sections && d.compose.sections.length) ? d.compose.sections : null;
    draw();
  }
  // sections the agent described in words: drawn here with gogh's own code,
  // then stored all at once
  function compose(list) {
    saying('Drawing ' + list.length + (list.length === 1 ? ' section…' : ' sections…'));
    var used = {}, blocks = [];
    list.forEach(function (sc) {
      var tpl = null;
      try { tpl = G.fillTake(sc); } catch (e) {}
      if (!tpl) return;
      var scope = nextScope();
      while (used[scope]) scope = nextScope();
      used[scope] = 1;
      try { blocks.push(G.buildSectionBlocksV3(secFrom(tpl, scope))); } catch (e) {}
    });
    tool('gogh_compose_page', { page_id: st.page.id, blocks: blocks }).then(function (r) {
      saying('Drawn. Click any words to change them.'); status(true); st.snapAt = 1; draw();
      tell('The panel drew ' + (r.composed || blocks.length) + ' new section(s) on "' + st.page.title + '" from the description. They are saved, not live yet.');
    }, function (e) { draw(); oops(e); });
  }
  // what each section is and says, for redrawing one in another design
  function reread() {
    return request('tools/call', { name: 'gogh_read_page', arguments: { page_id: st.page.id } }).then(function (r) {
      info = r && r.structuredContent ? r.structuredContent : null;
      return info;
    }).catch(function () { info = null; });
  }
  // one live panel: it watches its page, redraws when someone else (the agent,
  // the editor) changed it — lighting up what changed — and steps aside when
  // a newer panel for the same page opens
  var watching = null;
  function watch() {
    if (watching) clearInterval(watching);
    var m = /gogh-preview=([A-Za-z0-9]+)/.exec(st.preview || '');
    if (!m) return;
    var url = st.public_origin + '/?gogh-state=' + m[1];
    st.stamp = null;
    watching = setInterval(function () {
      if (document.hidden || busy || st.stale) return;
      fetch(url + '&t=' + Date.now(), { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (!d) return;
        if (d.newer) { goStale(); return; }
        if (d.deck) takeDeck(d.deck);
        if (!ed.looked) { ed.looked = true; if (!ed.notes.length) intro(); }
        if (st.seenRound == null) st.seenRound = d.explore ? d.explore.round : 0;
        else if (d.explore) exploreRound(d.explore);
        showChanges(d.changes);
        if (d.pending !== st.pending || (d.status === 'publish') !== (st.page.status === 'publish')) { st.page.status = d.status; status(d.pending); }
        if (st.stamp === null || Date.now() - (st.ownAt || 0) < 6000) { st.stamp = d.stamp; return; } // ours, or the first look
        if (d.stamp === st.stamp) return;
        st.stamp = d.stamp;
        if (editing || (document.activeElement && document.activeElement.isContentEditable)) return; // never under their hands
        st.flash = signatures();
        saying('Updated.');
        draw();
      }).catch(function () {});
    }, 3000);
  }
  function goStale() {
    st.stale = true;
    if (watching) clearInterval(watching);
    document.getElementById('stale').hidden = false;
    document.getElementById('w').classList.add('gw-stale');
    [].forEach.call(document.querySelectorAll('#gw-page [contenteditable]'), function (el) { el.removeAttribute('contenteditable'); });
    sizeUp();
  }
  function secKey(el) { var sc = el.querySelector('[data-gogh-scope]'); return sc ? sc.getAttribute('data-gogh-scope') : 'n' + el.getAttribute('data-gw-sec'); }
  function signatures() {
    var out = {};
    [].forEach.call(document.querySelectorAll('#gw-page [data-gw-sec]'), function (el) { out[secKey(el)] = el.innerText; });
    return out;
  }
  // let the agent see: after a change, a small picture of the section that
  // changed goes into its context (html2canvas, served by the site; the
  // site's pictures come through its CORS route so the canvas stays usable)
  var libP = null;
  function lib() {
    if (window.html2canvas) return Promise.resolve();
    if (!libP) libP = new Promise(function (res, rej) {
      var sc = document.createElement('script');
      sc.src = st.public_origin + '/?gogh-panel=lib';
      sc.onload = res; sc.onerror = function () { libP = null; rej(new Error('no snapshot library')); };
      document.head.appendChild(sc);
    });
    return libP;
  }
  function snap(sec) {
    if (!sec || !st) return;
    var n = sec.getAttribute('data-gw-sec');
    var s2 = info && info.sections ? info.sections.filter(function (x) { return x.key === secKey(sec); })[0] : null;
    var label = s2 && s2.design ? 'the ' + s2.design + ' section (place ' + n + ')' : 'section ' + n;
    lib().then(function () {
      return window.html2canvas(sec, {
        proxy: st.public_origin + '/wp-json/gogh/v1/img', useCORS: false, logging: false, scale: 0.5,
        backgroundColor: getComputedStyle(frame || document.body).backgroundColor || '#ffffff',
        onclone: function (doc) {
          var pg = doc.getElementById('gw-page'); if (pg) pg.style.transform = 'none';
          // html2canvas 1.4 cannot read the color(srgb …) the browser reports
          // for gogh's mixed colours: hand it plain rgb in the copy
          var win = doc.defaultView, root = doc.querySelector('[data-gw-sec="' + n + '"]') || pg;
          var rgb = function (v) {
            return String(v).replace(/color\(srgb\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)(?:\s*\/\s*([\d.]+)(%?))?\)/g, function (m, r, g, b2, a, pc) {
              var c = function (x) { return Math.max(0, Math.min(255, Math.round(parseFloat(x) * 255))); };
              var al = a == null ? 1 : (pc ? parseFloat(a) / 100 : parseFloat(a));
              return 'rgba(' + c(r) + ',' + c(g) + ',' + c(b2) + ',' + al + ')';
            }).replace(/(?:oklch|oklab|lab|lch|color)\([^()]*\)/g, 'rgba(128,128,128,0.5)');
          };
          var props = ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor', 'textDecorationColor', 'backgroundImage', 'boxShadow', 'textShadow', 'fill', 'stroke'];
          if (root && win) [root].concat([].slice.call(root.querySelectorAll('*'))).forEach(function (el) {
            var cs = win.getComputedStyle(el);
            props.forEach(function (pr) { var v = cs[pr]; if (v && /(?:color|oklch|oklab|lab|lch)\(/.test(v)) el.style[pr] = rgb(v); });
            // gogh layers a section's pieces with z-index on grid items;
            // html2canvas only stacks positioned boxes, so position them
            if (cs.zIndex !== 'auto' && cs.position === 'static') el.style.position = 'relative';
          });
          [].forEach.call(doc.querySelectorAll('.gw-tools, .gw-seam, .gw-empty'), function (x) { x.remove(); });
          [].forEach.call(doc.querySelectorAll('.gw-chosen, .gw-flash'), function (x) { x.classList.remove('gw-chosen', 'gw-flash'); });
        },
      });
    }).then(function (canvas) {
      var w = Math.min(720, canvas.width), h = Math.round(canvas.height * w / canvas.width);
      var c2 = document.createElement('canvas'); c2.width = w; c2.height = Math.min(h, 900);
      c2.getContext('2d').drawImage(canvas, 0, 0, w, h);
      st.picture = { label: label, data: c2.toDataURL('image/jpeg', 0.72).split(',')[1] };
      pushContext();
    }).catch(function (e) { try { console.error('gogh snapshot:', e && e.message || e); } catch (x) {} });
  }
  function snapKey(key) {
    var el = null;
    [].forEach.call(document.querySelectorAll('#gw-page [data-gw-sec]'), function (x) { if (!el && secKey(x) === key) el = x; });
    if (el) snap(el);
  }
  function flashChanged() {
    var before = st.flash, snapped = false; st.flash = null;
    if (!before) return;
    [].forEach.call(document.querySelectorAll('#gw-page [data-gw-sec]'), function (el) {
      var k = secKey(el);
      if (before[k] !== el.innerText) {
        el.classList.add('gw-flash'); setTimeout(function () { el.classList.remove('gw-flash'); }, 2600);
        if (!snapped) { snapped = true; snap(el); }
      }
    });
  }
  function draw() {
    var keep = window.scrollY;
    fetch(st.preview + '&t=' + Date.now(), { credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new Error('The page did not load (' + r.status + ').');
      return r.text();
    }).then(function (html) {
      html = toPublic(html);
      // every address in full: a chat may ignore the panel's <base>, and a
      // site-relative picture or font then looks for itself in the chat
      var pub = st.public_origin;
      html = html.replace(/(\s(?:src|href|srcset|poster|data-src)=["'])\/(?!\/)/g, '$1' + pub + '/')
        .replace(/(,\s*)\/(?!\/)(wp-content|wp-includes)/g, '$1' + pub + '/$2')
        .replace(/url\((['"]?)\/(?!\/)/g, 'url($1' + pub + '/');
      var doc = new DOMParser().parseFromString(html, 'text/html');
      // the page's own styles join the panel's (scripts never do); root-
      // relative addresses resolve on the site
      [].forEach.call(document.head.querySelectorAll('[data-gw]'), function (n) { n.remove(); });
      var base = document.createElement('base'); base.href = st.public_origin + '/'; base.target = '_blank'; base.setAttribute('data-gw', '');
      document.head.insertBefore(base, document.head.firstChild);
      var root = doc.querySelector('.wp-site-blocks') || doc.body;
      // every sheet the page wears, wherever WordPress printed it (blocks'
      // styles often land at the foot of the page), except the sections'
      // own, which travel with the page
      [].forEach.call(doc.querySelectorAll('link[rel~="stylesheet"], style'), function (n) {
        if (root !== doc.body && root.contains(n)) return;
        var c = document.importNode(n, true); c.setAttribute('data-gw', '');
        document.head.insertBefore(c, document.getElementById('gw-own'));
      });
      [].forEach.call(root.querySelectorAll('script'), function (n) { n.remove(); });
      var stage = document.getElementById('stage');
      var page = document.createElement('div');
      page.id = 'gw-page';
      page.className = doc.body.className;
      page.appendChild(document.importNode(root, true));
      stage.innerHTML = '';
      stage.appendChild(page);
      frame = page;
      reread().then(function () {
        wire(page);
        flashChanged();
        pins();
        if (st.snapAt) { var at = st.snapAt; st.snapAt = null; var el2 = document.querySelector('#gw-page [data-gw-sec="' + at + '"]'); if (el2) snap(el2); }
        if (st.stale) goStale();
        if (st.waiting) { var l = st.waiting; st.waiting = null; compose(l); }
        if (st.afterDraw) { var fn = st.afterDraw; st.afterDraw = null; fn(); }
      });
      window.scrollTo(0, keep);
    }).catch(oops);
  }
  function fit() {
    if (!frame) return;
    var stage = document.getElementById('stage');
    var k = stage.clientWidth / W;
    frame.style.transform = 'scale(' + k + ')';
    stage.style.height = Math.ceil(frame.scrollHeight * k) + 'px';
    sizeUp();
  }

  // which drawn part is which section: the preview puts <!--gogh-sec:N-->
  // before each top-level block
  function sections(root) {
    var out = [], walk = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT), c, marks = [];
    while ((c = walk.nextNode())) { var m = /^gogh-sec:(\d+|end)$/.exec(c.nodeValue.trim()); if (m) marks.push({ node: c, n: m[1] === 'end' ? 0 : +m[1] }); }
    marks.forEach(function (mk) {
      if (!mk.n) return;
      var el = mk.node.nextSibling;
      while (el && el.nodeType !== 1) { if (el.nodeType === 8 && /gogh-sec:/.test(el.nodeValue)) { el = null; break; } el = el.nextSibling; }
      if (el) { el.setAttribute('data-gw-sec', mk.n); out.push(el); }
    });
    return out;
  }
  function wire(page) {
    // a click on a link inside the page never leaves the panel
    page.addEventListener('click', function (ev) { var a = ev.target.closest && ev.target.closest('a'); if (a) ev.preventDefault(); }, true);
    // point and say: what they click is what "this" means to the agent
    page.addEventListener('click', function (ev) {
      if (!ev.target.closest || ev.target.closest('.gw-tools, .gw-seam, .gw-empty, .gw-pin')) return;
      var sec = ev.target.closest('[data-gw-sec]');
      choose(sec, sec && ev.target.closest('[class*="gogh-el-"]'));
    });
    var secs = sections(page);
    // an empty page: a way in
    if (!secs.length && G) {
      var host = page.querySelector('.wp-block-post-content, .entry-content, main') || page;
      var b = document.createElement('div');
      b.className = 'gw-empty';
      b.innerHTML = '<button type="button">+ Add a section</button>';
      b.querySelector('button').onclick = function () { chooseNew(1); };
      host.appendChild(b);
    }
    secs.forEach(function (el) {
      var n = +el.getAttribute('data-gw-sec');
      if (el.classList.contains('wp-block-gogh-section')) words(el, n);
      tools(el, n, secs.length);
    });
    if (document.fonts) document.fonts.ready.then(fit);
    [].forEach.call(page.querySelectorAll('img'), function (im) { if (!im.complete) im.addEventListener('load', fit); });
    fit();
    setTimeout(fit, 800);
  }
  function choose(sec, el) {
    [].forEach.call(document.querySelectorAll('#gw-page .gw-chosen'), function (x) { x.classList.remove('gw-chosen'); });
    if (!sec) { st.sel = null; document.getElementById('exploreBtn').hidden = true; about(null); pushContext(); return; }
    var n = +sec.getAttribute('data-gw-sec'), key = secKey(sec);
    var s2 = info && info.sections ? info.sections.filter(function (x) { return x.key === key; })[0] || info.sections[n - 1] : null;
    var name = (s2 && s2.design ? 'the ' + s2.design + ' section' : 'section ' + n);
    var head = s2 && s2.pieces ? (s2.pieces.filter(function (p) { return p.role === 'heading'; })[0] || {}).words : '';
    if (head) name += ' ("' + head.slice(0, 50) + '")';
    var piece = null, label = name;
    if (el && el.closest('[data-gw-sec]') === sec) {
      var m = /\bgogh-el-(\d+)\b/.exec(el.className);
      if (m) {
        piece = +m[1];
        var pc = s2 && s2.pieces ? s2.pieces.filter(function (p) { return p.piece === piece; })[0] : null;
        var role = pc ? pc.role : 'piece';
        var words = (el.innerText || '').trim().slice(0, 80);
        label = 'the ' + role + (words ? ' "' + words + '"' : '') + ' in ' + name;
      }
    }
    (piece ? el : sec).classList.add('gw-chosen');
    st.sel = { n: n, key: key.indexOf('gogh-sec') === 0 ? key : null, piece: piece, label: label };
    about(label);
    var eb = document.getElementById('exploreBtn');
    eb.hidden = !(s2 && s2.design) || editing;
    eb.textContent = s2 && s2.design ? 'Explore the ' + s2.design : 'Explore this section';
    sizeUp();
    pushContext();
  }
  // the words: headings, paragraphs and button labels, typed over in place
  function words(sec, n) {
    [].forEach.call(sec.querySelectorAll('[class*="gogh-el-"]'), function (el) {
      if (el.closest('.gogh-widget') || el.closest('[data-gw-sec]') !== sec) return;
      var m = /\bgogh-el-(\d+)\b/.exec(el.className); if (!m) return;
      var piece = +m[1], target = null;
      if (/^(P|H[1-6])$/.test(el.tagName)) target = el;
      else if (el.classList.contains('wp-block-buttons')) target = el.querySelector('.wp-block-button__link');
      if (!target) return;
      target.setAttribute('contenteditable', 'plaintext-only');
      target.setAttribute('spellcheck', 'true');
      var was = null;
      target.addEventListener('focus', function () { was = target.innerText; });
      target.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); target.blur(); }
        if (ev.key === 'Escape') { target.innerText = was; target.blur(); }
      });
      target.addEventListener('blur', function () {
        var now = target.innerText.replace(/ /g, ' ').trim();
        if (was == null || now === was.trim()) return;
        if (!now) { target.innerText = was; return; }
        var sk = secKey(sec);
        tool('gogh_change_words', sk.indexOf('gogh-sec') === 0 ? { page_id: st.page.id, section_key: sk, piece: piece, words: now } : { page_id: st.page.id, section: n, piece: piece, words: now }).then(function (r) {
          saying('Saved. Not live yet.'); status(true); fit(); snap(sec);
          tell('In the page panel the person changed words on "' + st.page.title + '", section ' + n + ': "' + was.trim().slice(0, 80) + '" → "' + now.slice(0, 80) + '".');
        }, function (e) { target.innerText = was; oops(e); });
      });
    });
  }
  // a section's handle: drag to move, or up / down / remove
  var dragFrom = 0;
  function tools(sec, n, count) {
    var doc = document;
    var t = doc.createElement('div'); t.className = 'gw-tools';
    t.setAttribute('contenteditable', 'false');
    var design = G && info && info.sections && info.sections[n - 1] && info.sections[n - 1].design && G.diceFaces(info.sections[n - 1].design);
    var explorable = G && info && info.sections && info.sections[n - 1] && info.sections[n - 1].design;
    t.innerHTML = '<button class="gw-grip" draggable="true" title="Drag to move">⠿</button>' +
      (explorable ? '<button data-a="explore" title="See this section many ways at once">Explore</button>' : '') +
      (design ? '<button data-a="design" title="Try this section in its other designs">Design</button>' : '') +
      (n > 1 ? '<button data-a="up" title="Move up">↑</button>' : '') +
      (n < count ? '<button data-a="down" title="Move down">↓</button>' : '') +
      (count > 1 ? '<button data-a="remove" title="Remove this section">Remove</button>' : '');
    sec.appendChild(t);
    if (G) {
      var seam = doc.createElement('div'); seam.className = 'gw-seam'; seam.setAttribute('contenteditable', 'false');
      seam.innerHTML = '<button type="button">+ Add a section</button>';
      seam.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); chooseNew(n + 1); });
      sec.appendChild(seam);
    }
    t.addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      ev.preventDefault(); ev.stopPropagation();
      var a = b.getAttribute('data-a');
      if (a === 'up') move(n, n - 1);
      if (a === 'down') move(n, n + 1);
      if (a === 'design') chooseDesign(n);
      if (a === 'explore') exploreStart(n);
      if (a === 'remove') { t.classList.add('on'); ask('Remove this section from the page? You can throw the change away until it is published.', 'Remove', function () { remove(n); }); }
    });
    var grip = t.querySelector('.gw-grip');
    grip.addEventListener('dragstart', function (ev) { dragFrom = n; sec.classList.add('gw-dim'); ev.dataTransfer.effectAllowed = 'move'; try { ev.dataTransfer.setData('text/plain', 'gogh-sec-' + n); ev.dataTransfer.setDragImage(sec, 40, 40); } catch (e) {} });
    grip.addEventListener('dragend', function () { sec.classList.remove('gw-dim'); line(doc, null); });
    sec.addEventListener('dragover', function (ev) {
      if (!dragFrom) return;
      ev.preventDefault();
      var r = sec.getBoundingClientRect(), below = ev.clientY > r.top + r.height / 2;
      sec.__gwTo = below ? n + 1 : n;
      line(doc, sec, below);
    });
    sec.addEventListener('drop', function (ev) {
      if (!dragFrom) return;
      ev.preventDefault();
      var from = dragFrom, to = sec.__gwTo || n;
      dragFrom = 0; line(doc, null);
      if (to > from) to--; // the slot below shifts up once the section leaves
      if (to !== from) move(from, to);
    });
  }
  function line(doc, sec, below) {
    var l = doc.querySelector('.gw-drop');
    if (!sec) { if (l) l.remove(); return; }
    if (!l) { l = doc.createElement('div'); l.className = 'gw-drop'; }
    // the line lives in the unscaled page, so measure there
    var y = sec.offsetTop + (below ? sec.offsetHeight : 0);
    var host = sec.offsetParent || frame;
    if (l.parentNode !== host) host.appendChild(l);
    l.style.top = (y - 4) + 'px';
  }
  function move(from, to) {
    tool('gogh_move_section', { page_id: st.page.id, section: from, to: to }).then(function () {
      saying('Moved. Not live yet.'); status(true); st.snapAt = to; draw();
      tell('In the page panel the person moved section ' + from + ' of "' + st.page.title + '" to place ' + to + '.');
    }, oops);
  }
  function remove(n) {
    tool('gogh_remove_section', { page_id: st.page.id, section: n }).then(function () {
      saying('Removed. Not live yet.'); status(true); draw();
      tell('In the page panel the person removed section ' + n + ' of "' + st.page.title + '".');
    }, oops);
  }

  // TEMPORARY probe: what the chat's sandbox blocks, reported to the site
  document.addEventListener('securitypolicyviolation', function (e) {
    if (!st) return;
    try { fetch(st.public_origin + '/?gogh-probe=' + encodeURIComponent(e.violatedDirective + ' ' + e.blockedURI + ' ' + (e.originalPolicy || '').slice(0, 900)), { mode: 'no-cors' }); } catch (x) {}
  });

  /* ---------- the full editor, full screen ---------- */
  // gogh's real editor, in a frame on the site's own address, signed in by a
  // short-lived pass from the connector: drag, resize, pictures, styles —
  // everything the editor does, with no new editing code here
  var editing = false;
  function editorOn(on) {
    editing = on;
    ['pages', 'pill', 'saving', 'discard', 'publish', 'editor'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = on ? 'none' : ''; });
    document.getElementById('back').hidden = !on;
    document.getElementById('w').classList.toggle('editing', on);
    layout();
    document.getElementById('hint').hidden = on;
  }
  function editorHeight() { return Math.max(520, window.innerHeight - document.getElementById('stage').getBoundingClientRect().top - 8); }
  document.getElementById('editor').onclick = function () {
    if (!st) return;
    reread();
    request('ui/request-display-mode', { mode: 'fullscreen' }).catch(function () {});
    saying('Opening the editor…');
    tool('gogh_open_editor', { page_id: st.page.id }).then(function (d) {
      return fetch(d.editor, { credentials: 'omit' }).then(function (r) {
        if (!r.ok) throw new Error('The editor did not load (' + r.status + ').');
        return r.text();
      });
    }).then(function (html) {
      saying('');
      html = toPublic(html);
      var pub = st.public_origin;
      // site-relative addresses in full: the frame has no address of its own
      html = html.replace(/(\s(?:src|href|srcset|poster|action)=["'])\/(?!\/)/g, '$1' + pub + '/')
        .replace(/(,\s*)\/(?!\/)(wp-content|wp-includes)/g, '$1' + pub + '/$2')
        .replace(/url\((['"]?)\/(?!\/)/g, 'url($1' + pub + '/');
      editorOn(true);
      var stage = document.getElementById('stage');
      stage.innerHTML = '';
      var f = document.createElement('iframe');
      f.title = 'gogh editor';
      f.setAttribute('allow', 'clipboard-read; clipboard-write');
      f.style.cssText = 'display:block;width:100%;border:0;height:' + editorHeight() + 'px;background:#fff';
      f.onload = function () { editorWire(f); };
      f.srcdoc = html;
      stage.style.height = 'auto';
      stage.appendChild(f);
      frame = null;
      setTimeout(function () { f.style.height = editorHeight() + 'px'; sizeUp(); }, 400);
      tell('The person opened gogh\'s full editor on "' + st.page.title + '" in the panel. Changes made there are saved by the editor itself; read the page again afterwards.');
    }).catch(oops);
  };
  // inside the editor: Done sits in gogh's own bar (one set of controls, one
  // Publish), and what the person clicks there tells the agent what "this" is
  function editorWire(f) {
    var doc = null;
    try { doc = f.contentDocument; } catch (e) {}
    if (!doc || !doc.body) return; // a chat that seals the frame keeps the panel's own Back
    var tries = 0;
    (function mount() {
      var bar = doc.querySelector('#wp-admin-bar-root-default');
      if (!bar) { if (++tries < 40) setTimeout(mount, 250); return; }
      if (!doc.getElementById('wp-admin-bar-gogh-done')) {
        var li = doc.createElement('li');
        li.id = 'wp-admin-bar-gogh-done';
        li.innerHTML = '<a class="ab-item" href="#" role="button">\u2190 Done</a>';
        li.querySelector('a').addEventListener('click', function (ev) { ev.preventDefault(); document.getElementById('back').click(); });
        bar.insertBefore(li, bar.firstChild);
        var css = doc.createElement('style');
        css.textContent = '#wp-admin-bar-gogh-edit{display:none!important}#wp-admin-bar-gogh-done>a{font-weight:600}';
        doc.head.appendChild(css);
      }
      document.querySelector('#w > .bar').style.display = 'none';
      f.style.height = (window.innerHeight - 8) + 'px';
      sizeUp();
    })();
    doc.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest || t.closest('#wpadminbar, .gogh-elbar, .gogh-panel, .gogh-side')) return;
      var wrap = t.closest('.gogh-wrap');
      if (!wrap) return;
      var scEl = wrap.querySelector('[data-gogh-scope]'), key = scEl ? scEl.getAttribute('data-gogh-scope') : null;
      var s2 = info && info.sections && key ? info.sections.filter(function (x) { return x.key === key; })[0] : null;
      var name = s2 && s2.design ? 'the ' + s2.design + ' section' : 'a section';
      var pieceEl = t.closest('[class*="gogh-el-"]'), m = pieceEl && /\bgogh-el-(\d+)\b/.exec(pieceEl.className);
      var piece = m ? +m[1] : null, pc = piece && s2 && s2.pieces ? s2.pieces.filter(function (p) { return p.piece === piece; })[0] : null;
      var words = pieceEl ? (pieceEl.innerText || '').trim().slice(0, 80) : '';
      st.sel = { n: s2 ? s2.section : 0, key: key, piece: piece, label: piece ? 'the ' + (pc ? pc.role : 'piece') + (words ? ' "' + words + '"' : '') + ' in ' + name + ' (in the full editor)' : name + ' (in the full editor)' };
      pushContext();
    }, true);
  }
  document.getElementById('back').onclick = function () {
    request('ui/request-display-mode', { mode: 'inline' }).then(function (r) { full = !!(r && r.mode === 'fullscreen'); layout(); }, function () {});
    document.querySelector('#w > .bar').style.display = '';
    editorOn(false);
    // what the editor did is on the site now: start from it
    tool('gogh_open_page', { page_id: st.page.id }).then(function (d) { saying(''); open(d); }, function () { draw(); });
  };
  window.addEventListener('resize', function () {
    var f = editing && document.querySelector('#stage iframe');
    if (f) f.style.height = editorHeight() + 'px';
  });

  /* ---------- which do you prefer? ---------- */
  // A beginner edits by choosing: one question at a time, one section shown
  // two ways (A as it is, B a new version), tap the one you like. The agent
  // prepares the questions (gogh_prepare_choices) when it opens the page;
  // the panel starts with ones it can make itself so nothing waits
  function secInfo(key) { return info && info.sections ? info.sections.filter(function (x) { return x.key === key; })[0] : null; }
  function faceNow(s2) { var fs = G.diceFaces(s2.design); return fs && s2.design_take && fs[s2.design_take] ? fs[s2.design_take].take : 'The original'; }
  function headOf(s2) { var h = (s2.pieces || []).filter(function (p) { return p.role === 'heading'; })[0]; return h && h.words ? h.words : s2.design; }
  function cardSec(card, scope) {
    var s2 = secInfo(card.key); if (!s2) return null;
    var spec = Object.assign({ take: s2.design, face: faceNow(s2) }, wordsOf(s2));
    var b = card.b || {};
    Object.keys(b).forEach(function (k) { if (k !== 'ground' && k !== 'after') spec[k] = b[k]; });
    if (b.take && b.take !== s2.design && !b.face) delete spec.face;
    var tpl = null;
    try { tpl = G.fillTake(spec); } catch (e) {}
    if (!tpl) return null;
    var sec = secFrom(tpl, scope);
    if (b.ground === 'dark' && !sec.bgImage) {
      sec.bg = 'var(--wp--preset--color--contrast)';
      sec.els.forEach(function (e) {
        if (e.kids && e.kids.length) return;
        if (e.type === 'button') { if (e.ghost) e.color = 'base'; else { e.btnBg = 'base'; e.btnText = 'contrast'; } }
        else if (e.type === 'heading' || e.type === 'para' || e.type === 'badge') e.color = 'base';
      });
    }
    return sec;
  }
  // A is the section itself, as the page draws it
  function asIs(key) {
    var el = null;
    [].forEach.call(document.querySelectorAll('#gw-page [data-gw-sec]'), function (x) { if (!el && secKey(x) === key) el = x; });
    if (!el) return '';
    var c = el.cloneNode(true);
    [].forEach.call(c.querySelectorAll('.gw-tools, .gw-seam'), function (x) { x.remove(); });
    c.classList.remove('gw-chosen', 'gw-flash');
    [].forEach.call(c.querySelectorAll('[contenteditable]'), function (x) { x.removeAttribute('contenteditable'); });
    return '<div class="thumb live"><div class="gw-stage gw-live">' + c.outerHTML + '</div></div>';
  }
  function keysNow() { return (info && info.sections || []).map(function (x) { return x.key || ('n' + x.section); }); }
  function fitLive() {
    [].forEach.call(document.querySelectorAll('.choices .gw-live, .thread .gw-live'), function (s) {
      var k = s.parentNode.clientWidth / W;
      s.style.transform = 'scale(' + k + ')';
      s.parentNode.style.height = Math.ceil(s.offsetHeight * k) + 'px';
    });
    sizeUp();
  }

  /* ---------- Claude as the page's editor ---------- */
  // Claude reads the page for a goal and sends a few notes, most helpful
  // first (gogh_prepare_choices). They arrive here as a conversation beside
  // the page, numbered on the page too: each with the section now and with
  // the fix, and Do it / Another way / Not now. Every change, whoever made
  // it, gets a receipt here while the page lights it up. What the person
  // wants beyond the notes they say to Claude in the chat itself: the panel
  // never writes in their message box
  var ed = { page: null, notes: [] }, full = false;
  function resetNotes(pageId) {
    ed = { page: pageId, goal: '', notes: [], done: {}, skipped: {}, opt: {}, cur: -1, seen: null, seenCh: null, applying: 0, stack: [], looked: false };
    var m = document.getElementById('msgs'); if (m) m.innerHTML = '';
    layout();
  }
  function layout() {
    var w = document.getElementById('w'); if (!w) return;
    w.classList.toggle('side', window.innerWidth >= 720);
    w.classList.toggle('full', full);
    var sb = document.getElementById('sideBtn');
    if (sb) { sb.hidden = editing; sb.textContent = full ? 'Back to the chat' : 'Full screen'; }
    // in full screen the chat's own message box sits just below the notes:
    // point at it (a panel cannot hold the chat's box, and never types in it)
    var ins = H.context && H.context.safeAreaInsets;
    w.style.setProperty('--gw-safe-b', (ins && ins.bottom > 0 ? ins.bottom : 104) + 'px');
    var tip = document.querySelector('.th-foot .tip');
    if (tip) tip.textContent = full ? 'Anything else? Type to Claude in the box below \u2193 Tap part of your page first and say \u201cthis\u201d.' : 'Anything else? Tell Claude in the chat. Tap part of your page first and say \u201cthis\u201d.';
  }
  document.getElementById('sideBtn').onclick = function () {
    request('ui/request-display-mode', { mode: full ? 'inline' : 'fullscreen' }).then(function (r) {
      full = !!(r && r.mode === 'fullscreen'); layout(); fit(); fitLive(); fitThumbs();
    }, function () {});
  };
  function say(who, html) {
    var box = document.getElementById('msgs');
    var m = document.createElement('div');
    m.className = 'm ' + who;
    m.innerHTML = html;
    box.appendChild(m);
    box.scrollTop = box.scrollHeight;
    fitLive(); fitThumbs(); sizeUp();
    return m;
  }
  function you(text) { say('you', esc(text)); }
  function retire() { [].forEach.call(document.querySelectorAll('#msgs .note button'), function (b) { b.disabled = true; }); }
  function about(label) {
    var a = document.getElementById('about'); if (!a) return;
    a.hidden = !label; a.textContent = label ? 'You’re pointing at ' + label.replace(/ \(in the full editor\)$/, '') : '';
  }
  function intro() {
    say('claude', '<p>I’m your page’s editor. Ask me in the chat what would make this page better: I’ll read it the way a visitor would, and my notes will appear here, numbered on your page.</p>');
  }
  function secName(key) {
    var s2 = secInfo(key); if (!s2) return 'that section';
    var h = headOf(s2);
    return h && h !== s2.design ? '“' + h.slice(0, 40) + (h.length > 40 ? '…' : '') + '”' : 'the ' + (s2.design || 'section');
  }
  // cards that share a section and a question are one note, other ways to fix it
  function takeDeck(dk) {
    if (ed.seen == null) ed.seen = dk.at && (Date.now() / 1000 - dk.at) > 600 ? dk.round : 0;
    if (dk.round <= ed.seen) return;
    ed.seen = dk.round;
    var list = [], at = {};
    (dk.cards || []).forEach(function (c) {
      if (!secInfo(c.key)) return;
      var id = c.key + '|' + c.q;
      if (at[id] == null) { at[id] = list.length; list.push({ key: c.key, q: c.q, hint: c.hint, fixes: [] }); }
      list[at[id]].fixes.push(c);
    });
    if (!list.length) return;
    retire();
    var again = ed.notes.length > 0;
    ed.notes = list; ed.done = {}; ed.skipped = {}; ed.opt = {}; ed.cur = -1; ed.goal = dk.goal || '';
    say('claude', '<p>' + (again ? 'Here are ' + list.length + ' new ' + (list.length === 1 ? 'note' : 'notes') : 'I read your page' + (ed.goal ? ' as someone who wants to ' + esc(ed.goal.replace(/^to /i, '')) : ' the way a visitor would') + '. ' + list.length + (list.length === 1 ? ' thing' : ' things') + ' would help most') + ', most helpful first. They’re numbered on your page too.</p>' +
      '<ol class="list">' + list.map(function (n, i) { return '<li><span class="num">' + (i + 1) + '</span><span>' + esc(n.q) + '</span></li>'; }).join('') + '</ol>');
    pins();
    setTimeout(function () { offer(0); }, 500);
    pushContext();
  }
  function nextNote(from) {
    for (var i = 0; i < ed.notes.length; i++) { var k = (from + i) % ed.notes.length; if (!ed.done[k] && !ed.skipped[k]) return k; }
    return -1;
  }
  function mini(n, f, i) {
    var b = f.b || {};
    if (b.after) {
      var now = keysNow(), moved = now.filter(function (k) { return k !== f.key; }), to = b.after === 'top' ? 0 : moved.indexOf(b.after) + 1;
      moved.splice(Math.max(0, to), 0, f.key);
      return '<div><div class="lab">Now</div>' + outlineOf(now, now.indexOf(f.key)) + '</div><div><div class="lab">With the fix</div>' + outlineOf(moved, moved.indexOf(f.key)) + '</div>';
    }
    // new words read best as words: what it says now, and what it would say
    var was = wordsOf(secInfo(n.key) || {}), rows = '';
    WORD_FIELDS.forEach(function (fl) {
      if (b[fl[0]] == null || b[fl[0]] === was[fl[0]]) return;
      rows += '<div class="wrow"><span class="wlab">' + fl[1] + '</span>' + (was[fl[0]] ? '<s>' + esc(was[fl[0]]) + '</s>' : '<i>Nothing yet</i>') + '<b>' + esc(b[fl[0]]) + '</b></div>';
    });
    var looks = ['take', 'face', 'ground'].some(function (k) { return b[k]; });
    if (!looks) return rows ? '<div class="words">' + rows + '</div>' : '';
    var sec = cardSec(f, 'gw-n' + i + '-' + (ed.opt[i] || 0));
    return '<div><div class="lab">Now</div>' + asIs(n.key) + '</div><div><div class="lab">With the fix</div>' + (sec ? thumb(sec) : '') + '</div>' + (rows ? '<div class="words">' + rows + '</div>' : '');
  }
  var WORD_FIELDS = [['eyebrow', 'Small heading'], ['heading', 'Heading'], ['text', 'Words'], ['text2', 'More words'], ['button', 'Button'], ['button2', 'Second button']];
  function outlineOf(order, hi) {
    return '<div class="outline">' + order.map(function (k, i) { var s2 = secInfo(k); return '<div' + (i === hi ? ' class="hi"' : '') + '>' + (i + 1) + '. ' + esc(s2 ? headOf(s2).slice(0, 30) : k) + '</div>'; }).join('') + '</div>';
  }
  function offer(i) {
    if (i < 0) { finish(); return; }
    var n = ed.notes[i];
    if (!secInfo(n.key)) { ed.skipped[i] = true; offer(nextNote(i + 1)); return; }
    ed.cur = i; pins();
    var f = n.fixes[ed.opt[i] || 0];
    var m = say('claude', '<div class="note"><h4><span class="num">' + (i + 1) + '</span>' + esc(n.q) + '</h4>' + (n.hint ? '<p class="why">' + esc(n.hint) + '</p>' : '') +
      '<p class="why">My suggestion: <b data-label>' + esc(f.lb || 'A new version') + '</b></p><div class="mini" data-mini>' + mini(n, f, i) + '</div>' +
      '<div class="btns"><button class="go" type="button" data-do>Do it</button>' + (n.fixes.length > 1 ? '<button class="chip" type="button" data-other>Another way</button>' : '') + '<button class="chip" type="button" data-not>Not now</button></div></div>');
    m.querySelector('[data-do]').onclick = function () { doIt(i); };
    m.querySelector('[data-not]').onclick = function () {
      retire(); you('Not now'); ed.skipped[i] = true;
      tell('The person said "not now" to your note ' + (i + 1) + ' ("' + n.q + '").');
      offer(nextNote(i + 1));
    };
    var other = m.querySelector('[data-other]');
    if (other) other.onclick = function () {
      ed.opt[i] = ((ed.opt[i] || 0) + 1) % n.fixes.length;
      var f2 = n.fixes[ed.opt[i]];
      m.querySelector('[data-label]').textContent = f2.lb || 'Another version';
      m.querySelector('[data-mini]').innerHTML = mini(n, f2, i);
      fitLive(); fitThumbs(); setTimeout(function () { fitLive(); fitThumbs(); }, 300);
    };
    setTimeout(function () { fitLive(); fitThumbs(); }, 300);
    showOnPage(n.key, false);
    pushContext();
  }
  // a fix is a new look for the section (words, design, ground) and/or a move
  function applyFix(f) {
    var b = f.b || {}, steps = [];
    if (Object.keys(b).some(function (k) { return k !== 'after'; })) steps.push(function () {
      var sec = cardSec(f, f.key);
      if (!sec) throw new Error('That note no longer fits this section.');
      return tool('gogh_replace_section', { page_id: st.page.id, section_key: f.key, blocks: G.buildSectionBlocksV3(sec) });
    });
    if (b.after) steps.push(function () {
      var keys = keysNow().filter(function (k) { return k !== f.key; }), to = b.after === 'top' ? 1 : keys.indexOf(b.after) + 2;
      if (to < 1) throw new Error('The section to move it under is no longer on the page.');
      return tool('gogh_move_section', { page_id: st.page.id, section_key: f.key, to: to });
    });
    ed.applying += steps.length;
    return steps.reduce(function (p, s) { return p.then(s); }, Promise.resolve()).then(function () { return steps.length; });
  }
  function doIt(i) {
    var n = ed.notes[i], f = n.fixes[ed.opt[i] || 0];
    retire(); you(ed.opt[i] ? f.lb : 'Do it');
    applyFix(f).then(function (count) {
      status(true);
      ed.done[i] = true; ed.cur = -1; ed.stack.push({ i: i, count: count }); ed.since = 0;
      var s2 = secInfo(n.key); st.snapAt = s2 ? s2.section : null;
      st.afterDraw = function () {
        say('claude', '<p>Done: ' + esc(f.lb || 'the new version') + '.</p><span class="receipt">Changed ' + esc(secName(n.key)) + ' · not live yet</span>');
        showOnPage(n.key, true);
        setTimeout(function () { offer(nextNote(i + 1)); }, 1400);
      };
      draw();
      tell('The person tapped Do it on your note ' + (i + 1) + ' ("' + n.q + '"): the panel made the change "' + (f.lb || '') + '". It is saved, not live yet.');
    }, function (e) { ed.applying = 0; oops(e); });
  }
  function finish() {
    ed.cur = -1; pins();
    var done = Object.keys(ed.done).length;
    say('claude', '<p>' + (done ? 'That’s my notes done. Have a look, then press <b>Publish</b> when you’re happy.' : 'That’s all my notes for now.') + '</p><p>Want more ideas, or something else changed? Tell me in the chat.</p>');
    pushContext();
  }
  // every change gets a receipt: the notes' own above, everyone else's here
  function receipts(list) {
    var n = list.length;
    if (ed.seenCh == null || n < ed.seenCh) { ed.seenCh = n; return; }
    list.slice(ed.seenCh).forEach(function (c) {
      if (ed.applying > 0) { ed.applying--; return; }
      ed.since = (ed.since || 0) + 1;
      say('line', '<span class="receipt">' + (c.who === 'you' ? 'You' : 'Claude') + ': ' + esc(c.what) + '</span>');
    });
    ed.seenCh = n;
  }
  document.getElementById('undoThat').onclick = function () {
    if (!st) return;
    you('Undo that');
    tool('gogh_undo_change', { page_id: st.page.id }).then(function (r) {
      status(!!r.left);
      if (!r.undone) { say('claude', '<p>There’s nothing to undo.</p>'); return; }
      // a note comes undone only when its own change was the latest
      var top = ed.stack[ed.stack.length - 1];
      if (ed.since > 0) ed.since--;
      else if (top) { top.count--; if (top.count <= 0) { ed.stack.pop(); delete ed.done[top.i]; } }
      say('claude', '<p>Undone: ' + esc(r.undone) + '.</p>');
      st.afterDraw = pins;
      draw();
      tell('The person undid the latest change (' + r.undone + ').');
    }, oops);
  };
  // the notes on the page: a numbered marker on each section a note is about
  function pins() {
    [].forEach.call(document.querySelectorAll('#gw-page .gw-pin'), function (p) { p.remove(); });
    ed.notes.forEach(function (n, i) {
      var el = null;
      [].forEach.call(document.querySelectorAll('#gw-page [data-gw-sec]'), function (x) { if (!el && secKey(x) === n.key) el = x; });
      if (!el) return;
      var others = el.querySelectorAll('.gw-pin').length;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'gw-pin' + (ed.done[i] ? ' done' : '') + (ed.cur === i ? ' now' : '');
      b.setAttribute('contenteditable', 'false');
      b.setAttribute('aria-label', 'Note ' + (i + 1));
      b.textContent = ed.done[i] ? '✓' : String(i + 1);
      b.style.left = (24 + others * 76) + 'px';
      b.onclick = function (ev) { ev.preventDefault(); ev.stopPropagation(); pinTap(i); };
      el.appendChild(b);
    });
  }
  function pinTap(i) {
    if (ed.done[i]) { say('claude', '<p>Note ' + (i + 1) + ' is done. Tap <b>Undo that</b> if it was the latest, or tell me in the chat.</p>'); return; }
    if (ed.cur === i) return;
    retire(); you('Show me note ' + (i + 1)); delete ed.skipped[i]; offer(i);
  }
  // full screen: bring the section into view in the page's own column
  function showOnPage(key, light) {
    var el = null;
    [].forEach.call(document.querySelectorAll('#gw-page [data-gw-sec]'), function (x) { if (!el && secKey(x) === key) el = x; });
    if (!el) return;
    if (light) { el.classList.remove('gw-flash'); void el.offsetWidth; el.classList.add('gw-flash'); setTimeout(function () { el.classList.remove('gw-flash'); }, 2600); }
    var col = document.getElementById('pagecol');
    if (full && col && frame) {
      var k = document.getElementById('stage').clientWidth / W;
      col.scrollTo({ top: Math.max(0, el.offsetTop * k - 40), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  }


  /* ---------- explore this section ---------- */
  // Not one change per message: the agent writes a handful of versions and
  // the dials that tell them apart, once; the panel draws every combination
  // with gogh's own code, so the person plays at full speed and chooses by
  // pointing ('choose, don't describe' — the hero picker, for any section)
  var ex = null;
  var SIZES = ['large', 'x-large', 'xx-large', '__disp-s', '__disp-m'];
  function exploreStart(n) {
    var s2 = info && info.sections && info.sections[n - 1];
    if (!G || !s2 || !s2.design) return;
    var fams = OPENERS.indexOf(s2.design) !== -1 ? OPENERS : [s2.design], faces = [];
    fams.forEach(function (f) {
      var fs = G.diceFaces(f);
      if (!fs) { faces.push({ take: f, face: 'The original' }); return; }
      fs.forEach(function (t, k) { faces.push({ take: f, face: k ? t.take : 'The original' }); });
    });
    var nowFace = s2.design_take ? (G.diceFaces(s2.design) || [])[s2.design_take] : null;
    var cur = { take: s2.design, face: nowFace && nowFace.take ? nowFace.take : 'The original' };
    faces.sort(function (a, b) { return (b.take === cur.take && b.face === cur.face) - (a.take === cur.take && a.face === cur.face); });
    var w0 = wordsOf(s2);
    ex = { n: n, key: s2.key, s: s2, faces: faces, versions: [w0], scores: [], dials: [], loud: null, ground: null, wd: [], round: null, shift: 0, focus: 0, waiting: true };
    exploreDraw();
    window.scrollTo(0, 0);
    // the agent writes the versions; the person can play with designs and
    // dials meanwhile
    var name = 'the ' + s2.design + ' section' + (w0.heading ? ' ("' + w0.heading.slice(0, 60) + '")' : '');
    // what the agent needs rides the panel's context; the message the person
    // sends stays short and in their own words (a chat asks before a panel's
    // message goes, so it must read like something they would say)
    st.exploring = 'The person is exploring ' + name + ' on "' + st.page.title + '" (page_id ' + st.page.id + ', section_key ' + (s2.key || '') + '). Its words now: ' + JSON.stringify(w0) + '. Write 4 genuinely different versions with the same fields, and up to two dials that say how they differ, and send them with gogh_explore.';
    ex.waiting = false; ex.askFirst = true;
    exploreDraw();
    tell('');
  }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function exploreRound(r) {
    if (!r) return;
    if (st.seenRound == null || r.round <= st.seenRound) return;
    st.seenRound = r.round;
    // versions arrived for a section that is not open: open it, filled in
    if (!ex || (ex.key && r.key && r.key !== ex.key)) {
      var n0 = 0;
      (info && info.sections || []).forEach(function (x) { if (!n0 && x.key === r.key) n0 = x.section; });
      if (!n0) return;
      exploreStart(n0);
      if (!ex) return;
    }
    ex.askMore = null;
    ex.round = r.round;
    ex.versions = [ex.versions[0]].concat(r.versions || []);
    saying('Claude sent ' + (r.versions || []).length + ' versions.');
    ex.dials = (r.dials || []).map(function (d) { return { low: d.low, high: d.high, scores: [0.5].concat(d.scores || []) }; });
    ex.wd = ex.dials.map(function () { return null; });
    ex.waiting = false; ex.focus = 0;
    exploreDraw(true);
  }
  // the versions nearest what the word dials ask for, the original first
  // until a dial moves
  function exploreWords() {
    var idx = ex.versions.map(function (v, i) { return i; });
    var set = ex.wd.some(function (x) { return x != null; });
    if (!set) return idx;
    var dist = function (i) { var d = 0; ex.dials.forEach(function (dl, k) { if (ex.wd[k] != null) d += Math.pow(dl.scores[i] - ex.wd[k], 2); }); return d; };
    return idx.sort(function (a, b) { return dist(a) - dist(b); });
  }
  function exploreTiles() {
    var words = exploreWords(), faces = ex.faces.slice(ex.shift).concat(ex.faces.slice(0, ex.shift)), out = [];
    if (ex.versions.length === 1) faces.slice(0, 6).forEach(function (f) { out.push({ f: f, v: 0 }); });
    else words.slice(0, 2).forEach(function (vi) { faces.slice(0, 3).forEach(function (f) { out.push({ f: f, v: vi }); }); });
    return out;
  }
  function exploreSec(tile, scope) {
    var tpl = G.fillTake(Object.assign({ take: tile.f.take, face: tile.f.face }, ex.versions[tile.v]));
    if (!tpl) return null;
    var sec = secFrom(tpl, scope);
    if (ex.loud != null) sec.els.forEach(function (e) { if (e.type === 'heading') e.fs = SIZES[Math.round(ex.loud * (SIZES.length - 1))]; });
    if (ex.ground != null && ex.ground >= 0.34 && !sec.bgImage) {
      if (ex.ground < 0.67) sec.bg = 'color-mix(in srgb, var(--wp--preset--color--contrast) 7%, var(--wp--preset--color--base))';
      else {
        sec.bg = 'var(--wp--preset--color--contrast)';
        sec.els.forEach(function (e) {
          if (e.kids && e.kids.length) return;
          if (e.type === 'button') { if (e.ghost) e.color = 'base'; else { e.btnBg = 'base'; e.btnText = 'contrast'; } }
          else if (e.type === 'heading' || e.type === 'para' || e.type === 'badge') e.color = 'base';
        });
      }
    }
    return sec;
  }
  function tileName(tile) {
    var f = tile.f.face === 'The original' ? tile.f.take : tile.f.take + ' · ' + tile.f.face.replace(/^The /, '');
    return f + (ex.versions.length > 1 ? ' — ' + (tile.v ? 'version ' + tile.v : 'as it is') : '');
  }
  function exploreDraw(fresh) {
    var box = document.getElementById('explore');
    var dialRow = function (label, low, high, val, id) {
      return '<label class="dial"><span>' + low + '</span><input type="range" min="0" max="100" value="' + (val == null ? 50 : Math.round(val * 100)) + '" data-d="' + id + '" aria-label="' + label + '"><span>' + high + '</span></label>';
    };
    var dials = dialRow('Quiet to loud', 'Quiet', 'Loud', ex.loud, 'loud') + dialRow('Light to dark', 'Light', 'Dark', ex.ground == null ? 0 : ex.ground, 'ground');
    ex.dials.forEach(function (d, k) { dials += dialRow(d.low + ' to ' + d.high, d.low, d.high, ex.wd[k], 'w' + k); });
    box.innerHTML = '<div class="head"><span>Explore ' + (ex.s.design ? 'the ' + ex.s.design : 'this section') + '</span>' +
      '<button class="chip" type="button" data-x="shuffle">Other designs</button><button class="chip" type="button" data-x="close">Done</button></div>' +
      '<div class="note">' + (ex.askMore ? 'Say <b>“more like this”</b> to Claude for new versions around “' + esc(ex.askMore) + '”.'
        : ex.versions.length > 1 ? 'Claude wrote ' + (ex.versions.length - 1) + ' versions' + (ex.round > 1 ? ' (round ' + ex.round + ')' : '') + '. Point to look, click to keep.'
        : 'Point to look, click to keep. For new words too, say <b>“explore this”</b> to Claude.') + '</div>' +
      '<div class="dials">' + dials + '</div>' +
      '<div class="big" id="exBig"></div><div class="tiles" id="exTiles"></div>';
    box.hidden = false;
    document.getElementById('hint').hidden = true;
    [].forEach.call(box.querySelectorAll('input[type=range]'), function (r) {
      r.addEventListener('input', function () {
        var d = r.getAttribute('data-d'), v = +r.value / 100;
        if (d === 'loud') ex.loud = v; else if (d === 'ground') ex.ground = v; else ex.wd[+d.slice(1)] = v;
        exploreTilesDraw(false);
      });
    });
    box.querySelector('[data-x="close"]').onclick = exploreClose;
    box.querySelector('[data-x="shuffle"]').onclick = function () { ex.shift = (ex.shift + 3) % Math.max(1, ex.faces.length); exploreTilesDraw(true); };
    exploreTilesDraw(fresh);
  }
  function exploreTilesDraw(fresh) {
    var host = document.getElementById('exTiles'); if (!host) return;
    var tiles = exploreTiles();
    host.innerHTML = '';
    tiles.forEach(function (tile, i) {
      var sec = exploreSec(tile, 'gw-ex-' + i);
      if (!sec) return;
      var b = document.createElement('div');
      b.className = 'tile' + (fresh ? ' arrive' : '') + (i === ex.focus ? ' on' : '');
      b.style.animationDelay = (i * 70) + 'ms';
      b.innerHTML = thumb(sec) + '<div class="name"><span></span><button type="button" class="more">More like this</button></div>';
      b.querySelector('.name span').textContent = tileName(tile);
      b.addEventListener('mouseenter', function () { exploreBig(tile); });
      b.addEventListener('click', function (ev) { if (ev.target.closest('.more')) return; exploreKeep(tile); });
      b.querySelector('.more').onclick = function () { exploreMore(tile); };
      host.appendChild(b);
    });
    exploreBig(tiles[Math.min(ex.focus, tiles.length - 1)]);
    if (document.fonts) document.fonts.ready.then(fitThumbs);
    fitThumbs(); setTimeout(fitThumbs, 300);
  }
  function exploreBig(tile) {
    var big = document.getElementById('exBig'); if (!big || !tile) return;
    var sec = exploreSec(tile, 'gw-ex-big');
    if (!sec) return;
    big.innerHTML = thumb(sec);
    fitThumbs();
  }
  function exploreKeep(tile) {
    var sec = exploreSec(tile, ex.key && ex.key.indexOf('gogh-sec') === 0 ? ex.key : nextScope());
    if (!sec) return;
    var blocks = G.buildSectionBlocksV3(sec), n = ex.n, key = ex.key, label = tileName(tile), words = ex.versions[tile.v];
    exploreClose();
    tool('gogh_replace_section', key ? { page_id: st.page.id, section_key: key, blocks: blocks } : { page_id: st.page.id, section: n, blocks: blocks }).then(function () {
      saying('Kept. Not live yet.'); status(true); st.snapAt = n; draw();
      tell('In the explore view the person kept ' + label + ' for section ' + n + ', with the words ' + JSON.stringify(words) + '.');
    }, oops);
  }
  function exploreMore(tile) {
    var w = ex.versions[tile.v];
    st.exploring = 'The person wants more like this version of the ' + (ex.s.design || 'section') + ' (page_id ' + st.page.id + ', section_key ' + (ex.key || '') + '): ' + JSON.stringify(w) + ', in the ' + tileName(tile) + ' design. Write 4 new versions close to it, each still a little different, and send them with gogh_explore.';
    ex.waiting = false; ex.askMore = String(w.heading || w.text || '').slice(0, 50);
    exploreDraw();
    tell('');
  }
  function exploreClose() {
    var key = ex && ex.key; ex = null; st.exploring = null;
    document.getElementById('explore').hidden = true;
    document.getElementById('explore').innerHTML = '';
    document.getElementById('hint').hidden = false;
    fit();
  }

  /* ---------- new sections, drawn with gogh's own code ---------- */
  var INTENTS = [['introduce', 'Introduce'], ['showcase', 'Showcase'], ['sell', 'Sell'], ['share', 'Share']];
  var OPENERS = ['Hero', 'Cover', 'Big statement'];
  function nextScope() {
    var top = 0;
    [].forEach.call(document.querySelectorAll('#gw-page [data-gogh-scope]'), function (el) { var m = /gogh-sec-(\d+)/.exec(el.getAttribute('data-gogh-scope')); if (m) top = Math.max(top, +m[1]); });
    return 'gogh-sec-' + (top + 1 + Math.floor(Math.random() * 50));
  }
  function secFrom(tpl, scope) {
    var els = G.tplEls(tpl);
    var m = G.diceFaces(tpl.name) ? { tpl: tpl.name, face: +tpl.face > 0 ? +tpl.face : 0 } : null;
    if (tpl.cls) m = Object.assign(m || {}, { cls: tpl.cls });
    return { scope: scope, els: els, minH: tpl.minH || null, bg: tpl.bg || null, bgImage: G.tplBgFor(tpl) || null, bgA: tpl.bgA != null ? tpl.bgA : null, m: m, divider: null, fx: null, anchor: null };
  }
  function shown(html) {
    var pub = st.public_origin;
    html = toPublic(html);
    return html.replace(/(\s(?:src|srcset)=["'])\/(?!\/)/g, '$1' + pub + '/').replace(/url\((['"]?)\/(?!\/)/g, 'url($1' + pub + '/');
  }
  function thumb(sec) {
    var css = G.buildCSS(sec.els, sec.scope, sec.minH, { bg: sec.bg, bgImage: sec.bgImage, bgA: sec.bgA });
    var inner = sec.els.map(function (e, i) { return G.makeNode(e, i).outerHTML; }).join('');
    return '<div class="thumb"><style>' + shown(css) + '</style><div class="gw-stage gogh-wrap"><div class="gogh-section ' + sec.scope + '">' + shown(inner) + '</div></div></div>';
  }
  function fitThumbs() {
    [].forEach.call(document.querySelectorAll('.pick .gw-stage, .explore .gw-stage, .choices .gw-stage:not(.gw-live), .thread .gw-stage:not(.gw-live)'), function (s) { s.style.transform = 'scale(' + (s.parentNode.clientWidth / 1200) + ')'; });
    sizeUp();
  }
  function showPick(title, tabs, onTab) {
    document.getElementById('pickTitle').textContent = title;
    var tb = document.getElementById('pickTabs'); tb.innerHTML = '';
    (tabs || []).forEach(function (t, i) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = t[1];
      b.setAttribute('aria-pressed', i ? 'false' : 'true');
      b.onclick = function () { [].forEach.call(tb.children, function (x) { x.setAttribute('aria-pressed', 'false'); }); b.setAttribute('aria-pressed', 'true'); onTab(t[0]); };
      tb.appendChild(b);
    });
    document.getElementById('pick').hidden = false;
    document.getElementById('stage').hidden = true;
    document.getElementById('hint').hidden = true;
    window.scrollTo(0, 0);
  }
  function hidePick() {
    document.getElementById('pick').hidden = true;
    document.getElementById('stage').hidden = false;
    document.getElementById('hint').hidden = false;
    document.getElementById('pickGrid').innerHTML = '';
    fit();
  }
  document.getElementById('pickClose').onclick = hidePick;
  function fillGrid(list, onPick) {
    var grid = document.getElementById('pickGrid'); grid.innerHTML = '';
    list.forEach(function (o, i) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'opt';
      try { b.innerHTML = thumb(secFrom(o.tpl, 'gw-pk-' + i)) + '<span class="name">' + o.label + '</span>'; } catch (e) { return; }
      b.onclick = function () { onPick(o); };
      grid.appendChild(b);
    });
    if (document.fonts) document.fonts.ready.then(fitThumbs);
    fitThumbs(); setTimeout(fitThumbs, 400);
  }
  // + Add a section: gogh's designs, by what they are for
  function chooseNew(at) {
    if (!G) return;
    var byIntent = function (intent) {
      return G.TEMPLATES.filter(function (t) { return t.intent === intent && !t.retired && !t.gated && t.els && t.els.length; })
        .map(function (t) { return { tpl: t, label: t.label ? String(t.label).replace(/<[^>]*>/g, '') : t.name }; });
    };
    showPick('Add a section here', INTENTS, function (k) { fillGrid(byIntent(k), pick); });
    fillGrid(byIntent('introduce'), pick);
    function pick(o) {
      var sec = secFrom(o.tpl, nextScope());
      var blocks = G.buildSectionBlocksV3(sec);
      hidePick();
      tool('gogh_add_section', { page_id: st.page.id, at: at, blocks: blocks }).then(function () {
        saying('Added. Click its words to make them yours.'); status(true); st.snapAt = at; draw();
        tell('In the page panel the person added a ' + o.label + ' section to "' + st.page.title + '" at place ' + at + '. It carries gogh\'s sample words until they change them.');
      }, oops);
    }
  }
  // a section's other designs, wearing its own words and pictures
  function wordsOf(s) {
    var w = {}, texts = [], buttons = [], pic = null, items = null;
    (s.pieces || []).forEach(function (p) {
      if (p.role === 'eyebrow' && !w.eyebrow) w.eyebrow = p.words;
      else if (p.role === 'heading' && !w.heading) w.heading = p.words;
      else if (p.role === 'text') texts.push(p.words);
      else if (p.role === 'button') buttons.push(p.words);
      else if (p.role === 'picture' && p.src && !pic) pic = p.src;
      else if (p.role === 'cards' && p.cards && !items) items = p.cards.map(function (c) { return { title: c.title, text: c.text, quote: c.text, name: c.name || c.role, role: c.role, price: c.price, eyebrow: c.eyebrow, image: c.src }; });
    });
    if (texts[0]) w.text = texts[0]; if (texts[1]) w.text2 = texts[1]; if (texts[2]) w.text3 = texts[2];
    if (buttons[0]) w.button = buttons[0]; if (buttons[1]) w.button2 = buttons[1];
    if (pic || s.background_picture) w.image = pic || s.background_picture;
    if (items) w.items = items;
    return w;
  }
  function chooseDesign(n) {
    if (!G || !info || !info.sections[n - 1]) return;
    var s = info.sections[n - 1], fam = s.design, words = wordsOf(s);
    var fams = OPENERS.indexOf(fam) !== -1 ? OPENERS : [fam];
    var list = [];
    fams.forEach(function (f) {
      (G.diceFaces(f) || []).forEach(function (t, k) {
        var face = k ? t.take : 'The original';
        if (f === fam && k === (s.design_take || 0)) return; // the one it is now
        var tpl = null;
        try { tpl = G.fillTake(Object.assign({ take: f, face: face }, words)); } catch (e) {}
        if (tpl) list.push({ tpl: tpl, label: face === 'The original' ? f : f + ' · ' + face.replace(/^The /, '') });
      });
    });
    showPick('Try section ' + n + ' in another design', null, null);
    fillGrid(list, function (o) {
      var sec = secFrom(o.tpl, nextScope());
      var blocks = G.buildSectionBlocksV3(sec);
      hidePick();
      tool('gogh_replace_section', { page_id: st.page.id, section: n, blocks: blocks }).then(function () {
        saying('Changed. Not live yet.'); status(true); st.snapAt = n; draw();
        tell('In the page panel the person changed section ' + n + ' of "' + st.page.title + '" to the ' + o.label + ' design, keeping its words.');
      }, oops);
    });
  }

  window.addEventListener('resize', function () { layout(); fit(); });
  window.__goghPage = function () { return st; };
  theme(H.context);
  if (H.result && H.result.structuredContent && H.result.structuredContent.preview) open(H.result.structuredContent);
})();


(function () {
  'use strict';
  var H = window.goghHost;
  document.getElementById('gw-root').innerHTML = "<div class=\"w\" id=\"w\">\n  <div class=\"bar\">\n    <select id=\"pages\" aria-label=\"Page\"></select>\n    <span class=\"pill\" id=\"pill\">Live</span>\n    <span class=\"saving\" id=\"saving\" aria-live=\"polite\"></span>\n    <button class=\"chip\" id=\"discard\" type=\"button\" hidden>Throw away changes</button>\n    <button class=\"go\" id=\"publish\" type=\"button\" hidden>Publish</button>\n  </div>\n  <div class=\"ask\" id=\"ask\" role=\"alertdialog\" aria-live=\"assertive\"><span id=\"askText\"></span><button class=\"chip\" id=\"askNo\" type=\"button\">Cancel</button><button class=\"go\" id=\"askYes\" type=\"button\">Yes</button></div>\n  <div class=\"hint\" id=\"hint\">Click any words to change them. Drag a section by its handle to move it. Add a section from the + under any section.</div>\n  <div class=\"pick\" id=\"pick\" hidden>\n    <div class=\"head\"><span id=\"pickTitle\">Add a section</span><button class=\"chip\" id=\"pickClose\" type=\"button\">Cancel</button></div>\n    <div class=\"tabs\" id=\"pickTabs\"></div>\n    <div class=\"grid\" id=\"pickGrid\"></div>\n  </div>\n  <div class=\"stage\" id=\"stage\"><div class=\"msg\" id=\"msg\">Opening your page\u2026</div></div>\n</div>";
  var st = null, busy = 0, frame = null, W = 1280, G = window.goghDraw, info = null;

  /* ---------- the chat: the loader holds the conversation ---------- */
  var inHost = H.inHost;
  var request = H.request, notify = H.notify;
  H.handle = function (m) {
    var a = m.params || {};
    if (m.method === 'ui/notifications/tool-result' && a.structuredContent && a.structuredContent.preview) open(a.structuredContent);
    else if (m.method === 'ui/notifications/host-context-changed') theme(a);
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
    return request('tools/call', { name: name, arguments: args }).then(function (r) {
      busy--;
      if (!r || r.isError) throw new Error((r && r.content && r.content[0] && r.content[0].text) || 'That did not work.');
      return r.structuredContent || {};
    }, function (e) { busy--; throw e; });
  }
  function tell(text) { // the agent should know what the person did here
    request('ui/update-model-context', { content: [{ type: 'text', text: text }] }).catch(function () {});
  }

  /* ---------- the bar ---------- */
  function saying(t) { document.getElementById('saving').textContent = t || ''; }
  function status(pending) {
    st.pending = !!pending;
    var pill = document.getElementById('pill');
    pill.textContent = pending ? 'Changes not live yet' : 'Live';
    pill.classList.toggle('pending', !!pending);
    document.getElementById('discard').hidden = !pending;
    document.getElementById('publish').hidden = !(pending || st.page.status !== 'publish') || !st.can_publish;
    document.getElementById('publish').textContent = st.page.status === 'publish' ? 'Publish' : 'Publish page';
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
  document.getElementById('publish').onclick = function () {
    ask(st.page.status === 'publish' ? 'Make these changes live on your site?' : 'Publish this page on your site?', 'Publish', function () {
      tool('gogh_publish', { page_id: st.page.id }).then(function () {
        st.page.status = 'publish'; status(false); saying('Published.');
        tell('The person published "' + st.page.title + '" from the page panel.');
      }, oops);
    });
  };
  document.getElementById('discard').onclick = function () {
    ask('Throw away the changes that are not live yet?', 'Throw away', function () {
      tool('gogh_discard_changes', { page_id: st.page.id }).then(function () {
        status(false); saying('Changes thrown away.'); draw();
        tell('The person threw away the unpublished changes to "' + st.page.title + '".');
      }, oops);
    });
  };

  /* ---------- the page ---------- */
  function open(d) {
    st = d;
    var sel = document.getElementById('pages');
    sel.innerHTML = '';
    (d.pages || []).forEach(function (p) {
      var o = document.createElement('option'); o.value = p.id; o.textContent = p.title;
      if (p.id === d.page.id) o.selected = true;
      sel.appendChild(o);
    });
    status(d.unpublished_changes);
    if (G && d.pictures) { G.mediaPool.imgs = d.pictures.imgs || []; G.mediaPool.bgs = d.pictures.bgs || []; G.mediaPool.fetched = true; }
    draw();
  }
  // what each section is and says, for redrawing one in another design
  function reread() {
    return request('tools/call', { name: 'gogh_read_page', arguments: { page_id: st.page.id } }).then(function (r) {
      info = r && r.structuredContent ? r.structuredContent : null;
      return info;
    }).catch(function () { info = null; });
  }
  function draw() {
    var keep = window.scrollY;
    fetch(st.preview + '&t=' + Date.now(), { credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new Error('The page did not load (' + r.status + ').');
      return r.text();
    }).then(function (html) {
      html = html.split(st.site_origin).join(st.public_origin);
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
      reread().then(function () { wire(page); });
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
    var secs = sections(page);
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
        tool('gogh_change_words', { page_id: st.page.id, section: n, piece: piece, words: now }).then(function () {
          saying('Saved. Not live yet.'); status(true); fit();
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
    t.innerHTML = '<button class="gw-grip" draggable="true" title="Drag to move">⠿</button>' +
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
      saying('Moved. Not live yet.'); status(true); draw();
      tell('In the page panel the person moved section ' + from + ' of "' + st.page.title + '" to place ' + to + '.');
    }, oops);
  }
  function remove(n) {
    tool('gogh_remove_section', { page_id: st.page.id, section: n }).then(function () {
      saying('Removed. Not live yet.'); status(true); draw();
      tell('In the page panel the person removed section ' + n + ' of "' + st.page.title + '".');
    }, oops);
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
    if (st.site_origin !== pub) html = html.split(st.site_origin).join(pub);
    return html.replace(/(\s(?:src|srcset)=["'])\/(?!\/)/g, '$1' + pub + '/').replace(/url\((['"]?)\/(?!\/)/g, 'url($1' + pub + '/');
  }
  function thumb(sec) {
    var css = G.buildCSS(sec.els, sec.scope, sec.minH, { bg: sec.bg, bgImage: sec.bgImage, bgA: sec.bgA });
    var inner = sec.els.map(function (e, i) { return G.makeNode(e, i).outerHTML; }).join('');
    return '<div class="thumb"><style>' + shown(css) + '</style><div class="gw-stage gogh-wrap"><div class="gogh-section ' + sec.scope + '">' + shown(inner) + '</div></div></div>';
  }
  function fitThumbs() {
    [].forEach.call(document.querySelectorAll('.pick .gw-stage'), function (s) { s.style.transform = 'scale(' + (s.parentNode.clientWidth / 1200) + ')'; });
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
        saying('Added. Click its words to make them yours.'); status(true); draw();
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
        saying('Changed. Not live yet.'); status(true); draw();
        tell('In the page panel the person changed section ' + n + ' of "' + st.page.title + '" to the ' + o.label + ' design, keeping its words.');
      }, oops);
    });
  }

  window.addEventListener('resize', fit);
  window.__goghPage = function () { return st; };
  theme(H.context);
  if (H.result && H.result.structuredContent && H.result.structuredContent.preview) open(H.result.structuredContent);
})();

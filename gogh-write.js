/* gogh write — a clean canvas and space to think.
 *
 * The doctrine: NOTHING on screen but the words. Chrome appears only on
 * intent (mouse movement wakes the one chip; typing hides it again).
 * Prose is FLOW, not canvas — no x/y, no grid, just the theme's own
 * column on the real front end. Storage is pure core blocks: with gogh
 * deactivated this is a perfectly ordinary WordPress post.
 */
(function () {
  'use strict';
  var cfg = window.GOGHWRITE || {};
  if (!cfg.postId || !cfg.restUrl) return;

  var body = document.querySelector('.entry-content, .wp-block-post-content');
  if (!body) return;
  // the RIGHT title: the nearest one PRECEDING the content — templates
  // scatter post-titles through "more posts" furniture, and some render
  // no main title at all for an empty draft. Find it or make it.
  var title = null;
  [].forEach.call(document.querySelectorAll('.wp-block-post-title, h1.entry-title'), function (t) {
    if (t.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING) title = t;
  });
  if (!title) {
    title = document.createElement('h1');
    title.className = 'wp-block-post-title';
    body.parentNode.insertBefore(title, body);
  }
  if (!title.textContent.trim()) title.innerHTML = '';
  document.body.classList.add('gogh-writing');

  // ---------- boot from RAW, not the rendered page ----------
  // the theme's rendered DOM is for READERS; the write surface rebuilds
  // itself from the stored block markup, so every block — splashes,
  // floats, captions, even blocks gogh does not know — round-trips
  // byte-faithfully. Unknown blocks ride as protected pass-throughs.
  var parseBlocks = function (raw) {
    var out = [];
    var re = /<!--\s*(\/)?wp:([a-z0-9\/-]+)([^>]*?)(\/)?-->/g;
    var m, depth = 0, start = 0, startTag = null;
    while ((m = re.exec(raw))) {
      var isClose = !!m[1];
      var isSelf = !!m[4];
      if (isClose) {
        depth--;
        if (depth === 0) out.push({ name: startTag, raw: raw.slice(start, m.index + m[0].length) });
      } else if (isSelf) {
        if (depth === 0) out.push({ name: m[2], raw: m[0] });
      } else {
        if (depth === 0) { start = m.index; startTag = m[2]; }
        depth++;
      }
    }
    return out;
  };
  var innerOf = function (blockRaw) {
    return blockRaw.replace(/<!--\s*\/?wp:[^>]*?-->/g, '').trim();
  };
  var keeperNode = function (blockRaw, html) {
    var node = document.createElement('div');
    node.className = 'gogh-splash';
    node.contentEditable = 'false';
    node.dataset.goghRaw = encodeURIComponent(blockRaw);
    node.innerHTML = html || innerOf(blockRaw) || '<em style="opacity:.5">A block gogh keeps safe for you</em>';
    return node;
  };
  var surfaceFromRaw = function (raw) {
    var blocks = parseBlocks(raw);
    if (!blocks.length) return false;
    // a fresh draft is just its empty seed paragraph — rebuilding it
    // would swap the typeable <p><br></p> for a caret-proof <p></p>
    var hasContent = blocks.some(function (b) {
      if (b.name !== 'paragraph') return true;
      return !!innerOf(b.raw).replace(/<[^>]*>/g, '').trim();
    });
    if (!hasContent) return false;
    var sel0 = getSelection();
    var caretWasInBody = sel0.rangeCount > 0 && body.contains(sel0.anchorNode);
    var frag = document.createDocumentFragment();
    blocks.forEach(function (b) {
      var name = String(b.name || '');
      var inner = innerOf(b.raw);
      var tmp = document.createElement('div');
      if (name === 'paragraph' || name === 'heading' || name === 'list' ||
          name === 'quote' || name === 'separator') {
        tmp.innerHTML = inner || (name === 'separator' ? '<hr>' : '');
        while (tmp.firstChild) frag.appendChild(tmp.firstChild);
      } else if (name === 'image' && !/gogh-splash-break/.test(b.raw)) {
        tmp.innerHTML = inner;
        var fig = tmp.querySelector('figure');
        if (fig) {
          var mid = (b.raw.match(/"id":(\d+)/) || [])[1];
          if (mid) fig.dataset.mid = mid;
          fig.contentEditable = 'false';
          var cap = fig.querySelector('figcaption');
          if (!cap) {
            cap = document.createElement('figcaption');
            cap.className = 'wp-element-caption gogh-w-cap';
            fig.appendChild(cap);
          }
          cap.classList.add('gogh-w-cap');
          cap.contentEditable = 'true';
          frag.appendChild(fig);
        }
      } else if (name === 'embed') {
        var eu = (b.raw.match(/"url":"([^"]+)"/) || [])[1];
        if (eu) {
          var ef = document.createElement('figure');
          ef.className = 'gogh-w-embed';
          ef.dataset.url = eu;
          ef.innerHTML = embedPreview(eu);
          frag.appendChild(ef);
        }
      } else {
        // splash compositions AND unknown blocks: protected pass-throughs
        frag.appendChild(keeperNode(b.raw, inner));
      }
    });
    body.innerHTML = '';
    body.appendChild(frag);
    if (!body.lastElementChild || !/^(P|H2|H3|H4)$/.test(body.lastElementChild.tagName)) {
      var tail = document.createElement('p');
      tail.innerHTML = '<br>';
      body.appendChild(tail);
    }
    // an empty block without <br> is caret-proof — contenteditable
    // cannot place the cursor inside it, and typing lands nowhere
    [].forEach.call(body.querySelectorAll('p, h2, h3, h4, li'), function (el) {
      if (!el.textContent.trim() && !el.firstElementChild) el.innerHTML = '<br>';
    });
    if (caretWasInBody) caretInto(body.firstElementChild);
    return true;
  };
  // if the writer starts typing before the raw arrives, their words win
  var typedFirst = false;
  body.addEventListener('input', function () { typedFirst = true; }, { once: true, capture: true });
  fetch(cfg.restUrl + 'wp/v2/posts/' + cfg.postId + '?context=edit', {
    headers: { 'X-WP-Nonce': cfg.nonce },
    credentials: 'same-origin',
  }).then(function (r) { return r.ok ? r.json() : null; }).then(function (post) {
    var raw = post && post.content && post.content.raw || '';
    if (!typedFirst && raw.trim() && surfaceFromRaw(raw)) {
      [].forEach.call(body.querySelectorAll('figure, .gogh-splash'), attachObjControls);
    }
  }).catch(function () {});

  // ---------- the surface ----------
  if (title) {
    title.contentEditable = 'plaintext-only';
    title.spellcheck = false;
    title.classList.add('gogh-w-title');
    if (!title.textContent.trim()) title.textContent = '';
  }
  body.contentEditable = 'true';
  body.spellcheck = false; // red squiggles are not space to think
  body.classList.add('gogh-w-body');
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {}
  if (!body.textContent.trim() && !body.querySelector('img')) {
    body.innerHTML = '<p><br></p>';
  }

  // start with the caret where thought starts
  setTimeout(function () {
    (title && !title.textContent.trim() ? title : body).focus();
  }, 60);

  // Enter in the title moves to the words
  if (title) title.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      body.focus();
      var r = document.createRange();
      r.selectNodeContents(body.firstElementChild || body);
      r.collapse(true);
      var s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
  });

  // ---------- markdown-ish shortcuts: blocks appear as you type ----------
  var blockOf = function (node) {
    while (node && node !== body && node.parentNode !== body) node = node.parentNode;
    return node === body ? null : node;
  };
  var swapBlock = function (blk, html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    var fresh = tmp.firstElementChild;
    blk.replaceWith(fresh);
    var r = document.createRange();
    r.selectNodeContents(fresh);
    r.collapse(false);
    var s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    return fresh;
  };
  body.addEventListener('keydown', function (ev) {
    if (ev.key !== ' ' && ev.key !== 'Enter') return;
    var sel = getSelection();
    if (!sel.rangeCount) return;
    var blk = blockOf(sel.anchorNode);
    if (!blk || !/^(P|DIV)$/.test(blk.tagName)) return;
    var t = blk.textContent;
    var rest = function (n) { return t.slice(n).trim(); };
    if (ev.key === ' ') {
      if (/^##$/.test(t)) { ev.preventDefault(); swapBlock(blk, '<h2><br></h2>'); }
      else if (/^###$/.test(t)) { ev.preventDefault(); swapBlock(blk, '<h3><br></h3>'); }
      else if (/^>$/.test(t)) { ev.preventDefault(); swapBlock(blk, '<blockquote><p><br></p></blockquote>'); }
      else if (/^[-*]$/.test(t)) { ev.preventDefault(); swapBlock(blk, '<ul><li><br></li></ul>'); }
      else if (/^1\.$/.test(t)) { ev.preventDefault(); swapBlock(blk, '<ol><li><br></li></ol>'); }
    } else if (ev.key === 'Enter' && /^---+$/.test(t)) {
      ev.preventDefault();
      blk.replaceWith(document.createElement('hr'));
      var p = document.createElement('p');
      p.innerHTML = '<br>';
      body.appendChild(p);
      var r = document.createRange();
      r.selectNodeContents(p);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    queueSave();
  });

  // ---------- images: drop or paste, they land where thought was ----------
  var insertImageAt = function (file, refNode) {
    var fig = document.createElement('figure');
    fig.className = 'wp-block-image size-large gogh-w-uploading';
    fig.contentEditable = 'false'; // the image is an OBJECT, not text
    fig.innerHTML = '<img alt="" src="' + URL.createObjectURL(file) + '"/>' +
      '<figcaption class="wp-element-caption gogh-w-cap" contenteditable="true"></figcaption>';
    if (refNode && refNode.parentNode === body) body.insertBefore(fig, refNode.nextSibling);
    else body.appendChild(fig);
    // there is ALWAYS a line below an image ("i cant write below")
    if (!fig.nextElementSibling || /^(FIGURE|HR)$/.test(fig.nextElementSibling.tagName)) {
      var after = document.createElement('p');
      after.innerHTML = '<br>';
      fig.after(after);
    }
    var cr2 = document.createRange();
    cr2.selectNodeContents(fig.nextElementSibling);
    cr2.collapse(true);
    var s2 = getSelection();
    s2.removeAllRanges();
    s2.addRange(cr2);
    var fd = new FormData();
    fd.append('file', file);
    fetch(cfg.restUrl + 'wp/v2/media', {
      method: 'POST',
      headers: { 'X-WP-Nonce': cfg.nonce },
      credentials: 'same-origin',
      body: fd,
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (m) {
      if (!m) { fig.remove(); return; }
      var img = fig.querySelector('img');
      img.src = m.source_url;
      img.className = 'wp-image-' + m.id;
      fig.dataset.mid = m.id;
      fig.classList.remove('gogh-w-uploading');
      attachObjControls(fig);
      queueSave();
    }).catch(function () { fig.remove(); });
  };
  body.addEventListener('dragover', function (ev) {
    if (ev.dataTransfer && [].some.call(ev.dataTransfer.items || [], function (i) { return i.kind === 'file'; })) {
      ev.preventDefault();
      body.classList.add('gogh-w-drop');
    }
  });
  body.addEventListener('dragleave', function () { body.classList.remove('gogh-w-drop'); });
  body.addEventListener('drop', function (ev) {
    var files = ev.dataTransfer && ev.dataTransfer.files;
    if (!files || !files.length) return;
    ev.preventDefault();
    body.classList.remove('gogh-w-drop');
    var ref = null;
    if (document.caretRangeFromPoint) {
      var cr = document.caretRangeFromPoint(ev.clientX, ev.clientY);
      if (cr) ref = blockOf(cr.startContainer);
    }
    [].forEach.call(files, function (f) {
      if (/^image\//.test(f.type)) insertImageAt(f, ref);
    });
  });
  body.addEventListener('paste', function (ev) {
    var items = ev.clipboardData && ev.clipboardData.items;
    if (!items) return;
    var imgs = [].filter.call(items, function (i) { return /^image\//.test(i.type); });
    if (!imgs.length) return;
    ev.preventDefault();
    var sel = getSelection();
    var ref = sel.rangeCount ? blockOf(sel.anchorNode) : null;
    imgs.forEach(function (i) { insertImageAt(i.getAsFile(), ref); });
  });

  // ---------- the ＋ margin menu: answers that exist only while the
  // question does — an empty line asks "what goes next?", the ＋ offers
  // the few things a writer actually reaches for. Typing melts it away.
  var plus = document.createElement('button');
  plus.type = 'button';
  plus.className = 'gogh-w-plus';
  plus.setAttribute('aria-label', 'Add something here');
  plus.textContent = '+';
  document.body.appendChild(plus);
  var menu = document.createElement('div');
  menu.className = 'gogh-w-menu';
  menu.innerHTML =
    '<button type="button" data-add="heading">H Heading</button>' +
    '<button type="button" data-add="image">\ud83d\udcf7 Image</button>' +
    '<button type="button" data-add="quote">\u275d Quote</button>' +
    '<button type="button" data-add="embed">\u25b6 Embed</button>' +
    '<button type="button" data-add="rule">\u2014 Divider</button>' +
    '<button type="button" data-add="splash" class="gogh-w-splashbtn">\u2726 Splash</button>';
  menu.hidden = true;
  document.body.appendChild(menu);
  var filePick = document.createElement('input');
  filePick.type = 'file';
  filePick.accept = 'image/*';
  filePick.multiple = true;
  filePick.hidden = true;
  document.body.appendChild(filePick);

  var plusBlk = null;
  var emptyBlock = function (blk) {
    return blk && /^(P|DIV)$/.test(blk.tagName) && !blk.textContent.trim() && !blk.querySelector('img');
  };
  var hidePlus = function () {
    plus.classList.remove('is-vis');
    menu.hidden = true;
    plusBlk = null;
  };
  var placePlus = function () {
    var sel = getSelection();
    if (!sel.rangeCount || !body.contains(sel.anchorNode)) { hidePlus(); return; }
    var blk = blockOf(sel.anchorNode);
    if (!emptyBlock(blk)) { hidePlus(); return; }
    plusBlk = blk;
    var r = blk.getBoundingClientRect();
    plus.style.left = Math.max(8, r.left - 46) + 'px';
    plus.style.top = (r.top + r.height / 2) + 'px';
    plus.classList.add('is-vis');
    if (!menu.hidden) {
      menu.style.left = Math.max(8, r.left) + 'px';
      menu.style.top = (r.top + r.height / 2) + 'px';
    }
  };
  var placeSoon = null;
  var queuePlace = function () {
    if (!menu.hidden) return;
    clearTimeout(placeSoon);
    placeSoon = setTimeout(placePlus, 60);
  };
  document.addEventListener('selectionchange', queuePlace);
  body.addEventListener('keyup', queuePlace);
  body.addEventListener('click', queuePlace);
  body.addEventListener('input', queuePlace);
  window.addEventListener('scroll', function () { if (plusBlk) placePlus(); }, { passive: true });

  var openMenu = function () {
    if (!plusBlk) return;
    var r = plusBlk.getBoundingClientRect();
    menu.style.left = Math.max(8, r.left) + 'px';
    menu.style.top = (r.top + r.height / 2) + 'px';
    menu.hidden = false;
  };
  plus.addEventListener('click', function (ev) { ev.preventDefault(); openMenu(); });
  document.addEventListener('pointerdown', function (ev) {
    if (!menu.hidden && !menu.contains(ev.target) && ev.target !== plus) menu.hidden = true;
  }, true);

  var caretInto = function (el, atEnd) {
    var r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(!atEnd);
    var s2 = getSelection();
    s2.removeAllRanges();
    s2.addRange(r);
  };
  var embedPreview = function (url) {
    var yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
    if (yt) return '<iframe src="https://www.youtube.com/embed/' + yt[1] + '" allowfullscreen loading="lazy"></iframe>';
    var vm = url.match(/vimeo\.com\/(\d+)/);
    if (vm) return '<iframe src="https://player.vimeo.com/video/' + vm[1] + '" allowfullscreen loading="lazy"></iframe>';
    return '<a href="' + url + '">' + url + '</a>';
  };
  // ---------- ✦ Splash: a gogh composition between the paragraphs ----------
  var splashOv = null;
  var closeSplash = function () {
    if (splashOv) { splashOv.remove(); splashOv = null; }
  };
  var insertSplash = function (made, refBlk) {
    var node = document.createElement('div');
    node.className = 'gogh-splash';
    node.contentEditable = 'false';
    node.dataset.goghRaw = encodeURIComponent(made.raw);
    node.innerHTML = made.html;
    if (refBlk && refBlk.classList && refBlk.classList.contains('gogh-splash')) {
      refBlk.replaceWith(node); // ✎ Replace swaps in place
    } else if (refBlk && refBlk.parentNode === body && !refBlk.textContent.trim()) {
      refBlk.replaceWith(node);
    } else if (refBlk && refBlk.parentNode === body) {
      node2After(refBlk, node);
    } else {
      body.appendChild(node);
    }
    // boundary guarantees: there is ALWAYS a line to type on either side
    // ("if i insert them i can't type at the start")
    if (!node.previousElementSibling || /^(FIGURE|HR)$/.test(node.previousElementSibling.tagName) || node.previousElementSibling.classList.contains('gogh-splash')) {
      var before = document.createElement('p');
      before.innerHTML = '<br>';
      node.before(before);
    }
    if (!node.nextElementSibling || /^(FIGURE|HR)$/.test(node.nextElementSibling.tagName) || node.nextElementSibling.classList.contains('gogh-splash')) {
      var after = document.createElement('p');
      after.innerHTML = '<br>';
      node.after(after);
    }
    caretInto(node.nextElementSibling);
    attachObjControls(node);
    closeSplash();
    queueSave();
  };
  var node2After = function (ref, node) { ref.after(node); };
  // \u270e on an existing splash EDITS it: the stage opens on its kind with
  // its photos already chosen, its words already in the fields \u2014 folks
  // adjust, they don't rebuild ("wouldn't it make more sense if it
  // brought up the existing splash")
  var readSplash = function (blk) {
    if (!blk || !blk.classList || !blk.classList.contains('gogh-splash') || !blk.dataset.goghRaw) return null;
    var raw = decodeURIComponent(blk.dataset.goghRaw);
    var tmp = document.createElement('div');
    tmp.innerHTML = raw.replace(/<!--[\s\S]*?-->/g, '');
    var kind = /gogh-carousel/.test(raw) ? 'carousel' : /gogh-wall/.test(raw) ? 'wall'
      : /gogh-splash-break/.test(raw) ? 'break' : /gogh-splash-glasswrap/.test(raw) ? 'glass' : null;
    if (!kind) return null;
    var cur = { kind: kind, urls: [], caps: {}, opts: {} };
    if (kind === 'carousel' || kind === 'wall') {
      [].forEach.call(tmp.querySelectorAll('.gogh-slide img, .gogh-brick img'), function (im) {
        cur.urls.push(im.getAttribute('src'));
        var cap = im.parentElement.querySelector('figcaption');
        if (cap && cap.textContent.trim()) cur.caps[im.getAttribute('src')] = cap.textContent;
      });
      cur.opts.light = /gogh-crsl-light/.test(raw) ? 1 : 0;
      if (kind === 'carousel') {
        if (/gogh-crsl-auto/.test(raw)) cur.opts.auto = 1;
        cur.opts.nav = /gogh-crsl-nav-both/.test(raw) ? 'both' : /gogh-crsl-nav-sides/.test(raw) ? 'sides' : undefined;
      } else {
        var cm = raw.match(/gogh-wall-(\d)/);
        cur.opts.cols = cm ? +cm[1] : 3;
      }
    } else {
      var im2 = tmp.querySelector('img');
      if (im2) cur.urls.push(im2.getAttribute('src'));
      if (kind === 'break') cur.alt = im2 ? im2.getAttribute('alt') || '' : '';
      if (kind === 'glass') {
        var k2 = tmp.querySelector('.gogh-glass-kicker');
        var h2 = tmp.querySelector('.gogh-glass h2');
        var p2 = tmp.querySelector('.gogh-glass p:not(.gogh-glass-kicker)');
        cur.kicker = k2 ? k2.textContent : '';
        cur.title = h2 ? h2.textContent : '';
        cur.text = p2 ? p2.textContent : '';
      }
    }
    return cur;
  };
  var openSplash = function (refBlk) {
    closeSplash();
    var cur = readSplash(refBlk);
    splashOv = document.createElement('div');
    splashOv.className = 'gogh-w-splash';
    splashOv.innerHTML =
      '<div class="gogh-w-splash-card">' +
      '<div class="gogh-w-splash-head">\u2726 ' + (cur ? 'Edit your splash' : 'A splash between the words') +
      '<button type="button" class="gogh-w-splash-x">\u2715</button></div>' +
      '<div class="gogh-w-splash-tiles">' +
      '<button type="button" data-splash="carousel">\ud83c\udfa0<b>Carousel</b><i>photos that glide</i></button>' +
      '<button type="button" data-splash="wall">\ud83e\uddf1<b>Photo wall</b><i>a gallery interlude</i></button>' +
      '<button type="button" data-splash="break">\ud83c\udf04<b>Break image</b><i>a full-bleed pause</i></button>' +
      '<button type="button" data-splash="glass">\ud83c\udccf<b>Glass card</b><i>a frosted call-out</i></button>' +
      '</div>' +
      '<div class="gogh-w-splash-stage" hidden></div>' +
      '</div>';
    document.body.appendChild(splashOv);
    splashOv.addEventListener('pointerdown', function (ev) {
      if (ev.target === splashOv) closeSplash();
    });
    splashOv.querySelector('.gogh-w-splash-x').addEventListener('click', closeSplash);
    var showStage = function (kind, seed) {
      var stage = splashOv.querySelector('.gogh-w-splash-stage');
      splashOv.querySelector('.gogh-w-splash-tiles').hidden = true;
      stage.hidden = false;
      var multi = kind === 'carousel' || kind === 'wall';
      var editing = !!seed;
      stage.innerHTML = '<div class="gogh-w-splash-hint">' +
        (editing
          ? (multi ? 'Tap photos to add or remove, then Update.' : 'Tap a photo to swap it in.')
          : (multi ? 'Pick a few photos, then Add.' : 'Pick the photo.')) + '</div>' +
        (kind === 'glass'
          ? '<input type="text" class="gogh-input gogh-w-splash-title" placeholder="Card title" value="' +
            String(seed && seed.title ? seed.title : 'A moment worth a card').replace(/"/g, '&quot;') + '" />' +
            '<input type="text" class="gogh-input gogh-w-splash-text" placeholder="One good line (optional)" value="' +
            String(seed && seed.text ? seed.text : '').replace(/"/g, '&quot;') + '" />'
          : '') +
        '<div class="gogh-media gogh-w-splash-media"><span class="gogh-media-loading">Loading media\u2026</span></div>' +
        (multi ? '<button type="button" class="gogh-w-publish gogh-w-splash-go" disabled>' + (editing ? 'Update' : 'Add') + '</button>' : '') +
        (editing && kind === 'glass' ? '<button type="button" class="gogh-w-publish gogh-w-splash-go">Update</button>' : '') +
        (editing ? '<button type="button" class="gogh-w-splash-rekind">Start over with a different kind</button>' : '');
      var chosen = editing && multi ? seed.urls.slice() : [];
      var caps = editing ? seed.caps || {} : {};
      var opts = editing ? seed.opts || {} : (kind === 'wall' ? { cols: 3, light: 1 } : { light: 1 });
      var goLabel = function (go) {
        go.disabled = chosen.length < 2;
        go.textContent = chosen.length ? (editing ? 'Update ' : 'Add ') + chosen.length + ' photos' : (editing ? 'Update' : 'Add');
      };
      var rk = stage.querySelector('.gogh-w-splash-rekind');
      if (rk) rk.addEventListener('click', function () {
        stage.hidden = true;
        splashOv.querySelector('.gogh-w-splash-tiles').hidden = false;
      });
      fetch(cfg.restUrl + 'wp/v2/media?per_page=32&media_type=image&orderby=date&order=desc', {
        headers: { 'X-WP-Nonce': cfg.nonce },
        credentials: 'same-origin',
      }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }).then(function (items) {
        var box = stage.querySelector('.gogh-w-splash-media');
        box.innerHTML = '';
        if (!items.length) { box.innerHTML = '<span class="gogh-media-loading">No images yet \u2014 upload some first.</span>'; return; }
        items.forEach(function (item) {
          var thumb = (item.media_details && item.media_details.sizes &&
            (item.media_details.sizes.thumbnail || item.media_details.sizes.medium));
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'gogh-thumb';
          if (editing && (multi ? chosen.indexOf(item.source_url) !== -1 : seed.urls[0] === item.source_url)) {
            b.classList.add('is-active');
          }
          b.style.backgroundImage = 'url("' + (thumb ? thumb.source_url : item.source_url) + '")';
          b.addEventListener('click', function () {
            if (!multi) {
              var made = kind === 'break'
                ? window.__goghCompose.breakImage(item.source_url, item.alt_text || '')
                : window.__goghCompose.glass(item.source_url, {
                    kicker: editing ? seed.kicker || '' : '',
                    title: (stage.querySelector('.gogh-w-splash-title') || {}).value || '',
                    text: (stage.querySelector('.gogh-w-splash-text') || {}).value || '',
                  });
              insertSplash(made, refBlk);
              return;
            }
            b.classList.toggle('is-active');
            var url = item.source_url;
            if (b.classList.contains('is-active')) chosen.push(url);
            else chosen = chosen.filter(function (u) { return u !== url; });
            goLabel(stage.querySelector('.gogh-w-splash-go'));
          });
          box.appendChild(b);
        });
        var go = stage.querySelector('.gogh-w-splash-go');
        if (go && multi) {
          if (editing) goLabel(go);
          go.addEventListener('click', function () {
            var items2 = chosen.map(function (u) { return { img: u, cap: caps[u] || '' }; });
            var made = kind === 'carousel'
              ? window.__goghCompose.carousel(items2, opts)
              : window.__goghCompose.wall(items2, opts);
            insertSplash(made, refBlk);
          });
        } else if (go && kind === 'glass') {
          // words-only edits apply with the photo it already wears
          go.addEventListener('click', function () {
            insertSplash(window.__goghCompose.glass(seed.urls[0], {
              kicker: seed.kicker || '',
              title: (stage.querySelector('.gogh-w-splash-title') || {}).value || '',
              text: (stage.querySelector('.gogh-w-splash-text') || {}).value || '',
            }), refBlk);
          });
        }
      });
    };
    splashOv.querySelector('.gogh-w-splash-tiles').addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-splash]');
      if (!t) return;
      showStage(t.dataset.splash, null);
    });
    if (cur) showStage(cur.kind, cur);
  };
  var addAt = function (kind) {
    var blk = plusBlk;
    menu.hidden = true;
    if (!blk) return;
    if (kind === 'splash') {
      hidePlus();
      openSplash(blk);
      return;
    }
    if (kind === 'image') {
      filePick.onchange = function () {
        [].forEach.call(filePick.files, function (f) { insertImageAt(f, blk); });
        filePick.value = '';
        queueSave();
      };
      filePick.click();
      return;
    }
    if (kind === 'heading') {
      var h = swapBlock(blk, '<h2><br></h2>');
      caretInto(h);
    } else if (kind === 'quote') {
      var q = swapBlock(blk, '<blockquote><p><br></p></blockquote>');
      caretInto(q.querySelector('p') || q);
    } else if (kind === 'rule') {
      var hr = document.createElement('hr');
      blk.replaceWith(hr);
      var p2 = document.createElement('p');
      p2.innerHTML = '<br>';
      hr.after(p2);
      caretInto(p2);
    } else if (kind === 'embed') {
      var line = swapBlock(blk, '<p class="gogh-w-embedline"><br></p>');
      caretInto(line);
      var finish = function () {
        var url = line.textContent.trim();
        line.removeEventListener('keydown', onKey);
        if (!/^https?:\/\//.test(url)) {
          line.className = '';
          return;
        }
        var fig = document.createElement('figure');
        fig.className = 'gogh-w-embed';
        fig.dataset.url = url;
        fig.innerHTML = embedPreview(url);
        line.replaceWith(fig);
        var p3 = document.createElement('p');
        p3.innerHTML = '<br>';
        fig.after(p3);
        caretInto(p3);
        queueSave();
      };
      var onKey = function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); finish(); }
        if (ev.key === 'Escape') { line.className = ''; line.removeEventListener('keydown', onKey); }
      };
      line.addEventListener('keydown', onKey);
    }
    hidePlus();
    queueSave();
  };
  menu.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-add]');
    if (b) addAt(b.dataset.add);
  });
  // "/" on an empty line opens the same menu — the keyboard's ＋
  body.addEventListener('keydown', function (ev) {
    if (ev.key === '/' ) {
      var blk = blockOf(getSelection().anchorNode);
      if (emptyBlock(blk)) {
        ev.preventDefault();
        plusBlk = blk;
        placePlus();
        openMenu();
      }
    }
  });

  // ---------- the selection bubble: appears over selected words ----------
  // bold, italic, a link, a drop cap — the four moves prose actually makes
  var bub = document.createElement('div');
  bub.className = 'gogh-w-bub';
  bub.hidden = true;
  bub.innerHTML =
    '<button type="button" data-fmt="bold"><b>B</b></button>' +
    '<button type="button" data-fmt="italic"><i>I</i></button>' +
    '<button type="button" data-fmt="link">\ud83d\udd17</button>' +
    '<button type="button" data-fmt="dropcap" title="Drop cap">\u00c1a</button>' +
    '<input type="url" class="gogh-w-bub-url" placeholder="Paste a link, Enter" hidden />';
  document.body.appendChild(bub);
  var bubUrl = bub.querySelector('.gogh-w-bub-url');
  var savedRange = null;
  var hideBub = function () {
    bub.hidden = true;
    bubUrl.hidden = true;
    [].forEach.call(bub.querySelectorAll('button'), function (b2) { b2.hidden = false; });
  };
  var pinBub = function (rect) {
    bub.hidden = false;
    var bw = bub.offsetWidth || 180;
    bub.style.left = Math.max(8, Math.min(window.innerWidth - bw - 8, rect.left + rect.width / 2 - bw / 2)) + 'px';
    bub.style.top = Math.max(8, rect.top - 46) + 'px';
  };
  var placeBub = function () {
    if (!bubUrl.hidden) return; // typing a link holds the bubble
    var sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed || !body.contains(sel.anchorNode)) { hideBub(); return; }
    var rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect || !rect.width) { hideBub(); return; }
    pinBub(rect);
    // the link button doubles as unlink inside an existing link
    var a = sel.anchorNode.parentElement && sel.anchorNode.parentElement.closest('a');
    bub.querySelector('[data-fmt="link"]').textContent = a ? '\u26d3\ufe0e\u2715' : '\ud83d\udd17';
  };
  // scrolling used to leave the bubble hanging at its old viewport spot
  // (over the title, over anything) \u2014 it stays glued to its words instead
  window.addEventListener('scroll', function () {
    if (bub.hidden) return;
    if (!bubUrl.hidden) {
      if (savedRange) pinBub(savedRange.getBoundingClientRect());
      return;
    }
    placeBub();
  }, { passive: true });
  var bubT = null;
  document.addEventListener('selectionchange', function () {
    clearTimeout(bubT);
    bubT = setTimeout(placeBub, 120);
  });
  bub.addEventListener('pointerdown', function (ev) { ev.preventDefault(); }); // keep the selection
  // clicking anywhere else closes the bubble — including mid-link-typing
  document.addEventListener('pointerdown', function (ev) {
    if (!bub.hidden && !bub.contains(ev.target)) hideBub();
  }, true);
  bub.addEventListener('click', function (ev) {
    var b2 = ev.target.closest('[data-fmt]');
    if (!b2) return;
    var kind = b2.dataset.fmt;
    if (kind === 'bold' || kind === 'italic') {
      document.execCommand(kind);
      queueSave();
    } else if (kind === 'dropcap') {
      var sel = getSelection();
      var blk = sel.rangeCount ? blockOf(sel.anchorNode) : null;
      if (blk && blk.tagName === 'P') {
        blk.classList.toggle('has-drop-cap');
        queueSave();
      }
    } else if (kind === 'link') {
      var sel2 = getSelection();
      var a = sel2.anchorNode && sel2.anchorNode.parentElement && sel2.anchorNode.parentElement.closest('a');
      if (a) {
        document.execCommand('unlink');
        queueSave();
        hideBub();
        return;
      }
      savedRange = sel2.rangeCount ? sel2.getRangeAt(0).cloneRange() : null;
      [].forEach.call(bub.querySelectorAll('button'), function (x2) { x2.hidden = true; });
      bubUrl.hidden = false;
      bubUrl.value = '';
      bubUrl.focus();
    }
  });
  // focus drifting anywhere outside the bubble ends link mode — Tab,
  // a click the capture listener missed, anything
  bubUrl.addEventListener('blur', function () {
    setTimeout(function () {
      if (!bubUrl.hidden && !bub.contains(document.activeElement)) hideBub();
    }, 0);
  });
  bubUrl.addEventListener('keydown', function (ev) {
    ev.stopPropagation();
    if (ev.key === 'Escape') {
      hideBub();
      // hand the caret back to the words the writer was linking
      if (savedRange) {
        body.focus();
        var s0 = getSelection();
        s0.removeAllRanges();
        s0.addRange(savedRange);
      }
      return;
    }
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    var url = bubUrl.value.trim();
    if (savedRange) {
      var sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
    if (url) {
      document.execCommand('createLink', false, /^https?:|^mailto:|^\//.test(url) ? url : 'https://' + url);
      queueSave();
    }
    hideBub();
  });

  // ---------- objects wear their controls: hover shows ✕ (and ✎ on a
  // splash) — beginners never have to discover click-to-pick ----------
  var attachObjControls = function (node) {
    if (node.__goghCtl || node.classList.contains('gogh-w-embedline')) return;
    // figures INSIDE a splash belong to the composition — the splash's own
    // ✕/✎ are the only controls; a ✕ on a brick would edit nothing real
    if (!node.classList.contains('gogh-splash') && node.closest('.gogh-splash')) return;
    node.__goghCtl = true;
    var x = document.createElement('button');
    x.type = 'button';
    x.className = 'gogh-w-figx';
    x.setAttribute('aria-label', 'Remove');
    x.textContent = '\u2715';
    x.addEventListener('click', function (ev2) {
      ev2.stopPropagation();
      removeFig(node);
    });
    node.appendChild(x);
    if (node.classList.contains('gogh-splash')) {
      var pen = document.createElement('button');
      pen.type = 'button';
      pen.className = 'gogh-w-figx gogh-w-figpen';
      pen.setAttribute('aria-label', 'Replace');
      pen.textContent = '\u270e';
      pen.addEventListener('click', function (ev2) {
        ev2.stopPropagation();
        var target = node;
        unpick();
        openSplash(target);
      });
      node.appendChild(pen);
    }
  };
  setTimeout(function () {
    [].forEach.call(body.querySelectorAll('figure, .gogh-splash'), attachObjControls);
  }, 300);
  var picked = null;
  var unpick = function () {
    if (!picked) return;
    picked.classList.remove('is-picked');
    var ar = picked.querySelector('.gogh-w-altrow');
    if (ar) ar.remove(); // the alt field leaves with the pick
    picked = null;
  };
  var removeFig = function (fig) {
    var next = fig.nextElementSibling;
    fig.remove();
    unpick();
    if (!body.children.length) body.innerHTML = '<p><br></p>';
    var target = (next && body.contains(next)) ? next : body.lastElementChild;
    if (target && /^(P|H2|H3|DIV)$/.test(target.tagName)) {
      var r2 = document.createRange();
      r2.selectNodeContents(target);
      r2.collapse(true);
      var s3 = getSelection();
      s3.removeAllRanges();
      s3.addRange(r2);
    }
    queueSave();
  };
  body.addEventListener('click', function (ev) {
    var fig = ev.target.closest && ev.target.closest('figure, .gogh-splash');
    if (fig && fig.closest('.gogh-splash')) fig = fig.closest('.gogh-splash');
    if (!fig || !body.contains(fig) || fig.classList.contains('gogh-w-embedline')) { unpick(); return; }
    if (picked === fig) return;
    unpick();
    picked = fig;
    fig.classList.add('is-picked');
    attachObjControls(fig);
    if (fig.classList.contains('gogh-splash')) return;
    // alt text edits on pick — LABELLED, and gone again on unpick
    var altRow = document.createElement('div');
    altRow.className = 'gogh-w-altrow';
    var altLab = document.createElement('span');
    altLab.className = 'gogh-w-altlab';
    altLab.textContent = 'Alt text';
    altLab.title = 'Describes the image for screen readers and search';
    var alt = document.createElement('input');
    alt.type = 'text';
    alt.className = 'gogh-w-alt';
    alt.placeholder = 'Describe this image\u2026';
    alt.value = (fig.querySelector('img') || {}).alt || '';
    alt.addEventListener('click', function (ev2) { ev2.stopPropagation(); });
    alt.addEventListener('input', function () {
      var im = fig.querySelector('img');
      if (im) im.alt = alt.value;
      queueSave();
    });
    altRow.appendChild(altLab);
    altRow.appendChild(alt);
    // layout chips: Wide, or float the image INTO the words (the
    // transparent-cutout trick — text wraps around it)
    var layRow = document.createElement('span');
    layRow.className = 'gogh-w-layrow';
    [['', 'Wide'], ['alignleft', 'Left'], ['alignright', 'Right']].forEach(function (L) {
      var lb = document.createElement('button');
      lb.type = 'button';
      lb.className = 'gogh-w-lay' + ((L[0] ? fig.classList.contains(L[0]) : !/align(left|right)/.test(fig.className)) ? ' is-on' : '');
      lb.textContent = L[1];
      lb.addEventListener('click', function (ev3) {
        ev3.stopPropagation();
        fig.classList.remove('alignleft', 'alignright');
        if (L[0]) fig.classList.add(L[0]);
        [].forEach.call(layRow.children, function (o2) { o2.classList.toggle('is-on', o2 === lb); });
        queueSave();
      });
      layRow.appendChild(lb);
    });
    altRow.appendChild(layRow);
    altRow.addEventListener('click', function (ev2) { ev2.stopPropagation(); });
    fig.appendChild(altRow);
    // clicking an existing caption-less image can still gain a caption
    if (!fig.querySelector('figcaption')) {
      var cap2 = document.createElement('figcaption');
      cap2.className = 'wp-element-caption gogh-w-cap';
      cap2.contentEditable = 'true';
      fig.insertBefore(cap2, x);
    }
  });
  document.addEventListener('keydown', function (ev) {
    if (!picked) return;
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault();
      removeFig(picked);
    } else if (ev.key === 'Escape') {
      unpick();
    }
  }, true);
  document.addEventListener('pointerdown', function (ev) {
    if (picked && !picked.contains(ev.target)) unpick();
  }, true);

  // ---------- serialization: pure core blocks, nothing exotic ----------
  // serialize from a COPY — stripping controls off the live node would
  // leave the writer with no ✕ two seconds after the first autosave
  var stripEditorGoo = function (fig) {
    fig = fig.cloneNode(true);
    var x = fig.querySelector('.gogh-w-figx');
    if (x) x.remove();
    var a = fig.querySelector('.gogh-w-altrow');
    if (a) a.remove();
    var p = fig.querySelector('.gogh-w-figpen');
    if (p) p.remove();
    return fig;
  };
  var inlineClean = function (el) {
    var tmp = document.createElement('div');
    tmp.innerHTML = el.innerHTML;
    tmp.querySelectorAll('*').forEach(function (n) {
      var keep = /^(A|STRONG|B|EM|I|CODE|BR)$/.test(n.tagName);
      if (!keep) {
        n.replaceWith.apply(n, [].slice.call(n.childNodes));
        return;
      }
      [].slice.call(n.attributes).forEach(function (a) {
        if (!(n.tagName === 'A' && a.name === 'href')) n.removeAttribute(a.name);
      });
    });
    return tmp.innerHTML.trim();
  };
  var serialize = function () {
    var out = [];
    [].forEach.call(body.children, function (n) {
      var tag = n.tagName;
      if (n.classList && n.classList.contains('gogh-splash') && n.dataset.goghRaw) {
        // raw rides verbatim; the live node (and its controls) stays untouched
        out.push(decodeURIComponent(n.dataset.goghRaw));
      } else if (tag === 'P' || tag === 'DIV') {
        var html = inlineClean(n);
        var dc = n.classList && n.classList.contains('has-drop-cap');
        if (html && html !== '<br>') out.push('<!-- wp:paragraph ' + (dc ? '{"dropCap":true} ' : '') + '-->\n<p' + (dc ? ' class="has-drop-cap"' : '') + '>' + html + '</p>\n<!-- /wp:paragraph -->');
      } else if (tag === 'H2' || tag === 'H3' || tag === 'H4') {
        var lvl = +tag.slice(1);
        out.push('<!-- wp:heading ' + (lvl === 2 ? '' : '{"level":' + lvl + '} ') + '-->\n<h' + lvl + ' class="wp-block-heading">' + inlineClean(n) + '</h' + lvl + '>\n<!-- /wp:heading -->');
      } else if (tag === 'BLOCKQUOTE') {
        var inner = [].map.call(n.querySelectorAll('p'), function (p2) { return '<p>' + inlineClean(p2) + '</p>'; }).join('');
        if (!inner) inner = '<p>' + inlineClean(n) + '</p>';
        out.push('<!-- wp:quote -->\n<blockquote class="wp-block-quote">' + inner + '</blockquote>\n<!-- /wp:quote -->');
      } else if (tag === 'UL' || tag === 'OL') {
        var lis = [].map.call(n.querySelectorAll('li'), function (li) {
          return '<!-- wp:list-item -->\n<li>' + inlineClean(li) + '</li>\n<!-- /wp:list-item -->';
        }).join('');
        out.push('<!-- wp:list ' + (tag === 'OL' ? '{"ordered":true} ' : '') + '-->\n<' + tag.toLowerCase() + ' class="wp-block-list">' + lis + '</' + tag.toLowerCase() + '>\n<!-- /wp:list -->');
      } else if (tag === 'FIGURE' && n.classList.contains('gogh-w-embed') && n.dataset.url) {
        var eu = n.dataset.url;
        var prov = /youtu/.test(eu) ? 'youtube' : /vimeo/.test(eu) ? 'vimeo' : null;
        var attrs = { url: eu };
        if (prov) { attrs.type = 'video'; attrs.providerNameSlug = prov; attrs.responsive = true; }
        var figCls = 'wp-block-embed' + (prov ? ' is-type-video is-provider-' + prov + ' wp-block-embed-' + prov : '');
        out.push('<!-- wp:embed ' + JSON.stringify(attrs) + ' -->\n<figure class="' + figCls + '"><div class="wp-block-embed__wrapper">\n' + eu + '\n</div></figure>\n<!-- /wp:embed -->');
      } else if (tag === 'HR') {
        out.push('<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"/>\n<!-- /wp:separator -->');
      } else if (tag === 'FIGURE' && n.querySelector('img') && !n.classList.contains('gogh-w-uploading')) {
        n = stripEditorGoo(n);
        var img = n.querySelector('img');
        var mid = n.dataset.mid ? +n.dataset.mid : null;
        var cap = n.querySelector('figcaption');
        var capTxt = cap && cap.textContent.trim() ? inlineClean(cap) : '';
        var flo = n.classList.contains('alignleft') ? 'left' : n.classList.contains('alignright') ? 'right' : null;
        var iattrs = { sizeSlug: 'large' };
        if (mid) iattrs.id = mid;
        if (flo) iattrs.align = flo;
        out.push('<!-- wp:image ' + JSON.stringify(iattrs) + ' -->\n' +
          '<figure class="wp-block-image' + (flo ? ' align' + flo : '') + ' size-large"><img src="' + img.src + '" alt="' + (img.alt || '') + '"' + (mid ? ' class="wp-image-' + mid + '"' : '') + '/>' +
          (capTxt ? '<figcaption class="wp-element-caption">' + capTxt + '</figcaption>' : '') +
          '</figure>\n<!-- /wp:image -->');
      }
    });
    return out.join('\n\n');
  };

  // ---------- the view follows the caret (typewriter's kindness) ----------
  // writing happens in the middle of the screen, not at its bottom edge:
  // whenever the caret sinks past the comfort line, the page steps down.
  // Instant, small steps — the classic typewriter snap, no easing queasiness.
  // the step GLIDES: 420ms ease-out, cancelled the moment the writer
  // scrolls for themselves, instant under reduced-motion ("can we make
  // it beautifully smooth")
  var glideT = null;
  var glideBy = function (delta) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      window.scrollBy(0, delta);
      return;
    }
    clearInterval(glideT);
    var start = window.scrollY;
    var t0 = Date.now();
    var D = 420;
    var ease = function (t) { return 1 - Math.pow(1 - t, 4); };
    var cancel = function () { clearInterval(glideT); };
    window.addEventListener('wheel', cancel, { once: true, passive: true });
    window.addEventListener('touchstart', cancel, { once: true, passive: true });
    glideT = setInterval(function () {
      var t = Math.min(1, (Date.now() - t0) / D);
      window.scrollTo(0, start + delta * ease(t));
      if (t >= 1) clearInterval(glideT);
    }, 16);
  };
  var followT = null;
  var caretFollow = function () {
    var sel = getSelection();
    if (!sel.rangeCount || !body.contains(sel.anchorNode)) return;
    var rect = sel.getRangeAt(0).cloneRange().getBoundingClientRect();
    if (!rect || (!rect.top && !rect.bottom && !rect.height)) {
      var blk = blockOf(sel.anchorNode);
      if (blk) rect = blk.getBoundingClientRect();
    }
    if (!rect) return;
    // STEP scrolling, not creep: the caret descends freely until it
    // nears the bottom, then the page takes ONE deliberate step back to
    // the comfort line — a per-wrap nudge moved the whole page on every
    // line break ("the text reshuffles - its a bit unsettling")
    var threshold = window.innerHeight * 0.86;
    var comfort = window.innerHeight * 0.62;
    if (rect.bottom > threshold) glideBy(rect.bottom - comfort);
  };
  body.addEventListener('input', function () {
    clearTimeout(followT);
    followT = setTimeout(caretFollow, 60);
  });
  body.addEventListener('keyup', function (ev) {
    if (ev.key === 'Enter' || ev.key === 'ArrowDown') caretFollow();
  });

  // ---------- silent autosave + the one chip ----------
  var chip = document.createElement('div');
  chip.className = 'gogh-w-chip';
  chip.innerHTML = '<span class="gogh-w-count"></span><span class="gogh-w-saved"></span>' +
    '<button type="button" class="gogh-w-draft">Save draft</button>' +
    '<button type="button" class="gogh-w-catsbtn">Categories & tags</button>' +
    '<button type="button" class="gogh-w-publish">Publish</button>' +
    '<a class="gogh-w-back" href="' + (cfg.homeUrl || '/') + '">Back to site</a>';
  document.body.appendChild(chip);
  var countEl = chip.querySelector('.gogh-w-count');
  var savedEl = chip.querySelector('.gogh-w-saved');
  var words = function () {
    return (body.innerText.trim().match(/\S+/g) || []).length;
  };
  // the chip LIVES bottom-right — a quiet count, always in the same
  // place, never popping in or out ("keeps popping up when i dont want
  // it" + "not sure how to make it pop up" = the summoning model was
  // wrong both ways). Hovering it opens the full chip; that is all.
  // the quiet label names the document's STATE — "Draft · 12 words"
  // says both "your work is safe" and "publishing lives here"
  var statusWord = cfg.status === 'publish' ? 'Published' : 'Draft';
  var clean = true; // "saved" only appears when it is TRUE
  var quietLabel = function () {
    var n = words();
    var state = statusWord === 'Draft' && clean ? 'Draft saved' : statusWord;
    countEl.textContent = state + ' · ' + n + (n === 1 ? ' word' : ' words');
  };
  quietLabel();
  var countT = null;
  body.addEventListener('input', function () {
    clearTimeout(countT);
    countT = setTimeout(quietLabel, 300);
  });

  var saveT = null, inflight = null;
  var save = function (statusTo) {
    // saves SERIALIZE: a publish clicked mid-autosave waits its turn —
    // the old queue dropped the status and Publish "did nothing"
    if (inflight) return inflight.then(function () { return save(statusTo); });
    inflight = fetch(cfg.restUrl + 'wp/v2/posts/' + cfg.postId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
      credentials: 'same-origin',
      body: JSON.stringify(Object.assign({
        title: title ? title.textContent.trim() : '',
        content: serialize(),
      }, statusTo ? { status: statusTo } : {}, chosenCats.length ? { categories: chosenCats } : {}, chosenTags.length ? { tags: chosenTags } : {})),
    }).then(function (r) {
      inflight = null;
      if (r.ok) {
        savedEl.textContent = 'saved';
        setTimeout(function () { savedEl.textContent = ''; }, 1600);
        if (!saveT) { clean = true; quietLabel(); } // nothing newer waiting
      }
      return r.ok ? r.json() : null;
    }).catch(function () { inflight = null; });
    return inflight;
  };
  var queueSave = function () {
    clean = false;
    quietLabel();
    clearTimeout(saveT);
    saveT = setTimeout(function () { saveT = null; save(); }, 2500);
  };
  body.addEventListener('input', queueSave);
  if (title) title.addEventListener('input', queueSave);

  var chosenCats = [];
  var chosenTags = [];
  var chosenNames = [];
  var doPublish = function (b) {
    b.disabled = true;
    b.textContent = 'Publishing…';
    clearTimeout(saveT);
    save('publish').then(function (post) {
      if (post && post.link) {
        b.textContent = 'Published ↗';
        b.disabled = false;
        statusWord = 'Published';
        quietLabel();
        b.onclick = function () { location.href = post.link; };
      } else {
        b.textContent = 'Publish';
        b.disabled = false;
      }
    });
  };
  chip.querySelector('.gogh-w-publish').addEventListener('click', function () {
    doPublish(chip.querySelector('.gogh-w-publish'));
  });
  // leaving flushes any words the 2.5s debounce hasn't saved yet
  chip.querySelector('.gogh-w-back').addEventListener('click', function (ev) {
    if (clean && !saveT && !inflight) return; // nothing pending — plain link
    ev.preventDefault();
    var href = ev.currentTarget.href;
    clearTimeout(saveT);
    saveT = null;
    save().then(function () { location.href = href; });
  });
  chip.querySelector('.gogh-w-draft').addEventListener('click', function () {
    var d = chip.querySelector('.gogh-w-draft');
    d.textContent = 'Saving\u2026';
    clearTimeout(saveT);
    save().then(function () {
      d.textContent = 'Saved \u2713';
      setTimeout(function () { d.textContent = 'Save draft'; }, 1400);
    });
  });
  var catsBtn = chip.querySelector('.gogh-w-catsbtn');
  var catsLabel = function () {
    // the button says WHAT IT HOLDS — a count needed a translator
    if (!chosenNames.length) { catsBtn.textContent = 'Categories & tags'; return; }
    catsBtn.textContent = chosenNames.slice(0, 2).join(', ') + (chosenNames.length > 2 ? ' +' + (chosenNames.length - 2) : '');
  };
  var closeFiling = function () {
    var row = chip.querySelector('.gogh-w-cats');
    if (row) row.remove();
    chip.classList.remove('is-filing');
    catsLabel();
  };
  // clicking off the card closes it — the canvas is always one click away
  document.addEventListener('pointerdown', function (ev) {
    if (chip.classList.contains('is-filing') && !chip.contains(ev.target)) closeFiling();
  }, true);
  catsBtn.addEventListener('click', function () {
    if (chip.querySelector('.gogh-w-cats')) {
      closeFiling();
      return;
    }
    var b = catsBtn;
    b.textContent = '\u2026';
    fetch(cfg.restUrl + 'wp/v2/categories?per_page=50&hide_empty=0', {
      headers: { 'X-WP-Nonce': cfg.nonce },
      credentials: 'same-origin',
    }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }).then(function (cats) {
      var row = document.createElement('div');
      row.className = 'gogh-w-cats';
      var lab1 = document.createElement('span');
      lab1.className = 'gogh-w-lab';
      lab1.textContent = 'Categories';
      row.appendChild(lab1);
      var syncCats = function () {
        chosenCats = [];
        chosenNames.length = 0;
        [].forEach.call(chip.querySelectorAll('.gogh-w-cat.is-on'), function (x) {
          if (x.dataset.cid) chosenCats.push(+x.dataset.cid);
          chosenNames.push(x.textContent.replace(/^#\s*/, '#'));
        });
        catsLabel();
      };
      cats.filter(function (c) { return c.slug !== 'uncategorized'; }).forEach(function (c) {
        var pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'gogh-w-cat';
        pill.textContent = c.name;
        pill.dataset.cid = c.id;
        pill.addEventListener('click', function () { pill.classList.toggle('is-on'); syncCats(); });
        row.appendChild(pill);
      });
      var fresh = document.createElement('input');
      fresh.type = 'text';
      fresh.className = 'gogh-w-newcat';
      fresh.placeholder = 'new…';
      fresh.addEventListener('keydown', function (ev) {
        ev.stopPropagation();
        if (ev.key !== 'Enter' || !fresh.value.trim()) return;
        fetch(cfg.restUrl + 'wp/v2/categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
          credentials: 'same-origin',
          body: JSON.stringify({ name: fresh.value.trim() }),
        }).then(function (r) { return r.ok ? r.json() : null; }).then(function (c) {
          if (!c) return;
          var pill = document.createElement('button');
          pill.type = 'button';
          pill.className = 'gogh-w-cat is-on';
          pill.textContent = c.name;
          pill.dataset.cid = c.id;
          pill.addEventListener('click', function () { pill.classList.toggle('is-on'); syncCats(); });
          row.insertBefore(pill, fresh);
          fresh.value = '';
          syncCats();
        });
      });
      row.appendChild(fresh);
      // tags: freeform — type, Enter, it finds or creates
      var lab2 = document.createElement('span');
      lab2.className = 'gogh-w-lab';
      lab2.textContent = 'Tags';
      var tagLine = document.createElement('div');
      tagLine.className = 'gogh-w-tags';
      tagLine.__lab = lab2;
      var tagIn = document.createElement('input');
      tagIn.type = 'text';
      tagIn.className = 'gogh-w-newcat gogh-w-newtag';
      tagIn.placeholder = '# tag\u2026';
      var addTagPill = function (t) {
        var pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'gogh-w-cat is-on gogh-w-tagpill';
        pill.textContent = '# ' + t.name;
        pill.dataset.tid = t.id;
        pill.addEventListener('click', function () {
          pill.remove();
          chosenTags = chosenTags.filter(function (x) { return x !== t.id; });
          chosenNames = chosenNames.filter(function (nm) { return nm !== '#' + t.name; });
          catsLabel();
        });
        tagLine.insertBefore(pill, tagIn);
      };
      tagIn.addEventListener('keydown', function (ev) {
        ev.stopPropagation();
        if (ev.key !== 'Enter' || !tagIn.value.trim()) return;
        var name = tagIn.value.trim().replace(/^#\s*/, '');
        tagIn.value = '';
        fetch(cfg.restUrl + 'wp/v2/tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
          credentials: 'same-origin',
          body: JSON.stringify({ name: name }),
        }).then(function (r) { return r.json(); }).then(function (t) {
          var id = t && t.id ? t.id : (t && t.code === 'term_exists' && t.data ? t.data.term_id : null);
          if (!id) return;
          if (chosenTags.indexOf(id) !== -1) return;
          chosenTags.push(id);
          chosenNames.push('#' + name);
          addTagPill({ id: id, name: name });
          catsLabel();
        });
      });
      tagLine.appendChild(tagIn);
      row.appendChild(lab2);
      row.appendChild(tagLine);
      chip.insertBefore(row, catsBtn);
      chip.classList.add('is-filing');
      catsBtn.textContent = 'Done';
    });
  });

  // leaving with unsaved words: one last quiet save
  window.addEventListener('beforeunload', function () {
    if (saveT) { clearTimeout(saveT); try { navigator.sendBeacon && save(); } catch (e) {} }
  });

  // exposed for verification, not for humans
  window.__goghWrite = { serialize: serialize, save: save };
})();

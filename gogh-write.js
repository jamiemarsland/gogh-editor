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
  var readOnly = false; // a classic/mixed post is shown but never saved over
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
    // wearing alignfull lets WP's own container rules bleed the wrapper —
    // they only reach DIRECT children, and the wrapper stands between
    node.className = 'gogh-splash' + (/alignfull/.test(blockRaw) ? ' alignfull' : '');
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
    // guarantee a typeable line beside every splash/figure, exactly as
    // insertSplash does at insert time — without this, two splashes saved
    // back-to-back (or a splash as the first block) reload with no place
    // the caret can ever go between them (audit: caret-proof islands)
    var isIsland = function (el) {
      return el && el.classList && (el.classList.contains('gogh-splash') || el.tagName === 'FIGURE' || el.tagName === 'HR');
    };
    var gap = function () { var p = document.createElement('p'); p.innerHTML = '<br>'; return p; };
    [].forEach.call([].slice.call(body.children), function (el) {
      if (!isIsland(el)) return;
      if (!el.previousElementSibling || isIsland(el.previousElementSibling)) el.before(gap());
    });
    if (!body.lastElementChild || !/^(P|H2|H3|H4)$/.test(body.lastElementChild.tagName)) {
      body.appendChild(gap());
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
  // gogh write faithfully round-trips gogh's own blocks and the core
  // blocks it understands; classic-editor prose and blocks nested outside
  // the top level would be flattened by the serializer. Rather than
  // silently mangle a rich post (audit), REFUSE it read-only.
  var stripToText = function (s) {
    return s.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  };
  var refuseReadOnly = function (why) {
    readOnly = true;
    body.contentEditable = 'false';
    if (title) title.contentEditable = 'false';
    var bar = document.createElement('div');
    bar.className = 'gogh-w-locked';
    bar.innerHTML = '<b>This post was written in the WordPress editor.</b> ' +
      'To keep every part of it safe, edit it there. gogh write is for new posts and gogh-authored ones.' +
      ' <a href="' + (cfg.adminEdit || ('/wp-admin/post.php?post=' + cfg.postId + '&action=edit')) + '">Open in WordPress →</a>';
    document.body.appendChild(bar);
    // nothing to save means nothing to click — retire the surfaces
    [].forEach.call(document.querySelectorAll('.gogh-w-chip, .gogh-w-plus, .gogh-w-bub'), function (el) {
      el.style.display = 'none';
    });
  };
  fetch(cfg.restUrl + 'wp/v2/posts/' + cfg.postId + '?context=edit', {
    headers: { 'X-WP-Nonce': cfg.nonce },
    credentials: 'same-origin',
  }).then(function (r) { return r.ok ? r.json() : null; }).then(function (post) {
    var raw = post && post.content && post.content.raw || '';
    if (typedFirst || !raw.trim()) return; // fresh draft, or the writer beat us to it
    var blocks = parseBlocks(raw);
    var classic = !blocks.length && stripToText(raw).length > 0;
    var mixed = blocks.length &&
      stripToText(raw).length > stripToText(blocks.map(function (b) { return b.raw; }).join('')).length + 4;
    if (classic || mixed) { refuseReadOnly(classic ? 'classic' : 'mixed'); return; }
    if (surfaceFromRaw(raw)) {
      [].forEach.call(body.querySelectorAll('figure, .gogh-splash'), attachObjControls);
      if (window.__goghViewInit) window.__goghViewInit();
      window.gogh.enhance(body);
    }
  }).catch(function () {});

  // ---------- the surface ----------
  if (title) {
    title.contentEditable = 'plaintext-only';
    title.spellcheck = false;
    title.classList.add('gogh-w-title');
    if (!title.textContent.trim()) title.textContent = '';
  }
  if (!readOnly) body.contentEditable = 'true';
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
  // a picture already in the library lands without re-uploading — same
  // figure shape insertImageAt settles into after its upload round-trip
  var insertMediaItemAt = function (m, refNode) {
    var fig = document.createElement('figure');
    fig.className = 'wp-block-image size-large';
    fig.contentEditable = 'false';
    var big = m.media_details && m.media_details.sizes &&
      (m.media_details.sizes.large || m.media_details.sizes.full);
    var img = document.createElement('img');
    img.alt = m.alt_text || '';
    img.className = 'wp-image-' + m.id;
    img.src = big ? big.source_url : m.source_url;
    fig.appendChild(img);
    var cap = document.createElement('figcaption');
    cap.className = 'wp-element-caption gogh-w-cap';
    cap.contentEditable = 'true';
    fig.appendChild(cap);
    fig.dataset.mid = m.id;
    if (refNode && refNode.parentNode === body) body.insertBefore(fig, refNode.nextSibling);
    else body.appendChild(fig);
    if (!fig.nextElementSibling || /^(FIGURE|HR)$/.test(fig.nextElementSibling.tagName)) {
      var after = document.createElement('p');
      after.innerHTML = '<br>';
      fig.after(after);
    }
    attachObjControls(fig);
  };
  // the image door opens on the LIBRARY first ("we need to let folks choose
  // images from their media library"), with Upload one tap away
  // opts: { title, onPick(mediaItem) } turns the library into a PICKER —
  // the cover photo chooser rides this; without opts it inserts as ever
  var openImageLibrary = function (blk, opts) {
    var ov = document.createElement('div');
    ov.className = 'gogh-w-imgpick';
    ov.innerHTML = '<div class="gogh-w-imgpick-sheet">' +
      '<div class="gogh-w-imgpick-head"><b>' + ((opts && opts.title) || 'Add an image') + '</b>' +
      '<span class="gogh-w-imgpick-sp"></span>' +
      '<button type="button" class="gogh-w-imgpick-up">Upload</button>' +
      '<button type="button" class="gogh-w-imgpick-x" title="Close">✕</button></div>' +
      '<div class="gogh-w-imgpick-grid"><span class="gogh-media-loading">Loading your library…</span></div></div>';
    document.body.appendChild(ov);
    var close = function () { ov.remove(); };
    ov.addEventListener('pointerdown', function (ev) { if (ev.target === ov) close(); });
    ov.querySelector('.gogh-w-imgpick-x').addEventListener('click', close);
    ov.querySelector('.gogh-w-imgpick-up').addEventListener('click', function () {
      close();
      filePick.onchange = function () {
        if (opts && opts.onPick) {
          var f0 = filePick.files[0];
          filePick.value = '';
          if (!f0) return;
          var fd0 = new FormData();
          fd0.append('file', f0);
          fetch(cfg.restUrl + 'wp/v2/media', { method: 'POST', headers: { 'X-WP-Nonce': cfg.nonce }, credentials: 'same-origin', body: fd0 })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (m) { if (m) opts.onPick(m); });
          return;
        }
        [].forEach.call(filePick.files, function (f) { insertImageAt(f, blk); });
        filePick.value = '';
        queueSave();
      };
      filePick.click();
    });
    fetch(cfg.restUrl + 'wp/v2/media?per_page=48&media_type=image&orderby=date&order=desc', {
      headers: { 'X-WP-Nonce': cfg.nonce },
      credentials: 'same-origin',
    }).then(function (r) { return r.json(); }).then(function (items) {
      var box = ov.querySelector('.gogh-w-imgpick-grid');
      box.innerHTML = '';
      if (!items.length) {
        box.innerHTML = '<span class="gogh-media-loading">No images yet — Upload is right up there.</span>';
        return;
      }
      items.forEach(function (item) {
        var thumb = item.media_details && item.media_details.sizes &&
          (item.media_details.sizes.thumbnail || item.media_details.sizes.medium);
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'gogh-w-imgpick-cell';
        b.style.backgroundImage = 'url("' + (thumb ? thumb.source_url : item.source_url) + '")';
        if (item.alt_text) b.title = item.alt_text;
        b.addEventListener('click', function () {
          if (opts && opts.onPick) { opts.onPick(item); close(); return; }
          insertMediaItemAt(item, blk);
          close();
          queueSave();
        });
        box.appendChild(b);
      });
    }).catch(function () {
      ov.querySelector('.gogh-w-imgpick-grid').innerHTML =
        '<span class="gogh-media-loading">Could not reach the library — try Upload.</span>';
    });
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
  // an SVG, not a text glyph: the site's own font renders '+' however it
  // pleases (Literata drew a hairline — 'the plus sign looks broken')
  plus.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M7 1.5v11M1.5 7h11"/></svg>';
  document.body.appendChild(plus);
  var menu = document.createElement('div');
  menu.className = 'gogh-w-menu';
  var mIc = function (paths) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
  };
  menu.innerHTML =
    '<button type="button" data-add="heading">' + mIc('<path d="M6 5v14M18 5v14M6 12h12"/>') + 'Heading</button>' +
    '<button type="button" data-add="image">' + mIc('<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M6 15l4-4 3 3 2.5-2.5L19 15"/><circle cx="9" cy="9" r="1.2"/>') + 'Image</button>' +
    '<button type="button" data-add="quote">' + mIc('<path d="M9 7c-2.5 0.5-4 2.5-4 5v5h5v-5H7c0-2 1-3 2-3.5zM19 7c-2.5 0.5-4 2.5-4 5v5h5v-5h-3c0-2 1-3 2-3.5z"/>') + 'Quote</button>' +
    '<button type="button" data-add="embed">' + mIc('<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M10 9.5l4.5 2.5L10 14.5z"/>') + 'Embed</button>' +
    '<button type="button" data-add="rule">' + mIc('<path d="M4 12h16"/>') + 'Divider</button>' +
    '<button type="button" data-add="splash" class="gogh-w-splashbtn">' + mIc('<path d="M12 4l1.8 6.2L20 12l-6.2 1.8L12 20l-1.8-6.2L4 12l6.2-1.8z"/>') + 'Splash</button>' +
    '<button type="button" data-add="break">' + mIc('<rect x="3" y="8" width="18" height="8" rx="1.5"/><path d="M12 3v2.5M12 18.5V21"/>') + 'Freeform break</button>';
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
    node.className = 'gogh-splash' + (/alignfull/.test(made.raw) ? ' alignfull' : '');
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
    // the splash comes ALIVE in the room — arrows, dots, lightbox — the
    // same audition the published page gives ("without having to publish")
    if (window.__goghViewInit) window.__goghViewInit();
    window.gogh.enhance(body);
    closeSplash();
    queueSave();
    return node;
  };
  var node2After = function (ref, node) { ref.after(node); };
  // ---------- 🎪 Freeform break: a full canvas band inside the story ----------
  // ("could / should we have a freeform option — no limits") — shape A from
  // The Freeform Post note. The band is a REAL gogh section: it arrives
  // designed, rides the splash rails through save and load, and its ✎
  // opens the canvas on this very post, where it drags like anything drawn
  // by hand. The prose around it is untouched — the canvas save splices.
  var insertBreak = function (refBlk) {
    if (!cfg.breakTpl) return;
    // a fresh scope per break, or two breaks would share one stylesheet
    var raw = cfg.breakTpl.replace(/gogh-sec-2/g, 'gogh-sec-brk' + Math.random().toString(36).slice(2, 8));
    var node = insertSplash({ raw: raw, html: innerOf(raw) }, refBlk);
    if (node) {
      node.classList.add('gogh-w-break'); // controls attached first — retell the pen its job
      var pen = node.querySelector('.gogh-w-figpen');
      if (pen) { pen.setAttribute('aria-label', 'Design this break on the canvas'); pen.title = 'Design this break on the canvas'; }
    }
  };
  // the pencil's promise on a break: flush the words, then open the canvas
  var designBreak = function () {
    var base = cfg.permalink || location.href.split('?')[0];
    var url = base + (base.indexOf('?') === -1 ? '?' : '&') + 'gogh-edit=1';
    clearTimeout(saveT);
    saveT = null;
    save().then(function (post) {
      if (post) { location.href = url; }
      else if (typeof countEl !== 'undefined') { countEl.textContent = '⚠ Not saved — staying here so nothing is lost'; }
    });
  };
  // ---------- break-image focal point: drag the photo to reframe ----------
  // The break window crops from the top by default; when that frames a photo
  // badly, grab the picture and slide it. The chosen slice persists as an
  // inline object-position, recomposed into the block raw on release.
  (function () {
    var fd = null; // { img, blk, startY, startFocal, moved }
    var focalOf = function (img) {
      var m = /50%\s+(-?[\d.]+)%/.exec(img.style.objectPosition || '');
      return m ? +m[1] : 0; // no inline style = the top-crop default
    };
    body.addEventListener('pointerdown', function (ev) {
      var img = ev.target.closest && ev.target.closest('.gogh-splash figure.gogh-splash-break img');
      if (!img) return;
      var blk = img.closest('.gogh-splash');
      if (!blk || !blk.dataset.goghRaw) return;
      ev.preventDefault(); // the wrapper is contentEditable=false; no caret to place
      fd = { img: img, blk: blk, startY: ev.clientY, startFocal: focalOf(img), moved: false };
      try { img.setPointerCapture(ev.pointerId); } catch (err) {}
    }, true);
    body.addEventListener('pointermove', function (ev) {
      if (!fd) return;
      var dy = ev.clientY - fd.startY;
      if (Math.abs(dy) > 2) fd.moved = true;
      // dragging the photo DOWN reveals what is above the window: lower focal
      var next = Math.max(0, Math.min(100, fd.startFocal - dy / fd.img.clientHeight * 100));
      fd.img.style.objectPosition = '50% ' + Math.round(next) + '%';
    }, true);
    var endFocalDrag = function () {
      if (!fd) return;
      var d = fd; fd = null;
      if (!d.moved) return; // a plain tap is not a reframe
      var raw = decodeURIComponent(d.blk.dataset.goghRaw);
      var alt = (/(?:alt="([^"]*)")/.exec(raw) || [])[1] || '';
      var made = window.__goghCompose.breakImage(d.img.getAttribute('src'), alt, focalOf(d.img));
      d.blk.dataset.goghRaw = encodeURIComponent(made.raw);
      queueSave();
    };
    body.addEventListener('pointerup', endFocalDrag, true);
    body.addEventListener('pointercancel', endFocalDrag, true);
  })();
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
  // ---------- the pack door ----------
  // add-on packs teach gogh new splash kinds without touching core:
  //   window.gogh.registerSplash({ key, label, hint, icon, multi,
  //     minPhotos, lines, linesHint, compose(items, opts) -> {raw, html} })
  // saved output must stay pure core blocks — the pack's enhancer only
  // decorates at view time, exactly like gogh's own carousel.
  window.gogh = window.gogh || {};
  window.gogh._splashes = window.gogh._splashes || {};
  window.gogh.registerSplash = function (def) {
    if (!def || typeof def.compose !== 'function') return;
    // keys ride into markup and DOM ids — keep them boring, and never let
    // one pack silently clobber another (audit: last-write-wins collisions)
    if (!/^[a-z0-9-]+$/.test(def.key || '')) {
      try { console.warn('gogh: splash key must match [a-z0-9-]:', def.key); } catch (e) {}
      return;
    }
    if (window.gogh._splashes[def.key]) {
      try { console.warn('gogh: splash key already registered, ignoring:', def.key); } catch (e) {}
      return;
    }
    window.gogh._splashes[def.key] = def;
  };
  window.gogh._imageStyles = window.gogh._imageStyles || [];
  window.gogh.registerImageStyle = function (def) {
    if (!def || !def.cls || !def.label) return;
    if (window.gogh._imageStyles.some(function (d) { return d.cls === def.cls; })) return; // dedupe
    window.gogh._imageStyles.push(def);
  };
  window.gogh._enhancers = window.gogh._enhancers || [];
  window.gogh.registerEnhancer = function (fn) {
    if (typeof fn !== 'function') return;
    if (window.gogh._enhancers.indexOf(fn) !== -1) return; // dedupe
    window.gogh._enhancers.push(fn);
  };
  window.gogh.enhance = function (root) {
    (window.gogh._enhancers || []).forEach(function (fn) {
      try { fn(root || document); } catch (e) {}
    });
  };
  // a third-party pack's compose() is untrusted: a throw, a missing raw,
  // or unbalanced block comments would corrupt the post (a malformed
  // splash swallows every block after it on the next boot). Catch and
  // validate before anything is inserted.
  var packMade = function (pack, items, opts) {
    var made;
    try { made = pack.compose(items, opts || {}); } catch (e) {
      try { console.warn('gogh: splash pack "' + pack.key + '" threw', e); } catch (e2) {}
      return null;
    }
    if (!made || typeof made.raw !== 'string' || !made.raw.trim()) return null;
    var blocks = parseBlocks(made.raw);
    if (!blocks.length) return null; // no top-level block
    // every non-self-closing open must have a close, or a later boot's
    // parseBlocks never returns to depth 0 and swallows the rest of the post
    var opens = (made.raw.match(/<!--\s+wp:[a-z0-9\/-]+(?![^>]*\/-->)[^>]*-->/g) || []).length;
    var closes = (made.raw.match(/<!--\s+\/wp:[a-z0-9\/-]+\s+-->/g) || []).length;
    if (opens !== closes) { try { console.warn('gogh: pack "' + pack.key + '" made unbalanced markup'); } catch (e) {} return null; }
    if (made.html == null) made.html = made.raw.replace(/<!--[\s\S]*?-->/g, '');
    return made;
  };
  var packSplashes = function () {
    var out = [];
    for (var k in window.gogh._splashes) out.push(window.gogh._splashes[k]);
    return out;
  };
  var esc = function (t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
      '<button type="button" data-splash="carousel">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="5" width="8" height="14" rx="1.5"/><path d="M4 8.5v7M20 8.5v7"/></svg>' +
      '<span><b>Carousel</b><i>photos that glide</i></span></button>' +
      '<button type="button" data-splash="wall">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="7" height="9" rx="1"/><rect x="13" y="4" width="7" height="5" rx="1"/><rect x="13" y="11" width="7" height="9" rx="1"/><rect x="4" y="15" width="7" height="5" rx="1"/></svg>' +
      '<span><b>Photo wall</b><i>a gallery interlude</i></span></button>' +
      '<button type="button" data-splash="break">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h20M2 18h20"/><path d="M5 15l4-4 3 3 2.5-2.5L19 15"/></svg>' +
      '<span><b>Break image</b><i>a full-bleed pause</i></span></button>' +
      '<button type="button" data-splash="glass">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="1.5"/><rect x="7" y="9" width="10" height="6" rx="1"/></svg>' +
      '<span><b>Glass card</b><i>a frosted call-out</i></span></button>' +
      packSplashes().map(function (p) {
        return '<button type="button" data-splash="pack:' + p.key + '">' +
          (p.icon || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 4l1.8 6.2L20 12l-6.2 1.8L12 20l-1.8-6.2L4 12l6.2-1.8z"/></svg>') +
          '<span><b>' + esc(p.label || p.key) + '</b><i>' + esc(p.hint || '') + '</i></span></button>';
      }).join('') +
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
      var pack = kind.indexOf('pack:') === 0 ? window.gogh._splashes[kind.slice(5)] : null;
      var multi = kind === 'carousel' || kind === 'wall' || (pack && pack.multi !== false);
      var editing = !!seed;
      stage.innerHTML = '<div class="gogh-w-splash-hint">' +
        (editing
          ? (multi ? 'Tap photos to add or remove, then Update.' : 'Tap a photo to swap it in.')
          : (multi ? 'Pick a few photos, then Add.' : 'Pick the photo.')) + '</div>' +
        '<button type="button" class="gogh-btn gogh-w-splash-upload">Upload photos</button>' +
        (pack && pack.lines
          ? '<textarea class="gogh-input gogh-w-splash-lines" rows="3" placeholder="' +
            String(pack.linesHint || 'One line per photo\u2026').replace(/"/g, '&quot;') + '"></textarea>'
          : '') +
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
        go.disabled = chosen.length < (pack && pack.minPhotos ? pack.minPhotos : 2);
        go.textContent = chosen.length ? (editing ? 'Update ' : 'Add ') + chosen.length + ' photos' : (editing ? 'Update' : 'Add');
      };
      var renumber = function () {
        [].forEach.call(stage.querySelectorAll('.gogh-thumb'), function (t) {
          var i = chosen.indexOf(t.dataset.url);
          if (i >= 0) t.dataset.n = i + 1;
          else if (t.dataset.n !== '✓') t.removeAttribute('data-n');
        });
      };
      var rk = stage.querySelector('.gogh-w-splash-rekind');
      if (rk) rk.addEventListener('click', function () {
        stage.hidden = true;
        splashOv.querySelector('.gogh-w-splash-tiles').hidden = false;
      });
      // one builder for every cell — the library fetch and fresh uploads share
      // it, so an uploaded photo behaves exactly like one that was always there
      var addCell = function (item, atFront) {
        var box = stage.querySelector('.gogh-w-splash-media');
        var empty = box.querySelector('.gogh-media-loading');
        if (empty) empty.remove();
        var thumb = (item.media_details && item.media_details.sizes &&
          (item.media_details.sizes.thumbnail || item.media_details.sizes.medium));
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'gogh-thumb';
        b.dataset.url = item.source_url;
        if (editing && (multi ? chosen.indexOf(item.source_url) !== -1 : seed.urls[0] === item.source_url)) {
          b.classList.add('is-active');
          if (!multi) b.dataset.n = '\u2713'; // the photo it wears today
        }
        b.style.backgroundImage = 'url("' + (thumb ? thumb.source_url : item.source_url) + '")';
        b.addEventListener('click', function () {
          if (!multi) {
            var made;
            if (pack) {
              made = packMade(pack, [{ img: item.source_url, cap: item.alt_text || '' }],
                { lines: [], title: (stage.querySelector('.gogh-w-splash-title') || {}).value || '' });
            } else {
              made = kind === 'break'
                ? window.__goghCompose.breakImage(item.source_url, item.alt_text || '')
                : window.__goghCompose.glass(item.source_url, {
                    kicker: editing ? seed.kicker || '' : '',
                    title: (stage.querySelector('.gogh-w-splash-title') || {}).value || '',
                    text: (stage.querySelector('.gogh-w-splash-text') || {}).value || '',
                  });
            }
            if (made) insertSplash(made, refBlk);
            return;
          }
          b.classList.toggle('is-active');
          var url = item.source_url;
          if (b.classList.contains('is-active')) chosen.push(url);
          else chosen = chosen.filter(function (u) { return u !== url; });
          renumber();
          goLabel(stage.querySelector('.gogh-w-splash-go'));
        });
        if (atFront && box.firstChild) box.insertBefore(b, box.firstChild);
        else box.appendChild(b);
        return b;
      };
      // fresh photos join the wall without leaving the sheet ("folks need
      // to be able to upload photos to the photo wall") — and arrive
      // already picked, because uploading IS picking
      var up = stage.querySelector('.gogh-w-splash-upload');
      if (up) up.addEventListener('click', function () {
        var inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/*';
        inp.multiple = true;
        inp.addEventListener('change', function () {
          var todo = inp.files.length;
          if (!todo) return;
          up.disabled = true;
          up.textContent = 'Uploading\u2026';
          [].forEach.call(inp.files, function (f) {
            var fd = new FormData();
            fd.append('file', f);
            fetch(cfg.restUrl + 'wp/v2/media', {
              method: 'POST',
              headers: { 'X-WP-Nonce': cfg.nonce },
              credentials: 'same-origin',
              body: fd,
            }).then(function (r) { return r.ok ? r.json() : null; }).then(function (m) {
              todo--;
              if (m) {
                var cell = addCell(m, true);
                if (multi && cell) cell.click();
              }
              if (todo <= 0) { up.disabled = false; up.textContent = 'Upload photos'; }
            }).catch(function () {
              todo--;
              if (todo <= 0) { up.disabled = false; up.textContent = 'Upload photos'; }
            });
          });
        });
        inp.click();
      });
      fetch(cfg.restUrl + 'wp/v2/media?per_page=32&media_type=image&orderby=date&order=desc', {
        headers: { 'X-WP-Nonce': cfg.nonce },
        credentials: 'same-origin',
      }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }).then(function (items) {
        var box = stage.querySelector('.gogh-w-splash-media');
        box.innerHTML = '';
        if (!items.length) { box.innerHTML = '<span class="gogh-media-loading">No images yet \u2014 upload some first.</span>'; return; }
        items.forEach(function (item) { addCell(item); });
        renumber(); // editing arrives with its picks already numbered
        var go = stage.querySelector('.gogh-w-splash-go');
        if (go && multi) {
          if (editing) goLabel(go);
          go.addEventListener('click', function () {
            var items2 = chosen.map(function (u) { return { img: u, cap: caps[u] || '' }; });
            var made;
            if (pack) {
              var linesEl = stage.querySelector('.gogh-w-splash-lines');
              made = packMade(pack, items2, { lines: linesEl ? linesEl.value.split('\n') : [] });
            } else {
              made = kind === 'carousel'
                ? window.__goghCompose.carousel(items2, opts)
                : window.__goghCompose.wall(items2, opts);
            }
            if (made) insertSplash(made, refBlk);
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
    if (kind === 'break') {
      hidePlus();
      insertBreak(blk);
      return;
    }
    if (kind === 'image') {
      openImageLibrary(blk);
      hidePlus();
      return;
    }
    if (kind === 'heading') {
      var h = swapBlock(blk, '<h2><br></h2>');
      caretInto(h);
    } else if (kind === 'quote') {
      var q = swapBlock(blk, '<blockquote class="wp-block-quote"><p><br></p></blockquote>');
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
    // Backspace/Delete at a splash BOUNDARY must not silently swallow the
    // whole composition (the audit's booby trap) — turn it into a pick,
    // so the writer sees what they're about to remove and confirms
    if (ev.key === 'Backspace' || ev.key === 'Delete') {
      var sel = getSelection();
      if (!sel.rangeCount || !sel.isCollapsed) return;
      var blk2 = blockOf(sel.anchorNode);
      if (!blk2) return;
      var r = sel.getRangeAt(0).cloneRange();
      var neighbour = null;
      if (ev.key === 'Backspace') {
        r.setStart(blk2, 0); // text before the caret within this block
        if (!r.toString().trim()) neighbour = blk2.previousElementSibling;
      } else {
        r.setEnd(blk2, blk2.childNodes.length); // text after the caret
        if (!r.toString().trim()) neighbour = blk2.nextElementSibling;
      }
      if (neighbour && neighbour.classList && neighbour.classList.contains('gogh-splash')) {
        ev.preventDefault();
        neighbour.click(); // pick it; ✕ (and the picked-key confirm) take over
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
      var isBreak = node.classList.contains('gogh-w-break');
      pen.setAttribute('aria-label', isBreak ? 'Design this break on the canvas' : 'Replace');
      pen.title = isBreak ? 'Design this break on the canvas' : '';
      pen.textContent = '\u270e';
      pen.addEventListener('click', function (ev2) {
        ev2.stopPropagation();
        if (node.classList.contains('gogh-w-break')) { designBreak(); return; }
        var target = node;
        unpick();
        openSplash(target);
      });
      node.appendChild(pen);
    }
  };
  setTimeout(function () {
    // a break loaded from save is a splash whose raw is a gogh section —
    // re-mark it BEFORE controls attach, so its ✎ opens the canvas
    [].forEach.call(body.querySelectorAll('.gogh-splash'), function (n) {
      if (/gogh-sec-brk/.test(n.dataset.goghRaw || '')) n.classList.add('gogh-w-break');
    });
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
    // pack styles ride the same row: one-tap treatments (Melt, Rise...)
    (window.gogh._imageStyles || []).forEach(function (st2) {
      var pb = document.createElement('button');
      pb.type = 'button';
      pb.className = 'gogh-w-lay' + (fig.classList.contains(st2.cls) ? ' is-on' : '');
      pb.textContent = st2.label;
      pb.addEventListener('click', function (ev4) {
        ev4.stopPropagation();
        var on = fig.classList.toggle(st2.cls);
        pb.classList.toggle('is-on', on);
        if (window.gogh.enhance) window.gogh.enhance(fig.parentNode || fig);
        queueSave();
      });
      layRow.appendChild(pb);
    });
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
    // typing in the alt row, a caption, or any input must NEVER delete
    // the picture — Backspace only removes when the FIGURE itself holds
    // focus (the audit's booby trap: fixing a caption typo ate the image)
    var t = ev.target;
    var island = t && t !== body && t.isContentEditable && t.closest && t.closest('figure, .gogh-splash');
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || island)) {
      if (ev.key === 'Escape') unpick();
      return;
    }
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
    // richer inline set (audit: footnote SUP, citation, mark, strike,
    // etc. were being flattened away on every autosave). Attributes kept
    // per tag: a link's href/target/rel, a footnote marker's id/refs.
    tmp.querySelectorAll('*').forEach(function (n) {
      var keep = /^(A|STRONG|B|EM|I|CODE|BR|SUP|SUB|MARK|S|U|KBD|CITE|SMALL)$/.test(n.tagName);
      if (!keep) {
        n.replaceWith.apply(n, [].slice.call(n.childNodes));
        return;
      }
      [].slice.call(n.attributes).forEach(function (a) {
        var okA = n.tagName === 'A' && /^(href|target|rel)$/.test(a.name);
        var okId = a.name === 'id' || a.name === 'data-fn'; // footnote anchors/markers
        if (!okA && !okId) n.removeAttribute(a.name);
      });
    });
    return tmp.innerHTML.trim();
  };
  // Chrome's contenteditable merge is a messy roommate: deleting across a
  // paragraph boundary can wrap the merged text in spans carrying copied
  // inline styles — on screen the paragraph reads double-spaced ("if i
  // delete the first para, the lines get double spaced") while the save
  // strips it clean. Normalize the LIVE block to exactly what the
  // serializer will keep, so the screen never lies about the post.
  body.addEventListener('input', function (ev) {
    if (!/^delete/.test(ev.inputType || '')) return;
    var sel = getSelection();
    if (!sel.rangeCount) return;
    var blk = blockOf(sel.anchorNode);
    if (!blk || !/^(P|DIV|H2|H3|H4)$/.test(blk.tagName)) return;
    if (!blk.getAttribute('style') && !blk.querySelector('[style], span, font')) return;
    // the caret survives as a character offset — cleaning only strips
    // tags, never text, so the offset still lands on the same letter
    var r = sel.getRangeAt(0);
    var pre = document.createRange();
    pre.selectNodeContents(blk);
    pre.setEnd(r.startContainer, r.startOffset);
    var off = pre.toString().length;
    blk.removeAttribute('style');
    blk.innerHTML = inlineClean(blk) || '<br>';
    var walker = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT, null);
    var node, seen = 0;
    while ((node = walker.nextNode())) {
      if (seen + node.length >= off) {
        var r2 = document.createRange();
        r2.setStart(node, off - seen);
        r2.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r2);
        break;
      }
      seen += node.length;
    }
  });
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
        var flo = n.classList.contains('alignfull') ? 'full' : n.classList.contains('alignwide') ? 'wide'
          : n.classList.contains('alignleft') ? 'left' : n.classList.contains('alignright') ? 'right' : null;
        // pack treatments travel as block styles — one class, pure core
        var styleCls = [].filter.call(n.classList, function (c4) { return c4.indexOf('is-style-') === 0; });
        // a link-to-media/link-to-URL wrapper is real user intent — the
        // audit flagged it silently dropped on every save
        var linkEl = n.querySelector('a');
        var href = linkEl && linkEl.getAttribute('href');
        var iattrs = { sizeSlug: 'large' };
        if (mid) iattrs.id = mid;
        if (flo) iattrs.align = flo;
        if (href) iattrs.linkDestination = 'custom';
        if (styleCls.length) iattrs.className = styleCls.join(' ');
        var imgTag = '<img src="' + img.src + '" alt="' + (img.alt || '') + '"' + (mid ? ' class="wp-image-' + mid + '"' : '') + '/>';
        if (href) imgTag = '<a href="' + href.replace(/"/g, '&quot;') + '"' +
          (linkEl.getAttribute('target') === '_blank' ? ' target="_blank" rel="noreferrer noopener"' : '') + '>' + imgTag + '</a>';
        out.push('<!-- wp:image ' + JSON.stringify(iattrs) + ' -->\n' +
          '<figure class="wp-block-image' + (flo ? ' align' + flo : '') + (styleCls.length ? ' ' + styleCls.join(' ') : '') + ' size-large">' + imgTag +
          (capTxt ? '<figcaption class="wp-element-caption">' + capTxt + '</figcaption>' : '') +
          '</figure>\n<!-- /wp:image -->');
      }
    });
    return out.join('\n\n');
  };

  // ---------- no block traps the caret ----------
  // Enter on an empty line inside a quote steps OUT of it (the browser
  // would keep making paragraphs inside forever — "i can't add any other
  // blocks"); Enter at the end of a heading starts a paragraph.
  body.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' || ev.shiftKey) return;
    var sel = getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return;
    var el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    if (!el || !body.contains(el)) return;
    var bq = el.closest('blockquote');
    if (bq && bq.parentNode === body) {
      var para = el.closest('p');
      if (para && !para.textContent.trim()) {
        ev.preventDefault();
        var out = document.createElement('p');
        out.innerHTML = '<br>';
        bq.after(out);
        para.remove();
        if (!bq.textContent.trim() && !bq.querySelector('img')) bq.remove();
        caretInto(out);
        queueSave();
      }
      return;
    }
    var h = el.closest('h2, h3, h4');
    if (h && h.parentNode === body) {
      var probe = sel.getRangeAt(0).cloneRange();
      probe.selectNodeContents(h);
      probe.setStart(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
      if (!probe.toString().trim()) {
        ev.preventDefault();
        var np = document.createElement('p');
        np.innerHTML = '<br>';
        h.after(np);
        caretInto(np);
      }
    }
  });

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
    // the door leads to the POST, not the home page — the writing loop is
    // write → see it as readers do ("should it say view post?")
    '<a class="gogh-w-back" href="' + (cfg.permalink || cfg.homeUrl || '/') + '">View post</a>';
  document.body.appendChild(chip);
  // the rail reaches the write room: Post style lives in a Design tab and
  // the receipts behind SEO — one grammar, every room ("have you moved
  // the post layouts to a tab - i still see this?")
  // one pill, two doors — the write room's rail matches the editor's
  var wRail = document.createElement('div');
  wRail.className = 'gogh-w-rail';
  document.body.appendChild(wRail);
  var railDesign = document.createElement('button');
  railDesign.type = 'button';
  railDesign.className = 'gogh-w-tab';
  railDesign.title = 'Design — choose this post\u2019s reading look';
  railDesign.innerHTML = '<span>Design</span>'; // no dot: only the SEO tab's light means something
  wRail.appendChild(railDesign);
  var railSEO = document.createElement('button');
  railSEO.type = 'button';
  railSEO.className = 'gogh-w-tab gogh-w-tab-seo';
  railSEO.title = 'SEO & AI answers — how machines read this post';
  railSEO.innerHTML = '<span>SEO</span><span class="gogh-w-tab-dot gogh-w-tab-dot-gold"></span>'; // the light reads after the word
  wRail.appendChild(railSEO);
  railSEO.addEventListener('click', function () { openARPanel(); });
  // the dot is a receipt light, never a score: grey = not published yet,
  // amber = published but no description, green = the machine layer is
  // complete. The tooltip says why.
  function updateSEODot() {
    // status speaks in TICKS, identity speaks in dots: the green state is
    // a ✓ so it can never be mistaken for the Design tab's decorative dot
    // ("the design has an orange dot that's not a feedback mechanism")
    var dot = railSEO.querySelector('.gogh-w-tab-dot');
    var published = cfg.status === 'publish' || !!publishedLink;
    var hasDesc = !!String(cfg.excerpt || '').trim();
    if (published && hasDesc) {
      dot.classList.add('is-tick');
      dot.style.background = 'transparent';
      dot.textContent = '\u2713';
      railSEO.title = 'SEO & AI answers — complete: schema, description and structure all in place';
      return;
    }
    dot.classList.remove('is-tick');
    dot.textContent = '';
    dot.style.background = published ? '#f2a413' : '#b9bcc4';
    railSEO.title = 'SEO & AI answers — ' + (published
      ? 'add a description on the search preview to complete the machine layer'
      : 'the machine layer appears on first publish');
  }
  updateSEODot();
  // a quiet word in the chip's saved slot — shared by Post style, publish,
  // and the Answer-ready receipt (it lived inside the Post-style closure
  // once, and the publish receipt calling it from outside threw)
  var noteT = null;
  // the chip breathes instead of snapping ("kinda grows and shrinks - it's
  // a little inelegant"): the saved-slot measures its destination, animates
  // its width on a soft spring, and cross-fades the words mid-journey
  var noteSwap = function (el, text) {
    var probe = document.createElement('span');
    probe.className = el.className.replace('is-turning', '');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;width:auto;';
    probe.textContent = text;
    el.parentNode.appendChild(probe);
    var w = probe.getBoundingClientRect().width;
    probe.remove();
    el.style.width = el.getBoundingClientRect().width + 'px';
    el.classList.add('is-turning');
    setTimeout(function () {
      el.textContent = text;
      el.style.width = w + 'px';
      el.classList.remove('is-turning');
    }, 130);
  };
  var note = function (msg) {
    var el = chip.querySelector('.gogh-w-saved');
    if (!el) return;
    var prev = el.textContent;
    noteSwap(el, msg);
    clearTimeout(noteT);
    noteT = setTimeout(function () { noteSwap(el, prev); }, 2400);
  };

  // ---------- Answer-ready: what machines see (the write-room twin of the
  // editor's panel — same classes, same live-page fetch, Article-shaped) ----
  var publishedLink = null; // doPublish learns the clean permalink
  function openARPanel() {
    var old = document.querySelector('.gogh-arwrap');
    if (old) old.remove();
    var escHtml = function (s) { var d = document.createElement('div'); d.textContent = String(s || ''); return d.innerHTML; };
    var wrap = document.createElement('div');
    wrap.className = 'gogh-arwrap';
    wrap.innerHTML = '<div class="gogh-arback"></div>' +
      '<div class="gogh-arpanel" role="dialog" aria-label="What machines see">' +
      '<h3>What machines see</h3>' +
      '<p class="gogh-ar-sub">Search engines and AIs read your post as facts. These are yours, straight from the live page.</p>' +
      '<div class="gogh-ar-status"><span class="gogh-ar-statusdot"></span><span class="gogh-ar-statustext"></span></div>' +
      '<div class="gogh-ar-cap">How it looks in search</div>' +
      '<div class="gogh-arsnippet">' +
      '<div class="gogh-arsnip-url">' + escHtml((cfg.permalink || location.href).replace(/^https?:\/\//, '').replace(/\?.*$/, '')) + '</div>' +
      '<div class="gogh-arsnip-title"></div>' +
      '<div class="gogh-arsnip-desc" contenteditable="true" spellcheck="true"></div>' +
      '</div>' +
      '<p class="gogh-ar-why gogh-arsnip-hint">Gogh drafted the description from your opening — edit it right here. It saves as the post\u2019s description, which search results and AI answers lean on.</p>' +
      '<div class="gogh-ar-actions gogh-arsnip-actions" hidden><button type="button" class="gogh-arsnip-save">Save description</button></div>' +
      '<div class="gogh-ar-rows"><div class="gogh-ar-row">Reading the published post…</div></div>' +
      '<div class="gogh-ar-cap">And built into every gogh post</div>' +
      '<div class="gogh-ar-always">' +
      '<div class="gogh-ar-row"><span class="tick">✓</span><div><b>Real structure</b> — proper headings and paragraphs, so machines and screen readers read the post like a document</div></div>' +
      '<div class="gogh-ar-row"><span class="tick">✓</span><div><b>Plain WordPress blocks</b> — your words are stored as ordinary core blocks, and they keep their look even with gogh switched off</div></div>' +
      '<div class="gogh-ar-row"><span class="tick">✓</span><div><b>Phone-ready</b> — the post reads beautifully on small screens, and Google indexes mobile first</div></div>' +
      '</div>' +
      '<div class="gogh-ar-cap">The machine layer — exactly what crawlers read</div>' +
      '<p class="gogh-ar-why">This is your post in the standard format (schema.org) that Google, ChatGPT ' +
      'and other AIs read facts in. Sites usually need an SEO plugin and a form-filling session to get this. ' +
      'Gogh wrote it from your post — it updates itself every time you publish.</p>' +
      '<div class="gogh-armachine"><pre>…</pre></div>' +
      '<div class="gogh-ar-actions"><button type="button" class="gogh-ar-share">Copy summary to share</button>' +
      '<button type="button" class="gogh-ar-copy">Copy machine version</button>' +
      '<button type="button" class="gogh-ar-done">Done</button></div></div>';
    document.body.appendChild(wrap);
    // the light, EXPLAINED, beside the action that changes it — a tooltip
    // on an 8px dot is guidance nobody finds ("i'm not sure how folks
    // would know how to effect this")
    var renderStatus = function () {
      var published = cfg.status === 'publish' || !!publishedLink;
      var hasDesc = !!String(cfg.excerpt || '').trim();
      var s = !published
        ? ['#b9bcc4', 'Not published yet — publish once and the machine layer appears.']
        : (!hasDesc
          ? ['#f2a413', 'One step left — keep or edit the description below, and this turns green.']
          : ['#2e9e6b', 'Complete — schema, description and structure are all in place.']);
      wrap.querySelector('.gogh-ar-statusdot').style.background = s[0];
      wrap.querySelector('.gogh-ar-statustext').textContent = s[1];
    };
    renderStatus();
    // the snippet: the writer polishes how the post LOOKS in results —
    // never a labelled meta-description form. Saved as the native excerpt
    // so it survives gogh, feeds the schema, and every SEO tool respects it.
    (function () {
      var titleEl = document.querySelector('.gogh-w-title');
      wrap.querySelector('.gogh-arsnip-title').textContent =
        ((titleEl && titleEl.textContent.trim()) || document.title || 'Untitled').slice(0, 70);
      var draft = function () {
        var b = document.querySelector('.gogh-w-body');
        var txt = (b ? b.textContent : '').replace(/\s+/g, ' ').trim();
        if (txt.length <= 155) return txt;
        var cut = txt.slice(0, 155);
        return cut.slice(0, cut.lastIndexOf(' ')) + '\u2026';
      };
      var descEl = wrap.querySelector('.gogh-arsnip-desc');
      var saved = String(cfg.excerpt || '').trim();
      descEl.textContent = saved || draft();
      var actions = wrap.querySelector('.gogh-arsnip-actions');
      descEl.addEventListener('input', function () { actions.hidden = false; });
      if (!saved && descEl.textContent.trim()) actions.hidden = false; // the draft is offered, one click keeps it
      wrap.querySelector('.gogh-arsnip-save').addEventListener('click', function () {
        var text = descEl.textContent.replace(/\s+/g, ' ').trim().slice(0, 300);
        fetch(cfg.restUrl + 'wp/v2/posts/' + cfg.postId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
          credentials: 'same-origin',
          body: JSON.stringify({ excerpt: text }),
        }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          cfg.excerpt = text;
          actions.hidden = true;
          note('description saved \u2713');
          updateSEODot();
          renderStatus();
        }).catch(function () { note('description not saved'); });
      });
    })();
    var onKey = function (ev) { if (ev.key === 'Escape') close(); };
    var close = function () { wrap.remove(); document.removeEventListener('keydown', onKey); };
    // (the write room's rail stays put — it has no drawer choreography)
    document.addEventListener('keydown', onKey);
    wrap.querySelector('.gogh-arback').addEventListener('click', close);
    wrap.querySelector('.gogh-ar-done').addEventListener('click', close);
    var target = publishedLink || cfg.permalink || location.pathname;
    fetch(target, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        if (!wrap.parentNode) return;
        var rows = wrap.querySelector('.gogh-ar-rows');
        var m = html.match(/<script type="application\/ld\+json" class="gogh-schema">([\s\S]*?)<\/script>/);
        if (!m) {
          rows.innerHTML = '<div class="gogh-ar-row">Publish once and the machine layer appears — it is computed when the post saves.</div>';
          // no layer yet: no empty black box, no dead copy button
          wrap.querySelector('.gogh-armachine').hidden = true;
          var cpy = wrap.querySelector('.gogh-ar-copy');
          if (cpy) cpy.hidden = true;
          return;
        }
        var g = JSON.parse(m[1]);
        var pretty = JSON.stringify(g, null, 2);
        wrap.querySelector('.gogh-armachine pre').textContent = pretty;
        var out = [];
        (g['@graph'] || []).forEach(function (n) {
          var t = n['@type'];
          if (t === 'Organization') {
            out.push('<div class="gogh-ar-row"><span class="tick">✓</span><div><b>Your brand</b> — ' +
              escHtml(n.name) + (n.logo ? ', with your logo' : '') + '</div></div>');
          } else if (t === 'Article') {
            out.push('<div class="gogh-ar-row"><span class="tick">✓</span><div><b>This story</b> — “' + escHtml(n.headline) + '”' +
              (n.author && n.author.name ? ', by ' + escHtml(n.author.name) : '') +
              (n.image ? ', with its picture' : '') + ', dated so answers stay fresh</div></div>');
          } else if (t === 'FAQPage') {
            var qs = (n.mainEntity || []).map(function (q) { return '<li>' + escHtml(q.name) + '</li>'; });
            out.push('<div class="gogh-ar-row"><span class="tick">✓</span><div><b>' + qs.length +
              ' question' + (qs.length === 1 ? '' : 's') + ' answered</b>, word for word' +
              '<ul class="gogh-ar-qs">' + qs.join('') + '</ul></div></div>');
          }
        });
        rows.innerHTML = out.join('') || '<div class="gogh-ar-row">Nothing emitted yet.</div>';
        wrap.querySelector('.gogh-ar-copy').addEventListener('click', function (ev) {
          var b = ev.currentTarget;
          var p = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(pretty) : Promise.reject();
          p.then(function () { b.textContent = 'Copied ✓ — paste into validator.schema.org'; },
            function () { b.textContent = 'Copy failed — select the dark box instead'; });
        });
        wrap.querySelector('.gogh-ar-share').addEventListener('click', function (ev) {
          var b = ev.currentTarget;
          var lines = [];
          (g['@graph'] || []).forEach(function (n) {
            if (n['@type'] === 'Article') lines.push('Our post “' + (n.headline || '') + '” is answer-ready.');
          });
          lines.push('It publishes with a machine-readable layer that Google, ChatGPT, Perplexity and other AIs read — so when they talk about us, they work from our facts, not guesses.');
          (g['@graph'] || []).forEach(function (n) {
            if (n['@type'] === 'Organization') lines.push('✓ Our brand facts (name' + (n.logo ? ' and logo' : '') + ') travel with the post.');
            if (n['@type'] === 'Article') lines.push('✓ Headline, author, dates and image, stated as facts.');
          });
          lines.push('Also built in: real semantic HTML, plain WordPress blocks (no lock-in), and phone-ready reading.');
          lines.push('Standard schema.org format, written automatically every time we publish — no plugin, no forms, no extra work.');
          var p2 = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(lines.join('\n')) : Promise.reject();
          p2.then(function () { b.textContent = 'Copied ✓ — paste into Slack or an email'; },
            function () { b.textContent = 'Copy failed'; });
        });
      })
      .catch(function () {
        if (!wrap.parentNode) return;
        wrap.querySelector('.gogh-ar-rows').innerHTML = '<div class="gogh-ar-row">Could not read the published post — try again in a moment.</div>';
      });
  }
  // ---------- Post style: how this post READS ----------
  // The third of the family (Site style / Page style / Post style). Hover a
  // look to audition — the room IS the post, so flipping the body class is
  // the truth — click to keep (post meta; the words never change).
  (function () {
    var LOOKS = [
      { key: '', name: 'Default', hint: 'the theme’s own look' },
      { key: 'magazine', name: 'Magazine', hint: 'big centred title, drop cap' },
      { key: 'journal', name: 'Journal', hint: 'quiet, narrow, contained' },
      { key: 'essay', name: 'Essay', hint: 'calm and spacious, soft quotes' },
      { key: 'gazette', name: 'Gazette', hint: 'newsprint rules, tight columns' },
      { key: 'photostory', name: 'Photo story', hint: 'pictures lead, words breathe' },
      { key: 'feature', name: 'Feature', hint: 'huge left title, offset images' },
      { key: 'cover', name: 'Cover', hint: 'your photo as the front page' },
    ];
    var current = cfg.postStyle || '';
    var CLASSES = LOOKS.map(function (l) { return 'gogh-read-' + l.key; }).filter(function (c) { return c !== 'gogh-read-'; });
    var wear = function (key) {
      CLASSES.forEach(function (c) { document.body.classList.remove(c); });
      if (key) document.body.classList.add('gogh-read-' + key);
    };
    wear(current); // arrive dressed in the saved look
    var pop = document.createElement('div');
    pop.className = 'gogh-w-stylepop';
    pop.hidden = true;
    pop.innerHTML = LOOKS.map(function (l) {
      return '<button type="button" data-look="' + l.key + '"><b>' + l.name + '</b><i>' + l.hint + '</i></button>';
    }).join('');
    document.body.appendChild(pop);
    var mark = function () {
      [].forEach.call(pop.querySelectorAll('button'), function (b) {
        b.classList.toggle('is-current', b.getAttribute('data-look') === current);
      });
    };
    // auditioning zooms the whole post out so a LOOK reads at a glance —
    // title treatment, measure, rhythm, all in one eyeful ("how about we
    // zoom out so folks can see the full effect"). Scroll comes back to
    // where the writer was when the popover closes.
    var audScroll = 0;
    var popOpen = function () {
      mark();
      pop.style.left = '52px';
      pop.style.right = 'auto';
      pop.style.top = '50%';
      pop.style.bottom = 'auto';
      pop.style.transform = 'translateY(-50%)';
      pop.hidden = false;
      audScroll = window.scrollY;
      document.body.classList.add('gogh-w-audition');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    var popClose = function () {
      if (pop.hidden) return;
      pop.hidden = true;
      document.body.classList.remove('gogh-w-audition');
      window.scrollTo({ top: audScroll, behavior: 'smooth' });
    };
    railDesign.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (pop.hidden) popOpen(); else popClose();
    });
    document.addEventListener('click', function (ev) {
      if (!pop.hidden && !ev.target.closest('.gogh-w-stylepop, .gogh-w-tab')) popClose();
    });
    [].forEach.call(pop.querySelectorAll('button'), function (b) {
      var key = b.getAttribute('data-look');
      b.addEventListener('mouseenter', function () { wear(key); });      // audition
      b.addEventListener('click', function () {                          // keep
        current = key;
        wear(key);
        mark();
        fetch(cfg.restUrl + 'wp/v2/posts/' + cfg.postId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
          credentials: 'same-origin',
          body: JSON.stringify({ meta: { _gogh_post_style: key } }),
        }).then(function (r) {
          note(r.ok ? ((LOOKS.filter(function (l) { return l.key === key; })[0] || {}).name + ' ✓')
            : 'style not saved');
        }).catch(function () { note('style not saved'); });
        popClose();
      });
    });
    pop.addEventListener('mouseleave', function () { wear(current); }); // audition never outlives the hover
  })();
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
  // a published post updates — it doesn't "publish" again, and "Save
  // draft" would be a lie (it never unpublishes anything)
  if (statusWord === 'Published') {
    chip.querySelector('.gogh-w-draft').remove();
    chip.querySelector('.gogh-w-publish').textContent = 'Update';
  }
  // phones have no hover: tapping the quiet chip opens the row, tapping
  // anywhere else folds it away again
  chip.addEventListener('click', function (ev) {
    if (!ev.target.closest('button')) chip.classList.toggle('is-open');
  });
  document.addEventListener('pointerdown', function (ev) {
    if (!chip.contains(ev.target)) chip.classList.remove('is-open');
  }, true);
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

  var saveT = null, inflight = null, saveFailed = false;
  var saveTrouble = function (code) {
    // failure must be VISIBLE — the audit's worst finding was saves
    // dying silently (an expired overnight nonce made Publish a no-op)
    saveFailed = true;
    noteSwap(savedEl, code === 403 ? 'signed out — reconnecting…' : 'not saved — retrying');
    countEl.textContent = '⚠ Your latest words are NOT saved yet';
  };
  var saveHealed = function () {
    if (!saveFailed) return;
    saveFailed = false;
    quietLabel();
  };
  var refreshNonce = function () {
    // an expired nonce is recoverable: WordPress hands out a fresh one
    return fetch(cfg.restUrl.replace(/wp\/v2\/?$/, '') + '?rest_route=/', { credentials: 'same-origin' })
      .then(function () {
        return fetch('/wp-admin/admin-ajax.php?action=rest-nonce', { credentials: 'same-origin' });
      }).then(function (r) { return r.ok ? r.text() : null; })
      .then(function (n) { if (n && /^[a-f0-9]+$/.test(n.trim())) cfg.nonce = n.trim(); });
  };
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
        saveHealed();
        noteSwap(savedEl, 'saved');
        setTimeout(function () { noteSwap(savedEl, ''); }, 1600);
        if (!saveT) { clean = true; quietLabel(); } // nothing newer waiting
        return r.json();
      }
      saveTrouble(r.status);
      if (r.status === 403) {
        // heal the session, then retry this save once
        return refreshNonce().then(function () { return save(statusTo); });
      }
      setTimeout(function () { if (saveFailed) save(statusTo); }, 8000);
      return null;
    }).catch(function () {
      inflight = null;
      saveTrouble(0);
      setTimeout(function () { if (saveFailed) save(statusTo); }, 8000);
      return null;
    });
    return inflight;
  };
  var queueSave = function () {
    if (readOnly) return; // never overwrite a post we refused to fully parse
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
    var already = statusWord === 'Published';
    b.disabled = true;
    b.textContent = already ? 'Updating…' : 'Publishing…';
    clearTimeout(saveT);
    save('publish').then(function (post) {
      if (post && post.link) {
        b.textContent = already ? 'Updated ↗' : 'Published ↗';
        b.disabled = false;
        statusWord = 'Published';
        quietLabel();
        // Answer-ready: the story's facts (headline, dates, author, image)
        // just went out as Article schema — the writer's receipt
        publishedLink = post.link;
        updateSEODot();
        note('Answer-ready ✓ — your story facts travel with this post. Tap ✦ to see what machines see.');
        b.onclick = function () { location.href = post.link; };
      } else {
        b.textContent = already ? 'Update' : 'Publish';
        b.disabled = false;
      }
    });
  };
  chip.querySelector('.gogh-w-publish').addEventListener('click', function () {
    doPublish(chip.querySelector('.gogh-w-publish'));
  });
  // leaving flushes any words the 2.5s debounce hasn't saved yet
  var leaveGuard = function (ev) {
    if (clean && !saveT && !inflight && !saveFailed) return; // nothing pending — plain link
    ev.preventDefault();
    var href = ev.currentTarget.href;
    clearTimeout(saveT);
    saveT = null;
    save().then(function (post) {
      // the door only opens on a SAVED room — leaving after a failed
      // save was guaranteed silent loss
      if (post) { location.href = href; }
      else { countEl.textContent = '⚠ Not saved — staying here so nothing is lost'; }
    });
  };
  chip.querySelector('.gogh-w-back').addEventListener('click', leaveGuard);
  // the way home is the web's oldest promise: the site's own name, top
  // left, quiet as a masthead ("folks need some way to get back home
  // from the write screen") — same saved-room guard as View post
  var mast = document.createElement('a');
  mast.className = 'gogh-w-mast';
  mast.href = cfg.homeUrl || '/';
  mast.textContent = cfg.siteName || 'Home';
  mast.title = 'Back to your site';
  document.body.appendChild(mast);
  mast.addEventListener('click', leaveGuard);
  // ---------- the cover chooses its photo ----------
  // ("we need to be able to set a background image for the cover post
  // type") — when the post wears Cover, a quiet glass chip sits on the
  // cover itself; picking saves the FEATURED image (the cover's source)
  // and repaints the sky without a reload.
  var coverChip = document.createElement('button');
  coverChip.type = 'button';
  coverChip.className = 'gogh-w-coverchip';
  coverChip.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="M21 16l-5-5-9 8"/></svg><span>Cover photo</span>';
  coverChip.hidden = true;
  document.body.appendChild(coverChip);
  var placeCoverChip = function () {
    var on = document.body.classList.contains('gogh-read-cover');
    coverChip.hidden = !on;
    if (!on) return;
    var r = title.getBoundingClientRect();
    coverChip.style.left = Math.max(18, r.left + 18) + 'px';
    coverChip.style.top = Math.max(70, r.bottom - 52) + 'px';
  };
  new MutationObserver(placeCoverChip).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('scroll', placeCoverChip, { passive: true });
  window.addEventListener('resize', placeCoverChip);
  placeCoverChip();
  coverChip.addEventListener('click', function () {
    openImageLibrary(null, {
      title: 'Choose the cover photo',
      onPick: function (item) {
        fetch(cfg.restUrl + 'wp/v2/posts/' + cfg.postId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
          credentials: 'same-origin',
          body: JSON.stringify({ featured_media: item.id }),
        }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          document.body.style.setProperty('--gogh-cover-img', 'url("' + item.source_url + '")');
          note('cover photo set ✓');
        }).catch(function () { note('cover photo not saved'); });
      },
    });
  });
  var draftBtn = chip.querySelector('.gogh-w-draft'); // absent on published posts
  if (draftBtn) draftBtn.addEventListener('click', function () {
    draftBtn.textContent = 'Saving\u2026';
    clearTimeout(saveT);
    save().then(function () {
      draftBtn.textContent = 'Saved \u2713';
      setTimeout(function () { draftBtn.textContent = 'Save draft'; }, 1400);
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

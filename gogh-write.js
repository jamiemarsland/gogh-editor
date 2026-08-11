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

  var title = document.querySelector('.wp-block-post-title, h1.entry-title');
  var body = document.querySelector('.entry-content, .wp-block-post-content');
  if (!body) return;
  document.body.classList.add('gogh-writing');

  // ---------- the surface ----------
  if (title) {
    title.contentEditable = 'plaintext-only';
    title.classList.add('gogh-w-title');
    if (!title.textContent.trim()) title.textContent = '';
  }
  body.contentEditable = 'true';
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
    fig.innerHTML = '<img alt="" src="' + URL.createObjectURL(file) + '"/>';
    if (refNode && refNode.parentNode === body) body.insertBefore(fig, refNode.nextSibling);
    else body.appendChild(fig);
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

  // ---------- serialization: pure core blocks, nothing exotic ----------
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
      if (tag === 'P' || tag === 'DIV') {
        var html = inlineClean(n);
        if (html && html !== '<br>') out.push('<!-- wp:paragraph -->\n<p>' + html + '</p>\n<!-- /wp:paragraph -->');
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
      } else if (tag === 'HR') {
        out.push('<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"/>\n<!-- /wp:separator -->');
      } else if (tag === 'FIGURE' && n.querySelector('img') && !n.classList.contains('gogh-w-uploading')) {
        var img = n.querySelector('img');
        var mid = n.dataset.mid ? +n.dataset.mid : null;
        var cap = n.querySelector('figcaption');
        out.push('<!-- wp:image ' + (mid ? '{"id":' + mid + ',"sizeSlug":"large"} ' : '{"sizeSlug":"large"} ') + '-->\n' +
          '<figure class="wp-block-image size-large"><img src="' + img.src + '" alt="' + (img.alt || '') + '"' + (mid ? ' class="wp-image-' + mid + '"' : '') + '/>' +
          (cap ? '<figcaption class="wp-element-caption">' + inlineClean(cap) + '</figcaption>' : '') +
          '</figure>\n<!-- /wp:image -->');
      }
    });
    return out.join('\n\n');
  };

  // ---------- silent autosave + the one chip ----------
  var chip = document.createElement('div');
  chip.className = 'gogh-w-chip';
  chip.innerHTML = '<span class="gogh-w-count"></span><span class="gogh-w-saved"></span>' +
    '<button type="button" class="gogh-w-publish">Publish</button>';
  document.body.appendChild(chip);
  var countEl = chip.querySelector('.gogh-w-count');
  var savedEl = chip.querySelector('.gogh-w-saved');
  var words = function () {
    return (body.innerText.trim().match(/\S+/g) || []).length;
  };
  var chipHideT = null;
  var wakeChip = function () {
    countEl.textContent = words() + ' words';
    chip.classList.add('is-vis');
    clearTimeout(chipHideT);
    chipHideT = setTimeout(function () { chip.classList.remove('is-vis'); }, 2200);
  };
  // the chip answers the MOUSE — typing keeps the canvas bare
  document.addEventListener('mousemove', wakeChip);
  document.addEventListener('keydown', function () {
    clearTimeout(chipHideT);
    chip.classList.remove('is-vis');
  }, true);

  var saveT = null, saving = false, dirty = false;
  var save = function (statusTo) {
    if (saving) { dirty = true; return Promise.resolve(); }
    saving = true;
    return fetch(cfg.restUrl + 'wp/v2/posts/' + cfg.postId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
      credentials: 'same-origin',
      body: JSON.stringify(Object.assign({
        title: title ? title.textContent.trim() : '',
        content: serialize(),
      }, statusTo ? { status: statusTo } : {})),
    }).then(function (r) {
      saving = false;
      if (r.ok) {
        savedEl.textContent = 'saved';
        setTimeout(function () { savedEl.textContent = ''; }, 1600);
      }
      if (dirty) { dirty = false; return save(); }
      return r.ok ? r.json() : null;
    }).catch(function () { saving = false; });
  };
  var queueSave = function () {
    clearTimeout(saveT);
    saveT = setTimeout(function () { save(); }, 2500);
  };
  body.addEventListener('input', queueSave);
  if (title) title.addEventListener('input', queueSave);

  chip.querySelector('.gogh-w-publish').addEventListener('click', function () {
    var b = chip.querySelector('.gogh-w-publish');
    b.disabled = true;
    b.textContent = 'Publishing…';
    clearTimeout(saveT);
    save('publish').then(function (post) {
      if (post && post.link) {
        b.textContent = 'Published ↗';
        b.disabled = false;
        b.onclick = function () { location.href = post.link; };
      } else {
        b.textContent = 'Publish';
        b.disabled = false;
      }
    });
  });

  // leaving with unsaved words: one last quiet save
  window.addEventListener('beforeunload', function () {
    if (saveT) { clearTimeout(saveT); try { navigator.sendBeacon && save(); } catch (e) {} }
  });

  // exposed for verification, not for humans
  window.__goghWrite = { serialize: serialize, save: save };
})();

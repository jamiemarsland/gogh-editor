/* gogh front-end editor — the live page IS the canvas.
 * v0.5: side palette, delete, undo/redo, between-section inserter, drag ghost
 * (no cursor drift), and fixed text/badge height measurement (no more
 * stretch-measure feedback loop).
 */
(function () {
  'use strict';

  var cfg = window.GOGH;
  // poster type: three stops ABOVE the theme's largest preset. Container
  // units scale with the section (phones included); the px floor keeps the
  // smallest screens readable. Emitted into the section stylesheet, so
  // published pages stay deactivation-safe and Global Styles stay untouched.
  // (Defined here, top of file: the boot DOM-parse below reads it.)
  var DISPLAY_FS = {
    '__disp-s': 'max(6cqw, 30px)',
    '__disp-m': 'max(9cqw, 36px)',
    '__disp-l': 'max(13cqw, 42px)',
  };
  var DISPLAY_ORDER = ['__disp-s', '__disp-m', '__disp-l'];
  var DISPLAY_LABEL = { '__disp-s': 'Display S', '__disp-m': 'Display M', '__disp-l': 'Display L' };
  if (!cfg) return;

  var TOL = 8, MIN_H = 560, PAD = 72, SNAP = 6, BASE = 8, W = 1200;

  // ---------- collect sections (resilient to Gutenberg-side edits) ----------
  // Carriers are paired by ADJACENCY (the style+model immediately before each
  // wrap). Wraps without a carrier — e.g. sections duplicated in the block
  // editor — are ADOPTED: a model is inferred from their blocks and they
  // become normal gogh sections on the next save.
  var wrapTags = [].slice.call(document.querySelectorAll('.gogh-wrap'));
  var wantEdit = /[?&]gogh-edit=1/.test(location.search);
  // a page whose content is native blocks (a starter site's page, a classic
  // page) is NOT an empty page — the blank-canvas machinery must leave it be
  function goghHasNativeContent() {
    var host = document.querySelector('.entry-content');
    return !!host && [].some.call(host.children, function (n) {
      return n.nodeType === 1 && !n.classList.contains('gogh-wrap') &&
        !n.classList.contains('gogh-pending') && n.tagName !== 'STYLE';
    });
  }
  // wraps inside the header/footer are site chrome, not page content — a
  // freeform header must not stop an empty PAGE from getting its canvas
  var contentWraps = wrapTags.filter(function (w) { return !w.closest('.wp-block-template-part'); });
  // no early exit in view mode: this script only loads for users who can
  // edit this page, so the floating pill belongs on EVERY page — gogh
  // sections or not, content or not. (It "sometimes" vanished for years on
  // native-only and empty pages.)
  if (!contentWraps.length && wantEdit && !goghHasNativeContent()) {
    // ?gogh-edit on a GENUINELY empty page: bootstrap an empty placeholder
    // section at the end of the content so the editor has a canvas. It is
    // never saved unless the user actually puts things in it. Pages made of
    // native blocks get no placeholder — it read as an undeletable empty
    // section at the bottom of every starter page.
    var host = document.querySelector('.entry-content') || document.querySelector('main');
    if (!host && !wrapTags.length) return;
    if (host) {
      var bWrap = document.createElement('div');
      bWrap.className = 'wp-block-gogh-section alignfull gogh-wrap';
      var bSec = document.createElement('div');
      bSec.className = 'gogh-section';
      bWrap.appendChild(bSec);
      host.appendChild(bWrap);
      bWrap.__goghBootstrap = true;
      wrapTags.push(bWrap);
    }
  }
  // native-only pages (a starter site) boot the editor with ZERO gogh
  // sections: light editing, the palette and the picker all still apply
  function inferModelFromDom(sectionEl) {
    var els = [];
    var y = 72;
    [].slice.call(sectionEl.children).forEach(function (child) {
      var e = null;
      var text = (child.textContent || '').trim();
      if (/^H[1-6]$/.test(child.tagName)) {
        e = { type: 'heading', w: 640, h: 80, text: text };
      } else if (child.classList.contains('gogh-badge')) {
        e = { type: 'badge', w: 226, h: 52, text: text };
      } else if (child.tagName === 'P') {
        e = { type: 'para', w: 520, h: 60, text: text };
      } else if (child.classList.contains('wp-block-buttons')) {
        var a = child.querySelector('a');
        e = { type: 'button', w: 178, h: 52,
          text: (a || child).textContent.trim(),
          ghost: !!child.querySelector('.gogh-ghost'),
          href: (a && a.getAttribute('href') && a.getAttribute('href') !== '#') ? a.getAttribute('href') : null };
      } else if (child.tagName === 'FIGURE' || child.classList.contains('wp-block-group')) {
        var img = child.querySelector('img');
        e = { type: 'image', w: 460, h: 300 };
        if (img) {
          e.src = img.getAttribute('src');
          e.alt = img.alt || null;
          var mm = (img.className || '').match(/wp-image-(\d+)/);
          e.mediaId = mm ? +mm[1] : null;
        }
      }
      if (!e) return;
      e.x = 72;
      e.y = y;
      y += e.h + 40;
      els.push(e);
    });
    return els;
  }

  // ---------- boot reconciliation: Gutenberg edits win over the model ----------
  // The DOM at collect time IS the saved markup, so anything Gutenberg can
  // legitimately change (text, links, presets, colours) is adopted back into
  // the model before the first render. Position/size stay model-owned.
  function pickColorSlug(cls) {
    var m = (cls || '').match(/has-([a-z0-9-]+)-color/g) || [];
    for (var i = 0; i < m.length; i++) {
      var s = m[i].replace(/^has-/, '').replace(/-color$/, '');
      if (s !== 'text' && s !== 'link' && s.indexOf('background') === -1) return s;
    }
    return null;
  }
  function syncModelFromMarkup(sectionEl, els) {
    var found = 0;
    var keep = [];
    els.forEach(function (e, i) {
      var node = sectionEl.querySelector('.gogh-el-' + (i + 1));
      if (!node) return; // deleted in the block editor
      found++;
      var cls = node.className || '';
      if (e.type === 'heading' || e.type === 'para') {
        if ((node.textContent || '').trim()) e.text = cleanInline(node.innerHTML);
        var fm = cls.match(/has-([a-z0-9-]+)-font-size/);
        // display sizes carry no preset class by design — the DOM can't
        // testify about them, so the model's word stands
        e.fs = fm ? fm[1] : (DISPLAY_FS[e.fs] ? e.fs : null);
        var am = cls.match(/has-text-align-(center|right)/);
        e.align = am ? am[1] : null;
        e.color = pickColorSlug(cls);
      } else if (e.type === 'badge') {
        var tb = (node.textContent || '').trim();
        if (tb) e.text = tb;
      } else if (e.type === 'button') {
        var a = node.querySelector('a');
        if (a) {
          var ta = (a.textContent || '').trim();
          if (ta) e.text = ta;
          var href = a.getAttribute('href');
          e.href = (href && href !== '#') ? href : null;
          var bgm = (a.className || '').match(/has-([a-z0-9-]+)-background-color/);
          e.btnBg = bgm ? bgm[1] : null;
          e.btnText = pickColorSlug(a.className);
        }
        e.ghost = !!node.querySelector('.gogh-ghost, .is-style-outline');
      } else if (e.type === 'image') {
        var img = node.querySelector('img');
        if (img) {
          e.src = img.getAttribute('src') || e.src;
          e.alt = img.getAttribute('alt') || null;
          var mm = (img.className || '').match(/wp-image-(\d+)/);
          if (mm) e.mediaId = +mm[1];
        }
      }
      keep.push(e);
    });
    // if nothing matched, the markup structure is unexpected: leave the model
    return found ? keep : els;
  }

  var scopeSeq = 0;
  var usedScopes = {};
  wrapTags.forEach(function (wrap) {
    var sEl = wrap.querySelector('.gogh-section');
    var m = sEl && (sEl.className || '').match(/gogh-sec-(\d+)/);
    if (m) scopeSeq = Math.max(scopeSeq, +m[1] + 1);
  });
  scopeSeq = Math.max(scopeSeq, wrapTags.length);

  if (wantEdit) document.documentElement.classList.add('gogh-editing');
  // arriving from a page-style switch: fade in instead of popping
  if (/[?&]gogh-ps=1/.test(location.search)) {
    (function () {
      var ov0 = document.createElement('div');
      ov0.className = 'gogh-pagefade is-on';
      try { ov0.style.background = getComputedStyle(document.body).backgroundColor; } catch (err) {}
      document.body.appendChild(ov0);
      requestAnimationFrame(function () { ov0.classList.remove('is-on'); });
      setTimeout(function () { ov0.remove(); }, 700);
      try {
        var uu = new URL(location.href);
        uu.searchParams.delete('gogh-ps');
        // "history" is gogh's UNDO STACK in this scope — the browser's
        // lives on window
        window.history.replaceState(null, '', uu.toString());
      } catch (err2) {}
    })();
  }
  var S = []; // {scope, els, minH, bg, divider, wrapEl, sectionEl, styleEl, nodes}
  wrapTags.forEach(function (wrap) {
    var sectionEl = wrap.querySelector('.gogh-section');
    if (!sectionEl) return;
    var model = null, styleEl = null, v3wrap = false;
    // v0.18 gogh/section format: style + model live inside the wrapper
    var innerStyle = wrap.querySelector(':scope > style.gogh-style');
    var innerModel = wrap.querySelector(':scope > script.gogh-model');
    if (innerStyle && innerModel) {
      styleEl = innerStyle;
      try { model = JSON.parse(innerModel.textContent); } catch (e1) { model = null; }
    } else if (innerStyle && !innerModel && sectionEl.getAttribute('data-gogh-scope')) {
      // v3: the attributes are the stored truth — the model rides in the
      // block comment, which the rendered DOM does not carry. Boot the shell
      // now; hydrateV3Sections() fills the model from the raw content.
      styleEl = innerStyle;
      v3wrap = true;
      model = { elements: [] };
    } else {
      // legacy carrier-pair format: style + model precede the wrapper
      var prev = wrap.previousElementSibling;
      if (prev && prev.tagName === 'SCRIPT' && prev.classList.contains('gogh-model')) {
        try { model = JSON.parse(prev.textContent); } catch (e2) { model = null; }
        var maybeStyle = prev.previousElementSibling;
        if (maybeStyle && maybeStyle.tagName === 'STYLE' && maybeStyle.classList.contains('gogh-style')) {
          styleEl = maybeStyle;
        }
      }
    }
    var scope;
    var hadModel = !!model;
    if (model) {
      var m2 = (sectionEl.className || '').match(/gogh-sec-(\d+)/);
      scope = (m2 && !usedScopes['gogh-sec-' + m2[1]]) ? 'gogh-sec-' + m2[1] : 'gogh-sec-' + (scopeSeq++);
    } else {
      // adopted section: shed any copied scope class, take a fresh identity
      (sectionEl.className.match(/gogh-sec-\d+/g) || []).forEach(function (c) {
        sectionEl.classList.remove(c);
      });
      scope = 'gogh-sec-' + (scopeSeq++);
      model = { elements: inferModelFromDom(sectionEl) };
    }
    usedScopes[scope] = true;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.className = 'gogh-style';
      document.head.appendChild(styleEl);
    }
    sectionEl.classList.add(scope);
    var chromeHost = wrap.closest('.wp-block-template-part');
    var chromeInfo = chromeHost ? { area: chromeHost.tagName === 'FOOTER' ? 'footer' : 'header' } : null;
    var bootEls = model.elements || [];
    if (hadModel && !v3wrap) bootEls = syncModelFromMarkup(sectionEl, bootEls);
    S.push({ scope: scope, els: bootEls,
      v3: v3wrap,
      srcScope: v3wrap ? sectionEl.getAttribute('data-gogh-scope') : null,
      chrome: chromeInfo,
      bootstrap: !!wrap.__goghBootstrap,
      minH: model.minH || (bootEls.length ? null : 480),
      bg: model.bg || null, divider: model.divider || null,
      fx: model.fx || null,
      bgImage: model.bgImage || null, bgId: model.bgId || null, bgA: model.bgA != null ? model.bgA : null, theme: model.theme || null, fill: !!model.fill,
      wrapEl: wrap, sectionEl: sectionEl, styleEl: styleEl, nodes: [] });
  });

  // marker after the last CONTENT wrap (never inside a template part)
  var endMarker = document.createComment('gogh-end');
  var contentSecs = S.filter(function (s) { return !s.chrome; });
  if (contentSecs.length) {
    contentSecs[contentSecs.length - 1].wrapEl.after(endMarker);
  } else {
    // only chrome sections exist: anchor page insertions in the page, not
    // inside the header/footer template part
    var mainHost = document.querySelector('.entry-content') || document.querySelector('main') || document.body;
    mainHost.appendChild(endMarker);
  }
  var pageParent = endMarker.parentNode;

  // ---------- solver ----------
  function cluster(vals) {
    var sorted = vals.slice().sort(function (a, b) { return a - b; });
    var groups = [];
    sorted.forEach(function (v) {
      var g = groups[groups.length - 1];
      if (g && v - g[g.length - 1] <= TOL) g.push(v);
      else groups.push([v]);
    });
    return groups.map(function (g) {
      return g.reduce(function (a, b) { return a + b; }, 0) / g.length;
    });
  }
  function nearest(v, lines) {
    var best = 0;
    lines.forEach(function (l, i) { if (Math.abs(l - v) < Math.abs(lines[best] - v)) best = i; });
    return best;
  }
  function designH(els, minH) {
    var bottom = els.length
      ? Math.max.apply(null, els.map(function (e) { return e.y + e.h; }))
      : (minH || MIN_H) - PAD;
    return Math.max(minH || MIN_H, bottom + PAD);
  }
  function solve(els, minH, dw) {
    var H = designH(els, minH);
    var xs = cluster([0, dw || W].concat(els.reduce(function (a, e) { return a.concat([e.x, e.x + e.w]); }, [])));
    var ys = cluster([0, H].concat(els.reduce(function (a, e) { return a.concat([e.y, e.y + e.h]); }, [])));
    var pct = function (v) { return +(v / W * 100).toFixed(2); };
    return {
      cols: xs.slice(1).map(function (x, i) { return pct(x - xs[i]) + 'cqw'; }),
      rows: ys.slice(1).map(function (y, i) { return 'minmax(' + pct(y - ys[i]) + 'cqw, max-content)'; }),
      areas: els.map(function (e) {
        return {
          c1: nearest(e.x, xs) + 1, c2: nearest(e.x + e.w, xs) + 1,
          r1: nearest(e.y, ys) + 1, r2: nearest(e.y + e.h, ys) + 1,
        };
      }),
    };
  }
  // mobile reading order via recursive XY-cut: split into vertical bands
  // wherever a horizontal gap crosses the full layout, split bands into
  // columns wherever a vertical gap does, recurse. Keeps a card's image,
  // copy and button TOGETHER instead of interleaving three cards row by row.
  function splitByGaps(items, pos, len) {
    var sorted = items.slice().sort(function (p, q) { return p.e[pos] - q.e[pos]; });
    var groups = [], cur = [sorted[0]];
    var end = sorted[0].e[pos] + sorted[0].e[len];
    for (var k = 1; k < sorted.length; k++) {
      var it = sorted[k];
      if (it.e[pos] >= end - 2) {
        groups.push(cur);
        cur = [it];
        end = it.e[pos] + it.e[len];
      } else {
        cur.push(it);
        end = Math.max(end, it.e[pos] + it.e[len]);
      }
    }
    groups.push(cur);
    return groups;
  }
  function xyLinearize(items) {
    if (items.length <= 1) return items;
    // a top band that SPANS the columns beneath it (a section title) reads
    // first; a top band that aligns one-per-column (a row of card images)
    // does not peel — the column pass below keeps each card together
    var bands = splitByGaps(items, 'y', 'h');
    if (bands.length > 1) {
      var rest0 = [];
      for (var bk = 1; bk < bands.length; bk++) rest0 = rest0.concat(bands[bk]);
      var colsRest = splitByGaps(rest0, 'x', 'w');
      if (colsRest.length > 1) {
        var extents = colsRest.map(function (g) {
          var lo = Infinity, hi = -Infinity;
          g.forEach(function (it) {
            lo = Math.min(lo, it.e.x);
            hi = Math.max(hi, it.e.x + it.e.w);
          });
          return [lo, hi];
        });
        var spansMulti = bands[0].every(function (it) {
          var n = 0;
          extents.forEach(function (ex) {
            if (it.e.x < ex[1] && it.e.x + it.e.w > ex[0]) n++;
          });
          return n >= 2;
        });
        if (spansMulti) return xyLinearize(bands[0]).concat(xyLinearize(rest0));
      }
    }
    // columns first: a card's image, copy and button belong together
    var cols = splitByGaps(items, 'x', 'w');
    if (cols.length > 1) {
      var out = [];
      cols.forEach(function (g) { out = out.concat(xyLinearize(g)); });
      return out;
    }
    // no clean columns (e.g. a full-width heading spans them): peel off the
    // TOP band only, so columns underneath stay detectable in the remainder
    var bands = splitByGaps(items, 'y', 'h');
    if (bands.length > 1) {
      var rest = [];
      for (var k = 1; k < bands.length; k++) rest = rest.concat(bands[k]);
      return xyLinearize(bands[0]).concat(xyLinearize(rest));
    }
    // fully interlocked cluster: stable top-to-bottom, left-to-right
    return items.slice().sort(function (p, q) { return p.e.y - q.e.y || p.e.x - q.e.x; });
  }
  function readingRank(els) {
    var rank = [];
    var items = els.map(function (e, i) { return { i: i, e: e }; });
    xyLinearize(items).forEach(function (r, kk) { rank[r.i] = kk; });
    return rank;
  }
  // element indexes sorted by visual reading order. The els array stays in
  // STACKING order (that's what bring-forward/send-back reorder); the DOM —
  // editor canvas and published markup alike — is emitted in READING order,
  // so tab and screen-reader order match what sighted readers see
  // (WCAG 1.3.2). Position comes from grid-area and stacking from z-index,
  // so the visuals never depend on DOM order.
  function readingIndexOrder(els) {
    var rank = readingRank(els);
    return els.map(function (_, i) { return i; })
      .sort(function (a, b) { return rank[a] - rank[b]; });
  }

  // text elements hug their content (align-self: start) so measuring them
  // returns intrinsic height, not the stretched grid-cell height
  // gogh owns LAYOUT; the theme (theme.json / Global Styles) owns typography,
  // colours and button treatment — so Full Site Editing changes flow through
  var TYPE_RULES = {
    heading: 'align-self: start;',
    para: 'align-self: start;',
    button: '',
    image: 'border-radius: clamp(8px, 1.5cqw, 20px);',
    badge: 'display: flex; align-items: center; min-width: max-content; gap: 0.6em; height: 100%; background: #fff; color: #141519; border-radius: clamp(6px, 1.2cqw, 14px); padding: 0 1.1em; font-size: clamp(11px, 1.15cqw, 14px); font-weight: 600; box-shadow: 0 14px 34px -12px rgba(0,0,0,0.55); white-space: nowrap;',
    widget: 'display: flex; align-items: center;',
    box: '',
    exp: 'position: relative; overflow: hidden; border-radius: clamp(8px, 1.5cqw, 20px); background: #101114;',
  };
  var isText = function (e) { return e.type === 'heading' || e.type === 'para'; };
  var textyEl = function (e) {
    return e.type === 'heading' || e.type === 'para' || e.type === 'badge' || e.type === 'button' ||
      (e.kids || []).some(function (k) { return textyEl(k); });
  };
  var fixedHeight = function (e) { return e.type === 'button' || e.type === 'image' || e.type === 'badge' || e.type === 'widget' || e.type === 'box' || e.type === 'exp'; };

  function imageBackground(e) {
    if (e.src) {
      return 'background: url("' + String(e.src).replace(/"/g, '%22') + '") center / cover no-repeat;';
    }
    return e.cool
      ? 'background: linear-gradient(140deg, #2e5a4f 0%, #24405c 60%, #1a2437 100%);'
      : 'background: linear-gradient(140deg, #e8b04b 0%, #d9745a 55%, #7a3b52 100%);';
  }

  var DIVIDER_PATHS = {
    wave: 'M0,64 C300,124 900,4 1200,64 L1200,120 L0,120 Z',
    brush: 'M0,88 C28,72 54,98 88,84 C118,72 142,94 178,80 C216,64 244,98 286,88 C322,80 352,60 392,76 C428,90 462,70 502,82 C538,92 574,66 612,78 C652,90 688,72 724,84 C762,96 800,62 842,74 C878,84 912,102 952,86 C990,70 1022,92 1060,80 C1096,68 1130,94 1162,84 C1178,79 1192,74 1200,72 L1200,120 L0,120 Z',
    torn: 'M0,86 L46,76 L94,90 L148,70 L206,88 L262,68 L328,86 L388,74 L452,92 L516,74 L582,88 L638,68 L698,86 L758,74 L822,92 L878,70 L938,84 L998,72 L1058,90 L1122,76 L1200,86 L1200,120 L0,120 Z',
    curve: 'M0,120 C400,10 800,10 1200,120 Z',
    slant: 'M0,120 L1200,30 L1200,120 Z',
    peaks: 'M0,120 L300,50 L600,110 L900,40 L1200,120 Z',
  };
  function dividerBg(shape, color) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 120" preserveAspectRatio="none">' +
      '<path fill="' + color + '" d="' + DIVIDER_PATHS[shape] + '"/></svg>';
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
  }

  // one element's scoped rules — shared by sections (.gogh-el-N) and the
  // kids inside a card (.gogh-k-N)
  function emitElCSS(out, sec, clsSel, e, i, a) {
      var extra = TYPE_RULES[e.type];
      if (e.type === 'widget' && e.wcol) extra += ' color: ' + e.wcol + ';';
      if (e.type === 'image') {
        extra += e.src ? ' overflow: hidden;' : ' ' + imageBackground(e);
      }
      if (e.type === 'box') {
        var bv = e.boxBg || '';
        if (bv && /^[a-z0-9-]+$/.test(bv)) bv = 'var(--wp--preset--color--' + bv + ')';
        if (e.boxImg) {
          var bimg = 'url("' + String(e.boxImg).replace(/"/g, '%22') + '") center / cover no-repeat';
          if (bv) {
            var btint = 'color-mix(in srgb, ' + bv + ' 45%, transparent)';
            extra += ' background: linear-gradient(' + btint + ', ' + btint + '), ' + bimg + ';';
          } else if ((e.kids || []).some(textyEl)) {
            // GUARDRAIL: photo cards with words get the soft scrim too
            var bauto = 'color-mix(in srgb, var(--wp--preset--color--base, #fff) 40%, transparent)';
            extra += ' background: linear-gradient(' + bauto + ', ' + bauto + '), ' + bimg + ';';
          } else {
            extra += ' background: ' + bimg + ';';
          }
        } else if (bv) extra += ' background: ' + bv + ';';
        if (e.radius) extra += ' border-radius: ' + (Math.round(e.radius / 12 * 100) / 100) + 'cqw;';
        if (e.shape && SHAPE_CSS[e.shape]) extra += SHAPE_CSS[e.shape];
      }
      if (e.rot) extra += ' transform: rotate(' + e.rot + 'deg);';
      if ((e.align === 'center' || e.align === 'right') && (e.type === 'heading' || e.type === 'para')) extra += ' text-align: ' + e.align + ';';
      // display sizes live in the scoped stylesheet, not theme presets
      if (DISPLAY_FS[e.fs] && (e.type === 'heading' || e.type === 'para')) {
        extra += ' font-size: ' + DISPLAY_FS[e.fs] + '; line-height: 1.05;';
      }
      if (e.tf) {
        // captured look of pasted HTML: emitted after the theme's presets so
        // the paste wins until the user picks a theme size/colour (which
        // clears the matching field)
        var tfd = [];
        if (e.tf.ff) tfd.push('font-family: ' + e.tf.ff);
        if (e.tf.fs2) {
          // container units scale the paste's text down on phones with the
          // section; the floor keeps small text readable (big text scales,
          // tiny text holds its size)
          var dpx = Math.round(e.tf.fs2 * 12);
          tfd.push('font-size: max(' + e.tf.fs2 + 'cqw, ' + Math.min(dpx, 15) + 'px) !important');
        } else if (e.tf.fs) {
          tfd.push('font-size: ' + e.tf.fs + 'px !important');
        }
        if (e.tf.fw) tfd.push('font-weight: ' + e.tf.fw);
        if (e.tf.fst) tfd.push('font-style: ' + e.tf.fst);
        if (e.tf.lh) tfd.push('line-height: ' + e.tf.lh);
        if (e.tf.ls2 != null) tfd.push('letter-spacing: ' + e.tf.ls2 + 'em');
        else if (e.tf.ls) tfd.push('letter-spacing: ' + e.tf.ls + 'px');
        if (e.tf.tt) tfd.push('text-transform: ' + e.tf.tt);
        if (e.tf.col) tfd.push('color: ' + e.tf.col + ' !important');
        if (e.tf.bg) tfd.push('background: ' + e.tf.bg + ' !important');
        if (e.tf.rad != null) tfd.push('border-radius: ' + e.tf.rad + 'px');
        if (tfd.length) {
          out.push(sec + clsSel +
            (e.type === 'button' ? ' .wp-block-button__link' : '') +
            ' { ' + tfd.join('; ') + '; }');
        }
      }
      if (e.type === 'button' && e.btnHover) {
        out.push(sec + clsSel + ' .wp-block-button__link:hover { background-color: var(--wp--preset--color--' + e.btnHover + ') !important; }');
      }
      out.push(sec + clsSel + ' { grid-area: ' + a.r1 + ' / ' + a.c1 + ' / ' + a.r2 + ' / ' + a.c2 +
        '; z-index: ' + (i + 1) + '; ' + extra + ' }');
      if (e.type === 'image' && e.src) {
        out.push(sec + clsSel + ' img { width: 100%; height: 100%; object-fit: cover; display: block; border-radius: inherit; }');
      }
  }
  function buildCSS(els, scope, minH, opts) {
    opts = opts || {};
    var g = solve(els, minH);
    var sec = '.gogh-section.' + scope;
    var out = [
      '/* generated by gogh */',
      '.gogh-wrap { container-type: inline-size; margin-block: 0 !important; min-width: 100%; }',
      sec + ' {',
      '  display: grid;',
      '  position: relative;',
      (opts.fill ? '  min-height: 100svh;' : ''),
      (function () {
        // the tint strength is a dial (Canva-style): default 62 over an
        // image, solid for plain colour — opts.bgA is 0–100
        var bgA = opts.bgA != null ? Math.max(0, Math.min(100, opts.bgA)) : null;
        if (opts.bgImage) {
          var img = 'url("' + String(opts.bgImage).replace(/"/g, '%22') + '") center / cover no-repeat';
          if (opts.bg) {
            // palette-aware tint over the image keeps text readable in any
            // style variation (the tint follows the theme's own colours)
            var tint = 'color-mix(in srgb, ' + opts.bg + ' ' + (bgA != null ? bgA : 62) + '%, transparent)';
            return '  background: linear-gradient(' + tint + ', ' + tint + '), ' + img + ';';
          }
          if (els.some(textyEl)) {
            // GUARDRAIL: an image straight behind text gets a soft
            // theme-base scrim so words stay readable; picking a colour
            // replaces it with the user's own tint
            var auto = 'color-mix(in srgb, var(--wp--preset--color--base, #fff) 45%, transparent)';
            return '  background: linear-gradient(' + auto + ', ' + auto + '), ' + img + ';';
          }
          return '  background: ' + img + ';';
        }
        if (opts.bg && bgA != null && bgA < 100) {
          return '  background: color-mix(in srgb, ' + opts.bg + ' ' + bgA + '%, transparent);';
        }
        return opts.bg ? '  background: ' + opts.bg + ';' : '';
      })(),
      '  grid-template-columns: ' + g.cols.join(' ') + ';',
      '  grid-template-rows:\n    ' + g.rows.join('\n    ') + ';',
      '}',
      sec + ' > * { margin: 0 !important; min-width: 0; box-sizing: border-box; }',
      // themes often give Group blocks default padding — fatal for empty
      // image placeholders, which must be exactly their grid cell
      sec + ' > .wp-block-group { padding: 0 !important; }',
    ];
    if (opts.divider && opts.divider.shape === 'melt' && opts.divColor) {
      // no edge at all: the section dissolves into the next one's colour
      out.push(sec + '::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 16cqw; z-index: 0; pointer-events: none; background: linear-gradient(to bottom, transparent, ' + opts.divColor + '); }');
    } else if (opts.divider && opts.divider.shape && opts.divColor && DIVIDER_PATHS[opts.divider.shape]) {
      // mask (not background-image) so the colour can be a CSS variable —
      // theme palette changes recolour dividers live
      var mask = dividerBg(opts.divider.shape, '#000');
      out.push(sec + '::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 8cqw; z-index: 0; pointer-events: none; background: ' + opts.divColor + '; ' +
        '-webkit-mask-image: ' + mask + '; mask-image: ' + mask + '; ' +
        '-webkit-mask-size: 100% 100%; mask-size: 100% 100%; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; }');
    }
    els.forEach(function (e, i) {
      emitElCSS(out, sec, ' .gogh-el-' + (i + 1), e, i, g.areas[i]);
    });
    // a box with kids is a CARD — a mini-section: its own grid over the same
    // solver. Columns in fr so the card fills its slot at ANY width (mobile
    // stacking included); rows in section-cqw like everything else, so the
    // card's proportions ride the page scale.
    els.forEach(function (e, i) {
      if (e.type !== 'box' || !e.kids || !e.kids.length) return;
      var cardSel = sec + ' .gogh-el-' + (i + 1);
      var kg = solve(e.kids, e.h, e.w);
      var kidH = designH(e.kids, e.h);
      var cardRows = kg.rows.map(function (r) {
        // solve emits section-cqw (1cqw = W/100 design units); the card's
        // rows must be % of the CARD's height so they scale with it
        var x = parseFloat(String(r).replace('minmax(', ''));
        var pctH = Math.max(0, +((x * W / 100) / kidH * 100).toFixed(2));
        return 'minmax(' + pctH + '%, max-content)';
      });
      out.push(cardSel + ' { display: grid; position: relative; overflow: hidden;' +
        ' grid-template-columns: ' + kg.cols.map(function (c) { return parseFloat(c) + 'fr'; }).join(' ') + ';' +
        ' grid-template-rows: ' + cardRows.join(' ') + '; }');
      out.push(cardSel + ' > * { margin: 0 !important; min-width: 0; box-sizing: border-box; }');
      if (e.href) {
        out.push(cardSel + ' > .gogh-card-link { position: absolute; inset: 0; z-index: 0; grid-area: 1 / 1 / -1 / -1; }');
      }
      e.kids.forEach(function (k, j) {
        emitElCSS(out, cardSel, ' > .gogh-k-' + (j + 1), k, j, kg.areas[j]);
      });
    });
    out.push(
      sec + ' .gogh-badge::before { content: "★"; width: 1.9em; height: 1.9em; flex: none; border-radius: 50%; background: #e8b04b; display: grid; place-items: center; color: #141519; }',
      sec + ' .wp-block-button, ' + sec + ' .wp-block-button__link { width: 100%; height: 100%; }',
      sec + ' .wp-block-button__link { display: flex; align-items: center; justify-content: center; box-sizing: border-box; white-space: nowrap; }',
      sec + ' .gogh-ghost .wp-block-button__link { background: transparent; color: inherit; box-shadow: inset 0 0 0 1.5px currentColor; }',
      '',
      '@container (max-width: 700px) {',
      '  ' + sec + ' { grid-template-columns: 7cqw 1fr 7cqw; grid-template-rows: none; grid-auto-rows: auto; row-gap: 6cqw; padding: 9cqw 0; }'
    );
    els.forEach(function (e, i) {
      // no `order:` here — the DOM itself is written in reading order, so
      // stacked mobile flow, tab order and screen-reader order all agree
      out.push('  ' + sec + ' .gogh-el-' + (i + 1) + ' { grid-area: auto; grid-column: 2;' +
        (e.type === 'image' ? ' aspect-ratio: ' + e.w + ' / ' + e.h + ';' : '') +
        // stacked mobile: decorative SHAPES step aside; plain boxes are
        // structural panels (photo-card scrims, feature mats) and keep
        // their proportions instead of collapsing to zero height. CARDS are
        // the exception — narrow width makes their text TALLER, so locking
        // the design aspect squeezes kids into overlap; they size to
        // content, with a gap standing in for the collapsed design spacers
        (e.type === 'box' ? (e.shape ? ' display: none;' :
          (e.kids && e.kids.length ? ' aspect-ratio: auto; height: auto; display: flex; flex-direction: column; gap: 3cqw; padding: 6cqw 5cqw !important; align-items: flex-start;' :
            ' aspect-ratio: ' + e.w + ' / ' + e.h + ';')) : '') +
        (e.type === 'exp' ? ' aspect-ratio: ' + e.w + ' / ' + e.h + ';' : '') +
        (e.type === 'badge' ? ' width: max-content; height: 44px;' : '') + ' }');
    });
    out.push(
      '  ' + sec + ' .wp-block-button, ' + sec + ' .wp-block-button__link { width: max-content; height: 44px; padding: 0 24px; }',
      '}'
    );
    var fx = opts.fx || {};
    var wrapSel = '.gogh-wrap:has(> ' + sec + ')';
    if (fx.pull) {
      // the section rides up over the previous one (design units -> vw)
      out.push(wrapSel + ' { margin-top: calc(-1 * ' + (Math.round(fx.pull / 12 * 100) / 100) + 'vw) !important; position: relative; z-index: 3; }');
      out.push('@media (max-width: 700px) { ' + wrapSel + ' { margin-top: 0 !important; } }');
    }
    if (fx.curtain) {
      // this section slides over the previous (which sectionOpts pins sticky)
      out.push(wrapSel + ' { position: relative; z-index: 2; }');
    }
    if (opts.stickUnder) {
      out.push(wrapSel + ' { position: sticky; top: 0; z-index: 0; }');
      out.push('@media (max-width: 700px) { ' + wrapSel + ' { position: static; } }');
    }
    if (fx.reveal) {
      // scroll-driven rise: published page only (never while editing);
      // `translate` not `transform` so element rotation survives the fill
      out.push('@keyframes gogh-rise { from { opacity: 0; translate: 0 46px; } to { opacity: 1; translate: 0 0; } }');
      out.push('@supports (animation-timeline: view()) { html:not(.gogh-editing) ' + sec + ' > * { animation: gogh-rise linear both; animation-timeline: view(); animation-range: entry 8% entry 48%; } }');
      out.push('@media (prefers-reduced-motion: reduce) { ' + sec + ' > * { animation: none; } }');
    }
    return out.join('\n');
  }

  // ---------- block markup ----------
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escAttr(s) {
    return esc(s).replace(/"/g, '&quot;');
  }
  function projEl(e) {
    return { type: e.type, x: e.x, y: e.y, w: e.w, h: e.h,
      text: e.text || null, ghost: !!e.ghost, cool: !!e.cool,
      src: e.src || null, href: e.href || null, rot: e.rot || 0,
      alt: e.alt || null, mediaId: e.mediaId || null, fs: e.fs || null,
      align: e.align || null, color: e.color || null, tf: e.tf || null,
      btnBg: e.btnBg || null, btnText: e.btnText || null, btnHover: e.btnHover || null,
      wsrc: e.wsrc || null, whtml: e.whtml || null, wcol: e.wcol || null,
      boxBg: e.boxBg || null, radius: e.radius || 0, shape: e.shape || null,
      boxImg: e.boxImg || null, boxImgId: e.boxImgId || null,
      ph: e.ph || null,
      expId: e.expId || null, expUrl: e.expUrl || null,
      kids: e.kids && e.kids.length ? e.kids.map(projEl) : null };
  }
  function buildElBlocks(els, clsBase) {
    // blocks are emitted in READING order; each keeps its stacking-indexed
    // class, so grid placement and z-order are untouched by the resequence
    return readingIndexOrder(els).map(function (i) {
      var e = els[i];
      var cls = (clsBase || 'gogh-el-') + (i + 1);
      switch (e.type) {
        case 'heading': {
          var hAttrs = { level: 2, className: cls };
          if (e.align === 'center' || e.align === 'right') hAttrs.textAlign = e.align;
          if (e.fs && !DISPLAY_FS[e.fs]) hAttrs.fontSize = e.fs;
          if (e.color) hAttrs.textColor = e.color;
          return '<!-- wp:heading ' + JSON.stringify(hAttrs) + ' -->\n' +
            '<h2 class="wp-block-heading ' + (e.align === 'center' || e.align === 'right' ? 'has-text-align-' + e.align + ' ' : '') + cls + (e.fs && !DISPLAY_FS[e.fs] ? ' has-' + e.fs + '-font-size' : '') + (e.color ? ' has-text-color has-' + e.color + '-color' : '') + '">' +
            cleanInline(e.text) + '</h2>\n<!-- /wp:heading -->';
        }
        case 'para': {
          var pAttrs = { className: cls };
          if (e.align === 'center' || e.align === 'right') pAttrs.align = e.align;
          if (e.fs && !DISPLAY_FS[e.fs]) pAttrs.fontSize = e.fs;
          if (e.color) pAttrs.textColor = e.color;
          return '<!-- wp:paragraph ' + JSON.stringify(pAttrs) + ' -->\n' +
            '<p class="' + (e.align === 'center' || e.align === 'right' ? 'has-text-align-' + e.align + ' ' : '') + cls + (e.fs && !DISPLAY_FS[e.fs] ? ' has-' + e.fs + '-font-size' : '') + (e.color ? ' has-text-color has-' + e.color + '-color' : '') + '">' +
            cleanInline(e.text) + '</p>\n<!-- /wp:paragraph -->';
        }
        case 'button': {
          var href = e.href ? escAttr(e.href) : '#';
          var attrs = {};
          if (e.ghost) attrs.className = 'gogh-ghost';
          if (e.href) attrs.url = e.href;
          if (e.btnBg) attrs.backgroundColor = e.btnBg;
          if (e.btnText) attrs.textColor = e.btnText;
          var linkCls = 'wp-block-button__link' +
            (e.btnText ? ' has-' + e.btnText + '-color has-text-color' : '') +
            (e.btnBg ? ' has-' + e.btnBg + '-background-color has-background' : '') +
            ' wp-element-button';
          var attrJson = JSON.stringify(attrs);
          return '<!-- wp:buttons {"className":"' + cls + '"} -->\n' +
            '<div class="wp-block-buttons ' + cls + '"><!-- wp:button ' + (attrJson !== '{}' ? attrJson + ' ' : '') + '-->\n' +
            '<div class="wp-block-button' + (e.ghost ? ' gogh-ghost' : '') + '">' +
            '<a class="' + linkCls + '" href="' + href + '">' + esc(e.text) + '</a></div>\n' +
            '<!-- /wp:button --></div>\n<!-- /wp:buttons -->';
        }
        case 'image':
          if (e.src) {
            var iAttrs = { className: cls + ' gogh-img', sizeSlug: 'full' };
            if (e.mediaId) iAttrs.id = e.mediaId;
            return '<!-- wp:image ' + JSON.stringify(iAttrs) + ' -->\n' +
              '<figure class="wp-block-image size-full ' + cls + ' gogh-img">' +
              '<img src="' + escAttr(e.src) + '" alt="' + escAttr(e.alt || '') + '"' +
              (e.mediaId ? ' class="wp-image-' + e.mediaId + '"' : '') +
              '/></figure>\n<!-- /wp:image -->';
          }
          return '<!-- wp:group {"className":"' + cls + '","layout":{"type":"default"}} -->\n' +
            '<div class="wp-block-group ' + cls + '"></div>\n<!-- /wp:group -->';
        case 'badge':
          return '<!-- wp:paragraph {"className":"' + cls + ' gogh-badge"} -->\n' +
            '<p class="' + cls + ' gogh-badge">' + esc(e.text) + '</p>\n<!-- /wp:paragraph -->';
        case 'box': {
          // a coloured backdrop rectangle: an empty group. Preset colours go
          // in block attrs; raw colours ride in the section stylesheet, which
          // ships inside the page either way.
          var boxAttrs = { className: cls + ' gogh-box' + (e.kids && e.kids.length ? ' gogh-cardbox' : ''), layout: { type: 'default' } };
          var boxCls = 'wp-block-group ' + cls + ' gogh-box' + (e.kids && e.kids.length ? ' gogh-cardbox' : '');
          if (e.boxBg && /^[a-z0-9-]+$/.test(e.boxBg)) {
            boxAttrs.backgroundColor = e.boxBg;
            boxCls += ' has-' + e.boxBg + '-background-color has-background';
          }
          // a card publishes its kids INSIDE itself — plugin off, they
          // degrade to normal stacked blocks in a group
          var boxLink = e.href
            ? '<a class="gogh-card-link" href="' + escAttr(e.href) + '" aria-label="' + escAttr((e.kids && e.kids.length && e.kids[0].text) || 'Card link') + '"></a>'
            : '';
          var boxInner = (boxLink || (e.kids && e.kids.length)) ? '\n' + boxLink + (e.kids && e.kids.length ? buildElBlocks(e.kids, 'gogh-k-') : '') + '\n' : '';
          return '<!-- wp:group ' + JSON.stringify(boxAttrs) + ' -->\n' +
            '<div class="' + boxCls + '">' + boxInner + '</div>\n<!-- /wp:group -->';
        }
        case 'widget':
          // atomic block (navigation, site title…): source markup verbatim,
          // wrapped so the solver can place it
          return '<!-- wp:group {"className":"' + cls + ' gogh-widget","layout":{"type":"default"}} -->\n' +
            '<div class="wp-block-group ' + cls + ' gogh-widget">\n' + (e.wsrc || '') + '\n</div>\n<!-- /wp:group -->';
        case 'exp':
          // stored markup carries ONLY a plain link (kses-safe, works with the
          // plugin off); gogh_render_section swaps it for the sandboxed iframe
          return '<!-- wp:group ' + JSON.stringify({ className: cls + ' gogh-exp' }) + ' -->\n' +
            '<div class="wp-block-group ' + cls + ' gogh-exp">' +
            (e.expUrl ? '<a class="gogh-exp-link" href="' + escAttr(e.expUrl) + '">Open interactive experience</a>' : '') +
            '</div>\n<!-- /wp:group -->';
      }
    }).join('\n\n');
  }
  function sectionModelJSON(sec, version) {
    return {
      version: version, designW: W, minH: sec.minH || null,
      bg: sec.bg || null, divider: sec.divider || null,
      fx: sec.fx || null,
      bgImage: sec.bgImage || null, bgId: sec.bgId || null, bgA: sec.bgA != null ? sec.bgA : null, theme: sec.theme || null, fill: sec.fill || null,
      elements: sec.els.map(projEl),
    };
  }
  function buildSectionBlocks(sec) {
    var els = sec.els;
    var inner = buildElBlocks(els);
    var json = JSON.stringify(sectionModelJSON(sec, 2)).replace(/</g, '\\u003c');

    return '<!-- wp:gogh/section -->\n' +
      '<div class="wp-block-gogh-section alignfull gogh-wrap">' +
      '<style class="gogh-style">' + buildCSS(els, sec.scope, sec.minH, sectionOpts(sec)) + '</style>' +
      '<script type="application/json" class="gogh-model">' + json + '</scr' + 'ipt>' +
      '<div class="gogh-section ' + sec.scope + '" data-gogh-scope="' + sec.scope + '">\n' +
      inner + '\n</div></div>\n' +
      '<!-- /wp:gogh/section -->';
  }

  // ---------- SPIKE: attributes as the stored source of truth (v3) ----------
  // The block comment carries { model, cssT }: the editing model plus the
  // presentation compiled to a scope-templated stylesheet. PHP's job at
  // render is scoping + emission ONLY — no visual logic lives server-side.
  // Saved inner markup stays semantic core blocks: the plugin-off fallback.
  function serializeBlockAttrs(obj) {
    // mirror WP's serialize_block_attributes(): the JSON rides inside an
    // HTML comment, so comment/HTML-sensitive sequences must be escaped
    return JSON.stringify(obj)
      .replace(/--/g, '\\u002d\\u002d')
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\\"/g, '\\u0022');
  }
  function buildSectionAttrsV3(sec) {
    return {
      v: 3,
      scope: sec.scope,
      model: sectionModelJSON(sec, 3),
      // GOGHSCOPE placeholder: PHP substitutes the sanitized scope class.
      // (Production refinement: split into per-rule declaration maps.)
      cssT: buildCSS(sec.els, 'GOGHSCOPE', sec.minH, sectionOpts(sec)),
    };
  }
  function buildSectionBlocksV3(sec) {
    var attrs = buildSectionAttrsV3(sec);
    // the baked stylesheet is a PROJECTION of the attrs (matches the block's
    // save() output byte-for-byte, and the server rebake regenerates it when
    // KSES strips it) — deactivation keeps the look, attrs stay the truth
    var css = attrs.cssT.split('GOGHSCOPE').join(sec.scope);
    return '<!-- wp:gogh/section ' + serializeBlockAttrs(attrs) + ' -->\n' +
      '<div class="wp-block-gogh-section alignfull gogh-wrap">' +
      '<style class="gogh-style">' + css + '</style>' +
      '<div class="gogh-section ' + sec.scope + '" data-gogh-scope="' + sec.scope + '">\n' +
      buildElBlocks(sec.els) + '\n</div></div>\n' +
      '<!-- /wp:gogh/section -->';
  }
  // the blank-canvas placeholder is discardable only while it's TRULY blank:
  // a background (image or colour) is content — the section publishes, the
  // invite leaves, and nothing replaces it silently
  function isBlankBoot(s) {
    return s.bootstrap && !s.els.length && !s.bg && !s.bgImage;
  }
  function realSections() {
    return S.filter(function (s) { return !isBlankBoot(s) && !s.chrome; });
  }
  function buildAllBlocks() {
    return realSections().map(buildSectionBlocksV3).join('\n\n');
  }
  // gogh sections and freshly added native patterns, in page order
  function pageStream() {
    var parts = [];
    [].slice.call(pageParent.children).forEach(function (n) {
      if (!n.classList) return;
      if (n.classList.contains('gogh-wrap')) {
        var sec = realSections().filter(function (s) { return s.wrapEl === n; })[0];
        if (sec) parts.push(buildSectionBlocksV3(sec));
      } else if (n.classList.contains('gogh-pending')) {
        var pe = pendingBlocks.filter(function (q) { return q.el === n; })[0];
        if (pe) parts.push(pe.raw);
      }
    });
    return parts.join('\n\n');
  }

  // ---------- element factory & rendering ----------
  // sanitize inline rich text to a safe subset: links, bold, italic, br.
  // Uses <template> so nothing in untrusted markup loads or executes.
  function cleanInline(html) {
    // self-contained: the boot-time collector calls this before mid-file
    // var assignments have run, so the allow-list must live inside
    var INLINE_OK = { A: 1, STRONG: 1, EM: 1, B: 1, I: 1, BR: 1, IMG: 1 };
    var tpl = document.createElement('template');
    tpl.innerHTML = html == null ? '' : String(html);
    (function walk(node) {
      [].slice.call(node.childNodes).forEach(function (c) {
        if (c.nodeType === 3) return;
        if (c.nodeType !== 1) { node.removeChild(c); return; }
        var tag = c.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE' || tag === 'IFRAME') {
          node.removeChild(c);
          return;
        }
        if (INLINE_OK[tag]) {
          var IMG_OK = { src: 1, alt: 1, style: 1, class: 1, width: 1, height: 1 };
          [].slice.call(c.attributes).forEach(function (at) {
            if (tag === 'A' && at.name === 'href') return;
            if (tag === 'IMG' && IMG_OK[at.name]) return;
            c.removeAttribute(at.name);
          });
          if (tag === 'IMG') {
            var isrc = c.getAttribute('src') || '';
            if (!/^(https?:|\/)/i.test(isrc.trim())) { node.removeChild(c); return; }
          }
          if (tag === 'A') {
            var href = c.getAttribute('href') || '';
            if (!/^(https?:|mailto:|tel:|\/|#)/i.test(href.trim())) c.removeAttribute('href');
          }
          walk(c);
          return;
        }
        // unknown element: unwrap, keep its content
        while (c.firstChild) node.insertBefore(c.firstChild, c);
        node.removeChild(c);
      });
    })(tpl.content);
    var out = document.createElement('div');
    out.appendChild(tpl.content.cloneNode(true));
    return out.innerHTML;
  }

  function makeNode(e, i) {
    var cls = 'gogh-el-' + (i + 1);
    var n;
    switch (e.type) {
      case 'box':
        n = document.createElement('div');
        n.className = 'wp-block-group gogh-box ' + cls + (e.kids && e.kids.length ? ' gogh-cardbox' : '');
        if (e.href) {
          var cardA = document.createElement('a');
          cardA.className = 'gogh-card-link';
          cardA.href = e.href;
          cardA.setAttribute('aria-label', (e.kids && e.kids.length && e.kids[0].text) || 'Card link');
          n.appendChild(cardA);
        }
        if (e.kids) e.kids.forEach(function (k, j) {
          var kn = makeNode(k, j);
          kn.className = kn.className.replace('gogh-el-' + (j + 1), 'gogh-k-' + (j + 1));
          n.appendChild(kn);
        });
        break;
      case 'heading':
        n = document.createElement('h2');
        n.className = 'wp-block-heading ' + cls + (e.fs && !DISPLAY_FS[e.fs] ? ' has-' + e.fs + '-font-size' : '') + (e.color ? ' has-text-color has-' + e.color + '-color' : '');
        n.innerHTML = cleanInline(e.text);
        if (e.ph && !(e.text && String(e.text).trim())) n.setAttribute('data-gogh-ph', e.ph);
        break;
      case 'para':
        n = document.createElement('p');
        n.className = cls + (e.fs && !DISPLAY_FS[e.fs] ? ' has-' + e.fs + '-font-size' : '') + (e.color ? ' has-text-color has-' + e.color + '-color' : '');
        n.innerHTML = cleanInline(e.text);
        if (e.ph && !(e.text && String(e.text).trim())) n.setAttribute('data-gogh-ph', e.ph);
        break;
      case 'button':
        n = document.createElement('div');
        n.className = 'wp-block-buttons ' + cls;
        n.innerHTML = '<div class="wp-block-button' + (e.ghost ? ' gogh-ghost' : '') + '">' +
          '<a class="wp-block-button__link' +
          (e.btnText ? ' has-' + e.btnText + '-color has-text-color' : '') +
          (e.btnBg ? ' has-' + e.btnBg + '-background-color has-background' : '') +
          ' wp-element-button" href="#"></a></div>';
        n.querySelector('a').textContent = e.text;
        break;
      case 'image':
        if (e.src) {
          n = document.createElement('figure');
          n.className = 'wp-block-image size-full ' + cls + ' gogh-img';
          var img = document.createElement('img');
          img.src = e.src;
          img.alt = e.alt || '';
          if (e.mediaId) img.className = 'wp-image-' + e.mediaId;
          n.appendChild(img);
        } else {
          n = document.createElement('div');
          n.className = 'wp-block-group ' + cls;
        }
        break;
      case 'widget':
        n = document.createElement('div');
        n.className = 'wp-block-group ' + cls + ' gogh-widget';
        n.innerHTML = e.whtml || '';
        break;
      case 'badge':
        n = document.createElement('p');
        n.className = cls + ' gogh-badge';
        n.textContent = e.text;
        break;
      case 'exp': {
        // uploaded HTML experience: sandboxed iframe with an OPAQUE origin —
        // allow-scripts only, never allow-same-origin, so the bundle's code
        // cannot read cookies or touch the embedding page
        n = document.createElement('div');
        n.className = 'wp-block-group ' + cls + ' gogh-exp';
        if (e.expUrl) {
          var fr = document.createElement('iframe');
          fr.setAttribute('sandbox', 'allow-scripts');
          fr.src = e.expUrl;
          fr.title = 'Interactive experience';
          fr.setAttribute('style', 'width:100%;height:100%;border:0;display:block;');
          n.appendChild(fr);
        }
        break;
      }
      default:
        // element type from a newer gogh: keep the page alive
        n = document.createElement('div');
        n.className = cls;
        break;
    }
    return n;
  }

  function scaleOf(sec) { return sec.sectionEl.getBoundingClientRect().width / W; }
  function measureTextHeights(sec) {
    if (!sec.nodes || sec.nodes.some(function (n) { return !n; })) return;
    var s = scaleOf(sec);
    sec.els.forEach(function (e, i) {
      if (isText(e)) {
        var h = sec.nodes[i].offsetHeight / s;
        if (h > 0) e.h = Math.round(h);
      }
    });
  }
  function sectionOpts(sec) {
    var idx = S.indexOf(sec);
    var next = idx >= 0 ? S[idx + 1] : null;
    return { bg: sec.bg, bgA: sec.bgA != null ? sec.bgA : null, fill: !!sec.fill, divider: sec.divider, bgImage: sec.bgImage,
      fx: sec.fx || null,
      stickUnder: !!(next && next.fx && next.fx.curtain),
      divColor: next ? (next.bg || '#0f0e0c') : null };
  }
  function resolveAndApply(sec) {
    sec.styleEl.textContent = buildCSS(sec.els, sec.scope, sec.minH, sectionOpts(sec));
  }
  function resolveAll() { S.forEach(resolveAndApply); }
  // when a text element's height changes through reflow (narrowing or typing),
  // shift everything that sat below its old bottom edge by the same delta —
  // deliberate overlaps (drags) are untouched, reflow never swallows neighbours
  function reflowPush(sec, e, oldH) {
    var delta = e.h - oldH;
    if (!delta) return false;
    var oldBottom = e.y + oldH;
    var pushed = [];
    sec.els.forEach(function (o) {
      if (o === e) return;
      // elements in the text's vertical path: below its old bottom edge
      // AND horizontally overlapping its (current) footprint
      if (o.y >= oldBottom - 8 && o.x < e.x + e.w && o.x + o.w > e.x) {
        pushed.push(o);
      }
    });
    // row-aware: anything aligned with a pushed element (top/centre/bottom
    // level within snap tolerance) moves with it, transitively, so rows the
    // user lined up stay lined up even when only part of the row is in the
    // text's path
    function aligned(a, b) {
      return Math.abs(a.y - b.y) <= SNAP ||
        Math.abs((a.y + a.h) - (b.y + b.h)) <= SNAP ||
        Math.abs((a.y + a.h / 2) - (b.y + b.h / 2)) <= SNAP;
    }
    var grew = true;
    while (grew) {
      grew = false;
      sec.els.forEach(function (o) {
        if (o === e || pushed.indexOf(o) !== -1) return;
        if (o.y < oldBottom - 8 - SNAP) return;
        if (pushed.some(function (p) { return aligned(o, p); })) {
          pushed.push(o);
          grew = true;
        }
      });
    }
    pushed.forEach(function (o) { o.y = Math.max(0, o.y + delta); });
    return true;
  }

  // (re)build one section's DOM from its model
  function renderSection(sec) {
    if (textEditing && textEditing.sec === sec) exitTextEdit();
    sec.sectionEl.innerHTML = '';
    sec.nodes = sec.els.map(function (e, i) { return makeNode(e, i); });
    // append in READING order (nodes[] stays indexed by element) — keyboard
    // tabbing through the canvas follows the visual flow
    readingIndexOrder(sec.els).forEach(function (i) {
      sec.sectionEl.appendChild(sec.nodes[i]);
    });
    sec.nodes.forEach(function (n, i) { bindSelect(sec, i); });
    if (editing) sec.els.forEach(function (e, i) { bindEditable(sec, i, true); });
    // a blank page must invite, not just permit: the empty bootstrap canvas
    // carries a visible "first section" button (edit mode only, via CSS)
    if (isBlankBoot(sec)) {
      var inv = document.createElement('button');
      inv.type = 'button';
      inv.className = 'gogh-bootinvite';
      inv.innerHTML = '<span class="gogh-bootinvite-plus">＋</span><span>Add your first section</span><span class="gogh-bootinvite-hint">pick a layout, or start from a blank canvas</span>';
      inv.addEventListener('click', function () { openPicker(S.indexOf(sec)); });
      sec.sectionEl.appendChild(inv);
    }
    resolveAndApply(sec);
    // the theme has the last word on type: a serif variation can wrap a
    // display heading TALLER than the box a template designed, and the
    // words then sit on whatever was below (James's "Good design is good
    // business" landed on its own button). Growth pushes — the same
    // contract typing honours — processed top-down so pushes cascade.
    var sMeasure = scaleOf(sec);
    if (sMeasure > 0) {
      sec.els.slice().sort(function (a, b) { return a.y - b.y; }).forEach(function (e) {
        if (!isText(e)) return;
        var i = sec.els.indexOf(e);
        var h = sec.nodes[i] ? sec.nodes[i].offsetHeight / sMeasure : 0;
        if (h > 0 && Math.round(h) > e.h + 2) {
          var oldH = e.h;
          e.h = Math.round(h);
          reflowPush(sec, e, oldH);
        }
      });
    }
    measureTextHeights(sec);
    resolveAndApply(sec);
  }

  function newSectionShell(scope) {
    var wrap = document.createElement('div');
    wrap.className = 'wp-block-gogh-section alignfull gogh-wrap';
    var styleEl = document.createElement('style');
    styleEl.className = 'gogh-style';
    wrap.appendChild(styleEl);
    var sectionEl = document.createElement('div');
    sectionEl.className = 'gogh-section ' + scope;
    sectionEl.setAttribute('data-gogh-scope', scope);
    wrap.appendChild(sectionEl);
    return { scope: scope, els: [], minH: null, bg: null, divider: null, fx: null, bgImage: null, bgId: null, wrapEl: wrap, sectionEl: sectionEl, styleEl: styleEl, nodes: [] };
  }

  // ---------- history (undo/redo) ----------
  var history = [], hIdx = -1, textTimer = null;
  function serialize() {
    return JSON.stringify(S.map(function (sec) { return { scope: sec.scope, els: sec.els, minH: sec.minH || null, bg: sec.bg || null, divider: sec.divider || null, fx: sec.fx || null, bgImage: sec.bgImage || null, bgId: sec.bgId || null, bgA: sec.bgA != null ? sec.bgA : null, theme: sec.theme || null, fill: sec.fill || null, src: sec.srcSig || null, boot: sec.bootstrap || false, chrome: sec.chrome || null }; }));
  }
  function pushState() {
    var snap = serialize();
    if (history[hIdx] === snap) return;
    history = history.slice(0, hIdx + 1);
    history.push(snap);
    if (history.length > 60) history.shift();
    hIdx = history.length - 1;
    syncHistoryButtons();
    placeConvertBtns(); // layout below may have shifted
    placeChromeBtns();
    refreshChip();
  }
  function partElForArea(area) {
    var els = chromePartEls();
    for (var i = 0; i < els.length; i++) {
      var a = els[i].tagName === 'FOOTER' ? 'footer' : 'header';
      if (a === area) return els[i];
    }
    return null;
  }
  function restoreState(snap) {
    clearMulti();
    var data = JSON.parse(snap);
    // full rebuild, but each section goes back to its own DOM position so
    // non-gogh blocks interleaved with sections stay where they are
    var anchorOf = {};
    var parentOf = {};
    S.forEach(function (sec) {
      var n = sec.wrapEl.nextSibling;
      while (n && n.nodeType === 1 && n.classList && n.classList.contains('gogh-wrap')) n = n.nextSibling;
      anchorOf[sec.scope] = n;
      parentOf[sec.scope] = sec.wrapEl.parentNode;
    });
    S.forEach(function (sec) { sec.wrapEl.remove(); sec.styleEl.remove(); });
    var newS = [];
    var prevIns = null; // the section restored just before = the NEXT one in page order
    for (var di = data.length - 1; di >= 0; di--) {
      var d = data[di];
      var sec = newSectionShell(d.scope);
      sec.els = d.els;
      sec.minH = d.minH || null;
      sec.bg = d.bg || null;
      sec.divider = d.divider || null;
      sec.fx = d.fx || null;
      sec.bgImage = d.bgImage || null;
      sec.bgId = d.bgId || null;
      sec.bgA = d.bgA != null ? d.bgA : null;
      sec.theme = d.theme || null;
      sec.fill = !!d.fill;
      sec.srcSig = d.src || null;
      sec.bootstrap = !!d.boot;
      sec.chrome = d.chrome || null;
      var stable = anchorOf[d.scope] ||
        (d.src && convertStash[d.src] && convertStash[d.src].marker.nextSibling) ||
        endMarker;
      // chrome canvases remount into their template part — falling back to
      // pageParent stranded a converted footer in the page body (and the
      // zoom then listed it twice)
      var host = parentOf[d.scope] ||
        (d.chrome && partElForArea(d.chrome.area)) ||
        pageParent;
      // adjacent sections all share one stable (non-gogh) anchor — inserting
      // each AT it reverses the run. Chain through the section restored just
      // before (our true next sibling) whenever it shares anchor and parent.
      var anchor = (prevIns && prevIns.host === host && prevIns.stable === stable)
        ? prevIns.wrap : stable;
      host.insertBefore(sec.wrapEl, anchor && anchor.parentNode === host ? anchor : null);
      prevIns = { wrap: sec.wrapEl, host: host, stable: stable };
      newS.unshift(sec);
    }
    S = newS;
    // converted originals: attached exactly when their conversion is inactive
    Object.keys(convertStash).forEach(function (sig) {
      var active = S.some(function (s) { return s.srcSig === sig; });
      var st = convertStash[sig];
      if (active && st.node.parentNode) st.node.remove();
      if (!active && !st.node.parentNode) pageParent.insertBefore(st.node, st.marker.nextSibling);
    });
    S.forEach(renderSection);
    // a part whose chrome canvas no longer exists gets its original
    // header/footer back; one that does keeps the originals hidden
    chromePartEls().forEach(function (pe) {
      if (!pe.__goghHidden) return;
      var owned = S.some(function (s) { return s.chrome && pe.contains(s.wrapEl); });
      pe.__goghHidden.forEach(function (c) { c.style.display = owned ? 'none' : ''; });
    });
    placeConvertBtns();
    sel = null;
    hideHandles();
    hideGuides();
    closePanel();
    syncHistoryButtons();
  }
  function undo() { if (hIdx > 0) { hIdx--; restoreState(history[hIdx]); } }
  function redo() { if (hIdx < history.length - 1) { hIdx++; restoreState(history[hIdx]); } }
  function syncHistoryButtons() {
    var u = side.querySelector('.gogh-undo'), r = side.querySelector('.gogh-redo');
    if (u) u.disabled = hIdx <= 0;
    if (r) r.disabled = hIdx >= history.length - 1;
  }

  // ---------- UI chrome ----------
  var editBtnWrap = document.createElement('div');
  editBtnWrap.className = 'gogh-bar';
  editBtnWrap.innerHTML = '<button type="button" class="gogh-btn gogh-btn-edit">✏️ Edit with gogh</button>';
  document.body.appendChild(editBtnWrap);
  var editBtn = editBtnWrap.querySelector('.gogh-btn-edit');

  // the canonical element menu — served by the Section pill's ＋ ("Add to
  // this section"); the drawer stopped listing elements when the pill
  // learned to Add, and became the design side instead
  var ELEM_ITEMS =
    '<button type="button" class="gogh-sitem" data-add="heading"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 4v16M18 4v16M6 12h12"/></svg>Heading</button>' +
    '<button type="button" class="gogh-sitem" data-add="para"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>Text</button>' +
    '<button type="button" class="gogh-sitem" data-add="button"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="8" width="18" height="8" rx="4"/></svg>Button</button>' +
    '<button type="button" class="gogh-sitem" data-add="image"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="M21 16l-5-5-9 8"/></svg>Image</button>' +
    '<button type="button" class="gogh-sitem" data-add="badge"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><circle cx="12" cy="9.5" r="5.5"/><path d="M9 14l-1.5 6 4.5-2.4 4.5 2.4L15 14"/></svg>Badge</button>' +
    '<button type="button" class="gogh-sitem" data-add="write" title="Start writing — a reading column, cursor ready"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>Write</button>' +
    '<button type="button" class="gogh-sitem" data-add="card" title="A card — drop elements inside and they stay together, even on mobile"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 12h6M7 15.5h4"/></svg>Card</button>' +
    '<button type="button" class="gogh-sitem" data-act="shapes"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><circle cx="8.5" cy="8.5" r="5.5"/><rect x="11" y="11" width="10" height="10" rx="2"/></svg>Shape</button>' +
    (cfg.canExp ? '<button type="button" class="gogh-sitem" data-add="exp" title="Upload a self-contained HTML experience — it runs sandboxed"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M10 9.5l4.5 2.5-4.5 2.5z"/></svg>Experience</button>' : '') +
    '<button type="button" class="gogh-sitem" data-add="posts" title="Your latest posts, live"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/></svg>Posts</button>' +
    (cfg.hasWoo ? '<button type="button" class="gogh-sitem" data-add="products" title="Your latest products, live — prices and add to cart included"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 7h12l1.5 13.5H4.5Z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/></svg>Products</button>' +
      '<button type="button" class="gogh-sitem" data-act="featured" title="One product, hero-sized — a card with a real add-to-cart button"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M12 8.5l1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.4Z"/></svg>Featured product</button>' : '');
  var side = document.createElement('div');
  side.className = 'gogh-side';
  side.hidden = true;
  side.innerHTML =
    '<div class="gogh-side-head">' +
    '<span class="gogh-side-title">Design</span>' +
    '</div>' +
    '<div class="gogh-side-row">' +
    '<button type="button" class="gogh-sbtn gogh-gridbtn" data-act="gridsnap" title="Grid: show and snap">' +
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>' +
    '</button>' +
    (cfg.experiments ? '<button type="button" class="gogh-sbtn gogh-phibtn" data-act="compguides" title="Golden ratio guides">φ</button>' : '') +
    '<button type="button" class="gogh-sbtn gogh-zoomopen" title="Whole page — reorder sections">' +
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="3" width="16" height="7" rx="1.6"/><rect x="4" y="14" width="16" height="7" rx="1.6"/><path d="M12 10.5v3"/></svg>' +
    '</button>' +
    '<button type="button" class="gogh-sbtn gogh-mirroropen" title="Live mobile preview">' +
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>' +
    '</button>' +
    '</div>' +
    '<button type="button" class="gogh-sitem gogh-stylebtn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18h1.5a2.5 2.5 0 0 0 1.8-4.2 2.5 2.5 0 0 1 1.8-4.3H20a9 9 0 0 0-8-9.5Z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="7.5" r="1.2" fill="currentColor" stroke="none"/></svg>Site style</button>' +
    '<button type="button" class="gogh-sitem gogh-pagestylebtn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>Page style</button>' +
    '<button type="button" class="gogh-sitem gogh-sd-designs"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="6" width="13" height="15" rx="1.6"/><path d="M7 3h13v15"/></svg>Site designs</button>' +
    '<div class="gogh-side-gap"></div>' +
    '<div class="gogh-side-foot">' +
    '<button type="button" class="gogh-sbtn gogh-undo" title="Undo (⌘Z)">↺</button>' +
    '<button type="button" class="gogh-sbtn gogh-redo" title="Redo (⇧⌘Z)">↻</button>' +
    (cfg.helpUrl ? '<button type="button" class="gogh-sbtn gogh-help" title="Help — ask gogh anything">?</button>' : '') +
    '</div>';
  document.body.appendChild(side);

  // tuck-away drawer: slim edge tab when collapsed, slide-in on hover
  var sideTab = document.createElement('button');
  sideTab.type = 'button';
  sideTab.className = 'gogh-side-tab';
  sideTab.title = 'Design';
  sideTab.innerHTML = '<span class="gogh-side-tab-dot"></span><span>Design</span>';
  sideTab.hidden = true;
  document.body.appendChild(sideTab);
  var sideTimer = null;
  function openSide() {
    clearTimeout(sideTimer);
    side.classList.add('is-open');
    sideTab.classList.add('is-away');
  }
  function closeSide(now) {
    clearTimeout(sideTimer);
    var doIt = function () {
      side.classList.remove('is-open');
      sideTab.classList.remove('is-away');
    };
    if (now) doIt(); else sideTimer = setTimeout(doIt, 500);
  }
  sideTab.addEventListener('pointerenter', openSide);
  sideTab.addEventListener('click', openSide);
  side.addEventListener('pointerenter', openSide);
  side.addEventListener('pointerleave', function () { closeSide(false); });
  document.addEventListener('pointermove', function (ev) {
    if (editing && ev.clientX >= window.innerWidth - 12) openSide();
  }, { passive: true });

  // handles
  var grip = document.createElement('div');
  grip.className = 'gogh-grip';
  grip.textContent = '⠿';
  var resizer = document.createElement('div');
  resizer.className = 'gogh-resizer';
  // selection box with 8 resize handles + rotate handle
  var DIRS = [
    { d: 'nw', dx: -1, dy: -1 }, { d: 'n', dx: 0, dy: -1 }, { d: 'ne', dx: 1, dy: -1 },
    { d: 'e', dx: 1, dy: 0 }, { d: 'se', dx: 1, dy: 1 },
    { d: 's', dx: 0, dy: 1 }, { d: 'sw', dx: -1, dy: 1 }, { d: 'w', dx: -1, dy: 0 },
  ];
  var selBox = document.createElement('div');
  selBox.className = 'gogh-selbox';
  DIRS.forEach(function (dir) {
    var h = document.createElement('button');
    h.type = 'button';
    h.className = 'gogh-h gogh-h-' + dir.d;
    h.dataset.d = dir.d;
    selBox.appendChild(h);
  });
  var rotGrip = document.createElement('button');
  rotGrip.type = 'button';
  rotGrip.className = 'gogh-rot';
  rotGrip.textContent = '⟳';
  rotGrip.title = 'Drag to rotate';
  selBox.appendChild(rotGrip);

  // floating element toolbar (Canva-style)
  var elbar = document.createElement('div');
  elbar.className = 'gogh-elbar';
  elbar.innerHTML =
    '<button type="button" class="gogh-eb gogh-eb-ctx"></button>' +
    '<button type="button" class="gogh-eb gogh-eb-fs" title="Cycle theme font sizes"></button>' +
    '<button type="button" class="gogh-eb gogh-eb-al" title="Text alignment"></button>' +
    '<button type="button" class="gogh-eb gogh-eb-lnk" title="Link text (\u2318K)"></button>' +
    '<button type="button" class="gogh-eb gogh-eb-col" title="Text colour"><span class="gogh-eb-colchip"></span></button>' +
    '<button type="button" class="gogh-eb gogh-eb-bck" title="Send backward">▼</button>' +
    '<button type="button" class="gogh-eb gogh-eb-fwd" title="Bring forward">▲</button>' +
    '<button type="button" class="gogh-eb gogh-eb-dup" title="Duplicate (or Alt-drag)">⧉</button>' +
    '<button type="button" class="gogh-eb gogh-eb-del" title="Delete (Del)">🗑</button>';
  var ctxBtn = elbar.querySelector('.gogh-eb-ctx');
  var fsBtn = elbar.querySelector('.gogh-eb-fs');
  var alBtn = elbar.querySelector('.gogh-eb-al');
  var colBtn = elbar.querySelector('.gogh-eb-col');
  var lnkBtn = elbar.querySelector('.gogh-eb-lnk');
  var colChip = colBtn.querySelector('.gogh-eb-colchip');
  var CTX_ICONS = {
    link: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M10 14a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 10a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
    image: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6" fill="currentColor" stroke="none"/><path d="M3 17l5-4.5 4 3.5 4-4 5 4.5"/></svg>',
    shape: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><circle cx="8.5" cy="8.5" r="5.5"/><rect x="11" y="11" width="10" height="10" rx="2"/></svg>',
  };
  var ALIGN_ICONS = {
    left: '<svg width="13" height="12" viewBox="0 0 13 12"><g fill="currentColor"><rect width="13" height="2" rx="1"/><rect y="5" width="8" height="2" rx="1"/><rect y="10" width="11" height="2" rx="1"/></g></svg>',
    center: '<svg width="13" height="12" viewBox="0 0 13 12"><g fill="currentColor"><rect width="13" height="2" rx="1"/><rect x="2.5" y="5" width="8" height="2" rx="1"/><rect x="1" y="10" width="11" height="2" rx="1"/></g></svg>',
    right: '<svg width="13" height="12" viewBox="0 0 13 12"><g fill="currentColor"><rect width="13" height="2" rx="1"/><rect x="5" y="5" width="8" height="2" rx="1"/><rect x="2" y="10" width="11" height="2" rx="1"/></g></svg>',
  };

  grip.hidden = resizer.hidden = true;
  selBox.hidden = elbar.hidden = true;
  document.body.appendChild(grip);
  document.body.appendChild(resizer);
  document.body.appendChild(selBox);
  document.body.appendChild(elbar);
  resizer.style.display = 'none'; // superseded by the selection box handles

  var dropBox = document.createElement('div');
  dropBox.className = 'gogh-dropbox';
  dropBox.hidden = true;
  document.body.appendChild(dropBox);

  // theme.json font-size presets, ordered small → large by computed pixels
  var fontSizesCache = null;
  function fontSizes() {
    if (fontSizesCache) return fontSizesCache;
    var slugs = [], seen = {};
    var gs = document.getElementById('global-styles-inline-css');
    var cssText = gs ? gs.textContent : '';
    var re = /--wp--preset--font-size--([a-z0-9-]+)/g, m;
    while ((m = re.exec(cssText))) { if (!seen[m[1]]) { seen[m[1]] = 1; slugs.push(m[1]); } }
    var probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0';
    document.body.appendChild(probe);
    fontSizesCache = slugs.map(function (slug) {
      probe.style.fontSize = 'var(--wp--preset--font-size--' + slug + ')';
      return { slug: slug, px: parseFloat(getComputedStyle(probe).fontSize) || 0 };
    }).filter(function (f) { return f.px > 0; })
      .sort(function (a, b) { return a.px - b.px; });
    probe.remove();
    return fontSizesCache;
  }

  // step a text element through the theme's preset sizes (null = theme default)
  function setFontSize(sec, i, slug) {
    var e = sec.els[i];
    if (!isText(e)) return;
    e.fs = slug || null;
    if (e.tf) { delete e.tf.fs; delete e.tf.fs2; delete e.tf.lh; }
    var oldH = e.h;
    renderSection(sec);
    measureTextHeights(sec);
    if (reflowPush(sec, e, oldH)) resolveAndApply(sec);
    placeHandles(sec, i);
    pushState();
  }
  function stepFontSize(sec, i, dir) {
    var sizes = fontSizes();
    if (!sizes.length) return;
    var e = sec.els[i];
    var order = [null].concat(sizes.map(function (f) { return f.slug; }), DISPLAY_ORDER);
    var idx = order.indexOf(e.fs || null);
    var next = (idx + dir + order.length) % order.length;
    setFontSize(sec, i, order[next]);
  }

  var sizeChip = document.createElement('div');
  sizeChip.className = 'gogh-sizechip';
  sizeChip.hidden = true;
  document.body.appendChild(sizeChip);
  function applyFontStep(sec, i, delta) {
    var sizes = fontSizes();
    if (!sizes.length) return;
    var e = sec.els[i];
    var order = [null].concat(sizes.map(function (f) { return f.slug; }), DISPLAY_ORDER);
    var idx = order.indexOf(e.fs || null);
    var next = Math.max(0, Math.min(order.length - 1, idx + delta));
    if (order[next] === (e.fs || null)) return;
    e.fs = order[next];
    if (e.tf) { delete e.tf.fs; delete e.tf.fs2; delete e.tf.lh; }
    var oldH = e.h;
    renderSection(sec);
    measureTextHeights(sec);
    if (reflowPush(sec, e, oldH)) resolveAndApply(sec);
    if (sel) placeHandles(sec, i);
  }

  // theme.json colour presets, parsed from WP's global-styles output
  function themePalette() {
    var out = [], seen = {};
    var gs = document.getElementById('global-styles-inline-css');
    var cssText = gs ? gs.textContent : '';
    var re = /--wp--preset--color--([a-z0-9-]+):\s*([^;}]+)/g, m;
    while ((m = re.exec(cssText))) {
      if (!seen[m[1]]) { seen[m[1]] = 1; out.push({ slug: m[1], value: m[2].trim() }); }
    }
    // the page CSS also carries WordPress's default presets — only offer the
    // colours the THEME actually declares (the server told us their slugs)
    if (cfg.palette && cfg.palette.length) {
      var ok = {};
      cfg.palette.forEach(function (p) { ok[p.slug] = 1; });
      var themed = out.filter(function (p) { return ok[p.slug]; });
      if (themed.length) return themed;
    }
    return out;
  }
  function pickerPalette() {
    var seen = {};
    return themePalette().filter(function (p) {
      var probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;visibility:hidden;color:' + p.value;
      document.body.appendChild(probe);
      var key = getComputedStyle(probe).color || p.value;
      probe.remove();
      if (seen[key]) return false;
      seen[key] = 1;
      return true;
    });
  }
  var guideV = document.createElement('div');
  var guideH = document.createElement('div');
  guideV.className = 'gogh-guide gogh-guide-v';
  guideH.className = 'gogh-guide gogh-guide-h';
  guideV.hidden = guideH.hidden = true;
  document.body.appendChild(guideV);
  document.body.appendChild(guideH);

  var inserter = document.createElement('button');
  inserter.type = 'button';
  inserter.className = 'gogh-inserter';
  inserter.textContent = '+ Section';
  inserter.hidden = true;
  document.body.appendChild(inserter);
  var insertIdx = null;
  var insertBefore = null; // DOM anchor: native blocks sit between sections, so an S-index alone cannot say “above the pattern”

  var editing = false;
  var sel = null; // {sec, i}
  var multiSel = null; // {sec, idxs} — a group selection within one section
  function clearMulti() {
    if (!multiSel) return;
    var m = multiSel;
    multiSel = null;
    m.idxs.forEach(function (j) { if (m.sec.nodes[j]) m.sec.nodes[j].classList.remove('gogh-multisel'); });
  }
  function setMulti(secM, idxs) {
    clearMulti();
    if (!idxs || !idxs.length) return;
    if (idxs.length === 1) { placeHandles(secM, idxs[0]); return; }
    exitTextEdit();
    closePanel();
    sel = null;
    hideHandles();
    multiSel = { sec: secM, idxs: idxs.slice().sort(function (a, b) { return a - b; }) };
    multiSel.idxs.forEach(function (j) { if (secM.nodes[j]) secM.nodes[j].classList.add('gogh-multisel'); });
  }

  function nodeBox(node) {
    var w = node.offsetWidth, h = node.offsetHeight;
    var r = node.getBoundingClientRect();
    return { x: r.left + window.scrollX + r.width / 2 - w / 2,
             y: r.top + window.scrollY + r.height / 2 - h / 2, w: w, h: h };
  }
  function goghFadeOut(el) {
    if (el.hidden || el.classList.contains('gogh-byebye')) return;
    el.classList.add('gogh-byebye');
    setTimeout(function () {
      // a show in the meantime clears the class — only hide if still leaving
      if (el.classList.contains('gogh-byebye')) {
        el.hidden = true;
        el.classList.remove('gogh-byebye');
      }
    }, 190);
  }
  function hideHandles() {
    grip.hidden = selBox.hidden = true;
    goghFadeOut(elbar);
  }
  function hideGuides() { guideV.hidden = guideH.hidden = true; }

  // the box the USER perceives: for buttons that's the pill, not its
  // layout cell (themes pad the wrapper, leaving an unsettling moat)
  function visualNode(sec, i) {
    var e = sec.els[i], n = sec.nodes[i];
    if (e && e.type === 'button' && n) return n.querySelector('.wp-block-button__link') || n;
    return n;
  }
  function placeHandles(sec, i) {
    if (!sec.nodes[i]) { hideHandles(); return; }
    sel = { sec: sec, i: i };
    var e = sec.els[i];
    var node = sec.nodes[i];
    var prev = document.querySelector('.gogh-selected');
    if (prev && prev !== node) prev.classList.remove('gogh-selected');
    node.classList.add('gogh-selected');
    // anchor to the RENDERED layout box — the grid can drift a few px from the
    // model when intrinsic minimums stretch rows, and that drift accumulates
    var b = nodeBox(visualNode(sec, i));
    var bx = b.x, byy = b.y, bw = b.w, bh = b.h;
    selBox.style.left = bx + 'px';
    selBox.style.top = byy + 'px';
    selBox.style.width = bw + 'px';
    selBox.style.height = bh + 'px';
    selBox.style.transform = e.rot ? 'rotate(' + e.rot + 'deg)' : '';
    selBox.classList.toggle('gogh-selbox-text', isText(e));
    selBox.hidden = false;
    grip.style.left = (bx - 26) + 'px';
    grip.style.top = (byy - 26) + 'px';
    grip.hidden = false;
    // toolbar above the rotated bounding rect, centred on the element
    var ar = node.getBoundingClientRect();
    elbar.style.left = (ar.left + window.scrollX + ar.width / 2) + 'px';
    elbar.style.top = (ar.top + window.scrollY - 14) + 'px';
    if (e.type === 'button' || e.type === 'image' || e.type === 'box') {
      // cards share the section's background icon — one glyph for one idea;
      // bare shapes keep the shape glyph (their panel really picks shapes)
      var isCardEl = e.type === 'box' && e.kids && e.kids.length;
      ctxBtn.innerHTML = CTX_ICONS[e.type === 'button' ? 'link' : e.type === 'box' ? (isCardEl ? 'image' : 'shape') : 'image'];
      ctxBtn.title = e.type === 'button' ? 'Button link' : e.type === 'box' ? ( isCardEl ? 'Background image & colour' : 'Shape, colour & image' ) : e.type === 'widget' ? 'Block settings & link' : 'Choose image';
      ctxBtn.style.display = '';
    } else {
      ctxBtn.style.display = 'none';
    }
    if (isText(e)) {
      fsBtn.textContent = 'Aa' + (e.fs ? ' · ' + (DISPLAY_LABEL[e.fs] || e.fs) : '');
      fsBtn.style.display = '';
    } else {
      fsBtn.style.display = 'none';
    }
    if (e.type === 'heading' || e.type === 'para') {
      alBtn.innerHTML = ALIGN_ICONS[e.align || 'left'];
      alBtn.title = 'Text align: ' + (e.align || 'left') + ' (click to cycle)';
      alBtn.style.display = '';
      lnkBtn.innerHTML = CTX_ICONS.link;
      lnkBtn.style.display = '';
      colChip.style.background = e.color ? 'var(--wp--preset--color--' + e.color + ')' : 'transparent';
      colChip.classList.toggle('is-default', !e.color);
      colBtn.style.display = '';
    } else {
      alBtn.style.display = 'none';
      lnkBtn.style.display = 'none';
      colBtn.style.display = 'none';
    }
    elbar.hidden = false;
  }

  function showGuides(sec, gx, gy) {
    var r = sec.sectionEl.getBoundingClientRect();
    var s = r.width / W;
    var Hc = designH(sec.els, sec.minH);
    if (gx !== null) {
      guideV.style.left = (r.left + window.scrollX + gx * s) + 'px';
      guideV.style.top = (r.top + window.scrollY) + 'px';
      guideV.style.height = r.height + 'px';
      var tx = compTag(Hc, gx, 'x');
      // the centre earns a name too: pink says aligned, the tag says WHERE
      guideV.dataset.tag = tx || (Math.round(gx) === Math.round(W / 2) ? 'centre' : '');
      guideV.classList.toggle('gogh-guide-comp', !!tx);
      guideV.hidden = false;
    } else guideV.hidden = true;
    if (gy !== null) {
      guideH.style.top = (r.top + window.scrollY + gy * s) + 'px';
      guideH.style.left = (r.left + window.scrollX) + 'px';
      guideH.style.width = r.width + 'px';
      var ty = compTag(Hc, gy, 'y');
      guideH.dataset.tag = ty || (Math.round(gy) === Math.round(Hc / 2) ? 'centre' : '');
      guideH.classList.toggle('gogh-guide-comp', !!ty);
      guideH.hidden = false;
    } else guideH.hidden = true;
  }

  // Canva-style pointer model: click selects, drag-from-anywhere moves,
  // a second click (or a click while selected) enters text editing.
  var pendingDrag = null;
  var textEditing = null; // {sec, i, node, target}
  // pasted-HTML widgets carry identical live/source markup — those we can
  // edit in place and write straight back. Block-backed widgets (posts)
  // must never be overwritten from their DOM, so they stay read-only.
  function widgetEditableLeaf(sec, i, ev) {
    var e = sec.els[i];
    if (e.type !== 'widget' || !e.wsrc || e.wsrc !== e.whtml || !ev) return null;
    var node = sec.nodes[i];
    var at = (ev.target instanceof Element && node.contains(ev.target))
      ? ev.target
      : document.elementFromPoint(ev.clientX, ev.clientY);
    if (!at || !node.contains(at)) return null;
    var SEL = 'h1,h2,h3,h4,h5,h6,p,li,figcaption,blockquote,dt,dd,span,a,button,em,strong,small';
    var leaf = at.closest ? at.closest(SEL) : null;
    while (leaf && node.contains(leaf) && leaf !== node) {
      var direct = [].some.call(leaf.childNodes, function (n2) {
        return n2.nodeType === 3 && n2.textContent.trim();
      });
      if (direct) return leaf;
      leaf = leaf.parentElement && leaf.parentElement !== node ? leaf.parentElement.closest(SEL) : null;
    }
    return null;
  }
  function syncWidgetEdit() {
    if (!textEditing || !textEditing.widget) return;
    var e = textEditing.sec.els[textEditing.i];
    var clone = textEditing.node.cloneNode(true);
    [].slice.call(clone.querySelectorAll('[contenteditable]')).forEach(function (n2) { n2.removeAttribute('contenteditable'); });
    var html = clone.innerHTML;
    e.whtml = html;
    e.wsrc = html;
    clearTimeout(textTimer);
    textTimer = setTimeout(pushState, 800);
  }
  function enterTextEdit(sec, i, ev) {
    var widgetLeaf = widgetEditableLeaf(sec, i, ev);
    var t = widgetLeaf || editableTarget(sec, i);
    if (!t) return;
    exitTextEdit();
    var e = sec.els[i];
    t.contentEditable = (widgetLeaf || e.type === 'heading' || e.type === 'para') ? 'true' : 'plaintext-only';
    sec.nodes[i].classList.add('gogh-textedit');
    // writing wants a CLEAN page: the selection box and handles fade out
    // while the caret is live (the floating toolbar stays)
    document.documentElement.classList.add('gogh-textediting');
    textEditing = { sec: sec, i: i, node: sec.nodes[i], target: t, widget: !!widgetLeaf };
    if (widgetLeaf) {
      t.addEventListener('input', syncWidgetEdit);
      var lk = t.closest('a');
      textEditing.link = lk;
      if (lk) lk.addEventListener('click', preventNav);
    }
    t.focus();
    if (ev && document.caretRangeFromPoint) {
      var cr = document.caretRangeFromPoint(ev.clientX, ev.clientY);
      if (cr && t.contains(cr.startContainer)) {
        var selObj = window.getSelection();
        selObj.removeAllRanges();
        selObj.addRange(cr);
      }
    }
  }
  function exitTextEdit() {
    if (!textEditing) return;
    document.documentElement.classList.remove('gogh-textediting');
    var t = textEditing.target;
    if (textEditing.widget) {
      syncWidgetEdit();
      t.removeEventListener('input', syncWidgetEdit);
      if (textEditing.link) textEditing.link.removeEventListener('click', preventNav);
    }
    t.contentEditable = 'false';
    if (textEditing.node.classList) textEditing.node.classList.remove('gogh-textedit');
    if (document.activeElement === t) t.blur();
    textEditing = null;
  }
  function bindSelect(sec, i) {
    var node = sec.nodes[i];
    node.addEventListener('dragstart', function (ev) { if (editing) ev.preventDefault(); });
    // while editing, clicks select and edit — they never follow links
    // (a pasted card's href="#" was scrolling the page to the top)
    node.addEventListener('click', function (ev) {
      if (!editing) return;
      var a2 = ev.target.closest && ev.target.closest('a');
      if (a2 && node.contains(a2)) ev.preventDefault();
    });
    node.addEventListener('pointerdown', function (ev) {
      if (!editing || drag || resize) return;
      if (textEditing && textEditing.node === node) return; // native caret/selection
      if (textEditing) exitTextEdit();
      if (ev.shiftKey && !ev.metaKey && !ev.ctrlKey) {
        // shift-click gathers a group (and shift-clicking again drops one)
        ev.preventDefault();
        var base = (multiSel && multiSel.sec === sec) ? multiSel.idxs.slice()
          : (sel && sel.sec === sec ? [sel.i] : []);
        var at = base.indexOf(i);
        if (at === -1) base.push(i); else base.splice(at, 1);
        setMulti(sec, base);
        return;
      }
      if (multiSel && multiSel.sec === sec && multiSel.idxs.indexOf(i) !== -1) {
        // grabbing any member drags the whole group
        sel = { sec: sec, i: i };
        pendingDrag = { sec: sec, i: i, node: node,
          x: ev.clientX, y: ev.clientY, wasSelected: false,
          ev: { altKey: false, clientX: ev.clientX, clientY: ev.clientY, pointerId: ev.pointerId } };
        return;
      }
      if (multiSel) clearMulti();
      if (explodeSt) {
        // exploded stack: a click plucks that element, anything else closes
        var wasFan = explodeSt.sec === sec && explodeSt.cluster.indexOf(i) !== -1;
        exitExplode();
        if (wasFan) { placeHandles(sec, i); return; }
      }
      var wasSelected = !!(sel && sel.sec === sec && sel.i === i);
      placeHandles(sec, i);
      // NO preventDefault here: it would stop the click from focusing this
      // frame (breaks keyboard nudge/undo inside iframes, e.g. Playground).
      // Carets can't appear anyway (contenteditable is off until second
      // click); text-selection is suppressed via CSS user-select.
      try { window.focus(); } catch (err) {}
      pendingDrag = {
        sec: sec, i: i, node: node,
        x: ev.clientX, y: ev.clientY,
        wasSelected: wasSelected,
        ev: { altKey: ev.altKey, clientX: ev.clientX, clientY: ev.clientY, pointerId: ev.pointerId },
      };
    });
  }
  document.addEventListener('pointermove', function (ev) {
    if (!pendingDrag || drag) return;
    if (resize) { pendingDrag = null; return; } // a handle took over
    if (ev.pointerId !== pendingDrag.ev.pointerId) return;
    if (Math.abs(ev.clientX - pendingDrag.x) + Math.abs(ev.clientY - pendingDrag.y) < 4) return;
    var pd = pendingDrag;
    pendingDrag = null;
    beginDrag(pd.ev);
  });
  document.addEventListener('pointerup', function (ev) {
    if (!pendingDrag) return;
    var pd = pendingDrag;
    pendingDrag = null;
    if (resize || ev.pointerId !== pd.ev.pointerId) return;
    if (pd.wasSelected) enterTextEdit(pd.sec, pd.i, ev);
  });

  function editableTarget(sec, i) {
    var e = sec.els[i], n = sec.nodes[i];
    if (!n) return null;
    if (isText(e) || e.type === 'badge') return e.type === 'badge' && n.querySelector('.gogh-star') ? null : n;
    if (e.type === 'button') return n.querySelector('.wp-block-button__link');
    return null;
  }
  function preventNav(ev) { ev.preventDefault(); }
  function onTextInput(ev) {
    var t = ev.target;
    S.forEach(function (sec) {
      sec.els.forEach(function (e, i) {
        if (editableTarget(sec, i) !== t) return;
        e.text = (e.type === 'heading' || e.type === 'para') ? cleanInline(t.innerHTML) : t.textContent;
        var oldH = e.h;
        measureTextHeights(sec);
        if (isText(e) && reflowPush(sec, e, oldH)) resolveAndApply(sec);
      });
    });
    if (sel) placeHandles(sel.sec, sel.i);
    clearTimeout(textTimer);
    textTimer = setTimeout(pushState, 800);
  }
  function bindEditable(sec, i, on) {
    var t = editableTarget(sec, i);
    if (!t) return;
    t.contentEditable = 'false'; // editing is entered per-element (second click)
    if (on) {
      t.addEventListener('input', onTextInput);
      t.addEventListener('click', preventNav);
    } else {
      t.removeEventListener('input', onTextInput);
      t.removeEventListener('click', preventNav);
    }
  }

  // the site header and footer sleep behind a veil while you arrange the
  // page — hover says what they are, one click wakes them for editing.
  // Accidental nav-drags die here, and editability announces itself.
  var chromeVeils = [];
  function veilChromeArea(area) {
    var pe = partElForArea(area);
    if (!pe || pe.querySelector('.gogh-chromeveil')) return;
    var v = document.createElement('div');
    v.className = 'gogh-chromeveil';
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'gogh-chromeveil-pill';
    b.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>Edit site ' + area;
    v.appendChild(b);
    v.addEventListener('click', function () {
      v.remove();
      wakeChrome(pe, area);
    });
    if (getComputedStyle(pe).position === 'static') pe.style.position = 'relative';
    pe.appendChild(v);
    chromeVeils.push(v);
  }
  // awake = visibly in focus: an editing ring around the part, and a click
  // anywhere back in the page puts the chrome to sleep again (re-veiled)
  function wakeChrome(pe, area) {
    pe.classList.add('gogh-chrome-live');
    var sleep = function (ev) {
      if (pe.contains(ev.target)) return;
      // gogh's own surfaces (panels, drawer, toolbars, toasts) are part of
      // the editing conversation — they don't put the chrome to sleep
      if (ev.target.closest && ev.target.closest('.gogh-panel, .gogh-side, .gogh-side-tab, .gogh-elbar, .gogh-hbar, .gogh-secbar, .gogh-toast, .gogh-chip, .gogh-convertbtn, .gogh-picker, .gogh-navadd, #wpadminbar')) return;
      pe.classList.remove('gogh-chrome-live');
      document.removeEventListener('pointerdown', sleep, true);
      if (editing) veilChromeArea(area);
    };
    document.addEventListener('pointerdown', sleep, true);
  }
  function veilChrome() {
    ['header', 'footer'].forEach(veilChromeArea);
  }
  function unveilChrome() {
    chromeVeils.forEach(function (v) { if (v.parentNode) v.remove(); });
    chromeVeils = [];
    document.querySelectorAll('.gogh-chrome-live').forEach(function (n) { n.classList.remove('gogh-chrome-live'); });
  }
  function setEditing(on) {
    editing = on;
    document.documentElement.classList.toggle('gogh-editing', on);
    if (on) veilChrome(); else unveilChrome();
    [elbar, secBar, hbar].forEach(function (b) { if (b) b.classList.remove('gogh-byebye'); });
    // the admin-bar landmark flips with the MODE, not just the URL — the
    // floating pill enters editing without a reload
    var abLink = document.querySelector('#wp-admin-bar-gogh-edit a');
    if (abLink) {
      abLink.textContent = on ? '\ud83c\udfa8 Exit gogh editor' : '\ud83c\udfa8 Edit with gogh';
      var abUrl = new URL(location.href);
      abUrl.searchParams[on ? 'delete' : 'set']('gogh-edit', '1');
      abLink.href = abUrl.toString();
    }
    side.hidden = !on;
    sideTab.hidden = !on;
    if (!on) {
      closeSide(true);
    }
    // the palette waits to be invited — its pulsing tab is the greeting
    if (on) {
      // warm the picker's shelves so the modal opens complete, not in jolts
      fetchSectionPatterns();
      fetchBlocks();
      // header/footer become lightly editable: text, links, menus in place
      initChromeLightEdits();
      // so do published native/HTML sections — publish is not a one-way door
      initStoredEdits();
    }
    editBtnWrap.hidden = on;
    hideHandles();
    hideGuides();
    closePanel();
    closePicker();
    inserter.hidden = true;
    hideHbar();
    shapeBtn.hidden = true;
    closeShapePanel();
    hideSecBar();
    exitTextEdit();
    var selNode = document.querySelector('.gogh-selected');
    if (selNode) selNode.classList.remove('gogh-selected');
    S.forEach(function (sec) {
      sec.els.forEach(function (e, i) { bindEditable(sec, i, on); });
      if (on) { measureTextHeights(sec); resolveAndApply(sec); }
    });
    if (on && history.length === 0) pushState();
    if (on && savedSnap === null) savedSnap = serialize();
    if (on) { placeConvertBtns(); placeChromeBtns(); } else { clearConvertBtns(); clearChromeBtns(); }
    chip.hidden = !on;
    if (on) { refreshChip(); checkRecovery(); }
    else exitPanel.hidden = true;
  }

  // ---------- context panel (link / image) ----------
  var panel = document.createElement('div');
  panel.className = 'gogh-panel';
  panel.hidden = true;
  document.body.appendChild(panel);
  var panelOpen = false;
  // panels drag by their title — a tall panel otherwise covers the very
  // section it styles, and auditioning a look means seeing the canvas
  (function () {
    var pd = null;
    panel.addEventListener('pointerdown', function (ev) {
      var t = ev.target.closest('.gogh-panel-title, .gogh-panel-head');
      if (!t || ev.target.closest('button, input, a, select, textarea')) return;
      var r = panel.getBoundingClientRect();
      pd = { dx: ev.clientX - r.left, dy: ev.clientY - r.top };
      try { panel.setPointerCapture(ev.pointerId); } catch (err) {}
      ev.preventDefault();
    });
    panel.addEventListener('pointermove', function (ev) {
      if (!pd) return;
      panel.style.left = (ev.clientX - pd.dx + window.scrollX) + 'px';
      panel.style.top = (ev.clientY - pd.dy + window.scrollY) + 'px';
    });
    panel.addEventListener('pointerup', function () { pd = null; });
    panel.addEventListener('pointercancel', function () { pd = null; });
  })();
  function closePanel() {
    panel.hidden = true;
    panelOpen = false;
    // a style audition must never outlive its panel
    if (typeof clearVariationPreview === 'function') clearVariationPreview();
    // an ACTIVE cycle owns its preview — defensive closePanel calls from
    // unrelated paths must not snuff it (the counter kept advancing while
    // the preview died: James's exact symptom)
    if (!chromeCycle) endChromePreview();
  }
  // place the panel near the element but always fully inside the viewport —
  // a viewport-filling image would otherwise push it below the fold
  function placePanelNear(node) {
    var r = node.getBoundingClientRect();
    panel.hidden = false;
    var pw = panel.offsetWidth || 340;
    var ph = panel.offsetHeight || 220;
    var left = Math.max(8, Math.min(r.left + window.scrollX, window.scrollX + window.innerWidth - pw - 16));
    var top = r.bottom + window.scrollY + 10;
    // 76px bottom reserve keeps the panel clear of the publish chip
    var maxTop = window.scrollY + window.innerHeight - ph - 76;
    if (top > maxTop) {
      // clamping would slide the panel up OVER its anchor ("the modal
      // overlaps the actual button") — step BESIDE it instead, whichever
      // side has the room
      var sideTop = Math.max(window.scrollY + 16, Math.min(r.top + window.scrollY - 8, maxTop));
      if (r.right + pw + 20 < window.innerWidth) {
        left = r.right + window.scrollX + 12;
        top = sideTop;
      } else if (r.left - pw - 20 > 0) {
        left = r.left + window.scrollX - pw - 12;
        top = sideTop;
      } else {
        top = Math.max(window.scrollY + 16, maxTop);
      }
    }
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panelAnchor = node;
  }
  var panelAnchor = null;
  function reclampPanel() { if (!panel.hidden && panelAnchor) placePanelNear(panelAnchor); }
  function openPanel(sec, i) {
    var e = sec.els[i];
    panel.innerHTML = '';
    if (e.type === 'button') buildLinkPanel(sec, i);
    else if (e.type === 'image') buildImagePanel(sec, i);
    else if (e.type === 'box') buildBoxPanel(sec, i);
    else if (e.type === 'widget') buildWidgetPanel(sec, i);
    placePanelNear(sec.nodes[i]);
    panelOpen = true;
  }
  var savedTextRange = null;
  function applyTextLink(url) {
    var selObj = window.getSelection();
    if (savedTextRange) {
      selObj.removeAllRanges();
      selObj.addRange(savedTextRange);
    }
    if (!selObj.rangeCount) return;
    var t = selObj.anchorNode && (selObj.anchorNode.nodeType === 1 ? selObj.anchorNode : selObj.anchorNode.parentElement);
    var host = t && t.closest('[contenteditable="true"]');
    if (host) host.focus();
    if (savedTextRange) {
      selObj.removeAllRanges();
      selObj.addRange(savedTextRange);
    }
    document.execCommand(url ? 'createLink' : 'unlink', false, url || undefined);
    savedTextRange = null;
    if (host) host.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function openTextLinkPanel() {
    var selObj = window.getSelection();
    if (!selObj.rangeCount) return;
    var range = selObj.getRangeAt(0);
    savedTextRange = range.cloneRange();
    var node = selObj.anchorNode;
    var el = node && (node.nodeType === 1 ? node : node.parentElement);
    var existing = el && el.closest('a');
    panel.innerHTML =
      '<div class="gogh-panel-title">Link text</div>' +
      '<div class="gogh-panel-row">' +
      '<input type="url" class="gogh-input" placeholder="https://\u2026" />' +
      '<button type="button" class="gogh-btn gogh-btn-small gogh-apply">Apply</button>' +
      (existing ? '<button type="button" class="gogh-btn gogh-btn-small gogh-unlink">Remove</button>' : '') +
      '</div>';
    var input = panel.querySelector('input');
    input.value = (existing && existing.getAttribute('href')) || '';
    var apply = function () {
      var url = input.value.trim();
      closePanel();
      if (url) applyTextLink(url);
    };
    panel.querySelector('.gogh-apply').addEventListener('click', apply);
    var un = panel.querySelector('.gogh-unlink');
    if (un) un.addEventListener('click', function () {
      closePanel();
      applyTextLink(null);
    });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); apply(); }
      if (ev.key === 'Escape') { savedTextRange = null; closePanel(); }
    });
    var rect = range.getBoundingClientRect();
    placePanelNear({ getBoundingClientRect: function () { return rect; } });
    panelOpen = true;
    input.focus();
  }

  function buildWidgetPanel(sec, i) {
    var e = sec.els[i];
    var node = sec.nodes[i];
    var editableSrc = e.wsrc != null && e.wsrc === e.whtml;
    var a = editableSrc ? node.querySelector('a') : null;
    panel.innerHTML =
      '<div class="gogh-panel-title">Imported block</div>' +
      (a
        ? '<div class="gogh-swlab">Link</div><div class="gogh-panel-row">' +
          '<input type="url" class="gogh-input" placeholder="https://\u2026" />' +
          '<button type="button" class="gogh-btn gogh-btn-small gogh-apply">Apply</button></div>' +
          '<div class="gogh-panel-hint">Click its text to edit the words in place.</div>'
        : '<div class="gogh-panel-hint">' + (editableSrc
            ? 'Click text to edit it in place.'
            : 'This block renders live WordPress content.') + '</div>');
    if (a) {
      var inp = panel.querySelector('input');
      var href = a.getAttribute('href');
      inp.value = href && href !== '#' ? href : '';
      panel.querySelector('.gogh-apply').addEventListener('click', function () {
        var url = inp.value.trim();
        if (url && !/^https?:\/\//i.test(url) && url[0] !== '/' && url[0] !== '#') url = 'https://' + url;
        a.setAttribute('href', url || '#');
        var clone = node.cloneNode(true);
        [].slice.call(clone.querySelectorAll('[contenteditable]')).forEach(function (n2) { n2.removeAttribute('contenteditable'); });
        e.whtml = clone.innerHTML;
        e.wsrc = clone.innerHTML;
        pushState();
        closePanel();
        toast(url ? 'Card now links to ' + url : 'Link cleared.');
      });
    }
  }
  function buildLinkPanel(sec, i) {
    buildLinkPanelFor(sec, sec.els[i], function () {
      renderSection(sec);
      placeHandles(sec, i);
      pushState();
      buildLinkPanel(sec, i); // rebuild so active states stay honest
    });
  }
  // the same panel serves top-level buttons AND buttons inside cards —
  // the caller owns re-rendering and reselection
  function buildLinkPanelFor(sec, e, reapply) {
    function swRow(label, key) {
      return '<div class="gogh-swlab">' + label + '</div><div class="gogh-swrow" data-key="' + key + '">' +
        '<button type="button" class="gogh-sw gogh-sw-none' + (!e[key] ? ' is-active' : '') + '" data-col="" title="Theme default"></button>' +
        pickerPalette().map(function (p) {
          return '<button type="button" class="gogh-sw' + (e[key] === p.slug ? ' is-active' : '') + '" data-col="' + p.slug + '"' +
            ' style="background: var(--wp--preset--color--' + p.slug + ')" title="' + p.slug + '"></button>';
        }).join('') + '</div>';
    }
    panel.innerHTML =
      '<div class="gogh-panel-title">Button</div>' +
      '<div class="gogh-panel-row">' +
      '<input type="url" class="gogh-input" placeholder="https://\u2026" />' +
      '<button type="button" class="gogh-btn gogh-btn-small gogh-apply">Apply</button>' +
      '</div>' +
      '<div class="gogh-swlab">Style</div>' +
      '<div class="gogh-panel-row gogh-btnstyle">' +
      '<button type="button" class="gogh-btn gogh-btn-small gogh-style-solid' + (!e.ghost ? ' is-active' : '') + '">Solid</button>' +
      '<button type="button" class="gogh-btn gogh-btn-small gogh-style-outline' + (e.ghost ? ' is-active' : '') + '">Outline</button>' +
      '</div>' +
      swRow('Background', 'btnBg') +
      swRow('Text', 'btnText') +
      swRow('Hover background', 'btnHover');
    (function () {
      var idx = sec.els.indexOf(e);
      var host = idx !== -1 ? sec.nodes[idx] : null;
      var link = host && host.querySelector('.wp-block-button__link');
      if (!link) return; // kid buttons: marking arrives with kid panels later
      var bgHex = cssColorToHex(getComputedStyle(link).backgroundColor);
      markSwatchLegibility(panel.querySelector('.gogh-swrow[data-key="btnText"]'), bgHex);
    })();
    panel.querySelector('.gogh-style-solid').addEventListener('click', function () {
      if (e.ghost) { e.ghost = false; reapply(); }
    });
    panel.querySelector('.gogh-style-outline').addEventListener('click', function () {
      if (!e.ghost) { e.ghost = true; reapply(); }
    });
    panel.querySelectorAll('.gogh-swrow[data-key]').forEach(function (row) {
      var key = row.dataset.key;
      row.querySelectorAll('.gogh-sw').forEach(function (swBtn) {
        swBtn.addEventListener('click', function () {
          e[key] = swBtn.dataset.col || null;
          if (e.tf) {
            if (key === 'btnBg') delete e.tf.bg;
            if (key === 'btnText') delete e.tf.col;
          }
          reapply();
        });
      });
    });
    var input = panel.querySelector('input');
    input.value = e.href || '';
    var apply = function () {
      e.href = input.value.trim() || null;
      closePanel();
      pushState();
    };
    panel.querySelector('.gogh-apply').addEventListener('click', apply);
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') apply();
      if (ev.key === 'Escape') closePanel();
    });
    input.focus();
  }
  function buildBoxPanel(sec, i) {
    var e = sec.els[i];
    panel.innerHTML =
      '<div class="gogh-panel-title">Shape</div>' +
      '<div class="gogh-shapegrid">' +
      SHAPE_DEFS.map(function (d, k) {
        var on = d.key === (e.shape || null);
        return '<button type="button" class="gogh-shapecell' + (on ? ' is-active' : '') + '" data-k="' + k + '" title="' + d.label + '">' +
          '<span style="' + shapePreviewCss(d) + '"></span></button>';
      }).join('') +
      '</div>' +
      '<div class="gogh-swlab">Colour</div><div class="gogh-swrow gogh-boxsw">' +
      '<button type="button" class="gogh-sw gogh-sw-none' + (!e.boxBg ? ' is-active' : '') + '" data-col="" title="None"></button>' +
      pickerPalette().map(function (p) {
        return '<button type="button" class="gogh-sw' + (e.boxBg === p.slug ? ' is-active' : '') + '" data-col="' + p.slug + '"' +
          ' style="background: var(--wp--preset--color--' + p.slug + ')" title="' + p.slug + '"></button>';
      }).join('') + '</div>' +
      (e.kids && e.kids.length
        ? '<div class="gogh-swlab">Link \u2014 the whole card is clickable</div>' +
          '<div class="gogh-panel-row">' +
          '<input type="url" class="gogh-input gogh-cardhref" placeholder="https://\u2026" value="' + escAttr(e.href || '') + '" />' +
          '<button type="button" class="gogh-btn gogh-btn-small gogh-cardhref-apply">Apply</button>' +
          '</div>'
        : '') +
      '<div class="gogh-swlab">Image \u2014 the colour above becomes its tint</div>' +
      '<div class="gogh-panel-row">' +
      '<input type="url" class="gogh-input gogh-boximg-url" placeholder="https://\u2026" value="' + escAttr(e.boxImg || '') + '" />' +
      '<button type="button" class="gogh-btn gogh-btn-small gogh-boximg-apply">Apply</button>' +
      '</div>' +
      '<div class="gogh-panel-row">' +
      (cfg.canUpload ? '<label class="gogh-btn gogh-btn-small gogh-upload">Upload<input type="file" accept="image/*" hidden /></label>' : '') +
      (e.boxImg ? '<button type="button" class="gogh-btn gogh-btn-small gogh-boximg-clear">Remove image</button>' : '') +
      '</div>' +
      '<div class="gogh-media gogh-boximg-media"></div>';
    function reapply() {
      renderSection(sec);
      placeHandles(sec, i);
      pushState();
      // update the active marks IN PLACE — a full rebuild refetches the
      // media grid and reads as the panel closing and reopening
      panel.querySelectorAll('.gogh-boxsw .gogh-sw').forEach(function (b2) {
        b2.classList.toggle('is-active', (b2.dataset.col || '') === (e.boxBg || ''));
      });
      panel.querySelectorAll('.gogh-shapecell').forEach(function (b2) {
        var d2 = SHAPE_DEFS[+b2.dataset.k];
        b2.classList.toggle('is-active', (d2.key || null) === (e.shape || null));
      });
    }
    panel.querySelectorAll('.gogh-shapecell').forEach(function (b) {
      b.addEventListener('click', function () {
        var d = SHAPE_DEFS[+b.dataset.k];
        e.shape = d.key || null;
        e.radius = d.radius || 0;
        reapply();
      });
    });
    panel.querySelectorAll('.gogh-boxsw .gogh-sw').forEach(function (swBtn) {
      swBtn.addEventListener('click', function () {
        e.boxBg = swBtn.dataset.col || null;
        reapply();
      });
    });
    // choosing an image completes the task — close instead of rebuilding
    function applyAndClose() {
      renderSection(sec);
      placeHandles(sec, i);
      pushState();
      closePanel();
    }
    var chBtn = panel.querySelector('.gogh-cardhref-apply');
    if (chBtn) chBtn.addEventListener('click', function () {
      var u = panel.querySelector('.gogh-cardhref').value.trim();
      if (u && !/^https?:\/\//i.test(u) && u[0] !== '/' && u[0] !== '#') u = 'https://' + u;
      e.href = u || null;
      renderSection(sec);
      placeHandles(sec, i);
      pushState();
      closePanel();
      toast(u ? 'The whole card links to ' + u : 'Card link removed.');
    });
    panel.querySelector('.gogh-boximg-apply').addEventListener('click', function () {
      var u = panel.querySelector('.gogh-boximg-url').value.trim();
      e.boxImg = u || null;
      if (!u) e.boxImgId = null;
      applyAndClose();
    });
    var bclear = panel.querySelector('.gogh-boximg-clear');
    if (bclear) bclear.addEventListener('click', function () {
      e.boxImg = null;
      e.boxImgId = null;
      reapply();
    });
    fetch(restQ(cfg.mediaUrl, 'per_page=12&media_type=image&orderby=date&order=desc'), {
      headers: { 'X-WP-Nonce': cfg.nonce }, credentials: 'same-origin',
    }).then(function (r2) { return r2.ok ? r2.json() : []; }).catch(function () { return []; })
      .then(function (items) {
        var mbox = panel.querySelector('.gogh-boximg-media');
        if (!mbox || panel.hidden) return;
        mbox.innerHTML = '';
        items.forEach(function (item) {
          var url = ((item.media_details || {}).sizes || {}).thumbnail;
          url = (url && url.source_url) || item.source_url;
          if (!url) return;
          var tb = document.createElement('button');
          tb.type = 'button';
          tb.className = 'gogh-thumb';
          tb.style.backgroundImage = 'url("' + url + '")';
          tb.title = (item.title && item.title.rendered) || '';
          tb.addEventListener('click', function () {
            e.boxImg = item.source_url;
            e.boxImgId = item.id;
            applyAndClose();
          });
          mbox.appendChild(tb);
        });
        reclampPanel();
      });
    var bfile = panel.querySelector('.gogh-upload input[type="file"]');
    if (bfile) bfile.addEventListener('change', function () {
      if (!bfile.files.length) return;
      var fd = new FormData();
      fd.append('file', bfile.files[0]);
      var blabel = panel.querySelector('.gogh-upload');
      blabel.firstChild.textContent = 'Uploading\u2026';
      fetch(cfg.mediaUrl, {
        method: 'POST',
        headers: { 'X-WP-Nonce': cfg.nonce },
        credentials: 'same-origin',
        body: fd,
      }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function (item) {
        e.boxImg = item.source_url;
        e.boxImgId = item.id;
        applyAndClose();
      }).catch(function (err) {
        blabel.firstChild.textContent = 'Upload failed';
        console.error('gogh upload failed:', err);
      });
    });
  }
  function setImage(sec, i, src, mediaId, alt) {
    var e = sec.els[i];
    e.src = src;
    e.mediaId = src ? (mediaId || null) : null;
    if (alt !== undefined) e.alt = alt || null;
    renderSection(sec);
    placeHandles(sec, i);
    closePanel();
    pushState();
  }
  function buildImagePanel(sec, i) {
    var e = sec.els[i];
    panel.innerHTML =
      '<div class="gogh-panel-title">Image</div>' +
      '<div class="gogh-panel-row">' +
      '<input type="url" class="gogh-input" placeholder="Paste image URL…" />' +
      '<button type="button" class="gogh-btn gogh-btn-small gogh-apply">Apply</button>' +
      '</div>' +
      '<div class="gogh-panel-row gogh-panel-actions">' +
      '<input type="text" class="gogh-input gogh-alt" placeholder="Alt text (describe the image)" />' +
      '</div>' +
      '<div class="gogh-panel-row gogh-panel-actions">' +
      (cfg.canUpload ? '<label class="gogh-btn gogh-btn-small gogh-upload">Upload<input type="file" accept="image/*" hidden /></label>' : '') +
      (e.src ? '<button type="button" class="gogh-btn gogh-btn-small gogh-clear">Remove image</button>' : '') +
      '</div>' +
      '<div class="gogh-media"><span class="gogh-media-loading">Loading media…</span></div>';
    var input = panel.querySelector('input[type="url"]');
    input.value = e.src || '';
    var altInput = panel.querySelector('.gogh-alt');
    altInput.value = e.alt || '';
    altInput.addEventListener('change', function () {
      e.alt = altInput.value.trim() || null;
      if (e.src) renderSection(sec);
      pushState();
    });
    panel.querySelector('.gogh-apply').addEventListener('click', function () {
      setImage(sec, i, input.value.trim() || null);
    });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') setImage(sec, i, input.value.trim() || null);
      if (ev.key === 'Escape') closePanel();
    });
    var clear = panel.querySelector('.gogh-clear');
    if (clear) clear.addEventListener('click', function () { setImage(sec, i, null); });
    var file = panel.querySelector('input[type="file"]');
    if (file) {
      file.addEventListener('change', function () {
        if (!file.files.length) return;
        var fd = new FormData();
        fd.append('file', file.files[0]);
        var label = panel.querySelector('.gogh-upload');
        label.firstChild.textContent = 'Uploading…';
        fetch(cfg.mediaUrl, {
          method: 'POST',
          headers: { 'X-WP-Nonce': cfg.nonce },
          credentials: 'same-origin',
          body: fd,
        }).then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        }).then(function (item) {
          setImage(sec, i, item.source_url, item.id, item.alt_text || null);
        }).catch(function (err) {
          label.firstChild.textContent = 'Upload failed';
          console.error('gogh upload failed:', err);
        });
      });
    }
    fetch(restQ(cfg.mediaUrl, 'per_page=12&media_type=image&orderby=date&order=desc'), {
      headers: { 'X-WP-Nonce': cfg.nonce },
      credentials: 'same-origin',
    }).then(function (res) { return res.ok ? res.json() : []; }).catch(function () { return []; })
      .then(function (items) {
        var box = panel.querySelector('.gogh-media');
        if (!box || panel.hidden) return;
        box.innerHTML = '';
        if (!items.length) {
          box.innerHTML = '<span class="gogh-media-loading">No images in the media library yet.</span>';
          reclampPanel();
          return;
        }
        items.forEach(function (item) {
          var thumb = (item.media_details && item.media_details.sizes &&
            (item.media_details.sizes.thumbnail || item.media_details.sizes.medium));
          var url = thumb ? thumb.source_url : item.source_url;
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'gogh-thumb';
          b.style.backgroundImage = 'url("' + url + '")';
          b.title = (item.title && item.title.rendered) || '';
          b.addEventListener('click', function () {
            setImage(sec, i, item.source_url, item.id, item.alt_text || null);
          });
          box.appendChild(b);
        });
        reclampPanel();
      });
  }
  ctxBtn.addEventListener('click', function () {
    if (sel) openPanel(sel.sec, sel.i);
  });
  fsBtn.addEventListener('click', function () {
    if (sel) stepFontSize(sel.sec, sel.i, 1);
  });
  function layerMove(dir) {
    if (!sel) return;
    var sec = sel.sec, i = sel.i, e = sec.els[i];
    // stacking only shows between things that overlap, so jump straight
    // past the nearest overlapping element — one click, visible result
    var hits = function (o) {
      return o.x < e.x + e.w && o.x + o.w > e.x && o.y < e.y + e.h && o.y + o.h > e.y;
    };
    var j = -1;
    if (dir > 0) {
      for (var k = i + 1; k < sec.els.length; k++) { if (hits(sec.els[k])) { j = k; break; } }
    } else {
      for (var k2 = i - 1; k2 >= 0; k2--) { if (hits(sec.els[k2])) { j = k2; break; } }
    }
    if (j === -1) {
      toast(dir > 0 ? 'Nothing overlaps this \u2014 it\u2019s already in front.' : 'Nothing overlaps this \u2014 it\u2019s already at the back.', { ttl: 2600 });
      return;
    }
    var t = sec.els.splice(i, 1)[0];
    sec.els.splice(j, 0, t);
    renderSection(sec);
    placeHandles(sec, j);
    pushState();
  }
  colBtn.addEventListener('click', function () {
    if (!sel) return;
    var sec = sel.sec, i = sel.i, e = sec.els[i];
    panel.innerHTML = '<div class="gogh-panel-title">Text colour</div>' +
      '<div class="gogh-swrow">' +
      '<button type="button" class="gogh-sw gogh-sw-none" data-col="" title="Theme default"></button>' +
      pickerPalette().map(function (p) {
        return '<button type="button" class="gogh-sw' + (e.color === p.slug ? ' is-active' : '') + '" data-col="' + p.slug + '"' +
          ' style="background: var(--wp--preset--color--' + p.slug + ')" title="' + p.slug + '"></button>';
      }).join('') + '</div>';
    markSwatchLegibility(panel.querySelector('.gogh-swrow'), effectiveBgHex(sec.nodes[i]));
    panel.querySelectorAll('.gogh-sw').forEach(function (swBtn) {
      swBtn.addEventListener('click', function () {
        e.color = swBtn.dataset.col || null;
        if (e.tf) delete e.tf.col;
        renderSection(sec);
        placeHandles(sec, i);
        closePanel();
        pushState();
      });
    });
    placePanelNear(sec.nodes[i]);
    panelOpen = true;
  });
  // preserve the text selection: a normal click would move focus/collapse it
  lnkBtn.addEventListener('pointerdown', function (ev) { ev.preventDefault(); });
  lnkBtn.addEventListener('click', function () {
    if (!sel) return;
    var t = editableTarget(sel.sec, sel.i);
    if (!t) return;
    if (!textEditing || textEditing.target !== t) enterTextEdit(sel.sec, sel.i);
    var selObj = window.getSelection();
    var inTarget = selObj.rangeCount &&
      t.contains(selObj.anchorNode) && !selObj.isCollapsed;
    if (!inTarget) {
      // no selection: link the whole element
      var r = document.createRange();
      r.selectNodeContents(t);
      selObj.removeAllRanges();
      selObj.addRange(r);
    }
    openTextLinkPanel();
  });
  alBtn.addEventListener('click', function () {
    if (!sel) return;
    var e = sel.sec.els[sel.i];
    e.align = e.align === 'center' ? 'right' : (e.align === 'right' ? null : 'center');
    resolveAndApply(sel.sec);
    placeHandles(sel.sec, sel.i);
    pushState();
  });
  elbar.querySelector('.gogh-eb-fwd').addEventListener('click', function () { layerMove(1); });
  elbar.querySelector('.gogh-eb-bck').addEventListener('click', function () { layerMove(-1); });
  elbar.querySelector('.gogh-eb-dup').addEventListener('click', function () {
    if (!sel) return;
    var sec = sel.sec;
    var copy = JSON.parse(JSON.stringify(sec.els[sel.i]));
    copy.x = Math.min(W - copy.w, copy.x + 24);
    copy.y = copy.y + 24;
    sec.els.push(copy);
    renderSection(sec);
    placeHandles(sec, sec.els.length - 1);
    pushState();
  });
  document.addEventListener('pointerdown', function (ev) {
    if (panelOpen && !panel.contains(ev.target) && !elbar.contains(ev.target)) closePanel();
    if (!editing) return;
    var t = ev.target;
    if (!t || !t.closest) return;
    var inUI = selBox.contains(t) || elbar.contains(t) || grip.contains(t) ||
      side.contains(t) || panel.contains(t) || picker.contains(t) ||
      t === inserter || t === hgrip || t === hbar;
    var inElement = t.closest('.gogh-section') && t.closest('.gogh-section > *');
    if (!inUI && !inElement) {
      sel = null;
      exitTextEdit();
      hideHandles();
      var selNode = document.querySelector('.gogh-selected');
      if (selNode) selNode.classList.remove('gogh-selected');
      if (document.activeElement && document.activeElement.isContentEditable) {
        document.activeElement.blur();
      }
    }
  });

  // ---------- add / delete elements ----------
  var stagger = 0;
  // shapes are boxes wearing geometry — pure CSS in the section stylesheet,
  // so they publish deactivation-safe like everything else
  var SHAPE_CSS = {
    circle: ' border-radius: 50%;',
    pill: ' border-radius: 999px;',
    arch: ' border-radius: 50% 50% 0 0 / 100% 100% 0 0;',
    tri: ' clip-path: polygon(50% 0%, 100% 100%, 0% 100%);',
    diamond: ' clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);',
    blob: ' border-radius: 42% 58% 63% 37% / 55% 42% 58% 45%;',
  };
  var SHAPE_DEFS = [
    // square/rounded have no SHAPE_CSS entry (radius covers them) but keep a
    // key so corner-resize knows to hold their proportions
    { key: 'square', label: 'Square', w: 320, h: 320, radius: 0 },
    { key: 'rounded', label: 'Rounded', w: 320, h: 320, radius: 28 },
    { key: 'circle', label: 'Circle', w: 320, h: 320 },
    { key: 'pill', label: 'Pill', w: 380, h: 130 },
    { key: 'arch', label: 'Arch', w: 320, h: 320 },
    { key: 'tri', label: 'Triangle', w: 340, h: 300 },
    { key: 'diamond', label: 'Diamond', w: 320, h: 320 },
    { key: 'blob', label: 'Blob', w: 340, h: 320 },
  ];
  var SHAPE_DEFAULT_BG = 'color-mix(in srgb, var(--wp--preset--color--contrast, #000) 12%, var(--wp--preset--color--base, transparent))';
  function shapePreviewCss(def) {
    var css = 'background: currentColor;';
    if (def.radius) css += 'border-radius: 18%;';
    if (def.key && SHAPE_CSS[def.key]) css += SHAPE_CSS[def.key];
    if (def.key === 'pill') css += 'height: 46%; align-self: center;';
    return css;
  }
  var DEFAULTS = {
    heading: function () { return { type: 'heading', x: 80, y: 80, w: 420, h: 60, text: 'A new heading', ghost: false, cool: false }; },
    para: function () { return { type: 'para', x: 80, y: 200, w: 380, h: 50, text: 'Some supporting copy. Drag me anywhere.', ghost: false, cool: false }; },
    button: function () { return { type: 'button', x: 80, y: 320, w: 170, h: 52, text: 'Click me', ghost: false, cool: false }; },
    image: function () { return { type: 'image', x: 520, y: 120, w: 360, h: 260, text: null, ghost: false, cool: true }; },
    badge: function () { return { type: 'badge', x: 520, y: 420, w: 220, h: 52, text: 'New badge', ghost: false, cool: false }; },
    card: function () {
      return { type: 'box', x: 360, y: 80, w: 480, h: 360, radius: 16,
        boxBg: 'color-mix(in srgb, var(--wp--preset--color--contrast, #000) 7%, var(--wp--preset--color--base, transparent))' };
    },
    posts: function () {
      // a real core query loop: WordPress renders it fresh on the published
      // page (and it keeps working with the plugin deactivated)
      var wsrc = '<!-- wp:query {"queryId":0,"query":{"perPage":3,"pages":0,"offset":0,"postType":"post","order":"desc","orderBy":"date","author":"","search":"","exclude":[],"sticky":"","inherit":false}} -->\n' +
        '<div class="wp-block-query">' +
        '<!-- wp:post-template {"layout":{"type":"grid","columnCount":3}} -->\n' +
        '<!-- wp:post-featured-image {"isLink":true,"aspectRatio":"4/3"} /-->\n' +
        '<!-- wp:post-title {"level":3,"isLink":true} /-->\n' +
        '<!-- wp:post-date /-->\n' +
        '<!-- /wp:post-template -->' +
        '</div>\n<!-- /wp:query -->';
      return { type: 'widget', x: 47, y: 60, w: 1106, h: 430, wsrc: wsrc,
        whtml: '<div class="gogh-postsprev gogh-postsprev-loading">Loading your latest posts\u2026</div>' };
    },
    products: function () {
      // WooCommerce's own grid via its shortcode block \u2014 Woo renders it
      // fresh on the published page (prices, add-to-cart, the lot), and it
      // keeps working with gogh deactivated
      var wsrc = '<!-- wp:shortcode -->[products limit="3" columns="3" orderby="date" order="DESC"]<!-- /wp:shortcode -->';
      return { type: 'widget', x: 47, y: 60, w: 1106, h: 470, wsrc: wsrc,
        whtml: '<div class="gogh-postsprev gogh-postsprev-loading">Loading your products\u2026</div>' };
    },
  };
  function postsPreviewHTML(posts) {
    return '<div class="gogh-postsprev">' + posts.map(function (p) {
      var media = p._embedded && p._embedded['wp:featuredmedia'] && p._embedded['wp:featuredmedia'][0];
      var sizes = media && media.media_details && media.media_details.sizes;
      var src = sizes && ((sizes.medium_large || sizes.large || sizes.full || {}).source_url) || (media && media.source_url) || null;
      var when = '';
      try { when = new Date(p.date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }); } catch (err) {}
      return '<div class="gogh-postsprev-card">' +
        (src ? '<img src="' + escAttr(src) + '" alt="" />' : '<div class="gogh-postsprev-ph"></div>') +
        '<h3>' + esc((p.title && p.title.rendered) || 'Untitled') + '</h3>' +
        '<div class="gogh-postsprev-date">' + when + '</div>' +
        '</div>';
    }).join('') + '</div>';
  }
  // a featured product is not an embed — it's a real gogh card composed of
  // real gogh elements (image, name, price badge, add-to-cart button), so
  // every piece drags like anything else and the card holds together on
  // mobile. The button's link is Woo's add-to-cart URL: one click, real cart.
  function storePriceText(p) {
    try {
      var pr = p.prices;
      return pr.currency_symbol + (parseInt(pr.price, 10) / Math.pow(10, pr.currency_minor_unit)).toFixed(pr.currency_minor_unit);
    } catch (err) { return ''; }
  }
  function composeFeaturedProduct(idx, p) {
    var card = {
      type: 'box', x: 150, y: 60, w: 900, h: 400, radius: 16,
      boxBg: 'color-mix(in srgb, var(--wp--preset--color--contrast, #000) 6%, var(--wp--preset--color--base, transparent))',
      kids: [
        { type: 'image', x: 30, y: 30, w: 340, h: 340, src: p.img || null },
        { type: 'heading', x: 420, y: 60, w: 440, h: 70, text: p.name || 'Product' },
        { type: 'badge', x: 420, y: 170, w: 170, h: 48, text: p.priceText || '' },
        { type: 'button', x: 420, y: 260, w: 250, h: 54, text: 'Add to cart', href: p.addUrl || p.permalink || null },
      ],
    };
    return addElementToSection(idx, card);
  }
  function openFeaturedProductPanel(idx) {
    panel.innerHTML = '<div class="gogh-panel-title">Feature a product</div>' +
      '<div class="gogh-panel-hint">Pick one — it becomes a card of ordinary gogh pieces, add-to-cart included.</div>' +
      '<div class="gogh-featlist"><span class="gogh-media-loading">Loading your products…</span></div>';
    placePanelNear(S[idx] ? S[idx].wrapEl : side);
    panelOpen = true;
    fetch(cfg.restUrl.split('wp/v2/')[0] + 'wc/store/v1/products?per_page=8&orderby=date&order=desc', {
      credentials: 'same-origin',
    }).then(function (r) { return r.ok ? r.json() : []; }).then(function (prods) {
      var box = panel.querySelector('.gogh-featlist');
      if (!box) return;
      if (!prods.length) {
        box.innerHTML = '<div class="gogh-panel-hint">No products yet — add one in WooCommerce first.</div>';
        return;
      }
      box.innerHTML = prods.map(function (p, k) {
        var img = p.images && p.images[0] && p.images[0].src;
        return '<button type="button" class="gogh-featrow" data-k="' + k + '">' +
          (img ? '<img src="' + escAttr(img) + '" alt="" />' : '<span class="gogh-postsprev-ph"></span>') +
          '<span class="gogh-featname">' + esc(p.name || 'Product') + '</span>' +
          '<span class="gogh-featprice">' + esc(storePriceText(p)) + '</span>' +
          '</button>';
      }).join('');
      [].forEach.call(box.querySelectorAll('.gogh-featrow'), function (row) {
        row.addEventListener('click', function () {
          var p = prods[+row.dataset.k];
          closePanel();
          composeFeaturedProduct(idx, {
            name: p.name,
            img: p.images && p.images[0] && p.images[0].src,
            priceText: storePriceText(p),
            permalink: p.permalink,
            addUrl: p.id ? '?add-to-cart=' + p.id : null,
          });
        });
      });
    }).catch(function () {});
  }
  // Products can aim at one category: same widget, shortcode narrowed, and
  // the ＋ flow asks "which products?" when the store has categories
  function productsElFor(cat) {
    var e = DEFAULTS.products();
    if (cat && cat.slug) {
      e.wsrc = '<!-- wp:shortcode -->[products limit="3" columns="3" category="' + cat.slug + '" orderby="date" order="DESC"]<!-- /wp:shortcode -->';
    }
    return e;
  }
  function openProductsPanel(idx) {
    fetch(cfg.restUrl.split('wp/v2/')[0] + 'wc/store/v1/products/categories?per_page=12', {
      credentials: 'same-origin',
    }).then(function (r) { return r.ok ? r.json() : []; }).then(function (cats) {
      cats = (cats || []).filter(function (c) { return c.count > 0; });
      if (!cats.length) {
        var e0 = addElementToSection(idx, productsElFor(null));
        hydrateProductsPreview(S[idx], e0);
        return;
      }
      panel.innerHTML = '<div class="gogh-panel-title">Products</div>' +
        '<div class="gogh-panel-hint">Which products should the grid show?</div>' +
        '<div class="gogh-featlist">' +
        '<button type="button" class="gogh-featrow" data-all="1"><span class="gogh-featname">All products</span></button>' +
        cats.map(function (c, k) {
          return '<button type="button" class="gogh-featrow" data-k="' + k + '">' +
            '<span class="gogh-featname">' + esc(c.name) + '</span>' +
            '<span class="gogh-featprice">' + c.count + '</span></button>';
        }).join('') + '</div>';
      placePanelNear(S[idx] ? S[idx].wrapEl : side);
      panelOpen = true;
      [].forEach.call(panel.querySelectorAll('.gogh-featrow'), function (row) {
        row.addEventListener('click', function () {
          var cat = row.dataset.all ? null : cats[+row.dataset.k];
          closePanel();
          var e2 = addElementToSection(idx, productsElFor(cat));
          hydrateProductsPreview(S[idx], e2, cat && cat.id);
        });
      });
    }).catch(function () {
      var e3 = addElementToSection(idx, productsElFor(null));
      hydrateProductsPreview(S[idx], e3);
    });
  }
  function hydrateProductsPreview(sec, e, catId) {
    // the Store API is public — same shape as the posts preview, plus price
    fetch(cfg.restUrl.split('wp/v2/')[0] + 'wc/store/v1/products?per_page=3&orderby=date&order=desc' + (catId ? '&category=' + catId : ''), {
      credentials: 'same-origin',
    }).then(function (r) { return r.ok ? r.json() : []; }).then(function (prods) {
      if (!prods.length || sec.els.indexOf(e) === -1) return;
      e.whtml = '<div class="gogh-postsprev">' + prods.map(function (p) {
        var img = p.images && p.images[0] && p.images[0].src;
        var price = '';
        try {
          var pr = p.prices;
          price = pr.currency_symbol + (parseInt(pr.price, 10) / Math.pow(10, pr.currency_minor_unit)).toFixed(pr.currency_minor_unit);
        } catch (err) {}
        return '<div class="gogh-postsprev-card">' +
          (img ? '<img src="' + escAttr(img) + '" alt="" />' : '<div class="gogh-postsprev-ph"></div>') +
          '<h3>' + esc(p.name || 'Product') + '</h3>' +
          '<div class="gogh-postsprev-date">' + esc(price) + '</div>' +
          '<span class="gogh-postsprev-btn">Add to cart</span>' +
          '</div>';
      }).join('') + '</div>';
      renderSection(sec);
      if (sel && sel.sec === sec) placeHandles(sec, sec.els.indexOf(e));
    }).catch(function () {});
  }
  function hydratePostsPreview(sec, e) {
    fetch(cfg.restUrl.split('wp/v2/')[0] + 'wp/v2/posts?per_page=3&_embed=wp:featuredmedia&status=publish', {
      headers: { 'X-WP-Nonce': cfg.nonce },
      credentials: 'same-origin',
    }).then(function (r) { return r.ok ? r.json() : []; }).then(function (posts) {
      if (!posts.length || sec.els.indexOf(e) === -1) return;
      e.whtml = postsPreviewHTML(posts);
      renderSection(sec);
      if (sel && sel.sec === sec) placeHandles(sec, sec.els.indexOf(e));
    }).catch(function () {});
  }
  // ---------- contrast sentinel: unreadable text fixes itself ----------
  // dark words on a dark background should be IMPOSSIBLE: when text lands on
  // a section (or a section's background changes), gogh measures the
  // effective contrast and quietly flips the text to the theme colour that
  // reads — a toast with Undo keeps the human in charge. Auto-fix with an
  // exit, never a warning: warnings are homework.
  function sentinelLum(rgb) {
    var a = rgb.map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }
  function sentinelContrast(l1, l2) {
    var hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }
  function cssToRgb(css) {
    if (!css) return null;
    var d = document.createElement('div');
    d.style.color = css;
    d.style.display = 'none';
    document.body.appendChild(d);
    var m = getComputedStyle(d).color.match(/[\d.]+/g);
    d.remove();
    return m && m.length >= 3 ? m.slice(0, 3).map(Number) : null;
  }
  // sample the image UNDER a text element, not the whole picture: a sky
  // that is pale up top and dark in the bushes averages to "fine" while
  // the words drown in the bushes (James's wheatfield). done(sampler) —
  // sampler(nx, ny, nw, nh) averages a normalised region; null on taint.
  function imgRegionLum(src, aspect, done) {
    var im = new Image();
    im.crossOrigin = 'anonymous';
    var CW = 48, CH = Math.max(12, Math.round(48 * Math.max(0.1, Math.min(4, aspect || 0.5))));
    im.onload = function () {
      try {
        var c = document.createElement('canvas');
        c.width = CW; c.height = CH;
        var ctx = c.getContext('2d');
        var sc = Math.max(CW / im.width, CH / im.height); // cover, centre-crop
        ctx.drawImage(im, (CW - im.width * sc) / 2, (CH - im.height * sc) / 2, im.width * sc, im.height * sc);
        var data = ctx.getImageData(0, 0, CW, CH).data;
        done(function (nx, ny, nw, nh) {
          var x0 = Math.max(0, Math.floor(nx * CW)), y0 = Math.max(0, Math.floor(ny * CH));
          var x1 = Math.min(CW, Math.ceil((nx + nw) * CW)), y1 = Math.min(CH, Math.ceil((ny + nh) * CH));
          if (x1 <= x0 || y1 <= y0) return null;
          var sum = 0, n = 0;
          for (var y = y0; y < y1; y++) {
            for (var x = x0; x < x1; x++) {
              var k = (y * CW + x) * 4;
              sum += sentinelLum([data[k], data[k + 1], data[k + 2]]);
              n++;
            }
          }
          return n ? sum / n : null;
        });
      } catch (err) { done(null); } // tainted canvas: tint-only judgement
    };
    im.onerror = function () { done(null); };
    im.src = src;
  }
  function imgAvgLum(src, done) {
    var im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = function () {
      try {
        var c = document.createElement('canvas');
        c.width = c.height = 16;
        var x = c.getContext('2d');
        x.drawImage(im, 0, 0, 16, 16);
        var d = x.getImageData(0, 0, 16, 16).data;
        var r = 0, g = 0, b = 0, n = d.length / 4;
        for (var i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
        done(sentinelLum([r / n, g / n, b / n]));
      } catch (err) { done(null); } // cross-origin taint: tint-only fallback
    };
    im.onerror = function () { done(null); };
    im.src = src;
  }
  // WCAG large-text wants 3.0 and body wants 4.5; 3.2 splits the
  // difference — 2.6 let olive-on-near-black (2.76) pass as "readable"
  var CONTRAST_FLOOR = 3.2;
  function contrastSentinel(sec, onlyIdx) {
    if (!editing || sec.chrome) return;
    var tint = sec.bg ? cssToRgb(sec.bg) : null;
    var secHpx = sec.sectionEl.offsetHeight || 1;
    var secWpx = sec.sectionEl.offsetWidth || 1;
    var judge = function (sampler) {
      var mixA = (sec.bgA != null ? sec.bgA : 62) / 100; // the dial, or the old default
      // the ground under ONE element: local image luminance when there is a
      // picture (a pale sky averages away the dark bushes the words sit in)
      var secHunits = secHpx / (secWpx / W); // section height in design units
      var groundFor = function (e) {
        var imgL = null;
        if (sampler) {
          imgL = sampler(e.x / W, e.y / secHunits, e.w / W, e.h / secHunits);
        }
        if (tint && imgL != null) return sentinelLum(tint) * mixA + imgL * (1 - mixA); // the published tint mix
        if (tint && sec.bgA != null && sec.bgA < 100) {
          var underRgb = cssToRgb('var(--wp--preset--color--base, #fff)');
          return sentinelLum(tint) * (sec.bgA / 100) + (underRgb ? sentinelLum(underRgb) : 1) * (1 - sec.bgA / 100);
        }
        if (tint) return sentinelLum(tint);
        if (imgL != null) {
          // no user tint: the auto-scrim (45% theme base) sits behind texty sections
          var baseRgb = cssToRgb('var(--wp--preset--color--base, #fff)');
          return imgL * 0.55 + (baseRgb ? sentinelLum(baseRgb) : 1) * 0.45;
        }
        var secRgb = cssToRgb(getComputedStyle(sec.sectionEl).backgroundColor);
        if (!secRgb || getComputedStyle(sec.sectionEl).backgroundColor === 'rgba(0, 0, 0, 0)') {
          secRgb = cssToRgb('var(--wp--preset--color--base, #fff)');
        }
        return secRgb ? sentinelLum(secRgb) : 1;
      };
      var candidates = themePalette().filter(function (p) {
        return /^(base|contrast)(-|$)/.test(p.slug);
      });
      var flips = [];
      sec.els.forEach(function (e, i) {
        if (onlyIdx != null && i !== onlyIdx) return;
        if (!isText(e)) return;
        var node = sec.nodes[i];
        if (!node) return;
        var host = node.matches('p,h1,h2,h3,h4,h5,h6') ? node : (node.querySelector('p,h1,h2,h3,h4,h5,h6') || node);
        var txt = cssToRgb(getComputedStyle(host).color);
        if (!txt) return;
        var bgL = groundFor(e);
        var curC = sentinelContrast(sentinelLum(txt), bgL);
        if (curC >= CONTRAST_FLOOR) return;
        var best = null, bestC = 0;
        candidates.forEach(function (p) {
          var rgb = cssToRgb(p.value);
          if (!rgb) return;
          var c = sentinelContrast(sentinelLum(rgb), bgL);
          if (c > bestC) { bestC = c; best = p.slug; }
        });
        // mid-tone grounds can defeat every preset — flip anyway when the
        // best ink is a real improvement (15%+), not only when it's perfect;
        // leaving the worst ink because no ink is ideal helps nobody
        if (best && e.color !== best && (bestC >= CONTRAST_FLOOR || bestC >= curC * 1.15)) {
          flips.push({ i: i, to: best });
        }
      });
      if (!flips.length) return;
      pushState();
      flips.forEach(function (f) { sec.els[f.i].color = f.to; });
      renderSection(sec);
      toast(flips.length === 1 ? 'Made the words readable on that background.'
        : 'Made ' + flips.length + ' text pieces readable on that background.',
        { actions: [{ label: 'Undo', onClick: function () { undo(); } }] });
    };
    if (sec.bgImage) imgRegionLum(sec.bgImage, secHpx / secWpx, judge); else judge(null);
  }
  function addElement(sec, e, atBack) {
    // shapes are backdrops: they join the stack BEHIND everything else
    if (atBack) sec.els.unshift(e); else sec.els.push(e);
    renderSection(sec);
    placeHandles(sec, atBack ? 0 : sec.els.length - 1);
    pushState();
    contrastSentinel(sec, atBack ? 0 : sec.els.length - 1);
  }
  function deleteSelected() {
    if (multiSel) {
      var msec = multiSel.sec;
      var idxs = multiSel.idxs.slice().sort(function (a, b) { return b - a; });
      clearMulti();
      idxs.forEach(function (j) { msec.els.splice(j, 1); });
      sel = null;
      hideHandles();
      closePanel();
      renderSection(msec);
      pushState();
      return;
    }
    if (!sel) return;
    var sec = sel.sec;
    sec.els.splice(sel.i, 1);
    sel = null;
    hideHandles();
    closePanel();
    renderSection(sec);
    pushState();
  }
  // the section most visible in the current viewport
  function viewportSection() {
    var best = null, bestPx = 0;
    S.forEach(function (sec) {
      if (sec.chrome) return; // never auto-target the site header/footer
      var r = sec.wrapEl.getBoundingClientRect();
      var vis = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
      if (vis > bestPx) { bestPx = vis; best = sec; }
    });
    return best || S[S.length - 1];
  }
  function sectionVisible(sec) {
    var r = sec.wrapEl.getBoundingClientRect();
    return r.bottom > 60 && r.top < window.innerHeight - 60;
  }
  function placeElAtViewport(e, atBack) {
    // land in what the user is looking at: the selected section if it's on
    // screen, else the most visible one — centred in the viewport
    var sec = (sel && sectionVisible(sel.sec)) ? sel.sec : viewportSection();
    var r = sec.sectionEl.getBoundingClientRect();
    var s = r.width / W;
    var cy = (window.innerHeight / 2 - r.top) / s - e.h / 2;
    var H = designH(sec.els, sec.minH);
    e.x = Math.round((W - e.w) / 2 + (stagger % 5) * 24 - 48);
    e.y = Math.round(Math.max(8, Math.min(H - e.h - 8, cy)) + (stagger % 5) * 24 - 48);
    e.x = Math.max(0, Math.min(W - e.w, e.x));
    e.y = Math.max(8, e.y);
    stagger++;
    addElement(sec, e, atBack);
    return e;
  }
  function addElementAtViewport(kind) {
    if (kind === 'exp') return addExperience();
    if (kind === 'write') return startWriting();
    var e = placeElAtViewport(DEFAULTS[kind]());
    if (kind === 'posts') hydratePostsPreview(sel.sec, e);
    if (kind === 'products') hydrateProductsPreview(sel.sec, e);
    return e;
  }
  function addElementToSection(idx, kind) {
    var secx = S[idx];
    // kind may be a DEFAULTS key or a ready-made element object — keep the
    // KEY for hydration: posts/products are 'widget' type in the model
    var kindKey = typeof kind === 'string' ? kind : null;
    var e = kindKey ? DEFAULTS[kindKey]() : kind;
    var H = designH(secx.els, secx.minH);
    e.x = Math.max(0, Math.min(W - e.w, Math.round((W - e.w) / 2 + (stagger % 5) * 24 - 48)));
    e.y = Math.max(8, Math.round(Math.min(Math.max(8, (H - e.h) / 2), Math.max(8, H - e.h - 8)) + (stagger % 5) * 24 - 48));
    stagger++;
    addElement(secx, e);
    if (kindKey === 'posts') hydratePostsPreview(secx, e);
    if (kindKey === 'products') hydrateProductsPreview(secx, e);
    return e;
  }
  function openSecAddPanel(idx) {
    var secx = S[idx];
    panel.innerHTML = '<div class="gogh-panel-title">Add to this section</div>' +
      '<div class="gogh-addmenu">' + ELEM_ITEMS + '</div>';
    placePanelNear(secx.wrapEl);
    panel.querySelectorAll('.gogh-sitem').forEach(function (btn) {
      btn.addEventListener('click', function () {
        closePanel();
        if (btn.dataset.act === 'shapes') return openShapeInsertPanel();
        if (btn.dataset.act === 'featured') return openFeaturedProductPanel(idx);
        if (btn.dataset.add === 'products') return openProductsPanel(idx);
        if (btn.dataset.add === 'write') return startWriting(idx);
        if (btn.dataset.add === 'exp') return addExperience(idx);
        addElementToSection(idx, btn.dataset.add);
      });
    });
  }
  function addExperience(targetIdx) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.html,text/html';
    input.addEventListener('change', function () {
      if (!input.files.length) return;
      var fd = new FormData();
      fd.append('file', input.files[0]);
      toast('Uploading experience\u2026');
      fetch(cfg.mediaUrl, {
        method: 'POST',
        headers: { 'X-WP-Nonce': cfg.nonce },
        credentials: 'same-origin',
        body: fd,
      }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function (item) {
        var expEl = { type: 'exp', x: 0, y: 0, w: 760, h: 480, expId: item.id, expUrl: item.source_url };
        if (typeof targetIdx === 'number' && S[targetIdx]) addElementToSection(targetIdx, expEl);
        else placeElAtViewport(expEl);
        toast('Experience added \u2014 it runs sandboxed; visitors can interact once published.', { ttl: 6000 });
      }).catch(function (err) {
        toast('Upload failed \u2014 .html uploads need admin rights.', { ttl: 6000 });
        console.error('gogh experience upload failed:', err);
      });
    });
    input.click();
  }
  function addShapeAtViewport(def) {
    return placeElAtViewport({
      type: 'box',
      x: 0, y: 0, w: def.w, h: def.h,
      shape: def.key || null,
      radius: def.radius || 0,
      boxBg: SHAPE_DEFAULT_BG,
    }, true);
  }
  function openShapeInsertPanel() {
    panel.innerHTML =
      '<div class="gogh-panel-head"><span class="gogh-panel-title">Add a shape</span>' +
      '<button type="button" class="gogh-sbtn gogh-panel-close" title="Close">✕</button></div>' +
      '<div class="gogh-panel-hint">A backdrop for other elements — send it backward once it\'s placed.</div>' +
      '<div class="gogh-shapegrid">' +
      SHAPE_DEFS.map(function (d, k) {
        return '<button type="button" class="gogh-shapecell" data-k="' + k + '" title="' + d.label + '">' +
          '<span style="' + shapePreviewCss(d) + '"></span></button>';
      }).join('') +
      '</div>';
    placePanelNear(secBarIdx !== null && S[secBarIdx] ? S[secBarIdx].wrapEl : side);
    panelOpen = true;
    panel.querySelector('.gogh-panel-close').addEventListener('click', closePanel);
    [].forEach.call(panel.querySelectorAll('.gogh-shapecell'), function (b) {
      b.addEventListener('click', function () {
        closePanel();
        addShapeAtViewport(SHAPE_DEFS[+b.dataset.k]);
      });
    });
  }
  side.querySelector('.gogh-sd-designs').addEventListener('click', openStarterPicker);
  // turning φ on should SHOW you what you enabled: flash the golden-section
  // lines over the section you're looking at
  function flashCompLines(sec2) {
    if (!sec2 || !sec2.sectionEl) return;
    var ov = document.createElement('div');
    ov.className = 'gogh-compflash';
    [0.382, 0.618].forEach(function (f) {
      var v = document.createElement('i');
      v.className = 'is-phi';
      v.style.cssText = 'left:' + (f * 100) + '%;top:0;width:0;height:100%;';
      ov.appendChild(v);
      var h = document.createElement('i');
      h.className = 'is-phi';
      h.style.cssText = 'top:' + (f * 100) + '%;left:0;height:0;width:100%;';
      ov.appendChild(h);
    });
    sec2.sectionEl.appendChild(ov);
    setTimeout(function () { ov.remove(); }, 2400);
  }
  var phiToggle = side.querySelector('[data-act="compguides"]');
  if (phiToggle) phiToggle.addEventListener('click', function () {
    compGuidesOn = !compGuidesOn;
    var pb = side.querySelector('.gogh-phibtn');
    pb.classList.toggle('is-active', compGuidesOn);
    pb.dataset.tip = 'Golden ratio guides: ' + (compGuidesOn ? 'on' : 'off');
    pb.removeAttribute('title');
    if (compGuidesOn) {
      flashCompLines(viewportSection());
      toast('Golden ratio guides on — the gold lines mark the golden section. Drag anything near one and it’ll catch.', { ttl: 6000 });
    } else {
      toast('Golden ratio guides off.');
    }
  });
  elbar.querySelector('.gogh-eb-del').addEventListener('click', deleteSelected);
  side.querySelector('[data-act="gridsnap"]').addEventListener('click', function () {
    gridSnapOn = !gridSnapOn;
    // the grid you snap to is the grid you see — never invisible magnets
    document.documentElement.classList.toggle('gogh-grid-on', gridSnapOn);
    var gb = side.querySelector('.gogh-gridbtn');
    gb.classList.toggle('is-active', gridSnapOn);
    gb.dataset.tip = 'Grid: ' + (gridSnapOn ? 'on' : 'off');
    gb.removeAttribute('title');
  });
  side.querySelector('.gogh-undo').addEventListener('click', undo);
  side.querySelector('.gogh-redo').addEventListener('click', redo);
  // the help bot lives in a small sheet — created on first ask, and it
  // learns the exact build from the script's own cache-buster
  var helpSheet = null;
  // help that knows where you're standing: the sheet passes the build AND
  // a context hint (what's selected, which mode is live) so the bot can
  // open on the questions this exact moment tends to raise
  function helpContext() {
    if (document.body.classList.contains('gogh-cycling')) return 'chrome-cycle';
    if (sel && sel.sec && sel.sec.els[sel.i]) return 'el-' + sel.sec.els[sel.i].type;
    if (panelOpen) return 'panel';
    return 'canvas';
  }
  function helpSrc() {
    var hu = String(cfg.helpUrl);
    return hu + (hu.indexOf('?') === -1 ? '?' : '&') +
      'v=' + encodeURIComponent((window.__gogh && window.__gogh.build) || '') +
      '&ctx=' + encodeURIComponent(helpContext()) +
      (cfg.experiments ? '&bridge=1' : '');
  }
  // ---------- the show-me bridge: help that DOES ----------
  // With experiments on, the bot may drive the editor through the same
  // WebMCP verbs a browser agent gets — messages are honoured only from
  // the helper's own origin, publishing stays human, and every action
  // lands as a toast with Undo. Documentation becomes demonstration.
  if (cfg.experiments && cfg.helpUrl) {
    var HELP_ORIGIN = (function () {
      try { return new URL(cfg.helpUrl).origin; } catch (err) { return null; }
    })();
    window.addEventListener('message', function (ev) {
      if (!HELP_ORIGIN || ev.origin !== HELP_ORIGIN) return;
      var m = ev.data;
      if (!m || m.gogh !== 'act' || typeof m.verb !== 'string') return;
      var reply = function (payload) {
        try {
          ev.source.postMessage(Object.assign({ gogh: 'act-result', id: m.id || null }, payload), HELP_ORIGIN);
        } catch (err) {}
      };
      var mcp = window.__goghMcp;
      if (!mcp) { reply({ ok: false, error: 'bridge not loaded' }); return; }
      if (m.verb === 'gogh_publish') { reply({ ok: false, error: 'publishing stays human' }); return; }
      Promise.resolve().then(function () { return mcp.call(m.verb, m.args || {}); })
        .then(function (res) {
          toast('gogh helper: ' + m.verb.replace(/^gogh_/, '').replace(/_/g, ' '),
            { actions: [{ label: 'Undo', onClick: function () { undo(); } }] });
          reply({ ok: true, result: res });
        })
        .catch(function (err) { reply({ ok: false, error: String((err && err.message) || err) }); });
    });
  }
  var helpBtn = side.querySelector('.gogh-help');
  if (helpBtn) helpBtn.addEventListener('click', function () {
    if (!helpSheet) {
      helpSheet = document.createElement('div');
      helpSheet.className = 'gogh-helpsheet';
      helpSheet.innerHTML = '<div class="gogh-helpsheet-bar"><span>gogh help</span>' +
        '<button type="button" class="gogh-sbtn gogh-helpsheet-x" title="Close">✕</button></div>' +
        '<iframe src="' + escAttr(helpSrc()) + '" title="gogh help"></iframe>';
      document.body.appendChild(helpSheet);
      helpSheet.querySelector('.gogh-helpsheet-x').addEventListener('click', function () {
        helpSheet.classList.remove('is-open');
        document.body.classList.remove('gogh-help-open');
      });
    } else if (!helpSheet.classList.contains('is-open')) {
      // reopening in a NEW situation refreshes the bot's context; the same
      // situation keeps the conversation exactly where it was
      var fresh = helpSrc();
      var fr = helpSheet.querySelector('iframe');
      if (fr.getAttribute('src') !== fresh) fr.setAttribute('src', fresh);
    }
    helpSheet.classList.toggle('is-open');
    // toasts share the bot's corner — while the sheet is open they step
    // aside so nothing ever sits on the ask box
    document.body.classList.toggle('gogh-help-open', helpSheet.classList.contains('is-open'));
    closeSide(true);
  });

  // ---------- section templates & picker ----------
  var TEMPLATES = [
    // fs '__max' resolves to the theme's largest font-size preset at insert
    { retired: true, name: 'Hero', minH: 640,
      bg: 'color-mix(in srgb, var(--wp--preset--color--contrast, currentColor) 5%, var(--wp--preset--color--base, transparent))',
      els: [
      { type: 'badge', x: 72, y: 88, w: 230, h: 52, text: 'Fresh off the canvas' },
      { type: 'heading', x: 72, y: 172, w: 640, h: 170, text: 'Make something people remember', fs: '__max' },
      { type: 'para', x: 72, y: 380, w: 500, h: 80, text: 'Supporting copy that explains the promise in a sentence or two. Drag anything anywhere — gogh keeps it responsive.' },
      { type: 'button', x: 72, y: 496, w: 190, h: 56, text: 'Get started' },
      { type: 'button', x: 282, y: 496, w: 190, h: 56, text: 'See how it works', ghost: true },
      { type: 'image', x: 756, y: 110, w: 372, h: 430 },
      { type: 'badge', x: 690, y: 486, w: 240, h: 56, text: 'Loved by builders' },
    ]},
    { retired: true, name: 'Hero — centered', minH: 600,
      bg: 'color-mix(in srgb, var(--wp--preset--color--contrast, currentColor) 5%, var(--wp--preset--color--base, transparent))',
      els: [
      { type: 'badge', x: 500, y: 92, w: 200, h: 52, text: 'New for 2026' },
      { type: 'heading', x: 200, y: 176, w: 800, h: 160, text: 'Big ideas, front and centre', fs: '__max', align: 'center' },
      { type: 'para', x: 320, y: 372, w: 560, h: 60, text: 'One clear promise, a little supporting warmth, and nothing in the way.', align: 'center' },
      { type: 'button', x: 400, y: 470, w: 190, h: 56, text: 'Start free' },
      { type: 'button', x: 610, y: 470, w: 190, h: 56, text: 'Take the tour', ghost: true },
    ]},
    { retired: true, name: 'Split', els: [
      { type: 'image', x: 72, y: 72, w: 500, h: 400, cool: true },
      { type: 'heading', x: 644, y: 120, w: 480, h: 100, text: 'Show the thing, then say the thing' },
      { type: 'para', x: 644, y: 264, w: 440, h: 78, text: 'A classic split layout: image on one side, message on the other. Swap sides by dragging.' },
      { type: 'button', x: 644, y: 380, w: 190, h: 52, text: 'See details' },
    ]},
    { retired: true, name: 'Features', els: [
      { type: 'heading', x: 300, y: 72, w: 600, h: 60, text: 'Three reasons to care' },
      { type: 'image', x: 72, y: 190, w: 328, h: 180 },
      { type: 'image', x: 436, y: 190, w: 328, h: 180, cool: true },
      { type: 'image', x: 800, y: 190, w: 328, h: 180 },
      { type: 'para', x: 72, y: 396, w: 328, h: 60, text: 'First feature, briefly and confidently described.' },
      { type: 'para', x: 436, y: 396, w: 328, h: 60, text: 'Second feature, briefly and confidently described.' },
      { type: 'para', x: 800, y: 396, w: 328, h: 60, text: 'Third feature, briefly and confidently described.' },
    ]},
    { retired: true, name: 'Call to action',
      bg: 'color-mix(in srgb, var(--wp--preset--color--contrast, currentColor) 8%, var(--wp--preset--color--base, transparent))',
      els: [
      { type: 'heading', x: 300, y: 120, w: 600, h: 60, text: 'Ready when you are', align: 'center' },
      { type: 'para', x: 350, y: 220, w: 500, h: 55, text: 'One last nudge. Keep it short, keep it warm.', align: 'center' },
      { type: 'button', x: 511, y: 330, w: 178, h: 52, text: 'Start now' },
    ]},
    { name: 'Start from scratch', minH: 480, els: [] },
    // ---- starters: born freeform, theme-adaptive, art-directed ----
    // one coherent world (a small design studio) so the previews read as a
    // real site, not lorem; eyebrows are paras wearing tf, ink sections are
    // theme-contrast backgrounds so every style variation re-dresses them
    { starter: true, intent: 'introduce', name: 'Hero', minH: 640, els: [
      { type: 'box', x: 640, y: 150, w: 500, h: 430, boxBg: 'color-mix(in srgb, var(--wp--preset--color--contrast, #000) 8%, var(--wp--preset--color--base, transparent))', radius: 26 },
      { type: 'image', x: 600, y: 110, w: 500, h: 430, cool: true },
      { type: 'badge', x: 560, y: 486, w: 196, h: 50, text: '\u2605 Est. 2019', rot: -2 },
      { type: 'para', x: 72, y: 118, w: 340, h: 24, text: 'Design studio \u00b7 Brighton',
        tf: { fs: 13, fw: 600, ls2: 0.22, tt: 'uppercase', col: 'color-mix(in srgb, var(--wp--preset--color--contrast, currentColor) 62%, transparent)' } },
      { type: 'heading', x: 72, y: 162, w: 470, h: 200, text: 'We make brands people remember', fs: '__max' },
      { type: 'para', x: 72, y: 396, w: 410, h: 72, text: 'Strategy, identity and websites for founders who care how things feel. Everything on this page is draggable \u2014 start here and make it yours.' },
      { type: 'button', x: 72, y: 502, w: 180, h: 54, text: 'See the work' },
      { type: 'button', x: 272, y: 502, w: 180, h: 54, text: 'Start a project', ghost: true },
    ] },
    { starter: true, intent: 'introduce', name: 'Big statement', minH: 520, els: [
      { type: 'para', x: 400, y: 92, w: 400, h: 24, align: 'center', text: 'What we believe',
        tf: { fs: 13, fw: 600, ls2: 0.22, tt: 'uppercase', col: 'color-mix(in srgb, var(--wp--preset--color--contrast, currentColor) 62%, transparent)' } },
      { type: 'heading', x: 60, y: 150, w: 1080, h: 240, text: 'Good design is good business', fs: '__disp-l', align: 'center' },
      { type: 'button', x: 516, y: 428, w: 168, h: 52, text: 'Our thinking', ghost: true },
    ] },
    { starter: true, intent: 'introduce', name: 'Story', minH: 600, els: [
      { type: 'image', x: 72, y: 84, w: 470, h: 452, cool: true },
      { type: 'badge', x: 44, y: 58, w: 122, h: 48, text: 'N\u00ba 01', rot: -2 },
      { type: 'para', x: 620, y: 122, w: 300, h: 24, text: 'Our story',
        tf: { fs: 13, fw: 600, ls2: 0.22, tt: 'uppercase', col: 'color-mix(in srgb, var(--wp--preset--color--contrast, currentColor) 62%, transparent)' } },
      { type: 'heading', x: 620, y: 162, w: 480, h: 120, text: 'It started in a spare room', fs: 'x-large' },
      { type: 'para', x: 620, y: 306, w: 460, h: 84, text: 'Two desks, one borrowed lamp, and a first client who paid in coffee. We said yes to everything and learned what we were good at.' },
      { type: 'para', x: 620, y: 406, w: 460, h: 84, text: 'Six years on we are eleven people, still small on purpose, and still excited on Mondays.' },
      { type: 'button', x: 620, y: 512, w: 220, h: 52, text: 'The whole story', ghost: true },
    ] },
    { starter: true, intent: 'introduce', name: 'Numbers', minH: 420, els: [
      { type: 'para', x: 72, y: 76, w: 300, h: 24, text: 'By the numbers',
        tf: { fs: 13, fw: 600, ls2: 0.22, tt: 'uppercase', col: 'color-mix(in srgb, var(--wp--preset--color--contrast, currentColor) 62%, transparent)' } },
      { type: 'heading', x: 72, y: 140, w: 330, h: 120, text: '184', fs: '__disp-m' },
      { type: 'para', x: 76, y: 276, w: 290, h: 44, text: 'Projects shipped since 2019' },
      { type: 'heading', x: 435, y: 140, w: 330, h: 120, text: '12', fs: '__disp-m' },
      { type: 'para', x: 439, y: 276, w: 290, h: 44, text: 'Design awards on two shelves' },
      { type: 'heading', x: 798, y: 140, w: 330, h: 120, text: '98%', fs: '__disp-m' },
      { type: 'para', x: 802, y: 276, w: 290, h: 44, text: 'Clients who came back for more' },
    ] },
    { starter: true, intent: 'introduce', name: 'Article', minH: 620, els: [
      { type: 'para', x: 280, y: 58, w: 300, h: 24, text: 'From the journal',
        tf: { fs: 13, fw: 600, ls2: 0.22, tt: 'uppercase', col: 'color-mix(in srgb, var(--wp--preset--color--contrast, currentColor) 62%, transparent)' } },
      { type: 'heading', x: 280, y: 98, w: 640, h: 70, text: 'Notes on doing less, better', fs: 'x-large' },
      { type: 'para', x: 280, y: 196, w: 640, h: 66, text: 'A comfortable reading column, the width your theme uses for posts. Gogh is not only for splashy pages \u2014 it is a pleasant place to just write.' },
      { type: 'para', x: 280, y: 286, w: 640, h: 66, text: 'Add paragraphs, pull a quote out to the side when you need one, and drop an image between thoughts. Everything still publishes as clean WordPress blocks.' },
      { type: 'para', x: 280, y: 376, w: 640, h: 66, text: 'And the moment an article needs something bolder \u2014 a full-width image, a card, a big number \u2014 you can simply place it.' },
      { type: 'button', x: 280, y: 482, w: 200, h: 54, text: 'Keep reading', ghost: true },
    ] },
    { starter: true, intent: 'sell', name: 'Feature cards', minH: 560, els: [
      { type: 'heading', x: 100, y: 56, w: 1000, h: 60, text: 'What we do', fs: 'x-large', align: 'center' },
      { type: 'box', x: 100, y: 170, w: 320, h: 330, radius: 18,
        boxBg: 'color-mix(in srgb, var(--wp--preset--color--contrast, #000) 7%, var(--wp--preset--color--base, transparent))',
        kids: [
          { type: 'badge', x: 28, y: 28, w: 96, h: 44, text: '01' },
          { type: 'heading', x: 28, y: 96, w: 264, h: 44, text: 'Brand identity', fs: 'large' },
          { type: 'para', x: 28, y: 152, w: 264, h: 100, text: 'A name, a voice and a look that hold together everywhere \u2014 from the sign above the door to the invoice footer.' },
        ] },
      { type: 'box', x: 440, y: 170, w: 320, h: 330, radius: 18,
        boxBg: 'color-mix(in srgb, var(--wp--preset--color--contrast, #000) 7%, var(--wp--preset--color--base, transparent))',
        kids: [
          { type: 'badge', x: 28, y: 28, w: 96, h: 44, text: '02' },
          { type: 'heading', x: 28, y: 96, w: 264, h: 44, text: 'Websites', fs: 'large' },
          { type: 'para', x: 28, y: 152, w: 264, h: 100, text: 'Fast, honest sites that read beautifully on a phone at a bus stop \u2014 which is where your customers are.' },
        ] },
      { type: 'box', x: 780, y: 170, w: 320, h: 330, radius: 18,
        boxBg: 'color-mix(in srgb, var(--wp--preset--color--contrast, #000) 7%, var(--wp--preset--color--base, transparent))',
        kids: [
          { type: 'badge', x: 28, y: 28, w: 96, h: 44, text: '03' },
          { type: 'heading', x: 28, y: 96, w: 264, h: 44, text: 'Art direction', fs: 'large' },
          { type: 'para', x: 28, y: 152, w: 264, h: 100, text: 'Photography, illustration and the thousand small calls that make everything feel intentional.' },
        ] },
    ] },
    { starter: true, intent: 'sell', name: 'Pricing', minH: 640, els: [
      { type: 'para', x: 400, y: 56, w: 400, h: 24, align: 'center', text: 'Simple pricing',
        tf: { fs: 13, fw: 600, ls2: 0.22, tt: 'uppercase', col: 'color-mix(in srgb, var(--wp--preset--color--contrast, currentColor) 62%, transparent)' } },
      { type: 'heading', x: 250, y: 96, w: 700, h: 64, text: 'Two ways to work with us', fs: 'x-large', align: 'center' },
      { type: 'box', x: 230, y: 216, w: 350, h: 380, radius: 20,
        boxBg: 'color-mix(in srgb, var(--wp--preset--color--contrast, #000) 6%, var(--wp--preset--color--base, transparent))',
        kids: [
          { type: 'heading', x: 32, y: 34, w: 286, h: 44, text: 'The Sprint', fs: 'large' },
          { type: 'para', x: 32, y: 90, w: 286, h: 76, text: 'One focused week. A sharp brief in, a finished thing out.' },
          { type: 'heading', x: 32, y: 186, w: 286, h: 60, text: '\u00a33,500', fs: 'x-large' },
          { type: 'button', x: 32, y: 278, w: 286, h: 54, text: 'Book a sprint', ghost: true },
        ] },
      { type: 'box', x: 620, y: 196, w: 350, h: 400, radius: 20,
        boxBg: 'var(--wp--preset--color--contrast, #16181c)',
        kids: [
          { type: 'badge', x: 210, y: 28, w: 116, h: 42, text: '\u2605 Loved' },
          { type: 'heading', x: 32, y: 34, w: 240, h: 44, text: 'The Partnership', fs: 'large', tf: { col: 'var(--wp--preset--color--base, #fff)' } },
          { type: 'para', x: 32, y: 98, w: 286, h: 76, text: 'A standing team beside yours \u2014 design, build and everything between.', tf: { col: 'color-mix(in srgb, var(--wp--preset--color--base, #fff) 78%, transparent)' } },
          { type: 'heading', x: 32, y: 196, w: 286, h: 60, text: '\u00a34,000/mo', fs: 'x-large', tf: { col: 'var(--wp--preset--color--base, #fff)' } },
          { type: 'button', x: 32, y: 290, w: 286, h: 54, text: 'Start together', tf: { bg: 'var(--wp--preset--color--base, #fff)', col: 'var(--wp--preset--color--contrast, #141519)' } },
        ] },
    ] },
    { starter: true, intent: 'sell', name: 'Quote', minH: 480, els: [
      { type: 'heading', x: 76, y: 44, w: 180, h: 160, text: '\u201c', fs: '__disp-l' },
      { type: 'para', x: 200, y: 168, w: 800, h: 160, text: 'They understood us in the first meeting. The site feels like walking into our shop \u2014 people say that, unprompted.', fs: 'x-large', tf: { lh: 1.25 } },
      { type: 'para', x: 204, y: 368, w: 500, h: 24, text: 'Hanna Lindqvist \u00b7 Hanna & Co',
        tf: { fs: 13, fw: 600, ls2: 0.22, tt: 'uppercase', col: 'color-mix(in srgb, var(--wp--preset--color--contrast, currentColor) 62%, transparent)' } },
    ] },
    { starter: true, intent: 'sell', name: 'Call to action', minH: 380,
      bg: 'var(--wp--preset--color--contrast, #16181c)',
      els: [
      { type: 'para', x: 96, y: 88, w: 300, h: 24, text: 'Next step',
        tf: { fs: 13, fw: 600, ls2: 0.22, tt: 'uppercase', col: 'color-mix(in srgb, var(--wp--preset--color--base, #fff) 60%, transparent)' } },
      { type: 'heading', x: 96, y: 130, w: 640, h: 130, text: 'Let\u2019s make yours', fs: '__max', tf: { col: 'var(--wp--preset--color--base, #fff)' } },
      { type: 'para', x: 98, y: 286, w: 440, h: 44, text: 'No forms and no decks \u2014 just a conversation about what you are building.', tf: { col: 'color-mix(in srgb, var(--wp--preset--color--base, #fff) 75%, transparent)' } },
      { type: 'button', x: 884, y: 186, w: 220, h: 60, text: 'Book a call', tf: { bg: 'var(--wp--preset--color--base, #fff)', col: 'var(--wp--preset--color--contrast, #141519)' } },
    ] },
    { starter: true, intent: 'sell', name: 'Get in touch', minH: 460, els: [
      { type: 'para', x: 400, y: 66, w: 400, h: 24, align: 'center', text: 'Say hello',
        tf: { fs: 13, fw: 600, ls2: 0.22, tt: 'uppercase', col: 'color-mix(in srgb, var(--wp--preset--color--contrast, currentColor) 62%, transparent)' } },
      { type: 'heading', x: 300, y: 122, w: 600, h: 100, text: 'Let\u2019s talk', fs: '__max', align: 'center' },
      { type: 'para', x: 340, y: 248, w: 520, h: 52, align: 'center', text: 'A question, an idea, or just to say hi \u2014 we read everything, usually the same day.' },
      { type: 'button', x: 424, y: 338, w: 170, h: 56, text: 'Email us' },
      { type: 'button', x: 614, y: 338, w: 170, h: 56, text: 'Follow along', ghost: true },
    ] },
    { starter: true, intent: 'showcase', name: 'Gallery', minH: 680, els: [
      { type: 'para', x: 72, y: 60, w: 300, h: 24, text: 'Selected work',
        tf: { fs: 13, fw: 600, ls2: 0.22, tt: 'uppercase', col: 'color-mix(in srgb, var(--wp--preset--color--contrast, currentColor) 62%, transparent)' } },
      { type: 'heading', x: 72, y: 100, w: 520, h: 64, text: 'A few favourites', fs: 'x-large' },
      { type: 'image', x: 72, y: 208, w: 330, h: 424, cool: true },
      { type: 'image', x: 435, y: 260, w: 330, h: 372 },
      { type: 'image', x: 798, y: 190, w: 330, h: 310, cool: true },
      { type: 'button', x: 798, y: 546, w: 210, h: 54, text: 'See the archive', ghost: true },
    ] },
    { starter: true, intent: 'showcase', name: 'Photo cards', minH: 720, els: [
      { type: 'image', x: 100, y: 40, w: 470, h: 620, cool: true },
      { type: 'box', x: 100, y: 340, w: 470, h: 320, boxBg: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.18) 30%, rgba(0,0,0,0.78) 100%)', radius: 20 },
      { type: 'heading', x: 136, y: 384, w: 340, h: 46, text: 'Quiet mountain cabin', fs: 'large', tf: { col: '#ffffff' } },
      { type: 'para', x: 136, y: 442, w: 398, h: 84, text: 'Wake up above the clouds. Two rooms, one stove, zero notifications \u2014 the good kind of nowhere.', tf: { col: '#ffffff' } },
      { type: 'badge', x: 136, y: 538, w: 130, h: 44, text: '\u2605 4.9' },
      { type: 'badge', x: 282, y: 538, w: 168, h: 44, text: '3 night stay' },
      { type: 'button', x: 136, y: 598, w: 398, h: 52, text: 'Reserve now', tf: { bg: '#ffffff', col: '#141519' } },
      { type: 'image', x: 630, y: 40, w: 470, h: 620, cool: true },
      { type: 'box', x: 630, y: 340, w: 470, h: 320, boxBg: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.18) 30%, rgba(0,0,0,0.78) 100%)', radius: 20 },
      { type: 'heading', x: 666, y: 384, w: 340, h: 46, text: 'Coastal hideaway', fs: 'large', tf: { col: '#ffffff' } },
      { type: 'para', x: 666, y: 442, w: 398, h: 84, text: 'Salt air, slow mornings and a five-minute walk to the water. Bring a book you\u2019ve been meaning to finish.', tf: { col: '#ffffff' } },
      { type: 'badge', x: 666, y: 538, w: 130, h: 44, text: '\u2605 4.8' },
      { type: 'badge', x: 812, y: 538, w: 168, h: 44, text: 'Guest favourite' },
      { type: 'button', x: 666, y: 598, w: 398, h: 52, text: 'Reserve now', tf: { bg: '#ffffff', col: '#141519' } },
    ] },
    { starter: true, intent: 'showcase', name: 'Portfolio', minH: 580, els: [
      { type: 'box', x: 40, y: 116, w: 560, h: 420, boxBg: 'color-mix(in srgb, var(--wp--preset--color--contrast, #000) 8%, var(--wp--preset--color--base, transparent))', radius: 24 },
      { type: 'image', x: 72, y: 80, w: 560, h: 420, cool: true },
      { type: 'badge', x: 104, y: 452, w: 190, h: 48, text: 'Hanna & Co' },
      { type: 'para', x: 700, y: 130, w: 300, h: 24, text: 'Case study',
        tf: { fs: 13, fw: 600, ls2: 0.22, tt: 'uppercase', col: 'color-mix(in srgb, var(--wp--preset--color--contrast, currentColor) 62%, transparent)' } },
      { type: 'heading', x: 700, y: 170, w: 420, h: 120, text: 'A bakery worth queueing for', fs: 'x-large' },
      { type: 'para', x: 700, y: 310, w: 400, h: 84, text: 'New identity, new site, same sourdough. Online orders doubled in the first month \u2014 the queue moved to the website.' },
      { type: 'badge', x: 700, y: 414, w: 170, h: 46, text: '+204% orders' },
      { type: 'badge', x: 886, y: 414, w: 160, h: 46, text: '6 weeks' },
      { type: 'button', x: 700, y: 486, w: 210, h: 52, text: 'Read the study', ghost: true },
    ] },
    { starter: true, intent: 'showcase', name: 'Menu', minH: 600, els: [
      { type: 'para', x: 400, y: 60, w: 400, h: 24, align: 'center', text: 'Served all day',
        tf: { fs: 13, fw: 600, ls2: 0.22, tt: 'uppercase', col: 'color-mix(in srgb, var(--wp--preset--color--contrast, currentColor) 62%, transparent)' } },
      { type: 'heading', x: 300, y: 100, w: 600, h: 70, text: 'Small plates', fs: 'x-large', align: 'center' },
      { type: 'heading', x: 280, y: 212, w: 520, h: 40, text: 'Sourdough, cultured butter', fs: 'medium' },
      { type: 'para', x: 850, y: 212, w: 70, h: 40, text: '\u00a36', align: 'right', fs: 'medium' },
      { type: 'heading', x: 280, y: 288, w: 520, h: 40, text: 'Burrata, blood orange, mint', fs: 'medium' },
      { type: 'para', x: 850, y: 288, w: 70, h: 40, text: '\u00a311', align: 'right', fs: 'medium' },
      { type: 'heading', x: 280, y: 364, w: 520, h: 40, text: 'Wood-roast leeks, romesco', fs: 'medium' },
      { type: 'para', x: 850, y: 364, w: 70, h: 40, text: '\u00a39', align: 'right', fs: 'medium' },
      { type: 'heading', x: 280, y: 440, w: 520, h: 40, text: 'Anchovy toast, soft egg', fs: 'medium' },
      { type: 'para', x: 850, y: 440, w: 70, h: 40, text: '\u00a38', align: 'right', fs: 'medium' },
      { type: 'para', x: 280, y: 516, w: 640, h: 30, text: 'Everything changes with the seasons \u2014 ask what\u2019s good today.', tf: { fst: 'italic', col: 'color-mix(in srgb, var(--wp--preset--color--contrast, currentColor) 62%, transparent)' } },
    ] },
    { starter: true, intent: 'showcase', name: 'Team', minH: 620, els: [
      { type: 'para', x: 72, y: 60, w: 300, h: 24, text: 'The studio',
        tf: { fs: 13, fw: 600, ls2: 0.22, tt: 'uppercase', col: 'color-mix(in srgb, var(--wp--preset--color--contrast, currentColor) 62%, transparent)' } },
      { type: 'heading', x: 72, y: 100, w: 600, h: 64, text: 'Eleven people, no egos', fs: 'x-large' },
      { type: 'image', x: 72, y: 208, w: 330, h: 300, cool: true },
      { type: 'heading', x: 74, y: 528, w: 320, h: 36, text: 'June Ashby', fs: 'medium' },
      { type: 'para', x: 74, y: 570, w: 320, h: 24, text: 'Creative director',
        tf: { fs: 13, fw: 600, ls2: 0.18, tt: 'uppercase', col: 'color-mix(in srgb, var(--wp--preset--color--contrast, currentColor) 62%, transparent)' } },
      { type: 'image', x: 435, y: 208, w: 330, h: 300 },
      { type: 'heading', x: 437, y: 528, w: 320, h: 36, text: 'Marco Reyes', fs: 'medium' },
      { type: 'para', x: 437, y: 570, w: 320, h: 24, text: 'Lead engineer',
        tf: { fs: 13, fw: 600, ls2: 0.18, tt: 'uppercase', col: 'color-mix(in srgb, var(--wp--preset--color--contrast, currentColor) 62%, transparent)' } },
      { type: 'image', x: 798, y: 208, w: 330, h: 300, cool: true },
      { type: 'heading', x: 800, y: 528, w: 320, h: 36, text: 'Priya Chandra', fs: 'medium' },
      { type: 'para', x: 800, y: 570, w: 320, h: 24, text: 'Strategy',
        tf: { fs: 13, fw: 600, ls2: 0.18, tt: 'uppercase', col: 'color-mix(in srgb, var(--wp--preset--color--contrast, currentColor) 62%, transparent)' } },
    ] },
  ];

  function tplEls(tpl) {
    var els = JSON.parse(JSON.stringify(tpl.els));
    var sizes = fontSizes();
    els.forEach(function (e) {
      if (e.fs === '__max') {
        if (sizes.length) e.fs = sizes[sizes.length - 1].slug;
        else delete e.fs;
      }
    });
    return els;
  }

  var picker = document.createElement('div');
  picker.className = 'gogh-picker';
  picker.hidden = true;
  document.body.appendChild(picker);
  var pickerIdx = null;
  var pickerBefore = null;

  var pickerCloseT = null;
  function closePicker() {
    clearTimeout(pickerCloseT);
    if (picker.__io) { picker.__io.disconnect(); picker.__io = null; }
    picker.classList.remove('is-open');
    if (/gogh-test/.test(location.search)) {
      // the suite runs synchronously — no 240ms of half-open picker
      picker.hidden = true;
      return;
    }
    pickerCloseT = setTimeout(function () { picker.hidden = true; }, 240);
  }
  // the modal grows out of whatever was clicked to open it
  document.addEventListener('pointerdown', function (ev) {
    picker.__ox = ev.clientX;
    picker.__oy = ev.clientY;
  }, true);
  function fitCardStage(pv, st) {
    // show the WHOLE design: shrink tall sections to fit, centre the rest
    var h = st.scrollHeight || 1;
    var scale = Math.min(pv.clientWidth / 1200, (pv.clientHeight || 1) / h);
    if (!isFinite(scale) || scale <= 0) scale = pv.clientWidth / 1200;
    st.style.transform = 'scale(' + scale + ')';
    st.style.left = Math.max(0, Math.round((pv.clientWidth - 1200 * scale) / 2)) + 'px';
    st.style.top = Math.max(0, Math.round(((pv.clientHeight || 0) - h * scale) / 2)) + 'px';
  }
  // one taxonomy for everything in the picker \u2014 starters and theme patterns
  // share these buckets, so the chips are the only navigation concept
  var BUCKETS = [
    { key: 'hero', label: 'Heroes & banners', cats: ['banner', 'hero', 'featured', 'call-to-action', 'cover', 'header'] },
    { key: 'text', label: 'Text', cats: ['text', 'about', 'quotes', 'quote', 'testimonials', 'testimonial'] },
    { key: 'cards', label: 'Cards & pricing', cats: ['card', 'cards', 'pricing', 'services', 'features', 'columns'] },
    { key: 'photos', label: 'Photos', cats: ['gallery', 'media', 'portfolio', 'images'] },
    { key: 'contact', label: 'Contact & social', cats: ['contact', 'team', 'social', 'subscribe', 'newsletter'] },
  ];
  var STARTER_CATS = {
    'Hero': 'hero', 'Big statement': 'hero', 'Story': 'text', 'Numbers': 'text',
    'Article': 'text', 'Feature cards': 'cards', 'Pricing': 'cards',
    'Quote': 'text', 'Call to action': 'hero', 'Get in touch': 'contact',
    'Gallery': 'photos', 'Photo cards': 'photos cards', 'Portfolio': 'photos',
    'Menu': 'text', 'Team': 'contact photos',
  };
  function openPicker(idx, before) {
    pickerIdx = idx;
    pickerBefore = (before && before.isConnected) ? before : null;
    try { picker.style.setProperty('--gogh-body-ff', getComputedStyle(document.body).fontFamily); } catch (err) {}
    var tplCardHTML = function (tpl, t, popular, si) {
      var els = tplEls(tpl);
      var scope = 'gogh-tpl-' + t;
      var css = els.length ? buildCSS(els, scope, tpl.minH || null, { bg: tpl.bg || null }) : '';
      var inner = els.map(function (e, i) { return makeNode(e, i).outerHTML; }).join('');
      return '<button type="button" class="gogh-card" data-tpl="' + t + '" data-si="' + (si || 0) + '"' +
        ' data-cats="' + (STARTER_CATS[tpl.name] || '') + '">' +
        '<span class="gogh-card-prev"><style>' + css + '</style>' +
        '<span class="gogh-card-stage gogh-wrap"><span class="gogh-card-sec gogh-section ' + scope + '">' + inner + '</span></span>' +
        '</span>' +
        '<span class="gogh-card-name">' + tpl.name +
        (popular ? '<span class="gogh-pop">🔥 Popular</span>' : '') + '</span>' +
        '</button>';
    };
    // starters shelve by INTENT, the question the user actually arrives
    // with (Squarespace lesson) — not by layout anatomy. Blank lives in
    // Quick start.
    var blankAt = TEMPLATES.findIndex(function (t) { return !t.retired && !t.starter; });
    var INTENTS = [
      { key: 'introduce', label: 'Introduce', sub: 'Say who you are' },
      { key: 'sell', label: 'Sell', sub: 'Turn interest into action' },
      { key: 'showcase', label: 'Showcase', sub: 'Let the work speak' },
    ];
    var cardsArr = [];
    var starterSeen = 0;
    INTENTS.forEach(function (g) {
      var labelled = false;
      TEMPLATES.forEach(function (tpl, t) {
        if (tpl.retired || !tpl.starter || tpl.intent !== g.key) return;
        if (!labelled) {
          cardsArr.push('<div class="gogh-seclab gogh-intentlab">' + g.label +
            '<i>' + g.sub + '</i></div>');
          labelled = true;
        }
        starterSeen++;
        cardsArr.push(tplCardHTML(tpl, t, false, starterSeen));
      });
    });
    // safety net: an intent-less starter still gets shelved, never lost
    TEMPLATES.forEach(function (tpl, t) {
      if (tpl.retired || !tpl.starter || tpl.intent) return;
      starterSeen++;
      cardsArr.push(tplCardHTML(tpl, t, false, starterSeen));
    });
    var cards = cardsArr.join('');
    var quickTile = function (cls, icon, title, sub) {
      return '<button type="button" class="gogh-quick ' + cls + '">' +
        '<span class="gogh-quick-ic">' + icon + '</span>' +
        '<span class="gogh-quick-tx"><b>' + title + '</b><i>' + sub + '</i></span>' +
        '<span class="gogh-quick-chev">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>' +
        '</span></button>';
    };
    picker.innerHTML =
      '<div class="gogh-picker-inner">' +
      '<div class="gogh-picker-head">' +
      '<span class="gogh-picker-headings"><span class="gogh-picker-title">Add a section</span>' +
      '<span class="gogh-picker-sub">Choose a layout to get started. You can customise everything.</span></span>' +
      '<span class="gogh-picker-tools">' +
      '<label class="gogh-picker-search">' +
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.6-4.6"/></svg>' +
      '<input type="text" class="gogh-patsearch" placeholder="Search layouts\u2026" />' +
      '</label>' +
      '<button type="button" class="gogh-picker-close gogh-picker-x" title="Close">' +
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
      '</button>' +
      '</span></div>' +
      // no chip row: search + the labelled shelves carry the whole modal —
      // "My sections" and the theme shelf open lightweight VIEWS instead,
      // with this bar as the way back
      '<div class="gogh-seclab gogh-viewbar" hidden><span></span>' +
      '<button type="button" class="gogh-gridlab-all gogh-view-back">← All layouts</button></div>' +
      '<div class="gogh-seclab gogh-quicklab">Quick start</div>' +
      '<div class="gogh-quickrow">' +
      quickTile('gogh-quick-scratch',
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
        'Start from scratch', 'Build your section on a blank canvas') +
      quickTile('gogh-quick-paste gogh-card-htmladd', '⌘V',
        'Paste HTML', 'Paste your HTML and we’ll convert it') +
      quickTile('gogh-quick-yours',
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 21S3.8 15.9 1.7 10.9C.3 7.6 2.4 4 5.9 4c2.2 0 3.8 1.2 4.7 2.6L12 8.5l1.4-1.9C14.3 5.2 15.9 4 18.1 4c3.5 0 5.6 3.6 4.2 6.9C20.2 15.9 12 21 12 21z"/></svg>',
        'My sections', 'Reuse your saved sections') +
      '</div>' +
      '<div class="gogh-cards">' + cards + '</div>' +
      '<div class="gogh-pickempty" hidden>Nothing here matches \u2014 try another filter.</div>' +
      '</div>';
    clearTimeout(pickerCloseT);
    picker.hidden = false;
    var pin = picker.querySelector('.gogh-picker-inner');
    if (pin && picker.__ox != null) {
      pin.style.transformOrigin =
        Math.round(picker.__ox / window.innerWidth * 100) + '% ' +
        Math.round(picker.__oy / window.innerHeight * 100) + '%';
    }
    picker.classList.remove('is-open');
    void picker.offsetWidth; // restart the transition
    picker.classList.add('is-open');
    picker.querySelector('.gogh-picker-close').addEventListener('click', closePicker);
    picker.querySelector('.gogh-card-htmladd').addEventListener('click', function () {
      var inner = picker.querySelector('.gogh-picker-inner');
      inner.innerHTML =
        '<div class="gogh-picker-head"><span class="gogh-picker-title">Paste HTML</span>' +
        '<button type="button" class="gogh-btn gogh-btn-small gogh-picker-close">Close</button></div>' +
        '<div class="gogh-panel-hint">It lands as a real HTML block \u2014 click text to edit it, \u2728 makes it freeform. Great with AI-written HTML. Tip: you can also just press \u2318V anywhere on the page.</div>' +
        '<textarea class="gogh-htmlpaste" placeholder="&lt;section&gt;\u2026&lt;/section&gt;" spellcheck="false"></textarea>' +
        '<div class="gogh-panel-row gogh-chrome-foot">' +
        '<button type="button" class="gogh-btn gogh-btn-small gogh-html-back">Back</button>' +
        '<button type="button" class="gogh-btn-save gogh-btn-small gogh-html-add">Add to page</button>' +
        '</div>';
      inner.querySelector('.gogh-picker-close').addEventListener('click', closePicker);
      inner.querySelector('.gogh-html-back').addEventListener('click', function () { openPicker(pickerIdx, pickerBefore); });
      var ta = inner.querySelector('.gogh-htmlpaste');
      ta.focus();
      inner.querySelector('.gogh-html-add').addEventListener('click', function () {
        if (!ta.value.trim()) { ta.focus(); return; }
        addHtmlSection(ta.value, pickerIdx, pickerBefore);
        closePicker();
      });
    });
    picker.addEventListener('pointerdown', function (ev) {
      if (ev.target === picker) closePicker();
    });
    picker.querySelectorAll('.gogh-card').forEach(function (card) {
      if (card.dataset.tpl == null) return;
      card.addEventListener('click', function () {
        addSection(TEMPLATES[+card.dataset.tpl], pickerIdx, pickerBefore);
        closePicker();
      });
    });
    picker.querySelector('.gogh-quick-scratch').addEventListener('click', function () {
      addSection(TEMPLATES[blankAt], pickerIdx, pickerBefore);
      closePicker();
    });
    picker.querySelector('.gogh-quick-yours').addEventListener('click', function () {
      setView('yours', 'Your sections'); // empty state falls through to the grid's hint
    });
    picker.querySelectorAll('.gogh-card-prev').forEach(function (p) {
      var st = p.querySelector('.gogh-card-stage');
      if (st) fitCardStage(p, st);
    });
    var cardsBox = picker.querySelector('.gogh-cards');
    var emptyHint = picker.querySelector('.gogh-pickempty');
    var searchIn = picker.querySelector('.gogh-patsearch');
    var activeCat = '', query = '';
    // one grid, one filter: chips and search treat every card the same
    function applyFilter() {
      var shown = 0, teaser = 0;
      var filtered = !!(activeCat || query);
      // the labelled library shape (Quick start / Recommended / Browse) only
      // makes sense on the first screen — filters flatten to one plain grid
      [].forEach.call(picker.querySelectorAll('.gogh-quicklab, .gogh-quickrow'), function (n) {
        n.hidden = filtered;
      });
      [].forEach.call(cardsBox.querySelectorAll('.gogh-seclab'), function (n) {
        n.hidden = filtered;
      });
      [].slice.call(cardsBox.querySelectorAll('.gogh-card')).forEach(function (b) {
        var ok;
        var isPat = b.classList.contains('gogh-card-pattern');
        if (!activeCat && !query) {
          // first screen: every starter under its intent shelf — the
          // shelves are the map, so nothing hides behind a See all — plus
          // a one-row taste of the theme's patterns (recents/faves carry
          // kind="yours" and stay off the first screen)
          ok = b.dataset.tpl != null ||
            (isPat && !b.dataset.kind && teaser < 4 && !!(++teaser));
        } else {
          var cats = (b.dataset.cats || '').split(' ');
          var name = ((b.querySelector('.gogh-card-name') || {}).textContent || '').toLowerCase();
          ok = (!activeCat ||
            (activeCat === 'yours' ? b.dataset.kind === 'yours' :
              activeCat === 'theme' ? isPat : cats.indexOf(activeCat) !== -1)) &&
            (!query || name.indexOf(query) !== -1);
        }
        b.style.display = ok ? '' : 'none';
        if (ok) {
          shown++;
          if (io && b.__pat && !b.__hydrated) { io.unobserve(b); hydrate(b, b.__pat); }
        }
      });
      var lab = cardsBox.querySelector('.gogh-gridlab');
      if (lab) lab.hidden = !(!activeCat && !query && teaser > 0);
      emptyHint.hidden = shown > 0;
    }
    // lightweight views (yours / theme) replace the old chip row
    var viewBar = picker.querySelector('.gogh-viewbar');
    function setView(cat, label) {
      activeCat = cat;
      picker.classList.toggle('gogh-view-yours', cat === 'yours');
      viewBar.querySelector('span').textContent = label || '';
      viewBar.hidden = !cat;
      applyFilter();
    }
    picker.querySelector('.gogh-view-back').addEventListener('click', function () { setView('', ''); });
    searchIn.addEventListener('input', function () {
      query = this.value.trim().toLowerCase();
      applyFilter();
    });
    // cap the first screen NOW — pattern loading used to be the only
    // early applyFilter trigger, so a 9th starter leaked past the cap
    applyFilter();
    // ---- pattern card machinery (lazy hydration) ----
    var hydrate = function (b, p) {
      if (b.__hydrated) return;
      b.__hydrated = true;
      renderPattern(p).then(function (html) {
        var st = b.querySelector('.gogh-card-stage');
        var pv = b.querySelector('.gogh-card-prev');
        if (!st || !html) { b.remove(); return; }
        st.innerHTML = html;
        // a pattern that renders next to nothing (post meta, bare social
        // icons) has no business as a section starting point — measured with
        // the injected layout <style> text excluded, or CSS counts as content
        var textOnly = function () {
          var c = st.cloneNode(true);
          [].slice.call(c.querySelectorAll('style')).forEach(function (n) { n.remove(); });
          return c.textContent || '';
        };
        var textLen = textOnly().trim().length;
        if (textLen < 30 && !st.querySelector('img')) { b.remove(); return; }
        fitCardStage(pv, st);
        [].slice.call(st.querySelectorAll('img')).forEach(function (im) {
          if (!im.complete) im.addEventListener('load', function () { fitCardStage(pv, st); }, { once: true });
        });
        // trial-convert the very render we're showing: if the scan loses
        // the content, don't offer the section at all. Hand-picked shelf
        // entries are exempt — they insert natively and were chosen on sight
        if (GOGH_SHELF.indexOf(p.name) !== -1) return;
        try {
          var trial = scanDomWithRaw(st, p.content || '', { loose: true });
          if (!trial.els.length) { b.remove(); return; }
          var kept = trial.els.map(function (e) {
            return e.type === 'widget' ? '' : (e.text || '');
          }).join(' ').replace(/\s+/g, ' ').length;
          var widgetText = trial.els.filter(function (e) { return e.type === 'widget'; })
            .map(function (e) { return e.whtml || ''; }).join(' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').length;
          var total = textOnly().replace(/\s+/g, ' ').length;
          if (total > 40 && (kept + widgetText) < total * 0.6) { b.remove(); return; }
        } catch (err) { b.remove(); return; }
      });
    };
    if (picker.__io) picker.__io.disconnect();
    var io = window.IntersectionObserver ? new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        hydrate(en.target, en.target.__pat);
      });
    }, { rootMargin: '200px' }) : null;
    picker.__io = io;
    Promise.all([
      fetchBlocks(),
      fetchSectionPatterns(),
    ]).then(function (res) {
      if (picker.hidden || !cardsBox.parentNode) return;
      var blocks = res[0] || [], pats = res[1] || [];
      var favs = {};
      try { (JSON.parse(localStorage.getItem('gogh-fav-patterns') || '[]')).forEach(function (n) { favs[n] = 1; }); } catch (err) {}
      var recents = [];
      try { recents = JSON.parse(localStorage.getItem('gogh-recent-sections') || '[]'); } catch (err) {}
      if (!Array.isArray(recents)) recents = [];
      var mine = blocks.filter(function (bk) {
        return ((bk.content && bk.content.raw) || '').indexOf('wp:gogh/section') !== -1;
      });
      var mineById = {};
      mine.forEach(function (bk) { mineById[bk.id] = bk; });

      var patCats = function (p) {
        // themes namespace their categories (ollie/hero, ollie/card) — match
        // on the bare name so the buckets see them
        var cats = (p.categories || []).map(function (c) { return String(c).split('/').pop(); });
        return BUCKETS.filter(function (bu) {
          return cats.some(function (c) { return bu.cats.indexOf(c) !== -1; });
        }).map(function (bu) { return bu.key; }).join(' ');
      };
      // no chip row anymore — but never strand the user inside an emptied
      // "Your sections" view
      var updateYoursChip = function () {
        if (activeCat === 'yours' && !cardsBox.querySelector('.gogh-card[data-kind="yours"]')) {
          setView('', '');
        }
      };
      var patCard = function (p) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'gogh-card gogh-card-pattern';
        b.__pat = p;
        b.dataset.cats = patCats(p);
        if (favs[p.name]) b.dataset.kind = 'yours';
        b.innerHTML = '<span class="gogh-card-prev"><span class="gogh-card-stage"></span></span>' +
          '<span class="gogh-card-name"></span>' +
          '<span class="gogh-card-fav">\u2665</span>' +
          '<span class="gogh-card-delpat gogh-card-unfav" title="Remove from Your sections">\u2715</span>';
        b.querySelector('.gogh-card-name').textContent = p.title || p.name;
        var favEl = b.querySelector('.gogh-card-fav');
        var syncFav = function () {
          favEl.classList.toggle('is-fav', !!favs[p.name]);
          favEl.title = favs[p.name] ? 'Remove from Your sections' : 'Favourite \u2014 adds to Your sections';
          if (favs[p.name]) b.dataset.kind = 'yours'; else delete b.dataset.kind;
        };
        syncFav();
        var setFav = function (on) {
          if (on) favs[p.name] = 1; else delete favs[p.name];
          try { localStorage.setItem('gogh-fav-patterns', JSON.stringify(Object.keys(favs))); } catch (err) {}
          syncFav();
          updateYoursChip();
          if (activeCat === 'yours') applyFilter();
        };
        var removeFav = function () {
          setFav(false);
          toast('\u201c' + (p.title || p.name) + '\u201d removed from Your sections.',
            { actions: [{ label: 'Undo', onClick: function () { setFav(true); } }] });
        };
        favEl.addEventListener('click', function (ev) {
          ev.stopPropagation();
          if (favs[p.name]) removeFav(); else setFav(true);
        });
        b.querySelector('.gogh-card-unfav').addEventListener('click', function (ev) {
          ev.stopPropagation();
          removeFav();
        });
        b.addEventListener('click', function () {
          addPatternSection(p, pickerIdx, pickerBefore);
          closePicker();
        });
        if (io) io.observe(b); else hydrate(b, p);
        return b;
      };
      var mineCard = function (bk) {
        var raw = (bk.content && bk.content.raw) || '';
        var tpl2 = document.createElement('template');
        tpl2.innerHTML = raw;
        var modelEl = tpl2.content.querySelector('script.gogh-model');
        var model = null;
        try { model = modelEl ? JSON.parse(modelEl.textContent) : null; } catch (err) {}
        if (!model || !model.elements) return null;
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'gogh-card gogh-card-mine';
        b.dataset.kind = 'yours';
        var scope = 'gogh-mine-' + bk.id;
        var css = buildCSS(model.elements, scope, model.minH || null, { bg: model.bg || null, bgImage: model.bgImage || null });
        var inner2 = model.elements.map(function (e, i) { return makeNode(e, i).outerHTML; }).join('');
        b.innerHTML = '<span class="gogh-card-prev"><style>' + css + '</style>' +
          '<span class="gogh-card-stage gogh-wrap"><span class="gogh-card-sec gogh-section ' + scope + '">' + inner2 + '</span></span>' +
          '</span>' +
          '<span class="gogh-card-name"></span>' +
          '<span class="gogh-card-delpat" title="Delete saved section">\u2715</span>';
        b.querySelector('.gogh-card-name').textContent = '\u2764 ' + ((bk.title && bk.title.raw) || 'My section');
        b.addEventListener('click', function () {
          recordRecent('b', bk.id);
          insertGoghPattern(raw, pickerIdx, pickerBefore);
          closePicker();
        });
        b.querySelector('.gogh-card-delpat').addEventListener('click', function (ev) {
          ev.stopPropagation();
          var slot = { parent: b.parentNode, next: b.nextSibling };
          var gone = function (undoable) {
            blocksCache = null;
            b.remove();
            updateYoursChip();
            toast('\u201c' + ((bk.title && bk.title.raw) || 'My section') + '\u201d deleted.',
              undoable ? { actions: [{ label: 'Undo', onClick: function () {
                fetch(blocksUrl(bk.id), {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
                  credentials: 'same-origin',
                  body: JSON.stringify({ status: 'publish' }),
                }).then(function (r3) {
                  if (!r3.ok) throw new Error('HTTP ' + r3.status);
                  blocksCache = null;
                  slot.parent.insertBefore(b, slot.next && slot.next.parentNode === slot.parent ? slot.next : null);
                  updateYoursChip();
                }).catch(function () { toast('Could not restore it.', { error: true }); });
              } }] } : undefined);
          };
          // trash first — restorable; some setups refuse trashing wp_block,
          // then (and only then) delete outright
          fetch(blocksUrl(bk.id), {
            method: 'DELETE',
            headers: { 'X-WP-Nonce': cfg.nonce },
            credentials: 'same-origin',
          }).then(function (res2) {
            if (res2.ok) { gone(true); return null; }
            return fetch(restQ(blocksUrl(bk.id), 'force=true'), {
              method: 'DELETE',
              headers: { 'X-WP-Nonce': cfg.nonce },
              credentials: 'same-origin',
            }).then(function (res3) {
              if (res3.ok) gone(false);
              else toast('Could not delete that section.', { error: true });
            });
          }).catch(function () {
            toast('Could not delete that section.', { error: true });
          });
        });
        return b;
      };

      // ---- build the one grid: yours floated first ----
      // curation: the hand-picked shelf (GOGH_SHELF, in its order) when the
      // active theme has it; otherwise only hero and card/feature patterns
      // make the cut — the long tail (post meta, footers, filler) is noise
      var shelf = pats.filter(function (p) { return GOGH_SHELF.indexOf(p.name) !== -1; });
      if (shelf.length) {
        shelf.sort(function (a, b) { return GOGH_SHELF.indexOf(a.name) - GOGH_SHELF.indexOf(b.name); });
        pats = shelf;
      } else {
        pats = pats.filter(function (p) {
          // whole-header/footer patterns aren't page sections
          var cats = (p.categories || []).map(function (c) { return String(c).split('/').pop(); });
          if (cats.indexOf('header') !== -1 || cats.indexOf('footer') !== -1) return false;
          var c = patCats(p);
          return c.indexOf('hero') !== -1 || c.indexOf('cards') !== -1;
        });
      }
      var patCardByName = {};
      var themeLabel = 'From ' + (cfg.themeName || 'your theme');
      if (pats.length) {
        // the theme's patterns get a labelled shelf on the first screen (a
        // three-card taste); See all opens the full set as a view
        var lab = document.createElement('div');
        lab.className = 'gogh-gridlab';
        lab.hidden = true;
        lab.innerHTML = '<span></span><button type="button" class="gogh-gridlab-all">See all →</button>';
        lab.querySelector('span').textContent = themeLabel;
        cardsBox.appendChild(lab);
        lab.querySelector('.gogh-gridlab-all').addEventListener('click', function () {
          setView('theme', themeLabel);
        });
      }
      pats.forEach(function (p) {
        var b = patCard(p);
        patCardByName[p.name] = b;
        cardsBox.appendChild(b);
      });
      var mineCardById = {};
      mine.forEach(function (bk) {
        var b = mineCard(bk);
        if (b) mineCardById[bk.id] = b;
      });
      // front of All: recents (newest first), then remaining saved sections
      var front = [];
      var seenF = {};
      recents.forEach(function (rc) {
        var c = rc.t === 'p' ? patCardByName[rc.k] : mineCardById[rc.k];
        if (!c || seenF[rc.t + rc.k]) return;
        seenF[rc.t + rc.k] = 1;
        c.dataset.kind = 'yours';
        front.push(c);
      });
      mine.forEach(function (bk) {
        if (mineCardById[bk.id] && !seenF['b' + bk.id]) { seenF['b' + bk.id] = 1; front.push(mineCardById[bk.id]); }
      });
      var anchor = cardsBox.querySelector('.gogh-card-blank');
      front.forEach(function (c) {
        cardsBox.insertBefore(c, anchor ? anchor.nextSibling : cardsBox.firstChild);
        anchor = c;
      });
      // saved-section cards render at design scale until fitted
      front.forEach(function (c) {
        if (c.__pat) return;
        var pv = c.querySelector('.gogh-card-prev');
        var st = c.querySelector('.gogh-card-stage');
        if (pv && st) fitCardStage(pv, st);
      });
      updateYoursChip();
      applyFilter();
    });
  }

  function addSection(tpl, idx, before) {
    if (idx == null) idx = S.length;
    idx = clampInsertIdx(idx);
    var sec = newSectionShell('gogh-sec-' + (scopeSeq++));
    sec.els = tplEls(tpl);
    sec.minH = tpl.minH || null;
    sec.bg = tpl.bg || null;
    var nextContent = null;
    for (var ni = idx; ni < S.length; ni++) { if (!S[ni].chrome) { nextContent = S[ni]; break; } }
    // the DOM anchor wins when given: it can place the section above a
    // native block, which the S-index cannot express
    var anchor = (before && before.isConnected) ? before : (nextContent ? nextContent.wrapEl : endMarker);
    pageParent.insertBefore(sec.wrapEl, anchor);
    S.splice(idx, 0, sec);
    // a real section replaces the ?gogh-edit bootstrap placeholder
    for (var bi = S.length - 1; bi >= 0; bi--) {
      if (isBlankBoot(S[bi]) && S[bi] !== sec) {
        S[bi].wrapEl.remove();
        if (S[bi].styleEl && S[bi].styleEl.parentNode) S[bi].styleEl.parentNode.removeChild(S[bi].styleEl);
        S.splice(bi, 1);
      }
    }
    renderSection(sec);
    sel = null;
    hideHandles();
    sec.wrapEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    pushState();
  }

  // ---------- "/" quick add: type to filter, Enter to insert ----------
  var cmd = document.createElement('div');
  cmd.className = 'gogh-cmd';
  cmd.hidden = true;
  cmd.innerHTML = '<div class="gogh-cmd-panel">' +
    '<input type="text" class="gogh-input gogh-cmd-in" placeholder="Add something\u2026" />' +
    '<div class="gogh-cmd-list"></div></div>';
  document.body.appendChild(cmd);
  var cmdIn = cmd.querySelector('.gogh-cmd-in');
  var cmdList = cmd.querySelector('.gogh-cmd-list');
  var cmdIdx = 0;
  function cmdItems() {
    var items = [
      { label: 'Heading', kind: 'heading' },
      { label: 'Text', kind: 'para' },
      { label: 'Button', kind: 'button' },
      { label: 'Image', kind: 'image' },
      { label: 'Badge', kind: 'badge' },
      { label: 'Posts grid', kind: 'posts' },
    ];
    if (cfg.hasWoo) items.push({ label: 'Products grid', kind: 'products' });
    TEMPLATES.forEach(function (t, ti) {
      if (t.els.length && !t.retired) items.push({ label: t.name + ' \u00b7 section', tpl: ti });
    });
    return items;
  }
  function renderCmd() {
    var q = cmdIn.value.trim().toLowerCase();
    var items = cmdItems().filter(function (it) { return it.label.toLowerCase().indexOf(q) !== -1; });
    cmdIdx = Math.max(0, Math.min(cmdIdx, items.length - 1));
    cmdList.innerHTML = '';
    items.forEach(function (it, k) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'gogh-cmd-item' + (k === cmdIdx ? ' is-active' : '');
      b.textContent = it.label;
      b.addEventListener('click', function () { runCmd(it); });
      cmdList.appendChild(b);
    });
    cmdList.__items = items;
  }
  function openCmd() {
    cmd.hidden = false;
    cmdIn.value = '';
    cmdIdx = 0;
    renderCmd();
    cmdIn.focus();
  }
  function closeCmd() {
    cmd.hidden = true;
    cmdIn.blur();
  }
  function runCmd(it) {
    closeCmd();
    if (it.kind) addElementAtViewport(it.kind);
    else addSection(TEMPLATES[it.tpl], S.indexOf(viewportSection()) + 1);
  }
  cmdIn.addEventListener('input', function () { cmdIdx = 0; renderCmd(); });
  cmdIn.addEventListener('keydown', function (ev) {
    var items = cmdList.__items || [];
    if (ev.key === 'ArrowDown') { ev.preventDefault(); cmdIdx++; renderCmd(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); cmdIdx--; renderCmd(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); if (items[cmdIdx]) runCmd(items[cmdIdx]); }
    else if (ev.key === 'Escape') { ev.preventDefault(); closeCmd(); }
    ev.stopPropagation(); // the menu owns the keyboard while open
  });
  cmd.addEventListener('pointerdown', function (ev) { if (ev.target === cmd) closeCmd(); });

  // ---------- section-height handle (Canva-style bottom-edge bar) ----------
  var hbar = document.createElement('div');
  hbar.className = 'gogh-hbar';
  var hgrip = document.createElement('button');
  hgrip.type = 'button';
  hgrip.className = 'gogh-hgrip';
  hgrip.title = 'Drag to move — or drag the element itself. Arrow keys nudge (Shift = 8\u00d7)';
  hbar.hidden = true;
  document.body.appendChild(hbar);
  document.body.appendChild(hgrip);
  hgrip.hidden = true;
  var hbarSec = null;

  function placeHbar(sec) {
    hbarSec = sec;
    var r = sec.wrapEl.getBoundingClientRect();
    var by = Math.min(r.bottom, window.innerHeight - 36);
    hbar.style.left = (r.left + window.scrollX) + 'px';
    hbar.style.width = r.width + 'px';
    hbar.style.top = (by + window.scrollY) + 'px';
    hbar.hidden = false;
    hgrip.style.left = (r.left + r.width / 2 + window.scrollX) + 'px';
    hgrip.style.top = (by + window.scrollY) + 'px';
    hgrip.hidden = false;
  }
  function hideHbar() { hgrip.hidden = true; goghFadeOut(hbar); hbarSec = null; }

  var hDrag = null, hRaf = false;
  hgrip.addEventListener('pointerdown', function (ev) {
    if (!editing || !hbarSec) return;
    ev.preventDefault();
    try { hgrip.setPointerCapture(ev.pointerId); } catch (err) {}
    hDrag = { sec: hbarSec, py: ev.clientY, h: designH(hbarSec.els, hbarSec.minH) };
    document.documentElement.classList.add('gogh-dragging');
    inserter.hidden = true;
    shapeBtn.hidden = true;
  });
  hgrip.addEventListener('pointermove', function (ev) {
    if (!hDrag) return;
    var sec = hDrag.sec;
    var s = scaleOf(sec);
    sec.minH = Math.round(Math.min(4000, Math.max(160, hDrag.h + (ev.clientY - hDrag.py) / s)));
    if (!hRaf) {
      hRaf = true;
      requestAnimationFrame(function () {
        hRaf = false;
        if (!hDrag) return;
        resolveAndApply(sec);
        placeHbar(sec);
      });
    }
  });
  function endHDrag() {
    if (!hDrag) return;
    var sec = hDrag.sec;
    hDrag = null;
    document.documentElement.classList.remove('gogh-dragging');
    // if dragged back to (or below) the content-driven height, clear the override
    var contentH = designH(sec.els, null);
    if (sec.minH && sec.minH <= contentH) sec.minH = null;
    resolveAndApply(sec);
    placeHbar(sec);
    pushState();
  }
  hgrip.addEventListener('pointerup', endHDrag);
  hgrip.addEventListener('pointercancel', endHDrag);

  // ---------- section operations ----------
  function deleteSection(idx) {
    if (!S[idx] || S[idx].chrome) return;
    var sig = S[idx].srcSig;
    var st = sig && convertStash[sig];
    S[idx].wrapEl.remove();
    S[idx].styleEl.remove();
    // deleting a converted section deletes the CONTENT — resurrecting the
    // original block here read as "I can't delete anything freeform". Its
    // stored span is marked for excision on the next publish instead (the
    // undo stack still restores the section itself).
    if (st && !st.node.parentNode && st.raw) {
      storedEdits.push({ el: st.node, raw: st.raw, savedRaw: st.raw, stored: true, deleted: true, title: 'Section' });
      delete convertStash[sig];
      refreshChip();
    }
    S.splice(idx, 1);
    sel = null;
    hideHandles();
    hideHbar();
    closePanel();
    hideSecBar();
    // deleting the LAST section is allowed: the page goes blank, an unsaved
    // placeholder becomes the canvas (same as booting an empty page), and
    // the picker opens so there's an obvious next step. Undo still works.
    if (!S.filter(function (s) { return !s.chrome; }).length && !pendingBlocks.length &&
        !goghHasNativeContent()) {
      var ph = newSectionShell('gogh-sec-' + (scopeSeq++));
      ph.bootstrap = true;
      pageParent.insertBefore(ph.wrapEl, endMarker);
      S.splice(clampInsertIdx(S.length), 0, ph);
      renderSection(ph);
      resolveAll();
      pushState();
      openPicker(S.indexOf(ph));
      return;
    }
    resolveAll();
    pushState();
  }
  function hideBoundaryUI() {
    inserter.hidden = true;
    shapeBtn.hidden = true;
    hideHbar();
  }
  function moveSection(idx, dir) {
    hideBoundaryUI();
    var j = idx + dir;
    if (j < 0 || j >= S.length || !S[idx]) return;
    var a = S[idx];
    if (dir < 0) S[j].wrapEl.before(a.wrapEl);
    else S[j].wrapEl.after(a.wrapEl);
    S.splice(idx, 1);
    S.splice(j, 0, a);
    resolveAll();
    hideSecBar();
    pushState();
  }
  function reorderSection(from, to) {
    if (from === to || !S[from]) return;
    var a = S[from];
    var target = S[to];
    if (!target) return;
    if (to < from) target.wrapEl.before(a.wrapEl);
    else target.wrapEl.after(a.wrapEl);
    S.splice(from, 1);
    S.splice(to, 0, a);
    resolveAll();
    hideSecBar();
    pushState();
  }
  function duplicateSection(idx) {
    var srcSec = S[idx];
    if (!srcSec) return;
    var sec = newSectionShell('gogh-sec-' + (scopeSeq++));
    sec.els = JSON.parse(JSON.stringify(srcSec.els));
    sec.minH = srcSec.minH;
    sec.bg = srcSec.bg;
    sec.divider = srcSec.divider ? JSON.parse(JSON.stringify(srcSec.divider)) : null;
    sec.fx = srcSec.fx ? JSON.parse(JSON.stringify(srcSec.fx)) : null;
    sec.bgImage = srcSec.bgImage || null;
    sec.bgId = srcSec.bgId || null;
    sec.bgA = srcSec.bgA != null ? srcSec.bgA : null;
    sec.theme = srcSec.theme || null;
    sec.fill = !!srcSec.fill;
    srcSec.wrapEl.after(sec.wrapEl);
    S.splice(idx + 1, 0, sec);
    renderSection(sec);
    resolveAll();
    hideSecBar();
    pushState();
  }

  // hover bar for section-level actions
  var secBar = document.createElement('div');
  secBar.className = 'gogh-secbar';
  secBar.innerHTML =
    '<span class="gogh-secbar-label">Section</span>' +
    '<button type="button" class="gogh-sb" data-sec="add" title="Add an element to this section">＋</button>' +
    '<button type="button" class="gogh-sb" data-sec="up" title="Move up">↑</button>' +
    '<button type="button" class="gogh-sb" data-sec="down" title="Move down">↓</button>' +
    '<button type="button" class="gogh-sb" data-sec="bgimg" title="Background image">' + CTX_ICONS.image + '</button>' +
    '<button type="button" class="gogh-sb" data-sec="rearrange" title="Rearrange \u2014 same pieces, new shapes"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="4" width="8" height="7" rx="1.5"/><rect x="14" y="13" width="7" height="7" rx="1.5"/><path d="M17 4h4v4M7 20H3v-4"/></svg></button>' +
    '<button type="button" class="gogh-sb" data-sec="savepat" title="Save this section to reuse">' +
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M6 3h12v18l-6-4.5L6 21Z"/></svg>' +
    '</button>' +
    '<button type="button" class="gogh-sb" data-sec="dup" title="Duplicate section">⧉</button>' +
    '<button type="button" class="gogh-sb gogh-sb-del" data-sec="del" title="Delete section">🗑</button>';
  secBar.hidden = true;
  document.body.appendChild(secBar);
  var secBarIdx = null;

  function hideSecBar() { goghFadeOut(secBar); secBarIdx = null; }
  function showSecBar(idx) {
    // the site header/footer isn't a page section: it can't move, duplicate
    // or be deleted, so the section toolbar has nothing to offer it
    if (S[idx] && S[idx].chrome) { hideSecBar(); return; }
    secBarIdx = idx;
    var r = S[idx].wrapEl.getBoundingClientRect();
    secBar.style.left = (r.left + window.scrollX + 16) + 'px';
    secBar.style.top = (r.top + window.scrollY + 14) + 'px';
    var contentIdxs = [];
    S.forEach(function (s, k) { if (!s.chrome) contentIdxs.push(k); });
    secBar.querySelector('[data-sec="up"]').disabled = idx === contentIdxs[0];
    secBar.querySelector('[data-sec="down"]').disabled = idx === contentIdxs[contentIdxs.length - 1];
    secBar.querySelector('[data-sec="del"]').disabled = false;
    secBar.hidden = false;
    // don't sit on the Edit header/footer pill — duck below it
    var sr = secBar.getBoundingClientRect();
    chromeBtns.forEach(function (cb) {
      var cr = cb.getBoundingClientRect();
      var clear = sr.right < cr.left - 8 || sr.left > cr.right + 8 ||
        sr.bottom < cr.top - 8 || sr.top > cr.bottom + 8;
      if (!clear) {
        secBar.style.top = (cr.bottom + window.scrollY + 10) + 'px';
        sr = secBar.getBoundingClientRect();
      }
    });
  }
  secBar.addEventListener('click', function (ev) {
    var b = ev.target.closest('.gogh-sb');
    if (!b || secBarIdx === null) return;
    if (b.dataset.sec === 'add') { openSecAddPanel(secBarIdx); return; }
    if (b.dataset.sec === 'bgimg') { openSecBgPanel(secBarIdx, b); return; }
    if (b.dataset.sec === 'rearrange') { openRearrangePanel(secBarIdx); return; }
    if (b.dataset.sec === 'savepat') { openSavePatternPanel(secBarIdx); return; }
    if (b.dataset.sec === 'del') deleteSection(secBarIdx);
    else if (b.dataset.sec === 'up') moveSection(secBarIdx, -1);
    else if (b.dataset.sec === 'down') moveSection(secBarIdx, 1);
    else if (b.dataset.sec === 'dup') duplicateSection(secBarIdx);
  });

  // plain-permalink safe: cfg URLs may already carry ?rest_route=…
  function restQ(url, qs) {
    return url + (url.indexOf('?') === -1 ? '?' : '&') + qs;
  }
  var blocksCache = null;
  function fetchBlocks() {
    if (blocksCache) return Promise.resolve(blocksCache);
    return fetch(restQ(blocksUrl(), 'per_page=100&context=edit'), {
      headers: { 'X-WP-Nonce': cfg.nonce },
      credentials: 'same-origin',
    }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function (list) { blocksCache = list; return list; })
      .catch(function () { return []; }); // failures are NOT cached — retry next call
  }
  function blocksUrl(id) {
    var base = cfg.restUrl.split('wp/v2/')[0] + 'wp/v2/blocks';
    return id ? base + '/' + id : base;
  }
  function openSavePatternPanel(idx) {
    var secx = S[idx];
    placePanelNear(secx.wrapEl);
    panel.innerHTML =
      '<div class="gogh-panel-title">Save this section</div>' +
      '<div class="gogh-panel-hint">It joins \u201cYour sections\u201d in + Section \u2014 and Gutenberg\u2019s pattern library too.</div>' +
      '<div class="gogh-panel-row">' +
      '<input type="text" class="gogh-input gogh-patname" placeholder="Name it\u2026" />' +
      '<button type="button" class="gogh-btn gogh-btn-small gogh-patsave">Save</button>' +
      '</div>';
    panel.hidden = false;
    panelOpen = true;
    var input = panel.querySelector('.gogh-patname');
    input.focus();
    var doSave = function () {
      var name = input.value.trim();
      if (!name) { input.focus(); return; }
      var btn = panel.querySelector('.gogh-patsave');
      btn.disabled = true;
      fetch(blocksUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
        credentials: 'same-origin',
        body: JSON.stringify({ title: name, status: 'publish',
          content: buildSectionBlocks(secx),
          meta: { wp_pattern_sync_status: 'unsynced' } }),
      }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        blocksCache = null;
        closePanel();
        toast('\u201c' + name + '\u201d saved \u2014 it\u2019s in + Section under Your sections.', { ttl: 5000 });
      }).catch(function () {
        btn.disabled = false;
        toast('Could not save that section.', { error: true });
      });
    };
    panel.querySelector('.gogh-patsave').addEventListener('click', doSave);
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') doSave();
      if (ev.key === 'Escape') closePanel();
    });
  }
  function insertGoghPattern(content, idx, before) {
    var tpl = document.createElement('template');
    tpl.innerHTML = content;
    var wrap = tpl.content.querySelector('.gogh-wrap');
    var modelEl = wrap && wrap.querySelector('script.gogh-model');
    var model = null;
    try { model = modelEl ? JSON.parse(modelEl.textContent) : null; } catch (err) {}
    if (!model) {
      // v3 markup: the model rides in the block-comment attributes
      var am = String(content).match(/<!--\s+wp:gogh\/section\s+(\{[\s\S]*?\})\s*-->/);
      if (am) {
        try { var a3 = JSON.parse(am[1]); model = a3 && a3.model; } catch (e9) {}
      }
    }
    if (!model || !model.elements) {
      toast('That saved section can\u2019t be read.', { error: true });
      return;
    }
    if (idx == null) idx = S.length;
    idx = clampInsertIdx(idx);
    var sec = newSectionShell('gogh-sec-' + (scopeSeq++));
    sec.els = model.elements;
    sec.minH = model.minH || null;
    sec.bg = model.bg || null;
    sec.divider = model.divider || null;
    sec.fx = model.fx || null;
    sec.bgImage = model.bgImage || null;
    sec.bgId = model.bgId || null;
    sec.bgA = model.bgA != null ? model.bgA : null;
    sec.theme = model.theme || null;
    sec.fill = !!model.fill;
    var nextContent = null;
    for (var ni = idx; ni < S.length; ni++) { if (!S[ni].chrome) { nextContent = S[ni]; break; } }
    pageParent.insertBefore(sec.wrapEl, (before && before.isConnected) ? before : (nextContent ? nextContent.wrapEl : endMarker));
    S.splice(idx, 0, sec);
    renderSection(sec);
    sel = null;
    hideHandles();
    sec.wrapEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    pushState();
  }
  // ---------- rearrange: the solver proposes, the hover auditions ----------
  // Alternate arrangements computed from the elements already present.
  // Hovering a chip applies the arrangement LIVE in the canvas (Squarespace
  // shows static thumbnails; the live canvas is the improvement), clicking
  // keeps it with Undo intact, leaving restores what was.
  // the visible words, not their box: a text element's box often carries
  // slack to the right of the ink, and arranging by box puts the WORDS in
  // the wrong place (James: "feels like its still centering the box")
  function inkWidthOf(sec, i) {
    var e = sec.els[i], node = sec.nodes && sec.nodes[i];
    if (!node || !(isText(e) || e.type === 'badge')) return null;
    try {
      var thost = node.querySelector('p,h1,h2,h3,h4,h5,h6') || node;
      var trng = document.createRange();
      trng.selectNodeContents(thost);
      var tw = trng.getBoundingClientRect().width / scaleOf(sec);
      return (tw > 0 && tw < e.w - 4) ? tw : null;
    } catch (err) { return null; }
  }
  function rearrangeVariants(sec) {
    var els = sec.els;
    if (els.length < 2) return [];
    var isMedia = function (e) {
      return e.type === 'image' || e.type === 'box' || e.type === 'exp' || e.type === 'widget';
    };
    var inks = els.map(function (e, i) { return inkWidthOf(sec, i); });
    var reading = els.map(function (e, i) { return i; }).sort(function (a, b) {
      return (els[a].y - els[b].y) || (els[a].x - els[b].x);
    });
    function stack(xOf) {
      var pos = els.map(function (e) { return { x: e.x, y: e.y }; });
      var y = 64;
      reading.forEach(function (i) {
        var e = els[i];
        pos[i] = { x: Math.max(0, Math.min(W - e.w, xOf(e, i))), y: y };
        y += e.h + 28;
      });
      return pos;
    }
    var out = [
      { slug: 'mirror', name: 'Mirror',
        // slack left-aligned text mirrors by its INK edge — the box's empty
        // right half must not decide where the words land
        pos: els.map(function (e, i) {
          var iw = inks[i];
          var nx = (iw && (!e.align || e.align === 'left')) ? W - e.x - iw : W - e.x - e.w;
          return { x: Math.max(0, Math.min(W - e.w, nx)), y: e.y };
        }) },
      { slug: 'centred', name: 'Centred',
        pos: stack(function (e, i) {
          var iw = inks[i];
          if (iw && (!e.align || e.align === 'left')) return (W - iw) / 2;
          if (iw && e.align === 'right') return (W - iw) / 2 - (e.w - iw);
          return (W - e.w) / 2;
        }) },
      { slug: 'rail', name: 'Left rail',
        pos: stack(function (e) { return 72; }) },
    ];
    if (els.some(isMedia) && els.some(function (e) { return !isMedia(e); })) {
      var pos = els.map(function (e) { return { x: e.x, y: e.y }; });
      var yT = 72, yM = 72;
      reading.forEach(function (i) {
        var e = els[i];
        if (isMedia(e)) {
          pos[i] = { x: Math.max(620, W - e.w - 72), y: yM };
          yM += e.h + 28;
        } else {
          pos[i] = { x: 72, y: yT };
          yT += e.h + 24;
        }
      });
      out.push({ slug: 'split', name: 'Words · picture', pos: pos });
    }
    return out;
  }
  function applyPositions(sec, pos) {
    sec.els.forEach(function (e, i) {
      if (pos[i]) { e.x = Math.round(pos[i].x); e.y = Math.round(pos[i].y); }
    });
    renderSection(sec);
  }
  function openRearrangePanel(idx) {
    var secx = S[idx];
    var variants = rearrangeVariants(secx);
    if (!variants.length) { toast('Nothing to rearrange yet — add a couple of elements first.'); return; }
    var snap = secx.els.map(function (e) { return { x: e.x, y: e.y }; });
    var committed = false;
    panel.innerHTML = '<div class="gogh-panel-title">Rearrange this section</div>' +
      '<div class="gogh-panel-hint">Hover to audition — click to keep. Same pieces, new arrangement.</div>' +
      '<div class="gogh-rearrow">' + variants.map(function (v, k) {
        return '<button type="button" class="gogh-rearchip" data-k="' + k + '">' + esc(v.name) + '</button>';
      }).join('') + '</div>';
    placePanelNear(secx.wrapEl);
    panelOpen = true;
    panel.querySelectorAll('.gogh-rearchip').forEach(function (chip) {
      chip.addEventListener('mouseenter', function () {
        if (!committed) applyPositions(secx, variants[+chip.dataset.k].pos);
      });
      chip.addEventListener('mouseleave', function () {
        if (!committed) applyPositions(secx, snap);
      });
      chip.addEventListener('click', function () {
        applyPositions(secx, snap); // restore, so undo lands on the true before
        pushState();
        applyPositions(secx, variants[+chip.dataset.k].pos);
        committed = true;
        closePanel();
        toast('Rearranged — same pieces, new shape.', { actions: [{ label: 'Undo', onClick: function () { undo(); } }] });
      });
    });
  }
  // ---------- section themes: pick a look, never a hex ----------
  // A few named looks derived from the LIVE palette — each carries a
  // background and a contrast-verified ink, and because they're written as
  // var() expressions they re-dress automatically when the site style
  // changes. Freedom in layout, constraint in style.
  function bestInkFor(bgCss) {
    var rgb = cssToRgb(bgCss);
    var bgL = rgb ? sentinelLum(rgb) : 1;
    var best = 'contrast', bestC = 0;
    themePalette().forEach(function (p) {
      if (!/^(base|contrast)(-|$)/.test(p.slug)) return;
      var prgb = cssToRgb(p.value);
      if (!prgb) return;
      var c = sentinelContrast(sentinelLum(prgb), bgL);
      if (c > bestC) { bestC = c; best = p.slug; }
    });
    return best;
  }
  function sectionThemes() {
    var v = function (slug) { return 'var(--wp--preset--color--' + slug + ')'; };
    var pal = themePalette();
    var has = {};
    pal.forEach(function (p) { has[p.slug] = 1; });
    if (!has.base || !has.contrast) return [];
    var out = [
      { slug: 'paper', name: 'Paper', bg: v('base'), ink: 'contrast' },
      { slug: 'mist', name: 'Mist', bg: 'color-mix(in srgb, ' + v('contrast') + ' 6%, ' + v('base') + ')', ink: 'contrast' },
      { slug: 'ink', name: 'Ink', bg: v('contrast'), ink: 'base' },
    ];
    ['accent-1', 'accent-2'].forEach(function (a, k) {
      if (!has[a]) return;
      out.push({ slug: a, name: 'Accent ' + (k + 1), bg: v(a), ink: bestInkFor(v(a)) });
      out.push({ slug: a + '-soft', name: 'Accent ' + (k + 1) + ' soft',
        bg: 'color-mix(in srgb, ' + v(a) + ' 14%, ' + v('base') + ')', ink: 'contrast' });
    });
    return out;
  }
  function applySectionTheme(idx, theme) {
    var secx = S[idx];
    pushState();
    secx.theme = theme.slug;
    secx.bg = theme.bg;
    secx.bgA = null;
    // the theme restyles the section's INK too — that's what makes it a
    // theme and not a background (undo covers a change of heart)
    secx.els.forEach(function (e) {
      if (isText(e) || e.type === 'badge') e.color = theme.ink;
    });
    syncBootInvite(secx);
    renderSection(secx);
    resolveAll();
  }
  // the invite lives in the rendered section — keep it honest when a
  // background arrives (or leaves) without a full re-render
  function syncBootInvite(sec2) {
    var has = !!sec2.sectionEl.querySelector('.gogh-bootinvite');
    if (has !== isBlankBoot(sec2)) renderSection(sec2);
  }
  function setSecBg(idx, src, id) {
    S[idx].bgImage = src || null;
    S[idx].bgId = src ? (id || null) : null;
    syncBootInvite(S[idx]);
    resolveAll();
    // the panel STAYS open — picking an image is an audition, not a
    // dismissal; people flick between backgrounds while deciding
    pushState();
    contrastSentinel(S[idx]);
  }
  function openSecBgPanel(idx, anchorEl) {
    var secx = S[idx];
    // open by the button that asked for it — the old section-top-right
    // anchor dates from when the toolbar lived there, and put the panel a
    // whole screen away from the pill
    if (anchorEl && anchorEl.getBoundingClientRect) {
      var ar = anchorEl.getBoundingClientRect();
      panel.style.left = Math.max(8, Math.min(ar.left + window.scrollX,
        window.scrollX + window.innerWidth - 360)) + 'px';
      panel.style.top = (ar.bottom + window.scrollY + 12) + 'px';
    } else {
      var r = secx.wrapEl.getBoundingClientRect();
      panel.style.left = Math.max(8, r.right + window.scrollX - 360) + 'px';
      panel.style.top = (r.top + window.scrollY + 52) + 'px';
    }
    var pal = pickerPalette();
    panel.innerHTML =
      '<div class="gogh-panel-title">Section background</div>' +
      '<div class="gogh-panel-hint">Theme \u2014 a look for the section and its words</div>' +
      '<div class="gogh-themerow">' +
      sectionThemes().map(function (t) {
        return '<button type="button" class="gogh-themechip' + (secx.theme === t.slug ? ' is-active' : '') + '" data-theme="' + t.slug + '" title="' + escAttr(t.name) + '">' +
          '<span class="gogh-themechip-swatch" style="background:' + escAttr(t.bg) + ';color:var(--wp--preset--color--' + t.ink + ')">Aa</span>' +
          '</button>';
      }).join('') + '</div>' +
      '<div class="gogh-panel-hint">Height</div>' +
      '<div class="gogh-hpresets">' +
      [['s','S',320],['m','M',560],['l','L',800]].map(function (hp) {
        return '<button type="button" class="gogh-hpreset' + (!secx.fill && secx.minH === hp[2] ? ' is-active' : '') + '" data-minh="' + hp[2] + '" title="' + hp[1] + ' — ' + hp[2] + ' units">' + hp[1] + '</button>';
      }).join('') +
      '<button type="button" class="gogh-hpreset gogh-hpreset-fill' + (secx.fill ? ' is-active' : '') + '" title="Fill the screen">Fill screen</button>' +
      '</div>' +
      '<div class="gogh-panel-hint">Image</div>' +
      '<div class="gogh-panel-row gogh-panel-actions">' +
      (cfg.canUpload ? '<label class="gogh-btn gogh-btn-small gogh-upload">Upload<input type="file" accept="image/*" hidden /></label>' : '') +
      (secx.bgImage ? '<button type="button" class="gogh-btn gogh-btn-small gogh-clear">Remove image</button>' : '') +
      '</div>' +
      '<div class="gogh-media"><span class="gogh-media-loading">Loading media…</span></div>' +
      '<button type="button" class="gogh-panel-more-toggle">Colour &amp; more \u2304</button>' +
      '<div class="gogh-panel-more" hidden>' +
      '<div class="gogh-panel-hint">Colour \u2014 with an image, it becomes the tint</div>' +
      '<div class="gogh-swrow gogh-secbg-sw">' +
      '<button type="button" class="gogh-sw gogh-sw-none" data-val="" title="None"></button>' +
      pal.map(function (p) {
        var val = 'var(--wp--preset--color--' + p.slug + ')';
        return '<button type="button" class="gogh-sw' + (secx.bg === val ? ' is-active' : '') + '" data-val="' + val + '"' +
          ' style="background: ' + val + '" title="' + p.slug + '"></button>';
      }).join('') + '</div>' +
      '<div class="gogh-panel-row gogh-panel-actions"><label class="gogh-colorlab">Custom <input type="color" class="gogh-color gogh-secbg-custom" /></label></div>' +
      '<div class="gogh-panel-hint">Transparency</div>' +
      '<div class="gogh-panel-row"><input type="range" class="gogh-secbg-alpha" min="8" max="100" step="1" value="' + (secx.bgA != null ? secx.bgA : (secx.bgImage && secx.bg ? 62 : 100)) + '" style="flex:1" /><span class="gogh-secbg-alpha-val">' + (secx.bgA != null ? secx.bgA : (secx.bgImage && secx.bg ? 62 : 100)) + '</span></div>' +
      '<div class="gogh-panel-row">' +
      '<input type="url" class="gogh-input" placeholder="Paste image URL…" />' +
      '<button type="button" class="gogh-btn gogh-btn-small gogh-apply">Apply</button>' +
      '</div>' +
      '</div>';
    panel.hidden = false;
    panelOpen = true;
    var moreT = panel.querySelector('.gogh-panel-more-toggle');
    if (moreT) moreT.addEventListener('click', function () {
      var more = panel.querySelector('.gogh-panel-more');
      more.hidden = !more.hidden;
      moreT.textContent = more.hidden ? 'Colour & more \u2304' : 'Colour & more \u2303';
    });
    panel.querySelectorAll('.gogh-hpreset').forEach(function (hb) {
      hb.addEventListener('click', function () {
        pushState();
        if (hb.classList.contains('gogh-hpreset-fill')) {
          secx.fill = !secx.fill;
        } else {
          secx.minH = +hb.dataset.minh;
          secx.fill = false;
        }
        renderSection(secx);
        resolveAll();
        panel.querySelectorAll('.gogh-hpreset').forEach(function (o) {
          var on = o.classList.contains('gogh-hpreset-fill') ? secx.fill
            : (!secx.fill && secx.minH === +o.dataset.minh);
          o.classList.toggle('is-active', on);
        });
      });
    });
    var themeDefs = sectionThemes();
    panel.querySelectorAll('.gogh-themechip').forEach(function (tc) {
      tc.addEventListener('click', function () {
        var t = themeDefs.filter(function (x) { return x.slug === tc.dataset.theme; })[0];
        if (!t) return;
        applySectionTheme(idx, t);
        panel.querySelectorAll('.gogh-themechip').forEach(function (o) {
          o.classList.toggle('is-active', o === tc);
        });
      });
    });
    panel.querySelectorAll('.gogh-secbg-sw .gogh-sw').forEach(function (swb) {
      swb.addEventListener('click', function () {
        secx.bg = swb.dataset.val || null;
        secx.theme = null;
        syncBootInvite(secx);
        resolveAll();
        pushState();
        contrastSentinel(secx);
        panel.querySelectorAll('.gogh-secbg-sw .gogh-sw').forEach(function (b2) {
          b2.classList.toggle('is-active', b2 === swb && !!swb.dataset.val);
        });
      });
    });
    var custom = panel.querySelector('.gogh-secbg-custom');
    if (secx.bg && secx.bg.charAt(0) === '#') custom.value = secx.bg;
    custom.addEventListener('input', function () {
      secx.bg = this.value;
      syncBootInvite(secx);
      resolveAll();
    });
    custom.addEventListener('change', function () {
      pushState();
      contrastSentinel(secx);
    });
    var alpha = panel.querySelector('.gogh-secbg-alpha');
    var alphaVal = panel.querySelector('.gogh-secbg-alpha-val');
    alpha.addEventListener('input', function () {
      secx.bgA = +this.value;
      alphaVal.textContent = this.value;
      resolveAll();
    });
    alpha.addEventListener('change', function () {
      pushState();
      contrastSentinel(secx);
    });
    var input = panel.querySelector('input[type="url"]');
    input.value = secx.bgImage || '';
    panel.querySelector('.gogh-apply').addEventListener('click', function () {
      setSecBg(idx, input.value.trim() || null);
    });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') setSecBg(idx, input.value.trim() || null);
      if (ev.key === 'Escape') closePanel();
    });
    var clear = panel.querySelector('.gogh-clear');
    if (clear) clear.addEventListener('click', function () { setSecBg(idx, null); });
    var file = panel.querySelector('input[type="file"]');
    if (file) {
      file.addEventListener('change', function () {
        if (!file.files.length) return;
        var fd = new FormData();
        fd.append('file', file.files[0]);
        var label = panel.querySelector('.gogh-upload');
        label.firstChild.textContent = 'Uploading…';
        fetch(cfg.mediaUrl, {
          method: 'POST',
          headers: { 'X-WP-Nonce': cfg.nonce },
          credentials: 'same-origin',
          body: fd,
        }).then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        }).then(function (item) {
          setSecBg(idx, item.source_url, item.id);
        }).catch(function (err) {
          label.firstChild.textContent = 'Upload failed';
          console.error('gogh upload failed:', err);
        });
      });
    }
    fetch(restQ(cfg.mediaUrl, 'per_page=12&media_type=image&orderby=date&order=desc'), {
      headers: { 'X-WP-Nonce': cfg.nonce },
      credentials: 'same-origin',
    }).then(function (res) { return res.ok ? res.json() : []; }).catch(function () { return []; })
      .then(function (items) {
        var box = panel.querySelector('.gogh-media');
        if (!box || panel.hidden) return;
        box.innerHTML = '';
        // a section BACKGROUND wants big, wide-ish images — logos, cutouts
        // and portraits are noise on this shelf (Upload and the URL row
        // still take anything); an over-strict filter falls back to recency
        var bgish = items.filter(function (it) {
          var d = it.media_details || {};
          return d.width >= 700 && d.width >= (d.height || 0) * 0.75;
        }).slice(0, 8);
        items = bgish.length ? bgish : items.slice(0, 8);
        items.forEach(function (item) {
          var thumb = (item.media_details && item.media_details.sizes &&
            (item.media_details.sizes.thumbnail || item.media_details.sizes.medium));
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'gogh-thumb' + (S[idx].bgImage === item.source_url ? ' is-active' : '');
          b.style.backgroundImage = 'url("' + (thumb ? thumb.source_url : item.source_url) + '")';
          b.addEventListener('click', function () {
            setSecBg(idx, item.source_url, item.id);
            box.querySelectorAll('.gogh-thumb').forEach(function (o) {
              o.classList.toggle('is-active', o === b);
            });
          });
          box.appendChild(b);
        });
        reclampPanel();
      });
  }

  // ---------- divider / colours chooser at boundaries ----------
  var shapeBtn = document.createElement('button');
  shapeBtn.type = 'button';
  shapeBtn.className = 'gogh-shapebtn';
  shapeBtn.textContent = '◠ Transition';
  shapeBtn.hidden = true;
  document.body.appendChild(shapeBtn);
  var shapePanel = document.createElement('div');
  shapePanel.className = 'gogh-panel gogh-shapepanel';
  shapePanel.hidden = true;
  document.body.appendChild(shapePanel);
  var shapeIdx = null; // boundary index: divider on S[shapeIdx-1], colours above/below

  function closeShapePanel() { shapePanel.hidden = true; }
  function openShapePanel(idx) {
    shapeIdx = idx;
    var above = S[idx - 1], below = S[idx];
    var current = (above.divider && above.divider.shape) || '';
    var shapes = [
      { key: '', label: 'None', path: 'M0,110 L1200,110' },
      { key: 'wave', label: 'Wave', path: DIVIDER_PATHS.wave },
      { key: 'curve', label: 'Curve', path: DIVIDER_PATHS.curve },
      { key: 'slant', label: 'Slant', path: DIVIDER_PATHS.slant },
      { key: 'peaks', label: 'Peaks', path: DIVIDER_PATHS.peaks },
      { key: 'brush', label: 'Brush', path: DIVIDER_PATHS.brush },
      { key: 'torn', label: 'Torn', path: DIVIDER_PATHS.torn },
      { key: 'melt', label: 'Melt', melt: true },
    ];
    shapePanel.innerHTML =
      '<div class="gogh-panel-title">Section transition</div>' +
      '<div class="gogh-shapes">' +
      shapes.map(function (sh) {
        var icon = sh.melt
          ? '<span class="gogh-shape-melt"></span>'
          : '<svg viewBox="0 0 1200 120" preserveAspectRatio="none"><path d="' + sh.path + '"/></svg>';
        return '<button type="button" class="gogh-shape' + (sh.key === current ? ' is-active' : '') + '" data-shape="' + sh.key + '" title="' + sh.label + '">' +
          icon + '<span>' + sh.label + '</span></button>';
      }).join('') +
      '</div>' +
      '<div class="gogh-panel-row gogh-panel-actions">' +
      '<label class="gogh-colorlab">Above <input type="color" class="gogh-color gogh-color-above" /></label>' +
      '<label class="gogh-colorlab">Below <input type="color" class="gogh-color gogh-color-below" /></label>' +
      '</div>' +
      (function () {
        var pal = pickerPalette();
        if (!pal.length) return '';
        var sw = function (which) {
          return '<div class="gogh-swrow"><span class="gogh-swlab">' + which + '</span>' +
            '<button type="button" class="gogh-sw gogh-sw-none" data-which="' + which + '" data-val="" title="Theme default"></button>' +
            pal.map(function (p) {
              return '<button type="button" class="gogh-sw" data-which="' + which + '"' +
                ' data-val="var(--wp--preset--color--' + p.slug + ')"' +
                ' style="background: var(--wp--preset--color--' + p.slug + ')" title="' + p.slug + '"></button>';
            }).join('') + '</div>';
        };
        return '<div class="gogh-panel-title" style="margin-top:12px">Theme palette</div>' + sw('above') + sw('below');
      })() +
      '<label class="gogh-fxpull" style="margin-top:12px">Overlap the section above' +
      '<input type="range" class="gogh-pull" min="0" max="180" step="12" /></label>';
    var r = { top: (S[idx - 1].wrapEl.getBoundingClientRect().bottom + window.scrollY) };
    shapePanel.style.left = 'calc(50% - 170px)';
    shapePanel.style.top = (r.top + 16) + 'px';
    shapePanel.hidden = false;
    shapePanel.querySelector('.gogh-color-above').value = above.bg || '#0f0e0c';
    shapePanel.querySelector('.gogh-color-below').value = below.bg || '#0f0e0c';
    shapePanel.querySelectorAll('.gogh-shape').forEach(function (btn) {
      btn.addEventListener('click', function () {
        above.divider = btn.dataset.shape ? { shape: btn.dataset.shape } : null;
        resolveAll();
        pushState();
        shapePanel.querySelectorAll('.gogh-shape').forEach(function (b) {
          b.classList.toggle('is-active', b === btn);
        });
      });
    });
    shapePanel.querySelector('.gogh-color-above').addEventListener('input', function () {
      above.bg = this.value;
      resolveAll();
    });
    shapePanel.querySelector('.gogh-color-below').addEventListener('input', function () {
      below.bg = this.value;
      resolveAll();
    });
    shapePanel.querySelectorAll('.gogh-color').forEach(function (inp) {
      inp.addEventListener('change', pushState);
    });
    shapePanel.querySelectorAll('.gogh-sw').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = btn.dataset.which === 'above' ? above : below;
        target.bg = btn.dataset.val || null;
        resolveAll();
        pushState();
      });
    });
    // reveal/curtain UI removed for simplicity \u2014 existing sections that
    // carry those flags still render them (published pages stay intact)
    shapePanel.querySelector('.gogh-pull').value = (below.fx && below.fx.pull) || 0;
    var pullInp = shapePanel.querySelector('.gogh-pull');
    pullInp.addEventListener('input', function () {
      below.fx = below.fx || {};
      below.fx.pull = +this.value || 0;
      resolveAll();
    });
    pullInp.addEventListener('change', pushState);
  }
  shapeBtn.addEventListener('click', function () {
    if (shapeIdx !== null) openShapePanel(shapeIdx);
  });
  document.addEventListener('pointerdown', function (ev) {
    if (!shapePanel.hidden && !shapePanel.contains(ev.target) && ev.target !== shapeBtn) closeShapePanel();
  });

  // ---------- between-section inserter + height handle proximity ----------
  var insertRaf = false;
  document.addEventListener('pointermove', function (ev) {
    if (!editing || drag || resize || hDrag || rotD || panelOpen || !picker.hidden) { return; }
    if (insertRaf) return;
    insertRaf = true;
    var cy = ev.clientY;
    requestAnimationFrame(function () {
      insertRaf = false;
      if (hDrag) return;
      var found = null;
      // boundaries belong to page content — ALL of it: freeform sections,
      // pending pattern holders, and stored native blocks alike. (none
      // above the site header, none below the site footer)
      var secOf = function (n2) {
        for (var s2 = 0; s2 < S.length; s2++) {
          if (!S[s2].chrome && S[s2].wrapEl === n2) return S[s2];
        }
        return null;
      };
      var bNodes = [];
      [].slice.call(pageParent.children).forEach(function (bn) {
        if (!bn.classList || bn.tagName === 'STYLE' || bn.tagName === 'SCRIPT') return;
        if (bn.classList.contains('gogh-wrap')) {
          if (secOf(bn)) bNodes.push(bn);
        } else if (bn.classList.contains('gogh-pending') ||
          (bn.textContent || '').trim().length > 0 || bn.querySelector('img,iframe,video,svg,canvas')) {
          bNodes.push(bn);
        }
      });
      for (var bi = 0; bi <= bNodes.length && bNodes.length; bi++) {
        var node, by;
        if (bi < bNodes.length) {
          node = bNodes[bi];
          by = node.getBoundingClientRect().top;
        } else {
          node = null;
          by = bNodes[bNodes.length - 1].getBoundingClientRect().bottom;
        }
        if (Math.abs(cy - by) < 28) {
          found = { node: node, y: by, prevNode: bi > 0 ? bNodes[bi - 1] : null, first: bi === 0 };
          break;
        }
      }
      if (found) {
        // model index: the first content section at or after the anchor
        var sIdx = null;
        if (found.node) {
          for (var n3 = found.node; n3 && sIdx === null; n3 = n3.nextElementSibling) {
            var so = secOf(n3);
            if (so) sIdx = S.indexOf(so);
          }
        }
        insertIdx = sIdx === null ? clampInsertIdx(S.length) : sIdx;
        insertBefore = found.node;
        // the section above this boundary, if it IS a section — the height
        // pill and the divider button are freeform-only affordances
        var prevSec = found.prevNode ? secOf(found.prevNode)
          : (found.first && S[insertIdx - 1] && S[insertIdx - 1].chrome ? S[insertIdx - 1] : null);
        var nextSec = found.node ? secOf(found.node) : null;
        // at the very bottom of the screen the pills would clip — keep them
        // reachable just inside the viewport
        found.y = Math.min(found.y, window.innerHeight - 36);
        // the TOP boundary shares its corner with the fixed Change-header
        // pill — keep + Section below it instead of cropping into it
        if (found.first) found.y = Math.max(found.y, 132);
        // anchor to the block's own centre — themes with padded layouts
        // (Ollie) don't run sections to the viewport edge, so 50% drifts
        var refNode = found.node || bNodes[bNodes.length - 1];
        var refR = refNode.getBoundingClientRect();
        var cx = refR.left + refR.width / 2 + window.scrollX;
        inserter.style.left = (prevSec ? (cx - 40) : cx) + 'px';
        // the height pill (44px) occupies the centre of every boundary whose
        // upper neighbour is freeform — + Section reads first (left),
        // Transition after (right), each 18px from the pill (22 + 18 = 40)
        inserter.style.transform = prevSec ? 'translate(-100%, -50%)' : 'translate(-50%, -50%)';
        inserter.style.marginLeft = '0';
        inserter.style.top = (found.y + window.scrollY) + 'px';
        inserter.classList.remove('gogh-byebye');
        inserter.hidden = false;
        if (prevSec) placeHbar(prevSec); else hideHbar();
        if (prevSec && nextSec && S.indexOf(nextSec) === S.indexOf(prevSec) + 1) {
          shapeIdx = S.indexOf(nextSec);
          shapeBtn.style.left = (cx + 40) + 'px';
          shapeBtn.style.top = (found.y + window.scrollY) + 'px';
          shapeBtn.classList.remove('gogh-byebye');
          // un-gated: the φ sweep caught Transition by mistake — James
          // uses it ("where has section transition gone?")
          shapeBtn.hidden = false;
        } else {
          shapeBtn.hidden = true;
        }
        hideSecBar();
      } else {
        if (!inserter.matches(':hover')) goghFadeOut(inserter);
        if (!hgrip.matches(':hover')) hideHbar();
        if (!shapeBtn.matches(':hover')) goghFadeOut(shapeBtn);
        // not near a boundary: offer section actions for the hovered section
        if (!secBar.matches(':hover')) {
          var hov = null;
          for (var si = 0; si < S.length; si++) {
            var wr = S[si].wrapEl.getBoundingClientRect();
            if (cy >= wr.top && cy <= wr.bottom) { hov = si; break; }
          }
          if (hov !== null) showSecBar(hov); else hideSecBar();
        }
      }
    });
  }, { passive: true });
  inserter.addEventListener('click', function () {
    inserter.hidden = true;
    openPicker(insertIdx == null ? S.length : insertIdx, insertBefore);
  });

  // ---------- dragging with ghost (no cursor drift) ----------
  var drag = null, dragRaf = false;
  var ghost = null;
  // ---------- cards: joining, leaving, and editing kids ----------
  // dropping an element FULLY inside a plain box makes it a kid of that
  // card (one level only; boxes never join boxes)
  var SETTLE_TYPES = { heading: 1, para: 1, button: 1, badge: 1 };
  function settleKid(host, kid) {
    // a card reads as a stack: TEXTY kids dropped roughly onto other texty
    // kids tuck below them instead of sharing grid cells (which renders as
    // genuine overlap). Images and boxes are exempt — text over a photo is
    // a design, not an accident.
    if (!SETTLE_TYPES[kid.type]) return;
    var moved = true, guard = 0;
    while (moved && guard++ < 8) {
      moved = false;
      (host.kids || []).forEach(function (ok) {
        if (ok === kid || !SETTLE_TYPES[ok.type]) return;
        var ox = Math.min(kid.x + kid.w, ok.x + ok.w) - Math.max(kid.x, ok.x);
        var oy = Math.min(kid.y + kid.h, ok.y + ok.h) - Math.max(kid.y, ok.y);
        if (ox > 12 && oy > 12) { kid.y = ok.y + ok.h + 12; moved = true; }
      });
    }
    if (kid.y + kid.h > host.h) host.h = kid.y + kid.h + 16;
  }
  function cardJoinTarget(sec, i) {
    var e = sec.els[i];
    if (!e || e.type === 'box') return -1;
    for (var b = sec.els.length - 1; b >= 0; b--) {
      if (b === i) continue;
      var o = sec.els[b];
      if (o.type !== 'box' || o.shape) continue;
      if (e.x >= o.x - 2 && e.y >= o.y - 2 &&
          e.x + e.w <= o.x + o.w + 2 && e.y + e.h <= o.y + o.h + 2) return b;
    }
    return -1;
  }
  // ---------- wrap: an image dropped into flowing text floats there, and
  // the words pour around its silhouette (shape-outside on its own alpha) --
  function wrapTargetIdx(sec, i) {
    var e = sec.els[i];
    if (!e || e.type !== 'image' || !e.src) return -1;
    var cx2 = e.x + e.w / 2;
    for (var t2 = 0; t2 < sec.els.length; t2++) {
      if (t2 === i) continue;
      var o = sec.els[t2];
      if (o.type !== 'para' || !(o.text || '').trim()) continue;
      // paragraphs auto-shrink to their text, so centre-inside is too
      // strict: intent is the image sitting ON the text — horizontally
      // centred over it with real vertical overlap
      var yInter = Math.min(e.y + e.h, o.y + o.h) - Math.max(e.y, o.y);
      var xInter = Math.min(e.x + e.w, o.x + o.w) - Math.max(e.x, o.x);
      // one grid square of real contact is intent enough — paras auto-shrink
      // to their text, so a taller demand misses honest drops on short copy
      if (cx2 >= o.x && cx2 <= o.x + o.w && yInter >= 8 && xInter >= e.w * 0.3) return t2;
    }
    return -1;
  }
  function wrapImageIntoText(sec, i, ti, cx, cy) {
    var e = sec.els[i];
    var t = sec.els[ti];
    var side = (e.x + e.w / 2) < (t.x + t.w / 2) ? 'left' : 'right';
    var pct = Math.max(25, Math.min(60, Math.round(e.w / t.w * 100)));
    var style = 'float:' + side + ';width:' + pct + '%;' +
      (side === 'left' ? 'margin:4px 18px 8px 0;' : 'margin:4px 0 8px 18px;') +
      'shape-outside:url("' + String(e.src).replace(/"/g, '%22') + '");' +
      'shape-image-threshold:0.5;shape-margin:16px;';
    // a float starts wrapping at the line it sits on, so the drop point
    // decides where in the text the wrap begins: insert at the caret under
    // the pointer (clamped into the paragraph, since the resolver may have
    // nudged it since the pointer let go); top-of-text is the fallback
    var placed = false;
    if (cx != null && cy != null && document.caretRangeFromPoint) {
      var host = sec.nodes[ti];
      if (host && host.tagName !== 'P') host = host.querySelector('p') || host;
      var dragNode = sec.nodes[i];
      var prevDisp = dragNode ? dragNode.style.display : '';
      if (dragNode) dragNode.style.display = 'none';
      var cr = null;
      try {
        var hr = host.getBoundingClientRect();
        cr = document.caretRangeFromPoint(
          Math.max(hr.left + 2, Math.min(hr.right - 2, cx)),
          Math.max(hr.top + 2, Math.min(hr.bottom - 2, cy)));
      } catch (err) {}
      if (dragNode) dragNode.style.display = prevDisp;
      if (cr && host && host.contains(cr.startContainer)) {
        var im = document.createElement('img');
        im.className = 'gogh-wrapped';
        im.src = e.src;
        if (e.alt) im.alt = e.alt;
        im.setAttribute('style', style);
        cr.insertNode(im);
        t.text = cleanInline(host.innerHTML);
        placed = true;
      }
    }
    if (!placed) {
      t.text = '<img class="gogh-wrapped" src="' + escAttr(e.src) + '" alt="' + escAttr(e.alt || '') + '"' +
        ' style="' + escAttr(style) + '">' + (t.text || '');
    }
    sec.els.splice(i, 1);
    renderSection(sec);
    return ti > i ? ti - 1 : ti;
  }
  function openWrapPanel(img) {
    var node = img.closest('[class*="gogh-el-"]');
    var wrapEl = img.closest('.gogh-wrap');
    var sec = null;
    S.forEach(function (s2) { if (s2.wrapEl === wrapEl) sec = s2; });
    if (!sec || !node) return;
    var ei = sec.nodes.indexOf(node);
    if (ei === -1) return;
    var t = sec.els[ei];
    var host = node.querySelector('p') || node;
    var getStyle = function (prop, fb) {
      var m = (img.getAttribute('style') || '').match(new RegExp(prop + ':([^;]+)'));
      return m ? m[1].trim() : fb;
    };
    var syncModel = function () {
      t.text = cleanInline(host.innerHTML);
      pushState();
    };
    var setStyle = function (prop, val) {
      var st = img.getAttribute('style') || '';
      st = st.replace(new RegExp(prop + ':[^;]+;?', 'g'), '');
      img.setAttribute('style', st + prop + ':' + val + ';');
    };
    panel.innerHTML =
      '<div class="gogh-panel-title">Wrapped image</div>' +
      '<em class="gogh-panel-hint">The words flow around it \u2014 tune the fit.</em>' +
      '<div class="gogh-panel-row gogh-wrapside"><span>Side</span>' +
      '<button type="button" class="gogh-btn gogh-btn-small" data-side="left">Left</button>' +
      '<button type="button" class="gogh-btn gogh-btn-small" data-side="right">Right</button></div>' +
      '<div class="gogh-panel-row gogh-logosize"><span>Size</span><input type="range" min="25" max="60" step="1" class="gogh-wrapw" /><span class="gogh-logosize-val gogh-wrapw-val"></span></div>' +
      '<div class="gogh-panel-row gogh-logosize"><span>Breathing room</span><input type="range" min="0" max="48" step="2" class="gogh-wrapm" /><span class="gogh-logosize-val gogh-wrapm-val"></span></div>' +
      '<div class="gogh-panel-row gogh-panel-actions"><button type="button" class="gogh-btn gogh-btn-small gogh-unwrap">Unwrap \u2014 back to freeform</button></div>';
    placePanelNear(img);
    panelOpen = true;
    panel.querySelectorAll('[data-side]').forEach(function (b) {
      b.addEventListener('click', function () {
        var sd = b.getAttribute('data-side');
        setStyle('float', sd);
        setStyle('margin', sd === 'left' ? '4px 18px 8px 0' : '4px 0 8px 18px');
        syncModel();
      });
    });
    var wIn = panel.querySelector('.gogh-wrapw');
    var wVal = panel.querySelector('.gogh-wrapw-val');
    wIn.value = parseInt(getStyle('width', '40%'), 10) || 40;
    wVal.textContent = wIn.value + '%';
    wIn.addEventListener('input', function () {
      wVal.textContent = wIn.value + '%';
      setStyle('width', wIn.value + '%');
    });
    wIn.addEventListener('change', syncModel);
    var mIn = panel.querySelector('.gogh-wrapm');
    var mVal = panel.querySelector('.gogh-wrapm-val');
    mIn.value = parseInt(getStyle('shape-margin', '16px'), 10) || 16;
    mVal.textContent = mIn.value + 'px';
    mIn.addEventListener('input', function () {
      mVal.textContent = mIn.value + 'px';
      setStyle('shape-margin', mIn.value + 'px');
    });
    mIn.addEventListener('change', syncModel);
    panel.querySelector('.gogh-unwrap').addEventListener('click', function () {
      var side = getStyle('float', 'left');
      var pct = parseInt(getStyle('width', '40%'), 10) || 40;
      var iw = Math.round(t.w * pct / 100);
      var ratio = (img.naturalHeight && img.naturalWidth) ? img.naturalHeight / img.naturalWidth : 0.66;
      var back = {
        type: 'image', src: img.getAttribute('src'), alt: img.getAttribute('alt') || '',
        x: side === 'left' ? Math.max(0, t.x - Math.round(iw / 2)) : Math.min(W - iw, t.x + t.w - Math.round(iw / 2)),
        y: t.y, w: iw, h: Math.round(iw * ratio),
      };
      img.remove();
      t.text = cleanInline(host.innerHTML);
      sec.els.push(back);
      renderSection(sec);
      closePanel();
      pushState();
      toast('Back to freeform \u2014 drag it anywhere.', { actions: [{ label: 'Undo', onClick: function () { undo(); } }] });
    });
  }
  document.addEventListener('click', function (ev) {
    if (!editing) return;
    var wimg = ev.target.closest && ev.target.closest('.gogh-section img.gogh-wrapped');
    if (!wimg) return;
    ev.preventDefault();
    ev.stopPropagation();
    openWrapPanel(wimg);
  }, true);
  var joinGlowNode = null;
  function setJoinGlow(node) {
    if (joinGlowNode === node) return;
    if (joinGlowNode) joinGlowNode.classList.remove('gogh-card-glow');
    joinGlowNode = node;
    if (node) node.classList.add('gogh-card-glow');
  }
  function beginDrag(ev) {
    if (!editing || !sel) return;
    closePanel();
    exitTextEdit();
    if (ev.altKey) {
      // alt-drag: duplicate in place, then drag the copy
      var dsec = sel.sec;
      var dcopy = JSON.parse(JSON.stringify(dsec.els[sel.i]));
      dsec.els.push(dcopy);
      renderSection(dsec);
      placeHandles(dsec, dsec.els.length - 1);
    }
    try { if (ev.target && ev.target.setPointerCapture) ev.target.setPointerCapture(ev.pointerId); } catch (err) {}
    var sec = sel.sec, i = sel.i;
    var e = sec.els[i];
    var node = sec.nodes[i];
    var r = node.getBoundingClientRect();
    // a rotated element's client rect is its INFLATED bounding box — sizing
    // the ghost to it stretches the clone, and the scoped rotate then spins
    // that inflated copy into the 'two badges' weirdness. Use the true
    // unrotated size, centred where the element's centre is (rotation-safe).
    var gL = r.left, gT = r.top, gW = r.width, gH = r.height;
    if (e.rot) {
      var gs = scaleOf(sec);
      gW = e.w * gs;
      gH = e.h * gs;
      gL = r.left + (r.width - gW) / 2;
      gT = r.top + (r.height - gH) / 2;
    }
    // ghost rides inside a wrapper carrying the section's scope classes so
    // the scoped element styles (colours, fonts) apply outside the section
    var inner = node.cloneNode(true);
    inner.classList.remove('gogh-selected');
    inner.removeAttribute('contenteditable');
    inner.querySelectorAll('[contenteditable]').forEach(function (n) { n.removeAttribute('contenteditable'); });
    inner.style.width = '100%';
    inner.style.height = '100%';
    ghost = document.createElement('div');
    ghost.className = 'gogh-wrap gogh-section ' + sec.scope + ' gogh-ghostel';
    ghost.style.cssText = 'position:fixed;display:block;background:transparent;container-type:normal;left:' + gL + 'px;top:' + gT + 'px;width:' + gW + 'px;height:' + gH + 'px;';
    ghost.appendChild(inner);
    document.body.appendChild(ghost);
    node.classList.add('gogh-dragsrc');
    dropBox.hidden = false;
    drag = { sec: sec, i: i, px: ev.clientX, py: ev.clientY, x: e.x, y: e.y, gx: gL, gy: gT };
    // centring a text box whose words don't fill it centres the BOX, not the
    // ink — measure the rendered text so its visual centre snaps too
    if (isText(e) || e.type === 'badge') {
      try {
        var thost = node.querySelector('p,h1,h2,h3,h4,h5,h6') || node;
        var trng = document.createRange();
        trng.selectNodeContents(thost);
        var tw = trng.getBoundingClientRect().width / scaleOf(sec);
        if (tw > 0 && tw < e.w - 4) {
          var talign = e.align || 'left';
          drag.textCXOff = talign === 'center' ? null
            : (talign === 'right' ? e.w - tw / 2 : tw / 2);
        }
      } catch (err) {}
    }
    sec.sectionEl.classList.add('gogh-grid-live');
    if (multiSel && multiSel.sec === sec && multiSel.idxs.indexOf(i) !== -1) {
      drag.multi = multiSel.idxs.filter(function (j) { return j !== i; }).map(function (j) {
        return { j: j, x: sec.els[j].x, y: sec.els[j].y };
      });
    }
    document.documentElement.classList.add('gogh-dragging');
    hideBoundaryUI();
    hideHandles();
  }
  grip.addEventListener('pointerdown', function (ev) {
    ev.preventDefault();
    beginDrag(ev);
  });
  document.addEventListener('pointermove', function (ev) {
    if (!drag) return;
    drag.cx = ev.clientX; drag.cy = ev.clientY;
    var dx = ev.clientX - drag.px, dy = ev.clientY - drag.py;
    var lockX = false, lockY = false;
    if (ev.shiftKey) {
      // constrain to the dominant axis — the locked axis is PINNED (no snap)
      if (Math.abs(dx) > Math.abs(dy)) { dy = 0; lockY = true; }
      else { dx = 0; lockX = true; }
    }
    if (ghost) ghost.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    var free = ev.metaKey || ev.ctrlKey;
    drag.freeHeld = free;
    var sec = drag.sec;
    var s = scaleOf(sec);
    var e = sec.els[drag.i];
    var rx = Math.max(0, Math.min(W - e.w, drag.x + dx / s));
    var ry = Math.max(0, drag.y + dy / s);
    var sn = snapPos(sec, e, rx, ry, e.w, e.h, free, drag.textCXOff);
    e.x = Math.max(0, Math.min(W - e.w, sn.x));
    e.y = Math.max(0, sn.y);
    if (lockX) { e.x = drag.x; sn.gx = null; }
    if (lockY) { e.y = drag.y; sn.gy = null; }
    drag.gxCap = sn.gx !== null;
    drag.gyCap = sn.gy !== null;
    drag.lockedX = lockX;
    drag.lockedY = lockY;
    // equal-spacing: when between two neighbours, the midpoint captures the
    // RAW pointer position and takes priority over edge snap — otherwise a
    // nearby alignment candidate (or 8-grid parity) can make equal gaps
    // unreachable
    drag.eqH = false;
    drag.eqV = false;
    if (!free) {
      var nb = neighbors(sec, e);
      if (!lockX && nb.L && nb.R) {
        var xEq = (nb.L.x + nb.L.w + nb.R.x - e.w) / 2;
        if (xEq >= nb.L.x + nb.L.w && Math.abs(rx - xEq) < 8) {
          e.x = xEq; sn.gx = null; drag.eqH = true; // exact midpoint: gaps truly equal
        }
      }
      if (!lockY && nb.T && nb.B) {
        var yEq = (nb.T.y + nb.T.h + nb.B.y - e.h) / 2;
        if (yEq >= nb.T.y + nb.T.h && Math.abs(ry - yEq) < 8) {
          e.y = yEq; sn.gy = null; drag.eqV = true;
        }
      }
    }
    if (drag.multi) {
      var mdx = e.x - drag.x, mdy = e.y - drag.y;
      drag.multi.forEach(function (mm) {
        var o = sec.els[mm.j];
        o.x = Math.max(0, Math.min(W - o.w, mm.x + mdx));
        o.y = Math.max(0, mm.y + mdy);
      });
    }
    if (!dragRaf) {
      dragRaf = true;
      requestAnimationFrame(function () {
        dragRaf = false;
        if (!drag) return;
        resolveAndApply(sec);
        showGuides(sec, sn.gx, sn.gy);
        drawDists(sec, drag.i, drag.eqH, drag.eqV);
        var b2 = nodeBox(visualNode(sec, drag.i));
        dropBox.style.left = b2.x + 'px';
        dropBox.style.top = b2.y + 'px';
        dropBox.style.width = b2.w + 'px';
        dropBox.style.height = b2.h + 'px';

        if (!drag.multi) {
          var jt = cardJoinTarget(sec, drag.i);
          if (jt === -1) {
            var wg = wrapTargetIdx(sec, drag.i);
            setJoinGlow(wg !== -1 ? sec.nodes[wg] : null);
          } else {
            setJoinGlow(sec.nodes[jt]);
          }
        }
      });
    }
  });
  function endDrag() {
    if (!drag) return;
    var sec = drag.sec, i = drag.i;
    var multiD = drag.multi || null;
    var gxCapD = !!drag.gxCap, gyCapD = !!drag.gyCap;
    var eqHD = !!drag.eqH, eqVD = !!drag.eqV;
    var lockedXD = !!drag.lockedX, lockedYD = !!drag.lockedY;
    var dropCX = drag.cx, dropCY = drag.cy;
    var freeD = !!drag.freeHeld;
    sec.sectionEl.classList.remove('gogh-grid-live');
    var ghostTop = null;
    if (ghost) {
      ghostTop = ghost.getBoundingClientRect().top + window.scrollY;
      ghost.remove();
      ghost = null;
    }
    dropBox.hidden = true;
    hideDists();
    sec.nodes[i].classList.remove('gogh-dragsrc');
    drag = null;
    document.documentElement.classList.remove('gogh-dragging');
    hideGuides();
    measureTextHeights(sec);
    resolveAndApply(sec);
    // the grid can render rows taller than the model predicts (theme fonts,
    // button padding stretch max-content rows), so the linear pointer→model
    // mapping lands low — correct until the element sits where the ghost was
    if (ghostTop !== null) {
      var totalCorr = 0;
      for (var pass = 0; pass < 2; pass++) {
        var b = nodeBox(sec.nodes[i]);
        var dDesign = Math.round((ghostTop - b.y) / scaleOf(sec));
        if (Math.abs(dDesign) < 3) break;
        sec.els[i].y = Math.max(0, sec.els[i].y + dDesign);
        totalCorr += dDesign;
        resolveAndApply(sec);
      }
      if (multiD && totalCorr) {
        multiD.forEach(function (mm) {
          var o = sec.els[mm.j];
          o.y = Math.max(0, o.y + totalCorr);
        });
        resolveAndApply(sec);
      }
    }
    // the visible grid is a promise: axes the grid governed at release must
    // land ON it (alignment/equal-spacing/shift-locked axes keep their own
    // promises and are left alone) — the grid shows on every drag now, so
    // every drop keeps the promise unless ⌘ asked for full freedom
    if (!freeD) {
      var eDrop = sec.els[i];
      if (!gxCapD && !eqHD && !lockedXD) eDrop.x = Math.max(0, Math.min(W - eDrop.w, Math.round(eDrop.x / BASE) * BASE));
      if (!gyCapD && !eqVD && !lockedYD) eDrop.y = Math.max(0, Math.round(eDrop.y / BASE) * BASE);
      resolveAndApply(sec);
    }
    setJoinGlow(null);
    if (!multiD) {
      var wti = wrapTargetIdx(sec, i);
      if (wti !== -1) {
        wrapImageIntoText(sec, i, wti, dropCX, dropCY);
        sel = null;
        hideHandles();
        closePanel();
        pushState();
        toast('Wrapped \u2014 the words flow around it now. Click the image to adjust.',
          { actions: [{ label: 'Undo', onClick: function () { undo(); } }] });
        return;
      }
      var jb = cardJoinTarget(sec, i);
      if (jb !== -1) {
        var kid = sec.els[i];
        sec.els.splice(i, 1);
        var host = sec.els[jb > i ? jb - 1 : jb];
        var adopt = [kid];
        if (!(host.kids && host.kids.length)) {
          // an overlay-style card (converted patterns compose this way: a
          // plain box with elements sitting ON it, not in it). Joining only
          // the dropped element would make a one-kid grid that stretches it
          // weirdly while the overlay text stacks by different rules on
          // mobile — so the first join promotes the box to a TRUE card:
          // everything fully on it becomes a kid together
          for (var q = sec.els.length - 1; q >= 0; q--) {
            var oe = sec.els[q];
            if (oe === host || oe.type === 'box') continue;
            if (oe.x >= host.x - 2 && oe.y >= host.y - 2 &&
                oe.x + oe.w <= host.x + host.w + 2 &&
                oe.y + oe.h <= host.y + host.h + 2) {
              sec.els.splice(q, 1);
              adopt.push(oe);
            }
          }
          // reading order — kids render in array order
          adopt.sort(function (a2, b2) { return (a2.y - b2.y) || (a2.x - b2.x); });
        }
        host.kids = host.kids || [];
        adopt.forEach(function (k2) {
          k2.x = Math.max(0, Math.round(k2.x - host.x));
          k2.y = Math.max(0, Math.round(k2.y - host.y));
          host.kids.push(k2);
        });
        settleKid(host, kid);
        sel = null;
        hideHandles();
        closePanel();
        renderSection(sec);
        pushState();
        toast('Added to the card \u2014 it moves and stacks with it now.',
          { actions: [{ label: 'Undo', onClick: function () { undo(); } }] });
        return;
      }
    }
    if (multiD) { sel = null; } else { placeHandles(sec, i); }
    pushState();
  }
  // ---------- kid selection, movement, escape, and text ----------
  var kidSel = null; // {sec, ci, j, node}
  var kidDrag = null;
  var kidEd = null; // text editing inside a kid
  function clearKidSel() {
    if (!kidSel) return;
    if (kidSel.node && kidSel.node.classList) kidSel.node.classList.remove('gogh-kid-selected');
    kidSel = null;
  }
  function exitKidEd() {
    if (!kidEd) return;
    document.documentElement.classList.remove('gogh-textediting');
    kidEd.node.removeAttribute('contenteditable');
    if (document.activeElement === kidEd.node) kidEd.node.blur();
    kidEd = null;
    pushState();
  }
  function openKidLinkPanel(sec, ci, j) {
    var hostEl = sec.els[ci];
    var kid = hostEl && hostEl.kids && hostEl.kids[j];
    if (!kid) return;
    buildLinkPanelFor(sec, kid, function () {
      renderSection(sec);
      pushState();
      var card = sec.nodes[ci];
      var kn2 = card && card.querySelector('.gogh-k-' + (j + 1));
      if (kn2) {
        clearKidSel();
        kidSel = { sec: sec, ci: ci, j: j, node: kn2 };
        kn2.classList.add('gogh-kid-selected');
      }
      openKidLinkPanel(sec, ci, j);
    });
    var card0 = sec.nodes[ci];
    var kn0 = card0 && card0.querySelector('.gogh-k-' + (j + 1));
    placePanelNear(kn0 || card0 || sec.sectionEl);
    panelOpen = true;
  }
  function kidHostOf(card) {
    var found = null;
    S.some(function (s2) {
      var at = s2.nodes ? s2.nodes.indexOf(card) : -1;
      if (at !== -1) { found = { sec: s2, ci: at }; return true; }
      return false;
    });
    return found;
  }
  document.addEventListener('pointerdown', function (ev) {
    if (!editing || drag || resize) return;
    if (!(ev.target instanceof Element)) return;
    if (kidEd && kidEd.node.contains(ev.target)) return; // caret work
    var kn = ev.target.closest('[class*="gogh-k-"]');
    var card = kn && kn.closest('.gogh-cardbox');
    if (!kn || !card) {
      if (kidSel && !(ev.target.closest && ev.target.closest('.gogh-toast'))) clearKidSel();
      if (kidEd) exitKidEd();
      return;
    }
    var host = kidHostOf(card);
    if (!host) return;
    var m = (kn.className + '').match(/gogh-k-(\d+)/);
    if (!m) return;
    var j = +m[1] - 1;
    var sec = host.sec, ci = host.ci;
    var hostEl = sec.els[ci];
    if (!hostEl || !hostEl.kids || !hostEl.kids[j]) return;
    ev.preventDefault();
    ev.stopPropagation(); // the card's own select must not fire
    exitKidEd();
    var already = kidSel && kidSel.node === kn;
    clearKidSel();
    sel = null;
    hideHandles();
    closePanel();
    kidSel = { sec: sec, ci: ci, j: j, node: kn };
    kn.classList.add('gogh-kid-selected');
    var kid = hostEl.kids[j];
    kidDrag = { sec: sec, ci: ci, j: j, node: kn,
      px: ev.clientX, py: ev.clientY, x0: kid.x, y0: kid.y,
      moved: false, already: !!already, id: ev.pointerId };
  }, true);
  document.addEventListener('pointermove', function (ev) {
    if (!kidDrag || ev.pointerId !== kidDrag.id) return;
    var sec = kidDrag.sec;
    var hostEl = sec.els[kidDrag.ci];
    if (!hostEl || !hostEl.kids) { kidDrag = null; return; }
    var kid = hostEl.kids[kidDrag.j];
    var sc = scaleOf(sec);
    var dx = (ev.clientX - kidDrag.px) / sc;
    var dy = (ev.clientY - kidDrag.py) / sc;
    if (!kidDrag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    kidDrag.moved = true;
    kid.x = Math.round(Math.max(0, Math.min(hostEl.w - kid.w, kidDrag.x0 + dx)));
    kid.y = Math.round(Math.max(0, Math.min(Math.max(0, hostEl.h - kid.h), kidDrag.y0 + dy)));
    // leaving intent: pointer beyond the card's box. The kid itself is
    // clamped inside the card's grid, so a GHOST follows the pointer out —
    // without it, the kid pinning at the wall reads as "can't leave"
    var cardR = sec.nodes[kidDrag.ci].getBoundingClientRect();
    var outside = ev.clientX < cardR.left - 4 || ev.clientX > cardR.right + 4 ||
      ev.clientY < cardR.top - 4 || ev.clientY > cardR.bottom + 4;
    sec.nodes[kidDrag.ci].classList.toggle('gogh-card-leaving', outside);
    if (outside && !kidDrag.ghost) {
      var kg = kidDrag.node.cloneNode(true);
      kg.classList.remove('gogh-kid-selected');
      kg.className += ' gogh-kid-ghost';
      var kr = kidDrag.node.getBoundingClientRect();
      kg.style.width = kr.width + 'px';
      kg.style.height = kr.height + 'px';
      document.body.appendChild(kg);
      kidDrag.ghost = kg;
      kidDrag.node.style.visibility = 'hidden';
    } else if (!outside && kidDrag.ghost) {
      kidDrag.ghost.remove();
      kidDrag.ghost = null;
      kidDrag.node.style.visibility = '';
    }
    if (kidDrag.ghost) {
      kidDrag.ghost.style.left = ev.clientX + 'px';
      kidDrag.ghost.style.top = ev.clientY + 'px';
    }
    resolveAndApply(sec);
  });
  document.addEventListener('pointerup', function (ev) {
    if (!kidDrag || ev.pointerId !== kidDrag.id) return;
    var kd = kidDrag;
    kidDrag = null;
    var sec = kd.sec;
    var cardNode = sec.nodes[kd.ci];
    if (cardNode) cardNode.classList.remove('gogh-card-leaving');
    if (kd.ghost) { kd.ghost.remove(); kd.node.style.visibility = ''; }
    var hostEl = sec.els[kd.ci];
    if (!hostEl || !hostEl.kids) return;
    if (kd.moved) {
      var cardR = cardNode.getBoundingClientRect();
      var outside = ev.clientX < cardR.left - 4 || ev.clientX > cardR.right + 4 ||
        ev.clientY < cardR.top - 4 || ev.clientY > cardR.bottom + 4;
      if (outside) {
        // the kid leaves the card, landing under the pointer in page space
        var kid = hostEl.kids.splice(kd.j, 1)[0];
        if (!hostEl.kids.length) hostEl.kids = null;
        var secR = sec.sectionEl.getBoundingClientRect();
        var sc2 = scaleOf(sec);
        kid.x = Math.round(Math.max(0, Math.min(W - kid.w, (ev.clientX - secR.left) / sc2 - kid.w / 2)));
        kid.y = Math.round(Math.max(0, (ev.clientY - secR.top) / sc2 - kid.h / 2));
        clearKidSel();
        sec.els.push(kid);
        renderSection(sec);
        placeHandles(sec, sec.els.length - 1);
        pushState();
        toast('Out of the card \u2014 it\u2019s a free element again.',
          { actions: [{ label: 'Undo', onClick: function () { undo(); } }] });
        return;
      }
      settleKid(hostEl, hostEl.kids[kd.j]);
      resolveAndApply(sec);
      pushState();
    } else if (!kd.already) {
      var kb = hostEl.kids[kd.j];
      if (kb && kb.type === 'button') openKidLinkPanel(sec, kd.ci, kd.j);
    } else if (kd.already) {
      // second click on a selected kid: edit its text in place
      var kid2 = hostEl.kids[kd.j];
      if (kid2 && (kid2.type === 'heading' || kid2.type === 'para' || kid2.type === 'badge' || kid2.type === 'button')) {
        var target = kid2.type === 'button' ? (kd.node.querySelector('.wp-block-button__link') || kd.node) : kd.node;
        target.setAttribute('contenteditable', kid2.type === 'heading' || kid2.type === 'para' ? 'true' : 'plaintext-only');
        document.documentElement.classList.add('gogh-textediting');
        kidEd = { sec: sec, ci: kd.ci, j: kd.j, node: target, kid: kid2 };
        target.focus();
        if (document.caretRangeFromPoint) {
          var cr = document.caretRangeFromPoint(ev.clientX, ev.clientY);
          if (cr && target.contains(cr.startContainer)) {
            var so = window.getSelection();
            so.removeAllRanges();
            so.addRange(cr);
          }
        }
      }
    }
  });
  document.addEventListener('input', function (ev) {
    if (!kidEd || ev.target !== kidEd.node) return;
    var k = kidEd.kid;
    k.text = (k.type === 'heading' || k.type === 'para') ? cleanInline(kidEd.node.innerHTML) : kidEd.node.textContent;
  });
  document.addEventListener('keydown', function (ev) {
    if (kidEd && ev.key === 'Escape') { ev.stopPropagation(); exitKidEd(); return; }
    if (!kidSel || kidEd) return;
    if (ev.key === 'Escape') { clearKidSel(); return; }
    if (ev.key === 'Backspace' || ev.key === 'Delete') {
      var sec = kidSel.sec;
      var hostEl = sec.els[kidSel.ci];
      if (!hostEl || !hostEl.kids) return;
      ev.preventDefault();
      hostEl.kids.splice(kidSel.j, 1);
      if (!hostEl.kids.length) hostEl.kids = null;
      clearKidSel();
      renderSection(sec);
      pushState();
      toast('Removed from the card.', { actions: [{ label: 'Undo', onClick: function () { undo(); } }] });
    }
  }, true);
  // writer's Enter: in a heading it finishes and hops to the paragraph
  // below (contents selected — typing replaces); in a paragraph it makes a
  // REAL paragraph gap like WordPress (Shift+Enter keeps the single break)
  document.addEventListener('keydown', function (ev) {
    if (!textEditing || ev.key !== 'Enter') return;
    var secK = textEditing.sec;
    var eK = secK.els[textEditing.i];
    if (!eK) return;
    if (eK.type === 'heading') {
      ev.preventDefault();
      for (var jk = textEditing.i + 1; jk < secK.els.length; jk++) {
        if (secK.els[jk].type === 'para') {
          exitTextEdit();
          placeHandles(secK, jk);
          enterTextEdit(secK, jk);
          return;
        }
      }
      exitTextEdit();
      return;
    }
    if (eK.type === 'para' && !ev.shiftKey) {
      ev.preventDefault();
      document.execCommand('insertHTML', false, '<br><br>');
      textEditing.target.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, true);
  document.addEventListener('pointerup', function () { if (drag) endDrag(); });
  document.addEventListener('pointercancel', function () { if (drag) endDrag(); });

  var gridSnapOn = false; // the always-on graph paper; drags show their own grid and snap regardless
  // golden ratio guides (a Design toggle): the golden section lines
  // join the smart-guide candidates — layouts start landing in pleasing
  // spots without anyone being taught anything
  var compGuidesOn = false;
  function compCands(H) {
    if (!compGuidesOn) return { x: [], y: [] };
    return {
      x: [Math.round(W * 0.382), Math.round(W * 0.618)],
      y: [Math.round(H * 0.382), Math.round(H * 0.618)],
    };
  }
  function compTag(H, v, axis) {
    if (!compGuidesOn || v === null) return '';
    var r = Math.round(v);
    var phi = axis === 'x' ? [Math.round(W * 0.382), Math.round(W * 0.618)]
      : [Math.round(H * 0.382), Math.round(H * 0.618)];
    return phi.indexOf(r) !== -1 ? 'φ' : '';
  }

  // ---------- theme style variations (drawer) ----------
  var GSROOT = cfg.restUrl.split('wp/v2/')[0] + 'wp/v2/';
  var variationsCache = null;
  function fetchVariations() {
    if (variationsCache) return Promise.resolve(variationsCache);
    return fetch(GSROOT + 'global-styles/themes/' + encodeURIComponent(cfg.theme) + '/variations', {
      headers: { 'X-WP-Nonce': cfg.nonce },
      credentials: 'same-origin',
    }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); }).then(function (vars) {
      // the API lists full variations and colour-only ones under one name
      var seen = {};
      variationsCache = vars.filter(function (v) {
        var t = v.title || '';
        if (seen[t]) return false;
        seen[t] = 1;
        return true;
      });
      return variationsCache;
    });
  }
  var previewFaces = {};
  function ensureVariationFonts(v) {
    if (!window.FontFace || !document.fonts) return;
    var fams = (((v.settings || {}).typography || {}).fontFamilies || {}).theme || [];
    fams.forEach(function (f) {
      if (!f.fontFamily) return;
      var fam = f.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      if (previewFaces[fam] || document.fonts.check('16px "' + fam + '"')) { previewFaces[fam] = 1; return; }
      var faces = f.fontFace || [];
      var face = faces.filter(function (ff) { return String(ff.fontStyle || 'normal') === 'normal'; })[0] || faces[0];
      var src = face && face.src ? [].concat(face.src)[0] : null;
      if (!src) return;
      if (src.indexOf('file:./') === 0) src = location.origin + '/wp-content/themes/' + cfg.theme + '/' + src.slice(7);
      previewFaces[fam] = 1;
      try {
        var ff2 = new FontFace(fam, 'url("' + src + '")', {
          weight: String(face.fontWeight || '400'),
          style: face.fontStyle || 'normal',
        });
        ff2.load().then(function (loaded) { document.fonts.add(loaded); }).catch(function () {});
      } catch (err) {}
    });
  }
  // ---------- page style: which template this page renders with ----------
  // Curated friendly names over raw template slugs; applying is a one-field
  // save, then a reload (the page chrome itself changes).
  function pageStyleLabel(t) {
    if (!t.slug) return { name: 'Standard', hint: 'The theme\u2019s normal page' };
    if (/no-title/.test(t.slug)) return { name: 'No page title', hint: 'Your content starts at the top' };
    if (/blank-canvas$/.test(t.slug)) return { name: 'Blank canvas', hint: 'No header or footer \u2014 pure gogh' };
    if (/full|wide/.test(t.slug)) return { name: t.title || 'Full width', hint: 'Content runs edge to edge' };
    return { name: t.title || t.slug, hint: '' };
  }
  function openPageStylePanel(anchorEl) {
    var options = [{ slug: '', title: 'Standard' }].concat(cfg.pageTemplates || []);
    panel.innerHTML =
      '<div class="gogh-panel-head"><span class="gogh-panel-title">Page style</span>' +
      '<button type="button" class="gogh-sbtn gogh-panel-close" title="Back to the palette">\u2715</button></div>' +
      '<div class="gogh-panel-hint">How this page is framed by your theme.</div>' +
      '<div class="gogh-pagestyles"></div>';
    // the panel keeps its LAST position unless placed — without this it can
    // open wherever it was previously used, often outside the viewport
    placePanelNear(anchorEl || side.querySelector('.gogh-pagestylebtn'));
    panelOpen = true;
    panel.querySelector('.gogh-panel-close').addEventListener('click', function () {
      closePanel();
      openSide();
    });
    var box = panel.querySelector('.gogh-pagestyles');
    options.forEach(function (t) {
      var lab = pageStyleLabel(t);
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'gogh-btn gogh-pagestyle' + ((cfg.pageTemplate || '') === t.slug ? ' is-current' : '');
      b.innerHTML = '<span class="gogh-pagestyle-name"></span>' +
        (lab.hint ? '<span class="gogh-pagestyle-hint"></span>' : '') +
        '<span class="gogh-pagestyle-tick">\u2713</span>';
      b.querySelector('.gogh-pagestyle-name').textContent = lab.name;
      if (lab.hint) b.querySelector('.gogh-pagestyle-hint').textContent = lab.hint;
      b.addEventListener('click', function () {
        if ((cfg.pageTemplate || '') === t.slug) return;
        if (isDirty()) {
          toast('Publish your changes first \u2014 changing the page style reloads the page.', { error: true });
          return;
        }
        b.disabled = true;
        fetch(cfg.restUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
          credentials: 'same-origin',
          body: JSON.stringify({ template: t.slug }),
        }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          var u = new URL(location.href);
          u.searchParams.set('gogh-edit', '1');
          u.searchParams.set('gogh-ps', '1');
          var ov = document.createElement('div');
          ov.className = 'gogh-pagefade';
          ov.style.background = pageBg();
          ov.innerHTML = '<span class="gogh-pagefade-pill">Switching page style\u2026</span>';
          document.body.appendChild(ov);
          requestAnimationFrame(function () { ov.classList.add('is-on'); });
          setTimeout(function () { location.href = u.toString(); }, 340);
        }).catch(function (err) {
          b.disabled = false;
          toast('gogh could not change the page style \u2014 ' + ((err && err.message) || 'try again.'), { error: true });
        });
      });
      box.appendChild(b);
    });
  }
  // ---------- your brand: four colours + two fonts as a first-class style ----------
  function hexToRgb(h) {
    var m = String(h || '').trim().match(/^#?([0-9a-f]{6})$/i);
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function contrastRatio(hexA, hexB) {
    var lum = function (rgb) {
      var c = rgb.map(function (v) {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    var a = hexToRgb(hexA), b = hexToRgb(hexB);
    if (!a || !b) return null;
    var l1 = lum(a), l2 = lum(b);
    return +(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2));
  }
  function cssColorToHex(str) {
    // resolve ANY css colour expression (var(), color-mix, names) by
    // letting the browser compute it on a probe element
    var probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;color:' + str;
    document.body.appendChild(probe);
    var rgb = getComputedStyle(probe).color;
    probe.remove();
    var m = rgb.match(/rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,\s\/]+([\d.]+))?\)/);
    if (!m) return null;
    if (m[4] != null && parseFloat(m[4]) < 0.5) return null;
    var h = function (v) { return ('0' + Math.round(+v).toString(16)).slice(-2); };
    return '#' + h(m[1]) + h(m[2]) + h(m[3]);
  }
  function effectiveBgHex(node) {
    // the nearest ancestor that PAINTS a solid backdrop. Image backdrops
    // return null — contrast is unknowable there, and the auto-scrim
    // guardrail owns that case.
    var n = node;
    while (n && n !== document.documentElement) {
      var cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && cs.backgroundImage.indexOf('url(') !== -1) return null;
      var bg = cs.backgroundColor;
      if (bg && bg !== 'transparent') {
        var m2 = bg.match(/rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,\s\/]+([\d.]+))?\)/);
        if (m2 && (m2[4] == null || parseFloat(m2[4]) >= 0.5)) {
          var h2 = function (v) { return ('0' + Math.round(+v).toString(16)).slice(-2); };
          return '#' + h2(m2[1]) + h2(m2[2]) + h2(m2[3]);
        }
      }
      n = n.parentElement;
    }
    return cssColorToHex(getComputedStyle(document.body).backgroundColor) || '#ffffff';
  }
  function markSwatchLegibility(rowEl, bgHex) {
    // guardrail, not a gate: swatches that would be hard to read get a
    // strike and an honest tooltip — they stay clickable
    if (!bgHex || !rowEl) return;
    rowEl.querySelectorAll('.gogh-sw[data-col]').forEach(function (sw) {
      if (!sw.dataset.col) return; // theme default: trust the theme
      var hex = cssColorToHex('var(--wp--preset--color--' + sw.dataset.col + ')');
      if (!hex) return;
      var r = contrastRatio(hex, bgHex);
      if (r != null && r < 3) {
        sw.classList.add('gogh-sw-lowc');
        sw.title = sw.dataset.col + ' \u2014 hard to read on this background';
      }
    });
  }
  function fontCatalogue() {
    // theme-declared font presets, parsed like themePalette()
    var out = [], seen = {};
    var gs = document.getElementById('global-styles-inline-css');
    var cssText = gs ? gs.textContent : '';
    var re = /--wp--preset--font-family--([a-z0-9-]+):\s*([^;}]+)/g, m;
    while ((m = re.exec(cssText))) {
      if (seen[m[1]]) continue;
      seen[m[1]] = 1;
      var fam = m[2].trim();
      var pretty = fam.split(',')[0].replace(/["']/g, '').trim();
      out.push({ slug: m[1], name: pretty, fontFamily: fam });
    }
    return out;
  }
  function brandToVariation(brand) {
    var c = (brand && brand.colors) || {};
    var cur = themePalette();
    var slugs = cur.map(function (p) { return p.slug; });
    if (!slugs.length) slugs = ['base', 'contrast', 'accent-1', 'accent-2'];
    var accents = [c.accent, c.accent2].filter(Boolean);
    var ai = 0;
    var pal = [];
    slugs.forEach(function (slug) {
      var v = null;
      if (/^(base|background)(-|$)/.test(slug)) v = c.background;
      else if (/^(contrast|foreground|text)(-|$)/.test(slug)) v = c.text;
      else if (/accent/.test(slug) && accents.length) { v = accents[ai % accents.length]; ai++; }
      if (!v) {
        var keep = cur.filter(function (p) { return p.slug === slug; })[0];
        v = keep && keep.value;
      }
      if (v) pal.push({ slug: slug, color: v, name: slug });
    });
    var out = { title: 'Your brand', settings: { color: { palette: { theme: pal } } }, styles: {} };
    var f = (brand && brand.fonts) || {};
    var byFam = {};
    fontCatalogue().forEach(function (x) { byFam[x.slug] = x; });
    var used = [];
    ['heading', 'body'].forEach(function (k) {
      if (f[k] && byFam[f[k]]) used.push({ slug: f[k], name: byFam[f[k]].name, fontFamily: byFam[f[k]].fontFamily });
    });
    if (used.length) out.settings.typography = { fontFamilies: { theme: used } };
    if (f.body && byFam[f.body]) out.styles.typography = { fontFamily: 'var:preset|font-family|' + f.body };
    if (f.heading && byFam[f.heading]) {
      out.styles.elements = { heading: { typography: { fontFamily: 'var:preset|font-family|' + f.heading } } };
    }
    return out;
  }
  var starterPick = null;
  function openStarterPicker() {
    if (starterPick) starterPick.remove();
    var ov = document.createElement('div');
    ov.className = 'gogh-starterpick';
    ov.innerHTML =
      '<div class="gogh-sp-sheet">' +
      '<div class="gogh-sp-head"><div>' +
      '<div class="gogh-sp-title">Site designs</div>' +
      '<div class="gogh-sp-sub">A whole site, ready to tweak. Your posts, name, logo and brand colours stay.</div>' +
      '</div><button type="button" class="gogh-sbtn gogh-sp-close" title="Close">\u2715</button></div>' +
      '<div class="gogh-sp-grid"></div></div>';
    document.body.appendChild(ov);
    starterPick = ov;
    var close = function () { ov.remove(); starterPick = null; };
    ov.querySelector('.gogh-sp-close').addEventListener('click', close);
    ov.addEventListener('pointerdown', function (ev) {
      ev.stopPropagation();
      if (ev.target === ov) close();
    });
    var grid = ov.querySelector('.gogh-sp-grid');
    (cfg.starters || []).forEach(function (st) {
      var card = document.createElement('div');
      card.className = 'gogh-sp-card';
      card.innerHTML =
        '<div class="gogh-sp-prev"><div class="gogh-card-stage gogh-sp-stage"></div>' +
        '<span class="gogh-sp-pagename"></span></div>' +
        '<div class="gogh-sp-body"><div class="gogh-sp-name"></div>' +
        '<div class="gogh-sp-desc"></div><div class="gogh-sp-chips"></div>' +
        '<div class="gogh-sp-actions">' +
        '<button type="button" class="gogh-btn gogh-sp-use">Use this design</button>' +
        (st.pages.length > 1 ? '<button type="button" class="gogh-btn gogh-sp-peek">Peek at pages</button>' : '') +
        '</div></div>';
      card.querySelector('.gogh-sp-name').textContent = st.name;
      card.querySelector('.gogh-sp-desc').textContent = st.description || '';
      card.querySelector('.gogh-sp-chips').textContent = st.pages.map(function (p) { return p.title; }).join(' \u00b7 ');
      var prev = card.querySelector('.gogh-sp-prev');
      var stage = card.querySelector('.gogh-sp-stage');
      var pageName = card.querySelector('.gogh-sp-pagename');
      // the preview wears the starter's OWN palette — the applied design
      // brings these colours, so the card must sell them
      if (st.preview) {
        Object.keys(st.preview).forEach(function (k) {
          stage.style.setProperty('--wp--preset--color--' + k, st.preview[k]);
        });
        prev.style.background = st.preview.base || '';
        stage.style.background = st.preview.base || '';
        stage.style.color = st.preview.contrast || '';
      }
      var pi = 0;
      var showPage = function (i) {
        pi = ((i % st.pages.length) + st.pages.length) % st.pages.length;
        var pg = st.pages[pi];
        pageName.textContent = pg.title;
        fetch(restQ(GSROOT.split('wp/v2/')[0] + 'gogh/v1/pattern',
          'slug=' + encodeURIComponent('gogh-starter/' + st.slug + '-' + pg.slug)), {
          headers: { 'X-WP-Nonce': cfg.nonce },
          credentials: 'same-origin',
        }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
          .then(function (d) {
            var html = d.rendered || '';
            if (html && d.css) html = '<style>' + d.css + '</style>' + html;
            stage.innerHTML = html;
            // hero crop: fill the card's width and show the top of the
            // page at readable scale — a whole-page miniature reads as lint
            var sc = prev.clientWidth / 1200;
            stage.style.transform = 'scale(' + sc + ')';
            stage.style.left = '0';
            stage.style.top = '0';
          }).catch(function () { stage.innerHTML = ''; });
      };
      showPage(0);
      var peek = card.querySelector('.gogh-sp-peek');
      if (peek) peek.addEventListener('click', function () { showPage(pi + 1); });
      card.querySelector('.gogh-sp-use').addEventListener('click', function () { confirmStarter(st, ov); });
      grid.appendChild(card);
    });
  }
  function confirmStarter(st, ov) {
    var old = ov.querySelector('.gogh-sp-confirm');
    if (old) old.remove();
    var dlg = document.createElement('div');
    dlg.className = 'gogh-sp-confirm';
    dlg.innerHTML =
      '<div class="gogh-sp-dialog">' +
      '<div class="gogh-sp-name"></div>' +
      '<div class="gogh-sp-line gogh-sp-keep">\u2713 Keeps your posts, images, name and logo</div>' +
      '<div class="gogh-sp-line gogh-sp-keep">\u2713 Brings its own colours \u2014 Your brand can re-apply yours any time</div>' +
      '<div class="gogh-sp-line gogh-sp-warn">\u26a0 Replaces your pages and menu \u2014 current pages move to Trash, restorable for 30 days</div>' +
      '<div class="gogh-sp-actions">' +
      '<button type="button" class="gogh-btn gogh-sp-cancel">Cancel</button>' +
      '<button type="button" class="gogh-btn gogh-sp-go">Switch design</button>' +
      '</div></div>';
    dlg.querySelector('.gogh-sp-name').textContent = 'Switch to ' + st.name + '?';
    ov.appendChild(dlg);
    dlg.addEventListener('pointerdown', function (ev) {
      ev.stopPropagation();
      if (ev.target === dlg) dlg.remove();
    });
    dlg.querySelector('.gogh-sp-cancel').addEventListener('click', function () { dlg.remove(); });
    var go = dlg.querySelector('.gogh-sp-go');
    go.addEventListener('click', function () {
      go.disabled = true;
      go.textContent = 'Building\u2026';
      fetch(GSROOT.split('wp/v2/')[0] + 'gogh/v1/starter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
        credentials: 'same-origin',
        body: JSON.stringify({ slug: st.slug }),
      }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
        .then(function (d) {
          discarding = true;
          var fade = document.createElement('div');
          fade.className = 'gogh-pagefade';
          fade.innerHTML = '<span class="gogh-pagefade-pill">Building your site\u2026</span>';
          document.body.appendChild(fade);
          requestAnimationFrame(function () { fade.classList.add('is-on'); });
          setTimeout(function () {
            location.href = d.home + (d.home.indexOf('?') === -1 ? '?' : '&') + 'gogh-edit=1';
          }, 420);
        }).catch(function (err) {
          go.disabled = false;
          go.textContent = 'Switch design';
          toast('gogh could not switch the design \u2014 ' + ((err && err.message) || 'try again.'), { error: true });
        });
    });
  }
  function openBrandForm(anchorEl) {
    var local = JSON.parse(JSON.stringify(cfg.brand || { colors: {
      background: '#f6f2ea', text: '#1c2733', accent: '#c96f4a', accent2: '#7a9e7e',
    }, fonts: {} }));
    local.colors = local.colors || {};
    local.fonts = local.fonts || {};
    var WELLS = [
      ['background', 'Background', 'The page behind everything'],
      ['text', 'Text', 'Your words'],
      ['accent', 'Accent', 'Buttons and links'],
      ['accent2', 'Second accent', 'Badges and extra highlights'],
    ];
    var cat = fontCatalogue();
    panel.innerHTML =
      '<div class="gogh-panel-head"><span class="gogh-panel-title">Your brand</span>' +
      '<button type="button" class="gogh-sbtn gogh-panel-close" title="Back">\u2715</button></div>' +
      '<div class="gogh-swlab">Colours</div>' +
      '<div class="gogh-brandwells">' +
      WELLS.map(function (w) {
        var val = local.colors[w[0]] || '#888888';
        return '<label class="gogh-brandwell" data-k="' + w[0] + '">' +
          '<input type="color" value="' + escAttr(val) + '" />' +
          '<span class="gogh-brandwell-name">' + w[1] + '</span>' +
          '<span class="gogh-brandwell-hint">' + w[2] + '</span>' +
          '<input type="text" class="gogh-input gogh-brandhex" value="' + escAttr(val) + '" spellcheck="false" />' +
          '</label>';
      }).join('') + '</div>' +
      '<div class="gogh-brandcontrast"></div>' +
      '<div class="gogh-panel-hint gogh-brandpaste-hint">Already have brand colours? Paste them below \u2014 gogh finds the codes and fills the boxes above.</div>' +
      '<input type="text" class="gogh-input gogh-brandpaste" placeholder="Anything with codes like #1B2A4A works" />' +
      '<div class="gogh-swlab">Fonts</div>' +
      ['heading', 'body'].map(function (k) {
        return '<div class="gogh-panel-row gogh-brandfontrow">' +
          '<span class="gogh-brandfont-lab">' + (k === 'heading' ? 'Headings' : 'Body') + '</span>' +
          '<select class="gogh-input gogh-brandfont" data-k="' + k + '">' +
          '<option value="">Theme default</option>' +
          cat.map(function (f2) {
            return '<option value="' + escAttr(f2.slug) + '"' + (local.fonts[k] === f2.slug ? ' selected' : '') + '>' + escAttr(f2.name) + '</option>';
          }).join('') + '</select></div>';
      }).join('') +
      '<div class="gogh-panel-row gogh-brandacts">' +
      '<button type="button" class="gogh-btn gogh-btn-small gogh-brandcancel">Cancel</button>' +
      '<button type="button" class="gogh-btn gogh-btn-small gogh-brandkeep">Save brand</button>' +
      '</div>';
    panel.hidden = false;
    placePanelNear(anchorEl || side);
    panelOpen = true;
    var contrastEl = panel.querySelector('.gogh-brandcontrast');
    function refreshContrast() {
      var r = contrastRatio(local.colors.text, local.colors.background);
      if (r == null) { contrastEl.textContent = ''; return; }
      contrastEl.className = 'gogh-brandcontrast ' + (r >= 4.5 ? 'is-good' : r >= 3 ? 'is-mid' : 'is-bad');
      contrastEl.textContent = r >= 4.5
        ? '\u2713 Your Text colour is easy to read on your Background'
        : r >= 3
          ? 'Your Text and Background are close \u2014 big headlines will read, small words won\u2019t'
          : 'Your Text colour can\u2019t be read on your Background \u2014 try a darker text or a lighter background';
    }
    var pvT = null;
    function livePreview() {
      refreshContrast();
      clearTimeout(pvT);
      pvT = setTimeout(function () { previewVariation(brandToVariation(local)); }, 150);
    }
    panel.querySelectorAll('.gogh-brandwell').forEach(function (well) {
      var k = well.dataset.k;
      var pick = well.querySelector('input[type="color"]');
      var hex = well.querySelector('.gogh-brandhex');
      pick.addEventListener('input', function () {
        local.colors[k] = pick.value;
        hex.value = pick.value;
        livePreview();
      });
      hex.addEventListener('input', function () {
        var v = hex.value.trim();
        if (/^#?[0-9a-f]{6}$/i.test(v)) {
          if (v[0] !== '#') v = '#' + v;
          local.colors[k] = v.toLowerCase();
          pick.value = v;
          livePreview();
        }
      });
    });
    panel.querySelector('.gogh-brandpaste').addEventListener('input', function () {
      var found = (this.value.match(/#?[0-9a-f]{6}\b/gi) || []).map(function (h) {
        return (h[0] === '#' ? h : '#' + h).toLowerCase();
      });
      if (!found.length) return;
      WELLS.forEach(function (w, i2) {
        if (found[i2]) local.colors[w[0]] = found[i2];
      });
      panel.querySelectorAll('.gogh-brandwell').forEach(function (well) {
        var k = well.dataset.k;
        well.querySelector('input[type="color"]').value = local.colors[k];
        well.querySelector('.gogh-brandhex').value = local.colors[k];
      });
      livePreview();
    });
    panel.querySelectorAll('.gogh-brandfont').forEach(function (sel2) {
      sel2.addEventListener('change', function () {
        if (sel2.value) local.fonts[sel2.dataset.k] = sel2.value;
        else delete local.fonts[sel2.dataset.k];
        livePreview();
      });
    });
    panel.querySelector('.gogh-panel-close').addEventListener('click', function () {
      clearVariationPreview();
      openStylePanel(anchorEl);
    });
    panel.querySelector('.gogh-brandcancel').addEventListener('click', function () {
      clearVariationPreview();
      openStylePanel(anchorEl);
    });
    panel.querySelector('.gogh-brandkeep').addEventListener('click', function () {
      var keepBtn = panel.querySelector('.gogh-brandkeep');
      keepBtn.disabled = true;
      fetch(GSROOT.replace(/wp\/v2\/$/, 'wp/v2/') + 'settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
        credentials: 'same-origin',
        body: JSON.stringify({ gogh_brand: local }),
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        cfg.brand = local;
        clearVariationPreview();
        return applyVariation(brandToVariation(local));
      }).then(function () {
        openStylePanel(anchorEl);
      }).catch(function (err) {
        keepBtn.disabled = false;
        toast('gogh could not save your brand \u2014 ' + ((err && err.message) || 'try again.'), { error: true });
      });
    });
    refreshContrast();
  }
  // ---------- type scale: one dial, every word ----------
  // Scaled sizes are written as calc(original * factor) into user Global
  // Styles, so px, rem and clamp() themes all scale uniformly — and always
  // from the THEME's originals, so the dial can never compound itself.
  // the global-styles REST endpoint serves fontSizes either FLAT or keyed
  // by origin ({default, theme, custom}) depending on WP version and
  // context — James's dial read .length on the object and declared the
  // theme fontless. Unwrap: the theme's own sizes first, then custom,
  // then core defaults.
  function themeFontSizeList(raw) {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') return raw.theme || raw.custom || raw.default || null;
    return null;
  }
  function scaleFontSizes(sizes, factor) {
    return (sizes || []).map(function (fs) {
      var out = { slug: fs.slug, name: fs.name || fs.slug, size: fs.size };
      if (factor !== 100 && fs.size) out.size = 'calc(' + fs.size + ' * ' + (factor / 100) + ')';
      return out;
    });
  }
  function applyTypeScale(factor, btn) {
    if (btn) btn.disabled = true;
    var H = { 'X-WP-Nonce': cfg.nonce };
    return Promise.all([
      fetch(GSROOT + 'global-styles/themes/' + encodeURIComponent(cfg.theme), { headers: H, credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); }),
      fetch(GSROOT + 'global-styles/' + cfg.gsId + '?context=edit', { headers: H, credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); }),
    ]).then(function (both) {
      var themeSizes = themeFontSizeList((((both[0] || {}).settings || {}).typography || {}).fontSizes);
      if (!themeSizes || !themeSizes.length) throw new Error('theme declares no font sizes');
      var settings = (both[1] && both[1].settings) || {};
      settings.typography = settings.typography || {};
      settings.typography.fontSizes = scaleFontSizes(themeSizes, factor);
      return fetch(GSROOT + 'global-styles/' + cfg.gsId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
        credentials: 'same-origin',
        body: JSON.stringify({ settings: settings }),
      });
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return fetch(location.href, { credentials: 'same-origin' });
    }).then(function (r) { return r.text(); }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      ['global-styles-inline-css', 'wp-fonts-local'].forEach(function (id) {
        var fresh = doc.getElementById(id);
        var cur = document.getElementById(id);
        if (fresh && cur) cur.textContent = fresh.textContent;
      });
      fontSizesCache = null;
      S.forEach(function (s2) { measureTextHeights(s2); });
      resolveAll();
      cfg.typeScale = factor;
      fetch(cfg.restUrl.split('wp/v2/')[0] + 'gogh/v1/type-scale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
        credentials: 'same-origin',
        body: JSON.stringify({ scale: factor }),
      }).catch(function () {});
      if (btn) btn.disabled = false;
      toast(factor === 100 ? 'Type back to the theme\u2019s own scale.' : 'Every word rescaled to ' + factor + '%.');
      return true;
    }).catch(function (err) {
      if (btn) btn.disabled = false;
      toast('Could not rescale the type \u2014 ' + ((err && err.message) || 'try again.'), { error: true });
      return false;
    });
  }
  function openStylePanel(anchorEl) {
    if (!cfg.gsId || !cfg.theme) return;
    fetchVariations().then(function (vars) {
      if (!vars.length) return;
      panel.innerHTML =
        '<div class="gogh-panel-head"><span class="gogh-panel-title">Site style</span>' +
        '<button type="button" class="gogh-sbtn gogh-panel-close" title="Back to the palette">\u2715</button></div>' +
        '<div class="gogh-panel-hint">Hover to preview \u2014 click to keep it</div>' +
        '<div class="gogh-panel-hint" style="margin-top:6px">Type scale</div>' +
        '<div class="gogh-hpresets gogh-typescale">' +
        [['Compact', 90], ['Regular', 100], ['Generous', 110], ['Grand', 120]].map(function (ts) {
          return '<button type="button" class="gogh-hpreset' + ((cfg.typeScale || 100) === ts[1] ? ' is-active' : '') + '" data-scale="' + ts[1] + '">' + ts[0] + '</button>';
        }).join('') + '</div>' +
        '<div class="gogh-varlist"></div>';
      panel.querySelectorAll('.gogh-typescale .gogh-hpreset').forEach(function (tb) {
        tb.addEventListener('click', function () {
          applyTypeScale(+tb.dataset.scale, tb).then(function (ok) {
            if (!ok) return;
            panel.querySelectorAll('.gogh-typescale .gogh-hpreset').forEach(function (o) {
              o.classList.toggle('is-active', o === tb);
            });
          });
        });
      });
      panel.querySelector('.gogh-panel-close').addEventListener('click', function () {
        closePanel();
        openSide();
      });
      var box = panel.querySelector('.gogh-varlist');
      // Site designs lives in the Design drawer alone — this panel is styles
      // your brand sits ABOVE the theme's styles — the most important option
      (function () {
        var row = document.createElement('div');
        row.className = 'gogh-brandrow';
        if (cfg.brand && cfg.brand.colors) {
          var b2 = document.createElement('button');
          b2.type = 'button';
          b2.className = 'gogh-varbtn gogh-brandbtn';
          if ((cfg.activeStyle || '') === 'Your brand') b2.classList.add('is-current');
          b2.title = 'Your brand \u2014 click to edit it';
          var order = ['background', 'text', 'accent', 'accent2'];
          b2.innerHTML = order.map(function (k) {
            var col = cfg.brand.colors[k];
            return col ? '<span class="gogh-vardot" style="background:' + escAttr(col) + '"></span>' : '';
          }).join('') + '<span class="gogh-varname">Your brand</span>';
          var bv = brandToVariation(cfg.brand);
          b2.addEventListener('mouseenter', function () {
            clearTimeout(previewHoverT);
            previewHoverT = setTimeout(function () { previewVariation(bv); }, 120);
          });
          // the whole row is the door to your brand — applying happens from
          // the editor's Keep, with live preview along the way
          b2.addEventListener('click', function () {
            clearVariationPreview();
            openBrandForm(anchorEl);
          });
          row.appendChild(b2);
        } else {
          var mk = document.createElement('button');
          mk.type = 'button';
          mk.className = 'gogh-btn gogh-btn-small gogh-brandsetup';
          mk.textContent = '+ Set up your brand';
          mk.addEventListener('click', function () { openBrandForm(anchorEl); });
          row.appendChild(mk);
        }
        box.appendChild(row);
      })();
      // colours and font pairs are different decisions — group them
      var groups = { color: [], font: [] };
      vars.forEach(function (v) {
        var pal = ((v.settings || {}).color || {}).palette || {};
        var colors = (pal.theme || pal.default || []).slice(0, 4);
        groups[colors.length ? 'color' : 'font'].push({ v: v, colors: colors });
      });
      [['color', 'Colours'], ['font', 'Fonts']].forEach(function (g) {
        if (!groups[g[0]].length) return;
        if (groups.color.length && groups.font.length) {
          var lab = document.createElement('div');
          lab.className = 'gogh-panel-group';
          lab.textContent = g[1];
          box.appendChild(lab);
        }
        groups[g[0]].forEach(function (item) {
          var v = item.v;
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'gogh-varbtn';
          if (item.colors.length) {
            b.innerHTML = item.colors.map(function (c) {
              return '<span class="gogh-vardot" style="background:' + c.color + '"></span>';
            }).join('') + '<span class="gogh-varname"></span>';
            b.querySelector('.gogh-varname').textContent = v.title || 'Style';
          } else {
            // the name is the specimen: each half of the pair in its own face
            ensureVariationFonts(v);
            var fams = (((v.settings || {}).typography || {}).fontFamilies || {}).theme || [];
            var name = document.createElement('span');
            name.className = 'gogh-varname gogh-varname-fonts';
            (v.title || 'Style').split(' & ').forEach(function (pt, k) {
              var piece = document.createElement('span');
              piece.textContent = (k ? ' & ' : '') + pt;
              var match = null;
              fams.forEach(function (f) {
                if (match) return;
                var label = (f.name || f.slug || f.fontFamily || '').toLowerCase();
                if (label.indexOf(pt.trim().toLowerCase()) !== -1) match = f;
              });
              if (!match) match = fams[k] || fams[0];
              if (match && match.fontFamily) piece.style.fontFamily = match.fontFamily;
              name.appendChild(piece);
            });
            b.appendChild(name);
          }
          if ((v.title || '') && (v.title || '') === (cfg.activeStyle || '')) b.classList.add('is-current');
          b.addEventListener('click', function () {
            clearVariationPreview();
            applyVariation(v, b);
          });
          // hover auditions the style — small debounce so sweeping the
          // cursor down the list doesn't strobe the page
          b.addEventListener('mouseenter', function () {
            clearTimeout(previewHoverT);
            previewHoverT = setTimeout(function () {
              ensureVariationFonts(v);
              previewVariation(v);
            }, 120);
          });
          box.appendChild(b);
        });
      });
      box.addEventListener('mouseleave', function () { clearVariationPreview(); });
      placePanelNear(anchorEl);
      panelOpen = true;
    }).catch(function () {});
  }
  // hover = instant local preview: the theme references its colours and
  // fonts through preset CSS variables, so overriding those vars in one
  // appended stylesheet re-skins the whole page with zero network. Click
  // still persists via applyVariation (full fidelity from the server).
  var previewStyleEl = null;
  var previewHoverT = null;
  function previewVariation(v) {
    var css = ':root{';
    var pal = ((v.settings || {}).color || {}).palette || {};
    (pal.theme || pal.default || []).forEach(function (p) {
      if (p.slug && p.color) css += '--wp--preset--color--' + p.slug + ':' + p.color + ';';
    });
    var fams = (((v.settings || {}).typography || {}).fontFamilies || {}).theme || [];
    fams.forEach(function (f) {
      if (f.slug && f.fontFamily) css += '--wp--preset--font-family--' + f.slug + ':' + f.fontFamily + ';';
    });
    css += '}';
    var resolve = function (s) {
      return String(s || '')
        .replace(/^var:preset\|color\|(.+)$/, 'var(--wp--preset--color--$1)')
        .replace(/^var:preset\|font-family\|(.+)$/, 'var(--wp--preset--font-family--$1)');
    };
    var sc = (v.styles || {}).color || {};
    var body = '';
    if (sc.background) body += 'background-color:' + resolve(sc.background) + ';';
    if (sc.text) body += 'color:' + resolve(sc.text) + ';';
    // font variations register their families under NEW preset slugs — the
    // page only picks them up through the variation's body/heading mappings,
    // so the preview must apply those too (colours reuse slugs; fonts don't)
    var ty = (v.styles || {}).typography || {};
    if (ty.fontFamily) body += 'font-family:' + resolve(ty.fontFamily) + ';';
    if (body) css += 'body{' + body + '}';
    var hty = ((((v.styles || {}).elements) || {}).heading || {}).typography || {};
    if (hty.fontFamily) {
      css += 'h1,h2,h3,h4,h5,h6,.wp-block-heading{font-family:' + resolve(hty.fontFamily) + ';}';
    }
    if (!previewStyleEl) {
      previewStyleEl = document.createElement('style');
      previewStyleEl.id = 'gogh-style-preview';
      document.head.appendChild(previewStyleEl);
    }
    previewStyleEl.textContent = css;
  }
  function clearVariationPreview() {
    clearTimeout(previewHoverT);
    if (previewStyleEl) previewStyleEl.textContent = '';
  }
  function applyVariation(v, btn) {
    if (btn) btn.disabled = true;
    return fetch(GSROOT + 'global-styles/' + cfg.gsId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
      credentials: 'same-origin',
      body: JSON.stringify({ styles: v.styles || {}, settings: v.settings || {} }),
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      // hot-swap the theme CSS so the whole page re-skins without a reload
      return fetch(location.href, { credentials: 'same-origin' });
    }).then(function (r) { return r.text(); }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      ['global-styles-inline-css', 'wp-fonts-local'].forEach(function (id) {
        var fresh = doc.getElementById(id);
        var cur = document.getElementById(id);
        if (fresh && cur) cur.textContent = fresh.textContent;
        else if (fresh && !cur) document.head.appendChild(fresh.cloneNode(true));
      });
      fontSizesCache = null;
      S.forEach(function (s) { measureTextHeights(s); });
      resolveAll();
      if (sel) placeHandles(sel.sec, sel.i);
      if (btn) btn.disabled = false;
      // remember the style's NAME — global styles forget it on copy
      cfg.activeStyle = v.title || '';
      fetch(cfg.restUrl.split('wp/v2/')[0] + 'gogh/v1/active-style', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
        credentials: 'same-origin',
        body: JSON.stringify({ name: cfg.activeStyle }),
      }).catch(function () {});
      [].forEach.call(panel.querySelectorAll('.gogh-varbtn.is-current'), function (x) { x.classList.remove('is-current'); });
      if (btn) btn.classList.add('is-current');
      toast('Theme style applied: ' + (v.title || ''));
      return true;
    }).catch(function (err) {
      if (btn) btn.disabled = false;
      toast('Could not apply that style.', { error: true });
      return false;
    });
  }
  function startWriting(afterIdx) {
    // leaner than the Article starter: nothing to delete, only to replace
    // no heading: the PAGE title is the title — straight into prose
    // prose starts where a post's first line would: tight under the title
    var tpl = { name: '__write', minH: 120, els: [
      { type: 'para', x: 280, y: 12, w: 640, h: 60, text: '', ph: 'Start writing.' },
    ] };
    var at = (typeof afterIdx === 'number' ? afterIdx : S.indexOf(viewportSection())) + 1;
    addSection(tpl, at);
    // straight into the words: select the heading and open its editor with
    // the caret ready — calm mode fades the chrome automatically
    var secW = null;
    for (var wi = S.length - 1; wi >= 0; wi--) {
      if (!S[wi].chrome && S[wi].els.length && S[wi].els[0].ph === tpl.els[0].ph) { secW = S[wi]; break; }
    }
    if (!secW) return;
    setTimeout(function () {
      placeHandles(secW, 0);
      enterTextEdit(secW, 0); // ghost placeholder: just start typing
    }, 350);
  }
  side.querySelector('.gogh-stylebtn').addEventListener('click', function (ev) {
    openStylePanel(ev.currentTarget);
  });
  side.querySelector('.gogh-pagestylebtn').addEventListener('click', function (ev) {
    openPageStylePanel(ev.currentTarget);
  });

  function snapPos(sec, exclude, x, y, w, h, free, textCXOff) {
    if (free) return { x: Math.round(x), y: Math.round(y), gx: null, gy: null };
    var H = designH(sec.els, sec.minH);
    var candX = [0, W, W / 2], candY = [0, H, H / 2];
    sec.els.forEach(function (o) {
      if (o === exclude) return;
      candX.push(o.x, o.x + o.w, o.x + o.w / 2);
      candY.push(o.y, o.y + o.h, o.y + o.h / 2);
    });
    var cc = compCands(H);
    cc.x.forEach(function (v) { candX.push(v); });
    cc.y.forEach(function (v) { candY.push(v); });
    function best(edges, cands) {
      var d = SNAP + 1, snap = null, guide = null;
      edges.forEach(function (edge) {
        cands.forEach(function (c) {
          var dd = Math.abs(c - edge.v);
          if (dd < d) { d = dd; snap = c - edge.off; guide = c; }
        });
      });
      return d <= SNAP ? { v: snap, g: guide } : null;
    }
    var xEdges = w > 0
      ? [{ v: x, off: 0 }, { v: x + w, off: w }, { v: x + w / 2, off: w / 2 }]
      : [{ v: x, off: 0 }];
    // when a text element's words don't fill its box, the ink's visual
    // centre REPLACES the box centre — the two must not compete, or the box
    // magnet catches first and the words sit visibly off-centre
    if (textCXOff != null && textCXOff > 0 && textCXOff < w) {
      xEdges = xEdges.filter(function (edge) { return edge.off !== w / 2; });
      xEdges.push({ v: x + textCXOff, off: textCXOff });
    }
    var yEdges = h > 0
      ? [{ v: y, off: 0 }, { v: y + h, off: h }, { v: y + h / 2, off: h / 2 }]
      : [{ v: y, off: 0 }];
    var sx = best(xEdges, candX);
    var sy = best(yEdges, candY);
    var gl = gridSnapOn || !!drag || !!resize; // the grid is visible mid-gesture, so its magnets are honest
    return {
      x: sx ? Math.round(sx.v) : (gl ? Math.round(x / BASE) * BASE : Math.round(x)),
      y: sy ? Math.round(sy.v) : (gl ? Math.round(y / BASE) * BASE : Math.round(y)),
      gx: sx ? sx.g : null,
      gy: sy ? sy.g : null,
    };
  }

  // ---------- smart spacing: neighbours, live distances, equal-space snap ----------
  function neighbors(sec, e) {
    var L = null, R = null, T = null, B = null;
    sec.els.forEach(function (o) {
      if (o === e) return;
      var vOv = o.y < e.y + e.h && o.y + o.h > e.y;
      var hOv = o.x < e.x + e.w && o.x + o.w > e.x;
      if (vOv) {
        if (o.x + o.w <= e.x + 2 && (!L || o.x + o.w > L.x + L.w)) L = o;
        if (o.x >= e.x + e.w - 2 && (!R || o.x < R.x)) R = o;
      }
      if (hOv) {
        if (o.y + o.h <= e.y + 2 && (!T || o.y + o.h > T.y + T.h)) T = o;
        if (o.y >= e.y + e.h - 2 && (!B || o.y < B.y)) B = o;
      }
    });
    return { L: L, R: R, T: T, B: B };
  }

  var dists = [];
  (function () {
    for (var di = 0; di < 4; di++) {
      var d = document.createElement('div');
      d.className = 'gogh-dist';
      d.appendChild(document.createElement('span'));
      d.hidden = true;
      document.body.appendChild(d);
      dists.push(d);
    }
  })();
  function hideDists() { dists.forEach(function (d) { d.hidden = true; }); }
  function showDist(idx, horiz, x, y, lenPx, label, equal) {
    if (idx >= dists.length || lenPx < 14) return;
    var d = dists[idx];
    d.className = 'gogh-dist ' + (horiz ? 'gogh-dist-h' : 'gogh-dist-v') + (equal ? ' is-equal' : '');
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    d.style.width = horiz ? lenPx + 'px' : '0px';
    d.style.height = horiz ? '0px' : lenPx + 'px';
    d.firstChild.textContent = (equal ? '= ' : '') + Math.round(label);
    d.hidden = false;
  }
  function drawDists(sec, i, eqH, eqV) {
    hideDists();
    var e = sec.els[i];
    var nb = neighbors(sec, e);
    var r = sec.sectionEl.getBoundingClientRect();
    var s = r.width / W;
    var px = function (v) { return r.left + window.scrollX + v * s; };
    var py = function (v) { return r.top + window.scrollY + v * s; };
    var di = 0, g, c;
    if (nb.L && (g = e.x - (nb.L.x + nb.L.w)) > 4) {
      c = (Math.max(e.y, nb.L.y) + Math.min(e.y + e.h, nb.L.y + nb.L.h)) / 2;
      showDist(di++, true, px(nb.L.x + nb.L.w), py(c), g * s, g * s, eqH);
    }
    if (nb.R && (g = nb.R.x - (e.x + e.w)) > 4) {
      c = (Math.max(e.y, nb.R.y) + Math.min(e.y + e.h, nb.R.y + nb.R.h)) / 2;
      showDist(di++, true, px(e.x + e.w), py(c), g * s, g * s, eqH);
    }
    if (nb.T && (g = e.y - (nb.T.y + nb.T.h)) > 4) {
      c = (Math.max(e.x, nb.T.x) + Math.min(e.x + e.w, nb.T.x + nb.T.w)) / 2;
      showDist(di++, false, px(c), py(nb.T.y + nb.T.h), g * s, g * s, eqV);
    }
    if (nb.B && (g = nb.B.y - (e.y + e.h)) > 4) {
      c = (Math.max(e.x, nb.B.x) + Math.min(e.x + e.w, nb.B.x + nb.B.w)) / 2;
      showDist(di++, false, px(c), py(e.y + e.h), g * s, g * s, eqV);
    }
    // no neighbour on a side → measure to the SECTION edge instead: page
    // margins are the distances people eyeball most
    if (!nb.L && (g = e.x) > 4) {
      showDist(di++, true, px(0), py(e.y + e.h / 2), g * s, g * s, false);
    }
    if (!nb.R && (g = W - (e.x + e.w)) > 4) {
      showDist(di++, true, px(e.x + e.w), py(e.y + e.h / 2), g * s, g * s, false);
    }
    if (!nb.T && (g = e.y) > 4) {
      showDist(di++, false, px(e.x + e.w / 2), py(0), g * s, g * s, false);
    }
    if (!nb.B) {
      var H2 = designH(sec.els, sec.minH);
      if ((g = H2 - (e.y + e.h)) > 4) {
        showDist(di++, false, px(e.x + e.w / 2), py(e.y + e.h), g * s, g * s, false);
      }
    }
  }

  // ---------- resizing: 8-direction handles ----------
  var resize = null, resizeRaf = false;
  function snapAxis(cands, v) {
    var best = null, d = SNAP + 1;
    cands.forEach(function (c) {
      var dd = Math.abs(c - v);
      if (dd < d) { d = dd; best = c; }
    });
    return best !== null ? { v: best, g: best } : { v: Math.round(v / BASE) * BASE, g: null };
  }
  selBox.querySelectorAll('.gogh-h').forEach(function (hBtn) {
    hBtn.addEventListener('pointerdown', function (ev) {
      if (!editing || !sel) return;
      ev.preventDefault();
      ev.stopPropagation();
      closePanel();
      try { hBtn.setPointerCapture(ev.pointerId); } catch (err) {}
      var sec = sel.sec;
      var e = sec.els[sel.i];
      var dir = DIRS.filter(function (d) { return d.d === hBtn.dataset.d; })[0];
      var candX = [0, W, W / 2], candY = [0];
      sec.els.forEach(function (o) {
        if (o === e) return;
        candX.push(o.x, o.x + o.w, o.x + o.w / 2);
        candY.push(o.y, o.y + o.h, o.y + o.h / 2);
      });
      var ccR = compCands(designH(sec.els, sec.minH));
      ccR.x.forEach(function (v) { candX.push(v); });
      ccR.y.forEach(function (v) { candY.push(v); });
      resize = { sec: sec, i: sel.i, dir: dir, px: ev.clientX, py: ev.clientY,
        x: e.x, y: e.y, w: e.w, h: e.h, candX: candX, candY: candY };
      sec.sectionEl.classList.add('gogh-grid-live');
      document.documentElement.classList.add('gogh-dragging');
      drag = null;
    });
    hBtn.addEventListener('pointermove', function (ev) {
      if (!resize) return;
      var sec = resize.sec;
      var s = scaleOf(sec);
      var e = sec.els[resize.i];
      var dir = resize.dir;
      // Canva-style: corner-drag on TEXT steps through the theme's preset
      // font sizes rather than free-scaling (Global Styles stay authoritative)
      if (isText(e) && dir.dx !== 0 && dir.dy !== 0) {
        var diag = ((ev.clientX - resize.px) * dir.dx + (ev.clientY - resize.py) * dir.dy) / 2;
        var want = Math.round(diag / 56);
        if (want !== (resize.fsSteps || 0)) {
          applyFontStep(sec, resize.i, want - (resize.fsSteps || 0));
          resize.fsSteps = want;
        }
        sizeChip.textContent = e.fs ? (DISPLAY_LABEL[e.fs] || e.fs) : 'theme default';
        sizeChip.style.left = (ev.clientX + 18 + window.scrollX) + 'px';
        sizeChip.style.top = (ev.clientY + 18 + window.scrollY) + 'px';
        sizeChip.hidden = false;
        return;
      }
      var dx = (ev.clientX - resize.px) / s;
      var dy = (ev.clientY - resize.py) / s;
      var nx = resize.x, ny = resize.y, nw = resize.w, nh = resize.h;
      var gx = null, gy = null;
      if (dir.dx === 1) {
        var sr = snapAxis(resize.candX, resize.x + resize.w + dx);
        nw = sr.v - resize.x; gx = sr.g;
      } else if (dir.dx === -1) {
        var sl = snapAxis(resize.candX, resize.x + dx);
        nx = sl.v; nw = resize.x + resize.w - sl.v; gx = sl.g;
      }
      if (fixedHeight(e)) {
        if (dir.dy === 1) {
          var sb = snapAxis(resize.candY, resize.y + resize.h + dy);
          nh = sb.v - resize.y; gy = sb.g;
        } else if (dir.dy === -1) {
          var st = snapAxis(resize.candY, resize.y + dy);
          ny = st.v; nh = resize.y + resize.h - st.v; gy = st.g;
        }
      }
      // Canva-style: corner-drag on a SHAPE scales it, keeping its
      // proportions (edge handles still stretch it freely on purpose)
      if (e.type === 'box' && e.shape && dir.dx !== 0 && dir.dy !== 0) {
        nh = nw * (resize.h / resize.w);
        if (dir.dy === -1) ny = resize.y + resize.h - nh;
        gy = null;
      }
      if (nw < 60) { if (dir.dx === -1) nx = resize.x + resize.w - 60; nw = 60; }
      if (nh < 32) { if (dir.dy === -1) ny = resize.y + resize.h - 32; nh = 32; }
      nx = Math.max(0, Math.min(W - nw, nx));
      ny = Math.max(0, ny);
      e.x = Math.round(nx); e.y = Math.round(ny);
      e.w = Math.round(Math.min(W - e.x, nw));
      // text height belongs to the measurer — writing it here re-arms the
      // reflow push every frame and compounds into runaway pushing
      if (fixedHeight(e)) e.h = Math.round(nh);
      if (!resizeRaf) {
        resizeRaf = true;
        requestAnimationFrame(function () {
          resizeRaf = false;
          if (!resize) return;
          var oldH = e.h;
          resolveAndApply(sec);
          measureTextHeights(sec);
          if (isText(e) && reflowPush(sec, e, oldH)) resolveAndApply(sec);
          showGuides(sec, gx, gy);
          placeHandles(sec, resize.i);
        });
      }
    });
    hBtn.addEventListener('pointerup', function () { endResize(); });
    hBtn.addEventListener('pointercancel', function () { endResize(); });
  });
  function endResize() {
    if (!resize) return;
    sizeChip.hidden = true;
    var sec = resize.sec, i = resize.i;
    sec.sectionEl.classList.remove('gogh-grid-live');
    var e = sec.els[i];
    var oldH = e.h;
    resize = null;
    document.documentElement.classList.remove('gogh-dragging');
    hideGuides();
    resolveAndApply(sec);
    measureTextHeights(sec);
    if (isText(e) && reflowPush(sec, e, oldH)) resolveAndApply(sec);
    else resolveAndApply(sec);
    placeHandles(sec, i);
    pushState();
  }

  // ---------- rotation ----------
  var rotD = null, rotRaf = false;
  rotGrip.addEventListener('pointerdown', function (ev) {
    if (!editing || !sel) return;
    ev.preventDefault();
    ev.stopPropagation();
    closePanel();
    try { rotGrip.setPointerCapture(ev.pointerId); } catch (err) {}
    var node = sel.sec.nodes[sel.i];
    var r = node.getBoundingClientRect();
    rotD = { sec: sel.sec, i: sel.i, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    document.documentElement.classList.add('gogh-dragging');
  });
  rotGrip.addEventListener('pointermove', function (ev) {
    if (!rotD) return;
    var e = rotD.sec.els[rotD.i];
    var deg = -Math.atan2(ev.clientX - rotD.cx, ev.clientY - rotD.cy) * 180 / Math.PI;
    var snap15 = Math.round(deg / 15) * 15;
    if (Math.abs(deg - snap15) < 5) deg = snap15;
    deg = Math.round(deg);
    if (deg > 180) deg -= 360;
    if (deg <= -180) deg += 360;
    e.rot = (Math.abs(deg) < 2 || Math.abs(deg) > 178) && deg % 15 === 0 && Math.abs(deg) < 2 ? 0 : deg;
    if (Math.abs(e.rot) < 2) e.rot = 0;
    if (!rotRaf) {
      rotRaf = true;
      requestAnimationFrame(function () {
        rotRaf = false;
        if (!rotD) return;
        resolveAndApply(rotD.sec);
        placeHandles(rotD.sec, rotD.i);
      });
    }
  });
  function endRot() {
    if (!rotD) return;
    var sec = rotD.sec, i = rotD.i;
    rotD = null;
    document.documentElement.classList.remove('gogh-dragging');
    resolveAndApply(sec);
    placeHandles(sec, i);
    pushState();
  }
  rotGrip.addEventListener('pointerup', endRot);
  rotGrip.addEventListener('pointercancel', endRot);

  // safety net: a pointerup anywhere always ends drag/resize so state can
  // never get stuck (which would silently block all selection)
  document.addEventListener('pointerup', function () {
    if (drag) endDrag();
    if (resize) endResize();
    if (hDrag) endHDrag();
    if (rotD) endRot();
  }, true);
  document.addEventListener('pointercancel', function () {
    if (drag) endDrag();
    if (resize) endResize();
    if (hDrag) endHDrag();
    if (rotD) endRot();
    pendingDrag = null;
    if (marq) { marq = null; marqBox.hidden = true; }
  }, true);

  // on scroll, keep the selection and move its handles with it
  var scrollRaf = false;
  window.addEventListener('scroll', function () {
    if (drag || resize || hDrag || rotD) return;
    closePanel();
    inserter.hidden = true;
    hideHbar();
    shapeBtn.hidden = true;
    closeShapePanel();
    hideSecBar();
    hideGuides();
    hideDists();
    if (scrollRaf) return;
    scrollRaf = true;
    requestAnimationFrame(function () {
      scrollRaf = false;
      if (sel && !drag && !resize) placeHandles(sel.sec, sel.i);
    });
  }, { passive: true });

  // debug/state hook
  // ---------- bird's-eye: the whole page, sections drag to reorder ----------
  var zoomOv = document.createElement('div');
  zoomOv.className = 'gogh-zoom';
  zoomOv.hidden = true;
  zoomOv.innerHTML = '<div class="gogh-zoom-head">Whole page \u2014 drag sections to reorder' +
    '<button type="button" class="gogh-btn gogh-btn-small gogh-zoom-close">Close</button></div>' +
    '<div class="gogh-zoom-col"></div>';
  document.body.appendChild(zoomOv);
  // opened from the gogh palette (the floating corner tabs are gone \u2014
  // the canvas stays clean)
  function closeZoom() { zoomOv.hidden = true; }
  zoomOv.querySelector('.gogh-zoom-close').addEventListener('click', closeZoom);
  // clicking the backdrop (anywhere off the cards) also closes
  zoomOv.addEventListener('pointerdown', function (ev) {
    if (ev.target === zoomOv || ev.target.classList.contains('gogh-zoom-col')) closeZoom();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !zoomOv.hidden) { closeZoom(); ev.stopPropagation(); }
  }, true);
  function resyncContentOrder() {
    var order = [].slice.call(pageParent.children);
    var pos = function (sec) { return order.indexOf(sec.wrapEl); };
    var head = S.filter(function (s) { return s.chrome && s.chrome.area !== 'footer'; });
    var foot = S.filter(function (s) { return s.chrome && s.chrome.area === 'footer'; });
    var content = S.filter(function (s) { return !s.chrome; }).sort(function (a, b) { return pos(a) - pos(b); });
    S.length = 0;
    head.concat(content, foot).forEach(function (s) { S.push(s); });
    resolveAll();
    pushState();
  }
  function openZoom() {
    var col = zoomOv.querySelector('.gogh-zoom-col');
    col.innerHTML = '';
    var CARD_W = 440;
    // the page in true order: freeform sections AND native pattern sections
    // drag to reorder; other stored blocks show pinned for context
    var items = [];
    S.filter(function (s) { return s.chrome && s.chrome.area !== 'footer'; }).forEach(function (s) {
      items.push({ kind: 'chrome', sec: s, label: 'Header' });
    });
    [].slice.call(pageParent.children).forEach(function (n) {
      if (!n.classList) return;
      if (n.classList.contains('gogh-wrap')) {
        var sec = S.filter(function (s) { return s.wrapEl === n; })[0];
        // chrome sections render as the pinned Header/Footer cards — never
        // twice, even if a stray remount left their wrap in the page body
        if (sec && !sec.chrome) items.push({ kind: 'sec', sec: sec, node: n });
      } else if (n.classList.contains('gogh-pending')) {
        items.push({ kind: 'pending', node: n });
      } else if (n.tagName !== 'STYLE' && n.tagName !== 'SCRIPT' &&
        ((n.textContent || '').trim().length > 0 || n.querySelector('img,iframe,video,svg,canvas'))) {
        items.push({ kind: 'static', node: n, bound: storedEdits.some(function (en) { return en.el === n; }) });
      }
    });
    S.filter(function (s) { return s.chrome && s.chrome.area === 'footer'; }).forEach(function (s) {
      items.push({ kind: 'chrome', sec: s, label: 'Footer' });
    });
    var secN = 0;
    items.forEach(function (it) {
      var card = document.createElement('div');
      // stored native blocks drag too once their raw span is bound (publish
      // re-emits top-level spans in DOM order); unbound ones stay pinned
      var pinned = it.kind === 'chrome' || (it.kind === 'static' && !it.bound);
      card.className = 'gogh-zoom-card' + (pinned ? ' is-chrome' : '');
      card.__it = it;
      var label;
      if (it.kind === 'chrome') label = it.label;
      else if (it.kind === 'static' && !it.bound) label = 'Other content';
      else {
        secN++;
        label = 'Section ' + secN +
          (it.kind === 'pending' ? ' \u00b7 pattern \u2014 drag me' : ' \u00b7 drag me');
      }
      var srcEl = it.sec ? it.sec.sectionEl : it.node;
      var stage = document.createElement('div');
      stage.className = 'gogh-zoom-stage';
      var clone = srcEl.cloneNode(true);
      clone.removeAttribute('style');
      [].slice.call(clone.querySelectorAll('[contenteditable]')).forEach(function (n2) { n2.removeAttribute('contenteditable'); });
      [].slice.call(clone.querySelectorAll('.gogh-selected, .gogh-dragsrc, .gogh-textedit, .gogh-fan, .gogh-multisel')).forEach(function (n2) {
        n2.classList.remove('gogh-selected', 'gogh-dragsrc', 'gogh-textedit', 'gogh-fan', 'gogh-multisel');
      });
      [].slice.call(clone.querySelectorAll('.gogh-pendbar')).forEach(function (n2) { n2.remove(); });
      clone.classList.remove('gogh-pending');
      stage.appendChild(clone);
      stage.style.zoom = CARD_W / 1200;
      stage.style.background = pageBg();
      card.innerHTML = '<div class="gogh-zoom-label">' + label + '</div>';
      card.appendChild(stage);
      col.appendChild(card);
    });
    zoomOv.hidden = false;
    var zdrag = null;
    var cardsOf = function () { return [].slice.call(col.querySelectorAll('.gogh-zoom-card')); };
    var lastDragMeta = null;
    function zdragSigCheck(card) {
      if (!lastDragMeta) return false;
      if (pinnedSig(card) === lastDragMeta.origSig) return false;
      col.insertBefore(card, lastDragMeta.origNext);
      toast('That section can\u2019t move past other stored content yet.', { error: true });
      return true;
    }
    var pinnedSig = function (card) {
      return cardsOf().filter(function (c) { return c.classList.contains('is-chrome') && c.__it && c.__it.kind === 'static'; })
        .map(function (p) { return (p.compareDocumentPosition(card) & 2) ? 'a' : 'b'; }).join('');
    };
    col.onpointerdown = function (ev) {
      var card = ev.target.closest ? ev.target.closest('.gogh-zoom-card') : null;
      if (!card || card.classList.contains('is-chrome')) return;
      ev.preventDefault();
      zdrag = { card: card, y0: ev.clientY, moved: false,
        origNext: card.nextSibling, origSig: pinnedSig(card) };
      try { col.setPointerCapture(ev.pointerId); } catch (err) {}
    };
    col.onpointermove = function (ev) {
      if (!zdrag) return;
      var dy = ev.clientY - zdrag.y0;
      if (!zdrag.moved && Math.abs(dy) < 5) return;
      zdrag.moved = true;
      zdrag.card.classList.add('is-lifting');
      zdrag.card.style.transform = 'translateY(' + dy + 'px)';
      var r = zdrag.card.getBoundingClientRect();
      var mid = r.top + r.height / 2;
      cardsOf().forEach(function (other) {
        if (other === zdrag.card || other.classList.contains('is-chrome')) return;
        var or2 = other.getBoundingClientRect();
        var omid = or2.top + or2.height / 2;
        if (mid < omid && zdrag.card.compareDocumentPosition(other) & 2) {
          other.before(zdrag.card);
          zdrag.y0 = ev.clientY;
          zdrag.card.style.transform = '';
        } else if (mid > omid && zdrag.card.compareDocumentPosition(other) & 4) {
          other.after(zdrag.card);
          zdrag.y0 = ev.clientY;
          zdrag.card.style.transform = '';
        }
      });
    };
    col.onpointercancel = function () {
      if (!zdrag) return;
      zdrag.card.classList.remove('is-lifting');
      zdrag.card.style.transform = '';
      zdrag = null;
    };
    col.onpointerup = function () {
      if (!zdrag) return;
      var card = zdrag.card;
      var wasDrag = zdrag.moved;
      lastDragMeta = { origSig: zdrag.origSig, origNext: zdrag.origNext };
      zdrag = null;
      card.classList.remove('is-lifting');
      card.style.transform = '';
      var it = card.__it;
      if (!wasDrag) {
        closeZoom();
        (it.sec ? it.sec.wrapEl : it.node).scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      // reordering across a stored non-gogh block would silently revert on
      // publish (its position lives in the page's raw) — refuse honestly
      if (zdragSigCheck(card)) return;
      // move the page node to mirror the card's new column position
      var node = it.node || (it.sec && it.sec.wrapEl);
      if (!node) return;
      var arr = cardsOf();
      var i2 = arr.indexOf(card);
      var before = null;
      for (var k = i2 + 1; k < arr.length; k++) {
        var itk = arr[k].__it;
        if (!itk || itk.kind === 'chrome') continue;
        before = itk.node || (itk.sec && itk.sec.wrapEl);
        if (before) break;
      }
      pageParent.insertBefore(node, before || endMarker);
      if (it.kind === 'sec') resyncContentOrder();
      else { resolveAll(); refreshChip(); }
      toast('Section moved.');
    };
  }
  side.querySelector('.gogh-zoomopen').addEventListener('click', openZoom);

  // ---------- marquee: drag on empty canvas to lasso a group ----------
  var marq = null;
  var marqBox = document.createElement('div');
  marqBox.className = 'gogh-marquee';
  marqBox.hidden = true;
  document.body.appendChild(marqBox);
  document.addEventListener('pointerdown', function (ev) {
    if (!editing || drag || resize || hDrag || rotD || panelOpen || !picker.hidden) return;
    if (ev.button !== 0 || ev.shiftKey) return;
    var t = ev.target;
    if (!t.classList || !t.classList.contains('gogh-section')) return;
    var secM = S.filter(function (s) { return s.sectionEl === t; })[0];
    if (!secM) return;
    marq = { sec: secM, x0: ev.clientX, y0: ev.clientY, x1: ev.clientX, y1: ev.clientY, on: false };
  });
  document.addEventListener('pointermove', function (ev) {
    if (!marq) return;
    marq.x1 = ev.clientX;
    marq.y1 = ev.clientY;
    if (!marq.on && Math.hypot(marq.x1 - marq.x0, marq.y1 - marq.y0) < 6) return;
    marq.on = true;
    marqBox.style.left = Math.min(marq.x0, marq.x1) + 'px';
    marqBox.style.top = Math.min(marq.y0, marq.y1) + 'px';
    marqBox.style.width = Math.abs(marq.x1 - marq.x0) + 'px';
    marqBox.style.height = Math.abs(marq.y1 - marq.y0) + 'px';
    marqBox.hidden = false;
  });
  document.addEventListener('pointerup', function () {
    if (!marq) return;
    var m = marq;
    marq = null;
    marqBox.hidden = true;
    if (!m.on) return;
    var r = m.sec.sectionEl.getBoundingClientRect();
    if (r.width < 10) return;
    var s = r.width / W;
    var rx0 = (Math.min(m.x0, m.x1) - r.left) / s, rx1 = (Math.max(m.x0, m.x1) - r.left) / s;
    var ry0 = (Math.min(m.y0, m.y1) - r.top) / s, ry1 = (Math.max(m.y0, m.y1) - r.top) / s;
    var hits = [];
    m.sec.els.forEach(function (o, j) {
      if (o.x < rx1 && o.x + o.w > rx0 && o.y < ry1 && o.y + o.h > ry0) hits.push(j);
    });
    if (hits.length >= 2) setMulti(m.sec, hits);
    else if (hits.length === 1) placeHandles(m.sec, hits[0]);
  });

  // ---------- exploded layers: fan a stack out (programmatic only — the
  // press-and-hold trigger was removed; it kept firing on slow clicks) ----------
  var explodeSt = null;
  function enterExplode(sec, cluster) {
    exitExplode();
    explodeSt = { sec: sec, cluster: cluster };
    sec.sectionEl.classList.add('gogh-exploded');
    sec.sectionEl.style.perspective = '1400px';
    hideHandles();
    var n = cluster.length;
    cluster.forEach(function (idx, ci) {
      var node = sec.nodes[idx];
      if (!node) return;
      var e = sec.els[idx];
      var spread = ci - (n - 1) / 2;
      node.classList.add('gogh-fan');
      node.style.zIndex = 9990 + ci;
      node.style.transform =
        (e.rot ? 'rotate(' + e.rot + 'deg) ' : '') +
        'translate(' + Math.round(spread * 56) + 'px,' + Math.round(spread * -44) + 'px) ' +
        'translateZ(' + (ci * 48) + 'px) rotate(' + (spread * 2.5) + 'deg)';
    });
  }
  function exitExplode() {
    if (!explodeSt) return;
    var st = explodeSt;
    explodeSt = null;
    st.sec.sectionEl.classList.remove('gogh-exploded');
    st.sec.sectionEl.style.perspective = '';
    st.cluster.forEach(function (idx) {
      var node = st.sec.nodes[idx];
      if (!node) return;
      node.classList.remove('gogh-fan');
      node.style.zIndex = '';
      node.style.transform = '';
    });
  }
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && explodeSt) { exitExplode(); ev.stopPropagation(); }
    else if (ev.key === 'Escape' && multiSel) { clearMulti(); ev.stopPropagation(); }
  }, true);
  document.addEventListener('pointerdown', function (ev) {
    if (!multiSel || ev.shiftKey) return;
    if (ev.target.closest && ev.target.closest('.gogh-side, .gogh-panel, .gogh-secbar, .gogh-elbar, .gogh-marquee')) return;
    var member = false;
    multiSel.idxs.forEach(function (j) {
      var n = multiSel.sec.nodes[j];
      if (n && (n === ev.target || n.contains(ev.target))) member = true;
    });
    if (!member) clearMulti();
  }, true);

  // ---------- live mobile mirror ----------
  var MIRROR_W = 250, MIRROR_DESIGN = 360;
  var mirror = document.createElement('div');
  mirror.className = 'gogh-mirror';
  mirror.hidden = true;
  mirror.innerHTML =
    '<div class="gogh-mirror-head"><span>Mobile \u00b7 live</span>' +
    '<button type="button" class="gogh-sbtn gogh-mirror-close" title="Hide">\u2715</button></div>' +
    '<div class="gogh-mirror-frame"><div class="gogh-mirror-vp"><div class="gogh-mirror-stage"></div></div></div>';
  document.body.appendChild(mirror);
  // the stage is a static clone — no interactivity runtime — so the nav's
  // hamburger would be a dead control ("mobile menu does not open"). Toggle
  // the overlay classes ourselves, and keep preview links from navigating.
  // the mirror is its own little world: pointerdowns inside it must not
  // reach the page-level editor handlers (deselect etc.), whose DOM cleanup
  // trips the mutation observer and rebuilds the stage 120ms later — the
  // "menu opens then glitches closed" report
  mirror.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
  mirror.addEventListener('click', function (ev) {
    var openBtn = ev.target.closest && ev.target.closest('.wp-block-navigation__responsive-container-open');
    if (openBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      var nav = openBtn.closest('nav');
      var mc = nav && nav.querySelector('.wp-block-navigation__responsive-container');
      if (mc) mc.classList.add('is-menu-open', 'has-modal-open');
      return;
    }
    var closeBtn = ev.target.closest && ev.target.closest('.wp-block-navigation__responsive-container-close');
    if (closeBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      var mc2 = closeBtn.closest('.wp-block-navigation__responsive-container');
      if (mc2) mc2.classList.remove('is-menu-open', 'has-modal-open');
      return;
    }
    var a = ev.target.closest && ev.target.closest('.gogh-mirror-stage a');
    if (a) ev.preventDefault();
  });
  var mirrorBtnSide = side.querySelector('.gogh-mirroropen');
  var mirrorT = null;
  var mirrorObs = new MutationObserver(function () { scheduleMirror(); });
  function pageBg() {
    // sections with no background inherit the page's — miniatures must too
    var b = getComputedStyle(document.body).backgroundColor;
    if (!b || b === 'rgba(0, 0, 0, 0)' || b === 'transparent') {
      b = getComputedStyle(document.documentElement).backgroundColor;
    }
    return (!b || b === 'rgba(0, 0, 0, 0)' || b === 'transparent') ? '#fff' : b;
  }
  function refreshMirror() {
    if (mirror.hidden) return;
    var stage = mirror.querySelector('.gogh-mirror-stage');
    var menuWasOpen = !!stage.querySelector('.wp-block-navigation__responsive-container.is-menu-open');
    stage.innerHTML = '';
    mirrorObs.disconnect();
    // the whole page, in true DOM order — freeform sections (header, content,
    // footer) AND native content: pasted holders awaiting publish plus
    // published native blocks (e.g. HTML sections never made freeform)
    var items = [];
    // native site chrome frames the preview (freeform chrome arrives via S)
    ['header', 'footer'].forEach(function (area) {
      var pe = partElForArea(area);
      if (pe && !pe.querySelector('.gogh-wrap')) items.push({ live: pe, src: pe });
    });
    S.forEach(function (sec) {
      if (sec.sectionEl) items.push({ live: sec.wrapEl || sec.sectionEl, src: sec.sectionEl, sec: sec });
    });
    pendingBlocks.forEach(function (p) {
      if (p.el && p.el.isConnected) items.push({ live: p.el, src: p.el });
    });
    topBlockNodes().forEach(function (n) {
      if (n.tagName !== 'STYLE') items.push({ live: n, src: n });
    });
    items.sort(function (a, b) {
      return (a.live.compareDocumentPosition(b.live) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
    });
    items.forEach(function (it) {
      mirrorObs.observe(it.src, { subtree: true, childList: true, characterData: true });
      var clone = it.src.cloneNode(true);
      if (it.sec) clone.removeAttribute('style');
      [].slice.call(clone.querySelectorAll('[contenteditable]')).forEach(function (n) { n.removeAttribute('contenteditable'); });
      [].slice.call(clone.querySelectorAll('.gogh-pendbar, .gogh-navadd, .gogh-logochip')).forEach(function (n) { n.remove(); });
      [].slice.call(clone.querySelectorAll('.gogh-selected, .gogh-dragsrc, .gogh-textedit, .gogh-fan')).forEach(function (n) {
        n.classList.remove('gogh-selected', 'gogh-dragsrc', 'gogh-textedit', 'gogh-fan');
        n.style.transform = '';
        n.style.zIndex = '';
      });
      clone.classList.remove('gogh-exploded', 'gogh-pending');
      stage.appendChild(clone);
    });
    if (menuWasOpen) {
      var mc0 = stage.querySelector('.wp-block-navigation__responsive-container');
      if (mc0) mc0.classList.add('is-menu-open', 'has-modal-open');
    }
    // zoom (not transform) so the scroll extent shrinks with the content
    // while container queries still see a 360px viewport
    stage.style.zoom = MIRROR_W / MIRROR_DESIGN;
    var frame = mirror.querySelector('.gogh-mirror-frame');
    frame.style.background = pageBg();
  }
  function scheduleMirror() {
    if (mirror.hidden) return;
    clearTimeout(mirrorT);
    mirrorT = setTimeout(refreshMirror, 120);
  }
  function openMirror() {
    mirror.hidden = false;
    mirrorBtnSide.classList.add('is-active');
    try { localStorage.setItem('gogh-mirror', '1'); } catch (err) {}
    refreshMirror();
  }
  function closeMirror() {
    mirror.hidden = true;
    mirrorBtnSide.classList.remove('is-active');
    mirrorObs.disconnect();
    try { localStorage.setItem('gogh-mirror', '0'); } catch (err) {}
  }
  // the mirror rides along: as you scroll the page it follows the section
  // in view and scrolls its own little viewport in step
  var mirrorScrollT = null;
  function syncMirrorScroll() {
    if (mirror.hidden) return;
    var vp = mirror.querySelector('.gogh-mirror-vp');
    var denom = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    var p = Math.max(0, Math.min(1, window.scrollY / denom));
    var range = vp.scrollHeight - vp.clientHeight;
    if (range > 0) vp.scrollTo({ top: p * range, behavior: 'smooth' });
  }
  window.addEventListener('scroll', function () {
    if (mirror.hidden) return;
    clearTimeout(mirrorScrollT);
    mirrorScrollT = setTimeout(syncMirrorScroll, 110);
  }, { passive: true });
  mirrorBtnSide.addEventListener('click', function () {
    if (mirror.hidden) openMirror(); else closeMirror();
  });
  mirror.querySelector('.gogh-mirror-close').addEventListener('click', closeMirror);
  document.addEventListener('pointerup', function () { scheduleMirror(); });
  try {
    // never auto-open during a test run — whole-page re-clones mid-suite
    // add noise the tests don't deserve
    if (wantEdit && localStorage.getItem('gogh-mirror') === '1' && location.search.indexOf('gogh-test') === -1) {
      mirror.hidden = false;
      mirrorBtnSide.classList.add('is-active');
    }
  } catch (err) {}

  window.__gogh = {
    mirror: { open: openMirror, close: closeMirror, refresh: refreshMirror, el: mirror },
    explode: { enter: enterExplode, exit: exitExplode, state: function () { return explodeSt; } },
    multi: { set: setMulti, clear: clearMulti, state: function () { return multiSel; } },
    zoom: { open: openZoom, close: closeZoom, el: zoomOv },
    reorderSection: reorderSection,
    reorderNavRaw: reorderNavRaw,
    stickyRawToggle: stickyRawToggle,
    chromeDialsRead: chromeDialsRead,
    inkWidthOf: inkWidthOf,
    themeFontSizeList: themeFontSizeList,
    chromeDialsApply: chromeDialsApply,
    insertGoghPattern: insertGoghPattern,
    addHtmlSection: addHtmlSection,
    startChromeCycle: startChromeCycle,
    openPicker: openPicker,
    navLinkMarkup: navLinkMarkup,
    chromeEdits: function () { return chromeLightEdits; },
    bindChromeTest: function (el, raw) {
      var e = { el: el, raw: raw, savedRaw: raw, chromePart: true, partId: 0, title: 'test chrome' };
      chromeLightEdits.push(e);
      bindPending(e);
      return e;
    },
    pending: function () { return pendingBlocks; },
    storedEdits: function () { return storedEdits; },
    previewVariation: previewVariation,
    clearVariationPreview: clearVariationPreview,
    initStoredEdits: initStoredEdits,
    bindStoredTest: function (el, raw) {
      var e = { el: el, raw: raw, savedRaw: raw, stored: true, selfBlock: true, title: 'test stored' };
      storedEdits.push(e);
      bindPending(e);
      return e;
    },
    get state() {
      return { editing: editing, sections: S.length, sel: sel ? { i: sel.i } : null,
        drag: !!drag, resize: !!resize, history: history.length, hIdx: hIdx };
    },
    sections: function () { return S; },
    showHbar: function (i) { placeHbar(S[i]); },
    openShapePanel: openShapePanel,
    openSecBgPanel: openSecBgPanel,
    scan: scanDomWithRaw,
    addSection: addSection,
    renderSection: renderSection,
    pushState: pushState,
    templates: function () { return TEMPLATES; },
    resolveAll: resolveAll,
    reflowPush: reflowPush,
    measure: measureTextHeights,
    resolve: resolveAndApply,
    serialize: serialize,
    syncModelFromMarkup: syncModelFromMarkup,
    cleanInline: cleanInline,
    showTip: showTipNow,
    applyTextLink: applyTextLink,
    readingOrder: function (els) {
      var rank = readingRank(els);
      var order = [];
      rank.forEach(function (r, i) { order[r] = i; });
      return order;
    },
    toast: toast,
    publish: publish,
    isDirty: isDirty,
    parseTopBlocks: parseTopBlocks,
    convertBlock: convertBlock,
    convertChrome: convertChrome,
    restore: restoreState,
    setEditing: setEditing,
    deleteSection: deleteSection,
    moveSection: moveSection,
    duplicateSection: duplicateSection,
    openSide: openSide,
    closeSide: closeSide,
    fontSizes: fontSizes,
    setFontSize: setFontSize,
    stepFontSize: stepFontSize,
    setSecBg: setSecBg,
    buildBlocks: buildAllBlocks,
    buildV3: function () { return realSections().map(buildSectionBlocksV3).join('\n\n'); },
    mergeContent: mergeContent,
    closePanel: closePanel,
    addElementAt: addElementAtViewport,
    addElementToSection: addElementToSection,
    composeFeaturedProduct: composeFeaturedProduct,
    contrastSentinel: contrastSentinel,
    sectionThemes: sectionThemes,
    rearrangeVariants: rearrangeVariants,
    scaleFontSizes: scaleFontSizes,
    applySectionTheme: applySectionTheme,
    openSecAdd: openSecAddPanel,
    showGuides: showGuides,
    addShape: addShapeAtViewport,
    shapeDefs: function () { return SHAPE_DEFS; },
    resequenceToDom: resequenceToDom,
    gatherRawUnits: gatherRawUnits,
    parseNavModel: parseNavModel,
    serializeNavModel: serializeNavModel,
    sanitizePastedHtml: sanitizePastedHtml,
    openPageStylePanel: openPageStylePanel,
    goghHasNativeContent: goghHasNativeContent,
    wrapImageIntoText: wrapImageIntoText,
    wrapTargetIdx: wrapTargetIdx,
    bindPending: bindPending,
    convertStash: function () { return convertStash; },
    deleteSectionRaw: deleteSection,
    contrastRatio: contrastRatio,
    brandToVariation: brandToVariation,
    cssColorToHex: cssColorToHex,
    effectiveBgHex: effectiveBgHex,
    markSwatchLegibility: markSwatchLegibility,
    openBrandForm: openBrandForm,
    openMenuManager: openMenuManager,
  };
  // the running build, visible at a glance: hover the gogh side tab, or read
  // it in the console — kills "is this tab stale?" debugging forever
  var GOGH_BUILD = (document.querySelector('script[src*="gogh-editor.js"]') || { src: '' }).src.split('ver=')[1] || 'dev';
  window.__gogh.build = GOGH_BUILD;
  sideTab.title = 'gogh ' + GOGH_BUILD;
  try { console.info('[gogh] ' + GOGH_BUILD); } catch (e0) {}
  document.dispatchEvent(new CustomEvent('gogh:ready'));

  // ---------- keyboard ----------
  window.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && panelOpen) {
      closePanel();
      return;
    }
    if (!editing || panelOpen || !picker.hidden) return;
    var a = document.activeElement;
    var typing = a && (a.isContentEditable || /INPUT|TEXTAREA/.test(a.tagName));
    if (ev.key === '/' && !typing && cmd.hidden) {
      ev.preventDefault();
      openCmd();
      return;
    }
    if (ev.key === 'Escape' && textEditing) {
      exitTextEdit();
      return;
    }
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') {
      var ksel = window.getSelection();
      var ka = document.activeElement;
      if (ka && ka.isContentEditable && ksel && (!ksel.isCollapsed || (ksel.anchorNode && (ksel.anchorNode.nodeType === 1 ? ksel.anchorNode : ksel.anchorNode.parentElement).closest('a')))) {
        ev.preventDefault();
        openTextLinkPanel();
        return;
      }
    }
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 's') {
      ev.preventDefault();
      publish();
      return;
    }
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) redo(); else undo();
      return;
    }
    if (typing) return;
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && (sel || multiSel)) {
      ev.preventDefault();
      deleteSelected();
      return;
    }
    if ((!sel && !multiSel) || !/^Arrow/.test(ev.key)) return;
    if (multiSel) {
      var mstep = ev.shiftKey ? BASE : 1;
      var msec2 = multiSel.sec;
      multiSel.idxs.forEach(function (j) {
        var o = msec2.els[j];
        if (ev.key === 'ArrowLeft') o.x = Math.max(0, o.x - mstep);
        else if (ev.key === 'ArrowRight') o.x = Math.min(W - o.w, o.x + mstep);
        else if (ev.key === 'ArrowUp') o.y = Math.max(0, o.y - mstep);
        else if (ev.key === 'ArrowDown') o.y = o.y + mstep;
      });
      ev.preventDefault();
      resolveAndApply(msec2);
      clearTimeout(textTimer);
      textTimer = setTimeout(pushState, 500);
      refreshChip();
      return;
    }
    var step = ev.shiftKey ? BASE : 1;
    var sec = sel.sec;
    var e = sec.els[sel.i];
    if (ev.key === 'ArrowLeft') e.x = Math.max(0, e.x - step);
    else if (ev.key === 'ArrowRight') e.x = Math.min(W - e.w, e.x + step);
    else if (ev.key === 'ArrowUp') e.y = Math.max(0, e.y - step);
    else if (ev.key === 'ArrowDown') e.y = e.y + step;
    ev.preventDefault();
    resolveAndApply(sec);
    placeHandles(sel.sec, sel.i);
    // same spacing feedback as dragging, fading after the last press —
    // badges go blue when a nudge lands on equal gaps
    var nbK = neighbors(sec, e);
    var eqHK = !!(nbK.L && nbK.R && Math.abs((e.x - (nbK.L.x + nbK.L.w)) - (nbK.R.x - (e.x + e.w))) < 1);
    var eqVK = !!(nbK.T && nbK.B && Math.abs((e.y - (nbK.T.y + nbK.T.h)) - (nbK.B.y - (e.y + e.h))) < 1);
    drawDists(sec, sel.i, eqHK, eqVK);
    clearTimeout(nudgeDistTimer);
    nudgeDistTimer = setTimeout(hideDists, 900);
    clearTimeout(textTimer);
    textTimer = setTimeout(pushState, 500);
    refreshChip(); // history push is debounced, the chip shouldn't be
  });
  var nudgeDistTimer = null;

  // ---------- toolbar actions ----------
  editBtn.addEventListener('click', function () { setEditing(true); });
  // ---------- instant tooltips (native title has a multi-second delay) ----------
  // One persistent tooltip that GLIDES: first hover rises in with a settle;
  // moving along a toolbar it slides to the next control and morphs its
  // width around the new text instead of blinking out and in.
  var tipEl = document.createElement('div');
  tipEl.className = 'gogh-tip';
  tipEl.hidden = true;
  var tipTextEl = document.createElement('span');
  tipTextEl.className = 'gogh-tip-text';
  tipEl.appendChild(tipTextEl);
  document.body.appendChild(tipEl);
  var tipTimer = null;
  var tipHideT = null;
  var tipVisibleUntil = 0;
  function showTipNow(el) {
    var text = el.getAttribute('title') || el.dataset.tip || '';
    if (el.getAttribute('title')) {
      el.dataset.tip = el.getAttribute('title');
      el.removeAttribute('title'); // suppress the native tooltip
      text = el.dataset.tip;
    }
    if (!text) return;
    clearTimeout(tipHideT);
    var gliding = !tipEl.hidden && tipEl.classList.contains('is-in');
    var oldW = gliding ? tipEl.offsetWidth : 0;
    tipEl.classList.remove('is-out');
    tipEl.hidden = false;
    // measure at natural size before deciding geometry
    tipEl.classList.remove('is-glide');
    tipEl.style.width = 'auto';
    tipTextEl.textContent = text;
    var tw = tipEl.offsetWidth;
    var th = tipEl.offsetHeight;
    var r = el.getBoundingClientRect();
    var left = Math.max(6, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 6));
    var top = r.bottom + 8;
    if (top + th > window.innerHeight - 6) top = r.top - th - 8;
    if (gliding) {
      // FLIP: start from the old width, glide position and width together.
      // The label fades IN as the pill travels — swapping it instantly left
      // the new text rattling around the old width (visible spare space).
      tipTextEl.style.transition = 'none';
      tipTextEl.style.opacity = '0';
      tipEl.style.width = oldW + 'px';
      void tipEl.offsetWidth;
      tipEl.classList.add('is-glide');
      tipEl.style.width = tw + 'px';
      tipEl.style.left = left + 'px';
      tipEl.style.top = top + 'px';
      tipTextEl.style.transition = 'opacity 0.1s ease 0.06s';
      tipTextEl.style.opacity = '1';
    } else {
      tipTextEl.style.transition = 'none';
      tipTextEl.style.opacity = '1';
      tipEl.style.width = tw + 'px';
      tipEl.style.left = left + 'px';
      tipEl.style.top = top + 'px';
      tipEl.classList.remove('is-in');
      void tipEl.offsetWidth; // restart the entrance
      tipEl.classList.add('is-in');
    }
    if (gliding) tipEl.classList.add('is-in');
  }
  function hideTip(instant) {
    clearTimeout(tipTimer);
    if (tipEl.hidden) return;
    tipVisibleUntil = Date.now() + 400;
    if (instant === true) {
      tipEl.hidden = true;
      tipEl.classList.remove('is-in', 'is-glide', 'is-out');
      return;
    }
    tipEl.classList.remove('is-in', 'is-glide');
    tipEl.classList.add('is-out');
    clearTimeout(tipHideT);
    tipHideT = setTimeout(function () {
      tipEl.hidden = true;
      tipEl.classList.remove('is-out');
    }, 130);
  }
  document.addEventListener('pointerover', function (ev) {
    if (!(ev.target instanceof Element)) return;
    var el = ev.target.closest('[title], [data-tip]');
    if (!el || !/gogh-/.test(el.className)) { hideTip(); return; }
    clearTimeout(tipTimer);
    // first hover waits a beat; moving along a toolbar is instant
    if (Date.now() < tipVisibleUntil || !tipEl.hidden) showTipNow(el);
    else tipTimer = setTimeout(function () { showTipNow(el); }, 140);
  });
  document.addEventListener('pointerdown', function () { hideTip(true); }, true);
  document.addEventListener('scroll', function () { hideTip(true); }, true);

  // ---------- publish state: status chip, toasts, exit panel ----------
  var savedSnap = null;
  var rawCache = null;     // last-known stored content (context=edit)
  var lastAutoSnap = null; // last state backed up to the WP autosave revision
  var backedUp = false;
  var discarding = false;

  function isDirty() {
    if (pendingBlocks.length) return true;
    if (chromeLightEdits.some(function (e) { return e.savedRaw != null && e.raw !== e.savedRaw; })) return true;
    if (storedEdits.some(function (e) { return e.raw !== e.savedRaw || e.deleted; })) return true;
    return savedSnap !== null && serialize() !== savedSnap;
  }

  var chip = document.createElement('div');
  chip.className = 'gogh-chip';
  chip.hidden = true;
  chip.innerHTML = '<span class="gogh-chip-dot"></span><span class="gogh-chip-txt"></span>' +
    '<button type="button" class="gogh-btn-save gogh-chip-btn">Publish</button>';
  document.body.appendChild(chip);
  var chipTxt = chip.querySelector('.gogh-chip-txt');
  var chipBtn = chip.querySelector('.gogh-chip-btn');
  var chipBusy = false;
  var chipTimer = null;
  function setChip(state, txt, btnLabel) {
    chip.className = 'gogh-chip is-' + state;
    chipTxt.textContent = txt;
    if (btnLabel) { chipBtn.textContent = btnLabel; chipBtn.hidden = false; }
    else chipBtn.hidden = true;
  }
  function refreshChip() {
    if (chipBusy) return;
    clearTimeout(chipTimer);
    if (isDirty()) setChip('dirty', backedUp ? 'Unpublished changes \u00b7 backed up' : 'Unpublished changes', 'Publish');
    else setChip('clean', 'All changes published');
  }

  var toastBox = document.createElement('div');
  toastBox.className = 'gogh-toasts';
  document.body.appendChild(toastBox);
  function toast(msg, opts) {
    opts = opts || {};
    var t = document.createElement('div');
    t.className = 'gogh-toast' + (opts.error ? ' is-error' : '');
    var span = document.createElement('span');
    span.textContent = msg;
    t.appendChild(span);
    (opts.actions || []).forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = a.label;
      b.addEventListener('click', function () { t.remove(); if (a.onClick) a.onClick(); });
      t.appendChild(b);
    });
    toastBox.appendChild(t);
    if (!opts.sticky) setTimeout(function () { if (t.parentNode) t.remove(); }, opts.ttl || 4500);
    return t;
  }

  function fetchRaw() {
    return fetch(cfg.restUrl + (cfg.restUrl.indexOf('?') === -1 ? '?' : '&') + 'context=edit', {
      headers: { 'X-WP-Nonce': cfg.nonce },
      credentials: 'same-origin',
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      rawCache = (data.content && data.content.raw) || '';
      return rawCache;
    });
  }

  function publish() {
    if (chipBusy) return Promise.resolve(false);
    chipBusy = true;
    S.forEach(measureTextHeights);
    setChip('saving', 'Publishing\u2026');
    return fetchRaw().then(function (raw) {
      return fetch(cfg.restUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
        credentials: 'same-origin',
        body: JSON.stringify({ content: resequenceToDom(mergeContent(raw), gatherRawUnits()) }),
      });
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (post) {
      if (post.content && post.content.raw) rawCache = post.content.raw;
      // native pattern sections are stored now: they graduate to ordinary
      // page content (the per-block Make freeform machinery owns them next).
      // gogh-pended keeps the EXACT presentation (full bleed, zero margins)
      // — stripping it caused a publish-moment reflow: the block-gap band
      // returned and the canvas shifted sideways.
      pendingBlocks.forEach(function (pe) {
        var bar = pe.el.querySelector(':scope > .gogh-pendbar');
        if (bar) bar.remove();
        pe.el.classList.remove('gogh-pending');
        pe.el.classList.add('gogh-pended');
      });
      pendingBlocks = [];
      // everything just stored — rebuild the stored-edit bindings against the
      // fresh content so the graduated blocks (and prior edits) stay editable
      initStoredEdits();
      // site chrome saves to its template part — one write, every page.
      // Resolve ids first (booted freeform chrome has none), and AWAIT the
      // saves: publish isn't done until the header/footer actually saved.
      return resolveChromeIds().then(function () {
        var unsaved = S.filter(function (s) { return s.chrome && !s.chrome.id; });
        if (unsaved.length) {
          throw new Error('could not find the ' + unsaved[0].chrome.area + ' template part');
        }
        return Promise.all(S.filter(function (s) { return s.chrome && s.chrome.id; }).map(function (s) {
          return fetch(tpUrl(s.chrome.id), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
            credentials: 'same-origin',
            body: JSON.stringify({ content: buildSectionBlocks(s) }),
          }).then(function (r) {
            if (!r.ok) throw new Error('the ' + s.chrome.area + ' did not save');
            toast('Site ' + s.chrome.area + ' updated across every page.');
          });
        }).concat(chromeLightEdits
          .filter(function (e) { return e.savedRaw != null && e.raw !== e.savedRaw; })
          .map(function (e) {
            return saveChromeEntry(e).then(function () {
              toast(e.title + ' updated across every page.');
            });
          })));
      });
    }).then(function () {
      // conversions are now committed: sections are ordinary gogh spans
      S.forEach(function (s) { s.srcSig = null; });
      savedSnap = serialize();
      backedUp = false;
      chipBusy = false;
      setChip('clean', 'Published \u2713');
      chipTimer = setTimeout(refreshChip, 1800);
      return true;
    }).catch(function (err) {
      chipBusy = false;
      setChip('error', 'Publish failed', 'Retry');
      toast('Publish failed: ' + err.message, { error: true });
      console.error('gogh publish failed:', err);
      return false;
    });
  }
  chipBtn.addEventListener('click', function () { publish(); });

  // exit: instant when everything is published; otherwise a real choice
  var exitPanel = document.createElement('div');
  exitPanel.className = 'gogh-exit';
  exitPanel.hidden = true;
  exitPanel.innerHTML =
    '<div class="gogh-exit-card">' +
    '<div class="gogh-exit-title">You have unpublished changes</div>' +
    '<p class="gogh-exit-sub">Publish them now, keep editing, or discard them and restore the live page.</p>' +
    '<div class="gogh-exit-row">' +
    '<button type="button" class="gogh-btn gogh-exit-pub">Publish &amp; close</button>' +
    '<button type="button" class="gogh-btn gogh-btn-small gogh-exit-keep">Keep editing</button>' +
    '<button type="button" class="gogh-btn gogh-btn-small gogh-exit-disc">Discard changes</button>' +
    '</div></div>';
  document.body.appendChild(exitPanel);
  exitPanel.addEventListener('pointerdown', function (ev) { if (ev.target === exitPanel) exitPanel.hidden = true; });
  exitPanel.querySelector('.gogh-exit-keep').addEventListener('click', function () { exitPanel.hidden = true; });
  exitPanel.querySelector('.gogh-exit-pub').addEventListener('click', function () {
    exitPanel.hidden = true;
    publish().then(function (ok) { if (ok) setEditing(false); });
  });
  // WP's REST API neither deletes autosave revisions nor reliably overwrites
  // them, so dismissed/discarded backups are remembered client-side instead
  function dismissKey() { return 'gogh-bak-dismissed-' + cfg.postId; }
  function dismissBackup(stamp) {
    try { localStorage.setItem(dismissKey(), stamp); } catch (e) {}
  }
  exitPanel.querySelector('.gogh-exit-disc').addEventListener('click', function () {
    discarding = true;
    // the backup describes the work being discarded — don't offer it back
    dismissBackup(new Date().toISOString().slice(0, 19));
    location.reload();
  });
  // one exit, not two: the drawer's ✕ is gone — the admin bar's Exit link
  // owns leaving, and the dirty-check panel intercepts it when work is
  // unpublished (a clean exit navigates as the link always did)
  var exitLink = document.querySelector('#wp-admin-bar-gogh-edit a');
  if (exitLink) exitLink.addEventListener('click', function (ev) {
    refreshChip(); // text re-measures can dirty the model without a pushState
    if (editing && isDirty()) { ev.preventDefault(); exitPanel.hidden = false; }
  });

  window.addEventListener('beforeunload', function (ev) {
    if (editing && !discarding && isDirty()) { ev.preventDefault(); ev.returnValue = ''; }
  });

  // ---------- autosave: continuous backup to the WP autosave revision ----------
  function autosaveUrl() {
    return cfg.restUrl.indexOf('?') === -1
      ? cfg.restUrl + '/autosaves'
      : cfg.restUrl.replace('?', '/autosaves?');
  }
  setInterval(function () {
    if (!editing || chipBusy || !isDirty()) return;
    // the suite wrecks the page BY DESIGN (delete-everything tests) — backing
    // that up would shadow the real fixture on every next boot
    if (/gogh-test/.test(location.search)) return;
    // pending native sections live outside serialize() — fingerprint them
    // too, or pending-only changes would skip the backup
    var snap = serialize() + '\u0000' + pendingBlocks.map(function (pe) { return pe.raw; }).join('\u0000');
    if (snap === lastAutoSnap) return;
    (rawCache !== null ? Promise.resolve(rawCache) : fetchRaw()).then(function (raw) {
      return fetch(autosaveUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
        credentials: 'same-origin',
        body: JSON.stringify({ content: mergeContent(raw) }),
      });
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function () {
      lastAutoSnap = snap;
      backedUp = true;
      refreshChip();
    }).catch(function () { /* backup is best-effort */ });
  }, 15000);

  var recoveryChecked = false;
  function checkRecovery() {
    if (recoveryChecked || !cfg.modified) return;
    recoveryChecked = true;
    fetch(autosaveUrl() + (autosaveUrl().indexOf('?') === -1 ? '?' : '&') + 'context=edit', {
      headers: { 'X-WP-Nonce': cfg.nonce },
      credentials: 'same-origin',
    }).then(function (res) { return res.ok ? res.json() : []; }).then(function (list) {
      var a = list && list[0];
      if (!a || !a.modified_gmt || a.modified_gmt <= cfg.modified) return;
      var dismissed = null;
      try { dismissed = localStorage.getItem(dismissKey()); } catch (e) {}
      if (dismissed && a.modified_gmt <= dismissed) return; // user already said no
      var models = extractModels((a.content && (a.content.raw || a.content.rendered)) || '');
      if (!models.length || !backupDiffers(models)) return; // matches the live page
      toast('gogh backed up unpublished work from an earlier session.', {
        sticky: true,
        actions: [
          { label: 'Restore it', onClick: function () { restoreAutosave(a); } },
          { label: 'Ignore', onClick: function () { dismissBackup(a.modified_gmt); } },
        ],
      });
    }).catch(function () {});
  }
  function extractModels(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var data = [];
    [].slice.call(doc.querySelectorAll('.gogh-wrap')).forEach(function (w) {
      var ms = w.querySelector('script.gogh-model');
      var sEl = w.querySelector('.gogh-section');
      if (!ms || !sEl) return;
      try {
        var m = JSON.parse(ms.textContent);
        data.push({ scope: sEl.getAttribute('data-gogh-scope') || ('gogh-sec-' + (scopeSeq++)),
          els: m.elements || [], minH: m.minH || null, bg: m.bg || null,
          divider: m.divider || null, bgImage: m.bgImage || null, bgId: m.bgId || null });
      } catch (e2) {}
    });
    return data;
  }
  function canonSec(d) {
    return { els: (d.els || []).map(projEl), minH: d.minH || null, bg: d.bg || null,
      divider: d.divider || null, bgImage: d.bgImage || null, bgId: d.bgId || null, bgA: d.bgA != null ? d.bgA : null, theme: d.theme || null, fill: d.fill || null };
  }
  function backupDiffers(data) {
    return JSON.stringify(data.map(canonSec)) !== JSON.stringify(realSections().map(canonSec));
  }
  function restoreAutosave(a) {
    var data = extractModels((a.content && (a.content.raw || a.content.rendered)) || '');
    if (!data.length) { toast('The backup could not be read.', { error: true }); return; }
    restoreState(JSON.stringify(data));
    pushState();
    toast('Backup restored \u2014 publish when ready.');
  }
  // ---------- convert Gutenberg blocks to freeform gogh sections ----------
  var convertStash = {}; // sig -> {node, marker}: originals of converted blocks

  function sigOf(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return str.length + '-' + h.toString(36);
  }

  // top-level block spans in raw block markup (depth-tracked comment parser)
  function parseTopBlocks(raw) {
    var re = /<!--\s+\/?wp:[a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)?(\s+\{[\s\S]*?\})?\s*(\/)?-->/g;
    var spans = [], m, depth = 0, start = -1, name = null;
    function nameOf(tag) { return (tag.match(/wp:([a-z0-9\/_-]+)/) || [])[1] || ''; }
    while ((m = re.exec(raw))) {
      var tag = m[0];
      if (/\/-->$/.test(tag)) {
        if (depth === 0) spans.push({ start: m.index, end: re.lastIndex, name: nameOf(tag) });
      } else if (/^<!--\s+\/wp:/.test(tag)) {
        depth = Math.max(0, depth - 1);
        if (depth === 0 && start !== -1) { spans.push({ start: start, end: re.lastIndex, name: name }); start = -1; }
      } else {
        if (depth === 0) { start = m.index; name = nameOf(tag); }
        depth++;
      }
    }
    return spans;
  }

  // measure a Gutenberg block's rendered leaves into gogh elements.
  // containers (group/columns/cover) are flattened; unsupported content is
  // reported, never silently dropped.
  // non-gogh top-level blocks eligible for conversion
  function topBlockNodes() {
    return [].slice.call(pageParent.children).filter(function (n) {
      return n.nodeType === 1 && !n.classList.contains('gogh-wrap') &&
        !n.classList.contains('gogh-pending');
    });
  }

  function convertBlock(node) {
    return fetch(cfg.restUrl + (cfg.restUrl.indexOf('?') === -1 ? '?' : '&') + 'context=edit', {
      headers: { 'X-WP-Nonce': cfg.nonce },
      credentials: 'same-origin',
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      var raw = (data.content && data.content.raw) || '';
      var spans = parseTopBlocks(raw);
      // map rendered NON-gogh blocks to stored NON-gogh spans: gogh sections
      // (saved or added this session) don't participate, so unsaved sections
      // never break the count. Spans already claimed by an unsaved conversion
      // are excluded too — their rendered original is gone.
      var claimed = {};
      S.forEach(function (s) { if (s.srcSig) claimed[s.srcSig] = true; });
      var freeSpans = spans.filter(function (sp) {
        if (sp.name === 'gogh/section') return false;
        return !claimed[sigOf(raw.slice(sp.start, sp.end))];
      });
      var statics = topBlockNodes();
      if (freeSpans.length !== statics.length) {
        throw new Error('gogh cannot safely map this page\u2019s blocks to its stored content (rendered ' + statics.length + ' vs stored ' + freeSpans.length + ').');
      }
      var idx = statics.indexOf(node);
      if (idx === -1) throw new Error('block not found');
      // the modern scanner: typed leaves with typography, styled groups as
      // boxes, and anything exotic (quotes, embeds…) becomes a draggable
      // widget instead of an error — we have this block's exact markup
      var blockRaw = raw.slice(freeSpans[idx].start, freeSpans[idx].end);
      var scan = scanDomWithRaw(node, blockRaw, { loose: true, rootIsBlock: true });
      if (!scan.els.length) throw new Error('gogh found nothing it can edit in this block.');

      var rr = node.getBoundingClientRect();
      var sec = newSectionShell('gogh-sec-' + (scopeSeq++));
      sec.els = scan.els;
      sec.minH = Math.round(rr.height * (W / rr.width));
      // group background / cover image carry over to the section
      var cover = node.classList.contains('wp-block-cover') ? node : node.querySelector('.wp-block-cover');
      if (cover) {
        var cimg = cover.querySelector('.wp-block-cover__image-background');
        if (cimg) { sec.bgImage = cimg.currentSrc || cimg.src || null; }
        var ov = cover.querySelector('.wp-block-cover__background');
        if (ov) {
          var oc = getComputedStyle(ov).backgroundColor;
          if (oc && oc !== 'rgba(0, 0, 0, 0)') sec.bg = oc;
        }
      }
      if (!sec.bg && scan.rootBg) sec.bg = scan.rootBg;
      if (!sec.bg) {
        var rc = getComputedStyle(node).backgroundColor;
        if (rc && rc !== 'rgba(0, 0, 0, 0)' && rc !== 'transparent') sec.bg = rc;
      }
      sec.srcSig = sigOf(raw.slice(freeSpans[idx].start, freeSpans[idx].end));
      var marker = document.createComment('gogh-src');
      pageParent.insertBefore(marker, node);
      convertStash[sec.srcSig] = { node: node, marker: marker,
        raw: raw.slice(freeSpans[idx].start, freeSpans[idx].end) };
      pageParent.insertBefore(sec.wrapEl, node);
      node.remove();
      // S stays DOM-ordered
      var before = S.filter(function (s) {
        return s.wrapEl.compareDocumentPosition(sec.wrapEl) & 4;
      }).length;
      S.splice(before, 0, sec);
      renderSection(sec);
      sel = null;
      hideHandles();
      pushState();
      placeConvertBtns();
      return sec;
    }).catch(function (err) {
      toast(err.message || 'Convert failed', { error: true });
      return null;
    });
  }

  // ---------- site chrome (header/footer template parts) as canvases ----------
  function chromePartEls() {
    return [].slice.call(document.querySelectorAll('.wp-block-template-part')).filter(function (el) {
      return el.tagName === 'HEADER' || el.tagName === 'FOOTER';
    });
  }
  function tpUrl(id) {
    var base = cfg.restUrl.replace(/wp\/v2\/(pages|posts)\/\d+.*$/, 'wp/v2/template-parts');
    return id ? base + '/' + encodeURIComponent(id) : base;
  }
  function innerRawOf(raw, span) {
    var s = raw.slice(span.start, span.end);
    var open = s.indexOf('-->');
    var close = s.lastIndexOf('<!--');
    if (open === -1 || close <= open) return null;
    return { text: s.slice(open + 3, close), base: span.start + open + 3 };
  }
  var patternCache = null;
  function fetchAreaPatterns(area) {
    // the theme's own patterns AND WordPress's pattern-directory ones — the
    // area signal is a category ('header') or a declared block type
    // ('core/template-part/header'), same as the site editor uses
    var pick = function (list) {
      var inArea = list.filter(function (p) {
        if (!p.name) return false;
        var inCat = (p.categories || []).indexOf(area) !== -1;
        var inBT = (p.block_types || []).some(function (b) {
          return String(b).indexOf('template-part/' + area) !== -1;
        });
        return inCat || inBT;
      });
      // a few good choices, not a shelf of 24: when gogh's curated designs
      // are present they ARE the pattern offer (the theme's real template
      // parts still join from their own fetch); the theme-extra and
      // remote-directory flood stays out. No gogh shelf → old behaviour.
      var curated = inArea.filter(function (p) { return String(p.name).indexOf('gogh/') === 0; });
      return curated.length ? curated : inArea;
    };
    if (patternCache) return Promise.resolve(pick(patternCache));
    return fetch(GSROOT + 'block-patterns/patterns', {
      headers: { 'X-WP-Nonce': cfg.nonce },
      credentials: 'same-origin',
    }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); }).then(function (list) {
      patternCache = list;
      return pick(list);
    }).catch(function () { return []; });
  }
  // the hand-picked shelf: James's curated favourites, in display order —
  // theme patterns by full name plus gogh's own theme-agnostic ones
  var GOGH_SHELF = [
    'twentytwentyfive/hero-podcast',
    'twentytwentyfive/page-link-in-bio-wide-margins',
    'twentytwentyfive/services-team-photos',
    'twentytwentyfive/banner-about-book',
    'twentytwentyfive/banner-description-images-grid',
    'twentytwentyfive/cta-grid-products-link',
    'twentytwentyfive/media-instagram-grid',
    'twentytwentyfive/page-coming-soon',
    'twentytwentyfive/banner-intro',
    'twentytwentyfive/contact-centered-social-link',
    'twentytwentyfive/overlapped-images',
    'twentytwentyfive/text-faqs',
    'twentytwentyfive/cta-newsletter',
    'twentytwentyfive/pricing-3-col',
    'gogh/fullscreen-cover-image-gallery',
    'gogh/fullwidth-headline-right',
    'gogh/simple-call-to-action',
    'gogh/three-column-pricing-table',
  ];
  // content patterns from the active theme (not chrome, not page shells):
  // offered in the section picker and inserted as freeform sections
  function fetchSectionPatterns() {
    var all = patternCache
      ? Promise.resolve(patternCache)
      : fetch(GSROOT + 'block-patterns/patterns', {
          headers: { 'X-WP-Nonce': cfg.nonce },
          credentials: 'same-origin',
        }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
          .then(function (list) { patternCache = list; return list; })
          .catch(function () { return []; });
    return all.then(function (list) {
      return list.filter(function (p) {
        var cats = p.categories || [];
        var c = p.content || '';
        // hard safety first — chrome and template plumbing never qualify,
        // curated or not
        var safe = p.name &&
          cats.indexOf('header') === -1 && cats.indexOf('footer') === -1 &&
          c.indexOf('wp:template-part') === -1 &&
          c.indexOf('wp:post-') === -1 &&
          c.indexOf('wp:comments') === -1 &&
          c.indexOf('wp:query') === -1;
        if (!safe) return false;
        // the curated shelf skips the theme-prefix and bucket heuristics
        // (it deliberately includes gogh/ patterns and _page-bucketed ones)
        if (GOGH_SHELF.indexOf(p.name) !== -1) return true;
        return p.name.indexOf(cfg.theme + '/') === 0 &&
          // internal buckets: whole-page layouts and post-format scraps
          !cats.some(function (cc) { return /_page$|post-format/.test(cc); });
      });
    });
  }
  function renderPattern(p) {
    if (p.__rendered != null) return Promise.resolve(p.__rendered);
    // gogh's own route: core's block-renderer omits the per-instance layout
    // CSS the style engine generates during render, so grids/columns collapse
    var opts = { headers: { 'X-WP-Nonce': cfg.nonce }, credentials: 'same-origin' };
    return fetch(restQ(GSROOT.split('wp/v2/')[0] + 'gogh/v1/pattern', 'slug=' + encodeURIComponent(p.name)), opts)
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function (d) {
        var html = (d && d.rendered) || '';
        if (html && d.css) html = '<style>' + d.css + '</style>' + html;
        if (html) p.__rendered = html; // only SUCCESS is cached
        return html;
      })
      .catch(function () {
        // older/cached server without the route: core renderer, no layout CSS
        return fetch(restQ(GSROOT + 'block-renderer/core/pattern', 'context=edit&attributes%5Bslug%5D=' + encodeURIComponent(p.name)), opts)
          .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
          .then(function (d) {
            var html = (d && d.rendered) || '';
            if (html) p.__rendered = html;
            return html;
          })
          .catch(function () { return ''; });
      });
  }
  var pendingBlocks = []; // native pattern sections awaiting publish
  // published native/HTML blocks, re-bound for light editing every time
  // editing turns on — publish must not be the end of click-to-edit
  var storedEdits = [];
  function initStoredEdits() {
    fetchRaw().then(function (raw) {
      storedEdits = [];
      var spans = parseTopBlocks(raw);
      var claimed = {};
      S.forEach(function (s) { if (s.srcSig) claimed[s.srcSig] = true; });
      // stored NON-gogh spans pair positionally with rendered non-gogh top
      // nodes — the same mapping convertBlock trusts. Counts differ → bind
      // nothing rather than bind wrongly.
      var free = spans.filter(function (sp) {
        if (sp.name === 'gogh/section') return false;
        return !claimed[sigOf(raw.slice(sp.start, sp.end))];
      });
      var kids = topBlockNodes();
      if (!free.length || !kids.length) return;
      // a graduated holder (same-session publish) wraps SEVERAL top blocks —
      // it consumes one span per rendered block child; bare blocks take one
      var blockKids = function (el) {
        return [].slice.call(el.children).filter(function (c) {
          var tg = c.tagName;
          return tg !== 'STYLE' && tg !== 'SCRIPT' && tg !== 'LINK' && tg !== 'TEMPLATE' &&
            !(c.classList && c.classList.contains('gogh-pendbar'));
        });
      };
      var out = [];
      var si = 0;
      for (var ki = 0; ki < kids.length; ki++) {
        var kid = kids[ki];
        var pended = kid.classList && kid.classList.contains('gogh-pended');
        var m = pended ? Math.max(1, blockKids(kid).length) : 1;
        if (si + m > free.length) return;
        var seg = raw.slice(free[si].start, free[si + m - 1].end);
        out.push({
          el: kid, raw: seg, savedRaw: seg, stored: true,
          selfBlock: !pended, title: 'Section',
        });
        si += m;
      }
      if (si !== free.length) return; // leftover spans: mapping untrusted
      storedEdits = out;
      out.forEach(bindPending);
      placeConvertBtns();
    }).catch(function () {});
  }
  function clampInsertIdx(idx) {
    var footAt = -1;
    S.forEach(function (s, k) { if (footAt === -1 && s.chrome && s.chrome.area === 'footer') footAt = k; });
    return footAt === -1 ? idx : Math.min(idx, footAt);
  }
  function insertNative(raw, html, title, idx, before) {
    if (idx == null) idx = S.length;
    idx = clampInsertIdx(idx);
    // arrives as REAL blocks — pixel-perfect, no conversion. Freeform is one
    // click away on its overlay, like any page content.
    var holder = document.createElement('div');
    holder.className = 'gogh-pending alignfull has-global-padding is-layout-constrained';
    holder.innerHTML = html;
    var nextContent = null;
    for (var ni = idx; ni < S.length; ni++) { if (!S[ni].chrome) { nextContent = S[ni]; break; } }
    pageParent.insertBefore(holder, (before && before.isConnected) ? before : (nextContent ? nextContent.wrapEl : endMarker));
    var entry = { el: holder, raw: raw || '', title: title || 'Section' };
    pendingBlocks.push(entry);
    var bar = document.createElement('div');
    bar.className = 'gogh-pendbar';
    bar.innerHTML =
      (cfg.canConvert ? '<button type="button" class="gogh-btn gogh-btn-small gogh-pend-ff">\u2728 Make freeform</button>' : '') +
      '<button type="button" class="gogh-btn gogh-btn-small gogh-pend-rm" title="Remove">\u2715</button>';
    holder.appendChild(bar);
    var ffBtn = bar.querySelector('.gogh-pend-ff');
    if (ffBtn) ffBtn.addEventListener('click', function () {
      convertPending(entry);
    });
    bar.querySelector('.gogh-pend-rm').addEventListener('click', function () {
      holder.remove();
      pendingBlocks = pendingBlocks.filter(function (q) { return q !== entry; });
      refreshChip();
    });
    bindPending(entry);
    holder.scrollIntoView({ behavior: 'smooth', block: 'start' });
    refreshChip();
    toast('\u201c' + entry.title + '\u201d added \u2014 click text to edit it.' + (cfg.canConvert ? ' \u2728 to go freeform.' : ''), { ttl: 5000 });
    return entry;
  }
  function recordRecent(t, k) {
    try {
      var list = JSON.parse(localStorage.getItem('gogh-recent-sections') || '[]');
      list = list.filter(function (rc) { return !(rc.t === t && rc.k === k); });
      list.unshift({ t: t, k: k });
      localStorage.setItem('gogh-recent-sections', JSON.stringify(list.slice(0, 6)));
    } catch (err) {}
  }
  function addPatternSection(p, idx, before) {
    return renderPattern(p).then(function (html) {
      if (!html) throw new Error('empty');
      recordRecent('p', p.name);
      insertNative(p.content || '', html, p.title, idx, before);
    }).catch(function () {
      toast('Could not add that section.', { error: true });
    });
  }
  var lastPasteRelUrls = 0; // root-relative refs we could not repair
  function sanitizePastedHtml(html) {
    // parse inert, then strip what would EXECUTE: script elements, on*
    // handler attributes, javascript: URLs (script tags via innerHTML never
    // run, but handler attributes do)
    var t = document.createElement('template');
    t.innerHTML = String(html || '');
    [].slice.call(t.content.querySelectorAll('script')).forEach(function (n) { n.remove(); });
    [].slice.call(t.content.querySelectorAll('*')).forEach(function (el) {
      [].slice.call(el.attributes).forEach(function (a) {
        var n = a.name.toLowerCase();
        if (n.indexOf('on') === 0) el.removeAttribute(a.name);
        else if ((n === 'href' || n === 'src' || n === 'xlink:href') &&
          /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
      });
    });
    // lazy-loading markup shows only its placeholder once pasted — promote
    // the real image and pin the largest srcset candidate
    [].slice.call(t.content.querySelectorAll('img')).forEach(function (img) {
      var lazy = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original');
      if (lazy && !/^data:/.test(lazy)) img.setAttribute('src', lazy);
      var ss = img.getAttribute('srcset') || img.getAttribute('data-srcset');
      if (ss) {
        var best = null, bw = -1;
        ss.split(',').forEach(function (cand) {
          var parts = cand.trim().split(/\s+/);
          if (!parts[0]) return;
          var w = parseFloat((parts[1] || '').replace(/[^0-9.]/g, '')) || 0;
          if (w >= bw) { bw = w; best = parts[0]; }
        });
        if (best) img.setAttribute('src', best);
        img.removeAttribute('srcset');
        img.removeAttribute('sizes');
        img.removeAttribute('data-srcset');
      }
    });
    // URL repair: protocol-relative always; root-relative only when every
    // absolute URL in the paste names ONE foreign origin (else we'd guess)
    var origins = {};
    var noteAbs = function (u) {
      var mm = String(u).match(/^https?:\/\/[^\/"')\s]+/i);
      if (mm && mm[0].toLowerCase().indexOf(location.host.toLowerCase()) === -1) origins[mm[0]] = 1;
    };
    [].slice.call(t.content.querySelectorAll('[src],[poster]')).forEach(function (el) {
      noteAbs(el.getAttribute('src') || el.getAttribute('poster') || '');
    });
    (t.innerHTML.match(/url\(\s*['"]?(https?:[^'")\s]+)/gi) || []).forEach(function (mch) {
      noteAbs(mch.replace(/^url\(\s*['"]?/i, ''));
    });
    var keys = Object.keys(origins);
    var origin = keys.length === 1 ? keys[0] : null;
    lastPasteRelUrls = 0;
    var fixUrl = function (u) {
      u = String(u);
      if (/^\/\//.test(u)) return 'https:' + u;
      if (u[0] === '/' && u[1] !== '/') {
        if (origin) return origin + u;
        lastPasteRelUrls++;
        return u;
      }
      return u;
    };
    [].slice.call(t.content.querySelectorAll('[src],[poster]')).forEach(function (el) {
      ['src', 'poster'].forEach(function (at) {
        var v = el.getAttribute(at);
        if (v) el.setAttribute(at, fixUrl(v));
      });
    });
    var fixCssUrls = function (css) {
      return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, function (_, q, u) {
        return 'url(' + q + fixUrl(u.trim()) + q + ')';
      });
    };
    [].slice.call(t.content.querySelectorAll('[style]')).forEach(function (el) {
      var st = el.getAttribute('style');
      if (st && st.indexOf('url(') !== -1) el.setAttribute('style', fixCssUrls(st));
    });
    [].slice.call(t.content.querySelectorAll('style')).forEach(function (st) {
      if (st.textContent.indexOf('url(') !== -1) st.textContent = fixCssUrls(st.textContent);
    });
    return t.innerHTML;
  }
  function addHtmlSection(html, idx, before) {
    html = sanitizePastedHtml(html).trim();
    if (!html) return;
    if (lastPasteRelUrls) {
      toast(lastPasteRelUrls + ' image path' + (lastPasteRelUrls === 1 ? '' : 's') +
        ' in this paste point at the original site \u2014 they may not load here.', { ttl: 6500 });
    }
    // a real core HTML block inside a FULL-WIDTH group: pasted HTML owns the
    // whole canvas (its own CSS decides any constraints), in the editor and
    // on the published page alike
    // the wrapper carries a persistent identity class and zero vertical
    // margins: pasted sections stay full-bleed and butt against their
    // neighbours everywhere — in the editor, after publish, after reload,
    // and for visitors (gogh.php ships the matching front-end CSS)
    var raw = '<!-- wp:group {"align":"full","className":"gogh-section-html","style":{"spacing":{"margin":{"top":"0","bottom":"0"}}},"layout":{"type":"default"}} -->\n' +
      '<div class="wp-block-group alignfull gogh-section-html" style="margin-top:0;margin-bottom:0">\n' +
      '<!-- wp:html -->\n' + html + '\n<!-- /wp:html -->\n' +
      '</div>\n<!-- /wp:group -->';
    var entry = insertNative(raw, '<div class="wp-block-group alignfull gogh-section-html" style="margin-top:0;margin-bottom:0">' + html + '</div>', 'HTML', idx, before);
    if (entry) entry.freeHtml = true;
  }
  // frictionless paste: Cmd+V anywhere in edit mode drops HTML straight onto
  // the page as a section — no modal, no textarea. Only pastes that are
  // clearly HTML source are claimed; typing into any field keeps its meaning.
  document.addEventListener('paste', function (ev) {
    if (!editing) return;
    var t = ev.target;
    if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
      (t.closest && t.closest('[contenteditable="true"]')))) return;
    var txt = ((ev.clipboardData && ev.clipboardData.getData('text/plain')) || '').trim();
    if (txt[0] !== '<' || !(/<\/[a-z]/i.test(txt) || /\/>/.test(txt))) return;
    ev.preventDefault();
    var idx = picker.hidden ? null : pickerIdx;
    var before = picker.hidden ? null : pickerBefore;
    if (!picker.hidden) closePicker();
    addHtmlSection(txt, idx == null ? undefined : idx, before);
  });
  // ---------- light editing on native (pre-freeform) sections ----------
  // Rendered leaves pair with their markup spans; edits replace the span's
  // HTML with the live DOM, so publish and Make freeform both see them.
  // ---------- selection link bubble: select text in any light editor and a
  // 'Link' chip floats above it — ⌘K without having to know ⌘K ----------
  var activeLightEd = null;
  var linkBubble = document.createElement('div');
  linkBubble.className = 'gogh-linkbubble';
  linkBubble.innerHTML =
    '<button type="button" class="gogh-fmtbtn" data-fmt="bold" title="Bold"><b>B</b></button>' +
    '<button type="button" class="gogh-fmtbtn" data-fmt="italic" title="Italic"><i>I</i></button>' +
    '<button type="button" class="gogh-fmtbtn gogh-fmt-link" title="Link">' +
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.1.4l3-3a5 5 0 0 0-7-7.1l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.1-.4l-3 3a5 5 0 0 0 7 7.1l1.7-1.7"/></svg>Link</button>';
  linkBubble.hidden = true;
  document.body.appendChild(linkBubble);
  function setActiveLightEd(ctx) {
    activeLightEd = ctx;
    if (!ctx) linkBubble.hidden = true;
  }
  // any selection inside editable light-edit text earns the bubble — even
  // before the paragraph was clicked into edit mode
  function lightEdContextFor(node) {
    var el = node && (node.nodeType === 1 ? node : node.parentElement);
    if (!el || !el.closest) return null;
    if (el.closest('.wp-block-navigation')) return null;
    var t = el.closest('h1,h2,h3,h4,h5,h6,p,figcaption');
    if (!t) return null;
    var all = chromeLightEdits.concat(pendingBlocks, storedEdits);
    for (var i = 0; i < all.length; i++) {
      var en = all[i];
      if (!en.el || !en.__leafOf || !en.el.contains(t)) continue;
      if (en.chromePart && en.el.querySelector('.gogh-wrap')) continue;
      var leaf = en.__leafOf(t);
      if (!leaf) return null;
      return { el: t, leafOf: en.__leafOf, sync: en.__sync };
    }
    return null;
  }
  document.addEventListener('selectionchange', function () {
    if (!editing) { linkBubble.hidden = true; return; }
    var s = window.getSelection();
    if (!s.rangeCount || s.isCollapsed) { linkBubble.hidden = true; return; }
    var ctx = (activeLightEd && activeLightEd.el.contains(s.anchorNode))
      ? activeLightEd
      : lightEdContextFor(s.anchorNode);
    if (!ctx) {
      // freeform text edits deserve the same toolbar: any selection inside
      // a gogh element being edited gets B / I / Link too
      var an = s.anchorNode;
      var ael = an && (an.nodeType === 1 ? an : an.parentElement);
      var edEl = ael && ael.closest && ael.closest('.gogh-section [contenteditable="true"]');
      if (edEl) {
        ctx = {
          el: edEl,
          leafOf: function () { return edEl; },
          sync: function () { edEl.dispatchEvent(new Event('input', { bubbles: true })); },
        };
      }
    }
    if (!ctx) { linkBubble.hidden = true; return; }
    var r = s.getRangeAt(0).getBoundingClientRect();
    if (!r.width) { linkBubble.hidden = true; return; }
    linkBubble.__ctx = ctx;
    linkBubble.style.left = (r.left + r.width / 2 + window.scrollX) + 'px';
    linkBubble.style.top = (r.top + window.scrollY - 36) + 'px';
    linkBubble.hidden = false;
  });
  // taking the bubble must not steal the selection it exists for
  linkBubble.addEventListener('pointerdown', function (ev) {
    ev.preventDefault();
    ev.stopPropagation();
  });
  // and the bubble must not OVERSTAY: any press outside it dismisses (a
  // fresh selection brings it straight back via selectionchange)
  document.addEventListener('pointerdown', function (ev) {
    if (!linkBubble.hidden && !linkBubble.contains(ev.target)) linkBubble.hidden = true;
  }, true);
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !linkBubble.hidden) linkBubble.hidden = true;
  });
  linkBubble.addEventListener('click', function (ev) {
    ev.stopPropagation();
    var ctx = linkBubble.__ctx || activeLightEd;
    if (!ctx) return;
    var s = window.getSelection();
    if (!s.rangeCount || s.isCollapsed) return;
    var range = s.getRangeAt(0).cloneRange();
    var fmtBtn = ev.target.closest && ev.target.closest('.gogh-fmtbtn');
    var fmt = fmtBtn && fmtBtn.getAttribute('data-fmt');
    if (fmt) {
      // bold/italic act right here and KEEP the selection for more formatting
      var wasEd = ctx.el.getAttribute('contenteditable') === 'true';
      if (!wasEd) ctx.el.setAttribute('contenteditable', 'true');
      s.removeAllRanges();
      s.addRange(range);
      try { document.execCommand(fmt, false, null); } catch (eF) {}
      if (!wasEd) ctx.el.removeAttribute('contenteditable');
      var leafF = ctx.leafOf(ctx.el);
      if (leafF) ctx.sync(leafF);
      return;
    }
    linkBubble.hidden = true;
    openLinkCreatePanel(ctx.el, function (url) {
      // createLink needs an editable host — borrow editability if the
      // paragraph was never clicked into edit mode
      var wasEditable = ctx.el.getAttribute('contenteditable') === 'true';
      if (!wasEditable) ctx.el.setAttribute('contenteditable', 'true');
      s.removeAllRanges();
      s.addRange(range);
      try { document.execCommand('createLink', false, url); } catch (e2) {}
      if (!wasEditable) ctx.el.removeAttribute('contenteditable');
      var leaf = ctx.leafOf(ctx.el);
      if (leaf) ctx.sync(leaf);
      toast('Linked.');
    });
  });
  function bindPending(entry) {
    // shared light editor: pending sections AND non-freeform chrome parts.
    // A chrome entry lives while editing is on and the part has no mounted
    // freeform canvas; a pending entry lives while it is still pending.
    var live = function () {
      if (entry.chromePart) {
        return editing && chromeLightEdits.indexOf(entry) !== -1 &&
          !entry.el.querySelector('.gogh-wrap');
      }
      // published blocks stay lightly editable for as long as editing is on
      if (entry.stored) return editing && storedEdits.indexOf(entry) !== -1;
      return pendingBlocks.indexOf(entry) !== -1;
    };
    var fresh = !entry.__bound;
    entry.__bound = true;
    entry.map = [];
    var pair = function pair(container, base, rawText) {
      var spans = parseTopBlocks(rawText);
      var keepKid = function (c) {
        if (c.nodeType !== 1) return false;
        if (c.classList && c.classList.contains('gogh-pendbar')) return false;
        // cover blocks render scaffolding elements with no block-comment
        // span of their own — counting them derails every leaf after them
        if (c.classList && (c.classList.contains('wp-block-cover__background') ||
          c.classList.contains('wp-block-cover__image-background'))) return false;
        // metadata children are never block output (a refreshed chrome part
        // carries a <style> from the renderer)
        var tg = c.tagName;
        return tg !== 'STYLE' && tg !== 'SCRIPT' && tg !== 'LINK' && tg !== 'TEMPLATE';
      };
      var kids = [].slice.call(container.children).filter(keepKid);
      // the cover's inner-container is a WRAPPER, not a block — its children
      // are the cover block's child blocks. Flatten it transparently.
      for (var gi = 0; gi < kids.length; gi++) {
        if (kids[gi].classList && kids[gi].classList.contains('wp-block-cover__inner-container')) {
          var innerKids = [].slice.call(kids[gi].children).filter(keepKid);
          Array.prototype.splice.apply(kids, [gi, 1].concat(innerKids));
          gi += innerKids.length - 1;
        }
      }
      if (!spans.length || spans.length !== kids.length) return;
      spans.forEach(function (sp, k) {
        var dom = kids[k];
        var nm = String(sp.name || '').replace(/^core\//, '');
        if (nm === 'group' || nm === 'columns' || nm === 'column' || nm === 'buttons' || nm === 'cover') {
          var inner = innerRawOf(rawText, sp);
          if (inner && dom.children.length) { pair(dom, base + inner.base, inner.text); return; }
        }
        var seg = rawText.slice(sp.start, sp.end);
        var bodyStart = seg.indexOf('-->');
        var bodyEnd = seg.lastIndexOf('<!--');
        if (bodyStart === -1 || bodyEnd <= bodyStart) return; // self-closing: nothing editable
        // a leaf whose body still contains block comments (cover, quote,
        // gallery…) cannot be rewritten safely from the DOM — leave it
        // uneditable rather than risk corrupting the markup
        if (seg.slice(bodyStart + 3, bodyEnd).indexOf('<!-- wp:') !== -1) return;
        entry.map.push({ node: dom, s: base + sp.start, e: base + sp.end });
      });
    };
    if (entry.selfBlock) {
      // a stored entry whose el IS the block's own root (not a holder of
      // blocks): descend into container blocks, or edit the node as the
      // block body when it holds no nested blocks
      var sp0s = parseTopBlocks(entry.raw);
      if (sp0s.length === 1) {
        var sp0 = sp0s[0];
        var nm0 = String(sp0.name || '').replace(/^core\//, '');
        if (nm0 === 'group' || nm0 === 'columns' || nm0 === 'buttons' || nm0 === 'cover') {
          var inner0 = innerRawOf(entry.raw, sp0);
          if (inner0 && entry.el.children.length) pair(entry.el, inner0.base, inner0.text);
        } else {
          var seg0 = entry.raw.slice(sp0.start, sp0.end);
          var bs0 = seg0.indexOf('-->');
          var be0 = seg0.lastIndexOf('<!--');
          if (bs0 !== -1 && be0 > bs0 && seg0.slice(bs0 + 3, be0).indexOf('<!-- wp:') === -1) {
            entry.map.push({ node: entry.el, s: sp0.start, e: sp0.end });
          }
        }
      }
    } else {
      pair(entry.el, 0, entry.raw);
      // one block, unmatched structure (an HTML block, say): the whole
      // holder edits as a single span. NEVER for chrome parts — their DOM
      // is a template RENDER (self-closing site-title/navigation blocks,
      // injected editor UI), and whole-copying it into the raw once
      // replaced a header with its own rendered DOM, navadds included.
      if (!entry.map.length && !entry.chromePart) {
        var spans0 = parseTopBlocks(entry.raw);
        if (spans0.length === 1) {
          entry.map.push({ node: entry.el, s: spans0[0].start, e: spans0[0].end, whole: true });
        }
      }
    }
    var holder = entry.el;
    var syncT = null;
    function leafOf(node) {
      for (var i = 0; i < entry.map.length; i++) {
        if (entry.map[i].node === node || entry.map[i].node.contains(node)) return entry.map[i];
      }
      return null;
    }
    function cleanCopy(node) {
      var c = node.cloneNode(true);
      [].slice.call(c.querySelectorAll('[contenteditable]')).forEach(function (n) { n.removeAttribute('contenteditable'); });
      c.removeAttribute('contenteditable');
      // gogh's own UI and markers must never travel into stored content
      [].slice.call(c.querySelectorAll('[class*="gogh-"]')).forEach(function (n) { n.remove(); });
      [].slice.call(c.querySelectorAll('*')).concat([c]).forEach(function (n) {
        [].slice.call(n.attributes || []).forEach(function (at) {
          if (at.name.indexOf('data-gogh') === 0) n.removeAttribute(at.name);
        });
      });
      return c.outerHTML;
    }
    function wholeCopy(node) {
      return [].slice.call(node.children).filter(function (c) {
        return !(c.classList && c.classList.contains('gogh-pendbar'));
      }).map(function (c) { return cleanCopy(c); }).join('\n');
    }
    function syncLeaf(leaf) {
      var markup = entry.raw.slice(leaf.s, leaf.e);
      // the body sits between the opening comment and the LAST comment (the
      // leaf's own closer) — never an inner block's closer
      var bodyStart = markup.indexOf('-->');
      var bodyEnd = markup.lastIndexOf('<!--');
      if (bodyStart === -1 || bodyEnd <= bodyStart) return;
      var next = markup.slice(0, bodyStart + 3) + '\n' +
        (leaf.whole ? wholeCopy(leaf.node) : cleanCopy(leaf.node)) + '\n' +
        markup.slice(bodyEnd);
      var delta = next.length - markup.length;
      entry.raw = entry.raw.slice(0, leaf.s) + next + entry.raw.slice(leaf.e);
      leaf.e += delta;
      entry.map.forEach(function (l) {
        if (l !== leaf && l.s >= leaf.e - delta) { l.s += delta; l.e += delta; }
      });
      refreshChip();
    }
    entry.__sync = syncLeaf;
    entry.__leafOf = leafOf;
    var activeEd = null;
    function stopEdit() {
      if (!activeEd) return;
      // focus returned (or never left): the editor is in use — keep it
      if (document.activeElement === activeEd.el) return;
      activeEd.el.removeAttribute('contenteditable');
      var leaf = leafOf(activeEd.el);
      if (leaf) syncLeaf(leaf);
      if (activeLightEd && activeLightEd.el === activeEd.el) setActiveLightEd(null);
      activeEd = null;
    }
    if (!fresh) return; // re-bind refreshes the map; listeners attach once
    // anchors and images are natively DRAGGABLE: a one-pixel hand tremor
    // during a click starts a browser link-drag and kills the caret the
    // click just placed — the classic "caret appears then vanishes"
    holder.addEventListener('dragstart', function (ev) {
      if (editing && live()) ev.preventDefault();
    });
    holder.addEventListener('click', function (ev) {
      if (!editing || !live()) return;
      // the menu has its own physics (drag to reorder, + to add)
      if (entry.chromePart && ev.target.closest && ev.target.closest('.wp-block-navigation')) return;
      var a = ev.target.closest && ev.target.closest('a');
      if (a && !a.closest('.gogh-pendbar')) ev.preventDefault();
      // the site logo IS an image — its branch must beat the generic
      // image-swap path or clicking the logo can never open the logo picker
      var slgEarly = ev.target.closest && ev.target.closest('.wp-block-site-logo');
      if (slgEarly && entry.chromePart) {
        ev.preventDefault();
        openLogoPicker(slgEarly);
        return;
      }
      var img = ev.target.closest && ev.target.closest('img');
      if (img) {
        ev.preventDefault();
        pickPendingImage(entry, img);
        return;
      }
      var soc = ev.target.closest && ev.target.closest('.wp-block-social-link');
      if (soc) {
        ev.preventDefault();
        editSocialLink(entry, soc);
        return;
      }
      // the logo text: clicking it renames the SITE (the block renders the
      // blogname option — editing the template raw would change nothing)
      var stt = ev.target.closest && ev.target.closest('.wp-block-site-title');
      if (stt && entry.chromePart) {
        ev.preventDefault();
        editSiteTitle(stt);
        return;
      }
      var btnLink = ev.target.closest && ev.target.closest('.wp-block-button__link, .wp-element-button');
      if (btnLink && !btnLink.closest('.gogh-pendbar') && leafOf(btnLink)) {
        ev.preventDefault();
        editPendingLink(entry, btnLink, leafOf(btnLink), syncLeaf);
        return;
      }
      var t = ev.target.closest &&
        ev.target.closest('h1,h2,h3,h4,h5,h6,p,figcaption');
      if (!t && ev.target.closest) {
        // standalone text spans (eyebrows, link labels) edit too — but a
        // span INSIDE an editable block defers to the block
        var sp2 = ev.target.closest('span,em,strong,small');
        if (sp2 && !sp2.closest('h1,h2,h3,h4,h5,h6,p,figcaption') &&
          [].some.call(sp2.childNodes, function (n2) { return n2.nodeType === 3 && n2.textContent.trim(); })) {
          t = sp2;
        }
      }
      // a plain text link inside editable text: edit or remove it. But a
      // CARD — an anchor wrapping whole headings/paragraphs — edits its
      // WORDS on text clicks; its link is edited from the padding.
      if (a && !a.closest('.gogh-pendbar') && leafOf(a) && !(t && a.contains(t))) {
        editTextLink(entry, a, leafOf(a), syncLeaf);
        return;
      }
      if (!t || t.closest('.gogh-pendbar') || !leafOf(t)) return;
      if (activeEd && activeEd.el !== t) stopEdit();
      if (t.getAttribute('contenteditable') !== 'true') {
        t.setAttribute('contenteditable', 'true');
        activeEd = { el: t };
        // the selection bubble knows which editor owns the selection
        setActiveLightEd({ el: t, leafOf: leafOf, sync: syncLeaf });
        // select-then-click is how people link text: the click that makes
        // this editable must not focus() away the selection they just made
        var selNow = window.getSelection();
        var keepSel = selNow && selNow.rangeCount && !selNow.isCollapsed && t.contains(selNow.anchorNode);
        if (!keepSel) {
          t.focus();
          // land the caret exactly under the click — focus() alone parks it
          // at the start, costing an extra click or three to re-aim
          if (document.caretRangeFromPoint) {
            var cr = document.caretRangeFromPoint(ev.clientX, ev.clientY);
            if (cr && t.contains(cr.startContainer)) {
              var so = window.getSelection();
              so.removeAllRanges();
              so.addRange(cr);
            }
          }
        }
      }
    });
    holder.addEventListener('input', function (ev) {
      if (!live()) return;
      var leaf = leafOf(ev.target);
      if (!leaf) return;
      clearTimeout(syncT);
      syncT = setTimeout(function () { syncLeaf(leaf); }, 500);
    });
    holder.addEventListener('keydown', function (ev) {
      // WordPress-feel Enter in the light editor too: a real paragraph gap
      // (Shift+Enter keeps the single break); headings finish on Enter
      if (!activeEd || ev.key !== 'Enter') return;
      var tEl = activeEd.el;
      if (/^H[1-6]$/.test(tEl.tagName)) {
        ev.preventDefault();
        stopEdit();
        return;
      }
      if (!ev.shiftKey) {
        ev.preventDefault();
        document.execCommand('insertHTML', false, '<br><br>');
        tEl.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    holder.addEventListener('focusout', function (ev) {
      // focus hopping WITHIN the holder must not stop editing: on anchor
      // cards, mousedown natively focuses the <a>, then edit entry focuses
      // the heading — that a→heading hop fired this and killed the fresh
      // caret 80ms in ("appears for an instant, then vanishes")
      if (ev.relatedTarget && holder.contains(ev.relatedTarget)) return;
      setTimeout(stopEdit, 80);
    });
    holder.addEventListener('keydown', function (ev) {
      // Cmd/Ctrl+K links the selected text, same shortcut as the canvas
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k' && activeEd) {
        ev.preventDefault();
        var selObj = window.getSelection();
        if (!selObj.rangeCount || selObj.isCollapsed) return;
        var range = selObj.getRangeAt(0).cloneRange();
        var edEl = activeEd.el;
        // gogh's own panel, never window.prompt \u2014 Chrome can mute native
        // dialogs in long-lived tabs
        openLinkCreatePanel(edEl, function (url) {
          selObj.removeAllRanges();
          selObj.addRange(range);
          try { document.execCommand('createLink', false, url); } catch (err) {}
          var leaf = leafOf(edEl);
          if (leaf) syncLeaf(leaf);
        });
      }
    });
  }
  function openLinkCreatePanel(nearEl, apply) {
    placePanelNear(nearEl);
    panel.innerHTML =
      '<div class="gogh-panel-title">Link the selected text</div>' +
      '<div class="gogh-panel-row">' +
      '<input type="url" class="gogh-input gogh-linkurl" placeholder="https://" />' +
      '<button type="button" class="gogh-btn gogh-btn-small gogh-apply">Link</button>' +
      '</div>';
    panel.hidden = false;
    panelOpen = true;
    var inp = panel.querySelector('.gogh-linkurl');
    inp.focus();
    var go = function () {
      var v = inp.value.trim();
      if (!v || v === 'https://') return;
      closePanel();
      apply(v);
    };
    panel.querySelector('.gogh-apply').addEventListener('click', go);
    inp.addEventListener('keydown', function (e2) { if (e2.key === 'Enter') go(); });
  }
  function editTextLink(entry, aEl, leaf, sync) {
    placePanelNear(aEl);
    panel.innerHTML =
      '<div class="gogh-panel-title">Link</div>' +
      '<div class="gogh-panel-row">' +
      '<input type="url" class="gogh-input gogh-linkurl" placeholder="https://" />' +
      '<button type="button" class="gogh-btn gogh-btn-small gogh-apply">Apply</button>' +
      '</div>' +
      '<div class="gogh-panel-row">' +
      '<button type="button" class="gogh-btn gogh-btn-small gogh-unlink">Remove link (keep the text)</button>' +
      '</div>';
    panel.hidden = false;
    panelOpen = true;
    var inp = panel.querySelector('.gogh-linkurl');
    inp.value = aEl.getAttribute('href') || '';
    var apply = function () {
      var v = inp.value.trim();
      if (v) aEl.setAttribute('href', v);
      sync(leaf);
      closePanel();
      toast('Link updated.');
    };
    panel.querySelector('.gogh-apply').addEventListener('click', apply);
    inp.addEventListener('keydown', function (e2) { if (e2.key === 'Enter') apply(); });
    panel.querySelector('.gogh-unlink').addEventListener('click', function () {
      aEl.replaceWith(document.createTextNode(aEl.textContent || ''));
      sync(leaf);
      closePanel();
      toast('Link removed — the text stays.');
    });
  }
  function editSocialLink(entry, li) {
    var m = (li.className + '').match(/wp-social-link-([a-z0-9_-]+)/);
    var service = m ? m[1] : null;
    if (!service) { toast('gogh couldn’t identify that icon.', { error: true }); return; }
    var re = /<!--\s*wp:social-link\s*({[\s\S]*?})\s*\/-->/g;
    var hits = [];
    var mm;
    while ((mm = re.exec(entry.raw))) {
      try {
        var at = JSON.parse(mm[1]);
        if (at.service === service) hits.push({ start: mm.index, end: re.lastIndex, attrs: at });
      } catch (e2) {}
    }
    var same = [].slice.call(entry.el.querySelectorAll('.wp-social-link-' + service));
    var hit = hits[Math.max(0, same.indexOf(li))] || hits[0];
    if (!hit) { toast('gogh couldn’t find that icon in the stored markup.', { error: true }); return; }
    placePanelNear(li);
    panel.innerHTML =
      '<div class="gogh-panel-title">' + service.charAt(0).toUpperCase() + service.slice(1) + ' link</div>' +
      '<div class="gogh-panel-row">' +
      '<input type="url" class="gogh-input gogh-linkurl" placeholder="https://" />' +
      '<button type="button" class="gogh-btn gogh-btn-small gogh-apply">Apply</button>' +
      '</div>';
    panel.hidden = false;
    panelOpen = true;
    var inp = panel.querySelector('.gogh-linkurl');
    inp.value = hit.attrs.url || '';
    inp.focus();
    var apply = function () {
      var v = inp.value.trim();
      if (!v) return;
      hit.attrs.url = v;
      var next = '<!-- wp:social-link ' + JSON.stringify(hit.attrs) + ' /-->';
      var delta = next.length - (hit.end - hit.start);
      entry.raw = entry.raw.slice(0, hit.start) + next + entry.raw.slice(hit.end);
      // keep every leaf's offsets honest around the splice
      entry.map.forEach(function (l) {
        if (l.s >= hit.end) { l.s += delta; l.e += delta; }
        else if (l.e > hit.start) { l.e += delta; }
      });
      var aa = li.querySelector('a');
      if (aa) aa.setAttribute('href', v);
      refreshChip();
      closePanel();
      toast('Icon link updated.');
    };
    panel.querySelector('.gogh-apply').addEventListener('click', apply);
    inp.addEventListener('keydown', function (e2) { if (e2.key === 'Enter') apply(); });
  }
  function editPendingLink(entry, aEl, leaf, syncLeaf) {
    placePanelNear(aEl);
    panel.innerHTML =
      '<div class="gogh-panel-title">Button</div>' +
      '<div class="gogh-panel-row">' +
      '<input type="text" class="gogh-input gogh-btnlabel" placeholder="Label" />' +
      '</div>' +
      '<div class="gogh-panel-row">' +
      '<input type="url" class="gogh-input gogh-btnhref" placeholder="Link to\u2026 (https://)" />' +
      '<button type="button" class="gogh-btn gogh-btn-small gogh-apply">Apply</button>' +
      '</div>';
    panel.hidden = false;
    panelOpen = true;
    var lab = panel.querySelector('.gogh-btnlabel');
    var href = panel.querySelector('.gogh-btnhref');
    lab.value = (aEl.textContent || '').trim();
    href.value = aEl.getAttribute('href') || '';
    var apply = function () {
      if (lab.value.trim()) aEl.textContent = lab.value.trim();
      if (href.value.trim()) aEl.setAttribute('href', href.value.trim());
      syncLeaf(leaf);
      closePanel();
      toast('Button updated.');
    };
    panel.querySelector('.gogh-apply').addEventListener('click', apply);
    [lab, href].forEach(function (inp) {
      inp.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') apply();
        if (ev.key === 'Escape') closePanel();
      });
    });
    lab.focus();
  }
  function pickPendingImage(entry, img) {
    var leaf = null;
    for (var i = 0; i < entry.map.length; i++) {
      if (entry.map[i].node.contains(img)) { leaf = entry.map[i]; break; }
    }
    if (!leaf) { toast('gogh can\u2019t safely swap this image.', { error: true }); return; }
    placePanelNear(img);
    panel.innerHTML =
      '<div class="gogh-panel-title">Replace image</div>' +
      '<div class="gogh-panel-row">' +
      '<input type="url" class="gogh-input" placeholder="Paste image URL\u2026" />' +
      '<button type="button" class="gogh-btn gogh-btn-small gogh-apply">Apply</button>' +
      '</div>' +
      '<div class="gogh-media"><span class="gogh-media-loading">Loading media\u2026</span></div>';
    panel.hidden = false;
    panelOpen = true;
    function useSrc(src2) {
      img.src = src2;
      img.removeAttribute('srcset');
      img.removeAttribute('sizes');
      var entryLeaf = leaf;
      var markup = entry.raw.slice(entryLeaf.s, entryLeaf.e);
      var bodyStart = markup.indexOf('-->');
      var bodyEnd = markup.lastIndexOf('<!--');
      var synced = false;
      if (bodyStart !== -1 && bodyEnd > bodyStart) {
        var frag = document.createElement('div');
        frag.innerHTML = markup.slice(bodyStart + 3, bodyEnd);
        var leafImgs = [].slice.call(entryLeaf.node.querySelectorAll('img')).filter(function (i2) {
          return !i2.closest('.gogh-pendbar');
        });
        var idx2 = leafImgs.indexOf(img);
        var im2 = idx2 === -1 ? null : frag.querySelectorAll('img')[idx2];
        if (im2) {
          im2.src = src2;
          im2.removeAttribute('srcset');
          im2.removeAttribute('sizes');
          var next = markup.slice(0, bodyStart + 3) + frag.innerHTML + markup.slice(bodyEnd);
          var delta = next.length - markup.length;
          entry.raw = entry.raw.slice(0, entryLeaf.s) + next + entry.raw.slice(entryLeaf.e);
          entryLeaf.e += delta;
          entry.map.forEach(function (l) {
            if (l !== entryLeaf && l.s >= entryLeaf.e - delta) { l.s += delta; l.e += delta; }
          });
          synced = true;
        }
      }
      closePanel();
      refreshChip();
      if (synced) toast('Image swapped.');
      else toast('gogh couldn\u2019t safely update this image in the saved markup.', { error: true });
    }
    var inp = panel.querySelector('input');
    panel.querySelector('.gogh-apply').addEventListener('click', function () {
      if (inp.value.trim()) useSrc(inp.value.trim());
    });
    inp.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && inp.value.trim()) useSrc(inp.value.trim());
      if (ev.key === 'Escape') closePanel();
    });
    fetch(restQ(cfg.mediaUrl, 'per_page=12&media_type=image&orderby=date&order=desc'), {
      headers: { 'X-WP-Nonce': cfg.nonce },
      credentials: 'same-origin',
    }).then(function (res) { return res.ok ? res.json() : []; }).catch(function () { return []; }).then(function (items) {
      var box = panel.querySelector('.gogh-media');
      if (!box || panel.hidden) return;
      box.innerHTML = '';
      items.forEach(function (item) {
        var thumb = (item.media_details && item.media_details.sizes &&
          (item.media_details.sizes.thumbnail || item.media_details.sizes.medium));
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'gogh-thumb';
        b.style.backgroundImage = 'url("' + (thumb ? thumb.source_url : item.source_url) + '")';
        b.addEventListener('click', function () { useSrc(item.source_url); });
        box.appendChild(b);
      });
      reclampPanel();
    });
  }
  function convertPending(entry) {
    var holder = entry.el;
    var scan = scanDomWithRaw(holder, entry.raw, { loose: true, freeHtml: !!entry.freeHtml });
    if (!scan.els.length) {
      toast('gogh found nothing it can edit in this section.', { error: true });
      return;
    }
    var sec = newSectionShell('gogh-sec-' + (scopeSeq++));
    sec.els = scan.els;
    sec.minH = scan.minH;
    if (scan.rootBg) sec.bg = scan.rootBg;
    var first = holder.firstElementChild;
    if (!sec.bg && first && !(first.classList && first.classList.contains('gogh-pendbar'))) {
      var bgc = getComputedStyle(first).backgroundColor;
      if (bgc && bgc !== 'rgba(0, 0, 0, 0)' && bgc !== 'transparent') sec.bg = bgc;
    }
    holder.replaceWith(sec.wrapEl);
    pendingBlocks = pendingBlocks.filter(function (q) { return q !== entry; });
    S.push(sec);
    renderSection(sec);
    // canonical model order comes from the DOM, not a guess
    resyncContentOrder();
    sel = null;
    hideHandles();
    toast('\u2728 \u201c' + entry.title + '\u201d is freeform now \u2014 drag anything.', { ttl: 4500 });
  }
  // "+ New page" in the admin bar: ask for a NAME first (the no-JS
  // fallback still creates "Untitled page" via admin-post)
  var npLink = document.querySelector('#wp-admin-bar-gogh-new-page a');
  if (npLink) npLink.addEventListener('click', function (ev) {
    ev.preventDefault();
    panel.innerHTML =
      '<div class="gogh-panel-title">New page</div>' +
      '<div class="gogh-panel-row">' +
      '<input type="text" class="gogh-input gogh-npname" placeholder="Page name\u2026" />' +
      '<button type="button" class="gogh-btn gogh-btn-small gogh-npgo">Create</button>' +
      '</div>' +
      '<em class="gogh-panel-hint">It opens in gogh, ready to design.</em>';
    placePanelNear(npLink);
    panelOpen = true;
    var inp = panel.querySelector('.gogh-npname');
    var go = panel.querySelector('.gogh-npgo');
    setTimeout(function () { inp.focus(); }, 50);
    var create = function () {
      var name = inp.value.trim();
      if (!name) { inp.focus(); return; }
      go.disabled = true;
      go.textContent = 'Creating\u2026';
      fetch(GSROOT + 'pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
        credentials: 'same-origin',
        body: JSON.stringify({ title: name, status: 'publish' }),
      }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
        .then(function (pg) {
          discarding = true;
          location.href = pg.link + (pg.link.indexOf('?') === -1 ? '?' : '&') + 'gogh-edit=1';
        }).catch(function () {
          go.disabled = false;
          go.textContent = 'Create';
          toast('gogh could not create the page \u2014 try again.', { error: true });
        });
    };
    go.addEventListener('click', create);
    inp.addEventListener('keydown', function (ev2) {
      if (ev2.key === 'Enter') create();
      if (ev2.key === 'Escape') closePanel();
    });
  });
  window.__goghAddPattern = function (name, idx) {
    return fetchSectionPatterns().then(function (pats) {
      var p = pats.filter(function (x) { return x.name === name; })[0];
      if (p) return addPatternSection(p, idx);
    });
  };

  function convertChrome(partEl) {
    var area = partEl.tagName === 'FOOTER' ? 'footer' : 'header';
    return Promise.all([
      fetch(restQ(tpUrl(), 'area=' + area + '&context=edit'), {
        headers: { 'X-WP-Nonce': cfg.nonce },
        credentials: 'same-origin',
      }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }),
      fetchAreaPatterns(area),
    ]).then(function (both) {
      var parts = both[0], patterns = both[1];
      if (!parts.length) throw new Error('No ' + area + ' template part found.');
      var active = parts.filter(function (p) { return p.slug === area; })[0] || parts[0];
      // one flat list of layouts: template parts + the theme's patterns
      var options = parts.map(function (p) {
        return { kind: 'part', id: p.id, slug: p.slug, theme: p.theme,
          title: (p.title && p.title.rendered) || p.slug,
          content: (p.content && p.content.raw) || '' };
      });
      patterns.forEach(function (p) {
        options.push({ kind: 'pattern', id: 'pattern:' + p.name, slug: p.name,
          title: p.title || p.name, content: p.content || '' });
      });
      // curated mode: gogh's designs plus the CURRENT part only — the
      // theme's sibling parts (vertical headers, Woo-era leftovers) are the
      // other half of the 24-option flood
      var curated = patterns.some(function (p) { return String(p.name).indexOf('gogh/') === 0; });
      if (curated) {
        options = options.filter(function (o) { return o.kind !== 'part' || o.id === active.id; });
      }
      // parts are often instances of the theme's patterns — same design twice
      var seenTitles = {};
      options = options.filter(function (o) {
        var t = o.title.toLowerCase().replace(/\s+/g, ' ').trim();
        if (seenTitles[t]) return false;
        seenTitles[t] = 1;
        return true;
      });
      var activeOpt = options.filter(function (o) { return o.id === active.id; })[0];
      if (activeOpt && activeOpt.content.indexOf('wp:gogh/section') !== -1) {
        activeOpt.title += ' \u00b7 freeform';
      }
      if (options.length > 1) {
        // render-screen the list first: themes ship duplicates and
        // lookalikes (core + theme copies of the same footer, patterns
        // whose broken pieces render just like the current part) — cycling
        // through those FEELS dead. Only visibly-distinct looks survive,
        // and their renders are kept so every flick is instant.
        return screenChromeOptions(options, activeOpt).then(function (kept) {
          if (kept.length > 1) {
            startChromeCycle(partEl, area, kept, activeOpt, active);
            return null;
          }
          return doConvertChrome(partEl, area, active);
        });
      }
      return doConvertChrome(partEl, area, active);
    }).catch(function (err) {
      toast(err.message || 'Could not edit the ' + area, { error: true });
      return null;
    });
  }
  // enter freeform editing for a chrome part: reuse the mounted section if
  // there is one, otherwise convert now
  function editChromeFreeform(partEl, area, active) {
    endChromePreview();
    closePanel();
    var existing = null;
    S.forEach(function (s) { if (s.chrome && partEl.contains(s.wrapEl)) existing = s; });
    if (existing) {
      if (!existing.chrome.id && active) existing.chrome.id = active.id;
      placeHandles(existing, 0);
      return;
    }
    doConvertChrome(partEl, area, active).catch(function (err) {
      toast(err.message || 'Could not edit the ' + area, { error: true });
    });
  }
  // no panel at all: the Header/Footer pill IS the control. Each click on it
  // flicks the part to the next layout as a live preview; a tick keeps what
  // you're looking at, click-off or Esc reverts. ✨ edits, ⋯ opens the full
  // panel (every layout by name, sticky).
  var chromeCycle = null;
  var cycBar = document.createElement('div');
  cycBar.className = 'gogh-cycbar';
  cycBar.hidden = true;
  cycBar.innerHTML =
    '<b class="gogh-cyc-next" role="button" title="Show the next layout">Next look ›</b>' +
    '<span class="gogh-cyc-n"></span>' +
    '<em class="gogh-cyc-hint"></em>' +
    '<em class="gogh-cyc-build"></em>' +
    '<span class="gogh-cyc-ok" role="button" title="Keep this layout (updates every page)">✓</span>' +
    '<span class="gogh-cyc-edit" role="button" title="Make it freeform">✨</span>' +
    '<span class="gogh-cyc-more" role="button" title="All options">⋯</span>' +
    '<span class="gogh-cyc-x" role="button" title="Put it back">✕</span>';
  document.body.appendChild(cycBar);
  // "click the footer for the next look" reads like a button — so clicking
  // the strip itself (anywhere that isn't ✓ ✨ ⋯ ✕) advances too
  cycBar.addEventListener('click', function (ev) {
    if (ev.target.closest('.gogh-cyc-ok,.gogh-cyc-edit,.gogh-cyc-more,.gogh-cyc-x')) return;
    if (chromeCycle) chromeCycle.advance();
  });
  // the header ITSELF is the button while cycling: the control strip docks
  // at the very top of the screen (over the admin bar) so nothing ever
  // covers the header being previewed
  function startChromeCycle(partEl, area, options, activeOpt, active) {
    if (chromeCycle) chromeCycle.collapse();
    var pill = null;
    chromeBtns.forEach(function (b) { if (b.__goghPart === partEl) pill = b; });
    var st = {
      partEl: partEl, area: area, options: options,
      activeOpt: activeOpt, active: active, idx: 0, busy: false, alive: true,
      // simple mode (James): ONE pill — it advances, carries the count and
      // an inline ✓; no second strip ever appears. Experiments keeps the
      // full strip (freeform convert, browse-all).
      simple: !cfg.experiments,
    };
    if (st.simple && pill) st.pillBase = pill.innerHTML;
    options.forEach(function (o, k) { if (activeOpt && o.id === activeOpt.id) st.idx = k; });
    function isCurrent(o) { return !!(activeOpt && o.id === activeOpt.id); }
    function render() {
      var o = st.options[st.idx];
      if (st.simple && pill) {
        pill.title = 'Site ' + area + ' — ' + o.title + ' (click for the next)';
        var spaceable = isCurrent(o) && !!chromeDialsRead((st.active && st.active.content && st.active.content.raw) || '');
        pill.innerHTML = 'Next ' + area + ' › <em class="gogh-pill-n">' +
          (st.idx + 1) + '/' + st.options.length + (isCurrent(o) ? ' · current' : '') + '</em>' +
          (isCurrent(o) ? '' : '<span class="gogh-pill-keep" role="button" title="Keep this layout (updates every page)">✓</span>') +
          // spacing rides the pill only on the CURRENT layout — tune what is
          // truly yours, never a preview (and only when the raw is dressable)
          (spaceable ? '<span class="gogh-pill-space" role="button" title="Adjust spacing">↕</span>' : '');
        var keep = pill.querySelector('.gogh-pill-keep');
        if (keep) keep.onclick = function (ev) { ev.stopPropagation(); commitChosen(true); };
        var spc = pill.querySelector('.gogh-pill-space');
        if (spc) spc.onclick = function (ev) {
          ev.stopPropagation();
          var act = st.active;
          collapse();
          openChromeSpacingPanel(partEl, area, act);
        };
        return;
      }
      // the layout name lives in the tooltip — the strip stays small
      cycBar.title = 'Site ' + area + ' — ' + o.title;
      cycBar.querySelector('.gogh-cyc-n').textContent =
        (st.idx + 1) + '/' + st.options.length + (isCurrent(o) ? ' · current' : '');
    }
    function collapse(keepPreview) {
      if (!st.alive) return;
      st.alive = false;
      chromeCycle = null;
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onKey, true);
      if (!keepPreview) endChromePreview();
      cycBar.hidden = true;
      cycBar.classList.remove('is-busy');
      document.body.classList.remove('gogh-cycling');
      if (pill) {
        pill.style.display = '';
        pill.disabled = false;
        if (st.simple && st.pillBase != null) pill.innerHTML = st.pillBase;
      }
      placeConvertBtns();
      placeChromeBtns();
    }
    function inPart(ev) {
      // geometry as well as containment: a full-bleed overlay hovering over
      // the part must not steal the "next look" click
      if (partEl.contains(ev.target)) return true;
      var r = partEl.getBoundingClientRect();
      return ev.clientY >= r.top && ev.clientY <= r.bottom &&
        ev.clientX >= r.left && ev.clientX <= r.right;
    }
    function onDocDown(ev) {
      if (pill && pill.contains(ev.target)) return; // the pill's own click advances
      if (cycBar.contains(ev.target)) {
        // strip clicks are the cycle's business alone: without stopping
        // propagation they leak into gogh's global handlers, one of which
        // closes panels — destroying the just-applied preview
        ev.stopPropagation();
        return;
      }
      if (inPart(ev)) {
        // clicking the header = next look; swallow it before nav links act
        ev.preventDefault();
        ev.stopPropagation();
        st.advance();
        return;
      }
      collapse();
    }
    function onDocClick(ev) {
      if (!st.alive) return;
      // the strip floats INSIDE the footer's rect — its clicks are its own
      // (this ate every real click on 'Next look' while synthetic test
      // clicks at 0,0 sailed past the geometry check)
      if (cycBar.contains(ev.target)) return;
      // the pointerdown consumed the gesture — stop the follow-up click from
      // navigating a header link mid-cycle
      if (inPart(ev)) { ev.preventDefault(); ev.stopPropagation(); }
    }
    function onKey(ev) { if (ev.key === 'Escape') { collapse(); ev.stopPropagation(); } }
    st.advance = function () {
      // a click during a slow preview fetch queues instead of vanishing —
      // dropped clicks read as "the footer toggle doesn't work"
      if (st.busy) { st.queued = true; return; }
      var prevIdx = st.idx;
      st.idx = (st.idx + 1) % st.options.length;
      var o = st.options[st.idx];
      render();
      if (isCurrent(o)) {
        endChromePreview();
        var h0 = cycBar.querySelector('.gogh-cyc-hint');
        if (h0) { h0.textContent = ''; h0.classList.remove('is-warn'); }
        return;
      }
      st.busy = true;
      cycBar.classList.add('is-busy');
      previewChromeLayout(partEl, o, function (ok) {
        st.busy = false;
        cycBar.classList.remove('is-busy');
        // a preview that lands after the cycle ended must not stick around —
        // but only end a preview that is OURS, never a newer cycle's stage
        if (!st.alive) {
          if (ok && chromePreview && chromePreview.partEl === partEl) endChromePreview();
          return;
        }
        if (!ok) {
          // the label must never claim a look that isn't on screen
          st.idx = prevIdx;
          render();
          return;
        }
        // the swap reflows the page and can cancel the opening scroll —
        // re-assert once the first preview is actually on screen
        if (!st.scrolled) {
          st.scrolled = true;
          partEl.scrollIntoView({ block: st.area === 'footer' ? 'end' : 'start' });
        }
        if (st.queued) { st.queued = false; st.advance(); }
      });
    };
    st.collapse = collapse;
    chromeCycle = st;
    if (pill) {
      if (st.simple) { pill.disabled = false; }
      else { pill.style.display = 'none'; }
    }
    // footer controls live at the bottom of the screen, header's at the top
    cycBar.classList.toggle('is-bottom', area === 'footer');
    var hintInit = cycBar.querySelector('.gogh-cyc-hint');
    hintInit.textContent = '';
    hintInit.classList.remove('is-warn');
    cycBar.querySelector('.gogh-cyc-build').textContent = (window.__gogh.build || '').replace('-chrome', '');
    var nextBtn = cycBar.querySelector('.gogh-cyc-next');
    nextBtn.textContent = 'Next ' + area + ' design ›';
    nextBtn.onclick = function (ev) {
      ev.stopPropagation();
      st.advance();
    };
    function commitChosen(viaPill) {
      var chosen = st.options[st.idx];
      if (isCurrent(chosen)) { collapse(); return; }
      if (!isDirty()) { swapChromeLayoutNow(area, active, chosen); return; }
      if (viaPill) {
        toast('Unpublished page changes will be lost when the ' + area + ' switches.', {
          ttl: 9000,
          actions: [
            { label: 'Switch anyway', onClick: function () { swapChromeLayoutNow(area, active, chosen); } },
            { label: 'Back', onClick: function () {} },
          ],
        });
        return;
      }
      commitViaStrip(chosen);
    }
    st.commitChosen = commitChosen;
    function commitViaStrip(chosen) {
      // the confirmation lives IN the strip — a corner toast goes unseen
      // and reads as "the tick does nothing"
      var area2 = st.area, active2 = st.active;
      var old = cycBar.querySelector('.gogh-cyc-confirm');
      if (old) old.remove();
      var conf = document.createElement('span');
      conf.className = 'gogh-cyc-confirm';
      conf.innerHTML = '<span>Unpublished page changes will be lost.</span>' +
        '<b role="button" class="gogh-cyc-yes">Switch anyway</b>' +
        '<b role="button" class="gogh-cyc-no">Back</b>';
      conf.querySelector('.gogh-cyc-yes').onclick = function (e2) {
        e2.stopPropagation();
        swapChromeLayoutNow(area2, active2, chosen);
      };
      conf.querySelector('.gogh-cyc-no').onclick = function (e2) {
        e2.stopPropagation();
        conf.remove();
      };
      conf.onclick = function (e2) { e2.stopPropagation(); };
      cycBar.appendChild(conf);
    }
    cycBar.querySelector('.gogh-cyc-ok').onclick = function (ev) {
      ev.stopPropagation();
      commitChosen(false);
    };
    cycBar.querySelector('.gogh-cyc-edit').onclick = function (ev) {
      ev.stopPropagation();
      var chosen = st.options[st.idx];
      var existing = null;
      S.forEach(function (s) { if (s.chrome && partEl.contains(s.wrapEl)) existing = s; });
      if (existing) {
        collapse();
        if (!existing.chrome.id && active) existing.chrome.id = active.id;
        placeHandles(existing, 0);
        return;
      }
      // ✨ converts what's ON SCREEN — the previewed look, not the saved one
      var partArg = isCurrent(chosen) ? active : { id: active.id, content: { raw: chosen.content || '' } };
      var scanRoot = null;
      if (!isCurrent(chosen) && chromePreview && chromePreview.partEl === partEl) {
        // scan the preview box; it then joins the hidden originals under
        // the mounted canvas
        scanRoot = chromePreview.box;
        chromePreview = null;
      }
      collapse(true);
      doConvertChrome(partEl, area, partArg, scanRoot).catch(function (err) {
        toast(err.message || 'Could not edit the ' + area, { error: true });
      });
    };
    cycBar.querySelector('.gogh-cyc-more').onclick = function (ev) {
      ev.stopPropagation();
      collapse();
      openChromeLayoutPanel(partEl, area, options, activeOpt, active);
    };
    cycBar.querySelector('.gogh-cyc-x').onclick = function (ev) {
      ev.stopPropagation();
      collapse();
    };
    document.addEventListener('pointerdown', onDocDown, true);
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKey, true);
    // choosing a header is a MODE: every other editing affordance hides so
    // the page is just the thing being chosen
    document.body.classList.add('gogh-cycling');
    sel = null;
    hideHandles();
    hideSecBar();
    closePanel();
    // super simple, per James: Next, the count, keep, put back — the
    // freeform convert and the browse-all live behind experiments for now
    cycBar.querySelector('.gogh-cyc-edit').style.display = cfg.experiments ? '' : 'none';
    cycBar.querySelector('.gogh-cyc-more').style.display = cfg.experiments ? '' : 'none';
    cycBar.hidden = !!st.simple;
    // bring the part on screen — flicking through looks you can't see
    // isn't choosing. Instant, not smooth: preview reflows cancel smooth
    // scrolls midway.
    partEl.scrollIntoView({ block: area === 'footer' ? 'end' : 'start' });
    // the pill click already MEANS "show me another" — arriving on the
    // current look and asking for a second click read as clunky
    st.advance();
    // open on the CURRENT design — 'Next look' starts the flicking
    render();
  }
  // the header designer, gogh-sized: three dials that paint the mounted
  // part live and persist once through WordPress's own spacing supports
  function openChromeSpacingPanel(partEl, area, active) {
    var raw = (active && active.content && active.content.raw) || '';
    var d0 = chromeDialsRead(raw);
    if (!d0) {
      toast('This ' + area + ' layout can\u2019t be re-spaced automatically.', { error: true });
      return;
    }
    var dial = function (label, cls, min, max, val) {
      return '<div class="gogh-panel-row gogh-logosize gogh-dialrow"><span>' + label + '</span>' +
        '<input type="range" class="' + cls + '" min="' + min + '" max="' + max + '" step="2" value="' + val + '" />' +
        '<span class="gogh-logosize-val ' + cls + '-val">' + val + '</span></div>';
    };
    panel.innerHTML =
      '<div class="gogh-panel-head"><span class="gogh-panel-title">' + area.charAt(0).toUpperCase() + area.slice(1) + ' spacing</span>' +
      '<button type="button" class="gogh-sbtn gogh-panel-close" title="Close">\u2715</button></div>' +
      '<div class="gogh-panel-hint">Drag \u2014 the ' + area + ' follows live</div>' +
      dial('Height', 'gogh-dial-pad', 4, 64, d0.pad) +
      dial('Elements', 'gogh-dial-gap', 4, 48, d0.gap) +
      (d0.hasNav ? dial('Links', 'gogh-dial-link', 8, 64, d0.linkGap) : '') +
      '<div class="gogh-panel-row gogh-chrome-foot">' +
      '<button type="button" class="gogh-btn gogh-btn-small gogh-dials-cancel">Cancel</button>' +
      '<button type="button" class="gogh-btn-save gogh-btn-small gogh-dials-apply" title="Updates every page" disabled>Apply</button>' +
      '</div>';
    var dialApply = panel.querySelector('.gogh-dials-apply');
    var readDials = function () {
      var v = function (cls, fb) {
        var inp = panel.querySelector('.' + cls);
        return inp ? +inp.value : fb;
      };
      return { pad: v('gogh-dial-pad', d0.pad), gap: v('gogh-dial-gap', d0.gap), linkGap: v('gogh-dial-link', d0.linkGap) };
    };
    ['gogh-dial-pad', 'gogh-dial-gap', 'gogh-dial-link'].forEach(function (cls) {
      var inp = panel.querySelector('.' + cls);
      if (!inp) return;
      inp.addEventListener('input', function () {
        var lab = panel.querySelector('.' + cls + '-val');
        if (lab) lab.textContent = inp.value;
        chromeDialsPreview(partEl, readDials());
        dialApply.disabled = false;
      });
    });
    var bail = function () {
      chromeDialsRevert(partEl);
      closePanel();
    };
    panel.querySelector('.gogh-panel-close').addEventListener('click', bail);
    panel.querySelector('.gogh-dials-cancel').addEventListener('click', bail);
    dialApply.addEventListener('click', function () {
      var newRaw = chromeDialsApply(raw, readDials());
      if (newRaw == null) {
        toast('This ' + area + ' layout can\u2019t be re-spaced automatically.', { error: true });
        return;
      }
      dialApply.disabled = true;
      dialApply.textContent = 'Applying\u2026';
      confirmChromeReload(area, function () {
        fetch(tpUrl(active.id), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
          credentials: 'same-origin',
          body: JSON.stringify({ content: newRaw }),
        }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          discarding = true;
          location.reload();
        }).catch(function () {
          dialApply.disabled = false;
          dialApply.textContent = 'Apply';
          toast('Could not update the ' + area + '.', { error: true });
        });
      });
    });
    placePanelNear(partEl);
    panelOpen = true;
  }
  // the full panel: every layout by name, freeform, sticky
  function openChromeLayoutPanel(partEl, area, options, activeOpt, active) {
    var selId = activeOpt ? activeOpt.id : null;
    var isFreeform = !!(activeOpt && activeOpt.content.indexOf('wp:gogh/section') !== -1);
    var mounted = partEl.querySelector('.gogh-wrap');
    function render() {
      panel.innerHTML =
        '<div class="gogh-panel-head"><span class="gogh-panel-title">Site ' + area + '</span>' +
        '<button type="button" class="gogh-sbtn gogh-panel-close" title="Close">\u2715</button></div>' +
        '<div class="gogh-panel-hint">Click a layout to preview it live' + (isFreeform ? ' \u2014 picking one replaces your freeform design' : '') + '</div>' +
        '<div class="gogh-panel-row gogh-chrome-rows">' +
        options.map(function (o, k) {
          return '<button type="button" class="gogh-btn gogh-btn-small gogh-chrome-opt' + (o.id === selId ? ' is-active' : '') + '" data-k="' + k + '"></button>';
        }).join('') +
        '</div>' +
        '<div class="gogh-panel-hint">Or make it yours</div>' +
        '<div class="gogh-panel-row gogh-chrome-rows">' +
        '<button type="button" class="gogh-btn gogh-btn-small gogh-chrome-edit">\u2728 ' + (isFreeform || mounted ? 'Edit freeform' : 'Make freeform') + '</button>' +
        '</div>' +
        (activeOpt ? '<div class="gogh-panel-row gogh-chrome-rows">' +
          '<button type="button" class="gogh-btn gogh-btn-small gogh-chrome-sticky' + (chromeIsSticky(active) ? ' is-active' : '') + '">\ud83d\udccc ' +
          (chromeIsSticky(active) ? 'Sticky \u2014 on' : 'Stick to the top') + '</button>' +
          '</div>' : '') +
        ((activeOpt && !isFreeform && !mounted && chromeDialsRead((active && active.content && active.content.raw) || '')) ?
          '<div class="gogh-panel-row gogh-chrome-rows">' +
          '<button type="button" class="gogh-btn gogh-btn-small gogh-chrome-space">\u2195 Spacing\u2026</button>' +
          '</div>' : '') +
        '<div class="gogh-panel-row gogh-chrome-foot">' +
        '<button type="button" class="gogh-btn gogh-btn-small gogh-chrome-cancel">Cancel</button>' +
        '<button type="button" class="gogh-btn gogh-btn-small gogh-chrome-use" title="Updates every page"' + ((activeOpt && selId === activeOpt.id) ? ' disabled' : '') + '>Use this layout</button>' +
        '</div>';
      panel.querySelector('.gogh-panel-close').addEventListener('click', function () {
        chromeDialsRevert(partEl);
        endChromePreview();
        closePanel();
      });
      var stickyBtn = panel.querySelector('.gogh-chrome-sticky');
      if (stickyBtn) stickyBtn.addEventListener('click', function () {
        stickyBtn.disabled = true;
        toggleChromeSticky(area, active);
      });
      var spaceBtn = panel.querySelector('.gogh-chrome-space');
      if (spaceBtn) spaceBtn.addEventListener('click', function () {
        endChromePreview();
        openChromeSpacingPanel(partEl, area, active);
      });
      options.forEach(function (o, k) {
        var b = panel.querySelector('.gogh-chrome-opt[data-k="' + k + '"]');
        b.textContent = o.title + ((activeOpt && o.id === activeOpt.id) ? ' (current)' : '');
        b.addEventListener('click', function () {
          if (activeOpt && o.id === activeOpt.id) {
            endChromePreview();
            selId = o.id;
            render();
            return;
          }
          previewChromeLayout(partEl, o, function (ok) {
            if (ok) { selId = o.id; render(); }
          });
        });
      });
      panel.querySelector('.gogh-chrome-edit').addEventListener('click', function () {
        editChromeFreeform(partEl, area, active);
      });
      panel.querySelector('.gogh-chrome-cancel').addEventListener('click', function () {
        chromeDialsRevert(partEl);
        endChromePreview();
        closePanel();
      });
      panel.querySelector('.gogh-chrome-use').addEventListener('click', function () {
        var chosen = options.filter(function (o) { return o.id === selId; })[0];
        if (!chosen || (activeOpt && chosen.id === activeOpt.id)) return;
        this.disabled = true;
        this.textContent = 'Applying\u2026';
        swapChromeLayout(area, active, chosen);
      });
    }
    render();
    placePanelNear(partEl);
    panelOpen = true;
  }
  var chromePreview = null; // {partEl, box, hidden}
  function endChromePreview() {
    if (!chromePreview) return;
    chromePreview.box.remove();
    chromePreview.hidden.forEach(function (c) { c.style.display = ''; });
    chromePreview = null;
  }
  var prevStyleHandles = {}; // block stylesheets pulled in for previews
  function applyChromePreview(partEl, opt, d, done) {
    (d.styles || []).forEach(function (href) {
      if (prevStyleHandles[href]) return;
      prevStyleHandles[href] = 1;
      if (document.querySelector('link[href="' + href.replace(/"/g, '%22') + '"]')) return;
      var lnk = document.createElement('link');
      lnk.rel = 'stylesheet';
      lnk.href = href;
      document.head.appendChild(lnk);
    });
    // a response landing after the preview stage moved to ANOTHER part
    // (header fetch resolving mid-footer-cycle) must not write into it —
    // that both showed the wrong content and let the dead cycle's cleanup
    // destroy the live preview
    if (chromePreview && chromePreview.partEl !== partEl) {
      if (done) done(false);
      return;
    }
    if (!chromePreview) {
      var hidden = [].slice.call(partEl.children);
      hidden.forEach(function (c) { c.style.display = 'none'; });
      var box = document.createElement('div');
      box.className = 'gogh-chrome-preview';
      partEl.appendChild(box);
      chromePreview = { partEl: partEl, box: box, hidden: hidden };
    }
    chromePreview.box.innerHTML = (d.css ? '<style>' + d.css + '</style>' : '') + (d.html || '');
    // self-check: an "applied" preview the user can't SEE is the worst
    // failure mode — detect it, and REPORT the outcome on the strip itself
    // so a single screenshot carries the full diagnosis
    setTimeout(function () {
      if (!chromePreview || chromePreview.partEl !== partEl) return;
      var bh = chromePreview.box.getBoundingClientRect().height;
      var origVisible = chromePreview.hidden.some(function (c) {
        return getComputedStyle(c).display !== 'none';
      });
      var hintEl = cycBar.querySelector('.gogh-cyc-hint');
      if (bh < 20 || origVisible) {
        if (hintEl && chromeCycle && chromeCycle.partEl === partEl) {
          hintEl.textContent = '⚠ applied but hidden: ' + Math.round(bh) + 'px' +
            (origVisible ? ', original visible' : '');
          hintEl.classList.add('is-warn');
        }
        toast('gogh: preview of “' + (opt.title || opt.slug) + '” applied but not visible' +
          ' (box ' + Math.round(bh) + 'px' + (origVisible ? ', original still showing' : '') +
          ', html ' + ((d.html || '').length) + ' chars)', { error: true, ttl: 9000 });
      } else if (hintEl && chromeCycle && chromeCycle.partEl === partEl) {
        // healthy previews stay quiet — the strip only speaks on failure
        hintEl.textContent = '';
        hintEl.classList.remove('is-warn');
      }
    }, 120);
    if (done) done(true);
  }
  function previewChromeLayout(partEl, opt, done) {
    // screened options carry their render — applying is instant
    if (opt.__prev) { applyChromePreview(partEl, opt, opt.__prev, done); return; }
    // gogh's own renderer: do_blocks output PLUS the generated layout CSS
    // and block stylesheets — the core block-renderer returns bare markup
    // that leaves navigations as bulleted lists
    renderChromeOption(opt).then(function (d) {
      if (!d) throw new Error('render failed');
      applyChromePreview(partEl, opt, d, done);
    }).catch(function (err) {
      var hintEl = cycBar.querySelector('.gogh-cyc-hint');
      if (hintEl && chromeCycle && chromeCycle.partEl === partEl) {
        hintEl.textContent = '⚠ ' + ((err && err.message) || 'network error');
        hintEl.classList.add('is-warn');
      }
      toast('Could not preview that layout — ' + ((err && err.message) || 'network error'), { error: true, ttl: 7000 });
      if (done) done(false);
    });
  }
  function renderChromeOption(o) {
    if (o.__prev) return Promise.resolve(o.__prev);
    return fetch(GSROOT.replace(/wp\/v2\/$/, '') + 'gogh/v1/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
      credentials: 'same-origin',
      body: JSON.stringify({ content: o.content || '' }),
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.html != null) { o.__prev = d; return d; }
        return null;
      }).catch(function () { return null; });
  }
  // structural signature: identical looks collapse regardless of the
  // generated hashes WordPress sprinkles through the markup
  function chromeRenderSig(html) {
    return (html || '')
      .replace(/wp-elements-[a-f0-9]+/g, '')
      .replace(/wp-container-[\w-]+/g, '')
      .replace(/\bid="[^"]*"/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function chromeTextSig(html) {
    var t = document.createElement('template');
    t.innerHTML = html || '';
    return (t.content.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }
  // what a look IS to the eye: its words plus its colour scheme — a dark
  // twin of the current layout is a REAL alternative, a same-coloured
  // lookalike is not
  function chromeLookSig(html) {
    var bgs = ((html || '').match(/has-[a-z0-9-]+-background-color/g) || []).sort().join(',');
    return chromeTextSig(html) + '::' + bgs;
  }
  // render every candidate once, up front: options that render empty, or
  // identical to another option, or indistinguishable from the CURRENT
  // part get dropped — flicking through lookalikes feels broken. The kept
  // renders make every subsequent flick instant.
  function screenChromeOptions(options, activeOpt) {
    return Promise.all(options.map(renderChromeOption)).then(function () {
      var seen = {};
      var activeLook = null;
      if (activeOpt && activeOpt.__prev) {
        seen[chromeRenderSig(activeOpt.__prev.html)] = 1;
        activeLook = chromeLookSig(activeOpt.__prev.html);
      }
      return options.filter(function (o) {
        if (o === activeOpt) return true;
        var d = o.__prev;
        if (!d || !d.html || chromeTextSig(d.html).length < 8) return false;
        var sig = chromeRenderSig(d.html);
        if (seen[sig]) return false;
        seen[sig] = 1;
        if (activeLook && chromeLookSig(d.html) === activeLook) return false;
        return true;
      });
    });
  }
  // booted freeform chrome has no template-part id — resolve it so edits
  // actually save somewhere
  function resolveChromeIds() {
    var missing = S.filter(function (s) { return s.chrome && !s.chrome.id; });
    if (!missing.length) return Promise.resolve();
    var areas = [];
    missing.forEach(function (s) { if (areas.indexOf(s.chrome.area) === -1) areas.push(s.chrome.area); });
    return Promise.all(areas.map(function (area) {
      return fetch(restQ(tpUrl(), 'area=' + encodeURIComponent(area) + '&context=edit'), {
        headers: { 'X-WP-Nonce': cfg.nonce },
        credentials: 'same-origin',
      }).then(function (r) { return r.ok ? r.json() : []; }).then(function (parts) {
        var active = null;
        (parts || []).forEach(function (p) {
          if (!active && p.slug === area && (!p.theme || p.theme === cfg.theme)) active = p;
        });
        if (active) {
          missing.forEach(function (s) { if (s.chrome.area === area) s.chrome.id = active.id; });
        }
      }).catch(function () {});
    }));
  }
  function chromeIsSticky(active) {
    var raw = (active && active.content && active.content.raw) || '';
    return /"position":\s*{[^}]*"type":"sticky"/.test(raw);
  }
  function stickyRawToggle(raw, on) {
    var spans = parseTopBlocks(raw);
    var sp = spans[0];
    var nm = sp ? String(sp.name || '').replace(/^core\//, '') : '';
    if (nm !== 'group') return null;
    var seg = raw.slice(sp.start, sp.end);
    var m = seg.match(/^<!--\s*wp:group(\s+({[\s\S]*?}))?\s*-->/);
    if (!m) return null;
    var attrs = {};
    try { attrs = m[2] ? JSON.parse(m[2]) : {}; } catch (err) { return null; }
    attrs.style = attrs.style || {};
    if (on) {
      // WordPress's own position support: core CSS, deactivation-safe
      attrs.style.position = { type: 'sticky', top: '0px' };
    } else {
      delete attrs.style.position;
      if (!Object.keys(attrs.style).length) delete attrs.style;
    }
    var head = Object.keys(attrs).length ? '<!-- wp:group ' + JSON.stringify(attrs) + ' -->' : '<!-- wp:group -->';
    return raw.slice(0, sp.start) + head + seg.slice(m[0].length) + raw.slice(sp.end);
  }
  // ---------- header designer: three dials, native attrs ----------
  // Squarespace's header designer distilled to the dials that matter:
  // Height (group padding), Element spacing (group blockGap), Link spacing
  // (navigation blockGap). Everything writes WordPress's OWN spacing
  // supports — like sticky above, it survives gogh's deactivation.
  function chromeLenPx(v) {
    var m = String(v == null ? '' : v).match(/^([\d.]+)\s*(px|rem|em)?$/);
    if (!m) return null;
    return Math.round(parseFloat(m[1]) * (m[2] && m[2] !== 'px' ? 16 : 1));
  }
  function chromeOuterGroup(raw) {
    var spans = parseTopBlocks(raw);
    var sp = spans[0];
    if (!sp || String(sp.name || '').replace(/^core\//, '') !== 'group') return null;
    var seg = raw.slice(sp.start, sp.end);
    var m = seg.match(/^<!--\s*wp:group(\s+({[\s\S]*?}))?\s*-->/);
    if (!m) return null;
    var attrs = {};
    try { attrs = m[2] ? JSON.parse(m[2]) : {}; } catch (err) { return null; }
    return { sp: sp, seg: seg, head: m[0], attrs: attrs };
  }
  function chromeDialsRead(raw) {
    var g = chromeOuterGroup(raw);
    if (!g) return null;
    var sty = g.attrs.style || {};
    var spc = sty.spacing || {};
    var padTop = spc.padding && spc.padding.top;
    var navM = raw.match(/<!--\s*wp:navigation(\s+({[\s\S]*?}))?\s*\/-->/);
    var navGap = null;
    if (navM && navM[2]) {
      try {
        var na = JSON.parse(navM[2]);
        navGap = na.style && na.style.spacing && na.style.spacing.blockGap;
      } catch (err) {}
    }
    return {
      pad: chromeLenPx(padTop) != null ? chromeLenPx(padTop) : 20,
      gap: chromeLenPx(spc.blockGap) != null ? chromeLenPx(spc.blockGap) : 18,
      linkGap: chromeLenPx(navGap) != null ? chromeLenPx(navGap) : 24,
      hasNav: !!navM,
    };
  }
  function chromeDialsApply(raw, d) {
    var g = chromeOuterGroup(raw);
    if (!g) return null;
    var attrs = g.attrs;
    attrs.style = attrs.style || {};
    attrs.style.spacing = attrs.style.spacing || {};
    var pad = attrs.style.spacing.padding || {};
    pad.top = d.pad + 'px';
    pad.bottom = d.pad + 'px';
    attrs.style.spacing.padding = pad;
    attrs.style.spacing.blockGap = d.gap + 'px';
    var head = '<!-- wp:group ' + JSON.stringify(attrs) + ' -->';
    var body = g.seg.slice(g.head.length);
    // the saved markup carries padding as an inline style — keep it in
    // lockstep with the attrs or the block reads as broken in WP's editor
    body = body.replace(/(<div[^>]*?)(\sstyle="([^"]*)")?>/, function (m0, pre, styAttr, sty) {
      var decls = (sty || '').split(';').map(function (x) { return x.trim(); })
        .filter(function (x) { return x && !/^padding-(top|bottom)\s*:/.test(x); });
      decls.push('padding-top:' + d.pad + 'px');
      decls.push('padding-bottom:' + d.pad + 'px');
      return pre + ' style="' + decls.join(';') + '">';
    });
    var out = raw.slice(0, g.sp.start) + head + body + raw.slice(g.sp.end);
    // the navigation block is dynamic: its attrs alone carry the link gap
    out = out.replace(/<!--\s*wp:navigation(\s+({[\s\S]*?}))?\s*\/-->/, function (m0, sp2, json) {
      var na = {};
      if (json) { try { na = JSON.parse(json); } catch (err) { return m0; } }
      na.style = na.style || {};
      na.style.spacing = na.style.spacing || {};
      na.style.spacing.blockGap = d.linkGap + 'px';
      return '<!-- wp:navigation ' + JSON.stringify(na) + ' /-->';
    });
    return out;
  }
  // live preview: paint the dials straight onto the mounted part — and
  // remember the first sight of each element so Cancel can undress it
  function chromeDialsPreview(partEl, d) {
    if (!partEl.__goghDialsOrig) {
      partEl.__goghDialsOrig = [].map.call(
        partEl.querySelectorAll('.wp-block-group, .wp-block-navigation__container, .wp-block-navigation ul'),
        function (el) { return [el, el.getAttribute('style')]; });
    }
    var grp = partEl.querySelector('.wp-block-group');
    if (grp) {
      grp.style.paddingTop = d.pad + 'px';
      grp.style.paddingBottom = d.pad + 'px';
      grp.style.gap = d.gap + 'px';
    }
    [].forEach.call(partEl.querySelectorAll('.wp-block-navigation__container, .wp-block-navigation ul'), function (ul) {
      ul.style.gap = d.linkGap + 'px';
    });
  }
  function chromeDialsRevert(partEl) {
    (partEl.__goghDialsOrig || []).forEach(function (pair) {
      if (pair[1] == null) pair[0].removeAttribute('style');
      else pair[0].setAttribute('style', pair[1]);
    });
    partEl.__goghDialsOrig = null;
  }
  // gogh's OWN confirm, not window.confirm: Chrome can silently suppress
  // native dialogs in long-lived tabs, which made the \u2713 do nothing at all
  function confirmChromeReload(area, proceed) {
    if (!isDirty()) { proceed(); return; }
    toast('You have unpublished changes \u2014 switching the ' + area + ' reloads the page and discards them.', {
      sticky: true,
      actions: [
        { label: 'Switch anyway', onClick: proceed },
        { label: 'Cancel' },
      ],
    });
  }
  function toggleChromeSticky(area, active) {
    confirmChromeReload(area, function () {
      var raw = (active && active.content && active.content.raw) || '';
      var newRaw = stickyRawToggle(raw, !chromeIsSticky(active));
      if (newRaw == null) {
        toast('This ' + area + ' layout can\u2019t be pinned automatically.', { error: true });
        return;
      }
      fetch(tpUrl(active.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
        credentials: 'same-origin',
        body: JSON.stringify({ content: newRaw }),
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        discarding = true;
        location.reload();
      }).catch(function () {
        toast('Could not update the ' + area + '.', { error: true });
      });
    });
  }
  function swapChromeLayoutNow(area, active, chosen) {
    var content = chosen.content || '';
    if (area === 'header') {
      // the site's identity choice survives a layout change: if the header
      // currently leads with a LOGO, the incoming pattern's title block
      // becomes a logo block (and never both — some patterns carry the two)
      var pe = partElForArea('header');
      var usingLogo = !!(pe && pe.querySelector('.wp-block-site-logo'));
      if (usingLogo) {
        var lg = logoizeHeaderRaw(content);
        if (lg) content = lg;
      } else if (content.indexOf('wp:site-logo') !== -1 && content.indexOf('wp:site-title') !== -1) {
        content = content.replace(/<!--\s*wp:site-logo(\s+\{[^]*?\})?\s*\/-->\s*/, '');
      }
    }
    fetch(tpUrl(active.id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
      credentials: 'same-origin',
      body: JSON.stringify({ content: content }),
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      discarding = true;
      location.reload();
    }).catch(function () {
      toast('Could not switch the ' + area + ' layout.', { error: true });
    });
  }
  function swapChromeLayout(area, active, chosen) {
    confirmChromeReload(area, function () {
      swapChromeLayoutNow(area, active, chosen);
    });
  }
  // measure a rendered container against its raw block markup: known leaves
  // become typed elements, anything else becomes an atomic widget. Shared by
  // chrome conversion and pattern insertion.
  function scanDomWithRaw(rootEl, raw, opts) {
    opts = opts || {};
    var rr = rootEl.getBoundingClientRect();
    if (rr.width < 10) return { els: [], minH: 0 };
    var sx = W / rr.width;
    var out = [];
    var styleTexts = []; // <style> tags in pasted HTML — rebundled into widgets
    // free mode = we're inside raw pasted HTML (not wp blocks). It flips on
    // INTRINSICALLY whenever the walk enters an html block or an arbitrary
    // non-wp container, so published pastes and recovered pastes convert
    // with their own look too — not only fresh ones carrying the flag.
    var freeMode = !!opts.freeHtml;
    function place(dom, e) {
      var r = dom.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      e.x = Math.max(0, Math.round((r.left - rr.left) * sx));
      e.y = Math.max(0, Math.round((r.top - rr.top) * sx));
      e.w = Math.max(24, Math.round(r.width * sx));
      e.h = Math.max(16, Math.round(r.height * sx));
      out.push(e);
    }
    function boxFrom(dom) {
      // a group that paints its own background must not vanish when we
      // flatten it — it becomes a box element behind its children
      var cs = getComputedStyle(dom);
      var bgc = cs.backgroundColor;
      var hasBg = bgc && bgc !== 'rgba(0, 0, 0, 0)' && bgc !== 'transparent';
      var grad = cs.backgroundImage && cs.backgroundImage.indexOf('gradient') !== -1;
      // a PHOTO background (url) must survive too — container divs get
      // flattened, and their backdrop image used to vanish with them
      var photo = cs.backgroundImage && cs.backgroundImage.indexOf('url(') !== -1;
      if (!hasBg && !grad && !photo) return;
      var e = { type: 'box' };
      var m = (dom.className + '').match(/has-([a-z0-9-]+)-background-color/);
      if (m) e.boxBg = m[1];
      else if (photo) {
        // single layer keeps position/size as a shorthand; layered
        // backgrounds (commas between layers) keep the image list only
        var solo = !/\),\s*(?:url|linear|radial|conic)/.test(cs.backgroundImage);
        e.boxBg = solo
          ? cs.backgroundImage + ' ' + cs.backgroundPosition + ' / ' + cs.backgroundSize + ' ' + cs.backgroundRepeat
          : cs.backgroundImage;
      }
      else e.boxBg = grad ? cs.backgroundImage : bgc;
      var rad = parseFloat(cs.borderTopLeftRadius) || 0;
      if (rad) e.radius = Math.round(rad * sx);
      place(dom, e);
    }
    function textStyle(dom, e) {
      var cls = dom.className + '';
      var fm = cls.match(/has-([a-z0-9-]+)-font-size/);
      if (fm) e.fs = fm[1];
      var am = cls.match(/has-text-align-(center|right)/);
      if (am) e.align = am[1];
      var cm = cls.match(/has-([a-z0-9-]+)-color/g);
      if (cm) {
        for (var ci = 0; ci < cm.length; ci++) {
          var cslug = cm[ci].replace(/^has-/, '').replace(/-color$/, '');
          if (cslug !== 'text' && cslug.indexOf('background') === -1 && cslug !== 'link') { e.color = cslug; break; }
        }
      }
      if (!e.fs) {
        // custom-sized text (clamp() and friends): keep the visual scale by
        // stepping to the nearest theme preset instead of falling to default
        var px = parseFloat(getComputedStyle(dom).fontSize);
        var sizes = fontSizes();
        var best = null, bestD = Infinity;
        sizes.forEach(function (s) {
          var d = Math.abs(s.px - px);
          if (d < bestD) { bestD = d; best = s; }
        });
        if (best && px) e.fs = best.slug;
      }
      var needTf = freeMode;
      if (!needTf) {
        // native sections normally re-express text in theme presets — but
        // display typography (huge inline sizes, tight leading, tracking,
        // uppercase) has no preset equivalent, and stepping it to a preset
        // is how a 12rem hero collapsed into body-sized text on convert.
        // Capture the real look whenever it diverges from the preset story.
        var pcs = getComputedStyle(dom);
        var ppx = parseFloat(pcs.fontSize) || 0;
        var chosen = null;
        if (e.fs) {
          fontSizes().forEach(function (sz) { if (sz.slug === e.fs) chosen = sz; });
        }
        var plh = parseFloat(pcs.lineHeight);
        needTf = (chosen && ppx && Math.abs(chosen.px - ppx) > Math.max(3, ppx * 0.12)) ||
          (parseFloat(pcs.letterSpacing) || 0) !== 0 ||
          (pcs.textTransform && pcs.textTransform !== 'none') ||
          (plh && ppx && plh / ppx < 1.05);
      }
      if (needTf) {
        // pasted HTML keeps its own look: capture the real typography so the
        // converted element renders like the paste, not the theme. Theme
        // controls win the moment the user reaches for them (setters clear
        // the matching override).
        var tcs = getComputedStyle(dom);
        var tf = {};
        if (freeMode && tcs.fontFamily) tf.ff = tcs.fontFamily;
        var fpx = parseFloat(tcs.fontSize);
        if (fpx) {
          tf.fs = Math.round(fpx * 100) / 100;
          // container units so captured text scales down on phones like the
          // rest of the section (fs2 cqw ≡ the same size at design width)
          tf.fs2 = Math.round(fpx * sx / 12 * 1000) / 1000;
        }
        if (tcs.fontWeight && tcs.fontWeight !== '400') tf.fw = tcs.fontWeight;
        if (tcs.fontStyle && tcs.fontStyle !== 'normal') tf.fst = tcs.fontStyle;
        var lhp = parseFloat(tcs.lineHeight);
        if (lhp && fpx) tf.lh = Math.round(lhp / fpx * 100) / 100;
        var lsp = parseFloat(tcs.letterSpacing);
        if (lsp) {
          tf.ls = Math.round(lsp * 100) / 100;
          // em tracks the font size at every breakpoint; raw px would keep
          // desktop tracking on phone-sized text
          tf.ls2 = Math.round(lsp / fpx * 1000) / 1000;
        }
        if (tcs.textTransform && tcs.textTransform !== 'none') tf.tt = tcs.textTransform;
        if (tcs.color) tf.col = tcs.color;
        e.tf = tf;
        if (!e.align) {
          var ta = tcs.textAlign;
          if (ta === 'center' || ta === 'right') e.align = ta;
        }
      }
      return e;
    }
    function looksLikeButton(dom) {
      var cs = getComputedStyle(dom);
      var bgc = cs.backgroundColor;
      var hasBg = bgc && bgc !== 'rgba(0, 0, 0, 0)' && bgc !== 'transparent';
      var hasBorder = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none';
      // an anchor holding headings/paragraphs, or standing card-tall, is a
      // CARD — squashing it into a button label mangles its content
      if (dom.querySelector('h1,h2,h3,h4,h5,h6,p')) return false;
      if (dom.getBoundingClientRect().height > 120) return false;
      return (hasBg || hasBorder) && (dom.textContent || '').trim().length < 60 && !dom.querySelector('img');
    }
    function leafFrom(dom, markup) {
      var cl = dom.classList, tag = dom.tagName;
      if (/^H[1-6]$/.test(tag)) return place(dom, textStyle(dom, { type: 'heading', text: cleanInline(dom.innerHTML).trim() }));
      if (tag === 'P' && !cl.contains('gogh-badge')) return place(dom, textStyle(dom, { type: 'para', text: cleanInline(dom.innerHTML).trim() }));
      if (tag === 'IMG') {
        return place(dom, { type: 'image', src: dom.currentSrc || dom.src || null, alt: dom.alt || null });
      }
      if ((tag === 'A' || tag === 'BUTTON') && looksLikeButton(dom)) {
        var bhref = tag === 'A' ? dom.getAttribute('href') : null;
        var bcs = getComputedStyle(dom);
        var bbg = bcs.backgroundColor;
        var bGhost = (!bbg || bbg === 'rgba(0, 0, 0, 0)' || bbg === 'transparent');
        var be = { type: 'button',
          text: (dom.textContent || '').trim(),
          href: (bhref && bhref !== '#') ? bhref : null,
          ghost: bGhost };
        if (freeMode) {
          var btf = {};
          if (!bGhost) btf.bg = bbg;
          if (bcs.color) btf.col = bcs.color;
          var brad = parseFloat(bcs.borderTopLeftRadius);
          if (brad) btf.rad = Math.round(brad);
          var bfpx = parseFloat(bcs.fontSize);
          if (bfpx) {
            btf.fs = Math.round(bfpx * 100) / 100;
            btf.fs2 = Math.round(bfpx * sx / 12 * 1000) / 1000;
          }
          if (bcs.fontWeight && bcs.fontWeight !== '400') btf.fw = bcs.fontWeight;
          if (bcs.fontFamily) btf.ff = bcs.fontFamily;
          be.tf = btf;
        }
        return place(dom, be);
      }
      if (tag === 'FIGURE' && cl.contains('wp-block-image')) {
        var img = dom.querySelector('img');
        var e = { type: 'image' };
        if (img) {
          e.src = img.currentSrc || img.src || null;
          e.alt = img.alt || null;
          var mm = (img.className || '').match(/wp-image-(\d+)/);
          e.mediaId = mm ? +mm[1] : null;
        }
        return place(dom, e);
      }
      if (cl.contains('wp-block-buttons')) {
        // every button becomes a real, individually draggable button
        var btns = [].slice.call(dom.querySelectorAll('.wp-block-button'));
        if (btns.length) {
          btns.forEach(function (btn) {
            var a = btn.querySelector('a');
            var lc = (a && a.className) || '';
            var bgm = lc.match(/has-([a-z0-9-]+)-background-color/);
            var txm = lc.replace(/has-[a-z0-9-]+-background-color/g, '').match(/has-((?!text-color)[a-z0-9-]+)-color/);
            // geometry from the LINK, not the wrapper: stretched button rows
            // make the wrapper span the row while the link hugs its label
            place(a || btn, { type: 'button',
              text: ((a || btn).textContent || '').trim(),
              href: (a && a.getAttribute('href') && a.getAttribute('href') !== '#') ? a.getAttribute('href') : null,
              btnBg: bgm ? bgm[1] : null,
              btnText: txm ? txm[1] : null,
              ghost: btn.className.indexOf('is-style-outline') !== -1 });
          });
          return;
        }
      }
      if (cl.contains('wp-block-spacer') || cl.contains('wp-block-separator') || tag === 'HR') return;
      place(dom, { type: 'widget', whtml: dom.outerHTML,
        wsrc: markup != null ? markup : dom.outerHTML,
        // verbatim markup keeps its OWN styles but loses everything it
        // inherited from wrappers the conversion discards — pin the colour
        wcol: getComputedStyle(dom).color });
    }
    function coverInto(dom, innerRawText) {
      // the cover's backdrop becomes a full-bleed image element; its inner
      // content becomes normal elements on top
      var img = dom.querySelector(':scope > .wp-block-cover__image-background');
      if (img) {
        var cm = (img.className || '').match(/wp-image-(\d+)/);
        place(dom, { type: 'image',
          src: img.currentSrc || img.src || null, alt: img.alt || null,
          mediaId: cm ? +cm[1] : null });
      }
      var inner = dom.querySelector(':scope > .wp-block-cover__inner-container');
      if (inner) {
        if (innerRawText) walk(inner, innerRawText);
        else walkDomOnly(inner);
      }
    }
    var FREE_ATOMIC = /^(UL|OL|DL|TABLE|FORM|VIDEO|AUDIO|IFRAME|CANVAS|PRE|BLOCKQUOTE|PICTURE|SELECT|INPUT|TEXTAREA|NAV|DETAILS)$/;
    function hasDirectText(dom) {
      return [].some.call(dom.childNodes, function (n) {
        return n.nodeType === 3 && n.textContent.trim();
      });
    }
    function walkDomOnly(containerDom) {
      [].slice.call(containerDom.children).forEach(function (c) {
        var cl = c.classList;
        if (cl && cl.contains('gogh-pendbar')) return;
        var tag = c.tagName;
        if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'LINK' || tag === 'TEMPLATE') {
          if (tag === 'STYLE' && c.textContent.trim()) styleTexts.push(c.textContent);
          return;
        }
        if (cl.contains('wp-block-cover')) return coverInto(c, null);
        // a leaf TAG is never a container — a classless <h1> holding a
        // styling <span> must stay one heading, not be descended into
        // (which drops its bare text nodes)
        var leafTag = FREE_ATOMIC.test(tag) || /^(H[1-6]|P|IMG|A|BUTTON|FIGURE|SVG)$/i.test(tag);
        if (!leafTag) {
          if (cl.contains('wp-block-group') || cl.contains('wp-block-columns') ||
              cl.contains('wp-block-column') || !c.className) {
            if (c.children.length && !hasDirectText(c)) { boxFrom(c); return walkDomOnly(c); }
          }
          // arbitrary pasted HTML: containers descend by SHAPE, not class —
          // an element wrapping only other elements is layout, not content
          if ((c.className + '').indexOf('wp-block-') === -1 &&
              c.children.length && !hasDirectText(c)) {
            boxFrom(c);
            var fmC = freeMode;
            freeMode = true;
            walkDomOnly(c);
            freeMode = fmC;
            return;
          }
        }
        leafFrom(c, null);
      });
    }
    function walk(containerDom, rawText) {
      var spans = parseTopBlocks(rawText);
      var kids = [].slice.call(containerDom.children).filter(function (c) {
        if (c.classList && c.classList.contains('gogh-pendbar')) return false;
        // metadata children are never block output — counting them against
        // the markup spans breaks pairing (a preview box carries a <style>)
        var tg = c.tagName;
        return tg !== 'STYLE' && tg !== 'SCRIPT' && tg !== 'LINK' && tg !== 'TEMPLATE';
      });
      // a lone html block renders ALL these children (a paste's <style> +
      // content roots) — span↔child pairing is meaningless, free-walk them
      if (spans.length === 1 && kids.length &&
          String(spans[0].name || '').replace(/^core\//, '') === 'html') {
        var fmW = freeMode;
        freeMode = true;
        walkDomOnly(containerDom);
        freeMode = fmW;
        return;
      }
      if (!spans.length || spans.length !== kids.length) {
        if (opts.loose) { walkDomOnly(containerDom); return; }
        // strict (chrome): capture the container whole so its blocks stay
        // dynamic (menus, site titles) rather than becoming snapshots
        leafFrom(containerDom, rawText);
        return;
      }
      spans.forEach(function (sp, k) {
        var dom = kids[k];
        var markup = rawText.slice(sp.start, sp.end);
        var nm = String(sp.name || '').replace(/^core\//, '');
        if (nm === 'cover') {
          var cInner = innerRawOf(rawText, sp);
          return coverInto(dom, cInner ? cInner.text : null);
        }
        if (nm === 'html' && dom.children.length) {
          // raw HTML block: no inner block structure to pair — walk the DOM.
          // The root often paints the section's backdrop; keep it as a box.
          boxFrom(dom);
          var fmH = freeMode;
          freeMode = true;
          walkDomOnly(dom);
          freeMode = fmH;
          return;
        }
        if (nm === 'group' || nm === 'columns' || nm === 'column') {
          var inner = innerRawOf(rawText, sp);
          if (inner && dom.children.length) {
            var innerSpans = parseTopBlocks(inner.text);
            var innerKids = [].slice.call(dom.children).filter(function (c2) {
              return !(c2.classList && c2.classList.contains('gogh-pendbar'));
            });
            if (opts.loose || (innerSpans.length && innerSpans.length === innerKids.length)) {
              boxFrom(dom);
              walk(dom, inner.text);
              return;
            }
            // strict + unpaired children: atomize the whole group with its
            // FULL markup so attrs/layout survive — and no orphan box
            leafFrom(dom, markup);
            return;
          }
        }
        leafFrom(dom, markup);
      });
    }
    if (opts.rootIsBlock) {
      // the root element IS the block (converting one page block): pair it
      // with the whole markup instead of pairing its children
      var spans0 = parseTopBlocks(raw);
      var sp0 = spans0[0];
      var nm0 = sp0 ? String(sp0.name || '').replace(/^core\//, '') : '';
      if (nm0 === 'cover') {
        var cInner0 = innerRawOf(raw, sp0);
        coverInto(rootEl, cInner0 ? cInner0.text : null);
      } else if (nm0 === 'html' && rootEl.children.length) {
        boxFrom(rootEl);
        freeMode = true;
        walkDomOnly(rootEl);
        freeMode = !!opts.freeHtml;
      } else if ((nm0 === 'group' || nm0 === 'columns' || nm0 === 'column') && rootEl.children.length) {
        // root background lifts to the section, not a box — callers handle it
        var inner0 = innerRawOf(raw, sp0);
        if (inner0) walk(rootEl, inner0.text); else walkDomOnly(rootEl);
      } else {
        leafFrom(rootEl, raw);
      }
    } else {
      walk(rootEl, raw);
    }
    if (styleTexts.length) {
      // the paste's <style> rides with its first widget chunk so raw pieces
      // keep their look; converted text/images are the theme's business now
      var styleTag = '<style>' + styleTexts.join('\n') + '</style>';
      var carried = false;
      for (var wi = 0; wi < out.length; wi++) {
        if (out[wi].type === 'widget') {
          out[wi].whtml = styleTag + (out[wi].whtml || '');
          out[wi].wsrc = styleTag + (out[wi].wsrc || '');
          carried = true;
          break;
        }
      }
      if (!carried &&
        /:{1,2}(hover|focus|active|before|after)|@media|@keyframes|@font-face|@supports/.test(styleTexts.join(''))) {
        // fully-atomized pastes dropped their stylesheet on the floor. The
        // STATIC rules are already captured per-element from computed style;
        // only dynamic/conditional rules (hover, pseudo, media, font-face)
        // genuinely need the sheet — those get a tiny carrier widget.
        out.push({ type: 'widget', x: 0, y: 0, w: 24, h: 16,
          whtml: styleTag, wsrc: styleTag });
      }
    }
    var minH = Math.round(rr.height * sx);
    // a backdrop box that covers the whole section becomes the SECTION's
    // background instead: a box has the measured height, but the rendered
    // section can end up taller (text metrics, viewport units) — and the
    // page background bleeding through the difference reads as a gap
    // between dark sections. The section's own bg stretches with it.
    var rootBg = null;
    if (out.length && out[0].type === 'box' &&
        out[0].x <= 6 && out[0].y <= 6 && out[0].w >= W - 12 &&
        out[0].h >= minH - Math.max(12, minH * 0.04)) {
      rootBg = out[0].boxBg || null;
      // boxBg may be a palette slug — as a section bg it must be real CSS
      if (rootBg && /^[a-z0-9-]+$/.test(rootBg)) rootBg = 'var(--wp--preset--color--' + rootBg + ')';
      out.shift();
    }
    return { els: out, minH: minH, rootBg: rootBg };
  }

  function doConvertChrome(partEl, area, part, scanRoot) {
    return Promise.resolve().then(function () {
      var raw = (part.content && part.content.raw) || '';
      // converting a PREVIEWED look scans the preview box: partEl's other
      // children are the hidden originals and would wreck span pairing
      var scanEl = scanRoot || partEl;
      var rr = scanEl.getBoundingClientRect();
      var sx = W / rr.width;
      var chromeScan = scanDomWithRaw(scanEl, raw);
      var out = chromeScan.els;
      if (!out.length) throw new Error('Nothing to edit in this ' + area + '.');
      var sec = newSectionShell('gogh-sec-' + (scopeSeq++));
      sec.els = out;
      sec.minH = Math.round(rr.height * sx);
      sec.chrome = { area: area, id: part.id };
      if (chromeScan.rootBg) sec.bg = chromeScan.rootBg;
      var bgc = getComputedStyle(partEl).backgroundColor;
      if (!sec.bg && bgc && bgc !== 'rgba(0, 0, 0, 0)' && bgc !== 'transparent') sec.bg = bgc;
      // hide the live chrome, mount the canvas in its place (tracked on the
      // part element so undo/redo can restore visibility)
      partEl.__goghHidden = [].slice.call(partEl.children);
      partEl.__goghHidden.forEach(function (c) { c.style.display = 'none'; });
      partEl.appendChild(sec.wrapEl);
      if (area === 'header') { S.unshift(sec); } else { S.push(sec); }
      renderSection(sec);
      sel = null;
      hideHandles();
      pushState();
      placeChromeBtns();
      toast('Editing the site ' + area + ' \u2014 publishing will update every page.', { ttl: 6000 });
      return sec;
    });
  }
  // ---------- drag the site menu into a new order ----------
  // top-level nav links in a (non-freeform) header or footer are draggable
  // while editing; the new order is written back to the WordPress menu, so
  // every page gets it.
  var navDrag = null;
  // ---------- menu manager: structured model of a navigation post ----------
  // One level of nesting only. Unchanged items keep their original bytes;
  // structural conversions (link <-> submenu) reuse the item's attrs JSON
  // verbatim so ids/kinds/opensInNewTab survive untouched.
  function parseNavModel(nraw) {
    return parseTopBlocks(nraw).map(function (sp) {
      var text = nraw.slice(sp.start, sp.end);
      var name = sp.name || '';
      var openEnd = text.indexOf('-->');
      var head = openEnd === -1 ? text : text.slice(0, openEnd);
      var jm = head.match(/\{[\s\S]*\}/);
      var attrs = {};
      var attrsText = jm ? jm[0] : null;
      try { attrs = attrsText ? JSON.parse(attrsText) : {}; } catch (err) { attrs = {}; attrsText = null; }
      var it = {
        name: name, text: text,
        attrsText: attrsText, attrs: attrs,
        label: attrs.label || '', url: attrs.url || '',
        kind: attrs.kind || null, children: null,
      };
      if (name.indexOf('navigation-submenu') !== -1 && openEnd !== -1) {
        var closeAt = text.lastIndexOf('<!--');
        var inner = closeAt > openEnd ? text.slice(openEnd + 3, closeAt) : '';
        it.children = parseTopBlocks(inner).map(function (cs) {
          var ct = inner.slice(cs.start, cs.end);
          var chead = ct.slice(0, ct.indexOf('-->'));
          var cjm = chead.match(/\{[\s\S]*\}/);
          var cat = {};
          try { cat = cjm ? JSON.parse(cjm[0]) : {}; } catch (e2) {}
          return { name: cs.name || '', text: ct, attrsText: cjm ? cjm[0] : null,
            attrs: cat, label: cat.label || '', url: cat.url || '',
            kind: cat.kind || null, children: null };
        });
      }
      return it;
    });
  }
  function navAttrsText(it) {
    if (it.attrsText) return it.attrsText;
    var a = { label: it.label || '', url: it.url || '#' };
    if (it.kind) a.kind = it.kind;
    return JSON.stringify(a).replace(/</g, '\\u003c');
  }
  function serializeNavModel(items) {
    return items.map(function (it) {
      if (it.children && it.children.length) {
        return '<!-- wp:navigation-submenu ' + navAttrsText(it) + ' -->\n' +
          it.children.map(function (c) { return serializeNavLeaf(c); }).join('\n') +
          '\n<!-- /wp:navigation-submenu -->';
      }
      return serializeNavLeaf(it);
    }).join('\n');
  }
  function serializeNavLeaf(it) {
    // an untouched plain link keeps its exact stored bytes
    if (it.text && it.name.indexOf('navigation-link') !== -1 && !it.dirty) return it.text;
    return '<!-- wp:navigation-link ' + navAttrsText(it) + ' /-->';
  }

  function navItemsOf(list) {
    return [].slice.call(list.children).filter(function (c) {
      return c.classList && c.classList.contains('wp-block-navigation-item');
    });
  }
  function reorderNavRaw(nraw, items) {
    var spans = parseTopBlocks(nraw);
    if (spans.length && spans.every(function (sp) { return (sp.name || '').indexOf('page-list') !== -1; })) {
      // an automatic page list has no order of its own: pin it down as
      // explicit links in the order the user just made (Gutenberg does the
      // same the moment you customise the list)
      return items.map(function (it) {
        return '<!-- wp:navigation-link {"label":' + JSON.stringify(it.label) + ',"url":' + JSON.stringify(it.href || '#') + ',"kind":"post-type"} /-->';
      }).join('\n');
    }
    var pool = spans.map(function (sp) {
      return { text: nraw.slice(sp.start, sp.end), used: false };
    });
    var ordered = [];
    var pathOf = function (t) {
      var um = t.match(/"url":"((?:[^"\\]|\\.)*)"/);
      if (!um) return null;
      var u = JSON.parse('"' + um[1] + '"');
      return u.replace(/^https?:\/\/[^\/]+/, '').replace(/\/$/, '') || '/';
    };
    var labelOf = function (t) {
      var lm = t.match(/"label":"((?:[^"\\]|\\.)*)"/);
      return lm ? JSON.parse('"' + lm[1] + '"').trim() : null;
    };
    items.forEach(function (it) {
      if (!ordered) return;
      var hit = null;
      for (var j = 0; j < pool.length && !hit; j++) {
        if (!pool[j].used && it.path != null && pathOf(pool[j].text) === it.path) hit = pool[j];
      }
      for (j = 0; j < pool.length && !hit; j++) {
        if (!pool[j].used && it.label && labelOf(pool[j].text) === it.label) hit = pool[j];
      }
      if (!hit) { ordered = null; return; }
      hit.used = true;
      ordered.push(hit.text);
    });
    if (!ordered) return null;
    pool.forEach(function (p) { if (!p.used) ordered.push(p.text); });
    return ordered.join('\n');
  }
  function saveNavOrder(partEl, listEl) {
    var area = partEl.tagName === 'FOOTER' ? 'footer' : 'header';
    var items = navItemsOf(listEl).map(function (li) {
      var a = li.querySelector('a');
      var path = null;
      if (a && a.href) {
        try { path = new URL(a.href, location.href).pathname.replace(/\/$/, '') || '/'; } catch (err) {}
      }
      return { label: navItemLabel(li), path: path, href: a ? a.getAttribute('href') : null };
    });
    var hdrs = { 'X-WP-Nonce': cfg.nonce, 'Content-Type': 'application/json' };
    return fetch(restQ(tpUrl(), 'area=' + area + '&context=edit'), {
      headers: { 'X-WP-Nonce': cfg.nonce },
      credentials: 'same-origin',
    }).then(function (r) { return r.ok ? r.json() : []; }).then(function (parts) {
      var active = null;
      (parts || []).forEach(function (p) {
        if (!active && p.slug === area && (!p.theme || p.theme === cfg.theme)) active = p;
      });
      if (!active) throw new Error('no part');
      var praw = (active.content && (active.content.raw || active.content)) || '';
      var refM = String(praw).match(/wp:navigation[^>]*"ref":(\d+)/);
      if (refM) {
        var navId = +refM[1];
        return fetch(restQ(GSROOT + 'navigation/' + navId, 'context=edit'), {
          headers: { 'X-WP-Nonce': cfg.nonce },
          credentials: 'same-origin',
        }).then(function (r) { if (!r.ok) throw new Error('nav'); return r.json(); }).then(function (nav) {
          var nraw = (nav.content && nav.content.raw) || '';
          var next = reorderNavRaw(nraw, items);
          if (next == null) throw new Error('map');
          return fetch(GSROOT + 'navigation/' + navId, {
            method: 'POST', headers: hdrs, credentials: 'same-origin',
            body: JSON.stringify({ content: next }),
          }).then(function (r) { if (!r.ok) throw new Error('save'); });
        });
      }
      // no ref: a bare wp:navigation renders the newest menu post, or the
      // page list when none exists. Reorder that post \u2014 or mint one.
      return fetch(restQ(GSROOT + 'navigation', 'context=edit&per_page=1'), {
        headers: { 'X-WP-Nonce': cfg.nonce },
        credentials: 'same-origin',
      }).then(function (r) { return r.ok ? r.json() : []; }).then(function (navs) {
        var nav = (navs || [])[0];
        if (nav) {
          var nraw = (nav.content && nav.content.raw) || '';
          var next2 = reorderNavRaw(nraw, items);
          if (next2 == null) throw new Error('map');
          return fetch(GSROOT + 'navigation/' + nav.id, {
            method: 'POST', headers: hdrs, credentials: 'same-origin',
            body: JSON.stringify({ content: next2 }),
          }).then(function (r) { if (!r.ok) throw new Error('save'); });
        }
        // page-list fallback: pin it down as an explicit menu in this order
        var links = items.map(function (it) {
          return '<!-- wp:navigation-link {"label":' + JSON.stringify(it.label) + ',"url":' + JSON.stringify(it.href || '#') + ',"kind":"post-type"} /-->';
        }).join('\n');
        return fetch(GSROOT + 'navigation', {
          method: 'POST', headers: hdrs, credentials: 'same-origin',
          body: JSON.stringify({ title: 'Navigation', status: 'publish', content: links }),
        }).then(function (r) { if (!r.ok) throw new Error('save'); });
      });
    });
  }
  document.addEventListener('pointerdown', function (ev) {
    if (!editing || navDrag) return;
    if (ev.button !== 0) return;
    if (ev.target.closest && ev.target.closest('.gogh-navrm, .gogh-navadd')) return;
    var item = ev.target.closest ? ev.target.closest('.wp-block-navigation-item') : null;
    if (!item) return;
    if (item.parentElement.closest('.wp-block-navigation-item')) return; // submenu: leave alone
    if (ev.target.closest('.gogh-wrap')) return; // freeform canvas has its own physics
    var parts = chromePartEls();
    var partEl = null;
    for (var i = 0; i < parts.length; i++) if (parts[i].contains(item)) partEl = parts[i];
    if (!partEl) return;
    ev.preventDefault();
    navDrag = { item: item, list: item.parentElement, partEl: partEl,
      startX: ev.clientX, startY: ev.clientY, started: false,
      order0: navItemsOf(item.parentElement) };
  }, true);
  document.addEventListener('pointermove', function (ev) {
    if (!navDrag) return;
    if (!navDrag.started) {
      if (Math.hypot(ev.clientX - navDrag.startX, ev.clientY - navDrag.startY) < 5) return;
      navDrag.started = true;
      navDrag.item.classList.add('gogh-navdragging');
    }
    var sibs = navItemsOf(navDrag.list).filter(function (s) { return s !== navDrag.item; });
    if (!sibs.length) return;
    var r0 = sibs[0].getBoundingClientRect();
    var r1 = sibs[sibs.length - 1].getBoundingClientRect();
    var horiz = Math.abs(r1.left - r0.left) >= Math.abs(r1.top - r0.top);
    var before = null;
    for (var i = 0; i < sibs.length; i++) {
      var r = sibs[i].getBoundingClientRect();
      var c = horiz ? r.left + r.width / 2 : r.top + r.height / 2;
      if ((horiz ? ev.clientX : ev.clientY) < c) { before = sibs[i]; break; }
    }
    if (before === null) {
      if (navDrag.item.nextElementSibling) navDrag.list.appendChild(navDrag.item);
    } else if (before !== navDrag.item && before !== navDrag.item.nextElementSibling) {
      navDrag.list.insertBefore(navDrag.item, before);
    }
  });
  document.addEventListener('pointercancel', function () {
    // abandon, don't commit: half-done gestures must not save
    if (navDrag) {
      if (navDrag.started) {
        navDrag.item.classList.remove('gogh-navdragging');
        navDrag.order0.forEach(function (li) { navDrag.list.appendChild(li); });
      }
      navDrag = null;
    }
  });
  document.addEventListener('pointerup', function () {
    if (!navDrag) return;
    var d = navDrag;
    navDrag = null;
    if (!d.started) return;
    d.item.classList.remove('gogh-navdragging');
    var now = navItemsOf(d.list);
    var same = now.length === d.order0.length && now.every(function (n, i) { return n === d.order0[i]; });
    if (same) return;
    saveNavOrder(d.partEl, d.list).then(function () {
      toast('Menu order updated \u2014 every page gets it.', { ttl: 4500 });
    }).catch(function () {
      // put the menu back the way it was
      d.order0.forEach(function (li) { d.list.appendChild(li); });
      toast('gogh couldn\u2019t save that menu order.', { error: true });
    });
  });

  // ---------- light chrome editing: text, links and menus in the
  // header/footer, no freeform required ----------
  var chromeLightEdits = [];
  function activePartFor(area) {
    return fetch(restQ(tpUrl(), 'area=' + encodeURIComponent(area) + '&context=edit'), {
      headers: { 'X-WP-Nonce': cfg.nonce },
      credentials: 'same-origin',
    }).then(function (r) { return r.ok ? r.json() : []; }).then(function (parts) {
      var active = null;
      (parts || []).forEach(function (p) {
        if (!active && p.slug === area && (!p.theme || p.theme === cfg.theme)) active = p;
      });
      return active;
    });
  }
  function initChromeLightEdits() {
    ['header', 'footer'].forEach(function (area) {
      var partEl = partElForArea(area);
      if (!partEl || partEl.querySelector('.gogh-wrap')) return;
      activePartFor(area).then(function (active) {
        if (!active) return;
        var raw = (active.content && active.content.raw) || '';
        var entry = partEl.__goghChromeEntry;
        if (!entry) {
          entry = { el: partEl, chromePart: true, title: 'Site ' + area };
          partEl.__goghChromeEntry = entry;
          chromeLightEdits.push(entry);
        }
        entry.partId = active.id;
        entry.raw = raw;
        entry.savedRaw = raw;
        bindPending(entry);
        partEl.classList.add('gogh-lightedit');
        placeNavAdders(partEl);
      }).catch(function () {});
    });
  }
  function logoRawWithWidth(praw, w) {
    return praw.replace(/<!--\s*wp:site-logo(\s+\{[^]*?\})?\s*\/-->/, function (m0, json) {
      var attrs = {};
      if (json) { try { attrs = JSON.parse(json.trim()); } catch (e) { attrs = {}; } }
      attrs.width = w;
      return '<!-- wp:site-logo ' + JSON.stringify(attrs) + ' /-->';
    });
  }
  function logoizeHeaderRaw(praw) {
    // one identity only: a header shows the logo OR the text title, never
    // both. Returns null (nothing to swap), '' (already right), or new raw.
    var next = praw;
    if (praw.indexOf('wp:site-logo') === -1) {
      next = next.replace(/<!--\s*wp:site-title(\s+\{[^]*?\})?\s*\/-->/, function (m0, json) {
        // a centred title begets a centred logo — alignment is part of the
        // layout's design, not the block's
        var t = {};
        if (json) { try { t = JSON.parse(json.trim()); } catch (e) { t = {}; } }
        var attrs = { width: 160, shouldSyncIcon: false };
        if (t.textAlign === 'center' || t.align === 'center') attrs.align = 'center';
        return '<!-- wp:site-logo ' + JSON.stringify(attrs) + ' /-->';
      });
      if (next === praw) return null;
      return next;
    }
    if (!/wp:site-logo\s+\{[^]*?"width"/.test(next)) next = logoRawWithWidth(next, 160);
    next = next.replace(/<!--\s*wp:site-title(\s+\{[^]*?\})?\s*\/-->\s*/, '');
    return next === praw ? '' : next;
  }
  function saveLogoWidth(w) {
    return activePartFor('header').then(function (active) {
      if (!active) return;
      var praw = String((active.content && (active.content.raw || active.content)) || '');
      if (praw.indexOf('wp:site-logo') === -1) return;
      var next = logoRawWithWidth(praw, w);
      if (next === praw) return;
      return fetch(tpUrl(active.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
        credentials: 'same-origin',
        body: JSON.stringify({ content: next }),
      });
    }).catch(function () {});
  }
  function openLogoPicker(anchorEl) {
    placePanelNear(anchorEl);
    var logoImgs = [].slice.call(document.querySelectorAll('header .wp-block-site-logo img, .wp-block-template-part .wp-block-site-logo img'));
    panel.innerHTML =
      '<div class="gogh-panel-title">Site logo</div>' +
      '<em class="gogh-panel-hint">Pick or upload an image \u2014 it replaces the text title in your header.</em>' +
      (logoImgs.length ?
        '<div class="gogh-panel-row gogh-logosize"><span>Size</span>' +
        '<input type="range" min="48" max="280" step="4" />' +
        '<span class="gogh-logosize-val"></span></div>' +
        '<button type="button" class="gogh-btn gogh-btn-small gogh-logo-totext">Use a text title instead</button>' : '') +
      '<label class="gogh-btn gogh-btn-small gogh-upload">Upload image<input type="file" accept="image/*" hidden /></label>' +
      '<div class="gogh-media"><span class="gogh-media-loading">Loading media\u2026</span></div>';
    panel.hidden = false;
    panelOpen = true;
    var toText = panel.querySelector('.gogh-logo-totext');
    if (toText) toText.addEventListener('click', function () {
      toText.disabled = true;
      activePartFor('header').then(function (active) {
        if (!active) throw new Error('no header found');
        var praw = String((active.content && (active.content.raw || active.content)) || '');
        var next = praw.replace(/<!--\s*wp:site-logo(\s+\{[^]*?\})?\s*\/-->/, function (m0, json) {
          // alignment belongs to the layout — a centred logo begets a
          // centred title on the way back too
          var lg = {};
          if (json) { try { lg = JSON.parse(json.trim()); } catch (e) { lg = {}; } }
          var attrs = { level: 0 };
          if (lg.align === 'center') attrs.textAlign = 'center';
          return '<!-- wp:site-title ' + JSON.stringify(attrs) + ' /-->';
        });
        if (next === praw) throw new Error('no logo block to swap');
        return fetch(tpUrl(active.id), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
          credentials: 'same-origin',
          body: JSON.stringify({ content: next }),
        });
      }).then(function (r) {
        if (r && !r.ok) throw new Error('the header did not save');
        closePanel();
        var pe = partElForArea('header');
        return pe ? refreshChromePart(pe) : null;
      }).then(function () {
        toast('Text title restored \u2014 click it to rename your site.');
      }).catch(function (err) {
        toText.disabled = false;
        toast('gogh could not switch back \u2014 ' + ((err && err.message) || 'try again.'), { error: true });
      });
    });
    var sizeIn = panel.querySelector('.gogh-logosize input');
    if (sizeIn) {
      var sizeVal = panel.querySelector('.gogh-logosize-val');
      var cur = Math.round(logoImgs[0].getBoundingClientRect().width) || 160;
      sizeIn.value = Math.max(48, Math.min(280, cur));
      sizeVal.textContent = sizeIn.value + 'px';
      sizeIn.addEventListener('input', function () {
        sizeVal.textContent = sizeIn.value + 'px';
        logoImgs.forEach(function (im) {
          im.style.width = sizeIn.value + 'px';
          im.style.height = 'auto';
        });
      });
      sizeIn.addEventListener('change', function () {
        saveLogoWidth(parseInt(sizeIn.value, 10)).then(function () {
          toast('Logo size saved.');
        });
      });
    }
    var busy = false;
    function useLogo(id) {
      if (busy) return;
      busy = true;
      fetch(GSROOT + 'settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
        credentials: 'same-origin',
        body: JSON.stringify({ site_logo: id }),
      }).then(function (r) {
        if (!r.ok) throw new Error('saving needs an admin login');
        return activePartFor('header');
      }).then(function (active) {
        if (!active) return null;
        var praw = String((active.content && (active.content.raw || active.content)) || '');
        var next = logoizeHeaderRaw(praw);
        if (next === null) throw new Error('this header has no title block to swap');
        if (next === '') return null;
        return fetch(tpUrl(active.id), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
          credentials: 'same-origin',
          body: JSON.stringify({ content: next }),
        }).then(function (r2) {
          if (!r2.ok) throw new Error('the header did not save');
        });
      }).then(function () {
        closePanel();
        var pe = partElForArea('header');
        return pe ? refreshChromePart(pe) : null;
      }).then(function () {
        toast('Logo set \u2014 your image now leads the header.');
      }).catch(function (err) {
        busy = false;
        toast('gogh could not set the logo \u2014 ' + ((err && err.message) || 'try again.'), { error: true });
      });
    }
    fetch(restQ(cfg.mediaUrl, 'per_page=12&media_type=image&orderby=date&order=desc'), {
      headers: { 'X-WP-Nonce': cfg.nonce },
      credentials: 'same-origin',
    }).then(function (res) { return res.ok ? res.json() : []; }).catch(function () { return []; }).then(function (items) {
      var box = panel.querySelector('.gogh-media');
      if (!box || panel.hidden) return;
      box.innerHTML = '';
      items.forEach(function (item) {
        var thumb = (item.media_details && item.media_details.sizes &&
          (item.media_details.sizes.thumbnail || item.media_details.sizes.medium));
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'gogh-thumb';
        b.style.backgroundImage = 'url("' + (thumb ? thumb.source_url : item.source_url) + '")';
        b.addEventListener('click', function () { useLogo(item.id); });
        box.appendChild(b);
      });
      reclampPanel();
    });
    var bfile = panel.querySelector('.gogh-upload input[type="file"]');
    bfile.addEventListener('change', function () {
      if (!bfile.files.length) return;
      var fd = new FormData();
      fd.append('file', bfile.files[0]);
      panel.querySelector('.gogh-upload').firstChild.textContent = 'Uploading\u2026';
      fetch(cfg.mediaUrl, {
        method: 'POST',
        headers: { 'X-WP-Nonce': cfg.nonce },
        credentials: 'same-origin',
        body: fd,
      }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function (item) { useLogo(item.id); }).catch(function () {
        panel.querySelector('.gogh-upload').firstChild.textContent = 'Upload failed';
      });
    });
  }
  function editSiteTitle(sttEl) {
    var leaf = sttEl.querySelector('a') || sttEl;
    if (leaf.getAttribute('contenteditable') === 'true') return;
    var orig = (leaf.textContent || '').trim();
    var setEverywhere = function (name) {
      [].slice.call(document.querySelectorAll('.wp-block-site-title')).forEach(function (el) {
        var lf = el.querySelector('a') || el;
        lf.textContent = name;
      });
    };
    var save = function (name, then) {
      return fetch(GSROOT + 'settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
        credentials: 'same-origin',
        body: JSON.stringify({ title: name }),
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        if (then) then();
      });
    };
    leaf.setAttribute('contenteditable', 'true');
    document.documentElement.classList.add('gogh-textediting');
    leaf.focus();
    // renaming is usually wholesale — start with everything selected
    var rng = document.createRange();
    rng.selectNodeContents(leaf);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(rng);
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'gogh-logochip';
    chip.textContent = 'Use a logo image instead';
    var sr = sttEl.getBoundingClientRect();
    chip.style.left = (sr.left + window.scrollX) + 'px';
    chip.style.top = (sr.bottom + window.scrollY + 8) + 'px';
    // a real pointerdown on the chip blurs the leaf BEFORE mousedown even
    // lands — onBlur removes the chip mid-gesture and the click never
    // arrives. Act on pointerdown itself, and stop it reaching the
    // document-level closer that would shut the panel we just opened.
    chip.addEventListener('pointerdown', function (ev3) {
      ev3.preventDefault();
      ev3.stopPropagation();
      leaf.textContent = orig;
      leaf.blur();
      openLogoPicker(sttEl);
    });
    document.body.appendChild(chip);
    var onKey = function (ev2) {
      if (ev2.key === 'Enter') { ev2.preventDefault(); leaf.blur(); }
      else if (ev2.key === 'Escape') { leaf.textContent = orig; leaf.blur(); }
      ev2.stopPropagation();
    };
    var onBlur = function () {
      chip.remove();
      leaf.removeEventListener('keydown', onKey);
      leaf.removeEventListener('blur', onBlur);
      leaf.removeAttribute('contenteditable');
      document.documentElement.classList.remove('gogh-textediting');
      var next = (leaf.textContent || '').replace(/\s+/g, ' ').trim();
      if (!next || next === orig) { setEverywhere(orig); return; }
      save(next, function () {
        setEverywhere(next);
        toast('Your site is now called \u201c' + next + '\u201d \u2014 it shows everywhere.', {
          actions: [{ label: 'Undo', onClick: function () {
            save(orig, function () { setEverywhere(orig); }).catch(function () {});
          } }],
        });
      }).catch(function () {
        setEverywhere(orig);
        toast('gogh could not rename the site \u2014 that needs an admin login.', { error: true });
      });
    };
    leaf.addEventListener('keydown', onKey);
    leaf.addEventListener('blur', onBlur);
  }
  function saveChromeEntry(entry) {
    if (!entry || entry.savedRaw == null || entry.raw === entry.savedRaw) return Promise.resolve();
    return fetch(tpUrl(entry.partId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce },
      credentials: 'same-origin',
      body: JSON.stringify({ content: entry.raw }),
    }).then(function (r) {
      if (!r.ok) throw new Error('could not save the ' + entry.title);
      entry.savedRaw = entry.raw;
    });
  }
  function navItemLabel(li) {
    var a = li.querySelector('a');
    return ((a ? a.textContent : li.textContent) || '').trim();
  }
  function placeNavAdders(partEl) {
    [].slice.call(partEl.querySelectorAll('.wp-block-navigation__container')).forEach(function (list) {
      if (list.closest('.wp-block-navigation-item')) return; // submenus: no
      if (list.querySelector(':scope > .gogh-navadd')) return;
      var li = document.createElement('li');
      li.className = 'gogh-navadd';
      li.innerHTML = '<button type="button" title="Add a page to this menu">+</button>';
      li.querySelector('button').addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        openNavAddPanel(partEl, list, li);
      });
      list.appendChild(li);
      var mg = document.createElement('li');
      mg.className = 'gogh-navadd gogh-navmanage';
      mg.innerHTML = '<button type="button" title="Manage this menu \u2014 reorder, nest, swap menus">\u22ef</button>';
      mg.querySelector('button').addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        openMenuManager(partEl, mg);
      });
      list.appendChild(mg);
    });
    // every top-level item gets a hover ✕ to leave the menu
    [].slice.call(partEl.querySelectorAll('.wp-block-navigation-item')).forEach(function (li) {
      if (li.parentElement.closest('.wp-block-navigation-item')) return;
      if (li.querySelector(':scope > .gogh-navrm')) return;
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'gogh-navrm';
      x.title = 'Remove from menu';
      x.textContent = '✕';
      x.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        removeNavItem(partEl, li);
      });
      li.appendChild(x);
    });
  }
  function resolveNavTarget(partEl) {
    var area = partEl.tagName === 'FOOTER' ? 'footer' : 'header';
    return activePartFor(area).then(function (active) {
      if (!active) throw new Error('no ' + area + ' part');
      var praw = String((active.content && (active.content.raw || active.content)) || '');
      var refM = praw.match(/wp:navigation[^>]*"ref":(\d+)/);
      if (refM) return +refM[1];
      return fetch(restQ(GSROOT + 'navigation', 'context=edit&per_page=1'), {
        headers: { 'X-WP-Nonce': cfg.nonce }, credentials: 'same-origin',
      }).then(function (r) { return r.ok ? r.json() : []; })
        .then(function (navs) { return navs && navs[0] ? navs[0].id : null; });
    });
  }
  function saveNavRemove(partEl, listEl, li) {
    var hdrs = { 'X-WP-Nonce': cfg.nonce, 'Content-Type': 'application/json' };
    var a = li.querySelector('a');
    var path = null;
    if (a && a.href) {
      try { path = new URL(a.href, location.href).pathname.replace(/\/$/, '') || '/'; } catch (e2) {}
    }
    var label = navItemLabel(li);
    var restLinks = function () {
      return navItemsOf(listEl).filter(function (x) { return x !== li; }).map(function (it) {
        var ia = it.querySelector('a');
        return '<!-- wp:navigation-link {"label":' + JSON.stringify(navItemLabel(it)) +
          ',"url":' + JSON.stringify(ia ? ia.getAttribute('href') : '#') + ',"kind":"post-type"} /-->';
      }).join('\n');
    };
    return resolveNavTarget(partEl).then(function (navId) {
      if (navId == null) {
        return fetch(GSROOT + 'navigation', {
          method: 'POST', headers: hdrs, credentials: 'same-origin',
          body: JSON.stringify({ title: 'Navigation', status: 'publish', content: restLinks() }),
        }).then(function (r) { if (!r.ok) throw new Error('save'); return { navId: null }; });
      }
      return fetch(restQ(GSROOT + 'navigation/' + navId, 'context=edit'), {
        headers: { 'X-WP-Nonce': cfg.nonce }, credentials: 'same-origin',
      }).then(function (r) { if (!r.ok) throw new Error('nav'); return r.json(); })
        .then(function (nav) {
          var nraw = ((nav.content && nav.content.raw) || '').trim();
          var spans = parseTopBlocks(nraw);
          if (!spans.length || spans.every(function (sp) { return (sp.name || '').indexOf('page-list') !== -1; })) {
            // automatic list: pin everything EXCEPT the removed item
            return fetch(GSROOT + 'navigation/' + navId, {
              method: 'POST', headers: hdrs, credentials: 'same-origin',
              body: JSON.stringify({ content: restLinks() }),
            }).then(function (r) { if (!r.ok) throw new Error('save'); return { navId: navId }; });
          }
          var pathOf = function (t) {
            var um = t.match(/"url":"((?:[^"\\]|\\.)*)"/);
            if (!um) return null;
            var u = JSON.parse('"' + um[1] + '"');
            return u.replace(/^https?:\/\/[^\/]+/, '').replace(/\/$/, '') || '/';
          };
          var labelOf = function (t) {
            var lm = t.match(/"label":"((?:[^"\\]|\\.)*)"/);
            return lm ? JSON.parse('"' + lm[1] + '"').trim() : null;
          };
          var hit = null;
          for (var j = 0; j < spans.length && !hit; j++) {
            var t = nraw.slice(spans[j].start, spans[j].end);
            if (path != null && pathOf(t) === path) hit = spans[j];
          }
          for (j = 0; j < spans.length && !hit; j++) {
            var t2 = nraw.slice(spans[j].start, spans[j].end);
            if (label && labelOf(t2) === label) hit = spans[j];
          }
          if (!hit) throw new Error('gogh couldn’t match that item in the menu');
          var removed = nraw.slice(hit.start, hit.end);
          var next = (nraw.slice(0, hit.start) + nraw.slice(hit.end)).replace(/\n{3,}/g, '\n\n').trim();
          return fetch(GSROOT + 'navigation/' + navId, {
            method: 'POST', headers: hdrs, credentials: 'same-origin',
            body: JSON.stringify({ content: next }),
          }).then(function (r) {
            if (!r.ok) throw new Error('save');
            return { navId: navId, removed: removed };
          });
        });
    });
  }
  function removeNavItem(partEl, li) {
    var label = navItemLabel(li);
    li.style.opacity = '0.35';
    var entry = partEl.__goghChromeEntry;
    saveChromeEntry(entry).then(function () {
      return saveNavRemove(partEl, li.parentElement, li);
    }).then(function (info) {
      var actions = [];
      if (info && info.navId != null && info.removed) {
        actions.push({
          label: 'Put it back',
          onClick: function () {
            fetch(restQ(GSROOT + 'navigation/' + info.navId, 'context=edit'), {
              headers: { 'X-WP-Nonce': cfg.nonce }, credentials: 'same-origin',
            }).then(function (r) { return r.json(); }).then(function (nav) {
              var nraw = ((nav.content && nav.content.raw) || '').trim();
              return fetch(GSROOT + 'navigation/' + info.navId, {
                method: 'POST',
                headers: { 'X-WP-Nonce': cfg.nonce, 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ content: (nraw ? nraw + '\n' : '') + info.removed }),
              });
            }).then(function (r) {
              if (r && !r.ok) throw new Error('restore');
              return refreshChromePart(partEl);
            }).then(function () {
              toast('“' + label + '” is back in the menu.');
            }).catch(function () {
              toast('gogh couldn’t restore it.', { error: true });
            });
          },
        });
      }
      toast('“' + label + '” removed from the menu — every page gets it.', { ttl: 7000, actions: actions });
      return refreshChromePart(partEl);
    }).catch(function (err) {
      li.style.opacity = '';
      toast((err && err.message) || 'gogh couldn’t remove that item.', { error: true });
    });
  }
  function navLinkMarkup(page) {
    var title = (page.title && page.title.rendered ? page.title.rendered.replace(/<[^>]+>/g, '') : 'Page');
    return '<!-- wp:navigation-link {"label":' + JSON.stringify(title) +
      ',"type":"page","id":' + (+page.id || 0) +
      ',"url":' + JSON.stringify(page.link || '#') + ',"kind":"post-type"} /-->';
  }
  function domNavLinks(listEl) {
    return navItemsOf(listEl).map(function (li) {
      var a = li.querySelector('a');
      return '<!-- wp:navigation-link {"label":' + JSON.stringify(navItemLabel(li)) +
        ',"url":' + JSON.stringify(a ? a.getAttribute('href') : '#') + ',"kind":"post-type"} /-->';
    });
  }
  function saveNavAppend(partEl, listEl, page) {
    var area = partEl.tagName === 'FOOTER' ? 'footer' : 'header';
    var hdrs = { 'X-WP-Nonce': cfg.nonce, 'Content-Type': 'application/json' };
    var link = navLinkMarkup(page);
    return activePartFor(area).then(function (active) {
      if (!active) throw new Error('no ' + area + ' part');
      var praw = (active.content && (active.content.raw || active.content)) || '';
      var refM = String(praw).match(/wp:navigation[^>]*"ref":(\d+)/);
      var target = refM ? Promise.resolve(+refM[1])
        : fetch(restQ(GSROOT + 'navigation', 'context=edit&per_page=1'), {
            headers: { 'X-WP-Nonce': cfg.nonce }, credentials: 'same-origin',
          }).then(function (r) { return r.ok ? r.json() : []; })
            .then(function (navs) { return navs && navs[0] ? navs[0].id : null; });
      return target.then(function (navId) {
        if (navId == null) {
          // no menu post anywhere: mint one from what's rendered + the page
          return fetch(GSROOT + 'navigation', {
            method: 'POST', headers: hdrs, credentials: 'same-origin',
            body: JSON.stringify({ title: 'Navigation', status: 'publish',
              content: domNavLinks(listEl).concat([link]).join('\n') }),
          }).then(function (r) { if (!r.ok) throw new Error('save'); });
        }
        return fetch(restQ(GSROOT + 'navigation/' + navId, 'context=edit'), {
          headers: { 'X-WP-Nonce': cfg.nonce }, credentials: 'same-origin',
        }).then(function (r) { if (!r.ok) throw new Error('nav'); return r.json(); })
          .then(function (nav) {
            var nraw = ((nav.content && nav.content.raw) || '').trim();
            // an automatic page list shows everything already — pin it as
            // explicit links so the menu becomes deliberate
            if (parseTopBlocks(nraw).every(function (sp) { return (sp.name || '').indexOf('page-list') !== -1; })) {
              nraw = domNavLinks(listEl).join('\n');
            }
            return fetch(GSROOT + 'navigation/' + navId, {
              method: 'POST', headers: hdrs, credentials: 'same-origin',
              body: JSON.stringify({ content: (nraw ? nraw + '\n' : '') + link }),
            }).then(function (r) { if (!r.ok) throw new Error('save'); });
          });
      });
    });
  }
  function refreshChromePart(partEl) {
    var area = partEl.tagName === 'FOOTER' ? 'footer' : 'header';
    return activePartFor(area).then(function (active) {
      if (!active) return;
      var raw = (active.content && active.content.raw) || '';
      return renderChromeOption({ content: raw }).then(function (d) {
        if (!d) return;
        partEl.innerHTML = (d.css ? '<style>' + d.css + '</style>' : '') + (d.html || '');
        var entry = partEl.__goghChromeEntry;
        if (entry) { entry.raw = raw; entry.savedRaw = raw; bindPending(entry); }
        placeNavAdders(partEl);
        placeChromeBtns();
      });
    });
  }
  function openNavAddPanel(partEl, listEl, anchorEl) {
    placePanelNear(anchorEl);
    panel.innerHTML =
      '<div class="gogh-panel-head"><span class="gogh-panel-title">Add to menu</span>' +
      '<button type="button" class="gogh-sbtn gogh-panel-close" title="Close">✕</button></div>' +
      '<div class="gogh-panel-hint">Pick a page — the menu updates on every page of your site.</div>' +
      '<div class="gogh-navadd-list"><em class="gogh-panel-hint">Loading pages…</em></div>';
    panel.hidden = false;
    panelOpen = true;
    panel.querySelector('.gogh-panel-close').addEventListener('click', closePanel);
    var inMenu = {};
    navItemsOf(listEl).forEach(function (li) {
      var a = li.querySelector('a');
      if (!a) return;
      try { inMenu[new URL(a.href, location.href).pathname.replace(/\/$/, '') || '/'] = 1; } catch (e2) {}
    });
    fetch(restQ(GSROOT + 'pages', 'status=publish&per_page=100&_fields=id,title,link'), {
      headers: { 'X-WP-Nonce': cfg.nonce }, credentials: 'same-origin',
    }).then(function (r) { return r.ok ? r.json() : []; }).then(function (pages) {
      var box = panel.querySelector('.gogh-navadd-list');
      if (!box) return;
      var avail = (pages || []).filter(function (p) {
        var path = '/';
        try { path = new URL(p.link).pathname.replace(/\/$/, '') || '/'; } catch (e3) {}
        return !inMenu[path];
      });
      if (!avail.length) {
        box.innerHTML = '<em class="gogh-panel-hint">Every page is already in this menu.</em>';
        return;
      }
      box.innerHTML = '';
      avail.forEach(function (p) {
        var title = (p.title && p.title.rendered ? p.title.rendered.replace(/<[^>]+>/g, '') : 'Page ' + p.id);
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'gogh-btn gogh-btn-small gogh-navadd-item';
        b.textContent = title;
        b.addEventListener('click', function () {
          b.disabled = true;
          b.textContent = 'Adding…';
          var entry = partEl.__goghChromeEntry;
          saveChromeEntry(entry).then(function () {
            return saveNavAppend(partEl, listEl, p);
          }).then(function () {
            closePanel();
            toast('“' + title + '” added to the menu — every page gets it.', { ttl: 4500 });
            return refreshChromePart(partEl);
          }).catch(function (err) {
            b.disabled = false;
            b.textContent = title;
            toast((err && err.message) || 'gogh couldn’t add that page.', { error: true });
          });
        });
        box.appendChild(b);
      });
    });
  }


  // ---------- menu manager panel ----------
  // Canvas edits words; this panel edits STRUCTURE: which menu shows, the
  // order, one level of submenus, and adding pages or custom links.
  function openMenuManager(partEl, anchorEl) {
    placePanelNear(anchorEl);
    var mmNavId = null;
    var mmItems = [];
    var mmMenus = [];
    var area = partEl.tagName === 'FOOTER' ? 'footer' : 'header';
    var hdrs = { 'X-WP-Nonce': cfg.nonce, 'Content-Type': 'application/json' };
    panel.innerHTML =
      '<div class="gogh-panel-head"><span class="gogh-panel-title">Menu</span>' +
      '<button type="button" class="gogh-sbtn gogh-panel-close" title="Close">\u2715</button></div>' +
      '<div class="gogh-mm-body"><em class="gogh-panel-hint">Loading menu\u2026</em></div>';
    panel.hidden = false;
    panelOpen = true;
    panel.querySelector('.gogh-panel-close').addEventListener('click', closePanel);
    var body = panel.querySelector('.gogh-mm-body');

    function commit() {
      var content = serializeNavModel(mmItems);
      var entry = partEl.__goghChromeEntry;
      var pre = entry ? saveChromeEntry(entry) : Promise.resolve();
      return pre.then(function () {
        if (mmNavId != null) {
          return fetch(GSROOT + 'navigation/' + mmNavId, {
            method: 'POST', headers: hdrs, credentials: 'same-origin',
            body: JSON.stringify({ content: content }),
          });
        }
        return fetch(GSROOT + 'navigation', {
          method: 'POST', headers: hdrs, credentials: 'same-origin',
          body: JSON.stringify({ title: 'Navigation', status: 'publish', content: content }),
        }).then(function (r) {
          return r.json().then(function (j) { if (j && j.id) mmNavId = j.id; return r; });
        });
      }).then(function (r) {
        if (r && !r.ok) throw new Error('HTTP ' + r.status);
        return refreshChromePart(partEl);
      }).catch(function (err) {
        toast('gogh could not save the menu \u2014 ' + ((err && err.message) || 'try again.'), { error: true });
      });
    }
    function snapshot() { return JSON.parse(JSON.stringify(mmItems)); }
    function undoToast(msg, snap) {
      toast(msg, { actions: [{ label: 'Undo', onClick: function () {
        mmItems = snap;
        renderList();
        commit();
      } }] });
    }
    function isExternal(it) {
      if (it.kind === 'custom') return true;
      try { return it.url && new URL(it.url, location.href).origin !== location.origin; } catch (err) { return false; }
    }

    function rowEl(it, parent) {
      var r = document.createElement('div');
      r.className = 'gogh-mm-row' + (parent ? ' gogh-mm-sub' : '');
      r.__it = it; r.__parent = parent || null;
      r.innerHTML =
        (parent ? '<span class="gogh-mm-ind">\u21b3</span>' : '<span class="gogh-mm-grip">\u22ee\u22ee</span>') +
        '<span class="gogh-mm-label"></span>' +
        (it.children && it.children.length ? '<span class="gogh-mm-count">' + it.children.length + ' inside</span>' : '') +
        (isExternal(it) ? '<span class="gogh-mm-link">link</span>' : '') +
        '<button type="button" class="gogh-mm-x" title="Remove from menu">\u2715</button>';
      r.querySelector('.gogh-mm-label').textContent = it.label || it.url || 'Untitled';
      r.querySelector('.gogh-mm-x').addEventListener('click', function (ev) {
        ev.stopPropagation();
        var snap = snapshot();
        if (parent) {
          parent.children.splice(parent.children.indexOf(it), 1);
          if (!parent.children.length) { parent.children = null; parent.dirty = true; }
        } else {
          var at = mmItems.indexOf(it);
          var kids = (it.children || []).map(function (c) { c.dirty = true; return c; });
          mmItems.splice.apply(mmItems, [at, 1].concat(kids));
        }
        renderList();
        commit();
        undoToast('\u201c' + (it.label || 'Item') + '\u201d removed from the menu.', snap);
      });
      r.addEventListener('pointerdown', function (ev) {
        if (ev.button !== 0 || ev.target.closest('.gogh-mm-x')) return;
        ev.preventDefault();
        startRowDrag(ev, r);
      });
      return r;
    }
    var listBox = null;
    function renderList() {
      body.innerHTML = '';
      var sel = document.createElement('div');
      sel.className = 'gogh-mm-showing';
      sel.innerHTML = '<label>Showing</label><select class="gogh-input"></select>';
      var dd = sel.querySelector('select');
      if (mmMenus.length) {
        mmMenus.forEach(function (m) {
          var o = document.createElement('option');
          o.value = m.id;
          o.textContent = (m.title && (m.title.rendered || m.title.raw)) || ('Menu ' + m.id);
          if (m.id === mmNavId) o.selected = true;
          dd.appendChild(o);
        });
        dd.addEventListener('change', function () { switchMenu(+dd.value); });
      } else {
        var o2 = document.createElement('option');
        o2.textContent = 'New menu';
        dd.appendChild(o2);
        dd.disabled = true;
      }
      body.appendChild(sel);
      listBox = document.createElement('div');
      listBox.className = 'gogh-mm-list';
      if (!mmItems.length) {
        listBox.innerHTML = '<em class="gogh-panel-hint">Nothing in this menu yet \u2014 add a page below.</em>';
      }
      mmItems.forEach(function (it) {
        var g = document.createElement('div');
        g.className = 'gogh-mm-group';
        g.__it = it;
        g.appendChild(rowEl(it, null));
        (it.children || []).forEach(function (c) { g.appendChild(rowEl(c, it)); });
        listBox.appendChild(g);
      });
      body.appendChild(listBox);
      var foot = document.createElement('div');
      foot.className = 'gogh-mm-foot';
      foot.innerHTML =
        '<button type="button" class="gogh-btn gogh-btn-small gogh-mm-addpage">+ Page</button>' +
        '<button type="button" class="gogh-btn gogh-btn-small gogh-mm-addlink">+ Link</button>';
      foot.querySelector('.gogh-mm-addpage').addEventListener('click', renderAddPage);
      foot.querySelector('.gogh-mm-addlink').addEventListener('click', renderAddLink);
      body.appendChild(foot);
      var hint = document.createElement('div');
      hint.className = 'gogh-panel-hint';
      hint.textContent = 'Drag to reorder \u00b7 drag right to nest under the item above';
      body.appendChild(hint);
    }

    function startRowDrag(ev, row) {
      var it = row.__it, parent = row.__parent;
      var unit = parent ? row : row.parentNode; // a family moves as one block
      var canNest = !parent && !(it.children && it.children.length);
      var y0 = ev.clientY, x0 = ev.clientX, moved = false, nestG = null;
      var sibsOf = function () {
        return [].slice.call(unit.parentNode.children).filter(function (n) {
          return n !== unit && (parent ? n.classList.contains('gogh-mm-sub') : n.classList.contains('gogh-mm-group'));
        });
      };
      var clearNest = function () {
        if (nestG) { nestG.classList.remove('gogh-mm-nest-target'); nestG = null; }
      };
      var onMove = function (e2) {
        var dy = e2.clientY - y0, dx = e2.clientX - x0;
        if (!moved && Math.abs(dy) < 4 && Math.abs(dx) < 4) return;
        moved = true;
        unit.classList.add('is-lifting');
        unit.style.transform = 'translate(' + Math.max(-20, Math.min(40, dx)) + 'px,' + dy + 'px)';
        // siblings step aside the moment the dragged block crosses their middle
        var r = unit.getBoundingClientRect();
        var mid = r.top + r.height / 2;
        sibsOf().forEach(function (other) {
          var om = other.getBoundingClientRect();
          var omid = om.top + om.height / 2;
          if (mid < omid && (unit.compareDocumentPosition(other) & 2)) {
            other.before(unit);
            y0 = e2.clientY;
            unit.style.transform = 'translate(' + Math.max(-20, Math.min(40, dx)) + 'px,0)';
          } else if (mid > omid && (unit.compareDocumentPosition(other) & 4)) {
            other.after(unit);
            y0 = e2.clientY;
            unit.style.transform = 'translate(' + Math.max(-20, Math.min(40, dx)) + 'px,0)';
          }
        });
        var nesting = canNest && dx > 32 && unit.previousElementSibling &&
          unit.previousElementSibling.classList.contains('gogh-mm-group');
        row.classList.toggle('is-nesting', !!nesting);
        row.classList.toggle('is-unnesting', !!parent && dx < -32);
        clearNest();
        if (nesting) {
          nestG = unit.previousElementSibling;
          nestG.classList.add('gogh-mm-nest-target');
        }
      };
      var onUp = function (e3) {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        unit.classList.remove('is-lifting');
        row.classList.remove('is-nesting', 'is-unnesting');
        unit.style.transform = '';
        var hostG = nestG;
        clearNest();
        if (!moved) return;
        var dx = e3.clientX - x0;
        var snap = snapshot();
        var changed = false;
        if (parent) {
          if (dx < -32) {
            parent.children.splice(parent.children.indexOf(it), 1);
            if (!parent.children.length) { parent.children = null; parent.dirty = true; }
            it.dirty = true;
            mmItems.splice(mmItems.indexOf(parent) + 1, 0, it);
            changed = true;
          } else {
            // the DOM already shows the order the user made — adopt it
            var order = [].slice.call(unit.parentNode.children)
              .filter(function (n) { return n.classList.contains('gogh-mm-sub'); })
              .map(function (n) { return n.__it; });
            changed = order.some(function (o, k) { return o !== parent.children[k]; });
            parent.children = order;
          }
        } else if (hostG && canNest) {
          mmItems.splice(mmItems.indexOf(it), 1);
          var host = hostG.__it;
          host.children = host.children || [];
          host.dirty = true;
          it.dirty = true;
          host.children.push(it);
          changed = true;
        } else {
          var order2 = [].slice.call(listBox.children)
            .filter(function (n) { return n.classList.contains('gogh-mm-group'); })
            .map(function (n) { return n.__it; });
          changed = order2.some(function (o, k) { return o !== mmItems[k]; });
          mmItems = order2;
        }
        if (changed) {
          renderList();
          commit();
          undoToast('Menu updated.', snap);
        } else {
          renderList();
        }
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    }


    function backBar(label) {
      var bb = document.createElement('button');
      bb.type = 'button';
      bb.className = 'gogh-btn gogh-btn-small gogh-mm-back';
      bb.textContent = '\u2190 ' + label;
      bb.addEventListener('click', renderList);
      return bb;
    }
    function addItem(label, url, kind) {
      mmItems.push({ name: '', text: null, attrsText: null, attrs: {},
        label: label, url: url, kind: kind, children: null, dirty: true });
      renderList();
      commit();
      toast('\u201c' + label + '\u201d added \u2014 the menu updates on every page.');
    }
    function renderAddPage() {
      body.innerHTML = '';
      body.appendChild(backBar('Menu'));
      var box = document.createElement('div');
      box.className = 'gogh-mm-pages';
      box.innerHTML = '<em class="gogh-panel-hint">Loading pages\u2026</em>';
      body.appendChild(box);
      var mk = document.createElement('div');
      mk.className = 'gogh-mm-newpage';
      mk.innerHTML = '<input type="text" class="gogh-input" placeholder="New page title" />' +
        '<button type="button" class="gogh-btn gogh-btn-small">Create</button>';
      body.appendChild(mk);
      mk.querySelector('button').addEventListener('click', function () {
        var t = mk.querySelector('input').value.trim();
        if (!t) return;
        mk.querySelector('button').textContent = 'Creating\u2026';
        fetch(GSROOT + 'pages', {
          method: 'POST', headers: hdrs, credentials: 'same-origin',
          body: JSON.stringify({ title: t, status: 'publish', content: '' }),
        }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (pg) { addItem(t, pg.link, 'post-type'); })
          .catch(function () {
            mk.querySelector('button').textContent = 'Create';
            toast('gogh could not create that page.', { error: true });
          });
      });
      var inMenu = {};
      var noteUrl = function (u) {
        try { inMenu[new URL(u, location.href).pathname.replace(/\/$/, '') || '/'] = 1; } catch (err) {}
      };
      mmItems.forEach(function (it) { noteUrl(it.url); (it.children || []).forEach(function (c) { noteUrl(c.url); }); });
      fetch(restQ(GSROOT + 'pages', 'status=publish&per_page=100&_fields=id,title,link'), {
        headers: { 'X-WP-Nonce': cfg.nonce }, credentials: 'same-origin',
      }).then(function (r) { return r.ok ? r.json() : []; }).then(function (pages) {
        var avail = (pages || []).filter(function (pg) {
          var path = '/';
          try { path = new URL(pg.link).pathname.replace(/\/$/, '') || '/'; } catch (err) {}
          return !inMenu[path];
        });
        box.innerHTML = avail.length ? '' : '<em class="gogh-panel-hint">Every page is already in this menu.</em>';
        avail.forEach(function (pg) {
          var title = (pg.title && pg.title.rendered ? pg.title.rendered.replace(/<[^>]+>/g, '') : 'Page ' + pg.id);
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'gogh-btn gogh-btn-small gogh-navadd-item';
          b.textContent = title;
          b.addEventListener('click', function () { addItem(title, pg.link, 'post-type'); });
          box.appendChild(b);
        });
      });
    }
    function renderAddLink() {
      body.innerHTML = '';
      body.appendChild(backBar('Menu'));
      var f = document.createElement('div');
      f.className = 'gogh-mm-newlink';
      f.innerHTML = '<input type="text" class="gogh-input gogh-mm-lab" placeholder="Label" />' +
        '<input type="url" class="gogh-input gogh-mm-url" placeholder="https://\u2026" />' +
        '<button type="button" class="gogh-btn gogh-btn-small">Add link</button>';
      body.appendChild(f);
      f.querySelector('button').addEventListener('click', function () {
        var lab = f.querySelector('.gogh-mm-lab').value.trim();
        var url = f.querySelector('.gogh-mm-url').value.trim();
        if (!lab || !url) return;
        if (!/^https?:\/\//i.test(url) && url[0] !== '/' && url[0] !== '#') url = 'https://' + url;
        addItem(lab, url, 'custom');
      });
    }
    function switchMenu(newId) {
      activePartFor(area).then(function (active) {
        if (!active) throw new Error('no ' + area + ' part');
        var praw = String((active.content && (active.content.raw || active.content)) || '');
        var next;
        if (/wp:navigation[^>]*"ref":\d+/.test(praw)) {
          next = praw.replace(/("ref":)\d+/, '$1' + newId);
        } else if (/<!--\s+wp:navigation\s+\{/.test(praw)) {
          next = praw.replace(/(<!--\s+wp:navigation\s+\{)/, '$1"ref":' + newId + ',');
        } else {
          next = praw.replace(/(<!--\s+wp:navigation)(\s+-->)/, '$1 {"ref":' + newId + '} -->');
        }
        if (next === praw && praw.indexOf('wp:navigation') === -1) throw new Error('this ' + area + ' has no menu block');
        return fetch(tpUrl(active.id), {
          method: 'POST', headers: hdrs, credentials: 'same-origin',
          body: JSON.stringify({ content: next }),
        }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          mmNavId = newId;
          return refreshChromePart(partEl);
        }).then(loadItems).then(function () {
          toast('Menu switched \u2014 every page shows it.');
        });
      }).catch(function (err) {
        toast('gogh could not switch the menu \u2014 ' + ((err && err.message) || 'try again.'), { error: true });
        renderList();
      });
    }
    function loadItems() {
      if (mmNavId == null) { mmItems = []; renderList(); return Promise.resolve(); }
      return fetch(restQ(GSROOT + 'navigation/' + mmNavId, 'context=edit'), {
        headers: { 'X-WP-Nonce': cfg.nonce }, credentials: 'same-origin',
      }).then(function (r) { return r.ok ? r.json() : null; }).then(function (nav) {
        mmItems = nav ? parseNavModel(((nav.content && nav.content.raw) || '').trim()) : [];
        renderList();
      });
    }
    resolveNavTarget(partEl).then(function (navId) {
      mmNavId = navId;
      return fetch(restQ(GSROOT + 'navigation', 'per_page=100&_fields=id,title'), {
        headers: { 'X-WP-Nonce': cfg.nonce }, credentials: 'same-origin',
      }).then(function (r) { return r.ok ? r.json() : []; });
    }).then(function (menus) {
      mmMenus = menus || [];
      return loadItems();
    }).catch(function () {
      body.innerHTML = '<em class="gogh-panel-hint">gogh could not load this menu.</em>';
    });
  }

  var chromeBtns = [];
  function clearChromeBtns() {
    if (chromeCycle) chromeCycle.collapse();
    chromeBtns.forEach(function (b) { b.remove(); });
    chromeBtns = [];
  }
  // pills only appear while the pointer is over their part (or the pill
  // itself) — less cognitive noise everywhere else on the page
  document.addEventListener('mouseover', function (ev) {
    chromeBtns.forEach(function (b) {
      var over = b.contains(ev.target) ||
        (b.__goghPart && b.__goghPart.contains(ev.target));
      // the pills are viewport-fixed: while their part is on screen, the
      // matching edge of the screen counts as hovering — otherwise the
      // pointer can never reach the pill across the gap
      if (!over && b.__goghPart &&
          (b.classList.contains('is-footpill') || b.classList.contains('is-headpill'))) {
        var fr = b.__goghPart.getBoundingClientRect();
        var onScreen = fr.top < window.innerHeight && fr.bottom > 0;
        over = onScreen && (b.classList.contains('is-footpill')
          ? ev.clientY > window.innerHeight - 120
          : ev.clientY < 120);
      }
      // while the veil is armed, the veil's pill is the ONLY invitation —
      // Change header waits until the chrome is awake
      if (over && b.__goghPart && b.__goghPart.querySelector('.gogh-chromeveil')) over = false;
      b.classList.toggle('is-vis', over);
    });
  });
  function placeChromeBtns() {
    clearChromeBtns();
    if (!editing) return;
    chromePartEls().forEach(function (partEl) {
      var r = partEl.getBoundingClientRect();
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'gogh-convertbtn gogh-chromebtn';
      // a verb + swap arrows: the pill CHANGES the design — a bare noun and
      // layers icon read as a label, not an invitation
      b.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3l4 4-4 4"/><path d="M20 7H7a4 4 0 0 0-4 4"/><path d="M8 21l-4-4 4-4"/><path d="M4 17h13a4 4 0 0 0 4-4"/></svg>' +
        (partEl.tagName === 'FOOTER' ? 'Change footer layout' : 'Change header layout');
      b.dataset.tip = 'Flick through ' + (partEl.tagName === 'FOOTER' ? 'footer' : 'header') + ' designs';
      b.__goghPart = partEl;
      // both pills are viewport-fixed and centred on their edge — where
      // folks expect the control, and clear of the part's own content
      // (the header pill used to overlap the nav)
      b.classList.add(partEl.tagName === 'FOOTER' ? 'is-footpill' : 'is-headpill');
      b.addEventListener('click', function () {
        // mid-cycle the pill IS the next button (simple mode)
        if (chromeCycle && chromeCycle.partEl === partEl) { chromeCycle.advance(); return; }
        b.disabled = true;
        convertChrome(partEl).then(function (sec) { if (!sec) b.disabled = false; }).catch(function () {
          b.disabled = false;
          toast('Could not open the layout panel.', { error: true });
        });
      });
      document.body.appendChild(b);
      chromeBtns.push(b);
    });
  }

  // "Make freeform" overlay buttons on convertible blocks
  var convBtns = [];
  // like the chrome pills: stored-block controls only show while the
  // pointer is over their block (or the pill itself) — a page of patterns
  // otherwise wears pill pairs on every block, and adjacent blocks stack
  // identical pills
  document.addEventListener('mouseover', function (ev) {
    convBtns.concat(storedRmBtns).forEach(function (b) {
      var over = b.contains(ev.target) ||
        (b.__goghBlock && b.__goghBlock.contains(ev.target));
      b.style.opacity = over ? '' : '0';
      b.style.pointerEvents = over ? '' : 'none';
    });
  });
  function clearConvertBtns() {
    convBtns.forEach(function (b) { b.remove(); });
    convBtns = [];
  }
  var storedRmBtns = [];
  function clearStoredRmBtns() {
    storedRmBtns.forEach(function (b) { b.remove(); });
    storedRmBtns = [];
  }
  function placeStoredRmBtns() {
    clearStoredRmBtns();
    if (!editing) return;
    storedEdits.forEach(function (en) {
      if (en.deleted || !en.el || !en.el.isConnected) return;
      if (en.chromePart) return;
      var r = en.el.getBoundingClientRect();
      if (r.height < 24) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'gogh-storedrm';
      b.textContent = '\u2715';
      b.title = 'Remove this section';
      b.__goghBlock = en.el;
      b.style.opacity = '0';
      b.style.pointerEvents = 'none';
      b.style.left = (r.right + window.scrollX - 38) + 'px';
      b.style.top = (r.top + window.scrollY + 10) + 'px';
      b.addEventListener('click', function () {
        var slot = { parent: en.el.parentNode, next: en.el.nextSibling };
        en.deleted = true;
        en.el.remove();
        clearStoredRmBtns();
        placeStoredRmBtns();
        refreshChip();
        toast('Section removed \u2014 publish to make it real.', { actions: [{ label: 'Undo', onClick: function () {
          en.deleted = false;
          if (slot.parent) slot.parent.insertBefore(en.el, slot.next && slot.next.parentNode === slot.parent ? slot.next : null);
          clearStoredRmBtns();
          placeStoredRmBtns();
          refreshChip();
        } }] });
      });
      document.body.appendChild(b);
      storedRmBtns.push(b);
    });
  }
  function placeConvertBtns() {
    clearConvertBtns();
    placeStoredRmBtns();
    // v1 posture: converting arbitrary imported markup to freeform is a
    // On by default since 0.97.6; ?gogh-experiments=0 (or the
    // gogh_convert_enabled filter) hides it — its
    // input space is the whole web. Native light editing stays on.
    if (!editing || !cfg.canConvert) return;
    // only nodes BOUND to stored content spans qualify — topBlockNodes()
    // also returns template-owned siblings (the page title, when an empty
    // post_content leaves no .entry-content wrapper and pageParent falls
    // back to <main>), and offering to convert the page title is nonsense.
    // storedEdits already pairs rendered nodes with stored spans and binds
    // nothing on a count mismatch, so it is the safe source of truth.
    storedEdits.forEach(function (en) {
      var node = en.el;
      if (en.deleted || !node || !node.isConnected) return;
      var r = node.getBoundingClientRect();
      if (r.height < 24) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'gogh-convertbtn';
      b.textContent = '\u2728 Make freeform';
      b.style.left = (r.right + window.scrollX - 10) + 'px';
      b.style.top = (r.top + window.scrollY + 10) + 'px';
      b.__goghBlock = node;
      b.style.opacity = '0';
      b.style.pointerEvents = 'none';
      b.addEventListener('click', function () {
        b.disabled = true;
        b.textContent = 'Converting\u2026';
        convertBlock(node).then(function (sec) {
          if (!sec) { b.disabled = false; b.textContent = '\u2728 Make freeform'; }
        }).catch(function (err) {
          b.disabled = false;
          b.textContent = '\u2728 Make freeform';
          toast((err && err.message) || 'gogh could not convert this block.', { error: true });
        });
      });
      document.body.appendChild(b);
      convBtns.push(b);
      // the remove ✕ sits to the pill's LEFT — its default offset assumed a
      // narrower pill and parked it on top of "freeform"
      storedRmBtns.forEach(function (rb) {
        if (rb.__goghBlock === node) {
          rb.style.left = (r.right + window.scrollX - 10 - b.offsetWidth - 36) + 'px';
          rb.style.top = (r.top + window.scrollY + 10) + 'px';
        }
      });
    });
  }

  // merge regenerated gogh sections into the stored content WITHOUT touching
  // non-gogh blocks: replace existing gogh/section spans in place, append when
  // the page had none, whole-replace only for legacy full-gogh pages
  function mergeContent(raw) {
    var OPEN = '<!-- wp:gogh/section -->', CLOSE = '<!-- /wp:gogh/section -->';
    // light edits to PUBLISHED native/HTML blocks: swap each edited block's
    // stored span (matched by the signature of its unedited form) for the
    // edited markup before anything else rewrites the content
    storedEdits.forEach(function (en) {
      if (!en.deleted) return;
      var gone = raw.indexOf(en.savedRaw);
      if (gone !== -1) {
        raw = raw.slice(0, gone) + raw.slice(gone + en.savedRaw.length);
      }
    });
    storedEdits = storedEdits.filter(function (en) { return !en.deleted; });
    storedEdits.forEach(function (en) {
      if (en.raw === en.savedRaw || !en.el.isConnected) return;
      // savedRaw is a verbatim slice of the stored content — exact-string
      // replacement handles single blocks and multi-block holders alike; a
      // miss (content changed elsewhere) skips rather than corrupts
      var at = raw.indexOf(en.savedRaw);
      if (at === -1) return;
      raw = raw.slice(0, at) + en.raw + raw.slice(at + en.savedRaw.length);
    });
    // converted Gutenberg blocks: swap each source span for its section, then
    // the generic paths below see them as ordinary gogh sections
    var converted = realSections().filter(function (s) { return s.srcSig; });
    if (converted.length) {
      var tspans = parseTopBlocks(raw);
      var repl = [];
      converted.forEach(function (sec) {
        for (var ti = 0; ti < tspans.length; ti++) {
          if (sigOf(raw.slice(tspans[ti].start, tspans[ti].end)) === sec.srcSig) {
            repl.push({ sp: tspans[ti], sec: sec });
            return;
          }
        }
        // source vanished (edited elsewhere): section flows through the
        // generic paths below instead
      });
      repl.sort(function (a, b) { return b.sp.start - a.sp.start; });
      repl.forEach(function (r) {
        raw = raw.slice(0, r.sp.start) + buildSectionBlocksV3(r.sec) + raw.slice(r.sp.end);
      });
    }
    var blocks = pendingBlocks.length ? pageStream() : buildAllBlocks();
    // v3 comments carry attributes, so exact-string matching would miss
    // them — span the sections with the real block parser
    var spans = parseTopBlocks(raw).filter(function (sp) {
      return sp.name === 'gogh/section';
    }).map(function (sp) { return [sp.start, sp.end]; });
    if (!spans.length) {
      // legacy carrier pages were 100% gogh: migrate the whole content
      if (raw.indexOf('gogh-model') !== -1) return blocks;
      // plain page: keep everything, append the new sections
      var trimmed = raw.replace(/\s+$/, '');
      return trimmed + (trimmed ? '\n\n' : '') + blocks;
    }
    var secs = realSections();
    if (spans.length === secs.length) {
      // 1:1 — rewrite each span in place, preserving interleaved blocks.
      // Pending native sections splice in at their DOM position relative to
      // the section that follows them (or at the end).
      var pendBefore = {}, pendTail = '';
      pendingBlocks.forEach(function (pe) {
        if (!pe.el.isConnected) return;
        var n = pe.el.nextElementSibling, target = -1;
        while (n) {
          if (n.classList && n.classList.contains('gogh-wrap')) {
            var owner = secs.filter(function (s2) { return s2.wrapEl === n; })[0];
            if (owner) { target = secs.indexOf(owner); break; }
          }
          n = n.nextElementSibling;
        }
        if (target >= 0) pendBefore[target] = (pendBefore[target] || '') + pe.raw + '\n\n';
        else pendTail += '\n\n' + pe.raw;
      });
      var out = '', pos = 0;
      spans.forEach(function (sp, k) {
        out += raw.slice(pos, sp[0]) + (pendBefore[k] || '') + buildSectionBlocksV3(secs[k]);
        pos = sp[1];
      });
      return out + pendTail + raw.slice(pos);
    }
    // sections were added/removed: replace the whole gogh region, keep
    // prefix/suffix, and carry along non-gogh chunks from between sections
    var head = raw.slice(0, spans[0][0]);
    var tail = raw.slice(spans[spans.length - 1][1]);
    var between = '';
    for (var k = 1; k < spans.length; k++) {
      var chunk = raw.slice(spans[k - 1][1], spans[k][0]).trim();
      if (chunk) between += '\n\n' + chunk;
    }
    return head + blocks + between + tail;
  }

  // The zoom modal can move native blocks, but mergeContent's in-place span
  // rewriting keeps every PUBLISHED native block in its old raw slot. These
  // two re-emit the merged content's top-level spans in live DOM order.
  // Every unit is an exact-text slice we authored or bound, so the mapping
  // is byte-precise; ANY ambiguity returns the merged raw untouched — the
  // failure mode is a stale order, never corrupted content.
  function gatherRawUnits() {
    var units = [];
    var kids = [].slice.call(pageParent.children);
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      if (!n.classList || n.tagName === 'STYLE' || n.tagName === 'SCRIPT') continue;
      if (n.classList.contains('gogh-wrap')) {
        var sec = realSections().filter(function (s) { return s.wrapEl === n; })[0];
        if (sec) units.push(buildSectionBlocksV3(sec));
      } else if (n.classList.contains('gogh-pending')) {
        var pe = pendingBlocks.filter(function (p) { return p.el === n; })[0];
        if (!pe) return null;
        units.push(pe.raw);
      } else {
        var en = storedEdits.filter(function (s2) { return s2.el === n; })[0];
        if (!en) return null; // unbound stored block: order must not be touched
        units.push(en.raw);
      }
    }
    return units;
  }
  function resequenceToDom(merged, units) {
    if (!units || units.length < 2) return merged;
    var ranges = [];
    for (var i = 0; i < units.length; i++) {
      var t = units[i];
      if (!t) return merged;
      var from = 0, at;
      for (;;) {
        at = merged.indexOf(t, from);
        if (at === -1) return merged; // unit not present verbatim: bail
        var lo = at;
        var clash = ranges.some(function (r) { return lo < r.end && lo + t.length > r.start; });
        if (!clash) break;
        from = at + 1;
      }
      ranges.push({ start: at, end: at + t.length, i: i });
    }
    var sorted = ranges.slice().sort(function (a, b) { return a.start - b.start; });
    var inOrder = sorted.every(function (r, k) { return r.i === k; });
    if (inOrder) return merged; // nothing moved: keep the merge byte-for-byte
    for (var k = 1; k < sorted.length; k++) {
      if (/\S/.test(merged.slice(sorted[k - 1].end, sorted[k].start))) return merged;
    }
    var head = merged.slice(0, sorted[0].start);
    var tail = merged.slice(sorted[sorted.length - 1].end);
    // content outside the claimed region must not contain blocks we'd strand
    if (parseTopBlocks(head).length || parseTopBlocks(tail).length) return merged;
    return head + units.join('\n\n') + tail;
  }


  // ---------- boot ----------
  // v3 sections carry their model in the block-comment attributes, which
  // the rendered DOM does not include — hydrate them from the raw content
  // over authenticated REST before the editor takes over. v2 pages resolve
  // immediately (no fetch).
  function hydrateV3Sections() {
    var pending = S.filter(function (s) { return s.v3; });
    if (!pending.length) return Promise.resolve();
    return fetchRaw().then(function (raw) {
      var freeAttrs = [];
      var byScope = {};
      parseTopBlocks(raw).forEach(function (sp) {
        if (sp.name !== 'gogh/section') return;
        var am = raw.slice(sp.start, sp.end).match(/^<!--\s+wp:gogh\/section\s+(\{[\s\S]*?\})\s*-->/);
        if (!am) return;
        try {
          var a = JSON.parse(am[1]);
          if (a && a.model) {
            freeAttrs.push(a);
            if (a.scope) byScope[a.scope] = a;
          }
        } catch (err) {}
      });
      pending.forEach(function (sec) {
        // primary match by the stored scope; duplicated pages can carry
        // colliding scopes, so fall back to document order
        var a = (sec.srcScope && byScope[sec.srcScope]) || freeAttrs.shift() || null;
        if (a && byScope[a.scope] === a) delete byScope[a.scope];
        var idx = freeAttrs.indexOf(a);
        if (idx !== -1) freeAttrs.splice(idx, 1);
        sec.v3 = false;
        if (!a) return; // orphan: renders as-is, uneditable model-wise
        var model = a.model;
        sec.els = syncModelFromMarkup(sec.sectionEl, model.elements || []);
        sec.minH = model.minH || null;
        sec.bg = model.bg || null;
        sec.divider = model.divider || null;
        sec.fx = model.fx || null;
        sec.bgImage = model.bgImage || null;
        sec.bgId = model.bgId || null;
        sec.bgA = model.bgA != null ? model.bgA : null;
        sec.theme = model.theme || null;
        sec.fill = !!model.fill;
      });
    }).catch(function (err) {
      console.warn('[gogh] v3 hydration failed:', err);
      S.forEach(function (s) { s.v3 = false; });
    });
  }
  hydrateV3Sections().then(function () {
    S.forEach(renderSection);
    if (wantEdit) {
      setEditing(true);
      var bootContent = S.filter(function (s) { return !s.chrome; });
      // the blank-canvas greeting is for genuinely EMPTY pages — a page
      // full of native blocks (a starter site's home) is not one
      if (bootContent.length === 1 && isBlankBoot(bootContent[0]) &&
          !topBlockNodes().length) {
        openPicker(S.indexOf(bootContent[0]));
      }
      try {
        var u = new URL(location.href);
        u.searchParams.delete('gogh-edit');
        history.replaceState(null, '', u);
      } catch (e3) {}
    }
  });
})();

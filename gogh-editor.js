/* gogh front-end editor — the live page IS the canvas.
 * v0.5: side palette, delete, undo/redo, between-section inserter, drag ghost
 * (no cursor drift), and fixed text/badge height measurement (no more
 * stretch-measure feedback loop).
 */
(function () {
  'use strict';

  var cfg = window.GOGH;
  if (!cfg) return;

  var TOL = 8, MIN_H = 560, PAD = 72, SNAP = 6, BASE = 8, W = 1200;

  // ---------- collect sections (resilient to Gutenberg-side edits) ----------
  // Carriers are paired by ADJACENCY (the style+model immediately before each
  // wrap). Wraps without a carrier — e.g. sections duplicated in the block
  // editor — are ADOPTED: a model is inferred from their blocks and they
  // become normal gogh sections on the next save.
  var wrapTags = [].slice.call(document.querySelectorAll('.gogh-wrap'));
  var wantEdit = /[?&]gogh-edit=1/.test(location.search);
  if (!wrapTags.length) {
    if (!wantEdit) return;
    // ?gogh-edit on a page with no gogh content yet: bootstrap an empty
    // placeholder section at the end of the content so the editor has a
    // canvas. It is never saved unless the user actually puts things in it.
    var host = document.querySelector('.entry-content') || document.querySelector('main');
    if (!host) return;
    var bWrap = document.createElement('div');
    bWrap.className = 'wp-block-gogh-section alignfull gogh-wrap';
    var bSec = document.createElement('div');
    bSec.className = 'gogh-section';
    bWrap.appendChild(bSec);
    host.appendChild(bWrap);
    bWrap.__goghBootstrap = true;
    wrapTags = [bWrap];
  }

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
        e.fs = fm ? fm[1] : null;
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

  var S = []; // {scope, els, minH, bg, divider, wrapEl, sectionEl, styleEl, nodes}
  wrapTags.forEach(function (wrap) {
    var sectionEl = wrap.querySelector('.gogh-section');
    if (!sectionEl) return;
    var model = null, styleEl = null;
    // v0.18 gogh/section format: style + model live inside the wrapper
    var innerStyle = wrap.querySelector(':scope > style.gogh-style');
    var innerModel = wrap.querySelector(':scope > script.gogh-model');
    if (innerStyle && innerModel) {
      styleEl = innerStyle;
      try { model = JSON.parse(innerModel.textContent); } catch (e1) { model = null; }
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
    var bootEls = model.elements || [];
    if (hadModel) bootEls = syncModelFromMarkup(sectionEl, bootEls);
    S.push({ scope: scope, els: bootEls,
      bootstrap: !!wrap.__goghBootstrap,
      minH: model.minH || (bootEls.length ? null : 480),
      bg: model.bg || null, divider: model.divider || null,
      bgImage: model.bgImage || null, bgId: model.bgId || null,
      wrapEl: wrap, sectionEl: sectionEl, styleEl: styleEl, nodes: [] });
  });
  if (!S.length) return;
  // marker after the last wrap so full rebuilds keep document position
  var endMarker = document.createComment('gogh-end');
  S[S.length - 1].wrapEl.after(endMarker);
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
  function solve(els, minH) {
    var H = designH(els, minH);
    var xs = cluster([0, W].concat(els.reduce(function (a, e) { return a.concat([e.x, e.x + e.w]); }, [])));
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

  // text elements hug their content (align-self: start) so measuring them
  // returns intrinsic height, not the stretched grid-cell height
  // gogh owns LAYOUT; the theme (theme.json / Global Styles) owns typography,
  // colours and button treatment — so Full Site Editing changes flow through
  var TYPE_RULES = {
    heading: 'align-self: start;',
    para: 'align-self: start;',
    button: '',
    image: 'border-radius: clamp(8px, 1.5cqw, 20px);',
    badge: 'display: flex; align-items: center; gap: 0.6em; height: 100%; background: #fff; color: #141519; border-radius: clamp(6px, 1.2cqw, 14px); padding: 0 1.1em; font-size: clamp(11px, 1.15cqw, 14px); font-weight: 600; box-shadow: 0 14px 34px -12px rgba(0,0,0,0.55); white-space: nowrap;',
  };
  var isText = function (e) { return e.type === 'heading' || e.type === 'para'; };
  var fixedHeight = function (e) { return e.type === 'button' || e.type === 'image' || e.type === 'badge'; };

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
    curve: 'M0,120 C400,10 800,10 1200,120 Z',
    slant: 'M0,120 L1200,30 L1200,120 Z',
    peaks: 'M0,120 L300,50 L600,110 L900,40 L1200,120 Z',
  };
  function dividerBg(shape, color) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 120" preserveAspectRatio="none">' +
      '<path fill="' + color + '" d="' + DIVIDER_PATHS[shape] + '"/></svg>';
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
  }

  function buildCSS(els, scope, minH, opts) {
    opts = opts || {};
    var g = solve(els, minH);
    var rank = readingRank(els);
    var sec = '.gogh-section.' + scope;
    var out = [
      '/* generated by gogh */',
      '.gogh-wrap { container-type: inline-size; margin-block: 0 !important; }',
      sec + ' {',
      '  display: grid;',
      '  position: relative;',
      (function () {
        if (opts.bgImage) {
          var img = 'url("' + String(opts.bgImage).replace(/"/g, '%22') + '") center / cover no-repeat';
          if (opts.bg) {
            // palette-aware tint over the image keeps text readable in any
            // style variation (the tint follows the theme's own colours)
            var tint = 'color-mix(in srgb, ' + opts.bg + ' 62%, transparent)';
            return '  background: linear-gradient(' + tint + ', ' + tint + '), ' + img + ';';
          }
          return '  background: ' + img + ';';
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
    if (opts.divider && opts.divider.shape && opts.divColor && DIVIDER_PATHS[opts.divider.shape]) {
      // mask (not background-image) so the colour can be a CSS variable —
      // theme palette changes recolour dividers live
      var mask = dividerBg(opts.divider.shape, '#000');
      out.push(sec + '::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 8cqw; z-index: 0; pointer-events: none; background: ' + opts.divColor + '; ' +
        '-webkit-mask-image: ' + mask + '; mask-image: ' + mask + '; ' +
        '-webkit-mask-size: 100% 100%; mask-size: 100% 100%; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; }');
    }
    els.forEach(function (e, i) {
      var a = g.areas[i];
      var extra = TYPE_RULES[e.type];
      if (e.type === 'image') {
        extra += e.src ? ' overflow: hidden;' : ' ' + imageBackground(e);
      }
      if (e.rot) extra += ' transform: rotate(' + e.rot + 'deg);';
      if ((e.align === 'center' || e.align === 'right') && (e.type === 'heading' || e.type === 'para')) extra += ' text-align: ' + e.align + ';';
      if (e.type === 'button' && e.btnHover) {
        out.push(sec + ' .gogh-el-' + (i + 1) + ' .wp-block-button__link:hover { background-color: var(--wp--preset--color--' + e.btnHover + ') !important; }');
      }
      out.push(sec + ' .gogh-el-' + (i + 1) + ' { grid-area: ' + a.r1 + ' / ' + a.c1 + ' / ' + a.r2 + ' / ' + a.c2 +
        '; z-index: ' + (i + 1) + '; ' + extra + ' }');
      if (e.type === 'image' && e.src) {
        out.push(sec + ' .gogh-el-' + (i + 1) + ' img { width: 100%; height: 100%; object-fit: cover; display: block; border-radius: inherit; }');
      }
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
      out.push('  ' + sec + ' .gogh-el-' + (i + 1) + ' { grid-area: auto; grid-column: 2; order: ' + rank[i] + ';' +
        (e.type === 'image' ? ' aspect-ratio: ' + e.w + ' / ' + e.h + ';' : '') +
        (e.type === 'badge' ? ' width: max-content; height: 44px;' : '') + ' }');
    });
    out.push(
      '  ' + sec + ' .wp-block-button, ' + sec + ' .wp-block-button__link { width: max-content; height: 44px; padding: 0 24px; }',
      '}'
    );
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
      align: e.align || null, color: e.color || null,
      btnBg: e.btnBg || null, btnText: e.btnText || null, btnHover: e.btnHover || null };
  }
  function buildSectionBlocks(sec) {
    var els = sec.els;
    var inner = els.map(function (e, i) {
      var cls = 'gogh-el-' + (i + 1);
      switch (e.type) {
        case 'heading': {
          var hAttrs = { level: 2, className: cls };
          if (e.align === 'center' || e.align === 'right') hAttrs.textAlign = e.align;
          if (e.fs) hAttrs.fontSize = e.fs;
          if (e.color) hAttrs.textColor = e.color;
          return '<!-- wp:heading ' + JSON.stringify(hAttrs) + ' -->\n' +
            '<h2 class="wp-block-heading ' + (e.align === 'center' || e.align === 'right' ? 'has-text-align-' + e.align + ' ' : '') + cls + (e.fs ? ' has-' + e.fs + '-font-size' : '') + (e.color ? ' has-text-color has-' + e.color + '-color' : '') + '">' +
            cleanInline(e.text) + '</h2>\n<!-- /wp:heading -->';
        }
        case 'para': {
          var pAttrs = { className: cls };
          if (e.align === 'center' || e.align === 'right') pAttrs.align = e.align;
          if (e.fs) pAttrs.fontSize = e.fs;
          if (e.color) pAttrs.textColor = e.color;
          return '<!-- wp:paragraph ' + JSON.stringify(pAttrs) + ' -->\n' +
            '<p class="' + (e.align === 'center' || e.align === 'right' ? 'has-text-align-' + e.align + ' ' : '') + cls + (e.fs ? ' has-' + e.fs + '-font-size' : '') + (e.color ? ' has-text-color has-' + e.color + '-color' : '') + '">' +
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
      }
    }).join('\n\n');

    var json = JSON.stringify({
      version: 2, designW: W, minH: sec.minH || null,
      bg: sec.bg || null, divider: sec.divider || null,
      bgImage: sec.bgImage || null, bgId: sec.bgId || null,
      elements: els.map(projEl),
    }).replace(/</g, '\\u003c');

    return '<!-- wp:gogh/section -->\n' +
      '<div class="wp-block-gogh-section alignfull gogh-wrap">' +
      '<style class="gogh-style">' + buildCSS(els, sec.scope, sec.minH, sectionOpts(sec)) + '</style>' +
      '<script type="application/json" class="gogh-model">' + json + '</scr' + 'ipt>' +
      '<div class="gogh-section ' + sec.scope + '" data-gogh-scope="' + sec.scope + '">\n' +
      inner + '\n</div></div>\n' +
      '<!-- /wp:gogh/section -->';
  }
  function realSections() {
    return S.filter(function (s) { return !(s.bootstrap && !s.els.length); });
  }
  function buildAllBlocks() {
    return realSections().map(buildSectionBlocks).join('\n\n');
  }

  // ---------- element factory & rendering ----------
  // sanitize inline rich text to a safe subset: links, bold, italic, br.
  // Uses <template> so nothing in untrusted markup loads or executes.
  function cleanInline(html) {
    // self-contained: the boot-time collector calls this before mid-file
    // var assignments have run, so the allow-list must live inside
    var INLINE_OK = { A: 1, STRONG: 1, EM: 1, B: 1, I: 1, BR: 1 };
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
          [].slice.call(c.attributes).forEach(function (at) {
            if (!(tag === 'A' && at.name === 'href')) c.removeAttribute(at.name);
          });
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
      case 'heading':
        n = document.createElement('h2');
        n.className = 'wp-block-heading ' + cls + (e.fs ? ' has-' + e.fs + '-font-size' : '') + (e.color ? ' has-text-color has-' + e.color + '-color' : '');
        n.innerHTML = cleanInline(e.text);
        break;
      case 'para':
        n = document.createElement('p');
        n.className = cls + (e.fs ? ' has-' + e.fs + '-font-size' : '') + (e.color ? ' has-text-color has-' + e.color + '-color' : '');
        n.innerHTML = cleanInline(e.text);
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
      case 'badge':
        n = document.createElement('p');
        n.className = cls + ' gogh-badge';
        n.textContent = e.text;
        break;
    }
    return n;
  }

  function scaleOf(sec) { return sec.sectionEl.getBoundingClientRect().width / W; }
  function measureTextHeights(sec) {
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
    return { bg: sec.bg, divider: sec.divider, bgImage: sec.bgImage,
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
    sec.nodes = sec.els.map(function (e, i) {
      var n = makeNode(e, i);
      sec.sectionEl.appendChild(n);
      return n;
    });
    sec.nodes.forEach(function (n, i) { bindSelect(sec, i); });
    if (editing) sec.els.forEach(function (e, i) { bindEditable(sec, i, true); });
    resolveAndApply(sec);
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
    return { scope: scope, els: [], minH: null, bg: null, divider: null, bgImage: null, bgId: null, wrapEl: wrap, sectionEl: sectionEl, styleEl: styleEl, nodes: [] };
  }

  // ---------- history (undo/redo) ----------
  var history = [], hIdx = -1, textTimer = null;
  function serialize() {
    return JSON.stringify(S.map(function (sec) { return { scope: sec.scope, els: sec.els, minH: sec.minH || null, bg: sec.bg || null, divider: sec.divider || null, bgImage: sec.bgImage || null, bgId: sec.bgId || null, src: sec.srcSig || null, boot: sec.bootstrap || false }; }));
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
    refreshChip();
  }
  function restoreState(snap) {
    var data = JSON.parse(snap);
    // full rebuild, but each section goes back to its own DOM position so
    // non-gogh blocks interleaved with sections stay where they are
    var anchorOf = {};
    S.forEach(function (sec) {
      var n = sec.wrapEl.nextSibling;
      while (n && n.nodeType === 1 && n.classList && n.classList.contains('gogh-wrap')) n = n.nextSibling;
      anchorOf[sec.scope] = n;
    });
    S.forEach(function (sec) { sec.wrapEl.remove(); sec.styleEl.remove(); });
    var newS = [];
    var nextAnchor = endMarker;
    for (var di = data.length - 1; di >= 0; di--) {
      var d = data[di];
      var sec = newSectionShell(d.scope);
      sec.els = d.els;
      sec.minH = d.minH || null;
      sec.bg = d.bg || null;
      sec.divider = d.divider || null;
      sec.bgImage = d.bgImage || null;
      sec.bgId = d.bgId || null;
      sec.srcSig = d.src || null;
      sec.bootstrap = !!d.boot;
      var anchor = anchorOf[d.scope] ||
        (d.src && convertStash[d.src] && convertStash[d.src].marker.nextSibling) ||
        nextAnchor;
      pageParent.insertBefore(sec.wrapEl, anchor);
      nextAnchor = sec.wrapEl;
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

  var side = document.createElement('div');
  side.className = 'gogh-side';
  side.hidden = true;
  side.innerHTML =
    '<div class="gogh-side-head">' +
    '<span class="gogh-side-title">gogh</span>' +
    '<button type="button" class="gogh-sbtn gogh-theme" data-act="uitheme" title="Editor theme"></button>' +
    '<button type="button" class="gogh-sbtn gogh-close" title="Finish editing">✕</button>' +
    '</div>' +
    '<div class="gogh-side-row">' +
    '<button type="button" class="gogh-sbtn gogh-undo" title="Undo (⌘Z)">↺</button>' +
    '<button type="button" class="gogh-sbtn gogh-redo" title="Redo (⇧⌘Z)">↻</button>' +
    '</div>' +
    '<div class="gogh-side-label">Add element</div>' +
    '<button type="button" class="gogh-sitem" data-add="heading">Heading</button>' +
    '<button type="button" class="gogh-sitem" data-add="para">Text</button>' +
    '<button type="button" class="gogh-sitem" data-add="button">Button</button>' +
    '<button type="button" class="gogh-sitem" data-add="image">Image</button>' +
    '<button type="button" class="gogh-sitem" data-add="badge">Badge</button>' +
    '<div class="gogh-side-label">Page</div>' +
    '<button type="button" class="gogh-sitem" data-act="addsec">+ Section</button>' +
    '<button type="button" class="gogh-sitem" data-act="gridsnap" title="Show an 8-unit grid and snap to it">Grid: off</button>' +
    '<div class="gogh-side-gap"></div>';
  document.body.appendChild(side);

  // tuck-away drawer: slim edge tab when collapsed, slide-in on hover
  var sideTab = document.createElement('button');
  sideTab.type = 'button';
  sideTab.className = 'gogh-side-tab';
  sideTab.title = 'gogh palette';
  sideTab.innerHTML = '<span class="gogh-side-tab-dot"></span><span>gogh</span>';
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
    var order = [null].concat(sizes.map(function (f) { return f.slug; }));
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
    var order = [null].concat(sizes.map(function (f) { return f.slug; }));
    var idx = order.indexOf(e.fs || null);
    var next = Math.max(0, Math.min(order.length - 1, idx + delta));
    if (order[next] === (e.fs || null)) return;
    e.fs = order[next];
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
    return out;
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

  var editing = false;
  var sel = null; // {sec, i}

  function nodeBox(node) {
    var w = node.offsetWidth, h = node.offsetHeight;
    var r = node.getBoundingClientRect();
    return { x: r.left + window.scrollX + r.width / 2 - w / 2,
             y: r.top + window.scrollY + r.height / 2 - h / 2, w: w, h: h };
  }
  function hideHandles() { grip.hidden = selBox.hidden = elbar.hidden = true; }
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
    if (e.type === 'button' || e.type === 'image') {
      ctxBtn.innerHTML = CTX_ICONS[e.type === 'button' ? 'link' : 'image'];
      ctxBtn.title = e.type === 'button' ? 'Button link' : 'Choose image';
      ctxBtn.style.display = '';
    } else {
      ctxBtn.style.display = 'none';
    }
    if (isText(e)) {
      fsBtn.textContent = 'Aa' + (e.fs ? ' · ' + e.fs : '');
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
    if (gx !== null) {
      guideV.style.left = (r.left + window.scrollX + gx * s) + 'px';
      guideV.style.top = (r.top + window.scrollY) + 'px';
      guideV.style.height = r.height + 'px';
      guideV.hidden = false;
    } else guideV.hidden = true;
    if (gy !== null) {
      guideH.style.top = (r.top + window.scrollY + gy * s) + 'px';
      guideH.style.left = (r.left + window.scrollX) + 'px';
      guideH.style.width = r.width + 'px';
      guideH.hidden = false;
    } else guideH.hidden = true;
  }

  // Canva-style pointer model: click selects, drag-from-anywhere moves,
  // a second click (or a click while selected) enters text editing.
  var pendingDrag = null;
  var textEditing = null; // {sec, i, node, target}
  function enterTextEdit(sec, i, ev) {
    var t = editableTarget(sec, i);
    if (!t) return;
    exitTextEdit();
    var e = sec.els[i];
    t.contentEditable = (e.type === 'heading' || e.type === 'para') ? 'true' : 'plaintext-only';
    sec.nodes[i].classList.add('gogh-textedit');
    textEditing = { sec: sec, i: i, node: sec.nodes[i], target: t };
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
    var t = textEditing.target;
    t.contentEditable = 'false';
    if (textEditing.node.classList) textEditing.node.classList.remove('gogh-textedit');
    if (document.activeElement === t) t.blur();
    textEditing = null;
  }
  function bindSelect(sec, i) {
    var node = sec.nodes[i];
    node.addEventListener('dragstart', function (ev) { if (editing) ev.preventDefault(); });
    node.addEventListener('pointerdown', function (ev) {
      if (!editing || drag || resize) return;
      if (textEditing && textEditing.node === node) return; // native caret/selection
      if (textEditing) exitTextEdit();
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

  function setEditing(on) {
    editing = on;
    document.documentElement.classList.toggle('gogh-editing', on);
    side.hidden = !on;
    sideTab.hidden = !on;
    if (on) {
      // greet with the palette open, then tuck it away
      openSide();
      sideTimer = setTimeout(function () { closeSide(true); }, 1800);
    } else {
      closeSide(true);
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
    if (on) placeConvertBtns(); else clearConvertBtns();
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
  function closePanel() { panel.hidden = true; panelOpen = false; }
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
    if (top > maxTop) top = Math.max(window.scrollY + 16, maxTop);
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

  function buildLinkPanel(sec, i) {
    var e = sec.els[i];
    function swRow(label, key) {
      return '<div class="gogh-swlab">' + label + '</div><div class="gogh-swrow" data-key="' + key + '">' +
        '<button type="button" class="gogh-sw gogh-sw-none' + (!e[key] ? ' is-active' : '') + '" data-col="" title="Theme default"></button>' +
        themePalette().map(function (p) {
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
    function reapply() {
      renderSection(sec);
      placeHandles(sec, i);
      pushState();
      buildLinkPanel(sec, i); // rebuild so active states stay honest
    }
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
    fetch(cfg.mediaUrl + '?per_page=12&media_type=image&orderby=date&order=desc', {
      headers: { 'X-WP-Nonce': cfg.nonce },
      credentials: 'same-origin',
    }).then(function (res) { return res.ok ? res.json() : []; })
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
    var sec = sel.sec, i = sel.i, j = i + dir;
    if (j < 0 || j >= sec.els.length) return;
    var t = sec.els[i];
    sec.els[i] = sec.els[j];
    sec.els[j] = t;
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
      themePalette().map(function (p) {
        return '<button type="button" class="gogh-sw' + (e.color === p.slug ? ' is-active' : '') + '" data-col="' + p.slug + '"' +
          ' style="background: var(--wp--preset--color--' + p.slug + ')" title="' + p.slug + '"></button>';
      }).join('') + '</div>';
    panel.querySelectorAll('.gogh-sw').forEach(function (swBtn) {
      swBtn.addEventListener('click', function () {
        e.color = swBtn.dataset.col || null;
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
  var DEFAULTS = {
    heading: function () { return { type: 'heading', x: 80, y: 80, w: 420, h: 60, text: 'A new heading', ghost: false, cool: false }; },
    para: function () { return { type: 'para', x: 80, y: 200, w: 380, h: 50, text: 'Some supporting copy. Drag me anywhere.', ghost: false, cool: false }; },
    button: function () { return { type: 'button', x: 80, y: 320, w: 170, h: 52, text: 'Click me', ghost: false, cool: false }; },
    image: function () { return { type: 'image', x: 520, y: 120, w: 360, h: 260, text: null, ghost: false, cool: true }; },
    badge: function () { return { type: 'badge', x: 520, y: 420, w: 220, h: 52, text: 'New badge', ghost: false, cool: false }; },
  };
  function addElement(sec, e) {
    sec.els.push(e);
    renderSection(sec);
    placeHandles(sec, sec.els.length - 1);
    pushState();
  }
  function deleteSelected() {
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
  function addElementAtViewport(kind) {
    var e = DEFAULTS[kind]();
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
    addElement(sec, e);
  }
  side.querySelectorAll('[data-add]').forEach(function (btn) {
    btn.addEventListener('click', function () { addElementAtViewport(btn.dataset.add); });
  });
  elbar.querySelector('.gogh-eb-del').addEventListener('click', deleteSelected);
  side.querySelector('[data-act="addsec"]').addEventListener('click', function () { openPicker(S.length); });
  side.querySelector('[data-act="gridsnap"]').addEventListener('click', function (ev) {
    gridSnapOn = !gridSnapOn;
    // the grid you snap to is the grid you see — never invisible magnets
    document.documentElement.classList.toggle('gogh-grid-on', gridSnapOn);
    ev.target.textContent = 'Grid: ' + (gridSnapOn ? 'on' : 'off');
  });
  var THEME_ICONS = {
    sun: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="4.4"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5 5l1.8 1.8M17.2 17.2 19 19M19 5l-1.8 1.8M6.8 17.2 5 19"/></svg>',
    moon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>',
  };
  function syncThemeBtn() {
    var light = document.documentElement.classList.contains('gogh-ui-light');
    var b = side.querySelector('.gogh-theme');
    b.innerHTML = light ? THEME_ICONS.moon : THEME_ICONS.sun;
    b.dataset.tip = light ? 'Dark editor' : 'Light editor';
    b.removeAttribute('title');
  }
  side.querySelector('.gogh-theme').addEventListener('click', function () {
    var light = !document.documentElement.classList.contains('gogh-ui-light');
    try { localStorage.setItem('gogh-ui-theme', light ? 'light' : 'dark'); } catch (e) {}
    document.documentElement.classList.toggle('gogh-ui-light', light);
    syncThemeBtn();
  });
  side.querySelector('.gogh-undo').addEventListener('click', undo);
  side.querySelector('.gogh-redo').addEventListener('click', redo);

  // ---------- section templates & picker ----------
  var TEMPLATES = [
    // fs '__max' resolves to the theme's largest font-size preset at insert
    { name: 'Hero', minH: 640,
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
    { name: 'Hero — centered', minH: 600,
      bg: 'color-mix(in srgb, var(--wp--preset--color--contrast, currentColor) 5%, var(--wp--preset--color--base, transparent))',
      els: [
      { type: 'badge', x: 500, y: 92, w: 200, h: 52, text: 'New for 2026' },
      { type: 'heading', x: 200, y: 176, w: 800, h: 160, text: 'Big ideas, front and centre', fs: '__max', align: 'center' },
      { type: 'para', x: 320, y: 372, w: 560, h: 60, text: 'One clear promise, a little supporting warmth, and nothing in the way.', align: 'center' },
      { type: 'button', x: 400, y: 470, w: 190, h: 56, text: 'Start free' },
      { type: 'button', x: 610, y: 470, w: 190, h: 56, text: 'Take the tour', ghost: true },
    ]},
    { name: 'Split', els: [
      { type: 'image', x: 72, y: 72, w: 500, h: 400, cool: true },
      { type: 'heading', x: 644, y: 120, w: 480, h: 100, text: 'Show the thing, then say the thing' },
      { type: 'para', x: 644, y: 264, w: 440, h: 78, text: 'A classic split layout: image on one side, message on the other. Swap sides by dragging.' },
      { type: 'button', x: 644, y: 380, w: 190, h: 52, text: 'See details' },
    ]},
    { name: 'Features', els: [
      { type: 'heading', x: 300, y: 72, w: 600, h: 60, text: 'Three reasons to care' },
      { type: 'image', x: 72, y: 190, w: 328, h: 180 },
      { type: 'image', x: 436, y: 190, w: 328, h: 180, cool: true },
      { type: 'image', x: 800, y: 190, w: 328, h: 180 },
      { type: 'para', x: 72, y: 396, w: 328, h: 60, text: 'First feature, briefly and confidently described.' },
      { type: 'para', x: 436, y: 396, w: 328, h: 60, text: 'Second feature, briefly and confidently described.' },
      { type: 'para', x: 800, y: 396, w: 328, h: 60, text: 'Third feature, briefly and confidently described.' },
    ]},
    { name: 'Call to action',
      bg: 'color-mix(in srgb, var(--wp--preset--color--contrast, currentColor) 8%, var(--wp--preset--color--base, transparent))',
      els: [
      { type: 'heading', x: 300, y: 120, w: 600, h: 60, text: 'Ready when you are', align: 'center' },
      { type: 'para', x: 350, y: 220, w: 500, h: 55, text: 'One last nudge. Keep it short, keep it warm.', align: 'center' },
      { type: 'button', x: 511, y: 330, w: 178, h: 52, text: 'Start now' },
    ]},
    { name: 'Start from scratch', els: [] },
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

  function closePicker() { picker.hidden = true; }
  function openPicker(idx) {
    pickerIdx = idx;
    var cards = TEMPLATES.map(function (tpl, t) {
      var els = tplEls(tpl);
      var scope = 'gogh-tpl-' + t;
      var css = els.length ? buildCSS(els, scope, tpl.minH || null, { bg: tpl.bg || null }) : '';
      var inner = els.map(function (e, i) { return makeNode(e, i).outerHTML; }).join('');
      return '<button type="button" class="gogh-card" data-tpl="' + t + '">' +
        '<span class="gogh-card-prev"><style>' + css + '</style>' +
        '<span class="gogh-card-stage gogh-wrap"><span class="gogh-card-sec gogh-section ' + scope + '">' + inner + '</span></span>' +
        '</span>' +
        '<span class="gogh-card-name">' + tpl.name + '</span>' +
        '</button>';
    }).join('');
    picker.innerHTML =
      '<div class="gogh-picker-inner">' +
      '<div class="gogh-picker-head">Add a section' +
      '<button type="button" class="gogh-btn gogh-btn-small gogh-picker-close">Close</button></div>' +
      '<div class="gogh-cards">' + cards + '</div>' +
      '</div>';
    picker.hidden = false;
    picker.querySelector('.gogh-picker-close').addEventListener('click', closePicker);
    picker.addEventListener('pointerdown', function (ev) {
      if (ev.target === picker) closePicker();
    });
    picker.querySelectorAll('.gogh-card').forEach(function (card) {
      card.addEventListener('click', function () {
        addSection(TEMPLATES[+card.dataset.tpl], pickerIdx);
        closePicker();
      });
    });
    picker.querySelectorAll('.gogh-card-prev').forEach(function (p) {
      var st = p.querySelector('.gogh-card-stage');
      if (st) st.style.transform = 'scale(' + (p.clientWidth / 1200) + ')';
    });
  }

  function addSection(tpl, idx) {
    if (idx == null) idx = S.length;
    var sec = newSectionShell('gogh-sec-' + (scopeSeq++));
    sec.els = tplEls(tpl);
    sec.minH = tpl.minH || null;
    sec.bg = tpl.bg || null;
    var anchor = idx < S.length ? S[idx].wrapEl : endMarker;
    pageParent.insertBefore(sec.wrapEl, anchor);
    S.splice(idx, 0, sec);
    // a real section replaces the ?gogh-edit bootstrap placeholder
    for (var bi = S.length - 1; bi >= 0; bi--) {
      if (S[bi].bootstrap && !S[bi].els.length && S[bi] !== sec) {
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
    ];
    TEMPLATES.forEach(function (t, ti) {
      if (t.els.length) items.push({ label: t.name + ' \u00b7 section', tpl: ti });
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
    hbar.style.left = (r.left + window.scrollX) + 'px';
    hbar.style.width = r.width + 'px';
    hbar.style.top = (r.bottom + window.scrollY) + 'px';
    hbar.hidden = false;
    hgrip.style.left = (r.left + r.width / 2 + window.scrollX) + 'px';
    hgrip.style.top = (r.bottom + window.scrollY) + 'px';
    hgrip.hidden = false;
  }
  function hideHbar() { hbar.hidden = hgrip.hidden = true; hbarSec = null; }

  var hDrag = null, hRaf = false;
  hgrip.addEventListener('pointerdown', function (ev) {
    if (!editing || !hbarSec) return;
    ev.preventDefault();
    try { hgrip.setPointerCapture(ev.pointerId); } catch (err) {}
    hDrag = { sec: hbarSec, py: ev.clientY, h: designH(hbarSec.els, hbarSec.minH) };
    document.documentElement.classList.add('gogh-dragging');
    inserter.hidden = true;
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
    if (S.length <= 1 || !S[idx]) return;
    var st = S[idx].srcSig && convertStash[S[idx].srcSig];
    S[idx].wrapEl.remove();
    S[idx].styleEl.remove();
    // deleting a converted section reverts it to the original Gutenberg block
    if (st && !st.node.parentNode) pageParent.insertBefore(st.node, st.marker.nextSibling);
    S.splice(idx, 1);
    sel = null;
    hideHandles();
    hideHbar();
    closePanel();
    hideSecBar();
    resolveAll();
    pushState();
  }
  function moveSection(idx, dir) {
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
  function duplicateSection(idx) {
    var srcSec = S[idx];
    if (!srcSec) return;
    var sec = newSectionShell('gogh-sec-' + (scopeSeq++));
    sec.els = JSON.parse(JSON.stringify(srcSec.els));
    sec.minH = srcSec.minH;
    sec.bg = srcSec.bg;
    sec.divider = srcSec.divider ? JSON.parse(JSON.stringify(srcSec.divider)) : null;
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
    '<button type="button" class="gogh-sb" data-sec="up" title="Move up">↑</button>' +
    '<button type="button" class="gogh-sb" data-sec="down" title="Move down">↓</button>' +
    '<button type="button" class="gogh-sb" data-sec="bgimg" title="Background image">' + CTX_ICONS.image + '</button>' +
    '<button type="button" class="gogh-sb" data-sec="dup" title="Duplicate section">⧉</button>' +
    '<button type="button" class="gogh-sb gogh-sb-del" data-sec="del" title="Delete section">🗑</button>';
  secBar.hidden = true;
  document.body.appendChild(secBar);
  var secBarIdx = null;

  function hideSecBar() { secBar.hidden = true; secBarIdx = null; }
  function showSecBar(idx) {
    secBarIdx = idx;
    var r = S[idx].wrapEl.getBoundingClientRect();
    secBar.style.left = (r.right + window.scrollX - 16) + 'px';
    secBar.style.top = (r.top + window.scrollY + 14) + 'px';
    secBar.querySelector('[data-sec="up"]').disabled = idx === 0;
    secBar.querySelector('[data-sec="down"]').disabled = idx === S.length - 1;
    secBar.querySelector('[data-sec="del"]').disabled = S.length <= 1;
    secBar.hidden = false;
  }
  secBar.addEventListener('click', function (ev) {
    var b = ev.target.closest('.gogh-sb');
    if (!b || secBarIdx === null) return;
    if (b.dataset.sec === 'bgimg') { openSecBgPanel(secBarIdx); return; }
    if (b.dataset.sec === 'del') deleteSection(secBarIdx);
    else if (b.dataset.sec === 'up') moveSection(secBarIdx, -1);
    else if (b.dataset.sec === 'down') moveSection(secBarIdx, 1);
    else if (b.dataset.sec === 'dup') duplicateSection(secBarIdx);
  });

  function setSecBg(idx, src, id) {
    S[idx].bgImage = src || null;
    S[idx].bgId = src ? (id || null) : null;
    resolveAll();
    closePanel();
    pushState();
  }
  function openSecBgPanel(idx) {
    var secx = S[idx];
    var r = secx.wrapEl.getBoundingClientRect();
    panel.style.left = Math.max(8, r.right + window.scrollX - 360) + 'px';
    panel.style.top = (r.top + window.scrollY + 52) + 'px';
    panel.innerHTML =
      '<div class="gogh-panel-title">Section background image</div>' +
      '<div class="gogh-panel-row">' +
      '<input type="url" class="gogh-input" placeholder="Paste image URL…" />' +
      '<button type="button" class="gogh-btn gogh-btn-small gogh-apply">Apply</button>' +
      '</div>' +
      (secx.bgImage ? '<div class="gogh-panel-row gogh-panel-actions"><button type="button" class="gogh-btn gogh-btn-small gogh-clear">Remove image</button></div>' : '') +
      '<div class="gogh-media"><span class="gogh-media-loading">Loading media…</span></div>';
    panel.hidden = false;
    panelOpen = true;
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
    fetch(cfg.mediaUrl + '?per_page=12&media_type=image&orderby=date&order=desc', {
      headers: { 'X-WP-Nonce': cfg.nonce },
      credentials: 'same-origin',
    }).then(function (res) { return res.ok ? res.json() : []; })
      .then(function (items) {
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
          b.addEventListener('click', function () { setSecBg(idx, item.source_url, item.id); });
          box.appendChild(b);
        });
        reclampPanel();
      });
  }

  // ---------- divider / colours chooser at boundaries ----------
  var shapeBtn = document.createElement('button');
  shapeBtn.type = 'button';
  shapeBtn.className = 'gogh-shapebtn';
  shapeBtn.textContent = '◠ Shape';
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
    ];
    shapePanel.innerHTML =
      '<div class="gogh-panel-title">Section divider</div>' +
      '<div class="gogh-shapes">' +
      shapes.map(function (sh) {
        return '<button type="button" class="gogh-shape' + (sh.key === current ? ' is-active' : '') + '" data-shape="' + sh.key + '" title="' + sh.label + '">' +
          '<svg viewBox="0 0 1200 120" preserveAspectRatio="none"><path d="' + sh.path + '"/></svg>' +
          '<span>' + sh.label + '</span></button>';
      }).join('') +
      '</div>' +
      '<div class="gogh-panel-row gogh-panel-actions">' +
      '<label class="gogh-colorlab">Above <input type="color" class="gogh-color gogh-color-above" /></label>' +
      '<label class="gogh-colorlab">Below <input type="color" class="gogh-color gogh-color-below" /></label>' +
      '</div>' +
      (function () {
        var pal = themePalette();
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
      })();
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
      for (var idx = 0; idx <= S.length; idx++) {
        var by = idx < S.length
          ? S[idx].wrapEl.getBoundingClientRect().top
          : S[S.length - 1].wrapEl.getBoundingClientRect().bottom;
        if (Math.abs(cy - by) < 28) { found = { idx: idx, y: by }; break; }
      }
      if (found) {
        insertIdx = found.idx;
        inserter.style.left = '50%';
        // the height pill (44px) occupies the centre of every boundary except
        // the very top one — flank it symmetrically: Shape's right edge and
        // + Section's left edge each 18px from the pill (22 + 18 = 40)
        inserter.style.transform = found.idx >= 1 ? 'translate(0, -50%)' : 'translate(-50%, -50%)';
        inserter.style.marginLeft = found.idx >= 1 ? '40px' : '0';
        inserter.style.top = (found.y + window.scrollY) + 'px';
        inserter.hidden = false;
        if (found.idx >= 1) placeHbar(S[found.idx - 1]); else hideHbar();
        if (found.idx >= 1 && found.idx < S.length) {
          shapeIdx = found.idx;
          shapeBtn.style.left = 'calc(50% - 40px)';
          shapeBtn.style.top = (found.y + window.scrollY) + 'px';
          shapeBtn.hidden = false;
        } else {
          shapeBtn.hidden = true;
        }
        hideSecBar();
      } else {
        if (!inserter.matches(':hover')) inserter.hidden = true;
        if (!hgrip.matches(':hover')) hideHbar();
        if (!shapeBtn.matches(':hover')) shapeBtn.hidden = true;
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
    openPicker(insertIdx == null ? S.length : insertIdx);
  });

  // ---------- dragging with ghost (no cursor drift) ----------
  var drag = null, dragRaf = false;
  var ghost = null;
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
    ghost.style.cssText = 'position:fixed;display:block;background:transparent;container-type:normal;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;';
    ghost.appendChild(inner);
    document.body.appendChild(ghost);
    node.classList.add('gogh-dragsrc');
    dropBox.hidden = false;
    drag = { sec: sec, i: i, px: ev.clientX, py: ev.clientY, x: e.x, y: e.y, gx: r.left, gy: r.top };
    document.documentElement.classList.add('gogh-dragging');
    hideHandles();
  }
  grip.addEventListener('pointerdown', function (ev) {
    ev.preventDefault();
    beginDrag(ev);
  });
  document.addEventListener('pointermove', function (ev) {
    if (!drag) return;
    var dx = ev.clientX - drag.px, dy = ev.clientY - drag.py;
    var lockX = false, lockY = false;
    if (ev.shiftKey) {
      // constrain to the dominant axis — the locked axis is PINNED (no snap)
      if (Math.abs(dx) > Math.abs(dy)) { dy = 0; lockY = true; }
      else { dx = 0; lockX = true; }
    }
    if (ghost) ghost.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    var free = ev.metaKey || ev.ctrlKey;
    var sec = drag.sec;
    var s = scaleOf(sec);
    var e = sec.els[drag.i];
    var rx = Math.max(0, Math.min(W - e.w, drag.x + dx / s));
    var ry = Math.max(0, drag.y + dy / s);
    var sn = snapPos(sec, e, rx, ry, e.w, e.h, free);
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
      });
    }
  });
  function endDrag() {
    if (!drag) return;
    var sec = drag.sec, i = drag.i;
    var gxCapD = !!drag.gxCap, gyCapD = !!drag.gyCap;
    var eqHD = !!drag.eqH, eqVD = !!drag.eqV;
    var lockedXD = !!drag.lockedX, lockedYD = !!drag.lockedY;
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
      for (var pass = 0; pass < 2; pass++) {
        var b = nodeBox(sec.nodes[i]);
        var dDesign = Math.round((ghostTop - b.y) / scaleOf(sec));
        if (Math.abs(dDesign) < 3) break;
        sec.els[i].y = Math.max(0, sec.els[i].y + dDesign);
        resolveAndApply(sec);
      }
    }
    // the visible grid is a promise: axes the grid governed at release must
    // land ON it (alignment/equal-spacing/shift-locked axes keep their own
    // promises and are left alone)
    if (gridSnapOn) {
      var eDrop = sec.els[i];
      if (!gxCapD && !eqHD && !lockedXD) eDrop.x = Math.max(0, Math.min(W - eDrop.w, Math.round(eDrop.x / BASE) * BASE));
      if (!gyCapD && !eqVD && !lockedYD) eDrop.y = Math.max(0, Math.round(eDrop.y / BASE) * BASE);
      resolveAndApply(sec);
    }
    placeHandles(sec, i);
    pushState();
  }
  document.addEventListener('pointerup', function () { if (drag) endDrag(); });
  document.addEventListener('pointercancel', function () { if (drag) endDrag(); });

  var gridSnapOn = false; // opt-in: invisible magnets feel broken to beginners

  // editor chrome theme: follows the system unless the user chose one
  function applyUiTheme() {
    var saved = null;
    try { saved = localStorage.getItem('gogh-ui-theme'); } catch (e) {}
    var light = saved === 'light'; // dark is gogh's default
    document.documentElement.classList.toggle('gogh-ui-light', light);
    return light;
  }
  applyUiTheme();
  syncThemeBtn();
  function snapPos(sec, exclude, x, y, w, h, free) {
    if (free) return { x: Math.round(x), y: Math.round(y), gx: null, gy: null };
    var H = designH(sec.els, sec.minH);
    var candX = [0, W, W / 2], candY = [0, H, H / 2];
    sec.els.forEach(function (o) {
      if (o === exclude) return;
      candX.push(o.x, o.x + o.w, o.x + o.w / 2);
      candY.push(o.y, o.y + o.h, o.y + o.h / 2);
    });
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
    var yEdges = h > 0
      ? [{ v: y, off: 0 }, { v: y + h, off: h }, { v: y + h / 2, off: h / 2 }]
      : [{ v: y, off: 0 }];
    var sx = best(xEdges, candX);
    var sy = best(yEdges, candY);
    return {
      x: sx ? Math.round(sx.v) : (gridSnapOn ? Math.round(x / BASE) * BASE : Math.round(x)),
      y: sy ? Math.round(sy.v) : (gridSnapOn ? Math.round(y / BASE) * BASE : Math.round(y)),
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
      resize = { sec: sec, i: sel.i, dir: dir, px: ev.clientX, py: ev.clientY,
        x: e.x, y: e.y, w: e.w, h: e.h, candX: candX, candY: candY };
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
        sizeChip.textContent = e.fs ? e.fs : 'theme default';
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
  window.__gogh = {
    get state() {
      return { editing: editing, sections: S.length, sel: sel ? { i: sel.i } : null,
        drag: !!drag, resize: !!resize, history: history.length, hIdx: hIdx };
    },
    sections: function () { return S; },
    showHbar: function (i) { placeHbar(S[i]); },
    openShapePanel: openShapePanel,
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
    convertScan: convertScan,
    convertBlock: convertBlock,
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
    mergeContent: mergeContent,
  };
  document.dispatchEvent(new CustomEvent('gogh:ready'));

  // ---------- keyboard ----------
  window.addEventListener('keydown', function (ev) {
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
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && sel) {
      ev.preventDefault();
      deleteSelected();
      return;
    }
    if (!sel || !/^Arrow/.test(ev.key)) return;
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
  var tipEl = document.createElement('div');
  tipEl.className = 'gogh-tip';
  tipEl.hidden = true;
  document.body.appendChild(tipEl);
  var tipTimer = null;
  var tipVisibleUntil = 0;
  function showTipNow(el) {
    var text = el.getAttribute('title') || el.dataset.tip || '';
    if (el.getAttribute('title')) {
      el.dataset.tip = el.getAttribute('title');
      el.removeAttribute('title'); // suppress the native tooltip
      text = el.dataset.tip;
    }
    if (!text) return;
    tipEl.textContent = text;
    tipEl.hidden = false;
    var r = el.getBoundingClientRect();
    var tw = tipEl.offsetWidth;
    var left = Math.max(6, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 6));
    var top = r.bottom + 8;
    if (top + tipEl.offsetHeight > window.innerHeight - 6) top = r.top - tipEl.offsetHeight - 8;
    tipEl.style.left = left + 'px';
    tipEl.style.top = top + 'px';
  }
  function hideTip() {
    clearTimeout(tipTimer);
    if (!tipEl.hidden) tipVisibleUntil = Date.now() + 400;
    tipEl.hidden = true;
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
  document.addEventListener('pointerdown', hideTip, true);
  document.addEventListener('scroll', hideTip, true);

  // ---------- publish state: status chip, toasts, exit panel ----------
  var savedSnap = null;
  var rawCache = null;     // last-known stored content (context=edit)
  var lastAutoSnap = null; // last state backed up to the WP autosave revision
  var backedUp = false;
  var discarding = false;

  function isDirty() { return savedSnap !== null && serialize() !== savedSnap; }

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
        body: JSON.stringify({ content: mergeContent(raw) }),
      });
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (post) {
      if (post.content && post.content.raw) rawCache = post.content.raw;
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
  side.querySelector('.gogh-close').addEventListener('click', function () {
    refreshChip(); // text re-measures can dirty the model without a pushState
    if (isDirty()) { exitPanel.hidden = false; return; }
    setEditing(false);
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
    var snap = serialize();
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
      divider: d.divider || null, bgImage: d.bgImage || null, bgId: d.bgId || null };
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
  function convertScan(root) {
    var out = { els: [], bad: [] };
    var rr = root.getBoundingClientRect();
    if (rr.width < 10) return out;
    var sx = W / rr.width;
    function leaf(el, e) {
      var r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      e.x = Math.max(0, Math.round((r.left - rr.left) * sx));
      e.y = Math.max(0, Math.round((r.top - rr.top) * sx));
      e.w = Math.max(16, Math.round(r.width * sx));
      e.h = Math.max(16, Math.round(r.height * sx));
      var fm = (el.className + '').match(/has-([a-z0-9-]+)-font-size/);
      if (fm) e.fs = fm[1];
      var am = (el.className + '').match(/has-text-align-(center|right)/);
      if (am) e.align = am[1];
      var cm = (el.className + '').match(/has-([a-z0-9-]+)-color/g);
      if (cm) {
        for (var ci = 0; ci < cm.length; ci++) {
          var cslug = cm[ci].replace(/^has-/, '').replace(/-color$/, '');
          if (cslug !== 'text' && cslug.indexOf('background') === -1 && cslug !== 'link') { e.color = cslug; break; }
        }
      }
      out.els.push(e);
    }
    function walk(el) {
      [].slice.call(el.children).forEach(function (c) {
        var cl = c.classList, tag = c.tagName;
        if (/^H[1-6]$/.test(tag)) return leaf(c, { type: 'heading', text: cleanInline(c.innerHTML).trim() });
        if (tag === 'P') return leaf(c, { type: 'para', text: cleanInline(c.innerHTML).trim() });
        if (cl.contains('wp-block-buttons')) {
          [].slice.call(c.querySelectorAll('.wp-block-button')).forEach(function (b) {
            var a = b.querySelector('a');
            var lc = (a && a.className) || '';
            var bgm = lc.match(/has-([a-z0-9-]+)-background-color/);
            var txm = lc.replace(/has-[a-z0-9-]+-background-color/g, '').match(/has-((?!text-color)[a-z0-9-]+)-color/);
            leaf(b, { type: 'button',
              text: ((a || b).textContent || '').trim(),
              href: (a && a.getAttribute('href') && a.getAttribute('href') !== '#') ? a.getAttribute('href') : null,
              btnBg: bgm ? bgm[1] : null,
              btnText: txm ? txm[1] : null,
              ghost: b.className.indexOf('is-style-outline') !== -1 });
          });
          return;
        }
        if (tag === 'FIGURE' && cl.contains('wp-block-image')) {
          var img = c.querySelector('img');
          var e = { type: 'image' };
          if (img) {
            e.src = img.currentSrc || img.src || null;
            e.alt = img.alt || null;
            var mm = (img.className || '').match(/wp-image-(\d+)/);
            e.mediaId = mm ? +mm[1] : null;
          }
          return leaf(c, e);
        }
        // pure layout / decoration: nothing to carry over
        if (cl.contains('wp-block-spacer') || tag === 'HR' ||
            cl.contains('wp-block-cover__background') ||
            cl.contains('wp-block-cover__image-background') || tag === 'VIDEO') return;
        // containers: flatten
        if (cl.contains('wp-block-group') || cl.contains('wp-block-columns') ||
            cl.contains('wp-block-column') || cl.contains('wp-block-cover') ||
            cl.contains('wp-block-cover__inner-container') || !c.className) return walk(c);
        if ((c.textContent || '').trim() || c.querySelector('img')) {
          out.bad.push((c.className + '').split(' ')[0] || tag.toLowerCase());
        }
      });
    }
    // the clicked block may itself be a single leaf (a bare paragraph,
    // heading, image or buttons row) rather than a container
    var rtag = root.tagName, rcl = root.classList;
    if (/^H[1-6]$/.test(rtag)) leaf(root, { type: 'heading', text: cleanInline(root.innerHTML).trim() });
    else if (rtag === 'P') leaf(root, { type: 'para', text: cleanInline(root.innerHTML).trim() });
    else if (rcl.contains('wp-block-buttons')) {
      [].slice.call(root.querySelectorAll('.wp-block-button')).forEach(function (b) {
        var a = b.querySelector('a');
        leaf(b, { type: 'button',
          text: ((a || b).textContent || '').trim(),
          href: (a && a.getAttribute('href') && a.getAttribute('href') !== '#') ? a.getAttribute('href') : null,
          ghost: b.className.indexOf('is-style-outline') !== -1 });
      });
    } else if (rtag === 'FIGURE' && rcl.contains('wp-block-image')) {
      var rimg = root.querySelector('img');
      var re2 = { type: 'image' };
      if (rimg) {
        re2.src = rimg.currentSrc || rimg.src || null;
        re2.alt = rimg.alt || null;
        var rmm = (rimg.className || '').match(/wp-image-(\d+)/);
        re2.mediaId = rmm ? +rmm[1] : null;
      }
      leaf(root, re2);
    } else walk(root);
    return out;
  }

  // non-gogh top-level blocks eligible for conversion
  function topBlockNodes() {
    return [].slice.call(pageParent.children).filter(function (n) {
      return n.nodeType === 1 && !n.classList.contains('gogh-wrap');
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
      var scan = convertScan(node);
      if (scan.bad.length) {
        var uniq = scan.bad.filter(function (v, i, a) { return a.indexOf(v) === i; });
        throw new Error('This block contains content gogh can\u2019t edit yet: ' + uniq.join(', '));
      }
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
      if (!sec.bg) {
        var rc = getComputedStyle(node).backgroundColor;
        if (rc && rc !== 'rgba(0, 0, 0, 0)' && rc !== 'transparent') sec.bg = rc;
      }
      sec.srcSig = sigOf(raw.slice(freeSpans[idx].start, freeSpans[idx].end));
      var marker = document.createComment('gogh-src');
      pageParent.insertBefore(marker, node);
      convertStash[sec.srcSig] = { node: node, marker: marker };
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

  // "Make freeform" overlay buttons on convertible blocks
  var convBtns = [];
  function clearConvertBtns() {
    convBtns.forEach(function (b) { b.remove(); });
    convBtns = [];
  }
  function placeConvertBtns() {
    clearConvertBtns();
    if (!editing) return;
    topBlockNodes().forEach(function (node) {
      var r = node.getBoundingClientRect();
      if (r.height < 24) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'gogh-convertbtn';
      b.textContent = '\u2728 Make freeform';
      b.style.left = (r.right + window.scrollX - 10) + 'px';
      b.style.top = (r.top + window.scrollY + 10) + 'px';
      b.addEventListener('click', function () {
        b.disabled = true;
        b.textContent = 'Converting\u2026';
        convertBlock(node).then(function (sec) {
          if (!sec) { b.disabled = false; b.textContent = '\u2728 Make freeform'; }
        });
      });
      document.body.appendChild(b);
      convBtns.push(b);
    });
  }

  // merge regenerated gogh sections into the stored content WITHOUT touching
  // non-gogh blocks: replace existing gogh/section spans in place, append when
  // the page had none, whole-replace only for legacy full-gogh pages
  function mergeContent(raw) {
    var OPEN = '<!-- wp:gogh/section -->', CLOSE = '<!-- /wp:gogh/section -->';
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
        raw = raw.slice(0, r.sp.start) + buildSectionBlocks(r.sec) + raw.slice(r.sp.end);
      });
    }
    var blocks = buildAllBlocks();
    var spans = [], i = 0;
    for (;;) {
      var a = raw.indexOf(OPEN, i);
      if (a === -1) break;
      var b = raw.indexOf(CLOSE, a);
      if (b === -1) break;
      b += CLOSE.length;
      spans.push([a, b]);
      i = b;
    }
    if (!spans.length) {
      // legacy carrier pages were 100% gogh: migrate the whole content
      if (raw.indexOf('gogh-model') !== -1) return blocks;
      // plain page: keep everything, append the new sections
      var trimmed = raw.replace(/\s+$/, '');
      return trimmed + (trimmed ? '\n\n' : '') + blocks;
    }
    var secs = realSections();
    if (spans.length === secs.length) {
      // 1:1 — rewrite each span in place, preserving interleaved blocks
      var out = '', pos = 0;
      spans.forEach(function (sp, k) {
        out += raw.slice(pos, sp[0]) + buildSectionBlocks(secs[k]);
        pos = sp[1];
      });
      return out + raw.slice(pos);
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


  // ---------- boot ----------
  S.forEach(renderSection);
  if (wantEdit) {
    setEditing(true);
    if (S.length === 1 && S[0].bootstrap && !S[0].els.length) openPicker(0);
    try {
      var u = new URL(location.href);
      u.searchParams.delete('gogh-edit');
      history.replaceState(null, '', u);
    } catch (e3) {}
  }
})();

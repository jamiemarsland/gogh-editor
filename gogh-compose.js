/* gogh compose — the compositions, shared.
 *
 * Pure functions producing {raw, html}: raw is the saved block markup
 * (core blocks, plugin-off safe), html a preview without block comments.
 * The write surface uses these for ✦ Splash; the suite guards them
 * against drifting from the editor's own compose functions.
 */
(function () {
  'use strict';
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  var escAttr = function (s) {
    return esc(s).replace(/"/g, '&quot;');
  };

  var carousel = function (items, copt) {
    copt = copt || {};
    var cls = 'gogh-carousel' + (copt.auto ? ' gogh-crsl-auto' : '') +
      (copt.light ? ' gogh-crsl-light' : '') +
      (copt.nav === 'sides' ? ' gogh-crsl-nav-sides' : copt.nav === 'both' ? ' gogh-crsl-nav-both' : '');
    var fig = function (it) {
      return '<figure class="wp-block-image size-large gogh-slide"><img src="' + escAttr(it.img) + '" alt="' + escAttr(it.cap || '') + '"/>' +
        (it.cap ? '<figcaption class="wp-element-caption">' + esc(it.cap) + '</figcaption>' : '') + '</figure>';
    };
    var imgAttrs = { sizeSlug: 'large', className: 'gogh-slide' };
    var raw = '<!-- wp:group {"className":"' + cls + '"} -->\n<div class="wp-block-group ' + cls + '">' +
      items.map(function (it) {
        return '<!-- wp:image ' + JSON.stringify(imgAttrs) + ' -->\n' + fig(it) + '\n<!-- /wp:image -->';
      }).join('') + '</div>\n<!-- /wp:group -->';
    var html = '<div class="wp-block-group ' + cls + '">' + items.map(fig).join('') + '</div>';
    return { raw: raw, html: html };
  };

  var wall = function (items, wopt) {
    wopt = wopt || {};
    var cols = wopt.cols === 2 || wopt.cols === 4 ? wopt.cols : 3;
    var cls = 'gogh-wall gogh-wall-' + cols + (wopt.light ? ' gogh-crsl-light' : '');
    var fig = function (it) {
      return '<figure class="wp-block-image size-large gogh-brick"><img src="' + escAttr(it.img) + '" alt="' + escAttr(it.cap || '') + '"/>' +
        (it.cap ? '<figcaption class="wp-element-caption">' + esc(it.cap) + '</figcaption>' : '') + '</figure>';
    };
    var raw = '<!-- wp:group {"className":"' + cls + '"} -->\n<div class="wp-block-group ' + cls + '">' +
      items.map(function (it) {
        return '<!-- wp:image {"sizeSlug":"large","className":"gogh-brick"} -->\n' + fig(it) + '\n<!-- /wp:image -->';
      }).join('') + '</div>\n<!-- /wp:group -->';
    var html = '<div class="wp-block-group ' + cls + '">' + items.map(fig).join('') + '</div>';
    return { raw: raw, html: html };
  };

  // a chapter break: one full-bleed picture, words resuming beneath it.
  // focal (0–100) picks WHICH slice of a tall photo the window shows —
  // 0 = top (the default, where faces live), 100 = bottom. Stored as an
  // inline object-position so it rides the block markup itself.
  var breakImage = function (img, alt, focal) {
    var style = (focal != null && isFinite(focal))
      ? ' style="object-position:50% ' + Math.max(0, Math.min(100, Math.round(focal))) + '%"' : '';
    var fig = '<figure class="wp-block-image alignfull size-full gogh-splash-break"><img src="' + escAttr(img) + '" alt="' + escAttr(alt || '') + '"' + style + '/></figure>';
    var raw = '<!-- wp:image {"align":"full","sizeSlug":"full","className":"gogh-splash-break"} -->\n' + fig + '\n<!-- /wp:image -->';
    return { raw: raw, html: fig };
  };

  // a frosted call-out floating on a photo
  var glass = function (img, o) {
    o = o || {};
    var inner =
      '<!-- wp:group {"className":"gogh-glass"} -->\n<div class="wp-block-group gogh-glass">' +
      (o.kicker ? '<!-- wp:paragraph {"className":"gogh-glass-kicker"} -->\n<p class="gogh-glass-kicker">' + esc(o.kicker) + '</p>\n<!-- /wp:paragraph -->' : '') +
      '<!-- wp:heading -->\n<h2 class="wp-block-heading">' + esc(o.title || 'A moment worth a card') + '</h2>\n<!-- /wp:heading -->' +
      (o.text ? '<!-- wp:paragraph -->\n<p>' + esc(o.text) + '</p>\n<!-- /wp:paragraph -->' : '') +
      '</div>\n<!-- /wp:group -->';
    var raw = '<!-- wp:cover {"url":"' + escAttr(img) + '","dimRatio":10,"align":"full","className":"gogh-splash-glasswrap"} -->\n' +
      '<div class="wp-block-cover alignfull gogh-splash-glasswrap">' +
      '<span aria-hidden="true" class="wp-block-cover__background has-background-dim-10 has-background-dim"></span>' +
      '<img class="wp-block-cover__image-background" alt="" src="' + escAttr(img) + '" data-object-fit="cover"/>' +
      '<div class="wp-block-cover__inner-container">' + inner + '</div></div>\n<!-- /wp:cover -->';
    var html = '<div class="wp-block-cover alignfull gogh-splash-glasswrap" style="background-image:url(\'' + escAttr(img) + '\');background-size:cover;background-position:center">' +
      '<div class="wp-block-cover__inner-container"><div class="wp-block-group gogh-glass">' +
      (o.kicker ? '<p class="gogh-glass-kicker">' + esc(o.kicker) + '</p>' : '') +
      '<h2 class="wp-block-heading">' + esc(o.title || 'A moment worth a card') + '</h2>' +
      (o.text ? '<p>' + esc(o.text) + '</p>' : '') +
      '</div></div></div>';
    return { raw: raw, html: html };
  };

  window.__goghCompose = { carousel: carousel, wall: wall, breakImage: breakImage, glass: glass };
})();

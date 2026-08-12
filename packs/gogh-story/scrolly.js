/* Gogh Story — scrollytelling through the pack door.
 *
 * Compose returns PURE CORE BLOCKS: a group of scenes, each a full
 * cover image and a paragraph. Without this pack (or without JS) the
 * story reads as a plain sequence — the honest fallback. With it, the
 * images pin and crossfade while the words drift past.
 */
(function () {
  'use strict';
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  var escAttr = function (s) { return esc(s).replace(/"/g, '&quot;'); };

  var compose = function (items, opts) {
    var lines = (opts && opts.lines || []).map(function (l) { return l.trim(); });
    var scenes = items.map(function (it, k) {
      var words = lines[k] || 'Write this part of the story…';
      return (
        '<!-- wp:group {"className":"gogh-scene"} -->\n' +
        '<div class="wp-block-group gogh-scene">' +
        '<!-- wp:image {"sizeSlug":"full","className":"gogh-scene-img"} -->\n' +
        '<figure class="wp-block-image size-full gogh-scene-img"><img src="' + escAttr(it.img) + '" alt="' + escAttr(it.cap || '') + '"/></figure>\n' +
        '<!-- /wp:image -->' +
        '<!-- wp:paragraph {"className":"gogh-scene-words"} -->\n' +
        '<p class="gogh-scene-words">' + esc(words) + '</p>\n' +
        '<!-- /wp:paragraph -->' +
        '</div>\n<!-- /wp:group -->'
      );
    }).join('');
    var raw = '<!-- wp:group {"align":"full","className":"gogh-scrolly"} -->\n' +
      '<div class="wp-block-group alignfull gogh-scrolly">' + scenes + '</div>\n' +
      '<!-- /wp:group -->';
    // the preview mirrors the raw minus comments — same as core splashes
    var html = raw.replace(/<!--[\s\S]*?-->/g, '');
    return { raw: raw, html: html };
  };

  var enhance = function (root) {
    [].forEach.call((root || document).querySelectorAll('.gogh-scrolly:not([data-scrolly])'), function (el) {
      el.setAttribute('data-scrolly', '1');
      var scenes = [].slice.call(el.querySelectorAll('.gogh-scene'));
      if (scenes.length < 2 || !('IntersectionObserver' in window)) return;
      // a scene is TALLER than the viewport, so its own ratio can never
      // reach 0.5 — watch the WORDS (small, honest) and light their scene
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var scene = en.target.closest('.gogh-scene');
          if (scene) scene.classList.toggle('is-live', en.isIntersecting && en.intersectionRatio >= 0.5);
        });
      }, { threshold: [0.5] });
      scenes.forEach(function (sc) {
        var w = sc.querySelector('.gogh-scene-words');
        io.observe(w || sc);
      });
    });
  };

  // entrances: elements wearing the family classes wake when scrolled to.
  // JS stamps the html flag so no-JS visitors see everything plainly.
  document.documentElement.classList.add('gogh-anim');
  var wake = function (root) {
    var els = (root || document).querySelectorAll('.is-style-gogh-rise:not([data-gogh-woke]), .is-style-gogh-unveil:not([data-gogh-woke])');
    if (!els.length || !('IntersectionObserver' in window)) {
      [].forEach.call(els, function (el) { el.classList.add('gogh-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('gogh-in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.22 });
    [].forEach.call(els, function (el) { el.setAttribute('data-gogh-woke', '1'); io.observe(el); });
  };
  var register = function () {
    if (!window.gogh || !window.gogh.registerSplash) return false;
    window.gogh.registerSplash({
      key: 'scrolly',
      label: 'Story',
      hint: 'scenes that unfold as you scroll',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="8" rx="1.5"/><path d="M9 15h6M8 19h8"/><path d="M12 11v2"/></svg>',
      multi: true,
      minPhotos: 2,
      lines: true,
      linesHint: 'The story — one line per photo…',
      compose: compose,
    });
    window.gogh.registerEnhancer(enhance);
    window.gogh.registerEnhancer(wake);
    if (window.gogh.registerImageStyle) {
      window.gogh.registerImageStyle({ cls: 'is-style-gogh-melt', label: 'Melt' });
      window.gogh.registerImageStyle({ cls: 'is-style-gogh-rise', label: 'Rise' });
      window.gogh.registerImageStyle({ cls: 'is-style-gogh-breathe', label: 'Breathe' });
    }
    return true;
  };
  // the write room defines the door; the front end has no door and no
  // need of one — enhance directly there
  if (!register()) {
    document.addEventListener('DOMContentLoaded', function () { register(); });
  }
  var boot = function () { enhance(document); wake(document); };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/**
 * gogh shop looks: the Lookbook (a book of products whose pages turn) and the
 * Index (names set large, the picture following the pointer). Both dress
 * Woo's own Product Collection, so prices, sale badges and Add to cart stay
 * Woo's. The real products are never moved: a turning page is drawn from
 * copies, and the copies go the moment the page lands.
 *
 * Runs before the Interactivity API hydrates (a classic footer script runs
 * as the page parses; modules wait), and only adds classes and siblings.
 *
 * @package gogh
 */
(function () {
  'use strict';
  var html = document.documentElement;
  if (html.classList.contains('gogh-editing')) return; // the editor draws its own sketch
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- the Lookbook ----------
  function lookbook(root) {
    var ul = root.querySelector('.wc-block-product-template');
    if (!ul || ul.classList.contains('gogh-book')) return;
    var pages = [].slice.call(ul.children).filter(function (li) { return li.tagName === 'LI'; });
    if (!pages.length) return;
    ul.classList.add('gogh-book');
    pages.forEach(function (li, n) {
      li.classList.add('gogh-book-spread');
      var pic = li.querySelector('.wc-block-components-product-image, .wp-block-woocommerce-product-image');
      while (pic && pic.parentNode !== li) pic = pic.parentNode;
      if (pic) pic.classList.add('gogh-book-pic');
      [].forEach.call(li.querySelectorAll('img'), function (im) { im.draggable = false; });
      li.setAttribute('aria-roledescription', 'page');
      li.setAttribute('aria-label', (n + 1) + ' of ' + pages.length);
    });
    var at = 0, busy = false;
    var nav = document.createElement('div');
    nav.className = 'gogh-book-nav';
    nav.innerHTML = '<button type="button" class="gogh-book-prev" aria-label="Previous page">←</button>' +
      '<span class="gogh-book-count" aria-live="polite"></span>' +
      '<button type="button" class="gogh-book-next" aria-label="Next page">→</button>';
    ul.parentNode.insertBefore(nav, ul.nextSibling);
    var prevB = nav.querySelector('.gogh-book-prev'), nextB = nav.querySelector('.gogh-book-next'), count = nav.querySelector('.gogh-book-count');
    ul.setAttribute('tabindex', '0');
    ul.setAttribute('aria-roledescription', 'lookbook');

    var single = false;
    function measure() {
      single = ul.clientWidth < 640;
      ul.classList.toggle('is-single', single);
    }
    function show(n) {
      pages.forEach(function (li, k) {
        var on = k === n;
        li.classList.toggle('is-current', on);
        li.toggleAttribute('inert', !on);
        li.setAttribute('aria-hidden', on ? 'false' : 'true');
      });
      at = n;
      count.textContent = (n + 1) + ' / ' + pages.length;
      prevB.disabled = n === 0;
      nextB.disabled = n === pages.length - 1;
      // the edge of the book thins on the right as the pages are read
      ul.style.setProperty('--gogh-book-left', Math.min(4, n));
      ul.style.setProperty('--gogh-book-right', Math.min(4, pages.length - 1 - n));
    }
    // a copy of one half of a spread: what a turning page shows
    function half(li, side) {
      var face = document.createElement('div');
      face.className = 'gogh-book-face gogh-book-face-' + side;
      var copy = li.cloneNode(true);
      copy.classList.add('is-current', 'gogh-book-copy');
      copy.removeAttribute('inert');
      [copy].concat([].slice.call(copy.querySelectorAll('*'))).forEach(function (el) {
        el.removeAttribute('id');
        [].slice.call(el.attributes).forEach(function (a) { if (/^data-wp-/.test(a.name)) el.removeAttribute(a.name); });
      });
      copy.setAttribute('aria-hidden', 'true');
      face.appendChild(copy);
      var shade = document.createElement('i');
      shade.className = 'gogh-book-shade';
      face.appendChild(shade);
      return face;
    }
    // a page in the hand: dir 1 turns forward, -1 back. Returns a setter for
    // how far it has turned (0..1) and an end that lands or returns it
    function lift(dir) {
      var from = pages[at], to = pages[at + dir];
      var leaf = document.createElement('div');
      leaf.className = 'gogh-book-leaf';
      var front, back, hold;
      if (dir > 0) {
        front = half(from, 'r'); back = half(to, 'l');
        hold = half(from, 'l'); hold.classList.add('gogh-book-hold');
      } else {
        front = half(to, 'r'); back = half(from, 'l');
        hold = half(from, 'r'); hold.classList.add('gogh-book-hold');
      }
      back.classList.add('gogh-book-back');
      leaf.appendChild(front); leaf.appendChild(back);
      ul.appendChild(hold); ul.appendChild(leaf);
      to.classList.add('is-current'); // the next spread waits underneath
      ul.classList.add('is-turning');
      var t = 0;
      function set(p) {
        t = Math.max(0, Math.min(1, p));
        var ang = dir > 0 ? -180 * t : -180 * (1 - t);
        leaf.style.transform = 'rotateY(' + ang + 'deg)';
        var s = Math.sin(Math.PI * t);
        front.lastChild.style.opacity = (0.45 * (dir > 0 ? t : 1 - t) * s + 0.15 * s).toFixed(3);
        back.lastChild.style.opacity = (0.45 * (dir > 0 ? 1 - t : t) * s + 0.15 * s).toFixed(3);
        leaf.style.zIndex = 4;
      }
      function end(land, done) {
        var start = t, goal = land ? 1 : 0, t0 = performance.now(), dur = 520 * Math.abs(goal - start) + 80;
        (function step(now) {
          var k = Math.min(1, (now - t0) / dur);
          var e = 1 - Math.pow(1 - k, 3);
          set(start + (goal - start) * e);
          if (k < 1) { requestAnimationFrame(step); return; }
          leaf.remove(); hold.remove();
          ul.classList.remove('is-turning');
          if (land) show(at + dir); else to.classList.remove('is-current');
          if (done) done();
        })(t0);
      }
      set(0);
      return { set: set, end: end };
    }
    function turn(dir) {
      if (busy || at + dir < 0 || at + dir >= pages.length) return;
      if (single || calm) { // one page on a phone, and no page-turn for those who asked for calm
        ul.classList.add('is-fading');
        setTimeout(function () { show(at + dir); ul.classList.remove('is-fading'); }, calm ? 0 : 180);
        return;
      }
      busy = true;
      lift(dir).end(true, function () { busy = false; });
    }
    prevB.addEventListener('click', function () { turn(-1); });
    nextB.addEventListener('click', function () { turn(1); });
    ul.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowRight') { ev.preventDefault(); turn(1); }
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); turn(-1); }
    });
    // take a page by its edge: the right page turns forward, the left back
    var drag = null;
    ul.addEventListener('pointerdown', function (ev) {
      // anywhere on a page, the picture's link included; only real controls are left alone
      if (busy || ev.button !== 0 || ev.target.closest('button, input, select, textarea, label, .wp-block-button')) return;
      var r = ul.getBoundingClientRect(), right = ev.clientX > r.left + r.width / 2;
      drag = { x: ev.clientX, y: ev.clientY, w: single ? r.width : r.width / 2, dir: right ? 1 : -1, page: null, id: ev.pointerId };
    });
    ul.addEventListener('pointermove', function (ev) {
      if (!drag || ev.pointerId !== drag.id) return;
      var dx = ev.clientX - drag.x;
      if (!drag.page) {
        if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(ev.clientY - drag.y)) return;
        if (single) drag.dir = dx < 0 ? 1 : -1;
        if (at + drag.dir < 0 || at + drag.dir >= pages.length || single || calm) { drag.flick = true; return; }
        busy = true;
        drag.moved = true;
        drag.page = lift(drag.dir);
        try { ul.setPointerCapture(ev.pointerId); } catch (e) {}
      }
      drag.page.set((drag.dir > 0 ? -dx : dx) / (drag.w * 1.6));
    });
    function letGo(ev) {
      if (!drag || ev.pointerId !== drag.id) return;
      var d = drag; drag = null;
      var dx = ev.clientX - d.x;
      if (d.page) {
        var far = (d.dir > 0 ? -dx : dx) / (d.w * 1.6);
        d.page.end(far > 0.35, function () { busy = false; });
      } else if (d.flick && Math.abs(dx) > 40) {
        d.moved = true;
        turn(dx < 0 ? 1 : -1);
      }
      // a page let go of is not a click on the picture's link
      if (d.moved) {
        var stop = function (e) { e.preventDefault(); e.stopPropagation(); };
        ul.addEventListener('click', stop, { capture: true, once: true });
        setTimeout(function () { ul.removeEventListener('click', stop, true); }, 400);
      }
    }
    // a link or picture would otherwise start the browser's own drag and cancel ours
    ul.addEventListener('dragstart', function (ev) { ev.preventDefault(); });
    ul.addEventListener('pointerup', letGo);
    ul.addEventListener('pointercancel', letGo);
    measure();
    show(0);
    if (window.ResizeObserver) new ResizeObserver(measure).observe(ul);
    root.classList.add('gogh-book-ready');
  }

  // ---------- the Index ----------
  var float = null;
  function floatEl() {
    if (float) return float;
    float = { el: document.createElement('div'), x: 0, y: 0, tx: 0, ty: 0, rot: 0, on: false, raf: 0 };
    float.el.className = 'gogh-index-float';
    float.el.setAttribute('aria-hidden', 'true');
    float.el.innerHTML = '<img alt="" />';
    document.body.appendChild(float.el);
    return float;
  }
  function glide() {
    var f = float;
    var dx = f.tx - f.x, dy = f.ty - f.y;
    f.x += dx * 0.18; f.y += dy * 0.18;
    f.rot += ((Math.max(-10, Math.min(10, dx * 0.12))) - f.rot) * 0.15;
    f.el.style.transform = 'translate(' + f.x.toFixed(1) + 'px,' + f.y.toFixed(1) + 'px) rotate(' + f.rot.toFixed(2) + 'deg)';
    if (f.on || Math.abs(dx) + Math.abs(dy) > 0.5) f.raf = requestAnimationFrame(glide);
    else f.raf = 0;
  }
  function index(root) {
    var ul = root.querySelector('.wc-block-product-template');
    if (!ul || ul.classList.contains('gogh-index')) return;
    ul.classList.add('gogh-index');
    var hover = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    [].slice.call(ul.children).forEach(function (li, n) {
      if (li.tagName !== 'LI') return;
      li.classList.add('gogh-index-row');
      li.style.setProperty('--gogh-index-n', '"' + (n + 1 < 10 ? '0' : '') + (n + 1) + '"');
      var pic = li.querySelector('.wc-block-components-product-image, .wp-block-woocommerce-product-image');
      while (pic && pic.parentNode !== li) pic = pic.parentNode;
      if (pic) pic.classList.add('gogh-index-pic');
      if (!hover) return;
      var img = li.querySelector('img');
      li.addEventListener('pointerenter', function (ev) {
        if (!img) return;
        var f = floatEl();
        var im = f.el.firstChild;
        im.src = img.currentSrc || img.src;
        if (img.srcset) im.srcset = img.srcset; else im.removeAttribute('srcset');
        im.sizes = '320px';
        if (!f.on && !f.raf) { f.x = f.tx = ev.clientX + 24; f.y = f.ty = ev.clientY - 120; }
        f.on = true;
        f.el.classList.add('is-on');
        if (!f.raf && !calm) f.raf = requestAnimationFrame(glide);
      });
      li.addEventListener('pointermove', function (ev) {
        var f = float;
        if (!f) return;
        // beside the pointer, on whichever side has room
        var w = f.el.offsetWidth || 280, h = f.el.offsetHeight || 360;
        f.tx = ev.clientX + 32 + w > window.innerWidth ? ev.clientX - w - 32 : ev.clientX + 32;
        f.ty = Math.max(12, Math.min(window.innerHeight - h - 12, ev.clientY - h / 2));
        if (calm) { f.x = f.tx; f.y = f.ty; f.el.style.transform = 'translate(' + f.x + 'px,' + f.y + 'px)'; }
      });
      li.addEventListener('pointerleave', function () {
        if (!float) return;
        float.on = false;
        float.el.classList.remove('is-on');
      });
    });
    root.classList.add('gogh-index-ready');
  }

  function run() {
    [].forEach.call(document.querySelectorAll('.gogh-shop-book'), lookbook);
    [].forEach.call(document.querySelectorAll('.gogh-shop-index'), index);
  }
  // now, not on DOMContentLoaded: this prints after the grids, and module
  // scripts (the Interactivity API) run before DOMContentLoaded fires
  run();
})();

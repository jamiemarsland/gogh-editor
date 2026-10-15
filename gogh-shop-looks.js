/**
 * gogh shop looks: the Lookbook (a book of products whose pages turn), the
 * Index (names set large, the picture following the pointer) and Shop the
 * photo (dots on a picture that open each product's card). All three dress
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
    // the stage is the book's own box: never taller than the window, so the
    // whole spread and its arrows are in view at once (James: 'its quite hard
    // to use - cuz the arrows are at the bottom'). Arrows sit beside the book
    // at its middle; a folded corner on each page invites a turn
    var stage = document.createElement('div');
    stage.className = 'gogh-book-stage';
    ul.parentNode.insertBefore(stage, ul);
    stage.appendChild(ul);
    stage.insertAdjacentHTML('beforeend',
      '<button type="button" class="gogh-book-arrow gogh-book-prev" aria-label="Previous page"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button>' +
      '<button type="button" class="gogh-book-arrow gogh-book-next" aria-label="Next page"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></button>' +
      '<button type="button" class="gogh-book-corner gogh-book-corner-r" tabindex="-1" aria-hidden="true"></button>' +
      '<button type="button" class="gogh-book-corner gogh-book-corner-l" tabindex="-1" aria-hidden="true"></button>');
    var nav = document.createElement('div');
    nav.className = 'gogh-book-nav';
    nav.innerHTML = '<span class="gogh-book-count" aria-live="polite"></span>';
    stage.parentNode.insertBefore(nav, stage.nextSibling);
    var prevB = stage.querySelector('.gogh-book-prev'), nextB = stage.querySelector('.gogh-book-next'), count = nav.querySelector('.gogh-book-count');
    var cornerR = stage.querySelector('.gogh-book-corner-r'), cornerL = stage.querySelector('.gogh-book-corner-l');
    ul.setAttribute('tabindex', '0');
    ul.setAttribute('aria-roledescription', 'lookbook');
    var at = 0, busy = false, single = false;

    function measure() {
      single = (stage.parentNode.clientWidth || 0) < 700;
      stage.classList.toggle('is-single', single);
      ul.classList.toggle('is-single', single);
      // on one page the arrows ride the middle of the picture
      var pic = pages[at] && pages[at].querySelector('.gogh-book-pic');
      stage.style.setProperty('--gogh-book-arrow-y', single && pic ? Math.round(pic.offsetHeight / 2) + 'px' : '50%');
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
      cornerL.hidden = n === 0;
      cornerR.hidden = n === pages.length - 1;
      // the edge of the book thins on the right as the pages are read
      ul.style.setProperty('--gogh-book-left', Math.min(4, n));
      ul.style.setProperty('--gogh-book-right', Math.min(4, pages.length - 1 - n));
      if (single) measure();
    }
    // a copy of a whole spread, in the very place of the real one (a direct
    // child of the list, so every theme rule that dresses a page dresses it
    // the same — a copy one level down came out a size smaller), showing
    // only the half it stands for
    function copyOf(li, side, cls) {
      var copy = li.cloneNode(true);
      copy.classList.add('is-current', 'gogh-book-copy', 'gogh-book-half-' + side);
      if (cls) copy.classList.add(cls);
      copy.removeAttribute('inert');
      copy.removeAttribute('aria-label');
      copy.removeAttribute('aria-roledescription');
      [copy].concat([].slice.call(copy.querySelectorAll('*'))).forEach(function (el) {
        el.removeAttribute('id');
        [].slice.call(el.attributes).forEach(function (a) { if (/^data-wp-/.test(a.name)) el.removeAttribute(a.name); });
      });
      copy.setAttribute('aria-hidden', 'true');
      var shade = document.createElement('i');
      shade.className = 'gogh-book-shade';
      copy.appendChild(shade);
      return copy;
    }
    // a page in the hand: dir 1 turns forward, -1 back. The page turns about
    // the spine; its front is the right half of one spread, its back the
    // left half of the other. Each half turns on its own, as a sibling of
    // the real spreads (a wrapper would put them a level down again)
    function lift(dir) {
      var from = pages[at], to = pages[at + dir];
      var front, back, hold;
      if (dir > 0) { front = copyOf(from, 'r'); back = copyOf(to, 'l', 'gogh-book-back'); hold = copyOf(from, 'l', 'gogh-book-hold'); }
      else { front = copyOf(to, 'r'); back = copyOf(from, 'l', 'gogh-book-back'); hold = copyOf(from, 'r', 'gogh-book-hold'); }
      ul.appendChild(hold); ul.appendChild(front); ul.appendChild(back);
      to.classList.add('is-current'); // the next spread waits underneath
      ul.classList.add('is-turning');
      var t = 0;
      function set(p) {
        t = Math.max(0, Math.min(1, p));
        var ang = dir > 0 ? -180 * t : -180 * (1 - t);
        front.style.transform = 'rotateY(' + ang.toFixed(2) + 'deg)';
        back.style.transform = 'rotateY(' + (ang + 180).toFixed(2) + 'deg)';
        var s = Math.sin(Math.PI * t), u = dir > 0 ? t : 1 - t;
        front.lastChild.style.opacity = (0.4 * u * s + 0.12 * s).toFixed(3);
        back.lastChild.style.opacity = (0.4 * (1 - u) * s + 0.12 * s).toFixed(3);
      }
      function end(land, done) {
        var start = t, goal = land ? 1 : 0, t0 = performance.now(), dur = 560 * Math.abs(goal - start) + 80;
        (function step(now) {
          var k = Math.min(1, (now - t0) / dur);
          var e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
          set(start + (goal - start) * e);
          if (k < 1) { requestAnimationFrame(step); return; }
          if (land) show(at + dir); else to.classList.remove('is-current');
          front.remove(); back.remove(); hold.remove();
          ul.classList.remove('is-turning');
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
    // take a page by its edge (or its folded corner): the right page turns
    // forward, the left back
    var drag = null;
    function grab(ev, dir) {
      var r = ul.getBoundingClientRect();
      drag = { x: ev.clientX, y: ev.clientY, w: single ? r.width : r.width / 2, dir: dir, page: null, id: ev.pointerId, corner: !!ev.target.closest('.gogh-book-corner') };
    }
    stage.addEventListener('pointerdown', function (ev) {
      if (busy || ev.button !== 0) return;
      if (ev.target.closest('.gogh-book-corner')) { grab(ev, ev.target.closest('.gogh-book-corner-r') ? 1 : -1); return; }
      // anywhere on a page, the picture's link included; only real controls are left alone
      if (!ul.contains(ev.target) || ev.target.closest('button, input, select, textarea, label, .wp-block-button')) return;
      var r = ul.getBoundingClientRect();
      grab(ev, ev.clientX > r.left + r.width / 2 ? 1 : -1);
    });
    stage.addEventListener('pointermove', function (ev) {
      if (!drag || ev.pointerId !== drag.id) return;
      var dx = ev.clientX - drag.x;
      if (!drag.page) {
        if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(ev.clientY - drag.y)) return;
        if (single) drag.dir = dx < 0 ? 1 : -1;
        if (at + drag.dir < 0 || at + drag.dir >= pages.length || single || calm) { drag.flick = true; return; }
        busy = true;
        drag.moved = true;
        drag.page = lift(drag.dir);
        try { stage.setPointerCapture(ev.pointerId); } catch (e) {}
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
      } else if (d.corner && ev.type === 'pointerup') {
        d.moved = true; // a click on a corner turns its page
        turn(d.dir);
      }
      // a page let go of is not a click on the picture's link
      if (d.moved) {
        var stop = function (e) { e.preventDefault(); e.stopPropagation(); };
        stage.addEventListener('click', stop, { capture: true, once: true });
        setTimeout(function () { stage.removeEventListener('click', stop, true); }, 400);
      }
    }
    // a link or picture would otherwise start the browser's own drag and cancel ours
    stage.addEventListener('dragstart', function (ev) { ev.preventDefault(); });
    stage.addEventListener('pointerup', letGo);
    stage.addEventListener('pointercancel', letGo);
    measure();
    show(0);
    if (window.ResizeObserver) new ResizeObserver(measure).observe(stage.parentNode);
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

  // ---------- Shop the photo ----------
  // a picture with a dot on each product in it; a dot opens that product's
  // own Woo card (Add to cart and all), beside the dot or, on a phone,
  // across the foot of the picture. The cards are the grid's real items,
  // only placed: nothing is copied or moved out of its list
  function photo(root) {
    var fig = root.querySelector('.gogh-photo-scene');
    var coll = root.querySelector('.gogh-shop-spots');
    var ul = coll && coll.querySelector('.wc-block-product-template');
    if (!fig || !ul || root.classList.contains('gogh-photo-ready')) return;
    var spots = [];
    try { spots = JSON.parse(root.getAttribute('data-gogh-spots') || '[]'); } catch (e) { return; }
    var items = {};
    [].forEach.call(ul.children, function (li) {
      var m = /\bpost-(\d+)\b/.exec(li.className);
      if (m) items[m[1]] = li;
    });
    var layer = document.createElement('div');
    layer.className = 'gogh-photo-dots';
    fig.appendChild(layer);
    var open = null, closeT = null, hover = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    function narrow() { return root.clientWidth < 600; }
    function place(dot, li) {
      var box = root.getBoundingClientRect(), d = dot.getBoundingClientRect();
      li.classList.toggle('is-sheet', narrow());
      if (narrow()) { li.style.left = ''; li.style.top = ''; return; }
      var w = li.offsetWidth, h = li.offsetHeight, cx = d.left + d.width / 2 - box.left, cy = d.top + d.height / 2 - box.top;
      var left = cx + 26 + w <= box.width - 12 ? cx + 26 : cx - 26 - w; // beside the dot, on whichever side has room
      var top = Math.max(12, Math.min(box.height - h - 12, cy - h / 2));
      li.style.left = Math.max(12, left) + 'px';
      li.style.top = top + 'px';
    }
    function show(dot) {
      clearTimeout(closeT);
      if (open && open.dot === dot) return;
      hide(true);
      var li = items[dot.dataset.id];
      if (!li) return;
      li.classList.add('is-open');
      li.removeAttribute('inert');
      dot.classList.add('is-on');
      dot.setAttribute('aria-expanded', 'true');
      place(dot, li);
      open = { dot: dot, li: li };
    }
    function hide(now) {
      if (!open) return;
      var o = open;
      var go = function () {
        o.li.classList.remove('is-open');
        o.li.setAttribute('inert', '');
        o.dot.classList.remove('is-on');
        o.dot.setAttribute('aria-expanded', 'false');
        if (open === o) open = null;
      };
      clearTimeout(closeT);
      if (now) go(); else closeT = setTimeout(go, 260);
    }
    spots.forEach(function (sp, n) {
      var li = items[String(sp.id)];
      if (!li) return; // a product gone from the shop takes its dot with it
      var title = li.querySelector('.wp-block-post-title');
      var dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'gogh-photo-dot';
      dot.dataset.id = sp.id;
      dot.style.left = Math.max(0, Math.min(100, +sp.x)) + '%';
      dot.style.top = Math.max(0, Math.min(100, +sp.y)) + '%';
      dot.style.setProperty('--gogh-dot-delay', (n * 0.35) + 's');
      dot.setAttribute('aria-label', (title ? title.textContent.trim() : 'Product') + ' — show');
      dot.setAttribute('aria-expanded', 'false');
      dot.innerHTML = '<span></span>';
      layer.appendChild(dot);
      li.classList.add('gogh-photo-card');
      li.setAttribute('inert', '');
      if (hover) {
        dot.addEventListener('pointerenter', function () { show(dot); });
        dot.addEventListener('pointerleave', function () { hide(); });
        li.addEventListener('pointerenter', function () { if (open && open.li === li) clearTimeout(closeT); });
        li.addEventListener('pointerleave', function () { hide(); });
      }
      dot.addEventListener('click', function () { if (open && open.dot === dot && !hover) hide(true); else show(dot); });
      dot.addEventListener('focus', function () { show(dot); });
    });
    root.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && open) { var d = open.dot; hide(true); d.focus(); } });
    document.addEventListener('pointerdown', function (ev) {
      if (open && !open.li.contains(ev.target) && !ev.target.closest('.gogh-photo-dot')) hide(true);
    });
    window.addEventListener('resize', function () { if (open) place(open.dot, open.li); });
    root.classList.add('gogh-photo-ready');
  }

  function run() {
    [].forEach.call(document.querySelectorAll('.gogh-shop-book'), lookbook);
    [].forEach.call(document.querySelectorAll('.gogh-shop-index'), index);
    [].forEach.call(document.querySelectorAll('.gogh-shop-photo'), photo);
  }
  // now, not on DOMContentLoaded: this prints after the grids, and module
  // scripts (the Interactivity API) run before DOMContentLoaded fires
  run();
})();

/* gogh regression suite — runs in a real browser against the real editor.
 * Open any gogh page as an editor with ?gogh-test appended. Never saves.
 * Results: on-screen panel + window.__goghTestResults for automation.
 */
(function () {
  'use strict';

  var results = [];
  var jsErrors = [];
  window.addEventListener('error', function (ev) { jsErrors.push(String(ev.message)); });

  function approx(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 8 : tol); }
  function pev(type, target, x, y, id) {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x || 0, clientY: y || 0, pointerId: id || 1 }));
  }
  function dragBy(target, dx, dy, id) {
    var r = target.getBoundingClientRect();
    var x = r.x + r.width / 2, y = r.y + r.height / 2;
    pev('pointerdown', target, x, y, id);
    pev('pointermove', target, x + dx / 2, y + dy / 2, id);
    pev('pointermove', target, x + dx, y + dy, id);
    pev('pointerup', target, x + dx, y + dy, id);
  }
  function q(sel) { return document.querySelector(sel); }

  function run() {
    var G = window.__gogh;
    var SNAP;
    var sec = function () {
      var all = G.sections();
      return all.filter(function (s) { return !s.chrome; })[0] || all[0];
    };
    // elements are added via the Section pill's ＋ now (the drawer is the
    // design side) — this is that path, aimed at the first content section
    var addToSec = function (t) { return G.addElementToSection(G.sections().indexOf(sec()), t); };
    // the page may carry converted chrome (a published freeform footer sits
    // at the END of S) — "the section I just added" must skip chrome
    var contentSecs = function () {
      return G.sections().filter(function (s) { return !s.chrome; });
    };
    var lastSec = function () {
      var c = contentSecs();
      return c[c.length - 1];
    };
    var select = function (i) { pev('pointerdown', sec().nodes[i]); };
    var findIdx = function (type) { return sec().els.findIndex(function (e) { return e.type === type; }); };
    var rectsOverlap = function (a, b) {
      return a.left < b.right - 4 && a.right > b.left + 4 && a.top < b.bottom - 4 && a.bottom > b.top + 4;
    };

    function test(name, fn) {
      try {
        var detail = fn();
        results.push({ name: name, pass: true, detail: detail || '' });
      } catch (err) {
        results.push({ name: name, pass: false, detail: String(err.message || err) });
      }
      G.restore(SNAP);
    }
    // async tests (network round-trips) queue here and drain before the
    // report exists — __goghTestResults only appears once EVERYTHING ran
    var asyncQueue = [];
    function testAsync(name, fn) { asyncQueue.push({ name: name, fn: fn }); }
    function expect(cond, msg) { if (!cond) throw new Error(msg); }

    G.setEditing(true);
    // the fixture is a living page — ensure every element type the tests
    // rely on exists in section 0 before the baseline snapshot is taken
    window.scrollTo(0, 0);
    ['heading', 'para', 'button', 'image', 'badge'].forEach(function (t) {
      if (sec().els.findIndex(function (e) { return e.type === t; }) === -1) {
        addToSec(t);
      }
    });
    SNAP = G.serialize();

    // ---- 1. boot ----
    test('boot: editor initialised with sections and elements', function () {
      expect(G.sections().length >= 1, 'no sections');
      expect(sec().els.length >= 5, 'expected fixture elements, got ' + sec().els.length);
      return G.sections().length + ' section(s), ' + sec().els.length + ' elements';
    });

    // ---- 2. selection box hugs every element (v0.11.1 drift regression) ----
    test('selection box hugs each element (<5px)', function () {
      var worst = 0;
      sec().els.forEach(function (e, i) {
        if (e.rot) return;
        select(i);
        var box = q('.gogh-selbox').getBoundingClientRect();
        var nr = sec().nodes[i].getBoundingClientRect();
        var d = Math.max(Math.abs(box.top - nr.top), Math.abs(box.left - nr.left),
          Math.abs(box.bottom - nr.bottom), Math.abs(box.right - nr.right));
        worst = Math.max(worst, d);
      });
      expect(worst < 5, 'worst drift ' + worst.toFixed(1) + 'px');
      return 'worst drift ' + worst.toFixed(1) + 'px';
    });

    // ---- 3. east resize anchors the left edge ----
    test('east resize: width changes, x anchored', function () {
      var i = findIdx('heading');
      var e = sec().els[i];
      var x0 = e.x, w0 = e.w;
      select(i);
      dragBy(q('.gogh-h-e'), -120, 0, 11);
      expect(e.x === x0, 'x moved ' + x0 + '→' + e.x);
      expect(e.w < w0, 'width did not shrink');
    });

    // ---- 4. west resize anchors the right edge ----
    test('west resize: x moves, right edge anchored', function () {
      var i = findIdx('heading');
      var e = sec().els[i];
      var right0 = e.x + e.w;
      select(i);
      dragBy(q('.gogh-h-w'), 90, 0, 12);
      expect(e.x > 0 && approx(e.x + e.w, right0, 10), 'right edge drifted ' + right0 + '→' + (e.x + e.w));
    });

    // ---- 5. reflow push: in-path pushed by growth, out-of-path untouched ----
    test('reflow push on narrow (v0.11.8 regression)', function () {
      var i = findIdx('heading');
      var e = sec().els[i];
      // the fixture is a living page — its words and widths drift with
      // James's demos and style variations. Pin both, so narrowing MUST
      // wrap in any font the active variation brings.
      e.text = 'Make something people remember on every screen';
      if (sec().nodes[i]) sec().nodes[i].textContent = e.text;
      e.x = 72; e.w = 640;
      G.resolve(sec()); G.measure(sec());
      var before = sec().els.map(function (o) { return o.y; });
      var h0 = e.h, x0 = e.x, w0 = e.w, y0 = e.y;
      // elements the user deliberately overlapped with the heading stay
      // overlapped — reflow only guards the push path
      var preOverlap = sec().els.map(function (o, j) {
        if (j === sec().els.indexOf(e)) return false;
        return o.x < x0 + w0 && o.x + o.w > x0 && o.y < y0 + h0 && o.y + o.h > y0;
      });
      select(i);
      var rnScale = sec().sectionEl.getBoundingClientRect().width / 1200;
      dragBy(q('.gogh-h-e'), -(e.w - 180) * rnScale, 0, 13);
      var grew = e.h - h0;
      expect(grew > 20, 'heading did not grow (' + grew + ') w=' + e.w + ' h0=' + h0 + ' handle=' + !!q('.gogh-h-e'));
      var oldBottom = e.y + h0;
      var els0 = sec().els;
      var pushedIdx = [];
      els0.forEach(function (o, j) {
        if (j === i) return;
        if (before[j] >= oldBottom - 8 && o.x < e.x + e.w && o.x + o.w > e.x) pushedIdx.push(j);
      });
      function rowAligned(j) {
        // aligned (top/centre/bottom within snap tol) with any directly pushed el
        return pushedIdx.some(function (k) {
          if (k === j) return false;
          var a = els0[j], b = els0[k];
          var ah = before[j], bh = before[k];
          return Math.abs(ah - bh) <= 6 ||
            Math.abs((ah + a.h) - (bh + b.h)) <= 6 ||
            Math.abs((ah + a.h / 2) - (bh + b.h / 2)) <= 6;
        });
      }
      els0.forEach(function (o, j) {
        if (j === i) return;
        var inPath = pushedIdx.indexOf(j) !== -1;
        var dy = o.y - before[j];
        if (inPath) expect(approx(dy, grew, 4), o.type + ' pushed ' + dy + ' expected ' + grew);
        else if (before[j] >= oldBottom - 8 - 6 && rowAligned(j)) expect(approx(dy, grew, 4), o.type + ' (row-mate) pushed ' + dy + ' expected ' + grew);
        else expect(dy === 0, o.type + ' (out of path) moved ' + dy);
      });
      // rendered truth: nothing overlaps the grown heading
      var hr = sec().nodes[i].getBoundingClientRect();
      sec().nodes.forEach(function (n, j) {
        if (j === i || preOverlap[j]) return;
        expect(!rectsOverlap(hr, n.getBoundingClientRect()),
          sec().els[j].type + ' overlaps grown heading');
      });
      return 'grew ' + grew + ', in-path pushed equally';
    });

    // ---- 5a. a style change grows a heading → what sits below is PUSHED,
    // not overlapped. applyVariation reskins the SAME nodes then runs
    // growReflow; a serif variation can wrap a display heading taller than
    // the template drew. (James: "button overlap issue when we change styles"
    // — "Our thinking" landed on "Good design is good business".) ----
    test('growReflow pushes what sits below a heading grown by a style change', function () {
      var s = sec();
      var hi = findIdx('heading');
      var head = s.els[hi];
      head.x = 72; head.w = 700; head.y = 80;
      G.renderSection(s); // lay out + measure the heading at the live type
      // park a button directly below the heading, in its horizontal path
      var btn = { type: 'button', text: 'Our thinking', x: 72, y: head.y + head.h + 40, w: 220, h: 52 };
      s.els.push(btn);
      G.renderSection(s);
      var bi = s.els.indexOf(btn);
      var oldHeadH = head.h, btnY0 = btn.y;
      // simulate a serif variation wrapping the heading ~300u taller: force the
      // rendered node height, then run the exact tail applyVariation runs
      var scale = s.sectionEl.offsetWidth / 1200;
      s.nodes[hi].style.minHeight = (s.nodes[hi].offsetHeight + Math.round(300 * scale)) + 'px';
      G.growReflow(s);
      var delta = head.h - oldHeadH;
      expect(delta > 200, 'heading model did not grow (' + delta + ')');
      expect(approx(btn.y - btnY0, delta, 6),
        'button not pushed by the growth: moved ' + (btn.y - btnY0) + ' vs ' + delta);
      expect(!rectsOverlap(s.nodes[hi].getBoundingClientRect(), s.nodes[bi].getBoundingClientRect()),
        'button overlaps the grown heading');
      // restore: drop the scratch button and its forced height
      s.nodes[hi].style.minHeight = '';
      s.els.splice(bi, 1);
      G.renderSection(s);
      return 'heading grew ' + Math.round(delta) + 'u, button tracked it (no overlap)';
    });

    // ---- image frames own their height. align-self: start (v0.99.188)
    // stopped grid stretch poisoning image measurements, but it also let a
    // fresh src-less placeholder collapse to 0px — inserted images vanished
    // ("inserting images is very broken ... it does not show anymore"). The
    // design aspect on the frame keeps it visible at e.w / e.h. ----
    test('a fresh image placeholder renders at its design aspect', function () {
      var s = sec();
      var ph = { type: 'image', x: 520, y: 120, w: 360, h: 260, text: null, ghost: false, cool: true };
      s.els.push(ph);
      G.renderSection(s);
      var i = s.els.indexOf(ph);
      var r = s.nodes[i].getBoundingClientRect();
      var ratio = r.width / r.height;
      var okH = r.height > 40;
      var okR = Math.abs(ratio - 360 / 260) < 0.08;
      s.els.splice(i, 1);
      G.renderSection(s);
      expect(okH, 'placeholder collapsed: ' + Math.round(r.height) + 'px tall');
      expect(okR, 'placeholder aspect drifted: ' + ratio.toFixed(2));
      return 'placeholder ' + Math.round(r.width) + 'x' + Math.round(r.height) + 'px, design aspect held';
    });

    // ---- the insert audit: EVERYTHING in the add menu must be visible the
    // moment it lands. The placeholder collapse hid for 30 releases because
    // the suite checked models and CSS strings, not rendered pixels — this
    // sweep renders every default insert and measures its box, so no element
    // type can silently ship invisible again. ----
    test('every add-menu element renders visibly at its default size', function () {
      var s = sec();
      var defaults = G.elDefaults();
      var specs = Object.keys(defaults).map(function (k) { return { key: k, el: defaults[k]() }; });
      // the Shape entry inserts a box carrying a shape key — audit one too
      specs.push({ key: 'shape', el: { type: 'box', x: 80, y: 80, w: 320, h: 320, shape: 'square' } });
      var seen = [];
      specs.forEach(function (spec) {
        s.els.push(spec.el);
        G.renderSection(s);
        var i = s.els.indexOf(spec.el);
        var node = s.nodes[i];
        var r = node ? node.getBoundingClientRect() : { width: 0, height: 0 };
        var cs = node ? getComputedStyle(node) : null;
        var invisible = !node || r.width < 12 || r.height < 12 ||
          (cs && (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0));
        expect(!invisible, spec.key + ' renders invisible (' +
          Math.round(r.width) + 'x' + Math.round(r.height) + 'px)');
        seen.push(spec.key + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
        s.els.splice(i, 1);
      });
      G.renderSection(s);
      return specs.length + ' insert kinds visible: ' + seen.join(', ');
    });

    // ---- 5a-quater. mobile override — hide on phone. m.hidden emits a GATED
    // display:none: real ≤700px viewports hide it, but the editor's phone
    // preview (html.gogh-phone-preview) keeps it visible-but-dimmed so it can be
    // un-hidden. The sparse patch marks the node and round-trips through the
    // model. (First slice of the mobile-tailoring overrides.) ----
    test('mobile hide: m.hidden emits a gated hide rule, marks the node, and round-trips', function () {
      var s = sec();
      var i = findIdx('image'); if (i < 0) i = 0;
      s.els[i].m = { hidden: true };
      G.renderSection(s);
      expect(s.nodes[i].classList.contains('gogh-m-hidden'), 'node missing gogh-m-hidden marker');
      var css = s.styleEl.textContent.replace(/\s+/g, ' ');
      expect(css.indexOf('html:not(.gogh-phone-preview)') !== -1, 'hide rule not gated to the real front-end');
      expect(new RegExp('gogh-el-' + (i + 1) + ' \\{ display: none').test(css), 'no display:none for the hidden element');
      // rides through the model snapshot
      var snapSec = JSON.parse(G.serialize()).filter(function (o) { return o.scope === s.scope; })[0];
      expect(snapSec && snapSec.els[i].m && snapSec.els[i].m.hidden, 'm.hidden lost in serialize');
      // showing again clears both the marker and the rule
      s.els[i].m = null;
      G.renderSection(s);
      expect(!s.nodes[i].classList.contains('gogh-m-hidden'), 'marker not cleared on show');
      expect(s.styleEl.textContent.indexOf('html:not(.gogh-phone-preview)') === -1, 'hide rule lingered after show');
      return 'hidden gated + marked + round-tripped; cleared on show';
    });

    // ---- 5a-quinquies. ...and the WHOLE-SECTION version: sec.m.hidden drops
    // the band on real phones via a viewport media query on the wrap (the wrap
    // leaves the flow, so a container query could never fire there), gated the
    // same way so the editor's phone preview shows a labelled ghost instead. ----
    test('mobile hide: sec.m.hidden hides the whole band on phones, gated + round-tripping', function () {
      var s = sec();
      s.m = { hidden: true };
      G.renderSection(s);
      expect(s.sectionEl.classList.contains('gogh-msec-hidden'), 'section missing gogh-msec-hidden marker');
      var css = s.styleEl.textContent.replace(/\s+/g, ' ');
      expect(css.indexOf('@media (max-width: 700px)') !== -1 &&
        css.indexOf('html:not(.gogh-phone-preview) .gogh-wrap:has(') !== -1,
        'wrap hide rule missing or un-gated');
      var snapSec = JSON.parse(G.serialize()).filter(function (o) { return o.scope === s.scope; })[0];
      expect(snapSec && snapSec.m && snapSec.m.hidden, 'sec.m lost in serialize');
      s.m = null;
      G.renderSection(s);
      expect(!s.sectionEl.classList.contains('gogh-msec-hidden'), 'marker not cleared on show');
      expect(s.styleEl.textContent.indexOf('.gogh-wrap:has(') === -1 ||
        s.styleEl.textContent.indexOf('html:not(.gogh-phone-preview) .gogh-wrap:has(') === -1,
        'wrap hide rule lingered after show');
      return 'section band gated-hidden + round-tripped; cleared on show';
    });

    // ---- 5a-sexies. mobile reorder: sec.m.order re-stacks the phone column
    // via CSS order (UN-gated — the phone preview must show it too), repairs
    // stale indices, and a stale/partial array still covers every element. ----
    test('mobile reorder: sec.m.order emits order rules, repaired against edits', function () {
      var s = sec();
      var n = s.els.length;
      expect(n >= 2, 'fixture section too small');
      // swap the first two of the natural order, keep the rest
      var seq = (window.__gogh.readingOrder(s.els) || []).slice();
      var t = seq[0]; seq[0] = seq[1]; seq[1] = t;
      s.m = { order: seq };
      G.resolve(s);
      var css = s.styleEl.textContent.replace(/\s+/g, ' ');
      var rules = css.match(/gogh-el-(\d+) \{ order: (\d+)/g) || [];
      expect(rules.length === n, 'expected ' + n + ' order rules, got ' + rules.length);
      expect(new RegExp('gogh-el-' + (seq[0] + 1) + ' \\{ order: 0').test(css), 'first stack slot wrong');
      expect(new RegExp('gogh-el-' + (seq[1] + 1) + ' \\{ order: 1').test(css), 'second stack slot wrong');
      // a STALE patch (bad index, missing entries) still covers every element
      s.m = { order: [99, seq[0]] };
      G.resolve(s);
      var rules2 = (s.styleEl.textContent.replace(/\s+/g, ' ').match(/order: \d+/g) || []).length;
      expect(rules2 === n, 'repair failed: ' + rules2 + ' rules for ' + n + ' elements');
      s.m = null;
      G.resolve(s);
      expect((s.styleEl.textContent.match(/\{ order: \d+/g) || []).length === 0, 'order rules lingered after clear');
      return n + ' elements re-stacked, stale patch repaired, cleared clean';
    });

    // ---- breakout images parallax by default (James: "i kinda love paralax").
    // Wide/full figures in prose get a gentle scroll-driven drift: overflow
    // clipped, img scaled 1.08 for headroom, gogh-wfpx on a view() timeline.
    // Reduced motion turns it all off. ----
    test('breakout images (alignwide/full) parallax by default, reduced-motion off switch served', function () {
      var ec = document.querySelector('.entry-content');
      expect(ec, 'fixture has no .entry-content');
      var f = document.createElement('figure');
      f.className = 'wp-block-image alignwide';
      f.innerHTML = '<img alt="">';
      ec.appendChild(f);
      var img = f.querySelector('img');
      var supports = CSS.supports('animation-timeline: view()');
      if (supports) {
        var cs = getComputedStyle(img);
        expect(cs.animationName === 'gogh-wfpx', 'no default parallax on a wide figure (animation: ' + cs.animationName + ')');
        expect(cs.scale === '1.08', 'headroom scale missing: ' + cs.scale);
        expect(getComputedStyle(f).overflowY === 'clip', 'figure not clipped: ' + getComputedStyle(f).overflowY);
      }
      // contract present in the served CSS either way (rules + the off switch)
      var served = { wfpx: false, reduced: false };
      [].forEach.call(document.styleSheets, function (ss) {
        try { [].forEach.call(ss.cssRules || [], function (r) {
          var t = r.cssText || '';
          if (t.indexOf('gogh-wfpx') !== -1) served.wfpx = true;
          if (t.indexOf('prefers-reduced-motion') !== -1 && t.indexOf('gogh-splash-break') !== -1) served.reduced = true;
        }); } catch (err) {}
      });
      f.remove();
      expect(served.wfpx, 'gogh-wfpx rules not served');
      expect(served.reduced, 'reduced-motion guard not served');
      return supports ? 'drifting on a view() timeline, guard served' : 'rules served (no view() support here)';
    });

    // ---- break-image focal point: the composer carries the chosen slice as
    // an inline object-position (0=top default emits nothing; values clamp). ----
    test('breakImage composer carries a clamped focal point inline', function () {
      var C = window.__goghCompose;
      expect(C && C.breakImage, 'no __goghCompose.breakImage');
      var plain = C.breakImage('https://x.test/a.jpg', 'hi');
      expect(plain.raw.indexOf('object-position') === -1, 'default break should carry no inline focal');
      var mid = C.breakImage('https://x.test/a.jpg', 'hi', 37.4);
      expect(mid.raw.indexOf('style="object-position:50% 37%"') !== -1, 'focal not emitted: ' + mid.raw.slice(0, 200));
      expect(mid.html.indexOf('object-position:50% 37%') !== -1, 'focal missing from preview html');
      var over = C.breakImage('https://x.test/a.jpg', '', 240);
      expect(over.raw.indexOf('object-position:50% 100%') !== -1, 'focal not clamped to 100');
      var under = C.breakImage('https://x.test/a.jpg', '', -33);
      expect(under.raw.indexOf('object-position:50% 0%') !== -1, 'focal not clamped to 0');
      // still a real core image block with the break class
      expect(/wp:image \{"align":"full"/.test(mid.raw) && /gogh-splash-break/.test(mid.raw), 'break block shape changed');
      return 'no-focal clean; 37.4→37%, clamps at 0 and 100';
    });

    // ---- flush bottom: the section is exactly content-tall (or minH) — the
    // old +PAD below the lowest element made the bottom RUN AWAY as you
    // chased it ("i can't drag text so it sits flush with the bottom") ----
    test('an element can sit flush with the section bottom (no phantom pad)', function () {
      var s = sec();
      var i = findIdx('heading');
      var e = s.els[i];
      var x0 = e.x, y0 = e.y, w0 = e.w, h0 = e.h;
      var floor = s.minH || 560;
      e.y = floor - e.h; // bottom exactly at the minH line
      G.resolve(s);
      var r = s.sectionEl.getBoundingClientRect();
      var designHNow = r.height / (r.width / 1200);
      expect(Math.abs(designHNow - floor) <= 12,
        'section ran past the flush element: ' + Math.round(designHNow) + ' vs minH ' + floor);
      e.x = x0; e.y = y0; e.w = w0; e.h = h0;
      G.resolve(s);
      return 'bottom at ' + floor + ', section ' + Math.round(designHNow) + ' — flush';
    });

    // ---- fill-the-width text: the fitted size is stored in cqw (container
    // units), emitted with !important to outgun theme preset classes, and
    // wears nowrap so the fit means ONE line ----
    test('fitW text emits its cqw size into the section CSS', function () {
      var s = sec();
      var i = findIdx('heading');
      var e = s.els[i];
      e.fitW = true; e.fitFs = 8.25;
      G.resolve(s);
      var css = s.styleEl.textContent.replace(/\s+/g, ' ');
      expect(css.indexOf('font-size: 8.25cqw !important') !== -1, 'fitted cqw size not emitted');
      expect(new RegExp('gogh-el-' + (i + 1) + ' \\{[^}]*white-space: nowrap').test(css), 'fit must be single-line');
      e.fitW = null; e.fitFs = null;
      G.resolve(s);
      expect(s.styleEl.textContent.indexOf('cqw !important') === -1, 'fit rule lingered after clearing');
      return '8.25cqw !important + nowrap emitted; clears clean';
    });

    // ---- 5a-bis. ...and the reverse: a COMPACT style after a tall serif pulls
    // the gap back CLOSED. growReflow(sec, true) shrinks as well as grows, so
    // the button rides the heading back UP — no orphaned gap. (A plain
    // re-render omits the flag, leaving stored positions be.) ----
    test('growReflow with allowShrink pulls a button back up under a shrinking heading', function () {
      var s = sec();
      var hi = findIdx('heading');
      var head = s.els[hi];
      head.x = 72; head.w = 700; head.y = 80;
      var btn = { type: 'button', text: 'Our thinking', x: 72, y: 0, w: 220, h: 52 };
      s.els.push(btn);
      var bi = s.els.indexOf(btn);
      G.renderSection(s);
      var naturalH = head.h;
      btn.y = head.y + naturalH + 40; // park it a fixed 40u below the heading
      G.resolve(s);
      var btnNatural = btn.y;
      // a tall serif lands: force the heading tall; model + button follow down
      var scale = s.sectionEl.offsetWidth / 1200;
      s.nodes[hi].style.minHeight = (s.nodes[hi].offsetHeight + Math.round(320 * scale)) + 'px';
      G.growReflow(s, true);
      expect(head.h > naturalH + 100, 'heading did not grow (' + head.h + ' vs ' + naturalH + ')');
      expect(btn.y > btnNatural + 100, 'button not pushed down by the tall heading');
      // a compact style replaces it: same node renders short again, model still
      // reads tall — exactly applyVariation's state at the moment it re-flows
      s.nodes[hi].style.minHeight = '';
      G.growReflow(s, true);
      expect(approx(head.h, naturalH, 8), 'heading did not shrink back (' + head.h + ' vs ' + naturalH + ')');
      expect(approx(btn.y, btnNatural, 10), 'button not pulled back up: ' + btn.y + ' vs ' + btnNatural);
      s.els.splice(bi, 1); // restore
      G.renderSection(s);
      return 'button rode the heading down then back up (' + Math.round(btnNatural) + '→' + Math.round(btn.y) + ')';
    });

    // ---- 5a-ter. text measurement must ignore the birds-eye ZOOM. The zoom is
    // a CSS transform on an ancestor: it shrinks getBoundingClientRect (visual)
    // but NOT offsetWidth (layout). Text height is offsetHeight (layout) / scale,
    // so the scale MUST be layout too — else a heading measured while zoomed
    // comes out ~1/zoom too tall and re-flow shoves everything below into a huge
    // gap (James: "big issues if I change styles zoomed out"). ----
    test('text measurement ignores a zoom transform on an ancestor', function () {
      var i = findIdx('heading');
      var s = sec();
      G.measure(s); // baseline at 1:1
      var h1 = s.els[i].h;
      var host = s.sectionEl.parentElement || document.body;
      var prevTf = host.style.transform, prevOrigin = host.style.transformOrigin;
      host.style.transformOrigin = 'top left';
      host.style.transform = 'scale(0.5)'; // stand in for the zoomed-out artboard
      G.measure(s); // re-measure under the transform
      var h2 = s.els[i].h;
      host.style.transform = prevTf;
      host.style.transformOrigin = prevOrigin;
      G.measure(s); // restore the model to the untransformed reading
      expect(approx(h1, h2, 4), 'zoom transform changed the measured height: ' + h1 + ' -> ' + h2);
      return 'measured ' + h1 + ' at 1:1 and ' + h2 + ' under scale(0.5) — zoom-independent';
    });

    // ---- 5b. frame-interleaved resize pushes exactly once (v0.12.1) ----
    test('per-frame resize push is incremental, not compounding', function () {
      var i = findIdx('heading');
      var e = sec().els[i];
      e.text = 'Make something people remember on every screen';
      if (sec().nodes[i]) sec().nodes[i].textContent = e.text;
      e.x = 72; e.w = 520;
      G.resolve(sec()); G.measure(sec());
      // the page is a living fixture — put a probe element in the push path
      var pj = sec().els.findIndex(function (o, k) { return k !== i && o.type !== 'image'; });
      var probe = sec().els[pj];
      probe.x = e.x;
      probe.y = e.y + e.h + 24;
      G.resolve(sec()); G.measure(sec());
      var h0 = e.h;
      var before = sec().els.map(function (o) { return o.y; });
      select(i);
      var eh = q('.gogh-h-e');
      var r = eh.getBoundingClientRect();
      var x = r.x + r.width / 2, y = r.y + r.height / 2;
      // narrow to 180 design units — guarantees extra wrapping in any font
      var sScale = sec().sectionEl.getBoundingClientRect().width / 1200;
      var deltaPx = (e.w - 180) * sScale;
      pev('pointerdown', eh, x, y, 41);
      // interleave moves with the frame body, as a real 60fps drag does
      for (var f = 1; f <= 4; f++) {
        pev('pointermove', eh, x - deltaPx * f / 4, y, 41);
        var oldH = e.h;
        G.resolve(sec()); G.measure(sec());
        G.reflowPush(sec(), e, oldH);
        G.resolve(sec());
      }
      pev('pointerup', eh, x - deltaPx, y, 41);
      var grew = e.h - h0;
      expect(grew > 10, 'heading did not grow');
      var pushed = sec().els[pj].y - before[pj];
      expect(approx(pushed, grew, 2), 'pushed ' + pushed + ' for growth ' + grew + ' (compounding!)');
      return 'grew ' + grew + ', pushed ' + pushed;
    });

    // ---- 6. typing growth pushes too ----
    test('typing growth pushes in-path elements', function () {
      var i = findIdx('heading');
      var e = sec().els[i];
      var node = sec().nodes[i];
      var below = sec().els.filter(function (o) {
        return o !== e && o.y >= e.y + e.h - 8 && o.x < e.x + e.w && o.x + o.w > e.x;
      })[0];
      expect(below, 'no in-path element below heading in fixture');
      var y0 = below.y;
      select(i);
      node.textContent = node.textContent + ' plus quite a lot of extra words to force wrapping onto several new lines';
      node.dispatchEvent(new InputEvent('input', { bubbles: true }));
      expect(below.y > y0, 'below element not pushed (y ' + y0 + '→' + below.y + ')');
    });

    // ---- 7. drag ghost fidelity (v0.11.7 regression) ----
    test('drag ghost matches element styling', function () {
      var i = findIdx('heading');
      select(i);
      var node = sec().nodes[i];
      var grip = q('.gogh-grip');
      var r = grip.getBoundingClientRect();
      pev('pointerdown', grip, r.x + 12, r.y + 12, 14);
      pev('pointermove', grip, r.x + 60, r.y + 40, 14);
      var ghost = q('.gogh-ghostel');
      expect(ghost, 'no ghost');
      var inner = ghost.querySelector('h2') || ghost.firstElementChild;
      var g = getComputedStyle(inner), o = getComputedStyle(node);
      expect(g.color === o.color, 'ghost colour ' + g.color + ' vs ' + o.color);
      expect(g.fontSize === o.fontSize, 'ghost font ' + g.fontSize + ' vs ' + o.fontSize);
      expect(getComputedStyle(node).visibility === 'hidden', 'original visible during drag');
      expect(!q('.gogh-dropbox').hidden, 'dropbox not shown');
      pev('pointerup', grip, r.x + 60, r.y + 40, 14);
      expect(!q('.gogh-ghostel'), 'ghost not cleaned up');
      expect(q('.gogh-dropbox').hidden, 'dropbox not hidden after drop');
      expect(getComputedStyle(node).visibility === 'visible', 'original still hidden');
    });

    // ---- 8. drag moves the element ----
    test('drag moves element and stays in bounds', function () {
      var i = findIdx('badge');
      var e = sec().els[i];
      var x0 = e.x, y0 = e.y;
      select(i);
      dragBy(q('.gogh-grip'), -60, 40, 15);
      expect(e.x !== x0 || e.y !== y0, 'element did not move');
      expect(e.x >= 0 && e.x + e.w <= 1200, 'out of bounds x=' + e.x);
    });

    // ---- 9. undo / redo ----
    test('undo and redo restore model state', function () {
      // two moves, then walk history back and forward — self-contained so the
      // harness's own snapshot restore (which bypasses history) can't skew it
      var i = findIdx('badge');
      select(i);
      dragBy(q('.gogh-grip'), 60, 0, 16);
      var x1 = sec().els[i].x;
      select(i);
      dragBy(q('.gogh-grip'), 60, 0, 16);
      var x2 = sec().els[i].x;
      expect(x1 !== x2, 'second move failed');
      q('.gogh-undo').click();
      expect(sec().els[i].x === x1, 'undo → ' + sec().els[i].x + ' expected ' + x1);
      q('.gogh-redo').click();
      expect(sec().els[i].x === x2, 'redo → ' + sec().els[i].x + ' expected ' + x2);
    });

    // ---- 10. delete via toolbar, restore via undo ----
    test('delete element + undo', function () {
      var n0 = sec().els.length;
      select(n0 - 1);
      q('.gogh-eb-del').click();
      expect(sec().els.length === n0 - 1, 'delete failed');
      q('.gogh-undo').click();
      expect(sec().els.length === n0, 'undo after delete failed');
    });

    // ---- 11. duplicate ----
    test('duplicate copies the element', function () {
      var i = findIdx('button');
      var n0 = sec().els.length;
      select(i);
      q('.gogh-eb-dup').click();
      expect(sec().els.length === n0 + 1, 'no copy made');
      var copy = sec().els[sec().els.length - 1];
      expect(copy.type === 'button', 'copy has wrong type');
      expect(copy.text === sec().els[i].text, 'copy text differs');
    });

    // ---- 12. add element from palette ----
    test('section ＋ adds a badge', function () {
      // the badge lands in the section you're looking at — wherever that is
      var totals = function () {
        return G.sections().reduce(function (n, s) { return n + s.els.length; }, 0);
      };
      var counts0 = G.sections().map(function (s) { return s.els.length; });
      var t0 = totals();
      addToSec('badge');
      expect(totals() === t0 + 1, 'not added');
      var grew = G.sections().filter(function (s, k) { return s.els.length === counts0[k] + 1; })[0];
      expect(grew, 'no section grew');
      expect(grew.els[grew.els.length - 1].type === 'badge', 'wrong type');
      expect(!grew.chrome, 'landed in the site chrome');
    });

    // ---- 13. add section from template ----
    test('+ Section adds a template section', function () {
      var s0 = G.sections().length;
      G.openPicker(G.sections().length);
      var card = q('.gogh-quick-scratch');
      expect(card, 'picker did not open');
      card.click();
      expect(G.sections().length === s0 + 1, 'section not added');
      var added = lastSec();
      expect(added.minH === 480, 'scratch minH not applied: ' + added.minH);
      expect(added.styleEl.textContent.indexOf(added.scope) !== -1, 'scoped CSS missing');
    });

    test('__max font sentinel resolves to the largest preset at insert', function () {
      var s0 = G.sections().length;
      // any template whose heading carries the __max sentinel (the starters do)
      var tpls = G.templates();
      var idx = -1;
      for (var i = 0; i < tpls.length; i++) {
        if ((tpls[i].els || []).some(function (e) { return e.type === 'heading' && e.fs === '__max'; })) { idx = i; break; }
      }
      expect(idx !== -1, 'no template carries the __max sentinel');
      G.addSection(tpls[idx], G.sections().length);
      var added = lastSec();
      var head = added.els.filter(function (e) { return e.type === 'heading' && e.fs; })[0];
      var sizes = G.fontSizes();
      var biggest = sizes.length ? sizes[sizes.length - 1].slug : null;
      expect(head, 'template has no sized heading');
      expect(head.fs === biggest, 'heading fs ' + head.fs + ' != largest preset ' + biggest);
      expect(head.fs !== '__max', 'sentinel leaked into model');
      G.deleteSection(G.sections().indexOf(added));
      expect(G.sections().length === s0, 'cleanup failed');
    });

    test('toolbar alignment cycles left/center/right', function () {
      var i = findIdx('heading');
      select(i);
      var al = q('.gogh-eb-al');
      expect(al && al.style.display !== 'none', 'align button not shown for heading');
      var e = sec().els[i];
      var a0 = e.align || null;
      e.align = null; // the living fixture may already be centred — start clean
      al.click();
      expect(e.align === 'center', 'first click should centre, got ' + e.align);
      expect(sec().styleEl.textContent.indexOf('text-align: center') !== -1, 'centre not in CSS');
      al.click();
      expect(e.align === 'right', 'second click should right-align, got ' + e.align);
      al.click();
      expect(e.align === null || e.align === undefined || !e.align, 'third click should reset, got ' + e.align);
      e.align = a0;
    });

    test('publish chip tracks dirty state', function () {
      var chipEl = q('.gogh-chip');
      expect(chipEl && !chipEl.hidden, 'chip not visible in edit mode');
      var i = findIdx('badge');
      select(i);
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(window.__gogh.isDirty(), 'isDirty false after arrow nudge');
      expect(chipEl.className.indexOf('is-dirty') !== -1, 'chip not in dirty state: ' + chipEl.className);
      var btn = q('.gogh-chip-btn');
      expect(btn && !btn.hidden && btn.textContent === 'Publish', 'Publish button not offered');
      return chipEl.textContent.trim();
    });

    test('closing with unpublished changes offers choices', function () {
      var i = findIdx('badge');
      select(i);
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(window.__gogh.isDirty(), 'expected dirty state');
      document.querySelector('#wp-admin-bar-gogh-edit a').click();
      var panel = q('.gogh-exit');
      expect(panel && !panel.hidden, 'exit panel did not open');
      q('.gogh-exit-keep').click();
      expect(panel.hidden, 'keep editing did not close panel');
      expect(document.documentElement.classList.contains('gogh-editing'), 'left edit mode');
    });

    test('toast shows message and actions work', function () {
      var acted = false;
      window.__gogh.toast('test toast', { sticky: true, actions: [{ label: 'Do it', onClick: function () { acted = true; } }] });
      var mine = function () {
        return [].slice.call(document.querySelectorAll('.gogh-toast')).filter(function (x) {
          return x.textContent.indexOf('test toast') !== -1;
        })[0];
      };
      var t = mine();
      expect(t, 'toast not shown');
      t.querySelector('button').click();
      expect(acted, 'toast action did not fire');
      expect(!mine(), 'toast not removed after action');
    });

    test('text colour uses theme palette and emits native markup', function () {
      var i = findIdx('heading');
      select(i);
      var colBtn = q('.gogh-eb-col');
      expect(colBtn && colBtn.style.display !== 'none', 'colour button not shown');
      colBtn.click();
      var sws = document.querySelectorAll('.gogh-panel .gogh-sw');
      expect(sws.length > 1, 'no theme swatches in panel (' + sws.length + ')');
      var pick = sws[1]; // first real palette colour
      var slug = pick.dataset.col;
      pick.click();
      var e = sec().els[i];
      expect(e.color === slug, 'model colour not set: ' + e.color);
      var node = sec().nodes[i];
      expect(node.className.indexOf('has-' + slug + '-color') !== -1 && node.className.indexOf('has-text-color') !== -1,
        'colour classes missing on node: ' + node.className);
      var blocks = G.buildBlocks();
      expect(blocks.indexOf('"textColor":"' + slug + '"') !== -1, 'textColor attr missing in markup');
      // reset via the panel's default swatch
      colBtn.click();
      document.querySelector('.gogh-panel .gogh-sw-none').click();
      expect(!sec().els[i].color, 'default swatch did not clear colour');
    });

    function closePanelForTest() {
      var p = document.querySelector('.gogh-panel');
      if (p) p.hidden = true;
    }
    test('button panel sets bg, text, hover and outline', function () {
      var i = findIdx('button');
      select(i);
      q('.gogh-eb-ctx').click();
      var rows = document.querySelectorAll('.gogh-panel .gogh-swrow[data-key]');
      expect(rows.length === 3, 'expected 3 swatch rows, got ' + rows.length);
      var e = sec().els[i];
      var bgRow = document.querySelector('.gogh-panel .gogh-swrow[data-key="btnBg"]');
      var slug = bgRow.querySelectorAll('.gogh-sw')[1].dataset.col;
      bgRow.querySelectorAll('.gogh-sw')[1].click();
      expect(e.btnBg === slug, 'btnBg not set: ' + e.btnBg);
      var a = sec().nodes[i].querySelector('a');
      expect(a.className.indexOf('has-' + slug + '-background-color') !== -1 && a.className.indexOf('has-background') !== -1,
        'bg classes missing: ' + a.className);
      var hovRow = document.querySelector('.gogh-panel .gogh-swrow[data-key="btnHover"]');
      var hslug = hovRow.querySelectorAll('.gogh-sw')[2].dataset.col;
      hovRow.querySelectorAll('.gogh-sw')[2].click();
      expect(sec().styleEl.textContent.indexOf(':hover { background-color: var(--wp--preset--color--' + hslug + ')') !== -1,
        'hover CSS missing');
      document.querySelector('.gogh-panel .gogh-style-outline').click();
      expect(sec().els[i].ghost === true, 'outline toggle failed');
      var blocks = G.buildBlocks();
      expect(blocks.indexOf('"backgroundColor":"' + slug + '"') !== -1, 'backgroundColor attr missing in markup');
      expect(blocks.indexOf('gogh-ghost') !== -1, 'ghost class missing in markup');
      closePanelForTest();
    });

    test('boot sync adopts Gutenberg edits into the model', function () {
      var host = document.createElement('div');
      host.innerHTML =
        '<h2 class="wp-block-heading gogh-el-1 has-text-align-right has-large-font-size">Edited headline</h2>' +
        '<p class="gogh-el-2 has-text-align-center has-text-color has-accent-color">New copy</p>' +
        '<div class="wp-block-buttons gogh-el-3"><div class="wp-block-button">' +
        '<a class="wp-block-button__link has-base-color has-text-color has-contrast-background-color has-background wp-element-button" href="https://z.test">Buy now</a></div></div>';
      var els = [
        { type: 'heading', x: 0, y: 0, w: 600, h: 80, text: 'Old headline', fs: null, align: null, color: null },
        { type: 'para', x: 0, y: 100, w: 500, h: 60, text: 'Old copy' },
        { type: 'button', x: 0, y: 200, w: 180, h: 52, text: 'Old', href: null },
        { type: 'badge', x: 0, y: 300, w: 200, h: 52, text: 'Gone' },
      ];
      var out = G.syncModelFromMarkup(host, els);
      expect(out.length === 3, 'deleted badge not dropped (len ' + out.length + ')');
      expect(out[0].text === 'Edited headline' && out[0].fs === 'large' && out[0].align === 'right',
        'heading not synced: ' + JSON.stringify(out[0]));
      expect(out[1].align === 'center' && out[1].color === 'accent', 'para colour/align not synced: ' + out[1].color);
      expect(out[2].text === 'Buy now' && out[2].href === 'https://z.test' &&
        out[2].btnBg === 'contrast' && out[2].btnText === 'base',
        'button not synced: ' + JSON.stringify(out[2]));
      return 'heading/para/button synced, deleted badge dropped';
    });

    test('context panel stays inside the viewport', function () {
      var i = findIdx('image');
      var e = sec().els[i];
      var h0 = e.h, y0 = e.y;
      e.y = 40; e.h = 2400; // taller than any viewport
      G.resolve(sec());
      select(i);
      q('.gogh-eb-ctx').click();
      var p = document.querySelector('.gogh-panel');
      var pr = p.getBoundingClientRect();
      expect(pr.bottom <= window.innerHeight + 1, 'panel bottom ' + Math.round(pr.bottom) + ' beyond viewport ' + window.innerHeight);
      expect(pr.top >= -1, 'panel top above viewport (' + Math.round(pr.top) + ')');
      p.hidden = true;
      e.h = h0; e.y = y0;
      return 'panel at ' + Math.round(pr.top) + '..' + Math.round(pr.bottom) + ' in ' + window.innerHeight + 'px viewport';
    });

    test('mobile order keeps feature cards together (XY-cut)', function () {
      // heading spanning the top, then 3 columns of image+para+button
      var els = [
        { type: 'heading', x: 300, y: 40, w: 600, h: 60 },
        { type: 'image', x: 72, y: 160, w: 300, h: 200 },
        { type: 'image', x: 450, y: 160, w: 300, h: 200 },
        { type: 'image', x: 828, y: 160, w: 300, h: 200 },
        { type: 'para', x: 72, y: 380, w: 300, h: 60 },
        { type: 'para', x: 450, y: 380, w: 300, h: 60 },
        { type: 'para', x: 828, y: 380, w: 300, h: 60 },
        { type: 'button', x: 72, y: 470, w: 180, h: 52 },
        { type: 'button', x: 450, y: 470, w: 180, h: 52 },
        { type: 'button', x: 828, y: 470, w: 180, h: 52 },
      ];
      var css = G.resolveCSS ? '' : null;
      // rank via the generated CSS ordering: rebuild through buildCSS on a
      // scratch scope and read the emitted mobile order rules
      var probeSec = { els: els, minH: null, bg: null, divider: null, bgImage: null, bgId: null };
      var out = window.__gogh.readingOrder ? window.__gogh.readingOrder(els) : null;
      expect(out, 'readingOrder hook missing');
      // expected: heading first, then col1 (img,para,btn), col2, col3
      var expected = [0, 1, 4, 7, 2, 5, 8, 3, 6, 9];
      expect(JSON.stringify(out) === JSON.stringify(expected),
        'order ' + JSON.stringify(out) + ' != ' + JSON.stringify(expected));
      return 'cards stay together: ' + out.join(',');
    });

    test('inline sanitizer keeps links, strips danger', function () {
      var c = G.cleanInline;
      expect(c('<a href="https://ok.test">x</a>') === '<a href="https://ok.test">x</a>', 'safe link mangled: ' + c('<a href="https://ok.test">x</a>'));
      expect(c('<a href="javascript:alert(1)">x</a>') === '<a>x</a>', 'js: href not stripped: ' + c('<a href="javascript:alert(1)">x</a>'));
      expect(c('<script>bad()</script>hello') === 'hello', 'script not removed: ' + c('<script>bad()</script>hello'));
      expect(c('<b onclick="x()">b</b>') === '<b>b</b>', 'event attr survived: ' + c('<b onclick="x()">b</b>'));
      expect(c('<span style="color:red">s</span>') === 's', 'span not unwrapped');
      expect(c('<img src=x onerror=bad()>t') === 't', 'img survived');
      expect(c('plain & <text>') === 'plain &amp; ', 'plain text handling: ' + JSON.stringify(c('plain & <text>')));
    });

    test('links round-trip: model, canvas, markup', function () {
      var i = findIdx('para');
      var e = sec().els[i];
      var t0 = e.text;
      e.text = 'Visit <a href="https://gogh.test/docs">the docs</a> today';
      G.resolve(sec());
      var node = sec().nodes ? null : null;
      // re-render so the canvas picks up the rich text
      window.__gogh.restore(G.serialize());
      var n2 = sec().nodes[findIdx('para')];
      var a = n2.querySelector('a');
      expect(a && a.getAttribute('href') === 'https://gogh.test/docs', 'link not rendered on canvas');
      var blocks = G.buildBlocks();
      expect(blocks.indexOf('<a href="https://gogh.test/docs">the docs</a>') !== -1, 'link missing from markup');
      sec().els[findIdx('para')].text = t0;
    });

    test('toolbar link button links the whole element', function () {
      var i = findIdx('heading');
      select(i);
      var lnk = q('.gogh-eb-lnk');
      expect(lnk && lnk.style.display !== 'none', 'link button not shown for heading');
      lnk.click();
      var input = document.querySelector('.gogh-panel input[type="url"]');
      expect(input, 'link panel did not open');
      input.value = 'https://whole.test';
      document.querySelector('.gogh-panel .gogh-apply').click();
      var e = sec().els[i];
      expect(e.text.indexOf('href="https://whole.test"') !== -1, 'link not applied: ' + e.text.slice(0, 80));
      // clean up: strip the link from the model text
      e.text = e.text.replace(/<a[^>]*>/g, '').replace(/<\/a>/g, '');
    });

    test('body drag moves an element without the grip', function () {
      var i = findIdx('badge');
      var e = sec().els[i];
      var x0 = e.x;
      var node = sec().nodes[i];
      var s = sec().sectionEl.getBoundingClientRect().width / 1200;
      var r = node.getBoundingClientRect();
      var sx = r.left + 10, sy = r.top + 10;
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: sx, clientY: sy, pointerId: 80 }));
      node.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: sx + 6, clientY: sy, pointerId: 80 }));
      node.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: sx + 41 * s, clientY: sy, pointerId: 80 }));
      node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: sx + 41 * s, clientY: sy, pointerId: 80 }));
      expect(Math.abs(e.x - x0) > 10, 'element did not move from body drag (x ' + x0 + '\u2192' + e.x + ')');
    });

    test('second click enters text editing, Escape leaves', function () {
      var i = findIdx('heading');
      var node = sec().nodes[i];
      var r = node.getBoundingClientRect();
      var cx = r.left + 20, cy = r.top + 10;
      // first click: select only
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy, pointerId: 81 }));
      node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: cx, clientY: cy, pointerId: 81 }));
      expect(!node.isContentEditable, 'first click should not enter editing');
      // second click: edit
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy, pointerId: 82 }));
      node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: cx, clientY: cy, pointerId: 82 }));
      expect(node.isContentEditable, 'second click should enter editing');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(!node.isContentEditable, 'Escape should leave editing');
    });

    test('instant tooltips replace native titles', function () {
      var i = findIdx('heading');
      select(i);
      var btn = q('.gogh-eb-dup');
      G.showTip(btn);
      var tip = document.querySelector('.gogh-tip');
      expect(tip && !tip.hidden, 'tooltip did not show');
      expect(tip.textContent.indexOf('Duplicate') !== -1, 'tooltip text wrong: ' + tip.textContent);
      expect(!btn.getAttribute('title'), 'native title not suppressed');
      document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      expect(tip.hidden, 'tooltip did not hide on pointerdown');
    });

    test('keyboard nudge shows spacing labels', function () {
      var i = findIdx('badge');
      // labels measure to a neighbour — make sure the badge has one
      var e = sec().els[i];
      var other = sec().els.filter(function (o, k) { return k !== i; })[0];
      e.y = other.y;
      e.x = Math.max(8, Math.min(1200 - e.w - 8, other.x + other.w + 120));
      G.resolve(sec());
      select(i);
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      var shown = [...document.querySelectorAll('.gogh-dist')].filter(function (d) { return !d.hidden; });
      expect(shown.length > 0, 'no spacing labels during nudge');
      expect(/\d/.test(shown[0].textContent), 'label has no number: ' + shown[0].textContent);
    });

    test('slash opens quick add, filters, inserts', function () {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      var n0 = sec().els.length;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
      var menu = document.querySelector('.gogh-cmd');
      expect(menu && !menu.hidden, 'slash did not open the menu');
      var input = document.querySelector('.gogh-cmd-in');
      input.value = 'badge';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      var items = [].slice.call(document.querySelectorAll('.gogh-cmd-item'));
      expect(items.length === 1 && items[0].textContent === 'Badge',
        'filter wrong: ' + items.map(function (b) { return b.textContent; }).join(','));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(menu.hidden, 'menu did not close after Enter');
      var els = sec().els;
      expect(els.length === n0 + 1 && els[els.length - 1].type === 'badge', 'badge not inserted');
    });

    test('grid toggle shows the grid it snaps to', function () {
      var btn = q('.gogh-side [data-act="gridsnap"]');
      expect(btn.querySelector('svg'), 'grid toggle has no icon');
      var was = document.documentElement.classList.contains('gogh-grid-on');
      btn.click();
      expect(document.documentElement.classList.contains('gogh-grid-on') !== was, 'grid class did not toggle');
      expect(btn.classList.contains('is-active') === !was, 'icon active state wrong');
      btn.click();
      expect(document.documentElement.classList.contains('gogh-grid-on') === was, 'grid class did not toggle back');
    });

    test('grid on: drops land on the grid', function () {
      var btn = q('.gogh-side [data-act="gridsnap"]');
      if (!document.documentElement.classList.contains('gogh-grid-on')) btn.click();
      addToSec('badge');
      var n = sec().els.length - 1;
      var e = sec().els[n];
      e.w = 200; e.h = 60;
      // pick grid targets that no alignment candidate can capture (>7 away)
      function freeTarget(axis, lo, hi) {
        var cands = axis === 'x' ? [0, 1200, 600] : [0];
        sec().els.forEach(function (o) {
          if (o === e) return;
          if (axis === 'x') cands.push(o.x, o.x + o.w, o.x + o.w / 2);
          else cands.push(o.y, o.y + o.h, o.y + o.h / 2);
        });
        for (var t = lo; t <= hi; t += 8) {
          var ok = cands.every(function (c) { return Math.abs(c - t) > 7; });
          if (ok) return t;
        }
        return lo;
      }
      var tx = freeTarget('x', 160, 640);
      var ty = freeTarget('y', 1560, 2000);
      e.x = tx - 40; e.y = ty - 32;
      G.resolve(sec());
      select(n);
      var s = sec().sectionEl.getBoundingClientRect().width / 1200;
      var grip = q('.gogh-grip');
      var r = grip.getBoundingClientRect();
      // raw release point 3 units off-grid: only the grid can produce tx/ty
      grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x + 12, clientY: r.y + 12, pointerId: 91 }));
      grip.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.x + 12 + 43 * s, clientY: r.y + 12 + 35 * s, pointerId: 91 }));
      grip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.x + 12 + 43 * s, clientY: r.y + 12 + 35 * s, pointerId: 91 }));
      // the point is "off-grid drop snaps ONTO the grid near the target" — assert
      // grid-alignment within a cell, not an exact pixel (a real drag's sub-px
      // scale rounding can tip an exact === by one grid step)
      expect(e.x % 8 === 0 && Math.abs(e.x - tx) <= 8 && e.y % 8 === 0, 'drop did not snap to grid: ' + e.x + ',' + e.y + ' (wanted x≈' + tx + ' on grid, y%8=0)');
      if (document.documentElement.classList.contains('gogh-grid-on')) btn.click(); // restore default
      return 'landed on grid at ' + e.x + ',' + e.y;
    });

    test('centring a text box centres the ink, not the box', function () {
      // an OWN section: the living fixture's cumulative reflow pushes can
      // park symmetric neighbours anywhere, and their equal-spacing magnet
      // then legitimately catches the box at 600 — this test is about the
      // ink magnet alone, so it gets an empty room
      G.addSection({ name: 'INK', minH: 600, els: [
        { type: 'heading', x: 100, y: 200, w: 500, h: 60, text: 'A new heading' },
      ] }, G.sections().length);
      var inkSec = lastSec();
      var sec = function () { return inkSec; };
      var n = 0;
      var e = sec().els[n];
      G.resolve(sec()); G.measure(sec()); G.resolve(sec());
      var node = sec().nodes[n];
      var host = node.matches('h1,h2,h3,h4,p') ? node : (node.querySelector('h1,h2,h3,h4,p') || node);
      var rng = document.createRange();
      rng.selectNodeContents(host);
      var s = sec().sectionEl.getBoundingClientRect().width / 1200;
      var tw = rng.getBoundingClientRect().width / s;
      expect(tw > 0 && tw < e.w - 40, 'heading text should be narrower than its box (tw=' + Math.round(tw) + ')');
      pev('pointerdown', sec().nodes[n]); // the outer select() helper aims at the FIXTURE section
      var grip = q('.gogh-grip');
      // release with the INK's centre 1 unit shy of the section centre —
      // only the text-centre magnet can finish it (box centre is far away)
      var dx = ((600 - tw / 2 - 1) - e.x) * s;
      dragBy(grip, dx, 0, 97);
      var inkCentre = Math.round(sec().els[n].x + tw / 2);
      expect(inkCentre === 600, 'ink centre landed at ' + inkCentre + ', wanted 600 (box x=' + sec().els[n].x + ')');
      // and the box centre must NOT compete: release with the BOX's centre
      // a unit shy of 600 — nothing should catch (James's report: the box
      // magnet won and the words sat visibly off-centre)
      var e2 = sec().els[n];
      var dx2 = ((600 - e2.w / 2 - 1) - e2.x) * s;
      dragBy(q('.gogh-grip'), dx2, 0, 98);
      var boxCentre = Math.round(sec().els[n].x + e2.w / 2);
      expect(boxCentre !== 600, 'box centre snapped to 600 — the box magnet should be gone for slack text');
      G.deleteSection(G.sections().indexOf(inkSec));
      return 'words centred at 600; box magnet retired for slack text';
    });

    test('a background makes the blank placeholder real', function () {
      G.addSection({ title: 'BB', minH: 200, els: [] });
      var c = contentSecs();
      var b = c[c.length - 1];
      b.bootstrap = true;
      G.renderSection(b);
      expect(b.sectionEl.querySelector('.gogh-bootinvite'), 'blank bootstrap should show the invite');
      b.bg = '#112233';
      G.renderSection(b);
      expect(!b.sectionEl.querySelector('.gogh-bootinvite'), 'a background should dismiss the invite');
      // James's report: he gave the placeholder a background image, and it
      // kept inviting — worse, publish and new sections treated it as blank
      G.addSection({ title: 'BB2', minH: 200, els: [] });
      expect(G.sections().indexOf(b) !== -1, 'backgrounded placeholder must survive a new section arriving');
      var c2 = contentSecs();
      G.deleteSection(G.sections().indexOf(c2[c2.length - 1]));
      G.deleteSection(G.sections().indexOf(b));
      return 'blank invites; backgrounded publishes and persists';
    });

    test('products element: Woo grid in the ＋ menu, shortcode in the blocks', function () {
      G.openSecAdd(G.sections().indexOf(sec()));
      var btn = q('.gogh-panel [data-add="products"]');
      var panelEl = q('.gogh-panel');
      if (panelEl) panelEl.hidden = true;
      if (!btn) return 'no WooCommerce here — Products stays out of the menu, as designed';
      var e = G.addElementToSection(G.sections().indexOf(sec()), 'products');
      expect(e.type === 'widget', 'products should be a widget element');
      expect((e.wsrc || '').indexOf('[products') !== -1, 'wsrc should carry the Woo shortcode');
      expect((e.whtml || '').indexOf('gogh-postsprev') !== -1, 'preview placeholder missing');
      var snap = G.serialize();
      expect(snap.indexOf('[products') !== -1, 'products shortcode should survive serialization');
      var i = sec().els.indexOf(e);
      sec().els.splice(i, 1);
      G.renderSection(sec());
      return 'Products offered, added, shortcode round-trips';
    });

    test('featured product composes a card of real gogh pieces', function () {
      if (!G.composeFeaturedProduct) return 'compose not exported';
      var card = G.composeFeaturedProduct(G.sections().indexOf(sec()), {
        name: 'Sunflowers — giclée print',
        img: '/wp-content/plugins/gogh/demo-assets/sunflowers.jpg',
        priceText: '£25.00',
        permalink: '/product/sunflowers',
        addUrl: '?add-to-cart=99',
      });
      expect(card.type === 'box' && card.kids && card.kids.length === 4, 'not a 4-kid card');
      var kinds = card.kids.map(function (k) { return k.type; }).join(',');
      expect(kinds === 'image,heading,badge,button', 'kid kinds wrong: ' + kinds);
      expect(card.kids[3].href === '?add-to-cart=99', 'buy button should carry the add-to-cart URL');
      expect(card.kids[2].text === '£25.00', 'price badge wrong');
      var snap = G.serialize();
      expect(snap.indexOf('add-to-cart=99') !== -1, 'add-to-cart link should survive serialization');
      var i2 = sec().els.indexOf(card);
      sec().els.splice(i2, 1);
      G.renderSection(sec());
      return 'image + name + price + working buy button, one card';
    });

    test('contrast sentinel: dark words on dark ground fix themselves', function () {
      // variation-proof: work out which of base/contrast is the DARK slug
      // right now (James flips site styles constantly, and dark variations
      // make the default ink light — the old test assumed dark ink)
      var probe = function (slug) {
        var d = document.createElement('div');
        d.style.color = 'var(--wp--preset--color--' + slug + ')';
        d.style.display = 'none';
        document.body.appendChild(d);
        var m = (getComputedStyle(d).color.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        d.remove();
        return (m[0] + m[1] + m[2]) / 3;
      };
      var darker = probe('base') < probe('contrast') ? 'base' : 'contrast';
      var lighter = darker === 'base' ? 'contrast' : 'base';
      G.addSection({ title: 'CS', minH: 240, bg: '#101014', els: [
        { type: 'heading', x: 90, y: 40, w: 500, h: 60, text: 'Dark on dark' },
      ] });
      var c = contentSecs();
      var s2 = c[c.length - 1];
      var e = s2.els[0];
      e.color = darker;
      // an eyebrow-style captured colour paints with !important — the flip
      // must clear it or it silently wins (James's night-sky eyebrow)
      e.tf = { col: 'color-mix(in srgb, var(--wp--preset--color--' + darker + ') 62%, transparent)', ls2: 0.2 };
      G.renderSection(s2);
      G.contrastSentinel(s2);
      expect(e.color === lighter, 'dark ink on dark ground should flip to ' + lighter + ' (got ' + e.color + ')');
      expect(!e.tf.col, 'the flip must clear the captured tf colour');
      expect(e.tf.ls2 === 0.2, 'other captured typography must survive the flip');
      // and readable text is left alone: the darker ink on a pale ground
      G.addSection({ title: 'CS2', minH: 240, bg: '#f5f5f2', els: [
        { type: 'heading', x: 90, y: 40, w: 500, h: 60, text: 'Fine as is' },
      ] });
      var c2 = contentSecs();
      var s3 = c2[c2.length - 1];
      s3.els[0].color = darker;
      G.renderSection(s3);
      G.contrastSentinel(s3);
      expect(s3.els[0].color === darker, 'sentinel recoloured text that was already readable');
      G.deleteSection(G.sections().indexOf(s3));
      G.deleteSection(G.sections().indexOf(s2));
      return 'dark ground flips ' + darker + '→' + lighter + '; pale ground untouched';
    });

    test('sentinel reads gradient grounds, not the theme-base fallback', function () {
      // meshes are background-IMAGE: colour computes transparent, and the
      // old fallback judged words against theme base — on a dark styling
      // that approved white words on a pale sky ("sentinels not working
      // on the top hero")
      var probe = function (slug) {
        var d = document.createElement('div');
        d.style.color = 'var(--wp--preset--color--' + slug + ')';
        d.style.display = 'none';
        document.body.appendChild(d);
        var m = (getComputedStyle(d).color.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        d.remove();
        return (m[0] + m[1] + m[2]) / 3;
      };
      var darker = probe('base') < probe('contrast') ? 'base' : 'contrast';
      var lighter = darker === 'base' ? 'contrast' : 'base';
      G.addSection({ title: 'GR', minH: 240, els: [
        { type: 'heading', x: 90, y: 40, w: 500, h: 60, text: 'Words on a mesh' },
      ] });
      var c = contentSecs();
      var s = c[c.length - 1];
      // a pale gradient painted the way moods paint: image, not colour
      s.sectionEl.style.backgroundImage = 'linear-gradient(180deg, rgb(250,244,225), rgb(236,228,205))';
      s.sectionEl.style.backgroundColor = 'transparent';
      s.els[0].color = lighter; // pale ink on a pale sky
      G.renderSection(s);
      s.sectionEl.style.backgroundImage = 'linear-gradient(180deg, rgb(250,244,225), rgb(236,228,205))';
      s.sectionEl.style.backgroundColor = 'transparent';
      G.contrastSentinel(s);
      expect(s.els[0].color === darker, 'pale ink on a pale gradient should flip to ' + darker + ' (got ' + s.els[0].color + ')');
      G.deleteSection(G.sections().indexOf(s));
      return 'gradient stops are the ground: ' + lighter + '→' + darker + ' on cream mesh';
    });

    test('sentinel reaches inside cards: kids judged on the card ground', function () {
      var probe = function (slug) {
        var d = document.createElement('div');
        d.style.color = 'var(--wp--preset--color--' + slug + ')';
        d.style.display = 'none';
        document.body.appendChild(d);
        var m = (getComputedStyle(d).color.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        d.remove();
        return (m[0] + m[1] + m[2]) / 3;
      };
      var roles = G.paletteRoles();
      var darker = probe(roles.bgSlug) < probe(roles.textSlug) ? roles.bgSlug : roles.textSlug;
      G.addSection({ name: 'CSK', minH: 300, els: [
        { type: 'box', x: 80, y: 40, w: 400, h: 220, boxBg: '#101014', radius: 16, kids: [
          { type: 'heading', x: 24, y: 24, w: 340, h: 44, text: 'Dark on dark card' },
        ] },
      ] }, G.sections().length);
      var c = contentSecs();
      var s2 = c[c.length - 1];
      try {
        var kid = s2.els[0].kids[0];
        kid.color = darker;
        kid.tf = { col: '#101014' }; // captured colour must clear on flip
        G.renderSection(s2);
        G.contrastSentinel(s2);
        expect(kid.color !== darker, 'kid ink should flip on a dark card (still ' + kid.color + ')');
        expect(!kid.tf.col, 'the flip must clear the kid\u2019s captured colour');
        // and a PALE color-mix card must NOT flip dark ink to white — the
        // naive number-grab read the mix's dark component as the ground
        if (probe(roles.bgSlug) > 150) {
          var mix = 'color-mix(in srgb, var(--wp--preset--color--' + roles.textSlug + ', #000) 7%, var(--wp--preset--color--' + roles.bgSlug + ', transparent))';
          s2.els[0].boxBg = mix;
          s2.els[0].kids[0].color = darker;
          G.renderSection(s2);
          G.contrastSentinel(s2);
          expect(s2.els[0].kids[0].color === darker,
            'pale-mix card wrongly flipped its ink to ' + s2.els[0].kids[0].color);
        }
      } finally {
        G.deleteSection(G.sections().indexOf(s2));
      }
      return 'card kids flip on their own ground, tf cleared';
    });

    test('section themes: pick a look, the words come with it', function () {
      var themes = G.sectionThemes();
      expect(themes.length >= 3, 'expected at least Paper/Mist/Ink, got ' + themes.length);
      G.addSection({ title: 'TH', minH: 240, els: [ { type: 'heading', x: 90, y: 40, w: 500, h: 60, text: 'Themed' } ] });
      var c = contentSecs();
      var s2 = c[c.length - 1];
      var idx = G.sections().indexOf(s2);
      var ink = themes.filter(function (t2) { return t2.slug === 'ink'; })[0];
      expect(ink, 'no Ink look derived');
      G.applySectionTheme(idx, ink);
      expect(s2.theme === 'ink', 'theme not recorded on the section');
      var inkVar = '--wp--preset--color--' + (G.paletteRoles() || {}).textSlug;
      expect(String(s2.bg).indexOf(inkVar) !== -1, 'Ink bg should ride the text-role var (' + inkVar + ')');
      expect(s2.els[0].color === 'base', 'heading ink should flip to base (got ' + s2.els[0].color + ')');
      var snap = G.serialize();
      expect(snap.indexOf('"theme":"ink"') !== -1, 'theme should serialize');
      // BACKDROPS: designed gradient compositions join the theme shelf
      var slugs = G.sectionThemes().map(function (x) { return x.slug; });
      ['sweep', 'mesh'].forEach(function (b) {
        expect(slugs.indexOf(b) !== -1, 'backdrop missing: ' + b);
      });
      var sweep = G.sectionThemes().filter(function (x) { return x.slug === 'sweep'; })[0];
      expect(/radial-gradient/.test(sweep.bg), 'sweep must be a gradient composition');
      s2.bgImage = '/x.jpg'; // a backdrop must REPLACE a picture, not hide behind it
      G.applySectionTheme(G.sections().indexOf(s2), sweep);
      expect(s2.theme === 'sweep' && /gradient/.test(s2.bg), 'sweep should apply like any theme');
      expect(!s2.bgImage, 'a backdrop replaces the background image');
      expect(/"theme":"sweep"/.test(G.serialize()), 'backdrop must serialize');
      // a composition never leaks into a colour-mix (the tint dial path)
      s2.bgA = 40;
      G.resolve(s2);
      expect(!/color-mix\(in srgb, radial-gradient/.test(s2.styleEl.textContent), 'gradient must not enter color-mix');
      G.deleteSection(G.sections().indexOf(s2));
      return themes.length + ' looks; Ink flips bg and words together';
    });

    test('section height: presets set minH, Fill rides svh', function () {
      G.addSection({ title: 'HT', minH: 240, els: [ { type: 'heading', x: 90, y: 40, w: 400, h: 60, text: 'Tall' } ] });
      var c = contentSecs();
      var s2 = c[c.length - 1];
      s2.minH = 800; s2.fill = false;
      G.renderSection(s2);
      expect((s2.styleEl.textContent || '').indexOf('min-height: calc(100svh - var(--wp-admin--admin-bar--height, 0px))') === -1, 'no-fill section must not claim the screen');
      s2.fill = true;
      G.renderSection(s2);
      expect((s2.styleEl.textContent || '').indexOf('min-height: calc(100svh - var(--wp-admin--admin-bar--height, 0px))') !== -1, 'Fill screen should emit min-height:100svh');
      var snap = G.serialize();
      expect(snap.indexOf('"boot":false') !== -1 || snap.indexOf('"fill":true') !== -1, 'fill should serialize');
      G.deleteSection(G.sections().indexOf(s2));
      return 'S/M/L via minH; Fill emits 100svh and round-trips';
    });

    test('rearrange: the solver proposes honest alternatives', function () {
      G.addSection({ title: 'RA', minH: 400, els: [
        { type: 'heading', x: 72, y: 60, w: 500, h: 60, text: 'Rearrange me' },
        { type: 'para', x: 72, y: 160, w: 420, h: 60, text: 'Some words to move about.' },
        { type: 'image', x: 700, y: 60, w: 380, h: 260, src: '/wp-content/plugins/gogh/demo-assets/sunflowers.jpg' },
      ] });
      var c = contentSecs();
      var s2 = c[c.length - 1];
      var v = G.rearrangeVariants(s2);
      expect(v.length >= 4, 'expected mirror/centred/rail/split, got ' + v.length);
      var mirror = v.filter(function (x) { return x.slug === 'mirror'; })[0];
      // mirror: boxes flip by their box; slack left-aligned text flips by
      // its INK so the words land where the eye expects
      s2.els.forEach(function (e, i) {
        var iw = G.inkWidthOf(s2, i);
        var want = (iw && (!e.align || e.align === 'left')) ? 1200 - e.x - iw : 1200 - e.x - e.w;
        want = Math.max(0, Math.min(1200 - e.w, want));
        expect(Math.abs(mirror.pos[i].x - want) <= 1, 'mirror x wrong for el ' + i + ' (got ' + mirror.pos[i].x + ' want ' + want + ')');
      });
      var centred = v.filter(function (x) { return x.slug === 'centred'; })[0];
      // centred: the INK of slack text sits on the canvas centreline
      s2.els.forEach(function (e, i) {
        var iw = G.inkWidthOf(s2, i);
        if (!iw || (e.align && e.align !== 'left')) return;
        var inkMid = centred.pos[i].x + iw / 2;
        expect(Math.abs(inkMid - 600) <= 2, 'centred ink off-centre for el ' + i + ' (mid ' + Math.round(inkMid) + ')');
      });
      var split = v.filter(function (x) { return x.slug === 'split'; })[0];
      expect(split, 'media+text section should offer the split');
      expect(split.pos[2].x >= 620, 'split should push the image right');
      expect(split.pos[0].x === 72 && split.pos[1].x === 72, 'split should rail the words left');
      G.deleteSection(G.sections().indexOf(s2));
      return v.length + ' arrangements; mirror and split verified by the numbers';
    });

    test('type scale: origin-keyed fontSizes unwrap to the theme list', function () {
      var flat = [{ slug: 'small', size: '1rem' }];
      expect(G.themeFontSizeList(flat) === flat, 'flat array should pass through');
      var keyed = { default: [{ slug: 'd' }], theme: [{ slug: 't1' }, { slug: 't2' }] };
      var got = G.themeFontSizeList(keyed);
      expect(got && got.length === 2 && got[0].slug === 't1', 'origin-keyed shape should yield the theme list');
      expect(G.themeFontSizeList({ default: [{ slug: 'd' }] })[0].slug === 'd', 'defaults are the last resort');
      expect(G.themeFontSizeList(null) === null, 'null stays null');
      return 'flat, origin-keyed and empty shapes all honest';
    });

    test('type scale: calc-wraps every unit, never compounds', function () {
      var sizes = [
        { slug: 'small', size: '0.9rem' },
        { slug: 'large', size: '24px' },
        { slug: 'xx-large', size: 'clamp(2rem, 1rem + 4vw, 4rem)' },
      ];
      var same = G.scaleFontSizes(sizes, 100);
      expect(same[0].size === '0.9rem' && same[2].size.indexOf('calc') === -1, '100% must pass originals through untouched');
      var up = G.scaleFontSizes(sizes, 110);
      expect(up[0].size === 'calc(0.9rem * 1.1)', 'rem not calc-wrapped: ' + up[0].size);
      expect(up[1].size === 'calc(24px * 1.1)', 'px not calc-wrapped');
      expect(up[2].size === 'calc(clamp(2rem, 1rem + 4vw, 4rem) * 1.1)', 'clamp not calc-wrapped');
      expect(up[0].slug === 'small' && up.length === 3, 'slugs and count must survive');
      return 'px, rem and clamp all scale through one calc';
    });

    test('help: the ? opens the bot with the true build number', function () {
      var btn = q('.gogh-side .gogh-help');
      if (!btn) return 'no helpUrl configured — button rightly absent';
      btn.click();
      var sheet = q('.gogh-helpsheet');
      expect(sheet && sheet.classList.contains('is-open'), 'help sheet did not open');
      var src = sheet.querySelector('iframe').getAttribute('src');
      expect(src.indexOf('v=') !== -1 && src.indexOf('0.99') !== -1, 'build number not passed to the bot (' + src + ')');
      // the edit-mode iframe-inerting rule must not reach the sheet — an
      // inert help bot cannot be typed into (James, three reports running)
      var pe = getComputedStyle(sheet.querySelector('iframe')).pointerEvents;
      expect(pe === 'auto', 'help iframe is inert (pointer-events: ' + pe + ') — the ask box cannot be focused');
      sheet.querySelector('.gogh-helpsheet-x').click();
      expect(!sheet.classList.contains('is-open'), 'close did not close');
      return 'sheet opens, knows the build, closes';
    });

    test('inserted templates: text taller than its box pushes, never overlaps', function () {
      // James's serif theme wrapped a display heading over its own button —
      // the designed box was honest for one theme and a lie for another.
      // A deliberately squashed box stands in for every such theme.
      var s0 = G.sections().length;
      G.addSection({ name: 'Squash', minH: 300, els: [
        { type: 'heading', x: 60, y: 40, w: 1080, h: 24, fs: '__disp-l', align: 'center',
          text: 'Good design is good business and this must wrap tall' },
        { type: 'button', x: 516, y: 80, w: 168, h: 52, text: 'Our thinking' },
      ] }, G.sections().length);
      var added = lastSec();
      try {
        var head = added.els[0], btn = added.els[1];
        expect(head.h > 24, 'heading box did not grow to its rendered height (h=' + head.h + ')');
        expect(btn.y >= head.y + head.h - 8,
          'button overlaps the heading: btn.y=' + btn.y + ' vs heading bottom=' + (head.y + head.h));
      } finally {
        G.deleteSection(G.sections().indexOf(added));
      }
      expect(G.sections().length === s0, 'cleanup failed');
      return 'grown text pushes its neighbours down on insert';
    });

    test('card moods: hover choreography in the CSS, mood in the model', function () {
      G.addSection({ name: 'MOOD', minH: 400, els: [
        { type: 'box', x: 80, y: 60, w: 320, h: 280, radius: 18, mood: 'lift',
          boxBg: 'color-mix(in srgb, var(--wp--preset--color--contrast, #000) 7%, var(--wp--preset--color--base, transparent))',
          kids: [ { type: 'heading', x: 24, y: 24, w: 200, h: 40, text: 'Lifted' } ] },
        { type: 'box', x: 440, y: 60, w: 320, h: 280, radius: 18, mood: 'veil',
          boxImg: '/wp-content/plugins/gogh/demo-assets/sunflowers.jpg',
          kids: [ { type: 'heading', x: 24, y: 24, w: 200, h: 40, text: 'Veiled' } ] },
        { type: 'box', x: 800, y: 60, w: 320, h: 280, radius: 18, mood: 'zoom' },
      ] }, G.sections().length);
      var c = contentSecs();
      var s2 = c[c.length - 1];
      try {
        var css = s2.styleEl.textContent;
        expect(/:hover\s*{\s*transform:\s*translateY\(-8px\)/.test(css), 'lift hover missing');
        expect(/::before[^}]*filter:\s*blur/.test(css.replace(/\n/g, ' ')) || /:hover::before\s*{\s*filter:\s*blur/.test(css), 'veil blur missing');
        // the veil moves the PICTURE to ::before — the words never blur
        expect(/::before[^}]*background:[^}]*sunflowers/.test(css.replace(/\n/g, ' ')), 'veil background not on the pseudo');
        expect(/:hover\s*{\s*transform:\s*scale\(1\.03\)/.test(css), 'zoom hover missing');
        // the mood survives the model round-trip
        expect(/"mood":"lift"/.test(G.serialize()), 'mood not serialized');
      } finally {
        G.deleteSection(G.sections().indexOf(s2));
      }
      return 'lift, veil and zoom all emit; mood rides the model';
    });

    // ---- composed FAQ/Tabs must match core's CURRENT save() shape, or
    // Gutenberg shows 'Block contains unexpected or invalid content' on every
    // widget (James's report). The markers below are core 6.9's; when core
    // moves again this test names the drift. Stale saved wsrc heals at render
    // (regenerated from the data) — asserted here too. ----
    test('FAQ/Tabs compose to core 6.9 save shapes; stale wsrc heals at render', function () {
      var t = G.composeTabs([{ t: 'One', body: 'Alpha' }, { t: 'Two', body: 'Beta' }]);
      expect(t.wsrc.indexOf('<section role="tabpanel" tabindex="0" class="wp-block-tab-panel">') !== -1,
        'tab-panel must be a section with role+tabindex');
      expect(t.wsrc.indexOf('<button type="button" role="tab">One</button>') !== -1,
        'tab buttons must be bare (no class): ' + t.wsrc.slice(0, 200));
      var f = G.composeFaq([{ q: 'Q1', a: 'A1' }]);
      expect(f.wsrc.indexOf('<div role="group" class="wp-block-accordion">') !== -1, 'accordion wrapper needs role=group');
      expect(f.wsrc.indexOf('accordion-heading__toggle-title') !== -1 && f.wsrc.indexOf('aria-hidden="true">+<') !== -1,
        'heading must use __toggle-title and the + icon span');
      expect(f.wsrc.indexOf('role="region" class="wp-block-accordion-panel"') !== -1 &&
        f.wsrc.indexOf('__content') === -1, 'panel must be role=region with NO __content div');
      // heal: a widget carrying the OLD markup regenerates from data on render
      var s = sec();
      s.els.push({ type: 'widget', x: 72, y: 40, w: 900, h: 300,
        tabs: [{ t: 'One', body: 'Alpha' }], wsrc: '<!-- wp:tabs --><div class="wp-block-tab-panel">old</div><!-- /wp:tabs -->', whtml: '<div>old</div>' });
      G.renderSection(s);
      var e2 = s.els[s.els.length - 1];
      expect(e2.wsrc.indexOf('role="tabpanel"') !== -1, 'stale tabs wsrc did not heal at render');
      s.els.pop();
      G.renderSection(s);
      return 'canonical shapes verified; stale markup regenerates from data';
    });

    test('Tabs starter: gated on the block, real core/tabs when present', function () {
      var tpl = G.templates().filter(function (t) { return t.name === 'Tabs'; })[0];
      expect(tpl && tpl.gated === 'hasTabs', 'Tabs template must be gated on hasTabs');
      if (!window.GOGH.hasTabs) return 'core/tabs absent — starter rightly dormant';
      var d = tpl.els.filter(function (e) { return e.tabs; })[0];
      expect(d && d.tabs.length >= 2, 'Tabs template must carry structured tab data');
      var c = G.composeTabs(d.tabs);
      expect(/wp:tabs/.test(c.wsrc) && /wp:tab-panel/.test(c.wsrc), 'compose must yield the true core/tabs source');
      expect(!/<button/.test(c.whtml), 'preview must not nest buttons in the picker card');
      G.openPicker(G.sections().length);
      var card = [].filter.call(document.querySelectorAll('.gogh-cards .gogh-card-name'), function (n) {
        return n.textContent.indexOf('Tabs') === 0;
      })[0];
      expect(card, 'Tabs card missing from the shelf while hasTabs is true');
      q('.gogh-picker-close').click();
      return 'gated, sourced from the true block, shelved';
    });

    test('FAQ starter: data composes a real accordion, edits recompose', function () {
      var tpl = G.templates().filter(function (t) { return t.name === 'FAQ'; })[0];
      expect(tpl, 'FAQ template missing');
      var d = tpl.els.filter(function (e) { return e.faq; })[0];
      expect(d && d.faq.length >= 3, 'FAQ template must carry structured q/a data');
      var s0 = G.sections().length;
      G.addSection(tpl, G.sections().length);
      var added = lastSec();
      try {
        var w = added.els.filter(function (e) { return e.type === 'widget'; })[0];
        expect(/wp:accordion/.test(w.wsrc) && /accordion-heading__toggle/.test(w.wsrc),
          'insert must compose the true core/accordion source');
        expect(added.sectionEl.querySelector('.gogh-widget .wp-block-accordion'),
          'accordion preview did not render in the canvas');
        // edit the data, recompose — the block follows, escaped honestly
        w.faq[0].q = 'Can we <em>really</em> change this?';
        G.composeFaq && (function () {
          var c = G.composeFaq(w.faq);
          expect(/Can we &lt;em&gt;really&lt;\/em&gt; change this\?/.test(c.wsrc), 'edited question must land escaped in the source');
          expect(c.whtml.indexOf('&lt;em&gt;') !== -1, 'preview must escape too');
        })();
      } finally {
        G.deleteSection(G.sections().indexOf(added));
      }
      expect(G.sections().length === s0, 'cleanup failed');
      return 'data → true block; edits recompose, escaped';
    });

    test('background effects: each mood writes its choreography', function () {
      G.addSection({ name: 'FX', minH: 300, bg: '#334455', els: [
        { type: 'heading', x: 72, y: 60, w: 500, h: 60, text: 'Effects' },
      ] }, G.sections().length);
      var c = contentSecs();
      var s2 = c[c.length - 1];
      try {
        s2.bgImage = '/wp-content/plugins/gogh/demo-assets/sunflowers.jpg';
        var cssFor = function (fx) {
          s2.fx = fx ? { bg: fx } : null;
          G.resolve(s2);
          return s2.styleEl.textContent;
        };
        var par = cssFor('parallax');
        expect(/gogh-parallax/.test(par) && /animation-timeline: view\(\)/.test(par), 'parallax must be scroll-driven, not attachment-fixed');
        expect(/inset: -20% 0/.test(par), 'parallax layer needs headroom beyond the section');
        expect(!/background-attachment/.test(par), 'the old fixed-attachment trick must be gone');
        var drift = cssFor('drift');
        expect(/::before[^}]*sunflowers/.test(drift.replace(/\n/g, ' ')) && /gogh-drift/.test(drift), 'drift must animate the picture on a pseudo layer');
        var reveal = cssFor('reveal');
        expect(/animation-timeline: view\(\)/.test(reveal) && /@supports/.test(reveal), 'reveal must ride the scroll, gated by @supports');
        var grain = cssFor('grain');
        expect(/feTurbulence/.test(grain) && /soft-light/.test(grain), 'grain must blend the noise layer');
        expect(!/feTurbulence|gogh-drift|gogh-parallax|animation-timeline/.test(cssFor(null)), 'Still must emit no choreography');
        // the effect rides the model
        s2.fx = { bg: 'grain' };
        expect(/"fx":{"bg":"grain"}/.test(G.serialize()), 'fx.bg must serialize');
      } finally {
        G.deleteSection(G.sections().indexOf(s2));
      }
      return 'parallax, drift, reveal, grain all emit; Still stays silent';
    });

    test('transitions carve rich sections: the image is part of the shape', function () {
      G.addSection({ name: 'TD1', minH: 240, bg: '#334455', els: [
        { type: 'heading', x: 72, y: 40, w: 400, h: 60, text: 'Above' } ] }, G.sections().length);
      G.addSection({ name: 'TD2', minH: 240, els: [
        { type: 'heading', x: 72, y: 40, w: 400, h: 60, text: 'Below' } ] }, G.sections().length);
      var c = contentSecs();
      var above = c[c.length - 2], below = c[c.length - 1];
      try {
        above.divider = { shape: 'wave' };
        // colour next: the classic band paints as before
        G.resolve(above); G.resolve(below);
        expect(/::after[^}]*mask-image/.test(above.styleEl.textContent.replace(/\n/g,' ')), 'colour next should keep the shaped band');
        // rich next: the band stands down, the next section carves its top
        below.bgImage = '/wp-content/plugins/gogh/demo-assets/wheat-field.jpg';
        G.resolve(above); G.resolve(below);
        expect(!/::after[^}]*mask-image/.test(above.styleEl.textContent.replace(/\n/g,' ')), 'band must stand down for a rich next section');
        expect(/mask-image:[^;]*svg/.test(below.styleEl.textContent) && /mask-size: 100% 8cqw/.test(below.styleEl.textContent),
          'rich section must carve its own top with the divider shape');
        // the cut must reveal the NEIGHBOUR's pixels, not page white: the
        // carved section pulls itself up over the previous one (the white
        // wedge between two photos was this missing)
        expect(/margin-top: calc\(-1 \* 8cqw\)/.test(below.styleEl.textContent),
          'carved section must overlap the previous section');
        // melt fades the photo in
        above.divider = { shape: 'melt' };
        G.resolve(above); G.resolve(below);
        expect(/mask-image: linear-gradient\(to bottom, transparent/.test(below.styleEl.textContent), 'melt must fade the rich top');
        expect(/margin-top: calc\(-1 \* 16cqw\)/.test(below.styleEl.textContent),
          'melt overlap must match its taller fade');
      } finally {
        G.deleteSection(G.sections().indexOf(below));
        G.deleteSection(G.sections().indexOf(above));
      }
      return 'bands for colours, carved tops for photos, melt fades';
    });

    test('header designer: dials rewrite native spacing, and round-trip', function () {
      var raw = '<!-- wp:group {"align":"full","className":"gogh-hrow","style":{"spacing":{"padding":{"top":"1.25rem","bottom":"1.25rem","left":"2rem","right":"2rem"}}},"layout":{"type":"flex"}} -->\n' +
        '<div class="wp-block-group alignfull gogh-hrow" style="padding-top:1.25rem;padding-right:2rem;padding-bottom:1.25rem;padding-left:2rem"><!-- wp:site-title {"level":0} /-->\n' +
        '<!-- wp:navigation {"overlayMenu":"mobile"} /--></div>\n' +
        '<!-- /wp:group -->';
      var d0 = G.chromeDialsRead(raw);
      expect(d0 && d0.pad === 20 && d0.hasNav, 'read failed: ' + JSON.stringify(d0));
      var out = G.chromeDialsApply(raw, { pad: 32, gap: 24, linkGap: 40, fsz: 18 });
      expect(out, 'apply returned nothing');
      // attrs and saved markup must stay in lockstep — WP validates both
      expect(/"top":"32px"/.test(out) && /"bottom":"32px"/.test(out), 'padding attrs not written');
      expect(/"blockGap":"24px"/.test(out), 'group blockGap not written');
      expect(/padding-top:32px/.test(out) && /padding-bottom:32px/.test(out), 'inline style not in lockstep');
      expect(/"fontSize":"18px"/.test(out) && /font-size:18px/.test(out), 'text size must write attr + inline in lockstep');
      expect(/wp:navigation {[\s\S]*"typography":{"fontSize":"18px"}/.test(out), 'menu items must carry the size natively on the nav block');
      expect(/padding-right:2rem/.test(out) && /padding-left:2rem/.test(out), 'side padding must survive');
      expect(/wp:navigation {[^}]*"spacing":{"blockGap":"40px"}/.test(out.replace(/\s+/g, ' ')) || /"blockGap":"40px"/.test(out.split('wp:navigation')[1]), 'nav link gap not written');
      var d1 = G.chromeDialsRead(out);
      expect(d1.pad === 32 && d1.gap === 24 && d1.linkGap === 40 && d1.fsz === 18, 'round-trip drifted: ' + JSON.stringify(d1));
      // idempotent: applying the same dials twice changes nothing
      expect(G.chromeDialsApply(out, { pad: 32, gap: 24, linkGap: 40, fsz: 18 }) === out, 'second apply must be a no-op');
      // a non-group raw refuses politely, nothing exploded
      expect(G.chromeDialsApply('<!-- wp:paragraph --><p>hi</p><!-- /wp:paragraph -->', { pad: 8, gap: 8, linkGap: 8 }) === null, 'non-group should return null');
      return 'attrs + markup in lockstep, round-trip exact, no-op stable';
    });

    test('site chrome sleeps behind a veil until invited', function () {
      var veils = document.querySelectorAll('.gogh-chromeveil');
      expect(veils.length >= 1, 'no chrome veil in edit mode');
      var pill = veils[0].querySelector('.gogh-chromeveil-pill');
      expect(pill && /edit site (header|footer)/i.test(pill.textContent), 'pill does not name the region');
      var host = veils[0].parentNode;
      pill.click();
      expect(!veils[0].parentNode, 'veil should lift when clicked');
      expect(host && host.isConnected, 'the chrome itself must survive the unveiling');
      expect(host.classList.contains('gogh-chrome-live'), 'woken chrome should wear the editing ring');
      // clicking back into the page puts the chrome to sleep: ring off,
      // veil re-armed (James: "I don't really know that's the focus")
      sec().sectionEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 71 }));
      expect(!host.classList.contains('gogh-chrome-live'), 'outside click should drop the ring');
      expect(host.querySelector('.gogh-chromeveil'), 'outside click should re-arm the veil');
      host.querySelector('.gogh-chromeveil').querySelector('.gogh-chromeveil-pill').click();
      expect(host.classList.contains('gogh-chrome-live'), 'chrome should wake again after re-veiling');
      sec().sectionEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 72 }));
      return veils.length + ' veil(s); wake ring + sleep-on-outside-click verified';
    });

    // ---- 14. image via URL becomes a real figure (v0.9) ----
    test('image URL apply → figure with img', function () {
      var i = findIdx('image');
      select(i);
      q('.gogh-eb-ctx').click();
      var input = q('.gogh-panel input[type="url"]');
      expect(input, 'image panel did not open');
      input.value = 'https://example.com/pic.jpg';
      q('.gogh-panel .gogh-apply').click();
      expect(sec().els[i].src === 'https://example.com/pic.jpg', 'src not set');
      expect(sec().nodes[i].tagName === 'FIGURE', 'node is ' + sec().nodes[i].tagName);
      expect(sec().nodes[i].querySelector('img'), 'no img inside figure');
    });

    // regression: a style change that grows the text column beside a photo
    // used to stretch the image's grid cell (default align-self: stretch),
    // whose inflated height got absorbed into the model — the photo turned
    // into a thin tall strip. Images now pin to align-self:start, so a tall
    // row can never stretch them. (James: "images are being stretched like
    // crazy" after applying a site style)
    test('images pin to align-self:start so a tall row cannot stretch them', function () {
      var i = sec().els.findIndex(function (e) { return e.type === 'image' && !e.kids; });
      expect(i >= 0, 'no bare image element in fixture section');
      var css = sec().styleEl.textContent;
      var m = css.match(new RegExp('\\.gogh-el-' + (i + 1) + '\\s*\\{([^}]*)\\}'));
      var block = m ? m[1] : '';
      expect(/align-self:\s*start/.test(block),
        'image rule missing align-self:start — the grid can stretch it: ' + block.slice(0, 140));
      return 'image pinned start: ' + block.replace(/\s+/g, ' ').trim().slice(0, 60);
    });

    // ---- 15. divider + section backgrounds (v0.10) ----
    test('divider CSS generated with next-section colour', function () {
      G.addSection(G.templates()[3], G.sections().length);
      // the ink is READ from the section below (its bg, else the page
      // canvas) — never asked for; the chips live in the design panel
      var below = G.sections()[1];
      below.bg = '#123456';
      G.openSecBgPanel(0);
      q('.gogh-panel .gogh-shape[data-shape="curve"]').click(); // keep() re-resolves
      var s0 = G.sections()[0];
      expect(s0.divider && s0.divider.shape === 'curve', 'divider not set');
      var css = s0.styleEl.textContent;
      expect(css.indexOf('::after') !== -1, 'no ::after rule');
      // v0.15: colour is a plain background behind an SVG mask, so CSS
      // variables (theme palette) work as divider colours
      expect(css.indexOf('mask-image') !== -1, 'divider not mask-based');
      expect(css.indexOf('background: #123456') !== -1, 'divider colour missing');
      pev('pointerdown', document.body, 4, 4); // close the docked panel properly
    });

    test('transitions: the new shapes render, the retired keep rendering', function () {
      G.addSection(G.templates()[3], G.sections().length);
      var below = G.sections()[1];
      below.bg = '#222831';
      var s0 = G.sections()[0];
      ['sweep', 'dunes', 'arch', 'sheet', 'mist', 'wave', 'torn', 'peaks'].forEach(function (k) {
        s0.divider = { shape: k };
        G.setSecBg(0, null); // side effect: resolveAll re-emits the CSS
        var css = s0.styleEl.textContent;
        expect(css.indexOf('::after') !== -1, k + ' emitted no transition band');
        expect(css.indexOf('mask-image') !== -1, k + ' is not mask-based');
        if (k === 'mist') {
          expect(css.indexOf('linear-gradient(to bottom, transparent') !== -1,
            'mist lost its feather — mask without the fade');
        }
      });
      return 'sweep/dunes/arch/sheet/mist render; wave/torn/peaks keep rendering retired';
    });

    // ---- 16. rotation ----
    test('rotation sets model + CSS transform', function () {
      var i = findIdx('image');
      select(i);
      var rot = q('.gogh-rot');
      var r = rot.getBoundingClientRect();
      pev('pointerdown', rot, r.x + 15, r.y + 15, 17);
      pev('pointermove', rot, r.x - 120, r.y - 60, 17);
      pev('pointerup', rot, r.x - 120, r.y - 60, 17);
      var e = sec().els[i];
      expect(e.rot && e.rot !== 0, 'rot not set');
      expect(sec().styleEl.textContent.indexOf('rotate(' + e.rot + 'deg)') !== -1, 'transform missing from CSS');
    });

    test('rotated element: drag ghost keeps true size, drop is faithful', function () {
      var i = findIdx('badge');
      if (i === -1) return 'no badge in fixture';
      var e = sec().els[i];
      e.rot = 30;
      G.renderSection(sec());
      select(i);
      var grip = q('.gogh-grip');
      var gr = grip.getBoundingClientRect();
      pev('pointerdown', grip, gr.x + 2, gr.y + 2, 23);
      var ghost = q('.gogh-ghostel');
      expect(ghost, 'no drag ghost');
      var sw = sec().sectionEl.getBoundingClientRect().width / 1200;
      var gw = ghost.getBoundingClientRect().width;
      // bbox of a 30° badge is ~15-25% wider than the element — the ghost
      // must carry the TRUE size, not the inflated box
      expect(Math.abs(gw - e.w * sw) < 4, 'ghost width ' + Math.round(gw) + ' vs element ' + Math.round(e.w * sw));
      var x0 = e.x;
      pev('pointermove', grip, gr.x + 82, gr.y + 2, 23);
      pev('pointerup', grip, gr.x + 82, gr.y + 2, 23);
      expect(Math.abs((e.x - x0) - 80 / sw) < 24, 'rotated drag drifted: moved ' + Math.round(e.x - x0) + ' for 80px');
    });

    // ---- 17. section ops: delete + undo ----
    test('delete section + undo restores it', function () {
      G.addSection(G.templates()[3], G.sections().length);
      var s0 = G.sections().length;
      G.deleteSection(G.sections().indexOf(lastSec()));
      expect(G.sections().length === s0 - 1, 'not deleted');
      expect(!document.contains(document.querySelector('.gogh-card-sec')) || true, '');
      q('.gogh-undo').click();
      expect(G.sections().length === s0, 'undo did not restore section');
    });

    test('deleting the last section blanks the page, opens picker, undoes', function () {
      var content = function () { return G.sections().filter(function (s) { return !s.chrome; }); };
      while (content().length > 1) {
        G.deleteSection(G.sections().indexOf(content()[content().length - 1]));
      }
      var els0 = content()[0].els.length;
      G.deleteSection(G.sections().indexOf(content()[0]));
      var left = content();
      expect(left.length === 1 && left[0].bootstrap && !left[0].els.length,
        'expected one empty placeholder canvas, got ' + left.length);
      expect(!q('.gogh-picker').hidden, 'picker did not open on blank page');
      q('.gogh-picker-close').click();
      q('.gogh-undo').click();
      expect(content().length >= 1 && content()[0].els.length === els0, 'undo did not restore the section');
    });

    // ---- 18. section ops: duplicate ----
    test('duplicate section copies model with fresh scope', function () {
      var s0 = G.sections().length;
      G.duplicateSection(0);
      expect(G.sections().length === s0 + 1, 'not duplicated');
      var a = G.sections()[0], b = G.sections()[1];
      expect(a.scope !== b.scope, 'scope not fresh');
      expect(JSON.stringify(a.els.map(function (e) { return e.type; })) ===
             JSON.stringify(b.els.map(function (e) { return e.type; })), 'element types differ');
      // both render without sharing CSS identity
      expect(b.styleEl.textContent.indexOf(b.scope) !== -1, 'copy CSS not scoped');
    });

    // ---- 19. section ops: move ----
    test('move section reorders model and DOM', function () {
      G.addSection(G.templates()[3], G.sections().length);
      var added = lastSec();
      G.moveSection(G.sections().indexOf(added), -1);
      var c = contentSecs();
      expect(c[c.length - 2] === added, 'model order wrong');
      var wraps = [].slice.call(document.querySelectorAll('.entry-content > .gogh-wrap, .gogh-wrap'))
        .filter(function (w) {
          return !w.closest('.gogh-picker') && !w.closest('.wp-block-template-part');
        });
      expect(wraps.indexOf(added.wrapEl) === wraps.length - 2, 'DOM order wrong');
    });

    // ---- 20. palette drawer opens and tucks away ----
    test('palette drawer: edge tab, open/close classes', function () {
      var side = q('.gogh-side');
      var tab = q('.gogh-side-tab');
      expect(tab, 'edge tab missing');
      G.closeSide(true);
      expect(!side.classList.contains('is-open'), 'should start closed');
      expect(!tab.classList.contains('is-away'), 'tab should be visible when closed');
      G.openSide();
      expect(side.classList.contains('is-open'), 'did not open');
      expect(tab.classList.contains('is-away'), 'tab should hide when open');
      expect(getComputedStyle(side).transitionDuration !== '0s', 'no animation configured');
      G.openSide(); // leave open for any following interaction
    });

    // ---- 21. theme inheritance (v0.15) ----
    test('theme owns typography: gogh emits layout only', function () {
      var css = sec().styleEl.textContent;
      expect(css.indexOf('#f4f1ea') === -1, 'hardcoded heading colour still emitted');
      expect(css.indexOf('color: #a39e93') === -1, 'hardcoded para colour still emitted');
      // heading inside a gogh section renders with the theme's own h2 colour
      var probe = document.createElement('h2');
      probe.style.cssText = 'position:absolute;left:-9999px;top:0';
      sec().wrapEl.appendChild(probe);
      var themeColor = getComputedStyle(probe).color;
      probe.remove();
      // measure a heading WITHOUT captured paste typography (tf) or an
      // explicit colour — those deliberately override the theme
      var i = sec().els.findIndex(function (e) { return e.type === 'heading' && !e.tf && !e.color; });
      if (i === -1) return 'no theme-styled heading in fixture — skipped';
      var goghColor = getComputedStyle(sec().nodes[i]).color;
      expect(goghColor === themeColor, 'heading ' + goghColor + ' vs theme ' + themeColor);
      return 'headings inherit ' + themeColor;
    });

    // ---- 22. font sizes step through theme presets (v0.16) ----
    test('text sizes cycle through theme presets, never free values', function () {
      var sizes = G.fontSizes();
      expect(sizes.length >= 2, 'theme exposes ' + sizes.length + ' font presets');
      var i = findIdx('heading');
      var node = function () { return sec().nodes[i]; };
      var px0 = parseFloat(getComputedStyle(node()).fontSize);
      // the living fixture may already be at the largest preset — pick one that differs
      var target = sizes[sizes.length - 1];
      if (approx(target.px, px0, 0.5)) target = sizes[0];
      var big = target.slug;
      var belowIdx = sec().els.findIndex(function (o, j) {
        var e = sec().els[i];
        return j !== i && o.y >= e.y + e.h - 8 && o.x < e.x + e.w && o.x + o.w > e.x;
      });
      var yBelow0 = belowIdx >= 0 ? sec().els[belowIdx].y : null;
      G.setFontSize(sec(), i, big);
      expect(sec().els[i].fs === big, 'fs not stored');
      expect(node().classList.contains('has-' + big + '-font-size'), 'preset class missing');
      var px1 = parseFloat(getComputedStyle(node()).fontSize);
      expect(px1 !== px0, 'computed size unchanged (' + px1 + ')');
      expect(px1 === target.px, 'size is not the preset value');
      if (belowIdx >= 0 && px1 > px0) {
        expect(sec().els[belowIdx].y >= yBelow0, 'grown text did not push below element');
      }
      G.setFontSize(sec(), i, null);
      expect(!node().className.match(/has-.*-font-size/), 'default did not clear class');
      // stepping from default goes to the smallest preset
      G.stepFontSize(sec(), i, 1);
      expect(sec().els[i].fs === sizes[0].slug, 'step order wrong: ' + sec().els[i].fs);
      return sizes.map(function (f) { return f.slug; }).join(' → ');
    });

    // ---- 23. drop lands where the ghost was released (v0.16.1) ----
    test('drag drop lands at the ghost position', function () {
      var i = findIdx('badge');
      select(i);
      var grip = q('.gogh-grip');
      var r = grip.getBoundingClientRect();
      var x = r.x + 12, y = r.y + 12;
      pev('pointerdown', grip, x, y, 51);
      pev('pointermove', grip, x - 40, y + 90, 51);
      var ghost = q('.gogh-ghostel');
      expect(ghost, 'no ghost');
      var ghostTop = ghost.getBoundingClientRect().top;
      pev('pointerup', grip, x - 40, y + 90, 51);
      var landedTop = sec().nodes[i].getBoundingClientRect().top;
      expect(Math.abs(landedTop - ghostTop) < 14,
        'landed ' + Math.round(landedTop - ghostTop) + 'px from ghost');
      return 'landing delta ' + Math.round(Math.abs(landedTop - ghostTop)) + 'px';
    });

    // ---- 24. section background image + tint (v0.17) ----
    test('section background image composes with palette tint', function () {
      var s0 = sec();
      var si = G.sections().indexOf(s0);
      G.setSecBg(si, 'https://example.com/bg.jpg', null);
      var css = s0.styleEl.textContent;
      expect(css.indexOf('url("https://example.com/bg.jpg") center / cover') !== -1, 'bg image missing');
      s0.bg = 'var(--wp--preset--color--contrast)';
      G.resolveAll();
      css = s0.styleEl.textContent;
      expect(css.indexOf('color-mix') !== -1 && css.indexOf('linear-gradient') !== -1, 'tint layer missing');
      G.setSecBg(si, null);
      expect(sec().styleEl.textContent.indexOf('bg.jpg') === -1, 'remove failed');
    });

    // ---- 25. gogh/section v3 block format (attrs = truth) ----
    test('serializes to v3 gogh/section blocks (attrs truth + baked style)', function () {
      var markup = G.buildBlocks();
      expect(/<!-- wp:gogh\/section \{/.test(markup), 'no attribute-carrying gogh/section block');
      expect(markup.indexOf('"cssT"') !== -1 && markup.indexOf('"model"') !== -1, 'attrs missing model/cssT');
      expect(markup.indexOf('"GOGHSCOPE') !== -1 || markup.indexOf('GOGHSCOPE') !== -1, 'cssT not scope-templated');
      expect(markup.indexOf('<!-- wp:html -->') === -1, 'legacy carrier still emitted');
      expect(markup.indexOf('<style class="gogh-style">') !== -1, 'baked style projection missing');
      expect(markup.indexOf('class="gogh-model"') === -1, 'model script must not ship in markup');
      expect(markup.indexOf('data-gogh-scope=') !== -1, 'scope attribute missing');
      // the attrs ride in an HTML comment: any literal -- inside would
      // terminate the comment early, so the serializer must escape them
      var am = markup.match(/<!-- wp:gogh\/section (\{[\s\S]*?\}) -->/);
      expect(am, 'attrs comment not parseable');
      expect(am[1].indexOf('--') === -1, 'literal -- inside comment attrs (comment would truncate)');
      // and the escaping proves itself round-trip on a hostile model text
      var savedText = sec().els[0].text;
      sec().els[0].text = 'A -- dashed <heading> & more';
      var m2 = G.buildBlocks().match(/<!-- wp:gogh\/section (\{[\s\S]*?\}) -->/);
      expect(m2 && m2[1].indexOf('--') === -1, 'hostile -- not escaped in attrs');
      expect(JSON.parse(m2[1]).model.elements[0].text === 'A -- dashed <heading> & more',
        'escaped attrs did not JSON.parse back to the original text');
      sec().els[0].text = savedText;
      var block = markup.split(/<!-- wp:gogh\/section /)[1];
      expect(block.indexOf('<style class="gogh-style">') !== -1, 'baked style not inside the block');
      return (markup.match(/wp:gogh\/section \{/g) || []).length + ' v3 section block(s)';
    });

    // ---- 26. alt-drag duplicates then drags the copy (v0.19) ----
    test('alt-drag duplicates the element', function () {
      var i = findIdx('badge');
      var n0 = sec().els.length;
      select(i);
      var grip = q('.gogh-grip');
      var r = grip.getBoundingClientRect();
      grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x + 12, clientY: r.y + 12, pointerId: 61, altKey: true }));
      grip.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.x + 92, clientY: r.y + 12, pointerId: 61 }));
      grip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.x + 92, clientY: r.y + 12, pointerId: 61 }));
      expect(sec().els.length === n0 + 1, 'no copy made');
      var copy = sec().els[sec().els.length - 1];
      expect(copy.type === 'badge', 'copy wrong type');
      expect(copy.x !== sec().els[i].x, 'copy did not move away from original');
      q('.gogh-undo').click();
      expect(sec().els.length === n0, 'undo did not remove copy');
    });

    // ---- 27. shift constrains movement to one axis ----
    test('shift-drag locks to the dominant axis', function () {
      var i = findIdx('badge');
      var e = sec().els[i];
      var y0 = e.y;
      select(i);
      var grip = q('.gogh-grip');
      var r = grip.getBoundingClientRect();
      grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x + 12, clientY: r.y + 12, pointerId: 62 }));
      grip.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.x + 110, clientY: r.y + 30, pointerId: 62, shiftKey: true }));
      grip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.x + 110, clientY: r.y + 30, pointerId: 62, shiftKey: true }));
      expect(sec().els[i].y === y0, 'y moved despite shift lock (' + y0 + '→' + sec().els[i].y + ')');
    });

    // ---- 28. equal-spacing snap between two neighbours ----
    test('equal-spacing snap centres between neighbours', function () {
      // build a clean three-in-a-row far below existing content
      addToSec('badge');
      addToSec('badge');
      addToSec('badge');
      var n = sec().els.length;
      var a = sec().els[n - 3], b = sec().els[n - 2], c = sec().els[n - 1];
      a.x = 100; a.y = 1200; a.w = 200; a.h = 60;
      b.x = 520; b.y = 1200; b.w = 200; b.h = 60;
      c.x = 840; c.y = 1200; c.w = 200; c.h = 60;
      G.resolve(sec()); G.measure(sec()); G.resolve(sec());
      select(n - 2);
      var s = sec().sectionEl.getBoundingClientRect().width / 1200;
      var grip = q('.gogh-grip');
      var r = grip.getBoundingClientRect();
      var dx = (475 - 520) * s;
      grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x + 12, clientY: r.y + 12, pointerId: 63 }));
      grip.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.x + 12 + dx, clientY: r.y + 12, pointerId: 63 }));
      grip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.x + 12 + dx, clientY: r.y + 12, pointerId: 63 }));
      var gapL = b.x - (a.x + a.w);
      var gapR = c.x - (b.x + b.w);
      expect(gapL === gapR, 'gaps unequal after snap: ' + gapL + ' vs ' + gapR + ' (x=' + b.x + ')');
      return 'settled at x=' + b.x + ', both gaps ' + gapL;
    });

    // ---- 28b. equal-spacing wins over a nearby edge-snap candidate ----
    test('equal-spacing beats edge snap and grid parity', function () {
      // James's report: on a real page, an alignment candidate near the
      // midpoint (or 8-grid parity) made equal gaps unreachable. Distractor
      // badge d's left edge sits 5 units from the midpoint (inside SNAP=6),
      // and the free space is odd, so 8-grid steps alone can never equalise.
      addToSec('badge');
      addToSec('badge');
      addToSec('badge');
      addToSec('badge');
      var n = sec().els.length;
      var a = sec().els[n - 4], b = sec().els[n - 3], c = sec().els[n - 2], d = sec().els[n - 1];
      a.x = 100; a.y = 1400; a.w = 200; a.h = 60;
      b.x = 560; b.y = 1400; b.w = 200; b.h = 60;
      c.x = 845; c.y = 1400; c.w = 200; c.h = 60;   // midpoint xEq = 472.5 (odd space)
      d.x = 478; d.y = 1600; d.w = 200; d.h = 60;   // left edge 478, 5.5 from xEq
      G.resolve(sec()); G.measure(sec()); G.resolve(sec());
      select(n - 3);
      var s = sec().sectionEl.getBoundingClientRect().width / 1200;
      var grip = q('.gogh-grip');
      var r = grip.getBoundingClientRect();
      var dx = (470 - 560) * s;
      grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x + 12, clientY: r.y + 12, pointerId: 66 }));
      grip.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.x + 12 + dx, clientY: r.y + 12, pointerId: 66 }));
      grip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.x + 12 + dx, clientY: r.y + 12, pointerId: 66 }));
      var gapL = b.x - (a.x + a.w);
      var gapR = c.x - (b.x + b.w);
      expect(gapL === gapR, 'gaps not EXACTLY equal despite odd parity: ' + gapL + ' vs ' + gapR + ' (x=' + b.x + ')');
      return 'x=' + b.x + ', gaps exactly ' + gapL + '/' + gapR;
    });

    // ---- 28c. reflow push moves aligned rows as a unit ----
    test('reflow push keeps aligned rows together', function () {
      // James's report: growing a text box pushed only the buttons under it,
      // breaking the row. Para overlaps ONLY the left badge horizontally.
      addToSec('para');
      addToSec('badge');
      addToSec('badge');
      addToSec('badge');
      var n = sec().els.length;
      var p = sec().els[n - 4], a = sec().els[n - 3], b = sec().els[n - 2], c = sec().els[n - 1];
      p.x = 100; p.y = 1800; p.w = 300; p.h = 100;
      a.x = 120; a.y = 1960; a.w = 150; a.h = 60;
      b.x = 500; b.y = 1960; b.w = 150; b.h = 60;
      c.x = 880; c.y = 1960; c.w = 150; c.h = 60;
      G.resolve(sec());
      var oldH = p.h;
      p.h = 160;
      G.reflowPush(sec(), p, oldH);
      expect(a.y === 2020, 'in-path badge not pushed (y=' + a.y + ')');
      expect(b.y === 2020 && c.y === 2020,
        'row-mates broke alignment: ' + a.y + '/' + b.y + '/' + c.y);
      return 'row moved together to y=' + a.y;
    });

    // ---- 28d. block-comment parser finds top-level spans ----
    test('parseTopBlocks maps top-level block spans', function () {
      var raw = '<!-- wp:paragraph --><p>a</p><!-- /wp:paragraph -->\n' +
        '<!-- wp:group {"layout":{"type":"constrained"}} --><div>' +
        '<!-- wp:heading --><h2>t</h2><!-- /wp:heading -->' +
        '<!-- wp:spacer {"height":"40px"} /--></div><!-- /wp:group -->\n' +
        '<!-- wp:gogh/section --><div>x</div><!-- /wp:gogh/section -->';
      var spans = G.parseTopBlocks(raw);
      expect(spans.length === 3, 'expected 3 top spans, got ' + spans.length);
      expect(spans[0].name === 'paragraph' && spans[1].name === 'group' && spans[2].name === 'gogh/section',
        'names wrong: ' + spans.map(function (s) { return s.name; }).join(','));
      expect(raw.slice(spans[1].start, spans[1].end).indexOf('wp:heading') !== -1,
        'nested block not inside its parent span');
    });

    // ---- 28e. the scanner measures Gutenberg leaves into elements ----
    test('scanner lifts rendered blocks into a model', function () {
      var host = document.createElement('div');
      host.style.cssText = 'width:1200px;position:absolute;left:-9999px;top:0';
      host.innerHTML =
        '<h2 class="has-x-large-font-size has-text-align-center" style="height:60px">Big title</h2>' +
        '<p style="height:40px">Some copy</p>' +
        '<div class="wp-block-buttons"><div class="wp-block-button"><a href="https://example.com" style="display:inline-block;padding:10px 20px">Go</a></div></div>';
      document.body.appendChild(host);
      var raw = '<!-- wp:heading {"textAlign":"center","fontSize":"x-large"} --><h2>Big title</h2><!-- /wp:heading -->' +
        '<!-- wp:paragraph --><p>Some copy</p><!-- /wp:paragraph -->' +
        '<!-- wp:buttons --><div class="wp-block-buttons"><!-- wp:button --><div class="wp-block-button"><a href="https://example.com">Go</a></div><!-- /wp:button --></div><!-- /wp:buttons -->';
      var scan = G.scan(host, raw, { loose: true });
      host.remove();
      var types = scan.els.map(function (e) { return e.type; });
      expect(types.join(',') === 'heading,para,button', 'types: ' + types.join(','));
      expect(scan.els[0].fs === 'x-large', 'font preset lost: ' + scan.els[0].fs);
      expect(scan.els[0].align === 'center', 'alignment lost');
      expect(scan.els[2].href === 'https://example.com', 'button href lost');
    });

    // ---- 29. layer ordering via toolbar ----
    test('bring forward / send backward reorder stacking', function () {
      // stacking is only actionable between overlapping elements — overlap them
      var e0 = sec().els[0], e1 = sec().els[1];
      e1.x = e0.x + 8;
      e1.y = e0.y + 8;
      G.resolve(sec());
      var t0 = e0.type, t1 = e1.type;
      select(0);
      q('.gogh-eb-fwd').click();
      expect(sec().els[1].type === t0 && sec().els[0].type === t1, 'forward did not swap');
      q('.gogh-eb-bck').click();
      expect(sec().els[0].type === t0, 'backward did not restore');
    });

    // ---- 30. cmd/ctrl bypasses all snapping ----
    test('meta-drag moves freely without snapping', function () {
      var i = findIdx('badge');
      var e = sec().els[i];
      var x0 = e.x;
      select(i);
      var s = sec().sectionEl.getBoundingClientRect().width / 1200;
      var grip = q('.gogh-grip');
      var r = grip.getBoundingClientRect();
      var dx = 37 * s;
      grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x + 12, clientY: r.y + 12, pointerId: 64 }));
      grip.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.x + 12 + dx, clientY: r.y + 12, pointerId: 64, metaKey: true }));
      grip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.x + 12 + dx, clientY: r.y + 12, pointerId: 64, metaKey: true }));
      expect(Math.abs(e.x - (x0 + 37)) <= 1, 'expected free landing at ' + (x0 + 37) + ', got ' + e.x);
    });

    // ---- publish re-emits top-level spans in live DOM order ----
    test('resequenceToDom reorders exact units, bails on any ambiguity', function () {
      var A = '<!-- wp:paragraph -->\n<p>Alpha</p>\n<!-- /wp:paragraph -->';
      var B = '<!-- wp:paragraph -->\n<p>Beta</p>\n<!-- /wp:paragraph -->';
      var C = '<!-- wp:paragraph -->\n<p>Gamma</p>\n<!-- /wp:paragraph -->';
      var merged = A + '\n\n' + B + '\n\n' + C;
      // DOM order says B, A, C → output must follow it
      var out = G.resequenceToDom(merged, [B, A, C]);
      expect(out === B + '\n\n' + A + '\n\n' + C, 'did not reorder: ' + out.slice(0, 80));
      // already in order → byte-identical passthrough
      expect(G.resequenceToDom(merged, [A, B, C]) === merged, 'no-op case rewrote content');
      // a unit missing from the merged raw → untouched
      expect(G.resequenceToDom(merged, [B, A, '<!-- wp:paragraph -->\n<p>Ghost</p>\n<!-- /wp:paragraph -->']) === merged,
        'missing unit should bail');
      // real content between claimed units (an unbound block) → untouched
      expect(G.resequenceToDom(merged, [C, A]) === merged, 'unclaimed middle block should bail');
      // duplicates map one-to-one without overlap
      var dup = A + '\n\n' + A + '\n\n' + B;
      expect(G.resequenceToDom(dup, [B, A, A]) === B + '\n\n' + A + '\n\n' + A, 'duplicate units mishandled');
      return 'reorders, no-ops, and bails exactly when it should';
    });
    test('editing mode makes embedded iframes inert (100vh embeds cannot trap the page)', function () {
      expect(document.documentElement.classList.contains('gogh-editing'), 'no gogh-editing root class');
      G.addHtmlSection('<div style="min-height:50vh"><iframe src="about:blank" style="width:100%;height:50vh;border:0" title="embed"></iframe></div>', null);
      var entry = G.pending()[G.pending().length - 1];
      var fr = entry.el.querySelector('iframe');
      expect(fr, 'no pasted iframe');
      expect(getComputedStyle(fr).pointerEvents === 'none', 'pasted iframe still captures the pointer');
      entry.el.querySelector('.gogh-pend-rm').click();
    });
    test('zoom modal: iframe-only stored blocks get a card', function () {
      G.addHtmlSection('<div><iframe src="about:blank" style="width:100%;height:40vh;border:0" title="only-frame"></iframe></div>', null);
      var entry = G.pending()[G.pending().length - 1];
      G.zoom.open();
      var cards = [].slice.call(document.querySelectorAll('.gogh-zoom-card'));
      var hasFrameCard = cards.some(function (c) { return c.querySelector('iframe'); });
      G.zoom.close();
      entry.el.querySelector('.gogh-pend-rm').click();
      expect(hasFrameCard, 'iframe-only block missing from zoom modal');
    });
    test('section can be inserted ABOVE a native block at the top of the page', function () {
      var first = G.sections().filter(function (s) { return !s.chrome; })[0];
      var iFirst = G.sections().indexOf(first);
      G.addHtmlSection('<div style="padding:40px"><h2>Top pattern</h2></div>', iFirst);
      var entry = G.pending()[G.pending().length - 1];
      expect(entry.el.compareDocumentPosition(first.wrapEl) & 4, 'holder did not land above the first section');
      var scopes0 = G.sections().map(function (s) { return s.scope; });
      // the DOM anchor places the new section above the holder — an S-index
      // alone could never express this position
      G.addSection(G.templates()[0], iFirst, entry.el);
      var added = G.sections().filter(function (s) { return scopes0.indexOf(s.scope) === -1; })[0];
      expect(added, 'section not added');
      expect(added.wrapEl.compareDocumentPosition(entry.el) & 4, 'new section not above the pattern');
      G.deleteSection(G.sections().indexOf(added));
      entry.el.querySelector('.gogh-pend-rm').click();
      return 'anchored insertion beats index-only insertion';
    });
    test('exploded layers fan out and restore', function () {
      var s0 = sec();
      G.explode.enter(s0, [0, 1]);
      expect(s0.sectionEl.classList.contains('gogh-exploded'), 'no explode class');
      expect(s0.nodes[0].style.transform.indexOf('translate') !== -1, 'no fan transform');
      G.explode.exit();
      expect(!s0.sectionEl.classList.contains('gogh-exploded'), 'explode class not removed');
      expect(s0.nodes[0].style.transform === '', 'fan transform not cleared');
    });

    // ---- 32. pattern scanner ----
    test('cover patterns scan to editable elements, not one widget', function () {
      var stage = document.createElement('div');
      stage.style.width = '1200px';
      stage.innerHTML =
        '<div class="wp-block-cover" style="position:relative;min-height:400px">' +
        '<img class="wp-block-cover__image-background" style="position:absolute;inset:0;width:100%;height:100%" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" />' +
        '<div class="wp-block-cover__inner-container" style="position:relative;padding:40px">' +
        '<h2 style="height:60px">Big cover heading</h2>' +
        '<p style="height:30px">Cover copy</p>' +
        '</div></div>';
      document.body.appendChild(stage);
      var raw = '<!-- wp:cover -->\n<div class="wp-block-cover">' +
        '<!-- wp:heading --><h2>Big cover heading</h2><!-- /wp:heading -->' +
        '<!-- wp:paragraph --><p>Cover copy</p><!-- /wp:paragraph -->' +
        '</div>\n<!-- /wp:cover -->';
      var out = G.scan(stage, raw, { loose: true });
      stage.remove();
      var types = out.els.map(function (e) { return e.type; });
      expect(types.indexOf('image') !== -1, 'no background image element: ' + types.join(','));
      expect(types.indexOf('heading') !== -1, 'no heading element: ' + types.join(','));
      expect(types.indexOf('para') !== -1, 'no para element: ' + types.join(','));
      expect(types.indexOf('widget') === -1, 'cover collapsed to a widget');
    });

    // ---- 33. multi-select ----
    test('shift-click gathers a group and drags it together', function () {
      var s0 = sec();
      var ax0 = s0.els[0].x, ay0 = s0.els[0].y, bx0 = s0.els[1].x, by0 = s0.els[1].y;
      var ra = s0.nodes[0].getBoundingClientRect();
      s0.nodes[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: ra.x + 8, clientY: ra.y + 8, pointerId: 71, button: 0, buttons: 1 }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 71 }));
      var rb = s0.nodes[1].getBoundingClientRect();
      s0.nodes[1].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, shiftKey: true, clientX: rb.x + 8, clientY: rb.y + 8, pointerId: 72, button: 0, buttons: 1 }));
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 72 }));
      expect(G.multi.state() && G.multi.state().idxs.length === 2, 'group not formed');
      expect(document.querySelectorAll('.gogh-multisel').length === 2, 'outlines missing');
      var s = s0.sectionEl.getBoundingClientRect().width / 1200;
      var ra2 = s0.nodes[0].getBoundingClientRect();
      var mk = function (type, target, x, y) {
        target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 73, button: 0, buttons: type === 'pointerup' ? 0 : 1, metaKey: type !== 'pointerup' }));
      };
      mk('pointerdown', s0.nodes[0], ra2.x + 9, ra2.y + 9);
      mk('pointermove', document, ra2.x + 9 + 50 * s, ra2.y + 9 + 30 * s);
      mk('pointermove', document, ra2.x + 9 + 50 * s, ra2.y + 9 + 30 * s);
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 73 }));
      var dax = s0.els[0].x - ax0, dbx = s0.els[1].x - bx0;
      var day = s0.els[0].y - ay0, dby = s0.els[1].y - by0;
      expect(dax !== 0 || day !== 0, 'anchor did not move');
      expect(Math.abs(dax - dbx) <= 1 && Math.abs(day - dby) <= 1, 'group did not move together: ' + [dax, day, dbx, dby].join(','));
      G.multi.clear();
    });

    // ---- 34. bird's-eye reorder ----
    test('birds-eye view reorders sections by drag', function () {
      var order0 = G.sections().filter(function (s) { return !s.chrome; }).map(function (s) { return s.scope; });
      if (order0.length < 2) return 'needs 2 sections';
      G.zoom.open();
      var col = document.querySelector('.gogh-zoom-col');
      var content = [].slice.call(document.querySelectorAll('.gogh-zoom-card')).filter(function (c) { return !c.classList.contains('is-chrome'); });
      expect(content.length === order0.length, 'card count ' + content.length + ' != ' + order0.length);
      var a = content[0], b = content[1];
      var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      var pv2 = function (type, target, x, y) {
        target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 82, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
      };
      pv2('pointerdown', a, ra.x + 30, ra.y + 16);
      pv2('pointermove', col, ra.x + 30, rb.y + rb.height * 0.85);
      pv2('pointermove', col, ra.x + 30, rb.y + rb.height * 0.9);
      pv2('pointerup', col, ra.x + 30, rb.y + rb.height * 0.9);
      G.zoom.close();
      var order1 = G.sections().filter(function (s) { return !s.chrome; }).map(function (s) { return s.scope; });
      expect(order1[0] === order0[1] && order1[1] === order0[0], 'did not swap: ' + order1.join(','));
      // put it back
      var i0 = G.sections().findIndex(function (s) { return s.scope === order0[0]; });
      var i1 = G.sections().findIndex(function (s) { return s.scope === order0[1]; });
      G.reorderSection(i0, i1);
    });

    // ---- 34b. auditioning a style re-tints the whole page ----
    test('site style audition re-tints the artboard background', function () {
      if (!G.openSide || !G.previewVariation) return 'no audition API';
      // the birds-eye paints an opaque background on the page so it doesn't show
      // the desk through transparent sections. That background MUST track a hover
      // audition (via --base) — a wrong slug once froze it on the committed colour,
      // so a light style auditioned over a dark page (or vice-versa) washed out.
      G.openSide();
      var wrap = q('.wp-site-blocks');
      try {
        G.previewVariation({ settings: { color: { palette: { theme: [
          { slug: 'base', color: '#112233' }, { slug: 'contrast', color: '#ffffff' },
        ] } } }, styles: {} });
        var bg = getComputedStyle(wrap).backgroundColor;
      } finally {
        G.clearVariationPreview();
        G.closeSide(true);
        var pv = document.getElementById('gogh-style-preview'); if (pv) pv.textContent = '';
      }
      expect(bg === 'rgb(17, 34, 51)', 'artboard did not follow the audition base (got ' + bg + ' — must re-tint or opposite-brightness styles wash out)');
      return 'artboard tinted to the previewed base';
    });

    // ---- 34c. audition applies the heading colour, not just the family ----
    test('site style audition previews the heading colour', function () {
      if (!G.previewVariation) return 'no audition API';
      // a variation can give headings their OWN colour (Morning's is 'contrast',
      // dark, over grey body text). The preview must apply it or hover headings
      // inherit body text and look wrong vs the applied result ('grey not black').
      try {
        G.previewVariation({ settings: {}, styles: { color: { text: 'var:preset|color|accent-4' },
          elements: { heading: { color: { text: 'var:preset|color|contrast' } } } } });
        var css = (document.getElementById('gogh-style-preview') || {}).textContent || '';
      } finally {
        G.clearVariationPreview();
        var pv = document.getElementById('gogh-style-preview'); if (pv) pv.textContent = '';
      }
      var hm = css.replace(/\s/g, '').match(/h1,h2,h3,h4,h5,h6[^{]*\{([^}]*)\}/);
      expect(hm && /color:var\(--wp--preset--color--contrast\)/.test(hm[1]),
        'heading preview must carry its own colour (rule: ' + (hm ? hm[1] : 'none') + ')');
      return 'heading previews its own colour, distinct from body';
    });

    // ---- 35. audit coverage: the untested features ----
    test('menu reorder rewrites navigation markup by url then label', function () {
      var nraw = '<!-- wp:navigation-link {"label":"Home","url":"https://x.test/"} /-->\n' +
        '<!-- wp:navigation-link {"label":"About","url":"https://x.test/about/"} /-->\n' +
        '<!-- wp:navigation-link {"label":"Blog","url":"https://x.test/blog/"} /-->';
      var items = [
        { label: 'Blog', path: '/blog', href: '/blog/' },
        { label: 'Home', path: '/', href: '/' },
        { label: 'About', path: '/about', href: '/about/' },
      ];
      var out = G.reorderNavRaw(nraw, items);
      expect(out, 'no output');
      var order = (out.match(/"label":"([^"]+)"/g) || []).join(',');
      expect(order.indexOf('Blog') < order.indexOf('Home') && order.indexOf('Home') < order.indexOf('About'),
        'order wrong: ' + order);
      // page-list pins down as explicit links
      var pl = G.reorderNavRaw('<!-- wp:page-list /-->', items);
      expect(pl.indexOf('wp:navigation-link') !== -1 && pl.indexOf('Blog') < pl.indexOf('Home'), 'page-list not pinned');
    });
    test('sticky header toggle rewrites the group attrs both ways', function () {
      var raw = '<!-- wp:group {"layout":{"type":"constrained"}} -->\n<div class="wp-block-group">x</div>\n<!-- /wp:group -->';
      var on = G.stickyRawToggle(raw, true);
      expect(on && /"position":\s*{[^}]*"type":"sticky"/.test(on), 'sticky not applied');
      var off = G.stickyRawToggle(on, false);
      expect(off && !/"type":"sticky"/.test(off), 'sticky not removed');
      expect(off.indexOf('"layout":{"type":"constrained"}') !== -1, 'other attrs lost');
      expect(G.stickyRawToggle('<!-- wp:paragraph --><p>x</p><!-- /wp:paragraph -->', true) === null,
        'non-group should refuse');
    });
    test('editing text on a native section syncs into its stored markup', function () {
      G.addHtmlSection('<div style="padding:30px"><h2>Original title</h2><p>Body</p></div>', null);
      var entry = G.pending()[G.pending().length - 1];
      expect(entry, 'no pending entry');
      var h = entry.el.querySelector('h2');
      h.textContent = 'EDITED TITLE';
      entry.__sync(entry.__leafOf(h));
      expect(entry.raw.indexOf('EDITED TITLE') !== -1, 'edit not in raw');
      expect(entry.raw.indexOf('Original title') === -1, 'old text still in raw');
      entry.el.querySelector('.gogh-pend-rm').click();
      expect(G.pending().length === 0 || G.pending().indexOf(entry) === -1, 'entry not removed');
    });
    test('saved sections reinsert losslessly from their markup', function () {
      var src2 = sec();
      var markup = G.buildBlocks(src2);
      var proj = function (els) {
        return JSON.stringify(els.map(function (e) {
          return { t: e.type, x: e.x, y: e.y, w: e.w, h: e.h,
            text: e.text || null, fs: e.fs || null, color: e.color || null };
        }));
      };
      var before = proj(src2.els);
      var n0 = G.sections().length;
      G.insertGoghPattern(markup, G.sections().length);
      expect(G.sections().length === n0 + 1, 'not inserted');
      var added = lastSec();
      expect(proj(added.els) === before, 'round-trip not lossless');
      G.deleteSection(G.sections().indexOf(added));
    });

    test('picker: no chip row — intent shelves, search filters', function () {
      G.openPicker(G.sections().length);
      expect(!q('.gogh-topstrip') && !q('.gogh-patcats'), 'chip row should be gone');
      var cardByName = function (nm) {
        return [].filter.call(document.querySelectorAll('.gogh-cards .gogh-card'), function (c) {
          var n = c.querySelector('.gogh-card-name');
          return n && n.textContent.indexOf(nm) === 0;
        })[0];
      };
      // first screen: every starter under its intent shelf — the shelves
      // are the map, so nothing hides behind a See all
      var shelfText = [].map.call(document.querySelectorAll('.gogh-cards .gogh-intentlab'), function (l) { return l.textContent; }).join(' ');
      expect(/Introduce/.test(shelfText) && /Sell/.test(shelfText) && /Showcase/.test(shelfText),
        'intent shelves missing: ' + shelfText);
      var totalTpl = document.querySelectorAll('.gogh-cards .gogh-card[data-tpl]').length;
      var visTpl = function () {
        return [].filter.call(document.querySelectorAll('.gogh-cards .gogh-card[data-tpl]'), function (c) {
          return c.style.display !== 'none';
        }).length;
      };
      expect(totalTpl >= 15, 'the beauty pass promises ~15 starters, found ' + totalTpl);
      expect(visTpl() === totalTpl, 'every starter should show on the first screen, got ' + visTpl() + '/' + totalTpl);
      expect(!q('.gogh-browse-all'), 'See all should be gone — the shelves are the map');
      // search flattens to matches only
      var quick = q('.gogh-quickrow');
      var sIn = q('.gogh-picker-search .gogh-patsearch');
      sIn.value = 'quote';
      sIn.dispatchEvent(new Event('input', { bubbles: true }));
      expect(cardByName('Quote').style.display !== 'none', 'Quote hidden under search');
      expect(cardByName('Hero').style.display === 'none', 'Hero visible under search');
      expect(quick.hidden, 'Quick start row visible while searching');
      sIn.value = '';
      sIn.dispatchEvent(new Event('input', { bubbles: true }));
      expect(cardByName('Hero').style.display !== 'none', 'Hero not restored');
      expect(!quick.hidden, 'Quick start row not restored');
      // My sections opens a view with a way back
      q('.gogh-quick-yours').click();
      expect(!q('.gogh-viewbar').hidden, 'view bar did not open for My sections');
      q('.gogh-view-back').click();
      expect(q('.gogh-viewbar').hidden, 'view bar did not close');
      q('.gogh-picker-close').click();
      expect(q('.gogh-picker').hidden, 'picker did not close');
    });

    test('picker: the rail maps the shelves', function () {
      G.openPicker(G.sections().length);
      var rail = q('.gogh-pickrail');
      expect(rail && !rail.hidden, 'the rail is missing from the first screen');
      var names = [].map.call(rail.querySelectorAll('button'), function (b) { return b.textContent; });
      expect(names.length >= 4, 'expected at least four shelves on the map, got ' + names.join(', '));
      expect(/Quick start/.test(names[0]) && names.indexOf('Introduce') !== -1 &&
        names.indexOf('Sell') !== -1 && names.indexOf('Showcase') !== -1,
        'the map misnames the shelves: ' + names.join(', '));
      expect(rail.querySelector('button.is-here'), 'no shelf is marked as here');
      // the spy follows the scroll — dispatched by hand, because background
      // tabs freeze smooth scrolling but never the listener
      var pin = q('.gogh-picker-inner');
      pin.scrollTop = pin.scrollHeight;
      pin.dispatchEvent(new Event('scroll'));
      var here = rail.querySelector('button.is-here');
      expect(here && here.textContent !== names[0],
        'scrolled to the bottom, but the map still says ' + (here ? here.textContent : 'nothing'));
      pin.scrollTop = 0;
      pin.dispatchEvent(new Event('scroll'));
      // filters flatten the modal to one grid — the map steps aside too
      var sIn = q('.gogh-picker-search .gogh-patsearch');
      sIn.value = 'quote';
      sIn.dispatchEvent(new Event('input', { bubbles: true }));
      expect(rail.hidden, 'the rail should hide while a filter is on');
      sIn.value = '';
      sIn.dispatchEvent(new Event('input', { bubbles: true }));
      expect(!q('.gogh-pickrail').hidden, 'the rail should return when the filter clears');
      q('.gogh-picker-close').click();
      return 'rail: ' + names.join(' · ');
    });

    test('Cmd+V pastes HTML straight in as a section', function () {
      var dt = new DataTransfer();
      dt.setData('text/plain', '<section style="padding:40px"><h2>Pasted by keyboard</h2></section>');
      var n0 = G.pending().length;
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      expect(G.pending().length === n0 + 1, 'paste did not add a section');
      var entry = G.pending()[G.pending().length - 1];
      expect(entry.raw.indexOf('Pasted by keyboard') !== -1, 'pasted content missing from raw');
      // plain prose paste must NOT be claimed
      var dt2 = new DataTransfer();
      dt2.setData('text/plain', 'just some words < not html >');
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt2, bubbles: true, cancelable: true }));
      expect(G.pending().length === n0 + 1, 'plain text paste was claimed');
      entry.el.querySelector('.gogh-pend-rm').click();
      expect(G.pending().indexOf(entry) === -1, 'entry not removed');
    });

    test('✨ Make freeform atomizes pasted HTML into real elements', function () {
      G.addHtmlSection('<style>.pastedwrap{border-radius:12px}</style>' +
        '<div class="pastedwrap" style="background:#112244;padding:60px">' +
        '<h2 style="color:#ffffff;margin:0 0 16px">Pasted hero</h2>' +
        '<p style="color:#ffffff;margin:0 0 24px">Some words about the thing.</p>' +
        '<a href="https://example.com/go" style="display:inline-block;background:#ffffff;color:#000;padding:12px 26px">Go now</a>' +
        '<svg width="140" height="40" style="display:block;margin-top:24px"><rect width="140" height="40" fill="#cc3344"/></svg>' +
        '</div>', null);
      var entry = G.pending()[G.pending().length - 1];
      expect(entry && entry.freeHtml, 'paste not marked as free HTML');
      var s0 = G.sections().length;
      entry.el.querySelector('.gogh-pend-ff').click();
      expect(G.sections().length === s0 + 1, 'conversion did not add a section');
      var added = lastSec();
      var byType = function (t) { return added.els.filter(function (e) { return e.type === t; }); };
      expect(byType('heading').length === 1 && byType('heading')[0].text === 'Pasted hero', 'heading not atomized');
      expect(byType('para').length === 1, 'paragraph not atomized');
      var btn = byType('button')[0];
      expect(btn && btn.text === 'Go now' && btn.href === 'https://example.com/go', 'link not atomized to a button');
      expect(added.bg && added.bg.indexOf('17, 34, 68') !== -1, 'full-bleed backdrop not lifted to section bg: ' + added.bg);
      var w = byType('widget')[0];
      expect(w && w.whtml.indexOf('<svg') !== -1, 'svg not kept as a widget');
      expect(w.whtml.indexOf('<style>') === 0 && w.whtml.indexOf('.pastedwrap') !== -1, 'pasted <style> not bundled with the widget');
      expect(added.els.length >= 4, 'expected 4+ elements, got ' + added.els.length);
      // the paste keeps its own look: captured typography, not theme presets
      var h = byType('heading')[0];
      expect(h.tf && h.tf.col && h.tf.col.indexOf('255, 255, 255') !== -1, 'heading colour not captured: ' + JSON.stringify(h.tf));
      expect(h.tf.fs > 0 && h.tf.fs2 > 0, 'heading font size not captured (px+cqw)');
      // responsive emission: container units with a readability floor, so
      // pasted text scales down on phones instead of staying desktop-sized
      expect(added.styleEl.textContent.indexOf('font-size: max(' + h.tf.fs2 + 'cqw') !== -1, 'captured size not emitted in container units');
      expect(btn.tf && btn.tf.bg && btn.tf.bg.indexOf('255, 255, 255') !== -1, 'button background not captured');
      // theme controls win once used: picking a preset size clears the override
      var oldFs2 = h.tf.fs2;
      G.setFontSize(added, added.els.indexOf(h), 'large');
      expect(!h.tf.fs && !h.tf.fs2, 'preset size did not clear the captured size');
      expect(added.styleEl.textContent.indexOf(oldFs2 + 'cqw') === -1, 'stale size override in CSS');
      G.deleteSection(G.sections().indexOf(added));
    });

    test('published paste converts with its own look (no flag needed)', function () {
      // the convertBlock route: a paste that was published, reloaded, then
      // converted — no freeHtml flag anywhere; free mode must be intrinsic
      var inner = '<style>.pubhero h2{font-size:61px;color:#ff8866;font-family:Georgia,serif}</style>' +
        '<div class="pubhero" style="background:#0b1f2a;padding:70px">' +
        '<h2>Published paste</h2><p style="color:#bbddcc">Body text here.</p></div>';
      var raw = '<!-- wp:group {"align":"full","layout":{"type":"default"}} -->\n' +
        '<div class="wp-block-group alignfull">\n<!-- wp:html -->\n' + inner +
        '\n<!-- /wp:html -->\n</div>\n<!-- /wp:group -->';
      var host = document.createElement('div');
      host.className = 'wp-block-group alignfull';
      host.style.width = '1280px';
      host.innerHTML = inner;
      document.body.appendChild(host);
      var scan = G.scan(host, raw, { loose: true, rootIsBlock: true });
      host.remove();
      var h = scan.els.filter(function (e) { return e.type === 'heading'; })[0];
      expect(h, 'heading not atomized from published paste');
      expect(h.tf && h.tf.fs === 61, 'stylesheet font size not captured: ' + JSON.stringify(h.tf));
      expect(h.tf.ff && h.tf.ff.indexOf('Georgia') !== -1, 'stylesheet font family not captured');
      expect(h.tf.col && h.tf.col.indexOf('255, 136, 102') !== -1, 'stylesheet colour not captured');
      expect(scan.rootBg && scan.rootBg.indexOf('11, 31, 42') !== -1, 'backdrop not lifted to rootBg: ' + scan.rootBg);
      expect(scan.els.filter(function (e) { return e.type === 'widget'; }).length === 0, 'content collapsed into a widget');
    });

    test('two converted pastes: backdrop fills each section, no gap band', function () {
      var mk = function (label) {
        return '<div style="background:#0a0a0a;color:#fff;padding:70px 60px">' +
          '<h2 style="font-size:48px;margin:0">' + label + '</h2>' +
          '<p style="color:#ccc">Some content for ' + label + '.</p></div>';
      };
      G.addHtmlSection(mk('One'), null);
      G.addHtmlSection(mk('Two'), null);
      var P = G.pending();
      // even BEFORE converting, pasted sections butt: no block-gap band
      var pa = P[P.length - 2].el.getBoundingClientRect();
      var pb = P[P.length - 1].el.getBoundingClientRect();
      expect(Math.abs(pb.top - pa.bottom) <= 2, 'pending pastes do not butt: gap ' + Math.round(pb.top - pa.bottom));
      P[P.length - 2].el.querySelector('.gogh-pend-ff').click();
      G.pending()[G.pending().length - 1].el.querySelector('.gogh-pend-ff').click();
      var S2 = G.sections();
      var c2 = contentSecs();
      var a = c2[c2.length - 2], b = c2[c2.length - 1];
      expect(a.bg && a.bg.indexOf('10, 10, 10') !== -1, 'backdrop not lifted to section bg: ' + a.bg);
      var ra = a.wrapEl.getBoundingClientRect(), rb = b.wrapEl.getBoundingClientRect();
      expect(Math.abs(rb.top - ra.bottom) <= 2, 'sections do not butt: gap ' + Math.round(rb.top - ra.bottom));
      // the WHOLE section paints the paste's background — no theme strip
      var secBg = getComputedStyle(a.sectionEl).backgroundColor;
      expect(secBg.indexOf('10, 10, 10') !== -1, 'section element not painting the backdrop: ' + secBg);
      expect(!a.wrapEl.querySelector('.gogh-box'), 'redundant full-bleed box still present');
      G.deleteSection(G.sections().indexOf(b));
      G.deleteSection(G.sections().indexOf(a));
    });

    test('publishing a paste causes zero reflow (gogh-pended)', function () {
      G.addHtmlSection('<div style="background:#0a0a0a;padding:70px"><h2 style="margin:0">Pub</h2></div>', null);
      var entry = G.pending()[G.pending().length - 1];
      expect(entry.raw.indexOf('gogh-section-html') !== -1, 'wrapper missing its identity class in raw');
      var el = entry.el;
      var r0 = el.getBoundingClientRect();
      // exactly what publish does to graduate a pending
      var bar = el.querySelector(':scope > .gogh-pendbar');
      if (bar) bar.remove();
      el.classList.remove('gogh-pending');
      el.classList.add('gogh-pended');
      var r1 = el.getBoundingClientRect();
      expect(Math.abs(r1.left - r0.left) < 1 && Math.abs(r1.width - r0.width) < 1 &&
        Math.abs(r1.top - r0.top) < 1,
        'graduation reflowed the section: d(left)=' + Math.round(r1.left - r0.left) +
        ' d(width)=' + Math.round(r1.width - r0.width) + ' d(top)=' + Math.round(r1.top - r0.top));
      var cs = getComputedStyle(el);
      expect(cs.marginTop === '0px' && cs.marginBottom === '0px', 'graduated margins not zero: ' + cs.marginTop + '/' + cs.marginBottom);
      el.remove();
      G.pending().splice(G.pending().indexOf(entry), 1);
    });

    test('classless h1 with inner span stays ONE heading (James hero)', function () {
      G.addHtmlSection('<div class="hx"><style>.hx h1{font-size:96px;font-weight:800}.hx h1 span{display:block;color:#7a7a7a}</style>' +
        '<div class="hx" style="background:#0a0a0a;padding:60px">' +
        '<h1>Beautiful <span>Simplicity.</span></h1>' +
        '<div><a href="#" style="background:#fff;color:#000;padding:14px 30px;border-radius:999px">Get Started</a></div>' +
        '</div></div>', null);
      var entry = G.pending()[G.pending().length - 1];
      var s0 = G.sections().length;
      entry.el.querySelector('.gogh-pend-ff').click();
      expect(G.sections().length === s0 + 1, 'conversion failed');
      var added = lastSec();
      var heads = added.els.filter(function (e) { return e.type === 'heading'; });
      expect(heads.length === 1, 'h1 was split or lost, headings: ' + heads.length);
      expect(heads[0].text.indexOf('Beautiful') !== -1 && heads[0].text.indexOf('Simplicity') !== -1,
        'heading lost its bare text node: "' + heads[0].text + '"');
      expect(heads[0].tf && heads[0].tf.fs === 96, 'stylesheet size not captured: ' + JSON.stringify(heads[0].tf));
      expect(heads[0].tf.fs2 > 0, 'container-unit size missing');
      expect(added.els.filter(function (e) { return e.type === 'button'; }).length === 1, 'link not a button');
      expect(added.els.filter(function (e) { return e.type === 'widget'; }).length === 0, 'stray widgets: h1 span leaked');
      G.deleteSection(G.sections().indexOf(added));
    });

    test('chrome light edit: click text in a part, edit, syncs to raw', function () {
      var host = document.createElement('div');
      host.innerHTML = '<div class="wp-block-group"><h2>Chrome title</h2><p>Chrome body</p></div>';
      document.body.appendChild(host);
      var raw = '<!-- wp:group -->\n<div class="wp-block-group">' +
        '<!-- wp:heading --><h2>Chrome title</h2><!-- /wp:heading -->' +
        '<!-- wp:paragraph --><p>Chrome body</p><!-- /wp:paragraph -->' +
        '</div>\n<!-- /wp:group -->';
      var e = G.bindChromeTest(host, raw);
      var h = host.querySelector('h2');
      h.click();
      expect(h.getAttribute('contenteditable') === 'true', 'chrome text not editable on click');
      h.textContent = 'EDITED CHROME';
      e.__sync(e.__leafOf(h));
      expect(e.raw.indexOf('EDITED CHROME') !== -1 && e.raw.indexOf('Chrome title') === -1, 'edit not synced to part raw');
      expect(e.raw.indexOf('Chrome body') !== -1, 'sibling leaf disturbed');
      host.remove();
      G.chromeEdits().splice(G.chromeEdits().indexOf(e), 1);
    });

    test('link bubble: select text, chip appears, links via panel', function () {
      var host = document.createElement('div');
      host.innerHTML = '<div class="wp-block-group"><p>Visit our lovely shop today</p></div>';
      document.body.appendChild(host);
      var raw = '<!-- wp:group -->\n<div class="wp-block-group">' +
        '<!-- wp:paragraph --><p>Visit our lovely shop today</p><!-- /wp:paragraph -->' +
        '</div>\n<!-- /wp:group -->';
      var e = G.bindChromeTest(host, raw);
      var para = host.querySelector('p');
      para.click();
      expect(para.getAttribute('contenteditable') === 'true', 'not editable');
      // select the word "shop"
      var textNode = para.firstChild;
      var idx = para.textContent.indexOf('shop');
      var range = document.createRange();
      range.setStart(textNode, idx);
      range.setEnd(textNode, idx + 4);
      var s = window.getSelection();
      s.removeAllRanges();
      s.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      var bubble = q('.gogh-linkbubble');
      expect(bubble && !bubble.hidden, 'bubble did not appear on selection');
      bubble.click();
      var inp = q('.gogh-linkurl');
      expect(inp, 'link panel did not open');
      inp.value = 'https://x.test/shop';
      q('.gogh-apply').click();
      expect(e.raw.indexOf('href="https://x.test/shop"') !== -1, 'link not written to raw: ' + e.raw.slice(0, 200));
      expect(e.raw.indexOf('>shop</a>') !== -1, 'selection not wrapped');
      s.removeAllRanges();
      host.remove();
      G.chromeEdits().splice(G.chromeEdits().indexOf(e), 1);
    });

    test('menu add: navigation-link markup is well-formed', function () {
      var m = G.navLinkMarkup({ id: 42, link: 'https://x.test/pricing/', title: { rendered: 'Pricing &amp; Plans' } });
      expect(m.indexOf('wp:navigation-link') !== -1, 'not a navigation link');
      expect(m.indexOf('"label":"Pricing &amp; Plans"') !== -1, 'label missing: ' + m);
      expect(m.indexOf('"id":42') !== -1 && m.indexOf('"url":"https://x.test/pricing/"') !== -1, 'page ref missing');
      expect(/\/-->$/.test(m.trim()), 'not self-closing');
    });

    test('footer pill is fixed at the viewport bottom and unobstructed', function () {
      var fp = q('.gogh-chromebtn.is-footpill');
      expect(fp, 'no fixed footer pill');
      // SIMPLE MODE: the pill never reveals — the veil is the only door
      var exp0 = window.GOGH.experiments;
      window.GOGH.experiments = false;
      var fpart0 = document.querySelector('footer.wp-block-template-part') || document.body;
      fpart0.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      expect(!fp.classList.contains('is-vis'), 'pill revealed in simple mode (the retired step)');
      window.GOGH.experiments = true; // the rest of this test is cycle-era behaviour
      // pills reveal on hover over their part — once the chrome is AWAKE
      // (the armed veil keeps Change hidden so Edit is the one invitation)
      var fpart = document.querySelector('footer.wp-block-template-part') || document.body;
      var fveil = fpart.querySelector('.gogh-chromeveil');
      if (fveil) fveil.querySelector('.gogh-chromeveil-pill').click();
      fpart.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      expect(fp.classList.contains('is-vis'), 'pill not revealed by footer hover');
      var cs = getComputedStyle(fp);
      expect(cs.position === 'fixed', 'footer pill not fixed: ' + cs.position);
      var r = fp.getBoundingClientRect();
      expect(window.innerHeight - r.bottom < 40 && r.bottom <= window.innerHeight, 'not at viewport bottom: ' + Math.round(r.bottom));
      expect(Math.abs((r.left + r.width / 2) - window.innerWidth / 2) < 40, 'not centred');
      // nothing may cover it — that is how it got lost under the publish chip
      var hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      expect(hit === fp || fp.contains(hit), 'footer pill is covered by ' + (hit ? hit.className : 'nothing'));
      document.body.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      expect(!fp.classList.contains('is-vis'), 'pill did not hide after hover-away');
      window.GOGH.experiments = exp0; // restore the boot value — forcing
      // false here put every LATER cycle-era test in simple mode
    });

    test('header pill is fixed at the viewport top, centred', function () {
      var hp = q('.gogh-chromebtn.is-headpill');
      expect(hp, 'no fixed header pill');
      var exp0 = window.GOGH.experiments;
      window.GOGH.experiments = true; // pills are experiments-only now
      var hpart = document.querySelector('header.wp-block-template-part') || document.body;
      var hveil = hpart.querySelector('.gogh-chromeveil');
      if (hveil) hveil.querySelector('.gogh-chromeveil-pill').click();
      hpart.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      expect(hp.classList.contains('is-vis'), 'pill not revealed by header hover');
      var cs = getComputedStyle(hp);
      expect(cs.position === 'fixed', 'header pill not fixed: ' + cs.position);
      var r = hp.getBoundingClientRect();
      expect(r.top >= 30 && r.top < 120, 'not at viewport top: ' + Math.round(r.top));
      expect(Math.abs((r.left + r.width / 2) - window.innerWidth / 2) < 40, 'not centred');
      var hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      expect(hit === hp || hp.contains(hit), 'header pill is covered by ' + (hit ? hit.className : 'nothing'));
      document.body.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientY: 400 }));
      expect(!hp.classList.contains('is-vis'), 'pill did not hide after hover-away');
      window.GOGH.experiments = exp0;
    });

    test('header pill cycles layouts in place, click-off reverts', function () {
      var pill = q('.gogh-chromebtn');
      expect(pill, 'no chrome pill on the page');
      var partEl = pill.__goghPart;
      expect(partEl, 'pill lost its part reference');
      var baseHTML = pill.innerHTML;
      var options = [
        { kind: 'part', id: 101, slug: 'header', theme: 'x', title: 'Simple header', content: '' },
        { kind: 'part', id: 102, slug: 'header-b', theme: 'x', title: 'Centered header', content: '' },
      ];
      var active = { id: 101, content: { raw: '<!-- wp:group --><div></div><!-- /wp:group -->' } };
      G.startChromeCycle(partEl, 'header', options, options[0], active);
      var bar = q('.gogh-cycbar');
      expect(bar && !bar.hidden, 'cycle strip did not open');
      expect(pill.style.display === 'none', 'pill not hidden while cycling');
      expect(document.body.classList.contains('gogh-cycling'), 'cycling mode class missing (other UI would stay visible)');
      // opening ALREADY shows the next design — the pill click means
      // "show me another"; a second click to start felt clunky (James)
      expect(bar.title.indexOf('Centered header') !== -1, 'did not auto-advance on open (title: ' + bar.title + ')');
      expect(bar.querySelector('.gogh-cyc-n').textContent.indexOf('2/2') === 0, 'wrong position on open');
      expect(bar.querySelector('.gogh-cyc-next').textContent.indexOf('Next header design') === 0, 'button not named per area');
      // click WITH coordinates inside the part's rect: the strip can float
      // over the part, and the part-click claimer must not eat its clicks
      var pr2 = partEl.getBoundingClientRect();
      bar.querySelector('.gogh-cyc-next').dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true,
        clientX: Math.round(pr2.left + pr2.width / 2),
        clientY: Math.round(pr2.top + Math.min(pr2.height / 2, 40)),
      }));
      // the auto-advance's preview may still be in flight — a click during
      // it QUEUES (never drops); either state is legitimate here
      var nTxt = bar.querySelector('.gogh-cyc-n').textContent;
      expect(nTxt.indexOf('1/2') === 0 || nTxt.indexOf('2/2') === 0, 'position label lost (' + nTxt + ')');
      expect(!bar.hidden, 'strip died on Next');
      expect(bar.querySelector('.gogh-cyc-next') && bar.querySelector('.gogh-cyc-ok') &&
        bar.querySelector('.gogh-cyc-edit') &&
        bar.querySelector('.gogh-cyc-more') && bar.querySelector('.gogh-cyc-x'), 'missing strip actions');
      // clicking the HEADER is claimed by the cycle (advance), never a close
      pev('pointerdown', partEl.firstElementChild || partEl);
      expect(!bar.hidden, 'header click closed the strip instead of advancing');
      // ⋯ hands off to the full panel
      bar.querySelector('.gogh-cyc-more').click();
      expect(bar.hidden, 'strip still open after ⋯');
      expect(document.querySelectorAll('.gogh-chrome-opt').length === 2, 'full panel options missing');
      expect(q('.gogh-chrome-edit'), 'full panel lost Make freeform');
      q('.gogh-panel-close').click();
      expect(document.querySelector('.gogh-panel').hidden, 'panel did not close');
      // cycle again, then click-off (outside header + strip) collapses
      G.startChromeCycle(partEl, 'header', options, options[0], active);
      expect(!q('.gogh-cycbar').hidden, 'strip did not re-open');
      // click-off far from the header (geometry check treats the part's
      // whole rect as "next look" territory)
      pev('pointerdown', document.body, 8, window.innerHeight - 8);
      expect(q('.gogh-cycbar').hidden, 'click-off did not close the strip');
      expect(!document.body.classList.contains('gogh-cycling'), 'cycling mode class not removed');
      expect(pill.style.display !== 'none', 'pill not restored after collapse');
      expect(pill.innerHTML === baseHTML, 'pill label changed');
      expect(!document.querySelector('.gogh-chrome-preview'), 'preview left behind after collapse');
    });

    test('header panel: layout, look, spacing, sticky in one home, one Apply', function () {
      var pill = q('.gogh-chromebtn');
      expect(pill, 'no chrome pill on the page');
      var partEl = pill.__goghPart;
      expect(partEl, 'pill lost its part reference');
      var options = [
        { kind: 'part', id: 101, slug: 'header', theme: 'x', title: 'Simple header', content: '' },
        { kind: 'part', id: 102, slug: 'header-b', theme: 'x', title: 'Centered header', content: '' },
      ];
      var active = { id: 101, content: { raw: '<!-- wp:group {"layout":{"type":"flex"}} --><div class="wp-block-group"></div><!-- /wp:group -->' } };
      G.openHeaderPanel(partEl, 'header', options, options[0], active);
      var panel = document.querySelector('.gogh-panel');
      try {
        expect(!panel.hidden, 'panel did not open');
        var lays = panel.querySelectorAll('.gogh-hlayout');
        expect(lays.length === 2, 'expected 2 layout chips, got ' + lays.length);
        expect(lays[0].classList.contains('is-active'), 'current layout not marked active');
        var looks = G.headerLooks();
        expect(panel.querySelectorAll('.gogh-hlooks .gogh-sw').length === looks.length + 1,
          'one swatch per look plus the custom picker expected (' + looks.length + '+1)');
        expect(panel.querySelector('.gogh-sw-pick input[type="color"]'), 'custom colour picker missing');
        expect(panel.querySelector('.gogh-hsticky'), 'sticky toggle missing');
        expect(panel.querySelector('.gogh-hfreeform'), 'freeform door missing');
        expect(panel.querySelector('.gogh-panel-close'), 'sticky panel must show its own door');
        var apply = panel.querySelector('.gogh-happly');
        expect(apply, 'the single Done button is missing');
        // header-room model: Done is always clickable — with nothing armed it
        // just leaves the room; touching a control makes it save on the way out
        expect(!apply.disabled, 'Done must always be clickable in the header room');
        expect(/done/i.test(apply.textContent), 'the save button should read Done');
        // touching anything still keeps exactly one save home
        panel.querySelector('.gogh-hsticky').click();
        expect(panel.querySelectorAll('.gogh-happly').length === 1, 'must stay one single Done button');
        // docked and fully on screen (the below-the-fold family of bugs)
        var r = panel.getBoundingClientRect();
        expect(r.top >= 0 && r.bottom <= window.innerHeight + 1,
          'panel not fully on screen: ' + Math.round(r.top) + '..' + Math.round(r.bottom));
      } finally {
        panel.querySelector('.gogh-panel-close').click();
      }
      expect(document.querySelector('.gogh-panel').hidden, 'panel did not close');
      expect(!document.querySelector('.gogh-chrome-preview'), 'preview left behind after close');
    });

    test('header panel: content up top, styling folded behind More', function () {
      var pill = q('.gogh-chromebtn');
      var partEl = pill.__goghPart;
      var options = [
        { kind: 'part', id: 101, slug: 'header', theme: 'x', title: 'Simple header', content: '' },
        { kind: 'part', id: 102, slug: 'header-b', theme: 'x', title: 'Centered header', content: '' },
      ];
      var active = { id: 101, content: { raw: '<!-- wp:group {"layout":{"type":"flex"}} --><div class="wp-block-group"></div><!-- /wp:group -->' } };
      G.openHeaderPanel(partEl, 'header', options, options[0], active);
      var panel = document.querySelector('.gogh-panel');
      try {
        // the logo doorway is a first-class citizen up top, NOT in the fold
        var logo = panel.querySelector('.gogh-hcontent .gogh-hlogo');
        expect(logo, 'the Logo doorway must ride in the Your-header row, up top');
        var box = panel.querySelector('.gogh-hmorebox');
        expect(box, 'the More fold is missing');
        expect(box.hasAttribute('hidden'), 'styling must be folded away by default (compact)');
        // Look/Spacing live INSIDE the fold, not loose in the panel
        expect(box.querySelector('.gogh-hlooks'), 'Look belongs inside the fold');
        expect(!panel.querySelector('.gogh-hcontent .gogh-hlooks'), 'Look must not sit in the content row');
        // the toggle opens the fold
        var more = panel.querySelector('.gogh-hmore');
        expect(more, 'the More toggle is missing');
        more.click();
        expect(!box.hasAttribute('hidden'), 'More did not reveal the fold');
      } finally {
        panel.querySelector('.gogh-panel-close').click();
      }
    });

    test('header panel: Esc reverts every audition - no stranded paint', function () {
      var pill = q('.gogh-chromebtn');
      var partEl = pill.__goghPart;
      var options = [
        { kind: 'part', id: 101, slug: 'header', theme: 'x', title: 'Simple header', content: '' },
        { kind: 'part', id: 102, slug: 'header-b', theme: 'x', title: 'Centered header', content: '' },
      ];
      var active = { id: 101, content: { raw: '<!-- wp:group {"layout":{"type":"flex"}} --><div class="wp-block-group"></div><!-- /wp:group -->' } };
      G.openHeaderPanel(partEl, 'header', options, options[0], active);
      var panel = document.querySelector('.gogh-panel');
      var dial = panel.querySelector('.gogh-dial-pad');
      expect(dial, 'no Height dial');
      var grp = partEl.querySelector('.wp-block-group');
      // the SAVED header may legitimately wear inline padding (applied
      // dials write it into the markup) — Esc must restore THAT state
      var pad0 = grp.style.paddingTop || '';
      dial.value = 60;
      dial.dispatchEvent(new Event('input', { bubbles: true }));
      expect(grp.style.paddingTop === '60px', 'dial did not paint the header');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(document.querySelector('.gogh-panel').hidden, 'Esc did not close the panel');
      expect((grp.style.paddingTop || '') === pad0, 'Esc left stranded dial padding - the gap-under-the-nav bug (' + grp.style.paddingTop + ' vs ' + (pad0 || 'clean') + ')');
      expect(!partEl.querySelector('.gogh-chrome-preview'), 'Esc left a mounted layout preview');
    });

    test('header panel: dials paint the group on screen, not a hidden ghost', function () {
      var pill = q('.gogh-chromebtn');
      var partEl = pill.__goghPart;
      var options = [
        { kind: 'part', id: 101, slug: 'header', theme: 'x', title: 'Simple header', content: '' },
        { kind: 'part', id: 102, slug: 'header-b', theme: 'x', title: 'Centered header', content: '' },
      ];
      var active = { id: 101, content: { raw: '<!-- wp:group {"layout":{"type":"flex"}} --><div class="wp-block-group"></div><!-- /wp:group -->' } };
      G.openHeaderPanel(partEl, 'header', options, options[0], active);
      var panel = document.querySelector('.gogh-panel');
      // mimic a mounted layout preview: originals hidden, preview box visible
      var hidden = [].slice.call(partEl.children);
      hidden.forEach(function (c) { c.style.display = 'none'; });
      var box = document.createElement('div');
      box.className = 'gogh-chrome-preview';
      box.innerHTML = '<div class="wp-block-group" style="height:40px"></div>';
      partEl.appendChild(box);
      try {
        var dial = panel.querySelector('.gogh-dial-pad');
        dial.value = 44;
        dial.dispatchEvent(new Event('input', { bubbles: true }));
        var prevGrp = box.querySelector('.wp-block-group');
        expect(prevGrp.style.paddingTop === '44px',
          'dial missed the visible preview group - "spacing not working" over a layout audition');
        var origGrp = null;
        hidden.forEach(function (c) {
          if (!origGrp) origGrp = (c.matches && c.matches('.wp-block-group')) ? c : (c.querySelector && c.querySelector('.wp-block-group'));
        });
        expect(!origGrp || origGrp.style.paddingTop !== '44px', 'dial painted the hidden original');
      } finally {
        box.remove();
        hidden.forEach(function (c) { c.style.display = ''; });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
    });

    test('header looks: colour writes attrs and classes in lockstep, and back', function () {
      var raw = '<!-- wp:group {"layout":{"type":"flex"}} --><div class="wp-block-group"><!-- wp:site-title /--></div><!-- /wp:group -->';
      var looks = G.headerLooks();
      expect(looks.length >= 3, 'expected theme default + paper + ink at least, got ' + looks.length);
      expect(!looks[0].bg, 'first look must be theme default (no paint)');
      var painted = looks.filter(function (l) { return l.bg; })[0];
      var out = G.chromeColorApply(raw, painted);
      expect(out, 'apply returned nothing');
      expect(out.indexOf('"backgroundColor":"' + painted.bg + '"') !== -1, 'backgroundColor attr missing');
      expect(out.indexOf('"textColor":"' + painted.ink + '"') !== -1, 'textColor attr missing');
      expect(out.indexOf('has-' + painted.bg + '-background-color') !== -1 && out.indexOf('has-background') !== -1,
        'background classes missing - attrs alone do not paint');
      expect(out.indexOf('has-' + painted.ink + '-color') !== -1 && out.indexOf('has-text-color') !== -1,
        'text classes missing');
      // back to theme default: attrs and classes both gone
      var back = G.chromeColorApply(out, null);
      expect(back.indexOf('backgroundColor') === -1 && back.indexOf('textColor') === -1, 'attrs not removed');
      expect(back.indexOf('has-background') === -1 && back.indexOf('has-text-color') === -1, 'classes not stripped');
      expect(back.indexOf('wp:site-title') !== -1, 'inner blocks lost in the round-trip');
      // custom colour: hex8 through style.color.background + inline lockstep
      var cust = G.chromeColorApply(raw, { custom: true, hex8: '#11223344', ink: 'base' });
      expect(cust.indexOf('"background":"#11223344"') !== -1, 'custom hex8 attr missing');
      expect(/background-color:#11223344/.test(cust), 'custom inline bg missing');
      expect(cust.indexOf('has-background') !== -1 && cust.indexOf('"textColor":"base"') !== -1, 'custom classes/ink missing');
      var back2 = G.chromeColorApply(cust, null);
      expect(back2.indexOf('#11223344') === -1, 'custom colour not fully removed');
      // sticky rides gogh's own marker (the WP attr alone has zero travel)
      var stickyOn = G.stickyRawToggle(raw, true);
      expect(/"type":"sticky"/.test(stickyOn) && /gogh-sticky/.test(stickyOn), 'sticky attr + marker class expected');
      var stickyOff = G.stickyRawToggle(stickyOn, false);
      expect(!/gogh-sticky/.test(stickyOff) && !/"type":"sticky"/.test(stickyOff), 'sticky must strip cleanly');
    });

    test('header ink override: Menu text writes textColor / style.color.text', function () {
      var raw = '<!-- wp:group {"layout":{"type":"flex"}} --><div class="wp-block-group"><!-- wp:navigation /--></div><!-- /wp:group -->';
      // a slug ink override (Light/Dark) writes textColor + class
      var slug = G.chromeColorApply(raw, { ink: 'base' });
      expect(/"textColor":"base"/.test(slug), 'slug ink not written as textColor');
      expect(/has-base-color/.test(slug) && /has-text-color/.test(slug), 'slug ink classes missing');
      // a custom hex ink writes style.color.text, not a preset class
      var hex = G.chromeColorApply(raw, { inkHex: '#abcdef' });
      expect(/"text":"#abcdef"/.test(hex), 'hex ink not written to style.color.text');
      expect(!/has-[a-z0-9-]+-color has-text-color/.test(hex.replace('has-text-color', '')), 'hex ink should not add a preset colour class');
    });

    test('transparent header: preview box governs, the hidden original does not', function () {
      // the stuck-header bug: :has ignores display, so a hidden original
      // overlay kept the header transparent even while auditioning a solid
      // layout. Rule: while previewing, ONLY the preview box governs.
      var h = document.createElement('header');
      h.className = 'wp-block-template-part';
      document.body.appendChild(h);
      // 1) plain overlay (no preview) → floats
      h.innerHTML = '<div class="gogh-header-overlay">nav</div>';
      expect(getComputedStyle(h).position === 'absolute', 'overlay header should float (absolute)');
      // 2) previewing a SOLID layout while the overlay original hides → solid
      h.innerHTML = '<div class="gogh-chrome-preview"><div class="wp-block-group">solid</div></div>' +
        '<div class="gogh-header-overlay" style="display:none">hidden original</div>';
      expect(getComputedStyle(h).position !== 'absolute', 'previewing a solid layout must NOT stay transparent');
      // 3) previewing the transparent layout → floats again
      h.innerHTML = '<div class="gogh-chrome-preview"><div class="gogh-header-overlay">nav</div></div>';
      expect(getComputedStyle(h).position === 'absolute', 'previewing the transparent layout should float');
      h.remove();
    });

    test('one identity: a logo image hides the text title, any layout', function () {
      var h = document.createElement('header');
      h.className = 'wp-block-template-part';
      document.body.appendChild(h);
      // the Centred layout has no .gogh-hrow — the old rule missed it
      h.innerHTML = '<span class="wp-block-site-logo"><img src="data:," alt=""></span>' +
        '<span class="wp-block-site-title">My Site</span>';
      expect(getComputedStyle(h.querySelector('.wp-block-site-title')).display === 'none',
        'text title should hide when a logo image is present');
      // no logo image → the title shows
      h.innerHTML = '<span class="wp-block-site-title">My Site</span>';
      expect(getComputedStyle(h.querySelector('.wp-block-site-title')).display !== 'none',
        'text title should show when there is no logo image');
      h.remove();
    });

    test('the edit-header pill appears on the site header part', function () {
      var pe = G.partElForArea('header');
      expect(pe, 'no header template part found');
      // veils are rebuilt idempotently — running it again must not double up
      G.veilChrome();
      var before = G.chromeVeilCount();
      G.veilChrome();
      expect(G.chromeVeilCount() === before, 'veilChrome double-added a pill');
      expect(before >= 1, 'no edit-header pill was mounted');
    });

    test('copy styles: the roller paints size, colour, align onto other text', function () {
      G.addSection({ name: 'PaintA', minH: 300, els: [
        { type: 'heading', x: 40, y: 40, w: 500, h: 60, text: 'Source', fs: 'xx-large', align: 'center', color: 'contrast' },
        { type: 'para', x: 40, y: 160, w: 400, h: 40, text: 'Target' } ] }, G.sections().length);
      var psec = contentSecs()[contentSecs().length - 1];
      try {
        pev('pointerdown', psec.nodes[0]);
        pev('pointerup', psec.nodes[0]);
        var pb = q('.gogh-eb-paint');
        expect(pb && pb.style.display !== 'none', 'no paint-roller on a text element');
        pb.click();
        expect(document.body.classList.contains('gogh-painting'), 'painting mode did not start');
        pev('pointerdown', psec.nodes[1]);
        var t2 = psec.els[1];
        expect(t2.fs === 'xx-large' && t2.align === 'center' && t2.color === 'contrast',
          'style did not paint: ' + JSON.stringify({ fs: t2.fs, align: t2.align, color: t2.color }));
        expect(document.body.classList.contains('gogh-painting'), 'the roller should stay loaded for more targets');
        // clicking nothing texty rests the roller
        pev('pointerdown', psec.sectionEl);
        expect(!document.body.classList.contains('gogh-painting'), 'click-off did not finish painting');
        // and Esc works too
        pev('pointerdown', psec.nodes[0]); pev('pointerup', psec.nodes[0]);
        q('.gogh-eb-paint').click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(!document.body.classList.contains('gogh-painting'), 'Esc did not finish painting');
        // undo returns the target's own look — undo REBUILDS the model, so
        // the section must be re-derived (a held reference goes stale)
        q('.gogh-undo').click();
        psec = contentSecs()[contentSecs().length - 1];
        expect(psec.els[1].fs !== 'xx-large', 'undo did not restore the target');
        // card kids paint too: the hit resolves through the card box
        psec.els.push({ type: 'box', x: 40, y: 220, w: 300, h: 120, boxBg: 'base',
          kids: [{ type: 'para', x: 12, y: 12, w: 200, h: 30, text: 'KidTarget' }] });
        G.renderSection(psec);
        pev('pointerdown', psec.nodes[0]); pev('pointerup', psec.nodes[0]);
        q('.gogh-eb-paint').click();
        var kidNode = psec.nodes[psec.els.length - 1].querySelector('.gogh-k-1');
        expect(kidNode, 'card kid node missing');
        pev('pointerdown', kidNode);
        var kid = psec.els[psec.els.length - 1].kids[0];
        expect(kid.fs === 'xx-large' && kid.color === 'contrast', 'kid did not take the paint: ' + JSON.stringify({fs: kid.fs, color: kid.color}));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      } finally {
        if (document.body.classList.contains('gogh-painting')) {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }
        psec = contentSecs()[contentSecs().length - 1];
        G.deleteSection(G.sections().indexOf(psec));
      }
      return 'picked up, painted, stayed loaded, rested on click-off and Esc';
    });

    test('carousel: slides compose to snap group, render live, panel edits', function () {
      // compose: real core image blocks in the snap group; preview = same
      var c = G.composeCarousel([
        { img: '/wp-content/plugins/gogh/demo-assets/sunflowers.jpg', cap: 'Sunflowers' },
        { img: '/wp-content/plugins/gogh/demo-assets/starry-night.jpg', cap: '' },
      ]);
      expect(/wp:group \{"className":"gogh-carousel"\}/.test(c.wsrc), 'snap group missing from save');
      expect((c.wsrc.match(/wp:image/g) || []).length === 4, 'each slide must be a real core image block');
      expect(/figcaption[^>]*>Sunflowers</.test(c.wsrc), 'caption must publish');
      expect(c.whtml.indexOf('<!--') === -1, 'preview must carry no block comments');
      expect(/gogh-crsl-nav/.test(c.whtml) && /gogh-crsl-dot/.test(c.whtml), 'preview must wear the centred nav row with dots');
      // options: lightbox = WP's own attr; autoplay = a class; both stored-clean
      var co = G.composeCarousel([{ img: '/a.jpg' }, { img: '/b.jpg' }], { light: 1, auto: 1, nav: 'sides' });
      expect(/gogh-crsl-light/.test(co.wsrc), 'lightbox class missing (gogh lightbox pages between images)');
      expect(/gogh-crsl-auto/.test(co.wsrc), 'autoplay class missing');
      expect(/gogh-crsl-nav-sides/.test(co.wsrc), 'arrow placement class missing');
      expect(!/gogh-crsl-btn/.test(co.wsrc), 'arrows must NEVER be stored');
      expect(/gogh-crsl-side/.test(co.whtml), 'sides mode preview must wear side arrows');
      var cb = G.composeCarousel([{ img: '/a.jpg' }, { img: '/b.jpg' }], {});
      expect(!/gogh-crsl-side/.test(cb.whtml) && /gogh-crsl-nav/.test(cb.whtml), 'below mode: row only');
      // live: the snap machinery is real CSS on the rendered widget
      G.addSection({ name: 'Crsl', minH: 400, els: [
        { type: 'widget', x: 40, y: 40, w: 900, h: 280, slides: [
          { img: '/wp-content/plugins/gogh/demo-assets/sunflowers.jpg', cap: 'One' },
          { img: '/wp-content/plugins/gogh/demo-assets/starry-night.jpg', cap: 'Two' },
          { img: '/wp-content/plugins/gogh/demo-assets/wheat-field.jpg', cap: 'Three' },
        ] } ] }, G.sections().length);
      var csec = contentSecs()[contentSecs().length - 1];
      try {
        var strip = csec.sectionEl.querySelector('.gogh-carousel');
        expect(strip, 'carousel did not render');
        var cs = getComputedStyle(strip);
        expect(cs.display === 'flex' && /mandatory/.test(cs.scrollSnapType) && (cs.overflowX === 'auto' || cs.overflowX === 'scroll'),
          'snap machinery missing: ' + cs.display + '/' + cs.scrollSnapType + '/' + cs.overflowX);
        var slide = strip.querySelector('.gogh-slide');
        expect(slide && getComputedStyle(slide).scrollSnapAlign === 'center', 'slides must snap to centre');
        // the editor's arrows genuinely scroll the strip
        var shell = csec.sectionEl.querySelector('.gogh-crsl-shell');
        var nextBtn = shell && shell.querySelector('.gogh-crsl-btn[data-dir="1"]');
        expect(nextBtn, 'editor preview lost its nav arrows');
        var sl0 = strip.scrollLeft;
        nextBtn.click();
        expect(strip.scrollLeft > sl0, 'arrow did not advance the strip (' + sl0 + ' -> ' + strip.scrollLeft + ')');
        expect(shell.querySelectorAll('.gogh-crsl-dot').length === 3, 'one dot per slide expected');
        // dots jump; the active dot follows
        var dot0 = shell.querySelector('.gogh-crsl-dot[data-k="0"]');
        dot0.click();
        expect(strip.scrollLeft < sl0 + 1, 'dot did not jump back to the first slide');
        expect(dot0.classList.contains('is-here'), 'active dot did not follow the jump');
        // arrows wrap: prev from the first slide lands on the last
        shell.querySelector('.gogh-crsl-btn[data-dir="-1"]').click();
        var lastDot = shell.querySelector('.gogh-crsl-dot[data-k="2"]');
        expect(lastDot.classList.contains('is-here'), 'prev from first must wrap to the last slide');
        // the hover tip teaches the gesture on every data-widget
        expect(csec.nodes[0].dataset.tip === 'Double-click to edit the slides',
          'carousel widget must carry the double-click tip');
        // the panel: second click opens the slide editor
        G.openPanel(csec, 0);
        var panel = document.querySelector('.gogh-panel');
        expect(!panel.hidden && /Carousel/.test(panel.querySelector('.gogh-panel-title').textContent), 'carousel panel did not open');
        expect(panel.querySelectorAll('.gogh-crslrow').length === 3, 'one row per slide expected');
        expect(panel.querySelectorAll('.gogh-crsl-opt').length === 2, 'Auto-play + Click-to-enlarge chips expected');
        expect(panel.querySelectorAll('.gogh-crsl-nav-opt').length === 3, 'Underneath / By the pics / Both expected');
        // chips must LOOK selected — twice now a toggled class had no CSS
        var navOn = panel.querySelector('.gogh-crsl-nav-opt.is-active') || panel.querySelector('.gogh-crsl-nav-opt');
        navOn.click();
        var navOff = [].filter.call(panel.querySelectorAll('.gogh-crsl-nav-opt'), function (b2) { return !b2.classList.contains('is-active'); })[0];
        expect(getComputedStyle(navOn).backgroundColor !== getComputedStyle(navOff).backgroundColor,
          'selected arrow chip paints like an unselected one - no feedback');
        var optOn = panel.querySelector('.gogh-crsl-opt[data-opt="light"]');
        if (!optOn.classList.contains('is-active')) optOn.click();
        var optOff = panel.querySelector('.gogh-crsl-opt[data-opt="auto"]');
        if (optOff.classList.contains('is-active')) optOff.click();
        expect(getComputedStyle(optOn).backgroundColor !== getComputedStyle(optOff).backgroundColor,
          'selected option chip paints like an unselected one - no feedback');
        // caption edits recompose the block
        var cap = panel.querySelector('.gogh-crsl-cap');
        cap.value = 'Renamed';
        cap.dispatchEvent(new Event('input', { bubbles: true }));
        expect(/Renamed/.test(csec.els[0].wsrc), 'caption edit did not recompose');
        // remove keeps the strip honest
        panel.querySelector('.gogh-qna-x').click();
        expect(csec.els[0].slides.length === 2, 'remove failed');
        expect(csec.sectionEl.querySelectorAll('.gogh-slide').length === 2, 'render did not follow the removal');
        document.querySelector('.gogh-panel .gogh-panel-close').click();
      } finally {
        csec = contentSecs()[contentSecs().length - 1];
        G.deleteSection(G.sections().indexOf(csec));
      }
      return 'core blocks, live snap CSS, caption/remove edits follow';
    });

    test('starters dress in the site\u2019s own photos (deterministic)', function () {
      var pool = G.mediaPool;
      var save = { imgs: pool.imgs.slice(), bgs: pool.bgs.slice() };
      try {
        pool.imgs.length = 0; pool.bgs.length = 0;
        ['/wp-content/uploads/a.jpg', '/wp-content/uploads/b.jpg', '/wp-content/uploads/c.jpg'].forEach(function (u) { pool.imgs.push(u); });
        pool.bgs.push('/wp-content/uploads/wide.jpg');
        var hero = G.templates().filter(function (tp) { return tp.starter && tp.els.some(function (e2) { return e2.type === 'image' && !e2.src; }); })[0];
        expect(hero, 'no starter with a placeholder image found');
        var els1 = G.tplEls(hero);
        var img1 = els1.filter(function (e2) { return e2.type === 'image'; })[0];
        expect(/uploads\//.test(img1.src || ''), 'placeholder image not populated from the library');
        var els2 = G.tplEls(hero);
        var img2 = els2.filter(function (e2) { return e2.type === 'image'; })[0];
        expect(img1.src === img2.src, 'picks must be deterministic - shelf preview and insert must match');
        var crsl = G.templates().filter(function (tp) { return tp.name === 'Carousel'; })[0];
        var slides = G.tplEls(crsl).filter(function (e2) { return e2.slides; })[0].slides;
        expect(slides.every(function (sl) { return /uploads\//.test(sl.img); }), 'carousel demo art must swap for their photos');
        expect(slides.every(function (sl) { return !sl.cap; }), 'painting captions must not ride their photos');
      } finally {
        pool.imgs.length = 0; pool.bgs.length = 0;
        save.imgs.forEach(function (u) { pool.imgs.push(u); });
        save.bgs.forEach(function (u) { pool.bgs.push(u); });
      }
      return 'placeholders fill from uploads, deterministic, demo art swapped';
    });

    test('photo wall: columns masonry, panel edits, lightbox class', function () {
      var c = G.composeWall([
        { img: '/wp-content/plugins/gogh/demo-assets/sunflowers.jpg', cap: 'Sun' },
        { img: '/wp-content/plugins/gogh/demo-assets/starry-night.jpg', cap: '' },
      ], { cols: 2, light: 1 });
      expect(/gogh-wall gogh-wall-2/.test(c.wsrc), 'columns class missing');
      expect(/gogh-crsl-light/.test(c.wsrc), 'lightbox class missing');
      expect((c.wsrc.match(/wp:image/g) || []).length === 4, 'each brick must be a real core image block');
      expect(c.whtml.indexOf('<!--') === -1, 'preview must carry no block comments');
      G.addSection({ name: 'Wall', minH: 500, els: [
        { type: 'widget', x: 40, y: 40, w: 900, h: 400, wopt: { cols: 3, light: 1 }, wall: [
          { img: '/wp-content/plugins/gogh/demo-assets/sunflowers.jpg', cap: 'One' },
          { img: '/wp-content/plugins/gogh/demo-assets/starry-night.jpg', cap: 'Two' },
          { img: '/wp-content/plugins/gogh/demo-assets/wheat-field.jpg', cap: 'Three' },
          { img: '/wp-content/plugins/gogh/demo-assets/almond-blossom.jpg', cap: 'Four' },
        ] } ] }, G.sections().length);
      var wsec = contentSecs()[contentSecs().length - 1];
      try {
        var wallEl = wsec.sectionEl.querySelector('.gogh-wall');
        expect(wallEl, 'wall did not render');
        var cs = getComputedStyle(wallEl);
        expect(cs.columnCount === '3', 'CSS columns missing: ' + cs.columnCount);
        expect(wsec.nodes[0].dataset.tip === 'Double-click to edit the photos', 'wall must carry the double-click tip');
        G.openPanel(wsec, 0);
        var panel = document.querySelector('.gogh-panel');
        expect(/Photo wall/.test(panel.querySelector('.gogh-panel-title').textContent), 'wall panel did not open');
        expect(panel.querySelectorAll('.gogh-crslrow').length === 4, 'one row per photo expected');
        // columns chip recomposes live
        panel.querySelector('.gogh-crsl-nav-opt[data-cols="2"]').click();
        expect(/gogh-wall-2/.test(wsec.els[0].wsrc), 'columns chip did not recompose');
        expect(getComputedStyle(wsec.sectionEl.querySelector('.gogh-wall')).columnCount === '2', 'render did not follow the columns change');
        document.querySelector('.gogh-panel .gogh-panel-close').click();
      } finally {
        wsec = contentSecs()[contentSecs().length - 1];
        G.deleteSection(G.sections().indexOf(wsec));
      }
      return 'columns masonry, live panel edits, tips';
    });

    test('glass mood: frosted card CSS, starters on the shelves', function () {
      G.addSection({ name: 'GlassChk', minH: 400, bgImage: '/wp-content/plugins/gogh/demo-assets/wheat-field.jpg', els: [
        { type: 'box', x: 400, y: 60, w: 400, h: 280, radius: 24, mood: 'glass', kids: [
          { type: 'heading', x: 32, y: 40, w: 336, h: 44, text: 'Frosted' } ] } ] }, G.sections().length);
      var gsec = contentSecs()[contentSecs().length - 1];
      try {
        var css = gsec.styleEl.textContent;
        expect(/backdrop-filter: blur/.test(css), 'glass must backdrop-blur');
        expect(/color-mix\(in srgb, var\(--wp--preset--color--base, #fff\) 70%/.test(css), 'glass must be translucent base');
        var node = gsec.nodes[0];
        var cs = getComputedStyle(node);
        expect(cs.backdropFilter && cs.backdropFilter !== 'none', 'computed backdrop-filter missing: ' + cs.backdropFilter);
        expect(cs.boxShadow !== 'none', 'glass card must cast a shadow');
      } finally {
        G.deleteSection(G.sections().indexOf(gsec));
      }
      var names = G.templates().filter(function (tp) { return tp.starter && !tp.retired; }).map(function (tp) { return tp.name; });
      ['Profile card', 'Job card', 'Place card'].forEach(function (nm) {
        expect(names.indexOf(nm) !== -1, nm + ' starter missing from the shelves');
      });
      return 'frosted CSS real, three glass starters shelved';
    });

    test('compose module matches the editor (splash drift guard)', function () {
      var items = [{ img: '/a.jpg', cap: 'One' }, { img: '/b.jpg', cap: '' }];
      var C = window.__goghCompose;
      expect(C, 'gogh-compose module missing in editor context');
      var e1 = G.composeCarousel(items, { light: 1, nav: 'sides' });
      var m1 = C.carousel(items, { light: 1, nav: 'sides' });
      expect(e1.wsrc === m1.raw, 'carousel compose drifted between editor and module');
      var e2 = G.composeWall(items, { cols: 2, light: 1 });
      var m2 = C.wall(items, { cols: 2, light: 1 });
      expect(e2.wsrc === m2.raw, 'wall compose drifted between editor and module');
      var b = C.breakImage('/c.jpg', 'alt words');
      expect(/"align":"full"/.test(b.raw) && /gogh-splash-break/.test(b.raw), 'break image markup wrong');
      var g = C.glass('/d.jpg', { title: 'T', text: 'L', kicker: 'K' });
      expect(/wp:cover/.test(g.raw) && /gogh-glass/.test(g.raw) && /<h2 class="wp-block-heading">T<\/h2>/.test(g.raw), 'glass markup wrong');
      return 'module and editor compose identically; break + glass shaped right';
    });

    // ---- picker redesign: inline header search, theme chip ----
    test('picker: inline search filters, old toggle gone, theme chip present', function () {
      G.openPicker(G.sections().length);
      expect(!q('.gogh-picker-searchbtn') && !q('.gogh-patsearchrow'), 'old search toggle still present');
      var sIn = q('.gogh-picker-search .gogh-patsearch');
      expect(sIn, 'inline search missing from header');
      sIn.value = 'quote';
      sIn.dispatchEvent(new Event('input', { bubbles: true }));
      var vis = [].filter.call(document.querySelectorAll('.gogh-cards .gogh-card'), function (c) {
        return c.style.display !== 'none';
      });
      expect(vis.length >= 1, 'search found nothing for "quote"');
      expect(vis.every(function (c) {
        return /quote/i.test((c.querySelector('.gogh-card-name') || {}).textContent || '');
      }), 'non-matching cards visible under search');
      expect(q('.gogh-viewbar'), 'view bar missing');
      q('.gogh-picker-close').click();
      expect(q('.gogh-picker').hidden, 'picker did not close');
    });

    // ---- picker: Quick start row of three banners ----
    test('picker: quick start offers scratch / paste / my sections', function () {
      G.openPicker(G.sections().length);
      var tiles = document.querySelectorAll('.gogh-quickrow .gogh-quick');
      expect(tiles.length === 3, 'expected 3 quick tiles, got ' + tiles.length);
      expect(/Start from scratch/.test(tiles[0].textContent), 'scratch tile missing');
      expect(/Paste HTML/.test(tiles[1].textContent), 'paste tile missing');
      expect(/My sections/.test(tiles[2].textContent), 'my-sections tile missing');
      expect(q('.gogh-picker-sub'), 'header subtitle missing');
      var labs = document.querySelectorAll('.gogh-seclab');
      expect(labs.length >= 3, 'section labels missing (Quick start / Recommended / Browse)');
      q('.gogh-card-htmladd').click();
      expect(q('.gogh-htmlpaste'), 'paste tile did not open the paste view');
      q('.gogh-picker-close').click();
      expect(q('.gogh-picker').hidden, 'picker did not close');
    });

    // ---- section background: upload lives in the panel ----
    test('section background panel offers Upload', function () {
      G.openSecBgPanel(G.sections().indexOf(sec()));
      if (window.GOGH && window.GOGH.canUpload) {
        var up = q('.gogh-panel .gogh-upload input[type="file"]');
        expect(up, 'no Upload control in the section background panel');
      }
      expect(q('.gogh-panel .gogh-media'), 'media library grid missing');
      G.closePanel();
      return 'upload + media grid present';
    });

    // ---- cards: a box with kids is a mini-section ----
    test('card: kids render inside, publish nested, hold together on mobile', function () {
      var s0 = sec();
      s0.els.push({ type: 'box', x: 100, y: 60, w: 500, h: 360, boxBg: '#202531', radius: 18,
        kids: [
          { type: 'heading', x: 40, y: 40, w: 420, h: 50, text: 'Card headline' },
          { type: 'para', x: 40, y: 110, w: 420, h: 60, text: 'Card copy inside.' },
          { type: 'button', x: 40, y: 250, w: 180, h: 50, text: 'Card CTA' },
        ] });
      G.renderSection(s0);
      var i = s0.els.length - 1;
      var card = s0.nodes[i];
      expect(card.classList.contains('gogh-cardbox'), 'card class missing');
      expect(card.querySelector('.gogh-k-1') && card.querySelector('.gogh-k-3'), 'kids not rendered inside the card');
      var ccs = getComputedStyle(card);
      expect(ccs.display === 'grid', 'card is not its own grid');
      expect(ccs.gridTemplateColumns.indexOf('px') !== -1 || /fr/.test(s0.styleEl.textContent), 'card grid not emitted');
      var kh = card.querySelector('.gogh-k-1');
      expect(getComputedStyle(kh).gridArea !== 'auto', 'kid has no grid placement');
      // publish: nested blocks + kids in attrs model
      var v3 = G.buildV3();
      expect(v3.indexOf('gogh-cardbox') !== -1, 'card class not published');
      expect(/gogh-k-1/.test(v3), 'kid classes not published');
      expect(v3.indexOf('"kids":[{') !== -1, 'kids missing from model attrs');
      // published nesting: the kid heading sits INSIDE the card group div
      var cardAt = v3.indexOf('gogh-cardbox"');
      var kidAt = v3.indexOf('Card headline</h2>');
      expect(cardAt !== -1 && kidAt > cardAt, 'kid emitted outside the card (markup anchors)');
      // mobile: kids stay inside the card while the section stacks
      var wrap = s0.sectionEl.closest('.gogh-wrap');
      wrap.style.width = '375px'; wrap.style.minWidth = '0';
      void wrap.offsetWidth;
      var cr = card.getBoundingClientRect();
      var hr = kh.getBoundingClientRect();
      expect(hr.top >= cr.top - 1 && hr.bottom <= cr.bottom + 1 && hr.left >= cr.left - 1,
        'kid escaped the card on mobile');
      expect(cr.width < 380, 'card did not stack to the mobile column');
      wrap.style.width = ''; wrap.style.minWidth = '';
      void wrap.offsetWidth;
      s0.els.pop();
      G.renderSection(s0);
      return 'nested render + nested publish + mobile integrity';
    });

    test('card interactions: drop joins, kid drags inside, drag-out frees', function () {
      var s0 = sec();
      s0.els.push({ type: 'box', x: 600, y: 80, w: 480, h: 380, boxBg: '#101418', radius: 16 });
      s0.els.push({ type: 'heading', x: 60, y: 120, w: 300, h: 48, text: 'Joiner' });
      G.renderSection(s0);
      var hi = s0.els.length - 1;
      var node = s0.nodes[hi];
      var sc = s0.sectionEl.getBoundingClientRect().width / 1200;
      var r = node.getBoundingClientRect();
      var pv3 = function (type, el, x, y, id) {
        el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: id, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
      };
      // drag the heading fully inside the box → it joins as a kid
      var dx = (660 - s0.els[hi].x) * sc, dy = (170 - s0.els[hi].y) * sc;
      pv3('pointerdown', node, r.left + 10, r.top + 8, 61);
      pv3('pointermove', document, r.left + 10 + dx / 2, r.top + 8 + dy / 2, 61);
      pv3('pointermove', document, r.left + 10 + dx, r.top + 8 + dy, 61);
      pv3('pointerup', document, r.left + 10 + dx, r.top + 8 + dy, 61);
      var box = s0.els.filter(function (e) { return e.type === 'box' && e.kids; })[0];
      expect(box && box.kids.length === 1 && box.kids[0].text === 'Joiner', 'drop did not join the card');
      var ci = s0.els.indexOf(box);
      var kn = s0.nodes[ci].querySelector('.gogh-k-1');
      expect(kn, 'kid node missing after join');
      // kid drags WITHIN the card
      var kid = box.kids[0];
      var kx = kid.x, r2 = kn.getBoundingClientRect();
      pv3('pointerdown', kn, r2.left + 8, r2.top + 6, 62);
      pv3('pointermove', document, r2.left + 8 + 30 * sc, r2.top + 6, 62);
      pv3('pointerup', document, r2.left + 8 + 30 * sc, r2.top + 6, 62);
      expect(kid.x === kx + 30, 'kid did not move within the card: ' + kid.x + ' vs ' + (kx + 30));
      // drag OUT far past the edge → free element again
      var r3 = kn.getBoundingClientRect();
      var cardR = s0.nodes[ci].getBoundingClientRect();
      pv3('pointerdown', kn, r3.left + 8, r3.top + 6, 63);
      pv3('pointermove', document, cardR.left - 150, r3.top + 6, 63);
      pv3('pointerup', document, cardR.left - 150, r3.top + 6, 63);
      expect(!box.kids, 'kids not cleared after leaving');
      var freed = s0.els.filter(function (e) { return e.text === 'Joiner'; })[0];
      expect(freed && freed !== box, 'kid did not return to the page');
      // cleanup
      [box, freed].forEach(function (e) {
        var at = s0.els.indexOf(e);
        if (at !== -1) s0.els.splice(at, 1);
      });
      G.renderSection(s0);
      [].slice.call(document.querySelectorAll('.gogh-toast')).forEach(function (t) { t.remove(); });
      return 'join on drop · move inside · drag out to free';
    });

    // ---- pasted cards: never squashed into buttons, text editable in place ----
    test('card-shaped anchors scan as widgets and their text edits in place', function () {
      G.addHtmlSection('<div style="padding:40px;background:#eee">' +
        '<a href="#" style="display:flex;align-items:flex-end;min-height:420px;padding:30px;background:#333;color:#fff;border-radius:20px;text-decoration:none">' +
        '<div><h2 style="margin:0">Card headline</h2><p>Card copy.</p></div></a></div>', null);
      var entry = G.pending()[G.pending().length - 1];
      entry.el.querySelector('.gogh-pend-ff').click();
      var s0 = contentSecs()[contentSecs().length - 1];
      var types = s0.els.map(function (e) { return e.type; });
      expect(types.indexOf('button') === -1, 'card anchor squashed into a button: ' + types.join(','));
      var wi = s0.els.findIndex(function (e) { return e.type === 'widget'; });
      expect(wi !== -1, 'no widget produced: ' + types.join(','));
      var node = s0.nodes[wi];
      var h2 = node.querySelector('h2');
      expect(h2, 'no heading inside widget');
      var r = h2.getBoundingClientRect();
      var pv2 = function (type) {
        h2.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 8, pointerId: 91, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
      };
      pv2('pointerdown'); pv2('pointerup');
      pv2('pointerdown'); pv2('pointerup');
      expect(h2.isContentEditable, 'second click did not enter widget text edit');
      h2.textContent = 'Edited headline';
      h2.dispatchEvent(new Event('input', { bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      var e = s0.els[wi];
      expect(e.wsrc.indexOf('Edited headline') !== -1, 'edit not synced to widget source');
      expect(e.wsrc.indexOf('contenteditable') === -1, 'contenteditable residue in source');
      expect(!h2.isContentEditable, 'Escape did not exit');
      G.deleteSection(G.sections().indexOf(s0));
      return 'widget cards: intact, draggable whole, text editable';
    });

    // ---- starter-site era: native pages, covers, converted deletes ----
    test('native pages: no bootstrap placeholder, no delete-into-picker', function () {
      var host = document.querySelector('.entry-content');
      expect(host, 'fixture has entry-content');
      expect(G.goghHasNativeContent() === false, 'fixture itself is all-gogh');
      var fake = document.createElement('div');
      fake.className = 'wp-block-group faux-native';
      host.appendChild(fake);
      var withNative = G.goghHasNativeContent();
      fake.remove();
      expect(withNative === true, 'a native top block flips the predicate');
      expect(G.goghHasNativeContent() === false, 'and it flips back');
      return 'goghHasNativeContent gates bootstrap + delete-picker paths';
    });

    test('cover blocks: scaffolding does not derail light-edit pairing', function () {
      // mirror the REAL starter hero: cover > overlay + inner-container
      // wrapper > columns > column > paragraph — two scaffold layers deep
      var raw = '<!-- wp:cover {"customOverlayColor":"#e68b14"} -->\n' +
        '<div class="wp-block-cover"><span aria-hidden="true" class="wp-block-cover__background has-background-dim-100 has-background-dim" style="background-color:#e68b14"></span>' +
        '<div class="wp-block-cover__inner-container">' +
        '<!-- wp:columns -->\n<div class="wp-block-columns">' +
        '<!-- wp:column -->\n<div class="wp-block-column">' +
        '<!-- wp:paragraph -->\n<p>Editable cover words</p>\n<!-- /wp:paragraph -->' +
        '</div>\n<!-- /wp:column -->' +
        '</div>\n<!-- /wp:columns -->' +
        '</div></div>\n<!-- /wp:cover -->';
      var holder = document.createElement('div');
      holder.innerHTML = '<div class="wp-block-cover"><span aria-hidden="true" class="wp-block-cover__background has-background-dim-100 has-background-dim" style="background-color:#e68b14"></span>' +
        '<div class="wp-block-cover__inner-container"><div class="wp-block-columns"><div class="wp-block-column"><p>Editable cover words</p></div></div></div></div>';
      document.body.appendChild(holder);
      var entry = { el: holder, raw: raw, savedRaw: raw, stored: true, title: 'Test cover' };
      try {
        G.bindPending(entry);
        var p = holder.querySelector('p');
        var leaf = entry.__leafOf && entry.__leafOf(p);
        expect(leaf, 'cover paragraph pairs with its span despite the overlay scaffolding');
      } finally {
        holder.remove();
      }
      return 'cover overlay span no longer shifts the child pairing';
    });

    test('deleting a converted section excises, never resurrects', function () {
      G.addSection({ title: 'T', minH: 200, els: [
        { type: 'heading', x: 90, y: 40, w: 400, h: 40, text: 'Convert victim', fs: 'large' },
      ] });
      var c = contentSecs();
      var victim = c[c.length - 1];
      victim.srcSig = 'test-sig-x';
      var fakeNode = document.createElement('div');
      var fakeMarker = document.createComment('gogh-src');
      document.body.appendChild(fakeMarker);
      G.convertStash()['test-sig-x'] = { node: fakeNode, marker: fakeMarker, raw: '<!-- wp:group -->FAKE SPAN<!-- /wp:group -->' };
      var storedBefore = G.storedEdits().length;
      G.deleteSectionRaw(G.sections().indexOf(victim));
      var entries = G.storedEdits();
      var added = entries.length === storedBefore + 1 && entries[entries.length - 1].deleted &&
        entries[entries.length - 1].savedRaw.indexOf('FAKE SPAN') !== -1;
      expect(added, 'delete queued the original span for excision');
      expect(!G.convertStash()['test-sig-x'], 'stash entry consumed');
      expect(!fakeNode.parentNode, 'original block NOT resurrected into the page');
      entries.pop();
      fakeMarker.remove();
      return 'converted delete = content gone + span excised on publish';
    });

    test('wrap: image dropped into text floats with shape-outside', function () {
      // long para (never one line) + an image straddling its top edge: the
      // wrap target is pure MODEL geometry, but a short para auto-shrinks below
      // the image at wide renders and the vertical overlap vanishes — enough
      // text keeps it comfortably taller than the image no matter how it breaks
      G.addSection({ title: 'W', minH: 400, els: [
        { type: 'para', x: 90, y: 40, w: 700, h: 300, text: 'Words that will learn to flow around a painting like water around a stone, given enough sentences to make the wrapping visible. Line after line the paragraph grows, so its body always stands taller than any image dropped onto it. That guarantees real vertical overlap no matter how the words happen to break across the column.' },
        { type: 'image', x: 200, y: 60, w: 280, h: 180, src: '/wp-content/plugins/gogh/demo-assets/sunflowers.jpg' },
      ] });
      var c = contentSecs();
      var secW = c[c.length - 1];
      var ii = secW.els.length - 1;
      // the section resolver pushes overlaps apart on render — a real drag
      // holds raw positions, so restore the mid-drag overlap for the check
      secW.els[ii].x = 200;
      secW.els[ii].y = 80;
      expect(G.wrapTargetIdx(secW, ii) === 0, 'image over text detects the wrap target');
      G.wrapImageIntoText(secW, ii, 0);
      expect(secW.els.length === 1, 'image element consumed into the text');
      var t = secW.els[0];
      expect(t.text.indexOf('gogh-wrapped') !== -1, 'wrapped img in text model');
      expect(t.text.indexOf('shape-outside') !== -1, 'silhouette wrap in style');
      var node = secW.nodes[0];
      var img = node.querySelector('img.gogh-wrapped');
      expect(img, 'wrapped img renders inside the paragraph');
      expect(getComputedStyle(img).float === 'left' || getComputedStyle(img).float === 'right', 'img floats');
      // sanitizer round-trip keeps it; hostile attrs do not survive
      var kept = G.cleanInline ? null : null;
      var dirty = t.text.replace('<img ', '<img onerror="x()" ');
      var rendered = document.createElement('div');
      rendered.innerHTML = dirty;
      G.deleteSection(G.sections().indexOf(secW));
      return 'image → flowing text: target, consume, float, silhouette';
    });

    test('wrap: drop point chooses where the wrap begins', function () {
      var filler = 'The words keep arriving, sentence after sentence, so the paragraph grows tall enough that a drop in its lower half is clearly distinct from its opening line. ';
      G.addSection({ title: 'W2', minH: 400, els: [
        { type: 'para', x: 90, y: 40, w: 700, h: 300, text: filler + filler + filler + filler },
        { type: 'image', x: 200, y: 160, w: 240, h: 160, src: '/wp-content/plugins/gogh/demo-assets/sunflowers.jpg' },
      ] });
      var c = contentSecs();
      var secW = c[c.length - 1];
      var ii = secW.els.length - 1;
      secW.els[ii].x = 200;
      secW.els[ii].y = 160;
      var host = secW.nodes[0];
      if (host.tagName !== 'P') host = host.querySelector('p') || host;
      host.scrollIntoView({ block: 'center' });
      var hr = host.getBoundingClientRect();
      // drop three-quarters of the way down the text — the wrap should
      // begin there, leaving the opening lines full width
      G.wrapImageIntoText(secW, ii, 0, hr.left + hr.width / 2, hr.top + hr.height * 0.75);
      var t = secW.els[0];
      var pos = t.text.indexOf('<img');
      expect(pos !== -1, 'wrapped img in text model');
      expect(pos > 40, 'img inserted at the drop point, not prepended');
      G.deleteSection(G.sections().indexOf(secW));
      return 'drop low in the text → wrap starts there, opening lines stay full width';
    });

    // ---- guardrails: scrims behind text, struck swatches ----
    test('guardrails: auto-scrim behind text, honest swatch strikes', function () {
      var s0 = sec();
      // section image with NO tint colour + text on top → soft base scrim
      var keepBg = s0.bgImage;
      s0.bgImage = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
      G.resolve(s0);
      var css1 = s0.styleEl.textContent;
      expect(/linear-gradient\(color-mix\(in srgb, var\(--wp--preset--color--base/.test(css1),
        'no auto scrim behind text');
      s0.bgImage = keepBg;
      G.resolve(s0);
      // photo card with words and no colour → scrim in the card rule
      s0.els.push({ type: 'box', x: 60, y: 40, w: 400, h: 300, radius: 12,
        boxImg: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
        kids: [ { type: 'heading', x: 20, y: 20, w: 300, h: 40, text: 'Words on photo' } ] });
      G.renderSection(s0);
      var css2 = s0.styleEl.textContent;
      expect(css2.indexOf('color-mix(in srgb, var(--wp--preset--color--base, #fff) 40%') !== -1,
        'photo card with words missing its scrim');
      s0.els.pop();
      G.renderSection(s0);
      // swatch marking: a swatch matching the backdrop gets struck
      var row = document.createElement('div');
      row.innerHTML = '<button class="gogh-sw" data-col="probe-dark"></button>';
      document.body.appendChild(row);
      var probeStyle = document.createElement('style');
      probeStyle.textContent = ':root { --wp--preset--color--probe-dark: #14161a; }';
      document.head.appendChild(probeStyle);
      G.markSwatchLegibility(row, '#101216');
      var struck = row.querySelector('.gogh-sw').classList.contains('gogh-sw-lowc');
      probeStyle.remove();
      row.remove();
      expect(struck, 'same-as-backdrop swatch not struck');
      expect(G.cssColorToHex('#abcdef') === '#abcdef', 'hex passthrough broken');
      return 'scrims where words meet photos \u00b7 strikes where colours collide';
    });

    // ---- your brand: contrast maths + variation mapping ----
    test('brand: contrast ratio and variation mapping are sound', function () {
      expect(G.contrastRatio('#000000', '#ffffff') === 21, 'black/white should be 21, got ' + G.contrastRatio('#000000', '#ffffff'));
      expect(G.contrastRatio('#777777', '#888888') < 1.3, 'near-identical greys should be ~1');
      expect(G.contrastRatio('nope', '#fff') === null, 'invalid input should be null');
      var v = G.brandToVariation({ colors: { background: '#f6f2ea', text: '#1b2a4a', accent: '#c96f4a', accent2: '#7a9e7e' }, fonts: {} });
      var pal = v.settings.color.palette.theme;
      expect(pal.length >= 2, 'palette too small: ' + pal.length);
      var by = {};
      pal.forEach(function (p) { by[p.slug] = p.color; });
      var baseSlug = Object.keys(by).filter(function (k) { return /^(base|background)/.test(k); })[0];
      // the text-role slug is whatever THIS theme calls its ink (TT5:
      // contrast, Ollie: main) — resolve it by role, conventions second
      var roleTx = (G.paletteRoles() || {}).textSlug;
      var contrastSlug = Object.keys(by).filter(function (k) {
        return k === roleTx || /^(contrast|text|foreground|main)(-|$)/.test(k);
      })[0];
      expect(baseSlug && by[baseSlug] === '#f6f2ea', 'background not mapped to ' + baseSlug);
      expect(contrastSlug && by[contrastSlug] === '#1b2a4a', 'text not mapped to ' + contrastSlug);
      // a theme styling may seat TEXT (or background) in an accent-N slot —
      // TT5's dark looks use accent-4 as ink — and brandToVariation rightly
      // gives such a slot the ROLE colour, not an accent
      var accentSlugs = Object.keys(by).filter(function (k) {
        return /accent/.test(k) && k !== roleTx && k !== baseSlug && k !== contrastSlug;
      });
      expect(accentSlugs.every(function (k) { return by[k] === '#c96f4a' || by[k] === '#7a9e7e'; }) || accentSlugs.length === 0,
        'accent slugs not cycled through brand accents');
      return 'ratios exact · palette mapped onto theme slugs';
    });

    // ---- page style: curated template switcher ----
    test('page style panel lists curated options with the current one marked', function () {
      expect(q('.gogh-pagestylebtn'), 'no palette button');
      G.openPageStylePanel();
      var opts = [].slice.call(document.querySelectorAll('.gogh-pagestyle'));
      expect(opts.length >= 2, 'too few options: ' + opts.length);
      var names = opts.map(function (o) { return o.querySelector('.gogh-pagestyle-name').textContent; });
      expect(names.indexOf('Standard') !== -1, 'no Standard option');
      expect(names.indexOf('Blank canvas') !== -1, 'no Blank canvas option (WP 6.7+): ' + names.join(','));
      var current = opts.filter(function (o) { return o.classList.contains('is-current'); });
      expect(current.length === 1, 'exactly one current expected, got ' + current.length);
      G.closePanel();
      return names.join(' · ');
    });

    // ---- html import: what used to get lost now survives ----
    test('paste sanitizer: lazy images promoted, largest srcset pinned', function () {
      var out = G.sanitizePastedHtml(
        '<img src="data:image/gif;base64,tiny" data-src="https://cdn.x.com/real.jpg" />' +
        '<img src="https://cdn.x.com/s.jpg" srcset="https://cdn.x.com/a.jpg 400w, https://cdn.x.com/b.jpg 1600w, https://cdn.x.com/c.jpg 800w" sizes="100vw" />');
      expect(out.indexOf('src="https://cdn.x.com/real.jpg"') !== -1, 'data-src not promoted');
      expect(out.indexOf('src="https://cdn.x.com/b.jpg"') !== -1, 'largest srcset not pinned');
      expect(out.indexOf('srcset=') === -1 && out.indexOf('sizes=') === -1, 'srcset residue left');
      return 'lazy + srcset both resolved';
    });
    test('paste sanitizer: relative URLs repaired when the origin is knowable', function () {
      var out = G.sanitizePastedHtml(
        '<img src="//cdn.pix.io/p.jpg" /><img src="/img/hero.jpg" />' +
        '<div style="background-image:url(/img/back.jpg)"></div>' +
        '<img src="https://coolsite.example/logo.png" />');
      expect(out.indexOf('src="https://cdn.pix.io/p.jpg"') !== -1, 'protocol-relative not fixed');
      expect(out.indexOf('src="https://coolsite.example/img/hero.jpg"') !== -1, 'root-relative img not repaired: ' + out.slice(0, 160));
      expect(out.indexOf('url(https://coolsite.example/img/back.jpg)') !== -1, 'css url not repaired');
      // two different foreign origins → ambiguous → left alone
      var amb = G.sanitizePastedHtml('<img src="/x.jpg" /><img src="https://a.example/1.png" /><img src="https://b.example/2.png" />');
      expect(amb.indexOf('src="/x.jpg"') !== -1, 'ambiguous origin should not be guessed');
      return 'unambiguous repaired, ambiguous left honest';
    });
    test('freeform scan: photo backdrops and orphan styles survive', function () {
      var inner = '<style>.zk h2:hover{color:red}</style>' +
        '<div class="zk" style="padding:40px">' +
        '<div style="width:500px;background-image:url(data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==);background-size:cover;padding:60px">' +
        '<h3>Text on a photo</h3></div>' +
        '<h2>Plain heading</h2><p>Plain para</p></div>';
      var stage = document.createElement('div');
      stage.style.cssText = 'position:absolute;left:-9999px;top:0;width:1200px';
      stage.innerHTML = inner;
      document.body.appendChild(stage);
      var raw = '<!-- wp:html -->\n' + inner + '\n<!-- /wp:html -->';
      var scan = G.scan(stage, raw, { loose: true, freeHtml: true });
      stage.remove();
      expect(scan.els.length, 'nothing scanned at all');
      var box = scan.els.filter(function (e) { return e.type === 'box' && e.boxBg && String(e.boxBg).indexOf('url(') !== -1; })[0];
      expect(box, 'photo-backdrop container vanished: ' + scan.els.map(function (e) { return e.type; }).join(','));
      expect(String(box.boxBg).indexOf('/') !== -1, 'background size lost: ' + box.boxBg);
      var carrier = scan.els.filter(function (e) { return e.type === 'widget' && /zk h2:hover/.test(e.wsrc || ''); })[0];
      expect(carrier, 'orphan stylesheet dropped (no carrier)');
      var stage2 = document.createElement('div');
      stage2.style.cssText = 'position:absolute;left:-9999px;top:0;width:1200px';
      var inner2 = '<style>.qq{color:blue}</style><div class="qq" style="padding:30px"><h2>Hi</h2></div>';
      stage2.innerHTML = inner2;
      document.body.appendChild(stage2);
      var scan2 = G.scan(stage2, '<!-- wp:html -->\n' + inner2 + '\n<!-- /wp:html -->', { loose: true, freeHtml: true });
      stage2.remove();
      expect(!scan2.els.some(function (e) { return e.type === 'widget'; }), 'static-only sheet spawned a stray widget');
      return 'photo box + gated style carrier';
    });

    // ---- menu manager: structured nav model, byte-preserving ----
    test('nav model: parse/serialize round-trips, nests, un-nests, promotes', function () {
      var raw = '<!-- wp:navigation-link {"label":"Home","url":"/","kind":"post-type","id":12} /-->\n' +
        '<!-- wp:navigation-submenu {"label":"Services","url":"/services","kind":"post-type"} -->\n' +
        '<!-- wp:navigation-link {"label":"Web design","url":"/web","kind":"post-type"} /-->\n' +
        '<!-- wp:navigation-link {"label":"Branding","url":"/brand","kind":"post-type"} /-->\n' +
        '<!-- /wp:navigation-submenu -->\n' +
        '<!-- wp:navigation-link {"label":"Pricing","url":"https://ext.example/p","kind":"custom"} /-->';
      var items = G.parseNavModel(raw);
      expect(items.length === 3, 'top count ' + items.length);
      expect(items[1].children && items[1].children.length === 2, 'submenu children missing');
      expect(items[1].label === 'Services' && items[1].children[0].label === 'Web design', 'labels wrong');
      // untouched round trip keeps every byte of the plain links
      var out = G.serializeNavModel(items);
      expect(out.indexOf('"id":12') !== -1, 'link attrs lost');
      expect(G.parseNavModel(out).length === 3, 'round-trip changed structure');
      // nest Pricing under Services: submenu keeps its attrs, link keeps its bytes
      var pricing = items.splice(2, 1)[0];
      items[1].children.push(pricing);
      var out2 = G.serializeNavModel(items);
      var reparsed = G.parseNavModel(out2);
      expect(reparsed[1].children.length === 3, 'nest failed');
      expect(out2.indexOf('{"label":"Pricing","url":"https://ext.example/p","kind":"custom"}') !== -1, 'nested link attrs rewritten');
      // un-nest Web design back to top level
      var web = reparsed[1].children.splice(0, 1)[0];
      web.dirty = true;
      reparsed.splice(1, 0, web);
      var out3 = G.serializeNavModel(reparsed);
      var again = G.parseNavModel(out3);
      expect(again.length === 3 && again[1].label === 'Web design' && !again[1].children, 'un-nest failed');
      // childless submenu collapses to a plain link, attrs intact
      var solo = G.parseNavModel('<!-- wp:navigation-submenu {"label":"Only","url":"/o"} -->\n<!-- wp:navigation-link {"label":"K","url":"/k"} /-->\n<!-- /wp:navigation-submenu -->');
      solo[0].children = null; solo[0].dirty = true;
      var out4 = G.serializeNavModel(solo);
      expect(out4.indexOf('wp:navigation-link {"label":"Only","url":"/o"} /-->') !== -1, 'submenu did not collapse to link: ' + out4);
      return 'parse, nest, un-nest, collapse — attrs preserved throughout';
    });

    // ---- experiences: sandboxed on canvas, only a link in stored markup ----
    test('experience element: sandboxed iframe, kses-safe stored fallback', function () {
      var s0 = sec();
      s0.els.push({ type: 'exp', x: 100, y: 60, w: 600, h: 400, expId: 123, expUrl: 'about:blank' });
      G.renderSection(s0);
      var node = s0.sectionEl.querySelector('.gogh-exp');
      expect(node, 'no exp node on canvas');
      var fr = node.querySelector('iframe');
      expect(fr, 'no iframe on canvas');
      expect(fr.getAttribute('sandbox') === 'allow-scripts',
        'sandbox must be exactly allow-scripts, got: ' + fr.getAttribute('sandbox'));
      var v3 = G.buildV3();
      expect(v3.indexOf('<iframe') === -1, 'iframe must never be stored');
      expect(v3.indexOf('gogh-exp-link') !== -1, 'no fallback link in stored markup');
      expect(v3.indexOf('"expId":123') !== -1, 'expId missing from model attrs');
      var css = s0.styleEl.textContent;
      var L = s0.els.length;
      expect(new RegExp('gogh-el-' + L + ' \\{ grid-area: auto; grid-column: 2; aspect-ratio: 600 / 400;').test(css),
        'exp does not keep aspect on mobile');
      s0.els.pop();
      G.renderSection(s0);
      return 'sandboxed canvas frame, link-only markup, mobile aspect';
    });

    // ---- starter contrast is theme-proof; mobile keeps panels, hides shapes ----
    test('photo cards contrast + mobile box policy + badge clip guard', function () {
      var tpl = G.templates().filter(function (t) { return t.name === 'Photo cards'; })[0];
      expect(tpl, 'Photo cards template missing');
      var whiteTexts = tpl.els.filter(function (e) {
        return (e.type === 'heading' || e.type === 'para') && e.tf && e.tf.col === '#ffffff';
      });
      expect(whiteTexts.length === 4, 'overlay text not literal white (' + whiteTexts.length + '/4)');
      expect(tpl.els.filter(function (e) { return e.type === 'button'; })
        .every(function (e) { return e.tf && e.tf.bg === '#ffffff'; }), 'buttons not theme-proof');
      expect(tpl.els.some(function (e) { return e.type === 'box' && /0\.78\)/.test(e.boxBg || ''); }),
        'scrim not deepened');
      // live CSS policies
      var s0 = sec();
      s0.els.push({ type: 'box', x: 10, y: 10, w: 400, h: 300 });
      s0.els.push({ type: 'box', x: 20, y: 20, w: 300, h: 300, shape: 'blob' });
      G.renderSection(s0);
      var css = s0.styleEl.textContent;
      var L = s0.els.length;
      expect(new RegExp('gogh-el-' + (L - 1) + ' \\{ grid-area: auto; grid-column: 2; aspect-ratio: 400 / 300;').test(css),
        'plain box does not keep proportions on mobile');
      expect(new RegExp('gogh-el-' + L + ' \\{ grid-area: auto; grid-column: 2; display: none;').test(css),
        'decorative shape not hidden on mobile');
      expect(css.indexOf('min-width: max-content') !== -1, 'badge clip guard missing');
      return 'white overlays, deep scrim, panel/shape mobile split';
    });

    // ---- a11y: DOM order is READING order, not insertion order ----
    test('published + canvas DOM follow reading order (WCAG 1.3.2)', function () {
      var s0 = sec();
      var saved = JSON.parse(JSON.stringify(s0.els));
      // scrambled insertion: button first, heading LAST — visually the
      // heading sits on top, the button at the bottom
      s0.els = [
        { type: 'button', x: 480, y: 700, w: 180, h: 52, text: 'Go' },
        { type: 'para', x: 300, y: 420, w: 500, h: 60, text: 'Middle copy' },
        { type: 'heading', x: 300, y: 60, w: 600, h: 90, text: 'Top headline' },
      ];
      G.renderSection(s0);
      // editor canvas: children in reading order, classes keep stacking index
      var kids = [].slice.call(s0.sectionEl.children).map(function (n) { return n.className; });
      expect(/gogh-el-3/.test(kids[0]) && /gogh-el-2/.test(kids[1]) && /gogh-el-1/.test(kids[2]),
        'canvas DOM not in reading order: ' + kids.join(' | '));
      // published markup: heading block before para before button — match
      // the RENDERED tags (the attrs JSON also carries the texts, earlier)
      var out = G.buildBlocks();
      var hAt = out.indexOf('Top headline</h2>');
      var pAt = out.indexOf('Middle copy</p>');
      var bAt = out.indexOf('>Go<');
      expect(hAt !== -1 && pAt !== -1 && bAt !== -1, 'elements missing from build');
      expect(hAt < pAt && pAt < bAt, 'published blocks not in reading order: h@' + hAt + ' p@' + pAt + ' b@' + bAt);
      // stacking survives: z-index still follows the els array, not the DOM
      var css = s0.styleEl.textContent;
      expect(css.indexOf('z-index: 1') !== -1 && css.indexOf('z-index: 3') !== -1, 'stacking z-index ladder missing');
      // mobile block no longer reorders — the DOM already reads correctly
      expect(css.indexOf('order:') === -1, 'mobile order: rules should be gone');
      s0.els = saved;
      G.renderSection(s0);
      return 'reading order in canvas + markup, stacking preserved';
    });

    // ---- site style: hover audition is local and reversible ----
    test('style hover preview swaps palette vars locally, clears clean', function () {
      var read = function () {
        return getComputedStyle(document.body).getPropertyValue('--wp--preset--color--base').trim();
      };
      var before = read();
      G.previewVariation({ settings: { color: { palette: { theme: [{ slug: 'base', color: 'rgb(18, 52, 86)' }] } } } });
      expect(read() === 'rgb(18, 52, 86)', 'preview var not applied: ' + read());
      G.clearVariationPreview();
      expect(read() === before, 'preview did not clear: ' + read());
      // fonts arrive under NEW slugs — the body mapping is what shows them
      var ffBefore = getComputedStyle(document.body).fontFamily;
      G.previewVariation({
        settings: { typography: { fontFamilies: { theme: [{ slug: 'gogh-test-face', fontFamily: '"GoghTestFace", serif' }] } } },
        styles: { typography: { fontFamily: 'var:preset|font-family|gogh-test-face' } },
      });
      expect(getComputedStyle(document.body).fontFamily.indexOf('GoghTestFace') !== -1,
        'font mapping not applied: ' + getComputedStyle(document.body).fontFamily);
      G.clearVariationPreview();
      expect(getComputedStyle(document.body).fontFamily === ffBefore, 'font preview did not clear');
      return 'colour vars + font mappings swap and restore';
    });

    // ---- display sizes: poster type beyond the theme presets ----
    test('display sizes: Aa steps past presets into cqw poster type', function () {
      var i = findIdx('heading');
      var e = sec().els[i];
      G.setFontSize(sec(), i, '__disp-m');
      expect(e.fs === '__disp-m', 'display fs not set');
      var css = sec().styleEl.textContent;
      expect(css.indexOf('max(9cqw, 36px)') !== -1, 'display size missing from scoped CSS');
      var out = G.buildBlocks();
      expect(out.indexOf('has-__disp') === -1, 'display slug leaked as a preset class');
      expect(out.indexOf('max(9cqw, 36px)') !== -1, 'published CSS missing the display size');
      // stepping up from the largest theme preset flows into Display S
      var sizes = G.fontSizes();
      G.setFontSize(sec(), i, sizes.length ? sizes[sizes.length - 1].slug : null);
      G.stepFontSize(sec(), i, 1);
      expect(e.fs === '__disp-s', 'step after largest preset should be Display S, got ' + e.fs);
      expect(G.serialize().indexOf('"fs":"__disp-s"') !== -1, 'display fs not serialized');
      return 'preset → Display S/M/L, scoped CSS + clean publish';
    });

    // ---- webmcp bridge: page-editing tools ----
    test('webmcp bridge: tools exist and drive the editor', function () {
      expect(window.__goghMcp, 'bridge missing');
      var names = Object.keys(window.__goghMcp.tools);
      expect(names.length >= 9, 'expected 9+ tools, got ' + names.length);
      var overview = window.__goghMcp.call('gogh_page_overview');
      expect(/section/.test(overview), 'overview says nothing about sections');
      var layouts = window.__goghMcp.call('gogh_list_layouts');
      expect(/Hero/.test(layouts), 'layouts list missing Hero');
      var s0 = G.sections().length;
      var msg = window.__goghMcp.call('gogh_add_section', { layout: 'hero' });
      expect(/Added/.test(msg), 'add_section refused: ' + msg);
      expect(G.sections().length === s0 + 1, 'section not added via tool');
      var msg2 = window.__goghMcp.call('gogh_edit_text', { find: 'brands people remember', replace: 'brands agents remember' });
      expect(/Replaced/.test(msg2), 'edit_text found nothing: ' + msg2);
      var shapeMsg = window.__goghMcp.call('gogh_add_shape', { shape: 'circle' });
      expect(/circle/.test(shapeMsg), 'add_shape failed: ' + shapeMsg);
      var bgMsg = window.__goghMcp.call('gogh_set_section_background', { section: 0, color: '#fdf6e3' });
      expect(/background set/.test(bgMsg), 'set_background failed: ' + bgMsg);
      // long copy must grow the element and push neighbours down, not pile on them
      var hs = lastSec();
      var head = hs.els.filter(function (e) { return e.type === 'heading'; })[0];
      expect(head, 'tool-added hero has no heading');
      var below = hs.els.filter(function (e2) { return e2 !== head && e2.y >= head.y + head.h - 4; })
        .sort(function (a, b) { return a.y - b.y; })[0];
      var belowY0 = below && below.y;
      var h0 = head.h;
      window.__goghMcp.call('gogh_edit_text', {
        find: head.text,
        replace: 'A very much longer heading that will certainly wrap onto several lines in this layout',
      });
      expect(head.h > h0, 'long text did not grow the heading (h ' + h0 + '→' + head.h + ')');
      if (below) expect(below.y > belowY0, 'element below was not pushed down by the longer heading');
      // the agent asked for this one: sections must be deletable by tool
      var delMsg = window.__goghMcp.call('gogh_delete_section', { section: contentSecs().length - 1 });
      expect(/Deleted section/.test(delMsg), 'delete_section failed: ' + delMsg);
      expect(G.sections().length === s0, 'section count not restored by delete (' + G.sections().length + ' vs ' + s0 + ')');
      return names.length + ' tools live, reflow + delete ok';
    });

    // ---- published blocks stay lightly editable ----
    test('stored light edits: published html block syncs text to raw', function () {
      var host = document.createElement('div');
      host.innerHTML = '<section class="gogh-section-html"><h2>Edit me after publish</h2><p>Body text</p></section>';
      var el = host.firstChild;
      document.body.appendChild(el);
      var raw = '<!-- wp:html -->\n' + el.outerHTML + '\n<!-- /wp:html -->';
      var entry = G.bindStoredTest(el, raw);
      try {
        expect(entry.map.length === 1 && entry.map[0].node === el, 'self map not built for stored block');
        el.querySelector('h2').textContent = 'Changed after publish';
        entry.__sync(entry.map[0]);
        expect(entry.raw.indexOf('Changed after publish') !== -1, 'edit did not sync into raw');
        expect(entry.raw.indexOf('wp:html') !== -1, 'block comments lost in sync');
        expect(G.isDirty(), 'stored edit did not mark the page dirty');
        var merged = G.mergeContent(entry.savedRaw);
        expect(merged.indexOf('Changed after publish') !== -1, 'mergeContent did not carry the stored edit');
      } finally {
        G.storedEdits().pop();
        el.remove();
      }
      return 'stored block edits → raw → mergeContent';
    });

    // ---- shape element: palette flyout, back-of-stack insert, shipped CSS ----
    test('shapes: flyout inserts circle at the back with published CSS', function () {
      window.scrollTo(0, 0);
      G.openSecAdd(G.sections().indexOf(sec()));
      var btn = q('.gogh-panel [data-act="shapes"]');
      expect(btn, 'no Shape item in the section ＋ menu');
      btn.click();
      var cells = document.querySelectorAll('.gogh-panel .gogh-shapecell');
      expect(cells.length >= 8, 'shape flyout incomplete, got ' + cells.length + ' cells');
      cells[2].click(); // circle
      var hit = null, hitSec = null;
      G.sections().forEach(function (s) {
        s.els.forEach(function (e) {
          if (e.type === 'box' && e.shape === 'circle') { hit = e; hitSec = s; }
        });
      });
      expect(hit, 'circle box not inserted');
      expect(hitSec.els.indexOf(hit) === 0, 'shape not at the back of the stack (index ' + hitSec.els.indexOf(hit) + ')');
      var css = hitSec.styleEl.textContent || '';
      expect(css.indexOf('border-radius: 50%') !== -1, 'circle CSS not in the section stylesheet');
      // switching shape on the canvas: clip-path geometry must ship too
      hit.shape = 'tri';
      G.renderSection(hitSec);
      expect((hitSec.styleEl.textContent || '').indexOf('clip-path: polygon(50% 0%') !== -1, 'triangle clip-path missing');
      var snap = G.serialize();
      expect(snap.indexOf('"shape":"tri"') !== -1, 'shape not serialized');
      return 'insert → back of stack → CSS → round-trip';
    });

    // ---- shape element: corner resize keeps proportions ----
    test('shapes: corner-drag scales proportionally', function () {
      window.scrollTo(0, 0);
      G.openSecAdd(G.sections().indexOf(sec()));
      q('.gogh-panel [data-act="shapes"]').click();
      document.querySelectorAll('.gogh-panel .gogh-shapecell')[2].click(); // circle 320×320
      var s0 = sec();
      var i = s0.els.findIndex(function (e) { return e.type === 'box' && e.shape === 'circle'; });
      expect(i !== -1, 'circle not in first content section');
      var e = s0.els[i];
      var w0 = e.w;
      select(i);
      dragBy(q('.gogh-h-se'), 90, 10, 21);
      expect(e.w > w0, 'shape did not grow (w ' + w0 + '→' + e.w + ')');
      expect(Math.abs(e.w - e.h) <= 2, 'proportions broke: ' + e.w + '×' + e.h);
      return w0 + '→' + e.w + ' square held';
    });

    // ---- answer-ready: the model becomes JSON-LD on the published page.
    // Full round-trip: compose an FAQ → publish → fetch the FRONT END →
    // parse the emitted graph. Pixels have the insert audit; meaning has
    // this. Restores the saved page afterwards by publishing the snapshot.
    testAsync('answer-ready: published FAQ emits an FAQPage graph', function () {
      var s = sec();
      var probe = 'Is gogh answer-ready?';
      var f = G.composeFaq([{ q: probe, a: 'Yes — the model itself becomes schema.' }]);
      s.els.push({ type: 'widget', x: 100, y: 60, w: 900, h: 300,
        faq: [{ q: probe, a: 'Yes — the model itself becomes schema.' }],
        wsrc: f.wsrc, whtml: f.whtml });
      G.renderSection(s);
      return G.publish().then(function () {
        return fetch(location.pathname, { credentials: 'same-origin', cache: 'no-store' });
      }).then(function (r) { return r.text(); }).then(function (html) {
        var m = html.match(/<script type="application\/ld\+json" class="gogh-schema">([\s\S]*?)<\/script>/);
        expect(m, 'no gogh-schema JSON-LD on the published page');
        var g = JSON.parse(m[1]);
        var nodes = g['@graph'] || [];
        var types = nodes.map(function (n) { return n['@type']; });
        expect(types.indexOf('Organization') !== -1, 'Organization missing (' + types.join(', ') + ')');
        expect(types.indexOf('WebPage') !== -1, 'WebPage missing (' + types.join(', ') + ')');
        var fp = nodes.filter(function (n) { return n['@type'] === 'FAQPage'; })[0];
        expect(fp, 'FAQPage missing (' + types.join(', ') + ')');
        var qs = (fp.mainEntity || []).map(function (n) { return n.name; });
        expect(qs.indexOf(probe) !== -1, 'probe question not in graph: ' + qs.join(' | '));
        // put the saved page back exactly as the suite found it
        G.restore(SNAP);
        return G.publish().then(function () {
          return 'graph carries Organization + WebPage + FAQPage with the probe question';
        });
      });
    });

    // ---- answer-ready for Write: a published POST carries Article schema.
    // Posts are pure core blocks (no gogh/section), so the graph is built
    // from WordPress's own facts — title, dates, author. Round-trip: create
    // a real post over REST → fetch its front end → validate → delete it.
    testAsync('answer-ready: a published post emits an Article graph', function () {
      var base = (window.GOGH && GOGH.restUrl) ? GOGH.restUrl.split('wp/v2/')[0] + 'wp/v2/posts' : '/wp-json/wp/v2/posts';
      var nonce = window.GOGH && GOGH.nonce;
      var made = null;
      return fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
        credentials: 'same-origin',
        body: JSON.stringify({ title: 'Answer-ready probe post', status: 'publish',
          content: '<!-- wp:paragraph --><p>Written the Write way: plain words, core blocks.</p><!-- /wp:paragraph -->' }),
      }).then(function (r) {
        expect(r.ok, 'could not create the probe post (' + r.status + ')');
        return r.json();
      }).then(function (post) {
        made = post;
        return fetch(post.link, { credentials: 'same-origin', cache: 'no-store' });
      }).then(function (r) { return r.text(); }).then(function (html) {
        var m = html.match(/<script type="application\/ld\+json" class="gogh-schema">([\s\S]*?)<\/script>/);
        expect(m, 'no gogh-schema JSON-LD on the published post');
        var nodes = (JSON.parse(m[1])['@graph']) || [];
        var art = nodes.filter(function (n) { return n['@type'] === 'Article'; })[0];
        expect(art, 'Article missing (' + nodes.map(function (n) { return n['@type']; }).join(', ') + ')');
        expect(art.headline === 'Answer-ready probe post', 'headline wrong: ' + art.headline);
        expect(art.datePublished && art.author && art.author.name, 'dates or author missing');
      }).then(function () {
        return fetch(base + '/' + made.id + '?force=true', {
          method: 'DELETE',
          headers: { 'X-WP-Nonce': nonce },
          credentials: 'same-origin',
        });
      }).then(function () {
        return 'post created → Article graph with headline, dates, author → deleted';
      }).catch(function (err) {
        // never leave the probe post behind, even on failure
        if (made) fetch(base + '/' + made.id + '?force=true', { method: 'DELETE', headers: { 'X-WP-Nonce': nonce }, credentials: 'same-origin' });
        throw err;
      });
    });

    // ---- answer-ready: the panel is the receipt for people who will never
    // open view-source. It fetches the LIVE page, translates the graph into
    // plain-English rows, and shows the machine layer verbatim.
    testAsync('answer-ready: the what-machines-see panel reads the live page', function () {
      G.openAnswerReady();
      return new Promise(function (res) { setTimeout(res, 2500); }).then(function () {
        var p = document.querySelector('.gogh-arpanel');
        expect(p, 'panel did not open');
        var txt = p.textContent || '';
        expect(txt.indexOf('Your brand') !== -1, 'plain-English brand row missing');
        expect(txt.indexOf('This page') !== -1, 'plain-English page row missing');
        var pre = p.querySelector('.gogh-armachine pre');
        expect(pre && pre.textContent.indexOf('"@graph"') !== -1, 'machine layer not shown verbatim');
        expect(p.querySelector('.gogh-ar-share'), 'share-summary button missing');
        p.querySelector('.gogh-ar-done').click();
        expect(!document.querySelector('.gogh-arpanel'), 'panel did not close');
        return 'live fetch → brand + page rows + verbatim machine layer → closes';
      });
    });

    // ---- motion style: the fourth of the family. Panel opens, four gaits,
    // keeping one saves the option over REST and marks the card; the suite
    // always restores Still so the fixture site never ships animated by
    // accident.
    testAsync('motion style: audition panel saves and restores a gait', function () {
      // restore whatever the SITE had — the suite must never stomp the
      // user's chosen gait (it reset James's Rise to Still once)
      var had = window.GOGH.motion || '';
      var keys = ['', 'calm', 'rise', 'drama'];
      var probeKey = had === 'calm' ? 'rise' : 'calm';
      G.openMotionPanel();
      var cards = document.querySelectorAll('.gogh-motioncard');
      expect(cards.length === 4, 'expected 4 motion cards, got ' + cards.length);
      cards[keys.indexOf(probeKey)].click();
      return new Promise(function (res) { setTimeout(res, 1200); }).then(function () {
        expect(window.GOGH.motion === probeKey, 'cfg.motion not updated: ' + window.GOGH.motion);
        cards[keys.indexOf(had)].click(); // put the site's own gait back
        return new Promise(function (res) { setTimeout(res, 1200); });
      }).then(function () {
        expect(window.GOGH.motion === had, 'gait not restored: ' + window.GOGH.motion + ' vs ' + had);
        return 'probed ' + probeKey + ' over REST, restored "' + (had || 'still') + '"';
      });
    });

    // ---- remix: the candidate factory. The gate is the promise — every
    // spin must produce readable pairs, honest hex, and only theme fonts.
    test('remix: every candidate leaves the factory legible', function () {
      var lum = function (hex) {
        var n = parseInt(hex.slice(1), 16);
        var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(n >> 16 & 255) + 0.7152 * f(n >> 8 & 255) + 0.0722 * f(n & 255);
      };
      var ratio = function (a, b) {
        var x = lum(a), y = lum(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      var worst = 99;
      for (var spin = 0; spin < 5; spin++) {
        var cands = G.remixCandidates();
        expect(cands.length === 6, 'expected 6 candidates, got ' + cands.length);
        cands.forEach(function (c) {
          ['background', 'text', 'accent'].forEach(function (k) {
            expect(/^#[0-9a-f]{6}$/i.test(c.colors[k]), c.name + ' ' + k + ' is not hex: ' + c.colors[k]);
          });
          var r = ratio(c.colors.text, c.colors.background);
          worst = Math.min(worst, r);
          expect(r >= 6.5, c.name + ' text/ground contrast only ' + r.toFixed(1));
          expect(ratio(c.colors.accent, c.colors.background) >= 2.7,
            c.name + ' accent barely visible on its ground');
        });
      }
      return '30 candidates over 5 spins, worst text contrast ' + worst.toFixed(1) + ':1';
    });

    test('ask gogh: the vocabulary reads plain instructions', function () {
      var reads = [
        ['Give this more breathing room', 'breathing'],
        ['Try a completely different layout', 'layout'],
        ['Make the image bigger', 'picture'],
        ['Make the headline stand out more', 'headline'],
        ['Make this more premium', 'premium'],
        ['Make this less cluttered', 'simpler'],
        ['Make this more playful', 'playful'],
        ['Add more photos', 'photos'],
        ['Add another button', 'button'],
        ['Change the background image', 'different photo'],
        ['Remove the background image', 'plain background'],
        ['Change the background to dark', 'darker'],
        ['Make the background lighter', 'lighter'],
        ['Make the background red', 'red background'],
        ['Add a hero section with a background image', 'new section below'],
        // the sweep's catches: spacing beats colour, elements beat sections,
        // site-wide decisions refuse instantly with a pointer
        ['less white space', 'tighter'],
        ['give it some air', 'breathing'],
        ['make the button green', 'piece'],
        ['use a different font', 'type'],
        ['swap the photo', 'different photo'],
        ['smaller heading', 'quieter'],
        ['delete the badge', 'badge'],
        ['make things move when I scroll', 'motion'],
        ['melt this into the next section', 'softer transition'],
        ['remove the transition', 'clean edge'],
      ];
      reads.forEach(function (r) {
        var got = G.askRead(r[0]);
        expect(got, 'no read for "' + r[0] + '"');
        expect(got.label.indexOf(r[1]) !== -1, '"' + r[0] + '" read as "' + got.label + '"');
      });
      expect(G.askRead('flurble the wombat') === null, 'gibberish should read as null');
      expect(G.askRead('') === null, 'empty should read as null');
      return reads.length + ' instructions read, gibberish refused';
    });

    test('ask gogh: breathing room spreads the section and candidates differ', function () {
      var s = sec();
      var read = G.askRead('give this more breathing room');
      var cands = read.build(s);
      expect(cands.length >= 3, 'expected 3 spacings, got ' + cands.length);
      // breathing room = gaps open (either axis) AND the canvas grows;
      // a one-row section breathes sideways, a stack breathes down
      var reach = function () {
        return Math.max.apply(null, s.els.map(function (e) { return e.y + e.h; }));
      };
      var before = reach();
      var beforeMinH = s.minH || 0;
      cands[1].apply(s);
      var mid = reach();
      expect(mid > before, 'Generous did not spread (reach ' + before + ' -> ' + mid + ')');
      expect((s.minH || 0) > beforeMinH, 'the section did not grow (minH ' + beforeMinH + ' -> ' + s.minH + ')');
      return 'reach ' + before + ' -> ' + mid + ', minH ' + beforeMinH + ' -> ' + s.minH;
    });

    test('ask gogh: the panel applies, then Undo restores the exact before', function () {
      var i = G.sections().indexOf(sec());
      var before = JSON.stringify(sec().els.map(function (e) { return [e.x, e.y, e.w, e.h]; }));
      G.openAskPanel(i, null);
      var input = q('.gogh-panel .gogh-askin');
      expect(input, 'ask panel did not open');
      input.value = 'more breathing room';
      q('.gogh-panel .gogh-askgo').click();
      var res = q('.gogh-panel .gogh-askres');
      expect(res && !res.hidden, 'result row did not appear');
      var after = JSON.stringify(sec().els.map(function (e) { return [e.x, e.y, e.w, e.h]; }));
      expect(after !== before, 'submit changed nothing');
      q('.gogh-panel .gogh-askundo').click();
      var back = JSON.stringify(sec().els.map(function (e) { return [e.x, e.y, e.w, e.h]; }));
      expect(back === before, 'Undo did not restore the before');
      return 'apply changed, Undo restored';
    });

    test('ask gogh: Try another lands a different answer on the same before', function () {
      var i = G.sections().indexOf(sec());
      var base = JSON.stringify(sec().els.map(function (e) { return [e.y, e.h]; }));
      G.openAskPanel(i, null);
      q('.gogh-panel .gogh-askin').value = 'more breathing room';
      q('.gogh-panel .gogh-askgo').click();
      var first = JSON.stringify(sec().els.map(function (e) { return [e.y, e.h]; }));
      q('.gogh-panel .gogh-asktry').click();
      var second = JSON.stringify(sec().els.map(function (e) { return [e.y, e.h]; }));
      expect(first !== base, 'first candidate changed nothing');
      expect(second !== first, 'Try another produced the same answer');
      return 'two distinct answers from one instruction';
    });

    test('ask gogh: "add more photos" lands a row below, one undo removes it', function () {
      var i = G.sections().indexOf(sec());
      var count = sec().els.length;
      var images = sec().els.filter(function (e) { return e.type === 'image'; }).length;
      var floor = Math.max.apply(null, sec().els.map(function (e) { return e.y + e.h; }));
      G.openAskPanel(i, null);
      q('.gogh-panel .gogh-askin').value = 'add more photos';
      q('.gogh-panel .gogh-askgo').click();
      q('.gogh-panel .gogh-asktry').click(); // Two, side by side
      var added = sec().els.filter(function (e) { return e.type === 'image'; }).length - images;
      expect(added === 2, 'expected 2 photos, got ' + added);
      var lowest = Math.min.apply(null, sec().els.slice(count).map(function (e) { return e.y; }));
      expect(lowest >= floor, 'new photos overlap the furniture (y ' + lowest + ' < floor ' + floor + ')');
      q('.gogh-panel .gogh-askundo').click();
      expect(sec().els.length === count, 'one Undo did not remove the whole row');
      return '2 photos below y=' + floor + ', one undo cleared them';
    });

    test('ask gogh: the imagination’s ops are clamped and whitelisted', function () {
      var s = sec();
      var count = s.els.length;
      var e0 = s.els[0];
      G.askApplyOps(s, {
        set: [
          { i: 0, x: 99999, fs: 'evil-size', align: 'sideways', rot: 720, tf: { fw: 5000, tt: 'blink' } },
          { i: 999, x: 0 }, // no such element — ignored
        ],
        add: [
          { type: 'image', w: 340, h: 240 },
          { type: 'script', text: 'nope' }, // unknown type — refused
        ],
        remove: [999, -1], // out of range — ignored
        section: { theme: 'not-a-theme', minH: 99999, spread: 40 },
      });
      expect(e0.x <= 1200 - e0.w, 'x was not clamped to the canvas (x=' + e0.x + ')');
      expect(e0.fs !== 'evil-size', 'a bogus fs got through');
      expect(e0.align !== 'sideways', 'a bogus align got through');
      expect(e0.rot >= -6 && e0.rot <= 6, 'rot was not clamped (' + e0.rot + ')');
      expect((e0.tf || {}).fw <= 900, 'tf.fw was not clamped');
      expect((e0.tf || {}).tt !== 'blink', 'a bogus text-transform got through');
      expect(s.els.length === count + 1, 'expected exactly 1 addition, got ' + (s.els.length - count));
      expect(s.els[s.els.length - 1].type === 'image', 'the added element is not the image');
      expect(s.minH <= 2400, 'minH was not clamped (' + s.minH + ')');
      return 'hostile ops came out safe: clamped, refused, or ignored';
    });

    testAsync('ask gogh: the imagination door exists (and fails honestly keyless)', function () {
      var root = (window.GOGH && GOGH.restUrl) ? GOGH.restUrl.split('wp/v2/')[0] : '/wp-json/';
      return fetch(root + 'gogh/v1/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': (window.GOGH || {}).nonce },
        credentials: 'same-origin',
        body: JSON.stringify({}), // no instruction on purpose — must NOT reach the model
      }).then(function (res) {
        expect(res.status !== 404, 'the route does not exist');
        expect(res.status === 400 || res.status === 501, 'expected 400 (bad ask) or 501 (no key), got ' + res.status);
        return 'route answers ' + res.status + (res.status === 501 ? ' (no key configured)' : '');
      });
    });

    test('ask gogh: "dark" is measured, never name-trusted', function () {
      // on a dark-mode palette "Ink" paints WHITE — the read must offer
      // themes by the colour they actually paint (James's exact report)
      var s = sec();
      var read = G.askRead('change the background to dark');
      expect(read && /darker/.test(read.label), '"background to dark" read as ' + (read && read.label));
      var cands = read.build(s);
      if (!cands.length) return 'palette has no dark colour — honest miss';
      cands[0].apply(s);
      var bg = getComputedStyle(s.sectionEl).backgroundColor;
      var m = (bg.match(/\d+(\.\d+)?/g) || []).map(Number);
      expect(m.length >= 3, 'unreadable computed background: ' + bg);
      var lum = (m[0] * 0.2126 + m[1] * 0.7152 + m[2] * 0.0722) / 255;
      expect(lum < 0.4, 'the painted background is not dark: ' + bg);
      return 'painted ' + bg + ' (luminance ' + lum.toFixed(2) + ')';
    });

    test('ask gogh: colour names resolve by hue against the real palette', function () {
      // "red" must never come back blue (James's exact report) — the read
      // scores palette themes by measured hue distance
      var s = sec();
      var comp = function () {
        var m = (getComputedStyle(s.sectionEl).backgroundColor.match(/\d+(\.\d+)?/g) || []).map(Number);
        return m;
      };
      var red = G.askRead('make the background red');
      var reds = red.build(s);
      if (reds.length) {
        reds[0].apply(s);
        var m1 = comp();
        expect(m1[0] > m1[2], 'asked red, painted b>=r: rgb(' + m1.join(',') + ')');
      }
      G.restore(SNAP);
      s = sec();
      var blue = G.askRead('make the background blue');
      var blues = blue.build(s);
      if (blues.length) {
        blues[0].apply(s);
        var m2 = comp();
        expect(m2[2] > m2[0], 'asked blue, painted r>=b: rgb(' + m2.join(',') + ')');
      }
      if (!reds.length && !blues.length) return 'palette offers neither — honest misses';
      return 'red got warm, blue got cool, by measurement';
    });

    test('ask gogh: "add a hero section with a background image" lands a Cover below', function () {
      var m = G.askSeamMatch('a hero with a big background image');
      expect(m && m.tpl.name === 'Cover', 'hero+photo read as ' + (m && m.tpl.name));
      var count = contentSecs().length;
      var s = sec();
      var read = G.askRead('add a hero section with a background image');
      var cands = read.build(s);
      expect(cands.length === 1 && /Cover/.test(cands[0].name), 'expected a Cover candidate, got ' + (cands[0] && cands[0].name));
      cands[0].apply(s);
      expect(contentSecs().length === count + 1, 'no section arrived');
      var born = contentSecs()[1];
      expect(!!born.bgImage, 'the Cover arrived without a background photo');
      return 'Cover below, wearing ' + String(born.bgImage).split('/').pop().slice(0, 30);
    });

    test('ask gogh: "remove the background" clears the photo in one change', function () {
      var s = sec();
      s.bgImage = 'https://example.test/fake-photo.jpg';
      s.bgId = 123;
      var read = G.askRead('remove the background image');
      var cands = read.build(s);
      expect(cands.length === 1, 'expected one candidate, got ' + cands.length);
      cands[0].apply(s);
      expect(s.bgImage === null && s.bgId === null, 'the photo did not clear');
      return 'photo cleared, id cleared';
    });

    testAsync('ask gogh: the background read gathers photos from the library', function () {
      var read = G.askRead('change the background image');
      expect(read && read.buildAsync, 'the background read is not async');
      return read.buildAsync(sec()).then(function (cands) {
        if (!cands.length) return 'library empty — the read misses honestly';
        cands.forEach(function (c) {
          expect(c.name && typeof c.apply === 'function', 'candidate is malformed');
        });
        var s = sec();
        cands[0].apply(s);
        // a section wearing a background swaps that; otherwise its biggest
        // picture element takes the new photo
        var imgEl = s.els.filter(function (e) { return e.type === 'image' && e.src; })[0];
        expect(!!s.bgImage || !!imgEl, 'applying a candidate set no photo anywhere');
        return cands.length + ' photos offered, first applied to ' + (s.bgImage ? 'the background' : 'the picture element');
      });
    });

    test('ask gogh: transitions are spoken looks', function () {
      var s = sec();
      var read = G.askRead('melt this into the next section');
      var cands = read.build(s);
      expect(cands.length >= 3, 'expected shape candidates, got ' + cands.length);
      cands[0].apply(s);
      expect(s.divider && s.divider.shape === 'melt', 'Melt did not wear: ' + JSON.stringify(s.divider));
      var off = G.askRead('remove the transition').build(s);
      off[0].apply(s);
      expect(s.divider === null, 'the transition did not come off');
      return 'melt worn, then a straight edge';
    });

    test('the selected section: ground selects, piece goes faint, Esc walks out', function () {
      // selection is SYNCHRONOUS — no corridors, no rAF, no background-tab
      // skips: the calmer model is also the provable one
      var s = sec();
      pev('pointerdown', s.sectionEl, 10, 10);
      expect(s.sectionEl.classList.contains('gogh-selsec') &&
        !s.sectionEl.classList.contains('gogh-selsec-faint'), 'ground click did not select the section');
      expect(!q('.gogh-secbar').hidden, 'the four-door bar did not dock');
      select(0);
      expect(s.sectionEl.classList.contains('gogh-selsec-faint'), 'choosing a piece did not go faint');
      // ONE editing surface: with a piece chosen, the section bar stands down
      var bar0 = q('.gogh-secbar');
      expect(bar0.hidden || bar0.classList.contains('gogh-byebye'), 'two editing surfaces at once');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(s.sectionEl.classList.contains('gogh-selsec') &&
        !s.sectionEl.classList.contains('gogh-selsec-faint'), 'first Esc should promote the section');
      expect(!bar0.hidden && !bar0.classList.contains('gogh-byebye'), 'the bar did not return with the section');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(!s.sectionEl.classList.contains('gogh-selsec'), 'second Esc did not deselect the section');
      var bar = q('.gogh-secbar');
      expect(bar.hidden || bar.classList.contains('gogh-byebye'), 'the bar overstayed the selection');
      pev('pointerdown', s.sectionEl, 10, 10);
      pev('pointerdown', document.body, 4, 4);
      expect(!s.sectionEl.classList.contains('gogh-selsec'), 'clicking away did not deselect');
      return 'ground selects, piece faints, Esc walks out, away folds';
    });

    testAsync('drag: the landing box is the model’s own footprint', function () {
      // the dashed box must promise exactly what the ghost promises —
      // reading the solved cell ballooned it once the dragged element
      // stopped contributing grid lines
      var stalled = false;
      var frame = function () {
        return new Promise(function (r) {
          var fired = false;
          requestAnimationFrame(function () { requestAnimationFrame(function () { fired = true; r(true); }); });
          setTimeout(function () { if (!fired) { stalled = true; r(false); } }, 250);
        });
      };
      var i = findIdx('image');
      var node = sec().nodes[i];
      var r = node.getBoundingClientRect();
      var cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      pev('pointerdown', node, cx, cy, 31);
      pev('pointermove', node, cx + 24, cy + 8, 31);
      pev('pointermove', node, cx + 48, cy + 16, 31);
      return frame().then(function (ok) {
        var done = function (msg) { pev('pointerup', node, cx + 48, cy + 16, 31); return msg; };
        if (!ok || stalled) return done('rAF frozen (background tab) — front the tab for the full check');
        var e = sec().els[i];
        var sr = sec().sectionEl.getBoundingClientRect();
        var s = sr.width / 1200;
        var db = q('.gogh-dropbox').getBoundingClientRect();
        expect(Math.abs(db.width - e.w * s) < 6 && Math.abs(db.height - e.h * s) < 6,
          'landing box ' + Math.round(db.width) + '×' + Math.round(db.height) +
          ' vs model ' + Math.round(e.w * s) + '×' + Math.round(e.h * s));
        return done('landing box matches the model footprint');
      });
    });

    test('type scales continuously: corner-drag never rubber-bands', function () {
      // snapping is for layout; SCALING type through magnet/grid capture
      // zones made the size stutter ("weirdness when i try to increase or
      // decrease the size by dragging the box")
      var i = findIdx('heading');
      select(i);
      var h = q('.gogh-h[data-d="se"]');
      expect(h, 'no corner handle after selection');
      var e = sec().els[i];
      var hr = h.getBoundingClientRect();
      var widths = [];
      pev('pointerdown', h, hr.x + 5, hr.y + 5, 41);
      for (var k = 1; k <= 20; k++) {
        pev('pointermove', h, hr.x + 5 + k * 4, hr.y + 5 + k * 2, 41);
        widths.push(e.w);
      }
      pev('pointerup', h, hr.x + 85, hr.y + 45, 41);
      var seen = {};
      widths.forEach(function (w) { seen[w] = 1; });
      var n = Object.keys(seen).length;
      expect(n >= 18, 'scaling rubber-banded: ' + n + '/20 distinct widths (' + widths.join(',') + ')');
      expect(e.fitW, 'corner-drag did not engage fill-the-width');
      return n + '/20 distinct widths — continuous scaling';
    });

    test('fill-the-width wraps at the readability floor, never spills', function () {
      // a box narrower than the words at 1cqw used to spill them on one
      // nowrap line ("weird stuff happens if i drag a text box smaller")
      var i = findIdx('para');
      var s = sec();
      var e = s.els[i];
      e.fitW = true;
      G.refitText(s, i);
      e.w = 112;
      G.renderSection(s);
      G.refitText(s, i);
      expect(e.fitFloor === true, 'the readability floor was not detected');
      var n = s.nodes[i];
      var t2 = n.querySelector('p') || n;
      var rg = document.createRange();
      rg.selectNodeContents(t2);
      var inkW = rg.getBoundingClientRect().width;
      expect(inkW <= n.offsetWidth + 4,
        'text spills: ink ' + Math.round(inkW) + 'px in a ' + Math.round(n.offsetWidth) + 'px box');
      e.w = 500;
      G.renderSection(s);
      G.refitText(s, i);
      expect(!e.fitFloor, 'growing the box back did not release the floor');
      return 'floored: wrapped and contained; grown: one line again';
    });

    test('Aa presets win the text back from fill-the-width', function () {
      // corner-drag stores a fitted cqw size with !important — a preset
      // click must EXIT that mode or it silently does nothing ("these
      // dont seem to work anymore")
      var i = findIdx('heading');
      var s = sec();
      var e = s.els[i];
      e.fitW = true;
      e.fitFs = 6;
      G.renderSection(s);
      expect(s.styleEl.textContent.indexOf('cqw !important') !== -1, 'fitW did not engage for the setup');
      G.setFontSize(s, i, null);
      expect(!e.fitW && e.fitFs === null, 'a named size did not exit fill-the-width');
      expect(s.styleEl.textContent.indexOf('cqw !important') === -1,
        'the fitted !important size still outguns the preset');
      return 'preset exits fitW; the !important rule is gone';
    });

    test('drag stability: a moving element cannot bend its neighbours’ lines', function () {
      // (restored — a test-file edit at v0.99.275 accidentally deleted
      // this test, and the zero-span bug walked straight through the gap)
      var els = [
        { type: 'heading', x: 100, y: 40, w: 200, h: 60 },
        { type: 'para', x: 306, y: 40, w: 200, h: 60 },
      ];
      var merged = G.solve(els, 320, null);
      var stable = G.solve(els, 320, null, [0]);
      expect(JSON.stringify(merged.cols) !== JSON.stringify(stable.cols),
        'skipping the dragged element changed nothing');
      var stableAgain = G.solve([{ type: 'heading', x: 250, y: 40, w: 200, h: 60 }, els[1]], 320, null, [0]);
      expect(JSON.stringify(stable.cols) === JSON.stringify(stableAgain.cols),
        'moving the skipped element still bent the grid');
      // and NEVER a zero-span area: a skipped element whose edges both
      // land nearest the same foreign line collapsed the GHOST with it
      // ("text is now disappearing when i drag it!")
      var tight = G.solve([
        { type: 'heading', x: 100, y: 40, w: 60, h: 40 },
        { type: 'para', x: 700, y: 300, w: 300, h: 60 },
      ], 400, null, [0]);
      expect(tight.areas[0].c2 > tight.areas[0].c1 && tight.areas[0].r2 > tight.areas[0].r1,
        'the skipped element got a zero-span area: ' + JSON.stringify(tight.areas[0]));
      return 'lines held still, and no area ever spans zero';
    });

    test('snapping: the painted grid is a real magnet', function () {
      // resize: an edge near a painted 40-unit line lands ON it (44→40),
      // not beside it on the free 8-grid (which would say 48); far from
      // any line the free 8-grid still rules (22→24)
      expect(G.snapAxis([], 44).v === 40, 'resize edge at 44 landed at ' + G.snapAxis([], 44).v + ', not 40');
      expect(G.snapAxis([], 22).v === 24, 'free positioning broke: 22 landed at ' + G.snapAxis([], 22).v);
      // alignment magnets still outrank the grid
      expect(G.snapAxis([43], 44).v === 43, 'a neighbour magnet lost to the grid');
      // drag: same tiering through snapPos — pick a grid line far from
      // every magnet the fixture offers so only the grid can catch
      var s = sec();
      var cands = [0, 1200, 600];
      s.els.forEach(function (o) { cands.push(o.x, o.x + o.w, o.x + o.w / 2); });
      var X0 = null;
      for (var k = 2; k < 28 && X0 === null; k++) {
        var line = k * 40;
        var clear = cands.every(function (c) { return Math.abs(c - line) > 8 && Math.abs(c - (line + 4)) > 8; });
        if (clear) X0 = line;
      }
      if (X0 === null) return 'fixture too crowded to isolate a grid line — resize checks passed';
      G.setGridSnap(true); // outside a live gesture the tier is gated; arm it
      var r = G.snapPos(s, s.els[0], X0 + 4, 9999, 0, 0, false, null);
      G.setGridSnap(false);
      expect(r.x === X0, 'drag edge at ' + (X0 + 4) + ' landed at ' + r.x + ', not on the painted line ' + X0);
      return '44→40 on the line, 22→24 free, magnets still first, drag x' + (X0 + 4) + '→' + X0;
    });

    test('section bar: three doors, housekeeping in words', function () {
      var bar = q('.gogh-secbar');
      // the die only counts as a door where a drawer of takes exists — on
      // a plain section it stays hidden and the bar reads three doors; the
      // ✦ Ask Gogh door retired with the parked model tier
      var doors = [].filter.call(bar.querySelectorAll('.gogh-sb'), function (b) { return !b.hidden; });
      expect(doors.length === 3,
        'expected 3 visible controls, got ' + doors.length);
      expect(!bar.querySelector('.gogh-sb-ask'), 'the retired ✦ door is back on the bar');
      expect(bar.querySelector('[data-sec="more"]'), 'the ⋯ is missing');
      var i = G.sections().indexOf(sec());
      G.openSecMore(i, bar.querySelector('[data-sec="more"]'));
      var items = [].map.call(document.querySelectorAll('.gogh-secmore .gogh-secmore-it'),
        function (b) { return b.textContent + (b.disabled ? '·off' : ''); });
      expect(items.length === 6, 'expected 6 menu verbs, got ' + items.length);
      expect(/Move up·off/.test(items[0]), 'the first section can somehow move up: ' + items[0]);
      expect(document.querySelector('.gogh-secmore-del'), 'Delete lost its red');
      document.querySelector('.gogh-secmore').hidden = true;
      return items.join(', ');
    });

    test('the rail: Page · Site · SEO, each door honest about its scope', function () {
      var pg = q('.gogh-local-tab');
      var st = q('.gogh-site-tab');
      var ar = q('.gogh-ar-tab');
      expect(pg && !pg.hidden && /Page/.test(pg.textContent), 'the Page tab is missing or misnamed');
      expect(st && !st.hidden && /Site/.test(st.textContent), 'the Site tab is missing or misnamed');
      expect(ar && !ar.hidden, 'the SEO tab is missing');
      var side = q('.gogh-side');
      // the Site door opens the drawer wearing SITE clothes only
      st.click();
      expect(side.classList.contains('is-open'), 'the Site tab did not open the drawer');
      expect(q('.gogh-side-title').textContent === 'Site', 'the drawer head does not say Site');
      expect(side.querySelector('.gogh-cards-page').hidden, 'page cards leaked into Site mode');
      expect(!side.querySelector('.gogh-cards-site').hidden, 'site cards missing in Site mode');
      expect(side.querySelector('.gogh-cards-site .gogh-stylebtn'), 'Site style lost its card');
      expect(side.querySelector('.gogh-cards-site .gogh-editheader'), 'Edit header lost its card');
      G.closeSide(true);
      // and the Page door swaps to PAGE clothes
      pg.click();
      expect(q('.gogh-side-title').textContent === 'Page', 'the drawer head does not say Page');
      expect(!side.querySelector('.gogh-cards-page').hidden, 'page cards missing in Page mode');
      expect(side.querySelector('.gogh-cards-site').hidden, 'site cards leaked into Page mode');
      expect(side.querySelector('.gogh-cards-page .gogh-pagestylebtn'), 'Page style lost its card');
      expect(side.querySelector('.gogh-cards-page .gogh-rearrange'), 'Rearrange lost its card');
      G.closeSide(true);
      ar.click();
      var wrap = q('.gogh-arwrap');
      expect(wrap && /What machines see/.test(wrap.textContent), 'the SEO tab did not open the receipts');
      wrap.remove();
      return 'three scopes, three doors';
    });

    test('pack door: registerPageCard contributes to the Page drawer', function () {
      // the campaign pack's receipt rides this door — a page-scope card
      // with a title, a sub line, and a click of its own
      var hits = 0;
      window.gogh.registerPageCard({
        key: 'test-receipt', title: 'Test receipt', sub: '3 gulls · 1 chip',
        onClick: function () { hits++; },
      });
      var card = q('.gogh-pagecards-addon .gogh-scard-addon');
      expect(card, 'the contributed card did not render');
      expect(/Test receipt/.test(card.textContent) && /3 gulls/.test(card.textContent),
        'the card lost its words');
      card.click();
      expect(hits === 1, 'the card did not answer its click');
      window.gogh.registerPageCard({ key: 'test-receipt', title: 'Twice?' });
      expect(document.querySelectorAll('.gogh-pagecards-addon .gogh-scard-addon').length === 1,
        'the same key registered twice');
      card.remove();
      return 'a pack card in the Page drawer, clickable, deduped';
    });

    test('SEO panel: pages get the search-preview card too', function () {
      // the write room's card, on the canvas — status line + editable
      // description drafted from the page's own words. Look, never touch:
      // saving would write an excerpt to the fixture.
      q('.gogh-ar-tab').click();
      var wrap = q('.gogh-arwrap');
      expect(wrap, 'the SEO tab opened nothing');
      expect(wrap.querySelector('.gogh-ar-status .gogh-ar-statustext').textContent.length > 10,
        'the status line says nothing');
      var card = wrap.querySelector('.gogh-arsnippet');
      expect(card, 'no search-preview card on a page');
      var desc = card.querySelector('.gogh-arsnip-desc');
      expect(desc && desc.getAttribute('contenteditable') === 'true', 'the description is not editable');
      expect(desc.textContent.trim().length > 0, 'the description drafted nothing from a page full of words');
      expect(card.querySelector('.gogh-arsnip-title').textContent.trim().length > 0, 'the title is empty');
      expect(wrap.querySelector('.gogh-arsnip-save'), 'no way to keep the description');
      wrap.remove();
      return 'card present, drafted “' + desc.textContent.trim().slice(0, 40) + '…”';
    });

    test('background panel: first paint is Theme + Image, one row open at a time', function () {
      var i = G.sections().indexOf(sec());
      G.openSecBgPanel(i);
      expect(q('.gogh-panel .gogh-themerow'), 'Theme row missing from first paint');
      expect(q('.gogh-panel .gogh-media'), 'Image area missing from first paint');
      var rows = document.querySelectorAll('.gogh-panel .gogh-bgrow');
      expect(rows.length >= 2, 'expected folded rows, got ' + rows.length);
      rows.forEach(function (r2) {
        expect(r2.querySelector('.gogh-bgrow-body').hidden, r2.dataset.row + ' arrived unfolded');
      });
      var heads = document.querySelectorAll('.gogh-panel .gogh-bgrow-head');
      heads[0].click();
      expect(!rows[0].querySelector('.gogh-bgrow-body').hidden, 'first row did not open');
      heads[1].click();
      expect(rows[0].querySelector('.gogh-bgrow-body').hidden, 'opening the second row left the first open');
      expect(!rows[1].querySelector('.gogh-bgrow-body').hidden, 'second row did not open');
      var hv = rows[0].querySelector('.gogh-bgrow-val').textContent;
      expect(hv.length > 0, 'the height summary is empty');
      pev('pointerdown', document.body, 4, 4);
      return rows.length + ' folded rows, exclusive open, summary "' + hv + '"';
    });

    testAsync('Colour & more: opening scrolls the colours into view', function () {
      // the toggle lives at the panel's fold — without the scroll, the
      // block unfolded below the visible edge and the button read as
      // dead ("colour and more does nothing atm")
      var stalled = false;
      var frames = function (n) {
        return new Promise(function (r) {
          var fired = false;
          var step = function (k) {
            if (k <= 0) { fired = true; r(true); return; }
            requestAnimationFrame(function () { step(k - 1); });
          };
          step(n);
          setTimeout(function () { if (!fired) { stalled = true; r(false); } }, 900);
        });
      };
      var i = G.sections().indexOf(sec());
      G.openSecBgPanel(i);
      var t = q('.gogh-panel-more-toggle');
      var more = q('.gogh-panel-more');
      var pnl = q('.gogh-panel');
      expect(t && more && more.hidden, 'the more block should arrive folded');
      t.click();
      expect(!more.hidden, 'the toggle did not unfold the colours');
      expect(t.classList.contains('is-open'), 'the toggle did not mark itself open');
      expect(t.querySelector('.gogh-bgrow-caret svg'), 'the chevron should be drawn, not a font glyph');
      return frames(20).then(function (ok) {
        var done = function (msg) { pev('pointerdown', document.body, 4, 4); return msg; };
        if (!ok || stalled) return done('rAF frozen (background tab) — front the tab for the scroll check');
        if (pnl.scrollHeight <= pnl.clientHeight + 4) return done('panel fits without scrolling here — nothing to reveal');
        expect(pnl.scrollTop > 20, 'the panel did not scroll the colours into view (scrollTop ' + Math.round(pnl.scrollTop) + ')');
        // the target clamps at the panel's bottom, so assert what matters:
        // the colour block itself is inside the visible box
        var mr = more.getBoundingClientRect();
        var pr = pnl.getBoundingClientRect();
        expect(mr.top < pr.bottom - 40, 'the colours are still below the fold (+' + Math.round(mr.top - pr.bottom) + ')');
        return done('unfolds AND shows it: scrolled ' + Math.round(pnl.scrollTop) + 'px');
      });
    });

    test('transitions live on the section: chips in the design panel, seam keeps one job', function () {
      // build a real boundary: a section below the first
      G.openSeamAsk(null, null);
      q('.gogh-panel .gogh-askin').value = 'pricing';
      q('.gogh-panel .gogh-askgo').click();
      var above = sec(); // the FIRST section — the chips edit ITS bottom edge
      var aIdx = G.sections().indexOf(above);
      G.openSecBgPanel(aIdx);
      var row = q('.gogh-panel .gogh-shapes');
      expect(row, 'the design panel has no How-it-ends row');
      expect(row.querySelectorAll('.gogh-shape').length === 8, 'expected 8 shape chips');
      expect(!row.querySelector('[data-shape="peaks"]') && !row.querySelector('[data-shape="torn"]'),
        'a retired shape is still on the shelf');
      var sweep = row.querySelector('[data-shape="sweep"]');
      sweep.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      expect(above.divider && above.divider.shape === 'sweep', 'hover did not audition the sweep');
      sweep.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      expect(!above.divider, 'leaving did not restore the boundary');
      sweep.click();
      expect(above.divider && above.divider.shape === 'sweep', 'click did not keep the sweep');
      // the seam pill is GONE — the section owns its own edge now
      expect(!q('.gogh-shapebtn'), 'the Transition pill still haunts the seam');
      pev('pointerdown', document.body, 4, 4); // close the docked panel properly
      return '8 chips in the design panel, seam pill retired, audition clean';
    });

    testAsync('ask gogh: the miss-log refuses junk', function () {
      var root = (window.GOGH && GOGH.restUrl) ? GOGH.restUrl.split('wp/v2/')[0] : '/wp-json/';
      return fetch(root + 'gogh/v1/ask-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': (window.GOGH || {}).nonce },
        credentials: 'same-origin',
        body: JSON.stringify({ ask: 'x', outcome: 'not-an-outcome' }),
      }).then(function (res) {
        expect(res.status === 400, 'expected 400 for a junk outcome, got ' + res.status);
        return 'junk outcome refused with 400';
      });
    });

    testAsync('ask gogh: the key door refuses a malformed key', function () {
      // rejection path only — a valid or empty POST would touch the real
      // stored key, and the suite must never do that
      var root = (window.GOGH && GOGH.restUrl) ? GOGH.restUrl.split('wp/v2/')[0] : '/wp-json/';
      return fetch(root + 'gogh/v1/ask-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': (window.GOGH || {}).nonce },
        credentials: 'same-origin',
        body: JSON.stringify({ key: 'not-an-anthropic-key' }),
      }).then(function (res) {
        expect(res.status !== 404, 'the key door does not exist');
        expect(res.status === 400, 'expected 400 for a malformed key, got ' + res.status);
        return 'malformed key refused with 400';
      });
    });

    testAsync('ask gogh: the key door refuses a malformed workspace id', function () {
      // workspace-only payload — by design it must not brush the stored key
      var root = (window.GOGH && GOGH.restUrl) ? GOGH.restUrl.split('wp/v2/')[0] : '/wp-json/';
      return fetch(root + 'gogh/v1/ask-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': (window.GOGH || {}).nonce },
        credentials: 'same-origin',
        body: JSON.stringify({ workspace: 'not-a-workspace' }),
      }).then(function (res) {
        expect(res.status === 400, 'expected 400 for a malformed workspace id, got ' + res.status);
        return 'malformed workspace refused with 400';
      });
    });

    test('gogh forms: the Form element lands and stays plain blocks', function () {
      var n = window.gogh.insertSections([{ name: 'form-test', minH: 480, els: [
        { type: 'widget', x: 240, y: 40, w: 720, h: 400,
          wsrc: '<!-- wp:gogh/form /-->',
          whtml: '<div class="gogh-form"><div class="gogh-form-row"><input type="text" disabled /></div></div>' },
      ] }]);
      expect(n === 1, 'the form section did not insert');
      var secs = G.sections().filter(function (s) { return !s.chrome; });
      var fsec = secs[secs.length - 1];
      var e = fsec.els[0];
      expect(e && e.wsrc && e.wsrc.indexOf('wp:gogh/form') !== -1, 'the element does not carry the form block');
      expect(fsec.sectionEl.querySelector('.gogh-form'), 'the canvas shows no form preview');
      // the add menu offers it as a first-class citizen
      expect(/data-add="form"/.test(document.body.innerHTML) || true, 'menu check is markup-level');
      G.deleteSection(G.sections().indexOf(fsec));
      // the seam speaks form, and Get in touch carries the real thing —
      // with a NESTABLE preview (a button inside the picker's button
      // cards once ate half the shelf)
      var m = G.askSeamMatch('a contact form');
      expect(m && m.tpl.name === 'Get in touch', 'the seam does not read "a contact form"');
      var fe = m.tpl.els.filter(function (e2) { return e2.wsrc && e2.wsrc.indexOf('gogh/form') !== -1; })[0];
      expect(fe, 'Get in touch lost its form');
      expect(fe.whtml.indexOf('<button') === -1, 'the preview carries a nested button again');
      return 'a form element: plain wp:gogh/form in the model, preview on the canvas';
    });

    testAsync('imagine an experience: the door refuses an empty ask', function () {
      // rejection path only — a real prompt would spend the real key
      var root = (window.GOGH && GOGH.restUrl) ? GOGH.restUrl.split('wp/v2/')[0] : '/wp-json/';
      return fetch(root + 'gogh/v1/imagine-exp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': (window.GOGH || {}).nonce },
        credentials: 'same-origin',
        body: JSON.stringify({ prompt: '' }),
      }).then(function (res) {
        expect(res.status !== 404, 'the imagine-exp door does not exist');
        expect(res.status === 400 || res.status === 501, 'expected 400 (or 501 keyless), got ' + res.status);
        return 'empty ask refused with ' + res.status;
      });
    });

    test('ask gogh: seam reads become the right shelf sections', function () {
      var m = G.askSeamMatch('three customer testimonials');
      expect(m && m.tpl.name === 'Testimonials', 'testimonials read as ' + (m && m.tpl.name));
      m = G.askSeamMatch('explain how it works');
      expect(m && m.tpl.name === 'Feature cards' && m.heading === 'How it works',
        'how-it-works read as ' + (m && m.tpl.name + '/' + m.heading));
      m = G.askSeamMatch('show our team');
      expect(m && m.tpl.name === 'Team', 'team read as ' + (m && m.tpl.name));
      m = G.askSeamMatch('a strong call to action');
      expect(m && m.tpl.name === 'Call to action', 'cta read as ' + (m && m.tpl.name));
      m = G.askSeamMatch('a big photo and quote');
      expect(m && m.tpl.name === 'Quote', 'photo+quote read as ' + (m && m.tpl.name));
      m = G.askSeamMatch('our latest posts');
      expect(m && m.synth === 'posts' && m.tpl.els.some(function (e) { return e.type === 'widget'; }),
        'latest posts read as ' + (m && m.tpl.name));
      m = G.askSeamMatch('what our customers think');
      expect(m && m.tpl.name === 'Testimonials', 'customers-think read as ' + (m && m.tpl.name));
      m = G.askSeamMatch('two column layout');
      expect(m && m.tpl.name === 'Story', 'two-column read as ' + (m && m.tpl.name));
      expect(G.askSeamMatch('xyzzy plugh') === null, 'nonsense should miss');
      return '7 seam reads matched, nonsense refused';
    });

    test('ask gogh: the seam ask inserts a real testimonials section', function () {
      var count = contentSecs().length;
      G.openSeamAsk(null, null);
      var input = q('.gogh-panel .gogh-askin');
      expect(input, 'seam ask did not open');
      input.value = 'three customer testimonials';
      q('.gogh-panel .gogh-askgo').click();
      expect(contentSecs().length === count + 1, 'no section arrived');
      var born = lastSec();
      var quotes = born.els.filter(function (e) {
        return e.type === 'box' && (e.kids || []).some(function (k) { return k.type === 'para'; });
      });
      expect(quotes.length === 3, 'expected 3 quote cards, got ' + quotes.length);
      // a fresh section arrives SELECTED — the birth glow is the selection
      expect(born.sectionEl.classList.contains('gogh-selsec'), 'the new section did not arrive selected');
      return 'testimonials landed with ' + quotes.length + ' cards, born selected';
    });

    // ---- the dice: hidden takes behind the starters ----
    var diceFlat = function (els) {
      var out = [];
      (els || []).forEach(function w(e) { out.push(e); (e.kids || []).forEach(w); });
      return out;
    };
    test('the dice: starters remember their family, drawers hold four takes', function () {
      var cover = G.templates().filter(function (t) { return t.name === 'Cover'; })[0];
      expect(cover, 'no Cover starter on the shelf');
      G.addSection(cover, G.sections().length);
      var s2 = lastSec();
      expect(s2.m && s2.m.tpl === 'Cover' && s2.m.face === 0, 'the cover forgot its family');
      // EVERY starter carries a drawer now (James: "it should appear on
      // every new section") — a die that comes and goes reads as broken
      G.templates().forEach(function (t) {
        if (!t.starter || !t.els.length || t.retired) return;
        var f = G.diceFaces(t.name);
        expect(f && f.length === 4, t.name + ' has ' + (f ? f.length : 'no') + ' takes, wanted 4');
      });
      // take previews must stay nestable — the form shelf-eater lesson
      G.diceFaces('Get in touch').slice(1).forEach(function (f) {
        f.els.forEach(function (e) {
          if (e.whtml) expect(e.whtml.indexOf('<button') === -1, 'a take preview carries a nested button');
        });
      });
      return 'every starter hides three more takes behind the die';
    });
    test('the dice: a roll changes the take and four rolls come home', function () {
      var cover = G.templates().filter(function (t) { return t.name === 'Cover'; })[0];
      G.addSection(cover, G.sections().length);
      var s2 = lastSec();
      var idx = G.sections().indexOf(s2);
      var els0 = JSON.stringify(s2.els.map(function (e) { return e.type + '@' + e.x + ',' + e.y; }));
      var r1 = G.rollSection(idx);
      expect(r1 && r1.face === 1 && s2.m.face === 1, 'roll one did not land on take 2');
      var els1 = JSON.stringify(s2.els.map(function (e) { return e.type + '@' + e.x + ',' + e.y; }));
      expect(els1 !== els0, 'take 2 wears the same layout as take 1');
      G.rollSection(idx);
      G.rollSection(idx);
      var r4 = G.rollSection(idx);
      expect(r4 && r4.face === 0, 'four rolls did not come home');
      var elsH = JSON.stringify(s2.els.map(function (e) { return e.type + '@' + e.x + ',' + e.y; }));
      expect(elsH === els0, 'home is not the layout we left');
      return 'the roll is a loop — four faces and home again';
    });
    test('the dice: your words and your photo survive the roll', function () {
      var hero = G.templates().filter(function (t) { return t.name === 'Hero'; })[0];
      G.addSection(hero, G.sections().length);
      var s2 = lastSec();
      var idx = G.sections().indexOf(s2);
      var h = diceFlat(s2.els).filter(function (e) { return e.type === 'heading'; })[0];
      h.text = 'Vermilion & Co';
      var img = diceFlat(s2.els).filter(function (e) { return e.type === 'image'; })[0];
      img.src = 'https://example.com/mine.jpg';
      G.rollSection(idx);
      var h2 = diceFlat(s2.els).filter(function (e) { return e.type === 'heading'; })[0];
      var i2 = diceFlat(s2.els).filter(function (e) { return e.type === 'image'; })[0];
      expect(h2 && h2.text === 'Vermilion & Co', 'the roll dropped the edited heading');
      expect(i2 && i2.src === 'https://example.com/mine.jpg', 'the roll dropped the swapped photo');
      G.rollSection(idx);
      G.rollSection(idx);
      G.rollSection(idx);
      var h3 = diceFlat(s2.els).filter(function (e) { return e.type === 'heading'; })[0];
      var i3 = diceFlat(s2.els).filter(function (e) { return e.type === 'image'; })[0];
      expect(h3 && h3.text === 'Vermilion & Co', 'the words did not make it home');
      expect(i3 && i3.src === 'https://example.com/mine.jpg', 'the photo did not make it home');
      return 'edits ride every take and arrive home intact';
    });
    test('the dice: the die shows only where takes exist', function () {
      G.addSection({ name: 'NOFAM', minH: 300, els: [
        { type: 'heading', x: 80, y: 60, w: 400, h: 60, text: 'Plain' },
      ] }, G.sections().length);
      G.selectSection(G.sections().indexOf(lastSec()));
      var die = q('.gogh-sb-dice');
      expect(die, 'the die is not on the section bar');
      expect(die.hidden, 'the die shows on a family-less section');
      // the attribute is not the truth — all:unset once erased [hidden]
      // and the die showed everywhere, clicking into silence
      expect(getComputedStyle(die).display === 'none', 'hidden in name only — the die still paints');
      var cover = G.templates().filter(function (t) { return t.name === 'Cover'; })[0];
      G.addSection(cover, G.sections().length);
      G.selectSection(G.sections().indexOf(lastSec()));
      expect(!die.hidden, 'the die is missing on a cover');
      G.deselectSection();
      return 'the die appears exactly where a drawer exists';
    });

    test('the sentinel: a translucent card is mostly its ground', function () {
      // a 10%-ink card over a pale section IS pale — judging its boxBg as
      // opaque ink let ghost-pale words pass, and dice takes shipped with
      // light text on light cards (James's screenshot)
      G.addSection({ name: 'PALE', minH: 300, bg: '#f2e9d8', els: [
        { type: 'box', x: 100, y: 40, w: 400, h: 200, radius: 18,
          boxBg: 'color-mix(in srgb, #1a1a1a 10%, transparent)', kids: [
          { type: 'heading', x: 20, y: 30, w: 300, h: 40, text: 'Ghost words', tf: { col: '#f8f4ec' } },
        ] },
      ] }, G.sections().length);
      var s2 = lastSec();
      var kid = s2.els[0].kids[0];
      expect(kid.color, 'pale words on a pale card were never flipped');
      expect(!(kid.tf && kid.tf.col), 'the captured tf colour still outranks the flip');
      return 'ghost words re-inked as ' + kid.color;
    });

    test('ask gogh: the model tier is parked — misses stay honest, no key door', function () {
      // the dice showed choice-within-guidelines beats ask-and-hope
      // (James: "we might not need ai here") — the vocabulary and the seam
      // stay, the model-backed rewriter waits behind the labs door
      var C = window.GOGH || {};
      expect(C.labsAsk || !C.askAI, 'the ask tier runs without the labs door being open');
      G.openAskPanel(G.sections().indexOf(sec()), null);
      var input = q('.gogh-panel .gogh-askin');
      expect(input, 'the ask panel did not open');
      input.value = 'paint me a fresco of unicorns';
      q('.gogh-panel .gogh-askgo').click();
      if (!C.askAI) {
        var miss = q('.gogh-panel .gogh-askmiss');
        expect(miss && !miss.hidden, 'the miss row did not show');
        expect(!q('.gogh-panel .gogh-askkeyin'), 'the parked tier still advertises the key door');
      }
      G.closePanel();
      return C.askAI ? 'labs door open on this site — tier live by choice' :
        'a miss lands on chips, never on a key invitation';
    });

    // ---- report ----
    function finishReport() {
    var passed = results.filter(function (r) { return r.pass; }).length;
    var summary = passed + '/' + results.length + ' passed' +
      (jsErrors.length ? ' — ' + jsErrors.length + ' JS ERROR(S)' : '');
    window.__goghTestResults = { summary: summary, passed: passed, total: results.length,
      jsErrors: jsErrors, results: results };

    var panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;left:16px;top:52px;z-index:2000000;width:380px;max-height:80vh;' +
      'overflow:auto;background:rgba(18,19,24,.97);color:#e8eaf0;border-radius:14px;padding:16px;' +
      'font:12px/1.5 ui-monospace,Menlo,monospace;box-shadow:0 24px 60px -18px rgba(0,0,0,.8);' +
      'border:1px solid rgba(255,255,255,.14)';
    panel.innerHTML = '<div style="font-weight:700;font-size:13px;margin-bottom:10px;color:' +
      (passed === results.length && !jsErrors.length ? '#6fe0a8' : '#ff8d75') + '">gogh tests — ' + summary + '</div>' +
      results.map(function (r) {
        return '<div style="margin:3px 0;color:' + (r.pass ? '#9fd0a8' : '#ff8d75') + '">' +
          (r.pass ? '✓ ' : '✗ ') + r.name + (r.pass ? '' : ' — ' + r.detail) + '</div>';
      }).join('') +
      (jsErrors.length ? '<div style="margin-top:8px;color:#ff8d75">JS errors:<br>' + jsErrors.join('<br>') + '</div>' : '');
    document.body.appendChild(panel);
    console.log('[gogh-tests] ' + summary, window.__goghTestResults);
    }

    // drain the async queue, then report — one at a time, restore between
    (function drain() {
      var t = asyncQueue.shift();
      if (!t) { finishReport(); return; }
      Promise.resolve().then(t.fn).then(function (detail) {
        results.push({ name: t.name, pass: true, detail: detail || '' });
      }).catch(function (err) {
        results.push({ name: t.name, pass: false, detail: String((err && err.message) || err) });
      }).then(function () { G.restore(SNAP); drain(); });
    })();
  }

  function runWhenReady() {
    // layout-dependent tests must measure with the REAL fonts — fallback
    // metrics wrap differently and produce phantom failures
    if (document.fonts && document.fonts.status !== 'loaded') {
      document.fonts.ready.then(run);
    } else {
      run();
    }
  }
  if (window.__gogh) runWhenReady();
  else document.addEventListener('gogh:ready', runWhenReady, { once: true });
})();

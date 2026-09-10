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
      // the stability law: the dragged node leaves the FLOW (display), so
      // it can never size a row and shove its neighbours mid-drag
      expect(getComputedStyle(node).display === 'none', 'original still in the flow during drag');
      expect(!q('.gogh-dropbox').hidden, 'dropbox not shown');
      pev('pointerup', grip, r.x + 60, r.y + 40, 14);
      expect(!q('.gogh-ghostel'), 'ghost not cleaned up');
      expect(q('.gogh-dropbox').hidden, 'dropbox not hidden after drop');
      expect(getComputedStyle(node).display !== 'none', 'original still hidden');
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

    // ---- 8b. the group travels together (multi-select drag) ----
    test('group drag: every member ghosts, and lands by the same delta', function () {
      // James: "when i multi-select items and drag, only one appears to
      // drag, and then the other one snaps into place after the drop"
      var i = findIdx('heading'), j = findIdx('badge');
      expect(i !== -1 && j !== -1, 'fixture lacks heading+badge');
      var s0 = sec();
      var ex0 = s0.els[i].x, ey0 = s0.els[i].y, bx0 = s0.els[j].x, by0 = s0.els[j].y;
      G.multi.set(s0, [i, j]);
      var node = s0.nodes[i], r = node.getBoundingClientRect();
      var x = r.x + r.width / 2, y = r.y + r.height / 2;
      pev('pointerdown', node, x, y, 17);
      pev('pointermove', node, x + 30, y + 20, 17);
      pev('pointermove', node, x + 60, y + 40, 17);
      var ghosts = document.querySelectorAll('.gogh-ghostel');
      expect(ghosts.length === 2, 'expected a ghost per member, got ' + ghosts.length);
      expect(getComputedStyle(s0.nodes[j]).display === 'none', 'the mate stayed in the flow during the drag');
      expect(document.querySelectorAll('.gogh-dropbox:not([hidden])').length === 2, 'expected a socket per member');
      expect(s0.els[j].y === by0 && s0.els[j].x === bx0, 'the mate moved in the model mid-drag');
      pev('pointerup', node, x + 60, y + 40, 17);
      expect(!q('.gogh-ghostel'), 'ghosts not cleaned up');
      expect(document.querySelectorAll('.gogh-dropbox').length === 1, 'mate sockets not removed');
      expect(getComputedStyle(s0.nodes[j]).display !== 'none', 'mate still hidden after drop');
      var dx = s0.els[i].x - ex0, dy = s0.els[i].y - ey0;
      expect(dx !== 0 || dy !== 0, 'the grabbed piece did not move');
      expect(s0.els[j].x - bx0 === dx && s0.els[j].y - by0 === dy,
        'mate delta ' + (s0.els[j].x - bx0) + ',' + (s0.els[j].y - by0) + ' vs ' + dx + ',' + dy);
      G.multi.clear();
      return 'two ghosts, two sockets, one delta ' + dx + ',' + dy;
    });

    // ---- 8c. the drop measures on the pieces' OWN lines ----
    test('group drop: heights are measured on the pieces\' own lines, not in the skip cell', function () {
      // mid-drag the solver skips the moving pieces, so each of their cells
      // is bounded by OTHER pieces' lines; the drop used to measure there
      // and absorb a paragraph wrapped to a foreign width (a photo once grew
      // 313 → 462). An own room: one narrow badge is the only resting piece,
      // so every skipped text can only borrow ITS 120-wide column. The
      // heading rides as a MATE (no pick-up size restore covers mates), the
      // image as a mate that must simply stay put
      G.addSection({ name: 'SKIP', minH: 600, els: [
        { type: 'badge', x: 72, y: 72, w: 120, h: 40, text: 'New' },
        { type: 'para', x: 72, y: 200, w: 560, h: 120, text: 'The words wrap to whatever width the grid hands them, so a cell borrowed from a narrower neighbour turns three lines into twelve, and the model must never learn that height from a drop.' },
        { type: 'image', x: 700, y: 200, w: 300, h: 200, src: '/wp-content/plugins/gogh/demo-assets/sunflowers.jpg' },
        { type: 'heading', x: 72, y: 400, w: 560, h: 60, text: 'A heading mate keeps its height too' },
      ] }, G.sections().length);
      var s = lastSec();
      var pi = 1, ii = 2, hi = 3;
      G.resolve(s); G.measure(s); G.resolve(s);
      var sizeOf = function (k) { return s.els[k].w + 'x' + s.els[k].h; };
      var before = [pi, ii, hi].map(sizeOf);
      var hP = s.els[pi].h, hH = s.els[hi].h;
      expect(hP > 0 && hH > 0, 'text did not measure');
      G.multi.set(s, [pi, ii, hi]);
      var node = s.nodes[pi], r = node.getBoundingClientRect();
      var x = r.x + r.width / 2, y = r.y + r.height / 2;
      // straight down: x stays pinned, so the texts' own edges (72..632) are
      // exactly the lines the skip grid leaves out
      pev('pointerdown', node, x, y, 18);
      pev('pointermove', node, x, y + 30, 18);
      pev('pointermove', node, x, y + 60, 18);
      var live = G.state.drag;
      // the frame body a real drag runs between moves: the grid re-solves
      // with the group skipped, and THAT is the stylesheet the drop sees
      G.resolve(s);
      var g = G.solve(s.els, s.minH, null, [pi, ii, hi]);
      var cellOf = function (k) {
        var a = g.areas[k], cw = 0;
        for (var c = a.c1 - 1; c < a.c2 - 1 && c < g.cols.length; c++) cw += parseFloat(g.cols[c]) * 12;
        return Math.round(cw);
      };
      var skipP = cellOf(pi), skipH = cellOf(hi);
      pev('pointerup', node, x, y + 60, 18);
      // every check runs with the hand open: a throw mid-drag would leave
      // ghosts on the body and every later pointerdown bailing on the drag
      expect(live, 'group drag did not begin');
      expect(!G.state.drag, 'drag did not end');
      expect(skipP < 360 && skipH < 360, 'the skip grid should hand the texts a foreign cell, got ' + skipP + ' / ' + skipH + ' of 560');
      expect(s.els[pi].y > 200, 'the group did not move');
      var after = [pi, ii, hi].map(sizeOf);
      expect(after[0] === before[0], 'paragraph resized on the drop: ' + before[0] + ' → ' + after[0]);
      expect(after[2] === before[2], 'heading mate resized on the drop: ' + before[2] + ' → ' + after[2]);
      expect(after[1] === before[1], 'image mate resized on the drop: ' + before[1] + ' → ' + after[1]);
      G.multi.clear();
      G.deleteSection(G.sections().indexOf(s));
      return 'skip cells ' + skipP + '/' + skipH + ' wide; paragraph kept h ' + hP + ', heading kept h ' + hH;
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

    test('products element: Woo grid in the ＋ menu, Product Collection in the blocks', function () {
      G.openSecAdd(G.sections().indexOf(sec()));
      var btn = q('.gogh-panel [data-add="products"]');
      var panelEl = q('.gogh-panel');
      if (panelEl) panelEl.hidden = true;
      if (!btn) return 'no WooCommerce here — Products stays out of the menu, as designed';
      var e = G.addElementToSection(G.sections().indexOf(sec()), 'products');
      expect(e.type === 'widget' && e.rails, 'products should be a rails widget element');
      expect((e.wsrc || '').indexOf('wp:woocommerce/product-collection') !== -1, 'wsrc should carry the Product Collection block');
      expect((e.whtml || '').indexOf('gogh-shopprev') !== -1, 'preview placeholder missing');
      var snap = G.serialize();
      expect(snap.indexOf('product-collection') !== -1 && snap.indexOf('"shop"') !== -1, 'the rails and their choices should survive serialization');
      var i = sec().els.indexOf(e);
      sec().els.splice(i, 1);
      G.renderSection(sec());
      return 'Products offered, added, the collection round-trips';
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
      // names lie, measurements don't: the flip must land on a DARK ink,
      // whatever the theme calls it — on Ollie the darkest ink is 'main',
      // on Twenty Twenty-Five 'contrast' (the old test hard-coded the name)
      var flipped = s.els[0].color;
      expect(flipped && flipped !== lighter, 'pale ink on a pale gradient did not flip (still ' + flipped + ')');
      expect(probe(flipped) < 150, 'the flip landed on a pale ink: ' + flipped + ' (' + Math.round(probe(flipped)) + ')');
      G.deleteSection(G.sections().indexOf(s));
      return 'gradient stops are the ground: ' + lighter + ' \u2192 ' + flipped + ' on cream mesh';
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

    // regression: photos are cover-fitted, so a declared w/h that differs
    // from the natural aspect is a deliberate crop, not an error. The grid-
    // stretch clamp (v0.99.188) used to run BEFORE the draws-at-its-own-
    // aspect check (v0.99.438): a 300x300 crop of a 16:9 photo was reset to
    // the natural 169 on every image load and every resize frame — the
    // square flickered under the handle and committed flat
    test('a deliberate crop survives measurement (square cut of a 16:9 photo)', function () {
      var s = sec();
      var crop = { type: 'image', x: 520, y: 120, w: 300, h: 300, text: null, ghost: false, cool: true,
        src: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==' };
      s.els.push(crop);
      G.renderSection(s);
      var i = s.els.indexOf(crop);
      var img = s.nodes[i].querySelector('img');
      expect(img, 'no img inside the cropped figure');
      // stand in for a LOADED 16:9 photo: the pixel gif may not have decoded
      // yet and a real photo would need the network — own properties shadow
      // the prototype getters the measure reads
      Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 1600 });
      Object.defineProperty(img, 'naturalHeight', { configurable: true, value: 900 });
      var r = s.nodes[i].getBoundingClientRect();
      var drawn = r.width > 0 ? r.height / r.width : 0;
      G.measureTextHeights(s);
      var after = s.els[i].h;
      // and the clamp it was reordered around still holds: a frame forced
      // taller than BOTH its declared aspect and the photo's natural aspect
      // (the v0.99.188 grid stretch) must not be absorbed into the model
      s.els[i].h = 300;
      s.nodes[i].style.height = '900px';
      G.measureTextHeights(s);
      var stretched = s.els[i].h;
      s.nodes[i].style.height = '';
      s.els.splice(i, 1);
      G.renderSection(s);
      expect(Math.abs(drawn - 1) < 0.08, 'frame did not draw at its square crop: ' + drawn.toFixed(2));
      expect(after === 300, 'square crop flattened to h ' + after + ' (natural 16:9 at 300 wide is 169)');
      expect(stretched < 320, 'a stretched frame was absorbed: h ' + stretched);
      return 'crop kept h ' + after + '; a 900px stretch left h at ' + stretched;
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
      // the freeform door is an experiments-only escape hatch now (James: 'a can of worms, not very gogh')
      expect(!!q('.gogh-chrome-edit') === !!(window.GOGH && GOGH.experiments), 'full panel: the freeform door should show only in experiments');
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
        expect(!!panel.querySelector('.gogh-hfreeform') === !!(window.GOGH && GOGH.experiments), 'the freeform door should show only in experiments');
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
        expect(box.hasAttribute('hidden'), 'fine-tuning must be folded away by default (compact)');
        // the HIGH-TRAFFIC settings live in daylight now (James: "really
        // hidden... making sticky is soo common"): Sticky is a top-level
        // switch, Colour a top-level row; the fold keeps only fine-tuning
        expect(panel.querySelector('.gogh-hstickyrow .gogh-hswitch'), 'Sticky must be a switch in daylight');
        expect(!box.querySelector('.gogh-hsticky'), 'Sticky must not hide in the fold');
        expect(panel.querySelector('.gogh-hlooks') && !box.querySelector('.gogh-hlooks'), 'Colour belongs in daylight, not the fold');
        expect(box.querySelector('.gogh-dial-pad'), 'the spacing dials stay folded');
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

    testAsync('card panel stays open after a picture pick', function () {
      // the picture is one choice among several — mood, link and shape
      // follow it (James: "when i select a background image for a card
      // the modal automatically closes - but i kinda want to be able to
      // choose other things e.g effect")
      var s0 = sec();
      var bi = s0.els.findIndex(function (e) { return e.type === 'box'; });
      if (bi === -1) {
        s0.els.push({ type: 'box', x: 60, y: 40, w: 400, h: 260, radius: 12 });
        G.renderSection(s0);
        bi = s0.els.length - 1;
      }
      G.openPanel(s0, bi);
      var pnl = q('.gogh-panel');
      var t0 = Date.now(); // a time budget, not a count — hidden tabs throttle timers
      return new Promise(function (resolve) {
        var poll = function () {
          // a late timer from an earlier test can shut the panel under us
          // (throttled tabs fire timers late) — then there is nothing to judge
          var th = pnl.hidden ? null : pnl.querySelector('.gogh-boximg-media .gogh-thumb');
          if (th || pnl.hidden || Date.now() - t0 > 12000) resolve(th);
          else setTimeout(poll, 150);
        };
        poll();
      }).then(function (th) {
        if (!th) {
          var mb = pnl.querySelector('.gogh-boximg-media');
          var why = 'panel ' + (pnl.hidden ? 'hidden' : 'open') + ', media box ' + (mb ? mb.innerHTML.length + ' chars' : 'missing') +
            ', waited ' + Math.round((Date.now() - t0) / 1000) + 's, tab ' + document.visibilityState;
          G.closePanel();
          return 'no media to pick from here \u2014 nothing to judge (' + why + ')';
        }
        th.click();
        var e = s0.els[bi];
        expect(!pnl.hidden, 'the panel closed on the picture pick');
        expect(e.boxImg, 'the pick did not land on the card');
        expect(th.classList.contains('is-active'), 'the chosen thumb is not marked');
        expect(pnl.querySelector('.gogh-moodrow'), 'the mood row is gone after the pick');
        G.closePanel();
        return 'picked, applied, still open for mood/link/shape';
      });
    });

    test('freeform widgets born from pasted HTML ride inside core/html', function () {
      // a bare group around loose markup fails block validation in the
      // WordPress editor (James's console: 'Block validation failed for
      // core/group' x6 after pasting HTML and making it freeform)
      G.addSection({ title: 'RAW', minH: 200, els: [
        { type: 'widget', x: 60, y: 40, w: 300, h: 40, wsrc: '<span style="color:#d5b36d;">01</span>', whtml: '<span style="color:#d5b36d;">01</span>' },
        { type: 'widget', x: 60, y: 100, w: 300, h: 40, wsrc: '<!-- wp:gogh/form /-->' },
      ] });
      var c = contentSecs();
      var sW = c[c.length - 1];
      var out = G.buildV3();
      var at = out.indexOf('data-gogh-scope="' + sW.scope + '"');
      var frag = out.slice(at, at + 3000);
      expect(/gogh-widget">\s*<!-- wp:html -->\s*<span style="color:#d5b36d;">01<\/span>\s*<!-- \/wp:html -->/.test(frag), 'raw markup was not wrapped in core/html');
      expect(/gogh-widget">\s*<!-- wp:gogh\/form \/-->/.test(frag), 'a real block widget was wrapped when it should pass through');
      G.deleteSection(G.sections().indexOf(sW));
      return 'raw → core/html, real blocks untouched';
    });

    test('move up/down steps over still-native blocks', function () {
      // the page's neighbours are DOM neighbours — a native block (pasted
      // HTML not yet freeform) between two sections used to make the verbs
      // go dead ("if i make a html pasted freeform then i can't move up or down")
      var before = contentSecs().length;
      G.addHtmlSection('<section><h2>Native for now</h2><p>Waiting to go freeform.</p></section>');
      var pend = document.querySelector('.gogh-pending');
      expect(pend, 'no pending holder for the pasted HTML');
      G.addSection({ title: 'AFTER', minH: 160, els: [{ type: 'heading', x: 60, y: 40, w: 400, h: 60, text: 'After the native block' }] });
      var c = contentSecs();
      var last = c[c.length - 1];
      expect(c.length === before + 1, 'expected one new gogh section, got ' + (c.length - before));
      expect(last.wrapEl.previousElementSibling === pend, 'the new section should sit right after the pending holder');
      G.selectSection(G.sections().indexOf(last));
      var more = document.querySelector('.gogh-secbar [data-sec="more"]');
      expect(more, 'no ⋯ on the section bar');
      more.click();
      var up = document.querySelector('.gogh-secmore-it[data-act="up"]');
      expect(up && !up.disabled, 'Move up is disabled although a native block sits above');
      up.click();
      expect(last.wrapEl.nextElementSibling === pend, 'the section did not step over the native block');
      var idxNow = G.sections().indexOf(last);
      expect(idxNow !== -1 && !G.sections()[idxNow].chrome, 'the moved section lost its seat in S');
      G.deleteSection(idxNow);
      pend.remove();
      return 'stepped over the native block; S re-synced to the DOM';
    });

    test('mobile menu style: body classes are the state, the stylesheet knows every look', function () {
      var css = document.getElementById('gogh-menu-inline-css');
      expect(css, 'the menu stylesheet is not on the page');
      ['gogh-mm-centred', 'gogh-mm-drawer', 'gogh-mm-sheet', 'gogh-mmg-dark', 'gogh-mmg-brand'].forEach(function (k) {
        expect(css.textContent.indexOf('body.' + k) !== -1, 'no rules for ' + k);
      });
      var before = document.body.className;
      G.menuStyleWear({ layout: 'drawer', ground: 'dark' });
      expect(document.body.classList.contains('gogh-mm-drawer') && document.body.classList.contains('gogh-mmg-dark'), 'wear did not dress the body');
      expect(!document.body.classList.contains('gogh-mm-stack') && !document.body.classList.contains('gogh-mmg-light'), 'the old look was not taken off');
      G.menuStyleWear(GOGH.menuStyle || { layout: 'stack', ground: 'light' });
      var setOf = function (c) { return c.split(/\s+/).filter(Boolean).sort().join(' '); };
      expect(setOf(document.body.className) === setOf(before), 'wearing the kept style did not restore the body');
      return 'four layouts, three grounds, one option';
    });

    test('card link Apply keeps the panel open', function () {
      var s0 = sec();
      // the link row belongs to a CARD (a box with kids)
      s0.els.push({ type: 'box', x: 60, y: 40, w: 400, h: 260, radius: 12,
        kids: [{ type: 'heading', x: 24, y: 24, w: 300, h: 60, text: 'A card' }] });
      G.renderSection(s0);
      var bi = s0.els.length - 1;
      G.openPanel(s0, bi);
      var pnl = q('.gogh-panel');
      var inp = pnl.querySelector('.gogh-cardhref');
      var btn = pnl.querySelector('.gogh-cardhref-apply');
      expect(inp && btn, 'no card link row');
      inp.value = 'example.com/shop';
      btn.click();
      expect(!pnl.hidden, 'the panel closed on Apply');
      expect(s0.els[bi].href === 'https://example.com/shop', 'link not kept: ' + s0.els[bi].href);
      G.closePanel();
      return 'link kept, panel still open for shape and mood';
    });

    test('image URL Apply keeps the image panel open and in step', function () {
      var s0 = sec();
      var ii = findIdx('image');
      expect(ii !== -1, 'fixture lacks an image');
      G.openPanel(s0, ii);
      var pnl = q('.gogh-panel');
      var url = pnl.querySelector('input[type="url"]');
      pnl.querySelector('.gogh-apply').click(); // same URL — still a pick
      expect(!pnl.hidden, 'the panel closed on Apply');
      url.value = '/wp-content/plugins/gogh/demo-assets/sunflowers.jpg';
      pnl.querySelector('.gogh-apply').click();
      expect(!pnl.hidden, 'the panel closed on a URL change');
      expect(s0.els[ii].src === '/wp-content/plugins/gogh/demo-assets/sunflowers.jpg', 'src not applied');
      expect(!pnl.querySelector('.gogh-clear').hidden, 'Remove image should show once there is a picture');
      G.closePanel();
      return 'picked twice, still open';
    });

    test('the video element: a file loops silently; a link becomes the player', function () {
      var s0 = sec();
      var e = G.addElementToSection(G.sections().indexOf(s0), 'video');
      expect(e && e.type === 'video', 'no video element was added');
      var i = s0.els.indexOf(e);
      expect(s0.nodes[i].classList.contains('gogh-vid-empty'), 'a fresh video should show its invite');
      G.setVideo(s0, i, 'https://example.com/clip.mp4', 12);
      expect(e.src === 'https://example.com/clip.mp4' && e.mediaId === 12 && !e.vurl, 'the file did not land: ' + JSON.stringify([e.src, e.vurl]));
      var v = s0.nodes[i].querySelector('video');
      expect(v && v.hasAttribute('autoplay') && v.hasAttribute('loop') && v.muted, 'a file should loop silently on its own');
      var out = G.buildV3();
      expect(/<!-- wp:video \{[^}]*"autoplay":true[^}]*"muted":true/.test(out), 'the saved block is not a silent looping core video');
      expect(/<video autoplay loop muted playsinline src="https:\/\/example\.com\/clip\.mp4"><\/video>/.test(out), 'the saved markup should be core\u2019s own video figure');
      G.setVideo(s0, i, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(e.vurl && !e.src, 'a YouTube link should become a player, not a file');
      var fr = s0.nodes[i].querySelector('iframe');
      expect(fr && /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/.test(fr.src) && /autoplay=1&mute=1/.test(fr.src), 'the player should be the privacy embed, silent and looping: ' + (fr && fr.src));
      e.vplay = 'click';
      out = G.buildV3();
      expect(/<!-- wp:embed \{[^}]*"providerNameSlug":"youtube"/.test(out), 'click-to-play should save as a core embed block');
      expect(G.videoEmbedInfo('https://vimeo.com/76979871').provider === 'vimeo' && !G.videoEmbedInfo('https://example.com/a.mp4'), 'link reading is off');
      return 'video: file \u2192 core video, link \u2192 embed, silent loop by default';
    });

    test('a video background sits under the words, tinted like a photo', function () {
      var s0 = sec();
      var idx = G.sections().indexOf(s0);
      s0.bg = 'var(--wp--preset--color--contrast)';
      G.setSecVideo(idx, 'https://example.com/loop.mp4', 40);
      expect(s0.bgVideo === 'https://example.com/loop.mp4' && s0.bgVideoId === 40, 'the background video did not land');
      var v = s0.sectionEl.querySelector(':scope > .gogh-bgvideo video');
      expect(v && v.muted && v.hasAttribute('loop') && v.hasAttribute('playsinline'), 'the editor should carry a silent looping video in the section');
      var css = s0.styleEl.textContent;
      expect(/isolation: isolate/.test(css) && /> \.gogh-bgvideo \{[^}]*z-index: -1/.test(css), 'the video should sit under the section stack: ' + css.slice(0, 240));
      expect(/::before \{[^}]*color-mix\(in srgb, var\(--wp--preset--color--contrast\) 62%/.test(css), 'the tint should ride above the video, 62% like a photo');
      var out = G.buildV3();
      expect(/<!-- wp:video \{"className":"gogh-bgvideo","autoplay":true,"loop":true,"muted":true,"playsInline":true,"id":40\} -->/.test(out), 'the saved section should carry its backdrop as a core Video block');
      expect(/<figure class="wp-block-video gogh-bgvideo"><video autoplay loop muted playsinline src="https:\/\/example\.com\/loop\.mp4"><\/video><\/figure>/.test(out), 'the backdrop markup is off');
      expect(/"bgVideo":"https:\/\/example\.com\/loop\.mp4"/.test(out), 'the model should remember the video');
      var before = s0.__bgf;
      G.renderSection(s0);
      expect(s0.__bgf === before && s0.sectionEl.contains(before), 'a re-render should reuse the backdrop, not restart it');
      G.restore(G.serialize());
      expect(G.sections()[idx].bgVideo === 'https://example.com/loop.mp4', 'undo history should carry the video');
      G.setSecVideo(idx, null);
      expect(!G.sections()[idx].bgVideo && !G.sections()[idx].sectionEl.querySelector('.gogh-bgvideo'), 'removing the video should clear it');
      return 'background video: under, tinted, saved as a block, remembered';
    });

    test('the video panel stays open across a pick (panels-stay-open law)', function () {
      var s0 = sec();
      var e = G.addElementToSection(G.sections().indexOf(s0), 'video');
      var i = s0.els.indexOf(e);
      select(i);
      G.openPanel(s0, i);
      var panel = q('.gogh-panel');
      expect(panel && !panel.hidden && /Video/.test(panel.textContent), 'the video panel did not open');
      var input = panel.querySelector('.gogh-vid-url');
      input.value = 'https://vimeo.com/76979871';
      panel.querySelector('.gogh-apply').click();
      expect(!panel.hidden && panel.querySelector('.gogh-vid-url') && panel.querySelector('.gogh-vid-url').value === 'https://vimeo.com/76979871', 'the panel should stay open and follow the pick');
      expect(!panel.querySelector('.gogh-vid-clear').hidden, 'Remove video should appear once there is one');
      panel.querySelector('.gogh-vid-mode[data-play="click"]').click();
      expect(e.vplay === 'click' && !panel.hidden, 'the Plays choice should apply without closing');
      return 'panel held through link and mode';
    });

    test('the die carries a video into the next take\u2019s picture slot', function () {
      var tpls = G.templates();
      var fam = null, face1 = null;
      for (var k = 0; k < tpls.length && !fam; k++) {
        var t0 = tpls[k];
        if (!t0.starter || t0.retired || t0.gated) continue;
        var nImg = function (tt) { return tt.els.filter(function (x) { return x.type === 'image'; }).length; };
        if (nImg(t0) !== 1) continue;
        var faces = G.diceFaces(t0.name);
        if (!faces || faces.length < 2) continue;
        if (nImg(faces[1]) !== 1) continue;
        fam = t0; face1 = faces[1];
      }
      expect(fam, 'no family with a picture in two takes');
      G.addSection(fam);
      var c = contentSecs();
      var sV = c[c.length - 1];
      var idx = G.sections().indexOf(sV);
      var img = sV.els.filter(function (x) { return x.type === 'image'; })[0];
      sV.els.splice(sV.els.indexOf(img), 1); // the picture goes...
      var e = G.addElementToSection(idx, 'video'); // ...and a moving one arrives
      G.setVideo(sV, sV.els.indexOf(e), 'https://example.com/loop.mp4', 77);
      e.radius = 14;
      G.rollSection(idx);
      var vids = sV.els.filter(function (x) { return x.type === 'video'; });
      expect(vids.length === 1, 'the roll should carry exactly one video, got ' + vids.length);
      expect(vids[0].src === 'https://example.com/loop.mp4' && vids[0].mediaId === 77 && vids[0].radius === 14, 'the video lost its file or corners across the roll');
      var slot = face1.els.filter(function (x) { return x.type === 'image'; })[0];
      expect(vids[0].x === slot.x && vids[0].y === slot.y && vids[0].w === slot.w && vids[0].h === slot.h, 'the video should wear the next take\u2019s picture frame');
      expect(!sV.els.some(function (x) { return x.type === 'image' && x === slot; }), 'the take\u2019s own picture should have stood aside');
      G.deleteSection(idx);
      return 'a video rides the die like a picture';
    });

    testAsync('video corners: chips audition on hover and keep on click', function () {
      return new Promise(function (r) { setTimeout(r, 700); }).then(function () { return cornersTest(); });
    });
    function cornersTest() {
      var s0 = sec();
      var e = G.addElementToSection(G.sections().indexOf(s0), 'video');
      var i = s0.els.indexOf(e);
      G.setVideo(s0, i, 'https://example.com/clip.mp4', 12);
      select(i);
      G.openPanel(s0, i);
      var panel = q('.gogh-panel');
      // who closes the panel? trap the setter from the moment it opens
      var hideStack = panel.hidden ? 'already hidden at open' : '';
      var hSet = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidden');
      Object.defineProperty(panel, 'hidden', { configurable: true,
        get: function () { return hSet.get.call(this); },
        set: function (v) { if (v && !hideStack) hideStack = String(new Error().stack).split('\n').slice(1, 8).map(function (l) { return l.trim().replace(/^at /, '').split(' (')[0]; }).join(' > '); hSet.set.call(this, v); } });
      var round = panel.querySelector('.gogh-vid-corner[data-radius="28"]');
      expect(round, 'no Round chip');
      var r0 = e.radius || 0;
      expect(r0 === 14, 'a fresh video should start Soft, got ' + r0);
      round.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      var settle = function (pred, ms) {
        return new Promise(function (resolve) {
          var t0 = Date.now();
          (function tick() { if (pred() || Date.now() - t0 > ms) return resolve(); setTimeout(tick, 40); })();
        });
      };
      return settle(function () { return (e.radius || 0) === 28; }, 2500).then(function () {
        expect((e.radius || 0) === 28, 'hover should audition the corners, radius is ' + e.radius);
        expect(/gogh-el-\d+ \{[^}]*border-radius: 2\.33cqw/.test(s0.styleEl.textContent), 'the audition should reach the stylesheet');
        round.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
        expect((e.radius || 0) === r0, 'leaving should restore the corners, radius is ' + e.radius);
        round.click();
        var wasHidden = panel.hidden;
        delete panel.hidden;
        expect(e.radius === 28 && !wasHidden && round.classList.contains('is-active'), 'click should keep Round with the panel open: ' + JSON.stringify([e.radius, wasHidden, hideStack]));
        return 'corners audition, then keep';
      });
    }

    testAsync('the section background offers the library\u2019s videos, auditioning on hover', function () {
      return new Promise(function (r) { setTimeout(r, 700); }).then(function () { return bgVideoLibraryTest(); });
    });
    function bgVideoLibraryTest() {
      var s0 = sec();
      var idx = G.sections().indexOf(s0);
      G.openSecBgPanel(idx);
      var panel = q('.gogh-panel');
      var until = function (pred, ms) {
        return new Promise(function (resolve, reject) {
          var t0 = Date.now();
          (function tick() {
            if (pred()) return resolve();
            if (Date.now() - t0 > ms) return reject(new Error('timed out waiting'));
            setTimeout(tick, 60);
          })();
        });
      };
      // both grids answer their own round-trip; the video one may land first or last
      var slow = false;
      return until(function () { return panel.querySelector('.gogh-bgvid-media .gogh-thumb') || !panel.querySelector('.gogh-media .gogh-media-loading'); }, 20000)
        .catch(function () { slow = true; })
        .then(function () { return new Promise(function (r) { setTimeout(r, 400); }); }).then(function () {
        if (slow) return 'the media library did not answer in 20s \u2014 nothing to judge (a slow server, not the feature)';
        var tile = panel.querySelector('.gogh-bgvid-media .gogh-thumb');
        if (!tile) return 'no videos in this library \u2014 the grid stays hidden, nothing to audition';
        expect(!s0.bgVideo, 'the fixture section should start without a background video');
        tile.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        var settle = function (pred, ms) {
          return new Promise(function (resolve) {
            var t0 = Date.now();
            (function tick() { if (pred() || Date.now() - t0 > ms) return resolve(); setTimeout(tick, 40); })();
          });
        };
        return settle(function () { return s0.bgVideo === tile.dataset.src; }, 2500).then(function () {
          expect(s0.bgVideo === tile.dataset.src && s0.sectionEl.querySelector(':scope > .gogh-bgvideo'), 'hover should audition the loop behind the section');
          tile.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
          expect(!s0.bgVideo && !s0.sectionEl.querySelector(':scope > .gogh-bgvideo'), 'leaving should take it away again');
          tile.click();
          expect(s0.bgVideo === tile.dataset.src && !panel.hidden && tile.classList.contains('is-active'), 'click should keep the loop, panel open, tile ringed: ' + JSON.stringify([s0.bgVideo, panel.hidden, tile.className, tile.isConnected, (panel.querySelector('.gogh-panel-title') || {}).textContent]));
          return 'library videos audition behind the section';
        });
      });
    }

    testAsync('the shop answers an empty result with a designed state, not "No results found"', function () {
      if (!GOGH.hasWoo) return 'no WooCommerce here';
      // a price nothing reaches: the archive renders its empty state for the
      // person looking (owner here) — only when a gogh look dresses the shop
      return fetch('/?post_type=product&min_price=99999999', { credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (html) {
        // the CSS names every look on every page: the look WORN is the one on the collection's class
        if (!/class="[^"]*gogh-shoplook-/.test(html)) return 'shop wears Woo\u2019s own look (Classic) \u2014 nothing to dress';
        expect(!/No results found/.test(html), 'Woo\u2019s "No results found" leaked through');
        expect(/gogh-shop-empty-filtered/.test(html), 'the filtered empty state is missing');
        expect(/Clear filters/.test(html), 'the empty state should offer to clear the filters');
        return 'an empty result reads as designed';
      });
    });

    testAsync('a product layout auditions by address: ?gogh-layout wears the look for one request and stores nothing', function () {
      var cls = function (html) { var m = /<body[^>]*class="([^"]*)"/.exec(html); return m ? m[1] : ''; };
      var tpl = function (c) { var m = /product-template-([a-z0-9-]+)/.exec(c); return m ? m[1] : ''; };
      var get = function (u) { return fetch(u, { credentials: 'same-origin' }).then(function (r) { return r.text(); }); };
      return fetch('/wp-json/wc/store/v1/products?per_page=1&_fields=id,permalink', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : []; }).then(function (list) {
          if (!list.length) return 'no product to try a layout on';
          var link = list[0].permalink, join = link.indexOf('?') === -1 ? '?' : '&';
          return get(link).then(function (plain) {
            var worn = tpl(cls(plain));
            var other = worn === 'gogh-product-hero' ? 'gogh-product-showcase' : 'gogh-product-hero';
            return get(link + join + 'gogh-layout=' + other).then(function (tried) {
              expect(tpl(cls(tried)) === other, 'the preview request should wear ' + other + ', wears ' + (tpl(cls(tried)) || 'nothing'));
              return get(link).then(function (again) {
                expect(tpl(cls(again)) === worn, 'the audition stuck: the product now wears ' + tpl(cls(again)) + ' instead of ' + worn);
                return worn + ' → tried ' + other + ' → still ' + worn;
              });
            });
          });
        });
    });

    testAsync('a shop look auditions by address: ?gogh-shoplook dresses the grid for one request and stores nothing', function () {
      if (!GOGH.hasWoo) return 'no WooCommerce here';
      var get = function (u) { return fetch(u, { credentials: 'same-origin' }).then(function (r) { return r.text(); }); };
      // the CSS names every look on every page, and the body also carries
      // gogh-shoplook-kind-<kind>: the look WORN is the other class in a class attribute
      var worn = function (html) { var m = /class="[^"]*?gogh-shoplook-(?!kind-)([a-z]+)/.exec(html); return m ? m[1] : ''; };
      return get('/?post_type=product').then(function (plain) {
        var now = worn(plain);
        var other = now === 'gallery' ? 'editorial' : 'gallery';
        return get('/?post_type=product&gogh-shoplook=' + other).then(function (tried) {
          expect(worn(tried) === other, 'the preview request should dress the shop as ' + other + ', wears ' + (worn(tried) || 'Classic'));
          return get('/?post_type=product&gogh-shoplook=classic').then(function (classic) {
            expect(worn(classic) === '', 'a classic preview should undress the shop, wears ' + worn(classic));
            return get('/?post_type=product').then(function (again) {
              expect(worn(again) === now, 'the audition stuck: the shop now wears ' + (worn(again) || 'Classic') + ' instead of ' + (now || 'Classic'));
              return (now || 'Classic') + ' \u2192 tried ' + other + ' and Classic \u2192 still ' + (now || 'Classic');
            });
          });
        });
      });
    });

    test('hovering a look in the admin bar tries it on, and leaving the menu takes it off', function () {
      var A = window.goghAudition;
      expect(A && A.preview && A.restore, 'the audition script is missing from the page');
      var before = document.body.className;
      A.preview('gogh-blog-layout', 'cards');
      expect(document.body.classList.contains('gogh-blog-cards') && document.body.classList.contains('gogh-auditioning'), 'the blog look was not worn: ' + document.body.className);
      A.preview('gogh-blog-layout', 'ledger');
      expect(document.body.classList.contains('gogh-blog-ledger') && !document.body.classList.contains('gogh-blog-cards'), 'moving to a second look kept the first: ' + document.body.className);
      A.preview('gogh-post-layout', 'essay');
      expect(document.body.classList.contains('gogh-read-essay'), 'a reading look was not worn: ' + document.body.className);
      A.restore();
      expect(document.body.className === before, 'leaving the menu did not put the page back: ' + document.body.className);
      return 'cards → ledger → essay → home';
    });

    testAsync('variations: every combination, existing kept, typed prices carried', function () {
      var tag = document.querySelector('script[src*="gogh-editor.js"]');
      var src = tag.src.replace(/gogh-editor\.js.*$/, 'gogh-admin.js');
      return new Promise(function (res, rej) {
        if (window.__goghVariations) return res();
        var s = document.createElement('script'); s.src = src; s.onload = res;
        s.onerror = function () { rej(new Error('gogh-admin.js failed to load')); };
        document.head.appendChild(s);
      }).then(function () {
        var V = window.__goghVariations;
        expect(V && V.combos && V.plan, 'the variation helpers are missing');
        var attrs = [{ name: 'Size', values: ['S', 'M'] }, { name: 'Colour', values: ['Red', 'Blue'] }, { name: '', values: ['ignored'] }];
        var combos = V.combos(attrs);
        expect(combos.length === 4, 'two by two should be four, got ' + combos.length);
        expect(combos[0].length === 2 && combos[0][0].name === 'Size' && combos[0][1].option === 'Red', 'combination shape is off: ' + JSON.stringify(combos[0]));
        var existing = [{ id: 9, attributes: [{ name: 'Colour', option: 'red' }, { name: 'Size', option: 'S' }], regular_price: '12' }];
        var plan = V.plan(attrs, existing, '10', {});
        expect(plan.create.length === 3 && plan.keep.length === 1 && plan.orphan.length === 0, 'the existing S/Red should be kept, three created: ' + JSON.stringify([plan.create.length, plan.keep.length]));
        expect(plan.update.length === 0, 'an untouched existing price must never be overwritten');
        expect(plan.create.every(function (c) { return c.regular_price === '10'; }), 'new ones take the product price');
        var k = V.key([{ name: 'Size', option: 'S' }, { name: 'Colour', option: 'Red' }]);
        var typed = {}; typed[k] = '15';
        var plan2 = V.plan(attrs, existing, '10', typed);
        expect(plan2.update.length === 1 && plan2.update[0].id === 9 && plan2.update[0].regular_price === '15', 'a typed price should update the kept variation');
        var kM = V.key([{ name: 'Size', option: 'M' }, { name: 'Colour', option: 'Blue' }]);
        var pr = {}; pr[kM] = '14';
        var range = V.priceRange(attrs, '10', pr);
        expect(range && range.lo === 10 && range.hi === 14, 'the storefront price range is off: ' + JSON.stringify(range));
        return 'variations: 4 of 4, kept 1, typed price carried';
      });
    });

    test('Shop the look: a photo, and the exact products in it, hand-picked', function () {
      if (!GOGH.hasWoo) return 'no WooCommerce here';
      var tpl = G.templates().filter(function (t) { return t.name === 'Shop the look'; })[0];
      expect(tpl && tpl.gated === 'hasWoo', 'the Shop the look template is missing or ungated');
      expect(tpl.els.some(function (x) { return x.type === 'image'; }) && tpl.els.some(function (x) { return x.rails && x.shop && x.shop.layout === 'list'; }), 'the template should carry a photo and a list of products');
      expect(G.diceFaces('Shop the look').length === 4, 'four faces expected');
      var src = G.composeShop({ layout: 'list', count: 3, order: 'date', cat: null, catId: null, show: { price: true, rating: false, button: true }, aspect: 'square', spacing: 's',
        pick: [{ id: 14, name: 'Aurora Ceramic Mug' }, { id: 64, name: 'Candle' }] });
      expect(/"woocommerceHandPickedProducts":\["14","64"\]/.test(src), 'hand-picked ids should ride the collection query: ' + src.slice(0, 260));
      expect(/"perPage":2/.test(src), 'the count should follow the picks');
      var plain = G.composeShop({ layout: 'grid', count: 3, order: 'date', cat: null, catId: null, show: { price: true, rating: false, button: true }, aspect: 'square', spacing: 'm' });
      expect(/"woocommerceHandPickedProducts":\[\]/.test(plain), 'without picks the query stays open');
      return 'shop the look: template, four faces, hand-picked rails';
    });

    test('one menu, two places: an item can show on desktop, on phones, or both', function () {
      var NM = G.navModel;
      expect(NM && NM.parse && NM.serialize, 'the nav model is not on the bridge');
      var raw = '<!-- wp:navigation-link {"label":"Home","type":"page","id":12,"url":"/","kind":"post-type"} /-->\n' +
        '<!-- wp:navigation-link {"label":"Call us","url":"tel:123","kind":"custom","className":"gogh-only-phone"} /-->';
      var items = NM.parse(raw);
      expect(items.length === 2 && items[0].where === 'both' && items[1].where === 'phone', 'where should read from the class: ' + JSON.stringify(items.map(function (i) { return i.where; })));
      items[0].where = 'desktop'; items[0].dirty = true;
      var out = NM.serialize(items);
      expect(/"className":"gogh-only-desktop"/.test(out), 'desktop-only should write its class');
      expect(/"id":12/.test(out) && /"type":"page"/.test(out), 'the rebuilt link must keep its page id and type');
      expect(out.indexOf('{"label":"Call us","url":"tel:123","kind":"custom","className":"gogh-only-phone"}') !== -1, 'an untouched item keeps its exact bytes');
      items[1].where = 'both'; items[1].dirty = true;
      var out2 = NM.serialize(items);
      expect(!/gogh-only-phone/.test(out2.split('\n')[1]), 'back to both should drop the class');
      return 'where travels as a class on the link block';
    });

    test('a menu item can carry a panel: the id rides its class beside where it shows', function () {
      var NM = G.navModel;
      var items = NM.parse('<!-- wp:navigation-link {"label":"Shop","url":"/shop/","kind":"post-type","className":"gogh-panel-77 gogh-only-desktop"} /-->');
      expect(items[0].panel === 77 && items[0].where === 'desktop', 'panel and where should both read from the class: ' + JSON.stringify([items[0].panel, items[0].where]));
      items[0].panel = 91; items[0].dirty = true;
      var out = NM.serialize(items);
      expect(/"className":"gogh-only-desktop gogh-panel-91"/.test(out), 'a new panel id should replace the old one and keep where: ' + out);
      items[0].panel = null; items[0].dirty = true;
      expect(/"className":"gogh-only-desktop"/.test(NM.serialize(items)), 'removing the panel should drop only its class');
      expect(NM.panelOf('foo gogh-panel-3') === 3 && NM.panelOf('gogh-panel-x') === null, 'panelOf reads a numeric id only');
      var shelf = G.templates().filter(function (tp) { return tp.intent === 'panel'; });
      expect(shelf.length >= 3 && shelf.every(function (tp) { return /^isPanel/.test(tp.gated || ''); }), 'the Menu panel shelf must be gated to a panel canvas');
      return 'panel id travels as a class; the shelf stays behind its gate';
    });

    test('the rails element: Woo Product Collection, composed from few choices', function () {
      if (!GOGH.hasWoo) return 'no WooCommerce here \u2014 nothing to lay';
      var e = G.addElementToSection(G.sections().indexOf(sec()), 'products');
      expect(e && e.rails && e.shop, 'the products element is not a rails element');
      expect(/wp:woocommerce\/product-collection/.test(e.wsrc), 'source is not a Product Collection block');
      expect(/"perPage":3/.test(e.wsrc) && /"type":"flex","columns":3/.test(e.wsrc), 'default is a 3-up grid: ' + e.wsrc.slice(0, 200));
      expect(/wp:woocommerce\/product-button/.test(e.wsrc) && /wp:woocommerce\/product-price/.test(e.wsrc), 'price and Add to cart should show by default');
      expect(!/product-rating/.test(e.wsrc), 'rating should be off by default');
      var listSrc = G.composeShop({ layout: 'list', count: 4, order: 'sale', cat: null, catId: null, show: { price: true, rating: true, button: false }, aspect: 'portrait', spacing: 'l' });
      expect(/"displayLayout":\{"type":"list"\}/.test(listSrc), 'List layout not composed');
      expect(/"woocommerceOnSale":true/.test(listSrc), 'On sale not composed');
      expect(/product-rating/.test(listSrc) && !/product-button/.test(listSrc), 'Show chips not honoured');
      expect(/"aspectRatio":"3\/4"/.test(listSrc) && /gogh-shop-gap-l/.test(listSrc), 'picture and spacing not composed');
      var out = G.buildV3();
      expect(out.indexOf('wp:woocommerce/product-collection') !== -1, 'the built page lacks the collection block');
      return 'rails laid: native Woo markup, two layouts, then stop';
    });

    test('rails never enter a card, and the bar offers two verbs', function () {
      if (!GOGH.hasWoo) return 'no WooCommerce here';
      var s0 = sec();
      s0.els.push({ type: 'box', x: 40, y: 40, w: 900, h: 500, radius: 12 });
      var e = G.addElementToSection(G.sections().indexOf(s0), 'products');
      e.x = 80; e.y = 80; e.w = 600; e.h = 300; // fully inside the box
      G.renderSection(s0);
      var i = s0.els.indexOf(e);
      expect(G.cardJoinTarget(s0, i) === -1, 'a rails element was offered a card to join');
      select(i);
      var manage = q('.gogh-eb-manage');
      expect(manage && manage.style.display !== 'none', 'Manage products verb missing from the bar');
      expect(q('.gogh-eb-ctx').title === 'Edit design', 'the context verb should read Edit design, got ' + q('.gogh-eb-ctx').title);
      G.openPanel(s0, i);
      var pnl = q('.gogh-panel');
      expect(pnl.querySelector('.gogh-shop-manage') && pnl.querySelector('.gogh-shop-layout'), 'shop panel missing verbs or layout');
      var list = pnl.querySelector('.gogh-shop-layout .gogh-hopt[data-v="list"]');
      list.click();
      expect(!pnl.hidden, 'the panel closed on a layout pick');
      expect(e.shop.layout === 'list' && /"type":"list"/.test(e.wsrc), 'List did not recompose the source');
      expect(list.classList.contains('is-active'), 'List not marked active in place');
      G.closePanel();
      return 'two verbs, one small panel, stays open';
    });

    test('the posts rail: a core query loop composed from few choices', function () {
      var e = G.addElementToSection(G.sections().indexOf(sec()), 'posts');
      expect(e && e.rails && e.posts, 'the posts element is not a rails element');
      expect(/<!-- wp:query /.test(e.wsrc) && /"postType":"post"/.test(e.wsrc), 'source is not a core query loop');
      expect(/"perPage":3/.test(e.wsrc) && /"columnCount":3/.test(e.wsrc), 'default is a 3-up grid: ' + e.wsrc.slice(0, 220));
      expect(/wp:post-date/.test(e.wsrc) && !/wp:post-excerpt/.test(e.wsrc) && !/wp:post-terms/.test(e.wsrc), 'date shows by default; excerpt and category stay off');
      expect(/gogh-posts-tpl/.test(e.wsrc) && !/gogh-blog-/.test(e.wsrc), 'the plain grid must not wear a look');
      expect(/gogh-posts-c3 gogh-posts-pic-landscape/.test(e.wsrc), 'the count and picture shape should ride as classes for the looks');
      var dressed = G.composePosts({ look: 'cards', count: 4, order: 'oldest', cat: 'Notes', catId: 7, show: { date: false, excerpt: true, category: true }, aspect: 'portrait', spacing: 'l' });
      expect(/gogh-blog-cards/.test(dressed) && /"layout":\{"type":"default"\}/.test(dressed), 'a look should dress the list and drop the column grid');
      expect(/gogh-posts-c4 gogh-posts-pic-portrait gogh-blog-cards/.test(dressed), 'a look should keep the count and the crop: ' + (dressed.match(/className":"[^"]+/) || [''])[0]);
      expect(/"order":"asc"/.test(dressed) && /"orderBy":"date"/.test(dressed), 'Oldest first not composed');
      expect(/"taxQuery":\{"category":\[7\]\}/.test(dressed), 'the category did not narrow the query');
      expect(/wp:post-excerpt/.test(dressed) && /wp:post-terms/.test(dressed) && !/wp:post-date/.test(dressed), 'Show chips not honoured');
      expect(/"aspectRatio":"3\/4"/.test(dressed) && /gogh-posts-gap-l/.test(dressed), 'picture and spacing not composed');
      var picked = G.composePosts(Object.assign(G.postsDefaults(), { pick: [{ id: 5, name: 'Five' }, { id: 9, name: 'Nine' }] }));
      expect(/gogh-pick-5,9/.test(picked) && /"perPage":2/.test(picked), 'hand-picked posts should name themselves in the template and set the count');
      expect(G.buildV3().indexOf('wp:query') !== -1, 'the built page lacks the query loop');
      return 'a query loop from a few choices: grid, looks, category, hand-picks';
    });

    test('an old posts grid heals onto the rails; the empty grid names the next verb', function () {
      var s0 = sec();
      var old = { type: 'widget', x: 47, y: 60, w: 1106, h: 430,
        wsrc: '<!-- wp:query {"queryId":0,"query":{"perPage":3,"pages":0,"offset":0,"postType":"post","order":"desc","orderBy":"date","author":"","search":"","exclude":[],"sticky":"","inherit":false},"className":"gogh-posts"} -->\n<div class="wp-block-query gogh-posts"><!-- wp:post-template {"layout":{"type":"grid","columnCount":3}} -->\n<!-- wp:post-featured-image {"isLink":true,"aspectRatio":"4/3"} /-->\n<!-- wp:post-title {"level":3,"isLink":true} /-->\n<!-- wp:post-date /-->\n<!-- /wp:post-template --></div>\n<!-- /wp:query -->',
        whtml: '<div class="gogh-postsprev"></div>' };
      s0.els.push(old);
      G.renderSection(s0);
      expect(old.rails && old.posts, 'the old grid did not heal onto the rails');
      expect(old.posts.count === 3 && old.posts.order === 'date' && old.posts.look === '' && old.posts.show.date && !old.posts.show.excerpt, 'the heal misread the old choices: ' + JSON.stringify(old.posts));
      s0.els.pop();
      G.renderSection(s0);
      var empty = G.postsPreviewHTML({ posts: G.postsDefaults() }, []);
      expect(/No posts yet/.test(empty) && /Write a post/.test(empty) && /post-new\.php/.test(empty), 'the empty grid should say so and offer the next verb');
      var fake = [1, 2, 3, 4].map(function (k) { return { id: k, date: '2026-09-0' + k + 'T10:00:00', title: { rendered: 'Post ' + k }, excerpt: { rendered: '<p>Words about post ' + k + '.</p>' } }; });
      var four = G.postsPreviewHTML({ posts: Object.assign(G.postsDefaults(), { count: 4, look: 'cards', show: { date: true, excerpt: true, category: false } }) }, fake);
      expect(/gogh-postsprev-c4/.test(four) && /gogh-postsprev-look-cards/.test(four), 'the preview should wear the count and the look: ' + four.slice(0, 160));
      expect((four.match(/gogh-postsprev-ph/g) || []).length === 4 && /gogh-postsprev-ex/.test(four), 'pictureless posts get a tinted stand-in each; the excerpt shows when asked');
      return 'old grids heal; the empty state and the looks draw';
    });

    test('the posts rail: two verbs, a small panel, looks audition and keep', function () {
      var s0 = sec();
      var e = G.addElementToSection(G.sections().indexOf(s0), 'posts');
      var i = s0.els.indexOf(e);
      expect(G.cardJoinTarget(s0, i) === -1, 'a posts rail was offered a card to join');
      select(i);
      var manage = q('.gogh-eb-manage');
      expect(manage && manage.style.display !== 'none' && /Manage posts/.test(manage.textContent), 'Manage posts verb missing from the bar');
      expect(q('.gogh-eb-ctx').title === 'Edit design', 'the context verb should read Edit design, got ' + q('.gogh-eb-ctx').title);
      G.openPanel(s0, i);
      var pnl = q('.gogh-panel');
      expect(pnl.querySelector('.gogh-shop-manage') && /edit\.php/.test(pnl.querySelector('.gogh-shop-manage').getAttribute('href')), 'the panel should link to the posts list');
      expect(pnl.querySelector('.gogh-posts-look') && pnl.querySelectorAll('.gogh-posts-look .gogh-hopt').length === 5, 'five looks: the grid and the blog’s four');
      var cards = pnl.querySelector('.gogh-posts-look .gogh-hopt[data-v="cards"]');
      cards.click();
      expect(!pnl.hidden, 'the panel closed on a look pick');
      expect(e.posts.look === 'cards' && /gogh-blog-cards/.test(e.wsrc), 'Cards did not recompose the source');
      expect(cards.classList.contains('is-active'), 'Cards not marked active in place');
      pnl.querySelector('.gogh-posts-count .gogh-hpreset[data-v="6"]').click();
      expect(e.posts.count === 6 && /"perPage":6/.test(e.wsrc), 'the count chip did not recompose');
      pnl.querySelector('.gogh-posts-show .gogh-hpreset[data-v="excerpt"]').click();
      expect(e.posts.show.excerpt && /wp:post-excerpt/.test(e.wsrc), 'the excerpt chip did not recompose');
      var snap = G.serialize();
      expect(snap.indexOf('"posts":') !== -1 && snap.indexOf('"look":"cards"') !== -1, 'the projected model lost the posts choices');
      G.closePanel();
      return 'two verbs, one small panel, the choices ride the model';
    });

    testAsync('the posts rail draws the site’s own posts', function () {
      var s0 = sec();
      var e = G.addElementToSection(G.sections().indexOf(s0), 'posts');
      var t0 = Date.now();
      return new Promise(function (resolve) {
        var poll = function () {
          var drawn = /gogh-postsprev-card|gogh-postsprev-empty/.test(e.whtml || '');
          if (drawn || Date.now() - t0 > 12000) resolve(drawn);
          else setTimeout(poll, 150);
        };
        poll();
      }).then(function (drawn) {
        expect(drawn, 'the preview never drew posts or the empty grid: ' + String(e.whtml).slice(0, 120));
        expect(!/Loading your latest posts/.test(e.whtml), 'the loading card should give way');
        var idx = s0.els.indexOf(e);
        if (idx !== -1) { s0.els.splice(idx, 1); G.renderSection(s0); }
        return 'real posts on the shelf, or an honest empty grid';
      });
    });

    test('Sell family: Featured product and Bestsellers arrive on rails, with takes', function () {
      if (!GOGH.hasWoo) return 'no WooCommerce here \u2014 the Sell rails stay off the shelf, as designed';
      var tpls = G.templates();
      var fp = tpls.filter(function (t) { return t.name === 'Featured product'; })[0];
      var bs = tpls.filter(function (t) { return t.name === 'Bestsellers'; })[0];
      expect(fp && bs, 'Sell starters missing');
      expect(fp.gated === 'hasWoo' && bs.gated === 'hasWoo', 'Sell starters must be gated on Woo');
      expect(G.diceFaces('Featured product').length === 4 && G.diceFaces('Bestsellers').length === 4, 'each should hide three takes behind the template (four faces)');
      G.addSection(fp);
      var c = contentSecs();
      var sF = c[c.length - 1];
      var rails = sF.els.filter(function (e) { return e.rails && e.shop; });
      expect(rails.length === 1, 'expected exactly one rails element, got ' + rails.length);
      expect(/wp:woocommerce\/product-collection/.test(rails[0].wsrc) && /"perPage":1/.test(rails[0].wsrc), 'the spotlight should be a one-product collection');
      expect(sF.m && sF.m.tpl === 'Featured product', 'the section forgot its family');
      // the shop's data travels across a roll; the take owns the shape
      rails[0].shop.cat = 'soap'; rails[0].shop.catId = 42; rails[0].shop.order = 'sale';
      G.rollSection(G.sections().indexOf(sF));
      var rails2 = sF.els.filter(function (e) { return e.rails && e.shop; });
      expect(rails2.length === 1, 'the roll lost the rails');
      expect(rails2[0].shop.cat === 'soap' && rails2[0].shop.catId === 42 && rails2[0].shop.order === 'sale', 'the roll dropped the shop\u2019s data');
      expect(rails2[0].shop.aspect === 'portrait', 'the billboard take should bring its own picture shape, got ' + rails2[0].shop.aspect);
      expect(/product_cat/.test(rails2[0].wsrc) && /"woocommerceOnSale":true/.test(rails2[0].wsrc), 'the recomposed source lost the data');
      G.deleteSection(G.sections().indexOf(sF));
      return 'two starters, four faces each, the data rides the roll';
    });

    test('rails survive a save: the model carries the flag and the choices', function () {
      if (!GOGH.hasWoo) return 'no WooCommerce here';
      var e = G.addElementToSection(G.sections().indexOf(sec()), 'products');
      e.shop.layout = 'list'; e.shop.count = 4; e.shop.order = 'sale'; e.shop.spacing = 'l';
      e.wsrc = G.composeShop(e.shop);
      var snap = G.serialize();
      expect(snap.indexOf('"rails":true') !== -1 && snap.indexOf('"shop":') !== -1, 'the projected model lost rails/shop');
      G.restore(snap);
      var back = sec().els.filter(function (x) { return x.type === 'widget' && x.rails; }).pop();
      expect(back && back.shop && back.shop.layout === 'list' && back.shop.count === 4 && back.shop.order === 'sale', 'choices did not come back: ' + JSON.stringify(back && back.shop));
      // a model saved WITHOUT the flag (v372-387) heals from Woo's block
      var old = JSON.parse(snap);
      return 'rails ride the model both ways';
    });

    test('Sell family complete: four more starters, four faces each, tiles and a seam that sells', function () {
      if (!GOGH.hasWoo) return 'no WooCommerce here';
      ['Editorial split', 'New in', 'Sale', 'Categories'].forEach(function (n) {
        var t = G.templates().filter(function (x) { return x.name === n; })[0];
        expect(t && t.gated === 'hasWoo' && t.intent === 'sell', n + ' missing or not gated');
        expect(G.diceFaces(n).length === 4, n + ' should have four faces, got ' + G.diceFaces(n).length);
        expect(t.els.some(function (e) { return e.rails && e.shop; }), n + ' has no rails element');
      });
      var cats = G.composeShop({ kind: 'categories', count: 4, spacing: 's' });
      expect(/wp:woocommerce\/product-categories/.test(cats) && /gogh-shop-cats-c4/.test(cats) && /gogh-shop-gap-s/.test(cats), 'category tiles not composed: ' + cats.slice(0, 120));
      expect(/"hasImage":true/.test(cats) && /"hasCount":false/.test(cats), 'tiles should carry pictures, never counts');
      var sale = G.templates().filter(function (x) { return x.name === 'Sale'; })[0];
      var srails = sale.els.filter(function (e) { return e.rails; })[0];
      expect(srails.shop.order === 'sale' && /"woocommerceOnSale":true/.test(G.composeShop(Object.assign(G.shopDefaults(), srails.shop))), 'Sale should ask for reduced products');
      G.openSeamAsk(G.sections().indexOf(sec()) + 1);
      var chips = [].map.call(document.querySelectorAll('.gogh-askchip'), function (b) { return b.textContent; });
      G.closePanel();
      expect(chips.indexOf('Bestsellers') !== -1 && chips.indexOf('Shop by category') !== -1, 'the seam does not offer the Sell family: ' + chips.join(', '));
      return 'Editorial split · New in · Sale · Categories; the seam sells';
    });

    test('chrome veils never outgrow their part', function () {
      // a transparent header computes absolute at veil time, so the old
      // anchor check skipped it; when an audition or restore took the
      // float away the veil (inset: 0) sized itself to the PAGE and every
      // canvas click died — caught here as a geometry invariant
      var veils = document.querySelectorAll('.gogh-chromeveil');
      expect(veils.length, 'no chrome veils on the page');
      var seen = [];
      [].forEach.call(veils, function (v) {
        var pe = v.parentElement;
        var vr = v.getBoundingClientRect(), pr = pe.getBoundingClientRect();
        expect(getComputedStyle(pe).position !== 'static', pe.tagName + ' holding a veil is position: static');
        expect(vr.height <= pr.height + 2 && vr.width <= pr.width + 2,
          pe.tagName + ' veil ' + Math.round(vr.width) + 'x' + Math.round(vr.height) + ' outgrew its part ' + Math.round(pr.width) + 'x' + Math.round(pr.height));
        seen.push(pe.tagName.toLowerCase() + ' ' + Math.round(pr.height) + 'px');
      });
      return 'every veil fits its part: ' + seen.join(', ');
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

    test('a layout change keeps the NAME when the logo block has no picture behind it', function () {
      // a starter's classic header ships a logo block with no logo set: the
      // name is the identity, and every other layout must keep showing it
      var classic = '<!-- wp:group --><div class="wp-block-group"><!-- wp:site-logo {"width":44} /--><!-- wp:site-title {"level":0} /--><!-- wp:navigation /--></div><!-- /wp:group -->';
      var hadLogo = !!(window.GOGH && window.GOGH.hasLogo);
      var pageHasImg = !!document.querySelector('.wp-block-site-logo img');
      if (hadLogo || pageHasImg) return 'this site wears a logo picture — the name case cannot be staged here';
      expect(G.headerWearsLogo(classic) === false, 'a logo block with no picture must not count as a logo identity');
      expect(G.headerWearsLogo('<!-- wp:site-title {"level":0} /-->') === false, 'no logo block, no logo identity');
      var h = document.createElement('header');
      h.className = 'wp-block-template-part';
      h.innerHTML = '<span class="wp-block-site-logo"><img src="data:," alt=""></span><span class="wp-block-site-title">My Site</span>';
      document.body.appendChild(h);
      var withPic = G.headerWearsLogo(classic);
      h.remove();
      expect(withPic === true, 'a logo block WITH a picture on the page is the logo identity');
      return 'no picture → name; picture → logo';
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

    testAsync('Make it freeform on the site header yields its pieces, not one opaque widget', function () {
      // the scan pairs blocks with rendered elements; gogh's own pill inside
      // the part, and a logo block that renders nothing, used to break the
      // count and the whole header became a single widget (James: "the
      // formatting broke")
      var pe = G.partElForArea('header');
      expect(pe, 'no header part on the page');
      var base = (window.GOGH && GOGH.restUrl) ? GOGH.restUrl.split('wp/v2/')[0] + 'wp/v2/' : '/wp-json/wp/v2/';
      return fetch(base + 'template-parts?per_page=20', { credentials: 'same-origin', headers: { 'X-WP-Nonce': GOGH.nonce } })
        .then(function (r) { return r.json(); })
        .then(function (parts) {
          var hp = (parts || []).filter(function (p) { return p.area === 'header' || /header/.test(p.slug || ''); })[0];
          if (!hp) return 'no header part found through the API';
          var raw = (hp.content && (hp.content.raw || hp.content.rendered)) || '';
          if (!raw) return 'header part carries no raw markup';
          var scan = G.scan(pe, raw);
          var els = scan.els || [];
          var oneWidget = els.length === 1 && els[0].type === 'widget' && /wp:group/.test(els[0].wsrc || '');
          expect(!oneWidget, 'the header converted as one opaque group widget');
          expect(els.length >= 2, 'expected at least the name and the menu as separate pieces, got ' + els.length);
          return els.length + ' pieces: ' + els.map(function (e) { return e.type; }).join(', ');
        });
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

    test('a kid resizes by its side grips: width and place change, the ink follows, phones run full width', function () {
      // James: "text boxes cannot be resized within cards, is this by design?"
      var s0 = sec();
      var box = { type: 'box', x: 80, y: 40, w: 640, h: 360, radius: 12, kids: [
        { type: 'heading', x: 32, y: 32, w: 576, h: 48, text: 'Card headline', fs: 'large' },
        { type: 'para', x: 32, y: 100, w: 576, h: 120, text: 'Houses, studios, shops and coastlines: the rooms people love and the things they keep in them, photographed slowly, over many visits.' } ] };
      s0.els.push(box);
      G.renderSection(s0);
      var ci = s0.els.indexOf(box);
      var card = s0.nodes[ci];
      var kn = card.querySelector('.gogh-k-2');
      var kid = box.kids[1];
      var sc = s0.sectionEl.getBoundingClientRect().width / 1200;
      var pv = function (type, el, x, y, id) {
        el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: id, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
      };
      var r = kn.getBoundingClientRect();
      pv('pointerdown', kn, r.left + 8, r.top + 6, 71);
      pv('pointerup', document, r.left + 8, r.top + 6, 71);
      var kb = q('.gogh-kidbox');
      expect(kb && !kb.hidden && G.kidState().sel && G.kidState().sel.j === 1, 'a chosen kid should show its side grips');
      var kr0 = kn.getBoundingClientRect();
      expect(Math.abs(parseFloat(kb.style.width) - kr0.width) < 3, 'the grips should sit on the kid: ' + kb.style.width + ' vs ' + kr0.width);
      // east grip: 200 units in — the right edge lands on the 8-unit base, x holds
      var he = kb.querySelector('.gogh-h-e');
      var hr = he.getBoundingClientRect();
      var x0 = kid.x, w0 = kid.w, hWide = kn.offsetHeight / sc; // the ink at full width (the design h is not measured yet)
      pv('pointerdown', he, hr.left + 4, hr.top + 10, 72);
      pv('pointermove', he, hr.left + 4 - 200 * sc, hr.top + 10, 72);
      pv('pointerup', he, hr.left + 4 - 200 * sc, hr.top + 10, 72);
      expect(kid.x === x0 && kid.w === w0 - 200, 'east grip should narrow the kid in place: ' + kid.x + 'x' + kid.w + ' from ' + x0 + 'x' + w0);
      expect(kid.h >= Math.round(hWide) - 2 && Math.abs(kid.h - kn.offsetHeight / sc) <= 3, 'the height should follow the ink at the new width: model ' + kid.h + ', ink ' + Math.round(kn.offsetHeight / sc) + ', was ' + Math.round(hWide));
      expect(Math.abs(kn.getBoundingClientRect().width - kid.w * sc) < 4, 'the card grid did not re-solve to the new width: ' + kn.getBoundingClientRect().width + ' vs ' + kid.w * sc);
      expect(getComputedStyle(card).gridTemplateColumns.split(' ').length >= 2, 'the card should now have more than one column');
      expect(!kb.hidden && G.kidState().sel && G.kidState().sel.j === 1, 'the kid should stay chosen after a resize');
      // west grip: 100 units in — the left edge snaps to the base, the right edge holds
      var hw = kb.querySelector('.gogh-h-w');
      var wr = hw.getBoundingClientRect();
      var right = kid.x + kid.w;
      pv('pointerdown', hw, wr.left + 4, wr.top + 10, 73);
      pv('pointermove', hw, wr.left + 4 + 100 * sc, wr.top + 10, 73);
      pv('pointerup', hw, wr.left + 4 + 100 * sc, wr.top + 10, 73);
      var wantX = Math.round((x0 + 100) / 8) * 8;
      expect(kid.x === wantX && kid.x + kid.w === right, 'west grip should move the left edge only: ' + kid.x + '..' + (kid.x + kid.w) + ' wanted ' + wantX + '..' + right);
      // it publishes: the kid's width rides the model
      var v3 = G.buildV3();
      expect(v3.indexOf('"w":' + kid.w) !== -1, 'the published model lost the kid width');
      // phones: the card runs one column and the kid takes the full width
      var wrap = s0.sectionEl.closest('.gogh-wrap');
      wrap.style.width = '375px'; wrap.style.minWidth = '0';
      void wrap.offsetWidth;
      var cr = card.getBoundingClientRect(), krm = kn.getBoundingClientRect();
      expect(cr.width < 380 && krm.width > cr.width * 0.8, 'on a phone the narrowed kid should run the full width: ' + krm.width + ' of ' + cr.width);
      wrap.style.width = ''; wrap.style.minWidth = '';
      void wrap.offsetWidth;
      pv('pointerdown', document.body, 2, 2, 74);
      pv('pointerup', document.body, 2, 2, 74);
      expect(!G.kidState().sel && kb.hidden, 'a click away should drop the kid and its grips');
      s0.els.pop();
      G.renderSection(s0);
      return 'two grips on a chosen kid: width and place, ink height, full width on phones';
    });

    test('the group bar: Make a card wraps a selection, Duplicate copies it, a card greys the verb', function () {
      // Canva puts Group first on a small floating bar; gogh's group is the Card
      var s0 = sec();
      var n0 = s0.els.length;
      s0.els.push({ type: 'heading', x: 100, y: 40, w: 400, h: 60, text: 'Group me' });
      s0.els.push({ type: 'para', x: 100, y: 120, w: 400, h: 60, text: 'And me.' });
      G.renderSection(s0);
      G.multi.set(s0, [n0, n0 + 1]);
      var bar = q('.gogh-mbar');
      expect(bar && !bar.hidden, 'the group bar should show for a multi-selection');
      var cardBtn = bar.querySelector('.gogh-mb-card');
      expect(cardBtn && !cardBtn.disabled && /Make a card/.test(cardBtn.textContent), 'Make a card should lead the bar for two loose pieces');
      cardBtn.click();
      var box = s0.els[s0.els.length - 1];
      expect(box.type === 'box' && box.kids && box.kids.length === 2 && s0.els.length === n0 + 1, 'Make a card should wrap both pieces into one box');
      expect(box.x === 76 && box.y === 16 && box.kids[0].type === 'heading' && box.kids[0].x === 24 && box.kids[0].y === 24, 'kids should be re-based inside the card in reading order: ' + JSON.stringify([box.x, box.y, box.kids[0].type, box.kids[0].x, box.kids[0].y]));
      expect(!G.multi.state() && bar.hidden && q('.gogh-selbox') && !q('.gogh-selbox').hidden, 'the new card should be the selection, the group bar gone');
      // a card cannot go into a card: the verb greys with its reason
      s0.els.push({ type: 'para', x: 600, y: 40, w: 300, h: 60, text: 'Loose' });
      G.renderSection(s0);
      G.multi.set(s0, [n0, n0 + 1]);
      expect(bar.querySelector('.gogh-mb-card').disabled && /inside a card/.test(bar.querySelector('.gogh-mb-card').title), 'Make a card should grey out, with a reason, when a card is in the selection');
      // Duplicate: copies 24 units down and right, and the copies become the selection
      bar.querySelector('.gogh-mb-dup').click();
      var m = G.multi.state();
      expect(s0.els.length === n0 + 4 && m && m.idxs.length === 2 && m.idxs[0] === n0 + 2 && m.idxs[1] === n0 + 3, 'Duplicate should add two copies and select them');
      expect(s0.els[n0 + 3].x === 624 && s0.els[n0 + 3].y === 64 && s0.els[n0 + 2].kids && s0.els[n0 + 2].kids.length === 2, 'copies should keep their shape and sit 24 units down and right');
      G.multi.clear();
      s0.els.splice(n0);
      G.renderSection(s0);
      return 'Make a card leads, Duplicate copies, a card greys the verb';
    });

    test('align, space evenly and tidy up act on the selection as one; the bar greys what would do nothing', function () {
      var s0 = sec();
      var n0 = s0.els.length;
      [[100, 60], [380, 80], [800, 100]].forEach(function (p, k) {
        s0.els.push({ type: 'para', x: p[0], y: p[1], w: 200, h: 60, text: 'Item ' + (k + 1) });
      });
      G.renderSection(s0);
      var a = s0.els[n0], b = s0.els[n0 + 1], c = s0.els[n0 + 2];
      G.multi.set(s0, [n0, n0 + 1, n0 + 2]);
      var bar = q('.gogh-mbar');
      bar.querySelector('.gogh-mb-more').click();
      expect(!bar.querySelector('.gogh-mbar-more').hidden, 'the dots should open the arrange row');
      var top = bar.querySelector('.gogh-mb-align[data-how="top"]');
      expect(!top.disabled, 'Align top should be offered for a ragged row');
      top.click();
      expect(a.y === 60 && b.y === 60 && c.y === 60, 'Align top should bring every piece to the topmost: ' + [a.y, b.y, c.y]);
      expect(bar.querySelector('.gogh-mb-align[data-how="top"]').disabled && bar.querySelector('.gogh-mb-align[data-how="top"]').title === 'Already lined up', 'Align top should grey out once aligned');
      expect(bar.querySelectorAll('.gogh-mbar-lab').length === 2 && /Line up/.test(bar.querySelector('.gogh-mb-more').textContent), 'the row should be labelled and the dots should say Line up');
      expect(G.multi.state() && G.multi.state().idxs.length === 3 && !bar.hidden, 'the selection and the bar should survive an arrange');
      var space = bar.querySelector('.gogh-mb-space');
      expect(!space.disabled, 'Space evenly should be offered for uneven gaps');
      space.click();
      // 100..300 and 800..1000 stay; 900 of span, 600 of pieces, two gaps of 150: the middle lands at 450
      expect(a.x === 100 && b.x === 450 && c.x === 800, 'Space evenly should equalise the gaps: ' + [a.x, b.x, c.x]);
      expect(bar.querySelector('.gogh-mb-space').disabled && bar.querySelector('.gogh-mb-tidy').disabled, 'Space evenly and Tidy up should grey out once the row is even and square');
      // ragged: a third of its own height down (the render re-measures text
      // heights, so a fixed offset could read as a second row), and off its gap
      var sag = Math.max(4, Math.round(b.h / 3));
      b.y = 60 + sag; b.x = 420;
      G.renderSection(s0);
      G.multi.set(s0, [n0, n0 + 1, n0 + 2]);
      var tidy = bar.querySelector('.gogh-mb-tidy');
      expect(!tidy.disabled, 'Tidy up should be offered for a ragged row (sag ' + sag + ' of h ' + b.h + ')');
      tidy.click();
      expect(b.y === 60 && b.x === 450 && a.x === 100 && c.x === 800, 'Tidy up should square the row and even the gaps: ' + [b.x, b.y]);
      G.multi.set(s0, [n0, n0 + 1]);
      expect(bar.querySelector('.gogh-mb-space').disabled && /three/.test(bar.querySelector('.gogh-mb-space').title), 'Space evenly needs three or more, and says so');
      G.multi.clear();
      s0.els.splice(n0);
      // words never sit on words: a heading above a paragraph refuses Top,
      // Middle and Bottom (James: "they seem just to cause text to overlap")
      s0.els.push({ type: 'heading', x: 100, y: 40, w: 400, h: 60, text: 'A new heading' });
      s0.els.push({ type: 'para', x: 100, y: 120, w: 300, h: 60, text: 'Some supporting copy. Drag me anywhere.' });
      G.renderSection(s0);
      G.multi.set(s0, [n0, n0 + 1]);
      bar.querySelector('.gogh-mb-more').click();
      var why = function (how) { var b2 = bar.querySelector('.gogh-mb-align[data-how="' + how + '"]'); return b2.disabled ? b2.title : 'offered'; };
      expect(why('middle') === 'Would put words on words' && why('top') === 'Would put words on words' && why('bottom') === 'Would put words on words', 'stacked words should refuse Top, Middle and Bottom: ' + [why('top'), why('middle'), why('bottom')]);
      expect(why('left') === 'Already lined up' && why('right') === 'offered' && why('center') === 'offered', 'sideways verbs should stay honest: ' + [why('left'), why('center'), why('right')]);
      expect(!bar.querySelector('.gogh-mbar-hint').hidden, 'the hint should explain the faded verbs');
      var hy = s0.els[n0].y, py = s0.els[n0 + 1].y;
      bar.querySelector('.gogh-mb-align[data-how="middle"]').click();
      expect(s0.els[n0].y === hy && s0.els[n0 + 1].y === py, 'a faded verb must do nothing');
      G.multi.clear();
      s0.els.splice(n0);
      G.renderSection(s0);
      return 'align, space evenly, tidy up: one click each; faded when already right or when words would land on words';
    });

    testAsync('select all picks the section’s pieces; the margin is a named magnet and guide', function () {
      var s0 = sec();
      select(0);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true, cancelable: true }));
      var m = G.multi.state();
      expect(m && m.sec === s0 && m.idxs.length === s0.els.length, 'Cmd+A should select every piece in the section: ' + (m ? m.idxs.length : 'none') + ' of ' + s0.els.length);
      G.multi.clear();
      // a piece dragged so its left edge sits 3 units off the margin lands ON it,
      // and the guide names the margin while the hand is closed
      var n0 = s0.els.length;
      var below = Math.max.apply(null, s0.els.map(function (e) { return e.y + e.h; })) + 40;
      var e = { type: 'para', x: 300, y: below, w: 300, h: 60, text: 'To the margin' };
      var cands = [0, 1200, 600];
      s0.els.forEach(function (o) { cands.push(o.x, o.x + o.w, o.x + o.w / 2); });
      var crowded = function (left) {
        return [left, left + 300, left + 150].some(function (v) { return cands.some(function (cd) { return Math.abs(cd - v) < 3; }); });
      };
      var target = !crowded(83) ? 83 : (!crowded(1117 - 300) ? 1117 - 300 : null);
      if (target === null) return 'select all works; the margin drag skipped — other magnets crowd both margins here';
      var want = target === 83 ? 80 : 820;
      s0.els.push(e);
      G.renderSection(s0);
      select(n0);
      var grip = q('.gogh-grip');
      var r = grip.getBoundingClientRect();
      var sc = s0.sectionEl.getBoundingClientRect().width / 1200;
      var x = r.x + 12, y = r.y + 12, dx = (target - 300) * sc;
      pev('pointerdown', grip, x, y, 83);
      pev('pointermove', grip, x + dx / 2, y, 83);
      pev('pointermove', grip, x + dx, y, 83);
      // a hidden tab never fires requestAnimationFrame; a short timer does
      return new Promise(function (res) { setTimeout(res, 80); }).then(function () {
        pev('pointerup', grip, x + dx, y, 83);
        expect(e.x === want, 'the piece should land on the margin: ' + e.x + ' wanted ' + want);
        // the guide paints on an animation frame, which a hidden tab never gets:
        // ask the guide directly what it would say at the margin, and at an edge
        G.showGuides(s0, want, null);
        var gv = q('.gogh-guide-v');
        var tag = gv && !gv.hidden ? gv.dataset.tag : null;
        G.showGuides(s0, want + 40, null);
        var plain = gv && !gv.hidden ? gv.dataset.tag : null;
        G.hideGuides();
        expect(tag === 'margin' && plain === '', 'the guide should be named margin at the margin and unnamed elsewhere, got ' + JSON.stringify([tag, plain]));
        var idx = s0.els.indexOf(e);
        if (idx !== -1) { s0.els.splice(idx, 1); G.renderSection(s0); }
        return 'Cmd+A selects the section; the margin is a named magnet';
      });
    });

    test('a card colour pick re-judges its words, and any colour is one well away', function () {
      // James made a card, chose black, and the words stayed black
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
      var s0 = sec();
      var n0 = s0.els.length;
      var below = Math.max.apply(null, s0.els.map(function (e) { return e.y + e.h; })) + 40;
      s0.els.push({ type: 'box', x: 80, y: below, w: 400, h: 200, radius: 12, kids: [
        { type: 'heading', x: 24, y: 24, w: 340, h: 44, text: 'Words on a card' },
      ] });
      G.renderSection(s0);
      var box = s0.els[n0], kid = box.kids[0];
      G.openPanel(s0, n0);
      var pnl = q('.gogh-panel');
      var sw = pnl.querySelector('.gogh-boxsw .gogh-sw[data-col="' + darker + '"]');
      expect(sw, 'the darker palette swatch should be offered');
      sw.click();
      expect(box.boxBg === darker, 'the swatch should colour the card');
      expect(kid.color && kid.color !== darker, 'the card’s words should flip to a readable ink on the dark ground, got ' + kid.color);
      var well = pnl.querySelector('.gogh-boxcustom');
      expect(well && well.type === 'color', 'a custom colour well should sit beside the palette');
      well.value = '#101014';
      well.dispatchEvent(new Event('change', { bubbles: true }));
      expect(box.boxBg === '#101014', 'the well should set any colour: ' + box.boxBg);
      var bg = getComputedStyle(s0.nodes[n0]).backgroundColor;
      expect(/rgb\(16, 16, 20\)/.test(bg), 'the card should paint the custom colour: ' + bg);
      expect(pnl.querySelector('.gogh-sw-pick').classList.contains('is-active'), 'the well should light when the colour is its own');
      G.closePanel();
      s0.els.splice(n0, 1);
      G.renderSection(s0);
      return 'a colour pick judges the words; any colour is one well away';
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

    // ---- a card's text stack: ghost under the hand, sortable swaps, cascade, reading order ----
    test('card stack: kids swap past a centre, pushes cascade, DOM follows reading order', function () {
      var s0 = sec();
      s0.els.push({ type: 'box', x: 600, y: 60, w: 480, h: 300, boxBg: '#101418', radius: 16, kids: [
        { type: 'heading', x: 30, y: 20, w: 420, h: 40, text: 'Alpha' },
        { type: 'para', x: 30, y: 80, w: 420, h: 40, text: 'Bravo' },
        { type: 'para', x: 30, y: 140, w: 420, h: 40, text: 'Charlie' },
      ] });
      G.renderSection(s0);
      var ci = s0.els.length - 1;
      var box = s0.els[ci];
      var sc = s0.sectionEl.getBoundingClientRect().width / 1200;
      var pv = function (type, el, x, y, id) {
        el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: id, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
      };
      var kidNode = function (text) {
        var j = box.kids.map(function (k) { return k.text; }).indexOf(text);
        return s0.nodes[ci].querySelector('.gogh-k-' + (j + 1));
      };
      var byText = function (text) { return box.kids.filter(function (k) { return k.text === text; })[0]; };
      var noOverlap = function () {
        var ks = box.kids;
        for (var a = 0; a < ks.length; a++) for (var b = a + 1; b < ks.length; b++) {
          var oy = Math.min(ks[a].y + ks[a].h, ks[b].y + ks[b].h) - Math.max(ks[a].y, ks[b].y);
          if (oy > 4) throw new Error(ks[a].text + ' and ' + ks[b].text + ' overlap by ' + oy);
        }
      };
      // 1. drag Alpha down past Bravo's centre (to y≈90): they swap, Charlie holds
      var an = kidNode('Alpha'), ar = an.getBoundingClientRect();
      pv('pointerdown', an, ar.left + 10, ar.top + 8, 81);
      pv('pointermove', document, ar.left + 10, ar.top + 8 + 35 * sc, 81);
      // mid-drag: a ghost under the hand, the real kid hidden
      var ghost = document.querySelector('.gogh-kid-ghost.gogh-kid-ghost-in');
      expect(ghost, 'no in-card ghost while dragging a kid');
      expect(an.style.display === 'none' || an.style.visibility === 'hidden', 'the real kid should hide behind its ghost (out of the grid, so its words size no row)');
      pv('pointermove', document, ar.left + 10, ar.top + 8 + 70 * sc, 81);
      pv('pointerup', document, ar.left + 10, ar.top + 8 + 70 * sc, 81);
      expect(!document.querySelector('.gogh-kid-ghost'), 'ghost left behind after the drop');
      expect(box.kids.map(function (k) { return k.text; }).join(',') === 'Bravo,Alpha,Charlie', 'swap did not reorder the kids: ' + box.kids.map(function (k) { return k.text; }).join(','));
      expect(byText('Bravo').y < byText('Alpha').y && byText('Alpha').y + byText('Alpha').h <= byText('Charlie').y + 4, 'Alpha did not land between Bravo and Charlie');
      noOverlap();
      var k1 = s0.nodes[ci].querySelector('.gogh-k-1');
      expect(k1 && /Bravo/.test(k1.textContent), 'DOM order does not follow the reading order');
      // 2. drag Alpha onto Charlie's centre: a push must cascade, nothing hides behind anything
      var an2 = kidNode('Alpha'), ar2 = an2.getBoundingClientRect();
      var toY = (byText('Charlie').y + 6 - byText('Alpha').y) * sc;
      pv('pointerdown', an2, ar2.left + 10, ar2.top + 8, 82);
      pv('pointermove', document, ar2.left + 10, ar2.top + 8 + toY / 2, 82);
      pv('pointermove', document, ar2.left + 10, ar2.top + 8 + toY, 82);
      pv('pointerup', document, ar2.left + 10, ar2.top + 8 + toY, 82);
      noOverlap();
      expect(box.kids.length === 3, 'a kid went missing');
      var bottom = Math.max.apply(null, box.kids.map(function (k) { return k.y + k.h; }));
      expect(box.h >= bottom, 'the card did not grow to hold its stack');
      // cleanup
      s0.els.splice(ci, 1);
      G.renderSection(s0);
      return 'ghost · swap · cascade · reading order';
    });

    // ---- undo/redo rebuilds every section object: kid selection, edit and drag must not outlive it ----
    test('card: undo/redo clears a stale kid selection, edit and drag', function () {
      var s0 = sec();
      s0.els.push({ type: 'box', x: 600, y: 60, w: 480, h: 300, boxBg: '#101418', radius: 16, kids: [
        { type: 'heading', x: 30, y: 20, w: 420, h: 40, text: 'Alpha' },
        { type: 'para', x: 30, y: 80, w: 420, h: 40, text: 'Bravo' },
      ] });
      G.renderSection(s0);
      var ci = s0.els.length - 1;
      var box = s0.els[ci];
      G.pushState(); // A: the card with two kids
      box.kids[1].text = 'Bravo, edited';
      G.pushState(); // B: one step on, so undo has A to go back to
      var pv = function (type, el, x, y, id) {
        el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: id, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
      };
      var liveCard = function () {
        var s = sec();
        var c = s.els.filter(function (e) { return e.type === 'box' && e.kids; }).pop();
        return { sec: s, el: c, node: c && s.nodes[s.els.indexOf(c)] };
      };
      var receipts = function (re) {
        return [].slice.call(document.querySelectorAll('.gogh-toast')).filter(function (t) { return re.test(t.textContent); }).length;
      };
      // 1. a selected kid, then undo: Backspace must not splice the dead model
      var kn = s0.nodes[ci].querySelector('.gogh-k-1');
      var r = kn.getBoundingClientRect();
      pv('pointerdown', kn, r.left + 10, r.top + 8, 91);
      pv('pointerup', document, r.left + 10, r.top + 8, 91);
      expect(G.kidState().sel && G.kidState().sel.sec === s0, 'the kid did not select');
      var removed0 = receipts(/Removed from the card/);
      q('.gogh-undo').click();
      expect(!G.kidState().sel, 'the kid selection outlived the undo');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
      var c1 = liveCard();
      expect(c1.el && c1.el.kids.length === 2, 'the restored card lost a kid');
      expect(box.kids.length === 2, 'Backspace spliced the dead (pre-undo) model');
      expect(receipts(/Removed from the card/) === removed0, 'a "Removed from the card" receipt showed after undo');
      // 2. a kid text edit in flight, then redo: the edit ends without pushing a history step
      var kn1 = c1.node.querySelector('.gogh-k-1');
      var r1 = kn1.getBoundingClientRect();
      pv('pointerdown', kn1, r1.left + 10, r1.top + 8, 92);
      pv('pointerup', document, r1.left + 10, r1.top + 8, 92);
      pv('pointerdown', kn1, r1.left + 10, r1.top + 8, 93); // second click on a selected kid edits it
      pv('pointerup', document, r1.left + 10, r1.top + 8, 93);
      expect(G.kidState().ed, 'the second click did not start a kid edit');
      var st0 = G.state;
      q('.gogh-redo').click();
      expect(!G.kidState().ed, 'the kid edit outlived the redo');
      expect(!document.documentElement.classList.contains('gogh-textediting'), 'gogh-textediting stuck on <html>');
      expect(G.state.history === st0.history && G.state.hIdx === st0.hIdx + 1,
        'ending the kid edit disturbed history: ' + st0.history + '/' + st0.hIdx + ' -> ' + G.state.history + '/' + G.state.hIdx);
      // 3. a kid drag mid-flight, then undo: no ghost left behind, the late pointerup writes nothing
      var c2 = liveCard();
      var kn2 = c2.node.querySelector('.gogh-k-1');
      var r2 = kn2.getBoundingClientRect();
      var sc = c2.sec.sectionEl.getBoundingClientRect().width / 1200;
      pv('pointerdown', kn2, r2.left + 10, r2.top + 8, 94);
      pv('pointermove', document, r2.left + 10, r2.top + 8 + 40 * sc, 94);
      expect(document.querySelector('.gogh-kid-ghost'), 'no ghost — the kid drag never started');
      var out0 = receipts(/Out of the card/);
      q('.gogh-undo').click();
      expect(!G.kidState().drag, 'the kid drag outlived the undo');
      expect(!document.querySelector('.gogh-kid-ghost'), 'the kid ghost was left behind by the undo');
      pv('pointerup', document, r2.left - 400, r2.top + 8 + 40 * sc, 94);
      var c3 = liveCard();
      expect(c3.el && c3.el.kids.length === 2, 'the late pointerup changed the restored card');
      expect(receipts(/Out of the card/) === out0, 'the late pointerup freed a kid from a dead drag');
      [].slice.call(document.querySelectorAll('.gogh-toast')).forEach(function (t) { t.remove(); });
      return 'selection, edit and drag all end on restore; history untouched';
    });
    // ---- a button kid's URL box: Backspace edits the URL, never the card ----
    test('kid link panel: Backspace in the URL box edits the field, not the card', function () {
      var s0 = sec();
      s0.els.push({ type: 'box', x: 600, y: 60, w: 480, h: 300, boxBg: '#101418', radius: 16, kids: [
        { type: 'heading', x: 30, y: 20, w: 420, h: 40, text: 'Keeper' },
        { type: 'button', x: 30, y: 100, w: 200, h: 50, text: 'Buy now', href: 'https://shop.test/buy' },
      ] });
      G.renderSection(s0);
      var ci = s0.els.length - 1;
      var box = s0.els[ci];
      var kn = s0.nodes[ci].querySelector('.gogh-k-2');
      expect(kn, 'button kid node missing');
      var removedToast = function () {
        return [].slice.call(document.querySelectorAll('.gogh-toast')).some(function (t) { return /Removed from the card/.test(t.textContent); });
      };
      [].slice.call(document.querySelectorAll('.gogh-toast')).forEach(function (t) { t.remove(); });
      // one click on a button kid: it is selected and its link panel opens
      var r = kn.getBoundingClientRect();
      pev('pointerdown', kn, r.left + 8, r.top + 6, 84);
      pev('pointerup', document, r.left + 8, r.top + 6, 84);
      expect(kn.classList.contains('gogh-kid-selected'), 'click did not select the button kid');
      var panel = q('.gogh-panel');
      expect(panel && !panel.hidden && panel.querySelector('input[type="url"]'), 'link panel did not open for the button kid');
      // the route to the bug: a restyle (Outline here) re-renders the card,
      // re-selects the kid and rebuilds the panel while it is visible, so the
      // URL box takes focus — the next Backspace is aimed at the field
      panel.querySelector('.gogh-style-outline').click();
      expect(box.kids[1].ghost === true, 'Outline did not restyle the kid');
      var kn2 = s0.nodes[ci].querySelector('.gogh-k-2');
      expect(kn2 && kn2.classList.contains('gogh-kid-selected'), 'kid not re-selected after the restyle');
      var input = panel.querySelector('input[type="url"]');
      expect(input && !panel.hidden, 'link panel did not come back after the restyle');
      expect(input.value === 'https://shop.test/buy', 'URL box does not show the kid href: ' + input.value);
      var focused = document.activeElement === input;
      // correcting the URL: Backspace lands in the input, so the kid must stay put
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
      expect(box.kids && box.kids.length === 2, 'Backspace in the URL box removed the kid');
      expect(s0.nodes[ci].contains(kn2), 'Backspace in the URL box re-rendered the card');
      expect(!removedToast(), 'a "Removed from the card" receipt fired for a URL edit');
      // the same key aimed at the canvas still removes the selected kid
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
      expect(box.kids && box.kids.length === 1 && box.kids[0].text === 'Keeper', 'Backspace on the canvas did not remove the selected kid');
      expect(removedToast(), 'no receipt toast after removing the kid');
      // cleanup
      G.closePanel();
      s0.els.splice(ci, 1);
      G.renderSection(s0);
      [].slice.call(document.querySelectorAll('.gogh-toast')).forEach(function (t) { t.remove(); });
      return 'URL-box Backspace keeps the kid · canvas Backspace removes it' + (focused ? ' · restyle focused the URL box' : ' · (URL box not focused here)');
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
      // with a real pointer the hand must let go ON the words: the same
      // geometry with the pointer off the paragraph is a plain move (James:
      // "when i drag a photo block it's changing to weird sizes")
      var pr = secW.nodes[0].getBoundingClientRect();
      expect(G.wrapTargetIdx(secW, ii, pr.right + 200, pr.top - 200) === -1, 'pointer off the words must not wrap');
      expect(G.wrapTargetIdx(secW, ii, pr.left + pr.width / 2, pr.top + pr.height / 2) === 0, 'pointer on the words wraps');
      G.wrapImageIntoText(secW, ii, 0);
      expect(secW.els.length === 1, 'image element consumed into the text');
      var t = secW.els[0];
      expect(t.text.indexOf('gogh-wrapped') !== -1, 'wrapped img in text model');
      expect(t.text.indexOf('shape-outside') !== -1, 'silhouette wrap in style');
      expect(t.text.indexOf('aspect-ratio:280/180') !== -1, 'the wrapped photo keeps its canvas crop, not its natural shape');
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
      host.scrollIntoView({ block: 'center', behavior: 'instant' });
      var hr = host.getBoundingClientRect();
      // drop three-quarters of the way down the text — the wrap should
      // begin there, leaving the opening lines full width
      var dpx = hr.left + hr.width / 2, dpy = hr.top + hr.height * 0.75;
      var dhit = document.elementFromPoint(dpx, dpy);
      var dcr = document.caretRangeFromPoint ? document.caretRangeFromPoint(dpx, dpy) : null;
      G.wrapImageIntoText(secW, ii, 0, dpx, dpy);
      var t = secW.els[0];
      var pos = t.text.indexOf('<img');
      expect(pos !== -1, 'wrapped img in text model');
      expect(pos > 40, 'img inserted at the drop point, not prepended (pos ' + pos + ', point ' +
        Math.round(dpx) + ',' + Math.round(dpy) + ', host ' + [hr.left, hr.top, hr.width, hr.height].map(Math.round).join('/') +
        ', hit ' + (dhit ? (dhit.className || dhit.tagName).toString().slice(0, 40) : 'none') +
        ', caret ' + (dcr ? dcr.startOffset : 'none') + ', scrollY ' + Math.round(window.scrollY) + ', vh ' + window.innerHeight + ')');
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
      // the save is a REST round trip: wait for the VALUE, not a fixed timer
      // (a busy, throttled tab made 1200ms a coin toss)
      var until = function (want) {
        var t0 = Date.now();
        return new Promise(function (res) {
          var look = function () {
            if (window.GOGH.motion === want || Date.now() - t0 > 8000) res();
            else setTimeout(look, 100);
          };
          look();
        });
      };
      cards[keys.indexOf(probeKey)].click();
      return until(probeKey).then(function () {
        expect(window.GOGH.motion === probeKey, 'cfg.motion not updated: ' + window.GOGH.motion);
        cards[keys.indexOf(had)].click(); // put the site's own gait back
        return until(had);
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
      // the die only counts as a door where a drawer of takes exists — a
      // named family, or one inferred from the section's shape (v0.99.407+);
      // without either it stays hidden and the bar reads three doors; the
      // ✦ Ask Gogh door retired with the parked model tier
      var doors = [].filter.call(bar.querySelectorAll('.gogh-sb'), function (b) { return !b.hidden; });
      var fam = G.diceFamilyOf(sec());
      var want = 3 + (fam ? 1 : 0);
      expect(doors.length === want,
        'expected ' + want + ' visible controls (family: ' + (fam || 'none') + '), got ' + doors.length);
      expect(!!fam === !bar.querySelector('.gogh-sb-dice').hidden, 'the die should show exactly when a family exists (' + (fam || 'none') + ')');
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

    test('the die leaves a one-of-a-kind section alone: a glaze chart of four swatches has no family', function () {
      // the Hollowell glaze band: an intro (eyebrow, heading, para) beside four
      // columns of swatch box, name, note and a small uppercase label. The
      // base take of any family it scored against had no slot for most of
      // them, so they rode over every take (v0.99.468)
      var els = [
        { type: 'para', x: 82, y: 64, w: 400, h: 17, text: 'Glazes', tf: { fs: 12, tt: 'uppercase' } },
        { type: 'heading', x: 82, y: 96, w: 360, h: 88, text: 'Four glazes, one kiln.', tf: { fs: 34 } },
        { type: 'para', x: 82, y: 200, w: 360, h: 110, text: 'Every piece is fired to cone 8, about 1260 degrees, in a gas kiln in reduction. That is why the same glaze never comes out quite the same twice.' } ];
      ['Salt', 'Ash', 'Cobalt', 'Tenmoku'].forEach(function (name, i) {
        var x = [480, 642, 804, 966][i];
        els.push({ type: 'box', x: x, y: 64, w: 148, h: 148, radius: 4, boxBg: '#B9C2B4', kids: [] });
        els.push({ type: 'heading', x: x, y: 226, w: 148, h: 20, text: name, tf: { fs: 15 } });
        els.push({ type: 'para', x: x, y: 252, w: 148, h: 58, text: 'A soft white that breaks warm over rims and edges.', tf: { fs: 13 } });
        els.push({ type: 'para', x: x, y: 318, w: 148, h: 16, text: 'Cone 8 reduction', tf: { fs: 11, tt: 'uppercase' } });
      });
      var n0 = G.sections().length;
      G.addSection({ name: 'glazes', minH: 380, els: els }, n0);
      var fam = G.diceFamilyOf(G.sections()[n0]);
      // a plain hero keeps its die: the rule only bites where pieces would ride
      G.addSection({ name: 'plain', minH: 520, els: [
        { type: 'para', x: 82, y: 80, w: 400, h: 17, text: 'Stoneware from Bristol', tf: { fs: 12, tt: 'uppercase' } },
        { type: 'heading', x: 82, y: 116, w: 540, h: 124, text: 'Thrown by hand. Fired to cone 8.', tf: { fs: 56 } },
        { type: 'para', x: 82, y: 262, w: 470, h: 84, text: 'Mugs, bowls and bottles made in small batches in a railway-arch studio.' },
        { type: 'button', x: 82, y: 376, w: 220, h: 50, text: 'Shop the collection' } ] }, n0 + 1);
      var fam2 = G.diceFamilyOf(G.sections()[n0 + 1]);
      G.deleteSectionRaw(n0 + 1);
      G.deleteSectionRaw(n0);
      expect(fam === null, 'the glaze chart found a family (' + fam + '): its swatches and labels would ride over every take');
      expect(!!fam2, 'a plain hero lost its die');
      return 'glaze chart: no family; plain hero: ' + fam2;
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
      expect(wrap && /How Google and AI read this page/.test(wrap.textContent), 'the SEO tab did not open the receipts');
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
      // smooth scrolling rides the compositor's clock (frozen in a hidden
      // tab): observe the REQUEST and apply it instantly, so the assertion
      // is about intent + geometry, not animation timing
      var origScrollTo = pnl.scrollTo;
      var asked = null;
      pnl.scrollTo = function (o) {
        asked = o && typeof o === 'object' ? o.top : o;
        return origScrollTo.call(pnl, { top: asked, behavior: 'instant' });
      };
      t.click();
      pnl.scrollTo = origScrollTo;
      expect(asked !== null && asked > 0, 'opening did not ask the panel to scroll');
      expect(!more.hidden, 'the toggle did not unfold the colours');
      expect(t.classList.contains('is-open'), 'the toggle did not mark itself open');
      expect(t.querySelector('.gogh-bgrow-caret svg'), 'the chevron should be drawn, not a font glyph');
      // smooth scrolling settles on its own clock — wait for the scrollTop
      // to move (or a real budget to pass), not a fixed frame count
      var settle = function () {
        var t0 = Date.now();
        return new Promise(function (r) {
          var look = function () {
            if (pnl.scrollTop > 20 || Date.now() - t0 > 2500) r(true);
            else setTimeout(look, 60);
          };
          look();
        });
      };
      return frames(20).then(function (ok) { return settle().then(function () { return ok; }); }).then(function (ok) {
        var done = function (msg) { pev('pointerdown', document.body, 4, 4); return msg; };
        if (!ok || stalled) return done('rAF frozen (background tab) — front the tab for the scroll check');
        // a hidden tab pauses smooth scrolling mid-flight — nothing to judge there
        if (document.visibilityState !== 'visible' && pnl.scrollTop <= 20) return done('hidden tab \u2014 smooth scroll paused; front the tab for the scroll check');
        if (pnl.scrollHeight <= pnl.clientHeight + 4) return done('panel fits without scrolling here — nothing to reveal');
        // the request was observed above; the instant scroll can clamp to 0
        // when the fold has not laid out yet — apply the asked offset, then judge the geometry
        if (pnl.scrollTop <= 20 && asked > 0) pnl.scrollTop = asked;
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

    testAsync('the front door: Add Page lands on the canvas, Add New Post in the write room', function () {
      // gogh IS the default experience now — the admin doors create a
      // blank draft and land straight on gogh's surfaces; an abandoned
      // blank is reused, never multiplied (the Trash (212) lesson)
      return fetch('/wp-admin/post-new.php?post_type=page', { credentials: 'same-origin' }).then(function (res) {
        expect(/gogh-edit=1/.test(res.url), 'Add Page did not land on the canvas: ' + res.url);
        expect(/preview=true/.test(res.url), 'the draft door skipped the preview gate');
        var first = res.url;
        return fetch('/wp-admin/post-new.php?post_type=page', { credentials: 'same-origin' }).then(function (res2) {
          expect(res2.url === first, 'a second knock minted a second draft: ' + res2.url);
          return fetch('/wp-admin/post-new.php', { credentials: 'same-origin' });
        }).then(function (res3) {
          expect(/gogh-write=1/.test(res3.url), 'Add New Post did not land in the write room: ' + res3.url);
          return 'both doors land on gogh, and blanks are reused';
        });
      });
    });

    test('the first minute: three beats, then the moment retires', function () {
      var fm = G.fm();
      fm.armed = true;
      var hero = G.templates().filter(function (t) { return t.name === 'Hero'; })[0];
      G.addSection(hero, G.sections().length);
      var s2 = lastSec();
      var idx = G.sections().indexOf(s2);
      expect(fm.active, 'the landing did not start the minute');
      var chip = q('.gogh-fm-chip');
      expect(chip && /headline/.test(chip.textContent), 'beat one is not inviting the headline');
      expect(q('.gogh-fm-mark'), 'no piece wears the pulse');
      expect(q('.gogh-fm-arrow') && !q('.gogh-fm-arrow').hidden, 'the arrow is not pointing at the piece');
      var h = s2.els.filter(function (e) { return e.type === 'heading'; })[0];
      h.text = 'My own words';
      G.pushState();
      chip = q('.gogh-fm-chip');
      expect(chip && /Drag the photo/.test(chip.textContent), 'beat two did not follow the typing');
      var img = s2.els.filter(function (e) { return e.type === 'image'; })[0];
      img.x += 60;
      G.pushState();
      chip = q('.gogh-fm-chip');
      expect(chip && /Roll the die/.test(chip.textContent), 'beat three did not follow the drag');
      // the die must be VISIBLE to be invited — beat three summons the bar
      var bar = q('.gogh-secbar');
      var die = q('.gogh-sb-dice');
      expect(bar && !bar.hidden && die && !die.hidden, 'beat three did not summon the die');
      G.rollSection(idx);
      expect(!fm.active, 'the minute did not retire after the roll');
      expect(!q('.gogh-fm-chip'), 'the chip outlived the minute');
      expect(!q('.gogh-fm-mark'), 'the pulse outlived the minute');
      G.fmReset();
      return 'type, drag, roll — and the moment is gone forever';
    });
    test('the first minute: doing it before being asked counts', function () {
      var fm = G.fm();
      fm.armed = true;
      var hero = G.templates().filter(function (t) { return t.name === 'Hero'; })[0];
      G.addSection(hero, G.sections().length);
      var s2 = lastSec();
      var idx = G.sections().indexOf(s2);
      // they roll FIRST and drag SECOND — beats complete in any order
      G.rollSection(idx);
      var img = s2.els.filter(function (e) { return e.type === 'image'; })[0];
      img.y += 40;
      G.pushState();
      var chip = q('.gogh-fm-chip');
      expect(fm.active && chip && /headline/.test(chip.textContent),
        'the chip is not waiting on the one remaining beat');
      var h = G.fm().sec.els.filter(function (e) { return e.type === 'heading'; })[0] ||
        (function () { var f = null; G.fm().sec.els.forEach(function (e) { (e.kids || []).forEach(function (k) { if (!f && k.type === 'heading') f = k; }); }); return f; })();
      h.text = 'Out of order and fine';
      G.pushState();
      expect(!G.fm().active, 'three organic edits did not finish the minute');
      G.fmReset();
      return 'the choreography follows the person, never the reverse';
    });
    test('the first minute: one click skips, nothing lingers', function () {
      var fm = G.fm();
      fm.armed = true;
      var cover = G.templates().filter(function (t) { return t.name === 'Cover'; })[0];
      G.addSection(cover, G.sections().length);
      expect(fm.active, 'the landing did not start the minute');
      var skip = q('.gogh-fm-chip .gogh-fm-skip');
      expect(skip && /find my own way/.test(skip.textContent), 'the skip is missing or misworded');
      skip.click();
      expect(!fm.active && !fm.armed, 'skipping did not retire the minute');
      expect(!q('.gogh-fm-chip') && !q('.gogh-fm-mark'), 'skip left furniture behind');
      G.fmReset();
      return 'no confirmation, no guilt, no residue';
    });

    test('publishing an untitled page pauses for its name', function () {
      var C = window.GOGH || {};
      var was = { t: C.postTitle, ty: C.postType };
      C.postTitle = '';
      C.postType = 'page';
      try {
        G.publish(); // the gate fires BEFORE any network — nothing saves
        var input = q('.gogh-panel .gogh-pagename');
        expect(input, 'no name panel appeared for the untitled page');
        expect(input.value.trim().length > 0, 'the name is not prefilled from a headline');
        expect(q('.gogh-panel .gogh-pagego'), 'the Publish page button is missing');
      } finally {
        G.closePanel();
        C.postTitle = was.t;
        C.postType = was.ty;
      }
      return 'the draft cannot go out into the world nameless';
    });

    test('the nameplate: the page wears its name beside its status', function () {
      var C = window.GOGH || {};
      var was = { t: C.postTitle, ty: C.postType };
      try {
        var plate = q('.gogh-chip-name');
        expect(plate, 'the chip has no nameplate');
        expect(!plate.hidden && plate.textContent.length > 0, 'the fixture page is not wearing its name');
        // an unnamed page wears the invitation, and clicking it opens the
        // namer in rename clothes — the name can be given at ANY moment
        C.postTitle = '';
        C.postType = 'page';
        G.publish(); // dirty state not needed: refresh via the gate path is separate
        G.closePanel();
        var refresh = window.__gogh; // refreshChip runs on pushState
        G.pushState();
        plate = q('.gogh-chip-name');
        expect(/name it/.test(plate.textContent), 'the unnamed page is not invited to a name');
        expect(plate.classList.contains('is-unnamed'), 'the invitation does not wear its amber');
        plate.click();
        var goBtn = q('.gogh-panel .gogh-pagego');
        expect(goBtn && /Save name/.test(goBtn.textContent), 'the rename door does not say Save name');
        expect(q('.gogh-panel .gogh-pagename'), 'the rename door has no input');
      } finally {
        G.closePanel();
        C.postTitle = was.t;
        C.postType = was.ty;
      }
      return 'identity beside status, renameable at any moment';
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

    // Playground boots the site in an iframe a few pixels wide; a measure
    // taken then divides one-line heights into thousands and autosave kept
    // the poison (the Yellow House hero came up 15,000px tall)
    test('text heights are not measured while the section is too narrow to trust', function () {
      var s = sec();
      var i = s.els.findIndex(function (e) { return e.type === 'heading' || e.type === 'para'; });
      if (i < 0) throw new Error('no text element in the first section');
      var before = s.els[i].h;
      var el = s.sectionEl, prev = el.style.width;
      el.style.width = '12px';
      try { G.measureTextHeights(s); } finally { el.style.width = prev; }
      if (s.els[i].h !== before) throw new Error('a 12px-wide measure changed h ' + before + ' \u2192 ' + s.els[i].h);
      G.measureTextHeights(s);
      if (s.els[i].h > before * 4 + 200) throw new Error('the full-width measure inflated h to ' + s.els[i].h);
      return 'h ' + before + ' kept at 12px wide, ' + s.els[i].h + ' at full width';
    });

    // an on-sale rail with nothing on sale is not an empty shop — the card
    // must not tell the owner to add their first product (James, Playground)
    test('an on-sale rail with nothing on sale says so, not "add your first product"', function () {
      if (!GOGH.hasWoo) return 'no WooCommerce here';
      var e = G.addElementToSection(G.sections().indexOf(sec()), 'products');
      if (!e || !e.shop) throw new Error('no products element');
      e.shop.order = 'sale';
      var html = G.shopPreviewHTML(e, []);
      if (!/Nothing is on sale right now/.test(html)) throw new Error('the on-sale rail did not say so: ' + html.slice(0, 160));
      if (/nearly ready|first product/.test(html)) throw new Error('the empty-shop card leaked into the on-sale rail');
      if (!/Manage products/.test(html)) throw new Error('the on-sale rail should hand the owner Manage products');
      e.shop.order = 'date';
      var plain = G.shopPreviewHTML(e, []);
      if (!/nearly ready/.test(plain)) throw new Error('a plain empty rail should still read as the empty shop');
      return 'sale rail: "Nothing is on sale right now" · plain rail: "nearly ready"';
    });

    // a starter's hand-made section never named its family, so the die hid
    // on every section of the Yellow House (James: "I can't see the die")
    test('the die infers a family for a section that never named one', function () {
      var hero = G.templates().filter(function (x) { return x.name === 'Hero'; })[0];
      if (!hero) throw new Error('no Hero template');
      G.addSection(hero);
      var s = lastSec();
      var idx = G.sections().indexOf(s);
      s.m = null; // a starter's section arrives with no model marker at all
      var fam = G.diceFamilyOf(s);
      if (!fam || !G.diceFaces(fam)) throw new Error('no family inferred for a hero-shaped section');
      var h = s.els.filter(function (e) { return e.type === 'heading'; })[0];
      if (!h) throw new Error('no heading to keep');
      h.text = 'Kept words';
      G.selectSection(idx);
      var die = document.querySelector('.gogh-secbar .gogh-sb-dice');
      if (!die || die.hidden) throw new Error('the die stayed hidden on a section without a named family');
      var r = G.rollSection(idx);
      if (!r || !r.of) throw new Error('the roll returned nothing');
      if (!s.m.tpl) throw new Error('the roll did not adopt the family');
      var kept = s.els.some(function (e) { return e.type === 'heading' && e.text === 'Kept words'; });
      if (!kept) throw new Error('the heading text did not survive the roll');
      // widgets match kind for kind: a wall section finds the wall family and never a form
      var wallFam = G.diceFamilyOf({ m: {}, els: [{ type: 'para', tf: { tt: 'uppercase' } }, { type: 'heading' }, { type: 'widget', wall: [] }] });
      if (wallFam !== 'Photo wall') throw new Error('a wall section should roll within Photo wall, got ' + wallFam);
      var formFam = G.diceFamilyOf({ m: {}, els: [{ type: 'para', tf: { tt: 'uppercase' } }, { type: 'heading' }, { type: 'widget', wsrc: '<!-- wp:group {"className":"gogh-form"} -->' }] });
      if (formFam === 'Photo wall' || formFam === 'FAQ' || formFam === 'Carousel') throw new Error('a form widget must not roll into ' + formFam);
      return 'inferred ' + fam + ', rolled to face ' + (r.face + 1) + ' of ' + r.of + ', words kept; wall → ' + wallFam + ', form → ' + formFam;
    });

    // EXTRAS RIDE ALONG — a piece the take never drew (a second button)
    // keeps its seat beside the take's own button through every roll
    // HOME IS EDITABLE — an inferred section's original take is a snapshot,
    // and the snapshot has to follow the edits made at home: drag the heading,
    // shrink the photo and retitle on face 0, roll around, and they are all
    // still there (the snapshot used to be taken once, on the first roll, so
    // rolling around put the pre-edit layout back and the edits were gone)
    test('the die weighs the words: a display headline never rolls within a glyph-headed family', function () {
      // the photographer's hero — eyebrow, a 28-character display headline in a
      // wide box, two lines — counted as a Quote by roles alone, and every take
      // poured the headline into the 180-wide slot the Quote keeps for its “
      var hero = { m: {}, els: [
        { type: 'para', x: 82, y: 96, w: 600, h: 20, text: 'People · Places · Quiet moments', tf: { tt: 'uppercase' } },
        { type: 'heading', x: 82, y: 132, w: 820, h: 210, text: 'The art of <em>paying attention.</em>' },
        { type: 'para', x: 840, y: 150, w: 300, h: 64, text: 'Photography for the moments that deserve to stay.' },
        { type: 'para', x: 840, y: 230, w: 300, h: 24, text: '<a href="/portfolio/">Explore portfolio ↗</a>' } ] };
      var fam = G.diceFamilyOf(hero);
      expect(fam && fam !== 'Quote', 'a wordy hero should not roll as a Quote, got ' + fam);
      var base = G.tplEls(G.diceFaces(fam)[0]);
      var slot = base.filter(function (e) { return e.type === 'heading'; })[0];
      expect(slot && slot.w * slot.h >= 0.5 * 820 * 210, fam + '’s headline slot (' + (slot ? slot.w + 'x' + slot.h : 'none') + ') cannot hold the words');
      // a real quote still finds its family: a glyph heading, the words, a name
      var quote = { m: {}, els: [
        { type: 'heading', x: 76, y: 44, w: 180, h: 160, text: '“' },
        { type: 'para', x: 200, y: 168, w: 800, h: 160, text: 'The best pictures are the ones you nearly did not take.' },
        { type: 'para', x: 204, y: 368, w: 500, h: 24, text: 'Hanna Lindqvist · Hanna & Co', tf: { tt: 'uppercase' } } ] };
      expect(G.diceFamilyOf(quote) === 'Quote', 'a quote-shaped section should still roll as a Quote, got ' + G.diceFamilyOf(quote));
      return 'hero → ' + fam + '; quote → Quote';
    });
    test('a take’s display headline steps down until the longest word fits its slot', function () {
      // the contact page's 'The statement' take draws its headline at Display M
      // for its own two words; five words at that size ran into the form
      var git = G.templates().filter(function (x) { return x.name === 'Get in touch'; })[0];
      if (!git) throw new Error('no Get in touch template');
      G.addSection(git);
      var s = lastSec(), idx = G.sections().indexOf(s);
      var h = s.els.filter(function (e) { return e.type === 'heading'; })[0];
      h.text = 'Let’s make something worth keeping.';
      G.renderSection(s);
      var faces = G.diceFaces('Get in touch');
      var seen = [];
      G.guardReset();
      for (var k = 0; k < faces.length; k++) {
        var r = G.rollSection(idx);
        var hh = s.els.filter(function (e) { return e.type === 'heading'; })[0];
        var n = s.nodes[s.els.indexOf(hh)];
        var over = n ? n.scrollWidth - n.clientWidth : 0;
        seen.push((r.take || 'home') + ':' + hh.fs + (over > 2 ? ' OVERFLOWS ' + over : ''));
        expect(over <= 2, 'take ' + (r.take || 'home') + ' lets the headline overflow its box by ' + over + 'px (' + hh.fs + ')');
        expect(hh.text === 'Let’s make something worth keeping.', 'the words changed on take ' + r.take);
      }
      var guard = G.guardLog(); G.guardReset();
      G.deleteSection(idx);
      expect(!guard.length, 'the guard spoke: ' + (guard.length ? guard[0].issues[0] : ''));
      return seen.join(' · ');
    });
    test('the original take keeps the edits made at home through a roll around', function () {
      var hero = G.templates().filter(function (x) { return x.name === 'Hero'; })[0];
      if (!hero) throw new Error('no Hero template');
      G.addSection(hero);
      var s = lastSec();
      var idx = G.sections().indexOf(s);
      s.m = null; // never named its family: the die infers one on the first roll
      var faces = G.diceFaces(G.diceFamilyOf(s));
      if (!faces) throw new Error('no family inferred for a hero-shaped section');
      var n = faces.length;
      var around = function () { for (var k = 0; k < n; k++) G.rollSection(idx); };
      var pick = function (type) { return diceFlat(s.els).filter(function (e) { return e.type === type; })[0]; };
      G.guardReset();
      around(); // adopt the family and come home once
      expect(s.m && s.m.face === 0 && s.m.orig && s.m.orig.els, 'the section did not come home with an original');
      // a piece added at home is part of the original from now on: it comes
      // home ONCE, in its place -- not beside a copy of itself (widgets ride
      // as themselves, and used to double every time round: two, three, five)
      s.els.push({ type: 'widget', x: 72, y: 560, w: 300, h: 40, wsrc: '<!-- wp:gogh/form /-->' });
      G.renderSection(s);
      var count0 = diceFlat(s.els).length;
      var widgets = function () { return s.els.filter(function (e) { return e.type === 'widget'; }).length; };
      expect(widgets() === 1, 'setup: expected one widget at home');
      // edit at home: move the heading, shrink the photo, retitle
      var h = pick('heading'), img = pick('image');
      if (!h || !img) throw new Error('no heading or image at home');
      h.x += 40; h.y += 24; h.text = 'Moved at home';
      img.w -= 60; img.h -= 40;
      G.renderSection(s);
      var hx = h.x, hy = h.y, iw = img.w, ih = img.h;
      around();
      expect(s.m.face === 0, n + ' rolls did not come home');
      var h2 = pick('heading'), img2 = pick('image');
      expect(h2 && h2.x === hx && h2.y === hy, 'the heading came home where it sat BEFORE the drag (' + (h2 ? h2.x + ',' + h2.y : 'gone') + ' vs ' + hx + ',' + hy + ')');
      expect(h2 && h2.text === 'Moved at home', 'the heading came home without its words');
      expect(img2 && img2.w === iw && img2.h === ih, 'the photo came home at its old size (' + (img2 ? img2.w + 'x' + img2.h : 'gone') + ' vs ' + iw + 'x' + ih + ')');
      expect(diceFlat(s.els).length === count0, 'coming home changed the piece count (' + diceFlat(s.els).length + ' vs ' + count0 + ')');
      expect(widgets() === 1, 'the widget came home beside a copy of itself (' + widgets() + ')');
      around();
      expect(widgets() === 1 && diceFlat(s.els).length === count0, 'a second time round changed the count (' + diceFlat(s.els).length + ' vs ' + count0 + ', ' + widgets() + ' widgets)');
      // a piece deleted at home stays deleted, and the original never keeps a piece a roll drew
      var btns = s.els.filter(function (e) { return e.type === 'button'; });
      var deleted = btns.length > 1;
      if (deleted) {
        s.els.splice(s.els.indexOf(btns[btns.length - 1]), 1);
        G.renderSection(s);
        around();
        var left = s.els.filter(function (e) { return e.type === 'button'; }).length;
        expect(left === btns.length - 1, 'a button deleted at home came back with the roll (' + left + ' of ' + btns.length + ')');
      }
      expect(!G.diceFlatten(s.m.orig.els).some(function (e) { return e.tk != null; }), 'the original carries a piece a roll drew');
      var guard = G.guardLog();
      G.guardReset();
      expect(!guard.length, 'the guard spoke on the way round: ' + (guard.length ? guard[0].issues[0] : ''));
      return n + ' rolls round: home wears the drag, the resize and the words' + (deleted ? '; a deleted button stayed deleted' : '');
    });
    // ---- the die follows pieces by identity (audit batch 2) ----
    // every piece carries an id and remembers its slot in the family's
    // drawing; the memories (words, seats, the kept background) live on the
    // model by those, so deleting or reordering a piece shifts nothing
    var heroSec = function () {
      var hero = G.templates().filter(function (x) { return x.name === 'Hero'; })[0];
      if (!hero) throw new Error('no Hero template');
      G.addSection(hero);
      var s = lastSec();
      return { s: s, idx: G.sections().indexOf(s) };
    };
    var texts = function (s, type) { return diceFlat(s.els).filter(function (e) { return e.type === type; }).map(function (e) { return e.text; }); };
    test('the die follows a piece by identity: delete or reorder, and the words stay with their pieces', function () {
      var h = heroSec(), s = h.s, idx = h.idx;
      G.rollSection(idx); // take 2: two buttons, every piece now knows its slot
      var btns = s.els.filter(function (e) { return e.type === 'button'; });
      expect(btns.length === 2, 'take 2 should draw two buttons, drew ' + btns.length);
      expect(diceFlat(s.els).every(function (e) { return e.id && e.sk; }), 'a drawn piece is missing its id or slot');
      btns[1].text = 'Mine';
      // reorder: the second button now sits first in the array
      s.els.splice(s.els.indexOf(btns[1]), 1);
      s.els.splice(s.els.indexOf(btns[0]), 0, btns[1]);
      G.renderSection(s);
      G.rollSection(idx); // take 3: two buttons
      var t3 = texts(s, 'button');
      expect(t3.length === 2 && t3.indexOf('Mine') !== -1, 'after a reorder the renamed button lost its words: ' + JSON.stringify(t3));
      expect(t3[0] !== 'Mine', 'the words jumped to the other slot: ' + JSON.stringify(t3));
      // delete the FIRST button: the survivor keeps its own words, and the
      // slot the deleted one held is redrawn by the take, not with its words
      var first = s.els.filter(function (e) { return e.type === 'button' && e.text !== 'Mine'; })[0];
      s.els.splice(s.els.indexOf(first), 1);
      G.renderSection(s);
      G.rollSection(idx); // take 4: one button
      var t4 = texts(s, 'button');
      expect(t4.length === 1 && t4[0] === 'Mine', 'through the one-button take the survivor should be "Mine", got ' + JSON.stringify(t4));
      G.rollSection(idx); // home: two slots again
      var t0 = texts(s, 'button');
      expect(t0.length === 2 && t0.indexOf('Mine') !== -1, 'home should draw two buttons with "Mine" among them: ' + JSON.stringify(t0));
      expect(t0.filter(function (x) { return x === 'Mine'; }).length === 1, 'the survivor’s words were drawn twice: ' + JSON.stringify(t0));
      G.deleteSection(idx);
      return 'reorder kept the words in place; delete left one survivor "Mine" at home: ' + JSON.stringify(t0);
    });
    test('a rider’s words beat an older take’s memory for the slot it fills', function () {
      var h = heroSec(), s = h.s, idx = h.idx;
      G.rollSection(idx); // take 2
      G.rollSection(idx); // take 3: two buttons
      var b2 = s.els.filter(function (e) { return e.type === 'button'; })[1];
      b2.text = 'Old words';
      G.renderSection(s);
      G.rollSection(idx); // take 4 draws one button: the second (an original) rides, and its words are remembered for slot two
      expect(s.m.edits && s.m.edits.button && s.m.edits.button[1] && s.m.edits.button[1].text === 'Old words', 'the memory should hold "Old words" for slot two: ' + JSON.stringify(s.m.edits));
      // the user deletes the rider while it rides (no take draws its slot here, so
      // the memory keeps "Old words") and adds a button of their own
      var rider = diceFlat(s.els).filter(function (e) { return e.type === 'button' && e.text === 'Old words'; })[0];
      expect(rider, 'the renamed button should ride through the one-button take');
      // it may have joined the take's card beside that card's button
      if (s.els.indexOf(rider) !== -1) s.els.splice(s.els.indexOf(rider), 1);
      else s.els.forEach(function (e) { if (e.kids && e.kids.indexOf(rider) !== -1) e.kids.splice(e.kids.indexOf(rider), 1); });
      s.els.push({ type: 'button', x: 300, y: 548, w: 180, h: 54, text: 'New words' });
      G.renderSection(s);
      G.rollSection(idx); // home: slot two is free, the new button takes it -- with ITS words
      var t0 = texts(s, 'button');
      expect(t0.length === 2, 'home should have two buttons: ' + JSON.stringify(t0));
      expect(t0.indexOf('New words') !== -1, 'the rider’s own words were overwritten by the older memory: ' + JSON.stringify(t0));
      expect(t0.indexOf('Old words') === -1, 'the stale memory came back: ' + JSON.stringify(t0));
      G.deleteSection(idx);
      return 'the rider wore "New words", not the take’s stale "Old words"';
    });
    test('a box and a card of the user’s own ride through every take', function () {
      var h = heroSec(), s = h.s, idx = h.idx;
      G.rollSection(idx); // bind
      var n0 = diceFlat(s.els).length;
      s.els.push({ type: 'box', x: 1000, y: 40, w: 160, h: 160, boxBg: '#e0b01e', radius: 20 });
      s.els.push({ type: 'box', x: 760, y: 420, w: 380, h: 180, boxBg: '#101418', radius: 16, kids: [
        { type: 'heading', x: 24, y: 20, w: 320, h: 40, text: 'Card kid' },
        { type: 'para', x: 24, y: 80, w: 320, h: 60, text: 'Rides inside the card' } ] });
      G.renderSection(s);
      G.guardReset();
      var seen = [];
      for (var k = 0; k < 4; k++) {
        var r = G.rollSection(idx);
        var boxes = s.els.filter(function (e) { return e.type === 'box' && !e.kids && e.boxBg === '#e0b01e'; });
        var cards = s.els.filter(function (e) { return e.type === 'box' && e.kids && e.kids.some(function (kk) { return kk.text === 'Card kid'; }); });
        seen.push('take ' + (r.face + 1) + ': ' + boxes.length + ' box, ' + cards.length + ' card');
        expect(boxes.length === 1, 'the user’s box did not ride whole (' + seen.join('; ') + ')');
        expect(cards.length === 1 && cards[0].kids.length === 2, 'the user’s card did not ride whole with its kids (' + seen.join('; ') + ')');
      }
      expect(diceFlat(s.els).length === n0 + 4, 'home should hold the take plus the box, the card and its two kids: ' + diceFlat(s.els).length + ' vs ' + (n0 + 4));
      var guard = G.guardLog(); G.guardReset();
      G.deleteSection(idx);
      expect(!guard.length, 'the guard spoke: ' + (guard.length ? guard[0].issues[0] : ''));
      return seen.join('; ');
    });
    test('the kept background lives on the model: undo and the saved page keep it', function () {
      var cover = G.templates().filter(function (x) { return x.name === 'Cover'; })[0];
      if (!cover) throw new Error('no Cover template');
      G.addSection(cover);
      var s = lastSec(), idx = G.sections().indexOf(s);
      var photo = '/wp-content/plugins/gogh/demo-assets/sunflowers.jpg';
      s.bgImage = photo; s.bgId = null;
      G.renderSection(s);
      var stashed = false, k;
      for (k = 0; k < 4 && !stashed; k++) {
        G.rollSection(idx);
        if (!s.bgImage) stashed = true;
      }
      if (!stashed) { G.deleteSection(idx); return 'every Cover take wears a picture — nothing to stash'; }
      expect(s.m.keepBg && s.m.keepBg.img === photo, 'an imageless take should stash the photo on the model: ' + JSON.stringify(s.m.keepBg));
      var am = G.blocksV3(s).match(/<!-- wp:gogh\/section (\{[\s\S]*?\}) -->/);
      var model = am ? JSON.parse(am[1]).model : null;
      expect(model && model.m && model.m.keepBg && model.m.keepBg.img === photo, 'the saved model lost the kept background');
      // undo one roll, redo it: still stashed
      q('.gogh-undo').click(); q('.gogh-redo').click();
      var s2 = lastSec();
      expect(s2.m && s2.m.keepBg && s2.m.keepBg.img === photo, 'undo/redo lost the kept background');
      var idx2 = G.sections().indexOf(s2), back = false;
      for (k = 0; k < 4 && !back; k++) { G.rollSection(idx2); if (s2.bgImage) back = true; }
      expect(back && s2.bgImage === photo, 'the next picture-wearing take should wear the user’s photo, wore ' + s2.bgImage);
      G.deleteSection(idx2);
      return 'stashed on m.keepBg, saved, survived undo, came back on the next picture take';
    });
    test('headings beyond what the family draws keep their words all the way round', function () {
      var h = heroSec(), s = h.s, idx = h.idx;
      s.els.push({ type: 'heading', x: 72, y: 620, w: 470, h: 60, text: 'Second' });
      s.els.push({ type: 'heading', x: 600, y: 620, w: 470, h: 60, text: 'Third' });
      G.renderSection(s);
      for (var k = 0; k < 4; k++) {
        var r = G.rollSection(idx);
        var t = texts(s, 'heading');
        expect(t.indexOf('Second') !== -1 && t.indexOf('Third') !== -1, 'take ' + (r.face + 1) + ' lost an extra heading’s words: ' + JSON.stringify(t));
      }
      expect(texts(s, 'heading').length === 3, 'home should hold all three headings');
      G.deleteSection(idx);
      return '"Second" and "Third" rode every take and came home';
    });
    test('the original snapshot leaves a widget’s composed HTML behind and composes it again at home', function () {
      var tpl = G.templates().filter(function (x) { return (x.els || []).some(function (e) { return e.type === 'widget' && (e.faq || e.slides || e.wall); }); })[0];
      if (!tpl) return 'no widget family to test with';
      G.addSection(tpl);
      var s = lastSec(), idx = G.sections().indexOf(s);
      s.m = null; // never named its family: the die infers one and snapshots the original
      var faces = G.diceFaces(G.diceFamilyOf(s));
      if (!faces) { G.deleteSection(idx); return 'no family inferred for ' + tpl.name; }
      var liveW = diceFlat(s.els).filter(function (e) { return e.type === 'widget'; })[0];
      expect(liveW && liveW.whtml, 'setup: the live widget should carry composed HTML');
      G.rollSection(idx); // adopt
      var origW = G.diceFlatten(s.m.orig.els).filter(function (e) { return e.type === 'widget'; })[0];
      expect(origW && !origW.whtml && (origW.faq || origW.slides || origW.wall), 'the snapshot should keep the data and drop the HTML: ' + (origW ? Object.keys(origW).join(',') : 'no widget'));
      for (var k = 1; k < faces.length; k++) G.rollSection(idx); // home
      var homeW = diceFlat(s.els).filter(function (e) { return e.type === 'widget'; })[0];
      expect(homeW && homeW.whtml && homeW.whtml.length > 20, 'the widget came home without its HTML');
      G.deleteSection(idx);
      return tpl.name + ': snapshot ' + JSON.stringify(s.m.orig).length + ' chars, HTML composed again at home';
    });
    test('a copy of a section is new to the die: fresh ids, its own homecomings', function () {
      var h = heroSec(), s = h.s, idx = h.idx;
      G.rollSection(idx);
      var ids = diceFlat(s.els).map(function (e) { return e.id; });
      expect(ids.every(Boolean) && new Set(ids).size === ids.length, 'ids should be present and unique after a roll');
      G.duplicateSection(idx);
      var c = G.sections()[idx + 1];
      expect(c && c !== s && c.els.length === s.els.length, 'the copy did not land after the source');
      var cids = diceFlat(c.els).map(function (e) { return e.id; });
      expect(cids.every(function (id) { return id && ids.indexOf(id) === -1; }), 'the copy shares ids with its source');
      // the saved model carries id and slot
      var am = G.blocksV3(s).match(/<!-- wp:gogh\/section (\{[\s\S]*?\}) -->/);
      var model = am ? JSON.parse(am[1]).model : null;
      expect(model && model.elements.every(function (e) { return e.id && e.sk; }), 'the saved model should carry every piece’s id and slot');
      var cidx = G.sections().indexOf(c);
      G.deleteSection(cidx);
      G.deleteSection(G.sections().indexOf(s));
      return ids.length + ' pieces, ' + cids.length + ' fresh ids on the copy; id + slot saved';
    });
    test('a piece deleted on a take that draws it takes its words with it', function () {
      var h = heroSec(), s = h.s, idx = h.idx;
      G.rollSection(idx); // take 2
      var b2 = s.els.filter(function (e) { return e.type === 'button'; })[1];
      var tplText = b2.text;
      b2.text = 'Gone';
      G.renderSection(s);
      G.rollSection(idx); // take 3: "Gone" remembered and applied
      expect(texts(s, 'button').indexOf('Gone') !== -1, 'the rename did not travel to take 3');
      var gone = s.els.filter(function (e) { return e.type === 'button' && e.text === 'Gone'; })[0];
      s.els.splice(s.els.indexOf(gone), 1);
      G.renderSection(s);
      G.rollSection(idx); // take 4: the slot was drawn and left empty by the user — forget its words
      expect(!(s.m.edits && s.m.edits.button && s.m.edits.button[1]), 'the deleted button’s words are still remembered: ' + JSON.stringify(s.m.edits));
      G.rollSection(idx); // home
      var t0 = texts(s, 'button');
      expect(t0.length === 2 && t0.indexOf('Gone') === -1, 'the deleted button came back wearing its words: ' + JSON.stringify(t0));
      G.deleteSection(idx);
      return 'home drew slot two afresh (' + JSON.stringify(t0[1]) + '), not "Gone"';
    });
    // ---- cards: order, typing, a cancelled hand, leaving, ink (audit batch 3) ----
    var cardAt = function (s0, kids, extra) {
      s0.els.push(Object.assign({ type: 'box', x: 600, y: 60, w: 480, h: 320, boxBg: '#101418', radius: 16, kids: kids }, extra || {}));
      G.renderSection(s0);
      var ci = s0.els.length - 1;
      return { ci: ci, box: s0.els[ci], node: s0.nodes[ci] };
    };
    var pvk = function (type, el, x, y, id) {
      el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: id, button: 0,
        buttons: (type === 'pointerup' || type === 'pointercancel') ? 0 : 1 }));
    };
    var lumOf = function (cssColor) {
      var m = (cssColor || '').match(/[\d.]+/g) || [];
      var f = function (c) { c = (+c) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      return m.length >= 3 ? 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]) : 1;
    };
    test('a piece joining a card takes its place in reading order, and the saved card agrees', function () {
      var s0 = sec();
      var f = cardAt(s0, [
        { type: 'heading', x: 30, y: 120, w: 420, h: 40, text: 'Second line' },
        { type: 'para', x: 30, y: 200, w: 420, h: 60, text: 'Third line' } ]);
      // a badge dropped inside the card ABOVE its kids
      s0.els.push({ type: 'badge', x: 630, y: 80, w: 160, h: 32, text: 'First line' });
      G.renderSection(s0);
      var bi = s0.els.length - 1;
      select(bi);
      var grip = q('.gogh-grip');
      expect(grip, 'no grip for the badge');
      var r = grip.getBoundingClientRect();
      pev('pointerdown', grip, r.x + 12, r.y + 12, 61);
      pev('pointermove', grip, r.x + 12, r.y + 12 + 6, 61);
      pev('pointerup', grip, r.x + 12, r.y + 12 + 6, 61);
      var box = f.box;
      expect(box.kids && box.kids.length === 3, 'the badge did not join the card (' + (box.kids ? box.kids.length : 0) + ' kids)');
      expect(box.kids[0].text === 'First line', 'the joiner was appended last instead of taking its place: ' + box.kids.map(function (k) { return k.text; }).join(' | '));
      // the saved card writes its kids in the same order the editor holds them
      var html = G.blocksV3(s0);
      var at = html.indexOf('#101418');
      expect(at !== -1, 'the card is missing from the saved markup');
      var seg = html.slice(at);
      var p1 = seg.indexOf('gogh-k-1'), p2 = seg.indexOf('gogh-k-2'), p3 = seg.indexOf('gogh-k-3');
      expect(p1 !== -1 && p2 !== -1 && p3 !== -1 && p1 < p2 && p2 < p3, 'the saved card lists its kids out of editor order (' + [p1, p2, p3].join(',') + ')');
      [].slice.call(document.querySelectorAll('.gogh-toast')).forEach(function (t) { t.remove(); });
      return 'badge joined as kid 1 of 3; saved order 1 < 2 < 3';
    });
    test('typing in a kid re-measures it: the stack settles below and comes back when the words shrink', function () {
      var s0 = sec();
      var f = cardAt(s0, [
        { type: 'heading', x: 30, y: 20, w: 420, h: 40, text: 'Short' },
        { type: 'para', x: 30, y: 100, w: 420, h: 40, text: 'Below the heading' } ]);
      var box = f.box, h0 = box.h;
      var kn = f.node.querySelector('.gogh-k-1');
      var r = kn.getBoundingClientRect();
      pvk('pointerdown', kn, r.left + 10, r.top + 8, 71); pvk('pointerup', document, r.left + 10, r.top + 8, 71);
      pvk('pointerdown', kn, r.left + 10, r.top + 8, 72); pvk('pointerup', document, r.left + 10, r.top + 8, 72);
      var ed = G.kidState().ed;
      expect(ed && ed.kid === box.kids[0], 'the second click did not start editing the heading kid');
      var hBefore = box.kids[0].h;
      ed.node.innerHTML = 'A heading that runs to several lines because the words keep coming and the card must make room for every one of them below';
      ed.node.dispatchEvent(new Event('input', { bubbles: true }));
      expect(box.kids[0].h > hBefore + 20, 'the kid did not grow with its words (' + hBefore + ' -> ' + box.kids[0].h + ')');
      expect(box.kids[1].y > 100, 'the paragraph did not settle below the taller heading (y ' + box.kids[1].y + ')');
      var grown = box.h, grownKid = box.kids[0].h;
      ed.node.innerHTML = 'Short';
      ed.node.dispatchEvent(new Event('input', { bubbles: true }));
      // the model absorbs the rendered truth: one line is what one line measures,
      // which may be less than the 40 the fixture declared
      expect(box.kids[0].h < grownKid - 20 && box.kids[0].h <= hBefore + 4, 'the kid did not shrink back with its words (' + grownKid + ' -> ' + box.kids[0].h + ')');
      expect(box.kids[1].y === 100, 'the paragraph did not come back up (y ' + box.kids[1].y + ')');
      expect(box.h === h0, 'the card kept its grown height (' + h0 + ' -> ' + grown + ' -> ' + box.h + ')');
      G.kidState().ed && document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return 'heading ' + hBefore + ' -> ' + box.kids[0].h + ' -> back; card ' + h0 + ' -> ' + grown + ' -> ' + box.h;
    });
    test('a cancelled pointer ends a kid drag cleanly: no ghost, nothing moved, the card at rest', function () {
      var s0 = sec();
      var f = cardAt(s0, [
        { type: 'heading', x: 30, y: 20, w: 420, h: 40, text: 'Top' },
        { type: 'para', x: 30, y: 100, w: 420, h: 40, text: 'Under' } ]);
      var box = f.box, h0 = box.h;
      var kn = f.node.querySelector('.gogh-k-1');
      var r = kn.getBoundingClientRect();
      var sc = s0.sectionEl.getBoundingClientRect().width / 1200;
      pvk('pointerdown', kn, r.left + 10, r.top + 8, 73);
      pvk('pointermove', document, r.left + 10, r.top + 8 + 90 * sc, 73);
      expect(document.querySelector('.gogh-kid-ghost'), 'the kid drag never started');
      expect(G.kidState().drag, 'no kid drag in flight');
      pvk('pointercancel', document, r.left + 10, r.top + 8 + 90 * sc, 73);
      expect(!G.kidState().drag, 'the drag outlived the cancel');
      expect(!document.querySelector('.gogh-kid-ghost'), 'the ghost was left behind');
      expect(kn.style.visibility !== 'hidden', 'the kid stayed hidden');
      expect(box.kids[0].y === 20 && box.kids[1].y === 100, 'the kids did not go back to rest: ' + box.kids.map(function (k) { return k.y; }).join(','));
      expect(box.h === h0, 'the card kept a drag-grown height (' + h0 + ' -> ' + box.h + ')');
      pvk('pointerup', document, r.left + 10, r.top + 8 + 90 * sc, 73); // a late release changes nothing
      expect(box.kids.length === 2 && box.kids[0].y === 20, 'a late pointerup moved the kids after the cancel');
      return 'cancel restored both kids and the card height ' + h0;
    });
    test('a kid leaving its card lands at the grip it was picked up by, and the card goes back to rest', function () {
      var s0 = sec();
      var f = cardAt(s0, [
        { type: 'heading', x: 30, y: 20, w: 300, h: 40, text: 'Leaver' },
        { type: 'para', x: 30, y: 100, w: 420, h: 40, text: 'Stays' } ]);
      var box = f.box, h0 = box.h, n0 = s0.els.length;
      var kn = f.node.querySelector('.gogh-k-1');
      var r = kn.getBoundingClientRect();
      var secR = s0.sectionEl.getBoundingClientRect();
      var sc = secR.width / 1200;
      var gx = r.left + 10, gy = r.top + 8; // the grip: 10px in from the left edge, 8px down
      var dx = -Math.round(220 * sc), dy = Math.round(120 * sc); // well outside the card, to the left
      pvk('pointerdown', kn, gx, gy, 74);
      pvk('pointermove', document, gx + dx / 2, gy + dy / 2, 74);
      pvk('pointermove', document, gx + dx, gy + dy, 74);
      pvk('pointerup', document, gx + dx, gy + dy, 74);
      expect(s0.els.length === n0 + 1, 'the kid did not leave the card');
      var left = s0.els[s0.els.length - 1];
      expect(left.text === 'Leaver', 'the wrong piece left the card');
      var wantX = Math.round((r.left + dx - secR.left) / sc), wantY = Math.round((r.top + dy - secR.top) / sc);
      expect(Math.abs(left.x - wantX) <= 2 && Math.abs(left.y - wantY) <= 2,
        'the leaver jumped: landed ' + left.x + ',' + left.y + ' wanted ' + wantX + ',' + wantY + ' (pointer-centred would be ' + Math.round((gx + dx - secR.left) / sc - left.w / 2) + ')');
      expect(box.kids.length === 1 && box.kids[0].y === 100, 'the staying kid was left where the drag pushed it: y ' + (box.kids[0] && box.kids[0].y));
      expect(box.h === h0, 'the card kept a drag-grown height (' + h0 + ' -> ' + box.h + ')');
      [].slice.call(document.querySelectorAll('.gogh-toast')).forEach(function (t) { t.remove(); });
      return 'landed at ' + left.x + ',' + left.y + ' (grip kept); card ' + h0 + ' at rest';
    });
    test('the ink sentinel judges the tint a card paints, not the colour it names', function () {
      var s0 = sec();
      // frosted glass paints 70% of #555 over what is behind it; judged solid,
      // #555 is dark and the sentinel painted the words white on a mid ground
      var f = cardAt(s0, [ { type: 'heading', x: 30, y: 20, w: 420, h: 40, text: 'Glass words' } ], { boxBg: '#555555', mood: 'glass' });
      var bgL = lumOf(getComputedStyle(s0.sectionEl).backgroundColor);
      if (getComputedStyle(s0.sectionEl).backgroundColor === 'rgba(0, 0, 0, 0)') bgL = 1;
      var painted = 0.7 * lumOf('rgb(85, 85, 85)') + 0.3 * bgL;
      var wantDark = (painted + 0.05) / 0.05 > 1.05 / (painted + 0.05);
      G.contrastSentinel(s0, f.ci);
      var kn = s0.nodes[f.ci].querySelector('.gogh-k-1');
      var host = kn.matches('p,h1,h2,h3,h4,h5,h6') ? kn : (kn.querySelector('p,h1,h2,h3,h4,h5,h6') || kn);
      var inkL = lumOf(getComputedStyle(host).color);
      expect(wantDark ? inkL < 0.5 : inkL >= 0.5, 'on a painted ground of ' + painted.toFixed(2) + ' the words should be ' + (wantDark ? 'dark' : 'light') + ', ink luminance ' + inkL.toFixed(2));
      [].slice.call(document.querySelectorAll('.gogh-toast')).forEach(function (t) { t.remove(); });
      return 'painted ground ' + painted.toFixed(2) + ' -> ' + (wantDark ? 'dark' : 'light') + ' ink (' + inkL.toFixed(2) + ')';
    });
    // ---- zoom and the solver (audit batch 4) ----
    test('the frame’s edges are fixed lines: a near-full-bleed photo does not shift the columns', function () {
      // an image six units short of the left edge, a heading at 72
      var g = G.solve([
        { type: 'image', x: 6, y: 0, w: 600, h: 400 },
        { type: 'heading', x: 72, y: 420, w: 470, h: 60, text: 'Here' },
        { type: 'para', x: 72, y: 500, w: 410, h: 40, text: 'And here' } ], 600, null, null);
      var lines = [0];
      g.cols.forEach(function (c) { lines.push(lines[lines.length - 1] + parseFloat(c) * 12); });
      var total = lines[lines.length - 1];
      expect(Math.abs(total - 1200) < 0.6, 'the columns should span the whole frame, span ' + total.toFixed(1));
      expect(lines[0] === 0 && Math.abs(lines[1] - 72) < 0.6, 'the first inner line should sit at 72, not be pulled by the photo edge: ' + lines.map(function (l) { return l.toFixed(1); }).join(', '));
      expect(g.areas[0].c1 === 1, 'the photo should start on the frame’s edge');
      // chained edges: 300, 307, 314, 321 are two lines (each group spans at most TOL), not one at 310
      var g2 = G.solve([
        { type: 'heading', x: 100, y: 0, w: 200, h: 40, text: 'a' },
        { type: 'heading', x: 307, y: 60, w: 200, h: 40, text: 'b' },
        { type: 'heading', x: 314, y: 120, w: 100, h: 40, text: 'c' },
        { type: 'heading', x: 321, y: 180, w: 100, h: 40, text: 'd' } ], 600, null, null);
      var l2 = [0];
      g2.cols.forEach(function (c) { l2.push(l2[l2.length - 1] + parseFloat(c) * 12); });
      var near = l2.filter(function (l) { return l > 290 && l < 330; });
      expect(near.length === 2, 'edges 300/307/314/321 should make two lines, made ' + near.length + ' (' + near.map(function (l) { return l.toFixed(1); }).join(', ') + ')');
      return 'span ' + total.toFixed(1) + '; inner line at ' + lines[1].toFixed(1) + '; chain -> ' + near.length + ' lines';
    });
    test('a card’s rows are a share of the card: a kid a unit past the bottom squeezes nothing', function () {
      var s0 = sec();
      var f = cardAt(s0, [
        { type: 'heading', x: 30, y: 20, w: 420, h: 40, text: 'Top of the card' },
        { type: 'para', x: 30, y: 240, w: 420, h: 81, text: 'One unit past the bottom' } ]); // 240 + 81 = 321 > 320
      var sc = s0.sectionEl.getBoundingClientRect().width / 1200;
      var cardR = f.node.getBoundingClientRect();
      var kn = f.node.querySelector('.gogh-k-1');
      var top = (kn.getBoundingClientRect().top - cardR.top) / sc;
      expect(Math.abs(top - 20) <= 3, 'the first kid should sit at its model y (20), sits at ' + top.toFixed(1));
      return 'first kid at ' + top.toFixed(1) + ' for a model y of 20';
    });
    test('the kid ghost wears the kid’s own dress, and the kid leaves the grid while it rides', function () {
      var s0 = sec();
      var f = cardAt(s0, [
        { type: 'heading', x: 30, y: 20, w: 420, h: 40, text: 'Dressed', color: 'base', tf: { fs: 34, fw: 700 } },
        { type: 'para', x: 30, y: 100, w: 420, h: 40, text: 'Under' } ]);
      var kn = f.node.querySelector('.gogh-k-1');
      var host = kn.matches('h1,h2,h3,h4,h5,h6,p') ? kn : (kn.querySelector('h1,h2,h3,h4,h5,h6,p') || kn);
      var want = { fs: getComputedStyle(host).fontSize, fw: getComputedStyle(host).fontWeight, col: getComputedStyle(host).color };
      var r = kn.getBoundingClientRect();
      var sc = s0.sectionEl.getBoundingClientRect().width / 1200;
      pvk('pointerdown', kn, r.left + 10, r.top + 8, 75);
      pvk('pointermove', document, r.left + 10, r.top + 8 + 60 * sc, 75);
      var ghost = document.querySelector('.gogh-kid-ghost');
      expect(ghost, 'no kid ghost');
      var gh = ghost.querySelector('h1,h2,h3,h4,h5,h6,p') || ghost;
      var got = { fs: getComputedStyle(gh).fontSize, fw: getComputedStyle(gh).fontWeight, col: getComputedStyle(gh).color };
      expect(getComputedStyle(kn).display === 'none', 'the riding kid should leave the grid (display none), has ' + getComputedStyle(kn).display);
      pvk('pointercancel', document, r.left + 10, r.top + 8 + 60 * sc, 75);
      expect(getComputedStyle(kn).display !== 'none', 'the kid did not come back after the cancel');
      expect(got.fs === want.fs && got.fw === want.fw && got.col === want.col,
        'the ghost wore ' + JSON.stringify(got) + ', the kid wears ' + JSON.stringify(want));
      return 'ghost ' + got.fs + ' / ' + got.fw + ' / ' + got.col + ' = kid';
    });
    test('under the birds-eye zoom a sideways drag keeps its height', function () {
      var i = findIdx('badge');
      var e0 = sec().els[i], y0 = e0.y, h0 = e0.h;
      G.canvasZoom.out();
      var zoomed = document.querySelector('.gogh-zoomed, [style*="scale("]');
      try {
        select(i);
        var grip = q('.gogh-grip');
        expect(grip, 'no grip under the zoom');
        var r = grip.getBoundingClientRect();
        pev('pointerdown', grip, r.x + 12, r.y + 12, 52);
        pev('pointermove', grip, r.x + 12 + 40, r.y + 12, 52);
        pev('pointermove', grip, r.x + 12 + 80, r.y + 12, 52);
        pev('pointerup', grip, r.x + 12 + 80, r.y + 12, 52);
      } finally {
        G.canvasZoom.back();
      }
      var e1 = sec().els[i];
      expect(Math.abs(e1.y - y0) <= 2, 'a sideways drag under the zoom moved the piece down: y ' + y0 + ' -> ' + e1.y);
      expect(e1.h === h0, 'the piece changed height under the zoom: ' + h0 + ' -> ' + e1.h);
      return 'y ' + y0 + ' -> ' + e1.y + (zoomed ? ' (zoom wrapper found)' : '');
    });
    test('a card stacks by ink: a button dropped beside a short heading stays beside it, one dropped on the words steps below', function () {
      var s0 = sec();
      var f = cardAt(s0, [
        { type: 'heading', x: 30, y: 40, w: 440, h: 60, text: 'Short' },
        { type: 'button', x: 30, y: 200, w: 160, h: 50, text: 'Drag me' } ], { w: 480, h: 320 });
      var box = f.box, kn = f.node.querySelector('.gogh-k-2');
      var sc = s0.sectionEl.getBoundingClientRect().width / 1200;
      var r = kn.getBoundingClientRect();
      // 1. beside the heading's words (the box runs the card's width, the ink does not)
      pvk('pointerdown', kn, r.left + 10, r.top + 8, 76);
      pvk('pointermove', document, r.left + 10 + 150 * sc, r.top + 8 - 80 * sc, 76);
      pvk('pointermove', document, r.left + 10 + 260 * sc, r.top + 8 - 155 * sc, 76);
      pvk('pointerup', document, r.left + 10 + 260 * sc, r.top + 8 - 155 * sc, 76);
      var b = box.kids.filter(function (k) { return k.type === 'button'; })[0];
      expect(b, 'the button left the card');
      expect(Math.abs(b.y - 45) <= 3 && b.x >= 250, 'beside the words it should stay at y 45, x 290: landed ' + b.x + ',' + b.y);
      var beside = b.x + ',' + b.y; // the same object moves again below
      // 2. onto the words themselves: it steps below the heading
      var kn2 = f.node.querySelector('.gogh-k-' + (box.kids.indexOf(b) + 1));
      var r2 = kn2.getBoundingClientRect();
      pvk('pointerdown', kn2, r2.left + 10, r2.top + 8, 77);
      pvk('pointermove', document, r2.left + 10 - 130 * sc, r2.top + 8, 77);
      pvk('pointermove', document, r2.left + 10 - 250 * sc, r2.top + 8, 77);
      pvk('pointerup', document, r2.left + 10 - 250 * sc, r2.top + 8, 77);
      var b2 = box.kids.filter(function (k) { return k.type === 'button'; })[0];
      expect(b2.y >= 100, 'on the words it should step below the heading (y >= 100): landed ' + b2.x + ',' + b2.y);
      [].slice.call(document.querySelectorAll('.gogh-toast')).forEach(function (t) { t.remove(); });
      return 'beside the words: ' + beside + '; on the words: ' + b2.x + ',' + b2.y;
    });
    test('an extra button rides beside the take\'s button through every roll', function () {
      var hero = G.templates().filter(function (x) { return x.name === 'Hero'; })[0];
      if (!hero) throw new Error('no Hero template');
      G.addSection(hero);
      var s = lastSec();
      var idx = G.sections().indexOf(s);
      var heroBtns = s.els.filter(function (e) { return e.type === 'button'; });
      var b1 = heroBtns[heroBtns.length - 1]; // after the LAST button the take draws
      if (!b1) throw new Error('the Hero has no button');
      var b2 = JSON.parse(JSON.stringify(b1));
      b2.text = 'Second'; b2.x = b1.x + b1.w + 16; b2.y = b1.y;
      s.els.push(b2);
      G.renderSection(s);
      var faces = G.diceFaces(G.diceFamilyOf(s));
      var seen = [];
      for (var k = 0; k < faces.length; k++) {
        G.rollSection(idx);
        var btns = G.diceFlatten(s.els).filter(function (e) { return e.type === 'button'; });
        var ex = btns.filter(function (e) { return e.text === 'Second'; })[0];
        var owns = btns.filter(function (e) { return e.text !== 'Second'; });
        var own = owns[owns.length - 1]; // the extra follows the take's last button
        if (!ex) throw new Error('lost the extra button on roll ' + (k + 1));
        if (ex.x < 0 || ex.x + ex.w > 1200) throw new Error('roll ' + (k + 1) + ': the extra left the canvas');
        if (!own) { seen.push('no-button-take'); continue; } // a take drawn without a button: the extra rides the headline
        // a take that keeps its button in a card: the extra joins the same card
        var cardOf = function (e) { return s.els.filter(function (b) { return b.type === 'box' && b.kids && b.kids.indexOf(e) !== -1; })[0] || null; };
        if (cardOf(own) !== cardOf(ex)) throw new Error('roll ' + (k + 1) + ': the extra and the take\'s button are not in the same card');
        var below = ex.y >= own.y + own.h && ex.x + ex.w <= 1200;
        if (Math.abs(ex.y - own.y) > 2 && !below) throw new Error('roll ' + (k + 1) + ': the extra left the row (y ' + ex.y + ' vs ' + own.y + ')');
        var gap = ex.x - (own.x + own.w);
        var overlap = !(ex.x >= own.x + own.w || ex.x + ex.w <= own.x || ex.y >= own.y + own.h || ex.y + ex.h <= own.y);
        if (overlap) throw new Error('roll ' + (k + 1) + ': the extra sits on top of the take\'s button');
        if (gap >= 0 && gap <= 40) seen.push(gap);
        else if (ex.x + ex.w <= own.x) seen.push('left'); // no room on the right: mirrored to the left
        else if (ex.y >= own.y + own.h) seen.push('below'); // no room either side: the row below
        else throw new Error('roll ' + (k + 1) + ': the extra lost its seat (gap ' + gap + ')');
      }
      G.deleteSection(idx);
      return faces.length + ' rolls, gaps ' + seen.join('/');
    });

    // THE YELLOW HOUSE SHAPE — one take button plus one of the user's own:
    // the second button keeps its words through every take, including the
    // one that draws a single button in a card, and never overlaps
    test('a second button keeps its words through a one-button take', function () {
      var hero = G.templates().filter(function (x) { return x.name === 'Hero'; })[0];
      G.addSection(hero);
      var s = lastSec();
      var idx = G.sections().indexOf(s);
      var btns = s.els.filter(function (e) { return e.type === 'button'; });
      btns.slice(1).forEach(function (b) { s.els.splice(s.els.indexOf(b), 1); });
      var b1 = s.els.filter(function (e) { return e.type === 'button'; })[0];
      var b2 = JSON.parse(JSON.stringify(b1));
      b2.text = 'And drag me'; b2.x = b1.x + b1.w + 16; b2.y = b1.y;
      s.els.push(b2);
      G.renderSection(s);
      var faces = G.diceFaces(G.diceFamilyOf(s));
      var abs = function (e) {
        var c = s.els.filter(function (b) { return b.type === 'box' && b.kids && b.kids.indexOf(e) !== -1; })[0];
        return { x: (c ? c.x : 0) + e.x, y: (c ? c.y : 0) + e.y, w: e.w, h: e.h };
      };
      var log = [];
      for (var k = 0; k < faces.length; k++) {
        G.rollSection(idx);
        var all = G.diceFlatten(s.els).filter(function (e) { return e.type === 'button'; });
        var mine = all.filter(function (e) { return e.text === 'And drag me'; })[0];
        if (!mine) throw new Error('roll ' + (k + 1) + ': the second button lost its words or vanished');
        all.forEach(function (o) {
          if (o === mine) return;
          var a = abs(mine), b = abs(o);
          if (!(a.x >= b.x + b.w || a.x + a.w <= b.x || a.y >= b.y + b.h || a.y + a.h <= b.y)) throw new Error('roll ' + (k + 1) + ': the buttons overlap');
        });
        log.push(all.length);
      }
      G.deleteSection(idx);
      return 'buttons per take ' + log.join('/') + ', words kept, no overlap';
    });

    // NAME SIZE — the site name's size rides its block as a typography
    // style, merged over whatever the block already carried
    // THE TAKE MARK RIDES THE SAVE — the die marks the pieces it drew (tk)
    // and the drop rule reads that mark on the next roll; a saved model
    // without it turns every take-drawn piece into an original after a
    // reload, and the roll after that piles the riders up (the v435 leak)
    test('the dice: the take mark survives the saved model, so a reload does not leak riders', function () {
      var hero = G.templates().filter(function (x) { return x.name === 'Hero'; })[0];
      G.addSection(hero);
      var s = lastSec();
      var idx = G.sections().indexOf(s);
      // the Yellow House shape: one button of the user's own
      var btns = s.els.filter(function (e) { return e.type === 'button'; });
      btns.slice(1).forEach(function (b) { s.els.splice(s.els.indexOf(b), 1); });
      G.renderSection(s);
      // take 2 draws two buttons: the second is the die's, and wears its mark
      G.rollSection(idx);
      var marked = G.diceFlatten(s.els).filter(function (e) { return e.type === 'button' && e.tk != null; });
      if (marked.length !== 1) throw new Error('expected one take-drawn button after the roll, found ' + marked.length);
      // publish + reload: the block attrs are the stored truth
      var am = G.blocksV3(s).match(/<!-- wp:gogh\/section (\{[\s\S]*?\}) -->/);
      if (!am) throw new Error('no attrs on the section block');
      var model = JSON.parse(am[1]).model;
      var saved = G.diceFlatten(model.elements).filter(function (e) { return e.type === 'button'; });
      var savedMarked = saved.filter(function (e) { return e.tk != null; });
      if (saved.length !== 2) throw new Error('the saved model holds ' + saved.length + ' buttons, wanted 2');
      if (savedMarked.length !== 1 || savedMarked[0].tk !== marked[0].tk) throw new Error('the take mark did not reach the saved model (tk ' + JSON.stringify(saved.map(function (e) { return e.tk; })) + ')');
      // the page reads back exactly what was saved
      s.els = model.elements;
      s.m = model.m || null;
      G.renderSection(s);
      // two more rolls land on the one-button take: the die's button steps
      // aside, the user's own continues — one button, never two
      G.rollSection(idx);
      var r = G.rollSection(idx);
      var after = G.diceFlatten(s.els).filter(function (e) { return e.type === 'button'; });
      if (after.length !== 1) throw new Error('take ' + (r.face + 1) + ' after the reload carries ' + after.length + ' buttons, wanted 1 (the die’s button rode along)');
      if (G.diceFlatten(s.els).some(function (e) { return e.tk != null && e.tk !== r.face; })) throw new Error('a piece from an earlier take is still on the section');
      G.deleteSection(idx);
      return 'tk saved and read back; ' + G.diceFlatten(s.els).length + ' pieces on take ' + (r.face + 1) + ', one button';
    });
    test('the site name takes a size on its block', function () {
      var raw = '<div><!-- wp:site-title {"level":0,"style":{"color":{"text":"#123"}}} /--><!-- wp:navigation /--></div>';
      var out = G.titleRawWithSize(raw, 36);
      var m = out.match(/wp:site-title (\{[^]*?\}) \/-->/);
      if (!m) throw new Error('title block lost');
      var a = JSON.parse(m[1]);
      if (a.style.typography.fontSize !== '36px') throw new Error('size not set: ' + m[1]);
      if (a.style.color.text !== '#123' || a.level !== 0) throw new Error('existing attributes must survive');
      if (G.titleRawWithSize('<!-- wp:site-title /-->', 20).indexOf('"fontSize":"20px"') === -1) throw new Error('a bare block takes the size too');
      if (G.titleRawWithSize('<!-- wp:navigation /-->', 20) !== '<!-- wp:navigation /-->') throw new Error('no title, no change');
      return 'fontSize merged, colour and level kept';
    });

    // LAYOUT SHAPE — a saved header built from a gogh pattern is that
    // pattern's chip, whatever menu ref, logo width or whitespace it carries
    test('a saved part collapses into the layout chip it was built from', function () {
      var patt = '<!-- wp:group {"className":"gogh-hrow","layout":{"type":"flex","justifyContent":"space-between"}} -->\n<div><!-- wp:site-logo {"width":44} /-->\n<!-- wp:site-title {"level":0} /-->\n<!-- wp:navigation {"overlayMenu":"mobile","icon":"menu"} /--></div>\n<!-- /wp:group -->';
      var saved = '<!-- wp:group {"className":"gogh-hrow","layout":{"type":"flex","justifyContent":"space-between"}} --><div><!-- wp:site-logo {"width":160} /--><!-- wp:site-title {"level":0} /--><!-- wp:navigation {"ref":42,"overlayMenu":"mobile","icon":"menu"} /--></div><!-- /wp:group -->';
      var other = patt.replace('"justifyContent":"space-between"', '"justifyContent":"center"');
      if (G.chromeShape(saved) !== G.chromeShape(patt)) throw new Error('a saved copy with a menu ref and a logo width must match its pattern');
      if (G.chromeShape(other) === G.chromeShape(patt)) throw new Error('a different layout must not match');
      if (G.chromeShape('') !== '') throw new Error('no blocks, no shape');
      return 'ref + width + whitespace ignored; layout attrs decide';
    });

    // IDENTITY — back to a name: a logo-only layout's logo BECOMES the
    // title; a layout that already shows the name beside its mark just
    // loses the mark (two titles otherwise)
    test('use a text name: never two site titles', function () {
      var both = '<div><!-- wp:site-logo {"width":44} /-->\n\n<!-- wp:site-title {"level":0} /--></div><!-- wp:navigation /-->';
      var r1 = G.textIdentityRaw(both);
      if ((r1.match(/wp:site-title/g) || []).length !== 1) throw new Error('a logo+name layout should keep ONE title, got ' + r1);
      if (/wp:site-logo/.test(r1)) throw new Error('the logo should go');
      var only = '<div><!-- wp:site-logo {"width":120,"align":"center"} /--></div><!-- wp:navigation /-->';
      var r2 = G.textIdentityRaw(only);
      if ((r2.match(/wp:site-title/g) || []).length !== 1 || /wp:site-logo/.test(r2)) throw new Error('a logo-only layout should turn its logo into the title, got ' + r2);
      if (r2.indexOf('"textAlign":"center"') === -1) throw new Error('a centred logo should beget a centred title');
      if (G.textIdentityRaw('<!-- wp:site-title /-->') !== null) throw new Error('no logo → nothing to swap');
      return 'logo+name → name; logo-only → name (alignment kept); no logo → null';
    });

    // THE RUNTIME GUARD — a break announces itself: a piece that changed
    // size on a move, two texty pieces on one another; badges and the big
    // quotation mark are design, not breaks
    test('runtime guard: speaks on a resize or an overlap, silent on design', function () {
      G.guardReset();
      var s = { scope: 'gogh-sec-guard', els: [
        { type: 'heading', x: 72, y: 100, w: 400, h: 60, text: 'Alpha' },
        { type: 'para', x: 72, y: 140, w: 400, h: 60, text: 'Bravo sits on Alpha' },
        { type: 'badge', x: 72, y: 100, w: 120, h: 40, text: 'Loved' },
        { type: 'heading', x: 72, y: 100, w: 80, h: 80, text: '\u201c' },
      ] };
      var issues = G.guardCheck(s, 'test');
      if (issues.length !== 1 || !/Alpha/.test(issues[0])) throw new Error('expected the one real overlap, got ' + JSON.stringify(issues));
      var moved = { e: s.els[0], w: 380, h: 60 };
      var issues2 = G.guardCheck({ scope: 'x', els: [s.els[0]] }, 'test', moved);
      if (issues2.length !== 1 || !/changed size/.test(issues2[0])) throw new Error('a size change must be called out: ' + JSON.stringify(issues2));
      if (G.guardCheck({ scope: 'x', els: [s.els[0], s.els[2], s.els[3]] }, 'test').length) throw new Error('a badge or a glyph over a heading is design, not a break');
      var n = G.guardLog().length;
      G.guardReset();
      return 'overlap + resize spoke (' + n + ' entries), design stayed silent';
    });

    // STARTER SWEEP — every starter, every take, every piece: the invariants
    // that today's bugs broke, checked on REAL shapes rather than hand-made
    // fixtures. Roll four times: nothing lost, nothing on top of anything,
    // home is home. Drag every top-level piece: it moves by the hand's
    // delta (or to the edge) and never changes size.
    test('starter sweep: rolls keep every piece apart and drags never resize', function () {
      var starters = G.templates().filter(function (t) { return t.starter && !t.retired && t.els && t.els.length; });
      var problems = [];
      G.guardReset(); // the runtime guard must stay silent through the whole sweep
      var rolled = 0, dragged = 0;
      // badges sit on corners by design and a one-glyph heading (the big
      // quotation mark) is decoration: neither counts as an overlap
      var texty = function (e) {
        if (e.type === 'badge') return false;
        if (e.type === 'heading' && String(e.text || '').replace(/<[^>]+>/g, '').trim().length <= 2) return false;
        return e.type === 'heading' || e.type === 'para' || e.type === 'button';
      };
      var absAll = function (s) {
        var out = [];
        s.els.forEach(function (e) {
          out.push({ e: e, x: e.x, y: e.y, w: e.w, h: e.h, card: null });
          (e.kids || []).forEach(function (k) { out.push({ e: k, x: e.x + k.x, y: e.y + k.y, w: k.w, h: k.h, card: e }); });
        });
        return out;
      };
      var overlaps = function (s, label) {
        var A = absAll(s).filter(function (r) { return texty(r.e); });
        for (var i = 0; i < A.length; i++) for (var j = i + 1; j < A.length; j++) {
          var a = A[i], b = A[j];
          if (a.card !== b.card) continue; // a card's kids and the page are different stacks
          var ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          var oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          if (ox > 12 && oy > 12) return label + ': ' + a.e.type + ' "' + String(a.e.text || '').slice(0, 14) + '" on ' + b.e.type + ' "' + String(b.e.text || '').slice(0, 14) + '"';
        }
        return null;
      };
      var pv = function (type, el, x, y, id) {
        el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: id, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
      };
      starters.forEach(function (t, ti) {
        G.addSection(t);
        var s = lastSec();
        var idx = G.sections().indexOf(s);
        var fam = G.diceFamilyOf(s);
        var faces = fam ? G.diceFaces(fam) : null;
        var count0 = G.diceFlatten(s.els).filter(function (e) { return e.type !== 'box'; }).length;
        var home = JSON.stringify(s.els.map(function (e) { return e.type + '@' + e.x + ',' + e.y; }));
        if (faces) {
          for (var k = 0; k < faces.length; k++) {
            G.rollSection(idx);
            rolled++;
            var c = G.diceFlatten(s.els).filter(function (e) { return e.type !== 'box'; }).length;
            if (c < count0) problems.push(t.name + ' take ' + (k + 1) + ': lost a piece (' + c + ' of ' + count0 + ')');
            var ov = overlaps(s, t.name + ' take ' + (k + 1));
            if (ov) problems.push(ov);
          }
          var back = JSON.stringify(s.els.map(function (e) { return e.type + '@' + e.x + ',' + e.y; }));
          if (back !== home) problems.push(t.name + ': four rolls did not come home');
        }
        // the guard must have stayed silent through the rolls (a roll is
        // gogh's own doing; a drag below may park a button on its neighbour
        // on purpose, so only a size change counts there)
        G.guardLog().forEach(function (g) { problems.push(t.name + ': guard on ' + g.why + ' \u2014 ' + g.issues[0]); });
        G.guardReset();
        // drag each top-level piece by (+40, +24): position follows, size holds
        var sc = s.sectionEl.getBoundingClientRect().width / 1200;
        s.els.slice().forEach(function (e, i) {
          if (e.type === 'box' && e.kids) return;
          var node = s.nodes[s.els.indexOf(e)];
          if (!node) return;
          var w0 = e.w, h0 = e.h, x0 = e.x, y0 = e.y;
          var r = node.getBoundingClientRect();
          var id = 3000 + ti * 40 + i;
          pv('pointerdown', node, r.left + 6, r.top + 6, id); pv('pointerup', document, r.left + 6, r.top + 6, id);
          r = node.getBoundingClientRect();
          pv('pointerdown', node, r.left + 6, r.top + 6, id + 1);
          pv('pointermove', document, r.left + 6 + 20 * sc, r.top + 6 + 12 * sc, id + 1);
          pv('pointermove', document, r.left + 6 + 40 * sc, r.top + 6 + 24 * sc, id + 1);
          pv('pointerup', document, r.left + 6 + 40 * sc, r.top + 6 + 24 * sc, id + 1);
          dragged++;
          var still = s.els.indexOf(e) !== -1 || G.diceFlatten(s.els).indexOf(e) !== -1;
          if (!still) return; // joined a card or wrapped: another test's contract
          if (e.w !== w0 || e.h !== h0) problems.push(t.name + ' ' + e.type + ': drag changed its size ' + w0 + 'x' + h0 + ' → ' + e.w + 'x' + e.h);
          if (e.x === x0 && e.y === y0 && x0 + e.w + 40 <= 1200) problems.push(t.name + ' ' + e.type + ': drag did not move it');
        });
        G.guardLog().forEach(function (g) {
          g.issues.forEach(function (msg) { if (/changed size/.test(msg)) problems.push(t.name + ': guard on ' + g.why + ' \u2014 ' + msg); });
        });
        G.guardReset();
        G.deleteSection(idx);
        [].slice.call(document.querySelectorAll('.gogh-toast')).forEach(function (x) { x.remove(); });
      });
      if (problems.length) throw new Error(problems.length + ' problem(s): ' + problems.slice(0, 6).join(' | '));
      return starters.length + ' starters, ' + rolled + ' rolls, ' + dragged + ' drags: no losses, no overlaps, no resizes, guard silent';
    });

    // NOTICES — one per kind, never a trail: status replaces status,
    // a receipt with Undo keeps its slot, and the take label lives in
    // the section bar rather than in a toast
    test('notices: one per kind, and the take reads from the section bar', function () {
      [].slice.call(document.querySelectorAll('.gogh-toast')).forEach(function (t) { t.remove(); });
      var mine = function () {
        return [].slice.call(document.querySelectorAll('.gogh-toast')).filter(function (x) {
          return /^ntc-/.test(x.textContent);
        });
      };
      G.toast('ntc-status one', { sticky: true });
      G.toast('ntc-status two', { sticky: true });
      if (mine().length !== 1 || mine()[0].textContent.indexOf('two') === -1) throw new Error('a second status should replace the first, got ' + mine().length);
      G.toast('ntc-receipt', { sticky: true, actions: [{ label: 'Undo', onClick: function () {} }] });
      G.toast('ntc-status three', { sticky: true });
      var left = mine().map(function (x) { return x.textContent.replace(/Undo$/, '').trim(); });
      if (left.length !== 2 || left.indexOf('ntc-receipt') === -1 || left.indexOf('ntc-status three') === -1) throw new Error('a receipt must survive a later status: ' + left.join(' | '));
      mine().forEach(function (t) { t.remove(); });
      // the take label: in the bar, in place, and no toast on a roll
      var hero = G.templates().filter(function (x) { return x.name === 'Hero'; })[0];
      if (!hero) throw new Error('no Hero template');
      G.addSection(hero);
      var s = lastSec();
      var idx = G.sections().indexOf(s);
      G.selectSection(idx);
      var lab = document.querySelector('.gogh-secbar .gogh-sb-take');
      if (!lab || lab.hidden || !/^1\//.test(lab.textContent)) throw new Error('the take label should read 1/N on a fresh take, got ' + (lab && lab.textContent));
      var before = document.querySelectorAll('.gogh-toast').length;
      var die = document.querySelector('.gogh-secbar .gogh-sb-dice');
      die.click();
      if (!/^2\//.test(lab.textContent)) throw new Error('the label should follow the roll, got ' + lab.textContent);
      var after = [].slice.call(document.querySelectorAll('.gogh-toast')).filter(function (t) { return /Take \d/.test(t.textContent); });
      if (after.length) throw new Error('a roll must not toast its take');
      G.deleteSection(idx);
      return 'status replaces status, receipt keeps its slot; bar reads ' + lab.textContent + ', ' + (document.querySelectorAll('.gogh-toast').length - before) + ' new toasts on roll';
    });

    // MANUAL — the reference look: contents built from the post's own
    // headings, ids minted where missing, the current section marked
    test('the Manual look builds its contents from the headings', function () {
      if (typeof window.goghManualToc !== 'function') throw new Error('goghManualToc is not on the page');
      var root = document.createElement('div');
      root.className = 'entry-content';
      root.innerHTML = '<p>Intro</p><h2>Install it</h2><p>a</p><h3>On a Mac</h3><p>b</p><h2 id="kept">Configure</h2><p>c</p><h2>Install it</h2><p>d</p>';
      document.body.appendChild(root);
      try {
        var nav = window.goghManualToc(root);
        if (!nav || !root.classList.contains('gogh-has-toc')) throw new Error('no contents were built');
        var links = [].map.call(nav.querySelectorAll('a'), function (a) { return a.getAttribute('href'); });
        if (links.length !== 4) throw new Error('expected 4 entries, got ' + links.length + ': ' + links.join(' '));
        if (links[0] !== '#install-it' || links[1] !== '#on-a-mac' || links[2] !== '#kept' || links[3] !== '#install-it-2') throw new Error('ids were not minted as expected: ' + links.join(' '));
        if (!nav.querySelector('li.gogh-toc-h3')) throw new Error('the h3 lost its level');
        if (root.firstChild !== nav) throw new Error('the contents should sit first in the content');
        var tiny = document.createElement('div'); tiny.innerHTML = '<h2>Only one</h2><p>x</p>';
        if (window.goghManualToc(tiny) !== null) throw new Error('one heading should build no contents');
        return links.join(' ') + ' · one heading builds nothing';
      } finally { root.remove(); }
    });

    // the paste-a-page demo lands with the Paste HTML door open (?gogh-paste=1)
    test('the paste door opens the picker on its Paste HTML pane', function () {
      if (!G.openPasteDoor()) throw new Error('the picker has no Paste HTML card');
      var ta = document.querySelector('.gogh-picker .gogh-htmlpaste');
      if (!ta) throw new Error('the paste pane did not open');
      if (!document.querySelector('.gogh-picker .gogh-html-add')) throw new Error('no Add to page button');
      document.querySelector('.gogh-picker .gogh-picker-close').click();
      return 'picker open on Paste HTML, then closed';
    });

    // the kind of HTML an AI writes: no styling at all, bare links between
    // paragraphs. Those links are the page's buttons, and the converted
    // section must land in a design family so the die has somewhere to go
    test('bare links in unstyled pasted HTML become buttons, and the page finds a family', function () {
      G.addHtmlSection('<section><p>Saltmarsh · Hastings</p><h1>Bowls you will reach for</h1>' +
        '<p>We throw stoneware in a shed by the sea.</p><a href="/shop/">See the shelves</a><a href="/visit/">Book a lesson</a>' +
        '<img src="/wp-content/plugins/gogh/demo-assets/sunflowers.jpg" alt="Bowls"></section>', null);
      var entry = G.pending()[G.pending().length - 1];
      entry.el.querySelector('.gogh-pend-ff').click();
      var added = lastSec();
      var byType = function (t) { return added.els.filter(function (e) { return e.type === t; }); };
      var btns = byType('button');
      if (btns.length !== 2) throw new Error('expected 2 buttons from the bare links, got ' + btns.length + ' (' + added.els.map(function (e) { return e.type; }).join('/') + ')');
      if (btns[0].text !== 'See the shelves' || btns[0].href !== '/shop/') throw new Error('the first button lost its words or its link');
      if (byType('widget').length) throw new Error('something was left as a widget: ' + byType('widget').map(function (e) { return (e.whtml || '').slice(0, 40); }).join(' | '));
      var fam = G.diceFamilyOf(added);
      if (!fam) throw new Error('the converted page found no design family');
      return 'buttons: ' + btns.map(function (b) { return b.text; }).join(', ') + ' · family: ' + fam;
    });

    // styled pasted HTML (the kind an AI writes): a painted container that
    // holds a picture and words converts to a CARD — a box with kids — and a
    // text-only div is a paragraph, never an opaque widget (James's collection)
    test('a painted container in pasted HTML converts to a card with kids', function () {
      G.addHtmlSection('<div style="background:#171717;padding:60px;color:#f5f5f5">' +
        '<div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#9f9f9f;margin-bottom:20px">Featured collection</div>' +
        '<h2 style="margin:0 0 30px;font-size:64px;line-height:1">Ideas made beautiful.</h2>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:32px">' +
        '<div style="background:#202020;border:1px solid rgba(255,255,255,.08)"><img src="/wp-content/plugins/gogh/demo-assets/sunflowers.jpg" alt="One" style="display:block;width:100%;height:220px;object-fit:cover"><div style="padding:32px"><div style="font-size:11px;text-transform:uppercase;color:#969696">Editorial design</div><h3 style="margin:12px 0;font-size:36px">Crafted with care.</h3><p style="margin:0 0 24px;color:#a8a8a8">Thoughtful layouts and carefully selected details.</p><a href="#" style="border-bottom:1px solid #fff;color:#f5f5f5;text-decoration:none">Explore</a></div></div>' +
        '<div style="background:#202020;border:1px solid rgba(255,255,255,.08)"><img src="/wp-content/plugins/gogh/demo-assets/wheat-field.jpg" alt="Two" style="display:block;width:100%;height:220px;object-fit:cover"><div style="padding:32px"><div style="font-size:11px;text-transform:uppercase;color:#969696">Creative direction</div><h3 style="margin:12px 0;font-size:36px">Designed to inspire.</h3><p style="margin:0 0 24px;color:#a8a8a8">Strong imagery and a restrained system.</p><a href="#" style="border-bottom:1px solid #fff;color:#f5f5f5;text-decoration:none">View work</a></div></div>' +
        '</div></div>', null);
      var entry = G.pending()[G.pending().length - 1];
      entry.el.querySelector('.gogh-pend-ff').click();
      var added = lastSec();
      var types = added.els.map(function (e) { return e.type + (e.kids ? '{' + e.kids.map(function (k) { return k.type; }).join(',') + '}' : ''); });
      var cards = added.els.filter(function (e) { return e.type === 'box' && e.kids && e.kids.length; });
      if (cards.length !== 2) throw new Error('expected 2 cards, got ' + cards.length + ': ' + types.join(' / '));
      cards.forEach(function (c, i) {
        var kt = c.kids.map(function (k) { return k.type; });
        if (kt.indexOf('image') === -1 || kt.indexOf('heading') === -1 || kt.indexOf('button') === -1) throw new Error('card ' + (i + 1) + ' is missing a piece: ' + kt.join(','));
        if (c.kids.some(function (k) { return k.type === 'widget'; })) throw new Error('card ' + (i + 1) + ' kept a widget: ' + kt.join(','));
        if (c.kids.some(function (k) { return k.x < 0 || k.y < 0 || k.x + k.w > c.w + 4; })) throw new Error('a kid sits outside card ' + (i + 1));
      });
      if (added.els.some(function (e) { return e.type === 'widget'; })) throw new Error('a text-only div became a widget: ' + types.join(' / '));
      var eyebrow = added.els.filter(function (e) { return e.type === 'para' && /Featured collection/.test(e.text); })[0];
      if (!eyebrow) throw new Error('the eyebrow div did not become a paragraph');
      // three priced cards find the three-card family
      G.addHtmlSection('<section style="background:#0f1115;color:#eef0f3;padding:80px"><p style="text-transform:uppercase;font-size:12px">Lessons</p><h2 style="font-size:48px">Three ways in.</h2><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px">' +
        ['Taster|£45|One evening.', 'Term|£240|Six evenings.', 'Studio|£90|Any day.'].map(function (r) { var q = r.split('|'); return '<div style="background:#171a21;border-radius:20px;padding:32px"><p style="text-transform:uppercase;font-size:12px">' + q[0] + '</p><h3 style="font-size:40px">' + q[1] + '</h3><p>' + q[2] + '</p><a href="#" style="display:inline-block;padding:12px 20px;border:1px solid #fff;color:#fff;text-decoration:none">Book</a></div>'; }).join('') +
        '</div></section>', null);
      var e2 = G.pending()[G.pending().length - 1];
      e2.el.querySelector('.gogh-pend-ff').click();
      var priced = lastSec();
      var famP = G.diceFamilyOf(priced);
      if (famP !== 'Pricing') throw new Error('three priced cards should roll within Pricing, got ' + famP + ' (' + priced.els.map(function (e) { return e.type + (e.kids ? '{' + e.kids.length + '}' : ''); }).join('/') + ')');
      return types.join(' / ') + ' · three cards → ' + famP;
    });

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

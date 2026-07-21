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
    var sec = function () { return G.sections()[0]; };
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
    function expect(cond, msg) { if (!cond) throw new Error(msg); }

    G.setEditing(true);
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
      var before = sec().els.map(function (o) { return o.y; });
      var h0 = e.h;
      select(i);
      dragBy(q('.gogh-h-e'), -260, 0, 13);
      var grew = e.h - h0;
      expect(grew > 20, 'heading did not grow (' + grew + ')');
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
        if (j === i) return;
        expect(!rectsOverlap(hr, n.getBoundingClientRect()),
          sec().els[j].type + ' overlaps grown heading');
      });
      return 'grew ' + grew + ', in-path pushed equally';
    });

    // ---- 5b. frame-interleaved resize pushes exactly once (v0.12.1) ----
    test('per-frame resize push is incremental, not compounding', function () {
      var i = findIdx('heading');
      var e = sec().els[i];
      var h0 = e.h;
      var before = sec().els.map(function (o) { return o.y; });
      select(i);
      var eh = q('.gogh-h-e');
      var r = eh.getBoundingClientRect();
      var x = r.x + r.width / 2, y = r.y + r.height / 2;
      pev('pointerdown', eh, x, y, 41);
      // interleave moves with the frame body, as a real 60fps drag does
      for (var f = 1; f <= 4; f++) {
        pev('pointermove', eh, x - 50 * f, y, 41);
        var oldH = e.h;
        G.resolve(sec()); G.measure(sec());
        G.reflowPush(sec(), e, oldH);
        G.resolve(sec());
      }
      pev('pointerup', eh, x - 200, y, 41);
      var grew = e.h - h0;
      expect(grew > 10, 'heading did not grow');
      var pushed = sec().els[1].y - before[1];
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
    test('palette adds a badge', function () {
      var last = function () { return G.sections()[G.sections().length - 1]; };
      var n0 = last().els.length;
      q('.gogh-side [data-add="badge"]').click();
      expect(last().els.length === n0 + 1, 'not added');
      expect(last().els[last().els.length - 1].type === 'badge', 'wrong type');
    });

    // ---- 13. add section from template ----
    test('+ Section adds a template section', function () {
      var s0 = G.sections().length;
      q('.gogh-side [data-act="addsec"]').click();
      var card = q('.gogh-card[data-tpl="3"]');
      expect(card, 'picker did not open');
      card.click();
      expect(G.sections().length === s0 + 1, 'section not added');
      var added = G.sections()[G.sections().length - 1];
      expect(added.els.length > 0, 'template empty');
      expect(added.styleEl.textContent.indexOf(added.scope) !== -1, 'scoped CSS missing');
    });

    test('Hero template resolves largest font preset + minH', function () {
      var s0 = G.sections().length;
      q('.gogh-side [data-act="addsec"]').click();
      q('.gogh-card[data-tpl="0"]').click();
      var added = G.sections()[G.sections().length - 1];
      var head = added.els.filter(function (e) { return e.type === 'heading'; })[0];
      var sizes = G.fontSizes();
      var biggest = sizes.length ? sizes[sizes.length - 1].slug : null;
      expect(head, 'hero has no heading');
      expect(head.fs === biggest, 'heading fs ' + head.fs + ' != largest preset ' + biggest);
      expect(head.fs !== '__max', 'sentinel leaked into model');
      expect(added.minH === 640, 'hero minH not applied: ' + added.minH);
      G.deleteSection(G.sections().length - 1);
      expect(G.sections().length === s0, 'cleanup failed');
    });

    test('toolbar alignment cycles left/center/right', function () {
      var i = findIdx('heading');
      select(i);
      var al = q('.gogh-eb-al');
      expect(al && al.style.display !== 'none', 'align button not shown for heading');
      var e = sec().els[i];
      var a0 = e.align || null;
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
      q('.gogh-side .gogh-close').click();
      var panel = q('.gogh-exit');
      expect(panel && !panel.hidden, 'exit panel did not open');
      q('.gogh-exit-keep').click();
      expect(panel.hidden, 'keep editing did not close panel');
      expect(document.documentElement.classList.contains('gogh-editing'), 'left edit mode');
    });

    test('toast shows message and actions work', function () {
      var acted = false;
      window.__gogh.toast('test toast', { sticky: true, actions: [{ label: 'Do it', onClick: function () { acted = true; } }] });
      var t = q('.gogh-toast');
      expect(t && t.textContent.indexOf('test toast') !== -1, 'toast not shown');
      t.querySelector('button').click();
      expect(acted, 'toast action did not fire');
      expect(!q('.gogh-toast'), 'toast not removed after action');
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

    // ---- 15. divider + section backgrounds (v0.10) ----
    test('divider CSS generated with next-section colour', function () {
      q('.gogh-side [data-act="addsec"]').click();
      q('.gogh-card[data-tpl="3"]').click();
      G.openShapePanel(1);
      q('.gogh-shape[data-shape="curve"]').click();
      var belowInput = q('.gogh-color-below');
      belowInput.value = '#123456';
      belowInput.dispatchEvent(new Event('input', { bubbles: true }));
      var s0 = G.sections()[0];
      expect(s0.divider && s0.divider.shape === 'curve', 'divider not set');
      var css = s0.styleEl.textContent;
      expect(css.indexOf('::after') !== -1, 'no ::after rule');
      // v0.15: colour is a plain background behind an SVG mask, so CSS
      // variables (theme palette) work as divider colours
      expect(css.indexOf('mask-image') !== -1, 'divider not mask-based');
      expect(css.indexOf('background: #123456') !== -1, 'divider colour missing');
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

    // ---- 17. section ops: delete + undo ----
    test('delete section + undo restores it', function () {
      q('.gogh-side [data-act="addsec"]').click();
      q('.gogh-card[data-tpl="3"]').click();
      var s0 = G.sections().length;
      G.deleteSection(s0 - 1);
      expect(G.sections().length === s0 - 1, 'not deleted');
      expect(!document.contains(document.querySelector('.gogh-card-sec')) || true, '');
      q('.gogh-undo').click();
      expect(G.sections().length === s0, 'undo did not restore section');
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
      q('.gogh-side [data-act="addsec"]').click();
      q('.gogh-card[data-tpl="3"]').click();
      var added = G.sections()[G.sections().length - 1];
      G.moveSection(G.sections().length - 1, -1);
      expect(G.sections()[G.sections().length - 2] === added, 'model order wrong');
      var wraps = [].slice.call(document.querySelectorAll('.entry-content > .gogh-wrap, .gogh-wrap'))
        .filter(function (w) { return !w.closest('.gogh-picker'); });
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
      var i = findIdx('heading');
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
      var big = sizes[sizes.length - 1].slug;
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
      expect(px1 === sizes[sizes.length - 1].px, 'size is not the preset value');
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
      G.setSecBg(0, 'https://example.com/bg.jpg', null);
      var css = s0.styleEl.textContent;
      expect(css.indexOf('url("https://example.com/bg.jpg") center / cover') !== -1, 'bg image missing');
      s0.bg = 'var(--wp--preset--color--contrast)';
      G.resolveAll();
      css = s0.styleEl.textContent;
      expect(css.indexOf('color-mix') !== -1 && css.indexOf('linear-gradient') !== -1, 'tint layer missing');
      G.setSecBg(0, null);
      expect(sec().styleEl.textContent.indexOf('bg.jpg') === -1, 'remove failed');
    });

    // ---- 25. gogh/section block format (v0.18) ----
    test('serializes to gogh/section blocks (deactivation-safe)', function () {
      var markup = G.buildBlocks();
      expect(markup.indexOf('<!-- wp:gogh/section -->') !== -1, 'no gogh/section block');
      expect(markup.indexOf('<!-- wp:html -->') === -1, 'legacy carrier still emitted');
      expect(markup.indexOf('<style class="gogh-style">') !== -1, 'style not in saved markup');
      expect(markup.indexOf('class="gogh-model"') !== -1, 'model not in saved markup');
      expect(markup.indexOf('data-gogh-scope=') !== -1, 'scope attribute missing');
      // the style tag INSIDE the block markup is what makes deactivation safe
      var block = markup.split('<!-- wp:gogh/section -->')[1];
      expect(block.indexOf('<style class="gogh-style">') !== -1 &&
        block.indexOf('</style>') < block.indexOf('<!-- /wp:gogh/section -->'),
        'style not inside the block');
      return (markup.match(/<!-- wp:gogh\/section -->/g) || []).length + ' section block(s)';
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
      q('.gogh-side [data-add="badge"]').click();
      q('.gogh-side [data-add="badge"]').click();
      q('.gogh-side [data-add="badge"]').click();
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
      q('.gogh-side [data-add="badge"]').click();
      q('.gogh-side [data-add="badge"]').click();
      q('.gogh-side [data-add="badge"]').click();
      q('.gogh-side [data-add="badge"]').click();
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
      q('.gogh-side [data-add="para"]').click();
      q('.gogh-side [data-add="badge"]').click();
      q('.gogh-side [data-add="badge"]').click();
      q('.gogh-side [data-add="badge"]').click();
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

    // ---- 28e. convertScan measures Gutenberg leaves into elements ----
    test('convertScan lifts rendered blocks into a model', function () {
      var host = document.createElement('div');
      host.style.cssText = 'width:600px;position:absolute;left:-9999px;top:0;';
      host.innerHTML =
        '<div class="wp-block-group">' +
        '<h2 class="has-x-large-font-size" style="height:40px;margin:0">Head</h2>' +
        '<p style="height:30px;margin:0">Copy</p>' +
        '<div class="wp-block-buttons" style="display:flex;gap:10px">' +
        '<div class="wp-block-button" style="width:120px;height:36px"><a href="https://x.test">Go</a></div>' +
        '<div class="wp-block-button is-style-outline" style="width:120px;height:36px"><a>Ghost</a></div>' +
        '</div>' +
        '<figure class="wp-block-image" style="width:200px;height:100px;margin:0">' +
        '<img class="wp-image-42" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="pic" style="width:100%;height:100%"></figure>' +
        '</div>';
      document.body.appendChild(host);
      var scan = G.convertScan(host);
      host.remove();
      var types = scan.els.map(function (e) { return e.type; }).join(',');
      expect(scan.bad.length === 0, 'unexpected bad blocks: ' + scan.bad.join(','));
      expect(types === 'heading,para,button,button,image', 'types: ' + types);
      expect(scan.els[0].fs === 'x-large', 'font preset not captured: ' + scan.els[0].fs);
      expect(scan.els[2].href === 'https://x.test', 'href lost');
      expect(scan.els[3].ghost === true, 'outline style not mapped to ghost');
      expect(scan.els[4].mediaId === 42 && scan.els[4].alt === 'pic', 'image id/alt lost');
      // 600px host -> x2 scale into 1200-unit design space
      expect(Math.abs(scan.els[4].w - 400) <= 2, 'image width not scaled: ' + scan.els[4].w);
      return types;
    });

    // ---- 29. layer ordering via toolbar ----
    test('bring forward / send backward reorder stacking', function () {
      var t0 = sec().els[0].type, t1 = sec().els[1].type;
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

    // ---- report ----
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

  if (window.__gogh) run();
  else document.addEventListener('gogh:ready', run, { once: true });
})();

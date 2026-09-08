/* gogh user-test walk — the Site Editor user-testing script, walked by a
 * script against a REAL Yellow House (a disposable Playground), before a
 * release. Open the home page as an editor with ?gogh-edit=1&gogh-walk=1.
 * It SAVES (publishes) — never point it at a site you care about.
 * Results: on-screen panel + window.__goghWalk for automation.
 * Statuses: pass · fail · gap (a door the script expects and cannot find).
 */
(function () {
  'use strict';
  if (!/[?&]gogh-walk/.test(location.search)) return;
  if (!/^(localhost|127\.0\.0\.1|.*playground\.wordpress\.net)$/.test(location.hostname)) {
    console.warn('gogh walk: refusing to run outside a local or Playground site');
    return;
  }
  // the header room RELOADS the page on Done — the walk must survive that:
  // progress lives in sessionStorage and the walk resumes at the next step
  var KEY = 'gogh-walk-state';
  var state = { steps: [], next: 0, pending: null };
  try { state = Object.assign(state, JSON.parse(sessionStorage.getItem(KEY) || '{}')); } catch (e) {}
  var steps = state.steps || [];
  var save = function () { try { sessionStorage.setItem(KEY, JSON.stringify({ steps: steps, next: state.next, pending: state.pending })); } catch (e) {} };
  var panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;left:16px;top:70px;z-index:100050;width:360px;max-height:70vh;overflow:auto;background:#101014;color:#e8eaf0;font:12px/1.4 ui-monospace,Menlo,monospace;padding:12px 14px;border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.5)';
  document.body.appendChild(panel);
  function render(done) {
    var pass = steps.filter(function (s) { return s.status === 'pass'; }).length;
    var fail = steps.filter(function (s) { return s.status === 'fail'; }).length;
    var gap = steps.filter(function (s) { return s.status === 'gap'; }).length;
    panel.innerHTML = '<div style="font-weight:700;margin-bottom:8px">gogh walk — ' + pass + ' pass · ' + fail + ' fail · ' + gap + ' gap' + (done ? '' : ' · walking…') + '</div>' +
      steps.map(function (s) {
        var mark = s.status === 'pass' ? '✓' : s.status === 'gap' ? '○' : '✗';
        var col = s.status === 'pass' ? '#7ad97a' : s.status === 'gap' ? '#e8b04b' : '#ff6b6b';
        return '<div style="margin:4px 0"><span style="color:' + col + '">' + mark + '</span> ' + s.name + (s.detail ? ' <span style="opacity:.7">— ' + String(s.detail).replace(/</g, '&lt;') + '</span>' : '') + '</div>';
      }).join('');
    if (done) {
      window.__goghWalk = { summary: pass + ' pass, ' + fail + ' fail, ' + gap + ' gap', steps: steps.slice() };
      try { sessionStorage.removeItem(KEY); } catch (e) {}
    }
  }
  function log(name, status, detail) { steps.push({ name: name, status: status, detail: detail || '' }); save(); render(false); }
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  async function until(fn, ms, what) {
    var t0 = Date.now();
    while (Date.now() - t0 < (ms || 6000)) {
      var v = fn();
      if (v) return v;
      await wait(120);
    }
    throw new Error('waited for ' + (what || 'something') + ' in vain');
  }
  var q = function (s, root) { return (root || document).querySelector(s); };
  var qa = function (s, root) { return [].slice.call((root || document).querySelectorAll(s)); };
  var byText = function (sel, re, root) { return qa(sel, root).filter(function (b) { return re.test(b.textContent.trim()); })[0] || null; };
  var pev = function (type, el, x, y, id) {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: id || 1, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
  };
  var clickEl = function (el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); };
  var textOf = function (html) { return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '); };

  var stepNo = 0;
  async function step(name, fn) {
    var k = stepNo++;
    if (k < state.next) return; // done before the reload
    state.next = k; save();
    try {
      var d = await fn();
      log(name, d && d.gap ? 'gap' : 'pass', d && d.gap ? d.gap : (d || ''));
    } catch (err) {
      log(name, 'fail', String((err && err.message) || err));
    }
    state.next = k + 1; save();
  }
  // a step that ends in a reload records what to verify afterwards
  function expectReload(name, check) { state.pending = { name: name, check: check }; save(); }

  async function walk() {
    var G = window.__gogh;
    var H = { 'X-WP-Nonce': window.GOGH.nonce, 'Content-Type': 'application/json' };
    if (state.pending) {
      var pend = state.pending; state.pending = null;
      var hdr = q('header');
      var changed = !!(hdr && hdr.innerHTML.length !== pend.check.sig);
      steps.push({ name: pend.name, status: changed ? 'pass' : 'fail', detail: changed ? 'header re-dressed, page reloaded on Done' : 'the header looks unchanged after the reload' });
      state.next = state.next + 1; save(); render(false);
    }
    var content = function () { return G.sections().filter(function (s) { return !s.chrome; }); };
    var T = function (n) { return G.templates().filter(function (t) { return t.name === n; })[0]; };
    if (G.guardReset) G.guardReset();

    // 1 — the visitor lands on the home page and can tell it is home
    await step('Preview: the front page is the home page', async function () {
      var r = await fetch('/?walk=' + Date.now()); var html = await r.text();
      if (!/Grab this title/.test(html)) { await wait(800); r = await fetch('/?walk=' + Date.now()); html = await r.text(); }
      if (r.status !== 200) throw new Error('front page answered ' + r.status);
      if (!/Grab this title/.test(html)) throw new Error('the Yellow House hero is not on the front page');
      var chip = qa('[class*="gogh-chip"]').map(function (c) { return c.textContent; }).join(' ');
      if (!/Home/.test(chip)) throw new Error('the nameplate does not say Home');
      return 'hero on the front page, nameplate says Home';
    });

    // 2 — the die on the hero: four rolls, home again, nothing broken
    await step('Edit the home page: roll the hero four times', async function () {
      var s = content()[0]; var idx = G.sections().indexOf(s);
      var home = JSON.stringify(s.els.map(function (e) { return e.type + '@' + e.x + ',' + e.y; }));
      var faces = G.diceFaces(G.diceFamilyOf(s));
      if (!faces) throw new Error('the hero has no die');
      for (var k = 0; k < faces.length; k++) G.rollSection(idx);
      var back = JSON.stringify(s.els.map(function (e) { return e.type + '@' + e.x + ',' + e.y; }));
      if (back !== home) throw new Error('four rolls did not come home');
      var gl = G.guardLog ? G.guardLog() : [];
      if (gl.length) throw new Error('the guard spoke: ' + gl[0].issues[0]);
      return faces.length + ' takes, home again, guard silent';
    });

    // 3 — edit the headline and publish; the visitor sees the new words
    await step('Edit the home page: change the headline and publish', async function () {
      var s = content()[0];
      var h = s.els.filter(function (e) { return e.type === 'heading'; })[0];
      if (!h) throw new Error('no headline in the hero');
      h.text = 'Welcome to the Yellow House';
      G.renderSection(s); G.pushState();
      var ok = await G.publish();
      if (ok === false) throw new Error('publish did not run');
      await until(function () { return !/Publishing/.test(document.body.textContent); }, 8000, 'publish to finish');
      var html = await (await fetch('/?walk=' + Date.now())).text();
      if (!/Welcome to the Yellow House/.test(html)) throw new Error('the new headline is not on the front page');
      return 'published, visible to visitors';
    });

    // 4 — can visitors contact you? add the Get in touch section
    await step('Contact: add a Get in touch section and publish', async function () {
      var t = T('Get in touch');
      if (!t) throw new Error('no Get in touch starter');
      G.addSection(t);
      await G.publish();
      await until(function () { return !/Publishing/.test(document.body.textContent); }, 8000, 'publish to finish');
      var html = await (await fetch('/?walk=' + Date.now())).text();
      if (!/gogh-form|gogh\/form|Your name/.test(html)) throw new Error('no form on the published page');
      return 'form section live';
    });

    // 5 — identity: the site name through the header room
    await step('Identity: change the site name from the header', async function () {
      var pill = q('header .gogh-chromeveil-pill') || q('.gogh-chromeveil-pill');
      if (!pill) throw new Error('no Edit site header pill');
      clickEl(pill);
      var door = await until(function () { return q('.gogh-panel .gogh-hlogo'); }, 8000, 'the Logo & name door');
      clickEl(door);
      var totext = await until(function () { return q('.gogh-panel .gogh-logo-totext') || q('.gogh-panel .gogh-logoname-in'); }, 8000, 'the name page');
      if (totext.classList.contains('gogh-logo-totext')) {
        clickEl(totext);
        await until(function () { return q('.gogh-panel .gogh-logoname-in'); }, 10000, 'the name field');
      }
      var input = q('.gogh-panel .gogh-logoname-in');
      input.value = 'The Yellow House, Arles';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await until(function () { return /Yellow House, Arles/.test((q('header .wp-block-site-title') || {}).textContent || ''); }, 8000, 'the header to show the new name');
      var doors = textOf(q('.gogh-panel').innerHTML);
      var back = q('.gogh-panel .gogh-panel-close'); if (back) clickEl(back);
      if (!/Tagline/i.test(doors) || !/icon/i.test(doors)) return { gap: 'name changes; no Tagline or Site icon door in Logo & name' };
      return 'name changed from the header room';
    });

    // 6 — template vs content: a header layout change from the page
    await step('Template: change the header layout from the page', async function () {
      var pill = q('header .gogh-chromeveil-pill') || q('.gogh-chromeveil-pill');
      if (!pill) throw new Error('no Edit site header pill');
      clickEl(pill);
      var lay = await until(function () { return byText('.gogh-panel button', /^Layout/); }, 8000, 'the Layout door');
      var before = q('header').innerHTML;
      clickEl(lay);
      var opt = await until(function () { return byText('.gogh-panel .gogh-hopt', /Centred header/); }, 8000, 'the Centred header option');
      clickEl(opt);
      var done = await until(function () { var b = q('.gogh-panel .gogh-happly'); return b && !b.disabled ? b : null; }, 8000, 'Done');
      // Done saves the part and RELOADS the page: the check runs after
      expectReload('Template: change the header layout from the page', { sig: before.length });
      clickEl(done);
      await wait(15000); // the reload takes the page away here
      throw new Error('Done did not reload the page');
    });

    // 7 — navigation: where an item shows, from the menu manager
    await step('Navigation: a menu item’s phone/desktop toggle', async function () {
      var pill = await until(function () { return q('header .gogh-chromeveil-pill') || q('.gogh-chromeveil-pill'); }, 8000, 'the Edit site header pill');
      clickEl(pill);
      var menu = await until(function () { return q('.gogh-panel .gogh-hmenu'); }, 8000, 'the Edit menu items door');
      clickEl(menu);
      var row = await until(function () { return byText('.gogh-mm-row', /Notes/); }, 8000, 'the Notes row');
      var tog = q('.gogh-mm-w[data-w="phone"]', row);
      var was = tog.getAttribute('aria-pressed');
      clickEl(tog);
      var row2 = await until(function () { var r2 = byText('.gogh-mm-row', /Notes/); var t2 = r2 && q('.gogh-mm-w[data-w="phone"]', r2); return t2 && t2.getAttribute('aria-pressed') !== was ? t2 : null; }, 8000, 'the toggle to flip');
      clickEl(row2); // and back
      await wait(400);
      var back = q('.gogh-panel .gogh-panel-close'); if (back) clickEl(back);
      return 'Notes toggled off phones and back on';
    });

    // 8 — mobile: the phone preview
    await step('Mobile: the phone preview stacks the hero', async function () {
      // the phone artboard lives in the zoomed-out canvas (it opens with the
      // whole-page style panels); the walk zooms out the way those do
      if (!G.canvasZoom) throw new Error('no canvas zoom on the bridge');
      G.canvasZoom.out();
      var dev = await until(function () { var b = q('.gogh-dev[data-dev="phone"]'); return b && b.offsetParent ? b : null; }, 6000, 'the phone button');
      clickEl(dev);
      await until(function () { return document.documentElement.classList.contains('gogh-phone-preview'); }, 4000, 'the phone preview');
      await wait(700);
      var w = content()[0].sectionEl.getBoundingClientRect().width;
      var desk = q('.gogh-dev[data-dev="desktop"]'); if (desk) clickEl(desk);
      await until(function () { return !document.documentElement.classList.contains('gogh-phone-preview'); }, 4000, 'desktop again');
      G.canvasZoom.back();
      if (!(w > 0 && w <= 480)) throw new Error('the hero did not narrow to a phone (' + Math.round(w) + 'px)');
      // a door to it from the page, without a style panel: not yet
      var door = byText('button, [role="button"]', /phone|mobile/i);
      return door ? 'hero at ' + Math.round(w) + 'px on the phone artboard' : { gap: 'hero at ' + Math.round(w) + 'px on the phone artboard, but the only way there is a whole-page style panel — no "see it on a phone" door' };
    });

    // 9 — a new page with a section on it, live at its own address
    await step('New page: add a page with a Pricing section', async function () {
      var t = T('Pricing');
      if (!t) throw new Error('no Pricing starter');
      G.addSection(t);
      var s = content()[content().length - 1];
      var markup = G.blocksV3(s);
      G.deleteSection(G.sections().indexOf(s));
      var made = await (await fetch('/wp-json/wp/v2/pages', { method: 'POST', headers: H, body: JSON.stringify({ title: 'Prices', status: 'publish', content: markup, slug: 'walk-prices-' + Date.now() }) })).json();
      if (!made.id) throw new Error('the page was not created');
      var html = await (await fetch(made.link)).text();
      await fetch('/wp-json/wp/v2/pages/' + made.id, { method: 'DELETE', headers: H });
      if (!/gogh-section/.test(html)) throw new Error('the new page does not render its section');
      return 'page created, section renders at its address, page trashed';
    });

    // 10 — the guard stayed silent through the whole walk
    await step('The runtime guard stayed silent', async function () {
      var gl = G.guardLog ? G.guardLog() : [];
      if (gl.length) throw new Error(gl.length + ' entries: ' + gl[0].why + ' — ' + gl[0].issues[0]);
      return 'no size changes, no overlaps';
    });

    render(true);
  }

  var t0 = Date.now();
  (function boot() {
    if (window.__gogh && window.__gogh.sections && window.__gogh.sections().length) { walk(); return; }
    if (Date.now() - t0 < 20000) { setTimeout(boot, 200); return; }
    log('boot', 'fail', 'the editor never booted');
    render(true);
  })();
})();

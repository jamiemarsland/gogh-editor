/* The Make door: a chat that builds the site it lives in.
 *
 * The conversation runs on the helper (/api/build, where: 'here'); when the
 * model publishes a site definition, this page fetches it, hands it to the
 * site's own gogh/v1/site-def route (replacing whatever the last chat made),
 * and goes to the build, which draws every page and lands on the home page.
 * The conversation is kept in this browser so coming back to ask for a
 * change carries on where it left off.
 */
(function () {
  var cfg = window.goghMake || {};
  var KEY = 'gogh-make-chat';
  var thread = document.getElementById('thread');
  var chips = document.getElementById('chips');
  var form = document.getElementById('f');
  var input = document.getElementById('q');
  var go = document.getElementById('go');
  var fileIn = document.getElementById('file');
  var shotBox = document.getElementById('shot');
  var shotImg = document.getElementById('shot-img');
  var state = [];
  var said = [];
  var busy = false;
  var shot = null;

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ state: state, said: said.slice(-40) })); } catch (e) {}
  }
  function load() {
    try { var d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (d && Array.isArray(d.state)) return d; } catch (e) {}
    return null;
  }

  function el(cls, text) {
    var d = document.createElement('div');
    d.className = cls;
    if (text != null) { var s = document.createElement('span'); s.textContent = text; d.appendChild(s); }
    return d;
  }
  function scroll() { window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }
  function say(who, text, keep) {
    thread.appendChild(el('msg ' + who, text));
    if (keep !== false) { said.push([who, text]); save(); }
    scroll();
  }

  // screenshots: shrink before sending, as the front door does
  function shrink(file) {
    return new Promise(function (ok, no) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var s = Math.min(1, 1400 / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * s));
        c.height = Math.max(1, Math.round(img.height * s));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        var out = c.toDataURL('image/jpeg', 0.78);
        ok({ media_type: 'image/jpeg', data: out.slice(out.indexOf(',') + 1), preview: out });
      };
      img.onerror = function () { URL.revokeObjectURL(url); no(new Error('not a picture')); };
      img.src = url;
    });
  }
  function takeShot(file) {
    if (!file || file.type.indexOf('image/') !== 0) return;
    shrink(file).then(function (s) {
      shot = s; shotImg.src = s.preview; shotBox.style.display = 'flex'; input.focus();
    }).catch(function () {});
  }
  function clearShot() { shot = null; shotBox.style.display = 'none'; shotImg.removeAttribute('src'); }
  fileIn.addEventListener('change', function () { if (fileIn.files[0]) takeShot(fileIn.files[0]); fileIn.value = ''; });
  document.getElementById('shot-drop').addEventListener('click', clearShot);
  document.addEventListener('paste', function (ev) {
    var items = (ev.clipboardData && ev.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) if (items[i].type.indexOf('image/') === 0) { takeShot(items[i].getAsFile()); return; }
  });

  // the published site becomes this site: fetch the definition, apply it
  // here (replacing the pages the last chat made), then build
  function build(pub, wait) {
    wait.set('Building your pages');
    fetch(cfg.helper + '/d/' + encodeURIComponent(pub.id) + '.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('I could not fetch the site I just made.'); return r.json(); })
      .then(function (def) {
        return fetch(cfg.rest + 'site-def?replace=1', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'X-WP-Nonce': cfg.nonce },
          body: JSON.stringify(def),
        });
      })
      .then(function (r) {
        return r.json().then(function (d) { if (!r.ok) throw new Error((d && d.message) || 'This site would not take the pages.'); return d; });
      })
      .then(function () {
        wait.set('Drawing every page');
        document.body.classList.add('is-leaving');
        setTimeout(function () { location.href = cfg.build; }, 400);
      })
      .catch(function (e) { wait.fail(e.message || 'Something went wrong building it. Try again?'); });
  }

  function send(text) {
    if (busy || (!text && !shot)) return;
    if (!text) text = 'Build me something like this.';
    busy = true; go.disabled = true; chips.hidden = true;
    var mine = el('msg you', text);
    if (shot) { var t = document.createElement('img'); t.src = shot.preview; mine.insertBefore(t, mine.firstChild); }
    thread.appendChild(mine); said.push(['you', text]); save(); scroll();
    var sending = shot ? { media_type: shot.media_type, data: shot.data } : null;
    clearShot();
    input.value = '';

    var waiting = el('msg gogh'); var w = document.createElement('span');
    w.className = 'dots'; waiting.appendChild(w); thread.appendChild(waiting); scroll();
    var step = sending ? 'Looking at your screenshot' : 'Thinking', began = Date.now(), done = false;
    var paint = function () {
      var secs = Math.round((Date.now() - began) / 1000);
      w.textContent = step + '…' + (secs > 2 ? ' ' + secs + 's' : '');
    };
    paint();
    var tick = setInterval(paint, 1000);
    var stop = function () { done = true; clearInterval(tick); waiting.remove(); busy = false; go.disabled = false; input.focus(); };
    var fail = function (msg) {
      if (done) return;
      stop();
      var e = el('msg gogh', msg); e.firstChild.className = 'err'; thread.appendChild(e); scroll();
    };
    var wait = {
      set: function (s) { step = s; paint(); scroll(); },
      fail: fail,
    };

    var handle = function (ev) {
      if (ev.type === 'step') { wait.set(ev.text); return; }
      if (ev.type === 'error') { fail(ev.error || 'Something went wrong. Try again?'); return; }
      if (ev.type === 'reply') {
        if (Array.isArray(ev.messages)) { state = ev.messages; save(); }
        if (ev.published && ev.published.id) {
          // keep the dots running: the site is being made now
          var line = ev.text ? el('msg gogh', ev.text) : null;
          if (line) { thread.insertBefore(line, waiting); said.push(['gogh', ev.text]); save(); }
          build(ev.published, wait);
          return;
        }
        stop();
        if (ev.text) say('gogh', ev.text);
      }
    };

    fetch(cfg.helper + '/api/build', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: text, messages: state, image: sending, where: 'here' }),
    }).then(function (r) {
      var kind = r.headers.get('content-type') || '';
      if (kind.indexOf('text/event-stream') === -1 || !r.body) {
        return r.json().then(function (d) { fail(d.error || 'Something went wrong. Try again?'); });
      }
      var reader = r.body.getReader(), dec = new TextDecoder(), buf = '';
      var pump = function () {
        return reader.read().then(function (res) {
          if (res.done) { if (!done && step.indexOf('Build') !== 0 && step.indexOf('Drawing') !== 0) fail('The answer stopped short. Try again?'); return; }
          buf += dec.decode(res.value, { stream: true });
          var parts = buf.split('\n\n'); buf = parts.pop();
          parts.forEach(function (p) {
            var line = p.replace(/^data: /, '');
            try { handle(JSON.parse(line)); } catch (e) {}
          });
          return pump();
        });
      };
      return pump();
    }).catch(function () { fail('I could not reach gogh just then. Try again?'); });
  }

  form.addEventListener('submit', function (ev) { ev.preventDefault(); send(input.value.trim()); });
  chips.addEventListener('click', function (ev) { if (ev.target.tagName === 'BUTTON') send(ev.target.textContent); });
  input.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); send(input.value.trim()); }
  });
  document.getElementById('restart').addEventListener('click', function () {
    try { localStorage.removeItem(KEY); } catch (e) {}
    state = []; said = []; thread.innerHTML = ''; chips.hidden = false; input.focus();
  });

  // coming back: the conversation carries on
  var kept = load();
  if (kept && kept.state.length) {
    state = kept.state;
    said = kept.said || [];
    said.forEach(function (m) { say(m[0], m[1], false); });
    chips.hidden = true;
    if (cfg.built) say('gogh', 'Welcome back. Tell me what to change and I will rebuild it.', false);
  }
  input.focus();

  // test hook
  window.__goghMake = { send: send, state: function () { return state; } };
})();

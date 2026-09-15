/* gogh user testing — a small card of tasks for a tester, and a wrap-up.
 * Loads only on a site booted with the gogh_user_test option (the
 * blueprint-usertest.json link). Everything the tester does with the card
 * (done, couldn't, a note, the hint, the wrap-up) goes to the helper under
 * a random session id. Nothing else is collected: no page content, no name
 * unless they type one. Place in the list survives reloads and the walk
 * between the editor and the published site. */
(function () {
  'use strict';
  var cfg = window.GOGH_UT;
  if (!cfg || !cfg.session || !cfg.tasks || !cfg.tasks.length) return;

  var KEY = 'goghUT:' + cfg.session;
  var state = load() || { i: 0, started: 0, taskStart: 0, results: {}, wrapped: false, hidden: false, queue: [] };
  var tasks = cfg.tasks;

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  // ---- sending: events queue up and go in small batches; a failed send
  // stays in the queue for the next try, so a flaky minute loses nothing
  var sending = false;
  function send(type, task, note, data) {
    state.queue.push({ t: Date.now(), type: type, task: task || '', note: note || '', data: data || null });
    save();
    flush();
  }
  function flush() {
    if (sending || !state.queue.length || !window.fetch) return;
    var batch = state.queue.slice(0, 40);
    sending = true;
    fetch(cfg.helpUrl + '/api/test', { method: 'POST', body: JSON.stringify({ session: cfg.session, events: batch }), keepalive: true })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); state.queue = state.queue.slice(batch.length); save(); })
      .catch(function () {})
      .then(function () { sending = false; if (state.queue.length) setTimeout(flush, 4000); });
  }
  window.addEventListener('error', function (ev) {
    var msg = ev && ev.message ? String(ev.message).slice(0, 300) : 'error';
    send('error', currentId(), msg);
  });

  // ---- the card
  var css = '' +
    '.gogh-ut{position:fixed;top:48px;right:16px;width:320px;max-width:calc(100vw - 32px);z-index:2147483000;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;color:#16181c;background:rgba(255,255,255,.98);border:1px solid rgba(22,24,28,.12);border-radius:14px;box-shadow:0 12px 40px rgba(22,24,28,.18);box-sizing:border-box}' +
    '.gogh-ut *{box-sizing:border-box}' +
    '.gogh-ut-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px 8px;border-bottom:1px solid rgba(22,24,28,.08)}' +
    '.gogh-ut-lab{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:rgba(22,24,28,.55)}' +
    '.gogh-ut-hide{all:unset;cursor:pointer;font-size:12px;color:rgba(22,24,28,.55);padding:2px 6px;border-radius:6px}.gogh-ut-hide:hover{background:rgba(22,24,28,.06)}' +
    '.gogh-ut-body{padding:12px}' +
    '.gogh-ut-title{margin:0 0 6px;font-size:16px;font-weight:600;line-height:1.3}' +
    '.gogh-ut-p{margin:0 0 10px;color:rgba(22,24,28,.7)}' +
    '.gogh-ut-hintbtn{all:unset;cursor:pointer;font-size:13px;color:rgba(22,24,28,.6);text-decoration:underline;text-underline-offset:3px;margin:0 0 10px;display:inline-block}' +
    '.gogh-ut-hint{margin:0 0 10px;padding:8px 10px;border-radius:8px;background:rgba(22,24,28,.05);font-size:13px}' +
    '.gogh-ut textarea,.gogh-ut input[type=text]{width:100%;font:inherit;padding:8px 10px;border:1px solid rgba(22,24,28,.16);border-radius:8px;resize:vertical;min-height:38px;background:#fff;color:inherit}' +
    '.gogh-ut textarea{min-height:56px}' +
    '.gogh-ut-row{display:flex;gap:8px;margin-top:10px}' +
    '.gogh-ut-btn{all:unset;cursor:pointer;flex:1;text-align:center;padding:9px 12px;border-radius:999px;font-weight:600;border:1px solid rgba(22,24,28,.16)}' +
    '.gogh-ut-btn.is-primary{background:#16181c;color:#fff;border-color:#16181c}' +
    '.gogh-ut-btn:hover{filter:brightness(.96)}' +
    '.gogh-ut-q{margin:12px 0 4px;font-weight:600}' +
    '.gogh-ut-scale{display:flex;gap:6px}.gogh-ut-scale button{all:unset;cursor:pointer;flex:1;text-align:center;padding:8px 0;border-radius:8px;border:1px solid rgba(22,24,28,.16)}.gogh-ut-scale button.is-on{background:#16181c;color:#fff;border-color:#16181c}' +
    '.gogh-ut-pill{all:unset;position:fixed;top:48px;right:16px;z-index:2147483000;cursor:pointer;font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;color:#fff;background:#16181c;padding:8px 14px;border-radius:999px;box-shadow:0 8px 24px rgba(22,24,28,.25)}' +
    '.gogh-ut-foot{padding:0 12px 10px;font-size:12px;color:rgba(22,24,28,.5)}' +
    '@media (max-width:700px){.gogh-ut{top:auto;bottom:12px;right:12px;left:12px;width:auto}.gogh-ut-pill{top:auto;bottom:12px}}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var card = document.createElement('div');
  card.className = 'gogh-ut';
  card.setAttribute('role', 'complementary');
  card.setAttribute('aria-label', 'Testing tasks');
  var pill = document.createElement('button');
  pill.className = 'gogh-ut-pill';
  pill.type = 'button';
  pill.hidden = true;
  pill.addEventListener('click', function () { state.hidden = false; save(); render(); });
  document.body.appendChild(card);
  document.body.appendChild(pill);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function currentId() { var t = tasks[state.i]; return t ? t.id : (state.wrapped ? 'done' : 'wrap'); }
  function secs() { return state.taskStart ? Math.round((Date.now() - state.taskStart) / 1000) : 0; }

  function render() {
    if (state.hidden) {
      card.hidden = true;
      pill.hidden = false;
      pill.textContent = state.wrapped ? 'Thanks for testing' : (state.i < tasks.length ? 'Task ' + (state.i + 1) + ' of ' + tasks.length : 'Last few questions');
      return;
    }
    card.hidden = false;
    pill.hidden = true;
    if (state.wrapped) return renderThanks();
    if (state.i >= tasks.length) return renderWrap();
    var t = tasks[state.i];
    card.innerHTML =
      '<div class="gogh-ut-head"><span class="gogh-ut-lab">Task ' + (state.i + 1) + ' of ' + tasks.length + '</span><button type="button" class="gogh-ut-hide" title="Put this card away for a moment">Hide</button></div>' +
      '<div class="gogh-ut-body">' +
        '<p class="gogh-ut-title">' + esc(t.title) + '</p>' +
        (t.why ? '<p class="gogh-ut-p">' + esc(t.why) + '</p>' : '') +
        (t.hint ? '<button type="button" class="gogh-ut-hintbtn">Stuck? Show a hint</button><div class="gogh-ut-hint" hidden>' + esc(t.hint) + '</div>' : '') +
        '<textarea class="gogh-ut-note" placeholder="Anything to say about this one? (optional)"></textarea>' +
        '<div class="gogh-ut-row"><button type="button" class="gogh-ut-btn gogh-ut-skip">Couldn’t do it</button><button type="button" class="gogh-ut-btn is-primary gogh-ut-done">Done</button></div>' +
      '</div>' +
      '<div class="gogh-ut-foot">Take your time. Say what you think out loud if someone is with you.</div>';
    card.querySelector('.gogh-ut-hide').addEventListener('click', function () { state.hidden = true; save(); render(); });
    var hb = card.querySelector('.gogh-ut-hintbtn');
    if (hb) hb.addEventListener('click', function () { card.querySelector('.gogh-ut-hint').hidden = false; hb.hidden = true; send('hint', t.id); });
    card.querySelector('.gogh-ut-done').addEventListener('click', function () { finish('task_done'); });
    card.querySelector('.gogh-ut-skip').addEventListener('click', function () { finish('task_skip'); });
    if (!state.taskStart) { state.taskStart = Date.now(); save(); send('task_start', t.id); }
  }

  function finish(type) {
    var t = tasks[state.i];
    var note = (card.querySelector('.gogh-ut-note') || {}).value || '';
    state.results[t.id] = { type: type, secs: secs(), note: note };
    send(type, t.id, note, { secs: secs() });
    state.i += 1;
    state.taskStart = 0;
    save();
    render();
  }

  function renderWrap() {
    card.innerHTML =
      '<div class="gogh-ut-head"><span class="gogh-ut-lab">Last few questions</span><button type="button" class="gogh-ut-hide">Hide</button></div>' +
      '<div class="gogh-ut-body">' +
        '<p class="gogh-ut-title">Thank you. Four quick questions.</p>' +
        '<div class="gogh-ut-q">Are you happy with the site you made?</div>' +
        '<div class="gogh-ut-scale" data-q="happy"><button type="button" data-v="1">1</button><button type="button" data-v="2">2</button><button type="button" data-v="3">3</button><button type="button" data-v="4">4</button><button type="button" data-v="5">5</button></div>' +
        '<div class="gogh-ut-q">Could you finish it with a bit more time?</div>' +
        '<div class="gogh-ut-scale" data-q="confident"><button type="button" data-v="yes">Yes</button><button type="button" data-v="maybe">Maybe</button><button type="button" data-v="no">No</button></div>' +
        '<div class="gogh-ut-q">How did editing make you feel?</div>' +
        '<textarea data-q="feel"></textarea>' +
        '<div class="gogh-ut-q">What confused you, if anything?</div>' +
        '<textarea data-q="confused"></textarea>' +
        '<div class="gogh-ut-q">Your name, if you like</div>' +
        '<input type="text" data-q="name" placeholder="optional">' +
        '<div class="gogh-ut-row"><button type="button" class="gogh-ut-btn is-primary gogh-ut-send">Send</button></div>' +
      '</div>';
    card.querySelector('.gogh-ut-hide').addEventListener('click', function () { state.hidden = true; save(); render(); });
    var picks = {};
    [].slice.call(card.querySelectorAll('.gogh-ut-scale')).forEach(function (row) {
      [].slice.call(row.querySelectorAll('button')).forEach(function (b) {
        b.addEventListener('click', function () {
          picks[row.dataset.q] = b.dataset.v;
          [].slice.call(row.querySelectorAll('button')).forEach(function (o) { o.classList.toggle('is-on', o === b); });
        });
      });
    });
    card.querySelector('.gogh-ut-send').addEventListener('click', function () {
      var answers = {
        happy: picks.happy || '', confident: picks.confident || '',
        feel: card.querySelector('[data-q=feel]').value.slice(0, 500),
        confused: card.querySelector('[data-q=confused]').value.slice(0, 500),
        name: card.querySelector('[data-q=name]').value.slice(0, 80),
        minutes: state.started ? Math.round((Date.now() - state.started) / 60000) : 0,
      };
      send('wrap', 'wrap', '', answers);
      state.wrapped = true;
      save();
      render();
    });
  }

  function renderThanks() {
    card.innerHTML =
      '<div class="gogh-ut-head"><span class="gogh-ut-lab">All done</span><button type="button" class="gogh-ut-hide">Hide</button></div>' +
      '<div class="gogh-ut-body"><p class="gogh-ut-title">Thank you. That really helps.</p><p class="gogh-ut-p">Your answers have gone to Jamie. Carry on playing with the site for as long as you like; it is yours until you close the tab.</p></div>';
    card.querySelector('.gogh-ut-hide').addEventListener('click', function () { state.hidden = true; save(); render(); });
  }

  if (!state.started) {
    state.started = Date.now();
    save();
    send('start', '', '', {
      version: cfg.version || '',
      viewport: window.innerWidth + 'x' + window.innerHeight,
      ua: String(navigator.userAgent || '').slice(0, 160),
      tasks: tasks.length,
      persona: cfg.persona || '',
    });
  } else {
    flush();
  }
  render();
})();

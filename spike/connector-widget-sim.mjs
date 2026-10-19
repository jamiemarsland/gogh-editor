// A pretend chat for the site connector: reads the page widget from the
// site's own MCP endpoint, opens a page, and relays the widget's tools/call
// to the site. Then it edits a heading, moves a section and screenshots.
import fs from 'fs';
import puppeteer from 'puppeteer-core';
const U = fs.readFileSync('/tmp/gogh-connector-url.txt', 'utf8').trim();
const out = process.argv[2], mode = process.argv[3] || 'edit';
let n = 0;
const rpc = async (method, params) => (await (await fetch(U, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method, params }) })).json());
const html = (await rpc('resources/read', { uri: 'ui://gogh/panel.html' })).result.contents[0].text;
const opened = (await rpc('tools/call', { name: 'gogh_open_page', arguments: process.env.PAGE ? { page_id: +process.env.PAGE } : {} })).result;
const host = `<!doctype html><html><body style="margin:0;padding:16px;background:#fff">
<iframe id="f" sandbox="allow-scripts" style="width:760px;border:0;height:300px"></iframe>
<script>
var f = document.getElementById('f'); window.__log = []; window.__ctx = [];
f.srcdoc = ${JSON.stringify(html).replace(/</g, '\\u003c')};
window.addEventListener('message', async function (ev) {
  var m = ev.data; if (!m || m.jsonrpc !== '2.0') return;
  window.__log.push(m.method || 'reply');
  var reply = function (r) { f.contentWindow.postMessage({ jsonrpc: '2.0', id: m.id, result: r }, '*'); };
  if (m.method === 'ui/initialize') reply({ protocolVersion: '2026-01-26', hostCapabilities: {}, hostInfo: { name: 'sim' }, hostContext: { theme: 'light' } });
  else if (m.method === 'ui/notifications/initialized') f.contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: ${JSON.stringify(opened)} }, '*');
  else if (m.method === 'ui/notifications/size-changed') f.style.height = m.params.height + 'px';
  else if (m.method === 'tools/call') reply(await window.mcpCall(m.params));
  else if (m.method === 'ui/update-model-context') { window.__ctx.push(m.params.content[0].text); reply({}); }
  else if (m.method === 'ui/request-display-mode') { f.style.width = '1260px'; f.style.height = '860px'; reply({ mode: m.params.mode }); }
});
</script></body></html>`;
fs.writeFileSync(out + '.html', host);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const p = await b.newPage(); await p.setViewport({ width: 800, height: 1000 });
p.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 300)));
p.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
await p.exposeFunction('mcpCall', async (params) => (await rpc('tools/call', params)).result);
await p.goto('file://' + out + '.html', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 6000));
const w = p.frames().find((x) => x.parentFrame() === p.mainFrame());
const pg = () => w;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const info = async () => pg().evaluate(() => ({ secs: [...document.querySelectorAll('[data-gw-sec]')].map((s) => s.getAttribute('data-gw-sec') + ':' + ((s.querySelector('h1,h2,h3') || {}).innerText || '').slice(0, 30)), editable: document.querySelectorAll('[contenteditable="plaintext-only"]').length }));
console.log("dbg", JSON.stringify(await w.evaluate(() => ({ page: !!document.getElementById("gw-page"), comments: (function(){var n=0,t=document.createTreeWalker(document.body,NodeFilter.SHOW_COMMENT),c;while((c=t.nextNode()))n++;return n;})(), ask: document.getElementById("askText").textContent, saving: document.getElementById("saving").textContent, stage: document.getElementById("stage").innerText.slice(0,80) }))));
console.log("before", JSON.stringify(await info()));
if (mode === 'add') {
  await w.evaluate(() => { document.querySelector('[data-gw-sec="1"] .gw-seam button').click(); });
  await sleep(2500);
  console.log('chooser', JSON.stringify(await w.evaluate(() => ({ open: !document.getElementById('pick').hidden, opts: [...document.querySelectorAll('.pick .opt .name')].map((n) => n.textContent) }))));
  await p.screenshot({ path: out + '-chooser.png', fullPage: true });
  await w.evaluate(() => { document.querySelectorAll('.pick .opt')[1].click(); });
  await sleep(6000);
  console.log('after add', JSON.stringify(await info()));
}
if (mode === 'design') {
  await w.evaluate(() => { document.querySelector('[data-gw-sec="1"] .gw-tools [data-a="design"]').click(); });
  await sleep(2500);
  console.log('designs', JSON.stringify(await w.evaluate(() => [...document.querySelectorAll('.pick .opt .name')].map((n) => n.textContent))));
  await p.screenshot({ path: out + '-chooser.png', fullPage: true });
  await w.evaluate((pick) => { [...document.querySelectorAll('.pick .opt')].find((b) => new RegExp(pick).test(b.textContent)).click(); }, process.env.PICK || 'mirror');
  await sleep(6000);
  console.log('after design', JSON.stringify(await info()));
}
if (mode === 'editor') {
  await p.setViewport({ width: 1300, height: 900 });
  await w.evaluate(() => { document.getElementById('editor').click(); });
  await sleep(14000);
  const ed = p.frames().find((x) => /gogh-editor=/.test(x.url()));
  console.log('editor frame', !!ed);
  if (ed) console.log('editor', JSON.stringify(await ed.evaluate(() => ({ editing: document.documentElement.classList.contains('gogh-editing'), sections: window.__gogh ? window.__gogh.sections().length : -1, user: !!document.getElementById('wpadminbar'), title: document.title }))));
  // a real REST call from inside the editor, as the signed-in person
  if (ed) console.log('rest', await ed.evaluate(async () => { const out = [];
    for (const [k, fn] of [['plain', () => fetch('/wp-json/')], ['edit', () => fetch('/wp-json/wp/v2/pages/6?context=edit')], ['xhr', () => new Promise((res) => { const x = new XMLHttpRequest(); x.open('GET', '/wp-json/wp/v2/pages/6?context=edit'); x.onload = () => res({ status: x.status }); x.onerror = () => res({ status: 'xhr-error' }); x.send(); })]]) {
      try { const r = await fn(); out.push(k + ':' + r.status); } catch (e) { out.push(k + ':' + e.message); } }
    return out.join(' | '); }));
}
if (mode === 'editor-publish') {
  await p.setViewport({ width: 1300, height: 900 });
  await w.evaluate(() => { document.getElementById('editor').click(); });
  await sleep(14000);
  const ed = p.frames().find((x) => /gogh-editor=/.test(x.url()));
  // change the first heading through the editor itself, then its own Publish
  console.log('publish', await ed.evaluate(async () => { const G = window.__gogh; const s0 = G.sections()[0]; const h = s0.els.find((e) => e.type === 'heading'); h.text = 'Watch us throw on Tuesdays'; G.renderSection(s0); G.pushState(); const ok = await G.publish(); return String(ok); }));
  await sleep(2000);
  await p.screenshot({ path: out + '-editor.png' });
  await w.evaluate(() => { document.getElementById('back').click(); });
  await sleep(6000);
  console.log('after', JSON.stringify(await info()));
  const live = await (await fetch('http://localhost:9007/studio/?x=' + Date.now())).text();
  console.log('live has it', /Watch us throw on Tuesdays/.test(live));
}
if (mode === 'editor-restore') {
  await p.setViewport({ width: 1300, height: 900 });
  await w.evaluate(() => { document.getElementById('editor').click(); });
  await sleep(16000);
  const ed = p.frames().find((x) => /gogh-editor=/.test(x.url()));
  console.log('restore in url', /gogh-restore=1/.test(ed.url()));
  console.log('editor shows', JSON.stringify(await ed.evaluate(() => window.__gogh.sections().map((s) => (s.els.find((e) => e.type === 'heading') || {}).text))));
}
if (mode === 'edit') {
  // type over the hero's heading
  await pg().evaluate(() => { const h = document.querySelector('[data-gw-sec="1"] h1, [data-gw-sec="1"] h2'); h.focus(); h.innerText = 'Stoneware for every day.'; h.blur(); });
  await sleep(2500);
  // move the third section up with its ↑ button
  await pg().evaluate(() => { document.querySelector('[data-gw-sec="3"] .gw-tools [data-a="up"]').click(); });
  await sleep(4000);
  console.log('after', JSON.stringify(await info()));
  console.log('bar', await w.evaluate(() => document.getElementById('pill').textContent + ' | ' + document.getElementById('saving').textContent));
}
await p.screenshot({ path: out + '.png', fullPage: true });
console.log('told the agent:', JSON.stringify(await p.evaluate(() => window.__ctx)));
await b.close();

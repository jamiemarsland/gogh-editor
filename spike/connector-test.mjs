// The site's own connector, end to end over HTTP against a local Studio site
// (branch explore/site-connector). Switch the stand-in on first:
//   studio wp eval 'file_put_contents("/tmp/gogh-connector-url.txt", gogh_connector_standin_on(1));'
// then: node spike/connector-test.mjs   (it edits and publishes page 5: use a scratch site)
import fs from 'fs';
const U = fs.readFileSync('/tmp/gogh-connector-url.txt', 'utf8').trim();
let n = 0;
const rpc = async (method, params, url = U) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method, params }) });
  const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) }; } catch (e) { return { status: r.status, body: t.slice(0, 300) }; }
};
const call = async (name, args) => { const r = await rpc('tools/call', { name, arguments: args }); return r.body.result; };
const ok = (c, m) => console.log(c ? 'ok  ' : 'FAIL', m);
let r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
ok(r.status === 200 && /Hollowell/.test(r.body.result.serverInfo.name), 'initialize: ' + r.body.result.serverInfo.name);
r = await rpc('tools/list', {});
ok(r.body.result.tools.length >= 10, 'tools: ' + r.body.result.tools.map((t) => t.name).join(', '));
r = await rpc('tools/list', {}, U.replace(/key=.*/, 'key=wrong-wrong-wrong-wrong-wrong-wrong-wrong'));
ok(r.status === 401, 'a wrong key is refused: ' + r.status);
let page = await call('gogh_read_page', { page_id: 5 });
const secs = page.structuredContent.sections;
ok(secs.length === 5 && secs[0].design === 'Hero', 'read: 5 sections, first is ' + secs[0].design);
console.log('   hero pieces:', JSON.stringify(secs[0].pieces.map((p) => [p.piece, p.role, (p.words || '').slice(0, 30)])));
const head = secs[0].pieces.find((p) => p.role === 'heading');
r = await call('gogh_change_words', { page_id: 5, section: 1, piece: head.piece, words: 'Made by hand in Bristol.' });
ok(!r.isError && r.structuredContent.changed, 'change words: ' + (r.isError ? r.content[0].text : r.structuredContent.now));
const btn = secs[0].pieces.find((p) => p.role === 'button');
r = await call('gogh_change_words', { page_id: 5, section: 1, piece: btn.piece, words: 'Shop mugs' });
ok(!r.isError, 'change a button: ' + (r.isError ? r.content[0].text : r.structuredContent.now));
r = await call('gogh_change_words', { page_id: 5, section: 2, piece: 2, words: 'x' });
ok(r.isError, 'cards are refused for now: ' + r.content[0].text.slice(0, 60));
r = await call('gogh_move_section', { page_id: 5, section: 4, to: 2 });
ok(!r.isError && r.structuredContent.moved, 'move testimonials up');
page = await call('gogh_read_page', { page_id: 5 });
const order = page.structuredContent.sections.map((s) => s.design);
ok(order[1] === 'Testimonials' && page.structuredContent.unpublished_changes, 'order now: ' + order.join(', '));
const live = await (await fetch('http://localhost:9007/')).text();
ok(/Thrown by hand/.test(live) && !/Made by hand in Bristol/.test(live), 'the live page is untouched');
r = await call('gogh_preview_page', { page_id: 5 });
const pv = await (await fetch(r.structuredContent.preview)).text();
ok(/Made by hand in Bristol/.test(pv) && /Shop mugs/.test(pv) && pv.indexOf('Kind words') < pv.indexOf('How we make'), 'the preview link shows the changes');
r = await call('gogh_publish', { page_id: 5 });
ok(!r.isError && r.structuredContent.published, 'publish');
const live2 = await (await fetch('http://localhost:9007/?x=' + Date.now())).text();
ok(/Made by hand in Bristol/.test(live2) && live2.indexOf('Kind words') < live2.indexOf('How we make'), 'live now');

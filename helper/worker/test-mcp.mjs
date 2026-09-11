// The connector, end to end against the built worker: initialize, tools,
// a check that fails and one that passes, a publish, then the two files a
// published site serves. Run: node helper/worker/test-mcp.mjs (after
// python3 helper/refresh.py, which builds dist/worker.js)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { default: worker } = await import(path.join(here, 'dist', 'worker.js'));
const florist = JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'spike', 'site-def-florist.json'), 'utf8'));
const onepage = JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'spike', 'site-def-onepage.json'), 'utf8'));

const kv = () => { const m = new Map(); return { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, _m: m }; };
const env = { RATE: kv(), SITES: kv() };
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL', msg); } else console.log('ok  ', msg); };
const rpcWith = async (e, msg) => {
  const res = await worker.fetch(new Request('https://gogh.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body: JSON.stringify(msg) }), e);
  return { status: res.status, body: res.status === 202 ? null : await res.json() };
};
const rpc = async (msg) => {
  const res = await worker.fetch(new Request('https://gogh.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body: JSON.stringify(msg) }), env);
  return { status: res.status, body: res.status === 202 ? null : await res.json() };
};

let r = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
check(r.status === 200 && r.body.result.protocolVersion === '2025-06-18' && r.body.result.serverInfo.name === 'gogh', 'initialize answers with the version asked for');
r = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
check(r.status === 202, 'a notification gets 202 and no body');
r = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
check(r.body.result.tools.map((t) => t.name).join() === 'gogh_rules,gogh_pictures,gogh_check,gogh_publish', 'four tools: rules first, then pictures, check, publish');
r = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'gogh_rules', arguments: {} } });
const rules = r.body.result.content[0].text;
check(/\*\*Cover\*\*/.test(rules) && /gogh_publish/.test(rules) && /Bloom & Bough/.test(rules), 'the rules carry the takes, the workflow and the example');
check(/## A one-page site/.test(rules) && /gogh-header-onepage/.test(rules) && /nav: \[ \{ label, url \} \]/.test(rules) && /anchor/.test(rules), 'the rules teach the one-page shape: anchors, a nav, the pinned header');
r = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'gogh_check', arguments: { definition: { name: 'X', pages: [{ title: 'Home', front: true, sections: [{ take: 'No such', heading: 'h' }, { take: 'Feature cards', heading: 'h' }] }] } } } });
check(r.body.result.structuredContent.ok === false && r.body.result.structuredContent.problems.some((p) => /unknown take/.test(p)) && r.body.result.structuredContent.problems.some((p) => /needs items/.test(p)), 'a bad definition is refused with named problems');
r = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'gogh_check', arguments: { definition: florist } } });
check(r.body.result.structuredContent.ok === true && /Home \(front\): Cover, Feature cards ×3/.test(r.body.result.structuredContent.summary), 'the florist passes and summarises: ' + r.body.result.structuredContent.summary.split('\n')[1]);
// the one-pager: anchors, a menu of them, and the checks that keep a menu honest
r = await rpc({ jsonrpc: '2.0', id: 51, method: 'tools/call', params: { name: 'gogh_check', arguments: { definition: onepage } } });
check(r.body.result.structuredContent.ok === true, 'the Fenwick & Lowe one-pager passes: ' + JSON.stringify(r.body.result.structuredContent.problems));
check(/Menu: Practice → #practice/.test(r.body.result.structuredContent.summary), 'the summary reads the menu back');
const bendAnchor = (fn) => { const d = JSON.parse(JSON.stringify(onepage)); fn(d); return d; };
const problemsFor = async (id, d) => (await rpc({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'gogh_check', arguments: { definition: d } } })).body.result.structuredContent;
let p2 = await problemsFor(52, bendAnchor((d) => { d.nav.push({ label: 'Prices', url: '#prices' }); }));
check(p2.ok === false && p2.problems.some((m) => /no section carries that anchor/.test(m)), 'a menu item pointing nowhere is caught');
p2 = await problemsFor(53, bendAnchor((d) => { d.pages[0].sections[1].anchor = 'Work Stuff'; }));
check(p2.ok === false && p2.problems.some((m) => /anchor must be a lowercase name/.test(m)), 'an anchor that is not a slug is caught');
p2 = await problemsFor(54, bendAnchor((d) => { d.pages[0].sections[2].anchor = 'work'; }));
check(p2.ok === false && p2.problems.some((m) => /both carry the anchor "work"/.test(m)), 'two sections claiming one anchor is caught');
p2 = await problemsFor(55, bendAnchor((d) => {
  d.pages.push({ title: 'About', sections: [{ take: 'Big statement', anchor: 'story', heading: 'A line' }] });
  d.nav.push({ label: 'Story', url: '#story' });
}));
check(p2.ok === false && p2.problems.some((m) => /only front-page sections can be named/.test(m)), 'an anchor on another page cannot be in the menu');
p2 = await problemsFor(56, bendAnchor((d) => { d.chrome.pinned = true; }));
check(p2.ok === false && p2.problems.some((m) => /"pinned" is not a chrome choice/.test(m)), 'an invented chrome choice is caught');
p2 = await problemsFor(57, bendAnchor((d) => { d.pages[0].sections[0].link = 'work'; }));
check(p2.ok === false && p2.problems.some((m) => /link must be "#anchor"/.test(m)), 'a button link that is neither an anchor nor a URL is caught');
r = await rpc({ jsonrpc: '2.0', id: 58, method: 'tools/call', params: { name: 'gogh_publish', arguments: { definition: onepage } } });
const one = r.body.result.structuredContent;
check(one.ok, 'the one-pager publishes');
{
  const bp1 = await (await worker.fetch(new Request(one.blueprint_url), env)).json();
  // find the boot step rather than counting: the blueprint gained the Move to
  // WordPress.com install, and a positional index moves whenever a step is added
  const emb = JSON.parse(Buffer.from((bp1.steps.find((x) => x.step === 'runPHP').code.match(/base64_decode\( '([^']+)' \)/) || [])[1], 'base64').toString('utf8'));
  check(emb.nav.length === 5 && emb.pages[0].sections[3].anchor === 'work', 'the published blueprint carries the nav and the anchors');
}
r = await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'gogh_publish', arguments: { definition: florist } } });
const pub = r.body.result.structuredContent;
check(pub.ok && /^https:\/\/playground\.wordpress\.net\/\?blueprint-url=https%3A%2F%2Fgogh\.test%2Fb%2F[a-z0-9]+\.json$/.test(pub.playground_url), 'publish returns a Playground link: ' + pub.playground_url);
let res = await worker.fetch(new Request(pub.definition_url), env);
check(res.status === 200 && (await res.json()).name === 'Bloom & Bough' && res.headers.get('access-control-allow-origin') === '*', 'the definition is served with CORS');
res = await worker.fetch(new Request(pub.blueprint_url), env);
const bp = await res.json();
const embedded = (bp.steps.find((x) => x.step === 'runPHP').code.match(/base64_decode\( '([^']+)' \)/) || [])[1];
check(bp.steps.filter((x) => x.step === 'installPlugin').length === 2 && bp.steps[2].pluginData.url.includes('playground-to-wordpress-com'), 'every built site carries the Move to WordPress.com helper');
const boot = bp.steps.find((x) => x.step === 'runPHP');
check(bp.landingPage === '/?gogh-edit=1&gogh-build=1' && bp.steps[1].pluginData.url.endsWith('gogh-playground.zip') && boot.code.includes('gogh_site_def_boot') && embedded && JSON.parse(Buffer.from(embedded, 'base64').toString('utf8')).name === 'Bloom & Bough' && !boot.code.includes('demo-boot') && bp.steps[bp.steps.length - 1].options.blogname === 'Bloom & Bough', 'the blueprint installs gogh and boots from the embedded definition, no fetch and no demo-boot');
res = await worker.fetch(new Request('https://gogh.test/d/nope.json'), env);
check(res.status === 404, 'an unknown site is 404');
r = await rpc({ jsonrpc: '2.0', id: 7, method: 'nope' });
check(r.body.error && r.body.error.code === -32601, 'an unknown method is a JSON-RPC error');
res = await worker.fetch(new Request('https://gogh.test/mcp', { method: 'GET' }), env);
check(res.status === 405, 'GET /mcp explains itself with 405');
const noStore = { RATE: kv() };
r = await (async () => { const rs = await worker.fetch(new Request('https://gogh.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'gogh_publish', arguments: { definition: florist } } }) }), noStore); return rs.json(); })();
check(r.result.isError === true && /not set up/.test(r.result.content[0].text), 'without SITES storage, publish says so instead of pretending');
// the front door
res = await worker.fetch(new Request('https://gogh.test/build'), env);
const page = await res.text();
check(res.status === 200 && /text\/html/.test(res.headers.get('content-type')) && /Make a website/.test(page) && /\/api\/build/.test(page), 'the front door serves a page that talks to /api/build');
// the page's script lives inside a template literal in worker.js, so an
// escape meant for the browser can be eaten on the way out and leave a
// string split across real newlines. Parse what we actually serve.
{
  const src = (page.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
  let parsed = true, why = '';
  try { new Function(src); } catch (e) { parsed = false; why = e.message; }
  check(src.length > 500 && parsed, 'the page we serve is valid JavaScript: ' + why);
}
res = await worker.fetch(new Request('https://gogh.test/api/build', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'a florist in Bath' }) }), env);
check(res.status === 500 && /not set up/.test((await res.json()).error), 'with no API key the front door says so plainly');
res = await worker.fetch(new Request('https://gogh.test/api/build', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '' }) }), { ...env, ANTHROPIC_API_KEY: 'sk-test' });
check(res.status === 400, 'an empty message is refused before any model is called');

// bands: an arrangement nobody authored, compiled into gogh's own geometry
{
  const band = {
    eyebrow: 'Selected work', heading: 'Recent projects', align: 'left', gap: 'm',
    columns: [1, 2, 3, 4].map((k) => ({ items: [
      { type: 'picture', url: 'https://images.unsplash.com/p' + k, shape: 'portrait' },
      { type: 'heading', text: 'Project ' + k, size: 'normal' },
      { type: 'text', text: 'Extension · 2025' } ] })),
  };
  const withBand = JSON.parse(JSON.stringify(florist));
  withBand.pages[0].sections = [withBand.pages[0].sections[0], { band }];
  let r = await rpc({ jsonrpc: '2.0', id: 80, method: 'tools/call', params: { name: 'gogh_check', arguments: { definition: withBand } } });
  check(r.body.result.structuredContent.ok, 'a described band passes: ' + JSON.stringify(r.body.result.structuredContent.problems));
  r = await rpc({ jsonrpc: '2.0', id: 81, method: 'tools/call', params: { name: 'gogh_publish', arguments: { definition: withBand } } });
  const made = r.body.result.structuredContent;
  const stored = JSON.parse(await env.SITES.get('def:' + made.id));
  const sec = stored.pages[0].sections[1];
  check(!sec.band && Array.isArray(sec.els), 'publishing turns the band into pieces');
  const pics = sec.els.filter((e) => e.type === 'image');
  const heads = sec.els.filter((e) => e.type === 'heading');
  check(pics.length === 4 && heads.length === 5, 'four pictures and four titles under one band heading: ' + pics.length + '/' + heads.length);
  const xs = pics.map((p) => p.x);
  check(xs[0] === 80 && xs.every((x, i) => i === 0 || x > xs[i - 1]) && pics[3].x + pics[3].w === 1120, 'the columns run left to right and fill the page margins: ' + xs.join(','));
  check(pics.every((p) => p.h > p.w), 'portrait was asked for, so the pictures are taller than they are wide');
  // nothing sits on anything else
  const boxes = sec.els.map((e) => [e.x, e.y, e.x + e.w, e.y + e.h]);
  let clash = false;
  for (let i = 0; i < boxes.length; i++) for (let k = i + 1; k < boxes.length; k++) {
    const a = boxes[i], b = boxes[k];
    if (Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 4 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 4) clash = true;
  }
  check(!clash, 'no two pieces overlap');
  check(sec.minH > Math.max(...boxes.map((b) => b[3])), 'the band is tall enough for what is in it');
  // a hero: words beside a picture, the short column riding middle
  const heroBand = { valign: 'middle', gap: 'l', columns: [
    { span: 3, items: [{ type: 'eyebrow', text: 'Architecture · Bristol' }, { type: 'heading', text: 'Buildings that keep their quiet', size: 'display' }, { type: 'button', text: 'See the work' }] },
    { span: 2, items: [{ type: 'text', text: 'A small practice working on houses, workplaces and one stubborn barn.' }] } ] };
  const heroDef = JSON.parse(JSON.stringify(florist));
  heroDef.pages[0].sections = [{ band: heroBand }];
  r = await rpc({ jsonrpc: '2.0', id: 83, method: 'tools/call', params: { name: 'gogh_publish', arguments: { definition: heroDef } } });
  const heroEls = JSON.parse(await env.SITES.get('def:' + r.body.result.structuredContent.id)).pages[0].sections[0].els;
  const bigHead = heroEls.filter((e) => e.type === 'heading')[0];
  const para = heroEls.filter((e) => e.type === 'para' && !(e.tf && e.tf.tt))[0];
  check(bigHead.w > para.w, 'span sets the share of the width: ' + bigHead.w + ' vs ' + para.w);
  const colTop = Math.min(...heroEls.filter((e) => e.x < 600).map((e) => e.y));
  check(para.y > colTop, 'a short column beside a tall one rides lower than the top of the tall one');
  // a list is rows in ONE band, with lines between and its padding paid once
  const ev = (when, what, who, price) => ({ columns: [
    { span: 1, items: [{ type: 'text', text: when }] },
    { span: 5, items: [{ type: 'heading', text: what, size: 'normal' }, { type: 'text', text: who }] },
    { span: 1, align: 'right', items: [{ type: 'text', text: price }] } ] });
  const listDef = JSON.parse(JSON.stringify(florist));
  listDef.pages[0].sections = [{ band: { heading: "What's on", rule: true, rowGap: 's', rows: [
    ev('Tue 16', 'Nature writing, out loud', 'With Amara Fenn', 'Free'),
    ev('Wed 17', "Children's hour", 'Ages 3 to 7', 'Free'),
    ev('Fri 19', 'Crime night', 'Signing from seven', '£6') ] } }];
  r = await rpc({ jsonrpc: '2.0', id: 84, method: 'tools/call', params: { name: 'gogh_publish', arguments: { definition: listDef } } });
  check(r.body.result.structuredContent.ok, 'a list of rows passes: ' + JSON.stringify(r.body.result.structuredContent.problems || []));
  const list = JSON.parse(await env.SITES.get('def:' + r.body.result.structuredContent.id)).pages[0].sections[0];
  const rules = list.els.filter((e) => e.type === 'box' && /linear-gradient/.test(e.boxBg || ''));
  check(rules.length === 4 && rules.every((e) => e.x === 80 && e.w === 1040), 'four hairlines for three rows, edge to edge: ' + rules.length);
  check(rules.every((e) => e.h >= 8) && /100% 1px no-repeat/.test(rules[0].boxBg), 'the line is one pixel whatever height the box is stretched to');
  const dates = list.els.filter((e) => e.type === 'para' && /^(Tue|Wed|Fri)/.test(e.text || ''));
  check(dates.length === 3 && dates.every((d) => d.x === 80), 'the dates line up in the left column');
  const prices = list.els.filter((e) => e.type === 'para' && /Free|£6/.test(e.text || ''));
  check(prices.every((p) => p.align === 'right' && p.x > 900), 'the prices sit hard right: ' + prices.map((p) => p.x).join(','));
  // the whole list costs one band's padding, not one per entry
  check(list.minH < 700, 'three entries do not become a page of white space: ' + list.minH);
  const rowTops = dates.map((d) => d.y).sort((a, b) => a - b);
  check(rowTops[1] - rowTops[0] < 130 && rowTops[2] - rowTops[1] < 130, 'the rows sit close together: ' + rowTops.join(','));
  const bad = await rpc({ jsonrpc: '2.0', id: 82, method: 'tools/call', params: { name: 'gogh_check', arguments: { definition: (() => { const d = JSON.parse(JSON.stringify(withBand)); d.pages[0].sections[1].band.columns[0].items[1].type = 'marquee'; return d; })() } } });
  check(bad.body.result.structuredContent.problems.some((m) => /type must be one of/.test(m)), 'an item type nobody has is caught by name');
}

// the palette's fourth slot is body ink for some variations, so it is never
// a wrapped-around brand colour
{
  const three = JSON.parse(JSON.stringify(florist));
  three.palette = { base: '#14161A', contrast: '#ECE7DE', accents: ['#D97757', '#2A2E35', '#8D8981'] };
  const r = await rpc({ jsonrpc: '2.0', id: 90, method: 'tools/call', params: { name: 'gogh_publish', arguments: { definition: three } } });
  const kept = JSON.parse(await env.SITES.get('def:' + r.body.result.structuredContent.id)).palette.accents;
  check(kept.length === 6 && kept[0] === '#D97757' && kept[3] !== '#D97757', 'three accents are padded to six, and the fourth is not the brand colour again: ' + kept.join(' '));
  check(kept[3].toLowerCase() === '#ece7de', 'the fourth slot is the ink, so body text stays readable: ' + kept[3]);
}

// pictures: a search with the library connected, and an honest answer without
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const url = typeof u === 'string' ? u : u.url;
    if (url.startsWith('https://api.unsplash.com/search/photos')) {
      check(/query=hands\+tying\+flowers|query=hands%20tying%20flowers/.test(url) && /orientation=landscape/.test(url), 'the search passes the words and the shape: ' + url.slice(38, 130));
      return new Response(JSON.stringify({ results: [{ id: 'p1', color: '#B4523A', alt_description: 'hands tying stems',
        urls: { raw: 'https://images.unsplash.com/photo-1', regular: 'https://images.unsplash.com/photo-1?w=1080' },
        links: { download_location: 'https://api.unsplash.com/photos/p1/download' },
        user: { name: 'Ada Reed', links: { html: 'https://unsplash.com/@ada' } } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.startsWith('https://api.unsplash.com/photos/p1/download')) { pinged.push(url); return new Response('{}', { status: 200 }); }
    return realFetch(u, init);
  };
  const pinged = [];
  const withKey = { ...env, UNSPLASH_ACCESS_KEY: 'test-key' };
  let rp = await rpcWith(withKey, { jsonrpc: '2.0', id: 70, method: 'tools/call', params: { name: 'gogh_pictures', arguments: { query: 'hands tying flowers', orientation: 'landscape' } } });
  const pics = rp.body.result.structuredContent;
  check(pics.ok && pics.pictures[0].url === 'https://images.unsplash.com/photo-1&w=1600&q=80&fm=jpg&fit=max' && pics.pictures[0].by === 'Ada Reed' && pics.pictures[0].colour === '#B4523A', 'a picture comes back ready to use, credited, with its colour: ' + JSON.stringify(pics.pictures[0] || {}).slice(0, 140));
  // publishing a definition that uses it tells Unsplash, as their terms ask
  const withPic = JSON.parse(JSON.stringify(florist));
  withPic.pages[0].sections[0].image = pics.pictures[0].url;
  withPic.credits = [{ name: 'Ada Reed', link: 'https://unsplash.com/@ada' }];
  rp = await rpcWith(withKey, { jsonrpc: '2.0', id: 71, method: 'tools/call', params: { name: 'gogh_publish', arguments: { definition: withPic } } });
  check(rp.body.result.structuredContent.ok && pinged.length === 1, 'publishing pings the download endpoint for the picture actually used: ' + pinged.length);
  globalThis.fetch = realFetch;
  const noKey = await rpcWith(env, { jsonrpc: '2.0', id: 72, method: 'tools/call', params: { name: 'gogh_pictures', arguments: { query: 'flowers' } } });
  check(noKey.body.result.structuredContent.ok === false && /without pictures/.test(noKey.body.result.content[0].text), 'with no key it says to carry on without pictures rather than failing');
  // the endpoint is open, so nobody may spend the whole picture allowance
  {
    const capped = { ...env, RATE: kv(), UNSPLASH_ACCESS_KEY: 'test-key', PICTURES_HOURLY_LIMIT: '2' };
    let last = null;
    for (let i = 0; i < 4; i++) last = await rpcWith(capped, { jsonrpc: '2.0', id: 73 + i, method: 'tools/call', params: { name: 'gogh_pictures', arguments: { query: 'flowers' } } });
    check(last.body.result.structuredContent.ok === false && /hour/.test(last.body.result.content[0].text), 'past the hourly allowance it stops searching and says so: ' + last.body.result.content[0].text.slice(0, 60));
  }
}

// a screenshot: it reaches the model, and it does not ride home in the history
{
  const realFetch = globalThis.fetch;
  let sent = null;
  globalThis.fetch = async (u, init) => {
    const url = typeof u === 'string' ? u : u.url;
    if (url.startsWith('https://api.anthropic.com')) {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'I can see it — a cover, then three cards.' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(u, init);
  };
  const waits = [];
  const shot = { media_type: 'image/jpeg', data: 'AAAABBBBCCCC' };
  let res = await worker.fetch(
    new Request('https://gogh.test/api/build', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'build me this', image: shot }) }),
    { ...env, ANTHROPIC_API_KEY: 'sk-test' },
    { waitUntil: (p) => waits.push(p) }
  );
  const body = await new Response(res.body).text();
  await Promise.all(waits);
  const events = body.split('\n\n').filter(Boolean).map((b) => JSON.parse(b.replace(/^data: /, '')));
  const first = sent.messages[0].content;
  check(Array.isArray(first) && first[0].type === 'image' && first[0].source.data === 'AAAABBBBCCCC' && first[1].text === 'build me this', 'the screenshot reaches the model beside the words');
  check(events.find((e) => e.type === 'step').text === 'Looking at your screenshot', 'the page is told it is being looked at');
  const home = events.find((e) => e.type === 'reply').messages;
  const anyImage = JSON.stringify(home).indexOf('"image"') !== -1;
  check(!anyImage && /shared earlier/.test(JSON.stringify(home)), 'the picture does not ride home in the history, only a note of it');
  // and a second turn carrying that history is accepted
  res = await worker.fetch(
    new Request('https://gogh.test/api/build', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'warmer please', messages: home }) }),
    { ...env, ANTHROPIC_API_KEY: 'sk-test' }, { waitUntil: (p) => waits.push(p) }
  );
  check(res.status === 200, 'the next turn carries on from that history');
  await new Response(res.body).text();
  res = await worker.fetch(
    new Request('https://gogh.test/api/build', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'this', image: { media_type: 'application/pdf', data: 'x' } }) }),
    { ...env, ANTHROPIC_API_KEY: 'sk-test' }
  );
  check(res.status === 400 && /could not read that picture/.test((await res.json()).error), 'something that is not a picture is refused kindly');
  globalThis.fetch = realFetch;
}

// the progress stream: a turn says what it is doing before it says anything else
{
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const url = typeof u === 'string' ? u : u.url;
    if (url.startsWith('https://api.anthropic.com')) {
      calls.push(1);
      const body = calls.length === 1
        ? { content: [{ type: 'tool_use', id: 't1', name: 'check_site', input: { definition: florist } }] }
        : calls.length === 2
          ? { content: [{ type: 'tool_use', id: 't2', name: 'publish_site', input: { definition: florist } }] }
          : { content: [{ type: 'text', text: 'Here is your site.' }] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(u, init);
  };
  const waits = [];
  const res = await worker.fetch(
    new Request('https://gogh.test/api/build', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'a florist in Bath' }) }),
    { ...env, ANTHROPIC_API_KEY: 'sk-test' },
    { waitUntil: (p) => waits.push(p) }
  );
  check(res.status === 200 && /text\/event-stream/.test(res.headers.get('content-type')), 'a build turn answers as a stream');
  const text = await new Response(res.body).text();
  await Promise.all(waits);
  const events = text.split('\n\n').filter(Boolean).map((b) => JSON.parse(b.replace(/^data: /, '')));
  const steps = events.filter((e) => e.type === 'step').map((e) => e.text);
  const reply = events.find((e) => e.type === 'reply');
  check(steps[0] === 'Thinking' && steps.includes('Checking it over') && steps.includes('Publishing your site'), 'it names each real step as it reaches it: ' + steps.join(' · '));
  check(reply && reply.text === 'Here is your site.' && reply.published && /playground\.wordpress\.net/.test(reply.published.url), 'the last event carries the words and the link');
  globalThis.fetch = realFetch;
}

console.log(failures ? `${failures} failure(s)` : 'all passed');
process.exit(failures ? 1 : 0);

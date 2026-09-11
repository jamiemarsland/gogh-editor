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
const rpc = async (msg) => {
  const res = await worker.fetch(new Request('https://gogh.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body: JSON.stringify(msg) }), env);
  return { status: res.status, body: res.status === 202 ? null : await res.json() };
};

let r = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
check(r.status === 200 && r.body.result.protocolVersion === '2025-06-18' && r.body.result.serverInfo.name === 'gogh', 'initialize answers with the version asked for');
r = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
check(r.status === 202, 'a notification gets 202 and no body');
r = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
check(r.body.result.tools.map((t) => t.name).join() === 'gogh_rules,gogh_check,gogh_publish', 'three tools, rules first');
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
console.log(failures ? `${failures} failure(s)` : 'all passed');
process.exit(failures ? 1 : 0);

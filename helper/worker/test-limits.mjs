import fs from 'fs';
import path from 'path';

const KB_URL = 'https://raw.githubusercontent.com/jamiemarsland/gogh-editor/main/helper/gogh-kb.md';
const kbText = fs.readFileSync('../gogh-kb.md', 'utf8');
const store = new Map();
globalThis.caches = { default: {
  async match(r) { const v = store.get(r.url); return v ? new Response(v) : undefined; },
  async put(r, res) { store.set(r.url, await res.text()); } } };

let sent = [];
globalThis.fetch = async (url, init) => {
  const u = typeof url === 'string' ? url : url.url;
  if (u === KB_URL) return new Response(kbText, { status: 200 });
  sent.push(JSON.parse(init.body));
  return new Response('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n',
    { status: 200, headers: { 'content-type': 'text/event-stream' } });
};

// minimal KV shim
const kv = new Map();
const RATE = { async get(k) { return kv.has(k) ? kv.get(k) : null; }, async put(k, v) { kv.set(k, v); } };

const worker = (await import(path.resolve('dist/worker.js'))).default;
const ok = (l, c, x = '') => console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  — ' + x : ''}`);

const ask = (env, ip = '1.2.3.4', body = {}) => worker.fetch(new Request('https://h.test/api/chat', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], ...body }),
}), env);

// --- per-IP cap ------------------------------------------------------------
kv.clear();
let env = { ANTHROPIC_API_KEY: 'k', RATE, DAILY_LIMIT: '3', GLOBAL_DAILY_LIMIT: '0' };
let codes = [];
for (let i = 0; i < 5; i++) codes.push((await ask(env)).status);
ok('per-IP cap of 3 blocks the 4th', JSON.stringify(codes) === '[200,200,200,429,429]', JSON.stringify(codes));

const otherIp = (await ask(env, '9.9.9.9')).status;
ok('a different IP is unaffected', otherIp === 200, String(otherIp));

// --- global cap ------------------------------------------------------------
kv.clear();
env = { ANTHROPIC_API_KEY: 'k', RATE, DAILY_LIMIT: '0', GLOBAL_DAILY_LIMIT: '4' };
codes = [];
for (let i = 0; i < 6; i++) codes.push((await ask(env, '10.0.0.' + i)).status);
ok('global cap holds across different IPs', JSON.stringify(codes) === '[200,200,200,200,429,429]', JSON.stringify(codes));

const msg = (await (await ask(env, '10.0.0.99')).json()).error;
ok('global-cap message differs from per-IP', msg.includes('for everyone'), JSON.stringify(msg));

// --- no KV = no limit (and meta says so) -----------------------------------
kv.clear();
env = { ANTHROPIC_API_KEY: 'k' };
codes = [];
for (let i = 0; i < 3; i++) codes.push((await ask(env)).status);
ok('without KV there is no limit', JSON.stringify(codes) === '[200,200,200]', JSON.stringify(codes));
let meta = await (await worker.fetch(new Request('https://h.test/api/meta'), env)).json();
ok('meta warns rateLimited:false', meta.rateLimited === false);

kv.clear();
env = { ANTHROPIC_API_KEY: 'k', RATE, GLOBAL_DAILY_LIMIT: '100' };
await ask(env); await ask(env);
meta = await (await worker.fetch(new Request('https://h.test/api/meta'), env)).json();
ok('meta reports usage today', meta.askedToday === 2 && meta.globalDailyLimit === 100, JSON.stringify({a: meta.askedToday, l: meta.globalDailyLimit}));

// --- plugin context --------------------------------------------------------
sent = [];
await ask({ ANTHROPIC_API_KEY: 'k' }, '1.1.1.1', { context: { pluginVersion: '0.94.2', from: 'editor' } });
let sys = sent[0].system[0].text;
ok('version reaches the prompt', sys.includes('running Gogh 0.94.2'));
ok('editor origin reaches the prompt', sys.includes('mid-task'));

sent = [];
await ask({ ANTHROPIC_API_KEY: 'k' }, '1.1.1.1', { context: { pluginVersion: 'x"; DROP--', from: 'evil' } });
sys = sent[0].system[0].text;
ok('junk context is dropped', !sys.includes('DROP') && !sys.includes('ABOUT THIS PERSON'));

sent = [];
await ask({ ANTHROPIC_API_KEY: 'k' }, '1.1.1.1');
ok('no context = no extra block', !sent[0].system[0].text.includes('ABOUT THIS PERSON'));

// --- KV write failure must not take the bot down ---------------------------
kv.clear();
const brokenKV = {
  async get(k) { return kv.has(k) ? kv.get(k) : null; },
  async put() { throw new Error('KV PUT limit exceeded'); },   // free tier: 1000/day
};
env = { ANTHROPIC_API_KEY: 'k', RATE: brokenKV, DAILY_LIMIT: '25', GLOBAL_DAILY_LIMIT: '400' };
codes = [];
for (let i = 0; i < 3; i++) codes.push((await ask(env)).status);
ok('requests survive KV write failure', JSON.stringify(codes) === '[200,200,200]', JSON.stringify(codes));

meta = await (await worker.fetch(new Request('https://h.test/api/meta'), env)).json();
ok('meta surfaces counterErrors', meta.counterErrors >= 3, String(meta.counterErrors));

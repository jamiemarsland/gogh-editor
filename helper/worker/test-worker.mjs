import fs from 'fs';
import path from 'path';

const KB_URL = 'https://raw.githubusercontent.com/jamiemarsland/gogh-editor/main/helper/gogh-kb.md';
const kbText = fs.readFileSync('../gogh-kb.md', 'utf8');

// --- shims -----------------------------------------------------------------
const store = new Map();
globalThis.caches = {
  default: {
    async match(req) { const v = store.get(req.url); return v ? new Response(v) : undefined; },
    async put(req, res) { store.set(req.url, await res.text()); },
  },
};

let upstreamCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = typeof url === 'string' ? url : url.url;
  if (u === KB_URL) return new Response(kbText, { status: 200 });
  if (u.startsWith('https://api.anthropic.com')) {
    upstreamCalls.push(JSON.parse(init.body));
    const sse = [
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Press "}}',
      '',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Publish."}}',
      '', '',
    ].join('\n');
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }
  return realFetch(url, init);
};

const mod = await import(path.resolve('dist/worker.js'));
const worker = mod.default;
const env = { ANTHROPIC_API_KEY: 'sk-test', REFRESH_TOKEN: 'tok' };
const call = (p, init) => worker.fetch(new Request('https://h.test' + p, init), env);

const ok = (label, cond, extra = '') =>
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);

// --- 1. UI -----------------------------------------------------------------
let r = await call('/');
let html = await r.text();
ok('GET / serves HTML', r.status === 200 && html.startsWith('<!DOCTYPE html>'));
ok('UI has an empty KB (hosted mode)', /const KB = "";/.test(html));
ok('UI carries the prompt', /const PROMPT = \{/.test(html));
ok('UI contains no API key field default', !html.includes('sk-ant-') || html.includes('placeholder="sk-ant-..."'));
ok('KB is NOT bundled in the served page', !html.includes('Generated facts appendix'));

// --- 2. meta ---------------------------------------------------------------
r = await call('/api/meta');
const meta = await r.json();
ok('GET /api/meta ok', r.status === 200);
ok('meta reports plugin version', meta.pluginVersion === '0.96.5', JSON.stringify(meta.pluginVersion));
ok('meta reports kb id', /^[0-9a-f]{7}$/.test(meta.kbId || ''), meta.kbId);
ok('meta flags missing rate limiter', meta.rateLimited === false);

// --- 3. chat ---------------------------------------------------------------
upstreamCalls = [];
r = await call('/api/chat', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'how do I publish?' }], mode: 'beginner' }),
});
const body = await r.text();
ok('POST /api/chat streams', r.status === 200 && body.includes('text_delta'));
ok('response is SSE', (r.headers.get('content-type') || '').includes('text/event-stream'));

const sent = upstreamCalls[0];
ok('KB sent as system block', sent.system[1].text.includes('Generated facts appendix'));
ok('prompt cache enabled on KB', sent.system[1].cache_control?.type === 'ephemeral');
ok('beginner mode reached the prompt', sent.system[0].text.includes('MODE: BEGINNER'));
ok('streaming requested', sent.stream === true);

// --- 4. validation ---------------------------------------------------------
const bad = async (payload, label) => {
  const res = await call('/api/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  ok(label, res.status === 400, 'got ' + res.status);
};
await bad({ messages: [] }, 'rejects empty messages');
await bad({ messages: 'nope' }, 'rejects non-array messages');
await bad({ messages: [{ role: 'system', content: 'x' }] }, 'rejects a system role');
await bad({ messages: Array.from({ length: 40 }, () => ({ role: 'user', content: 'x' })) }, 'rejects over-long conversations');

r = await call('/api/chat', { method: 'GET' });
ok('GET /api/chat rejected', r.status === 405);

// --- 5. refresh ------------------------------------------------------------
r = await call('/api/refresh');
ok('refresh needs a token', r.status === 401);
r = await call('/api/refresh?token=tok');
ok('refresh works with the token', r.status === 200);

// --- 6. missing key --------------------------------------------------------
r = await worker.fetch(new Request('https://h.test/api/chat', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
}), {});
ok('clear error when the key is unset', r.status === 500 && (await r.json()).error.includes('ANTHROPIC_API_KEY'));

r = await call('/nope');
ok('unknown path 404s', r.status === 404);

import fs from 'fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from '/home/claude/gogh-bot/node_modules/playwright/index.mjs';

const KB_URL = 'https://raw.githubusercontent.com/jamiemarsland/gogh-editor/main/helper/gogh-kb.md';
const kbText = fs.readFileSync('../gogh-kb.md', 'utf8');

const store = new Map();
globalThis.caches = { default: {
  async match(r) { const v = store.get(r.url); return v ? new Response(v) : undefined; },
  async put(r, res) { store.set(r.url, await res.text()); } } };

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = typeof url === 'string' ? url : url.url;
  if (u === KB_URL) return new Response(kbText, { status: 200 });
  if (u.startsWith('https://api.anthropic.com')) {
    // stream slowly so we can observe the typing effect
    const chunks = ['Hit ', '**Publish** ', 'in the status chip, ', 'or press ⌘S.'];
    const stream = new ReadableStream({
      async start(c) {
        const enc = new TextEncoder();
        for (const t of chunks) {
          c.enqueue(enc.encode('data: ' + JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } }) + '\n\n'));
          await new Promise(r => setTimeout(r, 200));
        }
        c.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }
  return realFetch(url, init);
};

const worker = (await import(path.resolve('dist/worker.js'))).default;
const env = { ANTHROPIC_API_KEY: 'sk-test' };

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const r = new Request('http://localhost' + req.url, {
    method: req.method,
    headers: req.headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
  const out = await worker.fetch(r, env);
  res.writeHead(out.status, Object.fromEntries(out.headers));
  if (out.body) { for await (const c of out.body) res.write(c); }
  res.end();
});
await new Promise(r => server.listen(8787, r));

const b = await chromium.launch({ executablePath: process.env.PW_EXE });
const p = await b.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:8787/');
await p.waitForTimeout(500);

const ok = (l, c, x = '') => console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  — ' + x : ''}`);

ok('hosted mode detected', await p.evaluate(() => HOSTED === true));
ok('settings gear hidden', await p.evaluate(() => getComputedStyle(document.getElementById('gear')).display === 'none'));
const sub = await p.textContent('.sub');
ok('version line filled from /api/meta', /Gogh 0\.96\.5 · knowledge base [0-9a-f]{7}/.test(sub), sub);
ok('status reads Ready', (await p.textContent('#statustext')) === 'Ready');

await p.fill('#input', 'how do I publish?');
await p.click('#send');
await p.waitForTimeout(300);
const midway = await p.textContent('.msg.bot .body');
await p.waitForTimeout(1200);
const final = await p.textContent('.msg.bot .body');

ok('streams progressively', midway.length > 0 && midway.length < final.length, `${midway.length} → ${final.length} chars`);
ok('renders the full answer', final.includes('Publish') && final.includes('⌘S'), JSON.stringify(final));
ok('markdown bold rendered', (await p.innerHTML('.msg.bot .body')).includes('<strong>Publish</strong>'));
ok('no JS errors', errs.length === 0, errs.join('; '));

await b.close();
server.close();

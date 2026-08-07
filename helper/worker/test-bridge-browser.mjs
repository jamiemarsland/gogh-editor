import fs from 'fs'; import http from 'node:http'; import path from 'node:path';
import { chromium } from '/home/claude/gogh-bot/node_modules/playwright/index.mjs';

const KB_URL='https://raw.githubusercontent.com/jamiemarsland/gogh-editor/main/helper/gogh-kb.md';
const kb=fs.readFileSync('../gogh-kb.md','utf8'); const store=new Map();
globalThis.caches={default:{async match(r){const v=store.get(r.url);return v?new Response(v):undefined;},async put(r,res){store.set(r.url,await res.text());}}};

// Canned answers keyed by what the user asks.
const ANSWERS = {
  add: 'Drop a heading in from the side palette, or I can do it.\n\n```gogh-act\n{"label":"Add the heading","verb":"gogh_add_element","args":{"type":"heading","text":"Our work","section":0}}\n```',
  del: 'That would remove section 2 and everything on it.\n\n```gogh-act\n{"label":"Delete section 2","verb":"gogh_delete_section","args":{"section":2}}\n```',
  bad: 'Here you go.\n\n```gogh-act\n{"label":"Publish it","verb":"gogh_publish","args":{}}\n```',
  why: 'Because text steps through your theme presets. No button needed.',
};
globalThis.fetch=async(url,init)=>{const u=typeof url==='string'?url:url.url;
  if(u===KB_URL) return new Response(kb,{status:200});
  const body=JSON.parse(init.body);
  const q=body.messages[body.messages.length-1].content;
  const text=ANSWERS[q]||'ok';
  const enc=new TextEncoder();
  return new Response(new ReadableStream({start(c){
    c.enqueue(enc.encode('data: '+JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text}})+'\n\n'));c.close();}}),
    {status:200,headers:{'content-type':'text/event-stream'}});};

const worker=(await import(path.resolve('dist/worker.js'))).default;
const env={ANTHROPIC_API_KEY:'k'};

const PARENT = `<!DOCTYPE html><html><body>
<iframe id="f" src="/?bridge=1&v=0.97.1&ctx=el-heading" style="width:900px;height:700px;border:0"></iframe>
<script>
window.received = [];
window.replyMode = 'ok';
addEventListener('message', ev => {
  const d = ev.data;
  if (!d || d.gogh !== 'act') return;
  window.received.push(d);
  if (window.replyMode === 'silent') return;
  const reply = window.replyMode === 'fail'
    ? { gogh:'act-result', id:d.id, ok:false, error:'Section 2 does not exist.' }
    : { gogh:'act-result', id:d.id, ok:true, result:'Added heading "Our work" to section 1.' };
  ev.source.postMessage(reply, '*');
});
<\/script></body></html>`;

const server=http.createServer(async(req,res)=>{
  if(req.url.startsWith('/parent')){res.writeHead(200,{'content-type':'text/html'});return res.end(PARENT);}
  const chunks=[];for await(const c of req)chunks.push(c);
  const r=new Request('http://localhost'+req.url,{method:req.method,headers:req.headers,body:chunks.length?Buffer.concat(chunks):undefined});
  const out=await worker.fetch(r,env);
  res.writeHead(out.status,Object.fromEntries(out.headers));
  if(out.body){for await(const c of out.body)res.write(c);} res.end();
});
await new Promise(r=>server.listen(8788,r));

const b=await chromium.launch({executablePath:process.env.PW_EXE});
const page=await b.newPage(); const errs=[];
page.on('pageerror',e=>errs.push(e.message));
await page.goto('http://localhost:8788/parent');
const f=page.frameLocator('#f');
await page.waitForTimeout(700);

const ok=(l,c,x='')=>console.log(`${c?'PASS':'FAIL'}  ${l}${x?'  — '+x:''}`);
const askIn = async (q) => { await f.locator('#input').fill(q); await f.locator('#send').click(); await page.waitForTimeout(500); };

ok('bridge detected in iframe', await page.frame({url:/bridge=1/}).evaluate(()=>BRIDGE===true));

// --- a normal action ---
await askIn('add');
ok('button rendered', await f.locator('.act button').count() === 1);
ok('button uses the model label', (await f.locator('.act button').textContent()).trim() === 'Add the heading');

await f.locator('.act button').click();
await page.waitForTimeout(400);
const got = await page.evaluate(()=>window.received);
ok('postMessage sent to parent', got.length === 1, JSON.stringify(got[0]&&got[0].verb));
ok('message shape correct', got[0].gogh==='act' && got[0].verb==='gogh_add_element'
   && got[0].args.text==='Our work' && typeof got[0].id==='string');
ok('success shown', (await f.locator('.act').getAttribute('class')).includes('done'));
ok('editor result surfaced', (await f.locator('.act .note').textContent()).includes('Added heading'));

// --- refusal of an unknown verb ---
await askIn('bad');
ok('gogh_publish never becomes a button', await f.locator('.act button').count() === 1, 'still just the earlier one');

// --- no button when none is warranted ---
await askIn('why');
ok('text-only answer stays text-only', await f.locator('.act button').count() === 1);

// --- destructive: two clicks ---
await page.evaluate(()=>{window.received=[];});
await askIn('del');
const delBtn = f.locator('.act button').last();
ok('delete button marked dangerous', (await delBtn.getAttribute('class')||'').includes('danger'));
await delBtn.click(); await page.waitForTimeout(250);
ok('first click does not fire', (await page.evaluate(()=>window.received.length)) === 0);
ok('first click asks to confirm', (await delBtn.textContent()).startsWith('Sure?'));
await delBtn.click(); await page.waitForTimeout(400);
ok('second click fires', (await page.evaluate(()=>window.received.length)) === 1);

// --- failure path ---
await page.evaluate(()=>{window.replyMode='fail';window.received=[];});
await askIn('add');
await f.locator('.act button').last().click();
await page.waitForTimeout(400);
const lastAct = f.locator('.act').last();
ok('failure shown', (await lastAct.getAttribute('class')).includes('failed'));
ok('error message surfaced', (await lastAct.locator('.note').textContent()).includes('does not exist'));
ok('retry still possible', await lastAct.locator('button').isEnabled());

// --- spoofed reply from a non-parent source is ignored ---
await page.evaluate(()=>{window.replyMode='silent';window.received=[];});
await askIn('add');
await f.locator('.act button').last().click();
await page.waitForTimeout(300);
await page.frame({url:/bridge=1/}).evaluate(()=>{
  window.postMessage({gogh:'act-result',id:'act-1-2654435761',ok:true,result:'spoofed'},'*');
});
await page.waitForTimeout(300);
const cls = await f.locator('.act').last().getAttribute('class');
ok('self-posted reply ignored', !cls.includes('done'), cls);

ok('no JS errors', errs.length===0, errs.join('; '));
await b.close(); server.close();

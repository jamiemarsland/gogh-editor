import fs from 'fs'; import path from 'path';
const KB_URL='https://raw.githubusercontent.com/jamiemarsland/gogh-editor/main/helper/gogh-kb.md';
const kbText=fs.readFileSync('../gogh-kb.md','utf8'); const store=new Map();
globalThis.caches={default:{async match(r){const v=store.get(r.url);return v?new Response(v):undefined;},async put(r,res){store.set(r.url,await res.text());}}};
let sent=[];
globalThis.fetch=async(url,init)=>{const u=typeof url==='string'?url:url.url;
  if(u===KB_URL) return new Response(kbText,{status:200});
  sent.push(JSON.parse(init.body));
  return new Response('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n',{status:200,headers:{'content-type':'text/event-stream'}});};
const worker=(await import(path.resolve('dist/worker.js'))).default;
const env={ANTHROPIC_API_KEY:'k'};
const ok=(l,c,x='')=>console.log(`${c?'PASS':'FAIL'}  ${l}${x?'  — '+x:''}`);
const ask=(context)=>worker.fetch(new Request('https://h.test/api/chat',{method:'POST',
  headers:{'content-type':'application/json'},
  body:JSON.stringify({messages:[{role:'user',content:'hi'}],context})}),env);

sent=[]; await ask({bridge:true});
let sys=sent[0].system[0].text;
ok('bridge on → verbs in prompt', sys.includes('gogh_add_element') && sys.includes('gogh-act'));
ok('bridge on → publish prohibition stated', sys.includes('cannot publish'));

sent=[]; await ask({from:'editor'});
sys=sent[0].system[0].text;
ok('bridge off → no button instructions', !sys.includes('gogh-act'));

sent=[]; await ask({bridge:true, ctx:'el-heading', pluginVersion:'0.97.1'});
sys=sent[0].system[0].text;
ok('ctx reaches the prompt', sys.includes('heading selected'));
ok('version reaches the prompt', sys.includes('running Gogh 0.97.1'));

sent=[]; await ask({bridge:true, ctx:'<script>alert(1)</script>'});
sys=sent[0].system[0].text;
ok('unknown ctx dropped', !sys.includes('alert') && !sys.includes('script'));

sent=[]; await ask({bridge:'yes'});
sys=sent[0].system[0].text;
ok('bridge must be boolean true', !sys.includes('gogh-act'));

sent=[]; await ask(undefined);
sys=sent[0].system[0].text;
ok('no context → nothing extra', !sys.includes('ABOUT THIS PERSON') && !sys.includes('gogh-act'));

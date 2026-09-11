/**
 * Gogh Helper — Cloudflare Worker
 *
 * Serves the chat UI and proxies to the Anthropic API with the key held
 * server-side, so the deployed page can be public.
 *
 * The knowledge base is NOT bundled. It is fetched from GitHub at runtime and
 * cached, so when the release workflow commits a regenerated kb, the deployed
 * bot picks it up on its own — no redeploy. That is the whole point: the worker
 * is infrastructure and changes rarely; the knowledge changes every release.
 *
 * Routes
 *   GET  /             the chat UI
 *   GET  /api/meta     { pluginVersion, kbId, kbBytes, model, fetchedAt }
 *   POST /api/chat     { messages, mode } → SSE stream passed straight through
 *   POST /api/refresh  force a KB re-fetch (needs REFRESH_TOKEN)
 *
 * Secrets / vars — see wrangler.jsonc
 *   ANTHROPIC_API_KEY  (secret, required)
 *   REFRESH_TOKEN      (secret, optional)
 *   KB_URL, MODEL, MAX_TOKENS, KB_TTL_SECONDS, MAX_TURNS,
 *   DAILY_LIMIT, GLOBAL_DAILY_LIMIT (vars)
 *   RATE (KV namespace, optional — without it there is no rate limiting)
 *
 * The connector ("chat to an AI, get a blueprint")
 *   POST /mcp          a remote MCP server: gogh_rules, gogh_check, gogh_publish
 *   GET  /d/<id>.json  a published site definition
 *   GET  /b/<id>.json  the Playground blueprint that builds it
 *   SITES (KV namespace) holds definitions for SITE_TTL_DAYS;
 *   PLUGIN_ZIP_URL is the gogh build the blueprint installs
 *
 * The front door (no install, no AI app, no account)
 *   GET  /build        a page where anyone describes a site and gets a link
 *   POST /api/build    one turn of that conversation, tools run in-process
 */

const UI = __UI__;
const PROMPT = __PROMPT__;

const DEFAULTS = {
  KB_URL: 'https://raw.githubusercontent.com/jamiemarsland/gogh-demo/main/gogh-kb.md', // the public demo repo — gogh-editor went private
  MODEL: 'claude-sonnet-4-5',
  MAX_TOKENS: '1400',
  KB_TTL_SECONDS: '600',
  MAX_TURNS: '24',
  DAILY_LIMIT: '25',
  GLOBAL_DAILY_LIMIT: '400',
  SITE_TTL_DAYS: '30',
  PUBLISH_DAILY_LIMIT: '12',
  BUILD_DAILY_LIMIT: '30',
  // a way out: every built site carries the Move to WordPress.com helper, so
  // what someone makes here need not stay in a browser tab. Set '' to drop it.
  MOVE_PLUGIN_URL: 'https://github.com/jamiemarsland/playground-to-wordpress-com/archive/refs/heads/main.zip',
  // real photographs, so a built site is not the same cream every time.
  // UNSPLASH_ACCESS_KEY is a secret; without it pictures are simply skipped.
  UNSPLASH_APP_NAME: 'gogh',
  PICTURES_PER_SEARCH: '6',
  // the endpoint is open, so the picture allowance needs its own guard: one
  // address cannot spend the day's, and everyone together cannot outrun the
  // hourly allowance Unsplash gives a new application
  PICTURES_DAILY_LIMIT: '60',
  PICTURES_HOURLY_LIMIT: '40',
  PLUGIN_ZIP_URL: 'https://raw.githubusercontent.com/jamiemarsland/gogh-demo/main/gogh-playground.zip',
};

const cfg = (env, k) => env[k] || DEFAULTS[k];

/* ------------------------------------------------------------------ the KB */

// Per-isolate memo on top of the Cache API. Isolates are short-lived, so the
// cache is what actually does the work; this just avoids re-parsing on bursts.
let memo = null;

async function getKB(env, { force = false } = {}) {
  const ttl = parseInt(cfg(env, 'KB_TTL_SECONDS'), 10);
  const now = Date.now();

  if (!force && memo && now - memo.fetchedAt < ttl * 1000) return memo;

  const url = cfg(env, 'KB_URL');
  const cache = caches.default;
  const cacheKey = new Request(url, { method: 'GET' });

  let res = force ? null : await cache.match(cacheKey);
  if (!res) {
    // force means FORCE: cf.cacheTtl caches the raw response at
    // Cloudflare's edge too, and a forced refresh must punch through
    // that layer or "refresh" serves the same stale copy for ttl seconds
    // a force-refresh must MISS Cloudflare's fetch cache, and cacheTtl:0
    // doesn't evict an existing entry — only a new cache key does
    const fetchUrl = force ? url + (url.includes('?') ? '&' : '?') + 'fresh=' + Date.now() : url;
    res = await fetch(fetchUrl, { cf: force ? { cacheTtl: 0, cacheEverything: false } : { cacheTtl: ttl, cacheEverything: true } });
    if (!res.ok) {
      // A stale KB beats no bot at all.
      if (memo) return memo;
      // Name the URL: the usual cause is that helper/gogh-kb.md has not been
      // pushed to the default branch yet, and that is not guessable from a 404.
      throw new Error(
        `Could not read the knowledge base (HTTP ${res.status}) from ${url} — ` +
        'open that link in a browser. If it 404s, the file is not on your default branch yet; ' +
        'upload the helper folder to GitHub, or change KB_URL in the Worker settings.'
      );
    }
    const copy = new Response(res.clone().body, res);
    copy.headers.set('cache-control', `public, max-age=${ttl}`);
    await cache.put(cacheKey, copy);
  }

  const text = await res.text();
  memo = {
    text,
    fetchedAt: now,
    bytes: text.length,
    // both stamped into the KB header by build.py
    pluginVersion: (text.match(/plugin version ([\d.]+)/) || [])[1] || null,
    kbId: (text.match(/knowledge base ([0-9a-f]{7})/) || [])[1] || null,
  };
  return memo;
}

/* -------------------------------------------------------------- rate limits */

/**
 * Two caps, because they stop different things.
 *
 * PER-IP stops one person hammering it. GLOBAL stops the bill. Once this URL is
 * linked from the plugin, every user's questions are billed to one key, and a
 * per-IP limit does nothing to bound the total — a thousand people politely
 * asking two questions each is a thousand people's worth of tokens.
 *
 * Both are KV counters. KV is eventually consistent, so under a burst these can
 * overshoot by a little. They are a spend guard, not an accountant — set a hard
 * budget limit on the Anthropic key too.
 *
 * With no KV binding neither cap applies and the endpoint is an open proxy on
 * your API key. /api/meta reports this so you can check from outside.
 */
let counterErrors = 0;

// A failed counter must never take the bot down. Cloudflare's free KV plan
// allows 1,000 writes/day and this spends two per question, which is why the
// defaults sit at 400 global — see wrangler.jsonc. If writes do start failing,
// requests keep flowing and /api/meta reports counterErrors so you can see it.
async function bump(env, key, ttl) {
  try {
    await env.RATE.put(key, String(ttl.next), { expirationTtl: 60 * 60 * 36 });
  } catch (e) {
    counterErrors++;
  }
}

async function checkLimits(env, req) {
  if (!env.RATE) return null;

  const day = new Date().toISOString().slice(0, 10);
  const perIp = parseInt(cfg(env, 'DAILY_LIMIT'), 10);
  const global = parseInt(cfg(env, 'GLOBAL_DAILY_LIMIT'), 10);

  if (global) {
    const gKey = `g:${day}`;
    const g = parseInt((await env.RATE.get(gKey)) || '0', 10);
    if (g >= global) {
      return "The helper has hit its daily limit for everyone — it'll reset tomorrow. " +
             'The docs and the GitHub repo have the same answers in the meantime.';
    }
    await bump(env, gKey, { next: g + 1 });
  }

  if (perIp) {
    const ip = req.headers.get('cf-connecting-ip') || 'unknown';
    const key = `q:${day}:${ip}`;
    const n = parseInt((await env.RATE.get(key)) || '0', 10);
    if (n >= perIp) {
      return "That's today's question limit for this address. Try again tomorrow.";
    }
    await bump(env, key, { next: n + 1 });
  }

  return null;
}

async function usageToday(env) {
  if (!env.RATE) return null;
  const day = new Date().toISOString().slice(0, 10);
  return parseInt((await env.RATE.get(`g:${day}`)) || '0', 10);
}

/* ------------------------------------------------------------------ helpers */

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  });

// What the user is doing when they open the helper, as reported by ?ctx=.
// Whitelisted: these strings reach the prompt, so they cannot be free text.
const CTX_NOTES = {
  'el-heading':   'They have a heading selected on the canvas. Lead with heading-related help — sizing, alignment, colour, linking — unless they ask about something else.',
  'chrome-cycle': 'They are cycling the site header or footer designs. Remember that publishing chrome updates every page, and say so.',
  'panel':        'They have a settings panel open, so they are configuring something specific.',
  'canvas':       'They are on the canvas with nothing selected.',
};

function contextNote(ctx) {
  // The plugin links here with ?v= and ?ctx=, so the bot knows which release
  // the person is on and what they are in the middle of doing.
  if (!ctx || typeof ctx !== 'object') return '';
  const bits = [];
  if (typeof ctx.pluginVersion === 'string' && /^[\w.-]{1,24}$/.test(ctx.pluginVersion)) {
    bits.push(`They are running Gogh ${ctx.pluginVersion}. If that differs from the version in the knowledge base, say so when it matters to the answer.`);
  }
  if (ctx.from === 'editor') {
    bits.push('They opened this from inside the Gogh editor, so they are mid-task. Lead with the action.');
  }
  if (CTX_NOTES[ctx.ctx]) {
    bits.push(CTX_NOTES[ctx.ctx]);
  }
  return bits.length ? '\n\nABOUT THIS PERSON\n\n' + bits.join('\n') : '';
}

function systemBlocks(kb, mode, ctx) {
  const note = PROMPT.modes[mode] || PROMPT.modes.auto;
  // The bridge instructions only exist when the page can actually render a
  // button. Sending them otherwise would have the bot promise something the
  // user's page will silently drop.
  const bridge = (ctx && ctx.bridge === true) ? '\n\n' + PROMPT.bridge : '';
  return [
    { type: 'text', text: PROMPT.persona + bridge + '\n\n' + note + contextNote(ctx) },
    {
      type: 'text',
      text:
        '=== GOGH EDITOR KNOWLEDGE BASE ===\n' +
        'Everything below is extracted from the Gogh Editor source. Treat it as authoritative.\n\n' +
        kb,
      // The KB is ~18k tokens and identical on every request, so caching it
      // turns the dominant cost into ~10% of itself after the first call.
      cache_control: { type: 'ephemeral' },
    },
  ];
}

function validate(body, env) {
  if (!body || !Array.isArray(body.messages)) return 'messages must be an array';
  const maxTurns = parseInt(cfg(env, 'MAX_TURNS'), 10);
  if (!body.messages.length) return 'messages is empty';
  if (body.messages.length > maxTurns) return `conversation too long (max ${maxTurns} turns)`;

  let chars = 0;
  for (const m of body.messages) {
    if (m.role !== 'user' && m.role !== 'assistant') return 'bad role';
    if (typeof m.content !== 'string') return 'content must be a string';
    chars += m.content.length;
  }
  if (chars > 60000) return 'conversation too long';
  return null;
}

/* ------------------------------------------------------------------- routes */

async function handleChat(req, env) {
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'ANTHROPIC_API_KEY is not set on this Worker' }, 500);
  }
  const limited = await checkLimits(env, req);
  if (limited) return json({ error: limited }, 429);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }

  const bad = validate(body, env);
  if (bad) return json({ error: bad }, 400);

  let kb;
  try {
    kb = await getKB(env);
  } catch (e) {
    return json({ error: e.message }, 502);
  }

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: cfg(env, 'MODEL'),
      max_tokens: parseInt(cfg(env, 'MAX_TOKENS'), 10),
      system: systemBlocks(kb.text, body.mode, body.context),
      messages: body.messages,
      stream: true,
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text();
    let msg = detail.slice(0, 400);
    try {
      msg = JSON.parse(detail).error.message;
    } catch {}
    // Never leak upstream auth failures verbatim to a public page.
    if (upstream.status === 401 || upstream.status === 403) {
      msg = 'the Worker’s API key was rejected';
    }
    return json({ error: msg }, upstream.status === 429 ? 429 : 502);
  }

  // Pipe the SSE stream straight through — no buffering, so it types out.
  return new Response(upstream.body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}


/* -------------------------------------------------------- the connector */
/*
 * "Chat to an AI, get a blueprint." The people this is for are not
 * technical: they describe a site to Claude (or any assistant that speaks
 * MCP), Claude calls these three tools, and comes back with a link that
 * builds the site in a Playground in their browser. Nothing installed.
 *
 * The AI never writes geometry. A definition is content and choices —
 * pages of takes from gogh's shelf, filled by role — and the editor draws
 * it with the tested takes, so a beginner's site looks designed the first
 * time. The server needs no browser and no AI key: the user's own
 * assistant does the composing; this end only checks, stores and serves.
 */

// the takes a definition may use, and what each one takes. Mirrors
// fillTake() in gogh-editor.js — keep the two together.
const TAKES = {
  'Cover': { for: 'the front door: one headline over one full-bleed picture', fields: ['eyebrow', 'heading', 'text', 'button', 'link', 'image'] },
  'Hero': { for: 'a headline and a photo side by side, two buttons, a badge', fields: ['eyebrow', 'heading', 'text', 'button', 'link', 'button2', 'badge', 'image'] },
  'Big statement': { for: 'one big line, nothing else', fields: ['eyebrow', 'heading', 'button', 'link'] },
  'Story': { for: 'a picture beside two paragraphs — about pages, origins', fields: ['eyebrow', 'heading', 'text', 'text2', 'button', 'link', 'badge', 'image'] },
  'Article': { for: 'a comfortable reading column', fields: ['eyebrow', 'heading', 'text', 'text2', 'text3', 'button', 'link'] },
  'Numbers': { for: 'three figures with labels', fields: ['eyebrow'], items: { value: 'the figure, e.g. "312"', label: 'what it counts' }, count: 3 },
  'Feature cards': { for: 'three things you do, offer or believe', fields: ['heading', 'mood'], items: { title: '', text: 'one or two sentences' }, count: 3, max: 3 },
  'Pricing': { for: 'three plans', fields: ['eyebrow', 'heading'], items: { title: '', text: '', price: 'e.g. "£40/mo"', button: '', badge: 'optional, e.g. "Most popular"' }, count: 3, max: 3 },
  'Quote': { for: 'one big quotation', fields: ['text', 'name'] },
  'Testimonials': { for: 'three short quotes from customers', fields: ['heading'], items: { quote: '', name: 'who, e.g. "Ella · Bath"' }, count: 3, max: 3 },
  'Call to action': { for: 'the ask, on a coloured band', fields: ['eyebrow', 'heading', 'text', 'button', 'link'] },
  'Get in touch': { for: 'a contact form with a short invitation', fields: ['eyebrow', 'heading', 'text'] },
  'Team': { for: 'people with a picture, a name and a role', fields: ['eyebrow', 'heading'], items: { name: '', role: '', image: 'optional' }, count: 3, max: 3 },
  'Gallery': { for: 'three pictures and a button', fields: ['eyebrow', 'heading', 'button', 'link'], items: { image: 'a picture URL' }, count: 3, max: 3 },
  'Photo wall': { for: 'a wall of pictures', fields: ['eyebrow', 'heading'], items: { image: 'a picture URL', caption: 'optional' }, count: 6, max: 12 },
  'Carousel': { for: 'pictures that slide', fields: ['eyebrow', 'heading'], items: { image: 'a picture URL', caption: 'optional' }, count: 4, max: 10 },
  'FAQ': { for: 'questions and answers', fields: ['eyebrow', 'heading'], items: { q: 'the question', a: 'the answer' }, count: 4, max: 8 },
  'Menu': { for: 'dishes and prices', fields: ['eyebrow', 'heading', 'text'], items: { name: '', price: 'e.g. "£9"' }, count: 4, max: 4 },
  'Portfolio': { for: 'one case study with a picture and two results', fields: ['eyebrow', 'heading', 'text', 'badge', 'badge2', 'button', 'link', 'image'] },
  'Profile card': { for: 'one person on a card over a picture', fields: ['eyebrow', 'heading', 'text', 'text2', 'button', 'link', 'badge'] },
  'Place card': { for: 'one place on a card over a picture', fields: ['eyebrow', 'heading', 'text', 'text2', 'button', 'link', 'badge'] },
  'Job card': { for: 'one job on a card', fields: ['heading', 'text', 'text2', 'button', 'link', 'badge'] },
  'Latest posts': { for: 'the newest posts, live', fields: ['heading', 'posts'] },
};
const VARIATIONS = ['Morning', 'Evening', 'Noon', 'Afternoon', 'Dusk', 'Twilight', 'Sunrise', 'Midnight'];
const HEADERS = ['gogh-header-classic', 'gogh-header-bold', 'gogh-header-centred', 'gogh-header-hamburger', 'gogh-header-minimal', 'gogh-header-onepage', 'gogh-header-overlay', 'gogh-header-split'];
const FOOTERS = ['gogh-footer-columns', 'gogh-footer-simple', 'gogh-footer-bold'];
// The pictures gogh itself ships, with what they ARE — a path alone tells
// the writer nothing, and a site of four Van Goghs was the only picture-led
// site the connector could build. The black-and-white set rides in every
// build (starters/ is in the zip); the paintings ride in the playground one.
const OWN_PICTURES = {
  '/wp-content/plugins/gogh/demo-assets/almond-blossom.jpg': 'Van Gogh — almond blossom, pale blue and white',
  '/wp-content/plugins/gogh/demo-assets/sunflowers.jpg': 'Van Gogh — sunflowers, yellow on yellow',
  '/wp-content/plugins/gogh/demo-assets/wheat-field.jpg': 'Van Gogh — a wheat field under a wide sky',
  '/wp-content/plugins/gogh/demo-assets/starry-night.jpg': 'Van Gogh — the starry night, deep blue',
  '/wp-content/plugins/gogh/starters/photographer/bw-the-villa.jpg': 'black and white — a modern villa, glass and flat roofs (wide)',
  '/wp-content/plugins/gogh/starters/photographer/bw-white-house.jpg': 'black and white — a white modernist house in hard sun (square)',
  '/wp-content/plugins/gogh/starters/photographer/bw-curves.jpg': 'black and white — a curved facade seen from below, nearly abstract (tall)',
  '/wp-content/plugins/gogh/starters/photographer/bw-cinque-terre.jpg': 'black and white — an old cliff town above a harbour (tall)',
  '/wp-content/plugins/gogh/starters/photographer/bw-first-light.jpg': 'black and white — first light on an empty beach (wide)',
  '/wp-content/plugins/gogh/starters/photographer/bw-salt-water.jpg': 'black and white — a small wave breaking, close up (tall)',
  '/wp-content/plugins/gogh/starters/photographer/bw-portrait-studio.jpg': 'black and white portrait — a man against a dark ground',
  '/wp-content/plugins/gogh/starters/photographer/bw-laughing.jpg': 'black and white portrait — a woman laughing',
  '/wp-content/plugins/gogh/starters/photographer/bw-portrait-dusk.jpg': 'black and white portrait — a woman at dusk, striped shirt',
};
const PICTURE_PATHS = Object.keys(OWN_PICTURES);
const MAX_DEF_BYTES = 64 * 1024;

const EXAMPLE = {
  name: 'Bloom & Bough', tagline: 'Flowers from Bath, tied by hand', variation: 'Morning',
  palette: { base: '#FBF7F1', contrast: '#22201C', accents: ['#B4523A', '#E9D6BD', '#7C8C6A', '#3F3A33'] },
  chrome: { header: 'gogh-header-classic', footer: 'gogh-footer-columns' },
  pages: [
    { title: 'Home', front: true, sections: [
      { take: 'Cover', eyebrow: 'Bath · since 2014', heading: 'Flowers that mean it', text: 'Seasonal stems from growers we know, tied the morning you order.', button: 'See this week’s flowers', image: '/wp-content/plugins/gogh/demo-assets/almond-blossom.jpg' },
      { take: 'Feature cards', heading: 'What we do', mood: 'lift', items: [{ title: 'Weddings', text: 'From a buttonhole to a whole barn.' }, { title: 'Weekly bunches', text: 'On your doorstep every Friday.' }, { title: 'Workshops', text: 'Two hours and a table of stems.' }] },
      { take: 'Testimonials', heading: 'Kind words', items: [{ quote: 'Better than the pictures I sent them.', name: 'Ella · Widcombe' }, { quote: 'The best thing I pay for.', name: 'Tom · Larkhall' }, { quote: 'She has not stopped tying posies since.', name: 'Priya · Oldfield Park' }] },
      { take: 'Latest posts', heading: 'From the journal', posts: { look: 'cards', count: 3 } },
      { take: 'Call to action', eyebrow: 'Say hello', heading: 'Come and see the shop', text: '12 Walcot Street, Tuesday to Saturday.', button: 'Get in touch' },
    ] },
    { title: 'About', sections: [
      { take: 'Story', eyebrow: 'Our story', heading: 'It started with a market stall', text: 'One table on Green Park on Saturdays.', text2: 'Ten years on: a shop, a cutting garden, the same rule.', button: 'Meet the team' },
      { take: 'Team', eyebrow: 'The shop', heading: 'Four people, one van', items: [{ name: 'Nell Hartley', role: 'Founder' }, { name: 'Sam Okafor', role: 'Weddings' }, { name: 'Ruth Adair', role: 'The garden' }] },
    ] },
    { title: 'Journal', blog: true },
    { title: 'Contact', sections: [{ take: 'Get in touch', eyebrow: 'Say hello', heading: 'Let’s talk flowers', text: 'Write and we will answer the same day.' }] },
  ],
  posts: [{ title: 'What is in season in September', text: 'Dahlias, still. Late roses.\n\nWe cut on Mondays and Thursdays.', image: '/wp-content/plugins/gogh/demo-assets/sunflowers.jpg' }],
};

function rulesText() {
  const takes = Object.keys(TAKES).map((k) => {
    const t = TAKES[k];
    let line = `- **${k}** — ${t.for}. Fields: ${t.fields.join(', ')}.`;
    if (t.items) line += ` Items (${t.count}${t.max && t.max !== t.count ? `, up to ${t.max}` : ''}): { ${Object.keys(t.items).map((f) => f + (t.items[f] ? ` (${t.items[f]})` : '')).join(', ')} }.`;
    return line;
  }).join('\n');
  return `# How to build a WordPress site with gogh

You write a **site definition**: content and choices, never layout. Gogh draws it with tested designs ("takes"), so the result looks designed without you seeing it. Work with the person first: what the site is for, its name, tone, three to five pages, what each page should say. Then draft the definition, call \`gogh_check\`, fix anything it reports, and call \`gogh_publish\`. Give the person the \`playground_url\` and tell them it builds itself in about a minute.

## The definition
\`\`\`
{ name, tagline,
  variation: one of ${VARIATIONS.join(' | ')}   (the typography and mood; Morning is warm and bookish, Evening is dark, Sunrise is bright),
  palette: { base: '#hex' (page colour), contrast: '#hex' (ink), accents: ['#hex', ...] (2 to 4) },
  chrome: { header: ${HEADERS.join(' | ')}, footer: ${FOOTERS.join(' | ')}, sticky: true (pins the header as you scroll) },
  nav: [ { label, url } ]   (optional: a menu of your own. url is '#anchor' or an http(s) link. Without it the menu is one link per page)
  pages: [ { title, front: true (exactly one), blog: true (the posts page, no sections), sections: [ { take, anchor, ...fields } ] } ],
  posts: [ { title, text (plain paragraphs separated by blank lines), image } ],
  credits: [ { name, link } ]   (the photographers whose pictures you used) }
\`\`\`
Rules: 1 to 8 pages, up to 10 sections a page, the front page first. Headings are short (2 to 7 words). Texts are one to three plain sentences. Buttons are two or three words. An eyebrow is a tiny label above the heading ("Bath · since 2014"). \`mood\` on card takes is one of still, lift, zoom, veil, glass. Write in the person's own voice and facts; never lorem ipsum.

**Pictures.** A site with photographs looks a world better than one without, so use them. Search by what should be in the shot, not by the trade: "hands tying flowers", "a bright cafe counter at dawn", "an empty theatre from the wings". Take the url exactly as given. One search of six often covers a whole site; two is plenty. A picture earns its place most on a Cover, a Story, a Portfolio or a Team. Use a URL the person gave you where they gave one, and gogh's own only as a last resort. Never invent a picture URL.

**Working from a picture.** If the person shares a screenshot, a mockup or a photograph of a design, read it and rebuild what it shows: which parts come in which order, how many across, where the pictures sit, the palette. Match it with the nearest takes rather than trying to trace it, and tell them plainly what you took and what you changed. Take the words from the image only when they are clearly the person's own; otherwise write fresh ones. Never reproduce a logo or a brand mark.

**Credit and colour.** Every photographer whose picture you use goes in \`credits\` as { name, link }, from the search result's \`by\` and \`by_link\`. The finished site prints them. Each result also carries \`colour\`, the photo's own dominant colour — building the palette around the hero photo's colour is the quickest way to make a site look designed rather than assembled.

## Gogh's own pictures
${PICTURE_PATHS.map((k) => `- \`${k}\` — ${OWN_PICTURES[k]}`).join('\n')} Write in the person's own voice and facts; never lorem ipsum.

## The takes
${takes}

## When no take fits: describe a band
A take is a design someone already made, so reach for one whenever it suits — they are quicker and they carry taste. But you are not limited to them. Instead of \`take\`, a section may carry a \`band\`: columns across the page, each holding a few pieces in order. gogh works out every position and size from it, so you never write coordinates.

\`\`\`
{ band: {
    eyebrow, heading, text,        // optional, across the full width above the columns
    size: display | large | normal, // how big that heading is
    align: left | center | right,   // default left
    valign: top | middle | bottom,  // how columns of different lengths sit against each other
    gap: s | m | l,
    background: '#rrggbb' | base | contrast | accent-1..6,
    image, tint,                    // a picture behind the whole band, 0-100
    columns: [ { span: 1, align, items: [ ... ] } ]   // up to 6 columns, span sets the share of the width
} }
\`\`\`
An item is one of: \`{type:'eyebrow', text}\`, \`{type:'heading', text, size}\`, \`{type:'text', text}\`, \`{type:'button', text, link}\`, \`{type:'badge', text}\`, \`{type:'picture', url, shape}\` where shape is landscape, portrait, square or wide. Up to 8 items a column.

**A list is rows, and it is ONE band.** For anything that reads down the page — events with dates, a menu with prices, opening hours, a programme — give the band \`rows\` instead of \`columns\`, each row holding its own columns, with \`rule: true\` for hairlines between them and \`rowGap: s|m|l\`. Never make a band per entry: each band carries its own generous padding, so four of them is a page of white space and no lines. Row titles are \`size: normal\`; a whole list of large headings reads as four separate sections rather than one list.

\`\`\`
{ band: { heading: "What's on", rule: true, rowGap: 's', rows: [
  { columns: [ {span:1, items:[{type:'text', text:'Tue 16'}]},
               {span:5, items:[{type:'heading', text:'Nature writing, out loud', size:'normal'}, {type:'text', text:'With Amara Fenn · upstairs room'}]},
               {span:1, align:'right', items:[{type:'text', text:'Free'}]} ] } ] } }
\`\`\`

Four projects across, each a tall picture with a name under it, is four columns of \`[picture(portrait), heading(normal), text]\`. A hero with the words on the left and one picture on the right is two columns with \`valign: middle\` and a \`span\` of 3 and 2. Use a band when the arrangement itself matters — when someone shows you a design and asks for something like it — and a take the rest of the time.

A good home page is four to six sections: a Cover or Hero, Feature cards, something human (Testimonials, Team, Story or Numbers), Latest posts if there are posts, and a Call to action or Get in touch at the end. An about page: Story, Numbers, Team. A contact page: Get in touch. Give a Journal page \`blog: true\` and two or three posts so it is not empty. Shops need WooCommerce and are not yet part of a definition.

## A one-page site
When the whole site belongs on one page — a small practice, an event, a product, anyone with more to say than a card and less than five pages — build it this way instead:

- **One page**, \`front: true\`, with six to nine sections. It is a whole site's worth of content in one scroll, so give it more sections than a home page would carry.
- **Give an \`anchor\`** to each section the menu will name: a lowercase word like \`work\` or \`services\`. It becomes the section's id. Leave it off the sections that are a breath between the named ones (a Quote, a Numbers strip) — a menu of nine is not a menu.
- **Write the \`nav\`** to match: \`[{ label: 'Work', url: '#work' }, …]\`, up to seven. Every \`#anchor\` must be a section on the front page, because an anchor link always lands there.
- **Pin the header**: \`chrome: { header: 'gogh-header-onepage', footer: 'gogh-footer-simple', sticky: true }\`. The menu has to still be there at the bottom of a long page. Gogh does the rest — the page glides to a section rather than jumping, and stops clear of the pinned header.

Example shape: \`{ take: 'Cover', anchor: 'top', … }\`, \`{ take: 'Big statement', anchor: 'about', … }\`, \`{ take: 'Numbers', … }\`, \`{ take: 'Gallery', anchor: 'work', … }\`, \`{ take: 'Feature cards', anchor: 'services', … }\`, \`{ take: 'Quote', … }\`, \`{ take: 'Team', anchor: 'studio', … }\`, \`{ take: 'Get in touch', anchor: 'contact', … }\` — with \`nav\` naming about, work, services, studio and contact.

A button inside a section can point at an anchor too: give the section a \`link\` of \`'#contact'\` and its button scrolls there.

## A complete example
\`\`\`json
${JSON.stringify(EXAMPLE, null, 1)}
\`\`\``;
}

const isHex = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
const BAND_ITEMS = { eyebrow: 1, heading: 1, text: 1, button: 1, badge: 1, picture: 1 };
function checkBand(band, where, bad) {
  if (!band || typeof band !== 'object' || Array.isArray(band)) { bad(`${where}: band must be an object.`); return; }
  if (band.align != null && !['left', 'center', 'right'].includes(band.align)) bad(`${where}: band.align must be left, center or right.`);
  if (band.valign != null && !['top', 'middle', 'bottom'].includes(band.valign)) bad(`${where}: band.valign must be top, middle or bottom.`);
  if (band.gap != null && !['s', 'm', 'l'].includes(band.gap)) bad(`${where}: band.gap must be s, m or l.`);
  if (band.background != null && !(isHex(band.background) || /^(base|contrast|accent-[1-6])$/.test(String(band.background)))) bad(`${where}: band.background must be a #rrggbb colour, or base, contrast or accent-1 to accent-6.`);
  if (band.image != null && !isPic(band.image)) bad(`${where}: band.image must be a picture web address.`);
  ['eyebrow', 'heading', 'text', 'name'].forEach((k) => { if (band[k] != null && !str(band[k], 600)) bad(`${where}: band.${k} is too long.`); });
  if (band.rowGap != null && !['s', 'm', 'l'].includes(band.rowGap)) bad(`${where}: band.rowGap must be s, m or l.`);
  if (Array.isArray(band.rows)) {
    if (!band.rows.length) bad(`${where}: band.rows is empty.`);
    if (band.rows.length > 12) bad(`${where}: at most 12 rows.`);
    band.rows.forEach((row, ri) => {
      if (!row || typeof row !== 'object') { bad(`${where}.rows[${ri}] must be an object.`); return; }
      checkColumns(row.columns, `${where}.rows[${ri}]`, bad);
    });
    return;
  }
  checkColumns(band.columns, where, bad);
}
function checkColumns(cols, where, bad) {
  if (!Array.isArray(cols) || !cols.length) { bad(`${where}: needs at least one column.`); return; }
  if (cols.length > 6) bad(`${where}: at most 6 columns.`);
  cols.forEach((c, ci) => {
    if (!c || typeof c !== 'object') { bad(`${where}.columns[${ci}] must be an object.`); return; }
    if (c.span != null && !(c.span >= 1 && c.span <= 6)) bad(`${where}.columns[${ci}].span must be 1 to 6.`);
    if (!Array.isArray(c.items) || !c.items.length) { bad(`${where}.columns[${ci}] needs items.`); return; }
    if (c.items.length > 8) bad(`${where}.columns[${ci}] has more than 8 items.`);
    c.items.forEach((it, ii) => {
      const at = `${where}.columns[${ci}].items[${ii}]`;
      if (!it || typeof it !== 'object') { bad(`${at} must be an object.`); return; }
      if (!BAND_ITEMS[it.type]) { bad(`${at}: type must be one of ${Object.keys(BAND_ITEMS).join(', ')}.`); return; }
      if (it.type === 'picture') {
        if (it.url != null && !isPic(it.url)) bad(`${at}: url must be a picture web address.`);
        if (it.shape != null && !['landscape', 'portrait', 'square', 'wide'].includes(it.shape)) bad(`${at}: shape must be landscape, portrait, square or wide.`);
      } else if (!str(it.text, 600) || !it.text) {
        bad(`${at}: ${it.type} needs text.`);
      }
      if (it.size != null && !['display', 'large', 'normal'].includes(it.size)) bad(`${at}: size must be display, large or normal.`);
    });
  });
}
const isPic = (v) => typeof v === 'string' && (/^https?:\/\/\S+$/.test(v) || PICTURE_PATHS.includes(v));
// a section's anchor becomes an id in the page: lowercase, starts with a letter
const isAnchor = (v) => typeof v === 'string' && /^[a-z][a-z0-9-]*$/.test(v);
// where a button goes: a section on this page, or off the site entirely
const isLink = (v) => typeof v === 'string' && (/^#[a-z][a-z0-9-]*$/.test(v) || /^https?:\/\/\S+$/.test(v) || /^(mailto:|tel:)\S+$/.test(v));
const str = (v, max) => v == null || (typeof v === 'string' && v.length <= max);

function checkDefinition(def) {
  const problems = [];
  const bad = (m) => problems.push(m);
  if (!def || typeof def !== 'object' || Array.isArray(def)) return { ok: false, problems: ['The definition must be an object.'], summary: '' };
  let bytes = 0;
  try { bytes = new TextEncoder().encode(JSON.stringify(def)).length; } catch (e) { bad('The definition is not valid JSON.'); }
  if (bytes > MAX_DEF_BYTES) bad(`The definition is ${Math.round(bytes / 1024)}KB; the limit is ${MAX_DEF_BYTES / 1024}KB.`);
  if (!str(def.name, 80) || !def.name) bad('name is required (up to 80 characters).');
  if (!str(def.tagline, 160)) bad('tagline is too long (160 characters).');
  if (def.variation != null && !VARIATIONS.some((v) => v.toLowerCase() === String(def.variation).toLowerCase())) bad(`variation must be one of ${VARIATIONS.join(', ')}.`);
  if (def.palette != null) {
    const p = def.palette;
    if (typeof p !== 'object') bad('palette must be an object.');
    else {
      ['base', 'contrast'].forEach((k) => { if (p[k] != null && !isHex(p[k])) bad(`palette.${k} must be a #rrggbb colour.`); });
      if (p.accents != null && (!Array.isArray(p.accents) || p.accents.length > 6 || !p.accents.every(isHex))) bad('palette.accents must be up to 6 #rrggbb colours.');
    }
  }
  if (def.chrome != null) {
    if (def.chrome.header != null && !HEADERS.includes(def.chrome.header)) bad(`chrome.header must be one of ${HEADERS.join(', ')}.`);
    if (def.chrome.footer != null && !FOOTERS.includes(def.chrome.footer)) bad(`chrome.footer must be one of ${FOOTERS.join(', ')}.`);
    if (def.chrome.sticky != null && typeof def.chrome.sticky !== 'boolean') bad('chrome.sticky must be true or false.');
    Object.keys(def.chrome).forEach((k) => { if (!['header', 'footer', 'sticky'].includes(k)) bad(`chrome: "${k}" is not a chrome choice (header, footer, sticky).`); });
  }
  const pages = Array.isArray(def.pages) ? def.pages : [];
  if (!pages.length) bad('pages must have at least one page.');
  if (pages.length > 8) bad('At most 8 pages.');
  const fronts = pages.filter((pg) => pg && pg.front).length;
  if (pages.length && fronts !== 1) bad('Exactly one page must have front: true.');
  const lines = [];
  const anchors = {}; // anchor -> the page it lives on, so nav can be checked against reality
  pages.forEach((pg, pi) => {
    if (!pg || typeof pg !== 'object') { bad(`pages[${pi}] must be an object.`); return; }
    if (!pg.title || !str(pg.title, 60)) bad(`pages[${pi}] needs a title (up to 60 characters).`);
    const secs = Array.isArray(pg.sections) ? pg.sections : [];
    if (pg.blog && secs.length) bad(`pages[${pi}] (${pg.title}) is the blog page: it takes no sections.`);
    if (!pg.blog && !secs.length) bad(`pages[${pi}] (${pg.title}) has no sections.`);
    if (secs.length > 10) bad(`pages[${pi}] (${pg.title}) has more than 10 sections.`);
    const names = [];
    secs.forEach((sc, si) => {
      const where = `pages[${pi}].sections[${si}]`;
      if (!sc || typeof sc !== 'object') { bad(`${where} must be an object.`); return; }
      if (sc.band && !sc.take) { checkBand(sc.band, where, bad); names.push('a band of ' + ((sc.band.columns || []).length || 1)); return; }
      const t = TAKES[sc.take];
      if (!t) { bad(`${where}: unknown take "${sc.take}", and no band either. Use one of: ${Object.keys(TAKES).join(', ')} — or describe a band.`); return; }
      names.push(sc.take + (Array.isArray(sc.items) ? ` ×${sc.items.length}` : ''));
      Object.keys(sc).forEach((k) => {
        if (['take', 'items', 'posts', 'mood', 'look'].includes(k)) return;
        if (k === 'anchor') {
          if (!isAnchor(sc[k])) bad(`${where}: anchor must be a lowercase name starting with a letter, like "work".`);
          else if (anchors[sc[k]] != null) bad(`${where}: two sections both carry the anchor "${sc[k]}" — an anchor names one section.`);
          else anchors[sc[k]] = pi;
          return;
        }
        if (!t.fields.includes(k)) bad(`${where} (${sc.take}): "${k}" is not a field of this take (fields: ${t.fields.join(', ')}).`);
        else if (k === 'image') { if (!isPic(sc[k])) bad(`${where}: image must be an http(s) URL or one of gogh's own pictures.`); }
        else if (k === 'link') { if (!isLink(sc[k])) bad(`${where}: link must be "#anchor" for a section on this site, or an http(s) URL — it is where the button goes.`); }
        else if (!str(sc[k], 600)) bad(`${where}: ${k} is too long (600 characters).`);
      });
      if (sc.items != null) {
        if (!t.items) bad(`${where} (${sc.take}) takes no items.`);
        else if (!Array.isArray(sc.items) || !sc.items.length) bad(`${where} (${sc.take}) items must be a non-empty list.`);
        else {
          if (sc.items.length > (t.max || 6)) bad(`${where} (${sc.take}) takes at most ${t.max || 6} items.`);
          sc.items.forEach((it, ii) => {
            if (!it || typeof it !== 'object') { bad(`${where}.items[${ii}] must be an object.`); return; }
            Object.keys(it).forEach((k) => {
              if (!(k in t.items) && k !== 'mood') bad(`${where}.items[${ii}]: "${k}" is not part of a ${sc.take} item (${Object.keys(t.items).join(', ')}).`);
              else if (k === 'image') { if (!isPic(it[k])) bad(`${where}.items[${ii}]: image must be an http(s) URL or one of gogh's own pictures.`); }
              else if (!str(it[k], 600)) bad(`${where}.items[${ii}]: ${k} is too long.`);
            });
          });
        }
      } else if (t.items && t.count) {
        bad(`${where} (${sc.take}) needs items — ${t.count} of { ${Object.keys(t.items).join(', ')} }.`);
      }
      if (sc.mood != null && !['still', 'lift', 'zoom', 'veil', 'glass', ''].includes(sc.mood)) bad(`${where}: mood must be still, lift, zoom, veil or glass.`);
      if (sc.posts != null) {
        if (sc.posts.look != null && !['', 'grid', 'cards', 'list', 'cover', 'ledger'].includes(sc.posts.look)) bad(`${where}: posts.look must be grid, cards, list, cover or ledger.`);
        if (sc.posts.count != null && !(sc.posts.count >= 1 && sc.posts.count <= 12)) bad(`${where}: posts.count must be 1 to 12.`);
      }
    });
    lines.push(`${pg.title}${pg.front ? ' (front)' : ''}${pg.blog ? ' (blog)' : ''}: ${names.join(', ') || '—'}`);
  });
  // a menu of anchors, for a one-page site. An anchor link always lands on
  // the FRONT page, so only the front page's sections can be named.
  const frontIdx = pages.findIndex((pg) => pg && pg.front);
  if (def.nav != null) {
    if (!Array.isArray(def.nav)) bad('nav must be a list of { label, url }.');
    else {
      if (!def.nav.length) bad('nav is empty — leave it out, or name some sections.');
      if (def.nav.length > 7) bad('nav takes at most 7 items.');
      def.nav.forEach((it, i) => {
        if (!it || typeof it !== 'object' || Array.isArray(it)) { bad(`nav[${i}] must be an object with a label and a url.`); return; }
        const who = it.label ? `"${it.label}"` : `nav[${i}]`;
        if (!it.label || !str(it.label, 40)) bad(`nav[${i}] needs a label (up to 40 characters).`);
        Object.keys(it).forEach((k) => { if (!['label', 'url'].includes(k)) bad(`nav[${i}] (${who}): "${k}" is not part of a menu item (label, url).`); });
        const u = typeof it.url === 'string' ? it.url.trim() : '';
        if (/^#[a-z][a-z0-9-]*$/.test(u)) {
          const at = anchors[u.slice(1)];
          if (at == null) bad(`nav[${i}] (${who}) points at ${u}, but no section carries that anchor.`);
          else if (frontIdx !== -1 && at !== frontIdx) bad(`nav[${i}] (${who}) points at ${u}, which is on "${pages[at].title}" — an anchor link always lands on the front page, so only front-page sections can be named.`);
        } else if (!/^https?:\/\/\S+$/.test(u)) {
          bad(`nav[${i}] (${who}) needs a url: "#anchor" for a section on this site, or an http(s) link.`);
        }
      });
    }
  } else if (Object.keys(anchors).length) {
    problems.push('Note: sections carry anchors but there is no nav — add one so the menu can scroll to them.');
  }
  if (def.credits != null) {
    if (!Array.isArray(def.credits) || def.credits.length > 20) bad('credits must be a list of up to 20 { name, link }.');
    else def.credits.forEach((c, i) => {
      if (!c || typeof c !== 'object' || !str(c.name, 120) || !c.name) bad(`credits[${i}] needs a name.`);
      if (c.link != null && !/^https?:\/\/\S+$/.test(String(c.link))) bad(`credits[${i}].link must be a web address.`);
    });
  }
  const posts = Array.isArray(def.posts) ? def.posts : [];
  if (posts.length > 8) bad('At most 8 posts.');
  posts.forEach((ps, i) => {
    if (!ps || !ps.title || !str(ps.title, 80)) bad(`posts[${i}] needs a title (up to 80 characters).`);
    if (!str(ps.text, 4000)) bad(`posts[${i}] text is too long (4000 characters).`);
    if (ps.image != null && !isPic(ps.image)) bad(`posts[${i}]: image must be an http(s) URL or one of gogh's own pictures.`);
  });
  const hasBlog = pages.some((pg) => pg && pg.blog);
  const usesPosts = pages.some((pg) => (pg && pg.sections || []).some((sc) => sc && sc.take === 'Latest posts'));
  if ((hasBlog || usesPosts) && !posts.length) problems.push('Note: there is a Journal page or a Latest posts section but no posts — add two or three so it is not empty.');
  if (Array.isArray(def.nav) && def.nav.length) {
    lines.push(`Menu: ${def.nav.map((it) => `${(it && it.label) || '?'} → ${(it && it.url) || '?'}`).join(', ')}`);
  }
  const summary = `${def.name || 'Site'}${def.tagline ? ' — ' + def.tagline : ''} · ${pages.length} page${pages.length === 1 ? '' : 's'}, ${posts.length} post${posts.length === 1 ? '' : 's'}${def.variation ? ', ' + def.variation : ''}\n` + lines.join('\n');
  const hard = problems.filter((m) => !/^Note:/.test(m));
  return { ok: hard.length === 0, problems, summary };
}

function newId() {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => (b % 36).toString(36)).join('');
}

async function publishLimit(env, req) {
  if (!env.RATE) return null;
  const perIp = parseInt(cfg(env, 'PUBLISH_DAILY_LIMIT'), 10);
  if (!perIp) return null;
  const day = new Date().toISOString().slice(0, 10);
  const ip = req.headers.get('cf-connecting-ip') || 'unknown';
  const key = `p:${day}:${ip}`;
  const n = parseInt((await env.RATE.get(key)) || '0', 10);
  if (n >= perIp) return `That is today's publishing limit for this address (${perIp} sites). Try again tomorrow.`;
  await bump(env, key, { next: n + 1 });
  return null;
}

async function publishSite(env, req, def) {
  const check = checkDefinition(def);
  if (!check.ok) return { ok: false, problems: check.problems };
  if (!env.SITES) return { ok: false, problems: ['Publishing is not set up on this helper (no SITES storage).'] };
  const limited = await publishLimit(env, req);
  if (limited) return { ok: false, problems: [limited] };
  try { await pingPictureUse(env, def); } catch (e) {}
  // bands become pieces here, so what is stored is what gogh draws
  try { def = compileDefinition(def); } catch (e) {
    return { ok: false, problems: ['That band could not be laid out: ' + (e.message || e)] };
  }
  const id = newId();
  const days = parseInt(cfg(env, 'SITE_TTL_DAYS'), 10) || 30;
  await env.SITES.put(`def:${id}`, JSON.stringify(def), { expirationTtl: days * 86400 });
  const origin = new URL(req.url).origin;
  const blueprintUrl = `${origin}/b/${id}.json`;
  return {
    ok: true,
    id,
    summary: check.summary,
    definition_url: `${origin}/d/${id}.json`,
    blueprint_url: blueprintUrl,
    playground_url: `https://playground.wordpress.net/?blueprint-url=${encodeURIComponent(blueprintUrl)}`,
    expires_in_days: days,
  };
}

function blueprintFor(env, id, def, origin) {
  // the definition rides INSIDE the blueprint, base64, and the boot calls
  // the plugin's own gogh_site_def_boot() straight from gogh.php: no
  // second fetch from PHP (Cloudflare's bot check refuses some server-side
  // clients) and no demo-boot.php (the public zip leaves it out on purpose)
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(def))));
  const php = [
    '<?php',
    "require '/wordpress/wp-load.php';",
    'wp_set_current_user( 1 );',
    'try { wp_trash_post( 1 ); } catch ( \\Throwable $e ) {}',
    `$def = json_decode( base64_decode( '${b64}' ), true );`,
    "if ( is_array( $def ) && function_exists( 'gogh_site_def_boot' ) ) {",
    '\ttry { gogh_site_def_boot( $def ); } catch ( \\Throwable $e ) {}',
    '}',
  ].join('\n');
  const steps = [
    { step: 'installTheme', themeData: { resource: 'wordpress.org/themes', slug: 'twentytwentyfive' }, options: { activate: true } },
    { step: 'installPlugin', pluginData: { resource: 'url', url: cfg(env, 'PLUGIN_ZIP_URL') }, options: { activate: true } },
  ];
  // a site made in a browser tab is a sketch until it has somewhere to live:
  // Move to WordPress.com rides along so there is a way out of the Playground
  const move = cfg(env, 'MOVE_PLUGIN_URL');
  if (move) steps.push({ step: 'installPlugin', pluginData: { resource: 'url', url: move }, options: { activate: true } });
  steps.push({ step: 'runPHP', code: php });
  steps.push({ step: 'setSiteOptions', options: { blogname: String(def.name || 'My site'), blogdescription: String(def.tagline || '') } });
  return {
    $schema: 'https://playground.wordpress.net/blueprint-schema.json',
    landingPage: '/?gogh-edit=1&gogh-build=1',
    preferredVersions: { php: '8.2', wp: 'latest' },
    features: { networking: true },
    login: true,
    steps: steps,
  };
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, accept, mcp-session-id, mcp-protocol-version, authorization',
  'access-control-expose-headers': 'mcp-session-id',
};

const MCP_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const TOOLS = [
  {
    name: 'gogh_rules',
    description: 'Read this FIRST, once per conversation, before drafting a site. Returns how a gogh site definition works: the format, the takes (tested section designs) and what each one needs, the writing rules, and a complete example.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'gogh_pictures',
    description: 'Search real photographs to use in a site. Call it once or twice while drafting, with plain words for what should be in the picture ("hands tying flowers", "a bright cafe counter"). Returns picture urls to use as-is, the photographer to credit, and each photo’s own dominant colour.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', description: 'What should be in the picture, in plain words.' },
      count: { type: 'number', description: 'How many to return, 1 to 10. Default 6.' },
      orientation: { type: 'string', enum: ['landscape', 'portrait', 'squarish'], description: 'Shape of the picture.' },
    }, required: ['query'] },
  },
  {
    name: 'gogh_check',
    description: 'Check a draft site definition before publishing. Returns ok, a list of problems to fix (each names the page and section), and a one-line-per-page summary you can read back to the person.',
    inputSchema: { type: 'object', properties: { definition: { type: 'object', description: 'The site definition, as described by gogh_rules.' } }, required: ['definition'] },
  },
  {
    name: 'gogh_publish',
    description: 'Publish a checked site definition. Returns playground_url — a link that builds the whole site in the person’s browser in about a minute, nothing to install — plus the definition and blueprint URLs. Give the person the playground_url and say it takes about a minute to build. Publish again after any change; each publish is a new link.',
    inputSchema: { type: 'object', properties: { definition: { type: 'object', description: 'The site definition, as described by gogh_rules.' } }, required: ['definition'] },
  },
];

async function mcpCall(env, req, name, args) {
  const text = (t, extra) => Object.assign({ content: [{ type: 'text', text: t }] }, extra || {});
  if (name === 'gogh_rules') return text(rulesText());
  if (name === 'gogh_pictures') {
    const r = await findPictures(env, req, args && args.query, args && args.count, args && args.orientation);
    return text(r.note + (r.pictures.length ? '\n\n' + JSON.stringify(r.pictures, null, 1) : ''), { structuredContent: r });
  }
  if (name === 'gogh_check') {
    const r = checkDefinition(args && args.definition);
    return text((r.ok ? 'OK — this definition can be published.\n' : 'Not yet — fix these:\n') + (r.problems.length ? r.problems.map((p) => '- ' + p).join('\n') + '\n' : '') + (r.summary ? '\n' + r.summary : ''), { structuredContent: r });
  }
  if (name === 'gogh_publish') {
    const r = await publishSite(env, req, args && args.definition);
    if (!r.ok) return text('Not published — fix these first:\n' + r.problems.map((p) => '- ' + p).join('\n'), { isError: true, structuredContent: r });
    return text(`Published. Give the person this link — it builds the site in their browser in about a minute:\n${r.playground_url}\n\n${r.summary}\n\nThe link stays live for ${r.expires_in_days} days. To change anything, edit the definition and publish again (a new link). People who already run gogh on a WordPress site can paste the definition URL into gogh instead: ${r.definition_url}`, { structuredContent: r });
  }
  return { content: [{ type: 'text', text: `Unknown tool ${name}` }], isError: true };
}

async function mcpMessage(env, req, msg) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
  const { id, method, params } = msg;
  if (id === undefined) return null; // a notification: nothing to say back
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  try {
    if (method === 'initialize') {
      const want = params && params.protocolVersion;
      return ok({
        protocolVersion: MCP_VERSIONS.includes(want) ? want : MCP_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'gogh', version: '1.0.0' },
        instructions: 'gogh builds WordPress sites from a definition of content and choices. Call gogh_rules once, work out the site with the person, draft the definition, gogh_check it, then gogh_publish and hand over the playground_url.',
      });
    }
    if (method === 'ping') return ok({});
    if (method === 'tools/list') return ok({ tools: TOOLS });
    if (method === 'tools/call') {
      const name = params && params.name;
      if (!TOOLS.some((t) => t.name === name)) return err(-32602, `Unknown tool: ${name}`);
      return ok(await mcpCall(env, req, name, (params && params.arguments) || {}));
    }
    return err(-32601, `Method not found: ${method}`);
  } catch (e) {
    return err(-32603, e.message || String(e));
  }
}

async function handleMcp(req, env) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'This is an MCP server: POST JSON-RPC here, or add it as a connector in your AI app.' }), { status: 405, headers: Object.assign({ 'content-type': 'application/json', allow: 'POST, OPTIONS' }, CORS) });
  }
  let body;
  try { body = await req.json(); } catch (e) {
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }), { status: 400, headers: Object.assign({ 'content-type': 'application/json' }, CORS) });
  }
  const batch = Array.isArray(body);
  const out = [];
  for (const msg of batch ? body : [body]) {
    const r = await mcpMessage(env, req, msg);
    if (r) out.push(r);
  }
  if (!out.length) return new Response(null, { status: 202, headers: CORS });
  return new Response(JSON.stringify(batch ? out : out[0]), { status: 200, headers: Object.assign({ 'content-type': 'application/json', 'cache-control': 'no-store' }, CORS) });
}

async function handleSiteFile(req, env, kind, id) {
  if (!/^[a-z0-9]{6,20}$/.test(id)) return new Response('Not found', { status: 404, headers: CORS });
  const raw = env.SITES ? await env.SITES.get(`def:${id}`) : null;
  if (!raw) return new Response(JSON.stringify({ error: 'This site link has expired or never existed.' }), { status: 404, headers: Object.assign({ 'content-type': 'application/json' }, CORS) });
  const headers = Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' }, CORS);
  if (kind === 'd') return new Response(raw, { headers });
  let def = {};
  try { def = JSON.parse(raw); } catch (e) {}
  return new Response(JSON.stringify(blueprintFor(env, id, def, new URL(req.url).origin), null, 1), { headers });
}

/* ------------------------------------------------------- bands */
/*
 * A catalogue of designs can never cover what people draw (James: "folks
 * might have a million designs — we can't create layouts for every
 * possibility"). So a section can also be described rather than named: a
 * band of columns, each holding a few pieces in order. This compiles that
 * description into gogh's own geometry — the model never writes a
 * coordinate, and gogh's solver, guard and contrast sentinel judge the
 * result exactly as they judge a person's own work.
 *
 * There is no browser here, so type cannot be measured. Every estimate
 * below leans tall: a loose band looks considered, a tight one collides.
 */
const W = 1200, MARGIN = 80, CONTENT = W - MARGIN * 2;
const GAPS = { s: 20, m: 32, l: 56 };
const PIC_RATIO = { portrait: 1.32, square: 1, landscape: 0.72, wide: 0.56 };
// '__max' is gogh's own sentinel for "the theme's largest size", resolved when
// the section is drawn — a literal slug came out at body size instead
// calibrated against what the canvas actually rendered, then rounded up:
// too tall is whitespace, too short is a collision
const HEAD = { display: { line: 66, per: 32, fs: '__max' }, large: { line: 46, per: 22, fs: 'x-large' }, normal: { line: 32, per: 14, fs: null } };
const AFTER = { eyebrow: 16, heading: 20, text: 22, button: 18, badge: 16, picture: 22 };

const lines = (text, width, per) => Math.max(1, Math.ceil(String(text || '').length / Math.max(4, width / per)));

function itemBox(it, width) {
  const kind = it.type;
  if (kind === 'picture') return { w: width, h: Math.round(width * (PIC_RATIO[it.shape] || PIC_RATIO.landscape)) };
  if (kind === 'eyebrow') return { w: width, h: 24 };
  if (kind === 'button') return { w: Math.max(150, Math.min(width, String(it.text || 'Go').length * 11 + 56)), h: 54 };
  if (kind === 'badge') return { w: Math.min(width, String(it.text || '').length * 11 + 46), h: 46 };
  if (kind === 'heading') {
    const size = HEAD[it.size] || HEAD.large;
    return { w: width, h: lines(it.text, width, size.per) * size.line + 6 };
  }
  return { w: width, h: lines(it.text, width, 12) * 27 + 4 }; // text
}

function itemEl(it, x, y, box, align) {
  const kind = it.type;
  if (kind === 'picture') {
    const e = { type: 'image', x, y, w: box.w, h: box.h, radius: it.radius != null ? +it.radius : 6 };
    if (it.url) e.src = String(it.url);
    if (it.alt) e.alt = String(it.alt).slice(0, 160);
    return e;
  }
  if (kind === 'button') return { type: 'button', x: align === 'center' ? Math.round(x + (CONTENT && 0)) : x, y, w: box.w, h: box.h, text: String(it.text || 'Go'), href: it.link ? String(it.link) : undefined };
  if (kind === 'badge') return { type: 'badge', x, y, w: box.w, h: box.h, text: String(it.text || '') };
  if (kind === 'eyebrow') {
    return { type: 'para', x, y, w: box.w, h: box.h, text: String(it.text || ''), align,
      tf: { fs: 13, fw: 600, ls2: 0.22, tt: 'uppercase' } };
  }
  if (kind === 'heading') {
    const size = HEAD[it.size] || HEAD.large;
    const e = { type: 'heading', x, y, w: box.w, h: box.h, text: String(it.text || ''), align };
    if (size.fs) e.fs = size.fs;
    return e;
  }
  return { type: 'para', x, y, w: box.w, h: box.h, text: String(it.text || ''), align };
}

function stack(items, x, width, top, align) {
  let y = top;
  const els = [];
  items.forEach((it, i) => {
    const box = itemBox(it, width);
    let ix = x;
    if (align === 'center' && box.w < width) ix = Math.round(x + (width - box.w) / 2);
    if (align === 'right' && box.w < width) ix = Math.round(x + width - box.w);
    els.push(itemEl(it, ix, y, box, align));
    y += box.h + (i === items.length - 1 ? 0 : (AFTER[it.type] || 20));
  });
  return { els, height: y - top };
}

const ROW_GAPS = { s: 18, m: 30, l: 52 };
// gogh's solver treats edges within 8 units of each other as the same grid
// line, so a 2-unit box collapses and comes back a fat bar. The rule is
// therefore a normal-height box that paints a line across its own middle —
// in percentages, so it stays one hair thick at any width, and in a tint of
// the theme's own ink, so it works on a light ground or a dark one.
const RULE_H = 12;
const RULE_INK = 'color-mix(in srgb, var(--wp--preset--color--contrast, #000) 18%, transparent)';
function ruleEl(y) {
  return { type: 'box', x: MARGIN, y, w: CONTENT, h: RULE_H,
    boxBg: `linear-gradient(to bottom, transparent 46%, ${RULE_INK} 46%, ${RULE_INK} 54%, transparent 54%)` };
}
function layColumns(columns, align, gap, valign, top) {
  const cols = (columns || []).filter((c) => c && Array.isArray(c.items) && c.items.length);
  if (!cols.length) return { els: [], height: 0 };
  const spans = cols.map((c) => Math.max(1, Math.min(6, +c.span || 1)));
  const total = spans.reduce((a, b) => a + b, 0);
  const room = CONTENT - gap * (cols.length - 1);
  let x = MARGIN;
  const laid = cols.map((c, i) => {
    const width = Math.round(room * (spans[i] / total));
    const done = stack(c.items, x, width, 0, c.align || align);
    x += width + gap;
    return done;
  });
  const tall = Math.max(...laid.map((l) => l.height));
  const els = [];
  laid.forEach((l) => {
    const off = valign === 'middle' ? Math.round((tall - l.height) / 2) : valign === 'bottom' ? tall - l.height : 0;
    l.els.forEach((e) => { e.y += top + off; els.push(e); });
  });
  return { els, height: tall };
}

function compileBand(band) {
  const align = ['left', 'center', 'right'].includes(band.align) ? band.align : 'left';
  const gap = GAPS[band.gap] || GAPS.m;
  const padTop = 96;
  const els = [];
  let y = padTop;

  // the band's own words, across the full width, above the columns
  const head = [];
  if (band.eyebrow) head.push({ type: 'eyebrow', text: band.eyebrow });
  if (band.heading) head.push({ type: 'heading', text: band.heading, size: band.size || 'large' });
  if (band.text) head.push({ type: 'text', text: band.text });
  if (head.length) {
    const width = align === 'center' ? Math.min(CONTENT, 820) : CONTENT;
    const hx = align === 'center' ? Math.round((W - width) / 2) : MARGIN;
    const done = stack(head, hx, width, y, align);
    done.els.forEach((e) => els.push(e));
    y += done.height + 54;
  }

  // rows: a list lives in ONE band, so its padding is paid once and the lines
  // between entries are part of the design (a band per row was four lots of
  // padding and no rules at all — "the dates look a bit weird, big spaces")
  const rows = Array.isArray(band.rows) ? band.rows.filter((r) => r && Array.isArray(r.columns) && r.columns.length) : [];
  if (rows.length) {
    const rowGap = ROW_GAPS[band.rowGap] || ROW_GAPS.m;
    rows.forEach((row) => {
      if (band.rule) { els.push(ruleEl(y)); y += RULE_H + Math.round(rowGap / 2); }
      const laid = layColumns(row.columns, row.align || align, GAPS[row.gap] || gap, row.valign || band.valign, y);
      laid.els.forEach((e) => els.push(e));
      y += laid.height + (band.rule ? Math.round(rowGap / 2) : rowGap);
    });
    if (band.rule) { els.push(ruleEl(y)); y += RULE_H; }
    else y -= rowGap;
  } else if (band.columns) {
    const laid = layColumns(band.columns, align, gap, band.valign, y);
    laid.els.forEach((e) => els.push(e));
    y += laid.height;
  }

  const out = { name: String(band.name || 'Band').slice(0, 60), els, minH: y + 96 };
  if (band.background) out.background = String(band.background);
  if (band.image) { out.image = String(band.image); if (band.tint != null) out.tint = Math.max(0, Math.min(100, +band.tint)); }
  return out;
}

// The theme keeps six accent slots and a style variation paints body text with
// the fourth of them. A palette of three was being cycled to fill six, so the
// fourth slot came back round to the brand colour and every word on the site
// turned terracotta. Pad deliberately instead: the pop first, then inks.
const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => rgb2hex(hex2rgb(a).map((v, i) => v + (hex2rgb(b)[i] - v) * t));

function padPalette(pal) {
  if (!pal || !Array.isArray(pal.accents) || pal.accents.length >= 6) return pal;
  const base = isHex(pal.base) ? pal.base : '#FFFFFF';
  const ink = isHex(pal.contrast) ? pal.contrast : '#111111';
  const out = pal.accents.slice();
  // slot 4 is the body ink for several variations, so it must be readable
  const filler = [ink, mix(ink, base, 0.35), mix(base, ink, 0.12), mix(ink, base, 0.6), mix(base, ink, 0.06)];
  let k = 0;
  while (out.length < 6) out.push(filler[Math.min(k++, filler.length - 1)]);
  return Object.assign({}, pal, { accents: out });
}

// bands become pieces on the way out; takes are left for gogh to fill
function compileDefinition(def) {
  const out = JSON.parse(JSON.stringify(def));
  if (out.palette) out.palette = padPalette(out.palette);
  (out.pages || []).forEach((pg) => {
    (pg.sections || []).forEach((sc, i) => {
      if (sc && sc.band && !sc.take) pg.sections[i] = compileBand(sc.band);
    });
  });
  return out;
}

/* ------------------------------------------------------------ pictures */
/*
 * A site with no photographs looks like every other site with no
 * photographs. Unsplash is the source (James pointed at their developer
 * page); the key lives here as a secret and is never seen by the page or
 * the assistant. Their terms ask two things of us and we do both: the
 * photographer is credited on the finished site, and a photo's download
 * endpoint is pinged when it is actually used — at publish, for the
 * pictures that really made it in, not for everything a search returned.
 */

// a short, stable key for a picture url
function picKey(url) {
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h * 33) ^ url.charCodeAt(i)) >>> 0;
  return 'pic:' + h.toString(36);
}

function unsplashUrl(env, path, params) {
  const u = new URL('https://api.unsplash.com' + path);
  Object.keys(params || {}).forEach((k) => u.searchParams.set(k, params[k]));
  return u.toString();
}

const utm = (env) => `utm_source=${encodeURIComponent(cfg(env, 'UNSPLASH_APP_NAME'))}&utm_medium=referral`;

async function pictureLimit(env, req) {
  if (!env.RATE) return null;
  const now = new Date().toISOString();
  const day = now.slice(0, 10), hour = now.slice(0, 13);
  const perHour = parseInt(cfg(env, 'PICTURES_HOURLY_LIMIT'), 10);
  if (perHour) {
    const key = `ph:${hour}`;
    const n = parseInt((await env.RATE.get(key)) || '0', 10);
    if (n >= perHour) return 'The picture library has had its hour’s worth — carry on without pictures, or try again shortly.';
    await bump(env, key, { next: n + 1 });
  }
  const perIp = parseInt(cfg(env, 'PICTURES_DAILY_LIMIT'), 10);
  if (perIp) {
    const ip = req && req.headers ? (req.headers.get('cf-connecting-ip') || 'unknown') : 'unknown';
    const key = `pd:${day}:${ip}`;
    const n = parseInt((await env.RATE.get(key)) || '0', 10);
    if (n >= perIp) return 'That is today’s picture searching for this address — carry on without pictures.';
    await bump(env, key, { next: n + 1 });
  }
  return null;
}

async function findPictures(env, req, query, count, orientation) {
  if (!env.UNSPLASH_ACCESS_KEY) {
    return { ok: false, pictures: [], note: 'No picture library is connected, so build the site without pictures — leave image out rather than inventing a URL.' };
  }
  const capped = await pictureLimit(env, req);
  if (capped) return { ok: false, pictures: [], note: capped };
  const want = Math.max(1, Math.min(10, +count || parseInt(cfg(env, 'PICTURES_PER_SEARCH'), 10)));
  const params = { query: String(query || '').slice(0, 120), per_page: String(want), content_filter: 'high' };
  if (['landscape', 'portrait', 'squarish'].includes(orientation)) params.orientation = orientation;
  let data;
  try {
    const res = await fetch(unsplashUrl(env, '/search/photos', params), {
      headers: { Authorization: 'Client-ID ' + env.UNSPLASH_ACCESS_KEY, 'accept-version': 'v1' },
    });
    if (!res.ok) {
      // say WHICH refusal: a rejected key and a spent hourly allowance look
      // identical from the outside and need opposite fixes
      let why = '';
      try {
        const body = await res.text();
        const parsed = JSON.parse(body);
        why = Array.isArray(parsed.errors) ? parsed.errors.join('; ') : body.slice(0, 120);
      } catch (e) {}
      const limited = res.status === 403 && /rate limit/i.test(why);
      return {
        ok: false,
        pictures: [],
        status: res.status,
        why: why || null,
        note: limited
          ? 'The picture library is rate limited just now — carry on without pictures.'
          : `The picture library refused the request (${res.status}${why ? ': ' + why : ''}) — carry on without pictures.`,
      };
    }
    data = await res.json();
  } catch (e) {
    return { ok: false, pictures: [], note: 'The picture library could not be reached — carry on without pictures.' };
  }
  const results = (data && data.results) || [];
  const pictures = results.map((p) => ({
    // a fixed width keeps the page light and the URL stable
    url: p.urls && p.urls.raw ? p.urls.raw + '&w=1600&q=80&fm=jpg&fit=max' : (p.urls && p.urls.regular),
    alt: (p.alt_description || p.description || String(query)).slice(0, 140),
    colour: p.color || null,
    by: (p.user && p.user.name) || 'Unknown',
    by_link: (p.user && p.user.links && p.user.links.html) || 'https://unsplash.com',
  })).filter((p) => p.url);
  // remember where each picture's download ping goes, keyed by the very url we
  // hand out, so publishing can look it up directly instead of scanning
  if (env.SITES) {
    await Promise.all(pictures.map(async (pic, i) => {
      const loc = results[i] && results[i].links && results[i].links.download_location;
      if (!loc) return;
      try { await env.SITES.put(picKey(pic.url), JSON.stringify({ url: pic.url, loc }), { expirationTtl: 86400 }); } catch (e) {}
    }));
  }
  return {
    ok: pictures.length > 0,
    pictures,
    note: pictures.length
      ? 'Use the url as-is. Put every photographer you use in the definition’s credits, as { name, link } from by and by_link. colour is the photo’s own dominant colour — a good accent, or a base to build the palette from.'
      : 'Nothing matched that search — try plainer words, or carry on without pictures.',
  };
}

// the pictures a definition really uses, told to Unsplash as their terms ask
async function pingPictureUse(env, def) {
  if (!env.UNSPLASH_ACCESS_KEY || !env.SITES) return;
  const used = new Set();
  const walk = (v) => {
    if (!v) return;
    if (typeof v === 'string') { if (/^https:\/\/images\.unsplash\.com\//.test(v)) used.add(v); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === 'object') Object.keys(v).forEach((k) => walk(v[k]));
  };
  walk(def);
  if (!used.size) return;
  await Promise.all([...used].slice(0, 40).map(async (url) => {
    let row = null;
    try { row = JSON.parse(await env.SITES.get(picKey(url))); } catch (e) {}
    if (!row || !row.loc) return;
    try {
      await fetch(row.loc + (row.loc.indexOf('?') === -1 ? '?' : '&') + utm(env), {
        headers: { Authorization: 'Client-ID ' + env.UNSPLASH_ACCESS_KEY },
      });
    } catch (e) {}
  }));
}

/* --------------------------------------------------- the front door */
/*
 * The connector needs an AI app and a paid plan. The people this is for
 * are starting out (James: "will users have to do this?"), so the same
 * three tools are wired to a page anyone can open: describe a site, get
 * a link. The key stays here, the caps stay here, and the model's tool
 * calls run in this process — no second hop.
 */

const BUILD_TOOLS = [
  {
    name: 'find_pictures',
    description: 'Search real photographs to use in the site. Call it while drafting, with plain words for what should be in the picture. Returns urls to use as-is, the photographer to credit, and each photo’s dominant colour.',
    input_schema: { type: 'object', properties: {
      query: { type: 'string', description: 'What should be in the picture, in plain words.' },
      count: { type: 'number', description: '1 to 10. Default 6.' },
      orientation: { type: 'string', enum: ['landscape', 'portrait', 'squarish'] },
    }, required: ['query'] },
  },
  {
    name: 'check_site',
    description: 'Check a draft site definition. Returns ok, the problems to fix, and a short summary. Always check before publishing.',
    input_schema: { type: 'object', properties: { definition: { type: 'object', description: 'The site definition.' } }, required: ['definition'] },
  },
  {
    name: 'publish_site',
    description: 'Publish a checked definition and get the link that builds the site in the person’s browser.',
    input_schema: { type: 'object', properties: { definition: { type: 'object', description: 'The site definition.' } }, required: ['definition'] },
  },
];

function buildPrompt() {
  return `You are gogh, and you make someone a real WordPress website while they chat with you. Many of the people you talk to have never made a website. Some are nervous about it.

How to behave:
- Warm, plain and brief. Two or three sentences a turn. No jargon, no marketing voice, no lists of options unless you are asking a question.
- Ask at most three short questions before you build: what the site is for, what it is called, and what they want people to do when they arrive. If they have already said enough, ask nothing and build.
- If they share a screenshot or a mockup, look at it properly and rebuild what it shows: the order of the parts, the shape of the page, the mood, the colours. Describe a band when the arrangement matters — four columns across, a picture beside the words — and use the nearest ready-made design — you are matching the arrangement, not tracing it — and say in a sentence what you took from it. Use words from the picture only when they are plainly the person's own; otherwise write fresh words for their site. Never copy a logo or a brand mark.
- Vary the shape. Not every site is a cover, three cards and a call to action: a restaurant wants its menu, a photographer a wall of pictures, a studio a piece of work shown properly, a shop the numbers that prove it. Use the card moods where they suit.
- Never show JSON, field names, take names or code to the person. They should never see the machinery. Say "your home page" and "the part about what you do", not "the Cover take".
- Write the site's words yourself, in their voice, using the facts they gave you. Never lorem ipsum, never invented prices, never invented testimonials attributed to named strangers — if you need a quote, keep it plainly generic or leave that part out.
- Find real photographs with find_pictures and use them — a site with pictures looks a world better than one without. Search by what should be in the shot, in plain words. One search of six usually covers a site. Put every photographer you use in credits, and build the palette around the hero photo's own colour.
- Build a small, complete site: usually a home page, an about page, a contact page, and a journal with two or three short posts if it suits them.
- Call check_site, fix anything it names, then call publish_site. Then give them the link on its own line and say it takes about a minute to build itself and that nothing is installed.
- After that, offer one or two concrete changes you could make ("I can make it warmer, or add your opening hours"). When they ask for a change, edit the site and publish again, then give the new link.
- If they ask what happens to the site, or how to keep it: it lives in their browser for 30 days at that link, and the site itself has a "Move to WordPress.com" item in its WordPress menu that walks them through taking it somewhere permanent. Say that plainly, and do not promise that the move will work on a free plan.
- If something fails, say so plainly in one sentence and suggest what to try.

${rulesText()}`;
}

// a screenshot is heavy, and only the newest one is worth carrying: older
// ones become a note, so a long conversation cannot drag megabytes behind it
function stripImages(messages) {
  return messages.map((m) => {
    if (!m || !Array.isArray(m.content)) return m;
    let hit = false;
    const content = m.content.map((c) => {
      if (c && c.type === 'image') { hit = true; return { type: 'text', text: '[a screenshot they shared earlier]' }; }
      return c;
    });
    return hit ? Object.assign({}, m, { content }) : m;
  });
}

function trimBuildHistory(messages) {
  // the whole conversation, tool calls and all, rides with each turn; drop
  // the oldest turns when it gets heavy so a long chat cannot run away
  let out = messages.slice();
  const size = () => new TextEncoder().encode(JSON.stringify(out)).length;
  while (out.length > 4 && size() > 120 * 1024) out = out.slice(2);
  return out;
}

async function buildLimit(env, req) {
  if (!env.RATE) return null;
  const day = new Date().toISOString().slice(0, 10);
  const perIp = parseInt(cfg(env, 'BUILD_DAILY_LIMIT'), 10);
  const global = parseInt(cfg(env, 'GLOBAL_DAILY_LIMIT'), 10);
  if (global) {
    const gKey = `g:${day}`;
    const g = parseInt((await env.RATE.get(gKey)) || '0', 10);
    if (g >= global) return 'gogh has hit its daily limit for everyone — it resets tomorrow.';
    await bump(env, gKey, { next: g + 1 });
  }
  if (perIp) {
    const ip = req.headers.get('cf-connecting-ip') || 'unknown';
    const key = `b:${day}:${ip}`;
    const n = parseInt((await env.RATE.get(key)) || '0', 10);
    if (n >= perIp) return 'That is today’s limit for this address. Come back tomorrow, or open the link you already have.';
    await bump(env, key, { next: n + 1 });
  }
  return null;
}

async function askModel(env, messages) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: cfg(env, 'MODEL'),
      max_tokens: 8000,
      system: buildPrompt(),
      tools: BUILD_TOOLS,
      messages,
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    let msg = detail.slice(0, 300);
    try { msg = JSON.parse(detail).error.message; } catch (e) {}
    if (res.status === 401 || res.status === 403) msg = 'the Worker’s API key was rejected';
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function handleBuildChat(req, env, ctx) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'This gogh is not set up to build sites yet (no API key).' }, 500);

  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'invalid JSON' }, 400); }
  const said = typeof body.text === 'string' ? body.text.trim() : '';
  if (!said || said.length > 4000) return json({ error: 'Say a little about the site you want (up to 4000 characters).' }, 400);

  const limited = await buildLimit(env, req);
  if (limited) return json({ error: limited }, 429);

  const pic = body.image && typeof body.image === 'object' ? body.image : null;
  if (pic && (!/^image\/(png|jpeg|webp|gif)$/.test(String(pic.media_type || '')) || typeof pic.data !== 'string' || !pic.data.length || pic.data.length > 1600 * 1024)) {
    return json({ error: 'I could not read that picture. A screenshot under about a megabyte works best.' }, 400);
  }

  let messages = Array.isArray(body.messages) ? body.messages : [];
  if (new TextEncoder().encode(JSON.stringify(messages)).length > 200 * 1024) {
    return json({ error: 'This conversation has grown too long — start a new one and I will be quicker.' }, 400);
  }
  messages = trimBuildHistory(stripImages(messages)).concat([{
    role: 'user',
    content: pic
      ? [{ type: 'image', source: { type: 'base64', media_type: pic.media_type, data: pic.data } }, { type: 'text', text: said }]
      : said,
  }]);

  // Writing a whole site takes the best part of a minute, and a page that
  // says nothing for that long reads as broken (James: "could we have some
  // feedback whilst the playground is being built"). So the turn streams
  // what it is actually doing — not a guess, the real step.
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = (obj) => writer.write(enc.encode('data: ' + JSON.stringify(obj) + '\n\n'));

  const run = (async () => {
    let published = null;
    try {
      for (let turn = 0; turn < 6; turn++) {
        await send({ type: 'step', text: turn === 0 ? (pic ? 'Looking at your screenshot' : 'Thinking') : 'Nearly there' });
        const r = await askModel(env, messages);
        const calls = (r.content || []).filter((c) => c.type === 'tool_use');
        messages = messages.concat([{ role: 'assistant', content: r.content }]);
        if (!calls.length) {
          const text = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
          await send({ type: 'reply', text: text || 'I am not sure what to make of that — tell me a little more?', messages: stripImages(messages), published });
          return;
        }
        const results = [];
        for (const c of calls) {
          let out;
          if (c.name === 'find_pictures') {
            await send({ type: 'step', text: 'Looking for pictures' });
            out = await findPictures(env, req, c.input && c.input.query, c.input && c.input.count, c.input && c.input.orientation);
          } else if (c.name === 'check_site') {
            await send({ type: 'step', text: 'Checking it over' });
            out = checkDefinition(c.input && c.input.definition);
          } else if (c.name === 'publish_site') {
            await send({ type: 'step', text: 'Publishing your site' });
            out = await publishSite(env, req, c.input && c.input.definition);
            if (out.ok) published = { url: out.playground_url, id: out.id, summary: out.summary, days: out.expires_in_days };
          } else {
            out = { ok: false, problems: ['Unknown tool.'] };
          }
          results.push({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out).slice(0, 8000) });
        }
        messages = messages.concat([{ role: 'user', content: results }]);
      }
      await send({ type: 'reply', text: 'That took more steps than I expected. Tell me the site again in a sentence and I will go straight at it.', messages: stripImages(messages), published });
    } catch (e) {
      await send({ type: 'error', error: e.message || 'Something went wrong talking to the model.' });
    } finally {
      try { await writer.close(); } catch (e) {}
    }
  })();
  if (ctx && ctx.waitUntil) ctx.waitUntil(run);

  return new Response(readable, {
    headers: Object.assign({
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    }, CORS),
  });
}

const BUILD_UI = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Make a website — gogh</title>
<style>
  :root { --paper: #faf9f6; --ink: #1a1916; --soft: #6d6a63; --line: #e6e2da; --accent: #b4523a; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink);
    font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 28px 20px 140px; }
  header h1 { font: 700 30px/1.15 Georgia, "Iowan Old Style", serif; margin: 0 0 6px; letter-spacing: -0.01em; }
  header p { margin: 0 0 26px; color: var(--soft); }
  .msg { margin: 0 0 16px; white-space: pre-wrap; }
  .msg.you { text-align: right; }
  .msg.you span { display: inline-block; background: #ece7dd; padding: 10px 14px; border-radius: 16px 16px 4px 16px; text-align: left; max-width: 85%; }
  .msg.gogh span { display: inline-block; max-width: 92%; }
  .site { border: 1px solid var(--line); background: #fff; border-radius: 16px; padding: 20px; margin: 4px 0 18px; }
  .site b { display: block; font: 700 17px/1.3 Georgia, serif; margin-bottom: 4px; }
  .site small { color: var(--soft); display: block; margin-bottom: 14px; }
  .site a { display: inline-block; background: var(--ink); color: #fff; text-decoration: none;
    padding: 12px 20px; border-radius: 999px; font-weight: 600; }
  .site a:hover { background: var(--accent); }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 20px; }
  .chips button { background: #fff; border: 1px solid var(--line); border-radius: 999px;
    padding: 9px 15px; font: inherit; font-size: 14px; cursor: pointer; color: var(--ink); }
  .chips button:hover { border-color: var(--ink); }
  .dots { color: var(--soft); font-style: italic; }
  .err { color: var(--accent); }
  .bar { position: fixed; left: 0; right: 0; bottom: 0; background: linear-gradient(to top, var(--paper) 72%, transparent); padding: 18px 20px 22px; }
  .bar form { max-width: 720px; margin: 0 auto; display: flex; gap: 10px; align-items: center; }
  .clip { flex: none; width: 46px; height: 46px; border: 1px solid var(--line); border-radius: 50%;
    background: #fff; display: grid; place-items: center; cursor: pointer; font-size: 19px; color: var(--soft); }
  .clip:hover { border-color: var(--ink); color: var(--ink); }
  .shot { max-width: 720px; margin: 0 auto 8px; display: none; align-items: center; gap: 10px; font-size: 13px; color: var(--soft); }
  .shot img { width: 44px; height: 44px; object-fit: cover; border-radius: 8px; border: 1px solid var(--line); }
  .shot button { border: 0; background: none; color: var(--soft); cursor: pointer; font: inherit; text-decoration: underline; padding: 0; }
  .msg.you img { max-width: 220px; border-radius: 12px; display: block; margin: 0 0 6px auto; border: 1px solid var(--line); }
  .dropping { outline: 2px dashed var(--accent); outline-offset: -8px; }
  .bar input { flex: 1; font: inherit; padding: 14px 18px; border: 1px solid var(--line);
    border-radius: 999px; background: #fff; color: var(--ink); min-width: 0; }
  .bar input:focus { outline: 2px solid var(--ink); outline-offset: -1px; }
  .bar button { font: inherit; font-weight: 600; padding: 14px 22px; border: 0; border-radius: 999px;
    background: var(--ink); color: #fff; cursor: pointer; }
  .bar button:disabled { opacity: 0.4; cursor: default; }
  footer { color: var(--soft); font-size: 13px; margin-top: 30px; }
  footer a { color: var(--soft); }
</style>
</head><body>
<div class="wrap">
  <header>
    <h1>Make a website</h1>
    <p>Tell me what it is for. I will build it and give you a link — nothing to install.</p>
  </header>
  <div class="chips" id="chips">
    <button>A florist in Bath</button>
    <button>A photographer's portfolio</button>
    <button>A cafe with a menu</button>
    <button>A plumber taking bookings</button>
  </div>
  <p id="hint" style="color:var(--soft);font-size:14px;margin:-10px 0 22px">Or drop in a screenshot of a design you like, and I will build something like it.</p>
  <div id="thread"></div>
  <footer>Your site is built in your own browser and kept for 30 days. It comes with a <b>Move to WordPress.com</b> option for taking it somewhere permanent. <a href="/">Questions about gogh?</a></footer>
</div>
<div class="bar">
  <div class="shot" id="shot"><img id="shot-img" alt=""><span>Screenshot attached — I will build from it.</span><button type="button" id="shot-drop">Remove</button></div>
  <form id="f">
    <label class="clip" title="Attach a screenshot or mockup">＋<input type="file" id="file" accept="image/*" hidden></label>
    <input id="q" autocomplete="off" placeholder="A florist in Bath, warm and simple…" aria-label="Describe your site">
    <button id="go" type="submit">Send</button>
  </form>
</div>
<script>
(function () {
  var thread = document.getElementById('thread');
  var chips = document.getElementById('chips');
  var form = document.getElementById('f');
  var input = document.getElementById('q');
  var go = document.getElementById('go');
  var state = [];
  var busy = false;
  var shot = null; // the screenshot waiting to go with the next message
  var fileIn = document.getElementById('file');
  var shotBox = document.getElementById('shot');
  var shotImg = document.getElementById('shot-img');

  // shrink before sending: a screenshot off a big display is many megabytes,
  // and the long edge is all the detail that is needed to read a layout
  function shrink(file) {
    return new Promise(function (ok, no) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1400, s = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * s));
        c.height = Math.max(1, Math.round(img.height * s));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        var out = c.toDataURL('image/jpeg', 0.78);
        ok({ media_type: 'image/jpeg', data: out.slice(out.indexOf(',') + 1), preview: out });
      };
      img.onerror = function () { URL.revokeObjectURL(url); no(new Error('not a picture')); };
      img.src = url;
    });
  }
  function takeShot(file) {
    if (!file || file.type.indexOf('image/') !== 0) return;
    shrink(file).then(function (s) {
      shot = s;
      shotImg.src = s.preview;
      shotBox.style.display = 'flex';
      document.getElementById('q').focus();
    }).catch(function () {});
  }
  function clearShot() { shot = null; shotBox.style.display = 'none'; shotImg.removeAttribute('src'); }
  fileIn.addEventListener('change', function () { if (fileIn.files[0]) takeShot(fileIn.files[0]); fileIn.value = ''; });
  document.getElementById('shot-drop').addEventListener('click', clearShot);
  document.addEventListener('paste', function (ev) {
    var items = (ev.clipboardData && ev.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) if (items[i].type.indexOf('image/') === 0) { takeShot(items[i].getAsFile()); return; }
  });
  ['dragenter', 'dragover'].forEach(function (t) {
    document.addEventListener(t, function (ev) { ev.preventDefault(); document.body.classList.add('dropping'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    document.addEventListener(t, function (ev) { ev.preventDefault(); if (t === 'drop' && ev.dataTransfer && ev.dataTransfer.files[0]) takeShot(ev.dataTransfer.files[0]); document.body.classList.remove('dropping'); });
  });

  function el(cls, text) { var d = document.createElement('div'); d.className = cls; if (text != null) { var s = document.createElement('span'); s.textContent = text; d.appendChild(s); } return d; }
  function scroll() { window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }
  function say(who, text) { thread.appendChild(el('msg ' + who, text)); scroll(); }
  function site(pub) {
    var box = document.createElement('div');
    box.className = 'site';
    var b = document.createElement('b'); b.textContent = 'Your site is ready';
    var s = document.createElement('small'); s.textContent = 'It builds itself in your browser in about a minute. The link works for ' + pub.days + ' days.';
    var a = document.createElement('a'); a.href = pub.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Open my site';
    box.appendChild(b); box.appendChild(s); box.appendChild(a);
    thread.appendChild(box); scroll();
  }

  function send(text) {
    if (busy || (!text && !shot)) return;
    if (!text) text = 'Build me something like this.';
    busy = true; go.disabled = true; chips.style.display = 'none';
    var hint = document.getElementById('hint');
    if (hint) hint.style.display = 'none';
    var mine = el('msg you', text);
    if (shot) { var t = document.createElement('img'); t.src = shot.preview; mine.firstChild.parentNode.insertBefore(t, mine.firstChild); }
    thread.appendChild(mine); scroll();
    var sending = shot ? { media_type: shot.media_type, data: shot.data } : null;
    clearShot();
    input.value = '';
    var waiting = el('msg gogh'); var w = document.createElement('span');
    w.className = 'dots'; waiting.appendChild(w); thread.appendChild(waiting); scroll();

    // the step comes from the Worker; the seconds are ours, so the line keeps
    // moving even while one long step runs
    var step = sending ? 'Looking at your screenshot' : 'Thinking', began = Date.now(), done = false;
    var paint = function () {
      var secs = Math.round((Date.now() - began) / 1000);
      w.textContent = step + '…' + (secs > 2 ? ' ' + secs + 's' : '');
    };
    paint();
    var tick = setInterval(paint, 1000);
    var stop = function () { done = true; clearInterval(tick); waiting.remove(); busy = false; go.disabled = false; input.focus(); };
    var fail = function (msg) { if (done) return; stop(); var e = el('msg gogh', msg); e.firstChild.className = 'err'; thread.appendChild(e); scroll(); };

    var seen = false;
    var handle = function (ev) {
      // the count runs for the whole turn, not per step: what someone wants to
      // know is how long they have been waiting altogether
      if (ev.type === 'step') { step = ev.text; paint(); scroll(); return; }
      if (ev.type === 'error') { fail(ev.error || 'Something went wrong. Try again?'); return; }
      if (ev.type === 'reply') {
        seen = true; stop();
        if (Array.isArray(ev.messages)) state = ev.messages;
        if (ev.text) say('gogh', ev.text);
        if (ev.published) site(ev.published);
      }
    };

    fetch('/api/build', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: text, messages: state, image: sending }),
    }).then(function (r) {
      var kind = r.headers.get('content-type') || '';
      if (kind.indexOf('text/event-stream') === -1 || !r.body) {
        return r.json().then(function (d) { fail(d.error || 'Something went wrong. Try again?'); });
      }
      var reader = r.body.getReader(), dec = new TextDecoder(), buf = '';
      var pump = function () {
        return reader.read().then(function (res) {
          if (res.done) { if (!seen && !done) fail('That did not finish. Try again?'); return; }
          buf += dec.decode(res.value, { stream: true });
          var blocks = buf.split('\\n\\n');
          buf = blocks.pop();
          blocks.forEach(function (block) {
            var line = block.split('\\n').filter(function (l) { return l.indexOf('data: ') === 0; }).map(function (l) { return l.slice(6); }).join('');
            if (!line) return;
            var ev = null;
            try { ev = JSON.parse(line); } catch (e) {}
            if (ev) handle(ev);
          });
          return pump();
        });
      };
      return pump();
    }).catch(function () { fail('I could not reach gogh just then. Try again?'); });
  }

  form.addEventListener('submit', function (ev) { ev.preventDefault(); send(input.value.trim()); });
  chips.addEventListener('click', function (ev) { if (ev.target.tagName === 'BUTTON') send(ev.target.textContent); });
  input.focus();
})();
</script>
</body></html>`;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (url.pathname === '/mcp') return handleMcp(req, env);
    if (url.pathname === '/api/build') return handleBuildChat(req, env, ctx);
    if (url.pathname === '/build' || url.pathname === '/build/') {
      return new Response(BUILD_UI, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' } });
    }
    const site = url.pathname.match(/^\/(d|b)\/([a-z0-9]+)\.json$/);
    if (site) {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      return handleSiteFile(req, env, site[1], site[2]);
    }

    if (url.pathname === '/api/chat') {
      if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
      return handleChat(req, env);
    }

    if (url.pathname === '/api/meta') {
      try {
        const kb = await getKB(env);
        return json(
          {
            pluginVersion: kb.pluginVersion,
            kbId: kb.kbId,
            kbBytes: kb.bytes,
            model: cfg(env, 'MODEL'),
            fetchedAt: new Date(kb.fetchedAt).toISOString(),
            rateLimited: !!env.RATE,
            askedToday: await usageToday(env),
            globalDailyLimit: env.RATE ? parseInt(cfg(env, 'GLOBAL_DAILY_LIMIT'), 10) : null,
            counterErrors,
          },
          200,
          { 'cache-control': 'no-store' }
        );
      } catch (e) {
        return json({ error: e.message }, 502);
      }
    }

    // Called by the release workflow so a new KB goes live immediately
    // instead of waiting out the TTL.
    if (url.pathname === '/api/refresh') {
      const token = req.headers.get('x-refresh-token') || url.searchParams.get('token');
      if (!env.REFRESH_TOKEN || token !== env.REFRESH_TOKEN) {
        return json({ error: 'unauthorised' }, 401);
      }
      memo = null;
      try {
        const kb = await getKB(env, { force: true });
        return json({ ok: true, pluginVersion: kb.pluginVersion, kbId: kb.kbId, bytes: kb.bytes });
      } catch (e) {
        return json({ error: e.message }, 502);
      }
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(UI, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'public, max-age=300',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
        },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};

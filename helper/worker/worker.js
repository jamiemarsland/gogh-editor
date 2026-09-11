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
  posts: [ { title, text (plain paragraphs separated by blank lines), image } ] }
\`\`\`
Rules: 1 to 8 pages, up to 10 sections a page, the front page first. Headings are short (2 to 7 words). Texts are one to three plain sentences. Buttons are two or three words. An eyebrow is a tiny label above the heading ("Bath · since 2014"). \`mood\` on card takes is one of still, lift, zoom, veil, glass. Pictures are optional: use URLs the person gave you; otherwise leave \`image\` out, or use one of gogh's own, below. Never invent picture URLs.

## Gogh's own pictures
${PICTURE_PATHS.map((k) => `- \`${k}\` — ${OWN_PICTURES[k]}`).join('\n')} Write in the person's own voice and facts; never lorem ipsum.

## The takes
${takes}

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
      const t = TAKES[sc.take];
      if (!t) { bad(`${where}: unknown take "${sc.take}". Use one of: ${Object.keys(TAKES).join(', ')}.`); return; }
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
  return {
    $schema: 'https://playground.wordpress.net/blueprint-schema.json',
    landingPage: '/?gogh-edit=1&gogh-build=1',
    preferredVersions: { php: '8.2', wp: 'latest' },
    features: { networking: true },
    login: true,
    steps: [
      { step: 'installTheme', themeData: { resource: 'wordpress.org/themes', slug: 'twentytwentyfive' }, options: { activate: true } },
      { step: 'installPlugin', pluginData: { resource: 'url', url: cfg(env, 'PLUGIN_ZIP_URL') }, options: { activate: true } },
      { step: 'runPHP', code: php },
      { step: 'setSiteOptions', options: { blogname: String(def.name || 'My site'), blogdescription: String(def.tagline || '') } },
    ],
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

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === '/mcp') return handleMcp(req, env);
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

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
 */

const UI = __UI__;
const PROMPT = __PROMPT__;

const DEFAULTS = {
  KB_URL: 'https://raw.githubusercontent.com/jamiemarsland/gogh-editor/main/helper/gogh-kb.md',
  MODEL: 'claude-sonnet-4-5',
  MAX_TOKENS: '1400',
  KB_TTL_SECONDS: '600',
  MAX_TURNS: '24',
  DAILY_LIMIT: '25',
  GLOBAL_DAILY_LIMIT: '400',
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
    res = await fetch(url, { cf: { cacheTtl: ttl, cacheEverything: true } });
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

function contextNote(ctx) {
  // The plugin links here with ?v=<version>, so the bot knows which release the
  // person is actually running rather than assuming the newest.
  if (!ctx || typeof ctx !== 'object') return '';
  const bits = [];
  if (typeof ctx.pluginVersion === 'string' && /^[\d.]{1,12}$/.test(ctx.pluginVersion)) {
    bits.push(`They are running Gogh ${ctx.pluginVersion}. If that differs from the version in the knowledge base, say so when it matters to the answer.`);
  }
  if (ctx.from === 'editor') {
    bits.push('They opened this from inside the Gogh editor, so they are mid-task. Lead with the action.');
  }
  return bits.length ? '\n\nABOUT THIS PERSON\n\n' + bits.join('\n') : '';
}

function systemBlocks(kb, mode, ctx) {
  const note = PROMPT.modes[mode] || PROMPT.modes.auto;
  return [
    { type: 'text', text: PROMPT.persona + '\n\n' + note + contextNote(ctx) },
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

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

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

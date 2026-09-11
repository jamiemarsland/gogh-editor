# Gogh Helper

A support bot for Gogh Editor that answers both "where do I click" and "how does the grid solver work" — and keeps up with releases on its own.

Drop this folder in the plugin root as `helper/`, and `kb.yml` in `.github/workflows/`.

There are two builds, both generated from one `template.html`:

| | |
|---|---|
| **Standalone** — `gogh-helper.html` | KB inlined, visitor supplies their own API key. For local testing. |
| **Hosted** — `worker/` | A Cloudflare Worker holds the key and fetches the KB from GitHub at runtime. Safe to put on a public URL, and it follows releases with no redeploy. |

## Try it

Open `gogh-helper.html`, click ⚙, paste an Anthropic API key. The model list loads from the API; a Sonnet is picked by default. The key is held in memory only — nothing stored, gone on reload.

Three answer modes: **Auto** (judges the register from the question — this is the one that matters for production), **Beginner** (no jargon, no code), **Developer** (straight to mechanism).

## The maintenance problem, and the shape of the fix

A help bot's real cost isn't building it, it's the day it starts confidently describing a button you renamed six releases ago. So the knowledge base is split in two:

**`kb.prose.md` — hand-written.** Explains how Gogh works and *why*: the solver, the reconciliation model, the security reasoning, the deliberate constraints. This is the part that makes the bot useful rather than a search index, and it's the part a script can't write. It changes slowly.

**`kb.facts.md` — generated, never hand-edited.** Extracted from source on every release: version, design constants, every UI label and toast string verbatim, template names, shape and divider keys, the WebMCP tool signatures, the `__gogh` API surface, hooks, REST routes, capability checks, element types, test count.

The final KB is prose + appendix, with a header telling the model **the appendix wins on conflict**. That's the property that makes auto-update safe: the facts can regenerate unattended without ever contradicting themselves, because the volatile half is machine-derived and the half that lags is explicitly ranked lower.

So a stale prose paragraph degrades the bot's *explanations*, never its *facts*.

## The connector: chat to an AI, get a blueprint

The Worker is also a remote MCP server at `/mcp`, so anyone can add it to Claude Desktop (or another assistant that speaks MCP) and say "build me a WordPress site for my florist". Three tools:

| | |
|---|---|
| `gogh_rules` | how a site definition works: the takes, their fields, the writing rules, a complete example |
| `gogh_check` | validates a draft and returns the problems by page and section, plus a summary |
| `gogh_publish` | stores the definition and returns a Playground link that builds the site in the browser in about a minute |

The AI writes content and choices, never layout: the editor draws the definition with gogh's tested takes on first load (`?gogh-edit=1&gogh-build=1`). A published site serves `/d/<id>.json` (the definition) and `/b/<id>.json` (the blueprint, which installs gogh from `PLUGIN_ZIP_URL` and boots from the definition). Definitions live in the `SITES` KV namespace for `SITE_TTL_DAYS`; `PUBLISH_DAILY_LIMIT` caps one address's publishes a day. No AI key is spent here — the person's own assistant does the composing.

Test it: `node helper/worker/test-mcp.mjs` (after `python3 helper/refresh.py`). To add it in Claude Desktop: Settings → Connectors → Add custom connector → URL `https://<your-worker>/mcp`.

## Running it

```
python3 helper/refresh.py
```

Extract → build → audit, in one go.

| Exit | Meaning |
|---|---|
| `0` | Clean. Facts regenerated, prose agrees with the source. |
| `1` | Facts regenerated, prose has drifted. The bot is still correct — someone should tidy the prose. |
| `2` | The extractor broke. A refactor moved something it anchors on, so facts are **missing** from the appendix. Fix `extract.py`. |

Only `2` should ever fail a release.

The individual scripts also run standalone: `extract.py` (source → facts), `build.py` (prose + facts → KB → HTML), `audit.py` (drift report → `kb.audit.md`).

## What the audit catches

`audit.py` compares the prose against the current facts, **and** diffs this build's facts against the last committed `kb.facts.json` via git. That diff is what makes rename detection possible — a removed tool or a reworded button is invisible to anything that only looks at the current source.

Four tiers:

- **DRIFT** — prose states a value the source contradicts (a constant, the version).
- **STALE** — prose names something that no longer exists, or describes something removed in this release.
- **MISSING** — source has something the prose never explains. The bot knows the name from the appendix but can't say what it's for.
- **QUOTE** — prose quotes copy not found verbatim in source. Advisory; paraphrase is fine, changed UI copy isn't.

Plus a **"What changed since the last build"** changelog, which doubles as a sanity check on the release itself.

It was verified by mutating the source the way a real release would — bumping the version, retuning `SNAP`, slowing the autosave, rewording a tooltip, renaming a shape, renaming a WebMCP tool, renaming a filter — and confirming all seven surfaced, correctly paired as removed/added.

**`kb.audit-ignore.txt`** suppresses known-fine findings (deliberate paraphrases, our own FAQ headings, test-only API members). This matters more than it looks: a report that cries wolf on day one is a report nobody reads. Current state is zero findings with sixteen suppressed.

## Hosting it

Uploading `gogh-helper.html` to a server does **not** give you a self-updating bot. That file is a snapshot — the KB is baked in at build time — and its API key field is client-side, so putting your own key in it would hand it to anyone who views source. The Worker exists to solve both.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jamiemarsland/gogh-editor/tree/main/helper/worker)

One click. Cloudflare reads `worker/wrangler.jsonc`, provisions the KV namespace for rate limiting, prompts for your Anthropic key, and deploys. **[SETUP.md](SETUP.md)** is the full walkthrough — three steps, no terminal.

Prefer the CLI? `cd helper/worker && ./deploy.sh`, or **[DEPLOY.md](DEPLOY.md)** for the manual commands. — account setup, secrets, wiring CI, linking from the plugin, and what it costs.

You get `https://gogh-helper.<your-subdomain>.workers.dev` — linkable straight away, no domain needed.

**GitHub Pages can't host the public version.** Pages serves static files only, so it cannot hold an API key. It *can* host the bring-your-own-key build — `pages.yml` does that, and it auto-updates on each tag — but that only suits you and collaborators, not a link from the plugin.

### Before you link it from the plugin

A public link means every plugin user's questions are billed to your key. Three things bound that:

| | |
|---|---|
| `DAILY_LIMIT` | 25 questions per IP per day. Stops one person hammering it. |
| `GLOBAL_DAILY_LIMIT` | 400 questions per day in total. **This is the one that bounds the bill** — a per-IP limit does nothing against a thousand people politely asking twice each. |
| A spend limit on the Anthropic key | Do this too. It's the only real backstop: the caps above bound *requests*, not cost. |

Both live in `worker/wrangler.jsonc` and are sized for Cloudflare's **free** KV plan, which allows 1,000 writes/day. Each question spends two, so ~500/day is the practical ceiling. Past it the counters fail — the Worker keeps serving but stops enforcing, and `counterErrors` climbs in `/api/meta`. Workers Paid is $5/month and lifts the write limit if you get that popular.

`/api/meta` reports `rateLimited`, `askedToday`, `globalDailyLimit` and `counterErrors`, so you can watch it from outside without opening the dashboard. If it says `rateLimited: false`, the KV binding is missing and the endpoint is an open proxy — fix that before sharing the URL.



### Bridge mode — buttons that act on the page

With `?bridge=1` the helper is running inside the editor and can offer the user a button that performs the action rather than describing it. The bot emits a fenced ` ```gogh-act ` block containing `{label, verb, args}`; the page renders it as a button and `postMessage`s the verb to the parent frame, then waits for `{gogh:'act-result', id, ok, result|error}`.

Nothing across that boundary is trusted:

- **Verbs are whitelisted client-side.** Only the nine the editor exposes render at all. `gogh_publish` is refused here as well as by the editor, rather than relying on the editor to refuse it.
- **Replies must come from `window.parent`** and match a pending id. A message posted by any other source — including the page itself — is ignored.
- **Destructive verbs need two clicks.** `gogh_delete_section` arms first ("Sure? Delete section 2") and only fires on the second press. Everything else is single-click.
- **Nothing renders outside the editor.** A `gogh-act` block in the standalone build, or in a copied answer, produces no button at all.
- Requests time out after 15s rather than hanging on a button that says "Working…" forever.

The bridge instructions live in their own `## bridge` section of `prompt.md` and are only appended to the system prompt when `context.bridge === true`. Outside the editor the bot doesn't know buttons exist, so it can't promise one that won't appear.

`?ctx=` (`el-heading`, `chrome-cycle`, `panel`, `canvas`) says what the user is doing; the Worker maps it through a whitelist to a prompt line so the bot leads with something relevant. Unknown values are dropped.

The prompt tells the bot to offer a button **only when doing the thing beats explaining it** — someone asking "why does this work this way" doesn't want their page edited.

### Linking from the plugin

`plugin-link.php` adds a `?` button to the side palette footer, next to Undo/Redo. Set `GOGH_HELPER_URL` and it appears; leave it empty and the file is inert.

The link carries `?v=<plugin version>&from=editor`. The Worker turns that into a line in the system prompt, so the bot answers for the release the person is actually running rather than assuming the newest, and knows they're mid-task so it leads with the action. Junk values are dropped rather than passed through.

It opens in a new tab deliberately — the canvas may hold unpublished changes, and navigating away would trip the leave-confirmation.

The important part: **the Worker does not bundle the knowledge base.** It fetches `gogh-kb.md` from GitHub raw and caches it for ten minutes. The release workflow commits a regenerated KB to `main`, so a deployed bot picks up a new release on its own, within the TTL, with no deploy step at all. The Worker is infrastructure and changes rarely; the knowledge changes every release. Deploying only matters when the UI or the Worker code itself changed.

Routes: `/` the chat UI · `/api/meta` version and status · `/api/chat` the streaming proxy · `/api/refresh` forces a KB re-read (needs `REFRESH_TOKEN`, and CI calls it so a release goes live immediately rather than waiting out the TTL).

Two test suites, both runnable with no Cloudflare account:

```
cd helper/worker
node test-worker.mjs     # 24 checks: routing, validation, streaming, auth, KB wiring
node test-limits.mjs     # 13 checks: both caps, KV failure, usage reporting, plugin context
node test-bridge.mjs     # 8 checks: bridge prompt gating, ctx whitelist
node test-bridge-browser.mjs   # 18 checks: buttons, postMessage, confirm step, spoofing
node test-browser.mjs    # mounts the Worker on localhost and drives the real UI
```

They stub GitHub, KV and the Anthropic API, so they exercise the real Worker code against fake upstreams.

### If you'd rather not run infrastructure

GitHub Pages works too — have the Action publish `gogh-helper.html` on each tag. It auto-updates and costs nothing, but everyone still brings their own API key, so it only suits you and your team.

## CI

`kb.yml` does two things:

**On a `v*` tag** — regenerates from the tagged source, commits the result back to the default branch, attaches `gogh-helper.html` and `gogh-kb.md` to the GitHub release, and opens (or comments on) an issue if the prose drifted. It does **not** block the release on prose drift, because the appendix is authoritative. It *does* fail on exit 2.

**On a PR** touching plugin source — runs the same refresh and reports drift in the job summary. This is what makes the tag run boring: drift gets caught when the code changes, not months later. Delete that job if you'd rather only check at release.

The Worker deploy is optional and skipped unless `CLOUDFLARE_API_TOKEN` is set, so the workflow is safe to merge before you have a Worker. To wire it up: secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `HELPER_REFRESH_TOKEN`, and a repo variable `HELPER_URL`.

Two housekeeping items when you drop this in:

- Add `helper` to `.distignore` so it stays out of the shipped zip.
- Add `helper/__pycache__/` to `.gitignore`.

## When the extractor breaks

It will, eventually — that's the honest trade for not hand-maintaining 50 toast strings. `extract.py` anchors on distinctive code shapes (`if (nw < 60)`, `snap15 = Math.round(deg / 15)`), and a refactor can move them.

The failure is loud and safe: the value records as `null`, `extract.py` prints which anchors missed, `refresh.py` exits 2, and CI fails the run. It never guesses a wrong number. Fixing it is a one-line regex change, and the anchors are grouped in one list at the top of `constants()`.

## Integrating into the plugin

`GoghBot` in `template.html` is deliberately separable from the chat UI — prompt assembly plus transport, nothing else. The port:

**1. Move the key server-side.** The browser-direct call uses `anthropic-dangerous-direct-browser-access`, fine for local testing and must not ship. Add a route beside `gogh/v1/render`:

```php
register_rest_route( 'gogh/v1', '/help', array(
    'methods'             => 'POST',
    'permission_callback' => function () { return current_user_can( 'edit_posts' ); },
    'callback'            => 'gogh_help_proxy',
) );
```

Same nonce and `credentials: 'same-origin'` as everything else.

**2. Ship `gogh-kb.md` as a plugin file**, read server-side, so the client never downloads 70KB of prose. It's already regenerated on every release, so it's always current with the code it ships beside. `worker/worker.js` is a working reference for the proxy shape — validation, prompt-cache headers, streaming passthrough — just in JS rather than PHP.

**3. Give it page context.** This is where an in-product bot beats a docs page. `gogh_page_overview` already produces exactly the right summary — pass it as a user-turn preamble and the bot can answer "why is this section stacking wrong on mobile" instead of guessing. `__gogh.isDirty()`, `__gogh.build` and the theme name are cheap to add.

**4. Consider giving it hands.** The WebMCP tools are already a clean tool surface — and now `kb.facts.json` carries their signatures in machine-readable form, so the tool definitions can be generated rather than written twice. Turns "how do I add a hero section" into "want me to add one?". Bigger product decision; the read-only version should earn its place first.

**5. Where it lives.** A `?` next to Undo/Redo in the side palette, opening a panel rather than a modal so the canvas stays visible while reading.

## Files

| File | |
|---|---|
| `gogh-helper.html` | **Generated.** The standalone tester. |
| `gogh-kb.md` | **Generated.** Prose + appendix, what the bot consumes. |
| `kb.prose.md` | Hand-written. Edit this. |
| `kb.facts.md` / `.json` | **Generated.** Never edit. |
| `kb.audit.md` | **Generated.** The drift report. |
| `kb.audit-ignore.txt` | Known-fine findings. Edit freely. |
| `template.html` | Chat UI. Builds into both front ends. |
| `prompt.md` | The system prompt. Injected into both, so they can't disagree. |
| `worker/worker.js` | The hosted Worker. Edit this, not `dist/`. |
| `worker/wrangler.jsonc` | Deploy config, rate limits, model. Read by the deploy button. |
| `worker/.dev.vars.example` | Declares the secrets the button asks for. |
| `worker/dist/worker.js` | **Generated.** What actually deploys. |
| `worker/deploy.sh` | One-command deploy. |
| `SETUP.md` | Point-and-click setup, no terminal. **Start here.** |
| `DEPLOY.md` | Command-line setup and the GitHub Pages option. |
| `worker/test-*.mjs` | Worker, rate-limit and browser tests. |
| `plugin-link.php` | The `?` button in the side palette. |
| `extract.py` / `build.py` / `audit.py` / `refresh.py` | The pipeline. |

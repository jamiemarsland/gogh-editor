# Deploying the Gogh Helper (command line)

> **There is a one-click version.** [SETUP.md](SETUP.md) uses a Deploy to Cloudflare button that provisions everything and prompts for your API key — no terminal, three steps. This page is for people who'd rather drive it from the CLI.

## Can GitHub host it?

Partly, and it's worth being precise about why.

**GitHub Pages serves static files only.** No server-side code runs there. That means Pages can host the chat page, but it cannot hold your Anthropic API key — anything Pages serves is readable by anyone who views source. GitHub Actions can't serve it either; Actions is CI, it runs on a trigger and exits, it isn't a web server.

So:

| What you want | Can GitHub do it? |
|---|---|
| A bot **you and your team** use, each with your own API key | **Yes** — GitHub Pages, free, no other service. See the last section. |
| A bot **linked from the plugin** that anyone can use | **No** — that needs a key held server-side, which Pages cannot do. |

Since you want to link it from the plugin, you need something that can run code. The Worker below is the smallest version of that: free tier, one command, no server to maintain.

---

## Deploying the Worker — step by step

You need Node installed, and about ten minutes. A Cloudflare account is free and takes a minute to make.

### 1. Get the files onto your machine

If `helper/` is already committed to the repo:

```
git clone https://github.com/jamiemarsland/gogh-editor.git
cd gogh-editor
```

Otherwise unzip the kit so `helper/` sits in the plugin root, next to `gogh.php`.

### 2. Build

```
python3 helper/refresh.py
```

You should see four lines ending in `refresh: clean`. This generates `helper/worker/dist/worker.js`, which is what actually deploys. If it errors, stop here — the deploy needs that file.

### 3. Make a Cloudflare account

Sign up at [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up). You do **not** need to add a domain or a payment card. The free plan covers this: 100,000 Worker requests/day, and you get a `*.workers.dev` subdomain to link to.

### 4. Log in from the terminal

```
cd helper/worker
npx --yes wrangler@latest login
```

That opens a browser to authorise. Come back to the terminal when it says success.

### 5. Get an Anthropic API key

From [console.anthropic.com](https://console.anthropic.com) → API keys → Create key. Copy it; you'll paste it in the next step and it won't be shown again.

**While you're there, set a spend limit** (Billing → Limits). This is the real backstop. The Worker's rate limits bound *requests*; only a spend limit bounds *cost*. Start low — £10/month tells you a lot before it can hurt.

### 6. Run the deploy script

```
./deploy.sh
```

It walks through four steps and tells you what it's doing:

1. **Rate limiting** — confirms `wrangler.jsonc` declares the `RATE` namespace. Cloudflare provisions it on deploy; nothing to do.
2. **Secrets** — prompts for your Anthropic key (hidden input), then offers to generate a refresh token. Say yes to that too and **copy the token it prints** — you'll need it in step 8.
3. **Deploy** — uploads the Worker.
4. **Verify** — curls the live endpoint and prints the result.

It ends with `Live at https://gogh-helper.<your-subdomain>.workers.dev`. Open that in a browser and ask it something.

Re-running is safe: each step checks whether it's already done.

<details>
<summary>If you'd rather do it by hand</summary>

```
npx wrangler@latest secret put ANTHROPIC_API_KEY
npx wrangler@latest secret put REFRESH_TOKEN      # optional
npx wrangler@latest deploy
```

The KV namespace is declared in `wrangler.jsonc` without an id, so wrangler provisions it on first deploy and writes the id back. That needs wrangler 4.45 or newer — hence `@latest`.
</details>

### 7. Check the limits are actually on

```
curl https://gogh-helper.<your-subdomain>.workers.dev/api/meta
```

Look for `"rateLimited": true`. If it says `false`, the KV binding didn't take, and **the endpoint is an open proxy on your API key** — don't share the URL until that's fixed. Re-run `./deploy.sh` and let it create the namespace.

The same response shows `askedToday` and `counterErrors`, so you can check usage later without opening the dashboard.

### 8. Let releases update it automatically

In the GitHub repo, Settings → Secrets and variables → Actions:

- **Variables** tab → New variable → `HELPER_URL` = your Worker URL, no trailing slash
- **Secrets** tab → New secret → `HELPER_REFRESH_TOKEN` = the token from step 6

That's it. The Worker reads the knowledge base from GitHub at runtime, so a new release goes live on its own within ten minutes. These two just make it instant.

Optional, only if you want the Worker itself redeployed on release (needed when the UI or Worker code changes, not for knowledge updates): also add secrets `CLOUDFLARE_API_TOKEN` (dash → My Profile → API Tokens → *Edit Cloudflare Workers* template) and `CLOUDFLARE_ACCOUNT_ID` (on the Workers dashboard sidebar).

### 9. Link it from the plugin

In `gogh.php`, or in a file you `require` from it:

```php
define( 'GOGH_HELPER_URL', 'https://gogh-helper.your-subdomain.workers.dev' );
require_once __DIR__ . '/helper/plugin-link.php';
```

A `?` appears in the side palette footer, next to Undo and Redo. It opens in a new tab, and carries the plugin version so the bot answers for the release the person is actually running.

---

## What it costs

**Cloudflare: nothing**, on these settings. The free plan gives 100,000 Worker requests/day and 1,000 KV writes/day. The default limits are sized to stay inside that.

**Anthropic: per question.** The knowledge base is ~18k tokens and goes with every request, but prompt caching means you pay full price for it once and roughly a tenth after that. A typical question costs well under a penny. The defaults cap it at 400 questions/day.

The free KV write budget is the binding constraint, not the request budget: each question spends two writes, so ~500 questions/day is the practical ceiling. Past that the counters start failing — the Worker keeps serving but stops enforcing limits, and `counterErrors` climbs in `/api/meta`. If you get that popular, Workers Paid is $5/month and removes the write limit; raise `GLOBAL_DAILY_LIMIT` in `wrangler.jsonc` at the same time.

---

## The GitHub Pages version

Worth doing if you also want a no-infrastructure copy for yourself, or if you'd rather not run the Worker at all and are happy for each person to bring their own key.

Add `.github/workflows/pages.yml` (included in the kit), then Settings → Pages → Source: **GitHub Actions**. On each `v*` tag it publishes `gogh-helper.html` to `https://jamiemarsland.github.io/gogh-editor/`.

It auto-updates with every release, same as the Worker. The difference is that each visitor pastes their own Anthropic key — fine for you and a few collaborators, not something to link from the plugin.

## The connector (MCP)

Nothing extra to deploy: `/mcp`, `/d/` and `/b/` ship with the Worker. `wrangler.jsonc` declares a second KV namespace, `SITES`, which Cloudflare creates on deploy the same way it creates `RATE`. After deploying, add the connector in Claude Desktop (Settings → Connectors → Add custom connector) with the URL `https://<your-worker>/mcp` and ask for a site.

## Pictures (Unsplash)

The builder writes better sites when it can find real photographs. That needs a free Unsplash key, which lives on the Worker as a secret and is never seen by the page, the assistant or anyone using it.

1. Go to https://unsplash.com/developers, sign in, and choose **Your apps → New Application**. Accept the API terms and give it a name and a description (for example "gogh — builds WordPress sites from a chat").
2. Copy the **Access Key** from the application page. Ignore the Secret key; it is only for logging people in, which this does not do.
3. From `helper/worker`, hand it to the Worker:

```
npx wrangler secret put UNSPLASH_ACCESS_KEY
```

Paste the key when prompted, then `npx wrangler deploy`.

A new application is in **Demo** mode: 50 searches an hour, which is roughly 50 sites, and plenty for testing. When you want more, apply for production on the application page. Without the key nothing breaks — the builder says so to itself and makes sites without pictures.

Both of Unsplash's requirements are handled in code: every photographer whose picture is used is credited at the foot of the built site, and a photo's download endpoint is pinged at publish time for the pictures that were actually used.

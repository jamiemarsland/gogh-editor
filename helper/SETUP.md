# Putting the helper online

Three things to do. No terminal, no commands, about ten minutes.

You do **not** need to run any of the scripts in this folder. Those are my build tools — I've already run them, and once the folder is on GitHub they run themselves.

---

## 1. Put the `helper` folder on GitHub

The bot reads its knowledge from your repo, which is how it stays current. So this goes first.

1. Go to `github.com/jamiemarsland/gogh-editor`
2. **Add file** → **Upload files**
3. Drag in the `helper` folder and the `.github` folder from the kit
4. Scroll down → **Commit changes**

**Check it landed.** Open this link:

`https://raw.githubusercontent.com/jamiemarsland/gogh-editor/main/helper/gogh-kb.md`

You should see plain text starting "Gogh Editor — Knowledge Base". If you get a 404, the files went to the wrong place — the path has to be exactly `helper/gogh-kb.md`. Don't go on until that link works.

---

## 2. Get an Anthropic API key

1. [console.anthropic.com](https://console.anthropic.com) → **API keys** → **Create key**
2. Copy it. You only get shown it once.
3. **Set a spending limit now**, while you're there: **Billing** → **Limits** → something small, like £10 a month.

That key pays for every question anyone asks the bot. The limit is your safety net.

---

## 3. Click the button

Add this to your repo's README so it's always to hand, or just click it here:

```
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jamiemarsland/gogh-editor/tree/main/helper/worker)
```

Direct link: **https://deploy.workers.cloudflare.com/?url=https://github.com/jamiemarsland/gogh-editor/tree/main/helper/worker**

What happens:

1. It asks you to sign in to Cloudflare, or make an account. Free — no domain, no card needed.
2. It reads the config and shows you a setup form.
3. **Paste your Anthropic key** into the `ANTHROPIC_API_KEY` field. Leave `REFRESH_TOKEN` blank unless you want step 5 below.
4. Click **Deploy**.

Cloudflare creates the storage for the rate limits, wires everything up, and gives you an address like:

`https://gogh-helper.your-name.workers.dev`

Open it and ask it something.

---

## That's it

The rest is optional.

### Check the spending guard is on

Add `/api/meta` to the end of your address. In the text that comes back, find `"rateLimited"`:

- `"rateLimited":true` — good.
- `"rateLimited":false` — the storage didn't get created. Redeploy from the button.

The same page shows `askedToday`, so you can check usage any time without digging through dashboards.

### Link it from the plugin

In `gogh.php`, after the plugin header:

```php
define( 'GOGH_HELPER_URL', 'https://gogh-helper.your-name.workers.dev' );
require_once __DIR__ . '/helper/plugin-link.php';
```

Your real address in the first line. A `?` button appears in the Gogh side palette, next to Undo and Redo.

### Make updates instant

The bot re-reads your repo every ten minutes, so new releases reach it on their own. This just makes it immediate.

1. Think of a long random string.
2. In Cloudflare: your Worker → **Settings** → **Variables and Secrets** → **Add** → type **Secret**, name `REFRESH_TOKEN`, value: your string.
3. In GitHub: **Settings** → **Secrets and variables** → **Actions**
   - **Variables** tab → new variable `HELPER_URL` = your Worker address, no slash on the end
   - **Secrets** tab → new secret `HELPER_REFRESH_TOKEN` = the same string

---

## If something goes wrong

| It says | What to do |
|---|---|
| "Could not read the knowledge base" | Step 1 didn't finish. Open the `raw.githubusercontent.com` link and check it shows text. |
| "ANTHROPIC_API_KEY is not set" | The key field was left blank on the deploy form. Worker → Settings → Variables and Secrets → Add it as a **Secret**. |
| "the Worker's API key was rejected" | Key copied wrong, or the Anthropic account has no credit on it. |
| `"rateLimited":false` | The storage wasn't created. Redeploy from the button. |
| Answers are out of date | It refreshes every 10 minutes. Wait and reload. |

---

## What it costs

**Cloudflare: nothing.** The free plan covers far more than this needs.

**Anthropic: well under a penny a question.** Capped at 400 questions a day in total and 25 per person, so the worst case is bounded — and past that the bot tells people it's reached its limit rather than charging you more. Your spending limit from step 2 is the real backstop.

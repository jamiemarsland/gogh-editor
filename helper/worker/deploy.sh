#!/usr/bin/env bash
#
# One-command deploy for the Gogh Helper Worker.
#
#   cd helper/worker && ./deploy.sh
#
# Prompts for the API key, deploys, then verifies the live endpoint. The KV
# namespace for rate limiting is provisioned by Cloudflare from wrangler.jsonc.
# Safe to re-run — every step checks before acting.
#
# You need a Cloudflare account (free tier is fine). The first wrangler command
# opens a browser to log in.

set -euo pipefail
cd "$(dirname "$0")"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

WRANGLER="npx --yes wrangler@latest"

[ -f dist/worker.js ] || die "dist/worker.js is missing — run 'python3 ../refresh.py' first."
[ -f wrangler.jsonc ] || die "wrangler.jsonc is missing — are you in helper/worker?"

# --- 1. rate limiting ------------------------------------------------------
say "1/3  Rate limiting"
if grep -q '"kv_namespaces"' wrangler.jsonc; then
  echo "wrangler.jsonc declares the RATE namespace with no id, so Cloudflare"
  echo "provisions it on deploy and links it automatically. Nothing to do."
else
  warn "wrangler.jsonc has no kv_namespaces block — without it there are no rate"
  warn "limits at all, and a public URL is an open proxy on your API key."
fi

# --- 2. secrets ------------------------------------------------------------
say "2/3  Secrets"
if $WRANGLER secret list 2>/dev/null | grep -q ANTHROPIC_API_KEY; then
  echo "ANTHROPIC_API_KEY already set. Skipping."
else
  echo "Paste your Anthropic API key when prompted (input is hidden)."
  $WRANGLER secret put ANTHROPIC_API_KEY
fi

if $WRANGLER secret list 2>/dev/null | grep -q REFRESH_TOKEN; then
  echo "REFRESH_TOKEN already set. Skipping."
else
  read -r -p "Set a REFRESH_TOKEN so CI can push knowledge-base updates instantly? [Y/n] " a
  if [ "${a:-Y}" != "n" ] && [ "${a:-Y}" != "N" ]; then
    tok=$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 32)
    echo "$tok" | $WRANGLER secret put REFRESH_TOKEN
    echo
    echo "Save this as the GitHub secret HELPER_REFRESH_TOKEN:"
    echo "    $tok"
    echo
  fi
fi

# --- 3. deploy -------------------------------------------------------------
say "3/3  Deploy and verify"
deploy_out=$($WRANGLER deploy 2>&1 | tee /dev/tty)
url=$(echo "$deploy_out" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)

# --- 4. verify -------------------------------------------------------------

if [ -z "$url" ]; then
  warn "Could not read the URL from wrangler's output. Check the dashboard and test /api/meta by hand."
  exit 0
fi

sleep 3
meta=$(curl -fsS "$url/api/meta") || die "The Worker deployed but /api/meta did not respond."
echo "$meta"

if echo "$meta" | grep -q '"rateLimited":false'; then
  warn ""
  warn "WARNING: rate limiting is OFF. Anyone who finds this URL can spend your API"
  warn "credit. Create the KV namespace and redeploy before linking to it."
fi

say "Live at $url"
cat <<EOF

Next:
  - Set a monthly spend limit on the Anthropic key. The caps here bound requests,
    not cost, and KV counters can overshoot slightly under a burst.
  - Add the repo variable HELPER_URL = $url so CI can push KB updates.
  - Link it from the plugin — see helper/plugin-link.php.

Not a terminal person? helper/SETUP.md does all of this with a deploy button
instead — no CLI at all.
EOF

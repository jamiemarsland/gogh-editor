#!/bin/sh
# The user-test walk, locally: a disposable Yellow House on Playground CLI
# with THIS working tree mounted as the plugin, then the walk in a browser.
#   sh spike/walk-local.sh            → serves on http://127.0.0.1:9400
# then open http://127.0.0.1:9400/?gogh-edit=1&gogh-walk=1 and read the
# panel (or window.__goghWalk). Ctrl-C stops the server; nothing persists.
cd "$(dirname "$0")/.." || exit 1
exec npx -y @wp-playground/cli@latest server \
  --blueprint=spike/walk-local.json \
  --mount="$(pwd):/wordpress/wp-content/plugins/gogh" \
  --port=9400 --login

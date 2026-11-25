#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18 or newer is required. See the Chromebook / Linux section of README.md."
  exit 1
fi
node server/stash-server.js

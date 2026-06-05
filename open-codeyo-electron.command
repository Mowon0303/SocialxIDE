#!/bin/zsh
set -euo pipefail

cd "$(dirname "$0")"

DIST_INDEX="dist/atelier-ide/browser/index.html"

echo "[Codeyo] Workspace: $PWD"

if [[ ! -f "$DIST_INDEX" ]]; then
  echo "[Codeyo] Desktop build not found. Building once..."
  npm run desktop:build
elif [[ -n "$(find src electron angular.json package.json package-lock.json -newer "$DIST_INDEX" -print -quit)" ]]; then
  echo "[Codeyo] Source changed since the last desktop build. Rebuilding..."
  npm run desktop:build
else
  echo "[Codeyo] Using existing desktop build."
fi

echo "[Codeyo] Opening Electron..."
./node_modules/.bin/electron .

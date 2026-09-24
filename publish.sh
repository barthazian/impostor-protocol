#!/bin/sh
# Publish Rare Friends: Impostor Protocol as a public GitHub Pages preview.
#
#   1) create an empty PUBLIC repo on GitHub, e.g. <you>/impostor-protocol
#   2) run:  sh publish.sh git@github.com:<you>/impostor-protocol.git
#   3) enable Pages: Settings -> Pages -> Source: Deploy from a branch
#                    -> Branch: main  /  Folder: /docs
#   4) your preview URL is https://<you>.github.io/<repo>/
#
# The repo ships the built static preview in docs/ (that is what Pages serves)
# and the game source in game/ so reviewers can read the code.
set -e

REMOTE="${1:?usage: sh publish.sh <git-remote-url>}"

NAME="$(git config user.name || true)"
EMAIL="$(git config user.email || true)"
if [ -z "$NAME" ] || [ -z "$EMAIL" ]; then
  echo "Set your git identity first, then re-run:" >&2
  echo "  git config --global user.name  'Your Name'" >&2
  echo "  git config --global user.email 'you@example.com'" >&2
  exit 1
fi

if [ ! -f docs/index.html ]; then
  echo "docs/index.html is missing - run this from the publish folder." >&2
  exit 1
fi

git init -q 2>/dev/null || true
git add -A
git commit -q -m "Rare Friends: Impostor Protocol - vibeathon submission (game source + static preview)"
git branch -M main
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE"
else
  git remote add origin "$REMOTE"
fi
git push -u origin main

cat <<'MSG'

Pushed. Now enable GitHub Pages:
  Settings -> Pages -> Source: Deploy from a branch
  Branch: main   Folder: /docs

Your preview URL will be https://<you>.github.io/<repo>/
Put that URL where README.md and SUBMISSION.md say FILL, and mention the
required wallet: Robinhood mainnet (chain 4663) + a hardwired Generations NFT
(generation 1 or higher).
MSG

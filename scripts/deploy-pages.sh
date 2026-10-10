#!/usr/bin/env bash
# Build the static site under /recap and publish it to the gh-pages branch.
# GitHub Pages serves it at https://<user>.github.io/recap/.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf out
NEXT_PUBLIC_BASE_PATH=/recap npx next build
touch out/.nojekyll # without it, Pages runs Jekyll and drops the _next/ folder
remote=$(git remote get-url origin)
tmp=$(mktemp -d)
cp -R out/. "$tmp"
cd "$tmp"
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C "$OLDPWD" config user.name || echo deploy)" -c user.email="$(git -C "$OLDPWD" config user.email || echo deploy@localhost)" \
  commit -q -m "Deploy $(git -C "$OLDPWD" rev-parse --short HEAD)"
git push -q -f "$remote" gh-pages
rm -rf "$tmp"
echo "Deployed to gh-pages"

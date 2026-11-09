#!/usr/bin/env bash
# Builds the Mac apps on this Mac and attaches them to the GitHub release for the current version.
# Uses no GitHub Actions minutes. Usage: npm run release:mac   (add --intel to also build the Intel Mac app)
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"
export VITE_COMMUNITY_URL="${VITE_COMMUNITY_URL:-$(gh variable get COMMUNITY_URL 2>/dev/null || true)}"

echo "Building Apple Silicon app for $TAG ..."
npm run tauri:build:mac-arm
FILES=(src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/*_"$VERSION"_aarch64.dmg)

if [[ "${1:-}" == "--intel" ]]; then
  rustup target add x86_64-apple-darwin
  echo "Building Intel Mac app for $TAG ..."
  npm run tauri:build:mac-intel
  FILES+=(src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/*_"$VERSION"_x64.dmg)
fi

# The release page needs its tag on GitHub; creating it pushes nothing that builds (the workflow is manual).
git rev-parse "$TAG" >/dev/null 2>&1 || git tag "$TAG"
git push -q origin "$TAG" 2>/dev/null || true
gh release view "$TAG" >/dev/null 2>&1 || gh release create "$TAG" --title "Grand Strategy Analyzer $TAG" --generate-notes
gh release upload "$TAG" "${FILES[@]}" --clobber
echo "Done: $(gh release view "$TAG" --json url --jq .url)"

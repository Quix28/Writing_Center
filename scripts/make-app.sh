#!/bin/zsh
# Builds "dist/Writing Centre.app" by placing the app inside a copy of Electron.app
# (Electron's documented manual packaging), then ad-hoc signs it so macOS will run it.
set -euo pipefail
cd "${0:A:h}/.."

npm run build
# Assemble and sign in a temp folder: iCloud-synced folders (like Desktop) add Finder attributes
# to bundles while they're being built, and codesign refuses bundles that carry them.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
APP="$STAGE/Writing Centre.app"
RES="$APP/Contents/Resources"
PLIST="$APP/Contents/Info.plist"

ditto --noextattr --norsrc node_modules/electron/dist/Electron.app "$APP"
rm -f "$RES/default_app.asar"
mkdir -p "$RES/app"
ditto --noextattr --norsrc out "$RES/app/out"
cp -X package.json "$RES/app/"
# node-pty (the Claude Code terminal) is native, so it ships as files: its JS, and macOS binaries only.
mkdir -p "$RES/app/node_modules/node-pty/prebuilds"
ditto --noextattr --norsrc node_modules/node-pty/lib "$RES/app/node_modules/node-pty/lib"
cp -X node_modules/node-pty/package.json "$RES/app/node_modules/node-pty/"
for arch in darwin-arm64 darwin-x64; do ditto --noextattr --norsrc "node_modules/node-pty/prebuilds/$arch" "$RES/app/node_modules/node-pty/prebuilds/$arch"; done
chmod +x "$RES"/app/node_modules/node-pty/prebuilds/darwin-*/spawn-helper
cp -X build/icon.icns "$RES/electron.icns"

plutil -replace CFBundleName -string "Writing Centre" "$PLIST"
plutil -replace CFBundleDisplayName -string "Writing Centre" "$PLIST"
plutil -replace CFBundleIdentifier -string "local.writing-centre" "$PLIST"
plutil -replace CFBundleShortVersionString -string "$(node -p 'require("./package.json").version')" "$PLIST"

xattr -cr "$APP"
codesign --force --deep --sign - "$APP"

mkdir -p dist
rm -rf "dist/Writing Centre.app"
ditto --noextattr --norsrc "$APP" "dist/Writing Centre.app"
codesign --verify --deep "dist/Writing Centre.app"
echo "Built dist/Writing Centre.app"

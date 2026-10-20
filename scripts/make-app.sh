#!/bin/zsh
# Builds "dist/Writing Centre.app" by placing the app inside a copy of Electron.app
# (Electron's documented manual packaging), then ad-hoc signs it so macOS will run it.
set -euo pipefail
cd "${0:A:h}/.."

npm run build
APP="dist/Writing Centre.app"
RES="$APP/Contents/Resources"
PLIST="$APP/Contents/Info.plist"

rm -rf "$APP"
mkdir -p dist
# ditto without extended attributes: macOS provenance tags on copies would make codesign refuse the bundle.
ditto --noextattr --norsrc node_modules/electron/dist/Electron.app "$APP"
rm -f "$RES/default_app.asar"
mkdir -p "$RES/app"
ditto --noextattr --norsrc out "$RES/app/out"
cp -X package.json "$RES/app/"
cp -X build/icon.icns "$RES/electron.icns"

plutil -replace CFBundleName -string "Writing Centre" "$PLIST"
plutil -replace CFBundleDisplayName -string "Writing Centre" "$PLIST"
plutil -replace CFBundleIdentifier -string "local.writing-centre" "$PLIST"
plutil -replace CFBundleShortVersionString -string "$(node -p 'require("./package.json").version')" "$PLIST"

xattr -cr "$APP"
codesign --force --deep --sign - "$APP"
echo "Built $APP"

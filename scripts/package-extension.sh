#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID="$(jq -r '.uuid' "$ROOT_DIR/metadata.json")"
OUT_DIR="$ROOT_DIR/dist"
ZIP_PATH="$OUT_DIR/$UUID.zip"

mkdir -p "$OUT_DIR"
rm -f "$ZIP_PATH"

# Compile schemas before packaging so the zip is self-contained for EGO installs.
glib-compile-schemas "$ROOT_DIR/schemas/"

cd "$ROOT_DIR"
zip -r "$ZIP_PATH" \
  extension.js \
  fileProvider.js \
  fileScanner.js \
  fuzzyMatch.js \
  metadata.json \
  prefs.js \
  stylesheet.css \
  LICENSE \
  schemas/org.gnome.shell.extensions.panel-search.gschema.xml \
  schemas/gschemas.compiled

echo "Packaged extension: $ZIP_PATH"

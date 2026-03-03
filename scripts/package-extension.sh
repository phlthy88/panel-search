#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$ROOT_DIR/dist}"
UUID="panel-search@phlthy88.github.io"
ZIP_PATH="$OUT_DIR/$UUID.zip"

mkdir -p "$OUT_DIR"
rm -f "$ZIP_PATH"

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
  schemas/org.gnome.shell.extensions.panel-search.gschema.xml

echo "Created release package: $ZIP_PATH"

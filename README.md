# Panel Search - GNOME Shell Extension

Panel Search adds a search box to the GNOME top panel with app launching, settings lookup, quick math, unit conversion, and optional web suggestions.

## Features

- Unified search results with keyboard navigation
- App and GNOME Settings search
- Calculator expressions (for example: `2+2`)
- Unit conversion (for example: `10 km to mi`, `100 kg to lb`)
- Configurable web search engine (Google, DuckDuckGo, Bing)
- Optional local file search integration
- Optional weather query intent
- Configurable panel placement and debounce timing

## Requirements

- GNOME Shell 48, 49, or 50
- GLib
- GTK 4

## Installation

1. Copy this extension folder to:
   ```bash
   ~/.local/share/gnome-shell/extensions/panel-search@phlthy88.github.io
   ```
2. Compile schemas:
   ```bash
   glib-compile-schemas ~/.local/share/gnome-shell/extensions/panel-search@phlthy88.github.io/schemas/
   ```
3. Enable the extension:
   ```bash
   gnome-extensions enable panel-search@phlthy88.github.io
   ```
4. Restart GNOME Shell (or log out/in on Wayland).

## Preferences

Open preferences with:

```bash
gnome-extensions prefs panel-search@phlthy88.github.io
```

You can configure panel position, search engine, prediction limits, file search behavior, package search behavior, weather units, and debounce timing.

## Packaging

Build a release zip with runtime files only:

```bash
./scripts/package-extension.sh
```

The archive is written to `dist/panel-search@phlthy88.github.io.zip`.

## License

GNU GPL v3 or later. See `LICENSE`.

# Panel Search - GNOME Shell Extension

A modern search widget for GNOME Shell 48-50 that integrates into the top panel, similar to Windows 11 taskbar search.

## Features

- **Unified Omnibox Search**: Single intelligent search that combines all sources with smart ranking
- **Predictive Search**: Learns from your usage patterns - frequently used apps and settings rank higher
- **Application Search**: Fuzzy search through all installed applications
- **Settings Search**: Quick access to system settings
- **Web Search**: Search using Google, DuckDuckGo, or Bing
- **Calculator**: Perform basic calculations (e.g., `2+2`, `10*5+3`)
- **Unit Conversion**:
  - Distance: `10 km to mi`, `5 ft to m`
  - Weight: `100 kg to lb`, `16 oz to g`
  - Volume: `2 l to gal`, `1 cup to ml`
- **Keyboard Navigation**: Arrow keys to navigate results, Enter to select, Escape to close
- **Debounced Search**: Optimized performance with smart search delays

## Installation

1. Copy the extension directory to GNOME Shell extensions folder:
   ```bash
   cp -r panel-search@phlthy88.github.io ~/.local/share/gnome-shell/extensions/
   ```

2. Compile the GSettings schema:
   ```bash
   cd ~/.local/share/gnome-shell/extensions/panel-search@phlthy88.github.io
   glib-compile-schemas schemas/
   ```

3. Restart GNOME Shell:
   - X11: Press `Alt+F2`, type `r`, press Enter
   - Wayland: Log out and log back in

4. Enable the extension:
   ```bash
   gnome-extensions enable panel-search@phlthy88.github.io
   ```

## Configuration

Access preferences through GNOME Extensions app or:
```bash
gnome-extensions prefs panel-search@phlthy88.github.io
```

### Settings:
- **Search Engine**: Choose between Google, DuckDuckGo, or Bing
- **Panel Box**: Place widget in left, center, or right section
- **Position Index**: Control order within the selected box
- **Maximum Predictions**: Number of suggestions to show (0-5)
- **Local File Search**: Enable/disable Tracker-based file suggestions
- **File Result Limit**: Control number of file results shown
- **File Query Min Length**: Minimum characters before file lookup starts
- **Weather Search**: Enable/disable weather intent queries (`weather`, `wx`, `temp`)
- **Weather Units**: Fahrenheit or Celsius
- **Package Search**: Enable/disable GNOME Software package suggestions
- **Package Result Limit**: Control number of package results shown
- **Search Debounce**: Delay before search runs after typing (50-500 ms)
- **Suggestion Source**: Suggestions currently come from DuckDuckGo autocomplete
- **Clear Search History**: Reset learned predictions

## Usage

1. Click the search icon in the top panel
2. Type your query - results appear instantly with intelligent ranking:
   - **Frequently used items appear first** (learned from your behavior)
   - **Apps**: `firefox`, `terminal` - launches immediately
   - **Settings**: `wifi`, `display` - opens settings panel
   - **Math**: `15*8`, `(100+50)/2` - shows calculation
   - **Conversions**: `25 km to mi`, `10 kg to lb`, `2 l to gal` - converts units
   - **Web search**: Any other text searches the web
3. Use arrow keys to navigate, Enter to select, or click a result
4. All selections are learned - your most-used items rank higher over time

## Requirements

- GNOME Shell 48, 49, or 50
- GLib 2.0+
- GTK 4.0+

## License

MIT License - Feel free to modify and distribute

## Development

The extension uses modern GNOME Shell APIs and ESM imports. Key files:
- `extension.js`: Main extension logic (817 lines)
- `prefs.js`: Preferences UI (148 lines)
- `metadata.json`: Extension metadata
- `schemas/`: GSettings schema definitions
- `stylesheet.css`: Custom styling

### Code Quality
- Automated test coverage: 28 tests
- Performance optimized with debounced search
- Memory-safe resource management
- Comprehensive error handling

## Packaging for release

Create a release zip that contains only runtime extension files:

```bash
./scripts/package-extension.sh
```

This writes `dist/panel-search@phlthy88.github.io.zip`, excluding development and QA artifacts.

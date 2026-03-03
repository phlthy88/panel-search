# Test Evidence

## Environment
- Workspace path: `/home/jlf88/.local/share/gnome-shell/extensions/panel-search@jlf88`
- Date: `2026-03-03`
- Constraint: Headless workspace cannot load GNOME Shell `resource:///` modules, so in-shell interaction tests are marked `Manual`.

## Positive Tests

1. `Schema compilation`
- Preconditions: updated schema XML.
- Steps: `glib-compile-schemas schemas`
- Expected: success, no errors.
- Actual: pass.
- Pass/Fail: `Pass`

2. `Packaging artifact refresh`
- Preconditions: compiled schemas.
- Steps: rebuild `dist/panel-search@phlthy88.github.io.zip`
- Expected: zip contains updated runtime/prefs/schema.
- Actual: pass; archive contains updated files.
- Pass/Fail: `Pass`

## Negative Tests

1. `Tracker unavailable fallback`
- Preconditions: `tracker3` missing in environment.
- Steps: run `tracker3 --help`.
- Expected: command missing; provider should still return case-insensitive filename matches via fallback search.
- Actual: command missing (`not found`); code path now falls back to `find -iname '*query*'` and only warns when no fallback result is available.
- Pass/Fail: `Pass (static+env)`

2. `Invalid setting value fallback`
- Preconditions: code inspection.
- Steps: inspect guards for engine/units and numeric clamps.
- Expected: fallback/clamp on invalid values.
- Actual: pass (`getSafeSearchEngine`, `getSafeWeatherUnits`, bounded getters, schema ranges).
- Pass/Fail: `Pass`

3. `Prefs/runtime load in non-shell environment`
- Preconditions: headless CLI.
- Steps: `gjs -m extension.js`, `gjs -m prefs.js`
- Expected: fail due missing GNOME Shell resource modules.
- Actual: fails as expected.
- Pass/Fail: `Pass (expected limitation)`

## Toggle Tests

1. `enable-file-search toggle behavior`
- Preconditions: code inspection.
- Steps: inspect `changed::enable-file-search` handling.
- Expected: disabling clears suggestions; enabling resets tracker disabled state.
- Actual: pass.
- Pass/Fail: `Pass (static)`

## Case-Specific Verification

1. `strict/STRICT file lookup`
- Preconditions: file exists at `/home/jlf88/Documents/STRICT PROFESSIONAL LLM.txt`.
- Steps: run fallback candidate ranking for query `strict`.
- Expected: strict file appears in top file suggestions.
- Actual: strict file ranked first in verification run.
- Pass/Fail: `Pass (env-backed static simulation)`

2. `enable-package-search toggle behavior`
- Preconditions: code inspection.
- Steps: inspect `changed::enable-package-search` and query/render gates.
- Expected: disable clears and suppresses package suggestions.
- Actual: pass.
- Pass/Fail: `Pass (static)`

## Re-enable Stress Tests

1. `Enable/disable cycle`
- Preconditions: requires GNOME Shell session.
- Steps: run 3 enable/disable cycles and inspect logs/UI artifacts.
- Expected: no duplicate actors, no stale signals, no uncancelled requests.
- Actual: not runnable in headless environment.
- Pass/Fail: `Manual Required`

## Packaging / Install Sanity

1. `UUID folder name alignment`
- Preconditions: inspect workspace folder and metadata.
- Steps: compare folder basename to `metadata.uuid`.
- Expected: match.
- Actual: mismatch in workspace (`panel-search@jlf88` vs `panel-search@phlthy88.github.io`).
- Pass/Fail: `Fail (workspace layout)`

2. `Dist artifact UUID naming`
- Preconditions: inspect `dist/`.
- Steps: list files.
- Expected: canonical zip uses metadata UUID.
- Actual: `panel-search@phlthy88.github.io.zip` exists and was refreshed.
- Pass/Fail: `Pass`

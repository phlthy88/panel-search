# Remediation Changelog

## Release-Critical (Workstream B)

1. `B1 usage-history live refresh`: Implemented
- Added runtime listener for `changed::usage-history`.
- Reloads `PredictionEngine` state in-place without widget recreation.
- References: `extension.js:296-299`, `extension.js:192-194`.

2. `B2 max-predictions=0 semantics`: Implemented
- Replaced truthy fallback behavior with bounded explicit numeric handling.
- `0` now remains `0`.
- Reference: `extension.js:1297-1300`.

3. `B3 file-search session disable behavior`: Implemented
- `enable-file-search` toggle-on resets tracker disabled state.
- Added case-insensitive fallback search (`find -iname`) when tracker is unavailable or returns no matches.
- Added user-visible warning row only when no fallback result is available.
- References: `extension.js:300-307`, `extension.js:1281-1286`.

4. `B4 bounds and validation`: Implemented
- Added schema ranges for integer settings.
- Clamped panel insertion index at runtime.
- References: `schemas/org.gnome.shell.extensions.panel-search.gschema.xml`, `extension.js:1588-1591`.

5. `B5 keyboard focus release hardening`: Implemented (gated by manual QA)
- Added explicit key-focus release in `_hideResults()`.
- Reference: `extension.js:351-356`.

## Enhancements (Workstream E)

1. `E1 package search controllability`: Implemented
- Added schema + prefs toggle and result limit.
- Runtime gates and max-results are now settings-driven.

2. `E2 search debounce configurability`: Implemented
- Added schema + prefs debounce setting (`50-500ms`).
- Runtime now reads debounce value per query.

3. `E3 suggestion source policy`: Implemented (Option A)
- Kept DuckDuckGo suggestion source.
- Explicitly documented in prefs subtitle and suggestion row subtitle.

## Packaging / Install (Workstream F)

1. `F1 UUID alignment`: Partial
- Metadata UUID is canonical, but current workspace directory basename differs.
- Dist artifact uses canonical UUID filename.

2. `F2 schema integrity`: Implemented
- Schema compiles successfully and updated compiled schema included in zip.

3. `F3 prefs open sanity`: Pending manual in GNOME Shell session
- Headless environment cannot load GNOME Shell resource modules.

## Artifact Updates
- Refreshed package archive: `dist/panel-search@phlthy88.github.io.zip`
- Added reports:
  - `COVERAGE_MATRIX_ADDENDUM.md`
  - `SHELL_HEALTH_REPORT.md`
  - `TEST_EVIDENCE.md`

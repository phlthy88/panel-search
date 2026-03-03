# Coverage Matrix Addendum

## Evidence Integrity
- Commit: `8f266eb`
- Generated (UTC): `2026-03-03T04:29:46Z`
- Source hashes:
  - `extension.js`: `683a48a08075b0da27dd20291c19e44035db57afa2c9a82cdb17c43bd24334f2`
  - `prefs.js`: `5907d6224dece17f524fe2c774e451f42d83e3c1dc0894a5cca9ca4fcf4394e5`
  - `schemas/org.gnome.shell.extensions.panel-search.gschema.xml`: `604293846992bb60c693d4f3e646e3e195bbc148faa1ed3828997606f4e37406`
  - `stylesheet.css`: `144ab884bc6128b4564cd7406c7a1f7820ef7d637cc1bca68433cb850f3a5b05`

## Framing Updates Applied
- `usage-history` is framed as:
  - `Runtime cache not refreshed on settings change`
  - not as an unused schema key.
- Line numbers are treated as secondary evidence only.
- Function/symbol references are the primary evidence path.

## Regeneration Command
```bash
git rev-parse --short HEAD
date -u +"%Y-%m-%dT%H:%M:%SZ"
sha256sum extension.js prefs.js schemas/org.gnome.shell.extensions.panel-search.gschema.xml stylesheet.css
```

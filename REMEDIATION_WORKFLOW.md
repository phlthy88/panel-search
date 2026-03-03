# Panel Search QC Remediation Workflow

## 1) Goal
Turn the current coverage matrix into a release-grade QC artifact and close the highest-risk runtime gaps it identifies.

This workflow is based on:
- `coverage-matrix.html`
- Addendum guidance (framing fixes, line-number caveat, lifecycle health, stronger tests)

## 2) Scope And Outcomes

### Required outcomes
1. Matrix framing is corrected and stable over time.
2. Runtime gaps are remediated or explicitly accepted with rationale.
3. A dedicated Shell lifecycle/health report exists.
4. Evidence includes negative, toggle, and re-enable cycle tests.

### Non-goals
- UI redesign of the matrix
- Broad feature expansion unrelated to findings

## 3) Workstreams

## Workstream A: Matrix Framing And Evidence Stability

### A1. Reframe `usage-history` finding
- Change wording from "Keys in schema with runtime gap" to:
  - "Runtime cache not refreshed on settings change"
- Clarify that `usage-history` is used but currently non-reactive at runtime.

### A2. Line reference policy
- Keep line numbers as optional convenience only.
- Make symbol/function references primary evidence.
- Stamp the matrix with:
  - Git commit SHA
  - Generation date/time
  - File hash or "generated from working tree state"

### A3. Matrix metadata block
- Add a top-level "Evidence Integrity" block:
  - Source revision
  - Known staleness risk
  - Regeneration command

### Exit criteria
- Matrix no longer presents line numbers as sole proof.
- Matrix includes immutable source revision metadata.

## Workstream B: Defects And Robustness (Release-Critical)

### B1. `usage-history` live refresh bug
- Add `changed::usage-history` handling in runtime.
- Reload `PredictionEngine` in-memory cache only when `usage-history` changes.
- Apply refresh only while widget/runtime objects are alive.
- Do not recreate the widget; update engine state in place to avoid UI state loss.
- Ensure "Clear History" takes effect without restart.

### B2. `max-predictions=0` semantic bug
- Replace `get_int('max-predictions') || 5` with explicit handling preserving `0`.
- Confirm behavior matches prefs subtitle ("0 to disable").

### B3. File-search session disable behavior
- Current behavior permanently disables file provider after one Tracker error.
- Remediate by:
  - Resetting disabled state when `enable-file-search` toggles on, or
  - Retrying with bounded backoff.
- Add user-visible feedback row on provider failure (optional but recommended).

### B4. Bounds and validation hardening
- Clamp panel insertion index before `insert_child_at_index`.
- Add schema `<range>` constraints for int settings where possible.
- Verify invalid/manual dconf edits cannot trigger undefined UI behavior.

### B5. Keyboard focus release hardening
- Current behavior closes the menu and clears text, but focus release should be explicit.
- Add focus release hardening in `_hideResults()` (for example `global.stage.set_key_focus(null)`), validated against GNOME Shell behavior.
- Gate rollout on verification: no keyboard shortcut regression and no focus trap after close/activate/escape.

### Exit criteria
- B1+B2 are fixed and proven.
- B3+B4+B5 are fixed and proven, or accepted with rationale + explicit test evidence + owner sign-off.

## Workstream E: Enhancements / Product Decisions (Scope-Controlled)

### E1. Package search controllability
- Add schema key + prefs toggle for package provider.
- Optional: add configurable package result limit.

### E2. Search debounce configurability
- Current behavior uses hardcoded `SEARCH_DEBOUNCE_MS`.
- Add schema key + prefs control for debounce interval (recommended bounded range, e.g. 50-500 ms).
- Read debounce from settings in runtime so power users can tune responsiveness/perf.

### E3. Suggestion source vs selected engine mismatch
- Current behavior always uses DuckDuckGo AC for suggestions while action URL follows selected engine.
- Remediation options:
  - Option A: Keep DuckDuckGo source but document this explicitly in prefs/help text.
  - Option B: Route suggestions by selected engine where APIs are available, fallback to DuckDuckGo otherwise.
- Choose one policy and make it explicit in UX copy and matrix notes.

### Exit criteria
- Each enhancement is either implemented or explicitly deferred with rationale and impact note.

## Workstream C: Shell Health QC Addendum

Create a separate "Shell Health" section/report with explicit pass/fail.

### C1. Signal disconnect audit
- Verify every `connect()` has matching disconnect on destroy/disable paths.
- Include enable/disable/re-enable sequence proof.

### C2. Timeout/source cleanup audit
- Verify all GLib source IDs are removed and nulled.
- Include repeated open/close interaction test.

### C3. Cancellable cancellation audit
- Verify all in-flight cancellables are cancelled on:
  - Query supersession
  - Widget destroy
  - Extension disable

### C4. Idempotence checks
- Double-enable guard behavior confirmed.
- Disable called without prior enable does not leak or throw.
- 3 full enable/disable cycles without residual actors/signals.

### C5. Stylesheet lifecycle verification
- Verify stylesheet behavior for target GNOME versions (auto-load vs explicit load/unload assumptions).
- If explicit load/unload is required, add and validate symmetric cleanup on disable.

### Exit criteria
- Shell Health report exists with checklist and evidence for each item.

## Workstream D: Test Evidence Upgrade

Add a "Tests That Prove It" block with explicit categories.

### D1. Positive tests
- Existing happy-path feature tests.

### D2. Negative tests
- Tracker missing/unavailable
- Network down for weather/suggestions
- GNOME Software provider missing
- Invalid GSettings value fallback checks
- Prefs open with schema issues simulated (or preflight-validated) without runtime crash

### D3. Toggle tests
- Toggle provider setting while:
  - Results menu open
  - User actively typing
  - Async request in flight

### D4. Re-enable stress tests
- Run at least 3 enable/disable cycles.
- Confirm no duplicate actors, no stale signals, no uncancelled async work.

### D5. Evidence format
- For each test case include:
  - Preconditions
  - Steps
  - Expected result
  - Actual result
  - Log snippet (if applicable)
  - Pass/Fail

### Exit criteria
- Test block includes positive/negative/toggle/re-enable categories with recorded outcomes.

## Workstream F: Packaging And Install Sanity

### F1. UUID and directory alignment
- Verify extension directory name matches metadata UUID.

### F2. Schema install integrity
- Verify schema files are present and compiled in packaged artifact.
- Validate no prefs/runtime warnings from missing schema at startup.

### F3. Prefs launch sanity
- Verify prefs window opens cleanly with no schema binding warnings.

### Exit criteria
- Packaging checklist passes for install, enable, and prefs-open paths.

## 4) Suggested Execution Sequence
1. Workstream A (matrix framing updates)
2. Workstream B1+B2 (critical semantic correctness)
3. Workstream C (lifecycle health report)
4. Workstream B3+B5 (robustness hardening)
5. Workstream F (packaging/install sanity)
6. Workstream E (enhancements, scoped decisions)
7. Workstream D (final proof pack; run against packaged artifact when shipping zips)

## 5) Deliverables
- Updated coverage matrix HTML
- Shell Health addendum report
- Test evidence pack
- Changelog entry summarizing fixed vs accepted risks

## 6) Definition Of Done
- Matrix framing reflects runtime semantics accurately.
- Revision-stable evidence is embedded (commit SHA and generation metadata).
- B1+B2 are fixed and proven.
- B3-B5 are either implemented or explicitly accepted with rationale and tests.
- E1-E3 are either implemented or explicitly deferred with rationale.
- Shell lifecycle health checks pass.
- Packaging/install sanity checks pass.
- Evidence includes negative/toggle/re-enable scenarios, not only happy paths.

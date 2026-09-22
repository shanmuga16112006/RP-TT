# RPSIT Timetable Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deployable browser application that imports timetable data from Excel, generates rule-aware class/teacher/lab schedules, and exports RPSIT-style PDF timetables.

**Architecture:** Use a dependency-light static web app with modular ES modules. The input normalizer accepts the canonical schema and the supplied `Book1.xlsx` section-marker format. A deterministic heuristic scheduler places fixed labs first, then theory subjects while enforcing hard constraints and recording soft-rule warnings and unresolved work. The UI is logo-free; the PDF export renders a separate RPSIT-branded document template.

**Tech Stack:** HTML, CSS, vanilla JavaScript ES modules, browser File API, SheetJS CDN for `.xlsx` parsing, browser print/PDF export, Node built-in test runner for pure modules.

**Spec:** User request and attached RPSIT class/teacher timetable references.

## Global Constraints

- Live application screens must not display the RPSIT logo.
- Exported/printed timetables must include the RPSIT logo and official-style header, timetable grid, subject table, and signatures.
- Break and lunch slots are fixed non-teaching slots.
- R1–R19 are encoded as hard constraints, soft preferences, or explicit fallback/warning diagnostics as defined below.
- Class options must come from uploaded data, never from a hardcoded class list.
- The current workbook format must be supported: section marker rows such as `AIDS` and `CSE`, followed by `Acronym`, `Subject Code`, `Subject Name`, `Faculty Member`, and `periods`.

### Task 1: Application shell and test harness

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `src/app.js`
- Create: `src/styles.css`
- Create: `tests/test-helpers.js`

**Interfaces:**
- Produces the DOM shell and module entrypoint consumed by later tasks.

- [ ] Add a minimal package with `npm test` mapped to `node --test tests/*.test.js`.
- [ ] Add semantic markup for rail navigation, setup state, generated state, upload status, class selector, template picker, conflict drawer, and toast region.
- [ ] Add CSS for the charcoal rail, warm canvas, coral accent, cards, chips, timetable grid, warning states, and print-only export surface.
- [ ] Run `npm test` and confirm the empty test harness executes successfully.

### Task 2: Schema normalization and validation

**Files:**
- Create: `src/data-model.js`
- Test: `tests/data-model.test.js`

**Interfaces:**
- `normalizeRows(rows) -> { classes, subjects, teachers, labs, metadata, errors }`
- `validateRows(rows) -> { valid, missing, warnings }`

- [ ] Write failing tests for canonical headers, supplied section-marker workbook rows, distinct classes, `4+2` theory/lab workload parsing, and missing required fields.
- [ ] Verify the tests fail because the normalizer is not implemented.
- [ ] Implement header aliasing for `Class Name`/`Class`, `Teacher Name`/`Faculty Member`, `Periods Required`/`periods`, and subject aliases.
- [ ] Parse numeric workloads and strings such as `4+2` into theory periods and lab periods.
- [ ] Treat a non-header single-cell row as the active class section when followed by subject rows, preserving `AIDS` and `CSE` from the supplied workbook.
- [ ] Return actionable validation errors without mutating source rows.
- [ ] Run the focused tests and then the complete suite.

### Task 3: Timetable slot model and rule engine

**Files:**
- Create: `src/scheduler.js`
- Test: `tests/scheduler.test.js`

**Interfaces:**
- `createDefaultSlots() -> Slot[]`
- `generateTimetable(model, options) -> { schedules, diagnostics }`
- `checkSchedule(schedule, model) -> Diagnostic[]`

- [ ] Write failing tests for fixed break/lunch slots, HOD/CC Period-1 exclusion, teacher double-booking, unavailable teacher slots, daily cap including external hours, one-subject-per-day, non-consecutive subjects, fixed consecutive labs, R2a fallback, R12 lab-day exception, unresolved periods, and teacher cross-class continuity preference.
- [ ] Verify the tests fail for missing scheduler exports.
- [ ] Implement the 6-day RPSIT slot layout: P1/P2, break, P3/P4, lunch, P5/P6, break, P7/P8.
- [ ] Place fixed labs exactly into their requested day/start/length before theory placement.
- [ ] Place theory periods using candidate scoring that prioritizes hard validity, weekly spread, Period-1 preference, time-slot variety, and teacher-gap preference.
- [ ] Emit diagnostics with rule IDs, severity, class, day, period, subject, teacher, and remediation suggestion.
- [ ] Ensure no placement silently violates R1–R19.
- [ ] Run the focused tests and then the complete suite.

### Task 4: Excel upload and runtime state

**Files:**
- Create: `src/xlsx-loader.js`
- Modify: `src/app.js`
- Test: `tests/xlsx-loader.test.js`

**Interfaces:**
- `loadWorkbook(file) -> Promise<RawSheetRows[]>`
- `buildModelFromWorkbook(file) -> Promise<NormalizedModel>`

- [ ] Write failing tests for workbook parsing adapter behavior using representative row matrices, including the supplied format.
- [ ] Verify the tests fail before the adapter exists.
- [ ] Load SheetJS from the pinned CDN URL in `index.html` and parse the first non-empty worksheet in the browser.
- [ ] Populate the class selector only after successful validation, with distinct classes from normalized data.
- [ ] Show filename chip, success state, invalid-column list, and re-upload refresh behavior.
- [ ] Persist the normalized model and last selected template in local storage.
- [ ] Run tests and manually verify the supplied workbook through the browser UI.

### Task 5: Generator UI and conflict workflow

**Files:**
- Create: `src/ui.js`
- Modify: `src/app.js`
- Modify: `src/styles.css`

**Interfaces:**
- `renderSetupState(state)`
- `renderGeneratedState(state)`
- `openConflict(diagnostic)`

- [ ] Add template cards for Class, Teacher, and Lab output formats.
- [ ] Add Generate and Validate & Generate actions with loading/skeleton state.
- [ ] Render class timetable cells with subject code, teacher initials, lab tint, warning dot, and merged lab spans.
- [ ] Add floating Export, Regenerate, and Edit Manually actions.
- [ ] Add conflict side panel with reason, suggested swap, approve/reject controls, and resolved toast.
- [ ] Add admin editing panels for teacher availability, external hours, HOD/CC assignments, and lab blocks.
- [ ] Verify keyboard focus, empty state, invalid upload state, generation state, generated state, and conflict state.

### Task 6: RPSIT PDF export

**Files:**
- Create: `src/export.js`
- Create: `public/rpsit-logo.svg`
- Modify: `src/app.js`
- Modify: `src/styles.css`

**Interfaces:**
- `buildExportDocument(schedule, model, template) -> HTMLElement`
- `downloadPdf(schedule, model, template) -> void`

- [ ] Write failing tests for export metadata mapping and slot ordering.
- [ ] Verify the tests fail before export helpers exist.
- [ ] Create an inline vector RPSIT logo based on the supplied reference image, used only inside the export document.
- [ ] Render document ID, programme, year/sem, regulation, academic year, odd/even, effective date, class advisor, timetable grid, subject table, workload, faculty, and signature labels.
- [ ] Preserve the reference ordering and visible break/lunch columns.
- [ ] Use a print-only export surface and invoke the browser print dialog with PDF instructions, avoiding a fake “download” that produces HTML.
- [ ] Add `@page` sizing and print styles so the output fits the official landscape/portrait format without clipping.
- [ ] Run export tests and inspect a printed/PDF preview in the browser.

### Task 7: Verification and delivery

**Files:**
- Create: `README.md`
- Create: `tests/integration.test.js`

- [ ] Add an integration test covering sample model → generated schedule → diagnostics → export metadata.
- [ ] Run `npm test` and fix all failures.
- [ ] Run a browser smoke test for upload, class selection, generation, conflict panel, manual edit, and print export.
- [ ] Inspect the working tree and report all created paths and remaining limitations, especially browser print-to-PDF behavior.


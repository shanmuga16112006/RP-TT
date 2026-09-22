# Timetable Generator — Project Specification

**Version:** 1.0
**Scope:** Backend / scheduling logic only. No frontend/UI.
**Audience:** Any developer or model implementing the system from scratch, in any language or stack.

---

## 1. Purpose & Scope

This system generates a conflict-free **weekly theory-period timetable** for one or more classes/sections, given staff, subject, and department data.

**Explicitly out of scope for v1:**
- Lab periods, placement periods, and library periods — these are allotted by a separate, external process and are provided to this system as **already-fixed, read-only input**. This generator never creates or moves them; it only works around them.
- Any user interface. Input/output are data structures (JSON), not screens.
- Cross-class or cross-department staff double-booking checks (see §9, Known Limitations).
- Faculty merging across departments.

**What this system must do:**
Given staff, subjects, classes, and the external (lab/placement/library) allotment grid for each class, assign every theory subject's weekly periods into the remaining open slots, satisfying all rules in §4, and clearly report anything it cannot place.

---

## 2. Core Entities & Data Schema

### 2.1 Department
| Field | Type | Notes |
|---|---|---|
| `id` | string | unique |
| `name` | string | |
| `hod_staff_id` | string | staff id of the Head of Department |

### 2.2 Class / Section
| Field | Type | Notes |
|---|---|---|
| `id` | string | e.g. `"CSE_A"` |
| `name` | string | e.g. `"Section A"` |
| `department_id` | string | owning department |
| `cc_staff_id` | string | Class Coordinator for this specific class (assumed class-level, not department-level — confirm if this is wrong) |
| `template_id` | string | which day/period template (§3) this class follows |
| `subjects` | list of `{subject_id, weekly_theory_periods}` | theory periods needed per week, per subject, for this class |
| `external_allotments` | list of `ExternalAllotment` | pre-fixed lab/placement/library slots for this class (see 2.5) |

### 2.3 Staff
| Field | Type | Notes |
|---|---|---|
| `id` | string | unique |
| `name` | string | |
| `designation` | enum | `HOD`, `CC`, `FACULTY` |
| `home_department_id` | string | a staff member may still teach subjects for other departments |
| `subjects_taught` | list of subject_id | subjects this staff is qualified/assigned to teach |
| `external_daily_hours` | map `{day: hours}` | hours already committed that day via lab/placement/library — **required input**, used by the 5-hour cap (R4) |

### 2.4 Subject
| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `name` | string | |
| `department_id` | string | owning department |
| `has_lab` | boolean | informational — tells the generator this subject also has an externally-allotted lab component, relevant to the same-day exception (R1) |
| `eligible_staff` | list of staff_id | which staff can teach this subject for this class (usually one, but may be more) |

### 2.5 ExternalAllotment (input, read-only)
Represents a lab/placement/library slot already fixed by the external process, for a given class.

| Field | Type | Notes |
|---|---|---|
| `day` | int | |
| `period_numbers` | list of int | e.g. `[5,6]` for a 2-period lab block |
| `type` | enum | `LAB`, `PLACEMENT`, `LIBRARY` |
| `subject_id` | string or null | populated when `type == LAB`, used for the R1 same-day exception |
| `staff_id` | string or null | if a staff member is committed by this allotment (used to compute their daily hour usage) |

### 2.6 Template (Day/Period structure)
Not hardcoded — every class references a template so the system generalizes beyond one fixed schedule.

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `days` | list | e.g. `["Day-1", ..., "Day-6"]` |
| `periods` | list of `{period_number, start_time, end_time, type}` | `type` is `TEACHING`, `BREAK`, or `LUNCH` — only `TEACHING` periods are ever allocated |

**Concrete instance (Section A, from the provided template):**

| Period | Time | Type |
|---|---|---|
| 1 | 09:05–10:00 | TEACHING |
| 2 | 10:00–11:00 | TEACHING |
| — | 11:00–11:15 | BREAK |
| 3 | 11:15–12:15 | TEACHING |
| 4 | 12:15–13:00 | TEACHING |
| — | 13:00–13:40 | LUNCH |
| 5 | 13:40–14:20 | TEACHING |
| 6 | 14:20–15:00 | TEACHING |
| — | 15:00–15:10 | BREAK |
| 7 | 15:10–15:50 | TEACHING |
| 8 | 15:50–16:30 | TEACHING |

8 teaching periods/day × 6 days = 48 teaching slots/week per class, before subtracting external allotments.

### 2.7 Department Override File
One file per department, read before generating that department's classes. See §5.

### 2.8 Output: TheoryTimetable
```
{
  "class_id": "CSE_A",
  "days": [
    {
      "day": "Day-1",
      "periods": [
        { "period_number": 1, "slot_type": "THEORY", "subject_id": "...", "staff_id": "..." },
        { "period_number": 2, "slot_type": "EXTERNAL", "external_type": "LAB", "subject_id": "..." },
        ...
      ]
    },
    ...
  ]
}
```

---

## 3. Rule Set (Theory Allocation Only)

Written as formal, checkable conditions. `C` = class, `S` = subject, `D` = day, `P` = period.

**R1 — No same-subject repeat per day, with lab exception.**
For class `C` on day `D`, subject `S` may occupy at most one *theory* period — **unless** `S` also has an externally-allotted lab (`type == LAB`, `subject_id == S`) on that same day `D`, in which case exactly one theory period of `S` is still permitted on `D` in addition to the lab.

**R2 — No consecutive same-subject periods.**
Subject `S` cannot occupy two theory periods that are immediately adjacent (no break/lunch between them) on the same day, for the same class.

**R3 — HOD/CC excluded from Period 1 of their own scope.**
- The staff member who is HOD of a department cannot be assigned Period 1 for **any class belonging to that department**.
- The staff member who is CC of a specific class cannot be assigned Period 1 for **that class**.

**R4 — Staff daily hour cap (combined).**
For any staff member on any day: `(theory periods assigned that day by this system) + (external_daily_hours for that day) ≤ 5`. External hours are treated as a pre-consumed budget — compute remaining capacity *before* attempting to place theory periods for that staff member on that day.

**R5 — Weekly spread (no clustering).**
A subject's weekly theory periods must be distributed across as many distinct days as possible, rather than clustered onto fewer days. Default assumption: no more than 1 theory period of a given subject per day unless the weekly count cannot otherwise fit within the available days (flag this as a fallback case, not a silent default).

**R6 — Time-slot variety.**
Across the days a subject appears in a given week, it should not occupy the identical period-number every time. Where more than one valid slot exists, prefer the one that most varies the subject's position in the day compared to its other placements that week.

**Dropped for v1 (do not implement):**
- ~~Staff double-booking across departments/classes~~ — not checked in this version.
- ~~No merging of faculty from different departments~~ — not addressed in this version.

See §9 for the operational risk this creates.

---

## 4. Department Override File

**Purpose:** some departments may need extra rules beyond the base set (e.g. a different daily hour cap, extra excluded periods, department-specific staff constraints). Rather than hardcoding exceptions, each department gets its own reference file the generator consults before scheduling that department's classes.

**Location convention:** `overrides/<department_id>.json`

**Template (currently empty — no department has defined overrides yet):**
```json
{
  "department_id": "",
  "custom_rules": []
}
```

**Behavior when populated (future):** `custom_rules` entries would be merged with the base rule set in §3 for that department's classes, with department-specific rules taking precedence on conflict. Until departments define needs, this file stays as the empty template above and the generator proceeds with only the base rules.

---

## 5. Scheduling Algorithm

1. **Load inputs:** departments, classes (with templates + external allotments), staff (with `external_daily_hours`), subjects, and each relevant department's override file.
2. **Per class**, compute the open theory-slot pool = all `TEACHING` periods in its template, minus periods already consumed by that class's `external_allotments`.
3. **Per class**, build the subject queue: for each subject, note `weekly_theory_periods` needed, eligible staff, and whether it `has_lab` (for the R1 exception).
4. **Order subjects by constrainedness** (most-constrained-first): subjects with fewer eligible staff, fewer eligible days, or a higher weekly-period count relative to available days get placed first. This reduces backtracking.
5. **For each subject**, attempt to place its required weekly periods:
   - For each candidate `(day, period)`:
     a. Reject if it violates **R1** (subject already placed that day, and no lab exception applies).
     b. Reject if it violates **R2** (adjacent period already holds the same subject).
     c. Reject if `period == 1` and the assigned staff is the HOD/CC excluded under **R3**.
     d. Reject if assigning this staff here would exceed their 5-hour cap under **R4** (check `external_daily_hours[day] + already_assigned_today`).
     e. Among remaining valid candidates, prefer the day that best preserves **R5** (spreads remaining periods across untouched days) and the period-number that best satisfies **R6** (differs from this subject's other placements this week).
   - Commit the best candidate; if none exists, mark this subject/period as **unresolved** and continue (do not force-place a violation).
6. Repeat step 5 for all subjects in all classes.
7. **Final validation pass** (§6): re-check every committed placement against R1–R6 as a regression safeguard.
8. **Emit output** (§2.8) plus a report of any unresolved subject-periods.

---

## 6. Validation & Conflict Reporting

After generation, re-validate the *entire* output against R1–R6 independently of the generation logic (a second, simpler pass — not just trusting the generator's own bookkeeping).

Any violation or any subject with fewer than its required weekly periods placed must be reported explicitly: which class, which subject, which rule, and why — never returned as a silently incomplete or silently violating timetable.

---

## 7. Edge Cases & Known Limitations (v1)

- **Cross-class/cross-department staff double-booking is not checked in this version.** Each class's timetable is generated independently. If the same staff member teaches multiple classes, nothing in this system verifies their theory periods (or their external allotments) don't collide across classes. This is a real deployment risk if staff share across classes/departments — flagged here explicitly since it was intentionally dropped from scope, not an oversight.
- A staff member whose external allotments already consume close to 5 hours on a given day may have little or no theory capacity that day — the algorithm must treat this as a normal (not exceptional) case.
- If a subject's weekly period count cannot fit within the available days without violating R1/R2 (e.g., needs 7 periods but the week effectively has fewer usable days for that class), the system must flag it as unresolved rather than force a placement or crash.
- Open question: is CC defined at the class/section level (assumed here) or could a CC be responsible for multiple sections? Confirm before implementation if this matters.
- Open question: when R5's default of "1 period/day per subject" can't be met, what is the fallback ordering (e.g., is 2-same-day-non-adjacent preferred over leaving periods unplaced)? Not yet specified — implementers should surface this as a configurable policy rather than hardcode a choice.

---

## 8. Summary of Inputs Required to Run This System

- Department list (id, name, HOD)
- Class list (id, department, CC, template, subject-period requirements, external allotments)
- Staff list (id, designation, home department, subjects taught, external daily hours)
- Subject list (id, department, has_lab flag, eligible staff)
- Template(s) defining day/period/break structure
- Department override files (empty templates acceptable for v1)

R1 — HOD not in Period 1
The HOD of a department is never assigned Period 1 for any class of that department.

R2 — Subject once per day
A subject appears at most once per day (theory), except the fallback in R2a.
R2a Fallback: if a subject's weekly required periods exceed the number of available days, it may appear twice on one day (e.g. 7h over 6 days) — flagged as a fallback case, not silent.

R3 — No consecutive same-subject periods
A subject cannot occupy two immediately adjacent periods on the same day (no break/lunch between them), same class.

R4 — Required weekly periods
Every subject receives its required weekly periods; anything unplaceable is reported as unresolved.

R5 — No teacher double-booking (checked across all classes)
A teacher cannot teach two different classes at the same period, checked across all classes being generated.

R6 — One subject per period per class
A class has at most one subject in any single period.

R7 — Labs managed manually
Lab periods are fixed by the user/admin and can be modified by them; the generator works around them.

R8 — Admin can update
Admin can update subject and teacher information at any time.

R9 — First-hour preference
Each subject should receive a Period-1 slot at least once per week whenever possible; reported as a warning if not achieved.

R10 — No continuous periods across classes for a teacher
A teacher should not have continuous periods across different classes (e.g. Class X period 1 → Class Y period 2 is avoided; a gap, e.g. period 3, is acceptable).

R11 — CC excluded from Period 1 of their own class
The staff member who is CC of a specific class is never assigned Period 1 for that class.

R12 — Lab-triggered exception for same-day repeat
If subject S has an externally-allotted lab on day D, exactly one theory period of S is additionally permitted on D — separate from the R2a weekly-shortfall fallback.

R13 — Staff daily hour cap (combined with external hours)
For any staff member on any day: (theory periods assigned that day) + (external_daily_hours that day) ≤ 5. External hours are a pre-consumed budget — compute remaining capacity before placing theory periods.

R14 — Weekly spread (no clustering)
A subject's weekly theory periods must be distributed across as many distinct days as possible. Default: no more than 1 period of a subject per day unless the weekly count can't otherwise fit (this is the R2a fallback, not silent).

R15 — Time-slot variety
Across the days a subject appears in a week, it should avoid the identical period-number every time. Where multiple valid slots exist, prefer the one that most varies the subject's position in the day relative to its other placements that week.

R16 — Lab consecutiveness (input-sheet driven) (new)
Lab periods must occupy the exact consecutive block of periods specified in the input sheet for that lab. The generator must not split, shorten, or relocate this block on its own — it treats the block as fixed and schedules theory periods around it, per R7.

R17 — Teacher availability constraints (new)
If a teacher has declared unavailable periods/days (leave, external commitment, etc.), those slots must be excluded from assignment for that teacher — distinct from R5, which only prevents simultaneous double-booking.

R18 — Extracurricular continuous block, starting Period 3 (new)
Lunch and break periods are fixed non-teaching slots; no subject or lab may be assigned into them. An extracurricular activity must never be scheduled in Period 1 or Period 2 — its first possible starting period is Period 3. Whenever an extracurricular activity is scheduled, its entire required duration must be placed in continuous, consecutive periods without any gap, and the block must not cross, overlap, or be interrupted by any Break or Lunch period. The generator never splits, shortens, or relocates such a block to satisfy another rule; if no compliant continuous block exists from Period 3 onward, the activity is reported as unresolved (not partially placed). This applies only to extracurricular activities and does not change theory or lab scheduling.

R-19 --A teacher can be assigned to multiple classes and different subjects & activities, but the same teacher must not be scheduled for two different classes in the same time slot.

R21 — No continuous subject patterns across classes (new)
A subject must not form a continuous column or row pattern across different classes: if the subject occupies slot P on day D in Class X, the same subject must not be placed at P on D or an adjacent day in another class, nor at an adjacent period (P±1) on the same day in another class. Labs are fixed per R16 and excluded from the pattern check, but theory placements still steer around lab slots.

R22 — No empty periods when a full 48-period week is required (new)
If a class requires all 48 teaching periods (input demand equals weekly capacity), the timetable must contain all 48 with no empty periods. Generation detects any empty slot, attempts to backfill the most under-allocated subject into it first (then any eligible subject), and rechecks all rules afterward; the CAPACITY diagnostic reports only what remains genuinely unfillable.

R23 — Lab cannot start in Period 1 or Period 2 (new)
A lab must never be scheduled in Period 1 or Period 2. The first possible starting period for a lab is Period 3. This applies to all lab sessions unless the admin explicitly overrides the restriction (each lab row exposes an override toggle in the Lab Classification panel; auto-placed labs always start at Period 3 or later). The lab must still satisfy the exact consecutive duration defined in the input sheet — the block is never split or shortened.

from __future__ import annotations

from typing import Any


DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT"]
PERIODS = [
    {"period_number": 1, "start_time": "09:05", "end_time": "10:00", "type": "TEACHING"},
    {"period_number": 2, "start_time": "10:00", "end_time": "11:00", "type": "TEACHING"},
    {"period_number": 3, "start_time": "11:15", "end_time": "12:15", "type": "TEACHING"},
    {"period_number": 4, "start_time": "12:15", "end_time": "13:00", "type": "TEACHING"},
    {"period_number": 5, "start_time": "13:40", "end_time": "14:20", "type": "TEACHING"},
    {"period_number": 6, "start_time": "14:20", "end_time": "15:00", "type": "TEACHING"},
    {"period_number": 7, "start_time": "15:10", "end_time": "15:50", "type": "TEACHING"},
    {"period_number": 8, "start_time": "15:50", "end_time": "16:30", "type": "TEACHING"},
]


def build_dataset(form: dict[str, Any]) -> dict[str, Any]:
    """Translate the UI model into the backend's validated scheduling model."""
    metadata = form.get("metadata") or {}
    rows = form.get("subjects") or []
    department_id = "DEPT"
    staff = [
        _staff("STF_HOD", "HOD", "HOD", department_id),
        _staff("STF_CC", metadata.get("class_advisor") or "Class Coordinator", "CC", department_id),
    ]
    subjects: list[dict[str, Any]] = []
    requirements: list[dict[str, Any]] = []
    fixed: list[dict[str, Any]] = []
    occupied: set[tuple[str, int]] = set()
    extra_subjects_by_day = {day: set() for day in DAYS}
    ids: set[str] = set()

    for index, row in enumerate(rows, 1):
        subject_id = _unique_id(row.get("acronym") or row.get("code") or f"S{index}", ids)
        staff_id = f"STF_{index}"
        kind = row.get("kind") or "theory"
        theory_hours = _non_negative_int(row.get("weekly_periods"), "weekly_periods")
        lab_hours = _non_negative_int(row.get("lab_periods"), "lab_periods")
        subjects.append({
            "id": subject_id,
            "name": row.get("name") or subject_id,
            "department_id": department_id,
            "has_lab": lab_hours > 0,
            "eligible_staff": [staff_id],
        })
        staff.append(_staff(staff_id, row.get("teacher") or subject_id, "FACULTY", department_id, [subject_id]))
        if kind != "extra" and theory_hours:
            requirements.append({"subject_id": subject_id, "weekly_theory_periods": theory_hours})
        fixed.extend(_reserve_fixed(subject_id, staff_id, lab_hours, "LAB", occupied))
        if kind == "extra":
            placement_mode = str(row.get("placement_mode") or "separate").lower()
            if placement_mode not in {"separate", "continuous"}:
                placement_mode = "separate"
            fixed.extend(_reserve_fixed(subject_id, staff_id, theory_hours, "PLACEMENT", occupied, placement_mode, extra_subjects_by_day))

    for allotment in fixed:
        assigned = next(item for item in staff if item["id"] == allotment["staff_id"])
        day = allotment["day"]
        assigned["external_daily_hours"][day] = assigned["external_daily_hours"].get(day, 0) + len(allotment["period_numbers"])

    return {
        "departments": [{"id": department_id, "name": metadata.get("programme") or "Department", "hod_staff_id": "STF_HOD"}],
        "staff": staff,
        "subjects": subjects,
        "templates": [{"id": "DEFAULT", "days": DAYS, "periods": PERIODS}],
        "classes": [{
            "id": "CLASS_1",
            "name": metadata.get("class_name") or metadata.get("programme") or "Class",
            "department_id": department_id,
            "cc_staff_id": "STF_CC",
            "template_id": "DEFAULT",
            "subjects": requirements,
            "external_allotments": fixed,
        }],
        "overrides": {department_id: {"allow_same_subject_twice_per_day_fallback": True}},
    }


def _staff(staff_id: str, name: str, designation: str, department_id: str, subjects: list[str] | None = None) -> dict[str, Any]:
    return {"id": staff_id, "name": name, "designation": designation, "home_department_id": department_id,
            "subjects_taught": subjects or [], "external_daily_hours": {}}


def _unique_id(value: Any, used: set[str]) -> str:
    base = "_".join(str(value).strip().upper().split()) or "SUBJECT"
    candidate = base
    suffix = 2
    while candidate in used:
        candidate = f"{base}_{suffix}"
        suffix += 1
    used.add(candidate)
    return candidate


def _non_negative_int(value: Any, field: str) -> int:
    try:
        number = int(value or 0)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be a whole number") from exc
    if number < 0:
        raise ValueError(f"{field} cannot be negative")
    return number


def _reserve_fixed(subject_id: str, staff_id: str, hours: int, kind: str,
                   occupied: set[tuple[str, int]], placement_mode: str = "separate",
                   daily_subjects: dict[str, set[str]] | None = None) -> list[dict[str, Any]]:
    if not hours:
        return []
    result: list[dict[str, Any]] = []
    remaining = hours
    reserved_by_day: dict[str, set[int]] = {day: set() for day in DAYS}
    if kind == "PLACEMENT" and placement_mode == "continuous":
        # Extracurricular blocks start at or after Period 3 and never cross a
        # Break/Lunch period, so only the (3,4), (5,6) and (7,8) segments qualify.
        candidates = [
            (day, segment[index:index + hours])
            for day in DAYS
            for segment in ([3, 4], [5, 6], [7, 8])
            for index in range(len(segment) - hours + 1)
            if segment[index:index + hours]
        ]
    elif kind == "PLACEMENT":
        # Extracurricular periods are barred from Period 1 and Period 2.
        candidates = [(day, [period]) for day in DAYS for period in (3, 5, 7, 4, 6, 8)]
    else:
        # Prefer contiguous blocks that do not cross the morning/afternoon gaps.
        candidates = [(day, block) for day in DAYS for block in ([3, 4], [5, 6], [7, 8], [1, 2])]
    while remaining:
        size = remaining if kind == "PLACEMENT" and placement_mode == "continuous" else (min(remaining, 2) if kind == "LAB" else 1)
        feasible = [(day, block[:size]) for day, block in candidates
                    if len(block) >= size
                    and all((day, period) not in occupied for period in block[:size])
                    and (daily_subjects is None or kind != "PLACEMENT" or not daily_subjects[day])
                    and (kind != "PLACEMENT" or placement_mode == "continuous" or all(
                        abs(period - previous) > 1
                        for period in block[:size]
                        for previous in reserved_by_day[day]))]
        choice = min(feasible, key=lambda item: (len(daily_subjects[item[0]]) if daily_subjects else 0, DAYS.index(item[0]), item[1][0]), default=None)
        if choice is None:
            raise ValueError("Fixed lab/extra-curricular periods exceed the 48-slot timetable")
        day, periods = choice
        occupied.update((day, period) for period in periods)
        reserved_by_day[day].update(periods)
        if daily_subjects is not None and kind == "PLACEMENT":
            daily_subjects[day].add(subject_id)
        result.append({"day": day, "period_numbers": periods, "type": kind,
                       "subject_id": subject_id, "staff_id": staff_id})
        remaining -= len(periods)
    return result

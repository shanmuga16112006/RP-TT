from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

from .models import Dataset


def _subject_identity(subject: Any) -> str:
    return str(subject.code or subject.acronym or subject.name or subject.id).strip().casefold()


def _days_adjacent(days: tuple[str, ...], first: str, second: str) -> bool:
    index = days.index(first) if first in days else -1
    if index < 0:
        return False
    return second == days[index - 1] or (index + 1 < len(days) and second == days[index + 1])


def _subject_pattern_conflict(
    dataset: Dataset,
    class_by_id: dict[str, Any],
    first: tuple[str, int, set[str]],
    second: tuple[str, int, set[str]],
) -> bool:
    first_day, first_number, first_owners = first
    second_day, second_number, second_owners = second
    if not any(a != b for a in first_owners for b in second_owners):
        return False
    if first_day == second_day:
        return abs(first_number - second_number) <= 1
    if first_number == second_number:
        reference_class = class_by_id[next(iter(first_owners))]
        days = dataset.templates[reference_class.template_id].days
        return _days_adjacent(days, first_day, second_day)
    return False


def validate_output(dataset: Dataset, timetables: list[dict[str, Any]]) -> list[dict[str, Any]]:
    violations: list[dict[str, Any]] = []
    class_by_id = {section.id: section for section in dataset.classes}
    staff_daily: Counter[tuple[str, str]] = Counter()
    teacher_cells: defaultdict[str, defaultdict[tuple[str, int], set[str]]] = defaultdict(lambda: defaultdict(set))
    subject_cells: defaultdict[str, defaultdict[tuple[str, int], set[str]]] = defaultdict(lambda: defaultdict(set))

    for timetable in timetables:
        class_id = timetable["class_id"]
        section = class_by_id[class_id]
        template = dataset.templates[section.template_id]
        policy = dataset.overrides[section.department_id]
        period_map = {period.period_number: period for period in template.periods if period.type == "TEACHING"}
        counts: Counter[str] = Counter()
        subject_days: defaultdict[str, Counter[str]] = defaultdict(Counter)
        for day_data in timetable["days"]:
            day = day_data["day"]
            theory = [slot for slot in day_data["periods"] if slot["slot_type"] == "THEORY"]
            by_number = {slot["period_number"]: slot for slot in theory}
            for slot in theory:
                subject_id, staff_id, number = slot["subject_id"], slot["staff_id"], slot["period_number"]
                counts[subject_id] += 1
                subject_days[subject_id][day] += 1
                staff_daily[(staff_id, day)] += 1
                subject_cells[_subject_identity(dataset.subjects[subject_id])][(day, number)].add(class_id)
                teacher_cells[staff_id][(day, number)].add(class_id)
                if number == 1 and staff_id in {dataset.departments[section.department_id].hod_staff_id, section.cc_staff_id}:
                    violations.append(_violation(class_id, subject_id, "R3", f"Staff {staff_id} is excluded from Period 1"))
                for other_number, other in by_number.items():
                    if other_number > number and other["subject_id"] == subject_id:
                        first, second = period_map[number], period_map[other_number]
                        if abs(number - other_number) == 1:
                            violations.append(_violation(class_id, subject_id, "R2", f"Consecutive placements on {day}, periods {number} and {other_number}"))
            for slot in day_data["periods"]:
                if slot["slot_type"] == "EXTERNAL" and slot.get("staff_id"):
                    teacher_cells[slot["staff_id"]][(day, slot["period_number"])].add(class_id)
            externals = sorted(
                (slot for slot in day_data["periods"]
                 if slot["slot_type"] == "EXTERNAL" and slot.get("external_type") in {"PLACEMENT", "LIBRARY"}),
                key=lambda slot: slot["period_number"],
            )
            for slot in externals:
                number = slot["period_number"]
                if number < 3:
                    violations.append(_violation(class_id, slot.get("subject_id"), "R18",
                                                 f"Extracurricular activity scheduled in Period {number} on {day}; extracurricular periods must start at or after Period 3"))
            for first, second in zip(externals, externals[1:]):
                if second["period_number"] == first["period_number"] + 1 and first["period_number"] in (2, 4, 6):
                    violations.append(_violation(class_id, second.get("subject_id"), "R18",
                                                 f"Extracurricular block on {day} crosses a Break/Lunch between periods {first['period_number']} and {second['period_number']}"))
            for subject_id, daily_count in Counter(slot["subject_id"] for slot in theory).items():
                allowed = 2 if policy.allow_same_subject_twice_per_day_fallback else 1
                if daily_count > allowed:
                    violations.append(_violation(class_id, subject_id, "R1", f"{daily_count} theory periods on {day}; maximum is {allowed}"))
        for requirement in section.subjects:
            if counts[requirement.subject_id] < requirement.weekly_theory_periods:
                # Missing periods are reported in the unresolved list by the generator.
                continue
            used_periods = [slot["period_number"] for day in timetable["days"] for slot in day["periods"] if slot.get("subject_id") == requirement.subject_id and slot["slot_type"] == "THEORY"]
            if len(used_periods) > 1 and len(set(used_periods)) == 1:
                violations.append(_violation(class_id, requirement.subject_id, "R6", "Every weekly placement uses the same period number"))
        required_theory = sum(requirement.weekly_theory_periods for requirement in section.subjects)
        minimum_daily_theory = 4
        if required_theory >= minimum_daily_theory * len(template.days):
            for day_data in timetable["days"]:
                daily_theory = sum(slot["slot_type"] == "THEORY" for slot in day_data["periods"])
                if daily_theory < minimum_daily_theory:
                    violations.append(_violation(class_id, "*", "DAILY_THEORY_MINIMUM",
                                                 f"{day_data['day']} has {daily_theory} theory periods; minimum is {minimum_daily_theory}"))
        available = sum(1 for period in template.periods if period.type == "TEACHING" and period.period_number not in policy.excluded_periods) * len(template.days)
        required_total = required_theory + sum(len(item.period_numbers) for item in section.external_allotments)
        if required_total == available:
            for day_data in timetable["days"]:
                for slot in day_data["periods"]:
                    if slot["slot_type"] == "OPEN":
                        violations.append(_violation(class_id, "*", "R22",
                                                     f"{day_data['day']} period {slot['period_number']} is empty though every available period is required"))
    for (staff_id, day), assigned in staff_daily.items():
        staff = dataset.staff[staff_id]
        related_classes = [section for section in dataset.classes if any(requirement.subject_id in staff.subjects_taught for requirement in section.subjects)]
        caps = [dataset.overrides[section.department_id].daily_staff_hour_cap for section in related_classes] or [5]
        cap = min(caps)
        if assigned + staff.external_daily_hours.get(day, 0) > cap:
            violations.append(_violation("*", "*", "R4", f"Staff {staff_id} has {assigned} theory plus {staff.external_daily_hours.get(day, 0)} external hours on {day}, above cap {cap}"))

    for staff_id, cells in teacher_cells.items():
        for (day, number), owners in sorted(cells.items()):
            if len(owners) > 1:
                violations.append(_violation("*", "*", "R5",
                                             f"Staff {staff_id} is assigned to multiple classes at {day} period {number}: {', '.join(sorted(owners))}"))
            adjacent_owners = cells.get((day, number + 1))
            if adjacent_owners and any(a != b for a in owners for b in adjacent_owners):
                violations.append(_violation("*", "*", "R10",
                                             f"Staff {staff_id} has continuous periods {number} and {number + 1} on {day} across different classes"))
    for subject_id, cells in subject_cells.items():
        items = sorted(((day, number, owners) for (day, number), owners in cells.items()))
        for index, first in enumerate(items):
            for second in items[index + 1:]:
                if _subject_pattern_conflict(dataset, class_by_id, first, second):
                    first_day, first_number, first_owners = first
                    second_day, second_number, second_owners = second
                    violations.append(_violation("*", subject_id, "R21",
                                                 f"Subject {subject_id} forms a continuous pattern: {first_day} period {first_number} in {', '.join(sorted(first_owners))} vs {second_day} period {second_number} in {', '.join(sorted(second_owners))}"))
    return violations


def _violation(class_id: str, subject_id: str, rule: str, reason: str) -> dict[str, str]:
    return {"class_id": class_id, "subject_id": subject_id, "rule": rule, "reason": reason}
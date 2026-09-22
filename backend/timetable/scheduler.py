from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any

from .models import ClassSection, Dataset, Period
from .validation import validate_output


@dataclass(frozen=True)
class Placement:
    day: str
    period_number: int
    subject_id: str
    staff_id: str


def _subject_identity(subject: Any) -> str:
    """Identify a subject across classes without using a section-specific id."""
    return str(subject.code or subject.acronym or subject.name or subject.id).strip().casefold()


def _are_adjacent(first: Period, second: Period) -> bool:
    return abs(first.period_number - second.period_number) == 1


def _teacher_conflicts(
    teacher_slot_owners: dict[tuple[str, str, int], set[str]],
    staff_id: str,
    day: str,
    number: int,
    class_id: str,
) -> bool:
    """Constraint 1: a teacher assigned to one class during a period must not be
    assigned to a different class during that same period or the next (adjacent)
    period. Own-class occupancy is always allowed."""
    for adjacent in (number - 1, number, number + 1):
        if adjacent < 1:
            continue
        owners = teacher_slot_owners.get((staff_id, day, adjacent)) or ()
        if any(owner != class_id for owner in owners):
            return True
    return False


def _subject_pattern_conflicts(
    subject_slot_owners: dict[tuple[str, str, int], set[str]],
    subject_id: str,
    day: str,
    number: int,
    class_id: str,
    days: tuple[str, ...],
) -> bool:
    """Constraint 2: the same subject must not be allocated in a continuous column
    or row-wise pattern across different classes - the identical slot, the same
    period on an immediately adjacent day, or an adjacent period on the same day."""
    index = days.index(day)
    adjacent_days = {day}
    if index > 0:
        adjacent_days.add(days[index - 1])
    if index + 1 < len(days):
        adjacent_days.add(days[index + 1])
    for probe_day in adjacent_days:
        for probe_number in (number - 1, number, number + 1):
            if probe_number < 1:
                continue
            owners = subject_slot_owners.get((subject_id, probe_day, probe_number)) or ()
            if any(owner != class_id for owner in owners):
                return True
    return False


def _schedule_class(
    dataset: Dataset,
    section: ClassSection,
    staff_load: Counter[tuple[str, str]],
    teacher_slot_owners: dict[tuple[str, str, int], set[str]],
    subject_slot_owners: dict[tuple[str, str, int], set[str]],
    variant_index: int = 0,
) -> tuple[list[Placement], list[dict[str, Any]], list[dict[str, Any]]]:
    template = dataset.templates[section.template_id]
    policy = dataset.overrides[section.department_id]
    periods = {period.period_number: period for period in template.periods if period.type == "TEACHING"}
    external = {(item.day, number): item for item in section.external_allotments for number in item.period_numbers}
    two_period_lab_days = {
        (item.subject_id, item.day)
        for item in section.external_allotments
        if item.type == "LAB" and item.subject_id is not None and len(item.period_numbers) >= 2
    }
    day_names = template.days
    open_slots = [(day, number) for day in day_names for number in sorted(periods) if (day, number) not in external and number not in policy.excluded_periods]
    placements: list[Placement] = []
    warnings: list[dict[str, Any]] = []
    subject_days: Counter[tuple[str, str]] = Counter()
    subject_periods: defaultdict[str, list[int]] = defaultdict(list)
    placed_counts: Counter[str] = Counter()
    day_rank = {day: (index - variant_index) % len(day_names) for index, day in enumerate(day_names)}
    period_numbers = sorted(periods)
    period_rank = {
        number: (index - (variant_index * 2)) % len(period_numbers)
        for index, number in enumerate(period_numbers)
    }
    requirements = sorted(
        section.subjects,
        key=lambda item: (
            len(dataset.subjects[item.subject_id].eligible_staff),
            -item.weekly_theory_periods,
            (sum(ord(char) for char in item.subject_id) + variant_index) % max(len(section.subjects), 1),
            item.subject_id,
        ),
    )

    def check_subject_slot(subject: Any, day: str, number: int) -> tuple[bool, bool] | None:
        """Subject-level validity for placing one period of ``subject`` at (day, number)."""
        same_day_count = subject_days[(subject.id, day)]
        fallback = same_day_count > 0
        same_day_as_lab = (subject.id, day) in two_period_lab_days
        if fallback and (not policy.allow_same_subject_twice_per_day_fallback or same_day_count >= 2):
            return None
        if any(item.day == day and item.subject_id == subject.id and _are_adjacent(periods[number], periods[item.period_number]) for item in placements):
            return None
        if _subject_pattern_conflicts(subject_slot_owners, _subject_identity(subject), day, number, section.id, day_names):
            return None
        return fallback, same_day_as_lab

    def suggest_staff(subject: Any, day: str, number: int) -> tuple[str, bool, bool] | None:
        """Return the first eligible staff member for (subject, day, number), or None."""
        flags = check_subject_slot(subject, day, number)
        if flags is None:
            return None
        fallback, same_day_as_lab = flags
        for staff_id in sorted(subject.eligible_staff):
            department = dataset.departments[section.department_id]
            if number == 1 and staff_id in {department.hod_staff_id, section.cc_staff_id}:
                continue
            external_hours = dataset.staff[staff_id].external_daily_hours.get(day, 0)
            if external_hours + staff_load[(staff_id, day)] >= policy.daily_staff_hour_cap:
                continue
            if _teacher_conflicts(teacher_slot_owners, staff_id, day, number, section.id):
                continue
            return staff_id, fallback, same_day_as_lab
        return None

    def commit(subject: Any, day: str, number: int, staff_id: str, fallback: bool, same_day_as_lab: bool) -> None:
        placements.append(Placement(day, number, subject.id, staff_id))
        open_slots.remove((day, number))
        subject_days[(subject.id, day)] += 1
        subject_periods[subject.id].append(number)
        staff_load[(staff_id, day)] += 1
        placed_counts[subject.id] += 1
        if fallback:
            warnings.append({
                "class_id": section.id, "subject_id": subject.id, "rule": "R5_FALLBACK",
                "reason": f"Placed a second non-adjacent theory period on {day} because the configured fallback policy allows it",
            })
        if same_day_as_lab:
            warnings.append({
                "class_id": section.id,
                "subject_id": subject.id,
                "rule": "LAB_DAY_FALLBACK",
                "reason": f"Placed theory on {day}, which also has a two-period {subject.id} lab, because it was the best remaining valid placement",
            })

    for requirement in requirements:
        subject = dataset.subjects[requirement.subject_id]
        for occurrence in range(requirement.weekly_theory_periods):
            candidates: list[tuple[tuple[Any, ...], str, int, str, bool, bool]] = []
            for day, number in open_slots:
                chosen = suggest_staff(subject, day, number)
                if chosen is None:
                    continue
                staff_id, fallback, same_day_as_lab = chosen
                period_reuse = subject_periods[subject.id].count(number)
                daily_theory_count = sum(1 for item in placements if item.day == day)
                score = (
                    daily_theory_count,
                    same_day_as_lab,
                    subject_days[(subject.id, day)],
                    period_reuse,
                    staff_load[(staff_id, day)],
                    day_rank[day],
                    period_rank[number],
                    staff_id,
                )
                candidates.append((score, day, number, staff_id, fallback, same_day_as_lab))
            if not candidates:
                continue
            _, day, number, staff_id, used_fallback, used_lab_day = min(candidates, key=lambda item: item[0])
            commit(subject, day, number, staff_id, used_fallback, used_lab_day)

    # Constraint 3: when the class requires every available period (e.g. 48 of 48),
    # no period may remain empty. Detect each empty slot, find a suitable subject,
    # allocate it, and recheck - repeating until every required period is filled.
    available_teaching = len([(day, number) for day in day_names for number in periods if number not in policy.excluded_periods])
    required_total = sum(requirement.weekly_theory_periods for requirement in section.subjects) + sum(
        len(item.period_numbers) for item in section.external_allotments
    )
    if required_total == available_teaching:
        backfill_order = sorted(
            section.subjects,
            key=lambda item: (-(item.weekly_theory_periods - placed_counts[item.subject_id]), item.subject_id),
        )
        progress = True
        while progress:
            progress = False
            for day, number in list(open_slots):
                if (day, number) not in open_slots:
                    continue
                for requirement in backfill_order:
                    if placed_counts[requirement.subject_id] >= requirement.weekly_theory_periods:
                        continue
                    subject = dataset.subjects[requirement.subject_id]
                    chosen = suggest_staff(subject, day, number)
                    if chosen is None:
                        continue
                    staff_id, used_fallback, used_lab_day = chosen
                    commit(subject, day, number, staff_id, used_fallback, used_lab_day)
                    progress = True
                    break
            if not open_slots:
                break

        def remove(placement: Placement) -> None:
            placements.remove(placement)
            open_slots.append((placement.day, placement.period_number))
            subject_days[(placement.subject_id, placement.day)] -= 1
            subject_periods[placement.subject_id].remove(placement.period_number)
            staff_load[(placement.staff_id, placement.day)] -= 1
            placed_counts[placement.subject_id] -= 1

        def repair_empty_slot(day: str, number: int) -> bool:
            """Move one non-lab theory cell when direct backfill is blocked."""
            for requirement in backfill_order:
                if placed_counts[requirement.subject_id] >= requirement.weekly_theory_periods:
                    continue
                target = dataset.subjects[requirement.subject_id]
                for donor in list(placements):
                    if donor.subject_id == target.id:
                        continue
                    warning_count = len(warnings)
                    remove(donor)
                    for destination_day, destination_number in list(open_slots):
                        if (destination_day, destination_number) == (day, number):
                            continue
                        donor_choice = suggest_staff(dataset.subjects[donor.subject_id], destination_day, destination_number)
                        if donor_choice is None:
                            continue
                        commit(dataset.subjects[donor.subject_id], destination_day, destination_number, *donor_choice)
                        target_choice = suggest_staff(target, day, number)
                        if target_choice is not None:
                            commit(target, day, number, *target_choice)
                            return True
                        moved = placements[-1]
                        remove(moved)
                        warnings[:] = warnings[:warning_count]
                    restored = suggest_staff(dataset.subjects[donor.subject_id], donor.day, donor.period_number)
                    if restored is not None:
                        commit(dataset.subjects[donor.subject_id], donor.day, donor.period_number, *restored)
                    warnings[:] = warnings[:warning_count]
            return False

        while open_slots:
            repaired = False
            for day, number in list(open_slots):
                if repair_empty_slot(day, number):
                    repaired = True
                    break
            if not repaired:
                break

    # Recompute unresolved requirements from final placed counts so any period
    # filled by the backfill pass is no longer reported.
    unresolved: list[dict[str, Any]] = []
    for requirement in section.subjects:
        deficit = requirement.weekly_theory_periods - placed_counts[requirement.subject_id]
        for occurrence in range(deficit):
            unresolved.append({
                "class_id": section.id,
                "subject_id": requirement.subject_id,
                "rule": "UNRESOLVED",
                "reason": f"No valid slot/staff combination for required occurrence {occurrence + 1} of {requirement.weekly_theory_periods}",
            })
    if required_total == available_teaching and open_slots:
        unresolved.append({
            "class_id": section.id,
            "subject_id": "*",
            "rule": "INFEASIBLE_CAPACITY",
            "reason": f"{len(open_slots)} mandatory teaching slot(s) remain empty after direct placement and relocation repair; no valid arrangement satisfies all active rules",
        })
    return placements, unresolved, warnings


def _serialize_class(dataset: Dataset, section: ClassSection, placements: list[Placement]) -> dict[str, Any]:
    template = dataset.templates[section.template_id]
    theory = {(item.day, item.period_number): item for item in placements}
    external = {(item.day, number): item for item in section.external_allotments for number in item.period_numbers}
    days = []
    for day in template.days:
        slots = []
        for period in sorted(template.periods, key=lambda item: (item.start_time, item.period_number)):
            if period.type != "TEACHING":
                continue
            key = (day, period.period_number)
            if key in theory:
                item = theory[key]
                slots.append({"period_number": period.period_number, "slot_type": "THEORY", "subject_id": item.subject_id, "staff_id": item.staff_id})
            elif key in external:
                item = external[key]
                slot = {"period_number": period.period_number, "slot_type": "EXTERNAL", "external_type": item.type, "subject_id": item.subject_id, "staff_id": item.staff_id}
                slots.append(slot)
            else:
                slots.append({"period_number": period.period_number, "slot_type": "OPEN"})
        days.append({"day": day, "periods": slots})
    return {"class_id": section.id, "days": days}


def _generate_one(dataset: Dataset, variant_index: int = 0) -> dict[str, Any]:
    staff_load: Counter[tuple[str, str]] = Counter()
    teacher_slot_owners: dict[tuple[str, str, int], set[str]] = defaultdict(set)
    subject_slot_owners: dict[tuple[str, str, int], set[str]] = defaultdict(set)
    for section in dataset.classes:
        for allotment in section.external_allotments:
            if allotment.subject_id is not None:
                for number in allotment.period_numbers:
                    subject = dataset.subjects.get(allotment.subject_id)
                subject_slot_owners[(_subject_identity(subject) if subject else allotment.subject_id, allotment.day, number)].add(section.id)
            if allotment.staff_id is not None:
                for number in allotment.period_numbers:
                    teacher_slot_owners[(allotment.staff_id, allotment.day, number)].add(section.id)

    generated = []
    unresolved: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    for section in sorted(dataset.classes, key=lambda item: (item.department_id, item.id)):
        placements, class_unresolved, class_warnings = _schedule_class(
            dataset, section, staff_load, teacher_slot_owners, subject_slot_owners, variant_index
        )
        generated.append(_serialize_class(dataset, section, placements))
        unresolved.extend(class_unresolved)
        warnings.extend(class_warnings)
        for placement in placements:
            teacher_slot_owners[(placement.staff_id, placement.day, placement.period_number)].add(section.id)
            subject_slot_owners[(_subject_identity(dataset.subjects[placement.subject_id]), placement.day, placement.period_number)].add(section.id)
    violations = validate_output(dataset, generated)
    return {
        "timetables": generated,
        "report": {
            "complete": not unresolved and not violations,
            "unresolved": unresolved,
            "violations": violations,
            "warnings": warnings,
            "known_limitations": [],
        },
    }


def generate_timetables(dataset: Dataset, variant_count: int = 1) -> dict[str, Any]:
    if variant_count < 1 or variant_count > 10:
        raise ValueError("variant_count must be between 1 and 10")
    if variant_count == 1:
        return _generate_one(dataset)

    alternatives = []
    incomplete_alternatives = []
    signatures: set[tuple[Any, ...]] = set()
    attempt = 0
    max_attempts = max(100, variant_count * 20)
    while len(alternatives) < variant_count and attempt < max_attempts:
        result = _generate_one(dataset, attempt)
        signature = tuple(
            (timetable["class_id"], day["day"], slot["period_number"], slot.get("subject_id"), slot.get("staff_id"))
            for timetable in result["timetables"]
            for day in timetable["days"]
            for slot in day["periods"]
        )
        if signature not in signatures:
            signatures.add(signature)
            if result["report"]["complete"]:
                alternatives.append({"alternative": len(alternatives) + 1, **result})
            else:
                incomplete_alternatives.append(result)
        attempt += 1

    if len(alternatives) < variant_count:
        for result in incomplete_alternatives[: variant_count - len(alternatives)]:
            alternatives.append({"alternative": len(alternatives) + 1, **result})

    return {
        "alternatives": alternatives,
        "report": {
            "requested": variant_count,
            "generated": len(alternatives),
            "complete": len(alternatives) == variant_count and all(item["report"]["complete"] for item in alternatives),
        },
    }
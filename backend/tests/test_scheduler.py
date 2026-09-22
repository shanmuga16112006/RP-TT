import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from backend.timetable.errors import InputError
from backend.timetable.export import export
from backend.timetable.input import parse_dataset
from backend.timetable.scheduler import generate_timetables
from backend.timetable.validation import validate_output
from frontend.mapping import DAYS, _reserve_fixed, build_dataset


class SchedulerTests(unittest.TestCase):
    def test_empty_dataset_is_valid_and_complete(self):
        raw = json.loads(Path("backend/examples/empty-input.json").read_text(encoding="utf-8"))
        result = generate_timetables(parse_dataset(raw))
        self.assertEqual(result["timetables"], [])
        self.assertTrue(result["report"]["complete"])

    def test_places_subject_with_spread_variety_and_period_one_exclusion(self):
        raw = _dataset(weekly_periods=3)
        result = generate_timetables(parse_dataset(raw))
        slots = [slot for day in result["timetables"][0]["days"] for slot in day["periods"] if slot["slot_type"] == "THEORY"]
        self.assertEqual(len(slots), 3)
        self.assertEqual(len({slot["period_number"] for slot in slots}), 3)
        self.assertNotIn(1, {slot["period_number"] for slot in slots})
        self.assertTrue(result["report"]["complete"])

    def test_unresolvable_periods_are_reported(self):
        raw = _dataset(weekly_periods=4)
        raw["templates"][0]["days"] = ["Day-1", "Day-2"]
        result = generate_timetables(parse_dataset(raw))
        self.assertFalse(result["report"]["complete"])
        self.assertEqual(len(result["report"]["unresolved"]), 2)

    def test_bad_reference_is_rejected(self):
        raw = _dataset(weekly_periods=1)
        raw["classes"][0]["cc_staff_id"] = "missing"
        with self.assertRaises(InputError):
            parse_dataset(raw)

    def test_generates_three_distinct_alternatives(self):
        result = generate_timetables(parse_dataset(_dataset(weekly_periods=3)), variant_count=3)
        self.assertEqual(result["report"]["generated"], 3)
        self.assertTrue(result["report"]["complete"])
        signatures = {
            tuple(
                (day["day"], slot["period_number"], slot.get("subject_id"))
                for day in alternative["timetables"][0]["days"]
                for slot in day["periods"]
            )
            for alternative in result["alternatives"]
        }
        self.assertEqual(len(signatures), 3)

    def test_export_overwrites_tables_and_removes_stale_variants(self):
        with TemporaryDirectory() as directory:
            output = Path(directory)
            input_path = Path("backend/examples/ai-ds-ii-i-input.json")
            export(input_path, output)
            self.assertTrue((output / "timetables.json").exists())
            self.assertTrue((output / "timetable-3.md").exists())

            stale = output / "timetable-4.md"
            stale.write_text("stale", encoding="utf-8")
            export(input_path, output)
            self.assertFalse(stale.exists())
            self.assertIn("Timetable Alternative 1", (output / "timetable-1.md").read_text(encoding="utf-8"))

    def test_avoids_theory_on_two_period_lab_day_when_possible(self):
        raw = _dataset(weekly_periods=2)
        raw["classes"][0]["external_allotments"] = [{
            "day": "Day-1",
            "period_numbers": [3, 4],
            "type": "LAB",
            "subject_id": "MATH",
            "staff_id": "S1",
        }]
        raw["staff"][0]["external_daily_hours"] = {"Day-1": 2}
        raw["subjects"][0]["has_lab"] = True
        result = generate_timetables(parse_dataset(raw))
        theory_days = {
            day["day"]
            for day in result["timetables"][0]["days"]
            for slot in day["periods"]
            if slot["slot_type"] == "THEORY"
        }
        self.assertNotIn("Day-1", theory_days)
        self.assertFalse(any(item["rule"] == "LAB_DAY_FALLBACK" for item in result["report"]["warnings"]))

    def test_two_weekly_theory_periods_are_not_consecutive(self):
        raw = _dataset(weekly_periods=2)
        raw["templates"][0]["days"] = ["Day-1"]
        raw["overrides"] = {"CSE": {"custom_rules": [{"type": "ALLOW_SAME_SUBJECT_TWICE_PER_DAY_FALLBACK", "enabled": True}]}}
        result = generate_timetables(parse_dataset(raw))
        slots = [slot["period_number"] for day in result["timetables"][0]["days"] for slot in day["periods"] if slot["slot_type"] == "THEORY"]
        self.assertEqual(len(slots), 2)
        self.assertNotEqual(abs(slots[0] - slots[1]), 1)
    def test_extra_periods_default_to_separate_and_avoid_first_period(self):
        dataset = parse_dataset(build_dataset({
            "metadata": {},
            "subjects": [{
                "kind": "extra", "code": "EC1", "name": "Club", "teacher": "Teacher",
                "acronym": "CLUB", "weekly_periods": 2, "lab_periods": 0,
            }],
        }))
        placements = [item for item in dataset.classes[0].external_allotments if item.type == "PLACEMENT"]
        slots = [(item.day, number) for item in placements for number in item.period_numbers]
        self.assertEqual(len(slots), 2)
        self.assertTrue(all(period >= 3 for _, period in slots))
        self.assertEqual(len({day for day, _ in slots}), 2)
        occupied = {(day, period) for day in DAYS for period in range(2, 9)}
        with self.assertRaises(ValueError):
            _reserve_fixed('EC1', 'STF_1', 1, 'PLACEMENT', occupied)

    def test_extra_period_mode_can_request_continuous_slots(self):
        dataset = parse_dataset(build_dataset({
            "metadata": {},
            "subjects": [{
                "kind": "extra", "placement_mode": "continuous", "code": "EC1",
                "name": "Club", "teacher": "Teacher", "acronym": "CLUB",
                "weekly_periods": 2, "lab_periods": 0,
            }],
        }))
        placements = [item for item in dataset.classes[0].external_allotments if item.type == "PLACEMENT"]
        slots = [(item.day, number) for item in placements for number in item.period_numbers]
        self.assertEqual(len(slots), 2)
        self.assertEqual(slots[0][0], slots[1][0])
        self.assertEqual(abs(slots[0][1] - slots[1][1]), 1)
        self.assertTrue(all(period >= 3 for _, period in slots))
        self.assertIn(set(period for _, period in slots), ({3, 4}, {5, 6}, {7, 8}))

    def test_extra_hours_respect_selected_continuous_mode_and_one_activity_subject_per_day(self):
        dataset = parse_dataset(build_dataset({
            "metadata": {},
            "subjects": [
                {"kind": "extra", "placement_mode": "continuous", "code": "PT", "name": "Placement Training", "teacher": "Teacher PT", "acronym": "P&T", "weekly_periods": 2, "lab_periods": 0},
                {"kind": "extra", "placement_mode": "continuous", "code": "CS", "name": "Club Seminar", "teacher": "Teacher CS", "acronym": "C/S", "weekly_periods": 2, "lab_periods": 0},
                {"kind": "extra", "placement_mode": "continuous", "code": "LIB", "name": "Library", "teacher": "Teacher LIB", "acronym": "LIB", "weekly_periods": 1, "lab_periods": 0},
            ],
        }))
        placements = [item for item in dataset.classes[0].external_allotments if item.type == "PLACEMENT"]
        by_subject = {}
        for item in placements:
            by_subject.setdefault(item.subject_id, []).extend((item.day, number) for number in item.period_numbers)
        for slots in by_subject.values():
            days = {day for day, _ in slots}
            periods = sorted(number for _, number in slots)
            self.assertEqual(len(days), 1)
            self.assertEqual(periods, list(range(periods[0], periods[0] + len(periods))))
            self.assertTrue(all(number >= 3 for number in periods))
            if len(periods) > 1:
                self.assertIn(set(periods), ({3, 4}, {5, 6}, {7, 8}))
        subjects_by_day = {}
        for item in placements:
            subjects_by_day.setdefault(item.day, set()).add(item.subject_id)
        self.assertTrue(all(len(subjects) <= 1 for subjects in subjects_by_day.values()), subjects_by_day)

    def test_extra_hours_can_be_selected_as_separate_periods(self):
        dataset = parse_dataset(build_dataset({
            "metadata": {},
            "subjects": [{"kind": "extra", "placement_mode": "separate", "code": "PT", "name": "Placement Training", "teacher": "Teacher PT", "acronym": "P&T", "weekly_periods": 3, "lab_periods": 0}],
        }))
        placements = [item for item in dataset.classes[0].external_allotments if item.type == "PLACEMENT"]
        slots = [(item.day, number) for item in placements for number in item.period_numbers]
        self.assertEqual(len(slots), 3)
        self.assertEqual(len({day for day, _ in slots}), 3)
        self.assertTrue(all(period >= 3 for _, period in slots))
    def test_continuous_extra_block_longer_than_two_periods_is_unplaceable(self):
        with self.assertRaises(ValueError):
            parse_dataset(build_dataset({
                "metadata": {},
                "subjects": [{"kind": "extra", "placement_mode": "continuous", "code": "PT",
                              "name": "Placement Training", "teacher": "Teacher PT", "acronym": "P&T",
                              "weekly_periods": 3, "lab_periods": 0}],
            }))

    def test_extra_blocks_never_start_before_period_three_across_modes(self):
        dataset = parse_dataset(build_dataset({
            "metadata": {},
            "subjects": [
                {"kind": "extra", "placement_mode": "separate", "code": "SG", "name": "Sports", "teacher": "Teacher SG", "acronym": "S/G", "weekly_periods": 1, "lab_periods": 0},
                {"kind": "extra", "placement_mode": "continuous", "code": "YO", "name": "Yoga", "teacher": "Teacher YO", "acronym": "Y/O", "weekly_periods": 2, "lab_periods": 0},
                {"kind": "extra", "placement_mode": "separate", "code": "NA", "name": "NSS", "teacher": "Teacher NA", "acronym": "N/A", "weekly_periods": 2, "lab_periods": 0},
            ],
        }))
        placements = [item for item in dataset.classes[0].external_allotments if item.type == "PLACEMENT"]
        self.assertEqual(sum(len(item.period_numbers) for item in placements), 5)
        self.assertTrue(len({item.subject_id for item in placements}) == 3)
        for item in placements:
            self.assertTrue(all(number >= 3 for number in item.period_numbers), item.period_numbers)

    def test_validation_rejects_extracurricular_before_period_three_and_across_break(self):
        dataset = parse_dataset(build_dataset({
            "metadata": {},
            "subjects": [{"kind": "extra", "code": "EC1", "name": "Club", "teacher": "Teacher", "acronym": "CLUB", "weekly_periods": 1, "lab_periods": 0}],
        }))
        timetables = [{
            "class_id": dataset.classes[0].id,
            "days": [{"day": "MON", "periods": [
                {"period_number": 2, "slot_type": "EXTERNAL", "external_type": "PLACEMENT", "subject_id": "EC1", "staff_id": "STF_EC1"},
                {"period_number": 4, "slot_type": "EXTERNAL", "external_type": "LIBRARY", "subject_id": "EC2", "staff_id": "STF_EC2"},
                {"period_number": 5, "slot_type": "EXTERNAL", "external_type": "LIBRARY", "subject_id": "EC2", "staff_id": "STF_EC2"},
                {"period_number": 2, "slot_type": "EXTERNAL", "external_type": "LAB", "subject_id": "LAB1", "staff_id": "STF_LAB"},
            ]}],
        }]
        r18 = [item["reason"] for item in validate_output(dataset, timetables) if item["rule"] == "R18"]
        self.assertEqual(len(r18), 2, r18)
        self.assertTrue(any("Period 2" in reason for reason in r18), r18)
        self.assertTrue(any("crosses a Break/Lunch between periods 4 and 5" in reason for reason in r18), r18)
        r18_lab = [reason for reason in r18 if "LAB1" in reason]
        self.assertEqual(r18_lab, [], "LAB periods must not be flagged by the extracurricular rule")

    def test_balances_feasible_theory_load_across_each_day(self):
        raw = _balanced_dataset(subject_count=5, weekly_periods=5)
        result = generate_timetables(parse_dataset(raw))
        daily_theory = {
            day["day"]: sum(slot["slot_type"] == "THEORY" for slot in day["periods"])
            for day in result["timetables"][0]["days"]
        }
        self.assertTrue(all(count >= 4 for count in daily_theory.values()), daily_theory)
        self.assertTrue(result["report"]["complete"])

    def test_teacher_never_allocated_adjacent_periods_across_classes(self):
        raw = _multi_class_dataset()
        result = generate_timetables(parse_dataset(raw))
        self.assertTrue(result["report"]["complete"], result["report"])
        cells = _theory_cells(result["timetables"])
        by_teacher = {}
        for class_id, mappings in cells.items():
            for (day, number), (subject_id, staff_id) in mappings.items():
                by_teacher.setdefault(staff_id, []).append((class_id, day, number))
        for staff_id, entries in by_teacher.items():
            for index, first in enumerate(entries):
                for second in entries[index + 1:]:
                    first_class, first_day, first_number = first
                    second_class, second_day, second_number = second
                    double_booked = first_class != second_class and first_day == second_day and first_number == second_number
                    continuous = first_class != second_class and first_day == second_day and abs(first_number - second_number) == 1
                    self.assertFalse(double_booked, f"Staff {staff_id} double-booked: {first} vs {second}")
                    self.assertFalse(continuous, f"Staff {staff_id} continuous across classes: {first} vs {second}")

    def test_same_subject_not_allocated_in_continuous_pattern_across_classes(self):
        raw = _multi_class_dataset()
        result = generate_timetables(parse_dataset(raw))
        self.assertTrue(result["report"]["complete"], result["report"])
        cells = _theory_cells(result["timetables"])
        days = raw["templates"][0]["days"]
        by_subject = {}
        for class_id, mappings in cells.items():
            for (day, number), (subject_id, _) in mappings.items():
                by_subject.setdefault(subject_id, []).append((class_id, day, number))
        for subject_id, entries in by_subject.items():
            for index, first in enumerate(entries):
                for second in entries[index + 1:]:
                    first_class, first_day, first_number = first
                    second_class, second_day, second_number = second
                    if first_class == second_class:
                        continue
                    same_slot = first_day == second_day and first_number == second_number
                    same_column_adjacent = first_number == second_number and abs(days.index(first_day) - days.index(second_day)) == 1
                    same_row_adjacent = first_day == second_day and abs(first_number - second_number) == 1
                    self.assertFalse(same_slot, f"Subject {subject_id} in same slot: {first} vs {second}")
                    self.assertFalse(same_column_adjacent, f"Subject {subject_id} continuous column: {first} vs {second}")
                    self.assertFalse(same_row_adjacent, f"Subject {subject_id} continuous row: {first} vs {second}")

    def test_full_capacity_timetable_has_no_empty_periods(self):
        raw = _full_capacity_dataset()
        result = generate_timetables(parse_dataset(raw))
        self.assertTrue(result["report"]["complete"], result["report"])
        self.assertFalse(any(item["rule"] == "R22" for item in result["report"]["violations"]))
        for timetable in result["timetables"]:
            opens = [
                (day["day"], slot["period_number"])
                for day in timetable["days"]
                for slot in day["periods"]
                if slot["slot_type"] == "OPEN"
            ]
            self.assertEqual(opens, [], f"{timetable['class_id']} has empty periods: {opens}")

    def test_empty_periods_are_backfilled_when_all_48_required(self):
        raw = _backfill_dataset()
        result = generate_timetables(parse_dataset(raw))
        self.assertFalse(result["report"]["complete"])
        self.assertEqual(len([item for item in result["report"]["unresolved"] if item["rule"] == "UNRESOLVED"]), 8)
        self.assertTrue(any(item["rule"] == "INFEASIBLE_CAPACITY" for item in result["report"]["unresolved"]))
        self.assertTrue(any(item["rule"] == "R22" for item in result["report"]["violations"]))
        opens = [
            (day["day"], slot["period_number"])
            for day in result["timetables"][0]["days"]
            for slot in day["periods"]
            if slot["slot_type"] == "OPEN"
        ]
        self.assertEqual(len(opens), 8, f"unexpected mandatory-slot result: {opens}")


def _theory_cells(timetables):
    return {
        timetable["class_id"]: {
            (day["day"], slot["period_number"]): (slot["subject_id"], slot["staff_id"])
            for day in timetable["days"]
            for slot in day["periods"]
            if slot["slot_type"] == "THEORY"
        }
        for timetable in timetables
    }


def _multi_class_dataset():
    periods = [
        {"period_number": 1, "start_time": "09:00", "end_time": "10:00", "type": "TEACHING"},
        {"period_number": 2, "start_time": "10:00", "end_time": "11:00", "type": "TEACHING"},
        {"period_number": 3, "start_time": "11:15", "end_time": "12:15", "type": "TEACHING"},
        {"period_number": 4, "start_time": "12:15", "end_time": "13:00", "type": "TEACHING"},
        {"period_number": 5, "start_time": "13:40", "end_time": "14:20", "type": "TEACHING"},
        {"period_number": 6, "start_time": "14:20", "end_time": "15:00", "type": "TEACHING"},
        {"period_number": 7, "start_time": "15:10", "end_time": "15:50", "type": "TEACHING"},
        {"period_number": 8, "start_time": "15:50", "end_time": "16:30", "type": "TEACHING"},
    ]
    days = ["Day-1", "Day-2", "Day-3", "Day-4", "Day-5", "Day-6"]
    return {
        "departments": [{"id": "CSE", "name": "CSE", "hod_staff_id": "S_HOD"}],
        "staff": [
            {"id": "S_HOD", "name": "HOD", "designation": "HOD", "home_department_id": "CSE", "subjects_taught": [], "external_daily_hours": {}},
            {"id": "S_DDM", "name": "A", "designation": "FACULTY", "home_department_id": "CSE", "subjects_taught": ["DDM"], "external_daily_hours": {}},
            {"id": "S_MATH", "name": "B", "designation": "FACULTY", "home_department_id": "CSE", "subjects_taught": ["MATH"], "external_daily_hours": {}},
        ],
        "subjects": [
            {"id": "DDM", "name": "DDM", "department_id": "CSE", "has_lab": False, "eligible_staff": ["S_DDM"]},
            {"id": "MATH", "name": "MATH", "department_id": "CSE", "has_lab": False, "eligible_staff": ["S_MATH"]},
        ],
        "templates": [{"id": "T", "days": days, "periods": periods}],
        "classes": [
            {"id": "A", "name": "A", "department_id": "CSE", "cc_staff_id": "S_HOD", "template_id": "T",
             "subjects": [{"subject_id": "DDM", "weekly_theory_periods": 3}, {"subject_id": "MATH", "weekly_theory_periods": 3}], "external_allotments": []},
            {"id": "B", "name": "B", "department_id": "CSE", "cc_staff_id": "S_HOD", "template_id": "T",
             "subjects": [{"subject_id": "DDM", "weekly_theory_periods": 3}, {"subject_id": "MATH", "weekly_theory_periods": 3}], "external_allotments": []},
        ],
        "overrides": {},
    }


def _full_capacity_dataset():
    periods = [
        {"period_number": number, "start_time": str(number), "end_time": str(number + 1), "type": "TEACHING"}
        for number in range(1, 9)
    ]
    staff = [{"id": "S_HOD", "name": "HOD", "designation": "HOD", "home_department_id": "D", "subjects_taught": [], "external_daily_hours": {}}]
    subjects = []
    requirements = []
    for index in range(1, 13):
        subject_id = f"S{index}"
        staff.append({"id": f"STF_{index}", "name": f"T{index}", "designation": "FACULTY", "home_department_id": "D", "subjects_taught": [subject_id], "external_daily_hours": {}})
        subjects.append({"id": subject_id, "name": subject_id, "department_id": "D", "has_lab": False, "eligible_staff": [f"STF_{index}"]})
        requirements.append({"subject_id": subject_id, "weekly_theory_periods": 4})
    return {
        "departments": [{"id": "D", "name": "Dept", "hod_staff_id": "S_HOD"}],
        "staff": staff,
        "subjects": subjects,
        "templates": [{"id": "T", "days": ["D1", "D2", "D3", "D4", "D5", "D6"], "periods": periods}],
        "classes": [{"id": "C", "name": "Class", "department_id": "D", "cc_staff_id": "S_HOD", "template_id": "T", "subjects": requirements, "external_allotments": []}],
        "overrides": {},
    }


def _backfill_dataset():
    periods = [
        {"period_number": number, "start_time": str(number), "end_time": str(number + 1), "type": "TEACHING"}
        for number in range(1, 9)
    ]
    staff = [{"id": "S_HOD", "name": "HOD", "designation": "HOD", "home_department_id": "D", "subjects_taught": [], "external_daily_hours": {}}]
    subjects = []
    requirements = []
    for index in range(1, 8):
        subject_id = f"A{index}"
        staff.append({"id": f"STF_{index}", "name": f"T{index}", "designation": "FACULTY", "home_department_id": "D", "subjects_taught": [subject_id], "external_daily_hours": {}})
        subjects.append({"id": subject_id, "name": subject_id, "department_id": "D", "has_lab": False, "eligible_staff": [f"STF_{index}"]})
        requirements.append({"subject_id": subject_id, "weekly_theory_periods": 4})
    staff.append({"id": "STF_MATH", "name": "TM", "designation": "FACULTY", "home_department_id": "D", "subjects_taught": ["MATH"], "external_daily_hours": {}})
    subjects.append({"id": "MATH", "name": "MATH", "department_id": "D", "has_lab": False, "eligible_staff": ["STF_MATH"]})
    requirements.append({"subject_id": "MATH", "weekly_theory_periods": 20})
    return {
        "departments": [{"id": "D", "name": "Dept", "hod_staff_id": "S_HOD"}],
        "staff": staff,
        "subjects": subjects,
        "templates": [{"id": "T", "days": ["D1", "D2", "D3", "D4", "D5", "D6"], "periods": periods}],
        "classes": [{"id": "C", "name": "Class", "department_id": "D", "cc_staff_id": "S_HOD", "template_id": "T", "subjects": requirements, "external_allotments": []}],
        "overrides": {"D": {"custom_rules": [{"type": "ALLOW_SAME_SUBJECT_TWICE_PER_DAY_FALLBACK", "enabled": True}]}},
    }

def _balanced_dataset(subject_count: int, weekly_periods: int):
    periods = [
        {"period_number": number, "start_time": str(number), "end_time": str(number + 1), "type": "TEACHING"}
        for number in range(1, 9)
    ]
    staff = [{"id": "S0", "name": "HOD", "designation": "HOD", "home_department_id": "D", "subjects_taught": [], "external_daily_hours": {}}]
    subjects = []
    requirements = []
    for index in range(1, subject_count + 1):
        subject_id = f"S{index}"
        staff.append({"id": subject_id, "name": subject_id, "designation": "FACULTY", "home_department_id": "D", "subjects_taught": [subject_id], "external_daily_hours": {}})
        subjects.append({"id": subject_id, "name": subject_id, "department_id": "D", "has_lab": False, "eligible_staff": [subject_id]})
        requirements.append({"subject_id": subject_id, "weekly_theory_periods": weekly_periods})
    return {
        "departments": [{"id": "D", "name": "Department", "hod_staff_id": "S0"}],
        "staff": staff,
        "subjects": subjects,
        "templates": [{"id": "T", "days": ["D1", "D2", "D3", "D4", "D5", "D6"], "periods": periods}],
        "classes": [{"id": "C", "name": "Class", "department_id": "D", "cc_staff_id": "S0", "template_id": "T", "subjects": requirements, "external_allotments": []}],
        "overrides": {},
    }
def _dataset(weekly_periods: int):
    periods = [
        {"period_number": 1, "start_time": "09:00", "end_time": "10:00", "type": "TEACHING"},
        {"period_number": 2, "start_time": "10:00", "end_time": "11:00", "type": "TEACHING"},
        {"period_number": 3, "start_time": "11:15", "end_time": "12:15", "type": "TEACHING"},
        {"period_number": 4, "start_time": "12:15", "end_time": "13:00", "type": "TEACHING"},
    ]
    return {
        "departments": [{"id": "CSE", "name": "Computer Science", "hod_staff_id": "S1"}],
        "staff": [{"id": "S1", "name": "Teacher", "designation": "HOD", "home_department_id": "CSE", "subjects_taught": ["MATH"], "external_daily_hours": {}}],
        "subjects": [{"id": "MATH", "name": "Math", "department_id": "CSE", "has_lab": False, "eligible_staff": ["S1"]}],
        "templates": [{"id": "T1", "days": ["Day-1", "Day-2", "Day-3"], "periods": periods}],
        "classes": [{"id": "CSE_A", "name": "Section A", "department_id": "CSE", "cc_staff_id": "S1", "template_id": "T1", "subjects": [{"subject_id": "MATH", "weekly_theory_periods": weekly_periods}], "external_allotments": []}],
        "overrides": {},
    }


if __name__ == "__main__":
    unittest.main()

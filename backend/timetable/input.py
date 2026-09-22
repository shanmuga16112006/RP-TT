from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .errors import InputError
from .models import ClassSection, ClassSubject, Dataset, Department, ExternalAllotment, Policy, Staff, Subject, Template, _required


def _unique(items: list[Any], kind: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for item in items:
        if item.id in result:
            raise InputError(f"duplicate {kind} id {item.id!r}")
        result[item.id] = item
    return result


def _parse_policy(data: dict[str, Any], path: str) -> Policy:
    rules = data.get("custom_rules", [])
    if not isinstance(rules, list):
        raise InputError(f"{path}.custom_rules must be a list")
    cap = 5
    fallback = False
    excluded: list[int] = []
    for index, rule in enumerate(rules):
        rule_path = f"{path}.custom_rules[{index}]"
        if not isinstance(rule, dict):
            raise InputError(f"{rule_path} must be an object")
        kind = rule.get("type")
        if kind == "DAILY_STAFF_HOUR_CAP":
            cap = _required(rule, "value", int, rule_path)
            if cap < 1:
                raise InputError(f"{rule_path}.value must be positive")
        elif kind == "EXCLUDE_PERIODS":
            values = _required(rule, "period_numbers", list, rule_path)
            if any(not isinstance(value, int) or isinstance(value, bool) or value < 1 for value in values):
                raise InputError(f"{rule_path}.period_numbers must contain positive integers")
            excluded.extend(values)
        elif kind == "ALLOW_SAME_SUBJECT_TWICE_PER_DAY_FALLBACK":
            fallback = _required(rule, "enabled", bool, rule_path)
        else:
            raise InputError(f"{rule_path}.type is unknown: {kind!r}")
    return Policy(cap, fallback, tuple(sorted(set(excluded))))


def parse_dataset(data: Any, overrides_dir: str | Path = "overrides") -> Dataset:
    if not isinstance(data, dict):
        raise InputError("request body must be a JSON object")
    departments = _unique([Department.parse(item, f"departments[{i}]") for i, item in enumerate(_required(data, "departments", list, "input"))], "department")
    staff = _unique([Staff.parse(item, f"staff[{i}]") for i, item in enumerate(_required(data, "staff", list, "input"))], "staff")
    subjects = _unique([Subject.parse(item, f"subjects[{i}]") for i, item in enumerate(_required(data, "subjects", list, "input"))], "subject")
    templates = _unique([Template.parse(item, f"templates[{i}]") for i, item in enumerate(_required(data, "templates", list, "input"))], "template")

    classes: list[ClassSection] = []
    for index, raw in enumerate(_required(data, "classes", list, "input")):
        path = f"classes[{index}]"
        template_id = _required(raw, "template_id", str, path)
        if template_id not in templates:
            raise InputError(f"{path}.template_id references unknown template {template_id!r}")
        class_subjects = []
        for subject_index, item in enumerate(_required(raw, "subjects", list, path)):
            item_path = f"{path}.subjects[{subject_index}]"
            count = _required(item, "weekly_theory_periods", int, item_path)
            if count < 0:
                raise InputError(f"{item_path}.weekly_theory_periods cannot be negative")
            class_subjects.append(ClassSubject(_required(item, "subject_id", str, item_path), count))
        allotments = tuple(ExternalAllotment.parse(item, f"{path}.external_allotments[{i}]", templates[template_id].days) for i, item in enumerate(_required(raw, "external_allotments", list, path)))
        classes.append(ClassSection(
            _required(raw, "id", str, path), _required(raw, "name", str, path),
            _required(raw, "department_id", str, path), _required(raw, "cc_staff_id", str, path),
            template_id, tuple(class_subjects), allotments,
        ))
    if len({item.id for item in classes}) != len(classes):
        raise InputError("class ids must be unique")

    inline = data.get("overrides", {})
    if not isinstance(inline, dict):
        raise InputError("input.overrides must be an object keyed by department id")
    policies: dict[str, Policy] = {}
    base = Path(overrides_dir)
    for department_id in departments:
        override = inline.get(department_id)
        override_path = base / f"{department_id}.json"
        if override is None and override_path.exists():
            try:
                override = json.loads(override_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise InputError(f"cannot read {override_path}: {exc}") from exc
        policies[department_id] = _parse_policy(override, f"overrides.{department_id}") if override is not None else Policy()

    dataset = Dataset(departments, classes, staff, subjects, templates, policies)
    validate_references(dataset)
    return dataset


def validate_references(dataset: Dataset) -> None:
    for department in dataset.departments.values():
        if department.hod_staff_id not in dataset.staff:
            raise InputError(f"department {department.id!r} references unknown HOD staff {department.hod_staff_id!r}")
    for subject in dataset.subjects.values():
        if subject.department_id not in dataset.departments:
            raise InputError(f"subject {subject.id!r} references unknown department")
        for staff_id in subject.eligible_staff:
            if staff_id not in dataset.staff:
                raise InputError(f"subject {subject.id!r} references unknown eligible staff {staff_id!r}")
            if subject.id not in dataset.staff[staff_id].subjects_taught:
                raise InputError(f"subject {subject.id!r} lists staff {staff_id!r}, but that staff does not list the subject")
    for section in dataset.classes:
        if section.department_id not in dataset.departments:
            raise InputError(f"class {section.id!r} references unknown department")
        if section.cc_staff_id not in dataset.staff:
            raise InputError(f"class {section.id!r} references unknown CC staff")
        teaching = {period.period_number for period in dataset.templates[section.template_id].periods if period.type == "TEACHING"}
        seen_subjects: set[str] = set()
        occupied: set[tuple[str, int]] = set()
        for requirement in section.subjects:
            if requirement.subject_id not in dataset.subjects:
                raise InputError(f"class {section.id!r} references unknown subject {requirement.subject_id!r}")
            if requirement.subject_id in seen_subjects:
                raise InputError(f"class {section.id!r} repeats subject requirement {requirement.subject_id!r}")
            seen_subjects.add(requirement.subject_id)
        for allotment in section.external_allotments:
            if allotment.subject_id is not None and allotment.subject_id not in dataset.subjects:
                raise InputError(f"class {section.id!r} external allotment references unknown subject")
            if allotment.staff_id is not None and allotment.staff_id not in dataset.staff:
                raise InputError(f"class {section.id!r} external allotment references unknown staff")
            for number in allotment.period_numbers:
                key = (allotment.day, number)
                if number not in teaching:
                    raise InputError(f"class {section.id!r} external allotment uses non-teaching period {number}")
                if key in occupied:
                    raise InputError(f"class {section.id!r} has overlapping external allotments at {key}")
                occupied.add(key)


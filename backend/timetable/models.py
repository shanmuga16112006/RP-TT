from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from .errors import InputError

DayKey = str
PeriodType = Literal["TEACHING", "BREAK", "LUNCH"]
ExternalType = Literal["LAB", "PLACEMENT", "LIBRARY"]


def _required(data: dict[str, Any], key: str, expected: type, path: str) -> Any:
    if key not in data:
        raise InputError(f"{path}.{key} is required")
    value = data[key]
    if not isinstance(value, expected) or expected is int and isinstance(value, bool):
        raise InputError(f"{path}.{key} must be {expected.__name__}")
    return value


def _string_list(value: Any, path: str) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise InputError(f"{path} must be a list of strings")
    return value


@dataclass(frozen=True)
class Department:
    id: str
    name: str
    hod_staff_id: str

    @classmethod
    def parse(cls, data: dict[str, Any], path: str) -> Department:
        return cls(_required(data, "id", str, path), _required(data, "name", str, path), _required(data, "hod_staff_id", str, path))


@dataclass(frozen=True)
class Staff:
    id: str
    name: str
    designation: str
    home_department_id: str
    subjects_taught: tuple[str, ...]
    external_daily_hours: dict[DayKey, int]

    @classmethod
    def parse(cls, data: dict[str, Any], path: str) -> Staff:
        designation = _required(data, "designation", str, path)
        if designation not in {"HOD", "CC", "FACULTY"}:
            raise InputError(f"{path}.designation has unsupported value {designation!r}")
        hours = _required(data, "external_daily_hours", dict, path)
        for day, value in hours.items():
            if not isinstance(day, str) or not isinstance(value, int) or isinstance(value, bool) or value < 0:
                raise InputError(f"{path}.external_daily_hours must map day names to non-negative integers")
        return cls(
            _required(data, "id", str, path),
            _required(data, "name", str, path),
            designation,
            _required(data, "home_department_id", str, path),
            tuple(_string_list(_required(data, "subjects_taught", list, path), f"{path}.subjects_taught")),
            dict(hours),
        )


@dataclass(frozen=True)
class Subject:
    id: str
    name: str
    department_id: str
    has_lab: bool
    eligible_staff: tuple[str, ...]
    code: str | None = None
    acronym: str | None = None

    @classmethod
    def parse(cls, data: dict[str, Any], path: str) -> Subject:
        return cls(
            _required(data, "id", str, path),
            _required(data, "name", str, path),
            _required(data, "department_id", str, path),
            _required(data, "has_lab", bool, path),
            tuple(_string_list(_required(data, "eligible_staff", list, path), f"{path}.eligible_staff")),
            data.get("code"),
            data.get("acronym"),
        )


@dataclass(frozen=True)
class Period:
    period_number: int
    start_time: str
    end_time: str
    type: PeriodType

    @classmethod
    def parse(cls, data: dict[str, Any], path: str) -> Period:
        kind = _required(data, "type", str, path)
        if kind not in {"TEACHING", "BREAK", "LUNCH"}:
            raise InputError(f"{path}.type has unsupported value {kind!r}")
        number = _required(data, "period_number", int, path)
        if number < 1:
            raise InputError(f"{path}.period_number must be positive")
        return cls(number, _required(data, "start_time", str, path), _required(data, "end_time", str, path), kind)  # type: ignore[arg-type]


@dataclass(frozen=True)
class Template:
    id: str
    days: tuple[DayKey, ...]
    periods: tuple[Period, ...]

    @classmethod
    def parse(cls, data: dict[str, Any], path: str) -> Template:
        periods = tuple(Period.parse(item, f"{path}.periods[{index}]") for index, item in enumerate(_required(data, "periods", list, path)))
        return cls(_required(data, "id", str, path), tuple(_string_list(_required(data, "days", list, path), f"{path}.days")), periods)


@dataclass(frozen=True)
class ExternalAllotment:
    day: DayKey
    period_numbers: tuple[int, ...]
    type: ExternalType
    subject_id: str | None = None
    staff_id: str | None = None

    @classmethod
    def parse(cls, data: dict[str, Any], path: str, days: tuple[str, ...]) -> ExternalAllotment:
        raw_day = data.get("day")
        if isinstance(raw_day, int) and not isinstance(raw_day, bool):
            if raw_day < 1 or raw_day > len(days):
                raise InputError(f"{path}.day is outside the template day range")
            day = days[raw_day - 1]
        elif isinstance(raw_day, str) and raw_day in days:
            day = raw_day
        else:
            raise InputError(f"{path}.day must be a 1-based day number or template day name")
        numbers = _required(data, "period_numbers", list, path)
        if any(not isinstance(number, int) or isinstance(number, bool) or number < 1 for number in numbers):
            raise InputError(f"{path}.period_numbers must contain positive integers")
        kind = _required(data, "type", str, path)
        if kind not in {"LAB", "PLACEMENT", "LIBRARY"}:
            raise InputError(f"{path}.type has unsupported value {kind!r}")
        subject_id = data.get("subject_id")
        staff_id = data.get("staff_id")
        if subject_id is not None and not isinstance(subject_id, str) or staff_id is not None and not isinstance(staff_id, str):
            raise InputError(f"{path}.subject_id and staff_id must be strings or null")
        if kind == "LAB" and not subject_id:
            raise InputError(f"{path}.subject_id is required for LAB allotments")
        return cls(day, tuple(numbers), kind, subject_id, staff_id)  # type: ignore[arg-type]


@dataclass(frozen=True)
class ClassSubject:
    subject_id: str
    weekly_theory_periods: int


@dataclass(frozen=True)
class ClassSection:
    id: str
    name: str
    department_id: str
    cc_staff_id: str
    template_id: str
    subjects: tuple[ClassSubject, ...]
    external_allotments: tuple[ExternalAllotment, ...]


@dataclass(frozen=True)
class Policy:
    daily_staff_hour_cap: int = 5
    allow_same_subject_twice_per_day_fallback: bool = False
    excluded_periods: tuple[int, ...] = ()


@dataclass
class Dataset:
    departments: dict[str, Department]
    classes: list[ClassSection]
    staff: dict[str, Staff]
    subjects: dict[str, Subject]
    templates: dict[str, Template]
    overrides: dict[str, Policy] = field(default_factory=dict)


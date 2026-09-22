from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, render_template, request

from backend.timetable.errors import InputError
from backend.timetable.input import parse_dataset
from backend.timetable.scheduler import generate_timetables
from frontend.mapping import build_dataset


app = Flask(__name__, template_folder="templates", static_folder="static")
_LOGO_PATH = Path(__file__).parent / "static" / "rpsit_logo.jpeg"
_BACKEND_TIMETABLES = Path(__file__).parents[1] / "backend" / "generated" / "timetables.json"


def _generate(form: dict[str, Any]) -> dict[str, Any]:
    dataset = parse_dataset(build_dataset(form), Path(__file__).parents[1] / "backend" / "overrides")
    result = generate_timetables(dataset, variant_count=1)
    result["subjects_meta"] = form.get("subjects", [])
    result["metadata"] = form.get("metadata", {})
    return result


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/api/generate")
def api_generate():
    try:
        return jsonify(_generate(request.get_json(silent=True) or {}))
    except (InputError, ValueError) as exc:
        return jsonify({"error": "invalid_input", "message": str(exc)}), 400


@app.get("/api/timetables/1")
def api_timetable_one():
    """Expose backend alternative 1 in the same shape as a generated result."""
    try:
        payload = json.loads(_BACKEND_TIMETABLES.read_text(encoding="utf-8"))
        if "alternatives" in payload:
            alternative = next(
                (item for item in payload["alternatives"] if item.get("alternative") == 1),
                payload["alternatives"][0],
            )
        else:
            alternative = payload
        return jsonify({
            "alternative": 1,
            "source": "backend/generated/timetables.json",
            "timetables": alternative.get("timetables", []),
            "report": alternative.get("report", {}),
        })
    except (OSError, ValueError, IndexError, TypeError) as exc:
        return jsonify({"error": "timetable_not_available", "message": str(exc)}), 404


@app.post("/render")
def render_timetable():
    try:
        form = request.get_json(silent=True) or {}
        result = _generate(form)
    except (InputError, ValueError) as exc:
        return render_template("error.html", message=str(exc)), 400
    timetable = result["timetables"][0]
    labels = {(day["day"], slot["period_number"]): _slot_label(slot)
              for day in timetable["days"] for slot in day["periods"]}
    days = [{"label": f"Day-{index}", "cells": [labels.get((day, period), "") for period in range(1, 9)]}
            for index, day in enumerate(("MON", "TUE", "WED", "THU", "FRI", "SAT"), 1)]
    metadata = form.get("metadata") or {}
    subjects = [{"sno": index, **row} for index, row in enumerate(form.get("subjects") or [], 1)]
    subjects.extend({} for _ in range(max(0, 15 - len(subjects))))
    logo = "data:image/jpeg;base64," + base64.b64encode(_LOGO_PATH.read_bytes()).decode("ascii")
    return render_template("timetable_template.html", doc_id=metadata.get("document_id", ""), doc_name="Time Table",
                           programme=metadata.get("programme", ""), year_sem=metadata.get("year_sem", ""),
                           regulation=metadata.get("regulation", ""), odd_even=metadata.get("odd_even", ""),
                           academic_year=metadata.get("academic_year", ""), wef=metadata.get("wef", ""),
                           class_advisor=metadata.get("class_advisor", ""), section=metadata.get("section", "A"),
                           logo_src=logo, days=days, subjects=subjects)


def _slot_label(slot: dict[str, Any]) -> str:
    if not slot.get("subject_id"):
        return ""
    suffix = " LAB" if slot.get("external_type") == "LAB" else ""
    return f"{slot['subject_id']}{suffix}"


def main() -> None:
    app.run(host="127.0.0.1", port=8000, debug=False)


if __name__ == "__main__":
    main()

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .input import parse_dataset
from .scheduler import generate_timetables


def _markdown_table(alternative: dict[str, Any]) -> str:
    timetable = alternative["timetables"][0]
    days = timetable["days"]
    period_numbers = [slot["period_number"] for slot in days[0]["periods"]] if days else []
    headers = ["Day", *(f"P{number}" for number in period_numbers)]
    lines = [
        f"# Timetable Alternative {alternative['alternative']}",
        "",
        "Fixed external periods are marked with `*`.",
        "",
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---", *("---" for _ in period_numbers)]) + " |",
    ]
    for day in days:
        values = []
        for slot in day["periods"]:
            value = slot.get("subject_id", "OPEN")
            if slot["slot_type"] == "EXTERNAL":
                value += "*"
            values.append(value)
        lines.append("| " + " | ".join([day["day"], *values]) + " |")
    report = alternative["report"]
    lines.extend([
        "",
        f"Complete: **{str(report['complete']).lower()}**  ",
        f"Unresolved: **{len(report['unresolved'])}**  ",
        f"Violations: **{len(report['violations'])}**",
        "",
    ])
    return "\n".join(lines)


def export(input_path: Path, output_dir: Path) -> dict[str, Any]:
    raw = json.loads(input_path.read_text(encoding="utf-8"))
    dataset = parse_dataset(raw, input_path.parent.parent / "overrides")
    options = raw.get("generation_options", {})
    variant_count = options.get("variant_count", 1)
    result = generate_timetables(dataset, variant_count=variant_count)

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "timetables.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8"
    )

    alternatives = result.get("alternatives", [{"alternative": 1, **result}])
    expected_files = set()
    for alternative in alternatives:
        path = output_dir / f"timetable-{alternative['alternative']}.md"
        path.write_text(_markdown_table(alternative), encoding="utf-8")
        expected_files.add(path.name)

    # Remove stale timetable variants when a later run requests fewer outputs.
    for path in output_dir.glob("timetable-*.md"):
        if path.name not in expected_files:
            path.unlink()
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate and export timetable tables")
    parser.add_argument("input", type=Path, help="Input dataset JSON file")
    parser.add_argument("--output", type=Path, default=Path("generated"))
    args = parser.parse_args()
    result = export(args.input, args.output)
    report = result["report"]
    print(f"Generated {report.get('generated', 1)} timetable(s) in {args.output.resolve()}")
    print(f"Complete: {report['complete']}")


if __name__ == "__main__":
    main()

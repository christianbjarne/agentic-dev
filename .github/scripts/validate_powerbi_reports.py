#!/usr/bin/env python3
"""Validate PBIR reports against the Opportunity Revenue report guideline."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path


REFERENCE_PATH = "guideline/powerbi_report/opportunity-revenue-template"
COMPARISON_VISUALS = {
    "barChart",
    "columnChart",
    "clusteredBarChart",
    "clusteredColumnChart",
    "lineChart",
    "lineStackedColumnComboChart",
    "lineClusteredColumnComboChart",
    "treemap",
}
DETAIL_VISUALS = {"pivotTable", "tableEx"}
DEPRECATED_VISUALS = {"map", "filledMap"}


@dataclass(frozen=True)
class Finding:
    path: Path
    rule: str
    message: str
    correction: str


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"{path}: invalid JSON: {exc}") from exc


def report_roots(root: Path) -> list[Path]:
    reports = []
    for pages_file in root.glob("**/*.Report/definition/pages/pages.json"):
        relative = pages_file.relative_to(root).as_posix()
        if relative.startswith(REFERENCE_PATH):
            continue
        reports.append(pages_file.parents[2])
    return sorted(reports)


def page_index(report: Path) -> dict[str, tuple[Path, dict]]:
    result = {}
    pages_root = report / "definition" / "pages"
    for page_file in pages_root.glob("*/page.json"):
        page = load_json(page_file)
        label = f"{page.get('name', '')} {page.get('displayName', '')}".lower()
        result[label] = (page_file.parent, page)
    return result


def page_by_role(
    pages: dict[str, tuple[Path, dict]], role: str
) -> tuple[Path, dict] | None:
    return next((value for label, value in pages.items() if role in label), None)


def visual_types(page_root: Path) -> list[tuple[Path, str]]:
    visuals = []
    for visual_file in page_root.glob("visuals/*/visual.json"):
        document = load_json(visual_file)
        visuals.append((visual_file, document.get("visual", {}).get("visualType", "")))
    return visuals


def validate_report(root: Path, report: Path) -> list[Finding]:
    relative = report.relative_to(root)
    pages = page_index(report)
    findings: list[Finding] = []
    overview = page_by_role(pages, "overview")
    detail = page_by_role(pages, "detail")
    tooltip = page_by_role(pages, "tooltip")
    missing = [
        name
        for name, page in (("Overview", overview), ("Detail", detail), ("Tooltip", tooltip))
        if page is None
    ]
    if missing:
        findings.append(
            Finding(
                relative,
                "PBI001",
                f"Required page architecture is missing: {', '.join(missing)}.",
                "Add Overview, Detail, and hidden Tooltip pages based on the Opportunity Revenue template.",
            )
        )

    all_visuals = [
        visual
        for page_root, _ in pages.values()
        for visual in visual_types(page_root)
    ]
    deprecated = sorted({kind for _, kind in all_visuals if kind in DEPRECATED_VISUALS})
    if deprecated:
        findings.append(
            Finding(
                relative,
                "PBI006",
                f"Deprecated map visual types are used: {', '.join(deprecated)}.",
                "Replace legacy map visuals with azureMap.",
            )
        )

    if overview:
        overview_root, page = overview
        width = page.get("width", 0)
        height = page.get("height", 0)
        if not height or abs((width / height) - (16 / 9)) > 0.02:
            findings.append(
                Finding(
                    overview_root.relative_to(root) / "page.json",
                    "PBI002",
                    f"Overview canvas is {width} x {height}, not 16:9.",
                    "Use a 1280 x 720 or 1920 x 1080 Overview canvas.",
                )
            )

        kinds = [kind for _, kind in visual_types(overview_root)]
        requirements = {
            "a title textbox": kinds.count("textbox") >= 1,
            "at least two KPI cards": kinds.count("cardVisual") >= 2,
            "a slicer": kinds.count("slicer") >= 1,
            "an Azure Map": kinds.count("azureMap") >= 1,
            "a comparison or trend visual": any(
                kind in COMPARISON_VISUALS for kind in kinds
            ),
        }
        absent = [name for name, present in requirements.items() if not present]
        if absent:
            findings.append(
                Finding(
                    overview_root.relative_to(root),
                    "PBI003",
                    f"Overview composition is missing: {', '.join(absent)}.",
                    "Follow the Opportunity Revenue overview composition.",
                )
            )

        analytical = [
            kind
            for kind in kinds
            if kind not in {"textbox", "shape", "actionButton", "pageNavigator"}
        ]
        if len(analytical) > 12:
            findings.append(
                Finding(
                    overview_root.relative_to(root),
                    "PBI004",
                    f"Overview has {len(analytical)} analytical visuals.",
                    "Keep at most 12 analytical visuals and move detail to the Detail page.",
                )
            )

    if detail:
        detail_root, _ = detail
        kinds = [kind for _, kind in visual_types(detail_root)]
        if not any(kind in DETAIL_VISUALS for kind in kinds):
            findings.append(
                Finding(
                    detail_root.relative_to(root),
                    "PBI005",
                    "Detail page requires a matrix or table.",
                    "Add pivotTable or tableEx; human review must also confirm return navigation.",
                )
            )

    if tooltip:
        tooltip_root, page = tooltip
        kinds = [kind for _, kind in visual_types(tooltip_root)]
        hidden = page.get("visibility") == "HiddenInViewMode"
        compact = page.get("width", 9999) <= 400 and page.get("height", 9999) <= 400
        if not hidden or not compact or not any(
            kind in {"cardVisual", "donutChart", "pieChart"} for kind in kinds
        ):
            findings.append(
                Finding(
                    tooltip_root.relative_to(root),
                    "PBI007",
                    "Tooltip page is not compact, hidden, and context-bearing.",
                    "Use a hidden page no larger than 400 x 400 with a KPI or composition visual.",
                )
            )

    return findings


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate PBIR reports against repository guidance."
    )
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    root = args.root.resolve()
    reports = report_roots(root)

    try:
        findings = [
            finding
            for report in reports
            for finding in validate_report(root, report)
        ]
    except ValueError as exc:
        print(f"validation error: {exc}")
        return 2

    if not findings:
        print(f"Validated {len(reports)} Power BI report(s).")
        return 0

    print(f"Found {len(findings)} Power BI report guideline violation(s):")
    for finding in findings:
        detail = f"[{finding.rule}] {finding.message} Fix: {finding.correction}"
        print(f"{finding.path}:1: error {detail}")
        print(
            f"::error file={finding.path.as_posix()},line=1,"
            f"title={finding.rule}::{detail.replace('%', '%25')}"
        )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

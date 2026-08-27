#!/usr/bin/env python3
"""Validate Fabric notebook source against repository guidelines and skills."""

from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Finding:
    rule: str
    path: Path
    line: int
    message: str
    source: str
    correction: str


LINE_RULES = (
    (
        "FAB001",
        re.compile(
            r"""(?ix)
            \b(?:workspace|lakehouse)_id\s*=\s*
            ["'][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-
            [0-9a-f]{4}-[0-9a-f]{12}["']
            """
        ),
        "Hardcoded workspace or lakehouse ID makes the notebook environment-specific.",
        ".github/skills/spark-authoring-cli/SKILL.md",
        "Resolve IDs from notebook runtime context, item discovery, or configuration.",
    ),
    (
        "FAB002",
        re.compile(r"onelake\.dfs\.fabric\.microsoft\.com", re.IGNORECASE),
        "The OneLake endpoint is hardcoded and will not work across cloud environments.",
        ".github/skills/spark-authoring-cli/resources/data-engineering-patterns.md",
        "Read the endpoint dynamically from notebookutils configuration.",
    ),
    (
        "FAB003",
        re.compile(r"""option\s*\(\s*["']inferSchema["']\s*,\s*["']true["']""", re.IGNORECASE),
        "Schema inference is not allowed for production ingestion.",
        ".github/skills/spark-authoring-cli/resources/data-engineering-patterns.md",
        "Declare and apply an explicit StructType schema.",
    ),
    (
        "FAB004",
        re.compile(r"\.collect\s*\("),
        "collect() moves all rows to the driver and can cause out-of-memory failures.",
        ".github/skills/spark-authoring-cli/resources/data-engineering-patterns.md",
        "Keep processing distributed with DataFrame transformations.",
    ),
    (
        "FAB005",
        re.compile(r"\.write.*\.(?:csv|json|parquet)\s*\(", re.IGNORECASE),
        "Managed Silver and Gold outputs must be Delta tables, not file-format writes.",
        "guideline/fabric_project_data_eng",
        "Write a managed Delta table using the required tbl_<domain>_<entity> name.",
    ),
    (
        "FAB007",
        re.compile(r"""["'][^"']*Files/gold(?:/|["'])""", re.IGNORECASE),
        "Gold data is being copied into Files instead of written as a governed Delta table.",
        "guideline/fabric_project_data_eng",
        "Use the Silver shortcut as input and write a managed Gold Delta table.",
    ),
)


def notebook_sources(root: Path) -> list[Path]:
    return sorted(root.glob("**/*.Notebook/notebook-content.py"))


def executable_lines(text: str) -> list[tuple[int, str]]:
    return [
        (number, line)
        for number, line in enumerate(text.splitlines(), start=1)
        if line.strip() and not line.lstrip().startswith("#")
    ]


def validate_notebook(root: Path, path: Path) -> list[Finding]:
    text = path.read_text(encoding="utf-8-sig")
    relative_path = path.relative_to(root)
    code = executable_lines(text)
    if not code:
        return []

    findings: list[Finding] = []
    for line_number, line in code:
        for rule, pattern, message, source, correction in LINE_RULES:
            if pattern.search(line):
                findings.append(
                    Finding(rule, relative_path, line_number, message, source, correction)
                )

    code_text = "\n".join(line for _, line in code)
    lowered = code_text.lower()
    writes_data = ".write" in lowered or "saveastable" in lowered
    has_validation = bool(
        re.search(
            r"\b(assert|validate|validation|quality|runtimeerror|row_count|expected_)\b",
            lowered,
        )
    )
    overwrite_lines = [
        line_number
        for line_number, line in code
        if re.search(r"""\.mode\s*\(\s*["']overwrite["']\s*\)""", line, re.IGNORECASE)
    ]
    if overwrite_lines and not has_validation:
        findings.append(
            Finding(
                "FAB006",
                relative_path,
                overwrite_lines[0],
                "Overwrite is used without evidence of scope or output validation.",
                ".github/skills/spark-authoring-cli/resources/data-engineering-patterns.md",
                "Use MERGE or partition-aware overwrite and validate the resulting output.",
            )
        )

    bronze_line = next(
        (line_number for line_number, line in code if "bronze" in line.lower()),
        None,
    )
    gold_output_line = next(
        (
            line_number
            for line_number, line in code
            if "files/gold" in line.lower()
        ),
        None,
    )
    if bronze_line and gold_output_line:
        findings.append(
            Finding(
                "FAB008",
                relative_path,
                gold_output_line,
                "The notebook mixes Bronze input and Gold output instead of preserving layer separation.",
                "guideline/fabric_project_data_eng",
                "Process Bronze through the Silver data-quality layer before producing Gold output.",
            )
        )

    if writes_data and not has_validation:
        write_line = next(line_number for line_number, line in code if ".write" in line.lower())
        findings.append(
            Finding(
                "FAB009",
                relative_path,
                write_line,
                "The notebook writes output without an explicit validation or data-quality gate.",
                "guideline/fabric_project_data_eng",
                "Validate schema, required values, duplicates, and output expectations before writing.",
            )
        )

    lineage_fields = (
        ("ingestion_timestamp", "_ingestion_timestamp", "processed_at"),
        ("source_system", "_source_file", "source_url"),
        ("pipeline_run_id", "_batch_id", "batch_id"),
    )
    has_lineage = all(
        any(alias in lowered for alias in aliases)
        for aliases in lineage_fields
    )
    if writes_data and not has_lineage:
        write_line = next(line_number for line_number, line in code if ".write" in line.lower())
        findings.append(
            Finding(
                "FAB010",
                relative_path,
                write_line,
                "Required lineage metadata columns are missing from persisted output.",
                ".github/skills/spark-authoring-cli/resources/data-engineering-patterns.md",
                "Add ingestion_timestamp, source_system, and pipeline_run_id before persisting.",
            )
        )

    return findings


def escape_command(value: str) -> str:
    return value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def write_summary(findings: list[Finding]) -> None:
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return

    with Path(summary_path).open("a", encoding="utf-8") as summary:
        summary.write("## Fabric notebook guideline validation\n\n")
        if not findings:
            summary.write("No guideline violations found.\n")
            return

        summary.write("| Rule | File:line | Violation | Source |\n")
        summary.write("|---|---|---|---|\n")
        for finding in findings:
            summary.write(
                f"| {finding.rule} | `{finding.path}:{finding.line}` | "
                f"{finding.message} | `{finding.source}` |\n"
            )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Validate Fabric notebook source against repository guidance."
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[2],
        help="Repository root to scan.",
    )
    args = parser.parse_args(argv)
    root = args.root.resolve()
    sources = notebook_sources(root)
    if not sources:
        print("No Fabric notebook source files found.")
        return 0

    findings = [
        finding
        for source in sources
        for finding in validate_notebook(root, source)
    ]
    write_summary(findings)

    if not findings:
        print(f"Validated {len(sources)} Fabric notebook source file(s).")
        return 0

    print(f"Found {len(findings)} Fabric notebook guideline violation(s):")
    for finding in findings:
        detail = (
            f"[{finding.rule}] {finding.message} "
            f"Source: {finding.source}. Fix: {finding.correction}"
        )
        print(f"{finding.path}:{finding.line}: error {detail}")
        print(
            f"::error file={finding.path.as_posix()},line={finding.line},"
            f"title={finding.rule}::{escape_command(detail)}"
        )
    return 1


if __name__ == "__main__":
    sys.exit(main())

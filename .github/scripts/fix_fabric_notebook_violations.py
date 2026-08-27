#!/usr/bin/env python3
"""Apply conservative automatic fixes for supported Fabric notebook findings."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


LINEAGE_ALIASES = (
    ("ingestion_timestamp", "_ingestion_timestamp", "processed_at"),
    ("source_system", "_source_file", "source_url"),
    ("pipeline_run_id", "_batch_id", "batch_id"),
)
DELTA_WRITE = re.compile(
    r'(?m)^(?P<indent>\s*)\(\r?\n'
    r'(?P=indent)\s{4}(?P<frame>[A-Za-z_][A-Za-z0-9_]*)'
    r'\.write\.format\(["\']delta["\']\)'
)


def has_lineage(text: str) -> bool:
    lowered = text.lower()
    return all(
        any(alias in lowered for alias in aliases)
        for aliases in LINEAGE_ALIASES
    )


def add_lineage(path: Path) -> bool:
    text = path.read_text(encoding="utf-8-sig")
    if has_lineage(text) or ".write" not in text:
        return False
    if "from pyspark.sql import functions as F" not in text:
        raise ValueError(f"{path}: cannot add lineage safely because functions as F is not imported")

    writes = list(DELTA_WRITE.finditer(text))
    frames = {match.group("frame") for match in writes}
    if len(writes) != 1 or len(frames) != 1:
        raise ValueError(
            f"{path}: automatic lineage fix requires exactly one Delta write target"
        )

    match = writes[0]
    frame = match.group("frame")
    notebook_name = path.parent.name.removesuffix(".Notebook")
    source_system = re.sub(r"[^a-z0-9]+", "_", notebook_name.lower()).strip("_")
    insertion = (
        "context = notebookutils.runtime.context\n"
        'pipeline_run_id = str(context.get("activityId") or context["currentNotebookId"])\n'
        f"{frame} = (\n"
        f"    {frame}\n"
        '    .withColumn("ingestion_timestamp", F.current_timestamp())\n'
        f'    .withColumn("source_system", F.lit("{source_system}"))\n'
        '    .withColumn("pipeline_run_id", F.lit(pipeline_run_id))\n'
        ")\n\n"
    )
    updated = text[: match.start()] + insertion + text[match.start() :]
    path.write_text(updated, encoding="utf-8")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fix supported Fabric notebook guideline violations."
    )
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    root = args.root.resolve()

    changed = [
        path
        for path in sorted(root.glob("**/*.Notebook/notebook-content.py"))
        if add_lineage(path)
    ]
    if not changed:
        print("No supported automatic Fabric notebook fixes were found.")
        return 2

    for path in changed:
        print(f"Added lineage metadata to {path.relative_to(root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

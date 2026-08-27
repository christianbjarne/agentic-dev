# Metadata-Driven Framework

This folder contains a reusable workload scaffold that follows the repo medallion guideline:

- Bronze: raw ingestion only
- Silver: schema enforcement and data quality
- Gold: curated star schema outputs

## What is included

- `workloads/sales_analytics/metadata/workload.yaml`
- `workloads/sales_analytics/notebooks/bronze_notebook.py`
- `workloads/sales_analytics/notebooks/silver_notebook.py`
- `workloads/sales_analytics/notebooks/gold_notebook.py`

## How to use for a new workload

1. Copy `workloads/sales_analytics` to `workloads/<your_workload_name>`.
2. Update `metadata/workload.yaml` with your entities, paths, and table names.
3. Update notebook `CONFIG` sections only.
4. Keep one notebook per layer.
5. Keep Bronze write target in Files and Silver/Gold write targets as Delta tables.

## Notes

- The notebooks are written as Fabric PySpark source files.
- Shortcuts are assumed between layers; paths in metadata should point to shortcut locations.
- Naming convention follows `tbl_<domain>_<entity>`.

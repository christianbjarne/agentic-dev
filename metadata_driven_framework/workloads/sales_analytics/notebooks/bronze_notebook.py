# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "synapse_pyspark"
# META   },
# META   "dependencies": {}
# META }

# CELL ********************

from pyspark.sql import functions as F

CONFIG = {
    "source_path": "Files/inbound/sales_orders",
    "target_path": "Files/raw/sales_orders",
    "ingest_run_id": "manual",
}

print(f"[bronze] source={CONFIG['source_path']}")
print(f"[bronze] target={CONFIG['target_path']}")

# Read raw data with minimal assumptions. Bronze keeps source as-is.
raw_df = (
    spark.read.format("csv")
    .option("header", "true")
    .option("inferSchema", "false")
    .load(CONFIG["source_path"])
    .withColumn("_ingest_ts_utc", F.current_timestamp())
    .withColumn("_ingest_run_id", F.lit(CONFIG["ingest_run_id"]))
)

row_count = raw_df.count()
print(f"[bronze] rows_read={row_count}")

(
    raw_df.write.mode("append")
    .format("parquet")
    .save(CONFIG["target_path"])
)

print("[bronze] write_complete")


# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

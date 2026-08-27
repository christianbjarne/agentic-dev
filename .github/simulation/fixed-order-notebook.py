# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "synapse_pyspark"
# META   },
# META   "dependencies": {}
# META }

# CELL ********************

# Parameters can be overridden by a Fabric pipeline.
source_table = "silver.tbl_order_clean"
target_table = "gold.tbl_order_daily_summary"
source_system = "silver_order_shortcut"

context = notebookutils.runtime.context
pipeline_run_id = str(context.get("activityId") or context["currentNotebookId"])

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

import logging

from delta.tables import DeltaTable
from pyspark.sql import functions as F

logger = logging.getLogger("order_daily_summary")
orders = spark.table(source_table)

required_columns = {"order_id", "order_date", "amount"}
missing_columns = required_columns.difference(orders.columns)
if missing_columns:
    raise ValueError(f"Missing required columns: {sorted(missing_columns)}")

quality_check = orders.agg(
    F.sum(F.col("order_id").isNull().cast("int")).alias("null_order_ids"),
    F.sum(F.col("order_date").isNull().cast("int")).alias("null_order_dates"),
    F.sum((F.col("amount") < 0).cast("int")).alias("negative_amounts"),
    F.count("*").alias("row_count"),
    F.countDistinct("order_id").alias("distinct_order_ids"),
).first()

if quality_check.null_order_ids or quality_check.null_order_dates:
    raise ValueError("Required order fields contain null values")
if quality_check.negative_amounts:
    raise ValueError("Order amount cannot be negative")
if quality_check.row_count == 0:
    raise ValueError("Order source table is empty")
if quality_check.row_count != quality_check.distinct_order_ids:
    raise ValueError("Duplicate order_id values detected")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

daily_orders = (
    orders.groupBy("order_date")
    .agg(
        F.sum("amount").alias("total_amount"),
        F.countDistinct("order_id").alias("order_count"),
    )
    .withColumn("ingestion_timestamp", F.current_timestamp())
    .withColumn("source_system", F.lit(source_system))
    .withColumn("pipeline_run_id", F.lit(pipeline_run_id))
)

if spark.catalog.tableExists(target_table):
    (
        DeltaTable.forName(spark, target_table)
        .alias("target")
        .merge(daily_orders.alias("source"), "target.order_date = source.order_date")
        .whenMatchedUpdateAll()
        .whenNotMatchedInsertAll()
        .execute()
    )
else:
    daily_orders.write.format("delta").saveAsTable(target_table)

logger.info(
    "Updated %s from %s for pipeline run %s",
    target_table,
    source_table,
    pipeline_run_id,
)

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

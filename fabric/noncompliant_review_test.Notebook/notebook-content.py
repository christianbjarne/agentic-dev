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
source_table = "silver.tbl_customer_clean"
target_table = "gold.tbl_customer_country_summary"
source_system = "silver_customer_shortcut"

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

logger = logging.getLogger("customer_country_summary")
customers = spark.table(source_table)

required_columns = {"customer_id", "country"}
missing_columns = required_columns.difference(customers.columns)
if missing_columns:
    raise ValueError(f"Missing required columns: {sorted(missing_columns)}")

quality_check = customers.agg(
    F.sum(F.col("customer_id").isNull().cast("int")).alias("null_customer_ids"),
    F.sum(F.col("country").isNull().cast("int")).alias("null_countries"),
    F.count("*").alias("row_count"),
    F.countDistinct("customer_id").alias("distinct_customer_ids"),
).first()

if quality_check.null_customer_ids or quality_check.null_countries:
    raise ValueError("Required customer fields contain null values")
if quality_check.row_count == 0:
    raise ValueError("Customer source table is empty")
if quality_check.row_count != quality_check.distinct_customer_ids:
    raise ValueError("Duplicate customer_id values detected")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

customer_summary = (
    customers.groupBy("country")
    .agg(F.countDistinct("customer_id").alias("customer_count"))
    .withColumn("ingestion_timestamp", F.current_timestamp())
    .withColumn("source_system", F.lit(source_system))
    .withColumn("pipeline_run_id", F.lit(pipeline_run_id))
)

if spark.catalog.tableExists(target_table):
    (
        DeltaTable.forName(spark, target_table)
        .alias("target")
        .merge(customer_summary.alias("source"), "target.country = source.country")
        .whenMatchedUpdateAll()
        .whenNotMatchedInsertAll()
        .execute()
    )
else:
    customer_summary.write.format("delta").saveAsTable(target_table)

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

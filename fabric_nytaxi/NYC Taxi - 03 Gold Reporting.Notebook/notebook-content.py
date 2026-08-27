# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "synapse_pyspark"
# META   },
# META   "dependencies": {
# META     "lakehouse": {
# META       "default_lakehouse": "52bc2e1b-964f-4930-bc63-c8af5e491bf2",
# META       "default_lakehouse_name": "nyc_taxi_lakehouse",
# META       "default_lakehouse_workspace_id": "f39ba351-8523-4084-9da1-ed33e4eff8ed"
# META     }
# META   }
# META }

# CELL ********************

from functools import reduce

from pyspark.sql import functions as F


spark.conf.set("spark.sql.parquet.vorder.default", "true")
spark.conf.set("spark.databricks.delta.optimizeWrite.enabled", "true")
spark.conf.set("spark.databricks.delta.optimizeWrite.binSize", "1g")
spark.conf.set("spark.sql.adaptive.enabled", "true")
spark.sql("CREATE SCHEMA IF NOT EXISTS gold")

fact_tables = [
    "silver.fact_yellow_trip",
    "silver.fact_green_trip",
    "silver.fact_fhv_trip",
    "silver.fact_high_volume_fhv_trip",
]

monthly_frames = []
for table_name in fact_tables:
    frame = spark.table(table_name)
    monthly = frame.groupBy("pickup_month_start", "service_type_key").agg(
        F.count(F.lit(1)).cast("long").alias("trip_count"),
        F.sum("passenger_count").cast("long").alias("passenger_count"),
        F.sum("trip_distance").cast("decimal(20,2)").alias("trip_distance"),
        F.sum("trip_duration_minutes").cast("decimal(20,2)").alias("trip_duration_minutes"),
        F.sum("fare_amount").cast("decimal(20,2)").alias("fare_amount"),
        F.sum("tip_amount").cast("decimal(20,2)").alias("tip_amount"),
        F.sum("tolls_amount").cast("decimal(20,2)").alias("tolls_amount"),
        F.sum("total_amount").cast("decimal(20,2)").alias("total_amount"),
        F.sum("congestion_surcharge_amount")
        .cast("decimal(20,2)")
        .alias("congestion_surcharge_amount"),
        F.sum("airport_fee_amount").cast("decimal(20,2)").alias("airport_fee_amount"),
        F.sum("cbd_congestion_fee_amount")
        .cast("decimal(20,2)")
        .alias("cbd_congestion_fee_amount"),
        F.sum(F.when(F.col("shared_request_flag") == "Y", 1).otherwise(0))
        .cast("long")
        .alias("shared_request_count"),
        F.sum(F.when(F.col("shared_match_flag") == "Y", 1).otherwise(0))
        .cast("long")
        .alias("shared_match_count"),
        F.sum(F.when(F.col("wav_request_flag") == "Y", 1).otherwise(0))
        .cast("long")
        .alias("wav_request_count"),
        F.sum(F.when(F.col("wav_match_flag") == "Y", 1).otherwise(0))
        .cast("long")
        .alias("wav_match_count"),
    )
    monthly_frames.append(monthly)

monthly_summary = reduce(lambda left, right: left.unionByName(right), monthly_frames)
monthly_summary = (
    monthly_summary.withColumn(
        "month_date_key", F.date_format("pickup_month_start", "yyyyMMdd").cast("int")
    )
    .withColumn(
        "paid_trip_count",
        F.when(F.col("service_type_key").isin(1, 2, 4), F.col("trip_count")).otherwise(F.lit(0)),
    )
    .withColumn(
        "average_trip_distance",
        F.when(F.col("trip_count") > 0, F.col("trip_distance") / F.col("trip_count"))
        .otherwise(F.lit(0))
        .cast("decimal(18,2)"),
    )
    .withColumn(
        "average_trip_duration_minutes",
        F.when(
            F.col("trip_count") > 0,
            F.col("trip_duration_minutes") / F.col("trip_count"),
        )
        .otherwise(F.lit(0))
        .cast("decimal(18,2)"),
    )
    .withColumn(
        "average_fare_amount",
        F.when(F.col("paid_trip_count") > 0, F.col("fare_amount") / F.col("paid_trip_count"))
        .otherwise(F.lit(0))
        .cast("decimal(18,2)"),
    )
    .withColumn(
        "average_tip_amount",
        F.when(F.col("paid_trip_count") > 0, F.col("tip_amount") / F.col("paid_trip_count"))
        .otherwise(F.lit(0))
        .cast("decimal(18,2)"),
    )
    .withColumn(
        "tip_rate",
        F.when(F.col("fare_amount") != 0, F.col("tip_amount") / F.col("fare_amount"))
        .otherwise(F.lit(0))
        .cast("decimal(18,4)"),
    )
    .withColumn(
        "shared_match_rate",
        F.when(
            F.col("shared_request_count") > 0,
            F.col("shared_match_count") / F.col("shared_request_count"),
        )
        .otherwise(F.lit(0))
        .cast("decimal(18,4)"),
    )
    .withColumn(
        "wav_fulfillment_rate",
        F.when(
            F.col("wav_request_count") > 0,
            F.col("wav_match_count") / F.col("wav_request_count"),
        )
        .otherwise(F.lit(0))
        .cast("decimal(18,4)"),
    )
    .select(
        "month_date_key",
        F.col("pickup_month_start").alias("month_start"),
        "service_type_key",
        "trip_count",
        "paid_trip_count",
        "passenger_count",
        "trip_distance",
        "trip_duration_minutes",
        "fare_amount",
        "tip_amount",
        "tolls_amount",
        "total_amount",
        "congestion_surcharge_amount",
        "airport_fee_amount",
        "cbd_congestion_fee_amount",
        "shared_request_count",
        "shared_match_count",
        "wav_request_count",
        "wav_match_count",
        "average_trip_distance",
        "average_trip_duration_minutes",
        "average_fare_amount",
        "average_tip_amount",
        "tip_rate",
        "shared_match_rate",
        "wav_fulfillment_rate",
    )
)

context = notebookutils.runtime.context
pipeline_run_id = str(context.get("activityId") or context["currentNotebookId"])
monthly_summary = (
    monthly_summary
    .withColumn("ingestion_timestamp", F.current_timestamp())
    .withColumn("source_system", F.lit("nyc_taxi_03_gold_reporting"))
    .withColumn("pipeline_run_id", F.lit(pipeline_run_id))
)

(
    monthly_summary.write.format("delta")
    .mode("overwrite")
    .option("overwriteSchema", "true")
    .saveAsTable("gold.monthly_trip_summary")
)

spark.sql(
    "OPTIMIZE gold.monthly_trip_summary ZORDER BY (month_start, service_type_key)"
)

result = spark.table("gold.monthly_trip_summary")
row_count = result.count()
month_count = result.select("month_start").distinct().count()
service_count = result.select("service_type_key").distinct().count()

if row_count != 48 or month_count != 12 or service_count != 4:
    raise RuntimeError(
        f"Expected 48 month/service rows, 12 months, and 4 services; "
        f"found {row_count}, {month_count}, and {service_count}"
    )

result.orderBy("month_start", "service_type_key").show(48, truncate=False)
print("Gold monthly reporting table completed")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "synapse_pyspark"
# META   },
# META   "dependencies": {
# META     "lakehouse": {
# META       "default_lakehouse": "25d46af5-836b-4596-be94-239421a4365d",
# META       "default_lakehouse_name": "LH_Silver",
# META       "default_lakehouse_workspace_id": "f39ba351-8523-4084-9da1-ed33e4eff8ed"
# META     }
# META   }
# META }

# PARAMETERS CELL ********************

process_year = 2025
process_month = 1
environment = "dev"

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

from datetime import datetime, timezone
import uuid

from delta.tables import DeltaTable
from pyspark.sql import functions as F
from pyspark.sql.window import Window

# Pipeline parameters. Fabric overrides these values when supplied by a caller.

spark.conf.set("spark.sql.parquet.vorder.default", "true")
spark.conf.set("spark.microsoft.delta.optimizeWrite.enabled", "true")
spark.conf.set("spark.databricks.delta.autoCompact.enabled", "true")
spark.conf.set("spark.sql.adaptive.enabled", "true")

month_token = f"{int(process_month):02d}"
trip_path = (
    f"Files/bronze_taxi/raw/yellow/"
    f"yellow_tripdata_{int(process_year)}-{month_token}.parquet"
)
zone_path = "Files/bronze_taxi/raw/reference/taxi_zone_lookup.csv"
run_id = str(uuid.uuid4())
processed_at = datetime.now(timezone.utc)

raw = spark.read.parquet(trip_path)
zone_raw = spark.read.option("header", True).option("inferSchema", True).csv(zone_path)

typed = (
    raw.select(
        F.col("VendorID").cast("int").alias("vendor_id"),
        F.col("tpep_pickup_datetime").cast("timestamp").alias("pickup_datetime"),
        F.col("tpep_dropoff_datetime").cast("timestamp").alias("dropoff_datetime"),
        F.col("passenger_count").cast("int").alias("passenger_count"),
        F.col("trip_distance").cast("double").alias("trip_distance"),
        F.col("RatecodeID").cast("int").alias("ratecode_id"),
        F.col("store_and_fwd_flag").cast("string").alias("store_and_forward_flag"),
        F.col("PULocationID").cast("int").alias("pickup_location_id"),
        F.col("DOLocationID").cast("int").alias("dropoff_location_id"),
        F.col("payment_type").cast("int").alias("payment_type"),
        F.col("fare_amount").cast("double").alias("fare_amount"),
        F.col("extra").cast("double").alias("extra_amount"),
        F.col("mta_tax").cast("double").alias("mta_tax_amount"),
        F.col("tip_amount").cast("double").alias("tip_amount"),
        F.col("tolls_amount").cast("double").alias("tolls_amount"),
        F.col("improvement_surcharge").cast("double").alias("improvement_surcharge"),
        F.col("total_amount").cast("double").alias("total_amount"),
        F.lit(int(process_year)).cast("int").alias("source_year"),
        F.lit(int(process_month)).cast("int").alias("source_month"),
        F.lit(
            f"yellow_tripdata_{int(process_year)}-{month_token}.parquet"
        ).alias("source_file"),
        F.lit(run_id).alias("dq_run_id"),
        F.current_timestamp().alias("processed_at_utc"),
    )
    .withColumn(
        "trip_id",
        F.sha2(
            F.concat_ws(
                "||",
                F.coalesce(F.col("vendor_id").cast("string"), F.lit("")),
                F.coalesce(F.col("pickup_datetime").cast("string"), F.lit("")),
                F.coalesce(F.col("dropoff_datetime").cast("string"), F.lit("")),
                F.coalesce(F.col("pickup_location_id").cast("string"), F.lit("")),
                F.coalesce(F.col("dropoff_location_id").cast("string"), F.lit("")),
                F.coalesce(F.col("total_amount").cast("string"), F.lit("")),
            ),
            256,
        ),
    )
    .withColumn(
        "trip_duration_minutes",
        (
            F.unix_timestamp("dropoff_datetime")
            - F.unix_timestamp("pickup_datetime")
        )
        / F.lit(60.0),
    )
    .withColumn("pickup_date", F.to_date("pickup_datetime"))
    .withColumn("pickup_date_key", F.date_format("pickup_datetime", "yyyyMMdd").cast("int"))
    .withColumn("pickup_hour", F.hour("pickup_datetime"))
    .withColumn("pickup_day_of_week", F.dayofweek("pickup_datetime"))
)

# Metadata-driven rules mirror gex_demo_utils_nb: rules are data, each run is logged,
# and unexpected rows are persisted separately before accepted rows are written.
rules = [
    ("R001", "Completeness", "pickup_datetime", "expect_not_null", "error"),
    ("R002", "Completeness", "dropoff_datetime", "expect_not_null", "error"),
    ("R003", "Validity", "pickup_datetime", "expect_year_month", "error"),
    ("R004", "Validity", "trip_duration_minutes", "expect_between_0_1440", "error"),
    ("R005", "Validity", "trip_distance", "expect_between_0_200", "error"),
    ("R006", "Validity", "fare_amount", "expect_between_0_1000", "error"),
    ("R007", "Validity", "total_amount", "expect_between_0_2000", "error"),
    ("R008", "Validity", "pickup_location_id", "expect_between_1_265", "error"),
    ("R009", "Validity", "dropoff_location_id", "expect_between_1_265", "error"),
    ("R010", "Uniqueness", "trip_id", "expect_unique", "error"),
]
rules_df = spark.createDataFrame(
    rules,
    "rule_id string, dimension string, column_name string, "
    "expectation string, severity string",
).withColumn("dataset_name", F.lit("nyc_taxi_trip")).withColumn("active", F.lit(True))
rules_df.write.format("delta").mode("overwrite").option(
    "overwriteSchema", "true"
).saveAsTable("tbl_nyc_taxi_dq_rules")

expected_start = F.to_timestamp(F.lit(f"{int(process_year)}-{month_token}-01"))
expected_end = F.add_months(expected_start, 1)
with_failures = typed.withColumn(
    "_dq_failure_reasons",
    F.array_compact(
        F.array(
            F.when(F.col("pickup_datetime").isNull(), F.lit("R001")),
            F.when(F.col("dropoff_datetime").isNull(), F.lit("R002")),
            F.when(
                ~(
                    (F.col("pickup_datetime") >= expected_start)
                    & (F.col("pickup_datetime") < expected_end)
                ),
                F.lit("R003"),
            ),
            F.when(
                ~F.col("trip_duration_minutes").between(0.01, 1440.0),
                F.lit("R004"),
            ),
            F.when(~F.col("trip_distance").between(0.0, 200.0), F.lit("R005")),
            F.when(~F.col("fare_amount").between(0.0, 1000.0), F.lit("R006")),
            F.when(~F.col("total_amount").between(0.0, 2000.0), F.lit("R007")),
            F.when(~F.col("pickup_location_id").between(1, 265), F.lit("R008")),
            F.when(~F.col("dropoff_location_id").between(1, 265), F.lit("R009")),
        )
    ),
)

dedupe_window = Window.partitionBy("trip_id").orderBy(
    F.col("processed_at_utc").desc()
)
ranked = with_failures.withColumn("_dedupe_rank", F.row_number().over(dedupe_window))
validated = ranked.withColumn(
    "_dq_failure_reasons",
    F.when(
        F.col("_dedupe_rank") > 1,
        F.array_union(F.col("_dq_failure_reasons"), F.array(F.lit("R010"))),
    ).otherwise(F.col("_dq_failure_reasons")),
)

failed = validated.filter(F.size("_dq_failure_reasons") > 0)
passed = validated.filter(F.size("_dq_failure_reasons") == 0).drop(
    "_dq_failure_reasons", "_dedupe_rank"
)

failed_to_write = failed.select(
    F.col("trip_id").alias("pk"),
    F.lit(run_id).alias("run_id"),
    F.lit("nyc_taxi_trip").alias("dataset_name"),
    F.to_json(F.struct(*[F.col(c) for c in typed.columns])).alias("record_data"),
    F.to_json("_dq_failure_reasons").alias("failure_reasons"),
    F.current_timestamp().alias("failed_at_utc"),
)
if not failed_to_write.rdd.isEmpty():
    failed_to_write.write.format("delta").mode("append").saveAsTable(
        "tbl_nyc_taxi_dq_failed_rows"
    )
elif not spark.catalog.tableExists("tbl_nyc_taxi_dq_failed_rows"):
    failed_to_write.write.format("delta").mode("overwrite").saveAsTable(
        "tbl_nyc_taxi_dq_failed_rows"
    )

total_rows = typed.count()
passed_rows = passed.count()
failed_rows = failed.count()
log_df = spark.createDataFrame(
    [
        (
            run_id,
            "nyc_taxi_trip",
            processed_at,
            total_rows,
            passed_rows,
            failed_rows,
            int(process_year),
            int(process_month),
            environment,
        )
    ],
    "run_id string, dataset_name string, run_time timestamp, total_rows long, "
    "passed_rows long, failed_rows long, source_year int, source_month int, "
    "environment string",
)
log_df.write.format("delta").mode("append").saveAsTable("tbl_nyc_taxi_dq_run_log")

if spark.catalog.tableExists("tbl_nyc_taxi_trip"):
    DeltaTable.forName(spark, "tbl_nyc_taxi_trip").delete(
        (F.col("source_year") == int(process_year))
        & (F.col("source_month") == int(process_month))
    )
    passed.write.format("delta").mode("append").saveAsTable("tbl_nyc_taxi_trip")
else:
    passed.write.format("delta").mode("overwrite").partitionBy(
        "source_year", "source_month"
    ).saveAsTable("tbl_nyc_taxi_trip")

zone = zone_raw.select(
    F.col("LocationID").cast("int").alias("location_id"),
    F.trim("Borough").alias("borough"),
    F.trim("Zone").alias("zone_name"),
    F.trim("service_zone").alias("service_zone"),
).dropDuplicates(["location_id"])
zone.write.format("delta").mode("overwrite").option(
    "overwriteSchema", "true"
).saveAsTable("tbl_nyc_taxi_zone")

for table_name in (
    "tbl_nyc_taxi_trip",
    "tbl_nyc_taxi_zone",
    "tbl_nyc_taxi_dq_rules",
    "tbl_nyc_taxi_dq_run_log",
    "tbl_nyc_taxi_dq_failed_rows",
):
    spark.sql(f"OPTIMIZE {table_name}")

if passed_rows == 0 or passed_rows + failed_rows != total_rows:
    raise RuntimeError(
        f"Silver validation failed: total={total_rows}, passed={passed_rows}, "
        f"failed={failed_rows}"
    )
print(
    f"Silver DQ completed: run_id={run_id}, total={total_rows:,}, "
    f"passed={passed_rows:,}, failed={failed_rows:,}"
)



# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

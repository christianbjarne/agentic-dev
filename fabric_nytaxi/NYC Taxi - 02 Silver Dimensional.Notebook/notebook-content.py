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

from datetime import datetime, timezone

from pyspark.sql import DataFrame
from pyspark.sql import functions as F


spark.conf.set("spark.sql.parquet.vorder.default", "true")
spark.conf.set("spark.databricks.delta.optimizeWrite.enabled", "true")
spark.conf.set("spark.sql.adaptive.enabled", "true")
spark.sql("CREATE SCHEMA IF NOT EXISTS silver")

MONEY = "decimal(18,2)"
NUMBER = "decimal(18,2)"


def source_column(frame: DataFrame, *candidates: str):
    columns = {name.lower(): name for name in frame.columns}
    for candidate in candidates:
        actual = columns.get(candidate.lower())
        if actual:
            return F.col(f"`{actual}`")
    return None


def value(frame: DataFrame, candidates, data_type, default=None):
    column = source_column(frame, *candidates)
    if column is None:
        return F.lit(default).cast(data_type)
    return column.cast(data_type)


def money(frame: DataFrame, *candidates):
    return F.coalesce(value(frame, candidates, MONEY), F.lit(0).cast(MONEY))


def canonical_fact(
    raw_table,
    service_type_key,
    pickup_candidates,
    dropoff_candidates,
    distance_candidates=(),
    duration_seconds_candidates=(),
    fare_candidates=(),
    tip_candidates=(),
    toll_candidates=(),
    total_candidates=(),
):
    raw = spark.table(raw_table)
    pickup = value(raw, pickup_candidates, "timestamp")
    dropoff = value(raw, dropoff_candidates, "timestamp")
    derived_duration = ((F.unix_timestamp(dropoff) - F.unix_timestamp(pickup)) / F.lit(60.0)).cast(NUMBER)
    duration_seconds = value(raw, duration_seconds_candidates, "double")
    duration = (
        (duration_seconds / F.lit(60.0)).cast(NUMBER)
        if duration_seconds_candidates and source_column(raw, *duration_seconds_candidates) is not None
        else derived_duration
    )

    frame = raw.select(
        F.lit(service_type_key).cast("int").alias("service_type_key"),
        pickup.alias("pickup_datetime"),
        dropoff.alias("dropoff_datetime"),
        F.coalesce(value(raw, ("PULocationID", "PUlocationID"), "int"), F.lit(0)).alias(
            "pickup_location_id"
        ),
        F.coalesce(value(raw, ("DOLocationID", "DOlocationID"), "int"), F.lit(0)).alias(
            "dropoff_location_id"
        ),
        F.coalesce(value(raw, ("VendorID",), "int"), F.lit(0)).alias("vendor_id"),
        F.coalesce(value(raw, ("RatecodeID",), "int"), F.lit(99)).alias("rate_code_id"),
        F.coalesce(value(raw, ("payment_type",), "int"), F.lit(99)).alias("payment_type_id"),
        F.coalesce(value(raw, ("trip_type",), "int"), F.lit(0)).alias("trip_type_id"),
        F.coalesce(value(raw, ("hvfhs_license_num",), "string"), F.lit("UNKNOWN")).alias(
            "hvfhs_license_num"
        ),
        F.coalesce(value(raw, ("passenger_count",), "long"), F.lit(0)).alias("passenger_count"),
        F.coalesce(value(raw, distance_candidates, NUMBER), F.lit(0).cast(NUMBER)).alias(
            "trip_distance"
        ),
        F.coalesce(duration, F.lit(0).cast(NUMBER)).alias("trip_duration_minutes"),
        F.coalesce(value(raw, fare_candidates, MONEY), F.lit(0).cast(MONEY)).alias("fare_amount"),
        F.coalesce(value(raw, tip_candidates, MONEY), F.lit(0).cast(MONEY)).alias("tip_amount"),
        F.coalesce(value(raw, toll_candidates, MONEY), F.lit(0).cast(MONEY)).alias("tolls_amount"),
        F.coalesce(value(raw, total_candidates, MONEY), F.lit(0).cast(MONEY)).alias("total_amount"),
        money(raw, "congestion_surcharge").alias("congestion_surcharge_amount"),
        money(raw, "airport_fee", "Airport_fee").alias("airport_fee_amount"),
        money(raw, "cbd_congestion_fee").alias("cbd_congestion_fee_amount"),
        money(raw, "bcf").alias("black_car_fund_amount"),
        money(raw, "sales_tax").alias("sales_tax_amount"),
        money(raw, "driver_pay").alias("driver_pay_amount"),
        F.upper(
            F.coalesce(value(raw, ("store_and_fwd_flag",), "string"), F.lit("N"))
        ).alias("store_and_forward_flag"),
        F.when(
            F.coalesce(value(raw, ("SR_Flag", "shared_request_flag"), "string"), F.lit("N")).isin(
                "1", "Y", "y", "true", "True"
            ),
            F.lit("Y"),
        )
        .otherwise(F.lit("N"))
        .alias("shared_request_flag"),
        F.when(
            F.coalesce(value(raw, ("shared_match_flag",), "string"), F.lit("N")).isin(
                "1", "Y", "y", "true", "True"
            ),
            F.lit("Y"),
        )
        .otherwise(F.lit("N"))
        .alias("shared_match_flag"),
        F.when(
            F.coalesce(value(raw, ("wav_request_flag",), "string"), F.lit("N")).isin(
                "1", "Y", "y", "true", "True"
            ),
            F.lit("Y"),
        )
        .otherwise(F.lit("N"))
        .alias("wav_request_flag"),
        F.when(
            F.coalesce(value(raw, ("wav_match_flag",), "string"), F.lit("N")).isin(
                "1", "Y", "y", "true", "True"
            ),
            F.lit("Y"),
        )
        .otherwise(F.lit("N"))
        .alias("wav_match_flag"),
        value(raw, ("dispatching_base_num",), "string").alias("dispatching_base_number"),
        value(raw, ("Affiliated_base_number",), "string").alias("affiliated_base_number"),
        F.col("_source_year").cast("int").alias("source_year"),
        F.col("_source_month").cast("int").alias("source_month"),
        F.col("_source_file").alias("source_file"),
        F.col("_batch_id").alias("batch_id"),
    )

    frame = (
        frame.withColumn("pickup_date", F.to_date("pickup_datetime"))
        .withColumn("dropoff_date", F.to_date("dropoff_datetime"))
        .withColumn("pickup_date_key", F.date_format("pickup_datetime", "yyyyMMdd").cast("int"))
        .withColumn("dropoff_date_key", F.date_format("dropoff_datetime", "yyyyMMdd").cast("int"))
        .withColumn("pickup_month_start", F.trunc("pickup_date", "month"))
        .withColumn("pickup_hour", F.hour("pickup_datetime"))
    )

    return (
        frame.filter(
            (F.col("pickup_datetime") >= F.lit("2025-01-01").cast("timestamp"))
            & (F.col("pickup_datetime") < F.lit("2026-01-01").cast("timestamp"))
            & F.col("dropoff_datetime").isNotNull()
            & (F.col("dropoff_datetime") >= F.col("pickup_datetime"))
            & (F.col("trip_duration_minutes") >= 0)
            & (F.col("trip_duration_minutes") <= 1440)
            & F.col("pickup_location_id").between(0, 265)
            & F.col("dropoff_location_id").between(0, 265)
            & F.col("trip_distance").between(0, 1000)
            & F.col("total_amount").between(-1000, 10000)
        )
        .dropDuplicates(
            [
                "pickup_datetime",
                "dropoff_datetime",
                "pickup_location_id",
                "dropoff_location_id",
                "vendor_id",
                "total_amount",
                "trip_distance",
            ]
        )
    )


yellow = canonical_fact(
    "bronze.yellow_trips_raw",
    1,
    ("tpep_pickup_datetime",),
    ("tpep_dropoff_datetime",),
    distance_candidates=("trip_distance",),
    fare_candidates=("fare_amount",),
    tip_candidates=("tip_amount",),
    toll_candidates=("tolls_amount",),
    total_candidates=("total_amount",),
)

green = canonical_fact(
    "bronze.green_trips_raw",
    2,
    ("lpep_pickup_datetime",),
    ("lpep_dropoff_datetime",),
    distance_candidates=("trip_distance",),
    fare_candidates=("fare_amount",),
    tip_candidates=("tip_amount",),
    toll_candidates=("tolls_amount",),
    total_candidates=("total_amount",),
)

fhv = canonical_fact(
    "bronze.fhv_trips_raw",
    3,
    ("pickup_datetime",),
    ("dropOff_datetime", "dropoff_datetime"),
)

fhvhv = canonical_fact(
    "bronze.fhvhv_trips_raw",
    4,
    ("pickup_datetime",),
    ("dropoff_datetime",),
    distance_candidates=("trip_miles",),
    duration_seconds_candidates=("trip_time",),
    fare_candidates=("base_passenger_fare",),
    tip_candidates=("tips",),
    toll_candidates=("tolls",),
)
fhvhv = fhvhv.withColumn(
    "total_amount",
    (
        F.col("fare_amount")
        + F.col("tolls_amount")
        + F.col("tip_amount")
        + F.col("congestion_surcharge_amount")
        + F.col("airport_fee_amount")
        + F.col("cbd_congestion_fee_amount")
        + F.col("black_car_fund_amount")
        + F.col("sales_tax_amount")
    ).cast(MONEY),
)

facts = {
    "fact_yellow_trip": ("bronze.yellow_trips_raw", yellow),
    "fact_green_trip": ("bronze.green_trips_raw", green),
    "fact_fhv_trip": ("bronze.fhv_trips_raw", fhv),
    "fact_high_volume_fhv_trip": ("bronze.fhvhv_trips_raw", fhvhv),
}

quality_rows = []
processed_at = datetime.now(timezone.utc).isoformat()
for table_name, (raw_table, clean_frame) in facts.items():
    raw_count = spark.table(raw_table).count()
    (
        clean_frame.write.format("delta")
        .mode("overwrite")
        .option("overwriteSchema", "true")
        .partitionBy("source_month")
        .saveAsTable(f"silver.{table_name}")
    )
    clean_count = spark.table(f"silver.{table_name}").count()
    if clean_count == 0:
        raise RuntimeError(f"silver.{table_name} is empty")
    quality_rows.append(
        (
            table_name,
            raw_count,
            clean_count,
            raw_count - clean_count,
            float(raw_count - clean_count) / raw_count if raw_count else 0.0,
            processed_at,
        )
    )
    print(f"silver.{table_name}: {clean_count:,} clean rows from {raw_count:,} raw rows")

date_dimension = (
    spark.sql(
        """
        SELECT explode(
            sequence(to_date('2025-01-01'), to_date('2025-12-31'), interval 1 day)
        ) AS date
        """
    )
    .withColumn("date_key", F.date_format("date", "yyyyMMdd").cast("int"))
    .withColumn("year", F.year("date"))
    .withColumn("quarter_number", F.quarter("date"))
    .withColumn("quarter_name", F.concat(F.lit("Q"), F.quarter("date")))
    .withColumn("month_number", F.month("date"))
    .withColumn("month_name", F.date_format("date", "MMMM"))
    .withColumn("month_start", F.trunc("date", "month"))
    .withColumn("year_month", F.date_format("date", "yyyy-MM"))
    .withColumn("day_of_month", F.dayofmonth("date"))
    .withColumn(
        "day_of_week_number",
        ((F.dayofweek("date") + F.lit(5)) % F.lit(7) + F.lit(1)).cast("int"),
    )
    .withColumn("day_name", F.date_format("date", "EEEE"))
    .withColumn("week_of_year", F.weekofyear("date"))
    .withColumn("is_weekend", F.col("day_of_week_number").isin(6, 7))
)

zone_raw = spark.table("bronze.taxi_zone_lookup_raw")
zone_columns = {name.lower(): name for name in zone_raw.columns}
zone_dimension = zone_raw.select(
    F.col(f"`{zone_columns['locationid']}`").cast("int").alias("location_id"),
    F.trim(F.col(f"`{zone_columns['borough']}`")).alias("borough"),
    F.trim(F.col(f"`{zone_columns['zone']}`")).alias("zone_name"),
    F.trim(F.col(f"`{zone_columns['service_zone']}`")).alias("service_zone"),
)
unknown_zone = spark.createDataFrame(
    [(0, "Unknown", "Unknown", "Unknown")],
    "location_id int, borough string, zone_name string, service_zone string",
)
zone_dimension = unknown_zone.unionByName(zone_dimension).dropDuplicates(["location_id"])

static_dimensions = {
    "dim_service_type": spark.createDataFrame(
        [
            (1, "Yellow Taxi"),
            (2, "Green Taxi"),
            (3, "For-Hire Vehicle"),
            (4, "High-Volume For-Hire Vehicle"),
        ],
        "service_type_key int, service_type_name string",
    ),
    "dim_vendor": spark.createDataFrame(
        [
            (0, "Unknown"),
            (1, "Creative Mobile Technologies"),
            (2, "Curb Mobility"),
            (6, "Myle Technologies"),
            (7, "Helix"),
        ],
        "vendor_id int, vendor_name string",
    ),
    "dim_rate_code": spark.createDataFrame(
        [
            (1, "Standard Rate"),
            (2, "JFK"),
            (3, "Newark"),
            (4, "Nassau or Westchester"),
            (5, "Negotiated Fare"),
            (6, "Group Ride"),
            (99, "Unknown"),
        ],
        "rate_code_id int, rate_code_name string",
    ),
    "dim_payment_type": spark.createDataFrame(
        [
            (0, "Flex Fare"),
            (1, "Credit Card"),
            (2, "Cash"),
            (3, "No Charge"),
            (4, "Dispute"),
            (5, "Unknown"),
            (6, "Voided Trip"),
            (99, "Missing"),
        ],
        "payment_type_id int, payment_type_name string",
    ),
    "dim_trip_type": spark.createDataFrame(
        [(0, "Unknown"), (1, "Street Hail"), (2, "Dispatch")],
        "trip_type_id int, trip_type_name string",
    ),
    "dim_hvfhs_license": spark.createDataFrame(
        [
            ("UNKNOWN", "Unknown"),
            ("HV0002", "Juno"),
            ("HV0003", "Uber"),
            ("HV0004", "Via"),
            ("HV0005", "Lyft"),
        ],
        "hvfhs_license_num string, hvfhs_provider_name string",
    ),
}

dimensions = {
    "dim_date": date_dimension,
    "dim_taxi_zone": zone_dimension,
    **static_dimensions,
}
for table_name, frame in dimensions.items():
    (
        frame.write.format("delta")
        .mode("overwrite")
        .option("overwriteSchema", "true")
        .saveAsTable(f"silver.{table_name}")
    )
    count = spark.table(f"silver.{table_name}").count()
    if count == 0:
        raise RuntimeError(f"silver.{table_name} is empty")
    print(f"silver.{table_name}: {count:,} rows")

quality_schema = """
fact_table string,
raw_row_count long,
clean_row_count long,
rejected_row_count long,
rejection_rate double,
processed_at_utc string
"""
(
    spark.createDataFrame(quality_rows, quality_schema)
    .write.format("delta")
    .mode("overwrite")
    .option("overwriteSchema", "true")
    .saveAsTable("silver.data_quality_summary")
)

for dimension_name in dimensions:
    spark.sql(f"OPTIMIZE silver.{dimension_name}")

print("Silver dimensional model completed")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

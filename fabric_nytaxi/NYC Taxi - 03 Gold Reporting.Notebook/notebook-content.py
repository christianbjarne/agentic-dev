# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "synapse_pyspark"
# META   },
# META   "dependencies": {
# META     "lakehouse": {
# META       "default_lakehouse": "1d366068-ed28-4e4d-a36a-495cf9889d6c",
# META       "default_lakehouse_name": "LH_Gold",
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

from pyspark.ml.clustering import KMeans
from pyspark.ml.evaluation import RegressionEvaluator
from pyspark.ml.feature import StandardScaler, VectorAssembler
from pyspark.ml.regression import LinearRegression
from pyspark.sql import functions as F

# Pipeline parameters. Fabric overrides these values when supplied by a caller.

spark.conf.set("spark.sql.parquet.vorder.default", "true")
spark.conf.set("spark.microsoft.delta.optimizeWrite.enabled", "true")
spark.conf.set("spark.databricks.delta.optimizeWrite.enabled", "true")
spark.conf.set("spark.databricks.delta.optimizeWrite.binSize", "1g")
spark.conf.set("spark.sql.adaptive.enabled", "true")

silver_trips = spark.table("src_tbl_nyc_taxi_trip")
silver_zones = spark.table("src_tbl_nyc_taxi_zone")

fact_trip = silver_trips.select(
    "trip_id",
    "pickup_date_key",
    "pickup_datetime",
    "dropoff_datetime",
    "pickup_hour",
    "pickup_day_of_week",
    "pickup_location_id",
    "dropoff_location_id",
    "vendor_id",
    "ratecode_id",
    "payment_type",
    "passenger_count",
    "trip_distance",
    "trip_duration_minutes",
    "fare_amount",
    "tip_amount",
    "tolls_amount",
    "total_amount",
    "source_year",
    "source_month",
).withColumn("service_type", F.lit("Yellow Taxi"))

dim_date = (
    spark.sql(
        f"""
        SELECT explode(
            sequence(
                to_date('{int(process_year)}-01-01'),
                to_date('{int(process_year)}-12-31'),
                interval 1 day
            )
        ) AS full_date
        """
    )
    .withColumn("date_key", F.date_format("full_date", "yyyyMMdd").cast("int"))
    .withColumn("year", F.year("full_date"))
    .withColumn("quarter", F.quarter("full_date"))
    .withColumn("month_number", F.month("full_date"))
    .withColumn("month_name", F.date_format("full_date", "MMMM"))
    .withColumn("week_of_year", F.weekofyear("full_date"))
    .withColumn("day_of_month", F.dayofmonth("full_date"))
    .withColumn("day_name", F.date_format("full_date", "EEEE"))
    .withColumn("is_weekend", F.dayofweek("full_date").isin(1, 7))
)
dim_zone = silver_zones
dim_vendor = spark.createDataFrame(
    [
        (1, "Creative Mobile Technologies"),
        (2, "Curb Mobility"),
        (6, "Myle Technologies"),
        (7, "Helix"),
    ],
    "vendor_id int, vendor_name string",
)
dim_payment = spark.createDataFrame(
    [
        (1, "Credit card"),
        (2, "Cash"),
        (3, "No charge"),
        (4, "Dispute"),
        (5, "Unknown"),
        (6, "Voided trip"),
    ],
    "payment_type int, payment_type_name string",
)
dim_ratecode = spark.createDataFrame(
    [
        (1, "Standard rate"),
        (2, "JFK"),
        (3, "Newark"),
        (4, "Nassau or Westchester"),
        (5, "Negotiated fare"),
        (6, "Group ride"),
        (99, "Unknown"),
    ],
    "ratecode_id int, ratecode_name string",
)

daily_summary = fact_trip.groupBy("pickup_date_key").agg(
    F.count("*").alias("trip_count"),
    F.sum("total_amount").alias("total_revenue"),
    F.sum("fare_amount").alias("fare_revenue"),
    F.sum("tip_amount").alias("tip_revenue"),
    F.avg("fare_amount").alias("average_fare"),
    F.avg("trip_distance").alias("average_distance"),
    F.avg("trip_duration_minutes").alias("average_duration_minutes"),
)
zone_summary = fact_trip.groupBy("pickup_location_id").agg(
    F.count("*").alias("trip_count"),
    F.sum("total_amount").alias("total_revenue"),
    F.avg("fare_amount").alias("average_fare"),
    F.avg("trip_distance").alias("average_distance"),
    F.avg("trip_duration_minutes").alias("average_duration_minutes"),
    F.avg("tip_amount").alias("average_tip"),
)

tables = {
    "tbl_nyc_taxi_fact_trip": fact_trip,
    "tbl_nyc_taxi_dim_date": dim_date,
    "tbl_nyc_taxi_dim_zone": dim_zone,
    "tbl_nyc_taxi_dim_vendor": dim_vendor,
    "tbl_nyc_taxi_dim_payment": dim_payment,
    "tbl_nyc_taxi_dim_ratecode": dim_ratecode,
    "tbl_nyc_taxi_daily_summary": daily_summary,
    "tbl_nyc_taxi_zone_summary": zone_summary,
}
for table_name, frame in tables.items():
    frame.write.format("delta").mode("overwrite").option(
        "overwriteSchema", "true"
    ).saveAsTable(table_name)

# Fare regression. A deterministic sample keeps deployment cost bounded while
# preserving enough rows for a meaningful model.
ml_base = fact_trip.filter(
    (F.col("fare_amount") > 0)
    & (F.col("trip_distance") > 0)
    & (F.col("trip_duration_minutes") > 0)
).select(
    "trip_id",
    "fare_amount",
    "trip_distance",
    "trip_duration_minutes",
    F.coalesce("passenger_count", F.lit(1)).cast("double").alias("passenger_count"),
    F.col("pickup_hour").cast("double").alias("pickup_hour"),
    F.col("pickup_day_of_week").cast("double").alias("pickup_day_of_week"),
)
ml_sample = ml_base.sample(False, 0.08, seed=42).limit(250000).cache()
assembler = VectorAssembler(
    inputCols=[
        "trip_distance",
        "trip_duration_minutes",
        "passenger_count",
        "pickup_hour",
        "pickup_day_of_week",
    ],
    outputCol="features",
    handleInvalid="skip",
)
training = assembler.transform(ml_sample).select(
    "trip_id", F.col("fare_amount").alias("label"), "features"
)
train, test = training.randomSplit([0.8, 0.2], seed=42)
fare_model = LinearRegression(
    featuresCol="features",
    labelCol="label",
    predictionCol="predicted_fare",
    maxIter=30,
    regParam=0.05,
    elasticNetParam=0.0,
).fit(train)
predictions = fare_model.transform(test)
rmse = RegressionEvaluator(
    labelCol="label", predictionCol="predicted_fare", metricName="rmse"
).evaluate(predictions)
r2 = RegressionEvaluator(
    labelCol="label", predictionCol="predicted_fare", metricName="r2"
).evaluate(predictions)
feature_names = assembler.getInputCols()
coefficients = [
    (feature_names[index], float(value), float(fare_model.intercept))
    for index, value in enumerate(fare_model.coefficients)
]
spark.createDataFrame(
    coefficients, "feature_name string, coefficient double, intercept double"
).withColumn("trained_at_utc", F.current_timestamp()).write.format("delta").mode(
    "overwrite"
).saveAsTable("tbl_nyc_taxi_ml_fare_coefficients")
spark.createDataFrame(
    [
        (
            "linear_regression",
            int(train.count()),
            int(test.count()),
            float(rmse),
            float(r2),
            environment,
            datetime.now(timezone.utc),
        )
    ],
    "model_name string, training_rows long, test_rows long, rmse double, "
    "r2 double, environment string, trained_at_utc timestamp",
).write.format("delta").mode("overwrite").saveAsTable(
    "tbl_nyc_taxi_ml_fare_metrics"
)
predictions.select("trip_id", "label", "predicted_fare").limit(25000).write.format(
    "delta"
).mode("overwrite").saveAsTable("tbl_nyc_taxi_ml_fare_predictions")

# Zone segmentation with standardized operational and revenue features.
zone_features = VectorAssembler(
    inputCols=[
        "trip_count",
        "total_revenue",
        "average_fare",
        "average_distance",
        "average_duration_minutes",
        "average_tip",
    ],
    outputCol="raw_features",
    handleInvalid="skip",
).transform(zone_summary)
scaled = StandardScaler(
    inputCol="raw_features",
    outputCol="features",
    withMean=True,
    withStd=True,
).fit(zone_features).transform(zone_features)
zone_model = KMeans(
    k=5, seed=42, featuresCol="features", predictionCol="zone_cluster"
).fit(scaled)
zone_clusters = (
    zone_model.transform(scaled)
    .drop("raw_features", "features")
    .join(
        dim_zone.select(
            F.col("location_id").alias("pickup_location_id"),
            "borough",
            "zone_name",
        ),
        "pickup_location_id",
        "left",
    )
    .withColumn(
        "avg_tip_pct",
        F.when(
            F.col("average_fare") > 0,
            F.col("average_tip") / F.col("average_fare"),
        ).otherwise(F.lit(0.0)),
    )
    .withColumn(
        "cluster_label",
        F.concat(F.lit("Segment "), (F.col("zone_cluster") + F.lit(1)).cast("string")),
    )
)
zone_clusters.write.format("delta").mode("overwrite").option(
    "overwriteSchema", "true"
).saveAsTable("tbl_nyc_taxi_ml_zone_clusters")

for table_name in list(tables) + [
    "tbl_nyc_taxi_ml_fare_coefficients",
    "tbl_nyc_taxi_ml_fare_metrics",
    "tbl_nyc_taxi_ml_fare_predictions",
    "tbl_nyc_taxi_ml_zone_clusters",
]:
    spark.sql(f"OPTIMIZE {table_name}")

fact_count = spark.table("tbl_nyc_taxi_fact_trip").count()
date_count = spark.table("tbl_nyc_taxi_dim_date").count()
cluster_count = spark.table("tbl_nyc_taxi_ml_zone_clusters").count()
metric_count = spark.table("tbl_nyc_taxi_ml_fare_metrics").count()
if fact_count == 0 or date_count not in (365, 366) or cluster_count == 0 or metric_count != 1:
    raise RuntimeError(
        "Gold validation failed: "
        f"facts={fact_count}, dates={date_count}, clusters={cluster_count}, "
        f"metrics={metric_count}"
    )
print(
    f"Gold and ML completed: facts={fact_count:,}, zones={cluster_count}, "
    f"fare_rmse={rmse:.3f}, fare_r2={r2:.3f}"
)


# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

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
from pyspark.sql import types as T

CONFIG = {
    "source_path": "Files/shortcuts/bronze/sales_orders",
    "target_table": "tbl_sales_orders",
    "required_columns": [
        "order_id",
        "line_id",
        "order_ts",
        "customer_id",
        "product_id",
        "quantity",
        "unit_price",
    ],
}

ORDER_SCHEMA = T.StructType(
    [
        T.StructField("order_id", T.StringType(), False),
        T.StructField("line_id", T.StringType(), False),
        T.StructField("order_ts", T.TimestampType(), False),
        T.StructField("customer_id", T.StringType(), False),
        T.StructField("product_id", T.StringType(), False),
        T.StructField("quantity", T.IntegerType(), False),
        T.StructField("unit_price", T.DecimalType(18, 2), False),
        T.StructField("_ingest_ts_utc", T.TimestampType(), True),
        T.StructField("_ingest_run_id", T.StringType(), True),
    ]
)

print(f"[silver] source={CONFIG['source_path']}")
print(f"[silver] target_table={CONFIG['target_table']}")

bronze_df = spark.read.format("parquet").load(CONFIG["source_path"])

missing_columns = [c for c in CONFIG["required_columns"] if c not in bronze_df.columns]
if missing_columns:
    raise ValueError(f"[silver] missing required columns: {missing_columns}")

# Enforce types, standardize casing, and apply deterministic cleansing.
silver_df = (
    bronze_df.select([F.col(c) for c in bronze_df.columns])
    .withColumn("order_id", F.trim(F.col("order_id")).cast("string"))
    .withColumn("line_id", F.trim(F.col("line_id")).cast("string"))
    .withColumn("order_ts", F.to_timestamp("order_ts"))
    .withColumn("customer_id", F.upper(F.trim(F.col("customer_id"))))
    .withColumn("product_id", F.upper(F.trim(F.col("product_id"))))
    .withColumn("quantity", F.col("quantity").cast("int"))
    .withColumn("unit_price", F.col("unit_price").cast("decimal(18,2)"))
    .withColumn("order_date", F.to_date("order_ts"))
    .dropDuplicates(["order_id", "line_id"])
    .filter(F.col("order_id").isNotNull())
    .filter(F.col("line_id").isNotNull())
    .filter(F.col("order_ts").isNotNull())
    .filter(F.col("customer_id").isNotNull())
    .filter(F.col("product_id").isNotNull())
    .filter(F.col("quantity").isNotNull())
    .filter(F.col("unit_price").isNotNull())
)

# Apply strict schema ordering to avoid drift.
silver_df = spark.createDataFrame(silver_df.rdd, schema=ORDER_SCHEMA.add(T.StructField("order_date", T.DateType(), True)))

row_count = silver_df.count()
print(f"[silver] rows_ready={row_count}")

(
    silver_df.write.format("delta")
    .mode("overwrite")
    .partitionBy("order_date")
    .saveAsTable(CONFIG["target_table"])
)

print("[silver] write_complete")


# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

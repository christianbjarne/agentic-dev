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
    "silver_table": "tbl_sales_orders",
    "gold_fact_table": "tbl_sales_fact_sales",
    "gold_dim_customer_table": "tbl_sales_dim_customer",
    "gold_dim_product_table": "tbl_sales_dim_product",
}

print(f"[gold] source_table={CONFIG['silver_table']}")

silver_df = spark.table(CONFIG["silver_table"])

dim_customer_df = (
    silver_df.select("customer_id")
    .where(F.col("customer_id").isNotNull())
    .dropDuplicates(["customer_id"])
    .withColumn("customer_sk", F.abs(F.hash(F.col("customer_id"))))
)

dim_product_df = (
    silver_df.select("product_id")
    .where(F.col("product_id").isNotNull())
    .dropDuplicates(["product_id"])
    .withColumn("product_sk", F.abs(F.hash(F.col("product_id"))))
)

fact_sales_df = (
    silver_df.alias("s")
    .join(dim_customer_df.alias("c"), on="customer_id", how="left")
    .join(dim_product_df.alias("p"), on="product_id", how="left")
    .select(
        F.col("s.order_id"),
        F.col("s.line_id"),
        F.col("s.order_ts"),
        F.col("s.order_date"),
        F.col("c.customer_sk"),
        F.col("p.product_sk"),
        F.col("s.quantity"),
        F.col("s.unit_price"),
        (F.col("s.quantity") * F.col("s.unit_price")).alias("gross_amount"),
    )
)

print(f"[gold] dim_customer_rows={dim_customer_df.count()}")
print(f"[gold] dim_product_rows={dim_product_df.count()}")
print(f"[gold] fact_sales_rows={fact_sales_df.count()}")

(
    dim_customer_df.write.format("delta")
    .mode("overwrite")
    .saveAsTable(CONFIG["gold_dim_customer_table"])
)

(
    dim_product_df.write.format("delta")
    .mode("overwrite")
    .saveAsTable(CONFIG["gold_dim_product_table"])
)

(
    fact_sales_df.write.format("delta")
    .mode("overwrite")
    .partitionBy("order_date")
    .saveAsTable(CONFIG["gold_fact_table"])
)
spark.conf.set("spark.sql.parquet.vorder.enabled", "false")

try:
    spark.sql(f"OPTIMIZE {CONFIG['gold_fact_table']} ZORDER BY (order_date)")
except Exception as optimize_error:
    print(f"[gold] optimize_skipped={optimize_error}")

print("[gold] write_complete")


# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

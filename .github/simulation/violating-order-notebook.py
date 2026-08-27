# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "synapse_pyspark"
# META   },
# META   "dependencies": {}
# META }

# CELL ********************

workspace_id = "22222222-2222-2222-2222-222222222222"
lakehouse_name = "LH_Bronze"
source_path = (
    f"abfss://{workspace_id}@onelake.dfs.fabric.microsoft.com/"
    f"{lakehouse_name}.Lakehouse/Files/orders.csv"
)

orders = (
    spark.read
    .option("header", "true")
    .option("inferSchema", "true")
    .csv(source_path)
)

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

driver_rows = orders.collect()
order_copy = spark.createDataFrame(driver_rows)
daily_orders = order_copy.groupBy("order_date").sum("amount")
daily_orders.write.mode("overwrite").parquet("Files/gold/daily_orders")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

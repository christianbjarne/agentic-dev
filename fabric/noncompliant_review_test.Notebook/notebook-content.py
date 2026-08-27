# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "synapse_pyspark"
# META   },
# META   "dependencies": {}
# META }

# CELL ********************

# This notebook intentionally remains noncompliant for PR validation testing.
workspace_id = "11111111-1111-1111-1111-111111111111"
lakehouse_name = "LH_Bronze"
source_path = (
    f"abfss://{workspace_id}@onelake.dfs.fabric.microsoft.com/"
    f"{lakehouse_name}.Lakehouse/Files/customers.csv"
)

customers = (
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

clean_customers = customers.filter("email IS NOT NULL").dropDuplicates(["customer_id"])
driver_rows = clean_customers.collect()
customer_copy = spark.createDataFrame(driver_rows)

customer_summary = customer_copy.groupBy("country").count()
customer_summary.write.mode("overwrite").parquet("Files/gold/customer_summary")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

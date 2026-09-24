# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "synapse_pyspark"
# META   },
# META   "dependencies": {}
# META }

# CELL ********************

# This notebook intentionally violates repository guidance to exercise the
# Copilot Fabric review workflow. It must never be deployed or merged.
workspace_id = "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d"
lakehouse_id = "aa11bb22-cc33-dd44-ee55-ff6600112233"

# CELL ********************

raw_customers = (
    spark.read.format("csv")
    .option("header", "true")
    .option("inferSchema", "true")
    .load("Files/bronze/customers.csv")
)

customer_rows = raw_customers.collect()
customers = spark.createDataFrame([row.asDict() for row in customer_rows])

# CELL ********************

(
    customers.write.format("delta")
    .mode("overwrite")
    .save("Files/gold/customer_summary")
)

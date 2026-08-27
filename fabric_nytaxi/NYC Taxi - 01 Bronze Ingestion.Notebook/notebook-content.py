# Fabric notebook source

# METADATA ********************

# META {
# META   "kernel_info": {
# META     "name": "synapse_pyspark"
# META   },
# META   "dependencies": {
# META     "lakehouse": {
# META       "default_lakehouse": "f6a83a1d-58a5-4141-9357-9cb7e6e1021d",
# META       "default_lakehouse_name": "LH_Bronze",
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
import json

from pyspark.sql import functions as F

# Pipeline parameters. Fabric overrides these values when supplied by a caller.

month_token = f"{int(process_month):02d}"
trip_path = (
    f"Files/nyc_taxi/raw/yellow/"
    f"yellow_tripdata_{int(process_year)}-{month_token}.parquet"
)
zone_path = "Files/nyc_taxi/raw/reference/taxi_zone_lookup.csv"

# Bronze is intentionally Files-only. Reading here is validation, not transformation.
trip_df = spark.read.parquet(trip_path)
zone_df = spark.read.option("header", True).csv(zone_path)
trip_rows = trip_df.count()
zone_rows = zone_df.count()

required_trip_columns = {
    "VendorID",
    "tpep_pickup_datetime",
    "tpep_dropoff_datetime",
    "passenger_count",
    "trip_distance",
    "PULocationID",
    "DOLocationID",
    "payment_type",
    "fare_amount",
    "tip_amount",
    "total_amount",
}
missing_columns = sorted(required_trip_columns.difference(trip_df.columns))
if missing_columns:
    raise RuntimeError(f"Bronze source is missing columns: {missing_columns}")
if trip_rows == 0 or zone_rows < 250:
    raise RuntimeError(
        f"Bronze validation failed: trip_rows={trip_rows}, zone_rows={zone_rows}"
    )

validation = {
    "environment": environment,
    "process_year": int(process_year),
    "process_month": int(process_month),
    "trip_path": trip_path,
    "zone_path": zone_path,
    "trip_rows": trip_rows,
    "zone_rows": zone_rows,
    "validated_at_utc": datetime.now(timezone.utc).isoformat(),
    "storage_policy": "Bronze Files only; no managed tables created",
}
print(json.dumps(validation, indent=2))



# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

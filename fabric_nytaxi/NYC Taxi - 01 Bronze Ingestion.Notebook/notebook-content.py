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

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import os
import re
import time
import uuid

import requests
from pyspark.sql import functions as F


spark.conf.set("spark.sql.parquet.vorder.default", "false")
spark.conf.set("spark.databricks.delta.optimizeWrite.enabled", "true")
spark.conf.set("spark.databricks.delta.autoCompact.enabled", "true")

for schema_name in ("bronze", "silver", "gold"):
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {schema_name}")

files_root = "/lakehouse/default/Files"
trip_root = f"{files_root}/landing/trip_data"
reference_root = f"{files_root}/reference"
batch_id = str(uuid.uuid4())

trip_categories = {
    "yellow": "yellow_tripdata",
    "green": "green_tripdata",
    "fhv": "fhv_tripdata",
    "fhvhv": "fhvhv_tripdata",
}

sources = []
for category, prefix in trip_categories.items():
    for month in range(1, 13):
        file_name = f"{prefix}_2025-{month:02d}.parquet"
        sources.append(
            {
                "asset_type": "trip_data",
                "category": category,
                "month": month,
                "url": f"https://d37ci6vzurychx.cloudfront.net/trip-data/{file_name}",
                "path": f"{trip_root}/{category}/{file_name}",
            }
        )

sources.extend(
    [
        {
            "asset_type": "lookup",
            "category": "taxi_zone",
            "month": None,
            "url": "https://d37ci6vzurychx.cloudfront.net/misc/taxi_zone_lookup.csv",
            "path": f"{reference_root}/lookups/taxi_zone_lookup.csv",
        },
        {
            "asset_type": "lookup",
            "category": "taxi_zone",
            "month": None,
            "url": "https://d37ci6vzurychx.cloudfront.net/misc/taxi_zones.zip",
            "path": f"{reference_root}/lookups/taxi_zones.zip",
        },
        {
            "asset_type": "data_dictionary",
            "category": "yellow",
            "month": None,
            "url": "https://www.nyc.gov/assets/tlc/downloads/pdf/data_dictionary_trip_records_yellow.pdf",
            "path": f"{reference_root}/data_dictionaries/yellow_trip_records.pdf",
        },
        {
            "asset_type": "data_dictionary",
            "category": "green",
            "month": None,
            "url": "https://www.nyc.gov/assets/tlc/downloads/pdf/data_dictionary_trip_records_green.pdf",
            "path": f"{reference_root}/data_dictionaries/green_trip_records.pdf",
        },
        {
            "asset_type": "data_dictionary",
            "category": "fhv",
            "month": None,
            "url": "https://www.nyc.gov/assets/tlc/downloads/pdf/data_dictionary_trip_records_fhv.pdf",
            "path": f"{reference_root}/data_dictionaries/fhv_trip_records.pdf",
        },
        {
            "asset_type": "data_dictionary",
            "category": "fhvhv",
            "month": None,
            "url": "https://www.nyc.gov/assets/tlc/downloads/pdf/data_dictionary_trip_records_hvfhs.pdf",
            "path": f"{reference_root}/data_dictionaries/high_volume_fhv_trip_records.pdf",
        },
    ]
)

request_headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127 Safari/537.36",
    "Accept": "*/*",
}


def download_one(source):
    destination = source["path"]
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    temporary = f"{destination}.part"

    for attempt in range(1, 4):
        try:
            with requests.get(
                source["url"],
                headers=request_headers,
                stream=True,
                timeout=(30, 600),
                allow_redirects=True,
            ) as response:
                response.raise_for_status()
                expected_size = int(response.headers.get("content-length") or 0)
                if os.path.exists(destination):
                    current_size = os.path.getsize(destination)
                    if current_size > 0 and (expected_size == 0 or current_size == expected_size):
                        return {**source, "downloaded_size": current_size, "status": "existing"}

                with open(temporary, "wb") as output:
                    for chunk in response.iter_content(chunk_size=8 * 1024 * 1024):
                        if chunk:
                            output.write(chunk)

            downloaded_size = os.path.getsize(temporary)
            if expected_size and downloaded_size != expected_size:
                raise IOError(
                    f"Size mismatch for {source['url']}: expected {expected_size}, got {downloaded_size}"
                )
            os.replace(temporary, destination)
            return {**source, "downloaded_size": downloaded_size, "status": "downloaded"}
        except Exception:
            if os.path.exists(temporary):
                os.remove(temporary)
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


download_results = []
with ThreadPoolExecutor(max_workers=4) as executor:
    futures = {executor.submit(download_one, source): source for source in sources}
    for future in as_completed(futures):
        result = future.result()
        download_results.append(result)
        print(f"{result['status']:>10} {result['downloaded_size']:>12,} {result['path']}")

trip_pattern = re.compile(r"_2025-(\d{2})\.parquet$")
for category in trip_categories:
    table_name = f"bronze.{category}_trips_raw"
    spark.sql(f"DROP TABLE IF EXISTS {table_name}")
    category_files = sorted(
        result["path"]
        for result in download_results
        if result["asset_type"] == "trip_data" and result["category"] == category
    )
    if len(category_files) != 12:
        raise RuntimeError(f"Expected 12 {category} files, found {len(category_files)}")

    for index, path in enumerate(category_files):
        month_match = trip_pattern.search(path)
        if not month_match:
            raise RuntimeError(f"Could not derive source month from {path}")
        source_month = int(month_match.group(1))
        spark_path = path.replace(f"{files_root}/", "Files/")
        frame = (
            spark.read.parquet(spark_path)
            .withColumn("_ingestion_timestamp", F.current_timestamp())
            .withColumn("_source_file", F.lit(os.path.basename(path)))
            .withColumn("_batch_id", F.lit(batch_id))
            .withColumn("_source_year", F.lit(2025))
            .withColumn("_source_month", F.lit(source_month))
            .withColumn("_service_type", F.lit(category))
        )
        mode = "overwrite" if index == 0 else "append"
        (
            frame.write.format("delta")
            .mode(mode)
            .option("mergeSchema", "true")
            .partitionBy("_source_year", "_source_month")
            .saveAsTable(table_name)
        )

zone_lookup = (
    spark.read.option("header", True)
    .option("inferSchema", True)
    .csv("Files/reference/lookups/taxi_zone_lookup.csv")
)
(
    zone_lookup.withColumn("_ingestion_timestamp", F.current_timestamp())
    .withColumn("_source_file", F.lit("taxi_zone_lookup.csv"))
    .withColumn("_batch_id", F.lit(batch_id))
    .write.format("delta")
    .mode("overwrite")
    .option("overwriteSchema", "true")
    .saveAsTable("bronze.taxi_zone_lookup_raw")
)

loaded_at = datetime.now(timezone.utc).isoformat()
manifest_rows = [
    (
        item["asset_type"],
        item["category"],
        item["month"],
        item["url"],
        item["path"].replace(f"{files_root}/", "Files/"),
        item["downloaded_size"],
        item["status"],
        batch_id,
        loaded_at,
    )
    for item in sorted(download_results, key=lambda value: value["path"])
]
manifest_schema = """
asset_type string,
category string,
source_month int,
source_url string,
lakehouse_path string,
file_size_bytes long,
download_status string,
batch_id string,
loaded_at_utc string
"""
(
    spark.createDataFrame(manifest_rows, manifest_schema)
    .write.format("delta")
    .mode("overwrite")
    .option("overwriteSchema", "true")
    .saveAsTable("bronze.source_manifest")
)

expected_assets = 48 + 2 + 4
if len(download_results) != expected_assets:
    raise RuntimeError(f"Expected {expected_assets} source assets, found {len(download_results)}")

for table_name in (
    "bronze.yellow_trips_raw",
    "bronze.green_trips_raw",
    "bronze.fhv_trips_raw",
    "bronze.fhvhv_trips_raw",
    "bronze.taxi_zone_lookup_raw",
    "bronze.source_manifest",
):
    row_count = spark.table(table_name).count()
    if row_count == 0:
        raise RuntimeError(f"{table_name} is empty")
    print(f"{table_name}: {row_count:,} rows")

print(f"Bronze ingestion completed with batch ID {batch_id}")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

# CELL ********************

print("Hello World")

# METADATA ********************

# META {
# META   "language": "python",
# META   "language_group": "synapse_pyspark"
# META }

// Generates notebook-content.ipynb for the zone-clustering ML notebook.
const fs = require('fs');
const path = require('path');

const WS = '36075c3f-6958-4d8b-9a58-b41b3bad4832';
const LH = '774809b0-278d-4417-b91d-dce1b561bf45';
const BASE = `abfss://${WS}@onelake.dfs.fabric.microsoft.com/${LH}/Tables/silver`;

const cells = [];
const md = (src) => cells.push({ cell_type: 'markdown', metadata: {}, source: lines(src) });
const code = (src) => cells.push({ cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source: lines(src) });
function lines(s) {
  const arr = s.replace(/^\n/, '').replace(/\n$/, '').split('\n');
  return arr.map((l, i) => i === arr.length - 1 ? l : l + '\n');
}

md(`
# NYC Taxi — Zone Segmentation (Machine Learning)

Unsupervised **KMeans** clustering that segments pickup zones into revenue/demand tiers
using per-zone features (revenue, trips, average fare, tip %, trip distance).
Output is written to the Delta table \`silver.ml_zone_clusters\` and surfaced in the
**ML Insights** page of the *Taxi Revenue* report.
`);

code(`
from pyspark.sql import functions as F
from pyspark.ml.feature import VectorAssembler, StandardScaler
from pyspark.ml.clustering import KMeans
from pyspark.sql.window import Window

BASE = "${BASE}"
fact = spark.read.format("delta").load(f"{BASE}/fact_trips")
zone = spark.read.format("delta").load(f"{BASE}/dim_zone")
print("fact rows:", fact.count(), "| zones:", zone.count())
`);

code(`
# Per-zone feature engineering (pickup zone)
agg = (fact.groupBy("pu_location_id")
       .agg(F.sum("total_amount").alias("total_revenue"),
            F.count(F.lit(1)).alias("total_trips"),
            F.avg("fare_amount").alias("avg_fare"),
            F.avg("trip_distance").alias("avg_distance"),
            F.avg(F.when(F.col("total_amount") > 0, F.col("tip_amount") / F.col("total_amount"))
                   .otherwise(F.lit(0.0))).alias("avg_tip_pct")))

feat = (agg.join(zone, agg.pu_location_id == zone.location_id, "inner")
            .select(zone.location_id.alias("location_id"),
                    zone.zone.alias("zone"),
                    zone.borough.alias("borough"),
                    F.col("total_revenue"), F.col("total_trips"),
                    F.col("avg_fare"), F.col("avg_distance"), F.col("avg_tip_pct"))
            .na.drop())
feat.cache()
print("zones with trips:", feat.count())
`);

code(`
# Scale features and fit KMeans (4 segments)
cols = ["total_revenue", "total_trips", "avg_fare", "avg_distance", "avg_tip_pct"]
va = VectorAssembler(inputCols=cols, outputCol="raw")
sc = StandardScaler(inputCol="raw", outputCol="features", withMean=True, withStd=True)
vec = va.transform(feat)
model = sc.fit(vec)
scaled = model.transform(vec)

k = 4
km = KMeans(k=k, seed=42, featuresCol="features", predictionCol="cluster_id")
fit = km.fit(scaled)
pred = fit.transform(scaled)
print("Silhouette training cost:", fit.summary.trainingCost)
`);

code(`
# Rank clusters by average revenue and assign human-readable tier labels
rank = (pred.groupBy("cluster_id").agg(F.avg("total_revenue").alias("c_rev"))
            .withColumn("rk", F.row_number().over(Window.orderBy(F.desc("c_rev")))))
tiers = {1: "Premium hubs", 2: "High-value", 3: "Mid-tier", 4: "Low-activity"}
label_expr = F
labeled = rank.select("cluster_id", "rk")
m = {row["cluster_id"]: tiers.get(row["rk"], f"Tier {row['rk']}") for row in labeled.collect()}

map_expr = F.create_map([x for kv in m.items() for x in (F.lit(kv[0]), F.lit(kv[1]))])
out = (pred.withColumn("cluster_label", map_expr[F.col("cluster_id")])
           .select("location_id", "zone", "borough",
                   F.round("total_revenue", 2).alias("total_revenue"),
                   F.col("total_trips").cast("long").alias("total_trips"),
                   F.round("avg_fare", 2).alias("avg_fare"),
                   F.round("avg_distance", 3).alias("avg_distance"),
                   F.round("avg_tip_pct", 4).alias("avg_tip_pct"),
                   F.col("cluster_id").cast("int").alias("cluster_id"),
                   "cluster_label"))
out.orderBy(F.desc("total_revenue")).show(10, False)
`);

code(`
# Persist results as a Delta table in the silver schema (Direct Lake ready)
(out.write.format("delta").mode("overwrite")
    .option("overwriteSchema", "true")
    .save(f"{BASE}/ml_zone_clusters"))
print("Wrote silver.ml_zone_clusters:", out.count(), "rows")
`);

const nb = {
  cells,
  metadata: {
    kernelspec: { name: 'synapse_pyspark', display_name: 'Synapse PySpark' },
    language_info: { name: 'python' },
    microsoft: { language: 'python' },
    dependencies: {
      lakehouse: {
        default_lakehouse: LH,
        default_lakehouse_name: 'nyc_taxi_lakehouse',
        default_lakehouse_workspace_id: WS
      }
    }
  },
  nbformat: 4,
  nbformat_minor: 5
};

fs.writeFileSync(path.join(__dirname, 'notebook-content.ipynb'), JSON.stringify(nb, null, 1));
console.log('Wrote notebook-content.ipynb with', cells.length, 'cells');

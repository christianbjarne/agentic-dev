// Generates notebook-fare.ipynb — regression model predicting metered fare.
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
# NYC Taxi — Fare Prediction (Machine Learning)

Supervised **Linear Regression** that predicts the metered \`fare_amount\` from
\`trip_distance\`, \`trip_minutes\` and \`passenger_count\`. Trained on a 80/20 split,
evaluated with R², RMSE and MAE. Outputs three Delta tables consumed by the
**Fare Prediction** page of the *Taxi Revenue* report:
\`silver.ml_fare_metrics\`, \`silver.ml_fare_eval\`, \`silver.ml_fare_coef\`.
`);

code(`
from pyspark.sql import functions as F
from pyspark.ml.feature import VectorAssembler
from pyspark.ml.regression import LinearRegression
from pyspark.ml.evaluation import RegressionEvaluator

BASE = "${BASE}"
fact = spark.read.format("delta").load(f"{BASE}/fact_trips")

# Clean: positive fares/distance, sane bounds to remove outliers
df = (fact.select("fare_amount", "trip_distance", "trip_minutes", "passenger_count")
          .na.drop()
          .where((F.col("fare_amount") > 0) & (F.col("fare_amount") < 500) &
                 (F.col("trip_distance") > 0) & (F.col("trip_distance") < 100) &
                 (F.col("trip_minutes") > 0) & (F.col("trip_minutes") < 360) &
                 (F.col("passenger_count") >= 0) & (F.col("passenger_count") < 9)))
df.cache()
print("training population:", df.count())
`);

code(`
FEATURES = ["trip_distance", "trip_minutes", "passenger_count"]
va = VectorAssembler(inputCols=FEATURES, outputCol="features")
data = va.transform(df).select("features", F.col("fare_amount").alias("label"))
train, test = data.randomSplit([0.8, 0.2], seed=42)

lr = LinearRegression(featuresCol="features", labelCol="label",
                      regParam=0.0, elasticNetParam=0.0)
mdl = lr.fit(train)
pred = mdl.transform(test)

r2 = RegressionEvaluator(metricName="r2").evaluate(pred)
rmse = RegressionEvaluator(metricName="rmse").evaluate(pred)
mae = RegressionEvaluator(metricName="mae").evaluate(pred)
print(f"R2={r2:.4f}  RMSE={rmse:.3f}  MAE={mae:.3f}")
print("coefficients:", mdl.coefficients, "intercept:", mdl.intercept)
`);

code(`
# 1) Metrics table (single row)
from pyspark.sql import Row
n_train, n_test = train.count(), test.count()
avg_actual = pred.agg(F.avg("label")).first()[0]
avg_pred = pred.agg(F.avg("prediction")).first()[0]
metrics = spark.createDataFrame([Row(
    r2=float(r2), rmse=float(rmse), mae=float(mae),
    n_train=int(n_train), n_test=int(n_test),
    avg_actual=float(avg_actual), avg_predicted=float(avg_pred),
    intercept=float(mdl.intercept))])
(metrics.write.format("delta").mode("overwrite").option("overwriteSchema", "true")
        .save(f"{BASE}/ml_fare_metrics"))
metrics.show(truncate=False)
`);

code(`
# 2) Coefficients table (feature importance)
coef = spark.createDataFrame(
    [Row(feature=f, coefficient=float(c), abs_coefficient=abs(float(c)))
     for f, c in zip(FEATURES, mdl.coefficients)] +
    [Row(feature="(intercept)", coefficient=float(mdl.intercept), abs_coefficient=abs(float(mdl.intercept)))])
(coef.write.format("delta").mode("overwrite").option("overwriteSchema", "true")
     .save(f"{BASE}/ml_fare_coef"))
coef.show(truncate=False)
`);

code(`
# 3) Evaluation buckets: actual vs predicted by trip-distance band
from pyspark.ml.functions import vector_to_array
buck = (pred.withColumn("d", vector_to_array("features").getItem(0))
            .withColumn("distance_bucket",
                F.when(F.col("d") < 1, "1. 0-1 mi")
                 .when(F.col("d") < 2, "2. 1-2 mi")
                 .when(F.col("d") < 5, "3. 2-5 mi")
                 .when(F.col("d") < 10, "4. 5-10 mi")
                 .otherwise("5. 10+ mi")))
ev = (buck.groupBy("distance_bucket")
          .agg(F.round(F.avg("label"), 2).alias("avg_actual"),
               F.round(F.avg("prediction"), 2).alias("avg_predicted"),
               F.round(F.avg("d"), 2).alias("avg_distance"),
               F.count(F.lit(1)).cast("long").alias("n_trips"),
               F.round(F.avg(F.abs(F.col("label") - F.col("prediction"))), 2).alias("avg_abs_error"))
          .orderBy("distance_bucket"))
(ev.write.format("delta").mode("overwrite").option("overwriteSchema", "true")
     .save(f"{BASE}/ml_fare_eval"))
ev.show(truncate=False)
print("Fare prediction tables written.")
`);

const nb = {
  cells,
  metadata: {
    kernelspec: { name: 'synapse_pyspark', display_name: 'Synapse PySpark' },
    language_info: { name: 'python' },
    microsoft: { language: 'python' },
    dependencies: {
      lakehouse: { default_lakehouse: LH, default_lakehouse_name: 'nyc_taxi_lakehouse', default_lakehouse_workspace_id: WS }
    }
  },
  nbformat: 4, nbformat_minor: 5
};

fs.writeFileSync(path.join(__dirname, 'notebook-fare.ipynb'), JSON.stringify(nb, null, 1));
console.log('Wrote notebook-fare.ipynb with', cells.length, 'cells');

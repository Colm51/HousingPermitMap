import json
from pathlib import Path

import pandas as pd
 
input_file = Path(
    "/Users/aidancarter/Desktop/CodexSandbox/PermitsMap/DataValidation/"
    "housing_permits_map_2026-08-09.parquet"
)

output_file = Path(
    "/Users/aidancarter/Desktop/CodexSandbox/HousingPermitMap/data/"
    "housing_permits_web_2026-08-09.geojson"
)

df = pd.read_parquet(input_file)

# Convert pandas missing values such as NaN/NaT to Python None,
# which becomes valid JSON null.
df = df.astype(object).where(pd.notna(df), None)

features = []

for _, row in df.iterrows():
    properties = {}

    for column in df.columns:
        if column not in ["longitude", "latitude"]:
            value = row[column]

            # Convert pandas Timestamp values to strings.
            if isinstance(value, pd.Timestamp):
                value = value.isoformat()

            properties[column] = value

    feature = {
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": [
                float(row["longitude"]),
                float(row["latitude"]),
            ],
        },
        "properties": properties,
    }

    features.append(feature)

geojson = {
    "type": "FeatureCollection",
    "features": features,
}

with open(output_file, "w", encoding="utf-8") as f:
    json.dump(
        geojson,
        f,
        ensure_ascii=False,
        allow_nan=False,
    )

print(f"Created: {output_file}")
print(f"Features: {len(features):,}")
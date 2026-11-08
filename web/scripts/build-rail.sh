#!/bin/sh
# Builds the European rail network tiles drawn under the trains, from OpenStreetMap (the data
# OpenRailwayMap draws). Mapbox Streets has no railways below zoom 8, so the network comes from here.
#
#   1. download each country's extract from Geofabrik, keep only railway=rail|narrow_gauge ways
#      (osmium), and throw the extract away (about 30 GB pass through, a few hundred MB stay);
#   2. merge the countries, export to GeoJSON, keep passenger lines (rail-features.ts);
#   3. cut vector tiles z4-z11 (tippecanoe) into $OUT, served by the server under /tiles/rail.
#
# Needs osmium-tool and tippecanoe (brew install osmium-tool tippecanoe). Takes about an hour.
# Run from web/: sh scripts/build-rail.sh, then copy $OUT to the server (see README).
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${WORK:-/tmp/continent-rail}
OUT=${OUT:-$WORK/tiles/rail}
UA='Continent (https://github.com/felixchvl/continent)'
# One extract per country (Geofabrik also has overlapping ones: alps, dach, britain-and-ireland...).
COUNTRIES=${COUNTRIES:-'albania andorra austria belarus belgium bosnia-herzegovina bulgaria croatia czech-republic
denmark estonia finland france germany greece hungary ireland-and-northern-ireland italy kosovo latvia
liechtenstein lithuania luxembourg macedonia moldova monaco montenegro netherlands norway poland portugal
romania serbia slovakia slovenia spain sweden switzerland turkey ukraine united-kingdom africa/morocco'}

mkdir -p "$WORK/rail"
cd "$WORK"

# 1. Per country: download, filter, delete. Already filtered countries are skipped (re-runnable).
for c in $COUNTRIES; do
  name=$(basename "$c")
  path=$c
  case $c in */*) ;; *) path=europe/$c ;; esac
  [ -s "rail/$name.osm.pbf" ] && continue
  echo "$(date +%H:%M:%S) $name"
  curl -sSfL -A "$UA" -o "$name.osm.pbf" "https://download.geofabrik.de/$path-latest.osm.pbf"
  osmium tags-filter "$name.osm.pbf" w/railway=rail,narrow_gauge -o "rail/$name.osm.pbf" --overwrite --no-progress
  rm -f "$name.osm.pbf"
done

# 2. Merge (overlapping borders are de-duplicated), export, keep the lines worth drawing.
echo "$(date +%H:%M:%S) merge"
osmium merge rail/*.osm.pbf -o europe-rail.osm.pbf --overwrite --no-progress
osmium export europe-rail.osm.pbf -f geojsonseq --geometry-types=linestring -o europe-rail.geojsonseq --overwrite --no-progress
node "$HERE/rail-features.ts" europe-rail.geojsonseq lines.geojsonseq

# 3. Tiles: high-speed and main lines from z4, every passenger line from z6.
echo "$(date +%H:%M:%S) tiles"
rm -rf "$OUT" && mkdir -p "$(dirname "$OUT")"
tippecanoe -e "$OUT" -l rail -Z4 -z11 --force --quiet \
  -j '{ "rail": [ "any", [ ">=", "$zoom", 6 ], [ "in", "c", "gv", "main" ] ] }' \
  --coalesce --reorder --simplification=2 --drop-densest-as-needed --extend-zooms-if-still-dropping \
  -P lines.geojsonseq
du -sh "$OUT"
echo "$(date +%H:%M:%S) done: $OUT"

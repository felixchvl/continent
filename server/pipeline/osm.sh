#!/bin/sh
# Continent's OpenStreetMap pipeline, run once a month on the server (continent-osm.timer):
#
#   download  each country's extract from Geofabrik, keep what runs on rails (filter.txt: tracks of
#             every kind, the lines, the stations), throw the extract away; merge the countries
#   load      into PostgreSQL, schema osm (bronze), with osm2pgsql and rail.lua
#   silver    silver.line, silver.track, silver.station (silver.sql)
#   actors    the library of operators, networks and authorities, with their logos (actors.ts)
#   tiles     vector tiles for the map: rail (z4-11, every passenger line) and urbain (z9-13:
#             metros, trams, funiculars and the stations), swapped in atomically
#
# STAGES picks the stages (default: all). About 30 GB pass through the download, a few hundred MB stay.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${WORK:-/var/lib/continent/osm}
TILES=${TILES:-/var/lib/continent/tiles}
DB=${DB:-continent}
STAGES=${STAGES:-download load silver actors tiles}
UA='Continent (https://github.com/felixchvl/continent)'
# One extract per country (Geofabrik also has overlapping ones: alps, dach, britain-and-ireland...).
COUNTRIES=${COUNTRIES:-'albania andorra austria belarus belgium bosnia-herzegovina bulgaria croatia czech-republic
denmark estonia finland france germany greece hungary ireland-and-northern-ireland italy kosovo latvia
liechtenstein lithuania luxembourg macedonia moldova monaco montenegro netherlands norway poland portugal
romania serbia slovakia slovenia spain sweden switzerland turkey ukraine united-kingdom africa/morocco'}

log() { echo "$(date '+%F %T') $*"; }
has() { case " $STAGES " in *" $1 "*) return 0 ;; esac; return 1; }
sql() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

mkdir -p "$WORK/countries" "$TILES"
cd "$WORK"
started=$(date -Iseconds)

if has download; then
  for c in $COUNTRIES; do
    name=$(basename "$c")
    path=$c
    case $c in */*) ;; *) path=europe/$c ;; esac
    out=countries/$name.osm.pbf
    # A country filtered less than 20 days ago is kept: the stage can be re-run after a failure.
    if [ -s "$out" ] && [ -n "$(find "$out" -mtime -20)" ]; then continue; fi
    log "download $name"
    curl -sSfL -A "$UA" -o "$name.full.osm.pbf" "https://download.geofabrik.de/$path-latest.osm.pbf"
    osmium tags-filter "$name.full.osm.pbf" -e "$HERE/filter.txt" -o "$out" --overwrite --no-progress
    rm -f "$name.full.osm.pbf"
  done
  log "merge"
  osmium merge countries/*.osm.pbf -o europe.osm.pbf --overwrite --no-progress
  ls -l europe.osm.pbf
fi

if has load; then
  log "load"
  sql -c 'create schema if not exists osm'
  osm2pgsql --create --slim --drop --cache 300 --number-processes 2 --log-level warn \
    --output flex --style "$HERE/rail.lua" --middle-schema osm -d "$DB" europe.osm.pbf
fi

if has silver; then
  log "silver"
  sql -f "$HERE/silver.sql"
fi

if has actors && [ -f "$HERE/actors.ts" ]; then
  log "actors"
  node "$HERE/actors.ts"
fi

if has tiles; then
  log "tiles"
  q() { psql -X -At -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }
  q "select json_build_object('type', 'Feature',
       'tippecanoe', json_build_object('minzoom', case when c in ('gv', 'main') then 4 else 6 end),
       'properties', json_strip_nulls(json_build_object('c', c, 'col', colour)),
       'geometry', st_asgeojson(geom, 5)::json)
     from silver.track where c in ('gv', 'main', 'branch')" > rail.geojsonseq
  q "select json_build_object('type', 'Feature',
       'tippecanoe', json_build_object('layer', 'urbain', 'minzoom', case c when 'tram' then 10 when 'metro' then 9 when 'light_rail' then 9 else 11 end),
       'properties', json_strip_nulls(json_build_object('c', c, 'col', colour, 'ref', refs)),
       'geometry', st_asgeojson(geom, 6)::json)
     from silver.track where c not in ('gv', 'main', 'branch')" > urbain.geojsonseq
  q "select json_build_object('type', 'Feature',
       'tippecanoe', json_build_object('layer', 'gares', 'minzoom', case kind when 'station' then 9 when 'halt' then 11 when 'tram' then 13 else 12 end),
       'properties', json_build_object('k', kind, 'n', name),
       'geometry', st_asgeojson(geom, 6)::json)
     from silver.station" > gares.geojsonseq
  build() {
    set_name=$1; shift
    rm -rf "$TILES/$set_name.new" "$TILES/$set_name.old"
    tippecanoe -e "$TILES/$set_name.new" --force --quiet "$@"
    [ -d "$TILES/$set_name" ] && mv "$TILES/$set_name" "$TILES/$set_name.old"
    mv "$TILES/$set_name.new" "$TILES/$set_name"
    rm -rf "$TILES/$set_name.old"
  }
  build rail -l rail -Z4 -z11 --coalesce --reorder --simplification=2 --drop-densest-as-needed \
    --extend-zooms-if-still-dropping -P rail.geojsonseq
  build urbain -Z9 -z13 --coalesce --reorder --simplification=2 --drop-densest-as-needed -P urbain.geojsonseq gares.geojsonseq
  du -sh "$TILES"/rail "$TILES"/urbain
fi

sql <<EOF
create table if not exists bronze.pipeline_run (name text, started timestamptz, finished timestamptz, stages text, detail jsonb);
insert into bronze.pipeline_run
select 'osm', '$started', now(), '$STAGES', jsonb_build_object(
  'tracks', (select jsonb_object_agg(c, n) from (select c, count(*) n from silver.track group by c) x),
  'coloured_tracks', (select count(*) from silver.track where colour is not null),
  'lines', (select count(*) from silver.line),
  'stations', (select count(*) from silver.station));
EOF
log "done"

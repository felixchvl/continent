#!/bin/sh
# Continent's OpenStreetMap pipeline, run once a month on the server (continent-osm.timer):
#
#   download  each country's extract from Geofabrik, keep what runs on rails (filter.txt: tracks of
#             every kind, the lines, the stations), throw the extract away; merge the countries
#   load      into PostgreSQL, schema osm (bronze), with osm2pgsql and rail.lua
#   silver    silver.line, silver.track, silver.station (silver.sql)
#   actors    the library of operators, networks and authorities, with their logos (actors.ts)
#   stations  the directory of stations: Trainline's references (UIC code, city, main station), the
#             station's manager and its logo, the Wikipedia article and its image (stations.ts)
#   tiles     vector tiles for the map: rail (z4-13, every passenger line) and urbain (z9-14:
#             metros, trams, funiculars and the stations), swapped in atomically
#   basemap   the base map under the network (sea, lakes, rivers, borders, roads): Europe cut out of the
#             latest Protomaps build of OpenStreetMap with `pmtiles extract`, served by src/basemap.ts
#
# STAGES picks the stages (default: all). About 30 GB pass through the download, a few hundred MB stay.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${WORK:-/var/lib/continent/osm}
TILES=${TILES:-/var/lib/continent/tiles}
DB=${DB:-continent}
STAGES=${STAGES:-download load silver actors stations tiles basemap}
BASEMAP=${BASEMAP:-/var/lib/continent/basemap/europe.pmtiles}
# Europe as the map shows it (Iceland and the Canaries to the Caucasus), up to zoom 12 (6.8 GB; zoom 13 is
# 14 GB, too much to swap on the server): the map draws its few layers (water, borders, roads) overzoomed beyond.
BBOX=${BBOX:--25,27,45,72}
BASE_MAXZOOM=${BASE_MAXZOOM:-12}
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
    # Filter into tmp/ and move into place only when done: a run killed midway (out of memory, say)
    # must not leave a half-written country that the next run would take as complete.
    mkdir -p tmp
    osmium tags-filter "$name.full.osm.pbf" -e "$HERE/filter.txt" -o "tmp/$name.osm.pbf" --overwrite --no-progress
    mv "tmp/$name.osm.pbf" "$out"
    rm -f "$name.full.osm.pbf"
  done
  log "merge"
  osmium merge countries/*.osm.pbf -o europe.osm.pbf --overwrite --no-progress
  ls -l europe.osm.pbf
fi

if has load; then
  log "load"
  sql -c 'create schema if not exists osm'
  osm2pgsql --create --slim --drop --cache 300 --number-processes 2 --log-level warn --log-progress false \
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

if has stations; then
  log "stations"
  node "$HERE/stations.ts"
fi

if has tiles; then
  log "tiles"
  q() { psql -X -At -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }
  # OpenStreetMap cuts a line into many short ways (bridges, switches, tag changes). Merged into long
  # lines first (per kind and colour, within 2-degree cells), they simplify into smooth curves instead
  # of a dotted trail of two-point fragments.
  merged() {
    echo "with m as (
      select c, colour, $2 (st_dump(st_linemerge(st_collect(geom)))).geom as geom from silver.track where $1
      group by c, colour, $2 floor(st_x(st_startpoint(geom)) / 2), floor(st_y(st_startpoint(geom)) / 2))"
  }
  q "$(merged "c in ('gv', 'main', 'branch')" '')
     select json_build_object('type', 'Feature',
       'tippecanoe', json_build_object('minzoom', case when c in ('gv', 'main') then 4 else 6 end),
       'properties', json_strip_nulls(json_build_object('c', c, 'col', colour)),
       'geometry', st_asgeojson(geom, 6)::json)
     from m" > rail.geojsonseq
  q "$(merged "c not in ('gv', 'main', 'branch')" 'refs,')
     select json_build_object('type', 'Feature',
       'tippecanoe', json_build_object('layer', 'urbain', 'minzoom', case c when 'tram' then 10 when 'metro' then 9 when 'light_rail' then 9 else 11 end),
       'properties', json_strip_nulls(json_build_object('c', c, 'col', colour, 'ref', refs)),
       'geometry', st_asgeojson(geom, 6)::json)
     from m" > urbain.geojsonseq
  # A station carries its id (the app asks /api/gare/:id when it is clicked), whether it is its city's
  # main station, and the logo of its manager (stations.ts), not of the networks that stop there.
  q "select json_build_object('type', 'Feature', 'id', s.id,
       'tippecanoe', json_build_object('layer', 'gares', 'minzoom', case s.kind when 'station' then 9 when 'halt' then 11 when 'tram' then 13 else 12 end),
       'properties', json_strip_nulls(json_build_object('k', s.kind, 'n', s.name, 'logo', l.logo_file, 'm', case when i.main then 1 end)),
       'geometry', st_asgeojson(s.geom, 6)::json)
     from silver.station s
     left join silver.station_info i on i.id = s.id
     left join silver.actor l on l.qid = i.logo_qid" > gares.geojsonseq
  build() {
    set_name=$1; shift
    rm -rf "$TILES/$set_name.new" "$TILES/$set_name.old"
    tippecanoe -e "$TILES/$set_name.new" --force --quiet "$@"
    [ -d "$TILES/$set_name" ] && mv "$TILES/$set_name" "$TILES/$set_name.old"
    mv "$TILES/$set_name.new" "$TILES/$set_name"
    rm -rf "$TILES/$set_name.old"
  }
  # Simplified below the maximum zoom only: from there on the map shows OpenStreetMap's exact curves.
  build rail -l rail -Z4 -z13 --coalesce --reorder --simplification=2 --simplify-only-low-zooms --drop-densest-as-needed \
    -P rail.geojsonseq
  build urbain -Z9 -z14 --coalesce --reorder --simplification=2 --simplify-only-low-zooms --drop-densest-as-needed \
    -P urbain.geojsonseq gares.geojsonseq
  du -sh "$TILES"/rail "$TILES"/urbain
fi

if has basemap; then
  log basemap
  if command -v pmtiles >/dev/null; then
    build=$(curl -fsS -A "$UA" https://build-metadata.protomaps.dev/builds.json |
      node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => console.log(JSON.parse(s).at(-1).key))')
    mkdir -p "$(dirname "$BASEMAP")"
    rm -f "$BASEMAP.new"
    pmtiles extract "https://build.protomaps.com/$build" "$BASEMAP.new" --bbox="$BBOX" --maxzoom="$BASE_MAXZOOM" \
      --download-threads=4
    mv "$BASEMAP.new" "$BASEMAP" # the server reopens it within a minute
    log "basemap: $build, $(du -h "$BASEMAP" | cut -f1)"
  else
    log "basemap: pmtiles is not installed, skipped"
  fi
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

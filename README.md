# Continent

A live map of Europe's trains: Flighty and Flightradar, for rail. Web first, then Swift.

## Current state: map prototype (November 2026)

- Every train in Europe, long distance and regional, as dots in their operator's colour (with logos).
- Spain: real GPS positions from Renfe. Elsewhere: positions estimated from timetables and real-time delays,
  interpolated along the track (Transitous / MOTIS). Every train says which of the two it is.
- Train sheet: times, delay, progress, stop timeline, route drawn on the map, camera follow.
- Followed trains (stored in the browser), search by train name or number.
- Light and dark themes (automatic by default), desktop and mobile layouts.

Not yet: 3D view and train models, stations, statistics from the stored history, the iOS app.

## Run it

```bash
cd web
npm install
echo "VITE_MAPBOX_TOKEN=pk.your_public_token" > .env.local
npm run dev
```

## Server

`server/` is a single Node process (TypeScript run natively by Node 24) deployed on a Proxmox container
(LXC 145 « continent », PostgreSQL 17 + PostGIS):

- every 3 minutes it collects every rail service in Europe from Transitous at zoom 7, over tiles that
  split in four whenever the API answers "too many trips";
- every 30 seconds it fetches Renfe's GPS positions and snaps them onto the Spanish trains;
- every 5 seconds it computes where each train is; the web app polls `/api/meta` (who the trains are)
  and `/api/live` (positions as integers, 30 to 100 KB gzipped) and moves each dot in between;
- it stores trains, stop-to-stop segments with their delays, and GPS fixes in PostgreSQL
  (`bronze` = what was fetched, `silver` = cleaned rows) for later statistics.

The site is public at **https://continent.felixchevalier.fr**: DNS at Infomaniak → home public IP → the
home Caddy (LXC 110, [`server/deploy/caddy-continent.caddy`](server/deploy/caddy-continent.caddy), installed
as `/etc/caddy/sites/public/40-continent.caddy`) → the server on 192.168.1.65:8080.

`./deploy.sh` pulls main on the server, builds the web app and restarts the `continent` service.
In development, Vite proxies `/api` to the server (`CONTINENT_API` to point elsewhere).

The container is cut off from the home network by the Proxmox firewall
([`server/deploy/proxmox-145.fw`](server/deploy/proxmox-145.fw), installed as `/etc/pve/firewall/145.fw`):
in, only SSH, the web app and ping from 192.168.1.0/24; out, the internet and DNS on the box, nothing
else on the LAN (IPv4 private ranges, IPv6 ULA and link-local rejected). `/api/trip` only forwards trains
the server has seen, within one Transitous request a second.

## Stack

- React + Vite + TypeScript.
- Mapbox GL JS for the quiet base map (style built in code from the design tokens, on Mapbox Streets tiles)
  and the rail network (our own OpenStreetMap vector tiles).
- deck.gl for the trains, the selected route and the city names (in Halyard).
- Plain CSS with variables (`web/src/styles/tokens.css`), light and dark.

## Design

Swiss and minimal, after the 2024 Figma file "Continent" (iOS screens): one typeface, black on white,
hairlines, outlined buttons, data written as sentences, and colour reserved for identity. Each train
takes its line's official colour (GTFS `route_color` via Transitous), neutral grey when the line has
none; operators are shown by their logos. Only a delay is shown in red. The train sheet is a vertical
timeline in the line's colour.

The typeface is Halyard Display (Darden Studio, via Adobe Fonts). It cannot be committed: in
development the locally installed font is used (Chrome; Safari and Brave hide local fonts), and a
deployed build loads it from an Adobe Fonts web project set in `VITE_ADOBE_FONTS_KIT`.

## Data

| Source | Used for | Terms |
|---|---|---|
| [Transitous](https://transitous.org) `/api/v6/map/trips`, `/api/v5/trip` | trains, timetables, delays, trip details | non-commercial use |
| Renfe GTFS-RT `vehicle_positions_LD.json`, `trip_updates_LD.json` | GPS positions and delays in Spain | CC BY 4.0 |
| Mapbox Streets, OpenStreetMap | base map | Mapbox terms, ODbL |
| OpenStreetMap via [Geofabrik](https://download.geofabrik.de) extracts | rail network (the data OpenRailwayMap draws) | ODbL |

The rail network drawn under the trains is built by `sh web/scripts/build-rail.sh` (osmium + tippecanoe,
about an hour): every country's OpenStreetMap extract is reduced to its `railway=rail|narrow_gauge` ways,
sidings, yards and industrial or heritage lines are dropped, and the rest is cut into vector tiles z4-z11
with one property, `c` = `gv` (`highspeed=yes`), `main` (`usage=main`) or `branch`. High-speed and main
lines show from zoom 4, branch lines from zoom 6. Mapbox Streets has no railways below zoom 8, hence our
own tiles. They are not in git: copy them to the server with
`rsync -a --delete $WORK/tiles/rail/ continent:/tmp/rail/` then
`ssh continent sudo rsync -a --delete --chown=continent:continent /tmp/rail/ /var/lib/continent/tiles/rail/`.

`web/public/data/villes.json` (city names in French) comes from Natural Earth via `node scripts/build-villes.ts`.

## Layout

- `web/`: the web app.
- `design/`: scripts that produced the Figma mockups (map SVGs from live data, Blender scene for the 3D view).

The 2024 code (booking site, first iOS app) is kept in the history under the tag `archive-2024`.

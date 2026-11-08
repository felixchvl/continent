# Continent

A live map of Europe's trains: Flighty and Flightradar, for rail. Web first, then Swift.

## Current state: map prototype (November 2026)

- Every train in Europe, long distance and regional, as dots in their line's colour.
- Every railway in Europe from OpenStreetMap, lines in their colour, then metros, trams, funiculars and
  stations with their network's logo when zoomed in; live metros and trams from zoom 12.
- A library of the actors of European rail (operators, networks, transport authorities, infrastructure
  managers, regions) with their logos, built every month on the server, shown as a page of logos
  (`?vue=bibliotheque`); the logos of a train's line and network (RER + B, S-Bahn + S1) in its tooltip
  and sheet.
- Stations with their names from zoom 10; the map position is kept in the address (`#zoom/lat/lon`).
- `?perf` shows a frame-time readout (frames per second, worst frame, missed frames, freezes) to measure
  the map in any browser.
- Spain: real GPS positions from Renfe. Elsewhere: positions estimated from timetables and real-time delays,
  interpolated along the track (Transitous / MOTIS). Every train says which of the two it is.
- Train sheet: times, delay, progress, stop timeline, route drawn on the map, camera follow, and the
  agency running the train with its logo when it is not the operator itself (DB → Trans Regio).
- Followed trains (stored in the browser), search by train name or number.
- Light and dark themes (automatic by default), desktop and mobile layouts.

Not yet: 3D view and train models, station names and pages, statistics from the stored history, the iOS app.

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
  (`bronze` = what was fetched, `silver` = cleaned rows) for later statistics;
- from zoom 12 the app asks `/api/urbain/12/x/y` for the metros, trams and funiculars of each tile in
  view; the server asks Transitous for that tile only, keeps it 30 s and makes at most one request a second;
- it serves the vector tiles (`/tiles/rail`, `/tiles/urbain`, and `/tiles/base`, the base map read from
  a Protomaps archive and cut down to the water, borders and roads the map draws, `src/basemap.ts`),
  the library of actors (`/api/actors`) and
  their logos (`/logos/Q….svg`, with a sandboxing CSP since the SVGs come from Wikimedia Commons);
- `/api/train/:id` says which OpenStreetMap line the train runs on (same reference within about 2 km,
  `silver.line_shape`), with the logos of the line and its network;
- segments whose feed gives no shape (straight lines between stations: the French multimodal base, part
  of Renfe Cercanías) are laid back onto the tracks: shortest path on every OpenStreetMap rail track in a
  corridor around them, computed once per pair of stations in the background and kept in
  `silver.segment_path` (`src/snap.ts`); the trains follow it and `/api/trip` returns it.

### Monthly OpenStreetMap pipeline

`server/pipeline/osm.sh`, run by `continent-osm.timer` on the first Sunday of each month at 03:00
(`sudo systemctl start continent-osm` to run it now, `STAGES="silver actors tiles"` to redo part of it):

1. **download**: each European country's extract from Geofabrik, reduced by osmium to what runs on rails
   (`filter.txt`: tracks of every kind, route relations and masters, stations); about 30 GB pass
   through, a few hundred MB stay. osmium needs about 1.9 GB whatever the country, hence a 4 GB container.
2. **load**: into the `osm` schema with osm2pgsql (`rail.lua`).
3. **silver**: `silver.line` (route masters, or routes alone), `silver.track` (tracks to draw, with their
   kind and their line's colour when the lines on them agree), `silver.station` (`silver.sql`).
4. **actors**: `silver.actor`, every Wikidata id OpenStreetMap gives for a line or a station, plus their
   parents, described by Wikidata (name, kinds, country, territory, parents, colour, website) with their
   logo downloaded from Commons into `/var/lib/continent/logos`; `silver.actor_name`, every operator or
   network name written in OpenStreetMap (`actors.ts`).
5. **tiles**: tracks merged into long lines first (OSM's short ways otherwise simplify into dashes), then
   `rail` (z4-13: high-speed and main lines from zoom 4, branch lines from 6) and `urbain` (z9-14: metros,
   trams, funiculars, stations with their logo), unsimplified at their maximum zoom, swapped in atomically.
6. **basemap**: Europe (z0-13) cut out of the latest [Protomaps](https://protomaps.com) build of
   OpenStreetMap with `pmtiles extract` into `/var/lib/continent/basemap/europe.pmtiles`; needs the
   [pmtiles](https://github.com/protomaps/go-pmtiles) command, skipped without it.

The site is public at **https://continent.felixchevalier.fr**: DNS at Infomaniak → home public IP → the
home Caddy (LXC 110, [`server/deploy/caddy-continent.caddy`](server/deploy/caddy-continent.caddy), installed
as `/etc/caddy/sites/public/40-continent.caddy`) → the server on 192.168.1.65:8080.

`./deploy.sh` pulls main on the server, builds the web app and restarts the `continent` service.
In development, Vite proxies `/api` and `/tiles` to the server (`CONTINENT_API` to point elsewhere).

The container is cut off from the home network by the Proxmox firewall
([`server/deploy/proxmox-145.fw`](server/deploy/proxmox-145.fw), installed as `/etc/pve/firewall/145.fw`):
in, only SSH, the web app and ping from 192.168.1.0/24; out, the internet and DNS on the box, nothing
else on the LAN (IPv4 private ranges, IPv6 ULA and link-local rejected). `/api/trip` only forwards trains
the server has seen, within one Transitous request a second.

## Stack

- React + Vite + TypeScript.
- Mapbox GL JS for the quiet base map (style built in code from the design tokens, on our Protomaps
  extract of OpenStreetMap), the rail network and the stations (our own OpenStreetMap vector tiles).
- deck.gl for the trains, metros and trams, the selected route and the city names (in Halyard).
- Plain CSS with variables (`web/src/styles/tokens.css`), light and dark.

## Design

Swiss and minimal, after the 2024 Figma file "Continent" (iOS screens): one typeface, black on white,
hairlines, outlined buttons, data written as sentences, and colour reserved for identity. Each train
takes its line's official colour (GTFS `route_color` via Transitous; near-black, near-white in dark,
when the line has none), and so do the tracks (OpenStreetMap `colour`); operators and networks are shown
by their logos (hand-picked in `web/public/logos`, else the library's, linked by Wikidata id in
`shared/operators.ts`). Only a delay is shown in red. The train sheet is a vertical timeline in the line's colour.

The typeface is Halyard Display (Darden Studio, via Adobe Fonts). It cannot be committed: in
development the locally installed font is used (Chrome; Safari and Brave hide local fonts), and a
deployed build loads it from an Adobe Fonts web project set in `VITE_ADOBE_FONTS_KIT`.

## Data

| Source | Used for | Terms |
|---|---|---|
| [Transitous](https://transitous.org) `/api/v6/map/trips`, `/api/v5/trip` | trains, timetables, delays, trip details | non-commercial use |
| Renfe GTFS-RT `vehicle_positions_LD.json`, `trip_updates_LD.json` | GPS positions and delays in Spain | CC BY 4.0 |
| OpenStreetMap via [Protomaps](https://protomaps.com) builds | base map (sea, rivers, borders, roads) | ODbL |
| OpenStreetMap via [Geofabrik](https://download.geofabrik.de) extracts | rail network, lines, stations (the data OpenRailwayMap draws) | ODbL |
| [Wikidata](https://www.wikidata.org), [Wikimedia Commons](https://commons.wikimedia.org) | library of actors, logos | CC0; each logo its own licence |

The tiles, the library and the logos are built on the server (see the monthly pipeline above) and are not in git.

`web/public/data/villes.json` (city names in French) comes from Natural Earth via `node scripts/build-villes.ts`.

## Layout

- `web/`: the web app.
- `server/`: the server (`src/`), its OpenStreetMap pipeline (`pipeline/`) and its deployment files (`deploy/`).
- `design/`: scripts that produced the Figma mockups (map SVGs from live data, Blender scene for the 3D view).

The 2024 code (booking site, first iOS app) is kept in the history under the tag `archive-2024`.

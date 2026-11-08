-- Turns the osm schema (bronze, loaded by osm2pgsql with rail.lua) into the tables the map and the
-- library of actors use:
--   silver.line     the lines (M4, RER B, S1, TER Lyon–Grenoble...): a route master, or a route alone
--   silver.line_shape  where each line runs
--   silver.track    the tracks to draw, with their kind and the colour of the line running on them
--   silver.station  stations, halts, metro and tram stops
-- Re-run as a whole after every load.

create schema if not exists silver;

-- An OpenStreetMap colour (#rgb, rrggbb, a few names) as '#rrggbb'; white or near-white counts as no colour.
create or replace function silver.hex_colour(c text) returns text language sql immutable as $$
  select nullif(case
    when v ~ '^#?[0-9a-f]{6}$' then '#' || right(v, 6)
    when v ~ '^#?[0-9a-f]{3}$' then '#' || regexp_replace(right(v, 3), '(.)', '\1\1', 'g')
    else case v
      when 'red' then '#e3000f' when 'blue' then '#0055a4' when 'green' then '#009640' when 'yellow' then '#ffcd00'
      when 'orange' then '#f28e1c' when 'purple' then '#7b2d8e' when 'violet' then '#7b2d8e' when 'brown' then '#8b5a2b'
      when 'pink' then '#e4007c' when 'magenta' then '#e4007c' when 'black' then '#000000' when 'grey' then '#8c8c8c'
      when 'gray' then '#8c8c8c' when 'lightblue' then '#6ec6f0' when 'darkblue' then '#00346e' when 'darkgreen' then '#006633'
      when 'lightgreen' then '#8cc63f' when 'turquoise' then '#00a19a' when 'gold' then '#c9a227'
    end
  end, '#ffffff')
  from (select lower(trim(c)) as v) x
$$;

create or replace function silver.line_colour(c text) returns text language sql immutable as $$
  select case when h is null then null
              when (0.2126 * ('x' || substr(h, 2, 2))::bit(8)::int + 0.7152 * ('x' || substr(h, 4, 2))::bit(8)::int
                    + 0.0722 * ('x' || substr(h, 6, 2))::bit(8)::int) / 255 > 0.85 then null
              else h end
  from (select silver.hex_colour(c) as h) x
$$;

-- Lines: a route master is the line; a route that belongs to no master stands for itself.
drop table if exists silver.line cascade;
create table silver.line as
select r.relation_id as id, r.route as mode, r.master, r.ref, r.name, silver.line_colour(r.colour) as colour,
       r.network, r.operator,
       nullif(r.network_wikidata, '') as network_qid, nullif(r.operator_wikidata, '') as operator_qid, nullif(r.wikidata, '') as qid
from osm.route r
where r.master
   or not exists (
     select 1 from osm.route_member mm join osm.route rm on rm.relation_id = mm.relation_id and rm.master
     where mm.type = 'r' and mm.ref = r.relation_id);
alter table silver.line add primary key (id);

-- Each route, the line it belongs to, and the colour to draw it in (its own, else its line's).
create temporary table route_line as
select r.relation_id as route_id, coalesce(rm.relation_id, r.relation_id) as line_id,
       coalesce(silver.line_colour(r.colour), silver.line_colour(rm.colour)) as colour, coalesce(r.ref, rm.ref) as ref
from osm.route r
left join osm.route_member mm on mm.type = 'r' and mm.ref = r.relation_id
left join osm.route rm on rm.relation_id = mm.relation_id and rm.master
where not r.master and (mm.relation_id is null or rm.relation_id is not null);

create temporary table way_line as
select distinct m.ref as way_id, rl.line_id, rl.colour, rl.ref
from osm.route_member m join route_line rl on rl.route_id = m.relation_id
where m.type = 'w';
create index on way_line (way_id);
analyze way_line;

-- Tracks to draw: no sidings, yards, industrial, military, test or heritage lines. A track takes the
-- colour of the lines on it when they all agree, none otherwise (drawn in grey).
drop table if exists silver.track;
create table silver.track as
with wl as (
  select way_id,
         case when count(distinct colour) = 1 then min(colour) end as colour,
         left(string_agg(distinct ref, ' ' order by ref), 40) as refs
  from way_line group by way_id
)
select w.way_id as id,
       case w.railway
         when 'subway' then 'metro' when 'tram' then 'tram' when 'light_rail' then 'light_rail'
         when 'funicular' then 'funicular' when 'monorail' then 'monorail'
         else case when w.highspeed then 'gv' when w.usage = 'main' then 'main' else 'branch' end
       end as c,
       wl.colour, wl.refs, w.geom
from osm.way w left join wl on wl.way_id = w.way_id
where w.service is null
  and coalesce(w.usage, '') not in ('industrial', 'military', 'test', 'tourism')
  and coalesce(w.tags->>'railway:preserved', '') <> 'yes';
alter table silver.track add primary key (id);

-- Where each line runs (its routes' ways, simplified): lets the server tell which line a train is on.
drop table if exists silver.line_shape;
create table silver.line_shape as
select rl.line_id as id, st_simplify(st_collect(w.geom), 0.0003) as geom
from route_line rl
join osm.route_member m on m.relation_id = rl.route_id and m.type = 'w'
join osm.way w on w.way_id = m.ref
group by rl.line_id;
alter table silver.line_shape add primary key (id);
create index on silver.line_shape using gist (geom);
create index if not exists line_ref on silver.line (upper(replace(ref, ' ', '')));

drop table if exists silver.station;
create table silver.station as
select s.node_id as id,
       case when s.railway = 'tram_stop' or s.station = 'tram' then 'tram'
            when s.station = 'subway' then 'metro'
            when s.station = 'light_rail' then 'light_rail'
            when s.station = 'funicular' then 'funicular'
            when s.railway = 'halt' then 'halt'
            else 'station' end as kind,
       s.name, nullif(s.uic_ref, '') as uic_ref, s.operator, s.network,
       nullif(s.wikidata, '') as qid, nullif(s.operator_wikidata, '') as operator_qid, nullif(s.network_wikidata, '') as network_qid,
       s.geom
from osm.station s;
alter table silver.station add primary key (id);
create index on silver.station using gist (geom);

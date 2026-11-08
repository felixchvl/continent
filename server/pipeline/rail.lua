-- osm2pgsql flex style: loads the filtered OpenStreetMap extract into the `osm` schema (bronze),
-- as close to the source as possible; silver.sql turns it into what the map and the library use.
--   osm.way           every track: railway kind, usage, service, high speed, geometry
--   osm.route         route relations (one direction or variant of a line) and route masters (the line)
--   osm.route_member  their members, in order
--   osm.station       stations, halts and tram stops

local tables = {}

tables.way = osm2pgsql.define_way_table('way', {
    { column = 'railway', type = 'text', not_null = true },
    { column = 'usage', type = 'text' },
    { column = 'service', type = 'text' },
    { column = 'highspeed', type = 'boolean' },
    { column = 'name', type = 'text' },
    { column = 'ref', type = 'text' },
    { column = 'tags', type = 'jsonb' },
    { column = 'geom', type = 'linestring', projection = 4326, not_null = true },
}, { schema = 'osm' })

tables.route = osm2pgsql.define_relation_table('route', {
    { column = 'route', type = 'text', not_null = true },
    { column = 'master', type = 'boolean', not_null = true },
    { column = 'ref', type = 'text' },
    { column = 'name', type = 'text' },
    { column = 'colour', type = 'text' },
    { column = 'network', type = 'text' },
    { column = 'operator', type = 'text' },
    { column = 'wikidata', type = 'text' },
    { column = 'network_wikidata', type = 'text' },
    { column = 'operator_wikidata', type = 'text' },
    { column = 'tags', type = 'jsonb' },
}, { schema = 'osm' })

tables.member = osm2pgsql.define_table({
    name = 'route_member',
    schema = 'osm',
    ids = { type = 'relation', id_column = 'relation_id' },
    columns = {
        { column = 'seq', type = 'int' },
        { column = 'type', type = 'text' },
        { column = 'ref', type = 'int8' },
        { column = 'role', type = 'text' },
    },
})

tables.station = osm2pgsql.define_node_table('station', {
    { column = 'railway', type = 'text', not_null = true },
    { column = 'station', type = 'text' },
    { column = 'name', type = 'text' },
    { column = 'uic_ref', type = 'text' },
    { column = 'operator', type = 'text' },
    { column = 'network', type = 'text' },
    { column = 'wikidata', type = 'text' },
    { column = 'operator_wikidata', type = 'text' },
    { column = 'network_wikidata', type = 'text' },
    { column = 'tags', type = 'jsonb' },
    { column = 'geom', type = 'point', projection = 4326, not_null = true },
}, { schema = 'osm' })

local TRACK = { rail = true, narrow_gauge = true, light_rail = true, subway = true, tram = true, monorail = true, funicular = true }
local LINE = { train = true, subway = true, tram = true, light_rail = true, monorail = true, funicular = true, railway = true }
local STOP = { station = true, halt = true, tram_stop = true }

local function yes(v) return v ~= nil and v ~= 'no' end

function osm2pgsql.process_way(object)
    local t = object.tags
    if not TRACK[t.railway] then return end
    tables.way:insert({
        railway = t.railway, usage = t.usage, service = t.service, highspeed = t.highspeed == 'yes',
        name = t.name, ref = t.ref, tags = t, geom = object:as_linestring(),
    })
end

function osm2pgsql.process_relation(object)
    local t = object.tags
    local master = t.type == 'route_master'
    local kind = (master and t.route_master) or (t.type == 'route' and t.route) or nil
    if not kind or not LINE[kind] then return end
    tables.route:insert({
        route = kind, master = master, ref = t.ref, name = t.name, colour = t.colour or t.color,
        network = t.network, operator = t.operator, wikidata = t.wikidata,
        network_wikidata = t['network:wikidata'], operator_wikidata = t['operator:wikidata'], tags = t,
    })
    for i, m in ipairs(object.members) do
        tables.member:insert({ seq = i, type = m.type, ref = m.ref, role = m.role })
    end
end

function osm2pgsql.process_node(object)
    local t = object.tags
    if not STOP[t.railway] or not t.name or yes(t.disused) then return end
    tables.station:insert({
        railway = t.railway, station = t.station, name = t.name, uic_ref = t.uic_ref,
        operator = t.operator, network = t.network, wikidata = t.wikidata,
        operator_wikidata = t['operator:wikidata'], network_wikidata = t['network:wikidata'],
        tags = t, geom = object:as_point(),
    })
end

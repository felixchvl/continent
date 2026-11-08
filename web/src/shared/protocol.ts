// What the server sends to the web app. Two payloads, so that the frequent one stays small:
// - meta (when the set of trains changes, every few minutes): who each train is;
// - live (every 10 s): where each running train is, as integers in meta order.

import type { Kind } from './model.ts'
import type { Operator } from './operators.ts'

export const KINDS: Kind[] = ['gv', 'cl', 'reg']

/** [id, name, operator index, kind index, line colour '#rrggbb' or '' when the line has none] */
export type MetaTrain = [string, string, number, number, string]
export type Meta = { v: number; ops: Operator[]; trains: MetaTrain[] }

/** Flat list, 7 integers per running train. */
export const LIVE_STRIDE = 7
export type Live = { t: number; v: number; d: number[] }

export const FLAG_GPS = 1
export const FLAG_MOVING = 2
export const FLAG_RT = 4

/** One row of `live.d`: meta index, lon×1e5, lat×1e5, bearing (deg), speed (m/s ×10), delay (min), flags. */
export type LiveRow = { i: number; lon: number; lat: number; bearing: number; mps: number; delay: number; flags: number }

/** The line a train runs on, found in OpenStreetMap (RER B, S1, RE2...), with the logos of the line
 * and of its network from the library of actors. */
/** A station's sheet (/api/gare/:id): its manager, its Trainline references, its Wikipedia article and
 * the article's image, served by the server (/api/gare/:id/photo) with its credit. */
export type StationDetail = {
  id: string; kind: string; name: string | null; lon: number; lat: number
  uic: string | null; main: boolean; city: string | null
  manager: { qid: string; name: string; logo: string | null } | null
  wiki: { lang: string; title: string; url: string } | null
  photo: { credit: string | null; licence: string; file: string } | null
}

export type LineInfo = { ref: string; name: string | null; colour: string | null; logo: string | null; network: string | null; networkLogo: string | null }

export type TrainDetail = {
  id: string
  name: string
  line?: LineInfo | null
  next: { name: string; arr: number | null; tz?: string } | null
  speed: number | null
  delay: number
  rt: boolean
  source: 'gps' | 'estimee'
  moving: boolean
}

import { BrazeError } from "./errors.js"
import { timeParameters } from "./operations/parameters.js"

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?$/

interface WallTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  ms: number
  dateOnly: boolean
}

/** A date, or a date and time, with neither `Z` nor an offset — the shapes whose zone is a guess. */
export const isZoneless = (value: string): boolean => LOCAL.test(value.trim())

/** The canonical IANA name, or a `validation_error` naming the bad one. */
export const checkTimeZone = (zone: string): string => {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone
  } catch {
    throw new BrazeError(
      "validation_error",
      `--timezone "${zone}" is not an IANA time zone — use a name such as Europe/Madrid or UTC`,
    )
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>()

// `hourCycle: "h23"`, not `hour12: false`: the latter prints midnight as 24:00 in some engines.
const formatterFor = (zone: string): Intl.DateTimeFormat => {
  let formatter = formatters.get(zone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    formatters.set(zone, formatter)
  }
  return formatter
}

const wallOf = (instant: number, zone: string): Record<string, number> => {
  const parts: Record<string, number> = {}
  for (const part of formatterFor(zone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value)
  }
  return parts
}

const offsetAt = (instant: number, zone: string): number => {
  const p = wallOf(instant, zone)
  const wall = Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day ?? 1, p.hour ?? 0, p.minute ?? 0, p.second ?? 0)
  return wall - Math.floor(instant / 1000) * 1000
}

/**
 * The instant a wall-clock time in `zone` names. A time that occurs twice (clocks going back) is the
 * earlier one; a time that never occurs (clocks going forward) moves forward by the gap — the same
 * choice Temporal calls "compatible".
 */
export const zonedToUtc = (wall: Omit<WallTime, "dateOnly">, zone: string): Date => {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second, wall.ms)
  const before = offsetAt(naive - 86_400_000, zone)
  const after = offsetAt(naive + 86_400_000, zone)
  const fits = [naive - before, naive - after].filter((instant) => instant + offsetAt(instant, zone) === naive)
  return new Date(fits.length > 0 ? Math.min(...fits) : naive - before)
}

/** `2026-09-01T08:00:00Z` — seconds unless the value carries milliseconds. */
export const utcString = (instant: Date): string => instant.toISOString().replace(/\.000Z$/, "Z")

/** `2026-09-01 10:00:00`, the wall clock in `zone`. The caller names the zone beside it. */
export const formatInZone = (instant: Date | string, zone: string): string => {
  const p = wallOf(new Date(instant).getTime(), zone)
  const two = (n: number | undefined) => String(n ?? 0).padStart(2, "0")
  return `${p.year}-${two(p.month)}-${two(p.day)} ${two(p.hour)}:${two(p.minute)}:${two(p.second)}`
}

const parseWall = (name: string, value: string): WallTime | undefined => {
  const match = LOCAL.exec(value.trim())
  if (!match) return undefined

  const [, y, mo, d, h, mi, s, fraction] = match
  const wall: WallTime = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h ?? 0),
    minute: Number(mi ?? 0),
    second: Number(s ?? 0),
    ms: fraction ? Number(fraction.slice(0, 3).padEnd(3, "0")) : 0,
    dateOnly: h === undefined,
  }

  const check = new Date(Date.UTC(wall.year, wall.month - 1, wall.day))
  const real =
    check.getUTCFullYear() === wall.year &&
    check.getUTCMonth() === wall.month - 1 &&
    check.getUTCDate() === wall.day &&
    wall.hour < 24 &&
    wall.minute < 60 &&
    wall.second < 60
  if (!real) throw new BrazeError("validation_error", `--${name} "${value}" is not a real date or time`)
  return wall
}

export interface TimeConversion {
  parameter: string
  given: string
  sent: string
  /** What the value covers, in UTC, in words a person can check. */
  means: string
}

export interface ResolvedTimes {
  query: Record<string, string>
  timeZone: string
  conversions: TimeConversion[]
}

/**
 * Reads every zone-less time parameter in `zone` and rewrites it as UTC, so the instant sent does not
 * depend on whichever zone Braze would have assumed. A value that already names its zone, or that
 * this does not recognise as a date, is sent as given — Braze is the judge of formats it documents.
 */
export const resolveTimeQuery = (query: Record<string, string>, zone: string): ResolvedTimes => {
  const out = { ...query }
  const conversions: TimeConversion[] = []

  for (const [parameter, given] of Object.entries(query)) {
    const rule = timeParameters[parameter]
    if (!rule) continue

    const wall = parseWall(parameter.replace(/[^a-zA-Z0-9]+/g, "-").replace(/-$/, ""), given)
    if (!wall) continue

    if (wall.dateOnly && rule.date === "utc-day") {
      const midnight = `${given.trim()}T00:00:00Z`
      conversions.push({ parameter, given, sent: given, means: `a UTC day for Braze, read as midnight ${midnight}` })
      continue
    }
    if (!wall.dateOnly && !rule.time) continue

    let instant: Date
    if (!wall.dateOnly) instant = zonedToUtc(wall, zone)
    else if (rule.date === "start") instant = zonedToUtc({ ...wall, hour: 0, minute: 0, second: 0, ms: 0 }, zone)
    else {
      const next = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + 1))
      const start = zonedToUtc(
        {
          year: next.getUTCFullYear(),
          month: next.getUTCMonth() + 1,
          day: next.getUTCDate(),
          hour: 0,
          minute: 0,
          second: 0,
          ms: 0,
        },
        zone,
      )
      instant = new Date(start.getTime() - 1000)
    }

    const sent = utcString(instant)
    out[parameter] = sent
    conversions.push({
      parameter,
      given,
      sent,
      means: wall.dateOnly ? `${rule.date === "start" ? "start" : "end"} of that day in ${zone}` : `in ${zone}`,
    })
  }

  return { query: out, timeZone: zone, conversions }
}

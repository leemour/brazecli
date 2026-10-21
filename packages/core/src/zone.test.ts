import { describe, expect, it } from "vitest"
import { BrazeError } from "./errors.js"
import { checkTimeZone, formatInZone, isZoneless, resolveTimeQuery, utcString, zonedToUtc } from "./zone.js"

const at = (zone: string, year: number, month: number, day: number, hour = 0, minute = 0) =>
  utcString(zonedToUtc({ year, month, day, hour, minute, second: 0, ms: 0 }, zone))

describe("reading a wall-clock time in a zone", () => {
  it("applies the zone's offset", () => {
    expect(at("Asia/Vladivostok", 2026, 9, 1, 10)).toBe("2026-09-01T00:00:00Z")
    expect(at("America/Los_Angeles", 2026, 9, 1, 10)).toBe("2026-09-01T17:00:00Z")
    expect(at("UTC", 2026, 9, 1, 10)).toBe("2026-09-01T10:00:00Z")
  })

  it("takes the earlier instant when clocks go back and 01:30 happens twice", () => {
    expect(at("America/Los_Angeles", 2026, 11, 1, 1, 30)).toBe("2026-11-01T08:30:00Z")
  })

  it("moves forward by the gap when clocks go forward and 02:30 never happens", () => {
    expect(at("America/Los_Angeles", 2026, 3, 8, 2, 30)).toBe("2026-03-08T10:30:00Z")
  })

  it("formats an instant as the wall clock of a zone", () => {
    expect(formatInZone("2026-09-13T19:15:00.000Z", "Europe/Madrid")).toBe("2026-09-13 21:15:00")
    expect(formatInZone("2026-09-13T00:00:00Z", "UTC")).toBe("2026-09-13 00:00:00")
  })
})

describe("which values have no zone", () => {
  it("recognises dates and times without Z or an offset", () => {
    expect(isZoneless("2026-09-01")).toBe(true)
    expect(isZoneless("2026-09-01T10:00")).toBe(true)
    expect(isZoneless("2026-09-01 10:00:00.123456")).toBe(true)
  })

  it("treats Z, an offset and Braze's own one-digit offset as zoned", () => {
    expect(isZoneless("2026-09-01T10:00:00Z")).toBe(false)
    expect(isZoneless("2026-09-01T10:00:00+02:00")).toBe(false)
    expect(isZoneless("2018-06-28T23:59:59-5:00")).toBe(false)
    expect(isZoneless("2013-07-16T19:20:30:000+0100")).toBe(false)
  })
})

describe("resolving the time parameters of a request", () => {
  const zone = "Asia/Vladivostok"

  it("sends a zone-less time as UTC and says what it did", () => {
    const { query, conversions } = resolveTimeQuery({ ending_at: "2026-09-01T10:00", length: "7" }, zone)

    expect(query).toEqual({ ending_at: "2026-09-01T00:00:00Z", length: "7" })
    expect(conversions).toEqual([
      { parameter: "ending_at", given: "2026-09-01T10:00", sent: "2026-09-01T00:00:00Z", means: `in ${zone}` },
    ])
  })

  it("turns a date alone into the start or the end of that local day", () => {
    const { query } = resolveTimeQuery(
      { starting_at: "2026-09-01", ending_at: "2026-09-01", modified_before: "2026-09-01" },
      zone,
    )

    expect(query).toEqual({
      starting_at: "2026-08-31T14:00:00Z",
      ending_at: "2026-09-01T13:59:59Z",
      modified_before: "2026-09-01T13:59:59Z",
    })
  })

  it("keeps a date Braze reads as a UTC day, and names it one", () => {
    const { query, conversions } = resolveTimeQuery({ start_date: "2026-09-01", end_time: "2026-09-02" }, zone)

    expect(query).toEqual({ start_date: "2026-09-01", end_time: "2026-09-02" })
    expect(conversions.map((c) => c.means)).toEqual([
      "a UTC day for Braze, read as midnight 2026-09-01T00:00:00Z",
      "a UTC day for Braze, read as midnight 2026-09-02T00:00:00Z",
    ])
  })

  it("sends a value with its own zone, or one it does not recognise, exactly as given", () => {
    const query = { ending_at: "2018-06-28T23:59:59-5:00", modified_after: "yesterday", page: "2" }

    expect(resolveTimeQuery(query, zone)).toEqual({ query, timeZone: zone, conversions: [] })
  })

  it("refuses a date that does not exist rather than letting Date roll it over", () => {
    expect(() => resolveTimeQuery({ ending_at: "2026-02-30" }, zone)).toThrow(BrazeError)
    expect(() => resolveTimeQuery({ ending_at: "2026-02-30" }, zone)).toThrow("--ending-at")
  })
})

describe("checking a zone name", () => {
  it("returns the canonical IANA name", () => {
    expect(checkTimeZone("europe/madrid")).toBe("Europe/Madrid")
  })

  it("refuses a name that is not a zone, as a validation error", () => {
    expect(() => checkTimeZone("Mars/Olympus")).toThrow(
      expect.objectContaining({ code: "validation_error", message: expect.stringContaining("Mars/Olympus") }),
    )
  })
})

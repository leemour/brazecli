import { describe, expect, it } from "vitest"
import { createRenderer } from "./renderer.js"
import { captureStreams } from "./stream.js"

// The control character is the point: these assert that no ANSI escape reaches a machine
// stream or a log file.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes is the test
const ANSI = /\u001b\[/

const render = (format: "json" | "jsonl" | "pretty", color = false) => {
  const streams = captureStreams()
  return { streams, renderer: createRenderer({ format, color, streams }) }
}

describe("json", () => {
  it("puts exactly one value on stdout", () => {
    const { streams, renderer } = render("json")

    renderer.result({ campaigns: [{ id: "c1" }] })

    expect(streams.stdout).toHaveLength(1)
    expect(JSON.parse(streams.stdout[0] ?? "")).toEqual({ campaigns: [{ id: "c1" }] })
  })

  it("keeps every decoration off stdout", () => {
    const { streams, renderer } = render("json")

    renderer.result({ ok: true })
    renderer.success("done")
    renderer.note("something")
    renderer.warn("careful")
    renderer.failure("nope")

    expect(streams.stdout).toHaveLength(1)
    expect(streams.stderr).toEqual(["done", "something", "careful", "nope"])
  })

  it("emits no ANSI even when colour is on", () => {
    const { streams, renderer } = render("json", true)

    renderer.result({ ok: true })
    renderer.success("done")

    expect([...streams.stdout, ...streams.stderr].join("")).not.toMatch(ANSI)
  })
})

describe("jsonl", () => {
  it("gives each item its own line", () => {
    const { streams, renderer } = render("jsonl")

    renderer.stream([{ id: "a" }, { id: "b" }])

    expect(streams.stdout).toEqual(['{"id":"a"}', '{"id":"b"}'])
  })
})

describe("pretty", () => {
  it("still keeps diagnostics off stdout — the invariant is unconditional", () => {
    const { streams, renderer } = render("pretty")

    renderer.result([{ name: "Summer Sale", status: "active" }])
    renderer.success("2 campaigns")

    // Unconditional on purpose: a mode check somewhere is a mode check somebody forgets, and
    // piping human output should still give content rather than commentary.
    expect(streams.stdout.join("\n")).not.toContain("2 campaigns")
    expect(streams.stderr.join("\n")).toContain("2 campaigns")
  })

  it("renders a list of like objects as a table", () => {
    const { streams, renderer } = render("pretty")

    renderer.result([
      { name: "Summer Sale", status: "active" },
      { name: "Retention EU", status: "draft" },
    ])

    const output = streams.stdout.join("\n")
    expect(output).toContain("name")
    expect(output).toContain("Summer Sale")
    expect(output).toContain("draft")
  })

  it("renders a single object as labelled lines", () => {
    const { streams, renderer } = render("pretty")

    renderer.result({ profile: "production", status: "ok" })

    expect(streams.stdout.join("\n")).toMatch(/profile\s+production/)
  })

  it("puts a nested value in its field rather than inventing a layout for it", () => {
    const { streams, renderer } = render("pretty")

    renderer.result({ profile: "production", batch: { attributes: 75 } })

    expect(streams.stdout.join("\n")).toMatch(/batch\s+\{"attributes":75\}/)
  })

  it("falls back to JSON for a value with no shape at all", () => {
    const { streams, renderer } = render("pretty")

    renderer.result("just a string")

    expect(JSON.parse(streams.stdout.join("\n"))).toBe("just a string")
  })

  it("emits no ANSI when colour is off", () => {
    const { streams, renderer } = render("pretty", false)

    renderer.result([{ a: 1 }])

    expect(streams.stdout.join("")).not.toMatch(ANSI)
  })
})

// SEC-2. A campaign name, a catalog title and an error message are all edited outside this
// repository and handed back to us as data; a terminal executes what it is given.
describe("text that came from Braze", () => {
  const HOSTILE = "Promo\u001b[2K\u001b[1GDELETED EVERYTHING"

  it("cannot clear the line from inside a table cell", () => {
    const { streams, renderer } = render("pretty")

    renderer.result([{ name: HOSTILE, id: "c1" }])

    const out = streams.stdout.join("\n")
    expect(out).not.toMatch(ANSI)
    expect(out).toContain("\\x1b[2K")
    // Still one row, still carrying its other column: made visible, not dropped.
    expect(out).toContain("c1")
  })

  it("cannot clear the line from inside a field value or its label", () => {
    const { streams, renderer } = render("pretty")

    renderer.result({ [HOSTILE]: "x", name: HOSTILE })

    expect(streams.stdout.join("\n")).not.toMatch(ANSI)
  })

  it.each(["pretty", "json", "jsonl"] as const)("cannot reach stderr as a %s diagnostic", (format) => {
    const { streams, renderer } = render(format)

    renderer.failure(`Invalid request: ${HOSTILE}`)
    renderer.warn(HOSTILE)

    expect(streams.stderr.join("\n")).not.toMatch(ANSI)
  })

  it("leaves the machine contract byte for byte alone", () => {
    const { streams, renderer } = render("json")

    renderer.result([{ name: HOSTILE }])

    // JSON.stringify already escapes control characters; changing these bytes would change what
    // every script parsing us reads back.
    expect(JSON.parse(streams.stdout.join("\n"))).toEqual([{ name: HOSTILE }])
  })
})

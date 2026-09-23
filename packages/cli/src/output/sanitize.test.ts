import { describe, expect, it } from "vitest"
import { formulaSafe, visibleControls } from "./sanitize.js"

// The control characters are the point: these assert that none of them survive into a terminal.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the test
const RAW_CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/

describe("visibleControls", () => {
  it.each([
    ["a screen-clear sequence", "Promo\u001b[2K\u001b[1GDELETED", "Promo\\x1b[2K\\x1b[1GDELETED"],
    ["a bell", "ring\u0007", "ring\\x07"],
    ["a lone carriage return", "first\rsecond", "first\\x0dsecond"],
    ["a null byte", "a\u0000b", "a\\x00b"],
    ["an 8-bit CSI", "a\u009bb", "a\\x9bb"],
  ])("makes %s visible", (_name, input, expected) => {
    const output = visibleControls(input)

    expect(output).toBe(expected)
    expect(output).not.toMatch(RAW_CONTROL)
  })

  it.each([
    ["a newline", "one\ntwo"],
    ["a tab", "one\ttwo"],
    ["an accent", "café"],
    ["han characters", "活动"],
    ["an emoji", "🎯 launch"],
    ["an empty string", ""],
  ])("leaves %s exactly as it was", (_name, input) => {
    expect(visibleControls(input)).toBe(input)
  })

  it("is reusable — the shared regex does not carry state between calls", () => {
    const hostile = "a\u001bb"

    expect([visibleControls(hostile), visibleControls(hostile), visibleControls(hostile)]).toEqual([
      "a\\x1bb",
      "a\\x1bb",
      "a\\x1bb",
    ])
  })
})

describe("formulaSafe", () => {
  it.each([['=HYPERLINK("http://evil","x")'], ["+1+1"], ["-2"], ["@SUM(A1)"], ["\tlate"], ["\rlate"]])(
    "marks %s as literal text",
    (input) => {
      expect(formulaSafe(input)).toBe(`'${input}`)
    },
  )

  it.each([["Invalid API key"], ["user not found"], ["'already quoted"], [""], ["2 + 2"]])(
    "leaves %s alone",
    (input) => {
      expect(formulaSafe(input)).toBe(input)
    },
  )
})

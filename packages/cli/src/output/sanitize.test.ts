import { describe, expect, it } from "vitest"
import { formulaSafe } from "./sanitize.js"

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

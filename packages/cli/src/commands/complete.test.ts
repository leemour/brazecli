import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { captureStreams } from "@leemour/cli-core"
import { beforeAll, describe, expect, it } from "vitest"
import { run } from "../program.js"

let configDir: string

const complete = async (...words: string[]) => {
  const streams = captureStreams()
  const fetch = () => Promise.reject(new Error("a Tab reached the network"))
  const code = await run(["complete", "--", ...words], { env: { BRAZE_CONFIG_DIR: configDir }, streams, fetch })
  return { code, lines: streams.stdout.join("\n").split("\n"), stderr: streams.stderr }
}

const values = (lines: string[]) => lines.filter((line) => !line.startsWith(":")).map((line) => line.split("\t")[0])

beforeAll(() => {
  configDir = mkdtempSync(join(tmpdir(), "brazecli-complete-"))
  const profile = { restEndpoint: "https://rest.iad-01.braze.com" }
  writeFileSync(
    join(configDir, "config.json"),
    JSON.stringify({ version: 1, profiles: { staging: profile, production: profile } }),
  )
})

describe("braze complete", () => {
  it("offers the commands and the profile names, not itself, and ends with the directive", async () => {
    const { code, lines, stderr } = await complete("")

    expect(code).toBe(0)
    expect(values(lines)).toEqual(expect.arrayContaining(["campaigns", "profile", "update", "staging", "production"]))
    expect(values(lines)).not.toContain("complete")
    expect(lines.at(-1)).toBe(":4")
    expect(stderr).toEqual([])
  })

  it("completes a half-typed first word as a command, not as a profile", async () => {
    const { lines } = await complete("camp")

    expect(values(lines)).toEqual(["campaigns"])
  })

  it("reads past a profile named first, and offers no second profile", async () => {
    const { lines } = await complete("staging", "campaigns", "")

    expect(values(lines)).toContain("list")
    expect(values(lines)).not.toContain("production")
  })

  it("offers profile names as the value of --profile", async () => {
    const { lines } = await complete("--profile", "")

    expect(values(lines)).toEqual(["staging", "production"])
  })

  it("refuses a shell it does not know, on stderr", async () => {
    const streams = captureStreams()

    expect(await run(["complete", "tcsh"], { env: { BRAZE_CONFIG_DIR: configDir }, streams })).toBe(2)
    expect(streams.stdout).toEqual([])
    expect(streams.stderr.join("")).toContain("zsh")
  })
})

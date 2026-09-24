import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { captureStreams } from "@leemour/cli-core"
import { describe, expect, it } from "vitest"
import { run } from "./program.js"
import { VERSION } from "./version.js"

const invoke = async (argv: string[], isTty = false) => {
  const streams = captureStreams()
  const env = { BRAZE_CONFIG_DIR: mkdtempSync(join(tmpdir(), "brazecli-program-")) }
  const code = await run(argv, { env, streams, isTty })
  return { code, stdout: streams.stdout.join("\n"), stderr: streams.stderr.join("\n") }
}

describe("a command line Commander rejects", () => {
  it("is one JSON validation_error on stderr in a machine mode, exit 2", async () => {
    const { code, stdout, stderr } = await invoke(["campaigns", "list", "--bogus"])

    expect(code).toBe(2)
    expect(stdout).toBe("")
    expect(JSON.parse(stderr)).toEqual({ error: { code: "validation_error", message: "unknown option '--bogus'" } })
  })

  it("keeps Commander's own words for a person, with the same exit code", async () => {
    const { code, stderr } = await invoke(["campaigns", "list", "--bogus"], true)

    expect(code).toBe(2)
    expect(stderr).toContain("unknown option '--bogus'")
  })

  it("reports a missing required option the same way", async () => {
    const { code, stderr } = await invoke(["catalogs", "delete"])

    expect(code).toBe(2)
    expect(JSON.parse(stderr).error).toMatchObject({
      code: "validation_error",
      message: expect.stringContaining("--catalog-name"),
    })
  })
})

describe("help and version", () => {
  it("print to the streams they were given and return 0", async () => {
    const version = await invoke(["--version"])
    const help = await invoke(["campaigns", "--help"])

    expect(version).toMatchObject({ code: 0, stdout: VERSION })
    expect(help.code).toBe(0)
    expect(help.stdout).toContain("braze campaigns")
  })

  it("show the help on stderr, never stdout, when no command was given", async () => {
    const { code, stdout, stderr } = await invoke(["campaigns"])

    expect(code).toBe(1)
    expect(stdout).toBe("")
    expect(stderr).toContain("Usage: braze campaigns")
  })
})

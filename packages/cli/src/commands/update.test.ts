import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { captureStreams } from "@leemour/cli-core"
import { beforeEach, describe, expect, it } from "vitest"
import { run } from "../program.js"
import { type UpdateEnvironment, updateNotice } from "../update.js"
import { VERSION } from "../version.js"

const NPM_INSTALL = "/usr/lib/node_modules/@leemour/brazecli/dist/bin/braze.js"
const CHECKOUT = "/home/someone/brazecli/packages/cli/dist/bin/braze.js"

let env: NodeJS.ProcessEnv

const npmSays = (version: string) => () =>
  Promise.resolve(new Response(JSON.stringify({ version }), { headers: { "content-type": "application/json" } }))

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "brazecli-update-"))
  env = { BRAZE_CONFIG_DIR: join(dir, "config"), BRAZE_STATE_DIR: join(dir, "state") }
})

const update = async (argv: string[], environment: UpdateEnvironment) => {
  const streams = captureStreams()
  const code = await run(["update", "--json", ...argv], { env, streams, isTty: false, update: environment })
  return { code, result: JSON.parse(streams.stdout.join("\n") || "null"), stderr: streams.stderr }
}

describe("braze update", () => {
  it("--check reports a newer version and runs nothing", async () => {
    const spawned: string[][] = []
    const { code, result } = await update(["--check"], {
      fetch: npmSays("99.0.0"),
      scriptPath: NPM_INSTALL,
      spawn: (argv) => spawned.push(argv) && 0,
    })

    expect(code).toBe(0)
    expect(result).toMatchObject({ current: VERSION, latest: "99.0.0", newer: true, installer: "npm", updated: false })
    expect(result.command).toBe("npm install -g @leemour/brazecli@latest")
    expect(spawned).toEqual([])
  })

  it("updates with the package manager that installed it", async () => {
    const spawned: string[][] = []
    const { code, result } = await update([], {
      fetch: npmSays("99.0.0"),
      scriptPath: NPM_INSTALL,
      spawn: (argv) => spawned.push(argv) && 0,
    })

    expect(code).toBe(0)
    expect(spawned).toEqual([["npm", "install", "-g", "@leemour/brazecli@latest"]])
    expect(result.updated).toBe(true)
  })

  it("runs nothing in a checkout, and says why", async () => {
    const spawned: string[][] = []
    const { result, stderr } = await update([], {
      fetch: npmSays("99.0.0"),
      scriptPath: CHECKOUT,
      spawn: (argv) => spawned.push(argv) && 0,
    })

    expect(spawned).toEqual([])
    expect(result).toMatchObject({ installer: "checkout", updated: false })
    expect(stderr.join("")).toContain("git pull")
  })

  it("fails with a code a script can branch on when the package manager fails", async () => {
    const { code } = await update([], { fetch: npmSays("99.0.0"), scriptPath: NPM_INSTALL, spawn: () => 1 })

    expect(code).not.toBe(0)
    expect(code).not.toBe(1)
  })
})

describe("--quiet", () => {
  it("drops the note and keeps the answer", async () => {
    const run2 = async (argv: string[]) => {
      const streams = captureStreams()
      await run(argv, { env, streams, isTty: true, update: { fetch: npmSays(VERSION), scriptPath: NPM_INSTALL } })
      return streams
    }

    const loud = await run2(["update"])
    const quiet = await run2(["--quiet", "update"])

    expect(loud.stderr.join("")).toContain("is the newest")
    expect(quiet.stderr).toEqual([])
    expect(quiet.stdout).toEqual(loud.stdout)
  })
})

describe("the daily update line", () => {
  const person: UpdateEnvironment = {
    fetch: npmSays("99.0.0"),
    scriptPath: NPM_INSTALL,
    stdoutIsTTY: true,
    stderrIsTTY: true,
  }

  it("tells a person at a terminal", async () => {
    expect(await updateNotice(["campaigns", "list"], { environment: person, env })).toContain("braze update")
  })

  it.each([
    ["--json", ["campaigns", "list", "--json"], {}],
    ["--output json", ["campaigns", "list", "--output", "json"], {}],
    ["--output=jsonl", ["campaigns", "list", "--output=jsonl"], {}],
    ["BRAZE_OUTPUT", ["campaigns", "list"], { BRAZE_OUTPUT: "json" }],
    ["BRAZE_NO_UPDATE_CHECK", ["campaigns", "list"], { BRAZE_NO_UPDATE_CHECK: "1" }],
    ["CI", ["campaigns", "list"], { CI: "true" }],
  ])("stays silent under %s", async (_name, argv, extra) => {
    expect(await updateNotice(argv, { environment: person, env: { ...env, ...extra } })).toBeUndefined()
  })

  it.each([
    ["after a profile name", ["prod", "update"]],
    ["after an option's value", ["--profile", "prod", "update", "--check"]],
    ["for completion", ["complete", "--", "camp"]],
  ])("stays silent %s, when the command is update or complete", async (_name, argv) => {
    expect(await updateNotice(argv, { environment: person, env })).toBeUndefined()
  })

  it("stays silent when the config turns it off", async () => {
    const config = env.BRAZE_CONFIG_DIR as string
    mkdirSync(config, { recursive: true })
    writeFileSync(join(config, "config.json"), JSON.stringify({ version: 1, updateCheck: false }))

    expect(await updateNotice(["campaigns", "list"], { environment: person, env })).toBeUndefined()
  })

  it("stays silent when the output is configured as JSON", async () => {
    const config = env.BRAZE_CONFIG_DIR as string
    mkdirSync(config, { recursive: true })
    writeFileSync(join(config, "config.json"), JSON.stringify({ version: 1, output: { format: "json" } }))

    expect(await updateNotice(["campaigns", "list"], { environment: person, env })).toBeUndefined()
  })

  it("asks npm at most once a day", async () => {
    let asked = 0
    const counting = {
      ...person,
      fetch: () => {
        asked += 1
        return npmSays("99.0.0")()
      },
    }

    await updateNotice(["runs", "list"], { environment: counting, env })
    await updateNotice(["runs", "list"], { environment: counting, env })

    expect(asked).toBe(1)
  })
})

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"

// The control character is the point: this asserts no ANSI escape reaches a machine stream.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes is the test
const ANSI = /\u001b\[/

const BINARY = "packages/cli/dist/bin/braze.js"

/**
 * The invariant is about the **process's** stdout, and an in-process test cannot see a stray
 * `console.log` in a dependency or a log destination accidentally pointed at fd 1. So this one
 * runs the built binary for real.
 */
const braze = (args: string[], env: NodeJS.ProcessEnv = {}) => {
  // spawnSync, not execFileSync: the latter returns stdout only, and stderr — the half this
  // test is about — would leak to the parent process instead of being captured.
  const result = spawnSync("node", [BINARY, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", ...env },
  })
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
}

let configDir: string
let runsDir: string

beforeAll(() => {
  if (!existsSync(BINARY)) throw new Error(`run \`pnpm build\` first — ${BINARY} is missing`)

  configDir = mkdtempSync(join(tmpdir(), "brazecli-e2e-"))
  runsDir = mkdtempSync(join(tmpdir(), "brazecli-e2eruns-"))
  writeFileSync(
    join(configDir, "config.json"),
    JSON.stringify({
      version: 1,
      credentialStorage: "file",
      defaultProfile: "t",
      profiles: {
        t: { restEndpoint: "https://rest.iad-01.braze.com", readOnly: false },
        ro: { restEndpoint: "https://rest.iad-01.braze.com", readOnly: true },
      },
    }),
  )
})

const env = () => ({
  BRAZE_CONFIG_DIR: configDir,
  BRAZE_RUNS_DIR: runsDir,
  BRAZE_API_KEY: "not-a-real-key",
  BRAZE_PROFILE: "t",
})

describe("the machine-output invariant, on the real binary", () => {
  it("gives exactly one JSON value on stdout and puts the commentary on stderr", () => {
    const result = braze(["api", "POST", "/users/track", "--input", '{"attributes":[]}', "--dry-run", "--json"], env())

    expect(result.code).toBe(0)
    expect(() => JSON.parse(result.stdout)).not.toThrow()
    expect(JSON.parse(result.stdout)).toMatchObject({ dryRun: true })
    expect(result.stderr).toContain("nothing was sent")
  })

  it("emits no ANSI on either stream", () => {
    const result = braze(["api", "POST", "/users/track", "--input", "{}", "--dry-run", "--json"], env())

    expect(result.stdout).not.toMatch(ANSI)
    expect(result.stderr).not.toMatch(ANSI)
  })

  it("leaves stdout empty when the command refuses", () => {
    const result = braze(["api", "POST", "/users/track", "--input", "{}", "--json"], env())

    expect(result.code).toBe(7)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("confirmation_required")
  })

  it("keeps stdout clean when a profile cannot be resolved at all", () => {
    const result = braze(["api", "GET", "/campaigns/list", "--json"], {
      BRAZE_CONFIG_DIR: mkdtempSync(join(tmpdir(), "brazecli-empty-")),
    })

    expect(result.code).toBe(3)
    expect(result.stdout).toBe("")
  })

  it("answers --json even without a terminal, and pretty is still available on request", () => {
    const asJson = braze(["runs", "list", "--json"], env())
    expect(() => JSON.parse(asJson.stdout)).not.toThrow()

    const asPretty = braze(["runs", "list", "--output", "pretty"], env())
    expect(asPretty.code).toBe(0)
  })
})

describe("a failure in a machine mode", () => {
  const refusedWrite = ["api", "POST", "/users/track", "--input", "{}", "--confirm"]

  it("is one JSON object on stderr, leaving stdout empty", () => {
    const result = braze([...refusedWrite, "--json"], { ...env(), BRAZE_PROFILE: "ro" })

    expect(result.stdout).toBe("")
    expect(JSON.parse(result.stderr).error).toMatchObject({ code: "permission_error" })
    expect(result.code).toBe(5)
  })

  it("names the code a caller branches on, and matches the exit status to it", () => {
    const result = braze(["api", "GET", "/campaigns/list", "--json"], {
      ...env(),
      BRAZE_REST_ENDPOINT: "https://127.0.0.1:1",
    })

    const { error } = JSON.parse(result.stderr)
    expect(error.code).toBe("network_error")
    expect(result.code).toBe(10)
  })

  it("stays human-readable in pretty mode", () => {
    const result = braze(["api", "GET", "/campaigns/list", "--output", "pretty"], {
      ...env(),
      BRAZE_REST_ENDPOINT: "https://127.0.0.1:1",
    })

    expect(result.stderr).toContain("network_error:")
    expect(() => JSON.parse(result.stderr)).toThrow()
  })
})

describe("help text, on the real binary", () => {
  // The paths are the one thing a caller cannot get from this CLI yet, so the pointer to
  // Braze's own list has to be where someone looking at the tool will actually see it.
  it("points at Braze's endpoint index from the root help, not only from `api`", () => {
    for (const args of [[], ["--help"], ["api", "--help"]]) {
      const result = braze(args, env())

      expect(`${result.stdout}${result.stderr}`).toContain("https://www.braze.com/docs/api/home")
    }
  })
})

// SEC-2, proved on the process rather than on a function: the sanitiser has to be reached by
// every path that renders a stored value, not merely be correct in isolation.
describe("text from outside, on the real binary", () => {
  const HOSTILE = "campaigns\u001b[2K\u001b[1Glist"

  const runWith = (command: string) => {
    const dir = join(runsDir, "2026-09-23")
    mkdirSync(join(dir, "hostile-run"), { recursive: true })
    writeFileSync(
      join(dir, "hostile-run", "run.json"),
      JSON.stringify({
        runId: "hostile-run",
        command,
        profile: "t",
        startedAt: "2026-09-23T00:00:00.000Z",
        status: "succeeded",
      }),
    )
  }

  it.each(["pretty", "json"])("cannot move the cursor through `runs list` in %s mode", (format) => {
    runWith(HOSTILE)

    const result = braze(["runs", "list", "--output", format], env())

    expect(result.stdout).not.toMatch(ANSI)
    expect(result.stderr).not.toMatch(ANSI)
  })

  it("shows the sequence rather than dropping it, so the reader knows it was there", () => {
    runWith(HOSTILE)

    const result = braze(["runs", "list", "--output", "pretty"], env())

    expect(result.stdout).toContain("\\x1b[2K")
  })

  it("keeps the JSON value parseable and byte-identical to what was stored", () => {
    runWith(HOSTILE)

    const result = braze(["runs", "list", "--json"], env())
    const runs = JSON.parse(result.stdout) as { command: string }[]

    expect(runs.some((run) => run.command === HOSTILE)).toBe(true)
  })
})

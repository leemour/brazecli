import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { captureStreams } from "@leemour/cli-core"
import { beforeEach, describe, expect, it } from "vitest"
import { buildProgram, run } from "../program.js"

let home: string
let configDir: string
let streams: ReturnType<typeof captureStreams>

const install = async (argv: string[], options: { cwd?: string } = {}) => {
  const code = await run(argv, {
    env: { BRAZE_CONFIG_DIR: configDir },
    streams,
    isTty: false,
    home,
    cwd: options.cwd ?? home,
  })
  return { code, stdout: streams.stdout.join("\n"), stderr: streams.stderr.join("\n") }
}

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), "brazecli-skill-"))
  home = join(base, "home")
  configDir = join(base, "config")
  mkdirSync(home, { recursive: true })
  streams = captureStreams()
})

describe("braze skill install", () => {
  it("installs where the named agent reads skills from", async () => {
    const { code, stdout } = await install(["skill", "install", "--claude", "--json"])

    expect(code).toBe(0)
    const { installed } = JSON.parse(stdout)
    expect(installed).toEqual([
      { agent: "claude", path: join(home, ".claude/skills/braze/SKILL.md"), status: "created" },
    ])
    expect(readFileSync(installed[0].path, "utf8")).toContain("name: braze")
  })

  // Codex reads user skills from ~/.agents/skills, not from anything under ~/.codex.
  it("installs for codex and hermes at their own paths", async () => {
    const { stdout } = await install(["skill", "install", "--codex", "--hermes", "--json"])

    expect(JSON.parse(stdout).installed.map((entry: { path: string }) => entry.path)).toEqual([
      join(home, ".agents/skills/braze/SKILL.md"),
      join(home, ".hermes/skills/braze/SKILL.md"),
    ])
  })

  it("finds the agents already on the machine when none is named", async () => {
    mkdirSync(join(home, ".claude"), { recursive: true })
    mkdirSync(join(home, ".hermes"), { recursive: true })

    const { stdout } = await install(["skill", "install", "--json"])

    expect(JSON.parse(stdout).installed.map((entry: { agent: string }) => entry.agent)).toEqual(["claude", "hermes"])
  })

  it("says so rather than guessing when no agent is installed", async () => {
    const { code, stdout, stderr } = await install(["skill", "install", "--json"])

    expect(code).toBe(3)
    expect(stdout).toBe("")
    expect(JSON.parse(stderr).error.code).toBe("configuration_error")
  })

  it("reports an unchanged file as unchanged, and a stale one as updated", async () => {
    const first = await install(["skill", "install", "--claude", "--json"])
    const path = JSON.parse(first.stdout).installed[0].path

    streams = captureStreams()
    const again = await install(["skill", "install", "--claude", "--json"])
    expect(JSON.parse(again.stdout).installed[0].status).toBe("unchanged")

    writeFileSync(path, "something older")
    streams = captureStreams()
    const third = await install(["skill", "install", "--claude", "--json"])
    expect(JSON.parse(third.stdout).installed[0].status).toBe("updated")
  })

  it("takes a directory of its own", async () => {
    const { stdout } = await install(["skill", "install", "--dir", "elsewhere/skills", "--json"], { cwd: home })

    expect(JSON.parse(stdout).installed).toEqual([
      { agent: "custom", path: join(home, "elsewhere/skills/braze/SKILL.md"), status: "created" },
    ])
  })

  it("installs into the repository with --project", async () => {
    const { stdout } = await install(["skill", "install", "--project", "--json"], { cwd: home })

    expect(JSON.parse(stdout).installed.map((entry: { path: string }) => entry.path)).toEqual([
      join(home, ".claude/skills/braze/SKILL.md"),
      join(home, ".agents/skills/braze/SKILL.md"),
    ])
  })

  it("needs no profile, because it never talks to Braze", async () => {
    const { code, stderr } = await install(["skill", "install", "--claude", "--json"])

    expect(code).toBe(0)
    expect(stderr).not.toContain("configuration_error")
  })
})

// A profile named after a command would make `braze <name> …` mean two things. The list is
// hand-maintained, so it is the kind that silently falls behind a new command.
describe("reserved profile names", () => {
  it("covers every top-level command", async () => {
    const commands = buildProgram()
      .commands.map((command) => command.name())
      .filter((name) => name !== "help")

    for (const name of commands) {
      streams = captureStreams()
      const code = await run(["profile", "add", name, "--endpoint", "https://rest.fra-01.braze.eu"], {
        env: { BRAZE_CONFIG_DIR: configDir },
        streams,
        isTty: false,
      })

      expect(code, `a profile may not be called "${name}"`).not.toBe(0)
      expect(streams.stderr.join("\n"), `"${name}" is a command but not a reserved profile name`).toContain(
        "is also a command",
      )
    }
  })
})

import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { captureStreams } from "@leemour/cli-core"
import { beforeEach, describe, expect, it } from "vitest"
import { run } from "../program.js"

let configDir: string
let streams: ReturnType<typeof captureStreams>

const discover = async (argv: string[] = ["commands", "--json"]) => {
  const code = await run(argv, { env: { BRAZE_CONFIG_DIR: configDir }, streams, isTty: false })
  return { code, surface: JSON.parse(streams.stdout.join("\n")) }
}

interface DiscoveredCommand {
  name: string
  path: string[]
  usage: string
  operationId?: string
  origin: string
  mutates?: boolean
  commands: DiscoveredCommand[]
}

const find = (commands: DiscoveredCommand[], name: string): DiscoveredCommand => {
  const hit = commands.find((command) => command.name === name)
  if (!hit) throw new Error(`no command named ${name}`)
  return hit
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "brazecli-commands-"))
  streams = captureStreams()
})

describe("braze commands", () => {
  it("puts one JSON value on stdout and nothing else", async () => {
    const { code } = await discover()

    expect(code).toBe(0)
    expect(streams.stderr).toEqual([])
  })

  it("lists every registered command, nested, with the argv path already split", async () => {
    const { surface } = await discover()
    const names = surface.commands.map((command: DiscoveredCommand) => command.name)

    // The handwritten four come first, then one group per catalog resource — registered in a loop,
    // so this list grows on its own when Braze's collection does.
    expect(names.slice(0, 4)).toEqual(["profile", "api", "runs", "commands"])
    expect(names).toContain("campaigns")

    const list = find(find(surface.commands, "runs").commands, "list")
    expect(list.path).toEqual(["runs", "list"])
    expect(list.usage).toBe("braze runs list [options]")
  })

  it("carries a catalog command with its path already split and its options named", async () => {
    const { surface } = await discover()
    const list = find(find(surface.commands, "campaigns").commands, "list")

    expect(list.path).toEqual(["campaigns", "list"])
    expect(list.usage).toBe("braze campaigns list [options]")
  })

  it("says which options take a value, and separately which must be given", async () => {
    const { surface } = await discover()
    const option = (flags: string) =>
      surface.globalOptions.find((candidate: { flags: string }) => candidate.flags === flags)

    // Commander calls both of these `required`, meaning different things. An agent reading
    // --profile as mandatory would refuse to run without one.
    expect(option("--json")).toMatchObject({ takesValue: false, mandatory: false })
    expect(option("--profile <name>")).toMatchObject({ takesValue: true, mandatory: false })
  })

  it("carries the choices for a constrained option", async () => {
    const { surface } = await discover()
    const output = surface.globalOptions.find((option: { flags: string }) => option.flags === "--output <format>")

    expect(output.choices).toEqual(["auto", "pretty", "json", "jsonl"])
  })

  it("publishes the exit code for every failure a script branches on", async () => {
    const { surface } = await discover()

    expect(surface.exitCodes).toMatchObject({ ok: 0, permission_error: 5, not_found: 6, cancelled: 130 })
  })

  it("needs no profile and survives a configuration it cannot read", async () => {
    const { code, surface } = await discover()

    expect(code).toBe(0)
    expect(surface.commands.length).toBeGreaterThan(0)
  })

  it("says the endpoints are discoverable, counts them, and still names the escape hatch", async () => {
    const { surface } = await discover()

    expect(surface.endpoints).toMatchObject({
      discoverable: true,
      documentation: "https://www.braze.com/docs/api/home",
    })
    // Leaves only: `campaigns` is scaffolding, `campaigns list` is a thing you can run.
    expect(surface.endpoints.runnableCommands).toBe(108)
    expect(surface.endpoints.escapeHatch).toContain("braze api")
  })

  it("renders a flat table for a terminal instead of the whole tree", async () => {
    const code = await run(["commands", "--output", "pretty"], {
      env: { BRAZE_CONFIG_DIR: configDir },
      streams,
      isTty: true,
    })

    expect(code).toBe(0)
    expect(streams.stdout.join("\n")).toContain("braze api <method> <path> [options]")
    expect(streams.stdout.join("\n")).not.toContain("takesValue")
  })
})

/**
 * CAT-7. `braze schema` is addressable by operation id, and before this the discovery surface
 * named no id anywhere — so that half of its addressing was reachable only by reading the
 * generated catalog. An agent reads `commands --json`; the id has to be in there.
 */
describe("the operation id on the discovery surface", () => {
  const leaves = (commands: DiscoveredCommand[]): DiscoveredCommand[] =>
    commands.flatMap((command) => (command.commands.length === 0 ? [command] : leaves(command.commands)))

  it("marks every generated command with the id braze schema takes", async () => {
    const { surface } = await discover()
    const withId = leaves(surface.commands).filter((command) => "operationId" in command)

    expect(withId.length).toBe(95)
  })

  it("marks none of the handwritten commands, which describe no Braze operation", async () => {
    const { surface } = await discover()
    const handwritten = ["profile", "api", "runs", "commands", "schema"]

    for (const name of handwritten) {
      const command = find(surface.commands, name)
      const tagged = leaves([command]).filter((leaf) => "operationId" in leaf)
      expect(tagged, name).toEqual([])
    }
  })
})

describe("what the registry says about each command", () => {
  const leaves = (commands: DiscoveredCommand[]): DiscoveredCommand[] =>
    commands.flatMap((command) => (command.commands.length === 0 ? [command] : leaves(command.commands)))
  const at = (commands: DiscoveredCommand[], ...path: string[]): DiscoveredCommand =>
    path.reduce<DiscoveredCommand>((command, name) => find(command.commands, name), {
      commands,
    } as DiscoveredCommand)

  it("labels every catalog command generated, and every other one handwritten", async () => {
    const { surface } = await discover()
    const all = leaves(surface.commands)

    expect(all.filter((command) => command.origin === "generated")).toEqual(
      all.filter((command) => command.operationId !== undefined),
    )
    expect(at(surface.commands, "profile", "add").origin).toBe("handwritten")
  })

  it("marks a write as mutating, and leaves the POST-shaped exports reads, as the --confirm guard does", async () => {
    const { surface } = await discover()

    expect(at(surface.commands, "users", "track").mutates).toBe(true)
    expect(at(surface.commands, "users", "export", "ids")).not.toHaveProperty("mutates")
    expect(at(surface.commands, "campaigns", "list")).not.toHaveProperty("mutates")
  })

  it("lists update but not the completion command a shell calls", async () => {
    const { surface } = await discover()
    const names = surface.commands.map((command: DiscoveredCommand) => command.name)

    expect(names).toContain("update")
    expect(names).not.toContain("complete")
  })
})

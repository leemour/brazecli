import { EXIT_CODES, GENERIC_FAILURE, type Streams } from "@leemour/cli-core"
import { describeOptions, describeProgram, flatten } from "@leemour/cli-core/commands"
import type { Command } from "commander"
import { Command as CommanderCommand } from "commander"
import { DOCUMENTATION } from "../documentation.js"
import { outputFor, rootOf } from "../output/context.js"
import { VERSION } from "../version.js"

export interface CommandsContext {
  env?: NodeJS.ProcessEnv
  streams?: Streams
  isTty?: boolean
}

/**
 * The discovery surface an agent reads instead of `--help`. It walks the live Commander tree
 * rather than a list written by hand, so anything registered later — the generated catalog
 * above all — shows up here without this file being touched.
 */
export const commandsCommand = (context: CommandsContext = {}): Command => {
  const command = new CommanderCommand("commands").description(
    "every command, option and exit code as JSON — the discovery surface for an agent",
  )

  command.action(function (this: Command) {
    const root = rootOf(this)
    const { format, renderer } = outputFor(this, context)

    const commands = describeProgram(root)

    if (format === "pretty") {
      renderer.result(flatten(commands).map(({ usage, description }) => ({ command: usage, description })))
      return
    }

    renderer.result({
      cli: root.name(),
      version: VERSION,
      description: root.description(),
      globalOptions: describeOptions(root),
      commands,
      exitCodes: { ok: 0, generic_failure: GENERIC_FAILURE, ...EXIT_CODES },
      // Every catalog operation is a command in the tree above, so an agent needs nothing else to
      // call one. The escape hatch and the documentation stay named for the endpoints the
      // collection does not carry.
      endpoints: {
        discoverable: true,
        // Leaves, so `profile` and `campaigns` do not count but `profile add` and `campaigns list` do.
        runnableCommands: flatten(commands).filter((command) => command.commands.length === 0).length,
        escapeHatch: "braze api <method> <path> --json, for anything the catalog does not carry",
        documentation: DOCUMENTATION.endpoints,
        apiBasics: DOCUMENTATION.basics,
      },
    })
  })

  return command
}

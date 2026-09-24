import { createRenderer, EXIT_CODES, GENERIC_FAILURE, processStreams, type Streams } from "@leemour/cli-core"
import type { Command } from "commander"
import { Command as CommanderCommand } from "commander"
import { emptyConfig, loadConfig } from "../config/file.js"
import { resolvePaths } from "../config/paths.js"
import { DOCUMENTATION } from "../documentation.js"
import { type GlobalFlags, resolveColor, resolveOutputFormat } from "../settings.js"
import { VERSION } from "../version.js"
import { operationIds } from "./catalog.js"

export interface CommandsContext {
  env?: NodeJS.ProcessEnv
  streams?: Streams
  isTty?: boolean
}

export interface ArgumentInfo {
  name: string
  required: boolean
  variadic: boolean
  description: string
  choices?: readonly string[]
  default?: unknown
}

export interface OptionInfo {
  flags: string
  description: string
  /** False for a plain switch like `--json`, so an agent knows not to look for a value. */
  takesValue: boolean
  /**
   * Whether the option itself must be given. Deliberately not Commander's `required`, which
   * means "takes a value when present" — reading that as "you must pass this" is the obvious
   * misreading, and an agent gets no chance to ask.
   */
  mandatory: boolean
  choices?: readonly string[]
  default?: unknown
  env?: string
}

export interface CommandInfo {
  /** What to pass to the CLI, already split: `["runs", "list"]`. */
  path: readonly string[]
  /** Present on a command generated from the catalog — what `braze schema` is addressed by. */
  operationId?: string
  name: string
  description: string
  usage: string
  arguments: readonly ArgumentInfo[]
  options: readonly OptionInfo[]
  commands: readonly CommandInfo[]
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
    const env = context.env ?? process.env
    const root = this.parent ?? this
    const globals = root.opts<GlobalFlags>()

    let config = emptyConfig()
    try {
      config = loadConfig(resolvePaths(env).config)
    } catch {
      // Listing the command surface must not depend on a configuration being readable.
    }

    const format = resolveOutputFormat(globals, env, config, context.isTty ?? process.stdout.isTTY === true)
    const streams = context.streams ?? processStreams
    const renderer = createRenderer({
      format,
      color: resolveColor(globals, env, config, context.isTty ?? process.stderr.isTTY === true),
      streams,
    })

    const commands = describeProgram(root)

    if (format === "pretty") {
      renderer.result(flatten(commands).map(({ usage, description }) => ({ command: usage, description })))
      return
    }

    renderer.result({
      cli: root.name(),
      version: VERSION,
      description: root.description(),
      globalOptions: root.options.filter((option) => !option.hidden).map(describeOption),
      commands,
      exitCodes: { ok: 0, generic_failure: GENERIC_FAILURE, ...EXIT_CODES },
      // Every catalog operation is a command in the tree above, so an agent needs nothing else to
      // call one. The escape hatch and the documentation stay named for the endpoints the
      // collection does not carry.
      endpoints: {
        discoverable: true,
        // Leaves, so `profile` and `campaigns` do not count but `profile add` and `campaigns list` do.
        runnableCommands: root.commands.reduce(countLeaves, 0),
        escapeHatch: "braze api <method> <path> --json, for anything the catalog does not carry",
        documentation: DOCUMENTATION.endpoints,
        apiBasics: DOCUMENTATION.basics,
      },
    })
  })

  return command
}

/**
 * The whole command tree as data — what `braze commands --json` prints, and what
 * `docs/commands.md` is rendered from (`CAT-8`).
 *
 * Exported so the generated documentation walks **this** tree rather than a second traversal of
 * its own. Two walks would drift the first time one learned something the other did not, and
 * "what commands exist" is exactly the fact this repository refuses to keep in two places.
 */
export const describeProgram = (root: Command): CommandInfo[] =>
  root.commands.map((child) => describe(child, root.name(), []))

const describe = (command: Command, cli: string, parents: readonly string[]): CommandInfo => {
  const path = [...parents, command.name()]
  const args = command.registeredArguments.map(describeArgument)
  const options = command.options.filter((option) => !option.hidden).map(describeOption)

  const usage = [
    cli,
    ...path,
    ...args.map((argument) => (argument.required ? `<${argument.name}>` : `[${argument.name}]`)),
    options.length > 0 ? "[options]" : "",
  ]
    .filter(Boolean)
    .join(" ")

  return {
    path,
    ...(operationIds.get(command) ? { operationId: operationIds.get(command) as string } : {}),
    name: command.name(),
    description: command.description(),
    usage,
    arguments: args,
    options,
    commands: command.commands.map((child) => describe(child, cli, path)),
  }
}

const describeArgument = (argument: Command["registeredArguments"][number]): ArgumentInfo => ({
  name: argument.name(),
  required: argument.required,
  variadic: argument.variadic,
  description: argument.description,
  ...(argument.argChoices ? { choices: argument.argChoices } : {}),
  ...(argument.defaultValue === undefined ? {} : { default: argument.defaultValue }),
})

const describeOption = (option: Command["options"][number]): OptionInfo => ({
  flags: option.flags,
  description: option.description,
  takesValue: option.required || option.optional,
  mandatory: option.mandatory,
  ...(option.argChoices ? { choices: option.argChoices } : {}),
  ...(option.defaultValue === undefined ? {} : { default: option.defaultValue }),
  ...(option.envVar ? { env: option.envVar } : {}),
})

const flatten = (commands: readonly CommandInfo[]): CommandInfo[] =>
  commands.flatMap((command) => [command, ...flatten(command.commands)])

/** A group is scaffolding; only a command that runs something counts as an operation. */
const countLeaves = (total: number, command: Command): number =>
  command.commands.length === 0 ? total + 1 : command.commands.reduce(countLeaves, total)

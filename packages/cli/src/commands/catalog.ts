import { annotate } from "@leemour/cli-core/commands"
import { catalog, type Operation } from "brazecli-core"
import { Command } from "commander"
import { collectQuery, type ExecutionContext, runOperation } from "../execute.js"
import { readInput } from "../input/read.js"
import type { GlobalFlags } from "../settings.js"

/**
 * Every catalog operation, registered as a command. §13: a loop, not a hundred nearly identical
 * files. Core never learns what Commander is — it hands over data, and the shaping happens here.
 */
export const catalogCommands = (
  context: ExecutionContext = {},
  operations: readonly Operation[] = catalog,
): Command[] => {
  const groups = new Map<string, Command>()
  const roots: Command[] = []

  for (const operation of operations) {
    const words = operation.command
    const leaf = words.at(-1)
    if (leaf === undefined) continue

    let parent: Command | undefined
    // Every word but the last is a group. `["catalogs", "items", "get"]` becomes
    // `braze catalogs items get`, with `catalogs` and `catalogs items` created once and shared.
    for (const [depth, word] of words.slice(0, -1).entries()) {
      const key = words.slice(0, depth + 1).join(" ")
      let group = groups.get(key)

      if (!group) {
        group = new Command(word).description(`${key} operations`)
        groups.set(key, group)
        if (parent) parent.addCommand(group)
        else roots.push(group)
      }
      parent = group
    }

    const command = build(operation, context)
    if (parent) parent.addCommand(command)
    else roots.push(command)
  }
  return roots
}

const build = (operation: Operation, context: ExecutionContext): Command => {
  const command = new Command(operation.command.at(-1) as string).description(
    operation.description ?? `${operation.method} ${operation.path}`,
  )

  // What `braze commands --json` prints as `operationId`, and what `braze schema` is addressed by.
  // Without it the discovery surface names no id at all, so half of `schema`'s addressing would be
  // reachable only by reading the generated catalog (CAT-7). `mutates` follows the same test as the
  // `--confirm` guard, so the three POST-shaped exports stay reads.
  annotate(command, {
    origin: "generated",
    operationId: operation.id,
    ...(operation.access === "write" ? { mutates: true } : {}),
  })

  // A path placeholder becomes a REQUIRED named option rather than a positional argument: an agent
  // building a call out of `braze commands --json` then never has to know the order, and `--help`
  // says what each one is.
  for (const parameter of operation.pathParameters ?? []) {
    command.requiredOption(`--${dashed(parameter)} <value>`, `path parameter {${parameter}}`)
  }

  for (const parameter of operation.queryParameters ?? []) {
    const hint = parameter.example ? ` (e.g. ${parameter.example})` : ""
    command.option(`--${dashed(parameter.name)} <value>`, `${parameter.description ?? "query parameter"}${hint}`)
  }

  // Postman examples are not a schema (§11), so the documented query keys above are a convenience
  // and never the whole list. `--query` keeps a typed command as capable as `braze api`.
  command.option("--query <key=value>", "any other query parameter, repeatable", collectQuery, {})

  if (operation.access === "write" || operation.method !== "GET") {
    command.option("--input <source>", "request body: @file, - for stdin, or inline JSON")
  }

  command.action(async (flags: Record<string, unknown>, self: Command) => {
    await runOperation(
      {
        operation,
        pathParams: collect(operation.pathParameters ?? [], flags),
        query: { ...named(operation, flags), ...((flags.query as Record<string, string>) ?? {}) },
        body: typeof flags.input === "string" ? readInput(flags.input) : undefined,
        label: operation.command.join(" "),
      },
      globalsOf(self),
      context,
    )
  })

  return command
}

/** Commander camel-cases an option name, so `--catalog-name` arrives as `catalogName`. */
const camel = (name: string): string =>
  dashed(name).replace(/-([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase())

const dashed = (name: string): string =>
  name
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()

const collect = (names: readonly string[], flags: Record<string, unknown>): Record<string, string> => {
  const values: Record<string, string> = {}
  for (const name of names) {
    const value = flags[camel(name)]
    if (typeof value === "string") values[name] = value
  }
  return values
}

const named = (operation: Operation, flags: Record<string, unknown>): Record<string, string> => {
  const values: Record<string, string> = {}
  for (const parameter of operation.queryParameters ?? []) {
    const value = flags[camel(parameter.name)]
    if (typeof value === "string") values[parameter.name] = value
  }
  return values
}

/** The root program holds the global flags, however deeply the command is nested. */
const globalsOf = (command: Command): GlobalFlags => {
  let node: Command = command
  while (node.parent) node = node.parent
  return node.opts<GlobalFlags>()
}

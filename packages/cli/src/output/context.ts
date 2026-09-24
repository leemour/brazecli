import { createRenderer, processStreams, type Streams } from "@leemour/cli-core"
import type { Command } from "commander"
import { type Config, emptyConfig, loadConfig } from "../config/file.js"
import { resolvePaths } from "../config/paths.js"
import { type GlobalFlags, resolveColor, resolveOutputFormat } from "../settings.js"

export interface OutputContext {
  env?: NodeJS.ProcessEnv
  streams?: Streams
  isTty?: boolean
}

export const rootOf = (command: Command): Command => (command.parent ? rootOf(command.parent) : command)

/** For commands that must work when the config is the thing that is broken. */
export const readableConfig = (env: NodeJS.ProcessEnv): Config => {
  try {
    return loadConfig(resolvePaths(env).config)
  } catch {
    return emptyConfig()
  }
}

/**
 * The output mode, colour and renderer a command answers with — `NEED-1` resolved once, here.
 * A command that needs the config to be valid loads it itself and passes it in.
 */
export const outputFor = (command: Command, context: OutputContext = {}, config?: Config) => {
  const env = context.env ?? process.env
  const globals = rootOf(command).opts<GlobalFlags>()
  const settled = config ?? readableConfig(env)
  const format = resolveOutputFormat(globals, env, settled, context.isTty ?? process.stdout.isTTY === true)
  const streams = context.streams ?? processStreams
  const renderer = createRenderer({
    format,
    color: resolveColor(globals, env, settled, context.isTty ?? process.stderr.isTTY === true),
    streams,
    quiet: globals.quiet === true,
  })
  return { env, globals, config: settled, format, streams, renderer }
}

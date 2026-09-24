import { createRenderer, processStreams, type Streams } from "@leemour/cli-core"
import { isNewer, updateCommand } from "@leemour/cli-core/update"
import { BrazeError } from "brazecli-core"
import { Command } from "commander"
import { emptyConfig, loadConfig } from "../config/file.js"
import { resolvePaths } from "../config/paths.js"
import { type GlobalFlags, resolveColor, resolveOutputFormat } from "../settings.js"
import { installer, latest, PACKAGE, runUpdate, type UpdateEnvironment } from "../update.js"
import { VERSION } from "../version.js"

export interface UpdateContext {
  env?: NodeJS.ProcessEnv
  streams?: Streams
  isTty?: boolean
  update?: UpdateEnvironment
}

const BY_HAND: Record<string, string> = {
  checkout: "this is a checkout: `git pull && pnpm install && pnpm build`",
  npx: "npx runs whatever version it is asked for: `npx @leemour/brazecli@latest`",
  unknown: "cannot tell how braze was installed, so nothing was run",
}

/**
 * Updates `braze` with the package manager that installed it. Never runs by itself: this program
 * holds API keys, and code that replaces itself unasked is not wanted here.
 */
export const selfUpdateCommand = (context: UpdateContext = {}): Command =>
  new Command("update")
    .description("update braze with the package manager that installed it; --check only looks")
    .option("--check", "say whether a newer version exists, and install nothing")
    .action(async function (this: Command, { check }: { check?: boolean }) {
      const env = context.env ?? process.env
      const globals = (this.parent ?? this).opts<GlobalFlags>()
      let config = emptyConfig()
      try {
        config = loadConfig(resolvePaths(env).config)
      } catch {
        // Updating must not depend on a configuration being readable — it may be how that gets fixed.
      }
      const format = resolveOutputFormat(globals, env, config, context.isTty ?? process.stdout.isTTY === true)
      const renderer = createRenderer({
        format,
        color: resolveColor(globals, env, config, context.isTty ?? process.stderr.isTTY === true),
        streams: context.streams ?? processStreams,
      })

      const environment = context.update ?? {}
      const found = installer(environment)
      const argv = updateCommand(found, PACKAGE)
      const newest = await latest(environment)
      const newer = newest !== undefined && isNewer(newest, VERSION)
      const answer = {
        current: VERSION,
        latest: newest ?? null,
        newer,
        installer: found,
        command: argv?.join(" ") ?? null,
      }

      if (check || !newer || !argv) {
        if (!check && newest === undefined) renderer.warn("npm did not answer, so nothing was run")
        else if (!check && !newer) renderer.note(`braze ${VERSION} is the newest`)
        else if (!check && !argv) renderer.warn(BY_HAND[found] ?? BY_HAND.unknown ?? "")
        renderer.result(format === "pretty" ? summary(answer) : { ...answer, updated: false })
        return
      }

      renderer.note(`running: ${argv.join(" ")}`)
      const code = runUpdate(argv, environment)
      if (code !== 0) {
        throw new BrazeError("provider_error", `${argv[0]} exited with ${code}; braze is still ${VERSION}`)
      }
      renderer.result(format === "pretty" ? `braze ${VERSION} → ${newest}` : { ...answer, updated: true })
    })

const summary = ({ current, latest, newer }: { current: string; latest: string | null; newer: boolean }) =>
  latest === null
    ? `braze ${current}; npm did not answer`
    : newer
      ? `braze ${latest} is out — you have ${current}`
      : `braze ${current} is the newest`

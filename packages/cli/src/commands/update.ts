import type { Streams } from "@leemour/cli-core"
import { isNewer, updateCommand } from "@leemour/cli-core/update"
import { BrazeError } from "brazecli-core"
import { Command } from "commander"
import { outputFor } from "../output/context.js"
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
      const { format, renderer } = outputFor(this, context)

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

import { BrazeClient, BrazeError, findOperation } from "brazecli-core"
import { Command } from "commander"
import { loadConfig, saveConfig } from "../config/file.js"
import { createRenderer } from "../output/renderer.js"
import { processStreams, type Streams } from "../output/stream.js"
import { type GlobalFlags, type ResolveOptions, resolveSettings } from "../settings.js"
import { userAgent } from "../user-agent.js"

export interface VerifyContext extends ResolveOptions {
  streams?: Streams
  fetch?: typeof globalThis.fetch
}

const MAU = "kpi.mau.data-series.get"

/**
 * Answers the one question a profile cannot answer on its own: **is this the workspace I think
 * it is?**
 *
 * Braze publishes no workspace identifier — no `/me`, nothing in any response that names the
 * workspace a key belongs to — so this cannot be checked directly. What does separate them is
 * size, and by activity rather than by volume: a sandbox seeded from production holds just as
 * many user *profiles*, but almost nobody is active in it.
 *
 * An exact fingerprint was considered and rejected. Hashing campaign or segment ids breaks the
 * first time anyone adds one, and a check that cries wolf is a check people learn to skip.
 */
export const verifyCommand = (context: VerifyContext = {}): Command =>
  new Command("verify")
    .argument("[name]", "profile to check; otherwise --profile or BRAZE_PROFILE")
    .option("--expect-max <count>", "record this ceiling on monthly active users", Number)
    .description("check that a profile still points at the workspace you think it does")
    .action(async (name: string | undefined, flags: { expectMax?: number }, self: Command) => {
      const globals = { ...(self.parent?.parent?.opts<GlobalFlags>() ?? {}), ...(name ? { profile: name } : {}) }
      const streams = context.streams ?? processStreams

      const settings = resolveSettings(globals, { ...context, warn: context.warn ?? streams.diagnostic })
      const renderer = createRenderer({ format: settings.outputFormat, color: settings.color, streams })

      const operation = findOperation(MAU)
      if (!operation) throw new BrazeError("configuration_error", `the catalog has no ${MAU} operation`)

      const client = new BrazeClient({
        endpoint: settings.restEndpoint,
        apiKey: settings.apiKey,
        fetch: context.fetch,
        userAgent: userAgent(),
      })

      const result = await client.execute(operation, { query: { length: "1" } })
      const monthlyActives = latestMau(result.data)

      if (monthlyActives === undefined) {
        throw new BrazeError("invalid_response", "Braze returned no monthly active figure, so nothing could be checked")
      }

      const ceiling = flags.expectMax ?? settings.expectMaxMonthlyActives
      const verdict = ceiling === undefined ? "unchecked" : monthlyActives <= ceiling ? "ok" : "too-large"

      // Only once the workspace agrees with it. Recording a ceiling the live workspace already
      // breaks would write the assertion "this is the small one" onto the large one.
      if (flags.expectMax !== undefined && verdict === "ok") {
        const config = loadConfig(settings.paths.config)
        const profile = config.profiles[settings.profileName]
        if (!profile) throw new BrazeError("configuration_error", `no profile named "${settings.profileName}"`)

        profile.expectMaxMonthlyActives = flags.expectMax
        saveConfig(settings.paths.config, config)
      }

      renderer.result({
        profile: settings.profileName,
        endpoint: settings.restEndpoint,
        readOnly: settings.readOnly,
        monthlyActives,
        expectMaxMonthlyActives: ceiling ?? null,
        verdict,
      })

      if (verdict === "unchecked") {
        renderer.warn(
          `no ceiling recorded for "${settings.profileName}" — run \`braze profile verify ${settings.profileName} ` +
            `--expect-max ${roundUp(monthlyActives)}\` to pin it, and a swapped key will be caught next time`,
        )
        return
      }

      if (verdict === "too-large") {
        throw new BrazeError(
          "configuration_error",
          `profile "${settings.profileName}" expects at most ${ceiling} monthly active users but this workspace ` +
            `has ${monthlyActives} — the key is very likely pointed at a different workspace. ` +
            "Nothing was recorded.",
          { operation: MAU },
        )
      }

      renderer.success(`"${settings.profileName}" looks right: ${monthlyActives} monthly actives, at most ${ceiling}`)
    })

const latestMau = (data: unknown): number | undefined => {
  if (typeof data !== "object" || data === null) return undefined

  const series = (data as { data?: unknown }).data
  if (!Array.isArray(series) || series.length === 0) return undefined

  const last = series.at(-1)
  const mau = typeof last === "object" && last !== null ? (last as { mau?: unknown }).mau : undefined
  return typeof mau === "number" ? mau : undefined
}

/** Headroom, so ordinary growth does not trip the check on a Tuesday. */
const roundUp = (value: number): number => {
  const withHeadroom = Math.max(value * 4, value + 1000)
  const magnitude = 10 ** Math.floor(Math.log10(withHeadroom))
  return Math.ceil(withHeadroom / magnitude) * magnitude
}

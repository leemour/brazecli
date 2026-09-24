import { type KeyringStore, visibleControls } from "@leemour/cli-core"
import { Command } from "commander"
import { type Diagnosis, diagnose } from "../diagnose.js"
import { type OutputContext, outputFor } from "../output/context.js"
import type { UpdateEnvironment } from "../update.js"

export interface DoctorContext extends OutputContext {
  keyring?: KeyringStore
  update?: UpdateEnvironment
}

/** Answers "why does braze not work here?" from this machine alone, and exits 0 whenever it could. */
export const doctorCommand = (context: DoctorContext = {}): Command =>
  new Command("doctor")
    .description("check this machine's setup: config, keys, keyring, runs and version — reaches nothing")
    .action(function (this: Command) {
      const { env, format, renderer, streams } = outputFor(this, context)
      const report = diagnose({ env, keyring: context.keyring, update: context.update })
      if (format === "pretty") streams.data(visibleControls(readable(report)))
      else renderer.result(report)
    })

const readable = (report: Diagnosis): string => {
  const { update, config, keyring, environment, profiles, runs, next } = report
  const seen = update.latest ? `npm had ${update.latest} on ${update.lastCheckedAt?.slice(0, 10)}` : "npm not asked yet"
  const set = Object.entries(environment)
    .filter(([, value]) => value)
    .map(([name, value]) => (value === true ? `${name} set` : `${name}=${value}`))
  const width = Math.max(0, ...profiles.map((profile) => profile.name.length))
  const key = ({ apiKey }: Diagnosis["profiles"][number]) =>
    apiKey.present ? `key from ${apiKey.source}` : apiKey.problem ? `no key: ${apiKey.problem}` : "no key"

  return [
    `braze     ${report.version}, installed by ${report.installer}; ${seen}`,
    `config    ${config.file} — ${!config.found ? "not created yet" : config.valid ? "valid" : `INVALID: ${config.problem}`}`,
    `keyring   ${keyring.service}${keyring.isolated ? " — separate, because BRAZE_CONFIG_DIR is set" : ""}`,
    `env       ${set.length > 0 ? set.join(" · ") : "no BRAZE_* variable set"}`,
    ...(profiles.length === 0
      ? ["profiles  none"]
      : profiles.map(
          (profile, index) =>
            `${index === 0 ? "profiles" : "        "}  ${profile.name.padEnd(width)}  ${profile.restEndpoint}  ${key(profile)}${profile.readOnly ? ", read-only" : ""}`,
        )),
    `runs      ${runs.directory} — ${runs.kept} kept`,
    ...(next.length > 0 ? ["", "Next:", ...next.map((step, index) => `  ${index + 1}. ${step}`)] : []),
  ].join("\n")
}

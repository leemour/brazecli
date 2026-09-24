import { configFilePath, loadConfigFile, saveConfigFile } from "@leemour/cli-core"
import { BrazeError } from "brazecli-core"
import * as v from "valibot"

export const CREDENTIAL_STORAGE = ["auto", "keyring", "file"] as const
export type CredentialStorage = (typeof CREDENTIAL_STORAGE)[number]

export const OUTPUT_FORMATS = ["auto", "pretty", "json", "jsonl"] as const
export type OutputFormat = (typeof OUTPUT_FORMATS)[number]

const ProfileSchema = v.object({
  restEndpoint: v.pipe(v.string(), v.url()),
  appId: v.optional(v.string()),
  /**
   * Refuses every write for this profile, **before** `--confirm` is even looked at. `--confirm`
   * protects against a typo; this protects against pasting someone else's command that already
   * carries it. Meant for a production profile during development.
   */
  readOnly: v.optional(v.boolean(), false),
  /**
   * A ceiling on how large this workspace is expected to be, in monthly active users.
   *
   * Braze exposes no workspace identifier — nothing in the API says which workspace a key belongs
   * to — so a profile cannot prove it is pointed at the sandbox. Size is the next best thing and
   * in practice separates them cleanly: the sandbox ran 502 monthly actives against production's
   * 1.3 million, even though both held millions of *profiles*. `braze profile verify` records and
   * checks this.
   */
  expectMaxMonthlyActives: v.optional(v.pipe(v.number(), v.minValue(1))),
})

export const ConfigSchema = v.object({
  version: v.literal(1),
  credentialStorage: v.optional(v.picklist(CREDENTIAL_STORAGE), "auto"),
  http: v.optional(
    v.object({
      timeoutMs: v.optional(v.pipe(v.number(), v.minValue(1))),
      retries: v.optional(v.pipe(v.number(), v.minValue(0))),
      retryBaseDelayMs: v.optional(v.pipe(v.number(), v.minValue(0))),
      retryMaxDelayMs: v.optional(v.pipe(v.number(), v.minValue(0))),
      maxRetryAfterMs: v.optional(v.pipe(v.number(), v.minValue(0))),
    }),
    {},
  ),
  bulk: v.optional(v.object({ concurrency: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(32))) }), {}),
  output: v.optional(
    v.object({
      format: v.optional(v.picklist(OUTPUT_FORMATS)),
      color: v.optional(v.picklist(["auto", "always", "never"])),
    }),
    {},
  ),
  logging: v.optional(v.object({ level: v.optional(v.string()) }), {}),
  /** The daily "a newer braze exists" line on a terminal. Absent means on. */
  updateCheck: v.optional(v.boolean()),
  profiles: v.optional(v.record(v.string(), ProfileSchema), {}),
})

export type Config = v.InferOutput<typeof ConfigSchema>
export type Profile = v.InferOutput<typeof ProfileSchema>

export const emptyConfig = (): Config => v.parse(ConfigSchema, { version: 1 })

/** cli-core names the bad field; braze adds the code a script branches on (`CLI-12`: exit 3). */
export const loadConfig = (configDir: string): Config => {
  try {
    return loadConfigFile(configFilePath(configDir), ConfigSchema, emptyConfig)
  } catch (error) {
    throw new BrazeError("configuration_error", error instanceof Error ? error.message : String(error))
  }
}

export const saveConfig = (configDir: string, config: Config): void => {
  saveConfigFile(configFilePath(configDir), config)
}

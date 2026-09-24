import { readFileSync } from "node:fs"
import { type KeyringStore, processStreams, type Streams } from "@leemour/cli-core"
import { BrazeError, catalog } from "brazecli-core"
import { Command } from "commander"
import { Credentials } from "../auth/credentials.js"
import { loadConfig, saveConfig } from "../config/file.js"
import { resolvePaths } from "../config/paths.js"
import { outputFor } from "../output/context.js"
import { verifyCommand } from "./verify.js"

/**
 * Top-level command names a profile may not take. Not derived from the program at runtime: that
 * would need the built tree here and make a circular import of it, and this list is short and
 * changes with the handwritten commands, not with the catalog.
 */
const RESERVED = [
  "profile",
  "api",
  "runs",
  "commands",
  "schema",
  "skill",
  "update",
  "complete",
  "help",
  ...new Set(catalog.map((o) => o.command[0])),
]

export interface ProfileContext {
  env?: NodeJS.ProcessEnv
  keyring?: KeyringStore
  streams?: Streams
  isTty?: boolean
  /** How the API key is obtained when the environment does not carry one. */
  promptForKey?: (profile: string) => Promise<string>
  /** Injected so a test does not have to own the process's standard input. */
  readStdin?: () => string
}

/**
 * These commands cannot use `resolveSettings`: they are what creates the profile it would demand.
 * The output format does not depend on a profile, so it is resolved from the same three functions
 * everything else uses, and `NEED-1` holds here too (BUG-17).
 */
const context = (options: ProfileContext, self: Command) => {
  const env = options.env ?? process.env
  const paths = resolvePaths(env)
  const config = loadConfig(paths.config)
  const streams = options.streams ?? processStreams

  const credentials = new Credentials({
    configDir: paths.config,
    storage: config.credentialStorage,
    keyring: options.keyring,
    env,
    warn: streams.diagnostic,
  })

  const { renderer } = outputFor(self, options, config)

  return { env, paths, config, streams, credentials, renderer }
}

export const profileCommand = (options: ProfileContext = {}): Command => {
  const command = new Command("profile").description("manage the Braze environments this CLI talks to")

  command
    .command("add")
    .argument("<name>", "profile name, such as production or staging")
    .option("--endpoint <url>", "Braze REST endpoint, e.g. https://rest.fra-01.braze.eu")
    .option("--read-only", "refuse every write for this profile, whatever flags a command carries")
    .option("--no-read-only", "allow writes again; they still need --confirm")
    .option("--key-stdin", "read the API key from standard input, for a CI with no terminal")
    .description("add or update a profile and store its API key")
    .action(
      async (name: string, flags: { endpoint?: string; readOnly?: boolean; keyStdin?: boolean }, self: Command) => {
        const { paths, config, credentials, env, renderer } = context(options, self)
        const existingProfile = config.profiles[name]

        // `braze <profile> <command>` reads the first word as a profile when one is configured with
        // that name. A profile called `users` would make `braze users track` ambiguous, so the
        // collision is refused here — at the only moment it can still be avoided.
        if (RESERVED.includes(name)) {
          throw new BrazeError(
            "validation_error",
            `"${name}" is also a command, so \`braze ${name} …\` would be ambiguous — pick another name`,
          )
        }

        // Never a command line argument: it would land in shell history, in `ps`, and in CI logs.
        //
        // `--key-stdin` wins over the environment, because it was asked for in this invocation and
        // `BRAZE_API_KEY` may be left over from the shell. Explicit rather than "read stdin whenever
        // it is not a terminal": this command reads standard input for nothing else, so silently
        // taking whatever is piped in would make a stray pipe install a key nobody meant to give.
        const given = flags.keyStdin
          ? keyFromStdin(options)
          : env.BRAZE_API_KEY?.trim() || (await askForKey(name, options))

        // Re-running `add` to correct an endpoint must not demand the key again. Keeping the
        // stored one is the obvious reading of "update this profile", and it is said out loud so
        // nobody is left guessing which key is now in use.
        const existing = given ? undefined : credentials.read(name)
        if (!given && !existing) {
          throw new BrazeError(
            "validation_error",
            flags.keyStdin
              ? "--key-stdin was given and standard input was empty"
              : "no API key given — pipe it in with --key-stdin, set BRAZE_API_KEY for this command, " +
                  "or run it in a terminal to be asked",
          )
        }

        // Updating one field must not mean retyping the others. The key was already protected this
        // way; the endpoint was not, and got retyped wrong — `rest.fra-01.braze.com` does not exist,
        // so every command failed until it was noticed (BUG-5, UX-3).
        const restEndpoint = flags.endpoint ?? existingProfile?.restEndpoint
        if (restEndpoint === undefined) {
          throw new BrazeError("validation_error", `new profile "${name}" needs --endpoint`)
        }

        // Three states, not two. With both --read-only and --no-read-only declared and neither
        // given, Commander leaves this `undefined` — which is what distinguishes "leave it alone"
        // from "set it false". Without that third state, `profile add production --endpoint …` to
        // correct a URL would quietly unlock writes.
        const readOnly = flags.readOnly ?? existingProfile?.readOnly ?? false

        config.profiles[name] = { restEndpoint, readOnly }
        saveConfig(paths.config, config)

        const storedIn = given ? credentials.write(name, given) : (existing?.source ?? "file")
        renderer.success(
          given
            ? `profile "${name}" saved · key stored in the ${storedIn}`
            : `profile "${name}" updated · keeping the key already in the ${storedIn}`,
        )
        renderer.result({
          profile: name,
          restEndpoint,
          readOnly,
          keyStoredIn: storedIn,
          keyChanged: Boolean(given),
        })
      },
    )

  command.addCommand(verifyCommand(options))

  command
    .command("list")
    .description("show the configured profiles")
    .action((_flags: unknown, self: Command) => {
      const { config, credentials, renderer } = context(options, self)

      // Names, endpoints, and whether a key exists. Never the key, and never a masked form of
      // it either — a masked key still confirms which key is installed.
      const rows = Object.entries(config.profiles).map(([name, profile]) => ({
        name,
        restEndpoint: profile.restEndpoint,
        readOnly: profile.readOnly === true,
        apiKey: credentials.read(name) ? { present: true, source: credentials.read(name)?.source } : { present: false },
      }))

      renderer.result({ profiles: rows })
    })

  command
    .command("remove")
    .argument("<name>", "profile to remove")
    .description("remove a profile and its stored key")
    .action((name: string, _flags: unknown, self: Command) => {
      const { paths, config, credentials, renderer } = context(options, self)

      if (config.profiles[name] === undefined) {
        throw new BrazeError("not_found", `no profile named "${name}"`)
      }

      delete config.profiles[name]
      saveConfig(paths.config, config)

      const removedFrom = credentials.remove(name)
      renderer.success(
        removedFrom.length > 0
          ? `removed "${name}" and its key from the ${removedFrom.join(" and ")}`
          : `removed "${name}"`,
      )
      renderer.result({ removed: name, keyRemovedFrom: removedFrom })
    })

  return command
}

/**
 * The whole of standard input, trimmed — `echo "$KEY" | braze profile add …` adds a newline nobody
 * meant to store, and a key with a newline in it fails authentication in a way that looks like a
 * wrong key.
 */
const keyFromStdin = (options: ProfileContext): string => {
  try {
    return (options.readStdin ? options.readStdin() : readFileSync(0, "utf8")).trim()
  } catch (error) {
    throw new BrazeError(
      "validation_error",
      `cannot read standard input: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

const askForKey = async (profile: string, options: ProfileContext): Promise<string> => {
  if (options.promptForKey) return options.promptForKey(profile)
  if (!process.stdin.isTTY) return ""

  const { isCancel, password } = await import("@clack/prompts")
  const answer = await password({ message: `Braze API key for "${profile}"` })
  if (isCancel(answer)) throw new BrazeError("cancelled", "cancelled")
  return String(answer)
}

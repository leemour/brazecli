import { script } from "@bomb.sh/tab"
import { processStreams, type Streams } from "@leemour/cli-core"
import { describeOptions, describeProgram } from "@leemour/cli-core/commands"
import { formatSuggestions, suggest } from "@leemour/cli-core/completion"
import { BrazeError } from "brazecli-core"
import { Command } from "commander"
import { loadConfig } from "../config/file.js"
import { resolvePaths } from "../config/paths.js"

export interface CompleteContext {
  env?: NodeJS.ProcessEnv
  streams?: Streams
}

const SHELLS = ["zsh", "bash", "fish", "powershell"]

/**
 * `braze complete zsh` prints the script a shell sources; the script then runs
 * `braze complete -- <words>` on every Tab, and this answers from the command registry.
 *
 * ⚠ **A Tab never reaches Braze.** The only values offered beyond the command tree are profile
 * names from the local config, and nothing goes to stderr: a shell shows whatever it is given.
 */
export const completeCommand = (context: CompleteContext = {}): Command =>
  new Command("complete")
    .description("shell completion: `braze complete zsh` prints the script to source")
    .argument("[words...]")
    .allowUnknownOption()
    .helpOption(false)
    .action(function (this: Command, words: string[]) {
      const root = this.parent ?? this

      // Commander drops the `--` from the operands, so only the raw words tell a request from a shell name.
      const raw = (root as Command & { rawArgs: string[] }).rawArgs
      if (!raw.includes("--")) {
        const [shell] = words
        if (!shell || !SHELLS.includes(shell)) {
          throw new BrazeError("validation_error", `name a shell: braze complete ${SHELLS.join(" | ")}`)
        }
        // tab writes the script through console.log; stdout is where a `source <(…)` reads it.
        script(shell, "braze", "braze")
        return
      }

      const profiles = profileNames(context.env ?? process.env)
      // The last word is still being typed, so it is never taken for a profile: `camp` is on its way to `campaigns`.
      const rest = words.length > 1 && profiles.includes(words[0] as string) ? words.slice(1) : words
      const suggestions = suggest({
        commands: describeProgram(root),
        globalOptions: describeOptions(root),
        words: rest.length > 0 ? rest : [""],
        sources: {
          options: { profile: () => profiles },
          ...(rest === words ? { firstWord: () => profiles } : {}),
        },
      })
      ;(context.streams ?? processStreams).data(formatSuggestions(suggestions))
    })

const profileNames = (env: NodeJS.ProcessEnv): string[] => {
  try {
    return Object.keys(loadConfig(resolvePaths(env).config).profiles)
  } catch {
    return []
  }
}

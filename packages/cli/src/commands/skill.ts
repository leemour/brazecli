import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createRenderer, processStreams, type Streams } from "@leemour/cli-core"
import { BrazeError } from "brazecli-core"
import { Command } from "commander"
import { emptyConfig, loadConfig } from "../config/file.js"
import { resolvePaths } from "../config/paths.js"
import { type GlobalFlags, resolveColor, resolveOutputFormat } from "../settings.js"

export interface SkillContext {
  env?: NodeJS.ProcessEnv
  streams?: Streams
  isTty?: boolean
  home?: string
  cwd?: string
}

export const AGENTS = ["claude", "codex", "hermes"] as const
export type Agent = (typeof AGENTS)[number]

/**
 * Where each agent reads skills from, and how to tell it is installed at all.
 *
 * Codex's user directory is `~/.agents/skills` rather than anything under `~/.codex` — the
 * cross-tool convention, per its own documentation — which is why presence is probed separately
 * from where the file goes.
 */
const TARGETS: Record<Agent, { home: string; project: string; installed: string[] }> = {
  claude: { home: ".claude/skills", project: ".claude/skills", installed: [".claude"] },
  codex: { home: ".agents/skills", project: ".agents/skills", installed: [".codex", ".agents"] },
  hermes: { home: ".hermes/skills", project: ".hermes/skills", installed: [".hermes"] },
}

const SKILL_NAME = "braze"

/** Beside the built `dist/`, at the same depth in the sources, so one path serves both. */
const skillSource = (): string =>
  resolve(dirname(fileURLToPath(import.meta.url)), "../../skills", SKILL_NAME, "SKILL.md")

export interface Installed {
  agent: Agent | "custom"
  path: string
  status: "created" | "updated" | "unchanged"
}

export const installSkill = (directory: string, agent: Agent | "custom"): Installed => {
  const contents = readFileSync(skillSource(), "utf8")
  const target = join(directory, SKILL_NAME, "SKILL.md")

  const before = existsSync(target) ? readFileSync(target, "utf8") : undefined
  if (before === contents) return { agent, path: target, status: "unchanged" }

  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, contents)

  return { agent, path: target, status: before === undefined ? "created" : "updated" }
}

const detect = (home: string): Agent[] =>
  AGENTS.filter((agent) => TARGETS[agent].installed.some((marker) => existsSync(join(home, marker))))

export const skillCommand = (context: SkillContext = {}): Command => {
  const command = new Command("skill").description(
    "the agent skill for this tool — install it into Claude Code, Codex or Hermes",
  )

  command
    .command("install")
    .description("write SKILL.md where an agent will find it")
    .option("--claude", "install for Claude Code")
    .option("--codex", "install for Codex")
    .option("--hermes", "install for Hermes")
    .option("--project", "install into this repository rather than your home directory")
    .option("--dir <path>", "a skills directory of your own; the skill lands in <path>/braze/")
    .action(function (
      this: Command,
      flags: { claude?: boolean; codex?: boolean; hermes?: boolean; project?: boolean; dir?: string },
    ) {
      const env = context.env ?? process.env
      const globals = this.parent?.parent?.opts<GlobalFlags>() ?? {}
      const streams = context.streams ?? processStreams

      let config = emptyConfig()
      try {
        config = loadConfig(resolvePaths(env).config)
      } catch {
        // Installing a skill file must not depend on a configuration it never reads.
      }

      const renderer = createRenderer({
        format: resolveOutputFormat(globals, env, config, context.isTty ?? process.stdout.isTTY === true),
        color: resolveColor(globals, env, config, context.isTty ?? process.stderr.isTTY === true),
        streams,
      })

      const home = context.home ?? homedir()
      const cwd = context.cwd ?? process.cwd()

      if (flags.dir) {
        renderer.result({ skill: SKILL_NAME, installed: [installSkill(resolve(cwd, flags.dir), "custom")] })
        return
      }

      const named = AGENTS.filter((agent) => flags[agent] === true)
      const agents = named.length > 0 ? named : flags.project ? ["claude" as const, "codex" as const] : detect(home)

      if (agents.length === 0) {
        throw new BrazeError(
          "configuration_error",
          "found no agent to install into — name one with --claude, --codex or --hermes, " +
            "or give a directory with --dir",
        )
      }

      const root = flags.project ? cwd : home
      const installed = agents.map((agent) =>
        installSkill(join(root, flags.project ? TARGETS[agent].project : TARGETS[agent].home), agent),
      )

      renderer.result({ skill: SKILL_NAME, installed })
    })

  return command
}

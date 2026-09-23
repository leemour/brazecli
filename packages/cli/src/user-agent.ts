import { VERSION } from "./version.js"

/**
 * What Braze sees in `user-agent`. One helper rather than a string at each call site: two copies
 * are how a runtime is reported correctly in one place and wrongly in the other (`CORE-11`).
 *
 * **`node` is the fallback, not the first check.** Bun reports a `process.versions.node` of its
 * own — measured at 24.3.0 under bun 1.3.14 — so testing for node first would label every bun run
 * as node, and `pnpm smoke:bun` makes bun a runtime this repository supports.
 */
export const userAgent = (versions: NodeJS.ProcessVersions = process.versions, platform = process.platform): string =>
  `brazecli/${VERSION} runtime/${runtime(versions)} platform/${platform}`

/**
 * The runtime's name and **not its version**: a patch number is a fact about the machine, and
 * `api.test.ts` pins that this header discloses none.
 */
const runtime = (versions: NodeJS.ProcessVersions): string => {
  if (versions.bun) return "bun"
  if (versions.deno) return "deno"
  return "node"
}

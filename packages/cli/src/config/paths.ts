import { join } from "node:path"
import { type Paths as CorePaths, resolvePaths as corePaths } from "@leemour/cli-core"

export interface Paths extends CorePaths {
  /** One directory per invocation that touches Braze. */
  runs: string
}

/**
 * cli-core's directories under braze's name and `BRAZE_*` overrides, plus `runs`: `BRAZE_RUNS_DIR`
 * is in the brief so a run's artifacts can be collected somewhere else.
 */
export const resolvePaths = (env: NodeJS.ProcessEnv = process.env): Paths => {
  const paths = corePaths({ appName: "brazecli", prefix: "BRAZE", env })
  return { ...paths, runs: env.BRAZE_RUNS_DIR ?? join(paths.state, "runs") }
}

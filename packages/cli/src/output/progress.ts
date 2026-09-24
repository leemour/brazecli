import type { Streams } from "@leemour/cli-core"

export interface Progress {
  /** Called per record. Cheap by design: a 750 000-record run calls it 750 000 times. */
  advance(records: number, batches: number): void
  /** Leaves the line clean, so the summary does not print underneath half a progress bar. */
  clear(): void
}

const EVERY_MS = 250

export interface ProgressOptions {
  streams: Streams
  /**
   * Off unless stderr is a terminal and the output is for a person.
   *
   * **Rule 3 is why this is a flag and not a heuristic per call site.** In a machine mode stdout
   * carries one JSON value and nothing else; progress is on stderr and so cannot break that, but a
   * pipe collecting stderr into a log would fill it with carriage returns nobody can read.
   */
  enabled: boolean
  now?: () => number
}

export const createProgress = ({ streams, enabled, now = () => Date.now() }: ProgressOptions): Progress => {
  if (!enabled || !streams.progress) {
    return { advance: () => {}, clear: () => {} }
  }

  const write = streams.progress
  const started = now()
  let lastAt = 0
  let width = 0

  return {
    advance: (records, batches) => {
      const at = now()
      if (at - lastAt < EVERY_MS) return
      lastAt = at

      const seconds = (at - started) / 1000
      const rate = seconds > 0 ? Math.round(records / seconds) : 0
      const line = `${records.toLocaleString("en-US")} records · ${batches.toLocaleString("en-US")} batches · ${rate.toLocaleString("en-US")}/sec`

      width = Math.max(width, line.length)
      write(line)
    },
    clear: () => {
      if (width > 0) write("")
    },
  }
}

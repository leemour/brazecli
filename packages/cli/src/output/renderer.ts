import type { OutputFormat } from "../config/file.js"
import { renderPretty } from "./pretty.js"
import { visibleControls } from "./sanitize.js"
import { processStreams, type Streams } from "./stream.js"

export interface Renderer {
  /** The one thing a caller asked for. In a machine mode this is the whole of stdout. */
  result(value: unknown): void
  /** Each item on its own line. Only meaningful in `jsonl`; elsewhere it renders the whole list. */
  stream(items: Iterable<unknown>): void
  note(message: string): void
  success(message: string): void
  warn(message: string): void
  failure(message: string): void
}

export interface RendererOptions {
  format: OutputFormat
  color: boolean
  streams?: Streams
}

/**
 * **Every diagnostic goes to stderr, in every mode — pretty included.**
 *
 * The brief only requires that of the machine modes, but making it unconditional means §44 holds
 * by construction instead of by a mode check somebody can forget. It also means piping human
 * output still gives you the content and not the commentary.
 */
export const createRenderer = ({ format, color, streams = processStreams }: RendererOptions): Renderer => {
  // Sanitised in every mode, not just `pretty`: a diagnostic goes to stderr, and stderr is read
  // by a person whatever stdout was asked to be. The message is usually Braze's own words.
  const mark = (symbol: string, message: string) =>
    format === "pretty" ? `${symbol} ${visibleControls(message)}` : visibleControls(message)

  const diagnostics = {
    note: (message: string) => streams.diagnostic(mark("·", message)),
    success: (message: string) => streams.diagnostic(mark("✓", message)),
    warn: (message: string) => streams.diagnostic(mark("!", message)),
    failure: (message: string) => streams.diagnostic(mark("✗", message)),
  }

  if (format === "jsonl") {
    return {
      ...diagnostics,
      result: (value) => streams.data(JSON.stringify(value)),
      stream: (items) => {
        for (const item of items) streams.data(JSON.stringify(item))
      },
    }
  }

  if (format === "pretty") {
    return {
      ...diagnostics,
      result: (value) => streams.data(renderPretty(value, { color })),
      stream: (items) => streams.data(renderPretty([...items], { color })),
    }
  }

  // json — exactly one deterministic value, and nothing else, ever.
  return {
    ...diagnostics,
    result: (value) => streams.data(JSON.stringify(value)),
    stream: (items) => streams.data(JSON.stringify([...items])),
  }
}

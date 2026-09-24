#!/usr/bin/env node
import { run } from "../program.js"
import { installSignalHandlers } from "../runs/signals.js"
import { updateNotice } from "../update.js"

// Here and not in `run()`: the tests call that hundreds of times, and a listener per call
// accumulates until Node warns about a leak.
installSignalHandlers()

// `braze commands --json | head` closes the pipe while we are still writing, and an unhandled
// EPIPE makes Node print a stack trace over the output of the very command that worked. A reader
// that stopped reading is not an error: leave quietly, the way every other Unix tool does.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0)
    throw error
  })
}

const argv = process.argv.slice(2)
// Here and not in `run()`, so no test ever reaches npm.
const notice = updateNotice(argv)
process.exitCode = await run(argv)
const line = await notice
if (line && process.exitCode === 0) process.stderr.write(`${line}\n`)

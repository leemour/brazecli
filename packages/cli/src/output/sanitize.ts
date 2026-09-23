/**
 * Text that came from Braze or from a customer's input file, made safe to display.
 *
 * A campaign name, a catalog title and a user attribute are all edited somewhere we do not
 * control and handed back to us as data. A terminal executes what it is given: `\x1b[2K\x1b[1G`
 * clears the line and returns the cursor, so a campaign name can overwrite output this tool
 * already printed. Braze's own error messages reach a terminal the same way (`SEC-2`).
 *
 * **Machine modes need none of this** — `JSON.stringify` already escapes control characters, and
 * those bytes are a contract with scripts. Only what a person reads goes through here.
 */

/**
 * Control characters become visible rather than disappearing. A reader has to know the value
 * contained something strange; an audit that silently drops bytes is worse than one that shows
 * them.
 *
 * `\t` and `\n` survive, because a table and a multi-line field are built out of them.
 */
/** C0 minus tab and newline, DEL, and C1 — which xterm honours as escapes in its 8-bit form. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the whole point
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g

export const visibleControls = (text: string): string =>
  text.replace(CONTROL, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`)

/**
 * A spreadsheet cell that Excel and LibreOffice will not execute.
 *
 * Quoting is a CSV concern and not a formula defence: `"=HYPERLINK(""http://evil"",""x"")"` is a
 * well-formed CSV cell and both programs still run it. A leading apostrophe is what marks a cell
 * as literal text.
 *
 * Applied to free text only, never to an identifier — a prefixed `external_id` no longer joins
 * back to the input file, which is the only reason that column exists.
 */
export const formulaSafe = (text: string): string => (/^[=+\-@\t\r]/.test(text) ? `'${text}` : text)

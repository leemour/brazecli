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

# Bulk: sending a file of records

```sh
braze staging users track --records users.jsonl --records-field attributes \
  --record-id external_id --confirm
```

One file in, one batched run out, one audit row per record. The file may hold ten records or ten
million: memory does not grow with it.

## The flags

| | |
|---|---|
| `--records <source>` | the file, or `-` for standard input |
| `--records-format <jsonl\|csv>` | only needed when the name does not say (`.jsonl`, `.ndjson`, `.csv`) |
| `--records-field <name>` | which of the operation's batch fields these records are — `attributes`, `events`, `purchases` |
| `--record-id <key>` | the key in each record holding *your* id for it, for the audit |
| `--concurrency <n>` | requests in flight, 1–32, default 4 |
| `--dry-run` | parse, validate and count; send nothing |
| `--confirm` | required, like any other write |

Standard input always needs the format naming it: `cat users.jsonl | braze staging users track
--records - --records-format jsonl --records-field attributes --confirm`.

## What the input looks like

**JSONL** — one JSON object per line, each one exactly what would go inside the batch field:

```json
{"external_id":"u1","plan":"pro"}
{"external_id":"u2","plan":"free"}
```

**CSV** — a header row, one record per line. **Every cell arrives as a string**, because a CSV cell
has no type and guessing one would silently change what you send.

⚠ **Braze still applies its own types on arrival.** An attribute sent as the string `"2026-09-15"`
reads back as `"2026-09-15T00:00:00.000Z"` — measured against a live workspace. We do not guess a
type, but not guessing does not mean the value survives untyped: a date-shaped column becomes a
date in Braze whatever we send, and a number-shaped one stays a string. Send the type you want in
JSONL where it matters.

## What comes back

```
420,000 records · 5,600 batches · 4 concurrent · 12m 03s · 581 records/sec

  submitted       419,204   sent in a batch Braze accepted
  failed              612   Braze refused them
  invalid             184   refused here, before sending — see records.csv for why
  unknown               0   may have been applied; nobody can say

  5,600 HTTP requests · 3 retries · records.csv has a row for every one of the 420,000
```

**`submitted` does not mean "it worked", and that is deliberate.** Braze acknowledges a request, not
the users inside it, so the strongest honest word for a record in an accepted batch is *submitted*.
There is no `success` status anywhere in this tool.

| Status | What it means |
|---|---|
| `submitted` | went out in a batch Braze accepted |
| `failed` | Braze named this record as refused — including inside an otherwise successful response |
| `invalid` | refused here, before anything was sent |
| `unknown` | the request left and the answer never arrived; it may or may not have been applied |
| `skipped` | never sent, because the run was interrupted |
| `planned` | `--dry-run`: what would have been sent |

Braze names the objects it refuses inside a `201`, by position within the named array. Its own
documentation does not mention this; it was measured against a live workspace and is kept as a test
fixture. Where an entry cannot be placed against a specific record, those records become `unknown`
rather than `failed` — an audit that guesses is worse than one that admits it does not know.

## The audit

Every run writes `records.csv` beside its log, with a row per record, **as work completes** rather
than at the end: a run killed at record 1 800 000 still has 1 800 000 rows.

```
row_number, record_id, record_id_source, batch_id, operation,
external_id, braze_id, user_alias_name, user_alias_label,
started_at, completed_at, status, http_status, attempts, duration_ms,
error_code, error_message, note
```

`record_id` is never blank: your own id where the record carried one (`record_id_source: input`),
otherwise one generated from the run id and the row number (`generated`), which still points at the
exact line of the exact file.

**The audit holds identifiers and nothing else.** No custom attribute, no arbitrary column from
your input. It is deliberately poorer than the file it describes, because a column added there is
customer data kept forever.

⚠ **Rows are not in the order of your input file.** A record refused here is written the moment it
is read; a record sent to Braze is written when Braze answers, and several requests are in flight
at once — so the refused rows of a batch appear above its submitted ones. Writing in input order
would mean holding finished rows back until the ones before them completed, and that buffer is the
size of your file in the worst case, which is the thing the memory bound exists to prevent. Look a
record up by `record_id` or `row_number`; do not read the file as a sequence.

```sh
dir=$(braze runs path <run-id>)
awk -F, '$12=="failed"' "$dir/records.csv" | head
```

Free text in the audit — `error_message` and `note` — is marked as literal text where a spreadsheet
would otherwise execute it, and control characters are shown as `\x1b` in every column. Identifier
columns are left exactly as they arrived, so they still join back to your file.
[`security.md`](security.md) has the detail.

## Interrupting a run

Ctrl+C stops the run, finishes the audit and exits `130`. Records that were never sent are
`skipped`, never `failed` — Braze never saw them. The batches already in flight are reported for
what they are.

## Memory, and why concurrency is the only knob

At most `concurrency × 2` batches exist at once — queued, running, and finished but not yet
written — so at most `concurrency × 2 × batch size` records are resident. The batch size comes from
the operation: 75 for `users track`. At the defaults that is 600 records, and a million-record run
was measured peaking at 599.

Raising `--concurrency` raises throughput and memory together, and Braze's rate limits will
usually bind first. `--concurrency 1` makes the run strictly sequential, which is what you want
while proving out a new file.

## Before the real run

```sh
braze staging users track --records users.jsonl --records-field attributes --dry-run
```

A dry run parses and validates every record, counts the batches, writes the audit with everything
`planned`, and sends nothing. It works on a read-only profile, which makes it the safe way to
check a production file.

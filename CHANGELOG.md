# Changelog

Notable changes to `@leemour/brazecli`.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the versions
follow [semantic versioning](https://semver.org/spec/v2.0.0.html) — with `0.x` meaning the command
surface may still move between minor versions.

## Unreleased

### Fixed

- **A mistyped command line is now a `validation_error`, exit 2, and JSON in a machine mode.** An
  unknown option, a missing required option or a bad choice used to print a line of text and exit
  1 — the code for "we have no idea what happened" — even under `--json`.
- The "a newer version is out" line no longer follows `braze <profile> update`, where it named the
  version just installed, and no longer follows a command that failed.

## 0.3.0 — 2026-09-24

### Added

- **Tab now completes braze's commands, options and your profile names.** `braze complete
  zsh|bash|fish|powershell` prints the script to source. It reads only the local `config.json` and
  never reaches Braze.
- **`braze update`** updates braze with whichever of npm, pnpm or bun installed it; `--check` only
  looks. It never runs by itself. Once a day, on a terminal, braze says in one line when a newer
  version exists. JSON modes, CI, `BRAZE_NO_UPDATE_CHECK` and `"updateCheck": false` keep it quiet.
- **`braze commands --json`** says for each command whether it is `generated` from Braze's
  collection or `handwritten`, and marks every generated command that writes to Braze with
  `mutates: true`. `braze api` carries no mark: whether it writes depends on the method you give it.

### Changed

- **`credentials.json` stores each key as `secret` instead of `apiKey`.** An existing file gains
  `secret` beside `apiKey` the first time braze reads it, keeping its `0600` permissions and every
  other entry, so an older braze using the same directory still finds its keys. The file is only
  used on machines without a working keyring.
- The warning when the keyring is unavailable now names the file the key goes to.
- The output, config and keyring code now comes from
  [`@leemour/cli-core`](https://www.npmjs.com/package/@leemour/cli-core). Exit codes, JSON
  output, keyring entries and file locations are unchanged.

### Fixed

- **A run no longer crashes when its directory is deleted while it runs.** The log file used to
  throw an unhandled `ENOENT`; now braze warns once and carries on without the log.
- `BRAZE_API_KEY` is redacted by name in the run log, as a second line of defence.

## 0.2.0 — 2026-09-23

### Security

- **Text from Braze can no longer rewrite your terminal.** A campaign name, a catalog title or an
  error message is edited outside this tool and handed back as data, and a terminal executes what
  it is given — a name containing `\x1b[2K\x1b[1G` cleared the line and overwrote output this tool
  had already printed. Control characters are now shown as `\x1b` wherever a person reads them:
  tables, field lists, diagnostics on stderr and every column of `records.csv`. They are made
  **visible, not removed**, so you can see the value carried something strange.
- **`records.csv` no longer hands a spreadsheet a formula.** Excel and LibreOffice execute a cell
  beginning `=`, `+`, `-` or `@` even when the CSV quotes it, and `error_message` carries Braze's
  own words. Free text now gets a leading apostrophe. Identifier columns deliberately do not — a
  prefixed `external_id` no longer joins back to your input file. [`docs/security.md`](docs/security.md)
  names that remaining risk.
- **`--json` and `--jsonl` are byte-for-byte unchanged.** `JSON.stringify` already escapes these
  characters, and those bytes are the contract scripts parse.

### Added

- `braze runs cleanup --older-than <days>`, with `--dry-run` and `--confirm`. Nothing expires on a
  timer and there is no retention setting to set and forget; every removal is asked for. A run
  directory whose `run.json` cannot be read is never removed.
- [`docs/development.md`](docs/development.md) — working on brazecli itself: every gate and what it
  catches, the generated files that are never edited by hand, and how a change gets made.

### Fixed

- A broken `config.json`, and `credentialStorage: "keyring"` on a machine whose keyring does not
  work, exited `1` as `generic_failure`. Both now exit `3` as `configuration_error`, which is what
  [`docs/agents.md`](docs/agents.md) has always published.
- The `user-agent` header said `runtime/node` under bun. It now names the runtime it is actually
  on, and still discloses no version of it.

## 0.1.1 — 2026-09-18

Both of these surfaced the first time the package was installed from the registry rather than
run out of its own build directory.

### Fixed

- `braze profile add`, `profile list` and `profile remove` printed raw JSON to a terminal and
  ignored `--output pretty`. They now render a table like every other command. The JSON that
  `--json` and a pipe produce is unchanged.

### Removed

- `defaultProfile` in the config file. Nothing had read it since profiles stopped having a
  default: a command without a profile named still fails, and asks for one. It was printed by
  `profile list`, where it read as a statement that some workspace was the default. A config
  that still carries the field is fine — it is ignored, and dropped the next time the file is
  written.

## 0.1.0 — 2026-09-17

The first published version. Everything below already existed; this is the release that makes it
installable.

### Added

- `braze` — profiles, `braze api`, 95 typed commands generated from Braze's collection,
  `braze schema`, `braze commands`, `braze runs`.
- Bulk runs: `--records` streams a JSONL or CSV file, batches it to Braze's limits under a bounded
  memory ceiling, and writes one audit row per record.
- `braze skill install` — writes the agent skill into Claude Code, Codex or Hermes.
- Every run leaves `run.json`, `events.jsonl` and, for a bulk run, `records.csv`.
- Published as `@leemour/brazecli`: npm refused the unscoped `brazecli` as too similar to an
  unrelated `braze-cli`. The command is `braze` either way.
- One package to install. The Braze client is kept free of Node APIs inside the repository and is
  bundled into the published command at build time.

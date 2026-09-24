# Installation

The npm package is **`@leemour/brazecli`**. The command it puts on your PATH is **`braze`**.

## Requirements

- **Node 22 or newer.** Check with `node --version`. Node 20 will install and then fail on syntax
  it does not know.
- Nothing else. The one native dependency — the OS keyring — ships as a prebuilt binary for macOS
  (arm64 and x64), Linux (x64, arm64, musl) and Windows, so no compiler is needed.

## Without installing anything

Good for trying it, and for a CI job that runs it once:

```sh
npx @leemour/brazecli --help
pnpm dlx @leemour/brazecli --help
bunx @leemour/brazecli --help
```

`npx @leemour/brazecli` runs the `braze` command inside the package. Everything after the
package name is passed to it: `npx @leemour/brazecli staging campaigns list --json`.

## On your PATH

```sh
npm install -g @leemour/brazecli
pnpm add -g @leemour/brazecli
bun add -g @leemour/brazecli
```

Then `braze --version`. If the shell cannot find it, the package manager's global bin directory is
not on your PATH — `npm prefix -g` and `pnpm bin -g` print where it went.

## As a project dependency

Pins the version for everyone working on a repository, and keeps it out of the global namespace:

```sh
pnpm add -D @leemour/brazecli
pnpm exec braze --help
```

In `package.json`:

```json
{
  "scripts": {
    "braze": "braze"
  },
  "devDependencies": {
    "@leemour/brazecli": "^0.1.0"
  }
}
```

## Updating

```sh
braze update            # with whichever of npm, pnpm or bun installed it
braze update --check    # only say whether a newer version exists
```

`braze update` never runs by itself. Once a day, on a terminal, `braze` asks npm whether a newer
version exists and says so in one line on stderr. It stays silent in JSON and JSONL modes, in CI,
and when `NO_UPDATE_NOTIFIER` or `BRAZE_NO_UPDATE_CHECK` is set; `"updateCheck": false` in
`config.json` turns it off for good. By hand, the same thing is:

```sh
npm install -g @leemour/brazecli@latest
pnpm add -g @leemour/brazecli@latest
```

`braze --version` prints what is installed. The version also travels to Braze in the `User-Agent`
of every request and into every run's `run.json`, so a support conversation can name it exactly.

## Shell completion

Tab completes commands, options and your profile names in zsh, bash, fish and PowerShell:

```sh
echo 'source <(braze complete zsh)' >> ~/.zshrc
echo 'source <(braze complete bash)' >> ~/.bashrc
braze complete fish > ~/.config/fish/completions/braze.fish
```

A Tab reads the local `config.json` for profile names and nothing else. It never reaches Braze.

## From a clone

For working on brazecli itself, or for running an unreleased commit:

```sh
git clone https://github.com/leemour/brazecli.git
cd brazecli
pnpm install
pnpm build
node packages/cli/dist/bin/braze.js --help
```

`pnpm build` marks the entry point executable, so it can also be symlinked onto your PATH:

```sh
ln -sfn "$PWD/packages/cli/dist/bin/braze.js" "${PNPM_HOME:-$HOME/.local/share/pnpm}/bin/braze"
```

The link points into the checkout, so `pnpm build` updates the command in place — and moving or
deleting the checkout breaks it. `pnpm link --global` is not the way: pnpm 11 removed it.

## Windows

The keyring binary exists for Windows and the paths are resolved per platform, but nobody has run
this there. If you do, [an issue](https://github.com/leemour/brazecli/issues) saying what happened
is welcome, working or not.

## What it writes on your machine

| | macOS | Linux |
|---|---|---|
| profiles | `~/Library/Preferences/brazecli/config.json` | `~/.config/brazecli/config.json` |
| run artifacts | `~/Library/Application Support/brazecli/runs/` | `~/.local/share/brazecli/runs/` |
| the last update check | `~/Library/Application Support/brazecli/update-check.json` | `~/.local/share/brazecli/update-check.json` |
| the API key | Keychain | Secret Service (GNOME Keyring, KWallet) |

`braze --help` prints the resolved paths for the machine it is running on. Both directories can be
moved with `BRAZE_CONFIG_DIR` and `BRAZE_RUNS_DIR` — see
[configuration.md](configuration.md).

Nothing is installed outside those directories, and uninstalling the package leaves them behind;
remove them by hand if you want them gone.

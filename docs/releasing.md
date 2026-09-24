# Releasing

Releases are published **from GitHub Actions** ([`release.yml`](../.github/workflows/release.yml))
through npm's [trusted publishing](https://docs.npmjs.com/trusted-publishers/): no npm token is
stored in GitHub, and npm attaches provenance. The tag and the GitHub release come afterwards, so
they record what actually reached npm.

npm trusts the workflow **by file name**: the package's Trusted Publisher settings on npmjs.com name
`leemour` / `brazecli` / `release.yml`. Rename the file and publishing stops until they are updated.

⚠ **Corrected 2026-09-24:** this page said releases are published from a maintainer's machine, not
from CI (`NEED-49`, now overturned). That path remains as `./scripts/release.sh --local`.

The package is `@leemour/brazecli`. There is only one; `packages/core` is private and is bundled
into the command at build time.

## Once, per machine — only for `--local`

Publishing needs an npm **granular access token with "Bypass two-factor authentication"** —
[npmjs.com → Access Tokens → Generate New Token](https://www.npmjs.com/settings/leemour/tokens),
*Read and write*, restricted to `@leemour/brazecli`. npm will not accept an interactive one-time
code through pnpm.

Keep it in the OS keyring rather than on disk:

```sh
secret-tool store --label="npm publish token" service npm account leemour
printf '%s\n' '//registry.npmjs.org/:_authToken=${NPM_TOKEN}' >> ~/.npmrc
```

`~/.npmrc` then holds a reference, not a secret. [pnpm expands `${VAR}` in the user-level
file](https://pnpm.io/npmrc) and deliberately not in a project's `.npmrc`.

## The release

**1. Bump the version and write the changelog.** One place is authoritative:

```sh
# edit "version" in packages/cli/package.json
pnpm version:sync            # copies it into core, version.ts and the skill's frontmatter
```

Then add a `## <version> — <date>` section to [`../CHANGELOG.md`](../CHANGELOG.md), written for
somebody who will not read the commits. **The first bullet's bold lead-in becomes the release
title**, so write it as a whole clause — `- **Text from Braze can no longer rewrite your
terminal.** …`.

A new command or flag is a **minor** bump even at `0.x`; only fixes are a patch.

**2. Open a pull request and let CI agree with you**, then merge it. Release from `main`.

**3. Run one script:**

```sh
./scripts/release.sh --dry-run    # everything except the publish, the tag and the release
./scripts/release.sh              # publish from GitHub Actions
./scripts/release.sh --local      # publish from this machine with the keyring token
```

It refuses unless you are on `main`, the tree is clean, `main` matches `origin/main`, the version
is not already on npm and the changelog has a section for it. Then the workflow runs all nine
gates, packs with pnpm, publishes with npm, and only once npm shows the version tags the commit and
writes the GitHub release — so the tag records what shipped rather than what was meant to. Back on
this machine the script **proves the result from the registry in an empty directory**.

With `--local` the same happens here, and the npm token is read from the keyring into the
environment of the publish command alone. It is never printed, never written to a file, and never
part of a URL an error could echo back.

`RELEASE_SUMMARY="…"` overrides the derived title with `--local` only; from CI the first bullet's
bold lead-in is the title, and a changelog without one stops the release before it tags.

## Things that bite

- **A version can never be republished.** npm refuses a second upload of the same number, so a
  mistake costs a new patch version, not a correction.
- **`pnpm` packs, `npm` only publishes the tarball.** `npm pack` leaves `workspace:*` in the
  manifest and produces a tarball that installs for nobody; pnpm rewrites it (`FIND-33`). But pnpm
  cannot use npm's trusted publishing, so the workflow runs `pnpm pack`, then
  `npm publish <tarball>`.
- **The unscoped name is not available.** npm refuses `brazecli` as too similar to an unrelated
  `braze-cli` (`NEED-48`). Scoped names are exempt from that check.
- **`pnpm typecheck` writes into `dist`.** It emits declarations only for exactly this reason; it
  once overwrote the bundled entry point and the tarball shipped a binary that could not start
  (`BUG-16`).

## Why from CI

`NEED-49` in [`DECISIONS.md`](DECISIONS.md): it was ruled out while it needed a long-lived npm
token in the repository, and overturned once trusted publishing removed the token.

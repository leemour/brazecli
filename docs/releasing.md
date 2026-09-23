# Releasing

Releases are published **from a maintainer's machine**, not from CI (`NEED-49`). The tag and the
GitHub release come afterwards, so they record what actually reached npm.

The package is `@leemour/brazecli`. There is only one; `packages/core` is private and is bundled
into the command at build time.

## Once, per machine

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

**1. Bump the version.** One place is authoritative:

```sh
# edit "version" in packages/cli/package.json
pnpm version:sync            # copies it into core, version.ts and the skill's frontmatter
```

**2. Write the changelog entry** in [`../CHANGELOG.md`](../CHANGELOG.md) — what changed, for
somebody who will not read the commits.

**3. Run everything.** All nine, in this order; `build` must come before `test`, because the tests
run the built binary:

```sh
pnpm install && pnpm lint && pnpm typecheck && pnpm build && pnpm test
pnpm portability:core && pnpm smoke:bun && pnpm catalog:check && pnpm docs:check && pnpm version:check
```

**4. Open a pull request and let CI agree with you**, then merge it. Release from `main`.

**5. Check what will ship, then publish:**

```sh
pnpm --filter @leemour/brazecli publish --dry-run --no-git-checks    # the file list
NPM_TOKEN="$(secret-tool lookup service npm account leemour)" \
  pnpm --filter @leemour/brazecli publish --access public
```

`pnpm publish` runs `prepack`, which rebuilds — so what ships is built from the tree being
published, never from whatever was left in `dist`.

**6. Prove it from the registry**, from a directory with no `node_modules`:

```sh
npm view @leemour/brazecli version
npx --yes @leemour/brazecli --version
npx --yes @leemour/brazecli commands --json | head -c 200
```

**7. Tag what you published, and write the release.** Set the two values once, so nothing has to
be retyped consistently into four places:

```sh
V=$(node -p 'require("./packages/cli/package.json").version')
SUMMARY="profile commands print a table again"

git tag -a "v$V" -m "v$V — $SUMMARY"
git push origin "v$V"
gh release create "v$V" --title "v$V — $SUMMARY" \
  --notes-file <(awk "/^## $V /{f=1;next} /^## /{f=0} f" CHANGELOG.md)
```

The tag goes on the commit that was published, on `main`, after the publish succeeded — so it
records a fact rather than an intention.

## Things that bite

- **A version can never be republished.** npm refuses a second upload of the same number, so a
  mistake costs a new patch version, not a correction.
- **`pnpm`, never `npm`.** `npm pack` leaves `workspace:*` in the manifest and produces a tarball
  that installs for nobody. pnpm rewrites it (`FIND-33`).
- **The unscoped name is not available.** npm refuses `brazecli` as too similar to an unrelated
  `braze-cli` (`NEED-48`). Scoped names are exempt from that check.
- **`pnpm typecheck` writes into `dist`.** It emits declarations only for exactly this reason; it
  once overwrote the bundled entry point and the tarball shipped a binary that could not start
  (`BUG-16`).

## Why not from CI

`NEED-49` in [`DECISIONS.md`](DECISIONS.md). If it ever changes — several maintainers, or releases
often enough that consistency beats the token — the work is `OPS-6` in [`BACKLOG.md`](BACKLOG.md).

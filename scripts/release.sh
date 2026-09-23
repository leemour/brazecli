#!/usr/bin/env bash
# Publishes the version in packages/cli/package.json to npm, then tags it and writes the GitHub
# release — in that order, so the tag records what reached the registry rather than an intention
# (NEED-49, docs/releasing.md).
#
#   ./scripts/release.sh            # check, publish, verify, tag, release
#   ./scripts/release.sh --dry-run  # everything except the publish, the tag and the release
#
# A script rather than a line of commands: the publish needs the npm token, and a token pasted
# into a terminal can be broken by a line wrap into something that prints it. Here it is read from
# the keyring straight into the environment of one command and never touches the screen.
set -euo pipefail

cd -- "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

dry_run=false
[ "${1:-}" = "--dry-run" ] && dry_run=true

die() { printf '\n✗ %s\n' "$1" >&2; exit 1; }
step() { printf '\n── %s\n' "$1"; }

version=$(node -p 'require("./packages/cli/package.json").version')
tag="v$version"

step "releasing $version"

[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || die "not on main — release from main (docs/releasing.md)"
[ -z "$(git status --porcelain)" ] || die "the working tree is dirty; commit or stash first"

git fetch --quiet origin
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "main and origin/main differ — push or pull first"

# npm refuses a second upload of the same number, so finding this out here costs nothing and
# finding it out after the build costs a patch version.
if npm view "@leemour/brazecli@$version" version >/dev/null 2>&1; then
  die "$version is already on npm — a version can never be republished. Bump and try again."
fi
git rev-parse -q --verify "refs/tags/$tag" >/dev/null && die "tag $tag already exists locally"

grep -q "^## $version " CHANGELOG.md || die "CHANGELOG.md has no '## $version' heading"

step "the gates, all nine"
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm portability:core
pnpm smoke:bun
pnpm catalog:check
pnpm docs:check
pnpm version:check

step "what will ship"
pnpm --filter @leemour/brazecli publish --dry-run --no-git-checks

if [ "$dry_run" = true ]; then
  printf '\n✓ dry run: %s is ready. Run without --dry-run to publish.\n' "$version"
  exit 0
fi

step "publishing to npm"
# The token is resolved in-process and handed to one command. It is never printed, never written
# to a file, and never becomes part of a URL that an error message could echo back.
if ! token=$(secret-tool lookup service npm account leemour 2>/dev/null) || [ -z "$token" ]; then
  die "no npm token in the keyring — see 'Once, per machine' in docs/releasing.md"
fi
NPM_TOKEN="$token" pnpm --filter @leemour/brazecli publish --access public
unset token

step "proving it from the registry"
# In a temporary directory, so node_modules in this repository cannot make a broken package look
# like a working one.
proof=$(mktemp -d)
trap 'rm -rf "$proof"' EXIT
(
  cd "$proof"
  published=$(npm view "@leemour/brazecli@$version" version)
  [ "$published" = "$version" ] || { printf '✗ npm reports %s\n' "$published" >&2; exit 1; }
  installed=$(npx --yes "@leemour/brazecli@$version" --version)
  [ "$installed" = "$version" ] || { printf '✗ the installed command reports %s\n' "$installed" >&2; exit 1; }
  npx --yes "@leemour/brazecli@$version" commands --json >/dev/null
)
printf '✓ %s installs from the registry and runs\n' "$version"

step "tagging and writing the release"
# The bold lead-in of the first bullet, which is written as a whole clause. Taking the bullet's
# prose instead gives a sentence cut off at the line wrap.
summary=${RELEASE_SUMMARY:-$(awk "/^## $version /{f=1;next} /^## /{f=0} f" CHANGELOG.md |
  grep -m1 -oP '^- \*\*\K[^*]+' | sed 's/[.:]$//')}
[ -n "$summary" ] || die "no bold lead-in on the first bullet under '## $version' — set RELEASE_SUMMARY instead"
notes=$(mktemp)
trap 'rm -rf "$proof" "$notes"' EXIT
awk "/^## $version /{f=1;next} /^## /{f=0} f" CHANGELOG.md > "$notes"

git tag -a "$tag" -m "$tag — $summary"
git push origin "$tag"
gh release create "$tag" --title "$tag — $summary" --notes-file "$notes"

printf '\n✓ %s published, tagged and released: https://www.npmjs.com/package/@leemour/brazecli\n' "$version"

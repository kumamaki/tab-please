#!/usr/bin/env bash
# Cut a tagged GitHub release for tab-please.
#
# What it does:
#   1. Validates preconditions (on main, clean tree, in sync with origin/main).
#   2. Resolves the target version — an explicit X.Y.Z, or a major|minor|patch
#      bump of package.json's current "version".
#   3. Validates it (semver-shaped, tag not already taken, strictly newer than
#      the latest existing tag).
#   4. Bumps package.json "version" (a no-op if it already matches — e.g. the
#      first release at the version package.json already declares).
#   5. Shows the plan (package.json diff + commits since the last tag).
#   6. After a y/N confirm (or with --push), commits the bump, pushes main,
#      creates an annotated tag, and pushes it. The tag push triggers
#      .github/workflows/release.yml, which cuts the GitHub Release.
#
# Usage (wired as `pnpm ship <arg>` in package.json):
#   pnpm ship patch            # 0.1.0 -> 0.1.1, prompt before mutating
#   pnpm ship minor            # 0.1.0 -> 0.2.0
#   pnpm ship 0.1.0            # release an explicit version (e.g. the first tag)
#   pnpm ship patch --push     # skip the prompt (non-interactive)
#   pnpm ship patch --dry-run  # print the plan, commit nothing
#   pnpm ship patch --watch    # after pushing, gh run watch the release workflow
#
# Flags:
#   --push       commit + tag + push without prompting (default: prompt)
#   --dry-run    print the plan and leave the bump unstaged; commit nothing
#   --watch      after pushing, `gh run watch` the release workflow
#   --remote N   git remote (default: origin)

set -euo pipefail

ARG=""
DO_PUSH=0
DO_DRYRUN=0
DO_WATCH=0
REMOTE="origin"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)    DO_PUSH=1; shift ;;
    --dry-run) DO_DRYRUN=1; shift ;;
    --watch)   DO_WATCH=1; shift ;;
    --remote)  REMOTE="${2:?--remote requires a name}"; shift 2 ;;
    -h|--help) grep '^#' "$0" | grep -v '^#!' | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)        echo "release.sh: unknown flag: $1" >&2; exit 2 ;;
    *)         [[ -z "$ARG" ]] || { echo "release.sh: unexpected arg: $1" >&2; exit 2; }
               ARG="$1"; shift ;;
  esac
done

if [[ -z "$ARG" ]]; then
  echo "usage: pnpm ship <major|minor|patch|X.Y.Z> [--push|--dry-run] [--watch]" >&2
  exit 2
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

PKG="package.json"
[[ -f "$PKG" ]] || { echo "release.sh: no $PKG at repo root" >&2; exit 1; }

# package.json's "version" is the source of truth for bump kinds.
CURRENT="$(grep -E '^[[:space:]]*"version":[[:space:]]*"[0-9]' "$PKG" \
  | head -1 | sed -E 's/.*"version":[[:space:]]*"([^"]+)".*/\1/')"
if [[ -z "$CURRENT" ]]; then
  echo "release.sh: couldn't read \"version\" from $PKG" >&2
  exit 1
fi

# Resolve the target version from the arg.
case "$ARG" in
  major|minor|patch)
    IFS=. read -r cmaj cmin cpat <<< "$CURRENT"
    if ! [[ "$cmaj" =~ ^[0-9]+$ && "$cmin" =~ ^[0-9]+$ && "$cpat" =~ ^[0-9]+$ ]]; then
      echo "release.sh: current version '$CURRENT' isn't X.Y.Z — can't bump '$ARG'" >&2
      exit 1
    fi
    case "$ARG" in
      major) cmaj=$((cmaj + 1)); cmin=0; cpat=0 ;;
      minor) cmin=$((cmin + 1)); cpat=0 ;;
      patch) cpat=$((cpat + 1)) ;;
    esac
    VERSION="${cmaj}.${cmin}.${cpat}"
    ;;
  *)
    VERSION="$ARG"
    ;;
esac

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "release.sh: '$VERSION' is not X.Y.Z-shaped (pre-release tags aren't supported)" >&2
  exit 2
fi
TAG="v$VERSION"

# --- Preconditions --------------------------------------------------------

HEAD_BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || echo "")"
if [[ "$HEAD_BRANCH" != "main" ]]; then
  echo "release.sh: must be on 'main' (currently on '$HEAD_BRANCH')" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "release.sh: working tree is dirty — commit or stash first" >&2
  git status --short >&2
  exit 1
fi

git fetch "$REMOTE" main --quiet

REMOTE_HEAD="$(git rev-parse "$REMOTE/main" 2>/dev/null || echo "")"
if [[ -z "$REMOTE_HEAD" ]]; then
  echo "release.sh: '$REMOTE/main' not found — is the remote configured?" >&2
  exit 1
fi

LOCAL_HEAD="$(git rev-parse HEAD)"
if [[ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]]; then
  BEHIND="$(git rev-list --count HEAD.."$REMOTE/main")"
  if [[ "$BEHIND" -gt 0 ]]; then
    echo "release.sh: local main is behind $REMOTE/main by $BEHIND commit(s) — pull first" >&2
    exit 1
  fi
  AHEAD="$(git rev-list --count "$REMOTE/main"..HEAD)"
  if [[ "$DO_DRYRUN" -eq 1 ]]; then
    echo "release.sh: local main is $AHEAD commit(s) ahead of $REMOTE/main — the real run pushes it first (dry-run mutates nothing)"
  else
    echo "release.sh: local main is $AHEAD commit(s) ahead of $REMOTE/main — pushing first..."
    git push "$REMOTE" main
  fi
fi

if git rev-parse "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "release.sh: tag '$TAG' already exists locally" >&2
  exit 1
fi
if git ls-remote --tags --exit-code "$REMOTE" "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "release.sh: tag '$TAG' already exists on $REMOTE" >&2
  exit 1
fi

# Strict monotonic check against the highest existing vX.Y.Z tag. `--list` takes
# a glob (not a regex), so it can't exclude pre-release suffixes — filter with
# grep to keep only strict vX.Y.Z.
LAST_TAG="$(git tag --list 'v[0-9]*.[0-9]*.[0-9]*' --merged "$REMOTE/main" --sort=-version:refname \
  | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 || true)"
if [[ -n "$LAST_TAG" ]]; then
  PREV="${LAST_TAG#v}"
  HIGHER="$(printf '%s\n%s\n' "$PREV" "$VERSION" | sort -V | tail -1)"
  if [[ "$HIGHER" != "$VERSION" || "$PREV" == "$VERSION" ]]; then
    echo "release.sh: '$VERSION' is not strictly newer than last tag '$LAST_TAG'" >&2
    exit 1
  fi
fi

# --- Bump package.json (no-op if already at the target version) -----------

if [[ "$CURRENT" != "$VERSION" ]]; then
  if ! grep -qE '^[[:space:]]*"version":[[:space:]]*"[0-9][^"]*",?[[:space:]]*$' "$PKG"; then
    echo "release.sh: couldn't find a \"version\": \"X.Y.Z\" line to bump in $PKG" >&2
    exit 1
  fi
  awk -v v="$VERSION" '
    /^[[:space:]]*"version":[[:space:]]*"[0-9][^"]*",?[[:space:]]*$/ && !done {
      print "  \"version\": \"" v "\","
      done = 1
      next
    }
    { print }
  ' "$PKG" > "$PKG.tmp"
  mv "$PKG.tmp" "$PKG"
fi

# --- Plan -----------------------------------------------------------------

TAG_MSG_FILE="$(mktemp)"
trap 'rm -f "$TAG_MSG_FILE"' EXIT
{
  echo "tab-please $VERSION"
  echo
  if [[ -n "$LAST_TAG" ]]; then
    echo "Changes since $LAST_TAG:"
    git --no-pager log --pretty='- %s' "$LAST_TAG"..HEAD
    [[ "$CURRENT" != "$VERSION" ]] && echo "- chore: release v$VERSION"
  else
    echo "Initial release."
  fi
} > "$TAG_MSG_FILE"

echo "Release plan"
echo "  version : $CURRENT -> $VERSION"
echo "  tag     : $TAG"
echo "  remote  : $REMOTE"
echo "  prev tag: ${LAST_TAG:-<none>}"
echo
if [[ "$CURRENT" != "$VERSION" ]]; then
  echo "package.json bump:"
  git --no-pager diff -- "$PKG"
  echo
fi
echo "Tag annotation:"
sed 's/^/  /' "$TAG_MSG_FILE"
echo

if [[ "$DO_DRYRUN" -eq 1 ]]; then
  echo "Dry-run only. Any bump is unstaged in your working tree — 'git checkout -- $PKG' to undo."
  exit 0
fi

if [[ "$DO_PUSH" -ne 1 ]]; then
  read -r -p "Commit bump, push main, tag $TAG, push tag? [y/N] " reply </dev/tty
  case "$reply" in
    y | Y | yes | YES) ;;
    *) echo "release.sh: aborted (bump left in working tree)" >&2; exit 1 ;;
  esac
fi

# --- Execute --------------------------------------------------------------

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Committing version bump..."
  git add "$PKG"
  git commit -m "chore: release v$VERSION"
  echo "Pushing to $REMOTE/main..."
  git push "$REMOTE" main
fi

TAG_TARGET="$(git rev-parse HEAD)"
echo "Creating annotated tag $TAG at $TAG_TARGET..."
git tag -a "$TAG" -F "$TAG_MSG_FILE" "$TAG_TARGET"
echo "Pushing $TAG to $REMOTE..."
git push "$REMOTE" "$TAG"

# Derive owner/repo from the remote URL for the Actions link (handles the
# `alias:owner/repo.git` SSH-config form as well as git@/https URLs).
ORIGIN_URL="$(git remote get-url "$REMOTE")"
SLUG="$(printf '%s' "$ORIGIN_URL" | sed -E 's#(.*[:/])([^/]+/[^/]+)$#\2#; s#\.git$##')"

echo
echo "Tag pushed. The release workflow should now be running:"
echo "  https://github.com/$SLUG/actions/workflows/release.yml"
echo

if [[ "$DO_WATCH" -eq 1 ]]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "release.sh: --watch requires the 'gh' CLI" >&2
    exit 0
  fi
  RUN_ID=""
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    RUN_ID="$(gh run list --workflow release.yml --limit 5 --json databaseId,headBranch \
      --jq "map(select(.headBranch == \"$TAG\")) | .[0].databaseId // empty" 2>/dev/null || true)"
    [[ -n "$RUN_ID" ]] && break
    sleep 2
  done
  if [[ -n "$RUN_ID" ]]; then
    gh run watch "$RUN_ID" --exit-status
  else
    echo "release.sh: couldn't locate the workflow run for $TAG after 20s; check the Actions tab." >&2
  fi
fi

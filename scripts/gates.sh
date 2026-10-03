#!/usr/bin/env bash
# scripts/gates.sh — rules a linter can't enforce: the version agrees everywhere,
# CHANGELOG.md heads with it, and each release stays short and plain.
# Every limit is overridable, to test a check's failure path without editing this:
#   CHANGELOG_MAX=2 npm run gates   # should fail
set -u
cd "$(dirname "$0")/.."
status=0
fail() { printf '✗ %s\n  %s\n' "$1" "$2"; status=1; }
pass() { printf '✓ %s\n' "$1"; }

CHANGELOG="${CHANGELOG:-CHANGELOG.md}"
CHANGELOG_MAX="${CHANGELOG_MAX:-6}"

# ── Version agrees everywhere ────────────────────────────────────────────────
# package.json is the source of truth (vite.config.ts bakes it into the UI as
# __APP_VERSION__); npm keeps two copies in the lockfile.
pkg_version=$(node -p 'require("./package.json").version' 2>/dev/null)
lock_version=$(node -p 'require("./package-lock.json").version' 2>/dev/null)
lock_root_version=$(node -p 'require("./package-lock.json").packages[""].version' 2>/dev/null)

if [ -z "$pkg_version" ]; then
	fail "could not read the version" "package.json='$pkg_version'"
elif [ "$lock_version" != "$pkg_version" ] || [ "$lock_root_version" != "$pkg_version" ]; then
	fail "versions disagree" \
		"package.json=$pkg_version lockfile=${lock_version:-n/a} lockfile packages[\"\"]=${lock_root_version:-n/a} — run 'npm install --package-lock-only', never edit the lockfile by hand"
else
	pass "version $pkg_version everywhere"
fi

# ── The changelog heads with the version being shipped ───────────────────────
# Heading shape: version, a dash, an ISO date.
top=$(sed -n 's/^## \([0-9]*\.[0-9]*\.[0-9]*\) .* \([0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}\)[[:space:]]*$/\1/p' "$CHANGELOG" | head -n 1)
heading="## $pkg_version — $(date -u +%Y-%m-%d)"
if [ "$top" != "$pkg_version" ]; then
	# Say which fix it is: a patch renames its minor's heading, a minor adds one.
	if [ "${top%.*}" = "${pkg_version%.*}" ]; then
		todo="rewrite '## $top' as '$heading' and add this patch's lines under it"
	else
		todo="start a section headed '$heading' above it"
	fi
	fail "$CHANGELOG does not open with $pkg_version" "top heading is '${top:-none}' — $todo"
else
	pass "$CHANGELOG opens with $pkg_version"
fi

# ── Each release is short ────────────────────────────────────────────────────
# Non-blank lines between headings; wrapping is the writer's business.
long=$(awk -v max="$CHANGELOG_MAX" '
	/^## / { if (name != "" && len > max) printf "%s — %d lines\n", name, len; name = $0; len = 0; next }
	name != "" && $0 != "" { len++ }
	END { if (name != "" && len > max) printf "%s — %d lines\n", name, len }
' "$CHANGELOG")
if [ -n "$long" ]; then
	fail "a release is over $CHANGELOG_MAX lines" "$long — cut it to what a user needs, or raise CHANGELOG_MAX on purpose"
else
	pass "every release is $CHANGELOG_MAX lines or fewer"
fi

# ── Release bullets are plain text ───────────────────────────────────────────
# No bold, links or headings inside a bullet. The preamble is excluded.
markup=$(awk '
	/^## [0-9]/ { r = 1; next }  /^## / { r = 0; next }
	r && /^- / && (/\*\*/ || /\[[^]]*\]\(/ || /^- #/) { printf "%d: %s\n", NR, $0 }
' "$CHANGELOG")
if [ -n "$markup" ]; then
	fail "markup in a release bullet" "$markup — plain text and \`code\` spans only"
else
	pass "release bullets are plain text and code spans"
fi

exit "$status"

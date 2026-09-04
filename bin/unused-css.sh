#!/usr/bin/env bash
# List class selectors in a stylesheet that no TypeScript or PHP file
# beside it (or under `src/`, for the runtime sheet) mentions.
#
# The markup of an app or a shell surface is built in templates and
# PHP, never in static HTML, so the HTML-driven CSS pruners (PurgeCSS,
# UnCSS) have nothing to look at. This is the honest first pass
# instead: every `.class` in the sheet is grepped, as a literal, over
# the sources that could emit it; a class assembled from a namespace
# prefix (`${ NS }__rail`) is matched on its `__suffix` too. A hit
# proves nothing (a longer class name contains a shorter one); a MISS
# is a rule to look at.
#
#   bin/unused-css.sh                       # every app sheet + the runtime sheet
#   bin/unused-css.sh apps/posts/posts.css  # one sheet
#
# Exit code is the number of sheets with a miss, so it can gate.
set -u
cd "$(dirname "$0")/.."

if [ "$#" -gt 0 ]; then
	sheets=("$@")
else
	sheets=(apps/*/*.css assets/css/app-runtime.css)
fi

misses=0
for css in "${sheets[@]}"; do
	[ -f "$css" ] || continue
	case "$css" in
		apps/*) scope="$(dirname "$css")" ;;
		*)      scope="apps src" ;;
	esac
	found=0
	while read -r cls; do
		# shellcheck disable=SC2086 # $scope is a list of paths on purpose.
		if grep -rqF -- "$cls" $scope --include='*.ts' --include='*.php' 2>/dev/null; then
			continue
		fi
		suffix="${cls#*__}"
		# shellcheck disable=SC2086
		if [ "$suffix" != "$cls" ] && grep -rqF -- "__$suffix" $scope --include='*.ts' --include='*.php' 2>/dev/null; then
			continue
		fi
		if [ "$found" -eq 0 ]; then
			echo "== $css"
			found=1
		fi
		echo "  no usage: .$cls"
	done < <(grep -oE '\.[a-zA-Z_][a-zA-Z0-9_-]+' "$css" | sort -u | sed 's/^\.//')
	misses=$((misses + found))
done

if [ "$misses" -eq 0 ]; then
	echo "unused-css: every class selector has a usage."
fi
exit "$misses"

# Releasing `desktop-mode`

Maintainer guide. Users install by downloading `/releases/latest/download/desktop-mode.zip`.

## Cutting a release

```bash
./bin/release.sh 0.5.0
```

Refreshes translation files (`npm run i18n`), drafts a `= X.Y.Z =` changelog block into `readme.txt` from GitHub's auto-generated release notes, then stops at **a single interactive gate**: it shows the block and requires an explicit `y` to continue — on every path, including `--skip-changelog` and resumed runs, and with a loud warning if the block is missing. Editing `readme.txt` while the prompt waits is supported: the bump commit picks up the file as saved, and the script re-prints the block if it changed. Answering `n` stops the release with nothing committed; fix the block and re-run — leftovers are tolerated, the draft merge is idempotent, and your edits survive, so the re-run lands straight back at the gate. If `readme.txt` already has a `= X.Y.Z =` block (hand-written, or committed by a feature PR), the draft still runs: existing entries are kept, only drafted bullets not already present verbatim are appended, and the appended ones are listed — watch for semantic duplicates. After confirmation it bumps all four version locations, commits, pushes to trunk, **waits for CI green**, tags, pushes the tag. Aborts cleanly if you're not on trunk, local trunk is out of sync with origin, CI fails, or the working tree has changes beyond the script-owned files (`languages/` and `readme.txt` leftovers from an aborted attempt are fine; they're re-reviewed and swept into the bump commit). Resumable — re-running after a mid-flow failure picks up where it left off.

Flags:

- `--skip-i18n` — skip the translation-file refresh. Use for hotfix releases where you don't want `.pot`/`.po`/`.json` churn in the bump commit.
- `--skip-changelog` — skip drafting the `readme.txt` changelog block. Use when you've already hand-written it, or for hotfixes with nothing notable to log. The interactive changelog confirmation still runs; only the drafting step is skipped.
- `--dry-run-changelog` — print the changelog draft that would be inserted into `readme.txt`, then exit without modifying any files or pushing.

The tag push fires [`.github/workflows/release.yml`](../.github/workflows/release.yml), which builds and publishes a GitHub Release with `desktop-mode.zip` attached.

Requires the `gh` CLI authenticated (`gh auth status`).

## Pre-releases

Hyphenated versions publish as GitHub pre-releases, so `/releases/latest` keeps pointing at the last stable. The workflow detects the hyphen and sets `--prerelease` automatically:

```bash
./bin/release.sh 0.5.0-rc1
```

## What each tool does

| Tool | Purpose |
|---|---|
| `bin/bump-version.sh <version>` | Syncs `package.json`, `package-lock.json`, plugin header, `DESKTOP_MODE_VERSION`, `readme.txt` `Stable tag:`. |
| `bin/package.sh` | Packages `desktop-mode.zip` from HEAD + current built JS. Derives the expected bundle list from `vite.config.js` TARGETS and ships each target's `<fileBase>.min.js` **only** — the unminified dev bundles (~4–5 MB) stay out of the zip; `desktop_mode_asset_suffix()` falls back to `.min` on installs where they're absent, so a `SCRIPT_DEBUG` site degrades gracefully. Errors if any expected `.min.js` is missing under `assets/js/`, or if a stale gitignored `.js` not produced by any vite target is left behind there. |
| `bin/release.sh <version>` | Full end-to-end release. |
| `release.yml` — `push: tags: v*` | Build + publish the GitHub Release. |

## Version locations

Four places, kept in sync by `bin/bump-version.sh`:

- `package.json` → `"version"` (and `package-lock.json` via `npm version`)
- `desktop-mode.php` → plugin header `Version:`
- `desktop-mode.php` → `DESKTOP_MODE_VERSION` constant
- `readme.txt` → `Stable tag:` (wp.org rejects submissions when this drifts from the plugin header `Version:`)

The `release` job re-reads all four at tag time and fails with a clear error if any doesn't match the tag. This catches "forgot to bump one".

## Versioning scheme

Semver: `vMAJOR.MINOR.PATCH`.

- **PATCH** — bug fixes, no API changes.
- **MINOR** — new hooks / JS API / features. Backwards-compatible.
- **MAJOR** — breaking changes to documented PHP hooks, JS API, or the chromeless bridge protocol. Bump with care; plugins extend this shell.

Tags carry the `v` prefix (`v0.5.0`); `package.json` and the plugin header store the bare number.

## Manual packaging

For local testing without publishing:

```bash
npm run package   # packages desktop-mode.zip at the repo root (run npm run build first)
```

The zip has the exact contents the workflow uploads.

## Packaging extensions

Sibling plugins under `extensions/` (e.g. `desktop-mode-cron-manager`,
`desktop-mode-phpmyadmin`) are packaged separately with:

```bash
./bin/package-extensions.sh             # writes to dist/
./bin/package-extensions.sh /tmp/out    # writes to a custom dir
./bin/package-extensions.sh /tmp/out desktop-mode-popup-siege
                                        # packages one named extension
```

Each extension produces one `<slug>.zip` under `dist/` (gitignored).
The script iterates every directory under `extensions/` that has a
matching `<slug>.php` plugin file. For each, it:

1. Runs any `bin/fetch-*.sh` scripts the extension ships with — these
   are idempotent vendor fetchers (e.g. `desktop-mode-phpmyadmin`'s
   `bin/fetch-phpmyadmin.sh` pulls a SHA-256-pinned phpMyAdmin 5.2.3
   zip into `assets/vendor/phpmyadmin/`, the directory is gitignored).
2. Stages tracked + untracked-but-not-gitignored files via
   `git ls-files -co --exclude-standard`, so packaging works on
   uncommitted work too. If an extension ships a `.distignore`, matching
   repository-only files are left out of the release artifact.
3. Splices any `assets/vendor/*` working-tree content back in (vendors
   are gitignored by convention so end users still get a zip that
   activates without a setup step).
4. Round-trips through `tar` + `zip` so file modes land at 0644 / 0755
   — same trick `bin/package.sh` uses for the main plugin.

Extensions are versioned independently from the parent plugin; bump
the version in the extension's plugin header before re-packaging.

## Troubleshooting

**`Version mismatch — tag 'X' vs package.json=Y header=Y DESKTOP_MODE_VERSION=Y readme.txt Stable tag=Y`**
You pushed a tag without bumping first, or bumped but didn't push the bump commit before tagging. Fix locally, delete the broken tag (`git push --delete origin vX.Y.Z`), re-tag from the correct commit, push again.

**`bin/release.sh` aborts with "working tree is dirty"**
Commit or stash your in-progress work first. The script refuses to bundle unrelated changes into the bump commit.

**Workflow succeeded but `desktop.min.js` is missing from the zip**
Shouldn't happen — `bin/package.sh` errors out if the build artifacts aren't present, and the release job runs `npm run build` before it. If you see this, the build probably produced zero-byte files; check the `Build` step log.

**Release created but with no notes / empty notes**
`--generate-notes` pulls from merged PRs since the last tag. If there are none (first release, or only direct pushes to `trunk`), the notes will be sparse. Edit the Release in the GitHub UI after the fact.

## First-time setup checks

Before cutting the first release, confirm:

- Repo Settings → Actions → General → Workflow permissions is set to **Read and write permissions** (needed for `gh release create`).
- The `v*` tag pattern isn't blocked by a tag protection rule.
- CI is passing on `trunk` (the script enforces this before tagging).

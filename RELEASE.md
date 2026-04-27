# Releasing `desktop-mode`

Maintainer guide. Users install by downloading `/releases/latest/download/desktop-mode.zip`.

## Cutting a release

```bash
./bin/release.sh 0.5.0
```

Bumps all three version locations, commits, pushes to trunk, **waits for CI green**, tags, pushes the tag. Aborts cleanly if the tree is dirty, you're not on trunk, local trunk is out of sync with origin, or CI fails. Resumable — re-running after a mid-flow failure picks up where it left off.

The tag push fires [`.github/workflows/release.yml`](.github/workflows/release.yml), which builds and publishes a GitHub Release with `desktop-mode.zip` attached.

Requires the `gh` CLI authenticated (`gh auth status`).

## Pre-releases

Hyphenated versions publish as GitHub pre-releases, so `/releases/latest` keeps pointing at the last stable. The workflow detects the hyphen and sets `--prerelease` automatically:

```bash
./bin/release.sh 0.5.0-rc1
```

## What each tool does

| Tool | Purpose |
|---|---|
| `bin/bump-version.sh <version>` | Syncs `package.json`, `package-lock.json`, plugin header, `DESKTOP_MODE_VERSION`. |
| `bin/package.sh` | Packages `desktop-mode.zip` from HEAD + current built JS. Errors if the build is stale. |
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
npm run package   # builds + writes desktop-mode.zip at the repo root
```

The zip has the exact contents the workflow uploads.

## Troubleshooting

**`Version mismatch — tag 'X' vs package.json=Y header=Y DESKTOP_MODE_VERSION=Y`**
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

# Desktop Mode Beta

A small companion plugin for testing unreleased builds of [Desktop Mode](https://github.com/WordPress/desktop-mode) on a live site. Pick any open pull request, the trunk branch, or the latest stable release, and the companion downloads that build's zip from the repository's GitHub releases and installs it over the `desktop-mode` plugin in place — the same overwrite WordPress performs on any plugin update.

Modeled on [Jetpack Beta](https://github.com/Automattic/jetpack/tree/trunk/projects/plugins/beta), including the key structural decision: **the switcher is a separate plugin, never distributed on WordPress.org.** That keeps install-from-GitHub machinery out of the wp.org-reviewed plugin entirely, and it means a broken branch build of Desktop Mode can never take down the tool you need to switch back to stable.

## Where the builds come from

The companion invents no build pipeline — it consumes artifacts CI already publishes to the rolling `ci-artifacts` release of the repository:

| Channel | Artifact | Produced by |
|---|---|---|
| Pull request | `pr-<number>-<head-sha>.zip` | `pr-preview-build.yml` + `pr-preview-publish.yml` (the WP Playground preview flow) |
| Trunk | `trunk.zip` + `trunk.json` (`{ sha, version, built_at }`) | `trunk-build.yml`, on every push to trunk |
| Stable | `desktop-mode.zip` on the latest `v*` GitHub release | `release.yml` |

Discovery uses the public GitHub API for the open-PR list and the latest release (cached in transients; unauthenticated is plenty — define `DESKTOP_MODE_BETA_GITHUB_TOKEN` only if you somehow hit the rate limit). Whether a PR's build is actually finished is checked with redirect-only HEAD probes against the public download URLs, which cost no API quota at all.

## Surfaces

- **Tools → Desktop Mode Beta** — a plain wp-admin page, deliberately free of any Desktop Mode dependency. This is the recovery surface: it works even when the installed build breaks the desktop shell.
- **OS Settings → Beta** — the same picker inside the Desktop Mode shell, registered through the public `desktop_mode_register_settings_tab()` API and rendered with `<wpd-*>` components. (Also a nice dogfood of the third-party settings-tab surface.)

Viewing requires `update_plugins`; switching builds requires `install_plugins`.

## Behavior notes

- The client never sends a download URL — it sends `{ source, id }` and the server resolves the URL from GitHub data it fetched itself, so only assets of the configured repository are installable.
- What's installed is recorded in the `desktop_mode_beta_current` option. While a PR/trunk build is active, WordPress **auto**-updates for Desktop Mode are suppressed (an overnight wp.org update would silently replace the build under test) and a warning shows on the Plugins screen. Manual updates stay possible — they're a visible, deliberate act.
- When the tracked PR gets new commits, the UI offers a one-click "Update to latest build". When the PR closes, it tells you to go back to stable.
- "Back to stable" installs the latest GitHub release zip and clears the record; from then on the install is a normal wp.org-updatable Desktop Mode.

## Install

Grab `desktop-mode-beta.zip` from any [release](https://github.com/WordPress/desktop-mode/releases) (attached alongside `desktop-mode.zip`), or build it from a checkout:

```bash
npm run package:beta
```

Then upload it via Plugins → Add New → Upload, and activate. Requires Desktop Mode to be installed (`Requires Plugins: desktop-mode`).

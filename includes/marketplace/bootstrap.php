<?php
/**
 * Desktop Mode — Extensions marketplace: bootstrap.
 *
 * Loads the marketplace subsystem. Each module registers its own
 * hooks at file scope, so requiring them is enough — no init function
 * to call.
 *
 * Architecture
 * ------------
 *
 *  1. The CI release pipeline runs `bin/package-extensions.sh` to
 *     build one zip per extension under `extensions/`, plus
 *     `extensions.resolved.json` (a manifest produced by
 *     `bin/build-manifest.sh`). All are uploaded as GitHub Release
 *     assets.
 *
 *  2. This subsystem fetches the resolved manifest on demand from
 *     the configured URL (default: the `latest` release alias on the
 *     public repo) and caches it in a 15-minute site transient.
 *
 *  3. The merged catalog (manifest + installed-plugin state) is
 *     surfaced via REST under `wp-desktop/v1/marketplace/*` and
 *     consumed by the Extensions tab in the OS Settings UI
 *     (`src/settings/sections/extensions/`).
 *
 *  4. Updates are injected into WP's native
 *     `site_transient_update_plugins`, so an extension with a newer
 *     manifest version shows up in Dashboard → Updates and the
 *     Plugins screen as a normal "update available" row.
 *
 * Local-dev escape hatch
 * ----------------------
 *
 * When `WP_DEBUG` is on AND the running plugin folder either contains
 * `extensions.json` + `extensions/` (auto-detect) OR
 * `WP_DESKTOP_LOCAL_MARKETPLACE_DIR` is set, the marketplace
 * synthesizes the manifest from the local checkout and zips each
 * extension folder via `ZipArchive` for install / update — skipping
 * any release roundtrip and any shell-tool dependency. See
 * `desktop_mode_marketplace_local_checkout()` in `manifest.php` for
 * the resolution rules.
 *
 * @since 0.6.0
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/manifest.php';
require_once __DIR__ . '/installer.php';
require_once __DIR__ . '/rest.php';
require_once __DIR__ . '/updates.php';

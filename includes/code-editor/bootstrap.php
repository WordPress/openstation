<?php
/**
 * Desktop Mode — Code Editor app.
 *
 * Embeds a Monaco-based editor as a built-in app: registered as a native
 * desktop window (`wpdc-editor`), pinned to the bottom taskbar, with a
 * matching wallpaper icon. Phase 1a ships the embed only — file tree,
 * save flow, and PHP IntelliSense land in later phases.
 *
 * Hard constraint: PHP-only on the server. Monaco runs entirely in the
 * browser; everything the editor needs from the server (file I/O,
 * symbol indexing) goes through WordPress REST routes.
 *
 * Skips registration entirely on `DISALLOW_FILE_EDIT` sites or when the
 * current user lacks `edit_plugins` — fail-closed, no UI footprint.
 *
 * @package WPDesktopMode
 * @since 0.18.0
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/window.php';
require_once __DIR__ . '/filesystem.php';
require_once __DIR__ . '/rest.php';

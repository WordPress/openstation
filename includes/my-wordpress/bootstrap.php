<?php
/**
 * Desktop Mode — "My WordPress" module bootstrap.
 *
 * Pinned virtual folder on the desktop wallpaper that opens a native
 * file-explorer window for browsing WordPress entities (Phase 1:
 * Posts and Pages). Future phases add Comments, Users, Tags,
 * Categories, Themes, and Plugins as additional sub-folders.
 *
 * @package WPDesktopMode
 * @since   0.8.0
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/assets.php';
require_once __DIR__ . '/window.php';
require_once __DIR__ . '/lock.php';
require_once __DIR__ . '/user-stats.php';
require_once __DIR__ . '/term-stats.php';

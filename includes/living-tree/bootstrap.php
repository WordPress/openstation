<?php
/**
 * Desktop Mode — Living Tree wallpaper module bootstrap.
 *
 * The `wp-living-tree` canvas wallpaper renders the site as a living
 * plant organism whose shape is the visual fingerprint of the site's
 * life. WordPress emits only *hormones* (age, vigour, health, diversity,
 * bloom…); the growth simulator in the JS bundle decides all geometry.
 * See `docs/living-tree-algorithm.md` for the full algorithm.
 *
 * This module owns the server side: the REST snapshot endpoint that
 * carries the compact site DNA, the metric helpers behind it, the
 * wallpaper registration, and the bundle asset handle.
 *
 * @package WPDesktopMode
 * @since   0.9.4
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/snapshot.php';
require_once __DIR__ . '/assets.php';
require_once __DIR__ . '/wallpaper.php';

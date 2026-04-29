<?php
/**
 * Desktop Mode - Cron Manager module bootstrap.
 *
 * Exposes a native desktop window for inspecting and managing WP-Cron
 * events. The UI lives in a lazy-loaded TypeScript bundle; PHP owns
 * event enumeration, scheduling, unscheduling, and custom interval
 * registration.
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/store.php';
require_once __DIR__ . '/rest.php';
require_once __DIR__ . '/window.php';

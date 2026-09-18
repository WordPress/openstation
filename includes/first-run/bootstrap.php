<?php
/**
 * OpenStation — first-run module bootstrap.
 *
 * The install / first-enable stamps: the facts that answer "did this
 * install ever get turned on, and how fast?". The deactivation
 * feedback payload (`includes/feedback/`) reads them.
 *
 * Loaded unconditionally, not inside the admin-only block: the stamps
 * are written from the AJAX toggle, the portal and the activation
 * hook, none of which is a wp-admin page render.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/stamps.php';

<?php
/**
 * OpenStation — first-run module bootstrap.
 *
 * Everything that turns an install into an activated install: the
 * install / first-enable stamps, the "Turn on" plugin row action, the
 * activation nudge on Dashboard and Plugins, and the server-side gate
 * of the first-boot shell tour.
 *
 * Loaded unconditionally, not inside the admin-only block: the stamps
 * are written from the AJAX toggle, the portal and the activation
 * hook, none of which is a wp-admin page render. The nudge's
 * `admin_notices` hook only fires in wp-admin and is harmless
 * elsewhere.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/stamps.php';
require_once __DIR__ . '/shell-tour.php';
require_once __DIR__ . '/plugin-row.php';
require_once __DIR__ . '/nudge.php';

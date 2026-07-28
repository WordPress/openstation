<?php
/**
 * Desktop Mode — Pinned notes bootstrap.
 *
 * Wires the pinned-notes feature: the `wpd_note` CPT, the REST
 * controller, and the Heartbeat delta sync. The Note Pad widget that
 * creates notes registers separately in
 * `includes/widgets/widget-notes.php`.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/cpt.php';
require_once __DIR__ . '/rest.php';
require_once __DIR__ . '/heartbeat.php';
require_once __DIR__ . '/recycle-bin.php';

<?php
/**
 * OpenStation — Code Blue module bootstrap.
 *
 * Native window with id `openstation-code-blue` plus a desktop
 * shortcut icon. The window is an error-log reader for site health
 * hunting: it tails the logs a WordPress install (or its host) can
 * produce — the WP debug log, the PHP error log, and any log file a
 * plugin registers via the `openstation_code_blue_log_sources`
 * filter — parses them into structured entries, and renders them as
 * a severity histogram, headline stat tiles, and a grouped issue
 * list with expandable stack traces.
 *
 * All heavy lifting is lazy: the bundle script loads the first time
 * the window opens, and the log files are only read when the REST
 * routes are hit.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/assets.php';
require_once __DIR__ . '/log-reader.php';
require_once __DIR__ . '/rest.php';
require_once __DIR__ . '/window.php';

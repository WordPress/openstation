<?php
/**
 * OpenStation — Station Home module bootstrap.
 *
 * Replaces the classic WordPress Dashboard entry point inside the shell with
 * a native, role-aware home surface. The original Dashboard remains available
 * from Station Home as a separate iframe window.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/assets.php';
require_once __DIR__ . '/rest.php';
require_once __DIR__ . '/window.php';

<?php
/**
 * OpenStation — Shared workspaces.
 *
 * A workspace saved from the main desk can be shared with a link. The
 * link duplicates it into the account of whoever opens it — once, and
 * with no dialog — and pins it there as their main and only desk until
 * an admin releases them. See docs/workspaces.md, "Sharing a workspace".
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/store.php';
require_once __DIR__ . '/pin.php';
require_once __DIR__ . '/link.php';
require_once __DIR__ . '/restrictions.php';
require_once __DIR__ . '/fence.php';
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/notes.php';

<?php
/**
 * Desktop Mode — Content Graph module bootstrap.
 *
 * Native window with id `desktop-mode-content-graph` plus a desktop
 * shortcut icon. The window renders a PixiJS-driven force-directed
 * graph of posts and pages (and any opt-in public CPT) wired together
 * by the internal hyperlinks the editors authored. Clicking a node
 * opens a side panel with the node's author, contributors, comments,
 * categories, attached media, and revisions; clicking another post in
 * that panel re-centres the graph; clicking author/category/media
 * deep-links to the matching native window.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/assets.php';
require_once __DIR__ . '/graph-builder.php';
require_once __DIR__ . '/rest.php';
require_once __DIR__ . '/window.php';

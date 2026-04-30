<?php
/**
 * Desktop Mode — Recycle Bin module bootstrap.
 *
 * The bin captures attachments into the WordPress trash (posts and
 * pages already trash by default) and exposes a desktop window with
 * a `<wpd-table>`-backed UI for browsing, sorting, restoring, and
 * permanently deleting them.
 *
 * Public PHP surface (all filterable, all action-emitting):
 *
 *   - `wp_desktop_recycle_bin_capture_post_types`
 *   - `wp_desktop_recycle_bin_should_capture`
 *   - `wp_desktop_recycle_bin_query_args`
 *   - `wp_desktop_recycle_bin_items` / `wp_desktop_recycle_bin_item`
 *   - `wp_desktop_recycle_bin_user_can_view|restore|purge|use`
 *   - `wp_desktop_recycle_bin_window_args` / `..._icon_args`
 *   - `wp_desktop_recycle_bin_template_html`
 *   - actions: `..._item_captured`, `..._before/after_restore`,
 *              `..._before/after_purge`, `..._emptied`
 *
 * @package WPDesktopMode
 * @since   0.19.0
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/capture.php';
require_once __DIR__ . '/store.php';
require_once __DIR__ . '/rest.php';
require_once __DIR__ . '/window.php';
require_once __DIR__ . '/realtime.php';

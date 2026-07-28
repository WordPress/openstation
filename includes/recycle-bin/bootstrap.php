<?php
/**
 * Desktop Mode — Recycle Bin module bootstrap.
 *
 * The bin stamps who-deleted-what-when metadata on posts, pages,
 * attachments, and comments as they pass through the WordPress trash
 * (attachments only reach trash when `MEDIA_TRASH` is enabled) and
 * exposes a desktop window with a `<wpd-table>`-backed UI for
 * browsing, sorting, restoring, and permanently deleting them.
 *
 * Public PHP surface (all filterable, all action-emitting):
 *
 *   - `desktop_mode_recycle_bin_capture_post_types`
 *   - `desktop_mode_recycle_bin_query_args`
 *   - `desktop_mode_recycle_bin_items` / `desktop_mode_recycle_bin_item`
 *   - `desktop_mode_recycle_bin_user_can_view|restore|purge|use`
 *   - `desktop_mode_recycle_bin_window_args` / `..._icon_args`
 *   - `desktop_mode_recycle_bin_template_html`
 *   - actions: `..._item_captured`, `..._before/after_restore`,
 *              `..._before/after_purge`, `..._emptied`
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/capture.php';
require_once __DIR__ . '/store.php';
require_once __DIR__ . '/rest.php';
require_once __DIR__ . '/window.php';
require_once __DIR__ . '/realtime.php';

<?php
/**
 * Desktop Mode — Native Posts Window module bootstrap.
 *
 * Replaces the chromeless `edit.php` iframe with a native desktop window
 * driven by `<wpd-table>` and core's `/wp/v2/posts` REST endpoint, behind
 * a per-user opt-in (`OsSettingsState.nativePostsEnabled`, surfaced as
 * the "Use the native Posts window" toggle in OS Settings → Features).
 *
 * Public PHP surface (all filterable):
 *
 *   - desktop_mode_posts_window_user_can_register
 *   - desktop_mode_posts_window_user_can_use
 *   - desktop_mode_posts_window_args
 *   - desktop_mode_posts_window_template_html
 *   - desktop_mode_posts_window_query_args
 *
 * The URL-remap swap (Posts tile → native window when opt-in is on) is
 * implemented JS-side in `src/desktop.ts` via `registerNativeUrlRemap`
 * — this module owns only the window itself, not the entry point.
 *
 * @package WPDesktopMode
 * @since   0.8.0
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/permissions.php';
require_once __DIR__ . '/window.php';

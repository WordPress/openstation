<?php
/**
 * Desktop Mode — Native Pages Window module bootstrap.
 *
 * Replaces the chromeless `edit.php?post_type=page` iframe with a native
 * desktop window driven by `<wpd-table>` and core's `/wp/v2/pages` REST
 * endpoint, behind a per-user opt-in (`OsSettingsState.nativePagesEnabled`,
 * surfaced as the "Use the native Pages window" toggle in OS Settings →
 * Features).
 *
 * Public PHP surface (all filterable):
 *
 *   - desktop_mode_pages_window_user_can_use
 *   - desktop_mode_pages_window_args
 *   - desktop_mode_pages_window_template_html
 *   - desktop_mode_pages_window_query_args
 *
 * The URL-remap swap (Pages tile → native window when opt-in is on) is
 * implemented JS-side in `src/desktop.ts` via `registerNativeUrlRemap`.
 *
 * @package WPDesktopMode
 * @since   0.18.0
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/permissions.php';
require_once __DIR__ . '/window.php';

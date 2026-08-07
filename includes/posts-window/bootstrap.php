<?php
/**
 * OpenStation — Native Posts Window module bootstrap.
 *
 * Replaces the chromeless `edit.php` iframe with a native desktop window
 * driven by `<os-table>` and core's `/wp/v2/posts` REST endpoint, behind
 * a per-user opt-in (`OsSettingsState.nativePostsEnabled`, surfaced as
 * the "Use the native Posts window" toggle in OS Settings → Features).
 *
 * Public PHP surface (all filterable):
 *
 *   - openstation_posts_window_user_can_register
 *   - openstation_posts_window_user_can_use
 *   - openstation_posts_window_args
 *   - openstation_posts_window_template_html
 *   - openstation_posts_window_query_args
 *
 * The URL-remap swap (Posts tile → native window when opt-in is on) is
 * implemented JS-side in `src/desktop.ts` via `registerNativeUrlRemap`
 * — this module owns only the window itself, not the entry point.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/permissions.php';
require_once __DIR__ . '/window.php';

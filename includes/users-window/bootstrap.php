<?php
/**
 * OpenStation — Native Users Window module bootstrap.
 *
 * Replaces the classic `users.php` iframe with a native desktop
 * window driven by `<os-table>` and core's `/wp/v2/users` REST
 * endpoint, behind a per-user opt-in (`OsSettingsState.nativeUsersEnabled`,
 * surfaced as the "Use the native Users window" toggle in OS Settings →
 * Features).
 *
 * Public PHP surface (all filterable):
 *
 *   - open_station_users_window_user_can_register
 *   - open_station_users_window_user_can_use
 *   - open_station_users_window_args
 *   - open_station_users_window_template_html
 *   - open_station_users_window_query_args
 *   - open_station_users_window_assignable_roles
 *
 * The URL-remap swap (Users tile → native window when opt-in is on)
 * is implemented JS-side in `src/desktop.ts` via
 * `registerNativeUrlRemap`.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/permissions.php';
require_once __DIR__ . '/login-tracker.php';
require_once __DIR__ . '/window.php';
require_once __DIR__ . '/rest.php';

<?php
/**
 * OpenStation — Native Plugins Window module bootstrap.
 *
 * Replaces the chromeless `plugins.php` + `plugin-install.php` iframes
 * with a single native window containing two tabs: an Installed list
 * (manage activations + updates + delete) and a curated Discover store
 * (explore wp.org, view rich detail in a `<os-flyout>`, install by
 * slug, upload .zip, drag-drop a .zip onto the window).
 *
 * Public PHP surface (all filterable):
 *
 *   - openstation_plugins_window_user_can_register
 *   - openstation_plugins_window_user_can_use
 *   - openstation_plugins_window_args
 *   - openstation_plugins_window_template_html
 *   - openstation_plugins_window_browse_args
 *   - openstation_plugins_window_browse_response
 *   - openstation_plugins_window_info_response
 *   - openstation_plugins_window_review_parser
 *
 * The dock-side swap (Plugins tile → native window when opt-in is on)
 * is implemented JS-side in `src/desktop.ts` via
 * `registerNativeUrlRemap` — this module owns only the window itself,
 * not the entry point.
 *
 * Plugin Check posture: NEVER `require_once ABSPATH . 'wp-admin/…'`.
 * Anything that needs admin-only classes (`Plugin_Upgrader`,
 * `WP_Filesystem`, `plugins_api`) lives on `admin-ajax.php`
 * (`includes/plugins-window/ajax.php`) where those files are already
 * loaded. Pure data enrichment lives on REST field decorators
 * (`includes/plugins-window/rest-fields.php`).
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/permissions.php';
require_once __DIR__ . '/window.php';
require_once __DIR__ . '/rest-fields.php';
require_once __DIR__ . '/ajax.php';

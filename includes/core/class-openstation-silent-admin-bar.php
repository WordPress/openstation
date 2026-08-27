<?php
/**
 * OpenStation — the admin bar a window builds instead of the real one.
 *
 * **This file is required lazily, not at bootstrap.** It extends
 * `WP_Admin_Bar`, which WordPress only loads inside
 * `_wp_admin_bar_init()` — requiring this at plugin load would fatal
 * on a missing parent. The `wp_admin_bar_class` filter runs *after*
 * that require, which is the one moment the parent is guaranteed
 * present, so {@see openstation_chromeless_silence_admin_bar()} pulls
 * this file in there.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * A `WP_Admin_Bar` that never asks anyone for nodes.
 *
 * Fully functional in every other respect — `add_node()` works,
 * `get_nodes()` answers, `$wp_admin_bar` stays a real object — so a
 * plugin that touches the global outside the `admin_bar_menu` hook
 * finds what it expects. Only the solicitation is skipped.
 */
class OpenStation_Silent_Admin_Bar extends WP_Admin_Bar {

	/**
	 * Skips the `admin_bar_menu` hook.
	 *
	 * The parent's `add_menus()` registers core's twenty-odd node
	 * callbacks and then fires `admin_bar_menu`, running every
	 * callback any plugin has on it — each resolving links, counting
	 * things, checking capabilities — to build a bar this window
	 * never draws.
	 */
	public function add_menus() {}
}

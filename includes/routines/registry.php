<?php
/**
 * Desktop Mode — Routines: in-memory registries.
 *
 * Three static-store helpers, one per registration surface:
 *
 *   - `wpdm_routine_trigger_registry()` — declared trigger metadata
 *     (label, payload schema, group, icon). Plugins may declare
 *     hooks here; undeclared hooks still work via the catch-all
 *     "raw hook" trigger type, but they get no friendly label or
 *     payload autocomplete.
 *
 *   - `wpdm_routine_action_registry()` — first-class action handlers
 *     (callables) keyed by slug. Commands and AI tools are reused
 *     verbatim — the executor falls back to those registries for
 *     `command:*` and `ai_tool:*` step kinds, so you only need to
 *     register here when the action isn't already a command/tool.
 *
 *   - `wpdm_routine_template_registry()` — starter recipes shipped
 *     by the plugin author. The Routines UI lists them in the
 *     "Templates" tab and one-click-installs into a CPT entry.
 *
 * All three follow the same read/write convention used elsewhere
 * in the plugin (see `desktop_mode_desktop_ai_tool_registry`):
 * pass a key + value to write, no args to read the whole store.
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Trigger registry.
 *
 * @since 0.22.0
 *
 * @param string     $key   Trigger id (a hook name like `comment_post`).
 * @param array|null $entry Entry to store, or null to read.
 * @return array|null|array<string,array>
 */
function wpdm_routine_trigger_registry( $key = '', $entry = null ) {
	static $store = array();
	if ( '' === (string) $key ) {
		return $store;
	}
	if ( null !== $entry ) {
		$store[ (string) $key ] = $entry;
	}
	return isset( $store[ (string) $key ] ) ? $store[ (string) $key ] : null;
}

/**
 * Action registry.
 *
 * @since 0.22.0
 *
 * @param string     $key   Action slug (`my_plugin.send_slack`).
 * @param array|null $entry Entry to store, or null to read.
 * @return array|null|array<string,array>
 */
function wpdm_routine_action_registry( $key = '', $entry = null ) {
	static $store = array();
	if ( '' === (string) $key ) {
		return $store;
	}
	if ( null !== $entry ) {
		$store[ (string) $key ] = $entry;
	}
	return isset( $store[ (string) $key ] ) ? $store[ (string) $key ] : null;
}

/**
 * Template registry.
 *
 * @since 0.22.0
 *
 * @param string     $key   Template id.
 * @param array|null $entry Entry to store, or null to read.
 * @return array|null|array<string,array>
 */
function wpdm_routine_template_registry( $key = '', $entry = null ) {
	static $store = array();
	if ( '' === (string) $key ) {
		return $store;
	}
	if ( null !== $entry ) {
		$store[ (string) $key ] = $entry;
	}
	return isset( $store[ (string) $key ] ) ? $store[ (string) $key ] : null;
}

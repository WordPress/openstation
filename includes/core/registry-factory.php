<?php
/**
 * Registry factory — Desktop Mode.
 *
 * **Why this exists.** Across the plugin, ~15 PHP "registry"
 * functions follow the same shape:
 *
 *     function desktop_mode_<thing>_registry( $id = '', $entry = null ) {
 *         static $store = array();
 *         if ( '__flush__' === (string) $id ) { $store = array(); return array(); }
 *         if ( '' === (string) $id ) return $store;
 *         if ( null !== $entry ) $store[ $id ] = $entry;
 *         return isset( $store[ $id ] ) ? $store[ $id ] : null;
 *     }
 *
 * Native windows, widgets, wallpapers, icons, window-tabs, commands,
 * settings tabs, window themes, window controls, window slots, window
 * chrome, dock-rail renderers, palettes, title-bar buttons, toast
 * types — all the same body with cosmetic differences. New registries
 * (palettes, future surfaces) hand-copy the pattern each time.
 *
 * This file replaces the boilerplate with two factories. Existing
 * registry functions in `includes/components.php`, `commands.php`,
 * `settings-tabs.php`, `window-chrome.php`, etc. can become one-line
 * forwarders calling these factories.
 *
 * @package Desktop_Mode
 * @since   0.8.1
 */

defined( 'ABSPATH' ) || exit;

/**
 * Build a per-id metadata registry.
 *
 * Returns a closure with the canonical registry signature:
 *
 *   $store         — `( '' )`              → full map
 *   read           — `( $id )`             → entry or null
 *   write          — `( $id, $entry )`     → store + return entry
 *   flush          — `( '__flush__' )`     → clear store; return empty array
 *
 * Each call to this factory creates an INDEPENDENT closure with its
 * own private `$state` array — closures in PHP capture by reference
 * via the `use ( &$state )` clause. Every registry instance is
 * therefore isolated; different registries cannot stomp on each other.
 *
 * @since 0.8.1
 *
 * @param array $initial Optional initial entries keyed by id.
 * @return callable Registry closure.
 */
function desktop_mode_create_registry( $initial = array() ) {
	$state = is_array( $initial ) ? $initial : array();
	return static function ( $id = '', $entry = null ) use ( &$state ) {
		// Flush — used by tests + the deactivation path that needs to
		// rebuild the registry after a plugin unloaded its callbacks.
		if ( '__flush__' === (string) $id ) {
			$state = array();
			return array();
		}
		// Read all.
		if ( '' === (string) $id ) {
			return $state;
		}
		// Write.
		if ( null !== $entry ) {
			$state[ (string) $id ] = $entry;
			return $entry;
		}
		// Read one.
		$key = (string) $id;
		return isset( $state[ $key ] ) ? $state[ $key ] : null;
	};
}

/**
 * Build a script-handle registry — boolean-flagged set of WP script
 * handles that the live-refresh payload should advertise so the
 * client can lazy-load them.
 *
 * Same shape as {@see desktop_mode_create_registry()} but values are
 * coerced to bool, and the read-one path returns `false` (not `null`)
 * when the handle is unknown — matching the existing convention used
 * across `*_script_registry()` functions.
 *
 * @since 0.8.1
 *
 * @param array $initial Optional initial flags keyed by handle.
 * @return callable Script-registry closure.
 */
function desktop_mode_create_script_registry( $initial = array() ) {
	$state = is_array( $initial ) ? $initial : array();
	return static function ( $handle = '', $value = null ) use ( &$state ) {
		if ( '__flush__' === (string) $handle ) {
			$state = array();
			return array();
		}
		if ( '' === (string) $handle ) {
			return $state;
		}
		if ( null !== $value ) {
			$state[ (string) $handle ] = (bool) $value;
			return (bool) $value;
		}
		$key = (string) $handle;
		return isset( $state[ $key ] ) ? $state[ $key ] : false;
	};
}

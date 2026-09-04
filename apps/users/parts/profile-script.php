<?php
/**
 * Users — the `<os-user-profile>` companion bundle.
 *
 * The profile surface (`apps/users/profile/`) is one bundle,
 * `assets/js/apps/user-profile[.min].js`, registered under the handle
 * `openstation-user-profile` and loaded as a first-open companion of
 * BOTH windows that host the element — the Users app (its Profile
 * tab) and the User Edit app — instead of a copy compiled into each
 * app's client view. The element takes its facts, its REST access
 * and its toast from properties the hosting app sets from
 * `updated()`, so the bundle carries no config of its own.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** The companion script handle. */
const OPENSTATION_USER_PROFILE_HANDLE = 'openstation-user-profile';

/**
 * Register the bundle. Hooked after the framework has loaded the apps
 * (the parts load DURING `init` @10, so a hook at 10 would never fire).
 */
function openstation_users_profile_register_script() {
	$suffix = openstation_asset_suffix();
	$path   = OPENSTATION_DIR . 'assets/js/apps/user-profile' . $suffix . '.js';
	wp_register_script(
		OPENSTATION_USER_PROFILE_HANDLE,
		OPENSTATION_URL . 'assets/js/apps/user-profile' . $suffix . '.js',
		array( 'wp-i18n' ),
		file_exists( $path ) ? (string) filemtime( $path ) : OPENSTATION_VERSION,
		true
	);
	wp_set_script_translations( OPENSTATION_USER_PROFILE_HANDLE, 'desktop-mode', OPENSTATION_DIR . 'languages' );
}
add_action( 'init', 'openstation_users_profile_register_script', 11 );

/**
 * Ride the two app windows: append the bundle to their companion
 * scripts, so it is in the tab before the runtime mounts either.
 *
 * @param array<string,mixed> $window_args `openstation_register_window()` args.
 * @param string              $app_id      App id.
 * @return array<string,mixed>
 */
function openstation_users_profile_window_args( $window_args, $app_id ) {
	if ( ! is_array( $window_args ) || ! in_array( (string) $app_id, array( 'desktop-mode-users', 'desktop-mode-user-edit' ), true ) ) {
		return $window_args;
	}
	// The handle registers on `init`; a caller that rebuilt `$wp_scripts`
	// since (a script manager, a test) would otherwise hand the window
	// a handle nothing resolves.
	if ( ! wp_script_is( OPENSTATION_USER_PROFILE_HANDLE, 'registered' ) ) {
		openstation_users_profile_register_script();
	}
	$scripts = isset( $window_args['scripts'] ) ? (array) $window_args['scripts'] : array();
	if ( ! in_array( OPENSTATION_USER_PROFILE_HANDLE, $scripts, true ) ) {
		$scripts[] = OPENSTATION_USER_PROFILE_HANDLE;
	}
	$window_args['scripts'] = $scripts;
	return $window_args;
}
add_filter( 'openstation_app_window_args', 'openstation_users_profile_window_args', 10, 2 );

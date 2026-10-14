<?php
/**
 * Station Home — the `<os-tribute-heart>` companion bundle.
 *
 * Station Home is a server view with no client half, so the one
 * animated detail it has, the heart in "Thank you, Eric", ships as a
 * small bundle of its own, `assets/js/apps/station-home-tribute[.min].js`,
 * registered under the handle `openstation-station-home-tribute` and
 * loaded as a first-open companion of the Station Home window.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** The companion script handle. */
const OPENSTATION_STATION_HOME_TRIBUTE_HANDLE = 'openstation-station-home-tribute';

/**
 * Register the bundle. Hooked after the framework has loaded the apps
 * (the parts load DURING `init` @10, so a hook at 10 would never fire).
 */
function openstation_station_home_tribute_register_script() {
	$suffix = openstation_asset_suffix();
	$path   = OPENSTATION_DIR . 'assets/js/apps/station-home-tribute' . $suffix . '.js';
	wp_register_script(
		OPENSTATION_STATION_HOME_TRIBUTE_HANDLE,
		OPENSTATION_URL . 'assets/js/apps/station-home-tribute' . $suffix . '.js',
		array(),
		file_exists( $path ) ? (string) filemtime( $path ) : OPENSTATION_VERSION,
		true
	);
}
add_action( 'init', 'openstation_station_home_tribute_register_script', 11 );

/**
 * Ride the Station Home window: append the bundle to its companion
 * scripts, so the element is defined before the view paints.
 *
 * @param array<string,mixed> $window_args `openstation_register_window()` args.
 * @param string              $app_id      App id.
 * @return array<string,mixed>
 */
function openstation_station_home_tribute_window_args( $window_args, $app_id ) {
	if ( ! is_array( $window_args ) || 'desktop-mode-dashboard' !== (string) $app_id ) {
		return $window_args;
	}
	// The handle registers on `init`; a caller that rebuilt `$wp_scripts`
	// since would otherwise hand the window a handle nothing resolves.
	if ( ! wp_script_is( OPENSTATION_STATION_HOME_TRIBUTE_HANDLE, 'registered' ) ) {
		openstation_station_home_tribute_register_script();
	}
	$scripts = isset( $window_args['scripts'] ) ? (array) $window_args['scripts'] : array();
	if ( ! in_array( OPENSTATION_STATION_HOME_TRIBUTE_HANDLE, $scripts, true ) ) {
		$scripts[] = OPENSTATION_STATION_HOME_TRIBUTE_HANDLE;
	}
	$window_args['scripts'] = $scripts;
	return $window_args;
}
add_filter( 'openstation_app_window_args', 'openstation_station_home_tribute_window_args', 10, 2 );

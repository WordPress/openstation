<?php
/**
 * OpenStation registration for Popup Siege.
 *
 * @package OpenStationPopupSiege
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register Popup Siege's discovery metadata and lazy-loaded browser runtime.
 */
function popup_siege_register_game() {
	if ( ! function_exists( 'open_station_register_game' ) ) {
		return;
	}

	$manifest = include POPUP_SIEGE_DIR . 'games/popup-breaker/game.php';
	if ( ! is_array( $manifest ) ) {
		return;
	}

	$script = (string) $manifest['script'];
	$style  = (string) $manifest['style'];
	$handle = 'desktop-mode-popup-siege';

	wp_register_script(
		$handle,
		plugins_url( $script, POPUP_SIEGE_FILE ),
		array( 'openstation' ),
		POPUP_SIEGE_ASSET_VERSION,
		true
	);

	$config           = $manifest['config'];
	$config['cssUrl'] = plugins_url( $style, POPUP_SIEGE_FILE );

	open_station_register_game(
		$manifest['id'],
		array(
			'title'         => $manifest['title'],
			'description'   => $manifest['description'],
			'icon'          => $manifest['icon'],
			'script'        => $handle,
			'score_columns' => $manifest['score_columns'],
			'config'        => $config,
		)
	);
}
